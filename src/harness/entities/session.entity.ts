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
}
