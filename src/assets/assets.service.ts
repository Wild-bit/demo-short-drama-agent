import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Repository } from "typeorm";
import { readImageFormat, requireMp4 } from "./asset-file";
import { CosStorageService } from "./cos-storage.service";
import { Asset, type AssetType } from "./entities/asset.entity";

const ASSET_OBJECT_PREFIX = "short-drama/";
const DEFAULT_ASSET_CDN_ORIGIN = "https://resource.lancespace.club";

type AssetSearchResult = Asset & { url?: string };
type NewAsset = Pick<Asset, "id" | "userId" | "name" | "type" | "source" | "objectKey">;

/** 素材库列表的查询条件，页码从 1 开始，由控制器校验后传入。 */
export type AssetListQuery = {
  type: AssetType;
  page: number;
  pageSize: number;
  query?: string;
};

type GeneratedVideoArchive = {
  /** 生成任务在首次归档前分配，并在归档重试时复用。 */
  assetId: string;
  userId: string;
  name: string;
  /** 由可信的生成任务打开供应商视频流。已有归档时无需读取源文件。 */
  openVideo: () => Promise<Readable>;
};

@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  private readonly cdnOrigin: string;
  private readonly activeVideoArchives = new Map<string, {
    userId: string;
    result: Promise<AssetSearchResult>;
  }>();

  constructor(
    @InjectRepository(Asset)
    private readonly assetRepository: Repository<Asset>,
    private readonly storage: CosStorageService,
  ) {
    const cdn = new URL(
      process.env.ASSET_CDN_ORIGIN?.trim() || DEFAULT_ASSET_CDN_ORIGIN,
    );
    if (cdn.protocol !== "https:" || cdn.href !== `${cdn.origin}/`) {
      throw new Error("ASSET_CDN_ORIGIN 必须是只含协议和域名的 HTTPS 地址");
    }
    this.cdnOrigin = cdn.origin;
  }

  async searchAssets(
    userId: string,
    query: string,
  ): Promise<AssetSearchResult[]> {
    const keyword = query.trim();
    if (!keyword) {
      return [];
    }
    const assets = await this.assetRepository
      .createQueryBuilder("asset")
      .where("asset.userId = :userId", { userId })
      .andWhere(
        "(asset.name LIKE :keyword OR asset.description LIKE :keyword)",
        { keyword: `%${keyword}%` },
      )
      .orderBy("asset.updatedAt", "DESC")
      .take(10)
      .getMany();
    return assets.map((asset) => this.withUrl(asset));
  }

  /** 素材库分页列表：只查当前用户、指定类型，可带关键词，按更新时间倒序。 */
  async listAssets(userId: string, { type, page, pageSize, query }: AssetListQuery) {
    const builder = this.assetRepository
      .createQueryBuilder("asset")
      .where("asset.userId = :userId", { userId })
      .andWhere("asset.type = :type", { type });
    const keyword = query?.trim();
    if (keyword) {
      builder.andWhere(
        "(asset.name LIKE :keyword OR asset.description LIKE :keyword)",
        { keyword: `%${keyword}%` },
      );
    }
    // 更新时间相同时再按 ID 排序，翻页时顺序保持稳定。
    const [assets, total] = await builder
      .orderBy("asset.updatedAt", "DESC")
      .addOrderBy("asset.id", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return {
      items: assets.map((asset) => this.withUrl(asset)),
      total,
      page,
      pageSize,
    };
  }

  /** 只返回当前用户拥有的资产。 */
  async getAsset(userId: string, id: string) {
    const asset = await this.assetRepository.findOneBy({ userId, id });
    if (!asset) throw new NotFoundException("素材不存在");
    return this.withUrl(asset);
  }

  async uploadImage(userId: string, name: unknown, filePath: string): Promise<AssetSearchResult> {
    try {
      const assetName = this.readAssetName(name);
      const format = await readImageFormat(filePath);
      const id = randomUUID();
      return await this.storeAsset({
        id,
        userId,
        name: assetName,
        type: "image",
        source: "upload",
        objectKey: `${ASSET_OBJECT_PREFIX}${id}.${format.extension}`,
      }, filePath, format.contentType);
    } finally {
      await this.removeTemporaryPath(filePath);
    }
  }

  async archiveGeneratedVideo(input: GeneratedVideoArchive): Promise<AssetSearchResult> {
    const id = input.assetId.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
      throw new BadRequestException("生成视频的资产 ID 必须是 UUID v4");
    }

    const active = this.activeVideoArchives.get(id);
    if (active) {
      if (active.userId !== input.userId) throw new ConflictException("资产 ID 已被占用");
      return active.result;
    }

    const asset: NewAsset = {
      id,
      userId: input.userId,
      name: this.readAssetName(input.name),
      type: "video",
      source: "generated",
      objectKey: `${ASSET_OBJECT_PREFIX}videos/${id}.mp4`,
    };
    const result = this.storeGeneratedVideo(asset, input.openVideo);
    this.activeVideoArchives.set(id, { userId: input.userId, result });
    try {
      return await result;
    } finally {
      this.activeVideoArchives.delete(id);
    }
  }

  private async storeGeneratedVideo(asset: NewAsset, openVideo: GeneratedVideoArchive["openVideo"]) {
    const existing = await this.assetRepository.findOneBy({ id: asset.id });
    if (existing) return this.checkExistingAsset(asset, existing);

    const directory = await mkdtemp(join(tmpdir(), "short-drama-video-"));
    try {
      const filePath = join(directory, "video.mp4");
      await pipeline(await openVideo(), createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
      await requireMp4(filePath);
      return await this.storeAsset(asset, filePath, "video/mp4");
    } finally {
      await this.removeTemporaryPath(directory);
    }
  }

  private async storeAsset(asset: NewAsset, filePath: string, contentType: string) {
    try {
      await this.storage.uploadFile(asset.objectKey, filePath, contentType);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new BadGatewayException("文件写入 COS 失败");
    }

    try {
      await this.assetRepository.insert({ ...asset, description: "", tags: [] });
    } catch (error) {
      // 数据库断线时写入可能实际已提交，只有确认无记录才清理用户上传的对象。
      const existing = await this.assetRepository.findOneBy({ id: asset.id }).catch(() => undefined);
      if (existing) return this.checkExistingAsset(asset, existing);
      if (existing === null && asset.source === "upload") {
        await this.storage.deleteFile(asset.objectKey).catch(() => {
          this.logger.warn(`无法清理待登记的 COS 对象 ${asset.objectKey}`);
        });
      }
      throw error;
    }

    return this.withUrl(await this.assetRepository.findOneByOrFail({ id: asset.id }));
  }

  private checkExistingAsset(asset: NewAsset, existing: Asset): AssetSearchResult {
    if (existing.userId !== asset.userId || existing.source !== asset.source || existing.objectKey !== asset.objectKey) {
      throw new ConflictException("资产 ID 已被占用");
    }
    return this.withUrl(existing);
  }

  private readAssetName(name: unknown): string {
    if (typeof name !== "string" || !name.trim() || Array.from(name.trim()).length > 255) {
      throw new BadRequestException("name 必须是 1 到 255 个字符的素材名称");
    }
    return name.trim();
  }

  private async removeTemporaryPath(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true }).catch(() => {
      this.logger.warn("无法清理素材上传的临时文件");
    });
  }

  private withUrl(asset: Asset): AssetSearchResult {
    return { ...asset, url: this.buildAssetUrl(asset.objectKey) };
  }

  private buildAssetUrl(objectKey: string): string | undefined {
    if (
      !objectKey.startsWith(ASSET_OBJECT_PREFIX) ||
      objectKey === ASSET_OBJECT_PREFIX
    ) {
      return undefined;
    }

    const segments = objectKey.split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return undefined;
    }

    // 保留 COS 对象键的目录分隔符，逐段编码文件名里的空格、中文和特殊字符。
    const path = segments
      .map(encodeURIComponent)
      .join("/")
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
    return `${this.cdnOrigin}/${path}`;
  }
}
