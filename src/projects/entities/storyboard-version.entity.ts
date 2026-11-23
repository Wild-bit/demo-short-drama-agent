import { Column, Entity, PrimaryColumn } from "typeorm";
import { TimestampEntity } from "@/database/entities/timestamp.entity";
import type { SavedShot, StoryboardDraft } from "@/domain/storyboard";

@Entity("project_storyboard_versions")
export class StoryboardVersion extends TimestampEntity {
  @PrimaryColumn({ name: "project_id", type: "varchar", length: 36 })
  projectId!: string;

  /** 从 1 起递增。项目 ID 和版本号共同标识一份不可变的作品。 */
  @PrimaryColumn({ type: "int", unsigned: true })
  version!: number;

  @Column({ type: "json" })
  storyboard!: StoryboardDraft<SavedShot>;
}
