type HttpClientConfig = {
  baseUrl: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

export function createHttpClient(config: HttpClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  return {
    async post<T>(path: string, body: unknown): Promise<T> {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...config.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs ?? 30_000),
      });

      if (!response.ok) {
        throw new Error(
          `HTTP 请求失败：${response.status} ${response.statusText}`,
        );
      }

      return (await response.json()) as T;
    },
  };
}
