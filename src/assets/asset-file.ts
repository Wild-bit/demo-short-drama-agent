import { UnsupportedMediaTypeException } from "@nestjs/common";
import { open } from "node:fs/promises";

async function readHeader(filePath: string): Promise<Buffer> {
  const file = await open(filePath, "r");
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(16), 0, 16, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

export async function readImageFormat(filePath: string) {
  const header = await readHeader(filePath);
  if (header.subarray(0, 3).toString("hex") === "ffd8ff") {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (header.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return { extension: "png", contentType: "image/png" };
  }
  if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  if (["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6))) {
    return { extension: "gif", contentType: "image/gif" };
  }
  throw new UnsupportedMediaTypeException("请上传 JPEG、PNG、WebP 或 GIF 图片");
}

export async function requireMp4(filePath: string): Promise<void> {
  const header = await readHeader(filePath);
  if (header.length < 12 || header.toString("ascii", 4, 8) !== "ftyp") {
    throw new UnsupportedMediaTypeException("生成结果必须是 MP4 文件");
  }
}
