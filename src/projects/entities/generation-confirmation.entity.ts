import { Column, Entity, Index, PrimaryColumn } from "typeorm";
import { TimestampEntity } from "@/database/entities/timestamp.entity";

@Entity("project_generation_confirmations")
@Index("idx_confirmation_project_version", ["projectId", "version"])
export class GenerationConfirmation extends TimestampEntity {
  @PrimaryColumn({ name: "project_id", type: "varchar", length: 36 })
  projectId!: string;

  /** 工作台为一次点击分配 UUID；网络重试沿用这个 ID。 */
  @PrimaryColumn({ name: "confirmation_id", type: "varchar", length: 36 })
  confirmationId!: string;

  @Column({ type: "int", unsigned: true })
  version!: number;

  /** 用户此次勾选的镜头，按对应分镜版本中的播放顺序保存。 */
  @Column({ name: "shot_ids", type: "json" })
  shotIds!: string[];

  @Column({ type: "varchar", length: 255 })
  model!: string;
}
