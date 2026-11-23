import { StoryboardsService } from "./storyboards.service";
import { StoryboardsController } from "./storyboards.controller";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "@/auth/auth.module";
import { StoryboardVersion } from "@/projects/entities/storyboard-version.entity";
import { GenerationConfirmation } from "@/projects/entities/generation-confirmation.entity";
import { ActiveSessionsService } from "./active-sessions.service";
import { Project } from "./entities/project.entity";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Project, StoryboardVersion, GenerationConfirmation])],
  controllers: [ProjectsController, StoryboardsController],
  providers: [ActiveSessionsService, ProjectsService, StoryboardsService],
  exports: [ActiveSessionsService, ProjectsService, StoryboardsService],
})
export class ProjectsModule {}
