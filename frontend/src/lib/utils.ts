// 工具函数
export function fmtSize(bytes: number): string {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

import type { FileItem } from "../stores/fileStore";

export function kindLabel(item: FileItem): string {
  if (item.type === "folder") return "文件夹";
  const mime = item.mime_type || "";
  if (mime.startsWith("image/")) return "图片";
  if (mime.startsWith("video/")) return "视频";
  if (mime.startsWith("audio/")) return "音频";
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("zip") || mime.includes("rar") || mime.includes("7z")) return "压缩包";
  if (mime.includes("text") || mime.includes("document")) return "文档";
  return "文件";
}

/**
 * Check if a file is previewable inline (image or video).
 * Returns the preview type or null.
 */
export function isPreviewable(item: FileItem): "image" | "video" | null {
  if (item.type !== "file") return null;
  const mime = item.mime_type || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}
