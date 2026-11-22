import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { TimestampEntity } from "@/database/entities/timestamp.entity";
import type { RunStatus, TraceStep } from "../trace/run-trace";

@Entity("agent_run_records")
@Index("idx_agent_run_user_session", ["userId", "sessionId"])
export class AgentRunRecord extends TimestampEntity {
  /** 一次用户提交对应一个运行 ID，整轮的模型和工具共用它。 */
  @PrimaryGeneratedColumn("uuid", { name: "run_id" })
  runId!: string;

  @Column({ name: "session_id", type: "varchar", length: 36 })
  sessionId!: string;

  @Column({ name: "user_id", type: "varchar", length: 64 })
  userId!: string;

  @Column({ type: "varchar", length: 16 })
  status!: RunStatus;

  /** 每次运行结束时保存按执行顺序排列的步骤和用量。 */
  @Column({ type: "json" })
  steps!: TraceStep[];

  @Column({ type: "varchar", length: 255, nullable: true })
  reason!: string | null;

  /** createdAt 是开始时间，endedAt 为本轮进入终态的时间。 */
  @Column({ name: "ended_at", type: "datetime", precision: 3, nullable: true })
  endedAt!: Date | null;
}
