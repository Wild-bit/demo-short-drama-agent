# 第四课准备：Docker MySQL 与 TypeORM

更新日期：2026-11-05。用户授权直接搭建基础设施，后续工具业务仍按文档先行、小步编写推进。

后续已将 API 一起容器化，当前推荐步骤见[NestJS 与 MySQL 一起容器化](./04c-containerized-api.md)，API 映射本机 3100。本文保留数据库配置说明，宿主机直接运行后端仅作为可选方式。

## 结构与职责

- `compose.yaml`：启动 MySQL 8.4，创建数据库和独立业务账号，配置健康检查与数据卷。
- `src/database/database.config.ts`：读取 MySQL 配置，设置连接池，不输出密码。
- `src/database/database.module.ts`：将 TypeORM 连接注册到 Nest。
- `GET /api/health`：应用存活；`GET /api/health/database`：实际执行 `SELECT 1` 检查数据库。

Nest 继续在本机运行，只有 MySQL 在容器内。默认通过 `127.0.0.1:3307` 连接容器的 `3306`，不需要本机安装 MySQL。若将来 Nest 也运行在 Compose 中，连接地址应改为服务名 `mysql`，端口使用 `3306`。

## 配置

`.env.example` 提供变量说明。本次已在真实 `.env` 中补充缺失的 MySQL 项，缺失密码随机生成；现有模型凭证与已存在变量保留，密码没有输出到聊天或文档。

| 变量 | 默认值或含义 |
|------|--------------|
| MYSQL_HOST | `127.0.0.1`，宿主机访问地址 |
| MYSQL_PORT | `3307`，宿主机映射端口 |
| MYSQL_DATABASE | `short_drama` |
| MYSQL_USER | `short_drama`，应用使用的业务账号 |
| MYSQL_PASSWORD | 业务账号密码 |
| MYSQL_ROOT_PASSWORD | 仅用于容器初始化，不作为 Nest 连接账号 |

MySQL 镜像首次初始化时使用环境变量创建库和账号。已有数据卷时，仅修改 `.env` 不会自动修改数据库密码或数据库名；变更应通过实际数据库操作完成，避免配置和现有数据不一致。

## 启动与验证

先打开 Docker Desktop 并等待引擎运行，再在项目根目录执行：

```bash
pnpm install
pnpm db:up
pnpm typecheck
pnpm dev
```

`db:up` 等待容器健康检查通过。首次需要拉取镜像和初始化数据，可能耗时较长。

另一个终端：

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/health/database
```

数据库接口预期：

```json
{"status":"ok","database":"mysql"}
```

它会使用应用业务账号进行实际查询，不只是检查容器是否存在。数据库依赖首次连接失败时，Nest 启动会失败；服务启动后数据库查询失败时，此检查返回 HTTP 503。

日常管理：

```bash
pnpm db:status
pnpm db:logs
pnpm db:down
```

`db:down` 停止并移除容器，保留命名数据卷；再次启动可继续使用已有数据。不要把删除数据卷作为普通重启步骤。

## 当前范围

这一阶段只验证连接，没有建立资产表，没有实现 COS 或数据库搜索。`synchronize` 关闭，后续资产表使用迁移管理，不靠启动应用自动修改表结构。

确定的后续工具：先实现 `search_user_assets` 查询实际资产；再接 `generate_image_asset` 生成参考图，存入 COS 并登记资产。图片生成供应商待确认；生成资产与用户选用资产是不同状态。

## 验证记录

- Docker CLI 与 Compose 可用；Compose 配置已通过 `docker compose config --quiet`，没有输出展开后的密码。
- 助手环境当前无法连接 Docker 引擎，自动打开 Docker Desktop 失败，尚未拉取镜像或创建数据库卷。
- 新增依赖的安装尚未成功完成；类型检查目前报告 `@nestjs/typeorm`、`typeorm` 缺失，不能声明编译与连接已通过。
- 待本机启动 Docker、安装依赖后完成端到端验证；未调用模型、未执行付费生成。

参考：[NestJS 数据库集成](https://docs.nestjs.com/techniques/database)、[MySQL 官方镜像](https://hub.docker.com/_/mysql)。
