import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { once } from "node:events";
import type { ServerResponse } from "node:http";
import { AuthGuard } from "@/auth/auth.guard";
import { CurrentUserId } from "@/auth/current-user.decorator";
import { SessionService } from "./session.service";

const uuid = new ParseUUIDPipe({ version: "4" });
const optionalUuid = new ParseUUIDPipe({ version: "4", optional: true });

@Controller("sessions")
@UseGuards(AuthGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  /** 列出指定项目下的对话列表（置顶优先，按最近更新时间倒序）。 */
  @Get("list")
  listSessions(@CurrentUserId() userId: string, @Query("projectId", uuid) projectId: string) {
    return this.sessionService.listProjectSessions(userId, projectId);
  }

  /** 创建会话；传 projectId 时归属该项目，不传时为独立会话。 */
  @Post("create")
  async createSession(
    @CurrentUserId() userId: string,
    @Body("projectId", optionalUuid) projectId?: string,
  ) {
    const session = await this.sessionService.create(userId, projectId ?? null);
    return {
      projectId: session.projectId,
      sessionId: session.sessionId,
      name: session.name,
      pinned: session.pinned,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /** 重命名指定对话。 */
  @Post("rename")
  @HttpCode(200)
  renameSession(
    @CurrentUserId() userId: string,
    @Body("sessionId", uuid) sessionId: string,
    @Body("projectId", optionalUuid) projectId: string | undefined,
    @Body("name") name: unknown,
  ) {
    return this.sessionService.renameSession(userId, sessionId, name, projectId);
  }

  /** 置顶或取消置顶指定对话。 */
  @Post("pin")
  @HttpCode(200)
  pinSession(
    @CurrentUserId() userId: string,
    @Body("sessionId", uuid) sessionId: string,
    @Body("projectId", optionalUuid) projectId: string | undefined,
    @Body("pinned") pinned: unknown,
  ) {
    return this.sessionService.pinSession(userId, sessionId, pinned, projectId);
  }

  /** 删除指定对话及其关联消息和运行轨迹。 */
  @Post("delete")
  @HttpCode(200)
  async deleteSession(
    @CurrentUserId() userId: string,
    @Body("sessionId", uuid) sessionId: string,
    @Body("projectId", optionalUuid) projectId?: string,
  ) {
    await this.sessionService.deleteSession(userId, sessionId, projectId);
    return { deleted: true };
  }

  /** 切回某段项目对话时，读取按时间顺序展示的消息。 */
  @Get("messages")
  getMessages(
    @CurrentUserId() userId: string,
    @Query("projectId", uuid) projectId: string,
    @Query("sessionId", uuid) sessionId: string,
  ) {
    return this.sessionService.getProjectChatMessages(userId, projectId, sessionId);
  }

  /** 获取一次运行的步骤、用量、耗时和终态。 */
  @Get("run")
  getRun(
    @CurrentUserId() userId: string,
    @Query("sessionId", uuid) sessionId: string,
    @Query("runId", uuid) runId: string,
  ) {
    return this.sessionService.getRun(sessionId, userId, runId);
  }

  /** POST 提交一条消息，同一个 HTTP 响应逐个发送本次运行的 SSE 事件。 */
  @Post("stream")
  async streamMessage(
    @CurrentUserId() userId: string,
    @Body("sessionId", uuid) sessionId: string,
    @Body("message") message: unknown,
    @Body("selectedShot") selectedShot: unknown,
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
      }, selectedShot);
    } catch (error) {
      // 鉴权、会话归属或并发冲突在开流前仍使用常规 HTTP 错误响应。
      if (!response.headersSent && !response.destroyed) throw error;
    } finally {
      response.off("close", disconnected);
      if (response.headersSent && !response.destroyed) response.end();
    }
  }

  /** 接收用户发给指定会话的消息，返回 Agent 的回答和工具调用记录。 */
  @Post("turn")
  async submitMessage(
    @CurrentUserId() userId: string,
    @Body("sessionId", uuid) sessionId: string,
    @Body("message") message: unknown,
    @Body("selectedShot") selectedShot: unknown,
  ) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new BadRequestException("message 必须是非空字符");
    }
    const result = await this.sessionService.replyToMessage(
      sessionId,
      userId,
      message,
      undefined,
      selectedShot,
    );
    return result;
  }
}
