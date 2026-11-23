import { Body, Controller, Get, HttpCode, ParseIntPipe, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@/auth/auth.guard";
import { CurrentUserId } from "@/auth/current-user.decorator";
import { StoryboardsService } from "./storyboards.service";

const uuid = new ParseUUIDPipe({ version: "4" });

@Controller("storyboards")
@UseGuards(AuthGuard)
export class StoryboardsController {
  constructor(private readonly storyboards: StoryboardsService) {}

  /** 工作台打开或刷新时读取最新作品。 */
  @Get("latest")
  getLatest(@CurrentUserId() userId: string, @Query("projectId", uuid) projectId: string) {
    return this.storyboards.getLatest(userId, projectId);
  }

  /** 查看已保存的指定历史版本。 */
  @Get("version")
  getVersion(
    @CurrentUserId() userId: string,
    @Query("projectId", uuid) projectId: string,
    @Query("version", ParseIntPipe) version: number,
  ) {
    return this.storyboards.getVersion(userId, projectId, version);
  }

  /** 用户点击保存时提交完整草案及编辑时的基础版本。 */
  @Post("save")
  @HttpCode(200)
  saveVersion(
    @CurrentUserId() userId: string,
    @Body("projectId", uuid) projectId: string,
    @Body() body: unknown,
  ) {
    return this.storyboards.saveVersion(userId, projectId, body);
  }

  /** 用户核对镜头和模型后显式提交一次生成前确认。 */
  @Post("confirm")
  @HttpCode(200)
  confirm(
    @CurrentUserId() userId: string,
    @Body("projectId", uuid) projectId: string,
    @Body("confirmationId", uuid) confirmationId: string,
    @Body() body: unknown,
  ) {
    return this.storyboards.confirmGeneration(userId, projectId, confirmationId, body);
  }

  /** 列出项目已保存的生成确认记录。 */
  @Get("confirmations")
  listConfirmations(@CurrentUserId() userId: string, @Query("projectId", uuid) projectId: string) {
    return this.storyboards.listConfirmations(userId, projectId);
  }

  /** 按确认 ID 核对单次生成确认记录。 */
  @Get("confirmation")
  getConfirmation(
    @CurrentUserId() userId: string,
    @Query("projectId", uuid) projectId: string,
    @Query("confirmationId", uuid) confirmationId: string,
  ) {
    return this.storyboards.getConfirmation(userId, projectId, confirmationId);
  }
}
