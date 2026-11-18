import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { createHash, randomBytes } from "node:crypto";
import { MoreThan, Repository } from "typeorm";
import { User } from "./entities/user.entity";
import { AuthToken } from "./entities/auth-token.entity";
import { verifyPassword } from "./password";

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuthToken) private readonly tokens: Repository<AuthToken>,
  ) {}

  async login(username: string, password: string) {
    const user = await this.users.createQueryBuilder("user")
      .addSelect("user.passwordHash")
      .where("user.username = :username", { username }).getOne();
    // 不存在的用户也执行密码计算，避免直接跳过昂贵校验。
    const valid = await verifyPassword(password, user?.passwordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`);
    if (!user?.passwordHash || !valid) throw new UnauthorizedException("用户名或密码错误");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.tokens.save(this.tokens.create({ tokenHash: tokenHash(token), userId: user.userId, expiresAt }));
    return { token, tokenType: "Bearer", expiresAt, user: { userId: user.userId, username: user.username } };
  }

  async authenticate(token: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException("Token 无效或已过期");
    const record = await this.tokens.findOneBy({ tokenHash: tokenHash(token), expiresAt: MoreThan(new Date()) });
    if (!record || !await this.users.existsBy({ userId: record.userId })) {
      throw new UnauthorizedException("Token 无效或已过期");
    }
    return record.userId;
  }

  async logout(token: string): Promise<void> {
    await this.tokens.delete({ tokenHash: tokenHash(token) });
  }
}
