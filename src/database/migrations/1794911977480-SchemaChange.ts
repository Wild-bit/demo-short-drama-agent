import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaChange1794911977480 implements MigrationInterface {
    name = 'SchemaChange1794911977480'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`sessions\` (\`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`session_id\` varchar(36) NOT NULL, \`owner_id\` varchar(64) NOT NULL, \`name\` varchar(255) NOT NULL, PRIMARY KEY (\`session_id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`CREATE TABLE \`session_messages\` (\`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), \`message_id\` varchar(36) NOT NULL, \`session_id\` varchar(36) NOT NULL, \`sequence\` int UNSIGNED NOT NULL, \`message\` json NOT NULL, UNIQUE INDEX \`session_id_sequence\` (\`session_id\`, \`sequence\`), PRIMARY KEY (\`message_id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`session_id_sequence\` ON \`session_messages\``);
        await queryRunner.query(`DROP TABLE \`session_messages\``);
        await queryRunner.query(`DROP TABLE \`sessions\``);
    }

}
