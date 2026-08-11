import { Folder, File, FileImage, FileVideo, FileAudio, FileArchive, FileText } from "lucide-react";
import type { FileItem } from "../stores/fileStore";

export function FileIcon({ item, size = "sm" }: { item: FileItem; size?: "sm" | "lg" }) {
  if (size === "lg") return <LargeIcon item={item} />;
  const s = "w-5 h-5";
  if (item.type === "folder") return <Folder className={`${s} text-[var(--icon-folder)]`} strokeWidth={1.5} />;
  const mime = item.mime_type || "";
  if (mime.startsWith("image/")) return <FileImage className={`${s} text-[var(--icon-image)]`} strokeWidth={1.5} />;
  if (mime.startsWith("video/")) return <FileVideo className={`${s} text-[var(--icon-video)]`} strokeWidth={1.5} />;
  if (mime.startsWith("audio/")) return <FileAudio className={`${s} text-[var(--icon-audio)]`} strokeWidth={1.5} />;
  if (mime.includes("zip") || mime.includes("rar")) return <FileArchive className={`${s} text-[var(--icon-share)]`} strokeWidth={1.5} />;
  if (mime.includes("pdf") || mime.includes("text")) return <FileText className={`${s} text-[var(--icon-doc)]`} strokeWidth={1.5} />;
  return <File className={`${s} text-[var(--icon-default)]`} strokeWidth={1.5} />;
}

/* iCloud-style large icon tile: soft gradient, generous size */
export function LargeIcon({ item }: { item: FileItem }) {
  const wrap = (bg: string, c: React.ReactNode) => (
    <div className={`w-[68px] h-[68px] rounded-[18px] flex items-center justify-center`} style={{ background: bg }}>{c}</div>
  );
  if (item.type === "folder") return wrap("var(--tile-folder)", <Folder className="w-8 h-8 text-[var(--icon-folder)]" strokeWidth={1.3} />);
  const mime = item.mime_type || "";
  if (mime.startsWith("image/")) return wrap("var(--tile-image)", <FileImage className="w-8 h-8 text-[var(--icon-image)]" strokeWidth={1.3} />);
  if (mime.startsWith("video/")) return wrap("var(--tile-video)", <FileVideo className="w-8 h-8 text-[var(--icon-video)]" strokeWidth={1.3} />);
  if (mime.startsWith("audio/")) return wrap("var(--tile-audio)", <FileAudio className="w-8 h-8 text-[var(--icon-audio)]" strokeWidth={1.3} />);
  if (mime.includes("zip") || mime.includes("rar")) return wrap("var(--tile-archive)", <FileArchive className="w-8 h-8 text-[var(--icon-share)]" strokeWidth={1.3} />);
  if (mime.includes("pdf") || mime.includes("text")) return wrap("var(--tile-doc)", <FileText className="w-8 h-8 text-[var(--icon-doc)]" strokeWidth={1.3} />);
  return wrap("var(--tile-generic)", <File className="w-8 h-8 text-[var(--icon-default)]" strokeWidth={1.3} />);
}
