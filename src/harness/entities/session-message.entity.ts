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
  /** 会话内从 1 开始递增的消息顺序。 */
  @Column({ type: "int", unsigned: true })
  sequence!: number;

  /** 完整保存用户、模型或工具消息。 */
  @Column({ type: "json" })
  message!: SessionMessagePayload;
}
