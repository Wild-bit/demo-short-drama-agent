import type { MigrationInterface, QueryRunner } from "typeorm";

/** 清理第八课停用的审批表，仅允许删除空表。 */
export class DropUnusedGenerationApprovals1795275915733 implements MigrationInterface {
  name = "DropUnusedGenerationApprovals1795275915733";

  async up(queryRunner: QueryRunner): Promise<void> {
    // MySQL 的 DDL 会隐式提交，掉线后重试时表可能已删除。
    if (!(await queryRunner.hasTable("generation_approvals"))) return;

    // 持锁检查，防止空表检查与删除之间又有记录写入。
    await queryRunner.query("LOCK TABLES `generation_approvals` WRITE");
    try {
      const rows = await queryRunner.query("SELECT 1 FROM `generation_approvals` LIMIT 1");
      if (rows.length > 0) {
        throw new Error("generation_approvals 中存在记录，已停止删除");
      }
      await queryRunner.query("DROP TABLE `generation_approvals`");
    } finally {
      await queryRunner.query("UNLOCK TABLES");
    }
  }

  /** 回滚时恢复上一条迁移留下的空表结构。 */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`generation_approvals\` (
        \`approval_id\` varchar(36) NOT NULL,
        \`session_id\` varchar(36) NOT NULL,
        \`based_on_sequence\` int UNSIGNED NOT NULL,
        \`draft\` json NOT NULL,
        \`estimated_cost_fen\` int UNSIGNED NULL,
        \`status\` varchar(16) NOT NULL,
        \`task_id\` varchar(36) NULL,
        \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (\`approval_id\`)
      ) ENGINE=InnoDB
    `);
  }
}
