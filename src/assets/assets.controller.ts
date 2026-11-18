import { UseGuards } from "@nestjs/common";
import { AuthGuard } from "@/auth/auth.guard";
import { CurrentUserId } from "@/auth/current-user.decorator";
import { Controller, Get, Query } from "@nestjs/common";
import { AssetsService } from "./assets.service";

@Controller("assets")
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get("search")
  search(@CurrentUserId() userId: string, @Query("query") query: string = "") {

    return this.assetsService.searchAssets(userId, query);
  }
}
