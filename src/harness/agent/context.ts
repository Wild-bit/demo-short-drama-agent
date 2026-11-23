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
  url?: unknown;
} {
  return typeof asset === "object" &&
    asset !== null &&
    "id" in asset && typeof asset.id === "string" &&
    "name" in asset && typeof asset.name === "string" &&
    "type" in asset && (asset.type === "image" || asset.type === "video");
}

/** 本轮超预算时保留有序候选名单，预算允许时也保留素材链接。 */
function keepAssetSearchCandidates(content: string, includeUrls: boolean): string {
  const result = parseAssetSearchResult(content);
  if (!result || !result.assets.length || !result.assets.every(hasAssetIdentity)) {
    return content;
  }
  const candidateList = JSON.stringify({
    assets: result.assets.map(({ id, name, type, url }) => ({
      id,
      name,
      type,
      url: includeUrls && typeof url === "string" ? url : undefined,
    })),
    detailsOmitted: true,
  });
  return Buffer.byteLength(candidateList) < Buffer.byteLength(content)
    ? candidateList
    : content;
}

/** 降档第一级：保留有序候选和素材链接，去掉描述与标签。 */
const keepCandidatesWithLinks = (content: string) =>
  keepAssetSearchCandidates(content, true);

/** 降档第二级：只保留 ID、名称和类型。 */
const keepCandidatesWithoutLinks = (content: string) =>
  keepAssetSearchCandidates(content, false);

/** 只在模型输入中精简素材搜索结果，通过工具调用 ID 找到对应结果。 */
function compactToolMessages(
  messages: readonly SessionMessagePayload[],
  compactSearchResult = compactAssetSearchResult,
) {
  const assetSearchCallIds = new Set<string>();
  return messages.map((message) => {
    // 用户主动引用的单镜随本条提问进入模型；聊天栏保留用户原文。
    if (message.role === "user" && message.selectedShot) {
      assetSearchCallIds.clear();
      return { role: message.role, content: message.content + "\n\n本次选中的镜头资料：" + JSON.stringify(message.selectedShot) };
    }
    if (message.role === "assistant" || message.role === "user") {
      assetSearchCallIds.clear();
      if (message.role === "assistant") {
        for (const call of message.toolCalls ?? []) {
          if (call.name === "search_user_assets") {
            assetSearchCallIds.add(call.id);
          }
        }
        // 最终回答里的草案与 UI 组件卡片供界面恢复；工具参数已在本会话历史中。
        if (message.storyboardProposal || message.uiBlocks) {
          return {
            role: message.role,
            content: message.content,
            ...(message.toolCalls?.length && { toolCalls: message.toolCalls }),
          };
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

/** 消息数组里每多一条消息，JSON 序列化时就多一个逗号。 */
const MESSAGE_SEPARATOR_BYTES = 1;

/** 估算一组消息追加到请求里占用的空间。 */
function measureMessages(messages: readonly SessionMessagePayload[]): number {
  return messages.reduce(
    (total, message) =>
      total + estimateDeepSeekMessageTokens(message) + MESSAGE_SEPARATOR_BYTES,
    0,
  );
}

/** 按用户消息把历史切成完整轮次；开头不属于任何一整轮的消息不参与选择。 */
function groupCompleteTurns(
  messages: readonly SessionMessagePayload[],
): SessionMessagePayload[][] {
  const turns: SessionMessagePayload[][] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push([]);
    } else if (turns.length === 0) {
      continue;
    }
    turns.at(-1)!.push(message);
  }
  return turns;
}

/** 本轮消息优先占用预算；装不下时依次去掉素材结果的描述、标签和链接。 */
function fitCurrentTurn(
  systemMessage: TextMessage,
  currentTurn: readonly SessionMessagePayload[],
  tools: ToolDefinition[],
  inputBudgetTokens: number,
): { messages: SessionMessagePayload[]; estimatedTokens: number } {
  let modelCurrentTurn = compactToolMessages(currentTurn);
  const measureInput = () =>
    estimateDeepSeekInputTokens({ messages: [systemMessage, ...modelCurrentTurn], tools });
  let estimatedTokens = measureInput();
  for (const compactSearchResult of [keepCandidatesWithLinks, keepCandidatesWithoutLinks]) {
    if (estimatedTokens <= inputBudgetTokens) break;
    modelCurrentTurn = compactToolMessages(modelCurrentTurn, compactSearchResult);
    estimatedTokens = measureInput();
  }
  if (estimatedTokens > inputBudgetTokens) {
    throw new PayloadTooLargeException({
      statusCode: 413,
      code: "AGENT_INPUT_BUDGET_EXCEEDED",
      message: "本轮输入或工具结果超出上下文预算，请缩短消息或缩小查询范围",
      estimatedInputTokens: estimatedTokens,
      inputBudgetTokens,
    });
  }
  return { messages: modelCurrentTurn, estimatedTokens };
}

/** 从最新一轮往前挑出装得下的完整轮次；遇到第一轮放不下就停止。 */
function fitRecentHistory(
  history: readonly SessionMessagePayload[],
  usedTokens: number,
  inputBudgetTokens: number,
) {
  const turns = groupCompleteTurns(history);
  let keptTokens = 0;
  let keptMessageCount = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turnTokens = measureMessages(turns[index]);
    if (usedTokens + keptTokens + turnTokens > inputBudgetTokens) break;
    keptTokens += turnTokens;
    keptMessageCount += turns[index].length;
  }
  return {
    retainedHistory: history.slice(history.length - keptMessageCount),
    droppedHistoryMessages: history.length - keptMessageCount,
    retainedTokens: keptTokens,
  };
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

  // 本轮消息优先进入预算。
  const currentTurnFit = fitCurrentTurn(systemMessage, currentTurn, tools, inputBudgetTokens);

  // 预算还够时带上旧摘要，摘要只占一条 user 消息。
  const summaryMessage = checkpoint && checkpointMessage(checkpoint);
  const summaryTokens = summaryMessage
    ? estimateDeepSeekMessageTokens(summaryMessage) + MESSAGE_SEPARATOR_BYTES
    : 0;
  const summaryIncluded =
    summaryMessage !== undefined &&
    currentTurnFit.estimatedTokens + summaryTokens <= inputBudgetTokens;
  const usedTokens =
    currentTurnFit.estimatedTokens + (summaryIncluded ? summaryTokens : 0);

  // 剩余预算从最新一轮历史往前补齐。
  const { retainedHistory, droppedHistoryMessages, retainedTokens } = fitRecentHistory(
    compactToolMessages(history),
    usedTokens,
    inputBudgetTokens,
  );
  const estimatedInputTokens = usedTokens + retainedTokens;

  const request: TextGenerationRequest = {
    messages: [
      systemMessage,
      ...(summaryIncluded && summaryMessage ? [summaryMessage] : []),
      ...retainedHistory,
      ...currentTurnFit.messages,
    ],
    tools,
  };
  return {
    request,
    inputSizes: {
      systemBytes: jsonBytes(systemMessage),
      historyBytes: jsonBytes(retainedHistory),
      currentTurnBytes: jsonBytes(currentTurnFit.messages),
      toolDefinitionsBytes: jsonBytes(tools),
      requestBytes: jsonBytes(request),
      estimatedInputTokens,
      inputBudgetTokens,
      droppedHistoryMessages,
      summaryIncluded,
    },
  };
}
