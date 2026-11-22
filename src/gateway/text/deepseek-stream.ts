import { EventSourceParserStream } from "eventsource-parser/stream";
import type { TextGenerationResult, ToolCall } from "./types";

export type TextDeltaHandler = (text: string) => void | Promise<void>;
export type DeepSeekUsage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };

/** 供应商报告的用量才计入 Trace，流提前结束时可能拿不到用量。 */
export function modelUsage(usage?: DeepSeekUsage | null): TextGenerationResult["usage"] {
  if (usage) return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

type ToolDelta = {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type CompletionChunk = {
  error?: unknown;
  usage?: DeepSeekUsage | null;
  choices: { finish_reason?: string | null; delta?: { content?: string; tool_calls?: ToolDelta[] } }[];
};

/** 边读边交付文字，收到完整结束事件后才交付本次模型请求的工具列表。 */
export async function readDeepSeekStream(response: Response, onTextDelta: TextDeltaHandler): Promise<TextGenerationResult> {
  let text = "";
  let finishReason: string | undefined;
  let usage: TextGenerationResult["usage"];
  const calls = new Map<number, ToolCall>();
  if (!response.body) throw new Error("模型没有返回响应流");
  const events = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());
  for await (const { data } of events) {
    if (data === "[DONE]") {
      if (finishReason !== "stop" && finishReason !== "tool_calls") break;
      const toolCalls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
      if ((finishReason === "tool_calls") !== (toolCalls.length > 0) ||
          toolCalls.some(call => !call.id || !call.name)) break;
      return { text, toolCalls, usage };
    }
    const chunk: CompletionChunk = JSON.parse(data);
    if (chunk.error || !Array.isArray(chunk.choices)) throw new Error("模型返回了无效的流式响应");
    const choice = chunk.choices[0];
    if (chunk.usage) usage = modelUsage(chunk.usage);
    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
      if (finishReason === "length") throw new Error("模型输出达到长度上限，未获得完整响应");
    }
    if (choice?.delta?.content) {
      text += choice.delta.content;
      await onTextDelta(choice.delta.content);
    }
    for (const part of choice?.delta?.tool_calls ?? []) {
      if (!Number.isSafeInteger(part.index) || part.index < 0) throw new Error("工具调用缺少有效位置");
      const call = calls.get(part.index) ?? { id: "", name: "", arguments: "" };
      call.id += part.id ?? "";
      call.name += part.function?.name ?? "";
      call.arguments += part.function?.arguments ?? "";
      calls.set(part.index, call);
    }
  }
  throw new Error("模型流未正常结束");
}
