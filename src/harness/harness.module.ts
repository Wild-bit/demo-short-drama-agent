import { AuthModule } from "@/auth/auth.module";
import { Module } from "@nestjs/common";
import { ToolsModule } from "@/tools/tools.module";
import { AgentController } from "./agent/agent.controller";
import { AgentService } from "./agent/agent.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AgentRunRecord } from "./entities/agent-run-record.entity";
import { Session } from "./entities/session.entity";
import { SessionMessage } from "./entities/session-message.entity";
import { SessionController } from "./session/session.controller";
import { SessionService } from "./session/session.service";
import { ProjectsModule } from "@/projects/projects.module";

@Module({
  imports: [AuthModule, ToolsModule, ProjectsModule, TypeOrmModule.forFeature([Session, SessionMessage, AgentRunRecord])],
  providers: [AgentService, SessionService],
  controllers: [AgentController, SessionController],
})
export class HarnessModule {}
