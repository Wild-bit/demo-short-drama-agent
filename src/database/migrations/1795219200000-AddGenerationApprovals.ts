import type { MigrationInterface, QueryRunner } from "typeorm";

/** 保存模拟生成的审批快照与用户决定。 */
export class AddGenerationApprovals1795219200000 implements MigrationInterface {
  name = "AddGenerationApprovals1795219200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`generation_approvals\` (
        \`approval_id\` varchar(36) NOT NULL,
        \`session_id\` varchar(36) NOT NULL,
        \`based_on_sequence\` int UNSIGNED NOT NULL,
        \`draft\` json NOT NULL,
        \`estimated_cost_fen\` int UNSIGNED NOT NULL,
        \`budget_fen\` int UNSIGNED NOT NULL,
        \`status\` varchar(16) NOT NULL,
        \`task_id\` varchar(36) NULL,
        \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`approval_id\`)
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE `generation_approvals`");
  }
}
