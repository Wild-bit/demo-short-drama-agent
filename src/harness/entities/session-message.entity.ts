import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { TimestampEntity } from "@/database/entities/timestamp.entity";
import type { SessionMessagePayload } from "../types";

@Entity("session_messages")
@Index("session_id_sequence", ["sessionId", "sequence"], { unique: true })
export class SessionMessage extends TimestampEntity {
  @PrimaryGeneratedColumn("uuid", { name: "message_id" })
  messageId!: string;

  @Column({ type: "varchar", length: 36, name: "session_id" })
  sessionId!: string;

  /** 写入时按会话从 1 递增分配，用户、助手和工具消息各占一个序号。 */
  @Column({ type: "int", unsigned: true })
  sequence!: number;

  /** 完整保存用户、模型或工具消息。 */
  @Column({ type: "json" })
  message!: SessionMessagePayload;
}
