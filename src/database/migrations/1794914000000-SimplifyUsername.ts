import { MigrationInterface, QueryRunner } from "typeorm";

/** 用户名同时用于登录和展示，移除独立显示名称。 */
export class SimplifyUsername1794914000000 implements MigrationInterface {
  name = "SimplifyUsername1794914000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `users` DROP COLUMN `name`");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("ALTER TABLE `users` ADD `name` varchar(255) NOT NULL DEFAULT ''");
    // 原显示名称不再保留，回退时以用户名填充。
    await queryRunner.query("UPDATE `users` SET `name` = `username`");
    await queryRunner.query("ALTER TABLE `users` ALTER COLUMN `name` DROP DEFAULT");
  }
}
