import { RunTrace } from "../trace/run-trace";
import { Injectable, Logger } from "@nestjs/common";
import { MAX_AGENT_TOOL_CALLS } from "@/config/agent-run-control";
import { getDeepSeekContextConfig } from "@/config/deepseek-context";
import { generateDeepSeekText } from "@/gateway/text/deepseek";
import { ToolRegistryService } from "@/tools/tool-registry.service";
import type { ToolExecutionContext } from "@/tools/types";
import type { ToolCall } from "@/gateway/text/types";
import { agentSystemPrompt } from "@/prompts/system/agent";
import type {
  AgentRunResult,
  AgentRunState,
  ContextCheckpoint,
  SessionHistoryEntry,
  SessionMessagePayload,
  ToolExecutionRecord,
} from "../types";
import { buildModelInput } from "./context";
import { prepareHistorySummary, summarizeHistory } from "./compaction";
import { readSessionHistory, readSessionHistoryDefinition } from "./history-recall";

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
  ): Promise<{
    result: AgentRunResult;
    newMessages: SessionMessagePayload[];
    checkpoint?: ContextCheckpoint;
  }> {
    const { inputBudgetTokens } = getDeepSeekContextConfig();
    const newMessages: SessionMessagePayload[] = [
      { role: "user", content: userRequest },
    ];
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolExecutionRecord[] = [];
    // 回查范围随每次模型请求重新计算，只在这一轮内使用。
    let archivedCount = 0;
    const turnToolRegistry = history.length > 0
      ? this.toolRegistry.withAdditionalTools({
        definition: readSessionHistoryDefinition,
        execute: async (input) => readSessionHistory(history.slice(0, archivedCount), input, inputBudgetTokens),
      })
      : this.toolRegistry;
    const tools = turnToolRegistry.getDefinitions();
    const assembleInput = (
      entries: SessionHistoryEntry[],
      checkpoint: ContextCheckpoint | undefined,
    ) => buildModelInput(
      agentSystemPrompt,
      entries.map(({ message }) => message),
      newMessages,
      tools,
      inputBudgetTokens,
      checkpoint,
    );

    let activeCheckpoint = previousCheckpoint;
    let summaryModelCallCount = 0;
    let modelCallCount = 0;
    const finishTurn = (state: AgentRunState, text: string) => ({
      result: {
        ...state,
        text,
        modelCallCount,
        ...(summaryModelCallCount > 0 ? { summaryModelCallCount } : {}),
        toolCalls,
        toolResults,
      },
      newMessages,
      ...(activeCheckpoint !== previousCheckpoint ? { checkpoint: activeCheckpoint } : {}),
    });
    while (true) {
      const liveHistory = history.filter(
        ({ sequence }) => sequence > (activeCheckpoint?.coveredThroughSequence ?? 0),
      );
      let input = assembleInput(liveHistory, activeCheckpoint);
      if (summaryModelCallCount === 0 && input.inputSizes.droppedHistoryMessages > 0) {
        const batch = prepareHistorySummary(
          liveHistory.slice(0, input.inputSizes.droppedHistoryMessages),
          activeCheckpoint,
          inputBudgetTokens,
        );
        if (batch) {
          summaryModelCallCount += 1;
          try {
            const { checkpoint, usage } = await trace.recordModelCall("summary", () => summarizeHistory(batch, trace.signal));
            if (checkpoint) {
              const updated = assembleInput(
                liveHistory.filter(({ sequence }) => sequence > checkpoint.coveredThroughSequence),
                checkpoint,
              );
              if (updated.inputSizes.summaryIncluded) {
                activeCheckpoint = checkpoint;
                input = updated;
              }
            }
            this.logger.log({
              event: "context_summary_finished",
              accepted: activeCheckpoint === checkpoint && checkpoint !== undefined,
              coveredThroughSequence: activeCheckpoint?.coveredThroughSequence,
              ...usage,
            });
          } catch {
            trace.signal?.throwIfAborted();
            this.logger.warn({ event: "context_summary_failed" });
          }
        }
      }

      const { request, inputSizes } = input;
      modelCallCount += 1;
      const emit = trace.emit;
      const response = await trace.recordModelCall("model", () => generateDeepSeekText(request, {
        signal: trace.signal,
        onTextDelta: emit ? text => emit({ type: "text_delta", modelCallNumber: modelCallCount, text }) : undefined,
      }), modelCallCount);
      this.logger.log({
        event: "model_input_measured",
        modelCallNumber: modelCallCount,
        ...inputSizes,
        ...response.usage,
      });

      // 整批检查，避免保存一批只有部分工具结果的调用。
      if (toolCalls.length + response.toolCalls.length > MAX_AGENT_TOOL_CALLS) {
        const text = `本轮请求的工具调用超过上限（${MAX_AGENT_TOOL_CALLS} 次），请缩小任务范围后继续。`;
        newMessages.push({ role: "assistant", content: text });
        return finishTurn({ status: "stopped", reason: "tool_call_limit" }, text);
      }
      newMessages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });
      toolCalls.push(...response.toolCalls);

      if (response.toolCalls.length === 0) {
        return finishTurn({ status: "completed" }, response.text);
      }

      // 只允许回查本次模型请求没有直接拿到的原始历史。
      const firstVisibleIndex = history.findIndex(
        ({ sequence }) => sequence > (activeCheckpoint?.coveredThroughSequence ?? 0),
      );
      archivedCount = firstVisibleIndex === -1
        ? history.length
        : firstVisibleIndex + inputSizes.droppedHistoryMessages;
      for (const call of response.toolCalls) {
        const result = await trace.recordToolCall(call, () => this.executeToolCall(call, turnToolRegistry, context));

        newMessages.push({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(result),
        });
        toolResults.push({
          toolCallId: call.id,
          name: call.name,
          result,
        });
      }
    }
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
