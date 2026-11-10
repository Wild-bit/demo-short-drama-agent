import type { TextGenerationRequest, TextGenerationResult } from "./types";
import { loadDeepSeekConfig } from "./deepseek-config";
import { createHttpClient } from "@/request/http-client";

type DeepSeekResponse = {
  choices?: {
    finish_reason?: string;
    message?: {
      content?: unknown;
      tool_calls?: {
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }[];
    };
  }[];
};

export async function generateDeepSeekText(
  request: TextGenerationRequest,
): Promise<TextGenerationResult> {
  const { apiKey, baseUrl, model } = loadDeepSeekConfig();
  const httpClient = createHttpClient({
    baseUrl,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const response = await httpClient.post<DeepSeekResponse>(
    "/chat/completions",
    {
      model,
      messages: request.messages,
      stream: false,
      max_tokens: 1024,
      thinking: { type: "disabled" },
      response_format: {
        type: request.outputFormat === "json" ? "json_object" : "text",
      },
      // 适配deepseek 的工具调用格式
      tools: request.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
    },
  );
  const choice = response?.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("模型输出达到长度上限，未获得完整响应");
  }
  const message = choice?.message;

  const toolCalls = (message?.tool_calls ?? []).map((call) => ({
    id: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }));
  const text = typeof message?.content === "string" ? message.content : "";
  return { text, toolCalls };
}
