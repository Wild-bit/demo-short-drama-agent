# 学习入口

分享主题：**《一句话开拍，Agent 在幕后忙什么？》**  
副标题：用短剧工坊拆解 Agent Loop、上下文管理与 Harness

项目已按用户要求清空原实现，从零手写。每轮先提供当前步骤的说明文档，用户理解后，助手再指导用户亲手写代码并检查结果。

- [项目目标、范围与架构约定](./project-goals-and-scope.md)：产品主线、NestJS/TypeORM/MySQL/COS、阶段取舍和课程调整。
- [学习导航](./学习导航.md)：分享约定、覆盖目标、协作方式与当前进度。
- [课程大纲](./课程大纲.md)：19 课的学习开发顺序、目录内容、验证标准与阶段成果。
- [第一课：一次提问背后的 Agent Loop 与 Harness](./01-agent-harness-loop.md)：模型与运行时的分工、工具反馈循环和一次提问中的多次模型调用。
- [第一课讨论记录：从工具请求到执行闭环](./01-agent-harness-loop-from-tool-request-to-execution.md)：本次问答、理解校准，以及接下来的动手起点。
- [第二课：从打印需求到第一次模型调用](./02-deepseek-first-call.md)：请求消息、响应字段、凭证配置与首次 DeepSeek 调用的验证目标。
- [第三课：让模型回答变成可校验的剧本与分镜](./03-prompts-and-structured-storyboard.md)：提示词装配、业务结构、JSON 解析与运行时校验。
- [第四课准备：NestJS 最小服务](./04a-nestjs-foundation.md)：框架结构、启动命令、健康检查与当前验证限制。
- [第四课准备：Docker MySQL 与 TypeORM](./04b-docker-mysql.md)：容器数据库、连接配置、健康检查与数据保留。
- [第四课准备：NestJS 与 MySQL 一起容器化](./04c-containerized-api.md)：当前推荐启动方式，API 映射到本机 3100。
- [第四课：工具定义与执行](./04-tool-definition-and-execution.md)：工具声明、模型调用请求、注册与真实执行，先使用用户素材库搜索工具。
- [项目 README](../README.md)：当前项目状态。
- [Gateway 路由讨论记录](./gateway-routing-discussion.md)：提前讨论的选择规则与职责分工，尚未进入实现；评测 Agent 列为后期扩展。

固定节奏：文档讲解 → 阅读、提问与复述 → 指导用户编写 → 运行验证与代码检查。每轮只推进一个小步骤。
