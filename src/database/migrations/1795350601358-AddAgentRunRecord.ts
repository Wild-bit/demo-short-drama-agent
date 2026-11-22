import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAgentRunRecord1795350601358 implements MigrationInterface {
    name = 'AddAgentRunRecord1795350601358'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`agent_run_record\` (\`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`run_id\` varchar(36) NOT NULL, \`session_id\` varchar(36) NOT NULL, \`user_id\` varchar(64) NOT NULL, \`status\` varchar(16) NOT NULL, \`steps\` json NOT NULL, \`reason\` varchar(255) NULL, \`ended_at\` datetime(3) NULL, INDEX \`idx_agent_run_user_session\` (\`user_id\`, \`session_id\`), PRIMARY KEY (\`run_id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`idx_agent_run_user_session\` ON \`agent_run_record\``);
        await queryRunner.query(`DROP TABLE \`agent_run_record\``);
    }

}
