# 第五课：手写 Agent Loop

编写日期：2026-11-12，更新日期：2026-11-13。消息类型、Gateway 转换、消息历史与一次工具反馈后的模型调用已实现并验证；真实请求已覆盖一轮内三次工具调用及空搜索结果。当前进入完整 Agent Loop 的编写，循环仍待实现和验证；模型调用次数上限作为可选运行策略，暂不加入本步示例。

## 1. 从第四课接过来

第四课已验证：用户要求搜索墨墨 → 模型返回正式工具调用 → 程序查询数据库 → 接口返回候选素材。

第四课结束时，`AgentService.runOnce` 把执行结果返回给 HTTP 调用方，到这里就结束。结果出现在接口响应里，不代表模型已经看到结果。第五课第 11 节已补上一次结果反馈，当前再将它扩展为完整循环。

第五课要让程序继续：保存模型发起的工具调用，追加对应的工具结果，把消息历史再次发送给模型。模型可能回答，也可能继续提出工具调用；程序根据响应和运行限制决定下一步。

本课最终要观察到多轮工具反馈后的模型调用，保留必要运行记录，并验证正常结束与消息配对。调用次数上限、取消和超时等运行策略另行补充。现在先学消息结构，每次只编写一个小步骤。

## 2. 当前小步要解决什么

扩展前，`src/gateway/text/types.ts` 中的 `TextMessage` 只有 `system`、`user`、`assistant` 三种角色和字符串 `content`，无法表达“模型要求调用什么”和“这条结果对应哪次调用”。

第一小步按 `role` 区分三类内部消息结构：

| 消息结构 | 需要的字段 | 在本项目中的含义 |
|----------|------------|------------------|
| 系统规则或用户输入 | `role: "system" \| "user"`、`content` | 给模型的规则或用户本次需求 |
| 模型消息 | `role: "assistant"`、`content`、可选的 `toolCalls: ToolCall[]` | 模型输出的文本，以及可能发起的工具调用 |
| 工具结果消息 | `role: "tool"`、`toolCallId`、`content` | 程序执行后提供的结果，关联到具体调用 |

这是本项目拟采用的内部契约；DeepSeek 接口的具体字段由 Gateway 转换。按角色区分字段的写法叫判别联合：通过 `role` 可以知道当前消息允许携带哪些字段。不要只给原来的大对象追加一堆可选字段，否则工具结果漏填调用 ID 也可能通过类型检查。

本步继续让内部 `content` 使用字符串。Gateway 目前已经把模型返回的空内容归一为 `""`；纯工具调用可以没有回答文本，不能只根据文本为空就丢弃这条模型消息。

## 3. 用一次墨墨搜索看消息往返

下面是拟采用的内部消息样例。调用 ID 和资产 ID 都是教学占位值，不代表新的真实运行结果；实际运行必须使用模型返回的 ID 和数据库查询结果。

第一次请求给模型：

```text
system：短剧助手的行为规则
user：请从我的素材库搜索墨墨，列出候选素材
```

模型返回一次调用后，程序先把它记录为 `assistant` 消息：

```ts
{
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id: "call_demo_1",
      name: "search_user_assets",
      arguments: '{"query":"墨墨"}',
    },
  ],
}
```

程序执行工具，再把结果记录为 `tool` 消息：

```ts
{
  role: "tool",
  toolCallId: "call_demo_1",
  content: JSON.stringify({
    assets: [{ id: "asset_demo_1", name: "墨墨·探头" }],
  }),
}
```

这里 `arguments` 是模型给出的参数字符串，执行前需要解析和检查；工具结果原本是对象，在构造本课的文本结果消息时使用 `JSON.stringify`。两者处于不同方向，不要把参数与结果混在一起。

第二次请求的历史顺序是：系统规则、用户需求、模型的工具调用消息、工具结果消息。模型看到这些记录后，才能基于真实搜索结果继续回答。DeepSeek 官方 Tool Calls 示例采用“追加模型消息 → 追加工具消息 → 再次调用”的过程，见文末来源。

工具结果属于程序提供的外部信息，使用 `tool` 角色；用户并没有亲口提交这份查询结果。保留角色也能让后续的上下文管理区分信息来源。

## 4. 为什么既需要工具名，又需要调用 ID

`name` 用来找实现：`search_user_assets` 对应哪个工具。

`id` 用来找这一次调用：同一个搜索工具可能先后搜索“墨墨”和“Aurora”，甚至在一次模型响应中出现多条调用。每条工具结果都要使用对应调用的 ID；工具名相同并不能区分不同请求。

示例中，模型调用的 `id` 与工具结果的 `toolCallId` 都是 `call_demo_1`。这个值来自模型响应，程序负责原样关联，不另造一个结果 ID 来替代它。

一次响应有多条调用时，先保存包含这些调用的模型消息，为各调用追加对应结果，再进行后续模型请求。本课先按顺序执行工具，不引入并行执行。

## 5. 消息类型与 Gateway 的分工

内部 `ToolCall` 已有 `id`、`name`、`arguments`，继续复用；内部字段采用现有的驼峰命名。

工具结果的关联字段采用 `toolCallId`，与现有 `ToolCall.id` 对应。它标识模型提出的一次工具调用，不表示工具已经执行成功。内部名称由项目约定；DeepSeek 协议使用 `tool_call_id`，在 Gateway 边界转换。

| 内部字段 | DeepSeek Chat Completions 字段 |
|----------|------------------------------|
| 模型消息的 `toolCalls` | `tool_calls`，每项包含 `id`、`type: "function"` 与 `function` 对象 |
| 调用的 `name`、`arguments` | 放入该项的 `function` 对象 |
| 工具消息的 `toolCallId` | `tool_call_id` |

出站转换实现前，`deepseek.ts` 直接发送 `messages: request.messages`。第二小步已改为逐条转换后发送；不能把内部驼峰字段直接当作接口字段发送。响应转换继续负责从接口字段得到内部 `ToolCall[]`。

当前项目显式关闭思考模式，本小步按这一配置讲解；以后若切换思考模式，需要重新核对其历史消息回传要求。

## 6. 已完成小步：扩展具名消息类型

本步只修改 `src/gateway/text/types.ts`：

1. 保留已有的 `ToolCall` 定义。
2. 把 `TextMessage` 调整为按角色区分的联合类型，表达第 2 节中的三类结构。
3. 保持 `TextGenerationRequest.messages` 使用 `TextMessage[]`，已有结果类型暂时保持原样。

类型定义不会自动保存历史或发起下一次请求。消息类型检查通过，只表示程序能够表达这些数据；实际反馈链路仍要经过后面的 Gateway 转换和运行逻辑才能验证。

编写后的验证目标：原有系统与用户消息仍可使用；模型消息可以携带调用列表；工具消息必须填写调用 ID；运行 `pnpm typecheck`。类型验证不需要请求真实模型。

实际检查记录：用户已定义 `TextInputMessage`、`TextAssistantMessage`、`TextToolResultMessage` 三个具名类型，并组合为 `TextMessage` 联合类型。工具调用列表在模型消息中可选，调用 ID 在工具结果消息中必填；`pnpm typecheck` 通过。此时 Gateway 仍直接发送内部消息，尚未验证消息转换。

## 7. 本步理解检查

请用自己的话解释：搜索工具已经返回了素材，为什么下一次模型请求还要同时带上“模型先前发起的工具调用”和“对应的工具结果”？`toolCallId` 在其中解决什么问题？

### 用户复述与检查结论（2026-11-12）

关于调用 ID，用户的理解是：

> 为了区分来自那个请求 相当于当次调用的请求ID

关于同时保留调用消息与结果消息，用户的理解是：

> 保留上下文并且标记这次的结果来源，让整个过程可追溯

上述理解正确。`assistant` 消息记录模型请求了什么工具、使用什么参数；`tool` 消息记录程序实际返回了什么；`toolCallId` 将结果关联到具体调用。同一个工具的多次调用需要分别关联，不能只靠工具名区分。

保留这些消息的直接用途，是让后续模型请求获得完整的调用与反馈上下文；它们也为执行追溯提供记录。完整追溯还需要工具名、参数、结果和执行状态等信息，不能只保存一个 ID。

检查结论：消息配对与调用 ID 的作用已理解，可以进入消息类型编写。此结论是概念理解确认，工具反馈后的实际模型调用仍待实现和验证。

Gateway 转换、消息追加和完整循环按后续小步推进，不一次性代写。

## 8. 本步问答：toolCallId 需要入库吗？

当前第五课不需要入库，先保存在本次运行的消息历史中，随工具调用消息与结果消息发送给模型，完成运行时配对。

以后如果需要重启后恢复会话，或长期查询历史执行过程，再把 `toolCallId` 随调用记录和结果一起持久化，无需为这个 ID 单独建立一张表。保存时还应保留工具名、参数、结果与执行状态等必要信息。

记忆存储与上下文加载是两个动作：即使记录已入库，程序仍需要读取相关内容并装入消息历史，模型才能在后续请求中看到。

命名结论：内部继续使用 `toolCallId`，与 `ToolCall.id` 对应；它标识一次工具调用，不代表执行成功。`toolRequestId` 也能表达请求关联，但本项目采用前者以保持类型与字段语义一致。

## 9. 已完成小步：Gateway 出站消息转换

### 为什么需要转换

内部消息类型已经能够表达调用与结果，但字段与 DeepSeek 的消息协议不同。原来的 `messages: request.messages` 会直接发送内部字段；改了类型并不会自动完成协议转换。

本步只修改 `src/gateway/text/deepseek.ts`，在请求发送前逐条转换消息。转换只改外部表示，不执行工具、不增加历史，也不发起额外的模型请求。

以调用 `call_demo_1` 为例，内部工具结果包含 `toolCallId: "call_demo_1"`；发送时使用 `tool_call_id: "call_demo_1"`，对应的调用 ID 和结果内容都保持原值。模型调用消息的 `toolCalls` 转为 `tool_calls`，名称与参数放入每项的 `function` 对象。普通系统、用户及模型文本消息继续携带原来的角色与内容。

### 编写指引：由用户操作

先在现有类型导入中加上 `TextMessage`：

```ts
import type {
  TextGenerationRequest,
  TextGenerationResult,
  TextMessage,
} from "./types";
```

在当前文件的 `generateDeepSeekText` 函数之前，添加一个本地转换函数：

```ts
function toDeepSeekMessage(message: TextMessage) {
  if (message.role === "tool") {
    return {
      role: message.role,
      content: message.content,
      tool_call_id: message.toolCallId,
    };
  }

  if (message.role === "assistant") {
    return {
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls?.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: call.arguments,
        },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}
```

再把请求体中的 `messages: request.messages` 替换为：

```ts
messages: request.messages.map(toDeepSeekMessage),
```

这里通过 `role` 缩小消息类型，只有 `tool` 分支才读取 `toolCallId`，只有 `assistant` 分支才读取 `toolCalls`。纯文本模型消息没有调用列表时，`tool_calls` 为 `undefined`，当前 HTTP 客户端的 JSON 序列化会省略该字段。`arguments` 已经是 JSON 字符串，转换时原样传递，不再次字符串化。

### 验证目标与边界

编写后先运行 `pnpm typecheck`。随后检查实际转换：普通消息保持角色和内容；模型调用正确生成 `tool_calls` 及嵌套结构；工具结果生成 `tool_call_id`；调用 ID、参数字符串和结果内容保持原值。转换后的消息不携带内部的 `toolCalls`、`toolCallId` 字段。

本步可以通过本地请求模拟检查发送内容，不调用真实模型。转换实现后，再推进消息历史追加与后续模型调用；当前不要把类型检查通过当作真实反馈循环已运行。

### 本步实际验证记录

用户已添加 `toDeepSeekMessage`，并使用 `request.messages.map(toDeepSeekMessage)` 构造请求消息。助手运行本地 TypeScript 编译器 `node node_modules/typescript/bin/tsc --noEmit`，结果通过，与项目 `typecheck` 脚本执行相同的类型检查。

随后在临时 Node 进程中替换 `fetch`，检查实际序列化请求体：系统与用户消息、纯文本模型消息、一次响应中的两条工具调用和对应结果均转换正确；调用 ID、参数字符串、结果内容保持原值；请求消息不含内部驼峰字段；原始消息数组未被修改。模拟响应中的调用 ID 也正确保留。上述验证没有真实网络调用，不代表真实反馈循环已运行。

## 10. 在一次运行内维护消息历史

### 目标与运行位置

现在 Gateway 能发送完整的工具消息，但 `AgentService.runOnce` 还只构造系统规则与用户需求，没有把本次响应和执行结果追加为后续模型可用的历史。

本步只修改 `src/harness/agent/agent.service.ts`。在方法内部维护 `TextMessage[]`，每次运行创建自己的数组，不放在服务实例字段上，避免不同请求混用历史。这是本次运行中的短期上下文，不引入数据库或跨请求会话存储。

本步完成后的顺序：系统规则 → 用户需求 → 模型消息（包含本轮调用列表）→ 对应的各条工具结果消息。先保留一条包含完整调用列表的模型消息，再按现有顺序执行工具、逐条追加结果。

### 编写指引：由用户操作

导入 `TextMessage`，将第一次模型请求中的消息数组提取为方法内变量：

```ts
const messages: TextMessage[] = [
  { role: "system", content: agentSystemPrompt },
  { role: "user", content: userRequest },
];

const response = await generateDeepSeekText({
  messages,
  tools: this.toolRegistry.getDefinitions(),
});
```

得到响应后，在工具执行循环之前，保存模型消息：

```ts
messages.push({
  role: "assistant",
  content: response.text,
  toolCalls: response.toolCalls,
});
```

在现有循环中，每次 `toolRegistry.execute` 成功后，追加对应结果：

```ts
messages.push({
  role: "tool",
  toolCallId: call.id,
  content: JSON.stringify(result),
});
```

现有 `toolResults` 继续用于本课 HTTP 返回，`messages` 用于模型历史：前者保存方便业务检查的对象，后者按消息角色组织，并把工具结果序列化成字符串。两者用途不同。

### 验证与下一步

编写后运行类型检查，并检查模型消息只追加一次、各结果的 ID 与对应调用一致、结果追加发生在工具成功执行之后。本步不增加真实模型请求，普通回答仍保存为一条模型消息，但不会产生工具结果消息。

本步先构造历史，下一小步再把该数组用于工具反馈后的模型调用，并检查实际发送顺序。不得仅凭内存数组已构造，就标记反馈循环已跑通。

### 代码检查与修正记录

首次检查时，用户已提取方法内的 `messages`，并追加工具结果，但模型消息的 `messages.push` 位于 `for (const call of response.toolCalls)` 内；一次响应有多条调用时，会重复追加包含完整调用列表的同一条模型消息。用户随后已将其移动到循环之前，每次模型响应只追加一次。普通回答没有工具调用时，也保存模型消息。

类型检查通过不代表消息顺序正确；后续已通过第 11 节的本地模拟与真实反馈请求验证修正后的行为。

## 11. 已完成小步：请求一次工具反馈后的模型响应

### 本步目标与范围

先修正第 10 节的追加位置：第一次模型请求完成后、工具循环开始之前，追加一次 `assistant` 消息。循环中只执行各工具、追加各自的 `tool` 消息并保留 `toolResults`。

本步继续修改 `src/harness/agent/agent.service.ts`，在所有工具结果追加完成后，用同一个 `messages` 再请求模型。第一次没有工具调用时，直接返回普通回答，不多请求一次。

这是一次反馈实验，最多请求模型两次。第二次响应可能直接回答，也可能提出更多调用；本步把第二次响应完整返回供观察，尚不自动执行其中的新调用。下一小步再引入完整循环。

### 编写指引：由用户操作

保留前面的首次请求及工具执行逻辑，把方法末尾原来的 `return` 替换为：

```ts
if (response.toolCalls.length === 0) {
  return {
    text: response.text,
    toolCalls: response.toolCalls,
    toolResults,
  };
}

const followUp = await generateDeepSeekText({
  messages,
  tools: this.toolRegistry.getDefinitions(),
});

return {
  text: followUp.text,
  toolCalls: response.toolCalls,
  toolResults,
  followUp,
};
```

返回值中的 `toolCalls` 仍表示第一次响应中的调用，`toolResults` 表示其执行结果；`followUp` 保存第二次模型响应，顶层 `text` 使用第二次的文本。若 `followUp.toolCalls` 非空，表示模型还提出了待处理动作，不能将本次实验描述为任务已全部完成。

第二次响应目前先作为返回值保留，下一小步改成循环时再统一追加各轮模型消息。

现有 HTTP 路径暂沿用 `/api/agent/run-once` 便于对照实验；同步把控制器方法注释更新为“第五课反馈实验：有工具调用时再请求一次模型，暂不自动循环”，避免仍把它描述为仅有一次模型响应。

### 验证目标

先运行类型检查，再做本地模拟：第一次直接回答时只有一次模型请求；第一次产生调用时，第二次请求的顺序应为系统规则、用户需求、一条模型调用消息、全部对应工具结果。还应覆盖一次响应内多条工具调用，以及第二次仍请求工具的情况，确认没有隐藏执行第三次请求。

用户随后在本机运行已有搜索请求，观察 `followUp` 中是否基于真实素材结果继续回答。类型检查和模拟通过后，再单独执行真实模型验证；本步实际结果记录如下。

### 本步实际验证记录（2026-11-12，2026-11-13 回写）

助手通过本地模拟确认：首次直接回答仅请求一次模型；一次响应中两条工具调用的结果正确回传；第二次仍提出调用时保留该请求，不执行第三次模型调用。

首次真实搜索返回了素材，但没有 `followUp`。排查发现容器挂载源码已更新，编译产物仍是旧版本，日志中没有触发重新编译。重启 API 容器后，同一请求正常返回 `followUp`：搜索“墨墨”执行一次工具，得到六条记录；第二次模型调用据此生成素材说明，后续工具调用列表为空。本次确认了运行版本差异，尚未修复文件监听未触发的具体原因。

用户随后真实请求“有黑猫的素材吗，歪头的或者招手”，结果如下：

| 首轮工具调用的关键词 | 返回记录数 |
|----------------------|------------|
| 黑猫 | 6 |
| 歪头 | 0 |
| 招手 | 1 |

三条调用的 ID 各不相同，结果均通过对应的 `toolCallId` 配对。第二次模型调用汇总结果，并区分招手命中与歪头未命中，`followUp.toolCalls` 为空。该请求总计两次模型调用、三次工具执行；多条搜索结果存在重复资产，不能把返回条数直接相加当作唯一素材数。

该结果验证的是名称与描述的数据库关键词查询，尚未验证 COS 图片可访问性，也不代表模型看过图片。它属于“一轮模型响应提出多个调用”，尚未验证第二轮再提出动作后的自动继续。

## 12. 当前小步：完整循环与自然结束

### 本步解决的问题

当前 `runOnce` 将第一次响应和 `followUp` 分别写了两段请求逻辑。如果第二次响应继续请求工具，程序就停下。现在把每轮的共同过程放进循环：请求模型 → 保存模型消息 → 判断是否结束 → 执行工具并追加结果 → 下一轮。

本步继续由用户修改 `src/harness/agent/agent.service.ts`，暂沿用现有方法名与 HTTP 路径。`runOnce` 在本课表示一次用户任务的运行，其中允许多次模型调用。控制器注释同步为“第五课：一次用户任务的 Agent Loop，持续处理工具调用，直到模型不再请求工具”。

### 核心循环与可选运行策略

- 每次模型请求返回后只保存一条模型消息。同一响应里三条工具调用，仍只计一次模型调用。
- 本轮没有工具调用：返回 `completed`，自然结束本次循环。
- 本轮有工具调用：执行全部工具，追加配对结果，再请求模型。
- 模型请求、参数解析或工具执行抛出错误：异常按当前方式向上传播，不返回正常完成结果。

`modelCallCount` 只记录实际发起的模型调用次数，本步不使用它决定是否停止。`completed` 表示模型不再请求工具、本次循环正常结束；业务需求是否满足还需要结合最终回答判断。

原先示例中的 `maxModelCalls = 5` 是教学时自行选择的保护值，没有实际任务数据作为依据，也不是 Agent Loop 的必要组成部分。经讨论，本步先实现核心循环；调用次数上限作为可选运行策略保留在后续扩展中，与超时、用户取消、费用预算、重复调用检测分别讨论。

当前示例没有实现这些额外停止策略。如果模型持续请求工具且没有发生异常，循环就会继续。后续加入可选上限时，再定义配置、停止状态和待处理调用的返回方式。

### 结果使用具名类型

在现有类型导入中同时导入 `ToolCall`：

```ts
import type { TextMessage, ToolCall } from "@/gateway/text/types";
```

在当前文件的 `AgentService` 类之前定义：

```ts
type ToolExecutionRecord = {
  toolCallId: string;
  name: string;
  result: unknown;
};

type AgentRunResult = {
  status: "completed";
  text: string;
  modelCallCount: number;
  toolCalls: ToolCall[];
  toolResults: ToolExecutionRecord[];
};
```

`toolCalls` 保存各轮模型提出的调用，`toolResults` 保存已执行成功的结果。正常返回时，所有调用都已执行并反馈给模型。本步不引入 `pendingToolCalls` 或上限停止状态。程序失败仍按当前异常处理方式向上传播，不当作正常完成；第八课再加入工具调用上限和停止原因。

### 编写指引：由用户替换 runOnce 方法

```ts
async runOnce(
  userRequest: string,
  context: ToolExecutionContext,
): Promise<AgentRunResult> {
  const messages: TextMessage[] = [
    { role: "system", content: agentSystemPrompt },
    { role: "user", content: userRequest },
  ];
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolExecutionRecord[] = [];
  let modelCallCount = 0;

  while (true) {
    modelCallCount += 1;
    const response = await generateDeepSeekText({
      messages,
      tools: this.toolRegistry.getDefinitions(),
    });

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });
    toolCalls.push(...response.toolCalls);

    if (response.toolCalls.length === 0) {
      return {
        status: "completed",
        text: response.text,
        modelCallCount,
        toolCalls,
        toolResults,
      };
    }

    for (const call of response.toolCalls) {
      const input: unknown = JSON.parse(call.arguments);
      const result = await this.toolRegistry.execute(
        call.name,
        input,
        context,
      );

      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(result),
      });
      toolResults.push({ toolCallId: call.id, name: call.name, result });
    }
  }
}
```

原先单独的 `followUp` 请求与返回字段由这套循环结果取代。现在返回 `modelCallCount` 便于观察实际轮数，所有已请求的调用保留在 `toolCalls` 中，不再只代表第一轮。

### 验证目标

用户完成编写后先运行 `pnpm typecheck`，助手再使用本地模拟验证明确的有限响应序列，检查循环是否持续处理调用并在正确时机结束。

| 模拟响应序列 | 预期结果 |
|--------------|----------|
| 第一轮直接回答 | `completed`，一次模型调用，没有工具执行 |
| 第一轮提出三条调用，第二轮回答 | `completed`，两次模型调用，三次工具执行，消息配对正确 |
| 第一轮请求搜索，第二轮再次请求搜索，第三轮回答 | `completed`，三次模型调用，两次工具执行 |
| 前五轮各请求一个工具，第六轮回答 | `completed`，六次模型调用，五次工具执行；确认没有残留的五次上限 |
| 模型请求、参数解析或工具执行失败 | 异常向上传播，不返回 `completed`，不再发起后续模型请求 |

模拟检查还需确认每次请求都包含之前的配对消息、各轮只保存一次模型消息，以及失败时不会伪装成 `completed`。真实请求待模拟验证后再单独运行。

讲义检查记录（2026-11-13）：助手将本节类型和方法示例组合成临时文件，使用当前项目的 TypeScript 配置检查通过；同时确认方法示例没有残留的次数上限分支。实现源码尚未改成完整循环，上表中的运行行为仍待用户编写后验证。

### 本步完成记录（2026-11-17）

- 用户已实现完整循环，并将 `ToolExecutionRecord`、`AgentRunResult` 导出到 `src/harness/types.ts`；服务通过类型导入使用，控制器注释已更新为第五课入口。
- 助手直接运行本地 TypeScript 编译器 `node node_modules/typescript/bin/tsc --noEmit`，退出码为 0。
- 本地模拟基于服务源码移除导入、装饰器并剥离类型，以模拟模型和工具执行器运行循环：直接回答、同轮三条工具调用、连续两轮工具调用、五轮调用后第六轮回答均通过；同时检查每轮历史、模型消息只追加一次、调用与结果 ID 配对。
- 模拟模型请求失败、JSON 参数解析失败、工具执行失败均按预期向上传播，不再请求模型。这些模拟不覆盖 Nest 注入或真实网络。
- 用户真实请求“搜索墨墨”：返回 `completed`，模型调用 2 次，搜索工具执行 1 次，调用 ID 与结果 ID 一致；最终回答列出工具返回的 6 条候选，并说明 COS 文件尚未接入。本次验证元数据查询，不代表图片文件已可读取。
- 用户真实请求“一句话解释分镜，不需要搜索素材”：返回 `completed`，模型调用 1 次，`toolCalls`、`toolResults` 均为空，最终回答符合请求。

本步核心循环验证完成，以上记录取代前述“源码尚未改成完整循环”的历史状态。当前没有实现调用上限、超时、取消或费用预算；这些运行策略后续单独学习。

第五课收尾理解检查：为什么搜索场景调用模型两次？为什么一次模型响应中的三条工具调用不算三次模型调用？为什么 `completed` 不等于业务目标一定达成？

## 官方协议参考

核对日期：2026-11-12。

- [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)：非思考模式下的工具调用与结果回传示例。
- [DeepSeek Chat Completions](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion/)：工具调用结构、`tool` 角色及 `tool_call_id` 字段。
