import {
  HISTORY_RECALL_BUDGET_DIVISOR,
  HISTORY_RECALL_MAX_BYTES,
  HISTORY_RECALL_MAX_QUERY_CODE_UNITS,
} from "@/config/deepseek-context";
import type { ToolDefinition } from "@/tools/types";
import type { SessionHistoryEntry } from "../types";
import { isVisibleMessage, splitHistoryTurns } from "./compaction";

export const readSessionHistoryDefinition: ToolDefinition = {
  name: "read_session_history",
  description:
    "回查当前会话移出窗口的原始对话。引用此前列表的序号时，以原助手回答的展示顺序为准；" +
    "原话缺失或无法确认时请用户澄清。可用关键词（如墨墨）或序号向前翻查。",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "用户或助手原话中的简短关键词" },
      beforeSequence: { type: "integer", minimum: 1, description: "只查该序号之前的完整对话" },
    },
    additionalProperties: false,
  },
};

/** 在当前会话的归档范围内查找一轮原始对话。 */
export function readSessionHistory(
  archive: readonly SessionHistoryEntry[],
  input: unknown,
  inputBudgetTokens: number,
) {
  if (typeof input !== "object" || input === null) {
    return { found: false, reason: "invalid_arguments" };
  }
  const query = "query" in input ? input.query : "";
  const before = "beforeSequence" in input ? input.beforeSequence : Number.MAX_SAFE_INTEGER;
  if (
    typeof query !== "string" || query.length > HISTORY_RECALL_MAX_QUERY_CODE_UNITS ||
    typeof before !== "number" || !Number.isSafeInteger(before) || before < 1
  ) {
    return { found: false, reason: "invalid_arguments" };
  }
  const keyword = query.trim().toLowerCase();
  const turn = splitHistoryTurns(archive).reverse().find((messages) => {
    const last = messages.at(-1);
    return last && last.sequence < before &&
      messages.some((entry) =>
        isVisibleMessage(entry) && entry.message.content.toLowerCase().includes(keyword),
      );
  });
  if (!turn) {
    return { found: false, reason: "no_match" };
  }
  const messages = turn.filter(isVisibleMessage).map(({ sequence, message }) => ({
    sequence,
    role: message.role,
    content: message.content,
  }));
  const result = { found: true, messages, nextBeforeSequence: turn[0].sequence };
  const maxBytes = Math.min(
    HISTORY_RECALL_MAX_BYTES,
    Math.floor(inputBudgetTokens / HISTORY_RECALL_BUDGET_DIVISOR),
  );
  if (Buffer.byteLength(JSON.stringify(result), "utf8") <= maxBytes) {
    return result;
  }
  return { found: false, reason: "archived_turn_too_large", nextBeforeSequence: turn[0].sequence };
}
