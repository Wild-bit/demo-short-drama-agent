import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { TimestampEntity } from "@/database/entities/timestamp.entity";

@Entity("projects")
@Index("idx_projects_user_updated", ["userId", "updatedAt"])
export class Project extends TimestampEntity {
  /** 项目创建时分配，重新打开项目时沿用。 */
  @PrimaryGeneratedColumn("uuid", { name: "project_id" })
  projectId!: string;

  /** 项目所属用户，由服务端从登录凭证取得。 */
  @Column({ name: "user_id", type: "varchar", length: 64 })
  userId!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;
}
