import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";
import { TimestampEntity } from "@/database/entities/timestamp.entity";

@Entity("sessions")
export class Session extends TimestampEntity {
  @PrimaryGeneratedColumn("uuid", { name: "session_id" })
  sessionId!: string;

  @Column({ type: "varchar", length: 64, name: "user_id" })
  userId!: string;

  @Column({ type: "varchar", length: 255, name: "name" })
  name!: string;

  /** 旧对话的摘要，原始消息仍由 session_messages 保存。 */
  @Column({ type: "text", name: "context_summary", nullable: true })
  contextSummary!: string | null;

  /** 摘要覆盖到的最后一条原始消息序号（含该条），0 表示尚未生成摘要。 */
  @Column({ type: "int", unsigned: true, name: "context_summary_through_sequence", default: 0 })
  contextSummaryThroughSequence!: number;
}
