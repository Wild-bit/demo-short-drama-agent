# 一键短剧工坊

分享主题：**《一句话开拍，Agent 在幕后忙什么？》**  
副标题：用短剧工坊拆解 Agent Loop、上下文管理与 Harness

文本模型已选定 **DeepSeek**（已完成终端真实调用与 JSON 输出解析）。2026-11-02 讨论将 Seedance 2.5、Grok Imagine Video 1.5 作为可能同时使用的视频候选，具体接口与账户权限仍待核实。Gateway 先支持手动选择，再增加能力与预算规则路由；评测 Agent 留作后期扩展。详见[Gateway 讨论记录](./teacher/gateway-routing-discussion.md)。

## 当前状态

第十课已接通 Web 工作台。启动开发环境后打开[本地工作台](http://127.0.0.1:5173)，使用已有账号创建项目、编辑分镜、切换对话和确认镜头范围。首次运行需先完成数据库迁移和账号初始化。操作与验收见[第十课讲义](./teacher/10-project-workbench.md)。

## 协作方式

每课先由助手提交代码执行方案，用户审核通过后再编码。助手用实际运行结果走读关键代码、回答疑问，随后提炼分享材料。[逐课流程](./teacher/课程大纲.md#2-每一课怎样进行)

## 技术与范围

已确认采用 NestJS + TypeORM + MySQL + 腾讯云 COS，保留用户、项目与资产归属设计。业务接口使用单 Bearer Token 鉴权并核对资源归属。

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

## 素材上传和视频归档

按 `.env.example` 配置 `COS_BUCKET`、`COS_REGION`，将用于签发的专用 CAM 身份配置到 `COS_STS_SECRET_ID` 和 `COS_STS_SECRET_KEY`。服务端通过 `GetFederationToken` 获取有效期一小时的临时凭证，缓存到内存并在接近过期时重新申请。上传和清理对象均使用临时凭证。若使用 Compose，更新签发身份配置后重新创建 API 容器以加载环境变量。[腾讯云 STS](https://cloud.tencent.com/document/product/1312/48195)

CAM 身份需要 `sts:GetFederationToken` 及该桶 `short-drama/` 下的对应权限，申请临时凭证时同样限制到该前缀。简单上传使用 `PutObject`，分块上传使用 `InitiateMultipartUpload`、`ListMultipartUploads`、`ListParts`、`UploadPart` 和 `CompleteMultipartUpload`。用户上传后登记失败时，清理对应对象使用 `DeleteObject`。[腾讯云 COS 授权策略](https://cloud.tencent.com/document/product/436/31923)

登录后可发送 `multipart/form-data` 上传 JPEG、PNG、WebP 或 GIF，单张图片的大小限制是 20 MiB。

```bash
curl --fail-with-body http://127.0.0.1:3100/api/assets \
  --header "Authorization: Bearer $ASSET_API_TOKEN" \
  --form 'name=墨墨参考图' \
  --form 'file=@./墨墨.jpg'
```

接口在 COS 上传和 MySQL 登记成功后返回资产 `id`、`objectKey` 与固定 `url`。视频生成任务可调用 `AssetsService.archiveGeneratedVideo()`，传入可重新打开的视频流和任务分配的资产 ID。视频写入 `short-drama/videos/<assetId>.mp4`，超过 5 MiB 走分块上传。重复归档已登记的资产时返回同一条记录。
