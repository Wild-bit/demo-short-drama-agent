import { Module } from "@nestjs/common";
import { AssetsModule } from "@/assets/assets.module";
import { SearchUserAssetsTool } from "./search-user-assets.tool";
import { ToolRegistryService } from "./tool-registry.service";
import { AGENT_TOOLS } from "./types";

@Module({
  imports: [AssetsModule],
  providers: [
    SearchUserAssetsTool,
    {
      provide: AGENT_TOOLS,
      useFactory: (searchTool: SearchUserAssetsTool) => [searchTool],
      inject: [SearchUserAssetsTool],
    },
    ToolRegistryService,
  ],
  exports: [ToolRegistryService],
})
export class ToolsModule {}
