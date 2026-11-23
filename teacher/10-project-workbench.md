# 第十课　项目、会话与分镜工作台

## 10.1 创建项目，在同一项目里新开对话

本节把“打开哪部短剧”和“继续哪段聊天”分别落实到 `projectId` 和 `sessionId`。下面用同一账号创建的《墨墨开场》举例，P、A、B 代表服务端实际分配的三个 UUID。

| 用户动作 | 请求（省略统一前缀 `/api`） | 返回或写入 |
|---|---|---|
| 创建《墨墨开场》 | `POST /projects/create`，请求体为 `{"name":"墨墨开场"}` | 服务端从 Bearer Token 取得用户 ID，在 `projects` 写入项目并返回 P |
| 从项目列表重新打开作品 | `GET /projects/list`，再 `GET /projects/detail?projectId=P` | 列表按用户过滤。详情查询同时匹配用户和 P |
| 在项目中新开两次对话 | 两次 `POST /sessions/create`，请求体为 `{"projectId":"P"}` | 两条会话记录的 `project_id` 都是 P，返回的 `session_id` 分别为 A、B |
| 在 A 搜索墨墨 | `POST /sessions/stream`，提交 `{"sessionId":"A","message":...}` | 沿用第九课的流式接口，用户提问、工具调用、结果和最终回答都归 A |
| 打开侧栏，切回 A | `GET /sessions/list?projectId=P`，再 `GET /sessions/messages?projectId=P&sessionId=A` | 侧栏按置顶优先 + 最近更新排序列出 P 的会话，聊天栏显示 A 的用户提问、助手回答与结构化卡片 |
| 重命名 / 置顶 / 删除对话 | `POST /sessions/rename`、`POST /sessions/pin`、`POST /sessions/delete` | 均在请求体传 `projectId`、`sessionId`，校验归属后执行；运行中的对话禁止删除 |
| 删除项目 | `POST /projects/delete`，请求体为 `{"projectId":"P"}` | 单事务级联清理项目的分镜版本、生成确认、项目会话及消息，保留跨项目共享的个人资产 |

### 按一次请求走读代码

1. **谁拥有项目？** 创建请求只需要名称。`AuthGuard` 验证登录凭证，Controller 从 `@CurrentUserId()` 取得用户 ID，交给 `ProjectsService.createProject`。服务端将它写入 `projects.user_id`。重新打开 P 时，`getOwnedProject` 同时查询 `userId` 和 `projectId`，别人的项目和不存在的项目都返回 404。[项目入口](../src/projects/projects.controller.ts) · [项目服务](../src/projects/projects.service.ts)
2. **B 怎样关联 P？** 点击新建对话，`SessionController.createSession` 把用户 ID 和请求体里的可选 `projectId` 传给 `SessionService.create`。服务先在事务内读取并锁定当前用户的 P，再在同一事务插入 B。B 有自己的 ID，默认标题为「未命名对话」（首轮回答落库时自动截取首句前 20 字命名），摘要为空、覆盖序号为 0。不传 `projectId` 时创建独立会话，`project_id` 为 `NULL`。[会话入口](../src/harness/session/session.controller.ts) · [会话服务](../src/harness/session/session.service.ts)
3. **为什么 B 看不到 A？** 发消息时，`replyToMessage` 用当前用户和 B 查会话，从 B 的记录取摘要，并按 B 的 `sessionId` 查消息。模型第一次收到系统指令和 B 的本次提问。即使 A 已经搜索过墨墨，B 想用这张图仍需按本轮请求查询用户资产。两次查询可以返回同一个资产 ID，各自的工具执行记录归各自的会话。[上下文入口](../src/harness/session/session.service.ts) · [素材搜索工具](../src/tools/search-user-assets.tool.ts)
4. **切回 A 时为什么能看到第 1、4 条？** 假设一次搜索共保存四条消息，序号 1 是提问，2 是助手请求调用工具，3 是工具结果，4 是最终回答。`getProjectChatMessages` 校验用户、项目和会话后按序读取，向聊天栏返回 1 和 4，保留数据库中的原始序号。需要看这次搜索如何执行时，可以按第九课的 `runId` 查看 Trace。如果请求把另一个项目的会话 ID 拼到 P 下，即使两个项目都属于自己，也返回 404。[会话服务](../src/harness/session/session.service.ts)

### 本地运行验证

已在开发 MySQL 执行增量迁移。它创建 `projects` 表，给 `sessions` 增加可空的 `project_id` 以及用于侧栏查询的索引。表之间用标量列逻辑关联。[迁移文件](../src/database/migrations/1795404497188-AddProjects.ts)

HTTP 与 MySQL 联调用两个临时账号验证了项目创建和重开、项目列表隔离、跨用户和错配项目返回 404，以及独立会话继续发消息。测试还在 A 保存搜索记录和摘要，逐条比对 B 首次发送给模型的消息，在 B 再搜索时核对工具返回的资产 ID 和 Trace 的三步顺序。模型响应使用固定样例，以便重复检查相同条件。测试结束后清理临时数据。[10.1 集成测试](../tests/integration/project-sessions.test.mjs)

本节使用 HTTP 接口验收。后续 10.2 保存剧本和分镜版本，10.3 将项目列表、聊天栏和生成前确认接入工作台。生成前确认由用户选择本次使用的镜头版本、镜头范围和模型，第十一课接入实际视频任务。

## 10.2 从对话里的分镜建议到项目里的作品

用户在会话 A 说“给墨墨写一个三镜头开场”。收到回答后，你把第 2 镜的提示词改为“固定镜头，墨墨抬爪招手”，选了素材库中的参考图并点击保存。今天的后端支持这条链路，工作台按钮在 10.3 接入。

### 三个用户动作，数据分别写在哪里

| 用户动作 | 后端做什么 | 刷新后从哪里读取 |
|---|---|---|
| 要 Agent 给出分镜建议 | 项目会话本轮注册 `propose_storyboard`。工具校验剧本和有序镜头，整理为可编辑卡片。会话事务提交后，SSE 的 `completed.storyboardProposal` 携带卡片 | 回到 A，从历史里的助手消息取 `storyboardProposal`。此时项目版本仍是 0 |
| 编辑后点击保存 | 提交剧名、梗概、剧本文本和镜头数组。每镜保存场景、画面、对白、提示词和参考素材 ID。服务端检查归属，在事务内新增版本 1 | 打开工作台时从 `project_storyboard_versions` 取最新快照。可以先保存剧本，再补分镜 |
| 选择第 1、3 镜和模型，点击确认生成 | 工作台为这次点击分配 `confirmationId`，服务端保存版本、两个稳定镜头 ID 和模型 | 从 `project_generation_confirmations` 取确认，再按项目和版本读取当时的提示词。第十一课用这份确认创建实际任务 |

### 按一次保存走读代码

1. **建议怎么到工作台。** 工具的参数来自模型，`baseVersion` 来自服务端在本轮开始时读到的版本号。工具成功后只给模型返回简短回执，结构化卡片放在本轮最终回答上。普通 JSON 接口与 SSE 的完成事件都能取得卡片，重新打开 A 也能恢复。独立会话的工具列表沿用原配置。[建议工具](../src/tools/propose-storyboard.tool.ts) · [Agent Loop](../src/harness/agent/agent.service.ts)
2. **为什么要传 `expectedVersion`。** 页面打开空项目得到版本 0，就用 0 作为首次保存的条件。`saveVersion` 先锁住所属项目，读取最新版本再比较。两个标签页都基于版本 1 保存时，一个写入 2，另一个得到 409。页面应保留本地编辑，重新读取版本 2 让用户合并。以后端返回的新版本作为下次编辑起点。[保存与确认](../src/projects/storyboards.service.ts)
3. **镜头怎么移动。** 新镜头省略 `shotId`，服务端首次保存时分配 UUID。编辑、重排时将已有 ID 随镜头提交，数组位置表示播放顺序。项目当前版本中缺失或重复的 ID 会返回 400。素材引用保存 `assetIds`，服务端检查这些素材均属于当前用户；其他账户的素材不能写入作品。[分镜字段](../src/domain/storyboard.ts) · [版本实体](../src/projects/entities/storyboard-version.entity.ts)
4. **B 怎样修改其中一镜。** B 普通提问继续使用自己的对话历史。用户在工作台明确点选某镜后，聊天请求可额外携带 `selectedShot: { version, shotId }`。服务端按 B 所属项目取这一镜，将它随用户本条提问送给模型。返回的 `kind: "shot"` 卡片沿用该镜的 ID 和素材引用。工作台只替换该镜，再按卡片的 `baseVersion` 保存完整草案。整份新草案使用 `kind: "storyboard"`。[会话入口](../src/harness/session/session.controller.ts) · [上下文装配](../src/harness/agent/context.ts)
5. **版本改变后如何查原确认。** 假设版本 2 的第 1 镜已确认，之后将它移动并保存为版本 3。原确认仍记录版本 2 的镜头 ID，可以取回当时的画面和提示词。同一次网络重试复用原确认 ID，得到原记录。同一 ID 改用其他模型或范围会收到 409；为新版本确认时分配新的 ID。[确认实体](../src/projects/entities/generation-confirmation.entity.ts)

### 10.3 工作台接入的接口

全站业务接口统一只使用 `GET`（Query 传参）与 `POST`（JSON/FormData Body 传参），不在路径中嵌入动态 UUID，以下省略统一前缀 `/api`，身份由 Bearer Token 确定。

| 方法及路径 | 请求或响应 |
|---|---|
| `GET /storyboards/latest?projectId=P` | 最新的 `{ projectId, version, storyboard }`。空项目返回版本 0 和 `storyboard: null` |
| `POST /storyboards/save` | 提交 `{ projectId, expectedVersion, storyboard }`，返回服务端保存的新版本和完整作品，含各镜的稳定 ID |
| `GET /storyboards/version?projectId=P&version=V` | 按版本读取完整作品 |
| `POST /storyboards/confirm` | 提交 `{ projectId, confirmationId, version, shotIds, model }`，返回本次确认。请求重试沿用同一 `confirmationId` |
| `GET /storyboards/confirmations?projectId=P` | 列出项目已保存的所有生成确认记录 |
| `GET /storyboards/confirmation?projectId=P&confirmationId=C` | 读取单条确认记录；结合上面的历史版本接口还原当时的选择 |

### 后端验证与页面验收

已在开发 MySQL 执行新增两张表的迁移，并用真实 HTTP、MySQL 事务和固定模型响应验证 SSE 卡片、会话刷新、作品保存、单镜上下文、引用归属、并发冲突和确认重试。用例也检查了镜头重排、删除、新增及旧版可读。可在宿主机构建后复跑：

```sh
pnpm build
node --env-file=.env --test tests/integration/storyboard-versions.test.mjs
```

用户的手动验收留到 10.3。届时在浏览器中创建草案，给一镜选图，保存后刷新；随后另开对话修改选中的单镜，重排后核对参考图，再核对确认记录中的版本与提示词。[10.2 集成测试](../tests/integration/storyboard-versions.test.mjs)

## 10.3 在浏览器中验收项目、会话和作品

本地打开[短剧工坊](http://127.0.0.1:5173)，使用已有账号登录。Compose 的 `web` 服务提供 React + Vite 页面，将同源 `/api` 转发给 Nest。新环境先按项目 README 准备开发库、迁移和账号。在工程根目录执行 `pnpm docker:up` 启动服务。

### 用《墨墨开场》验收

| 在页面做什么 | 应看到什么 |
|---|---|
| 新建项目，输入“墨墨开场”，点击“创建并打开” | 进入项目工作台，编辑区显示版本 0。可直接填写剧本，也可在“创作对话”中新建会话 A |
| 在 A 发“给墨墨写一个三镜头开场，请给我可编辑的分镜草案” | 文字逐段出现，工具执行时显示进度。建议卡支持展开查看。点“采用到编辑区”后版本仍为 0 |
| 在其中一镜点“选择参考素材”，按名称搜索，选图后保存 | 版本加一。刷新仍能看到剧本、提示词和参考素材名称。重新排序后，参考图仍跟随原镜头 |
| 新建会话 B，切回 A | B 从空白对话开始，A 保留原回答和建议。工作台继续展示同一份作品。如果 A 还在回答，切到 B 后到达的 A 事件只更新 A |
| 在已保存的镜头上点“引用到对话”，再让 B 改成特写 | 输入框上方显示本次引用的镜头和版本，可在发送前取消。本轮成功后引用标记移到聊天记录。采用建议只更新该镜，点击保存写入下一版 |
| 点击“生成前确认”，选择镜头、核对提示词和模型后确认 | 出现确认记录。之后修改提示词再保存，打开旧确认仍能核对旧版提示词。真正的视频生成任务属于第十一课 |

可以用两个标签页检查并发。先同时打开同一版本，在两页分别修改，第一处保存后再保存第二处。后保存的标签页会提示服务器版本，并保留本地文字。点“载入最新版并保留本地副本”可以一边查看旧稿一边合并；再次保存才会写入数据库。当前标签页的未保存编辑按用户和项目暂存在 `sessionStorage`。

### 从一次操作读前端代码

1. 登录和打开项目由 [App.tsx](../web/src/App.tsx) 处理。地址中的项目 ID 支持刷新或在另一个标签页打开。`~web` 在 TypeScript 和 Vite 中都指向 `web/src`。界面 Logo 的文件是 `web/public/static/images/logo.svg`，页面使用 `/static/images/logo.svg`。
2. [Workspace.tsx](../web/src/components/Workspace.tsx) 管理服务器版本和正在编辑的副本。保存时携带 `expectedVersion`；采用卡片时检查 `baseVersion`，防止把旧建议直接套到新版。
3. [Chat.tsx](../web/src/components/Chat.tsx) 为每个打开过的会话维护独立输入框、消息和取消信号。[api.ts](../web/src/api.ts) 使用 `fetch` 提交 POST，使用 `eventsource-parser` 解析 SSE，按会话和运行 ID 校验归属。终态回答替换临时文本。输入超长、流内保存冲突和网络中断均在当前对话里显示，并保留本轮输入供修改。
4. [Editor.tsx](../web/src/components/Editor.tsx) 管理增删和重排。已有镜头沿用 `shotId`，新镜头的界面标识仅用于 React 渲染。重开时，参考图通过 `GET /api/assets/detail?assetId=...` 按当前用户读取；对话中搜索到的素材通过 `uiBlocks`（`asset_gallery`）渲染为可视化卡片网格。
5. [Confirmation.tsx](../web/src/components/Confirmation.tsx) 为一次提交分配确认 ID，网络结果未知时沿用原 ID。重新打开项目通过 `GET /api/storyboards/confirmations?projectId=...` 获取确认列表，再按记录里的版本查看当时的镜头。

### 运行验证

从工程根目录可复跑以下命令。浏览器测试需要本机 Chrome、开发 MySQL 和已应用的迁移。测试启动独立的 Vite、Nest 和浏览器会话，创建并清理自己的临时账号和项目，模型供应商响应由测试固定。

```sh
pnpm build
pnpm --dir web install --frozen-lockfile
pnpm --dir web build
pnpm --dir web test:browser
```

自动化场景见[浏览器验收用例](../web/tests/workbench.test.mjs)。在正式工作台发送对话时使用 API 服务已经配置的文本模型。
