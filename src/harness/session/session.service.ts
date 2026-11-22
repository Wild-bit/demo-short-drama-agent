import {
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
import type { ContextCheckpoint, SessionMessagePayload } from "../types";
import { SessionMessage } from "../entities/session-message.entity";
import { AgentService } from "@/harness/agent/agent.service";
import type { AgentRunResult } from "@/harness/types";

/** 组装本轮结束时要写入运行记录的字段。 */
function buildRunOutcome(
  status: Exclude<RunStatus, "running">,
  reason: string | null,
  steps: TraceStep[],
) {
  return { status, reason, steps, endedAt: new Date() };
}

@Injectable()
export class SessionService {
  private readonly sessionsInProgress = new Set<string>();
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    @InjectRepository(SessionMessage)
    private readonly messageRepository: Repository<SessionMessage>,
    private readonly agentService: AgentService,
    @InjectRepository(AgentRunRecord)
    private readonly runs: Repository<AgentRunRecord>,
  ) {}

  /** 为指定用户创建并保存一个空会话。 */
  async create(userId: string): Promise<Session> {
    const session = this.sessionRepository.create({
      userId,
      name: "新会话",
    });

    return this.sessionRepository.save(session);
  }

  /** 校验会话归属，按序读取已保存的对话消息。 */
  async loadHistory(
    sessionId: string,
    userId: string,
  ): Promise<SessionMessagePayload[]> {
    const session = await this.findOwnedSession(sessionId, userId);
    const messages = await this.loadMessageRows(session.sessionId);
    return messages.map((row) => row.message);
  }

  /** 确认历史没有被并发更新，再用事务按序追加本轮消息。 */
  async appendMessages(
    sessionId: string,
    userId: string,
    /** 本轮读取历史时的末条序号，保存时与数据库最新序号比较，以识别并发写入。 */
    expectedLastSequence: number,
    newMessages: readonly SessionMessagePayload[],
    checkpoint?: ContextCheckpoint,
    record?: AgentRunRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.sessionRepository.manager.transaction(async (manager) => {
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
        return;
      }

      await messages.insert(
        newMessages.map((message, index) => ({
          sessionId,
          sequence: lastSequence + index + 1,
          message,
        })),
      );
      await sessions.update(sessionId, {
        updatedAt: () => "CURRENT_TIMESTAMP(3)",
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
  ): Promise<AgentRunResult & { runId: string }> {
    const sessionKey = `${userId}:${sessionId.toLowerCase()}`;
    if (this.sessionsInProgress.has(sessionKey)) {
      throw new ConflictException("会话正在处理中，请稍后再试");
    }
    this.sessionsInProgress.add(sessionKey);
    let record: AgentRunRecord | undefined;
    let committed = false;
    let trace: RunTrace | undefined;
    try {
      const session = await this.findOwnedSession(sessionId, userId);
      stream?.signal.throwIfAborted();
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
      const { result, newMessages, checkpoint } =
        await this.agentService.runWithHistory(
          message,
          { userId },
          history,
          previous,
          trace,
        );
      const outcome = buildRunOutcome(
        result.status,
        result.status === "stopped" ? result.reason : null,
        trace.steps,
      );
      await this.appendMessages(
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
            ? { type: "stopped", reason: result.reason, text: result.text }
            : { type: "completed", text: result.text },
        );
      }
      return { ...result, runId };
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
      this.sessionsInProgress.delete(sessionKey);
    }
  }

  private async findOwnedSession(
    sessionId: string,
    userId: string,
  ): Promise<Session> {
    const session = await this.sessionRepository.findOneBy({
      sessionId,
      userId,
    });
    if (!session) {
      throw new NotFoundException("会话不存在");
    }
    return session;
  }

  private loadMessageRows(sessionId: string): Promise<SessionMessage[]> {
    return this.messageRepository.find({
      where: { sessionId },
      order: { sequence: "ASC" },
    });
  }
}
