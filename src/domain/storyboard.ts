/** 一条分镜的创作内容。 */
export type Shot = {
  /** 镜头序号：同一份草案中唯一的正整数，例如 1。 */
  id: number;
  /** 场景：描述时间、地点与环境，例如“夜晚，机场出口，正在下雨”。 */
  scene: string;
  /** 画面与动作：描述能看到的内容，例如“女主撑伞停下，男主从人群中走来”。 */
  visual: string;
  /** 人物对白：例如“女主：你还是来了。”，没有对白时使用空字符串。 */
  dialogue: string;
};

/** 整个故事及分镜草案的创作内容，不包含审批或视频生成状态。 */
export type Storyboard = {
  /** 剧名：整个故事的标题，例如《雨夜重逢》。 */
  title: string;
  /** 剧情梗概：概括整个故事的人物、冲突和发展，不是单个镜头的描述。 */
  synopsis: string;
  /** 分镜列表：按播放顺序排列，镜头数量根据本次需求确定。 */
  shots: Shot[];
};

/** 工作台镜头所需的画面、台词与可独立编辑的视频生成提示词。 */
export type ShotContent = Pick<Shot, "scene" | "visual" | "dialogue"> & { prompt: string };
export type EditableShot = ShotContent & { shotId?: string; assetIds: string[] };
export type SavedShot = EditableShot & { shotId: string };

/** 数组顺序就是播放顺序。移动镜头只改变位置，已有 shotId 随镜头保留。 */
export type StoryboardDraft<T extends EditableShot = EditableShot> =
  Pick<Storyboard, "title" | "synopsis"> & { script: string; shots: T[] };

export type SelectedShot = { version: number; shot: SavedShot };
export type StoryboardTurnContext = { baseVersion: number; selectedShot?: SelectedShot };

/** 两种卡片分别供工作台替换整份草案或只更新用户点选的一个镜头。 */
export type StoryboardProposal =
  | { kind: "storyboard"; baseVersion: number; storyboard: StoryboardDraft }
  | { kind: "shot"; baseVersion: number; shot: SavedShot };
