# 学习入口

分享主题：**《一句话开拍，Agent 在幕后忙什么？》**  
副标题：用短剧工坊拆解 Agent Loop、上下文管理与 Harness

项目从零手写起步。当前每课由助手先提交代码执行方案，用户审核通过后再编码、验证和走读。[逐课流程](./课程大纲.md#2-每一课怎样进行)

- [项目目标、范围与架构约定](./project-goals-and-scope.md)：产品主线、NestJS/TypeORM/MySQL/COS、阶段取舍和课程调整。
- [学习导航](./学习导航.md)：分享约定、覆盖目标、协作方式与当前进度。
- [课程大纲](./课程大纲.md)：19 课的学习开发顺序、目录内容、验证标准与阶段成果。
- [第一课：一次提问背后的 Agent Loop 与 Harness](./01-agent-harness-loop.md)：模型与运行时的分工、工具反馈循环和一次提问中的多次模型调用。
- [第一课讨论记录：从工具请求到执行闭环](./01-agent-harness-loop-from-tool-request-to-execution.md)：本次问答、理解校准，以及接下来的动手起点。
- [第二课：从打印需求到第一次模型调用](./02-deepseek-first-call.md)：请求消息、响应字段、凭证配置与首次 DeepSeek 调用的验证目标。
- [第三课：让模型回答变成可校验的剧本与分镜](./03-prompts-and-structured-storyboard.md)：提示词装配、业务结构、JSON 解析与运行时校验。
- [第四课：工具定义与执行](./04-tool-definition-and-execution.md)：统一阅读入口，汇总 NestJS、Docker/MySQL、迁移、工具调用原理及验证状态；原准备文档作为详细记录按需查阅。
- [第五课：手写 Agent Loop](./05-agent-loop.md)：当前先理解工具调用与结果消息、调用 ID 配对，再逐步实现反馈循环。
- [第六课：会话、提示词装配与上下文管理](./06-context-management.md)：建立最小会话与跨请求历史，再学习上下文装配及规则和资料的边界。
- [第七课：各家 Agent Harness 怎样处理上下文膨胀](./07-context-compaction.md)：对照 Multica、DeepSeek Harness、Codex、OpenCode 等公开实现，再动手做预算、压缩和历史回查。
- [第八课：工具循环的步数控制](./08-agent-run-control.md)：沿着素材搜索理解按轮计数、整批超限和停止后的会话历史。
- [第九课：SSE 与 Trace](./09-sse-and-trace.md)。从一段增量回答走读会话提交、工具进度、Trace 与断线取消。
- [项目 README](../README.md)：当前项目状态。
- [Gateway 路由讨论记录](./gateway-routing-discussion.md)：提前讨论的选择规则与职责分工，尚未进入实现；评测 Agent 列为后期扩展。

固定节奏：文档讲解 → 阅读、提问与复述 → 指导用户编写 → 运行验证与代码检查。每轮只推进一个小步骤。
