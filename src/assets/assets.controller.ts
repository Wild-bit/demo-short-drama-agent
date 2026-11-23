import {
  BadRequestException,
  Body,
  Controller,
  Get,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { tmpdir } from "node:os";
import { AuthGuard } from "@/auth/auth.guard";
import { CurrentUserId } from "@/auth/current-user.decorator";
import { AssetsService } from "./assets.service";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const uuid = new ParseUUIDPipe({ version: "4" });

/** 读取查询串里的正整数；缺省时用默认值，格式不对或超过上限时返回 400。 */
function readPositiveInt(value: unknown, name: string, fallback: number, max?: number): number {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^[1-9]\d{0,8}$/.test(value)) {
    throw new BadRequestException(`${name} 必须是正整数`);
  }
  const parsed = Number(value);
  if (max !== undefined && parsed > max) {
    throw new BadRequestException(`${name} 不能超过 ${max}`);
  }
  return parsed;
}

@Controller("assets")
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /** 素材库分页列表：按图片或视频分类，每页条数由前端传入。 */
  @Get()
  list(
    @CurrentUserId() userId: string,
    @Query("type") type: unknown,
    @Query("page") page: unknown,
    @Query("pageSize") pageSize: unknown,
    @Query("query") query: unknown,
  ) {
    if (type !== "image" && type !== "video") {
      throw new BadRequestException("type 必须是 image 或 video");
    }
    if (query !== undefined && typeof query !== "string") {
      throw new BadRequestException("query 必须是字符串");
    }
    return this.assetsService.listAssets(userId, {
      type,
      page: readPositiveInt(page, "page", 1),
      pageSize: readPositiveInt(pageSize, "pageSize", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
      query,
    });
  }

  @Get("search")
  search(@CurrentUserId() userId: string, @Query("query") query: string = "") {
    return this.assetsService.searchAssets(userId, query);
  }

  /** 重开分镜时，根据保存的资产 ID 恢复名称和预览地址。 */
  @Get("detail")
  getAsset(@CurrentUserId() userId: string, @Query("assetId", uuid) assetId: string) {
    return this.assetsService.getAsset(userId, assetId);
  }

  @Post("upload")
  @UseInterceptors(FileInterceptor("file", {
    dest: tmpdir(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 1, fieldSize: 1024 },
  }))
  upload(
    @CurrentUserId() userId: string,
    @Body("name") name: unknown,
    @UploadedFile() file?: { path: string },
  ) {
    if (!file) throw new BadRequestException("请提供 file 图片文件");
    return this.assetsService.uploadImage(userId, name, file.path);
  }
}
