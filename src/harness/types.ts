import type { ToolCall } from "@/gateway/text/types";
import type { TextMessage } from "@/gateway/text/types";

export type ToolExecutionRecord = {
  toolCallId: string;
  name: string;
  result: unknown;
};

export type AgentRunState =
  | { status: "completed" }
  | { status: "stopped"; reason: "tool_call_limit" };

export type AgentRunResult = AgentRunState & {
  text: string;
  modelCallCount: number;
  summaryModelCallCount?: number;
  toolCalls: ToolCall[];
  toolResults: ToolExecutionRecord[];
};

export type SessionMessagePayload =
  | Exclude<TextMessage, { role: "system" | "user" }>
  | {
      role: "user";
      content: string;
    };

export type SessionHistoryEntry = {
  /** 该消息写入当前会话时分配的序号，从 1 开始。 */
  sequence: number;
  message: SessionMessagePayload;
};

export type ContextCheckpoint = {
  /** 这份摘要覆盖到的最后一条原始消息序号，包含该条。 */
  coveredThroughSequence: number;
  text: string;
};
