type HttpClientConfig = {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export function createHttpClient(config: HttpClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  /** 返回原始响应，让调用方选择读取 JSON 或持续读取响应流。 */
  async function postResponse(path: string, body: unknown, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(config.timeoutMs ?? 30_000);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...config.headers },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP 请求失败：${response.status} ${response.statusText}`);
    }
    return response;
  }

  return {
    postResponse,
    async post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
      return (await (await postResponse(path, body, signal)).json()) as T;
    },
  };
}
