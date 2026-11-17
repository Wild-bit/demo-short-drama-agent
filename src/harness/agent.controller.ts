import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { AgentService } from "./agent.service";

@Controller("agent")
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  /**  第五课入口：运行一次用户任务，持续处理工具调用，直到模型不再请求工具。 */
  @Post("run-once")
  runOnce(@Body("message") message: unknown) {
    if (typeof message !== "string" || message.trim() === "") {
      throw new BadRequestException("message 必须是非空字符串");
    }

    // 演示身份由服务端提供，后续替换为统一用户上下文。
    return this.agentService.runOnce(message, { ownerId: "demo-user" });
  }
}
