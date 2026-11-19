import { Injectable, Logger } from "@nestjs/common";
import { generateDeepSeekText } from "@/gateway/text/deepseek";
import { ToolRegistryService } from "@/tools/tool-registry.service";
import type { ToolExecutionContext } from "@/tools/types";
import type { ToolCall } from "@/gateway/text/types";
import { agentSystemPrompt } from "@/prompts/system/agent";
import type { ToolExecutionRecord, AgentRunResult } from "../types";
import { SessionMessagePayload } from "../types";
import { buildModelInput } from "./context";

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
    history: readonly SessionMessagePayload[],
  ): Promise<{
    result: AgentRunResult;
    newMessages: SessionMessagePayload[];
  }> {
    const newMessages: SessionMessagePayload[] = [
      { role: "user", content: userRequest },
    ];
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolExecutionRecord[] = [];
    let modelCallCount = 0;
    while (true) {
      const tools = this.toolRegistry.getDefinitions();
      const { request, inputSizes } = buildModelInput(
        agentSystemPrompt,
        history,
        newMessages,
        tools,
      );

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
            toolCalls,
            toolResults,
          },
          newMessages,
        };
      }

      for (const call of response.toolCalls) {
        const input: unknown = JSON.parse(call.arguments);
        const result = await this.toolRegistry.execute(
          call.name,
          input,
          context,
        );

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
