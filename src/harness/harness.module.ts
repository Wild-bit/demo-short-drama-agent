import { AuthModule } from "@/auth/auth.module";
import { Module } from "@nestjs/common";
import { ToolsModule } from "@/tools/tools.module";
import { AgentController } from "./agent/agent.controller";
import { AgentService } from "./agent/agent.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Session } from "./entities/session.entity";
import { SessionMessage } from "./entities/session-message.entity";
import { SessionController } from "./session/session.controller";
import { SessionService } from "./session/session.service";

@Module({
  imports: [AuthModule, ToolsModule, TypeOrmModule.forFeature([Session, SessionMessage])],
  providers: [AgentService, SessionService],
  controllers: [AgentController, SessionController],
})
export class HarnessModule {}
