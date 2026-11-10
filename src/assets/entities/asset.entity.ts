import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type AssetType = "image" | "video";
export type AssetSource = "upload" | "generated";

@Entity("assets")
export class Asset {
  /** 资产唯一ID */
  @PrimaryGeneratedColumn("uuid")
  id: string;

  /** 所属用户；演示阶段由服务端提供用户上下文。 */
  @Column({ type: "varchar", length: 64 })
  ownerId!: string;

  /** 素材名称。 */
  @Column({ type: "varchar", length: 255 })
  name!: string;

  /** 素材类型：图片或视频。 */
  @Column({ type: "varchar", length: 16 })
  type!: AssetType;

  /** 内容描述，供用户浏览和关键词搜索。 */
  @Column({ type: "text" })
  description!: string;

  /** 标签，例如“女主”“红衣”“古装”。 */
  @Column({ type: "json" })
  tags!: string[];

  /** 素材来源：上传或生成。 */
  @Column({ type: "varchar", length: 16 })
  source!: AssetSource;

  /** COS 对象 Key，不保存会过期的签名 URL。 */
  @Column({ type: "varchar", length: 1024 })
  objectKey!: string;

  @CreateDateColumn({
    type: "datetime",
    precision: 3,
    default: () => "CURRENT_TIMESTAMP(3)",
  })
  createdAt!: Date;

  @UpdateDateColumn({
    type: "datetime",
    precision: 3,
    default: () => "CURRENT_TIMESTAMP(3)",
    onUpdate: "CURRENT_TIMESTAMP(3)",
  })
  updatedAt!: Date;
}
