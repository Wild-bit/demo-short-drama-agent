import { Injectable } from "@nestjs/common";
import { generateDeepSeekText } from "@/gateway/text/deepseek";
import { ToolRegistryService } from "@/tools/tool-registry.service";
import type { ToolExecutionContext } from "@/tools/types";
import type { TextMessage, ToolCall } from "@/gateway/text/types";
import { agentSystemPrompt } from "@/prompts/system/agent";
import type { ToolExecutionRecord, AgentRunResult } from "../types";
import { SessionMessagePayload } from "../types";

@Injectable()
export class AgentService {
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
      const messages: TextMessage[] = [
        { role: "system", content: agentSystemPrompt },
        ...history,
        ...newMessages,
      ];

      modelCallCount += 1;
      const response = await generateDeepSeekText({
        messages,
        tools: this.toolRegistry.getDefinitions(),
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
