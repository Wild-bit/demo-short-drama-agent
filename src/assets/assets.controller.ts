import { Controller, Get, Query } from "@nestjs/common";
import { AssetsService } from "./assets.service";

@Controller("assets")
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get("search")
  search(@Query("query") query: string = "") {
    // 当前演示用户，后续由统一用户上下文提供。
    const ownerId = "demo-user";

    return this.assetsService.searchAssets(ownerId, query);
  }
}
