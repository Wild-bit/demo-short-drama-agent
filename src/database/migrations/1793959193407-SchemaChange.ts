import { MigrationInterface, QueryRunner } from "typeorm";

export class SchemaChange1793959193407 implements MigrationInterface {
    name = 'SchemaChange1793959193407'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`assets\` (\`id\` varchar(36) NOT NULL, \`ownerId\` varchar(64) NOT NULL, \`name\` varchar(255) NOT NULL, \`type\` varchar(16) NOT NULL, \`description\` text NOT NULL, \`tags\` json NOT NULL, \`source\` varchar(16) NOT NULL, \`objectKey\` varchar(1024) NOT NULL, \`createdAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`updatedAt\` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE \`assets\``);
    }

}
