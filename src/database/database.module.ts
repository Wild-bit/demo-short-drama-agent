import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { createDatabaseOptions } from "./database.config";

/** 连接池由 TypeORM 管理；资产实体和迁移在下一阶段加入。 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...createDatabaseOptions(),
        autoLoadEntities: true,
        retryAttempts: 3,
        retryDelay: 1_000,
      }),
    }),
  ],
})
export class DatabaseModule {}
