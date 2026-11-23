import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddSessionPinned1795450000000 implements MigrationInterface {
  /** 为会话补充置顶标记，并更新项目会话列表排序索引。 */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`sessions\` ADD \`is_pinned\` tinyint(1) NOT NULL DEFAULT 0`);
    await queryRunner.query(`CREATE INDEX \`idx_sessions_user_project_pinned_updated\` ON \`sessions\` (\`user_id\`, \`project_id\`, \`is_pinned\`, \`updatedAt\`)`);
    await queryRunner.query(`DROP INDEX \`idx_sessions_user_project_updated\` ON \`sessions\``);
  }

  /** 回滚会话置顶列并恢复原项目会话索引。 */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX \`idx_sessions_user_project_updated\` ON \`sessions\` (\`user_id\`, \`project_id\`, \`updatedAt\`)`);
    await queryRunner.query(`DROP INDEX \`idx_sessions_user_project_pinned_updated\` ON \`sessions\``);
    await queryRunner.query(`ALTER TABLE \`sessions\` DROP COLUMN \`is_pinned\``);
  }
}
