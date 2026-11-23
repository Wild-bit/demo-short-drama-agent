import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjects1795404497188 implements MigrationInterface {
  /** 创建项目表并让现有独立会话保持可用。 */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`projects\` (\`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`project_id\` varchar(36) NOT NULL, \`user_id\` varchar(64) NOT NULL, \`name\` varchar(255) NOT NULL, INDEX \`idx_projects_user_updated\` (\`user_id\`, \`updatedAt\`), PRIMARY KEY (\`project_id\`)) ENGINE=InnoDB`);
    await queryRunner.query(`ALTER TABLE \`sessions\` ADD \`project_id\` varchar(36) NULL`);
    await queryRunner.query(`CREATE INDEX \`idx_sessions_user_project_updated\` ON \`sessions\` (\`user_id\`, \`project_id\`, \`updatedAt\`)`);
  }

  /** 撤销项目结构，保留原有会话与消息。 */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`idx_sessions_user_project_updated\` ON \`sessions\``);
    await queryRunner.query(`ALTER TABLE \`sessions\` DROP COLUMN \`project_id\``);
    await queryRunner.query(`DROP INDEX \`idx_projects_user_updated\` ON \`projects\``);
    await queryRunner.query(`DROP TABLE \`projects\``);
  }
}
