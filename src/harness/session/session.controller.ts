import {
  BadRequestException,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Controller,
  Get,
  Post,
  Res,
} from "@nestjs/common";
import { once } from "node:events";
import type { ServerResponse } from "node:http";
import { AuthGuard } from "@/auth/auth.guard";
import { CurrentUserId } from "@/auth/current-user.decorator";
import { SessionService } from "./session.service";

@Controller("sessions")
@UseGuards(AuthGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /** 为当前登录用户创建会话，返回会话的基本信息。 */
  @Post()
  async createSession(@CurrentUserId() userId: string) {
    const session = await this.sessionService.create(userId);

    return {
      sessionId: session.sessionId,
      name: session.name,
      createdAt: session.createdAt,
    };
  }

  /** 获取一次运行的步骤、用量、耗时和终态。 */
  @Get(":sessionId/runs/:runId")
  getRun(
    @CurrentUserId() userId: string,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Param("runId", new ParseUUIDPipe({ version: "4" })) runId: string,
  ) {
    return this.sessionService.getRun(sessionId, userId, runId);
  }

  /** POST 提交一条消息，同一个 HTTP 响应逐个发送本次运行的 SSE 事件。 */
  @Post(":sessionId/turns/stream")
  async streamMessage(
    @CurrentUserId() userId: string,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Body("message") message: unknown,
    @Res() response: ServerResponse,
  ) {
    if (typeof message !== "string" || !message.trim())
      throw new BadRequestException("message 必须是非空字符");
    const abort = new AbortController();
    const disconnected = () => abort.abort();
    response.once("close", disconnected);
    if (response.destroyed) disconnected();
    try {
      await this.sessionService.replyToMessage(sessionId, userId, message, {
        signal: abort.signal,
        async send(runId, sessionId, event) {
          abort.signal.throwIfAborted();
          if (!response.headersSent) {
            response.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            });
          }
          const data = JSON.stringify({ sessionId, runId, ...event });
          // SSE 用空行标记一条事件的结束。
          const sseFrame = `event: ${event.type}\ndata: ${data}\n\n`;

          const canContinueWriting = response.write(sseFrame);
          if (!canContinueWriting) {
            // 当前帧已进入缓冲区，等 drain 后再写下一帧。
            await once(response, "drain", { signal: abort.signal });
          }
        },
      });
    } catch (error) {
      // 鉴权、会话归属或并发冲突在开流前仍使用常规 HTTP 错误响应。
      if (!response.headersSent && !response.destroyed) throw error;
    } finally {
      response.off("close", disconnected);
      if (response.headersSent && !response.destroyed) response.end();
    }
  }

  /** 接收用户发给指定会话的消息，返回 Agent 的回答和工具调用记录。 */
  @Post(":sessionId/turns")
  async submitMessage(
    @CurrentUserId() userId: string,
    @Param("sessionId", new ParseUUIDPipe({ version: "4" })) sessionId: string,
    @Body("message") message: unknown,
  ) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new BadRequestException("message 必须是非空字符");
    }
    const result = await this.sessionService.replyToMessage(
      sessionId,
      userId,
      message,
    );
    return result;
  }
}
