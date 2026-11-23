import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { DatabaseModule } from "./database/database.module";
import { AssetsModule } from "./assets/assets.module";
import { ProjectsModule } from "./projects/projects.module";
import { ToolsModule } from "./tools/tools.module";
import { HarnessModule } from "./harness/harness.module";
/** 应用根模块，注册数据库、健康检查、资产、项目、工具与 Agent 模块。 */
@Module({
  imports: [DatabaseModule, HealthModule, AssetsModule, ProjectsModule, ToolsModule, HarnessModule],
})
export class AppModule {}
