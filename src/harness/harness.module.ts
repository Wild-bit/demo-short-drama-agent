import { Module } from "@nestjs/common";
import { ToolsModule } from "@/tools/tools.module";
import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";

@Module({
  imports: [ToolsModule],
  providers: [AgentService],
  controllers: [AgentController],
})
export class HarnessModule {}
