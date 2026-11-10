/** 程序提供的可信执行上下文，不由模型填写。 */
export type ToolExecutionContext = {
  ownerId: string;
};

/** 给模型看的工具说明。 */
export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
};

/** 所有工具共同遵守的执行约定。 */
export interface AgentTool {
  readonly definition: ToolDefinition;

  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

/** Nest 注入工具实例列表时使用的标识。 */
export const AGENT_TOOLS = Symbol("AGENT_TOOLS");
