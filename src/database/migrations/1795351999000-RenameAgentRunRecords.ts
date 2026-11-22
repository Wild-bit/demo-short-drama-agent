import type { MigrationInterface, QueryRunner } from "typeorm";

export class RenameAgentRunRecords1795351999000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("RENAME TABLE `agent_run_record` TO `agent_run_records`");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("RENAME TABLE `agent_run_records` TO `agent_run_record`");
  }
}
