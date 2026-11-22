import { User } from "@/auth/entities/user.entity";
import { AuthToken } from "@/auth/entities/auth-token.entity";
import "reflect-metadata";
import { fileURLToPath } from "node:url";
import { DataSource } from "typeorm";
import { Asset } from "@/assets/entities/asset.entity";
import { createDatabaseOptions } from "./database.config";
import { AgentRunRecord } from "@/harness/entities/agent-run-record.entity";
import { Session } from "@/harness/entities/session.entity";
import { SessionMessage } from "@/harness/entities/session-message.entity";

export default new DataSource({
  ...createDatabaseOptions(),
  entities: [Asset, Session, SessionMessage, User, AuthToken, AgentRunRecord],
  migrations: [fileURLToPath(new URL("./migrations/*.js", import.meta.url))],
  migrationsTableName: "migrations",
});
