# 一键短剧工坊

分享主题：**《一句话开拍，Agent 在幕后忙什么？》**  
副标题：用短剧工坊拆解 Agent Loop、上下文管理与 Harness

文本模型已选定 **DeepSeek**（已完成终端真实调用与 JSON 输出解析）。2026-11-02 讨论将 Seedance 2.5、Grok Imagine Video 1.5 作为可能同时使用的视频候选，具体接口与账户权限仍待核实。Gateway 先支持手动选择，再增加能力与预算规则路由；评测 Agent 留作后期扩展。详见[Gateway 讨论记录](./teacher/gateway-routing-discussion.md)。

## 当前状态

2026-10-29 按用户要求从零开始：原有实现、目录骨架、构建配置、示例资产与旧落地方案已清空，之后由用户逐步编写，现已具备 TypeScript 终端入口、DeepSeek 适配、通用 HTTP 客户端和分镜提示词；NestJS 最小服务源码已搭建，类型检查与构建通过，真实 HTTP 监听待本机验证；Docker MySQL 与 TypeORM 接入代码已准备，依赖安装和真实连接待验证；COS 与工具调用尚未实现。

## 协作方式

每课先由助手提交代码执行方案，用户审核通过后再编码。助手用实际运行结果走读关键代码、回答疑问，随后提炼分享材料。[逐课流程](./teacher/课程大纲.md#2-每一课怎样进行)

## 技术与范围

已确认采用 NestJS + TypeORM + MySQL + 腾讯云 COS，保留用户、项目与资产归属设计。演示阶段暂缓登录与接口鉴权，不将产品限定为单用户服务。

统一依据见[项目目标、范围与架构约定](./teacher/project-goals-and-scope.md)。

## 学习入口

- [课程大纲：学习节奏、逐课开发内容与目标目录](./teacher/课程大纲.md)
- [学习导航与分享约定](./teacher/学习导航.md)
- [第一课：一次提问背后的 Agent Loop 与 Harness](./teacher/01-agent-harness-loop.md)
- [Gateway 路由讨论记录（待实现）](./teacher/gateway-routing-discussion.md)

当前进入第九课走读。会话支持流式回答、工具进度和按运行查询 Trace，已通过本地 HTTP 与 MySQL 联调。[第九课讲义与终端示例](./teacher/09-sse-and-trace.md)

## 本地容器启动

NestJS 与 MySQL 均由 Docker Compose 管理，先打开 Docker Desktop，然后执行：

```bash
docker compose up -d --build --wait --wait-timeout 180
```

API：`http://localhost:3100/api/health`；数据库检查：`http://localhost:3100/api/health/database`。

源码挂载到 API 容器，容器内编译与重启；不需要本机安装 MySQL 或先安装 Node 依赖。文件修改、依赖变更与常用命令见[容器开发说明](./teacher/04-tool-definition-and-execution.md)。

只重启 API 时运行 `docker compose restart api`，也可在宿主机用 `pnpm docker:restart` 或 `pnpm restart`。

已验证开发容器能通过当前脚本启动 API，数据库健康检查和迁移状态查询均通过。
