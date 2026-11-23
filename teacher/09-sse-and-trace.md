# 第九课　让 Agent 边回答边展示，按运行查看 Trace

用户在会话 A 发「搜墨墨」。客户端能先看到工具开始搜索，随后看到「找到了」和「墨墨-招手」两段文字。开发者用这轮返回的 `runId` 可以查到两次模型调用、中间的一次工具执行和各自的耗时。第九课用终端观察这些事件，第十课的 Web 对话栏可以消费相同的数据。

## 1. 从一条请求开始读

| 顺序 | 在这个例子里发生了什么 | 从哪里读 |
|---|---|---|
| 1 | 客户端带 Bearer Token 提交消息。Controller 校验消息，在当前 HTTP 响应上发送 SSE。会话服务按认证用户校验会话归属，同时处理同一会话的请求会收到 409。 | [会话接口](../src/harness/session/session.controller.ts) |
| 2 | 会话服务向 `agent_run_records` 写入一条运行记录，得到 `runId`。第一个事件是 `started`。随后读出历史，把本次运行的 Trace 传给 Agent Loop。 | [会话服务](../src/harness/session/session.service.ts) |
| 3 | 第一次模型调用提出 `search_user_assets`。Gateway 按工具位置拼好名称和参数。Harness 对完整列表检查第八课的步数上限，执行搜索，把工具结果交回模型。 | [DeepSeek 流解析](../src/gateway/text/deepseek-stream.ts) · [Agent Loop](../src/harness/agent/agent.service.ts) |
| 4 | 第二次模型调用给出自然语言回答。每收到一段文字，Gateway 调用 `onTextDelta` 立即发出 `text_delta`，同时累计本次完整文本。Trace 记录模型用量和耗时。 | [DeepSeek Gateway](../src/gateway/text/deepseek.ts) · [运行步骤](../src/harness/trace/run-trace.ts) |
| 5 | 会话服务在同一事务里追加原始消息、更新已采用的摘要和运行终态。提交成功后才发送 `completed`。客户端用终态里的完整文本确认最终展示。 | [会话保存事务](../src/harness/session/session.service.ts) |

例如，搜索工具参数可能依次到达 `{"query":` 和 `"墨墨"}` 两段。程序收齐才能执行搜索。回答文字「找到了」本身就可展示，下一段「墨墨-招手」到来时直接追加。网络也可能在一个汉字的 UTF-8 字节中间切开，或一次传来多个 SSE 事件。Gateway 用 `TextDecoderStream` 将 UTF-8 字节增量解码成文本，再用 `eventsource-parser` 分出完整事件。收到一条事件即可读取它的 `data`。

### 沿着一次 POST 理解 response、signal 和 emit

用户提交「搜墨墨」时，Nest 通过 `@Res()` 将本次 POST 的响应对象交给 Controller，代码用 Node 的 `ServerResponse` 类型声明它。Controller 创建的 `send` 函数可以一直访问这个 `response`。把函数传给 `replyToMessage()` 时只是在传递发送能力，第一次调用它时才设置响应头、写入第一条 SSE 事件。[Controller 中的 send](../src/harness/session/session.controller.ts)

假设服务端正在等 `findOwnedSession()` 查询 MySQL，用户恰好点了停止。连接关闭触发 `abort.abort()`，同一个 `signal.aborted` 变成 `true`。查库返回后，`stream?.signal.throwIfAborted()` 立即抛出取消原因，因此本次请求在创建运行记录和调用模型之前结束。连接正常时，这行直接执行完，继续往下走。普通 JSON 会话接口也用这个方法，它省略 `stream`，所以 `?.` 会跳过这次检查。[会话归属检查与创建运行记录](../src/harness/session/session.service.ts)

查库成功且连接正常时，`agent_run_records` 先写一行 `running` 并取得本轮的 `runId`。随后创建的 `RunTrace` 实例持有内存中的步骤列表，以及一个可选的 `emit` 回调。这个回调已经记住本次的 `runId` 和 `sessionId`。因此 `trace.emit({ type: "started" })` 会调用 `stream.send(runId, sessionId, event)`，最终由 Controller 写入同一个响应。“记录步骤”和“把事件发给页面”是两次独立动作，发出 `text_delta` 也不会向数据库新增一行。[RunTrace](../src/harness/trace/run-trace.ts)

进入 `runWithHistory()` 时，`history` 是按序读取的原始消息，`previous` 是已保存的摘要文字和覆盖末条序号，首次对话时为 `undefined`。`trace` 供 Harness 记录步骤、传递取消信号和发布事件。`expectedLastSequence` 留在会话服务里，等 Agent 返回后再用于保存时的并发检查。

## 2. 客户端怎样显示同一条回答

| 收到的事件 | 客户端的动作 |
|---|---|
| `started` | 用 `sessionId` 定位会话，用 `runId` 关联这次请求的显示状态。同一会话的下一条提问会获得新的 `runId`。 |
| `step_started`、`step_finished` | 当 `step.kind === "tool"`，按 `step.toolCallId` 更新同一个工具进度，例如「正在搜索素材」。正式回答模型的步骤标为 `model`，上下文压缩中额外调用的模型标为 `summary`。 |
| `text_delta` | 将 `text` 追加到本次运行、当前 `modelCallNumber` 对应的助手草稿。模型连续返回两段文字时，更新同一条。 |
| `completed`、`stopped` | 取终态里的 `text` 作为本轮最终展示。达到工具上限时，`stopped.reason` 为 `tool_call_limit`。 |
| `failed` | 将已显示的草稿标为未完成，并显示本次错误。若已经收到文字后才发生保存冲突，这个事件会带 `statusCode: 409`。 |

本课用 POST 携带消息和认证头，响应类型是 `text/event-stream`。第十课页面可用 `fetch` 读取响应体。会话归属校验等开流前的错误照常使用 HTTP 状态码。流一旦开始，HTTP 响应头已经发出，运行失败通过事件传递。

### 问题一：保存时抛出 409，后端和页面分别在哪里处理？

联调测试让本轮先读到第 2 条消息。客户端收到第一段回答后，测试模拟另一个 API 实例写入第 3、4 条。保存时 `lastSequence = 4`、`expectedLastSequence = 2`，`appendMessages()` 抛出 `ConflictException`，本轮消息的事务回滚。`replyToMessage()` 的 `catch` 将运行记录更新为 `failed`，连接仍在时发送带有 `statusCode: 409` 和错误文字的 `failed` 事件。浏览器的 HTTP 状态仍是开流时的 200，因此页面既要检查 `response.ok`，也要处理流里的 `failed`，在当前回答旁展示错误。若同一 API 进程在开流前就发现这个会话正在处理另一条请求，Nest 可以直接返回 HTTP 409。[联调测试中的冲突案例](../tests/integration/session-stream.test.mjs)

### 问题二：为什么第一次发送事件时要写响应头？

第一次调用 `send()` 时，`writeHead()` 用 `Content-Type` 声明整个响应是 UTF-8 的 SSE 流。`Cache-Control` 要求缓存复用前重新验证，并禁止中间节点转换内容。`X-Accel-Buffering: no` 请求 Nginx 关闭代理缓冲，让小段文字尽早到达页面。之后每次 `send()` 都写入同一个响应体，所以只在 `!response.headersSent` 时写响应头。会话归属检查发生在第一次发送之前，此时仍可以正常返回 HTTP 404。

### 问题三：为什么先用 `JSON.stringify()`，再拼一条 SSE 事件？

`JSON.stringify({ sessionId, runId, ...event })` 把业务字段转成文本，放到 SSE 的 `data:` 行。`event:` 行给出事件名。两行之后的空行（`\n\n`）标记一条完整事件的结束。网络可能把一条事件拆成多块，也可能把几条一起送来。客户端的解析器读到空行就能交付事件，页面再用 `JSON.parse(frame.data)` 读取业务字段。[SSE 事件格式](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)

### 问题四：为什么 `write()` 返回 `false` 后要等 `drain`？

例如写第 10 帧时，`response.write()` 返回 `false`，表示 Node 已接收这一帧，后续写入应暂停。若重发第 10 帧，页面可能显示两次。代码等待本地响应流发出 `drain`，再继续写第 11 帧，以免慢连接使待发送数据持续占用内存。若此时用户关闭页面，`signal` 会取消等待。[Node.js 的 response.write](https://nodejs.org/api/http.html#responsewritechunk-encoding-callback)

### 浏览器怎样把两段文字显示在同一条消息里

浏览器读取 NestJS 发出的事件。收到 `event: text_delta` 时，解析器给出事件名 `frame.event` 和字符串 `frame.data`。对后者调用一次 `JSON.parse`，就能取到 `text`、`runId`、`modelCallNumber` 等业务字段。比如依次收到「找到了」和「墨墨-招手」，页面会先显示「找到了」，再更新为「找到了墨墨-招手」。`completed.text` 已经包含完整回答，最后赋值覆盖草稿即可。[解析库文档](https://github.com/rexxars/eventsource-parser#stream-usage)

下面是给第十课 Web 工程使用的 JavaScript 模块示例。`answer` 和 `status` 分别是本条助手消息的正文和状态 DOM 元素。每次发送消息创建独立的一组元素和一个 `AbortController`，将它的 `signal` 传给函数，用户点停止时调用 `controller.abort()`。

```js
import { EventSourceParserStream } from "eventsource-parser/stream";

async function displayReply({ sessionId, token, message, signal, answer, status }) {
  let runId;
  let modelCallNumber;
  status.textContent = "正在连接";
  try {
    const response = await fetch(`/api/sessions/stream`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, message }),
      signal,
    });
    if (!response.ok) throw new Error(`提交失败（HTTP ${response.status}）`);
    if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      throw new Error("未收到事件流");
    }
    const events = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new EventSourceParserStream());

    for await (const frame of events) {
      const data = JSON.parse(frame.data);
      switch (frame.event) {
        case "started":
          runId = data.runId;
          status.textContent = "正在处理";
          break;
        case "step_started":
          if (data.step.kind === "tool") status.textContent = `正在执行 ${data.step.name}`;
          break;
        case "text_delta":
          if (modelCallNumber !== data.modelCallNumber) {
            modelCallNumber = data.modelCallNumber;
            answer.textContent = "";
          }
          answer.textContent += data.text;
          status.textContent = "正在回答";
          break;
        case "completed":
        case "stopped":
          answer.textContent = data.text;
          status.textContent = frame.event === "completed" ? "已完成" : "已停止";
          return;
        case "failed":
          throw new Error(data.message);
      }
    }
    throw new Error("连接已结束，尚未收到运行终态");
  } catch (error) {
    status.textContent = signal?.aborted ? "已断开" : error.message;
    // 若已收到 started，保留 runId 供页面查询本次运行的最终状态。
    if (runId) status.dataset.runId = runId;
  }
}
```

本课的 HTTP 联调客户端使用相同的解码和解析方式。测试让供应商发出「找到了」后等待，客户端读到第一条文字事件才放行后续输出，用这个顺序验证页面能逐段更新。断流后若需核实状态，可以用已收到的 `runId` 查询 Trace。重新 POST 会开启另一轮运行。[联调客户端](../tests/integration/session-stream.test.mjs)

## 3. 数据库存什么，取消后去哪里查

`agent_run_records` 每次会话运行一行。开始时写入 `run_id`、`session_id`、`user_id` 和 `running`。执行中的步骤由本次请求持有，实时发给客户端；进入终态时统一保存到 `steps` JSON。模型步骤记录模型名、耗时和供应商返回的 token 用量，工具步骤记录工具名、调用 ID、耗时和执行状态。整轮耗时可由 `endedAt - createdAt` 得到。原始对话继续存在 `session_messages`。普通会话 JSON 接口也返回 `runId`，可用同一查询接口看 Trace。[运行实体](../src/harness/entities/agent-run-record.entity.ts)

如果用户在事务提交前断开连接，服务端向正在进行的模型请求传递取消信号，停止后续调用，将 Trace 标为 `cancelled`。此时客户端已经断开，可以用第一条事件的 `runId` 从查询接口确认状态。已经开始的本地素材查询可能先完成，Harness 会在下一步执行前检查取消信号。如果断开发生在数据库已经开始提交之后，查询接口会反映实际提交结果。

本课的运行记录没有进程崩溃后的自动恢复。若 API 进程被强制终止，开始时保存的记录可能停在 `running`。流中途断开且未收到终态时，客户端可以用运行查询接口核对。

## 4. 在终端观察

准备已登录用户的 `TOKEN` 和该用户的 `SESSION_ID`。下面两条命令依次提交消息、查询第一条事件给出的 `RUN_ID`。流式请求会使用本机 API 配置的模型。

```sh
curl -sS -N "http://localhost:3100/api/sessions/stream" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\",\"message\":\"从我的素材库搜索墨墨，告诉我找到了哪些候选。\"}"

curl -sS "http://localhost:3100/api/sessions/run?sessionId=$SESSION_ID&runId=$RUN_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## 5. 运行验收

本课自动验收使用本地固定响应替代 DeepSeek 在线服务。Nest HTTP、登录鉴权、素材搜索、TypeORM 事务与 MySQL 均实际运行。测试创建独立用户和会话，结束时清理自己的数据。

- **文字在完成前到达。** 测试供应商发出「找到了」后暂停。客户端已经收到这段文字，此时查询 Trace 是 `running`，会话新增消息数仍为 0。放行后收到第二段和终态，数据库中新增 4 条原始消息，Trace 顺序为模型、工具、模型。
- **会话与用户隔离。** 会话 A 等待第二段时，会话 B 可以完成。同一用户换错会话查询 Trace 和另一用户读取 Trace 都返回 404。
- **取消、超限与失败。** 取消后上游模型连接关闭，Trace 为 `cancelled`，会话可继续。模型在同一批请求 6 个工具时，Trace 为 `stopped`，实际执行工具 0 次。供应商返回 503 或保存时发现并发写入，流返回 `failed`。
- **网络分块与摘要。** 回归测试覆盖一个字节一块、多个事件合包、多个工具参数交错、上游缺少结束标记，以及摘要模型失败而正式回答成功时两个步骤各自的状态。[流解析回归](../tests/deepseek-stream.test.mjs) · [HTTP 与 MySQL 联调](../tests/integration/session-stream.test.mjs) · [摘要回归](../tests/context-compaction.test.mjs)

在项目根目录、开发库已执行迁移且安装了本地依赖时，可以重跑：

```sh
pnpm build
node --test tests/*.test.mjs
node --env-file=.env --test tests/integration/session-stream.test.mjs
```

## 6. 第九课掌握度评估

**代码走读掌握度复评为 86/100，初评为 84/100。** 两次评分都依据学习者自己的提问和复述，考察阅读现有代码并解释一次请求的能力。

| 内容 | 初评得分 | 初评依据 |
| --- | ---: | --- |
| 一次请求如何进入 Agent Loop | 28/30 | 能按顺序串起 POST、会话归属检查、创建运行记录、读取历史和摘要，再进入 `runWithHistory()`。需要进一步说准 `runId` 的范围，以及 `expectedLastSequence` 在保存时的用途。 |
| 运行轨迹与浏览器之间的关系 | 22/25 | 能从 Controller 传入的 `send` 推出 Agent 里的 `emit` 会把事件送回浏览器。下一步可独立说明哪一步记录在 `trace.steps`，何时写入 MySQL。 |
| Gateway 的流式输出与客户端渲染 | 20/25 | 能指出等 Gateway 拼完全文才返回会影响逐段展示。文本片段的即时回调、完整工具参数的拼接和客户端按空行解析事件，已在答疑中走读。 |
| 保存冲突、取消和背压 | 14/20 | 能定位保存时的冲突检查，追问谁处理 409，也找到了取消检查和等待 `drain` 的位置。这几条分支刚讲完，独立推演的表现仍待观察。 |

### 复评依据

- **运行轨迹与浏览器之间的关系，23/25（+1）。** 走读时主动对照了正常与异常分支，发现两处都给同一条运行记录的四个结束字段赋值。能从单行追到两个分支，是这次加分的依据。事务在何时把最终状态写入 MySQL，还可以结合 409 案例自己复述。
- **保存冲突、取消和背压，15/20（+1）。** 能预测收到首段文字后关页会中断请求，也能定位到取消信号。第一次作答把中断位置指向了查会话后的 `throwIfAborted()`。下次按时间顺序说明谁发出信号、哪个操作正等待信号、谁把已有运行记录改成 `cancelled`，就能讲清整条取消路径。
- 请求进入 Agent Loop 为 28/30，Gateway 与客户端渲染为 20/25，沿用初评。

### 保存冲突的四个自测问题

页面已经显示「找到了」，连接仍然正常。此时另一个 API 实例先保存了一轮，本轮执行到 `appendMessages()` 时发现历史序号变化。

| 自测问题 | 参考答案 |
| --- | --- |
| 浏览器看到的 HTTP 状态是什么？ | 200。第一条 SSE 事件发出时，响应头就已经确定。 |
| 页面接下来收到什么事件？ | 收到 `failed`，其中 `statusCode` 为 409，`message` 为「会话历史已更新，请重试」。页面据此把已显示的回答标为未完成。 |
| 用本轮的 `runId` 查询，会看到什么？ | `agent_run_records` 中这次运行的状态为 `failed`，原因记录了保存冲突。 |
| 本轮消息有没有写入会话历史？ | 没有。冲突检查发生在插入消息之前，事务回滚，`session_messages` 中保留另一个实例已提交的那一轮。 |

延伸练习：如果用户在收到第一段文字后主动关闭页面，此时事务尚未开始，运行记录的状态会有什么不同？

参考答案：此时已有一条 `running` 记录，查完会话后的 `stream?.signal.throwIfAborted()` 已经执行完。这行只检查执行当下的信号。用户关闭页面后，Controller 的 `close` 监听器调用 `abort.abort()`。如果 Gateway 正在等下一段文字，传入模型 HTTP 请求的取消信号会中断读取。异常传回 `replyToMessage()`，它在 `catch` 中根据 `signal.aborted` 把运行记录更新为 `cancelled`，原因是「客户端已断开」。页面已经关闭，本轮草稿未写入会话历史。联调用例在第一个 `text_delta` 时断开，随后用 `runId` 查到 `cancelled`，会话消息数仍是原来的 4 条。[取消用例](../tests/integration/session-stream.test.mjs)
