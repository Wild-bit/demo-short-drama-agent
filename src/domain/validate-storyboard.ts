export function validateStoryboard(data: unknown): void {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("分镜草案必须是对象");
  }

  if (
    !("title" in data) ||
    typeof data.title !== "string" ||
    data.title.trim() === ""
  ) {
    throw new Error("title 必须是非空字符串");
  }

  if (
    !("synopsis" in data) ||
    typeof data.synopsis !== "string" ||
    data.synopsis.trim() === ""
  ) {
    throw new Error("synopsis 必须是非空字符串");
  }

  if (
    !("shots" in data) ||
    !Array.isArray(data.shots) ||
    data.shots.length === 0
  ) {
    throw new Error("shots 必须是非空数组");
  }
  data.shots.forEach((shot, index) => {
    const label = `第 ${index + 1} 条分镜`;

    if (
      !("visual" in shot) ||
      typeof shot.visual !== "string" ||
      shot.visual.trim() === ""
    ) {
      throw new Error(`${label}的 visual 必须是非空字符串`);
    }

    if (!("dialogue" in shot) || typeof shot.dialogue !== "string") {
      throw new Error(`${label}的 dialogue 必须是字符串`);
    }
  });
}
