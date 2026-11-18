import { MigrationInterface, QueryRunner } from "typeorm";

/** 为已有演示数据建立真实用户归属；不创建数据库外键。 */
export class UserAuthentication1794913000000 implements MigrationInterface {
  name = "UserAuthentication1794913000000";
  private readonly demoId = "9cf47952-2145-41de-bf39-9a7038690ca9";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("CREATE TABLE `users` (`createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), `user_id` varchar(36) NOT NULL, `username` varchar(64) NOT NULL, `name` varchar(255) NOT NULL, `password_hash` varchar(255) NULL, UNIQUE INDEX `users_username` (`username`), PRIMARY KEY (`user_id`)) ENGINE=InnoDB");
    await queryRunner.query("CREATE TABLE `auth_tokens` (`token_hash` varchar(64) NOT NULL, `user_id` varchar(36) NOT NULL, `expires_at` datetime(3) NOT NULL, INDEX `auth_tokens_user_id` (`user_id`), PRIMARY KEY (`token_hash`)) ENGINE=InnoDB");
    await queryRunner.query("INSERT INTO `users` (`user_id`, `username`, `name`, `password_hash`) VALUES (?, 'demo', '演示用户', NULL)", [this.demoId]);
    await queryRunner.query("UPDATE `assets` SET `ownerId` = ? WHERE `ownerId` = 'demo-user'", [this.demoId]);
    await queryRunner.query("UPDATE `sessions` SET `owner_id` = ? WHERE `owner_id` = 'demo-user'", [this.demoId]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("UPDATE `assets` SET `ownerId` = 'demo-user' WHERE `ownerId` = ?", [this.demoId]);
    await queryRunner.query("UPDATE `sessions` SET `owner_id` = 'demo-user' WHERE `owner_id` = ?", [this.demoId]);
    await queryRunner.query("DROP TABLE `auth_tokens`");
    await queryRunner.query("DROP TABLE `users`");
  }
}
