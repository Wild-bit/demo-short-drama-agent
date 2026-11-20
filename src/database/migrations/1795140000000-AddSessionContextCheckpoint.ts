import type { MigrationInterface, QueryRunner } from "typeorm";

/** 为每个会话增加最新摘要及对应的原始消息位置。 */
export class AddSessionContextCheckpoint1795140000000 implements MigrationInterface {
  name = "AddSessionContextCheckpoint1795140000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `sessions` ADD `context_summary` text NULL, " +
      "ADD `context_summary_through_sequence` int UNSIGNED NOT NULL DEFAULT 0",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `sessions` DROP COLUMN `context_summary_through_sequence`, " +
      "DROP COLUMN `context_summary`",
    );
  }
}
