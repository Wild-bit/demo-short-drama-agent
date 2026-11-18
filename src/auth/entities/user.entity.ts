import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { TimestampEntity } from "@/database/entities/timestamp.entity";

@Entity("users")
@Index("users_username", ["username"], { unique: true })
export class User extends TimestampEntity {
  @PrimaryGeneratedColumn("uuid", { name: "user_id" })
  userId!: string;

  @Column({ type: "varchar", length: 64 })
  username!: string;

  /** 初始演示用户须先设置密码才能登录；查询时默认不返回密码哈希。 */
  @Column({ name: "password_hash", type: "varchar", length: 255, nullable: true, select: false })
  passwordHash!: string | null;
}
