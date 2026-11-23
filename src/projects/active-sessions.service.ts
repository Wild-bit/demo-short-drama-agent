import { Injectable } from "@nestjs/common";

/** 记录当前进程内正在执行 Agent Loop 的会话，供并发轮次拒绝及会话/项目删除检查共用。 */
@Injectable()
export class ActiveSessionsService {
  private readonly running = new Set<string>();

  private key(userId: string, sessionId: string): string {
    return `${userId}:${sessionId.toLowerCase()}`;
  }

  tryAcquire(userId: string, sessionId: string): boolean {
    const k = this.key(userId, sessionId);
    if (this.running.has(k)) return false;
    this.running.add(k);
    return true;
  }

  release(userId: string, sessionId: string): void {
    this.running.delete(this.key(userId, sessionId));
  }

  isRunning(userId: string, sessionId: string): boolean {
    return this.running.has(this.key(userId, sessionId));
  }
}
