import {
  BadRequestException,
  Body,
  Param,
  UseGuards,
  ParseUUIDPipe,
  Controller,
  Post,
} from "@nestjs/common";
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
