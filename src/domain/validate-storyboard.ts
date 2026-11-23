import type { EditableShot, ShotContent, StoryboardDraft } from "./storyboard";

/** 读取 JSON 对象，拒绝 null、数组和基本类型。 */
export function readObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(label + "必须是对象");
  return value as Record<string, unknown>;
}

/** 读取文字字段；无对白的镜头允许空字符串。 */
function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(label + "填写不正确");
  return value;
}

/** 第三课的基本校验要求动作有内容，无对白时允许传空字符串。 */
function readAction(shot: Record<string, unknown>) {
  return {
    visual: text(shot.visual, "画面"),
    dialogue: text(shot.dialogue, "对白", true),
  };
}

/** 兼容第三课的分镜草案，工作台在同一组字段上增加剧本和提示词。 */
export function validateStoryboard(data: unknown): void {
  const draft = readObject(data, "分镜草案");
  text(draft.title, "剧名");
  text(draft.synopsis, "梗概");
  if (!Array.isArray(draft.shots) || !draft.shots.length) throw new Error("请至少保留一个镜头");
  draft.shots.forEach((shot, index) => readAction(readObject(shot, `第 ${index + 1} 镜`)));
}

/** 将业务 UUID 规范为小写，供归属和去重检查。 */
export function readUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(label + "须为有效的 UUID");
  }
  return value.toLowerCase();
}

/** 读取有序的 ID 列表并拒绝重复项。 */
export function readIds(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(label + "须为数组");
  const ids = value.map(id => readUuid(id, label));
  if (new Set(ids).size !== ids.length) throw new Error(label + "有重复项");
  return ids;
}

/** 校验一镜的创作内容。 */
export function readShotContent(value: unknown): ShotContent {
  const shot = readObject(value, "镜头");
  return { scene: text(shot.scene, "场景"), ...readAction(shot), prompt: text(shot.prompt, "镜头提示词") };
}

/** 将前端提交或工具提议的草案整理成可安全保存的字段。 */
export function readStoryboardDraft(value: unknown): StoryboardDraft {
  const draft = readObject(value, "分镜草案");
  if (!Array.isArray(draft.shots)) throw new Error("镜头列表须为数组");
  const shots = draft.shots.map((value, index): EditableShot => {
    const shot = readObject(value, `第 ${index + 1} 镜`);
    return {
      ...readShotContent(shot),
      ...(shot.shotId !== undefined && { shotId: readUuid(shot.shotId, "镜头 ID") }),
      assetIds: shot.assetIds === undefined ? [] : readIds(shot.assetIds, "参考素材 ID"),
    };
  });
  return {
    title: text(draft.title, "剧名"),
    synopsis: text(draft.synopsis, "梗概", true),
    script: text(draft.script, "剧本"),
    shots,
  };
}
