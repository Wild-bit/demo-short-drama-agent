import { Injectable } from "@nestjs/common";
import { generateDeepSeekText } from "@/gateway/text/deepseek";
import { ToolRegistryService } from "@/tools/tool-registry.service";
import type { ToolExecutionContext } from "@/tools/types";
import type { TextMessage, ToolCall } from "@/gateway/text/types";
import { agentSystemPrompt } from "@/prompts/system/agent";
import type { ToolExecutionRecord, AgentRunResult } from "./types";

@Injectable()
export class AgentService {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async runOnce(
    userRequest: string,
    context: ToolExecutionContext,
  ): Promise<AgentRunResult> {
    const messages: TextMessage[] = [
      {
        role: "system",
        content: agentSystemPrompt,
      },
      {
        role: "user",
        content: userRequest,
      },
    ];
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolExecutionRecord[] = [];
    let modelCallCount = 0;
    while (true) {
      modelCallCount += 1;

      const response = await generateDeepSeekText({
        messages,
        tools: this.toolRegistry.getDefinitions(),
      });

      // 每轮模型响应只保存一次。
      messages.push({
        role: "assistant",
        content: response.text,
        toolCalls: response.toolCalls,
      });

      // 汇总各轮模型提出的工具调用。
      toolCalls.push(...response.toolCalls);

      // 模型不再请求工具，结束本次运行。
      if (response.toolCalls.length === 0) {
        return {
          status: "completed",
          text: response.text,
          modelCallCount,
          toolCalls,
          toolResults,
        };
      }

      // 执行本轮全部工具，并追加对应结果。
      for (const call of response.toolCalls) {
        const input: unknown = JSON.parse(call.arguments);

        const result = await this.toolRegistry.execute(
          call.name,
          input,
          context,
        );

        messages.push({
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
