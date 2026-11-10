import { Module } from "@nestjs/common";
import { HealthModule } from "./health/health.module";
import { DatabaseModule } from "./database/database.module";
import { AssetsModule } from "./assets/assets.module";
import { ToolsModule } from "./tools/tools.module";
import { HarnessModule } from "./harness/harness.module";
/** 应用根模块，后续逐步注册资产、数据库与 Agent 模块。 */
@Module({
  imports: [DatabaseModule, HealthModule, AssetsModule, ToolsModule, HarnessModule],
})
export class AppModule {}
