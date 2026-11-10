import type { ToolDefinition } from "@/tools/types";

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type TextMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type TextGenerationRequest = {
  messages: TextMessage[];
  outputFormat?: "text" | "json";
  tools?: ToolDefinition[];
};

export type TextGenerationResult = {
  text: string;
  toolCalls: ToolCall[];
};
