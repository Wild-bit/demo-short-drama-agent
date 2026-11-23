export type ChatAssetCardItem = {
  id: string;
  name: string;
  type: "image" | "video";
  url?: string;
  description?: string;
  tags?: string[];
};

/** 对话区受控 UI 组件块（A2UI 风格组件注册表协议）。 */
export type ChatUiBlock = {
  component: "asset_gallery";
  assets: ChatAssetCardItem[];
};
