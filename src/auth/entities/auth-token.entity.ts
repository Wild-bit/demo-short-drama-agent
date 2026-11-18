import { Column, Entity, PrimaryColumn, Index } from "typeorm";

@Entity("auth_tokens")
export class AuthToken {
  @PrimaryColumn({ name: "token_hash", type: "varchar", length: 64 })
  tokenHash!: string;

  @Index("auth_tokens_user_id")
  @Column({ name: "user_id", type: "varchar", length: 36 })
  userId!: string;

  @Column({ name: "expires_at", type: "datetime", precision: 3 })
  expiresAt!: Date;
}
