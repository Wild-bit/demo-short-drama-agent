export function loadDeepSeekConfig() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = process.env.DEEPSEEK_BASE_URL;
  const model = process.env.DEEPSEEK_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("缺少 DeepSeek 配置，请检查 .env");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
  };
}
