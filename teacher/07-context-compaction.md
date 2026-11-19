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
| 7.2 精简工具结果 | 先给素材搜索做一版确定性字段挑选。保留候选顺序、素材 ID、名称、类型和本轮必要信息，完整 JSON 继续保存在原始历史 | 普通输入无需额外模型请求。工具消息的 `toolCallId` 与原调用仍对应，原始消息未被改写 |
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
