import { UseGuards } from "@nestjs/common";
import { AuthGuard } from "@/auth/auth.guard";
import { CurrentUserId } from "@/auth/current-user.decorator";
import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AgentService } from "./agent.service";

@Controller("agent")
@UseGuards(AuthGuard)
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /** 运行一次用户任务，返回模型回答或工具调用超限的停止提示。 */
  @Post("run-once")
  runOnce(@Body("message") message: unknown, @CurrentUserId() userId: string) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new BadRequestException("message 必须是非空字符串");
    }

    return this.agentService.runOnce(message, { userId });
  }
}
