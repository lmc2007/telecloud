import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Pencil, Download, Share2, FolderInput, Trash2, Eye } from "lucide-react";
import type { FileItem } from "../stores/fileStore";
import { isPreviewable } from "../lib/utils";

export function ContextMenu({ item, selected, selectedCount, onClose, onShare, onRename, onDownload, onDelete, onMove, onDeleteSelected, onShareSelected, onMoveSelected, onDownloadSelected, onPreview }: {
  item: FileItem; selected?: Set<string>; selectedCount?: number; onClose: () => void; onShare: () => void; onRename: () => void; onDownload: () => void; onDelete: () => void; onMove: () => void;
  onDeleteSelected?: () => void;
  onShareSelected?: () => void;
  onMoveSelected?: () => void;
  onDownloadSelected?: () => void;
  onPreview?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const multi = (selectedCount ?? 0) > 1 && selected?.has(item.id);
  const items = multi
    ? [
        ...(onDownloadSelected ? [{ icon: Download, label: `下载 ${selectedCount} 项`, action: onDownloadSelected }] : []),
        ...(onShareSelected ? [{ icon: Share2, label: `分享 ${selectedCount} 项`, action: onShareSelected }] : []),
        ...(onMoveSelected ? [{ icon: FolderInput, label: `移动到 ${selectedCount} 项`, action: onMoveSelected }] : []),
        null as any,
        ...(onDeleteSelected ? [{ icon: Trash2, label: `删除 ${selectedCount} 项`, action: onDeleteSelected, danger: true }] : []),
      ]
    : [
        { icon: Pencil, label: "重命名", action: onRename },
        ...(item.type === "file" ? [
          ...(isPreviewable(item) && onPreview ? [{ icon: Eye, label: "预览", action: onPreview }] : []),
          { icon: Download, label: "下载", action: onDownload },
          { icon: Share2, label: "分享", action: onShare },
        ] : []),
        { icon: FolderInput, label: "移动到", action: onMove },
        null as any,
        { icon: Trash2, label: "删除", action: onDelete, danger: true },
      ];

  return (
    <motion.div ref={ref} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.12 }}
      className="fixed z-[100] w-40 bg-white rounded-lg py-1 shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[var(--border-light)]">
      {items.map((e, i) => {
        if (e === null) return <div key={i} className="h-px bg-[var(--border-light)] my-0.5 mx-3" />;
        const IconComp = e.icon as React.FC<{ className?: string; strokeWidth?: number }>;
        return (
          <button key={i} className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] transition-colors ${e.danger ? "text-[var(--brand-red)] hover:bg-red-50" : "text-[var(--text-primary)] hover:bg-[rgba(0,0,0,0.03)]"}`}
            onClick={e.action}>{IconComp && <IconComp className="w-4 h-4" strokeWidth={1.6} />}{e.label}</button>
        );
      })}
    </motion.div>
  );
}
