import {
  BadRequestException,
  ConflictException,
  Injectable,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { AgentRunRecord } from "../entities/agent-run-record.entity";
import {
  failureMessage,
  RunTrace,
  type RunStatus,
  type SessionStream,
  type TraceStep,
} from "../trace/run-trace";
import { Repository } from "typeorm";
import { Session } from "../entities/session.entity";
import {
  appendAssistantSegment,
  extractAssetCardItems,
  type AgentRunResult,
  type ChatAssetCardItem,
  type ChatUiBlock,
  type ContextCheckpoint,
  type SessionMessagePayload,
} from "../types";
import { SessionMessage } from "../entities/session-message.entity";
import { AgentService } from "@/harness/agent/agent.service";
import type { SelectedShot, StoryboardProposal } from "@/domain/storyboard";
import { ActiveSessionsService } from "@/projects/active-sessions.service";
import { ProjectsService } from "@/projects/projects.service";
import { StoryboardsService } from "@/projects/storyboards.service";

type VisibleChatMessage =
  | {
      sequence: number;
      role: "user";
      content: string;
      selectedShot?: SelectedShot;
    }
  | {
      sequence: number;
      role: "assistant";
      content: string;
      storyboardProposal?: StoryboardProposal;
      uiBlocks?: ChatUiBlock[];
    };

const DEFAULT_SESSION_NAMES = new Set(["未命名对话", "新会话"]);

/** 组装本轮结束时要写入运行记录的字段。 */
function buildRunOutcome(
  status: Exclude<RunStatus, "running">,
  reason: string | null,
  steps: TraceStep[],
) {
  return { status, reason, steps, endedAt: new Date() };
}

/** 首轮提交且尚未手动命名时，截取首句摘要作为会话标题。 */
function deriveSessionTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(cleaned);
  if (chars.length === 0) return "";
  return chars.length > 20 ? `${chars.slice(0, 20).join("")}…` : cleaned;
}

function parseSessionName(name: unknown): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || Array.from(trimmed).length > 255) {
    throw new BadRequestException("会话名称须为 1 至 255 个字符");
  }
  return trimmed;
}

function parseSessionPinned(pinned: unknown): boolean {
  if (typeof pinned !== "boolean") {
    throw new BadRequestException("pinned 必须是布尔值");
  }
  return pinned;
}

@Injectable()
export class SessionService {
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    @InjectRepository(SessionMessage)
    private readonly messageRepository: Repository<SessionMessage>,
    private readonly agentService: AgentService,
    @InjectRepository(AgentRunRecord)
    private readonly runs: Repository<AgentRunRecord>,
    private readonly projects: ProjectsService,
    private readonly storyboards: StoryboardsService,
    private readonly activeSessions: ActiveSessionsService,
  ) {}

  /** 创建空会话。传入项目时，在同一事务内核对归属并保存关联。 */
  async create(
    userId: string,
    projectId: string | null = null,
  ): Promise<Session> {
    return this.sessionRepository.manager.transaction(async (manager) => {
      const project =
        projectId === null
          ? null
          : await this.projects.getOwnedProject(userId, projectId, manager);
      const sessions = manager.getRepository(Session);
      return sessions.save(
        sessions.create({
          userId,
          projectId: project?.projectId ?? null,
          name: "未命名对话",
          pinned: false,
        }),
      );
    });
  }

  /** 侧栏读取该项目的会话列表：置顶优先，其余按最近活跃时间倒序。 */
  async listProjectSessions(userId: string, projectId: string) {
    await this.projects.getOwnedProject(userId, projectId);
    return this.sessionRepository.find({
      select: {
        sessionId: true,
        projectId: true,
        name: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
      },
      where: { userId, projectId },
      order: { pinned: "DESC", updatedAt: "DESC", sessionId: "ASC" },
    });
  }

  /** 重命名会话，保留会话原有的活跃更新时间。 */
  async renameSession(
    userId: string,
    sessionId: string,
    name: unknown,
    projectId?: string,
  ) {
    return this.applySessionPatch(
      userId,
      sessionId,
      { name: parseSessionName(name) },
      projectId,
    );
  }

  /** 切换会话置顶状态，保留会话原有的活跃更新时间。 */
  async pinSession(
    userId: string,
    sessionId: string,
    pinned: unknown,
    projectId?: string,
  ) {
    return this.applySessionPatch(
      userId,
      sessionId,
      { pinned: parseSessionPinned(pinned) },
      projectId,
    );
  }

  private async applySessionPatch(
    userId: string,
    sessionId: string,
    patch: { name?: string; pinned?: boolean },
    projectId?: string,
  ) {
    return this.sessionRepository.manager.transaction(async (manager) => {
      if (projectId !== undefined)
        await this.projects.getOwnedProject(userId, projectId, manager);
      const sessions = manager.getRepository(Session);
      const session = await sessions.findOne({
        where: {
          sessionId,
          userId,
          ...(projectId !== undefined && { projectId }),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (!session) throw new NotFoundException("会话不存在");
      const nextName = patch.name ?? session.name;
      const nextPinned = patch.pinned ?? session.pinned;
      await sessions
        .createQueryBuilder()
        .update(Session)
        .set({
          name: nextName,
          pinned: nextPinned,
          updatedAt: () => "updatedAt",
        })
        .where("session_id = :sessionId AND user_id = :userId", {
          sessionId: session.sessionId,
          userId,
        })
        .execute();
      return {
        projectId: session.projectId,
        sessionId: session.sessionId,
        name: nextName,
        pinned: nextPinned,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });
  }

  /** 删除单条会话及其关联消息和运行轨迹；运行中的会话禁止删除。 */
  async deleteSession(
    userId: string,
    sessionId: string,
    projectId?: string,
  ): Promise<void> {
    await this.sessionRepository.manager.transaction(async (manager) => {
      if (projectId !== undefined)
        await this.projects.getOwnedProject(userId, projectId, manager);
      const session = await manager.getRepository(Session).findOne({
        where: {
          sessionId,
          userId,
          ...(projectId !== undefined && { projectId }),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (!session) throw new NotFoundException("会话不存在");
      if (this.activeSessions.isRunning(userId, session.sessionId)) {
        throw new ConflictException("会话正在运行，请先停止后再删除");
      }
      await manager.delete(SessionMessage, { sessionId: session.sessionId });
      await manager.delete(AgentRunRecord, {
        userId,
        sessionId: session.sessionId,
      });
      await manager.delete(Session, { sessionId: session.sessionId, userId });
    });
  }

  /** 打开项目对话时展示用户提问与合并后的本轮助手回答，沿用终态消息序号并补齐素材卡片块。 */
  async getProjectChatMessages(
    userId: string,
    projectId: string,
    sessionId: string,
  ) {
    await this.projects.getOwnedProject(userId, projectId);
    const session = await this.findOwnedSession(sessionId, userId, projectId);
    const history = await this.loadMessageRows(session.sessionId);
    const searchCallIds = new Set<string>();
    const turnAssets = new Map<string, ChatAssetCardItem>();
    let pendingAssistantText = "";
    let pendingAssistantSequence: number | undefined;
    const visible: VisibleChatMessage[] = [];

    const flushPendingAssistant = () => {
      if (!pendingAssistantText || pendingAssistantSequence === undefined)
        return;
      const uiBlocks: ChatUiBlock[] | undefined =
        turnAssets.size > 0
          ? [{ component: "asset_gallery", assets: [...turnAssets.values()] }]
          : undefined;
      visible.push({
        sequence: pendingAssistantSequence,
        role: "assistant",
        content: pendingAssistantText,
        ...(uiBlocks && { uiBlocks }),
      });
      pendingAssistantText = "";
      pendingAssistantSequence = undefined;
    };

    for (const { sequence, message } of history) {
      if (message.role === "user") {
        flushPendingAssistant();
        searchCallIds.clear();
        turnAssets.clear();
        visible.push({
          sequence,
          role: message.role,
          content: message.content,
          ...(message.selectedShot && { selectedShot: message.selectedShot }),
        });
        continue;
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        for (const call of message.toolCalls) {
          if (call.name === "search_user_assets") searchCallIds.add(call.id);
        }
        if (message.content.trim()) {
          pendingAssistantText = appendAssistantSegment(
            pendingAssistantText,
            message.content,
          );
          pendingAssistantSequence = sequence;
        }
        continue;
      }
      if (message.role === "tool") {
        if (searchCallIds.delete(message.toolCallId)) {
          try {
            for (const item of extractAssetCardItems(
              JSON.parse(message.content),
            )) {
              if (!turnAssets.has(item.id)) turnAssets.set(item.id, item);
            }
          } catch {
            // 忽略异常工具负载，不影响历史消息读取
          }
        }
        continue;
      }
      if (message.role === "assistant") {
        const uiBlocks: ChatUiBlock[] | undefined = message.uiBlocks?.length
          ? message.uiBlocks
          : turnAssets.size > 0
            ? [{ component: "asset_gallery", assets: [...turnAssets.values()] }]
            : undefined;
        const content = appendAssistantSegment(
          pendingAssistantText,
          message.content,
        );
        pendingAssistantText = "";
        pendingAssistantSequence = undefined;
        searchCallIds.clear();
        turnAssets.clear();
        visible.push({
          sequence,
          role: message.role,
          content: content || message.content,
          ...(message.storyboardProposal && {
            storyboardProposal: message.storyboardProposal,
          }),
          ...(uiBlocks && { uiBlocks }),
        });
      }
    }
    flushPendingAssistant();
    return visible;
  }

  /** 确认历史没有被并发更新，再用事务按序追加本轮消息；首轮默认会话自动提取标题。 */
  async appendMessages(
    sessionId: string,
    userId: string,
    /** 本轮读取历史时的末条序号，保存时与数据库最新序号比较，以识别并发写入。 */
    expectedLastSequence: number,
    newMessages: readonly SessionMessagePayload[],
    checkpoint?: ContextCheckpoint,
    record?: AgentRunRecord,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    return this.sessionRepository.manager.transaction(async (manager) => {
      const sessions = manager.getRepository(Session);
      const messages = manager.getRepository(SessionMessage);
      const session = await sessions.findOne({
        where: { sessionId, userId },
        lock: { mode: "pessimistic_write" },
      });

      if (!session) {
        throw new NotFoundException("会话不存在");
      }

      const lastMessage = await messages.findOne({
        select: { sequence: true },
        where: { sessionId },
        order: { sequence: "DESC" },
      });
      const lastSequence = lastMessage?.sequence ?? 0;

      // 确认数据库仍停留在本轮调用模型时所读到的位置。
      signal?.throwIfAborted();
      if (lastSequence !== expectedLastSequence) {
        throw new ConflictException("会话历史已更新，请重试");
      }

      if (newMessages.length === 0) {
        return undefined;
      }

      await messages.insert(
        newMessages.map((message, index) => ({
          sessionId,
          sequence: lastSequence + index + 1,
          message,
        })),
      );

      let autoName: string | undefined;
      if (
        expectedLastSequence === 0 &&
        DEFAULT_SESSION_NAMES.has(session.name)
      ) {
        const firstUser = newMessages.find((m) => m.role === "user");
        const candidate = firstUser
          ? deriveSessionTitle(firstUser.content)
          : "";
        if (candidate) autoName = candidate;
      }

      await sessions.update(sessionId, {
        updatedAt: () => "CURRENT_TIMESTAMP(3)",
        ...(autoName && { name: autoName }),
        ...(checkpoint &&
        checkpoint.coveredThroughSequence >
          session.contextSummaryThroughSequence &&
        checkpoint.coveredThroughSequence <= expectedLastSequence
          ? {
              contextSummary: checkpoint.text,
              contextSummaryThroughSequence: checkpoint.coveredThroughSequence,
            }
          : {}),
      });
      if (record) await manager.save(AgentRunRecord, record);
      // 事务回调返回后开始提交，此后即使客户端断线也保留已提交的结果。
      signal?.throwIfAborted();
      return autoName;
    });
  }

  /** 按已认证用户和会话查询本次运行，标识不匹配时统一返回 404。 */
  async getRun(sessionId: string, userId: string, runId: string) {
    const record = await this.runs.findOneBy({ sessionId, userId, runId });
    if (!record) throw new NotFoundException("运行记录不存在");
    return record;
  }

  /** 读取会话历史交给 Agent 回答，保存本轮消息后返回运行结果。 */
  async replyToMessage(
    sessionId: string,
    userId: string,
    message: string,
    stream?: SessionStream,
    selectedShot?: unknown,
  ): Promise<AgentRunResult & { runId: string; sessionName?: string }> {
    if (!this.activeSessions.tryAcquire(userId, sessionId)) {
      throw new ConflictException("会话正在处理中，请稍后再试");
    }
    let record: AgentRunRecord | undefined;
    let committed = false;
    let trace: RunTrace | undefined;
    try {
      const session = await this.findOwnedSession(sessionId, userId);
      stream?.signal.throwIfAborted();
      if (!session.projectId && selectedShot !== undefined)
        throw new BadRequestException("请在项目会话中选择镜头");
      const storyboard = session.projectId
        ? await this.storyboards.prepareTurn(
            userId,
            session.projectId,
            selectedShot,
          )
        : undefined;
      record = await this.runs.save(
        this.runs.create({
          userId,
          sessionId: session.sessionId,
          status: "running",
          steps: [],
        }),
      );
      const { runId } = record;
      trace = new RunTrace(
        stream?.signal,
        stream && ((event) => stream.send(runId, session.sessionId, event)),
      );
      await trace.emit?.({ type: "started" });
      const history = await this.loadMessageRows(session.sessionId);
      // 在调用模型前记下历史末条序号，空会话记为 0。
      const expectedLastSequence = history.at(-1)?.sequence ?? 0;
      const previous =
        session.contextSummary && session.contextSummaryThroughSequence
          ? {
              text: session.contextSummary,
              coveredThroughSequence: session.contextSummaryThroughSequence,
            }
          : undefined;
      // agent loop 主要代码
      const { result, newMessages, checkpoint } =
        await this.agentService.runWithHistory(
          message,
          { userId },
          history,
          previous,
          trace,
          storyboard,
        );
      const outcome = buildRunOutcome(
        result.status,
        result.status === "stopped" ? result.reason : null,
        trace.steps,
      );
      const sessionName = await this.appendMessages(
        session.sessionId,
        userId,
        expectedLastSequence,
        newMessages,
        checkpoint,
        { ...record, ...outcome },
        stream?.signal,
      );
      committed = true;
      if (!stream?.signal.aborted) {
        await trace.emit?.(
          result.status === "stopped"
            ? {
                type: "stopped",
                reason: result.reason,
                text: result.text,
                ...(sessionName && { sessionName }),
              }
            : {
                type: "completed",
                text: result.text,
                ...(result.storyboardProposal && {
                  storyboardProposal: result.storyboardProposal,
                }),
                ...(result.uiBlocks && { uiBlocks: result.uiBlocks }),
                ...(sessionName && { sessionName }),
              },
        );
      }
      return { ...result, runId, ...(sessionName && { sessionName }) };
    } catch (error) {
      if (record && !committed) {
        const cancelled = stream?.signal.aborted === true;
        const reason = cancelled ? "客户端已断开" : failureMessage(error);
        const outcome = buildRunOutcome(
          cancelled ? "cancelled" : "failed",
          reason,
          trace?.steps ?? [],
        );
        await this.runs.update(
          { runId: record.runId, status: "running" },
          outcome,
        );
        if (!cancelled)
          await trace?.emit?.({
            type: "failed",
            message: reason,
            statusCode:
              error instanceof HttpException ? error.getStatus() : 500,
          });
      }
      throw error;
    } finally {
      this.activeSessions.release(userId, sessionId);
    }
  }

  /** 从可信用户身份查会话。项目路径还须匹配该会话的项目 ID。 */
  private async findOwnedSession(
    sessionId: string,
    userId: string,
    projectId?: string,
  ): Promise<Session> {
    const session = await this.sessionRepository.findOneBy({
      sessionId,
      userId,
      ...(projectId !== undefined && { projectId }),
    });
    if (!session) {
      throw new NotFoundException("会话不存在");
    }
    return session;
  }

  /** 从数据库读取单个会话的完整消息，保留工具记录和原始顺序。 */
  private loadMessageRows(sessionId: string): Promise<SessionMessage[]> {
    return this.messageRepository.find({
      where: { sessionId },
      order: { sequence: "ASC" },
    });
  }
}
