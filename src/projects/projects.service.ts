import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, type EntityManager } from "typeorm";
import { AgentRunRecord } from "@/harness/entities/agent-run-record.entity";
import { Session } from "@/harness/entities/session.entity";
import { SessionMessage } from "@/harness/entities/session-message.entity";
import { ActiveSessionsService } from "./active-sessions.service";
import { GenerationConfirmation } from "./entities/generation-confirmation.entity";
import { Project } from "./entities/project.entity";
import { StoryboardVersion } from "./entities/storyboard-version.entity";

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly db: DataSource,
    private readonly activeSessions: ActiveSessionsService,
  ) {}

  /** 用当前用户的身份保存项目，返回工作台重新打开它所需的 ID。 */
  createProject(userId: string, name: unknown) {
    const title = typeof name === "string" ? name.trim() : "";
    if (!title || Array.from(title).length > 255) {
      throw new BadRequestException("项目名称须为 1 至 255 个字符");
    }
    return this.projects.save(this.projects.create({ userId, name: title }));
  }

  /** 按最近更新时间列出当前用户的项目。 */
  listProjects(userId: string) {
    return this.projects.find({ where: { userId }, order: { updatedAt: "DESC", projectId: "ASC" } });
  }

  /** 校验项目归属；事务内建会话用共享锁，保存作品、确认与删除用排他锁。 */
  async getOwnedProject(
    userId: string,
    projectId: string,
    manager?: EntityManager,
    lockMode: "pessimistic_read" | "pessimistic_write" = "pessimistic_read",
  ) {
    const repository = manager?.getRepository(Project) ?? this.projects;
    const project = await repository.findOne({
      where: { userId, projectId },
      lock: manager ? { mode: lockMode } : undefined,
    });
    if (!project) throw new NotFoundException("项目不存在");
    return project;
  }

  /** 显式在单事务内清理项目及其分镜版本、生成确认、会话与消息；保留跨项目共享的个人资产。 */
  async deleteProject(userId: string, projectId: string): Promise<void> {
    await this.db.transaction(async (manager) => {
      const project = await this.getOwnedProject(userId, projectId, manager, "pessimistic_write");
      const sessions = await manager.find(Session, {
        select: { sessionId: true },
        where: { userId, projectId: project.projectId },
        lock: { mode: "pessimistic_write" },
      });
      if (sessions.some((s) => this.activeSessions.isRunning(userId, s.sessionId))) {
        throw new ConflictException("项目中有对话正在运行，请先停止后再删除");
      }
      if (sessions.length > 0) {
        const sessionIds = sessions.map((s) => s.sessionId);
        await manager.delete(SessionMessage, { sessionId: In(sessionIds) });
        await manager.delete(AgentRunRecord, { userId, sessionId: In(sessionIds) });
        await manager.delete(Session, { userId, projectId: project.projectId });
      }
      await manager.delete(GenerationConfirmation, { projectId: project.projectId });
      await manager.delete(StoryboardVersion, { projectId: project.projectId });
      await manager.delete(Project, { userId, projectId: project.projectId });
    });
  }
}
