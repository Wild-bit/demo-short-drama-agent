import { Inject, Injectable } from "@nestjs/common";
import { AGENT_TOOLS } from "./types";
import type { AgentTool, ToolExecutionContext } from "./types";

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, AgentTool>();
  constructor(@Inject(AGENT_TOOLS) tools: AgentTool[]) {
    for (const tool of tools) {
      this.tools.set(tool.definition.name, tool);
    }
  }

  getDefinitions() {
    return [...this.tools.values()].map((tool) => tool.definition);
  }

  async execute(
    name: string,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`未知工具：${name}`);
    }

    return tool.execute(input, context);
  }
}
