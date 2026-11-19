import type { TextGenerationRequest, TextMessage } from "@/gateway/text/types";
import type { ToolDefinition } from "@/tools/types";
import type { SessionMessagePayload } from "../types";

/** 计算数据序列化为 JSON 后的 UTF-8 字节数。 */
function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** 组装一次模型请求，并测量各部分的体积。 */
export function buildModelInput(
  systemPrompt: string,
  history: readonly SessionMessagePayload[],
  currentTurn: readonly SessionMessagePayload[],
  tools: ToolDefinition[],
) {
  const systemMessage: TextMessage = {
    role: "system",
    content: systemPrompt,
  };

  const request: TextGenerationRequest = {
    messages: [systemMessage, ...history, ...currentTurn],
    tools,
  };
  return {
    request,
    inputSizes: {
      systemBytes: jsonBytes(systemMessage),
      historyBytes: jsonBytes(history),
      currentTurnBytes: jsonBytes(currentTurn),
      toolDefinitionsBytes: jsonBytes(tools),
      requestBytes: jsonBytes(request),
    },
  };
}
