import { PayloadTooLargeException } from "@nestjs/common";
import {
  estimateDeepSeekInputTokens,
  estimateDeepSeekMessageTokens,
} from "@/gateway/text/deepseek";
import type { TextGenerationRequest, TextMessage } from "@/gateway/text/types";
import type { ToolDefinition } from "@/tools/types";
import type { ContextCheckpoint, SessionMessagePayload } from "../types";
import { checkpointMessage } from "./compaction";

/** 计算数据序列化为 JSON 后的 UTF-8 字节数。 */
function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** 素材结果的标签可以提取为公共字段，其余候选信息按原样传递。 */
function hasAssetTags(asset: unknown): asset is { tags: string[] } {
  return (
    typeof asset === "object" &&
    asset !== null &&
    "tags" in asset &&
    Array.isArray(asset.tags) &&
    asset.tags.every((tag: unknown) => typeof tag === "string")
  );
}

function parseAssetSearchResult(content: string) {
  let result: unknown;
  try {
    result = JSON.parse(content);
  } catch {
    return undefined;
  }

  if (
    typeof result !== "object" ||
    result === null ||
    !("assets" in result) ||
    !Array.isArray(result.assets)
  ) {
    return undefined;
  }
  const assets: unknown[] = result.assets;
  return { ...result, assets };
}

/** 把所有候选共有的标签提到 sharedTags，保留各自的其他标签。 */
function compactAssetSearchResult(content: string): string {
  const result = parseAssetSearchResult(content);
  if (!result || "sharedTags" in result) {
    return content;
  }
  const { assets } = result;
  if (assets.length < 2 || !assets.every(hasAssetTags)) {
    return content;
  }

  const sharedTags = [...new Set(assets[0].tags)].filter((tag) =>
    assets.every((asset) => asset.tags.includes(tag)),
  );
  if (sharedTags.length === 0) {
    return content;
  }

  const sharedTagSet = new Set(sharedTags);
  const compacted = JSON.stringify({
    ...result,
    sharedTags,
    assets: assets.map((asset) => ({
      ...asset,
      tags: asset.tags.filter((tag) => !sharedTagSet.has(tag)),
    })),
  });
  return Buffer.byteLength(compacted) < Buffer.byteLength(content)
    ? compacted
    : content;
}

function hasAssetIdentity(asset: unknown): asset is {
  id: string;
  name: string;
  type: "image" | "video";
} {
  return typeof asset === "object" &&
    asset !== null &&
    "id" in asset && typeof asset.id === "string" &&
    "name" in asset && typeof asset.name === "string" &&
    "type" in asset && (asset.type === "image" || asset.type === "video");
}

/** 本轮仍超预算时保留有序候选名单，详情继续保存于原始工具结果。 */
function keepAssetSearchCandidates(content: string): string {
  const result = parseAssetSearchResult(content);
  if (!result || !result.assets.length || !result.assets.every(hasAssetIdentity)) {
    return content;
  }
  const candidateList = JSON.stringify({
    assets: result.assets.map(({ id, name, type }) => ({ id, name, type })),
    detailsOmitted: true,
  });
  return Buffer.byteLength(candidateList) < Buffer.byteLength(content)
    ? candidateList
    : content;
}

/** 只在模型输入中精简素材搜索结果，通过工具调用 ID 找到对应结果。 */
function compactToolMessages(
  messages: readonly SessionMessagePayload[],
  compactSearchResult = compactAssetSearchResult,
) {
  const assetSearchCallIds = new Set<string>();
  return messages.map((message) => {
    if (message.role === "assistant" || message.role === "user") {
      assetSearchCallIds.clear();
      if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) {
          if (call.name === "search_user_assets") {
            assetSearchCallIds.add(call.id);
          }
        }
      }
    }
    if (message.role !== "tool" || !assetSearchCallIds.delete(message.toolCallId)) {
      return message;
    }

    const content = compactSearchResult(message.content);
    return content === message.content ? message : { ...message, content };
  });
}

/** 在预算内组装一次模型请求，并测量各部分的体积。 */
export function buildModelInput(
  systemPrompt: string,
  history: readonly SessionMessagePayload[],
  currentTurn: readonly SessionMessagePayload[],
  tools: ToolDefinition[],
  inputBudgetTokens: number,
  checkpoint?: ContextCheckpoint,
) {
  const systemMessage: TextMessage = {
    role: "system",
    content: systemPrompt,
  };

  let modelCurrentTurn = compactToolMessages(currentTurn);
  const requiredInput: TextGenerationRequest = {
    messages: [systemMessage, ...modelCurrentTurn],
    tools,
  };
  let estimatedInputTokens = estimateDeepSeekInputTokens(requiredInput);
  if (estimatedInputTokens > inputBudgetTokens) {
    modelCurrentTurn = compactToolMessages(modelCurrentTurn, keepAssetSearchCandidates);
    requiredInput.messages = [systemMessage, ...modelCurrentTurn];
    estimatedInputTokens = estimateDeepSeekInputTokens(requiredInput);
  }
  if (estimatedInputTokens > inputBudgetTokens) {
    throw new PayloadTooLargeException({
      statusCode: 413,
      code: "AGENT_INPUT_BUDGET_EXCEEDED",
      message: "本轮输入或工具结果超出上下文预算，请缩短消息或缩小查询范围",
      estimatedInputTokens,
      inputBudgetTokens,
    });
  }

  const summaryMessage = checkpoint && checkpointMessage(checkpoint);
  const summaryTokens = summaryMessage
    ? estimateDeepSeekMessageTokens(summaryMessage) + 1
    : 0;
  const summaryIncluded =
    summaryMessage !== undefined && estimatedInputTokens + summaryTokens <= inputBudgetTokens;
  if (summaryIncluded) {
    estimatedInputTokens += summaryTokens;
  }

  const modelHistory = compactToolMessages(history);
  let droppedHistoryMessages = modelHistory.length;
  let turnTokens = 0;
  for (let index = modelHistory.length - 1; index >= 0; index -= 1) {
    const message = modelHistory[index];
    // 消息数组已有 system，每加入一条历史消息会多一个逗号。
    turnTokens += estimateDeepSeekMessageTokens(message) + 1;
    if (message.role !== "user") {
      continue;
    }
    if (estimatedInputTokens + turnTokens > inputBudgetTokens) {
      break;
    }
    droppedHistoryMessages = index;
    estimatedInputTokens += turnTokens;
    turnTokens = 0;
  }

  const retainedHistory = modelHistory.slice(droppedHistoryMessages);
  const request: TextGenerationRequest = {
    messages: [
      systemMessage,
      ...(summaryIncluded && summaryMessage ? [summaryMessage] : []),
      ...retainedHistory,
      ...modelCurrentTurn,
    ],
    tools,
  };
  return {
    request,
    inputSizes: {
      systemBytes: jsonBytes(systemMessage),
      historyBytes: jsonBytes(retainedHistory),
      currentTurnBytes: jsonBytes(modelCurrentTurn),
      toolDefinitionsBytes: jsonBytes(tools),
      requestBytes: jsonBytes(request),
      estimatedInputTokens,
      inputBudgetTokens,
      droppedHistoryMessages,
      summaryIncluded,
    },
  };
}
