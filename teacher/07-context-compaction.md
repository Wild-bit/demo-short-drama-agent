# 第七课：各家 Agent Harness 怎样处理上下文膨胀

本课先读公开实现，再给短剧工坊设计一套可验证的上下文装配流程。第六课负责同一 `sessionId` 下的历史读写。本课的目标是让用户持续在这个会话里聊，每次模型请求都落在预算内，后续任务还能查到准确的旧信息。以下是课程设计和源码阅读笔记，项目实现与验证将在动手阶段记录。

## 1. 先弄清楚什么在增长

Agent Loop 每次调用模型都要组装输入。即使用户只发了一句话，模型仍可能先搜索素材、读取结果，再回答。把完整历史传给每次请求时，系统规则、工具定义、旧交互和刚返回的工具结果都会占窗口。一次大查询也能比许多轮简短问答更占空间，所以只数轮数不足以控制输入。

| 数据 | 保存什么 | 怎样使用 |
|---|---|---|
| 会话记录 | 用户、助手、工具的原始消息 | 用户查看历史，服务端按需回查 |
| 素材与候选 | 素材库保存当前用户的资产。当时展示的候选顺序、用户随后选了哪张，从这段会话的记录取证 | 按会话找回当时的选择，再按用户归属查询素材。项目级的分镜版本与已确认选择在第十课接入 |
| 本次模型输入 | 系统规则、工具声明、近期交互、本轮消息、需要的摘要与资料 | Harness 在每次请求前按预算装配 |

同一个会话可以多次更换模型的工作上下文。用户无需为了腾出窗口而创建新会话。摘要可以帮模型接续话题，但精确的 ID、顺序、版本或用户确认，应从能核对的记录读取。找不到旧细节时明确说明缺什么，并请用户确认。

**主动新建会话**和**自动压缩**是两个独立操作。用户点「新建对话」会得到新的 `sessionId`，历史和摘要都从空开始。同一用户仍能搜索自己的素材库。自动压缩沿用原 `sessionId`，原对话仍可查看，变化的是下次请求携带的内容。第七课可用两个会话接口请求演示这一区别，页面按钮留给第十课。

## 2. 公开实现对照

读每一家的资料时追踪四个问题：谁决定本轮放什么、什么时候触发压缩、保留了什么、细节能否回查。以下区分开源运行时、上层编排器和模型 API 的职责。

### Multica：把任务交给运行时，缺什么就按需读取

Multica 的 daemon 组装任务和本轮动态信息。源码把本轮才变化的内容追加到 prompt 后部，减少已有会话前缀发生变化。对于支持回查的聊天入口，它提供触发消息和线程读取方式，Agent 在需要时再取具体线程。恢复中的会话能否提供足够新鲜的历史，也影响它给 Agent 哪种读取提示。[Multica 的 `prompt.go`](https://github.com/multica-ai/multica/blob/main/server/internal/daemon/prompt.go)

Multica 可以恢复底层 runtime 的会话，不同 runtime 的会话协议与支持能力不同。要判断恢复的会话具体怎样压缩，还需要读 Codex、Claude Code 或 DeepSeek Harness 等对应运行时的实现。这里最值得借鉴的是把可按 ID 查到的资料留在数据源，按任务需要加载。[Multica CLI 与 daemon 文档](https://github.com/multica-ai/multica/blob/main/CLI_AND_DAEMON.md)

### DeepSeek Harness：先处理工具大输出，再摘要旧历史

DeepSeek Harness 分别组织系统提示词片段、动态上下文和本次可见的工具定义。动态上下文有独立来源，运行时可在变化后或压缩移除旧快照后重新提供。[System Prompt Assembly](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/system-prompt.md)

启用自动压缩后，`agent/pre-step` 在请求组装前按实际路由模型测量上下文压力。达到阈值时，可以先调用工具结果裁剪插件，再选较早的一段可完整切分的历史做摘要，近期历史保持原文。插件裁剪长文本时可保留开头和结尾，并留下裁剪标记与原事件引用；压缩后的结果用于以后发给模型，原始结果保存在会话日志中。供应商确认发生上下文溢出时，框架还有更积极的压缩路径，只有上下文确实更新后才允许重试。[基本压缩模块](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-basic/README.md) · [工具结果裁剪插件](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/compaction/compaction-tool-result-pruner/README.md) · [压缩事件与检查点](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/compaction.md)

### OpenAI Codex 与 Responses API：Harness 维护预算，服务端可生成压缩项

Codex 将系统或开发者指令、工具定义、工作环境与对话一起组装，并尽量保持稳定前缀。开源运行时包含自动压缩阈值，以及根据运行时能力选择的压缩路径。[Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/) · [Codex 的运行代码](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/turn.rs)

Responses API 支持由服务器生成压缩项。独立压缩端点返回一个可用于下一次请求的完整替换窗口，其中可能既有保留的原消息，也有不透明的压缩项。调用方按 API 约定继续传递。这个例子说明 Harness 可负责预算、触发和接续，压缩表示也可以由供应商产生。公开资料可以核实 Codex 与 Responses API 的行为。ChatGPT 产品内部具体怎样组装提示词，仍缺少公开依据。[OpenAI Responses 压缩文档](https://developers.openai.com/api/docs/guides/compaction)

### OpenCode：摘要检查点加近期对话

OpenCode 的文本路径用结构化摘要加预算内的近期对话组成检查点，再接上后续消息。摘要模板要求保留准确的路径、命令、错误与标识符，因为这些值可能是下一次操作的输入。实现还区分自动阈值、显式压缩和已溢出的情况，并针对支持的模型提供原生压缩路径。[OpenCode 的 `compaction.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/session/compaction.ts)

### Anthropic Claude Code / Claude API：工具结果裁剪与摘要分别处理

Claude Code 在接近上下文容量时自动压缩，也提供 `/compact` 手动指定保留重点。Claude API 另有工具结果裁剪和摘要两种机制。裁剪可以把较早的工具结果正文换成占位信息，近期结果仍可用；摘要则可压缩旧对话，并按所选协议保留近期交互。Claude Code 是产品层的例子，Claude API 文档描述的是应用开发者能调用的能力。[Claude Code 会话命令](https://code.claude.com/docs/en/claude-code-on-the-web) · [Claude API 工具上下文](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context) · [Claude API 压缩](https://platform.claude.com/docs/en/build-with-claude/compaction)

### LangChain Deep Agents：大内容卸载到可读存储

Deep Agents 提供文件读写工具，把大段内容放到可按需读取的文件或其他存储后端，并在对话变长时对旧消息做摘要。这个做法适合原文还会被用到、但每轮只需要其中一小部分的情况。[Deep Agents 上下文管理](https://docs.langchain.com/oss/javascript/deepagents/overview)

### 这些做法解决的是不同问题

- **用引用替代原文**。先传线程 ID、资产 ID 或文件位置，有需要时加载具体内容。
- **裁剪工具结果和旧历史**。按确定规则缩小输入，适合可重新获取或可安全省略的资料。
- **摘要与压缩项**。给旧交互创建检查点，让模型在更小的窗口里继续当前任务。摘要可能漏掉精确细节，遇到依赖原值的决策就回查。
- **前缀缓存**。相同的系统规则、工具定义和历史前缀有机会避免重复处理，降低时间或费用。缓存中的内容仍占上下文窗口，窗口容量用裁剪或压缩控制。[Codex 的 prompt 缓存说明](https://openai.com/index/unrolling-the-codex-agent-loop/) · [Claude 的工具上下文说明](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context)

## 3. 短剧工坊的第七课怎么写

以 DeepSeek Harness 的「测量 → 裁剪 → 摘要」为主，借鉴 Multica 的按需回查、OpenCode 的检查点以及 Codex 的稳定前缀。继续使用当前文本 Gateway 和 MySQL，在 `src/harness/agent/` 内实现，沿用第六课把 `history` 和 `newMessages` 分开的边界。

```text
当前会话的 MySQL 历史 + 按需读取的用户素材 + 本轮新增消息
  → Harness 在每次模型请求前测量预算、挑选并压缩内容
  → 装配 messages 与 tools，交给 Gateway 转换协议并发送
  → 工具结果和模型回复进入本轮原始记录，下一次请求重新检查预算
```

| 小步 | 亲手实现 | 验收证据 |
|---|---|---|
| 7.1 测量输入 | 在 `context.ts` 组装模型输入。先用 JSON 的 UTF-8 字节数定位增长，再与供应商返回的输入 token 用量对照 | 能指出工具返回前后是哪部分增长，并解释请求字节数与模型 token 用量各自怎么得到 |
| 7.2 精简工具结果 | 将素材搜索候选共有的标签提到 `sharedTags`，保留候选顺序、ID、名称、类型、描述与各自的其他标签 | 普通输入无需额外模型请求。工具消息的 `toolCallId` 与原调用仍对应，原始消息未被改写 |
| 7.3 按预算选近期交互 | 先计入系统规则、工具声明、输出预留和安全余量，再给本轮消息和必要的业务记录留空间。剩余预算从新到旧选择完整交互，输出时恢复时间正序 | 同一组调用与结果一起保留或一起移出。刚产生的工具结果塞满窗口时，用更小的投影、按页回查或返回可处理的超限错误 |
| 7.4 给旧历史做摘要检查点 | 在 `compaction.ts` 为已经结束的旧交互生成小摘要，记录 `sessionId` 和被覆盖到的 `sequence`，以便后续从检查点接续。摘要另存，保留上一份有效检查点直到新摘要通过校验 | 摘要内容、覆盖范围和旧消息可核对。摘要失败或体积未减少时，旧检查点仍可用；额外模型调用单独记入用量 |
| 7.5 按需回查与长会话验证 | 去 MySQL 加载相关会话消息或业务记录，补回必要的精确数据。用同一 `sessionId` 跨多个压缩周期反复追问 | 对比压缩前后的模型输入预算、素材 ID、用户确认的限制与工具配对，验证会话可持续使用 |

预算要覆盖实际送给供应商的消息结构和工具声明开销。先从「窗口容量减去生成空间和安全余量」得到输入预算，再计算历史能占多少。课程用较小的可配置预算触发裁剪，便于复现，无需凑很多轮对话。原始记录、摘要和业务资料各自保留来源，摘要和工具文本以资料身份进入上下文，权限与确认仍由服务端校验。

### 一次搜索需要检查几次预算？

以一个 **16,000 token 的教学窗口**为例，给回复留 2,000，给估算误差留 1,000，可发送的输入上限就是 13,000。系统规则、工具声明以及请求包装都算在输入内。下面数字只用于手算练习。

| 同一个用户轮次 | 预计输入 | Harness 的动作 |
|---|---:|---|
| 第一次调用，用户说「搜索墨墨」 | 9,000 | 可以发送。模型要求调用搜索工具 |
| 第二次调用前，加上工具请求和完整结果 | 15,000 | 先精简搜索结果，再重新测量 |
| 第二次调用，保留候选 ID、顺序和必要描述 | 11,000 | 可以发送。模型根据候选回答用户 |

若固定指令、工具声明和当前用户输入本身就放不下，压缩旧历史也腾不出足够空间。此时结束本次运行，告知需要拆分的输入。摘要调用本身也有预算，旧历史应按完整交互分批处理。每次实际发送前重新计数，记录压缩前后估值及可用的实际用量。

用户看到的上下文占用百分比也可以随压缩下降。原聊天记录仍在，新的工作窗口只装入接续任务所需的内容。教学观测优先展示「本次预计输入 / 本次输入预算」，同时单列累计用量。不同界面的百分比取决于各自的分母、取整和刷新时机，看到 0% 也无法推断摘要或系统指令已被清空。

### 怎样验证第二次压缩还能接上？

假设首次检查点覆盖本会话的 `sequence` 1–20，之后保留 21–30 的原文。下一次压缩到 30 时，从旧摘要和 21–30 的完整交互生成新摘要。确认范围连续、末尾工具调用均已收到结果、压缩后输入确实变短，再原子更新检查点。写入时比较旧覆盖序号，避免迟到的结果覆盖较新的进度。失败时沿用有效检查点，重算后的请求仍须满足预算。新会话即使也有序号 1–30，加载时也只查询属于当前用户和当前会话的检查点。

## 4. 贯穿示例：「用刚才第三张墨墨素材」

用户先搜索墨墨，系统向用户展示六个候选。随后对话继续，旧工具结果达到裁剪阈值。下一次用户说「用刚才第三张当参考」，Harness 需要用**当时实际展示的候选顺序**来解析引用。数据库当前排序或搜索工具原始顺序可能与当时展示的顺序不同。

只留下「搜到六张图」不足以续接。课程示例要把展示顺序与对应的 `assetId` 一起保留或回查，比如「候选 3 对应 `asset_3`」，具体标签和长描述可以到需要时按 ID 加载。本课可用已归档的助手回答（含有序名称和 ID）与用户确认原话还原选择。第十课再把确认采用的素材写入项目，使同一项目里的新对话也能使用。找不到当时展示的顺序，也没有明确选中记录时，请用户确认具体是哪张。

最后用固定消息和工具结果比较以下情况：

1. **压缩前后行为一致**。都能找到同一个 `assetId`，并遵守用户已确认的创作要求。
2. **候选顺序有差异**。把工具结果故意做成与用户可见列表不同的顺序，验证依据的是可见列表。
3. **旧信息缺失**。摘要只有「搜索过墨墨」时，回查能补回对应记录；查不到时请求确认。
4. **一轮产生多个工具结果**。压缩后没有孤立的结果消息、缺失的调用 ID 或乱序。
5. **输入过大或摘要失败**。每轮输入落在预算内，无法缩小时给出可处理的错误。原始历史不变，摘要的额外调用与用量可追踪。
6. **同会话延续与新会话隔离**。让 A 连续触发两次压缩，重载检查点后追问仍命中同一个素材。在新会话 B 直接问「刚才第三张」应请求澄清。B 主动搜索墨墨仍能查到个人素材。

第七课的过关证据包括两部分：能解释各家 Harness 在哪一层处理膨胀，以及能用同一个会话证明输入变短后仍能继续准确做事。

## 5. 7.1 动手第一步：观察工具结果让输入长了多少

新建会话后发「搜索墨墨」。第一次请求携带系统规则、这句用户消息和工具定义。模型要求调用搜索工具后，Harness 把工具调用和结果追加到 `newMessages`。第二次请求带着这组新增消息，让模型能根据结果作答。虽然始终是同一条用户请求，两次模型输入已经不同。

用仓库当前的系统提示词和搜索工具定义，以一条固定的素材结果跑了本地示例。两次模型输入的体积分别如下，单位均为 UTF-8 字节。

| 输入部分 | 第一次 | 第二次 |
|---|---:|---:|
| 系统规则 | 1,279 | 1,279 |
| 旧历史（空数组） | 2 | 2 |
| 本轮消息 | 42 | 284 |
| 工具定义 | 571 | 571 |
| 完整内部请求 | 1,915 | 2,157 |

这次增加了 242 字节，全部来自本轮消息里的工具调用和结果。完整内部请求按 `{ messages, tools }` 单独序列化。各部分单独量时也会算上自己的 JSON 括号，因此分项大小用于定位变化，总量以完整对象为准。字节数取决于序列化内容，模型输入 token 取决于供应商的分词和协议处理。这里先观察增长，接下来再采集模型用量。

### 在 `src/harness/agent/context.ts` 组装并测量

```ts
import type { TextGenerationRequest, TextMessage } from "@/gateway/text/types";
import type { ToolDefinition } from "@/tools/types";
import type { SessionMessagePayload } from "../types";

/** 计算数据序列化为 JSON 后的 UTF-8 字节数。 */
function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** 组装一次模型请求，并测量各部分的体积。 */
export function buildModelInput(
  systemPrompt: string,
  history: readonly SessionMessagePayload[],
  currentTurn: readonly SessionMessagePayload[],
  tools: ToolDefinition[],
) {
  const systemMessage: TextMessage = { role: "system", content: systemPrompt };
  const request: TextGenerationRequest = {
    messages: [systemMessage, ...history, ...currentTurn],
    tools,
  };

  return {
    request,
    inputSizes: {
      systemBytes: jsonBytes(systemMessage),
      historyBytes: jsonBytes(history),
      currentTurnBytes: jsonBytes(currentTurn),
      toolDefinitionsBytes: jsonBytes(tools),
      requestBytes: jsonBytes(request),
    },
  };
}
```

### 在 `AgentService.runWithHistory` 里记录每次调用

从 `@nestjs/common` 导入 `Logger`，从 `./context` 导入 `buildModelInput`。原先用于本地组装 `messages` 的 `TextMessage` 类型导入可移到新文件。给 `AgentService` 增加以下字段。

```ts
private readonly logger = new Logger(AgentService.name);
```

把循环开头从创建 `messages` 到调用 Gateway 的部分替换为以下代码。其余代码继续把工具调用和结果追加到 `newMessages`，下一次循环就能测到变化。

```ts
const tools = this.toolRegistry.getDefinitions();
const { request, inputSizes } = buildModelInput(
  agentSystemPrompt,
  history,
  newMessages,
  tools,
);

modelCallCount += 1;
this.logger.log({
  event: "model_input_measured",
  modelCallNumber: modelCallCount,
  ...inputSizes,
});
const response = await generateDeepSeekText(request);
```

验收时在新会话提交「从我的素材库搜索墨墨，告诉我找到了哪些候选」。查看两条 `model_input_measured` 日志，核对 `modelCallNumber` 为 1 和 2，第二条的 `currentTurnBytes` 和 `requestBytes` 更大。日志只包含调用编号和计数。实测素材的描述、标签和 ID 会影响字节数。

接着在同一个会话发「刚才第三张叫什么？直接根据上次回答」。上一轮已保存的消息现在通过 `history` 进入请求，`historyBytes` 会大于空数组的 2 字节。`modelCallNumber` 从 1 重新计数，因为这是一次新的 Agent 执行。

当前项目代码已接入 `buildModelInput` 和日志，类型检查通过。用固定的模型和工具响应直接调用 `AgentService`，两次模型输入分别为 1,915 和 2,157 字节，工具调用和结果仍按同一个 ID 配对。把上一轮新增消息作为第二轮的历史传入后，首条日志的 `historyBytes` 从 2 升到 358，`modelCallNumber` 重新从 1 计数。这次验证覆盖 Agent 与 Gateway 的请求组装，模型响应由测试提供。

## 6. 7.1 动手第二步：从 Gateway 读回实际 token

假设「搜索墨墨」的第一次调用在发送前测得 1,915 字节。DeepSeek 回来时，响应里的 `usage` 记录了供应商实际统计的 token。比如模拟响应为 `{"prompt_tokens":480,"completion_tokens":20,"total_tokens":500}`。Gateway 把它转换成 `inputTokens: 480`、`outputTokens: 20`、`totalTokens: 500`。第二次请求带上工具结果，收到自己的 `usage`。这两个响应分别提供各自的用量，字节数仍负责定位输入里的哪一部分在增长。[DeepSeek Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)

在 `src/gateway/text/types.ts` 更新整个结果类型。

```ts
export type TextGenerationResult = {
  text: string;
  toolCalls: ToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};
```

在 `src/gateway/text/deepseek.ts` 的 `DeepSeekResponse` 内，与 `choices` 同级添加原始响应用量。

```ts
usage?: {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
} | null;
```

在 `generateDeepSeekText` 末尾，用以下代码替换原先的 `return { text, toolCalls };`。缺少 `usage` 时保留原结果，用量未知和实际为零可以分别表示。

```ts
const usage = response?.usage;
if (!usage) {
  return { text, toolCalls };
}

return {
  text,
  toolCalls,
  usage: {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  },
};
```

本小步验收 Gateway 的转换。用提供 `usage` 的模拟响应检查三个值，再用省略 `usage` 的模拟响应确认文本和工具请求仍可读取。下一小步在 Agent 调用返回后将同一次调用的字节数与实际用量一起记录。

Gateway 的改动已通过类型检查和固定响应验证。有用量时映射为输入 480、输出 20、合计 500。省略用量时，工具调用仍完整返回。

### 把同一次调用的字节数和 token 对在一起

请求发送前，`inputSizes` 已经算出来。等待 `generateDeepSeekText(request)` 返回后，手上又多了同一次请求的 `response.usage`。当前实现将两组数据写在同一条日志里。缺少用量时日志省略 token 字段。

```ts
modelCallCount += 1;
const response = await generateDeepSeekText(request);
this.logger.log({
  event: "model_input_measured",
  modelCallNumber: modelCallCount,
  ...inputSizes,
  ...response.usage,
});
```

7.1 已通过类型检查和固定模型响应验证。模拟「搜索墨墨」时，两次调用分别记录 1,915 字节和 480 输入 token、2,157 字节和 550 输入 token。模拟追问的响应省略了 `usage`，日志仍有字节数，追问仍能正常完成。token 数字来自测试设定的响应。7.2 将用同样的方法对比素材搜索完整结果与精简结果的体积。

## 7. 7.2 精简素材搜索的工具结果

假设「搜索墨墨」返回探头、招手、思考三张图。每张都有「墨墨」「角色设定参考图」「短剧工坊」三个标签，另外各有一个动作标签。以前模型会收到三份相同的标签。本步在发送给模型时，把共有标签提到结果顶部的 `sharedTags`，每张图自己的 `tags` 只存其余标签。第三张仍是思考，ID 仍是 `asset-3`，描述和标签内容也能查到。

`AgentService` 继续把工具返回的完整 JSON 存入本轮消息。每次构建模型输入时，`context.ts` 用 `toolCallId` 找出来自 `search_user_assets` 的工具消息，只在模型请求中替换消息内容。其他工具、结果格式未知或替换后没有缩小的情况，继续传原内容。

用三张固定素材和模拟模型响应验证。工具消息内容从 480 字节减到 399 字节，同一次模拟 DeepSeek 请求的完整 JSON 从 3,539 字节减到 3,448 字节。验证覆盖候选顺序和标签、调用与结果的配对、完整会话消息保留，以及下一轮加载历史时仍能精简。类型检查通过。本例记录的是字节数，实际 token 节省量可用 7.1 接入的供应商用量观察。

## 8. 7.3 按预算保留最近的完整对话

假设这个会话里有一段很长的早期对话，后来你搜索了墨墨，现在追问「刚才第三张叫什么」。在固定样例里，带上全部历史要占 2,793 个估算单位。把输入预算设为 700，去掉最老的两条消息后，请求估算为 621。最近那轮「搜索墨墨」的用户消息、模型工具调用、工具结果和模型回答一起保留。发出的顺序依然是系统规则、留下的历史和本轮追问。

`buildModelInput` 先精简本轮的工具结果，再给系统规则、工具定义和本轮消息计数。从最新历史往回读，每遇到一条用户消息，就拿到了这轮对话的边界。整轮能放下才加入请求。某轮超限时停止往前选，保留连续的近期历史。老消息只从当前模型请求里移出，MySQL 的完整记录可用于接下来的摘要和回查。

### 为什么按整轮移出？

「搜索墨墨」可以保存为四条消息。第 1 条是用户请求，第 2 条是助手提出搜索并分配调用 ID `search-1`，第 3 条是带同一 ID 的搜索结果，第 4 条是助手根据结果给出的回答。移出第 3 条后，1、2、4 的时间顺序依然正确，但请求里留下了一次没有对应结果的工具调用，助手回答也失去了原始搜索证据。只留下结果则无法根据调用 ID 找到它对应的请求。

调用与结果配对解决消息结构的问题。按完整用户轮次保留，还能保住用户需求和最终回答之间的关系。所以一轮已经结束的历史放不下时，四条一起移出，原文留在 MySQL。正在处理的本轮要保留工具结果供下一次模型调用使用，素材搜索结果过大时可以自动换成候选名单。

Gateway 先按 DeepSeek 的实际消息、工具声明结构编码，再用 JSON 的 UTF-8 字节数做保守估算。日志的 `estimatedInputTokens` 用于发送前判断，响应的 `inputTokens` 则是供应商报告的实际用量。前置估算的精度取决于内容和供应商的分词规则。

### 如何切换教学窗口和 DeepSeek 正常窗口？

窗口、输出上限和估算余量集中在 [DeepSeek 上下文配置](../src/config/deepseek-context.ts)。Harness 用这份配置计算输入预算，Gateway 用同一份配置设置 `max_tokens`。

| `AGENT_CONTEXT_PROFILE` | 窗口 | 单次输出上限 | 输入估算预算 |
| --- | ---: | ---: | ---: |
| `normal` | 1,048,576 | 16,384 | 1,031,168 |
| `lesson` | 16,000 | 1,024 | 13,952 |

`normal` 使用 `deepseek-flash` 的官方窗口，并显式设置 `max_tokens: 16384`，给较长的剧本和分镜留出输出空间。若省略 `max_tokens`，DeepSeek 非思考模式默认使用 8,192。DeepSeek 允许显式请求的单次输出最高为 393,216 token，仍受上下文总窗口约束。两个模式都预留 1,024 的估算余量。[DeepSeek 模型规格](https://api-docs.deepseek.com/api/list-models/) [Chat Completions 参数](https://api-docs.deepseek.com/api/create-chat-completion/)

配置中 `1,048,576` 来自 DeepSeek 官方规格。两个档位的 `max_tokens` 和教学窗口由项目设定。下面六个值也由项目设定，`normal` 和 `lesson` 共用。

| 常量 | 作用 |
| --- | --- |
| `CONTEXT_SAFETY_MARGIN_TOKENS = 1_024` | 计算输入预算时，除了给输出预留空间，再留这一份余量，给发送前的用量估算留出空间。 |
| `SUMMARY_SOURCE_MAX_CODE_UNITS = 400` | 控制**送去做摘要的材料**。每条旧用户消息或助手最终回答最多取开头 400 个 UTF-16 代码单元，限制摘要请求的大小。完整原话仍在 MySQL。 |
| `SUMMARY_MAX_BYTES = 900` | 控制**生成后的摘要正文**。摘要会在后续请求里复用，超过 900 个 UTF-8 字节时舍弃这份候选摘要，有旧摘要就沿用。 |
| `HISTORY_RECALL_MAX_QUERY_CODE_UNITS = 100` | 控制模型传给回查工具的查询词长度，最多 100 个 UTF-16 代码单元。 |
| `HISTORY_RECALL_MAX_BYTES = 1_800` | 单次回查成功结果序列化后的 UTF-8 字节上限，防止长原话占掉下一次模型调用太多输入空间。 |
| `HISTORY_RECALL_BUDGET_DIVISOR = 3` | 小窗口下进一步收紧回查结果。上限取 `1,800` 字节与 `floor(当前输入估算预算 / 3)` 的较小值。输入预算为 `4,452` 时，结果上限是 `1,484` 字节。 |

`400` 和 `100` 用的是 JavaScript 字符串的 `.length`，`900` 和 `1,800` 用的是 `Buffer.byteLength(..., "utf8")`。两种单位都用来控制数据大小。[代码：上下文配置](../src/config/deepseek-context.ts)

可以在 `.env` 中设置模式，或直接启动指定模式的 API 容器。

```sh
# 快速验证第七课
AGENT_CONTEXT_PROFILE=lesson docker compose up -d api

# 恢复 DeepSeek 正常窗口和输出上限
AGENT_CONTEXT_PROFILE=normal docker compose up -d api
```

教学模式可再用 `AGENT_CONTEXT_WINDOW_TOKENS` 覆盖窗口，比如设成 `6500` 更快触发摘要。兼容只设置旧窗口变量的用法，此时按教学模式处理。显式指定 `normal` 时忽略这个窗口覆盖值。两个变量都没设置时使用正常模式。修改 `.env` 后，用 `docker compose up -d api` 让 Compose 应用新的环境变量。

每次模型调用前都检查。若本轮的素材搜索完整结果太大，程序自动改发只含 ID、名称和类型的有序候选名单，沿用工具调用 ID，用户原请求继续执行。完整结果保存在本轮记录中，模型需要更具体的内容时可缩小查询范围。候选名单或其他必需内容仍超限时，服务端在发下一次模型请求前结束本轮，返回 HTTP 413 和错误码 `AGENT_INPUT_BUDGET_EXCEEDED`。成功调用的日志额外记录移出历史的消息条数。

五项预算回归覆盖整轮恰好装下、最近一轮超限时保持连续边界、固定输入超限、无法精简的工具结果被拦截，以及素材结果自动降级。固定响应测试中，素材搜索只执行了一次，第二次模型调用在 3,452 的预算内以 2,323 个估算单位发出，并按原顺序回答第三张。7.4 将处理已移出窗口的旧对话，把摘要保存为检查点。

## 9. 7.4 保存会话摘要检查点

假设「搜索墨墨」的完整一轮占了原始消息 1–4。之后一次调用因为上下文预算移出这一轮，`prepareHistorySummary` 才从这批旧消息里读取用户原话和助手最终回答，连同已有摘要单独交给 DeepSeek。第 1–4 条的原始消息都保存在 MySQL，包含第 2 条工具调用和第 3 条工具结果，可供排查原始调用。一次用户请求最多启动一次摘要调用，摘要请求也先检查输入预算。用量由 `context_summary_finished` 单独记录，运行结果可用 `summaryModelCallCount` 看这轮的摘要调用次数。

模型只生成摘要文字。程序根据输入批次计算 `coveredThroughSequence = 4`，确认新摘要更小并能放进请求后，才采用它。`SUMMARY_MAX_BYTES = 900` 是项目对摘要正文的 UTF-8 字节上限，防止每轮复用的摘要占掉太多空间。比如「墨墨」是 6 字节。候选摘要超过 900 字节会整份舍弃，已有检查点继续使用。下一次读取会话时，消息 1–4 不再作为普通历史发给模型，输入带上摘要以及预算允许的后续完整对话。[摘要阈值](../src/config/deepseek-context.ts)

新摘要生成并通过检查后，先放在本轮 Agent 的内存变量里，供正式回答使用。会话表的 `context_summary` 和 `context_summary_through_sequence` 保存已写入 MySQL 的最新检查点。正式回答成功后，`SessionService.appendMessages` 校验会话归属和原历史末序号，把新检查点和本轮新增消息放在同一事务里写入。摘要请求失败时可沿用已有检查点，正式回答成功后仍会把本轮消息入库。正式回答失败时，保存方法不会被调用，已经生成的新摘要也不会落库。迁移只增加上述两列，已有会话以空摘要和序号 0 开始。

用固定响应分别走了「摘要成功、正式回答失败」和「两次都成功」。前者调用保存方法 0 次，后者调用 1 次，并把覆盖到第 4 条的摘要和本轮新增的用户、助手两条消息一起交给保存方法。

## 10. 7.5 按用户实际看到的答案回查

同一次搜索里，工具原始顺序可以是「探头、招手、思考」，而助手当时展示的顺序是「思考、探头、招手」。你问「刚才第三张是哪张」时，应以用户看到的回答为准。

旧回答移出窗口后，Agent 可调用 `read_session_history`，用「墨墨」找到那轮对话。工具只返回用户提问和助手最终回答的原话及其 `sequence`，也就是示例中的第 1、4 条。在验证案例里，第 4 条原回答明确写着「第三张墨墨-招手（asset-b）」。服务端使用通过归属校验的当前会话历史，工具参数只有查询词和向前翻查的序号。没有匹配或原话超出工具返回预算时，工具明确返回原因，模型可请用户澄清。

### 第七课验收记录

- 类型检查、构建和 13 项自动化测试通过，覆盖正常模式恢复、预算边界、工具配对、素材结果自动降级、摘要失败降级与新会话隔离。
- 临时 API 走真实 HTTP、登录 Guard 与本地 MySQL，模型使用固定响应。检查点在两次压缩后从 0 推进到 4、10，第三次摘要失败后仍是 10。原消息 1–4 内容完整。
- 回查实际读到第 4 条助手回答，并在同一请求中返回预期 `asset-b`。新会话的模型请求未收到旧候选或回查工具，其他用户访问返回 404，测试数据已清理。

## 11. 完整走读与本次答疑

### 1. 先看同一个会话已有的数据

| 原始消息序号 | 内容 |
|---|---|
| 1 | 用户说「主角用墨墨，搜索三张备选并告诉我备选顺序」 |
| 2、3 | 助手请求搜索，工具按探头、招手、思考的顺序返回 |
| 4 | 助手实际给用户展示的顺序是思考、探头、招手，第三张是 `asset-b` |
| 5–9 | 用户又找角色和夜景的参考图。助手调用两个搜索工具，最后在第 9 条回答「角色用墨墨，场景用夜晚窗台」 |

假设之前已保存了一份覆盖到第 4 条的摘要，内容是「已确认主角是墨墨，用户看过三张参考图」。现在用户问「你当时列出来的第三张是哪张？」。服务端按当前用户和 `sessionId` 校验归属，从 `sessions` 拿到摘要文字和覆盖位置，从 `session_messages` 按序读到原始 1–9 条。本次追问先作为 `newMessages` 的第一条存在内存中。[代码：加载会话与历史](../src/harness/session/session.service.ts)

两个数据结构可以用第 4 条原话来理解：

```ts
type SessionHistoryEntry = {
  sequence: number;
  message: SessionMessagePayload;
};

type ContextCheckpoint = {
  coveredThroughSequence: number;
  text: string;
};
```

`SessionHistoryEntry` 对应一条原始消息，例子中的 `sequence: 4` 就是原回答的位置。`ContextCheckpoint` 包含摘要文字和它覆盖到的位置，`coveredThroughSequence: 4` 包含第 4 条。下一次组装输入从第 5 条开始选普通历史。数据库里的最新原始消息已经是第 9 条，所以本次新增消息从第 10 条编号。

### 2. 每次模型调用前先测量，再压缩

7.1 记录发出前的请求体积和 DeepSeek 响应中的实际 token 用量。Gateway 把供应商的 `prompt_tokens`、`completion_tokens`、`total_tokens` 映射成 `inputTokens`、`outputTokens`、`totalTokens`。响应缺少 `usage` 时，实际用量为空，发送前的预算判断照常执行。同一个用户轮次可以请求模型多次。模型发起搜索后，工具结果进入 `newMessages`，第二次请求会重新计算预算。

7.2 初步精简搜索结果，把共有标签提到 `sharedTags`。如果本轮结果仍太大，自动降级为保留顺序、ID、名称和类型的名单。模型仍收到配对的工具调用与结果，原始结果继续保存在本轮消息中。固定响应测试里只执行了一次搜索，第二次模型调用已在预算内。

7.3 先给系统规则、工具定义和本轮消息留空间，再放得下已有摘要时带上摘要，剩余空间给近期历史。倒着遇到 `role === "user"` 代表找到了这轮的开头，因此判断这轮能否**整体加入**。已经结束的轮次包含最终助手回答。如果搜索刚到工具结果，这轮还在处理，结果会供下一次模型调用使用。

```ts
if (message.role !== "user") {
  continue;
}
if (estimatedInputTokens + turnTokens > inputBudgetTokens) {
  break;
}
droppedHistoryMessages = index;
```

只移出工具结果会让助手的调用 ID 缺少对应结果。保留或移出整轮可以保住配对和原问答关系。走读可用 `lesson` 模式复现，默认输入预算为 13,952 个估算单位，来自 16,000 的应用窗口扣除 1,024 的输出预留和 1,024 的估算余量。这个发送前的字节估算和响应里的实际 token 是两项数据。[代码：请求组装和预算判断](../src/harness/agent/context.ts)

如果单条用户原文本身仍放不下，服务端会在首次模型请求前返回 `413`。循环中的后续请求也会检查，本轮必需的消息经过精简仍超限时，会在发出下一次模型请求前返回 `413`。针对单条原文太长的情况，工作台的约定是在失败消息下方显示「这次提交的原文太长，请拆成几段提交」，输入框保留原文供编辑。

### 3. 旧历史放不下时，程序怎样生成摘要

本例第 5–9 条的工具结果很长，整轮放不下，但旧摘要和新问题已经可以组装成一份可发送的请求。Harness 才尝试另发一次摘要请求。这里的「摘要模型」还是同一个 DeepSeek。摘要调用的系统指令是 `compaction.ts` 里的 `summaryInstruction`，资料包括旧摘要、第 5 条提问和第 9 条最终回答。DeepSeek 负责写文字，程序从已有原始消息算出新的覆盖位置 `9`。

如果这轮只到工具结果，还没有最终助手回答，就不把它算进摘要批次。摘要也要符合输入预算，返回的文字要非空、足够短，并能装进正式模型请求。下面是 Agent 的关键分支，保留了请求替换和失败后的执行顺序：

```ts
let input = assembleInput(liveHistory, activeCheckpoint);

// 准备好本轮可压缩的批次后
try {
  const { checkpoint } = await summarizeHistory(batch);
  if (checkpoint) {
    const updated = assembleInput(
      liveHistory.filter(({ sequence }) => sequence > checkpoint.coveredThroughSequence),
      checkpoint,
    );
    if (updated.inputSizes.summaryIncluded) {
      activeCheckpoint = checkpoint;
      input = updated;
    }
  }
} catch {
  this.logger.warn({ event: "context_summary_failed" });
}

const { request } = input;
const response = await generateDeepSeekText(request);
```

摘要请求如果超时或返回 503，代码进入 `catch`，继续用原先准备好的 `input` 做正式回答。正式回答若从旧摘要就能读到「主角是墨墨」，它可以直接写一句晚安台词。需要未放进去的细节时，可以走下一步的原话回查。[代码：摘要生成](../src/harness/agent/compaction.ts) · [代码：Agent 主循环](../src/harness/agent/agent.service.ts)

### 4. 回查细节时谁发起工具调用

本次问「第三张」，摘要只提供背景。模型可发送 `read_session_history` 调用请求，例如 `{"query":"备选顺序"}`。Harness 从本轮开始时已经读取的会话历史里查找，在正式请求没有直接携带的旧消息范围内匹配原话。这一步复用内存中的原始记录。回查结果包含第 1 条提问和第 4 条最终回答，下一次模型调用据此答出「墨墨-招手，asset-b」。第 3 条的工具原始顺序可用于排查；回答「你展示给我的第三张」时，以第 4 条展示顺序为准。找不到对应原话时，工具会返回原因，模型可请用户澄清。

有历史时，Harness 用 `withAdditionalTools` 在本轮的工具注册器中加入回查工具。这个注册器同时提供发给模型的工具声明，以及统一的 `execute` 入口。搜索素材和读历史都走 `execute`。回查工具读取的范围由 Harness 随每次模型请求更新。新会话没有历史，沿用基础注册器。[代码：本轮工具注册](../src/harness/agent/agent.service.ts) · [代码：工具注册器](../src/tools/tool-registry.service.ts)

#### 命中了旧对话，但原话超过回查上限怎么办？

假设那轮问答序列化后有 `2,000` 字节，当前回查上限是 `1,800` 字节。`read_session_history` 会舍弃这次的完整工具结果，只返回 `found: false`、`reason: "archived_turn_too_large"` 和 `nextBeforeSequence`。原话继续保存在 MySQL。`nextBeforeSequence` 是向更早的对话查找的游标，使用它会跳过这轮超长对话。[代码：回查上限分支](../src/harness/agent/history-recall.ts)

Harness 将这三个字段作为工具结果交给下一次模型调用。当前实现没有专门针对这个错误码自动截取原文、分段读取或重试。模型根据已有摘要、近期消息和工具结果决定下一步。已有信息足够时可以回答，缺少候选顺序时可以说「我没能核对当时的候选顺序，你还记得其中一个候选名称吗？」。这句是可能的回复，实际回答由模型决定。[代码：工具结果回传](../src/harness/agent/agent.service.ts) · [代码：模型提示词](../src/prompts/system/agent.ts)

指令告诉模型按什么原则做，例如 `summaryInstruction` 要求保留已确认的选择。模型工具提供可请求执行的动作，例如 `read_session_history` 能查找原话，具体查找由 Harness 执行。课堂也可把 `compaction.ts` 称为「内部压缩工具」，它由 Harness 根据预算主动运行。[代码：回查工具](../src/harness/agent/history-recall.ts)

### 5. 正式回答完成以后，才写入数据库

这次追问如果经历一次回查，会新增第 10 条用户提问、第 11 条助手工具调用、第 12 条工具结果和第 13 条最终回答。只需直接回答的请求则新增用户和助手两条。摘要可以先在本轮内存中使用，正式回答结束后 `SessionService.appendMessages` 才会把新摘要和本轮消息放在同一事务里写入。下一轮从 `sessions.context_summary` 和 `sessions.context_summary_through_sequence` 读取已保存的检查点。

`expectedLastSequence` 来自本轮开始时读到的原始历史末尾，本例是 `9`，即使旧摘要只覆盖到 `4`。保存时会锁定会话行，再核对历史末尾仍是 `9`。核对成功后才按 `lastSequence + index + 1` 生成新序号，发生冲突时本轮写入会失败。下一轮读取时，若摘要成功，普通历史从 `10` 开始筛选。若摘要失败、正式回答成功，普通历史仍从 `5` 开始筛选，此时数据库中可以已经有第 `13` 条原话。[代码：会话保存事务](../src/harness/session/session.service.ts)

| 摘要请求 | 正式回答 | 数据库结果 |
|---|---|---|
| 成功并采用新摘要 | 成功 | 在同一事务里追加本轮消息，并把检查点从 4 推进到 9 |
| 失败或摘要不合格 | 成功 | 追加本轮消息，使用原来的检查点 4 |
| 成功并采用新摘要 | 失败 | 保存方法不会被调用，继续使用原来的历史和检查点 |

用本节同一份固定数据重跑了摘要成功和返回 503 两条分支。两次都观察到一次摘要请求、两次正式模型调用，回查都取回第 1、4 条，并得到 `asset-b`。会话服务向保存方法传入的原历史末尾都是 9，随后新增 10–13。摘要成功时还传入覆盖到 9 的新检查点，失败时该参数为空。该走读用固定模型响应和保存方法替身验证调用顺序，真实 MySQL 的检查点验证记录见上一节。

## 12. 第七课掌握度评估

**总评 90/100，通过第七课的理解和代码走读检查。** 评分依据是本课讨论中的提问、复述和代码理解。独立实现能力没有单独考核。

| 内容 | 评分 | 依据 |
| --- | ---: | --- |
| 输入预算和输出上限 | 22/25 | 主动用 DeepSeek 官方规格核对代码，追问 `384K`、`8K` 和项目配置的区别，理解了调大输出上限怎样影响输入预算。 |
| 整轮保留、摘要与检查点 | 28/30 | 提出按完整旧轮次移出以保留工具配对。能用 `coveredThroughSequence = 4` 推出普通历史从第 5 条开始选，并追问摘要失败但正式回答成功时怎样保存。 |
| 历史回查与工具执行 | 28/30 | 发现回查原本绕过 `ToolRegistryService.execute()`，沿着超限分支确认工具返回结果、Harness 编排和模型决定下一步各自的职责。 |
| 独立推演新场景 | 12/15 | 能跟着墨墨案例完整走读。尚未单独验证换一组序号和预算后，能否独立推算模型收到的消息、摘要覆盖范围和失败时的数据库状态。 |
