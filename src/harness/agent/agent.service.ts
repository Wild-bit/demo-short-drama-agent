import { RunTrace } from "../trace/run-trace";
import { Injectable, Logger } from "@nestjs/common";
import { MAX_AGENT_TOOL_CALLS } from "@/config/agent-run-control";
import { getDeepSeekContextConfig } from "@/config/deepseek-context";
import { generateDeepSeekText } from "@/gateway/text/deepseek";
import { ToolRegistryService } from "@/tools/tool-registry.service";
import type { ToolDefinition, ToolExecutionContext } from "@/tools/types";
import type { TextGenerationResult, ToolCall } from "@/gateway/text/types";
import { agentSystemPrompt } from "@/prompts/system/agent";
import {
  appendAssistantSegment,
  extractAssetCardItems,
  type AgentRunResult,
  type AgentRunState,
  type ChatAssetCardItem,
  type ChatUiBlock,
  type ContextCheckpoint,
  type SessionHistoryEntry,
  type SessionMessagePayload,
  type ToolExecutionRecord,
} from "../types";
import { buildModelInput } from "./context";
import { prepareHistorySummary, summarizeHistory } from "./compaction";
import { readSessionHistory, readSessionHistoryDefinition } from "./history-recall";
import { proposeStoryboardTool } from "@/tools/propose-storyboard.tool";
import type { StoryboardProposal, StoryboardTurnContext } from "@/domain/storyboard";

/** 一次 Agent 执行中随循环变化的状态，只在本轮内有效。 */
type TurnState = {
  /** 本轮新增消息；工具结果会持续追加，下一次模型请求据此重新装配输入。 */
  newMessages: SessionMessagePayload[];
  toolCalls: ToolCall[];
  toolResults: ToolExecutionRecord[];
  /** 本轮搜索命中并去重后的素材，用于推送累积的素材卡片。 */
  matchedAssets: Map<string, ChatAssetCardItem>;
  proposal?: StoryboardProposal;
  assistantText: string;
  modelCallCount: number;
  /** 本轮已经尝试过的摘要次数，保证一次执行最多摘要一次。 */
  summaryModelCallCount: number;
  /** 当前使用的检查点；采用新摘要时会推进。 */
  activeCheckpoint?: ContextCheckpoint;
  /** 可回查的历史条数上界，每次发起工具调用前重新计算。 */
  archivedCount: number;
};

/** 一次模型输入的组装结果与体积测量。 */
type ModelInput = ReturnType<typeof buildModelInput>;

/** 一轮执行的产出：运行结果、待保存的新消息，以及推进后的检查点。 */
type TurnResult = {
  result: AgentRunResult;
  newMessages: SessionMessagePayload[];
  checkpoint?: ContextCheckpoint;
};

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async runOnce(
    userRequest: string,
    context: ToolExecutionContext,
  ): Promise<AgentRunResult> {
    const { result } = await this.runWithHistory(userRequest, context, []);
    return result;
  }

  async runWithHistory(
    userRequest: string,
    context: ToolExecutionContext,
    history: readonly SessionHistoryEntry[],
    previousCheckpoint?: ContextCheckpoint,
    trace = new RunTrace(),
    storyboard?: StoryboardTurnContext,
  ): Promise<TurnResult> {
    const { inputBudgetTokens } = getDeepSeekContextConfig();
    const turn: TurnState = {
      newMessages: [
        {
          role: "user",
          content: userRequest,
          ...(storyboard?.selectedShot && { selectedShot: storyboard.selectedShot }),
        },
      ],
      toolCalls: [],
      toolResults: [],
      matchedAssets: new Map(),
      assistantText: "",
      modelCallCount: 0,
      summaryModelCallCount: 0,
      activeCheckpoint: previousCheckpoint,
      archivedCount: 0,
    };
    const registry = this.buildTurnRegistry(history, inputBudgetTokens, storyboard, turn);
    const tools = registry.getDefinitions();
    const finishTurn = (state: AgentRunState, text: string) =>
      this.buildTurnResult(turn, state, text, previousCheckpoint);

    while (true) {
      // 1. 装配本次模型输入；历史被截断且尚未摘要时，先尝试压缩旧历史。
      const input = await this.prepareTurnInput(history, turn, tools, inputBudgetTokens, trace);

      // 2. 发起模型调用，流式文本与输入体积在这里产出。
      const response = await this.callModel(input, trace, turn);

      // 整批检查，避免保存一批只有部分工具结果的调用。
      if (turn.toolCalls.length + response.toolCalls.length > MAX_AGENT_TOOL_CALLS) {
        const limitNotice = `本轮请求的工具调用超过上限（${MAX_AGENT_TOOL_CALLS} 次），请缩小任务范围后继续。`;
        turn.newMessages.push({ role: "assistant", content: limitNotice });
        turn.assistantText = appendAssistantSegment(turn.assistantText, limitNotice);
        return finishTurn({ status: "stopped", reason: "tool_call_limit" }, turn.assistantText || limitNotice);
      }

      // 3. 记录助手回复；没有工具调用说明本轮完成。
      this.appendAssistantTurn(turn, response);
      if (response.toolCalls.length === 0) {
        return finishTurn({ status: "completed" }, turn.assistantText || response.text);
      }

      // 4. 执行工具并把结果加入本轮消息，下一次循环重新装配输入。
      await this.runToolBatch(
        response.toolCalls,
        registry,
        context,
        history,
        turn,
        trace,
        input.inputSizes.droppedHistoryMessages,
      );
    }
  }

  /** 组装本轮注册器：有历史时加入回查工具，项目会话再加入分镜草案工具。 */
  private buildTurnRegistry(
    history: readonly SessionHistoryEntry[],
    inputBudgetTokens: number,
    storyboard: StoryboardTurnContext | undefined,
    turn: TurnState,
  ): ToolRegistryService {
    // 回查范围随每次模型请求重新计算，只在这一轮内使用。
    let registry = history.length > 0
      ? this.toolRegistry.withAdditionalTools({
        definition: readSessionHistoryDefinition,
        execute: async (input) =>
          readSessionHistory(history.slice(0, turn.archivedCount), input, inputBudgetTokens),
      })
      : this.toolRegistry;
    if (storyboard) {
      registry = registry.withAdditionalTools(
        proposeStoryboardTool(storyboard, (draft) => {
          turn.proposal = draft;
        }),
      );
    }
    return registry;
  }

  /** 按当前检查点过滤历史、组装输入；必要时生成摘要并换用新输入。 */
  private async prepareTurnInput(
    history: readonly SessionHistoryEntry[],
    turn: TurnState,
    tools: ToolDefinition[],
    inputBudgetTokens: number,
    trace: RunTrace,
  ): Promise<ModelInput> {
    const liveHistory = history.filter(
      ({ sequence }) => sequence > (turn.activeCheckpoint?.coveredThroughSequence ?? 0),
    );
    const assembleInput = (
      entries: SessionHistoryEntry[],
      checkpoint: ContextCheckpoint | undefined,
    ) => buildModelInput(
      agentSystemPrompt,
      entries.map(({ message }) => message),
      turn.newMessages,
      tools,
      inputBudgetTokens,
      checkpoint,
    );

    const input = assembleInput(liveHistory, turn.activeCheckpoint);
    if (turn.summaryModelCallCount > 0 || input.inputSizes.droppedHistoryMessages === 0) {
      return input;
    }
    return this.summarizeContext(liveHistory, input, assembleInput, turn, inputBudgetTokens, trace);
  }

  /** 把被移出窗口的旧历史压成摘要；失败时沿用原输入，本轮照常继续。 */
  private async summarizeContext(
    liveHistory: SessionHistoryEntry[],
    input: ModelInput,
    assembleInput: (
      entries: SessionHistoryEntry[],
      checkpoint: ContextCheckpoint | undefined,
    ) => ModelInput,
    turn: TurnState,
    inputBudgetTokens: number,
    trace: RunTrace,
  ): Promise<ModelInput> {
    const batch = prepareHistorySummary(
      liveHistory.slice(0, input.inputSizes.droppedHistoryMessages),
      turn.activeCheckpoint,
      inputBudgetTokens,
    );
    if (!batch) return input;

    turn.summaryModelCallCount += 1;
    try {
      const { checkpoint, usage } = await trace.recordModelCall(
        "summary",
        () => summarizeHistory(batch, trace.signal),
      );
      let nextInput = input;
      if (checkpoint) {
        const updated = assembleInput(
          liveHistory.filter(({ sequence }) => sequence > checkpoint.coveredThroughSequence),
          checkpoint,
        );
        if (updated.inputSizes.summaryIncluded) {
          turn.activeCheckpoint = checkpoint;
          nextInput = updated;
        }
      }
      this.logger.log({
        event: "context_summary_finished",
        accepted: turn.activeCheckpoint === checkpoint && checkpoint !== undefined,
        coveredThroughSequence: turn.activeCheckpoint?.coveredThroughSequence,
        ...usage,
      });
      return nextInput;
    } catch {
      trace.signal?.throwIfAborted();
      this.logger.warn({ event: "context_summary_failed" });
      return input;
    }
  }

  /** 发起一次正式模型调用，转发流式文本并记录输入体积与用量。 */
  private async callModel(
    input: ModelInput,
    trace: RunTrace,
    turn: TurnState,
  ): Promise<TextGenerationResult> {
    const { request, inputSizes } = input;
    turn.modelCallCount += 1;
    const emit = trace.emit;
    const response = await trace.recordModelCall("model", () => generateDeepSeekText(request, {
      signal: trace.signal,
      onTextDelta: emit
        ? (text) => emit({ type: "text_delta", modelCallNumber: turn.modelCallCount, text })
        : undefined,
    }), turn.modelCallCount);
    this.logger.log({
      event: "model_input_measured",
      modelCallNumber: turn.modelCallCount,
      ...inputSizes,
      ...response.usage,
    });
    return response;
  }

  /** 追加本次助手回复；最终回复一并写入供界面恢复的草案与素材卡片。 */
  private appendAssistantTurn(turn: TurnState, response: TextGenerationResult) {
    turn.assistantText = appendAssistantSegment(turn.assistantText, response.text);
    const finalUiBlocks = response.toolCalls.length === 0 ? this.currentUiBlocks(turn) : undefined;
    turn.newMessages.push({
      role: "assistant",
      content: response.text,
      ...(response.toolCalls.length > 0 && { toolCalls: response.toolCalls }),
      ...(response.toolCalls.length === 0 && turn.proposal && { storyboardProposal: turn.proposal }),
      ...(finalUiBlocks && { uiBlocks: finalUiBlocks }),
    });
    turn.toolCalls.push(...response.toolCalls);
  }

  /** 依次执行本次模型请求的工具调用，结果追加到本轮消息。 */
  private async runToolBatch(
    calls: ToolCall[],
    registry: ToolRegistryService,
    context: ToolExecutionContext,
    history: readonly SessionHistoryEntry[],
    turn: TurnState,
    trace: RunTrace,
    droppedHistoryMessages: number,
  ) {
    // 只允许回查本次模型请求没有直接拿到的原始历史。
    const firstVisibleIndex = history.findIndex(
      ({ sequence }) => sequence > (turn.activeCheckpoint?.coveredThroughSequence ?? 0),
    );
    turn.archivedCount = firstVisibleIndex === -1
      ? history.length
      : firstVisibleIndex + droppedHistoryMessages;

    for (const call of calls) {
      const result = await trace.recordToolCall(
        call,
        () => this.executeToolCall(call, registry, context),
      );
      if (call.name === "search_user_assets") {
        await this.reportAssetCards(result, turn, trace);
      }
      turn.newMessages.push({
        role: "tool",
        toolName: call.name,
        toolCallId: call.id,
        content: JSON.stringify(result),
      });
      turn.toolResults.push({
        toolCallId: call.id,
        name: call.name,
        result,
      });
    }
  }

  /** 搜索命中新素材时，推送一张包含本轮全部候选的去重卡片。 */
  private async reportAssetCards(result: unknown, turn: TurnState, trace: RunTrace) {
    const found = extractAssetCardItems(result);
    let added = false;
    for (const item of found) {
      if (!turn.matchedAssets.has(item.id)) {
        turn.matchedAssets.set(item.id, item);
        added = true;
      }
    }
    if (!added) return;
    await trace.emit?.({
      type: "ui_block",
      block: { component: "asset_gallery", assets: [...turn.matchedAssets.values()] },
    });
  }

  private currentUiBlocks(turn: TurnState): ChatUiBlock[] | undefined {
    return turn.matchedAssets.size > 0
      ? [{ component: "asset_gallery", assets: [...turn.matchedAssets.values()] }]
      : undefined;
  }

  /** 汇总本轮结果；检查点只在相对上一轮推进过时才交给会话存储。 */
  private buildTurnResult(
    turn: TurnState,
    state: AgentRunState,
    text: string,
    previousCheckpoint: ContextCheckpoint | undefined,
  ): TurnResult {
    const uiBlocks = state.status === "completed" ? this.currentUiBlocks(turn) : undefined;
    return {
      result: {
        ...state,
        text,
        ...(state.status === "completed" && turn.proposal && { storyboardProposal: turn.proposal }),
        ...(uiBlocks && { uiBlocks }),
        modelCallCount: turn.modelCallCount,
        ...(turn.summaryModelCallCount > 0 ? { summaryModelCallCount: turn.summaryModelCallCount } : {}),
        toolCalls: turn.toolCalls,
        toolResults: turn.toolResults,
      },
      newMessages: turn.newMessages,
      ...(turn.activeCheckpoint !== previousCheckpoint ? { checkpoint: turn.activeCheckpoint } : {}),
    };
  }

  /** 参数无法解析时向模型反馈本次调用失败，业务执行异常继续由上层处理。 */
  private async executeToolCall(call: ToolCall, registry: ToolRegistryService, context: ToolExecutionContext) {
    let input: unknown;
    try {
      input = JSON.parse(call.arguments);
    } catch {
      return { status: "blocked", reason: "invalid_arguments", message: "工具参数必须为有效 JSON，请修正后再调用。" };
    }
    return registry.execute(call.name, input, context);
  }
}
