import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAssetLibraryIndex1795460000000 implements MigrationInterface {
  /** 为素材库按用户、类型分页并按更新时间排序的查询补充索引。 */
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX \`idx_assets_user_type_updated\` ON \`assets\` (\`user_id\`, \`type\`, \`updatedAt\`)`);
  }

  /** 回滚素材库分页索引。 */
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX \`idx_assets_user_type_updated\` ON \`assets\``);
  }
}
