import { Injectable } from "@nestjs/common";
import { AssetsService } from "@/assets/assets.service";
import type { ToolExecutionContext, AgentTool } from "./types";

/** 给模型看的工具说明，不包含实际执行逻辑。 */
export const searchUserAssetsDefinition = {
  name: "search_user_assets",
  description:
    "搜索当前用户素材库中的已有图片或视频。" +
    "当用户要求使用已有角色、场景或参考素材时调用。" +
    "当前按名称和描述匹配，请使用一个简短关键词，" +
    "例如墨墨、Aurora、探头；不要拼接成长句。" +
    "可能返回多个候选，也可能没有匹配结果。" +
    "此工具不生成新素材。",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "素材搜索关键词，例如墨墨或探头。",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
} as const;

@Injectable()
export class SearchUserAssetsTool implements AgentTool {
  readonly definition = searchUserAssetsDefinition;
  constructor(private readonly assetsService: AssetsService) {}

  async execute(input: unknown, context: ToolExecutionContext) {
    if (
      typeof input !== "object" ||
      input === null ||
      !("query" in input) ||
      typeof input.query !== "string" ||
      input.query.trim() === "" ||
      Object.keys(input).length !== 1
    ) {
      throw new Error("搜索工具参数必须只包含非空字符串 query");
    }

    const assets = await this.assetsService.searchAssets(
      context.ownerId,
      input.query,
    );

    return {
      assets: assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        description: asset.description,
        tags: asset.tags,
      })),
    };
  }
}
