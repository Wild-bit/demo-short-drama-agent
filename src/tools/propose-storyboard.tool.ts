import type { StoryboardProposal, StoryboardTurnContext } from "@/domain/storyboard";
import { readShotContent, readStoryboardDraft } from "@/domain/validate-storyboard";
import type { AgentTool } from "./types";

const shotFields = {
  scene: { type: "string", description: "时间、地点与环境" },
  visual: { type: "string", description: "镜头画面与动作" },
  dialogue: { type: "string", description: "对白，可为空字符串" },
  prompt: { type: "string", description: "本镜可编辑的视频生成提示词" },
};
const shotSchema = {
  type: "object", properties: shotFields,
  required: Object.keys(shotFields), additionalProperties: false,
};
const storyboardSchema = {
  type: "object",
  properties: {
    title: { type: "string" }, synopsis: { type: "string" },
    script: { type: "string", description: "供用户编辑的完整剧本文本" },
    shots: { type: "array", minItems: 1, items: shotSchema },
  },
  required: ["title", "synopsis", "script", "shots"], additionalProperties: false,
};

/** 仅在项目会话注册。工具生成本轮的编辑卡片，保存和确认由用户单独提交。 */
export function proposeStoryboardTool(
  context: StoryboardTurnContext, onProposal: (proposal: StoryboardProposal) => void,
): AgentTool {
  const { baseVersion, selectedShot } = context;
  return {
    definition: {
      name: "propose_storyboard",
      description: selectedShot
        ? "用户请求修改已选镜头时调用，提交该镜的完整修改建议，保留其他镜头。"
        : "用户请求编写可编辑分镜时调用，提交剧本和有序镜头草案供审阅。仅提出建议，不保存作品或生成视频。",
      parameters: selectedShot ? shotSchema : storyboardSchema,
    },
    async execute(input) {
      try {
        if (selectedShot) {
          const shot = { ...selectedShot.shot, ...readShotContent(input) };
          onProposal({ kind: "shot", baseVersion, shot });
        } else {
          const storyboard = readStoryboardDraft(input);
          if (!storyboard.synopsis.trim() || !storyboard.shots.length) throw new Error("请提供梗概和分镜");
          if (storyboard.shots.some(shot => shot.shotId || shot.assetIds.length)) {
            throw new Error("新草案的镜头标识及参考素材由工作台处理");
          }
          onProposal({ kind: "storyboard", baseVersion, storyboard });
        }
        return { status: "proposed", message: "已整理为供用户编辑的建议，尚待用户保存。" };
      } catch (error) {
        return { status: "blocked", message: error instanceof Error ? error.message : "分镜格式无效" };
      }
    },
  };
}
