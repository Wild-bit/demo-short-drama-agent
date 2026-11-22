import type {
  TextGenerationRequest,
  TextGenerationResult,
  TextMessage,
} from "./types";
import { getDeepSeekContextConfig } from "@/config/deepseek-context";
import { createHttpClient } from "@/request/http-client";
import { loadDeepSeekConfig } from "./deepseek-config";

import { modelUsage, readDeepSeekStream, type DeepSeekUsage, type TextDeltaHandler } from "./deepseek-stream";

type DeepSeekResponse = {
  usage?: DeepSeekUsage | null;
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

function toDeepSeekMessage(message: TextMessage) {
  if (message.role === "tool") {
    return {
      role: message.role,
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  if (message.role === "assistant") {
    return {
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}

function toDeepSeekInput(request: TextGenerationRequest) {
  return {
    messages: request.messages.map(toDeepSeekMessage),
    tools: request.tools?.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  };
}

/** 按发给 DeepSeek 的消息和工具声明的 JSON 字节数保守估计用量。 */
export function estimateDeepSeekInputTokens(
  request: TextGenerationRequest,
): number {
  return Buffer.byteLength(JSON.stringify(toDeepSeekInput(request)), "utf8");
}

/** 估计追加一条消息占用的空间，数组分隔符由调用方计入。 */
export function estimateDeepSeekMessageTokens(message: TextMessage): number {
  return Buffer.byteLength(JSON.stringify(toDeepSeekMessage(message)), "utf8");
}

export async function generateDeepSeekText(
  request: TextGenerationRequest,
  options: { signal?: AbortSignal; onTextDelta?: TextDeltaHandler } = {},
): Promise<TextGenerationResult> {
  const { apiKey, baseUrl, model } = loadDeepSeekConfig();
  const { maxOutputTokens } = getDeepSeekContextConfig();
  const httpClient = createHttpClient({
    baseUrl,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
  const body = {
    model,
    ...toDeepSeekInput(request),
    max_tokens: maxOutputTokens,
    thinking: { type: "disabled" },
    response_format: { type: request.outputFormat === "json" ? "json_object" : "text" },
  };
  if (options.onTextDelta) {
    const response = await httpClient.postResponse("/chat/completions", {
      ...body, stream: true, stream_options: { include_usage: true },
    }, options.signal);
    return readDeepSeekStream(response, options.onTextDelta);
  }
  const response = await httpClient.post<DeepSeekResponse>("/chat/completions", { ...body, stream: false }, options.signal);
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

  const usage = response?.usage;
  if (!usage) {
    return { text, toolCalls };
  }

  return {
    text,
    toolCalls,
    usage: modelUsage(usage),
  };
}
