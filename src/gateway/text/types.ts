import type { ToolDefinition } from "@/tools/types";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};
export type TextInputMessage = {
  role: "system" | "user";
  content: string;
};

export type TextAssistantMessage = {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
};

export type TextToolResultMessage = {
  role: "tool";
  content: string;
  toolCallId: string;
};

export type TextMessage =
  | TextInputMessage
  | TextAssistantMessage
  | TextToolResultMessage;

export type TextGenerationRequest = {
  messages: TextMessage[];
  outputFormat?: "text" | "json";
  tools?: ToolDefinition[];
};

export type TextGenerationResult = {
  text: string;
  toolCalls: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};
