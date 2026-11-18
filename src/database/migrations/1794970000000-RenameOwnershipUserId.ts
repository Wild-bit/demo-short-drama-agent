import type { MigrationInterface, QueryRunner } from "typeorm";

/** 统一资产和会话的用户归属列，保留已有归属值。 */
export class RenameOwnershipUserId1794970000000 implements MigrationInterface {
  name = "RenameOwnershipUserId1794970000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.renameColumn(queryRunner, "assets", "ownerId", "user_id");
    await this.renameColumn(queryRunner, "sessions", "owner_id", "user_id");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.renameColumn(queryRunner, "sessions", "user_id", "owner_id");
    await this.renameColumn(queryRunner, "assets", "user_id", "ownerId");
  }

  private async renameColumn(
    queryRunner: QueryRunner,
    table: "assets" | "sessions",
    from: "ownerId" | "owner_id" | "user_id",
    to: "ownerId" | "owner_id" | "user_id",
  ): Promise<void> {
    // MySQL DDL 会隐式提交。重试时跳过已成功改名的列。
    if (!(await queryRunner.hasColumn(table, from)) && await queryRunner.hasColumn(table, to)) {
      return;
    }

    await queryRunner.query(`ALTER TABLE \`${table}\` RENAME COLUMN \`${from}\` TO \`${to}\``);
  }
}
