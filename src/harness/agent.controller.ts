import {
  BadRequestException,
  Body,
  Controller,
  Post,
} from "@nestjs/common";
import { AgentService } from "./agent.service";

@Controller("agent")
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /** 第四课入口：一次模型响应及其工具执行，不自动进入下一轮。 */
  @Post("run-once")
  runOnce(@Body("message") message: unknown) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new BadRequestException("message 必须是非空字符串");
    }

    // 演示身份由服务端提供，后续替换为统一用户上下文。
    return this.agentService.runOnce(message, { ownerId: "demo-user" });
  }
}
