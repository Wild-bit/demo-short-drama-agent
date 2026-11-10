import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 只表示应用存活，不代表数据库、COS 或模型服务可用。 */
  getStatus() {
    return {
      status: "ok",
      service: "short-drama-agent",
    };
  }

  /** 单独验证数据库连接，不把 HTTP 存活和外部依赖就绪混为一谈。 */
  async getDatabaseStatus() {
    try {
      await this.dataSource.query("SELECT 1");
      return { status: "ok", database: "mysql" };
    } catch {
      throw new ServiceUnavailableException("数据库暂不可用");
    }
  }
}
