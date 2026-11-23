import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, In, type EntityManager } from "typeorm";
import { Asset } from "@/assets/entities/asset.entity";
import type { SavedShot, StoryboardTurnContext } from "@/domain/storyboard";
import { readIds, readObject, readStoryboardDraft, readUuid } from "@/domain/validate-storyboard";
import { Project } from "./entities/project.entity";
import { StoryboardVersion } from "./entities/storyboard-version.entity";
import { GenerationConfirmation } from "./entities/generation-confirmation.entity";
import { ProjectsService } from "./projects.service";

/** 将不合法的请求字段转换成前端可显示的 400。 */
function readInput<T>(parse: () => T): T {
  try { return parse(); } catch (error) {
    throw new BadRequestException(error instanceof Error ? error.message : "分镜请求无效");
  }
}

/** 新项目保存时版本为 0，选镜和确认时版本至少为 1。 */
function readVersion(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error("请提供有效的分镜版本号");
  }
  return value;
}

@Injectable()
export class StoryboardsService {
  constructor(private readonly db: DataSource, private readonly projects: ProjectsService) {}

  /** 查当前作品；空项目让编辑器从版本 0 开始。 */
  async getLatest(userId: string, projectId: string) {
    await this.projects.getOwnedProject(userId, projectId);
    return await this.latestVersion(this.db.manager, projectId) ?? { projectId, version: 0, storyboard: null };
  }

  /** 重新打开历史版本或核对某次确认使用的镜头。 */
  async getVersion(userId: string, projectId: string, version: number) {
    await this.projects.getOwnedProject(userId, projectId);
    const row = await this.db.manager.findOneBy(StoryboardVersion, { projectId, version });
    if (!row) throw new NotFoundException("分镜版本不存在");
    return row;
  }

  /** 普通项目对话仅读取版本号；显式点选时才提取该版本的单个镜头。 */
  async prepareTurn(userId: string, projectId: string, selection: unknown): Promise<StoryboardTurnContext> {
    await this.projects.getOwnedProject(userId, projectId);
    if (selection === undefined) {
      const latest = await this.db.manager.findOne(StoryboardVersion, {
        select: { version: true }, where: { projectId }, order: { version: "DESC" },
      });
      return { baseVersion: latest?.version ?? 0 };
    }
    const { version, shotId } = readInput(() => {
      const input = readObject(selection, "选中的镜头");
      return { version: readVersion(input.version, 1), shotId: readUuid(input.shotId, "镜头 ID") };
    });
    const latest = await this.latestVersion(this.db.manager, projectId);
    if (latest?.version !== version) throw new ConflictException("分镜已更新，请重新选择镜头");
    const shot = latest.storyboard.shots.find(item => item.shotId === shotId);
    if (!shot) throw new NotFoundException("镜头不存在");
    return { baseVersion: version, selectedShot: { version, shot } };
  }

  /** 串行检查基础版本和素材归属，写入一份全新的快照。 */
  async saveVersion(userId: string, projectId: string, body: unknown) {
    const { expectedVersion, draft } = readInput(() => {
      const input = readObject(body, "保存请求");
      return { expectedVersion: readVersion(input.expectedVersion, 0), draft: readStoryboardDraft(input.storyboard) };
    });
    return this.db.transaction(async manager => {
      const project = await this.projects.getOwnedProject(userId, projectId, manager, "pessimistic_write");
      const latest = await this.latestVersion(manager, project.projectId);
      if ((latest?.version ?? 0) !== expectedVersion) throw new ConflictException("分镜已更新，请重新读取后合并修改");
      const remainingIds = new Set(latest?.storyboard.shots.map(shot => shot.shotId));
      const shots = draft.shots.map((shot): SavedShot => {
        if (shot.shotId && !remainingIds.delete(shot.shotId)) {
          throw new BadRequestException("镜头 ID 重复或不属于正在编辑的版本");
        }
        return { ...shot, shotId: shot.shotId ?? randomUUID() };
      });
      const assetIds = [...new Set(shots.flatMap(shot => shot.assetIds))];
      if (assetIds.length) {
        const assets = await manager.find(Asset, {
          select: { id: true }, where: { userId, id: In(assetIds) }, lock: { mode: "pessimistic_read" },
        });
        if (assets.length !== assetIds.length) throw new BadRequestException("参考素材不存在或不属于当前用户");
      }
      const record = manager.create(StoryboardVersion, {
        projectId: project.projectId, version: expectedVersion + 1, storyboard: { ...draft, shots },
      });
      await manager.insert(StoryboardVersion, record);
      await manager.update(Project, project.projectId, { updatedAt: () => "CURRENT_TIMESTAMP(3)" });
      return record;
    });
  }

  /** 保存用户选定的版本、镜头范围与模型，同一次请求重试返回原记录。 */
  async confirmGeneration(userId: string, projectId: string, confirmationId: string, body: unknown) {
    const { version, model, shotIds } = readInput(() => {
      const input = readObject(body, "生成前确认");
      const model = typeof input.model === "string" ? input.model.trim() : "";
      if (!model || Array.from(model).length > 255) throw new Error("请提供有效的模型名称");
      const shotIds = readIds(input.shotIds, "选中镜头");
      if (!shotIds.length) throw new Error("请至少选择一个镜头");
      return { version: readVersion(input.version, 1), model, shotIds: new Set(shotIds) };
    });
    return this.db.transaction(async manager => {
      const project = await this.projects.getOwnedProject(userId, projectId, manager, "pessimistic_write");
      const key = { projectId: project.projectId, confirmationId: confirmationId.toLowerCase() };
      const existing = await manager.findOneBy(GenerationConfirmation, key);
      if (existing) {
        const sameShots = shotIds.size === existing.shotIds.length && existing.shotIds.every(id => shotIds.has(id));
        if (existing.version === version && existing.model === model && sameShots) return existing;
        throw new ConflictException("本次确认已使用，变更内容后请重新确认");
      }
      const latest = await this.latestVersion(manager, project.projectId);
      if (latest?.version !== version) throw new ConflictException("分镜已更新，请核对最新版本后确认");
      const orderedIds = latest.storyboard.shots.map(shot => shot.shotId).filter(id => shotIds.has(id));
      if (orderedIds.length !== shotIds.size) throw new BadRequestException("选中镜头不属于该版本");
      const record = manager.create(GenerationConfirmation, { ...key, version, model, shotIds: orderedIds });
      await manager.insert(GenerationConfirmation, record);
      return record;
    });
  }

  /** 按项目归属读取确认记录。 */
  async listConfirmations(userId: string, projectId: string) {
    await this.projects.getOwnedProject(userId, projectId);
    return this.db.manager.find(GenerationConfirmation, { where: { projectId }, order: { createdAt: "DESC", confirmationId: "ASC" } });
  }

  /** 按确认 ID 读取原先选择的版本、镜头和模型。 */
  async getConfirmation(userId: string, projectId: string, confirmationId: string) {
    await this.projects.getOwnedProject(userId, projectId);
    const record = await this.db.manager.findOneBy(GenerationConfirmation, { projectId, confirmationId });
    if (!record) throw new NotFoundException("生成确认不存在");
    return record;
  }

  /** 取该项目最近保存的完整快照。 */
  private latestVersion(manager: EntityManager, projectId: string) {
    return manager.findOne(StoryboardVersion, { where: { projectId }, order: { version: "DESC" } });
  }
}
