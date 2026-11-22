# 短剧工坊图像与视频模型选型

核对日期为 2026-11-18。本文记录首接方案、候选模型和对比方法。目前已接入 DeepSeek，图像与视频模型还待接入和项目实测。早期讨论中的视频候选可结合本次选型复习。[Gateway 路由讨论](./gateway-routing-discussion.md)

## 选型结论

| 环节 | 首选 | 第二选择 |
|---|---|---|
| 剧本、结构化分镜、工具决策 | 继续使用 DeepSeek，示例配置为 `deepseek-flash` | 目前沿用现有文本链路 |
| 角色参考图、场景图、分镜首帧 | 阿里云百炼 `wan2.7-image` | `MiniMax-H3-Image` 优先参与生图对比，重点测多参考图与角色一致性 |
| 图生视频与普通镜头 | 阿里云百炼 `wan3.0-video`，首轮以 720P、5 秒为基线 | 火山方舟 Seedance 2.5，重点测复杂运镜、连续动作和双人对白 |

图片和视频先接同一家供应商，便于用一个百炼账号跑通参考图生成、审核确认、视频任务和产物归档。图片先用已选角色图生成不同场景的分镜首帧，视频再从确认后的首帧开始。Seedance 和 H3-Image 的适用场景是基于官方能力的试验方向，质量排序由实际结果决定。

## 图像模型对比

下表采用官方 API 参考价。阿里云使用华北 2（北京）价格，MiniMax 保留美元计价。按张计费和 token 计费分开看，多张参考图可能改变单次总价。

| 模型 | API 参考价 | 适合优先验证的场景 |
|---|---|---|
| **Wan 2.7 Image** (`wan2.7-image`) | ¥0.20/张输出 | 文生图、参考图编辑和 2K 分镜首帧。首接重点测同一角色换姿态、换场景，以及服装和道具是否延续。 [价格](https://help.aliyun.com/zh/model-studio/model-pricing) · [图像编辑](https://help.aliyun.com/zh/model-studio/wan-image-edit) |
| **Seedream 5.0 Flash / 5.5** | Flash：¥0.12/张输出，输入免费。5.5：≤261 万像素的输出 ¥0.13/张，输入 ¥0.05/张 | Flash 用于低成本试构图。5.5 用于多轮局部编辑，例如换手里的道具并保持原构图。 [方舟价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh) · [模型能力](https://docs.volcengine.com/docs/ark/model-list?lang=zh) |
| **MiniMax H3-Image** (`MiniMax-H3-Image`) | 官方标准版 2K 示例约 $0.0233（纯文生图）、$0.0266（1 张参考图）或 $0.0418（3 张参考图） | 最多 16 张参考图，支持 4K。重点测同一镜头融合角色、服装和场景参考的效果。实际按 token 计费，包括适用的提示词增强用量。 [价格](https://platform.minimax.io/docs/pricing/overview#image) · [图片 API](https://platform.minimax.io/docs/guides/image-generation) |
| **Qwen Image 3.0** (`qwen-image-3.0`) | 1K、2K 输出 ¥0.18/张，输入 ¥0.02/张。一张参考图加一张输出为 ¥0.20 | 百炼内的补充候选，优先对比中文招牌、道具文字和局部修改。 [价格](https://help.aliyun.com/zh/model-studio/model-pricing) · [文生图与编辑](https://help.aliyun.com/zh/model-studio/text-to-image) |

MiniMax 的 `MiniMax-H3-Image` 用于生图和修图，`MiniMax-H3` 用于生成视频，两者分别使用各自的 API 和计费规则。[MiniMax 官方定价](https://platform.minimax.io/docs/pricing/overview)

## 视频模型对比

统一采用 **输出 5 秒、无输入视频**的场景。国内模型使用官方人民币价格，美元模型保留原币种。Wan 采用原价，Seedance 采用方舟公开的 16:9 示例，竖屏和其他规格按实际 API 用量核算。MiniMax 使用 768P 档，与 720P 近似比较。下表未计入优惠、视频输入、额外素材费用或重做费用，Grok 输入图单列。

| 模型 | 5 秒 API 参考价 | 适合优先验证的场景 |
|---|---|---|
| **Wan 3.0** (`wan3.0-video`) | 720P **¥3.00**，1080P ¥6.00 | 第一家视频供应商。支持 9:16、首帧或首尾帧控制、原生音频，最长 30 秒。首尾帧与全能参考是两种请求模式，不能混在同一次请求中。 [北京区原价](https://help.aliyun.com/zh/model-studio/wan3-0-video) · [API 指南](https://help.aliyun.com/zh/model-studio/wan3-video-generation-guide) |
| **Seedance 2.5** | 720P **约 ¥7.56**，1080P 约 ¥18.71 | 第二家优先。可测试复杂运镜、连续动作、多参考素材和双人对白。最长 30 秒。接入前核实账户开通条件，真人肖像参考按平台专门流程处理。 [价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh) · [模型能力](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh) · [开通条件](https://docs.volcengine.com/docs/ark/seedance-model-activation-usage-and-refund?lang=zh) · [肖像素材](https://docs.volcengine.com/docs/ark/seedance-portrait-asset-guide?lang=en) |
| **Seedance 2.5 Flash / 2.0 Mini** | 720P 分别约 ¥4.97 / ¥2.48 | 方舟内的试镜选项，适合先看构图、动作与节奏。两者最高 720P。 [价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh) · [API 参数](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh) |
| **MiniMax H3 Lite / H3** | 768P 分别 $0.20 / $0.40，H3 的 2K 为 $0.65 | Lite 可试低成本短镜头，H3 用于对比首尾帧、有声片段和 2K 输出。最长 15 秒，参考视频按时长额外计费。 [价格](https://platform.minimax.io/docs/pricing/overview#video) · [视频 API](https://platform.minimax.io/docs/api-reference/video-generation-v2-create) |
| **Grok Imagine Video 1.5 Lite / 1.5** | 720P 分别 $0.15 / $0.70，输入图另计 $0.01/张 | Lite 适合单图短镜头。标准版可用于多图、声音参考和口型对比。如果现有 xAI 账户已具备 API 额度，可纳入第二轮。 [价格](https://docs.x.ai/developers/pricing) · [视频能力](https://docs.x.ai/developers/model-capabilities/video/overview) |

## 性价比与实测方法

**按可用镜头比较总成本。** 把同一模型对该组镜头的实际生成费用（含重做）相加，再除以通过验收的镜头数量。某组没有通过验收的镜头时，记录为零通过。以表中 720P 价格为例，如果 Wan 平均试 3 次才有一条可用，单条可用镜头约 ¥9。如果 Seedance 2.5 一次即可用，成本约 ¥7.56。这是计算示例，项目出片率待测。

| 样例 | 主要验收点 |
|---|---|
| 墨墨转身 | 外形延续、动作完成、是否出现明显变形 |
| 同一角色换景 | 脸、服装和道具是否一致，构图与场景是否符合分镜 |
| 双人中文对白 | 两人身份是否稳定，谁在说话、口型和台词是否对应，镜头是否按要求运动 |

图片对比先固定参考图、构图和输出档位。视频对比用同一张已确认首帧、同一动作目标、9:16、5 秒及可比的分辨率，每个样例先生成两次。记录实际型号、规格、输入素材数量、耗时、每次费用、通过数和重做原因。先确保两家都支持本次素材和参数组合，再提交对比任务。每次付费生成都按用户确认的型号和生成范围执行，费用随任务记录。[项目范围与架构约定](./project-goals-and-scope.md)

## 接入顺序

1. 先接 `wan2.7-image`，验证文生图、参考图生图以及图片保存到 COS，MySQL 登记对象 Key 并可按资产 ID 复用。
2. 接 `wan3.0-video`，先做一张首帧生视频，走通费用估算、用户确认、异步任务查询，以及成功后将产物归档到 COS。
3. 接入 Seedance 2.5 的前提是核实当前账号权限和本项目的素材限制。用相同样例对比两家后，再决定哪些镜头值得用 Seedance。
4. 图片质量需要进一步比较时，优先用 `MiniMax-H3-Image` 测试同一份角色、服装和场景素材。第一轮保持手动选型，拿到能力和费用记录后再确定自动路由规则。[Gateway 路由讨论](./gateway-routing-discussion.md)
