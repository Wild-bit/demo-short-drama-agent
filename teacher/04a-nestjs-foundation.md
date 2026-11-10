# 第四课准备：NestJS 最小服务

2026-11-05 用户授权助手直接搭建本次框架基础。该授权不改变后续业务代码以用户亲手编写为主的约定。

## 当前结构

| 文件 | 作用 |
|------|------|
| `src/main.ts` | 加载 Nest 应用、设置 `/api` 前缀、监听端口 |
| `src/app.module.ts` | 根模块，组织后续业务模块 |
| `src/health/health.module.ts` | 注册健康检查控制器和服务 |
| `src/health/health.controller.ts` | 接收 `GET /api/health` |
| `src/health/health.service.ts` | 返回应用存活状态，演示 Controller 注入 Service |

NestJS 负责应用组织，现有 `gateway`、`request`、`prompts`、`domain` 保留。启动 HTTP 服务不会请求模型。

本次只建立框架与健康检查，没有实现数据库、COS、资产接口、鉴权或工具调用。

## 构建与运行

保留 ESM 和 `@/` 路径别名。Nest 使用装饰器和依赖注入，开启 TypeScript 装饰器元数据；服务使用 TypeScript 编译后运行，不使用原 `tsx` 命令直接启动 Nest。

`tsc-alias` 负责将构建后的路径别名和无后缀相对导入改写为 Node.js 可解析的路径。`tsc-watch` 监视源码，编译成功后重启服务。类型检查仍单独执行。

在项目根目录：

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm dev
```

默认端口 3000，可通过 `.env` 的 `PORT` 修改。服务使用 Node.js 的可选环境文件加载；不存在 `.env` 时健康检查也能启动，不需要模型 Key。

另一个终端检查：

```bash
curl http://localhost:3000/api/health
```

预期返回：

```json
{"status":"ok","service":"short-drama-agent"}
```

该结果仅表示 HTTP 应用存活，不表示 MySQL、COS 或模型可用。验证 Controller 能正确调用 Service，也验证了当前编译流程的依赖注入元数据。

运行构建产物用 `pnpm start`。需要依赖中的开发工具时使用完整依赖安装，本阶段未设计生产精简部署。

原终端模型演示已于 2026-11-06 清理，后续从 Nest 业务服务继续接入 Gateway。

## 验证进度与 TypeScript 7 兼容处理

初次安装曾受助手环境 DNS 限制；用户已完成依赖安装，当前本地依赖可用。

`tsc-watch` 默认通过 `typescript/bin/tsc` 包子路径查找编译器，TypeScript 7 的 exports 不公开该子路径，因此触发 `ERR_PACKAGE_PATH_NOT_EXPORTED`。开发命令现使用 `--compiler "$PWD/node_modules/typescript/bin/tsc"` 指定实际文件入口，保留现有 TypeScript 版本。该脚本适用于当前 macOS 的 shell 环境。

已验证类型检查、TypeScript 编译、构建导入路径改写，以及 Nest 模块、依赖注入和路由初始化。助手环境的文件监视出现 FSEvents 限制，端口监听报 EPERM，因此没有声明开发热更新及真实 HTTP 请求已通过。用户本机继续用 `pnpm dev` 和健康检查验证。

下一步验证最小服务后再接 TypeORM/MySQL，随后接 COS；不提前创建所有业务模块。
