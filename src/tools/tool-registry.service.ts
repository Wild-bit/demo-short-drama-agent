import { Inject, Injectable } from "@nestjs/common";
import { AGENT_TOOLS } from "./types";
import type { AgentTool, ToolExecutionContext } from "./types";

@Injectable()
export class ToolRegistryService {
  private readonly tools = new Map<string, AgentTool>();
  constructor(@Inject(AGENT_TOOLS) tools: AgentTool[]) {
    for (const tool of tools) {
      const name = tool.definition.name;
      if (this.tools.has(name)) {
        throw new Error(`重复工具名：${name}`);
      }
      this.tools.set(name, tool);
    }
  }

  /** 为本轮创建工具表，保留原注册器中的工具实例。 */
  withAdditionalTools(...additionalTools: AgentTool[]): ToolRegistryService {
    return new ToolRegistryService([...this.tools.values(), ...additionalTools]);
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
