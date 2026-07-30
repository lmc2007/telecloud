import { Folder, File, FileImage, FileVideo, FileAudio, FileArchive, FileText } from "lucide-react";
import type { FileItem } from "../stores/fileStore";

export function FileIcon({ item, size = "sm" }: { item: FileItem; size?: "sm" | "lg" }) {
  if (size === "lg") return <LargeIcon item={item} />;
  const s = "w-5 h-5";
  if (item.type === "folder") return <Folder className={`${s} text-[#FFB020]`} strokeWidth={1.5} />;
  const mime = item.mime_type || "";
  if (mime.startsWith("image/")) return <FileImage className={`${s} text-[#7C5CFC]`} strokeWidth={1.5} />;
  if (mime.startsWith("video/")) return <FileVideo className={`${s} text-[#F53F3F]`} strokeWidth={1.5} />;
  if (mime.startsWith("audio/")) return <FileAudio className={`${s} text-[#00B578]`} strokeWidth={1.5} />;
  if (mime.includes("zip") || mime.includes("rar")) return <FileArchive className={`${s} text-[#FF8F1F]`} strokeWidth={1.5} />;
  if (mime.includes("pdf") || mime.includes("text")) return <FileText className={`${s} text-[#1677FF]`} strokeWidth={1.5} />;
  return <File className={`${s} text-[#8F959E]`} strokeWidth={1.5} />;
}

export function LargeIcon({ item }: { item: FileItem }) {
  const wrap = (bg: string, c: React.ReactNode) => (
    <div className={`w-12 h-12 rounded-lg ${bg} flex items-center justify-center`}>{c}</div>
  );
  if (item.type === "folder") return wrap("bg-[#FFF7E6]", <Folder className="w-6 h-6 text-[#FFB020]" strokeWidth={1.5} />);
  const mime = item.mime_type || "";
  if (mime.startsWith("image/")) return wrap("bg-[#F3F0FF]", <FileImage className="w-6 h-6 text-[#7C5CFC]" strokeWidth={1.5} />);
  if (mime.startsWith("video/")) return wrap("bg-[#FFF0F0]", <FileVideo className="w-6 h-6 text-[#F53F3F]" strokeWidth={1.5} />);
  if (mime.startsWith("audio/")) return wrap("bg-[#E6FAF4]", <FileAudio className="w-6 h-6 text-[#00B578]" strokeWidth={1.5} />);
  if (mime.includes("zip") || mime.includes("rar")) return wrap("bg-[#FFF4E6]", <FileArchive className="w-6 h-6 text-[#FF8F1F]" strokeWidth={1.5} />);
  if (mime.includes("pdf") || mime.includes("text")) return wrap("bg-[#E8F3FF]", <FileText className="w-6 h-6 text-[#1677FF]" strokeWidth={1.5} />);
  return wrap("bg-[#F5F6F7]", <File className="w-6 h-6 text-[#8F959E]" strokeWidth={1.5} />);
}
