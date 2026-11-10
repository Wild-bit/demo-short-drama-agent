import type { TypeOrmModuleOptions } from "@nestjs/typeorm";
import type { DataSourceOptions } from "typeorm";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`缺少数据库配置 ${name}，请检查 .env`);
  }
  return value;
}

/** Nest 在创建数据库模块时读取配置，凭证不写入源码或日志。 */
export function createDatabaseOptions(): DataSourceOptions {
  const port = Number(process.env.MYSQL_PORT ?? 3307);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("MYSQL_PORT 必须是 1–65535 之间的整数");
  }

  return {
    type: "mysql",
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port,
    username: process.env.MYSQL_USER ?? "short_drama",
    password: required("MYSQL_PASSWORD"),
    database: process.env.MYSQL_DATABASE ?? "short_drama",
    charset: "utf8mb4_unicode_ci",
    synchronize: false,
    logging: false,
    connectTimeout: 5_000,
    extra: { connectionLimit: 5 },
  };
}
