import type { ToolCall } from "@/gateway/text/types";
import type { TextMessage } from "@/gateway/text/types";

export type ToolExecutionRecord = {
  toolCallId: string;
  name: string;
  result: unknown;
};

export type AgentRunResult = {
  status: "completed";
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
  sequence: number;
  message: SessionMessagePayload;
};

export type ContextCheckpoint = {
  coveredThroughSequence: number;
  text: string;
};
