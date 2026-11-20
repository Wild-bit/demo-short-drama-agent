/**
 * DeepSeek 官方规格。deepseek-flash 的上下文窗口包含输入和输出。
 * https://api-docs.deepseek.com/api/list-models/
 */
const DEEPSEEK_FLASH_CONTEXT_WINDOW_TOKENS = 1_048_576;

/** 项目运行档位。切换档位会切换窗口和请求的单次输出上限。 */
const contextProfiles = {
  normal: {
    contextWindowTokens: DEEPSEEK_FLASH_CONTEXT_WINDOW_TOKENS,
    // 项目设置的 max_tokens，给较长的剧本和分镜留出输出空间。
    maxOutputTokens: 16_384,
  },
  lesson: {
    // 第七课用较小的窗口和输出上限，便于复现摘要与超限。
    contextWindowTokens: 16_000,
    maxOutputTokens: 1_024,
  },
} as const;

// 以下数值由项目设定，normal 和 lesson 共用。

/** 计算输入预算时，从所选档位的窗口额外扣掉的估算余量。 */
const CONTEXT_SAFETY_MARGIN_TOKENS = 1_024;

/** 每条原话送去生成摘要时，最多取前 400 个 UTF-16 代码单元。 */
export const SUMMARY_SOURCE_MAX_CODE_UNITS = 400;

/** 候选摘要正文的 UTF-8 字节上限，超出时舍弃候选摘要。 */
export const SUMMARY_MAX_BYTES = 900;

/** 回查工具查询词的 UTF-16 代码单元上限。 */
export const HISTORY_RECALL_MAX_QUERY_CODE_UNITS = 100;

/** 一次回查结果序列化后的 UTF-8 字节上限。 */
export const HISTORY_RECALL_MAX_BYTES = 1_800;

/** 回查结果还受当前输入预算的三分之一限制，取两种上限中的较小值。 */
export const HISTORY_RECALL_BUDGET_DIVISOR = 3;

/** 统一读取 Harness 的输入预算和 Gateway 的输出上限。 */
export function getDeepSeekContextConfig() {
  const windowOverride = process.env.AGENT_CONTEXT_WINDOW_TOKENS?.trim();
  // 兼容此前只设置窗口的验证用法，显式 normal 可恢复正常配置。
  const profile =
    process.env.AGENT_CONTEXT_PROFILE?.trim() ||
    (windowOverride ? "lesson" : "normal");
  if (profile !== "normal" && profile !== "lesson") {
    throw new Error("AGENT_CONTEXT_PROFILE 必须是 normal 或 lesson");
  }

  const defaults = contextProfiles[profile];
  const contextWindowTokens =
    profile === "lesson" && windowOverride
      ? Number(windowOverride)
      : defaults.contextWindowTokens;
  const reservedTokens =
    defaults.maxOutputTokens + CONTEXT_SAFETY_MARGIN_TOKENS;
  const inputBudgetTokens = contextWindowTokens - reservedTokens;
  if (!Number.isSafeInteger(contextWindowTokens) || inputBudgetTokens < 1) {
    throw new Error(
      `AGENT_CONTEXT_WINDOW_TOKENS 必须是大于 ${reservedTokens} 的整数`,
    );
  }

  return {
    contextWindowTokens,
    inputBudgetTokens,
    maxOutputTokens: defaults.maxOutputTokens,
  };
}
