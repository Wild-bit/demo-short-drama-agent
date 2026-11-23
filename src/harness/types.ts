import type { ToolCall } from "@/gateway/text/types";
import type { TextMessage } from "@/gateway/text/types";
import type { SelectedShot, StoryboardProposal } from "@/domain/storyboard";
import type { ChatAssetCardItem, ChatUiBlock } from "@/domain/chat-ui";

export type { ChatAssetCardItem, ChatUiBlock };

/** 将同一轮多次模型调用的非空回答按段落合并，保留单段原样并消除衔接处多余空白。 */
export function appendAssistantSegment(accumulated: string, segment: string): string {
  if (!segment.trim()) return accumulated;
  if (!accumulated.trim()) return segment;
  return `${accumulated.replace(/\s+$/, "")}\n\n${segment.replace(/^\s+/, "")}`;
}

/** 从 search_user_assets 工具返回结果中提取可安全交给前端卡片渲染的资产列表。 */
export function extractAssetCardItems(result: unknown): ChatAssetCardItem[] {
  if (typeof result !== "object" || result === null || !("assets" in result) || !Array.isArray(result.assets)) {
    return [];
  }
  const items: ChatAssetCardItem[] = [];
  for (const raw of result.assets) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      (item.type !== "image" && item.type !== "video")
    ) {
      continue;
    }
    items.push({
      id: item.id,
      name: item.name,
      type: item.type,
      ...(typeof item.url === "string" && item.url && { url: item.url }),
      ...(typeof item.description === "string" && item.description && { description: item.description }),
      ...(Array.isArray(item.tags) &&
        item.tags.every((t): t is string => typeof t === "string") &&
        item.tags.length > 0 && { tags: item.tags }),
    });
  }
  return items;
}

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
  storyboardProposal?: StoryboardProposal;
  uiBlocks?: ChatUiBlock[];
  modelCallCount: number;
  summaryModelCallCount?: number;
  toolCalls: ToolCall[];
  toolResults: ToolExecutionRecord[];
};

export type SessionMessagePayload =
  | (Extract<TextMessage, { role: "tool" }> & {
      /** 新工具消息保存调用名称，旧会话记录允许缺少此字段。 */
      toolName?: string;
    })
  | (Extract<TextMessage, { role: "assistant" }> & {
      storyboardProposal?: StoryboardProposal;
      uiBlocks?: ChatUiBlock[];
    })
  | {
      role: "user";
      content: string;
      selectedShot?: SelectedShot;
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
