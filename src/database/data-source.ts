import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { DataSource } from "typeorm";
import { Asset } from "@/assets/entities/asset.entity";
import { createDatabaseOptions } from "./database.config";

export default new DataSource({
  ...createDatabaseOptions(),
  entities: [Asset],
  migrations: [fileURLToPath(new URL("./migrations/*.js", import.meta.url))],
  migrationsTableName: "migrations",
});
