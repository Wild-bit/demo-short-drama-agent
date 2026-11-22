import type { MigrationInterface, QueryRunner } from "typeorm";

/** 移除教学版费用上限，待确认时允许尚无任务费用。 */
export class RemoveGenerationApprovalBudget1795220000000 implements MigrationInterface {
  name = "RemoveGenerationApprovalBudget1795220000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `generation_approvals` DROP COLUMN `budget_fen`, " +
      "MODIFY COLUMN `estimated_cost_fen` int UNSIGNED NULL",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚到教学版时，按当时的单价补齐尚未执行的方案金额。
    await queryRunner.query(
      "UPDATE `generation_approvals` SET `estimated_cost_fen` = JSON_LENGTH(`draft`, '$.shotIds') * 200 " +
      "WHERE `estimated_cost_fen` IS NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `generation_approvals` ADD COLUMN `budget_fen` int UNSIGNED NOT NULL DEFAULT 1000, " +
      "MODIFY COLUMN `estimated_cost_fen` int UNSIGNED NOT NULL",
    );
    await queryRunner.query("ALTER TABLE `generation_approvals` ALTER COLUMN `budget_fen` DROP DEFAULT");
  }
}
