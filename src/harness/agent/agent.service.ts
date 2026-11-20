import { Injectable, Logger } from "@nestjs/common";
import { getDeepSeekContextConfig } from "@/config/deepseek-context";
import { generateDeepSeekText } from "@/gateway/text/deepseek";
import { ToolRegistryService } from "@/tools/tool-registry.service";
import type { ToolExecutionContext } from "@/tools/types";
import type { ToolCall } from "@/gateway/text/types";
import { agentSystemPrompt } from "@/prompts/system/agent";
import type {
  AgentRunResult,
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
    history: readonly (SessionHistoryEntry | SessionMessagePayload)[],
    previousCheckpoint?: ContextCheckpoint,
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
    const archive = history.map((entry, index) =>
      "sequence" in entry ? entry : { sequence: index + 1, message: entry },
    );
    // 回查范围随每次模型请求重新计算，只在这一轮内使用。
    let archivedCount = 0;
    const turnToolRegistry = archive.length > 0
      ? this.toolRegistry.withAdditionalTools({
        definition: readSessionHistoryDefinition,
        execute: async (input) => readSessionHistory(archive.slice(0, archivedCount), input, inputBudgetTokens),
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
    while (true) {
      const liveHistory = archive.filter(
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
            const { checkpoint, usage } = await summarizeHistory(batch);
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
            this.logger.warn({ event: "context_summary_failed" });
          }
        }
      }

      const { request, inputSizes } = input;
      modelCallCount += 1;
      const response = await generateDeepSeekText(request);
      this.logger.log({
        event: "model_input_measured",
        modelCallNumber: modelCallCount,
        ...inputSizes,
        ...response.usage,
      });

      newMessages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });
      toolCalls.push(...response.toolCalls);

      if (response.toolCalls.length === 0) {
        return {
          result: {
            status: "completed",
            text: response.text,
            modelCallCount,
            ...(summaryModelCallCount > 0 ? { summaryModelCallCount } : {}),
            toolCalls,
            toolResults,
          },
          newMessages,
          ...(activeCheckpoint !== previousCheckpoint ? { checkpoint: activeCheckpoint } : {}),
        };
      }

      // 只允许回查本次模型请求没有直接拿到的原始历史。
      const firstVisibleSequence = archive.findIndex(
        ({ sequence }) => sequence > (activeCheckpoint?.coveredThroughSequence ?? 0),
      );
      archivedCount = firstVisibleSequence === -1
        ? archive.length
        : firstVisibleSequence + inputSizes.droppedHistoryMessages;
      for (const call of response.toolCalls) {
        const input: unknown = JSON.parse(call.arguments);
        const result = await turnToolRegistry.execute(call.name, input, context);

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
}
