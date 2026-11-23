import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddStoryboardVersionsAndConfirmations1795414811622 implements MigrationInterface {
  /** 保存作品快照和用户对指定版本的生成前确认。 */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE \`project_storyboard_versions\` (\`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`project_id\` varchar(36) NOT NULL, \`version\` int UNSIGNED NOT NULL, \`storyboard\` json NOT NULL, PRIMARY KEY (\`project_id\`, \`version\`)) ENGINE=InnoDB`);
    await queryRunner.query(`CREATE TABLE \`project_generation_confirmations\` (\`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`project_id\` varchar(36) NOT NULL, \`confirmation_id\` varchar(36) NOT NULL, \`version\` int UNSIGNED NOT NULL, \`shot_ids\` json NOT NULL, \`model\` varchar(255) NOT NULL, INDEX \`idx_confirmation_project_version\` (\`project_id\`, \`version\`), PRIMARY KEY (\`project_id\`, \`confirmation_id\`)) ENGINE=InnoDB`);
  }

  /** 撤销第 10.2 节新增的两张表。 */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`idx_confirmation_project_version\` ON \`project_generation_confirmations\``);
    await queryRunner.query(`DROP TABLE \`project_generation_confirmations\``);
    await queryRunner.query(`DROP TABLE \`project_storyboard_versions\``);
  }
}
