import { HttpException } from "@nestjs/common";
import type { TextGenerationResult, ToolCall } from "@/gateway/text/types";
import type { AgentRunState } from "../types";

export type RunStatus = "running" | AgentRunState["status"] | "failed" | "cancelled";
export type TraceStep = {
  kind: "model" | "summary" | "tool";
  name: string;
  toolCallId?: string;
  /** 正式回答模型在本轮内的调用编号，用来对应 text_delta。 */
  modelCallNumber?: number;
  startedAt: string;
  durationMs?: number;
  status: "running" | "completed" | "blocked" | "failed" | "cancelled";
  usage?: TextGenerationResult["usage"];
  error?: string;
};

export type RunEvent =
  | { type: "started" }
  | { type: "text_delta"; modelCallNumber: number; text: string }
  | { type: "step_started" | "step_finished"; step: TraceStep }
  | { type: "completed"; text: string }
  | { type: "stopped"; reason: "tool_call_limit"; text: string }
  | { type: "failed"; message: string; statusCode: number };

export type SessionStream = {
  signal: AbortSignal;
  send: (runId: string, sessionId: string, event: RunEvent) => Promise<void>;
};

/** 只向调用者公开可处理的错误信息，避免暴露 SQL、凭证或供应商响应正文。 */
export function failureMessage(error: unknown): string {
  if (error instanceof HttpException) return error.message;
  if (error instanceof Error) {
    const upstream = /^HTTP 请求失败：(\d{3})/.exec(error.message);
    if (upstream) return `模型服务响应 HTTP ${upstream[1]}`;
    if (error.name === "TimeoutError") return "请求超时";
    if (error.message.startsWith("模型")) return error.message;
  }
  return "执行失败，请查看本次运行的步骤记录";
}

/** 每次运行独享步骤列表；流式连接用同一组动作通知客户端。 */
export class RunTrace {
  readonly steps: TraceStep[] = [];
  constructor(readonly signal?: AbortSignal, readonly emit?: (event: RunEvent) => Promise<void>) {}

  /** 分开计算正式模型和摘要模型的用量，摘要文字只进入上下文。 */
  async recordModelCall<T extends { usage?: TextGenerationResult["usage"] }>(
    kind: "model" | "summary",
    action: () => Promise<T>,
    modelCallNumber?: number,
  ): Promise<T> {
    return this.measure({ kind, name: process.env.DEEPSEEK_MODEL ?? "", modelCallNumber }, async step => {
      const result = await action();
      step.usage = result.usage;
      return result;
    });
  }

  /** 对应模型的工具调用 ID，参数校验失败也有独立记录。 */
  async recordToolCall(call: ToolCall, action: () => Promise<unknown>) {
    return this.measure({ kind: "tool", name: call.name, toolCallId: call.id }, async step => {
      const result = await action();
      if (typeof result === "object" && result && "status" in result && result.status === "blocked") {
        step.status = "blocked";
      }
      return result;
    });
  }

  /** 一步只记录一次，正常、抛错和客户端取消都有耗时。 */
  private async measure<T>(
    details: Pick<TraceStep, "kind" | "name" | "toolCallId" | "modelCallNumber">,
    action: (step: TraceStep) => Promise<T>,
  ) {
    this.signal?.throwIfAborted();
    const started = Date.now();
    const step: TraceStep = { ...details, startedAt: new Date(started).toISOString(), status: "running" };
    this.steps.push(step);
    try {
      await this.emit?.({ type: "step_started", step });
      this.signal?.throwIfAborted();
      const result = await action(step);
      this.signal?.throwIfAborted();
      if (step.status === "running") step.status = "completed";
      return result;
    } catch (error) {
      step.status = this.signal?.aborted ? "cancelled" : "failed";
      step.error = this.signal?.aborted ? "客户端已断开" : failureMessage(error);
      throw error;
    } finally {
      step.durationMs = Date.now() - started;
      if (!this.signal?.aborted) await this.emit?.({ type: "step_finished", step });
    }
  }
}
