import { Injectable } from "@nestjs/common";
import { generateDeepSeekText } from "@/gateway/text/deepseek";
import { ToolRegistryService } from "@/tools/tool-registry.service";
import type { ToolExecutionContext } from "@/tools/types";
import { agentSystemPrompt } from "@/prompts/system/agent";

@Injectable()
export class AgentService {
  constructor(private readonly toolRegistry: ToolRegistryService) {}

  async runOnce(userRequest: string, context: ToolExecutionContext) {
    const response = await generateDeepSeekText({
      messages: [
        {
          role: "system",
          content: agentSystemPrompt,
        },
        {
          role: "user",
          content: userRequest,
        },
      ],
      tools: this.toolRegistry.getDefinitions(),
    });
    const toolResults = [];

    for (const call of response.toolCalls) {
      const input: unknown = JSON.parse(call.arguments);

      const result = await this.toolRegistry.execute(call.name, input, context);

      toolResults.push({
        toolCallId: call.id,
        name: call.name,
        result,
      });
    }
    return {
      text: response.text,
      toolCalls: response.toolCalls,
      toolResults,
    };
  }
}
