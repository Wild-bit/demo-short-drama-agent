import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT 必须是 1–65535 之间的整数");
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();

  await app.listen(port);
  Logger.log(`服务已启动：http://localhost:${port}/api/health`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : "应用启动失败",
    undefined,
    "Bootstrap",
  );
  process.exitCode = 1;
});
