import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { Asset, RunEvent } from '~web/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 统一身份、HTTP 错误和开流前的状态码处理；兼容 JSON 与 FormData 上传。 */
async function request(token: string, path: string, method: string, data?: unknown, signal?: AbortSignal) {
  const isForm = typeof FormData !== 'undefined' && data instanceof FormData;
  const response = await fetch('/api' + path, {
    method,
    signal,
    headers: {
      ...(token && { Authorization: 'Bearer ' + token }),
      ...(data !== undefined && !isForm && { 'Content-Type': 'application/json' }),
    },
    body: data === undefined ? undefined : isForm ? data : JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && token)
      window.dispatchEvent(new CustomEvent('auth-expired', { detail: token }));
    throw new ApiError(response.status, body.message || '请求失败，请重试');
  }
  return response;
}

export async function api<T>(
  token: string,
  path: string,
  method = 'GET',
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await request(token, path, method, data, signal);
  return response.status === 204 ? (undefined as T) : response.json();
}

/** 上传本地参考图片至 COS 并登记到个人资产库（POST /api/assets/upload）。 */
export async function uploadAsset(
  token: string,
  name: string,
  file: File,
  signal?: AbortSignal,
): Promise<Asset> {
  const form = new FormData();
  form.append('name', name.trim());
  form.append('file', file);
  const response = await request(token, '/assets/upload', 'POST', form, signal);
  return response.json();
}

/** 由空行解析事件边界，一个网络分块可能含多帧或半帧。 */
export async function streamTurn(
  token: string,
  sessionId: string,
  data: Record<string, unknown>,
  signal: AbortSignal,
  receive: (event: RunEvent) => void,
) {
  const response = await request(token, '/sessions/stream', 'POST', { sessionId, ...data }, signal);
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('未收到对话事件流');
  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .getReader();
  let runId: string | undefined;
  try {
    for (;;) {
      const frame = await reader.read();
      if (frame.done) throw new Error('连接已中断，本轮未收到完成事件');
      const event: RunEvent = JSON.parse(frame.value.data);
      if (
        event.sessionId !== sessionId ||
        (runId && event.runId !== runId) ||
        frame.value.event !== event.type
      )
        throw new Error('对话事件不匹配');
      runId = event.runId;
      receive(event);
      if (event.type === 'completed' || event.type === 'stopped' || event.type === 'failed') return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : '请求失败，请重试';
}
