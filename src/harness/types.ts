import type { ToolCall } from "@/gateway/text/types";

export type ToolExecutionRecord = {
  toolCallId: string;
  name: string;
  result: unknown;
};

export type AgentRunResult = {
  status: "completed";
  text: string;
  modelCallCount: number;
  toolCalls: ToolCall[];
  toolResults: ToolExecutionRecord[];
};
