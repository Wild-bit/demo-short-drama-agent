import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Session } from "../entities/session.entity";
import type { SessionMessagePayload } from "../types";
import { SessionMessage } from "../entities/session-message.entity";
import { AgentService } from "@/harness/agent/agent.service";
import type { AgentRunResult } from "@/harness/types";

@Injectable()
export class SessionService {
  private readonly sessionsInProgress = new Set<string>();
  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    @InjectRepository(SessionMessage)
    private readonly messageRepository: Repository<SessionMessage>,
    private readonly agentService: AgentService,
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
    const session = await this.sessionRepository
      .createQueryBuilder("session")
      .where("session.sessionId = :sessionId", { sessionId })
      .andWhere("session.userId = :userId", { userId })
      .getOne();

    if (!session) {
      throw new NotFoundException("会话不存在");
    }
    const messages = await this.messageRepository
      .createQueryBuilder("message")
      .where("message.sessionId = :sessionId", { sessionId: session.sessionId })
      .orderBy("message.sequence", "ASC")
      .getMany();

    return messages.map((row) => row.message);
  }

  /** 确认历史没有被并发更新，再用事务按序追加本轮消息。 */
  async appendMessages(
    sessionId: string,
    userId: string,
    expectedLastSequence: number,
    newMessages: readonly SessionMessagePayload[],
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
      });
    });
  }

  /** 读取会话历史交给 Agent 回答，保存本轮消息后返回运行结果。 */
  async replyToMessage(
    sessionId: string,
    userId: string,
    message: string,
  ): Promise<AgentRunResult> {
    const sessionKey = `${userId}:${sessionId.toLowerCase()}`;
    if (this.sessionsInProgress.has(sessionKey)) {
      throw new ConflictException("会话正在处理中，请稍后再试");
    }
    this.sessionsInProgress.add(sessionKey);
    try {
      const history = await this.loadHistory(sessionId, userId);
      const expectedLastSequence = history.length;
      const { result, newMessages } = await this.agentService.runWithHistory(
        message,
        { userId },
        history,
      );
      await this.appendMessages(
        sessionId,
        userId,
        expectedLastSequence,
        newMessages,
      );
      return result;
    } finally {
      this.sessionsInProgress.delete(sessionKey);
    }
  }
}
