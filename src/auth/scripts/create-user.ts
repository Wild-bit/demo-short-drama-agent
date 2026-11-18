import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import dataSource from "@/database/data-source";
import { User } from "../entities/user.entity";
import { AuthToken } from "../entities/auth-token.entity";
import { hashPassword } from "../password";

/** 密码从标准输入读取，避免出现在命令参数、shell 历史或源码中。 */
async function main() {
  const [username, ...extraArgs] = process.argv.slice(2);
  if (extraArgs.length || !username || !/^[a-zA-Z0-9_-]{1,64}$/.test(username)) {
    throw new Error("用法：auth:create-user <用户名>，通过标准输入提供 8–256 字符密码");
  }
  const password = readFileSync(0, "utf8").replace(/\r?\n$/, "");
  if (password.length < 8 || password.length > 256) throw new Error("密码长度应为 8–256 字符");
  const passwordHash = await hashPassword(password);
  await dataSource.initialize();
  try {
    await dataSource.transaction(async manager => {
      const users = manager.getRepository(User);
      const existing = await users.findOneBy({ username });
      if (existing) {
        // 命令是受信任的运维入口，可初始化或重置密码，同时撤销旧 Token。
        await users.update({ userId: existing.userId }, { passwordHash });
        await manager.getRepository(AuthToken).delete({ userId: existing.userId });
      } else {
        await users.save(users.create({ userId: randomUUID(), username, passwordHash }));
      }
    });
    console.log(`用户 ${username} 已就绪；如已存在，密码已更新且旧 Token 已撤销。`);
  } finally {
    await dataSource.destroy();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "创建用户失败"); process.exitCode = 1; });
