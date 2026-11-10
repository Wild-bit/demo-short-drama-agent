# NestJS 与 MySQL 一起容器化

更新日期：2026-11-05。当前推荐本地运行方式，替代此前“本机启动 Nest、Docker 只启动 MySQL”的步骤。

## 一次启动

打开 Docker Desktop，等待引擎就绪，在项目根目录执行：

```bash
docker compose up -d --build --wait --wait-timeout 180
```

无需在本机安装 MySQL，也无需先执行本机 `pnpm install` 或 `pnpm dev`。镜像内安装依赖并启动 Nest。首次需要下载 Node、MySQL 镜像和 npm 依赖，必须能访问镜像与包仓库。

验证：

```bash
curl http://localhost:3100/api/health
curl http://localhost:3100/api/health/database
```

第二个接口应返回 `{"status":"ok","database":"mysql"}`。Compose 先等待 MySQL 实际查询检查通过，再启动 API；API 的健康检查也使用数据库接口。

## 端口和环境变量

| 访问关系 | 地址 |
|----------|------|
| 浏览器、本机工具 → Nest | `localhost:3100` |
| API 容器监听 | `3000` |
| Nest 容器 → MySQL | `mysql:3306` |
| 本机 DataGrip → MySQL | `127.0.0.1:3307`，可通过 MYSQL_PORT 修改 |

Compose 显式覆盖 API 中的 `PORT=3000`、`MYSQL_HOST=mysql` 与 `MYSQL_PORT=3306`。因此 `.env` 中为宿主机设置的 MySQL 端口不会误用于容器内部连接。

Compose 在宿主机读取 `.env`，仅向 API 注入需要的业务数据库配置和 DeepSeek 配置，不注入 MySQL root 密码。`.env` 被 `.dockerignore` 排除，不会复制进镜像。改环境变量后重新执行启动命令以重建容器配置。

## 开发与构建

默认使用 Dockerfile 的 `development` 阶段，挂载可写 `src`、只读 `package.json` 与 TypeScript 配置，编译结果写到容器自己的 `dist`。容器内安装 Linux 依赖，不使用宿主机的 `node_modules`。

修改已有源码后，容器内开发命令监听、编译并重启应用；修改依赖或 Dockerfile 后重新执行带 `--build` 的启动命令。热更新仍需本机实际运行验证，不能仅凭配置声称成功。

另有 `runtime` 多阶段镜像入口：先编译、保留运行依赖，再直接用 Node 启动构建产物。当前 Compose 使用开发阶段，不把它称为已完成生产部署。

新增 MySQL 依赖尚未完成宿主机锁文件更新，因此 Docker 安装暂用 `--no-frozen-lockfile` 补齐依赖。后续网络恢复并更新锁文件后再切换冻结安装，当前不能声称构建依赖完全可复现。

## 日常操作

```bash
docker compose ps
docker compose logs --tail 100 -f api
docker compose logs --tail 100 -f mysql
docker compose down
```

停止保留 MySQL 命名数据卷，不使用删除数据卷作为普通重启方式。也可使用 package.json 中的 `docker:up`、`docker:down`、`docker:status`、`docker:logs` 别名。

原终端模型示例及其启动命令已于 2026-11-06 移除；后续通过 Nest 业务服务使用现有 Gateway。

## 本次验证结果

`docker compose config --quiet` 与差异检查通过。实际尝试启动时，Docker socket 不存在，未能连接引擎，尚未执行镜像构建、启动容器、HTTP 验证或热更新验证。启动 Docker Desktop 后继续验证；当前没有新增付费模型请求。

## 用户本机验证（2026-11-06）

用户执行 Compose 启动，并提供 `http://localhost:3100/api/health/database` 返回 `{"status":"ok","database":"mysql"}`。据此记录 API 容器、TypeORM 与 MySQL 连接链路已在用户本机验证通过；助手沙箱无法直接访问 Docker socket 和宿主机端口。热更新、资产表、COS 和工具调用尚未验证。下一步进入资产表设计与迁移。

## 简化迁移命令（2026-11-06）

开发阶段源码可写，TypeORM 生成文件直接保存到宿主机 `src/database/migrations/`，不再通过临时目录复制。`package.json` 只读挂载，脚本变更无需重建镜像；依赖变更仍需重新构建安装。

本次挂载配置改变后，在已有数据库运行的前提下重建 API 容器配置一次：

```bash
docker compose up -d --no-deps --force-recreate api
```

日常迁移只需：

```bash
# 自动编译，比较实体与数据库，生成时间戳-SchemaChange.ts
docker compose exec api pnpm db:generate

# 人工检查新迁移的 up/down 后，执行尚未执行的迁移
docker compose exec api pnpm db:migrate

# 查看迁移状态
docker compose exec api pnpm db:migrations
```

每个命令内部包含必要编译和路径改写，不必再单独输入 build 或 CLI 路径。生成文件不执行数据库结构变更。文件名使用通用 SchemaChange 和唯一时间戳，具体变更以文件内容为准；没有结构差异时生成命令会提示无需迁移。

本次仅配置命令，尚未生成迁移或执行建表。
