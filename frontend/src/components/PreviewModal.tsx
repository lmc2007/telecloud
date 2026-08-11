import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Download, Loader2 } from "lucide-react";
import type { FileItem } from "../stores/fileStore";
import { isPreviewable } from "../lib/utils";
import { getPreviewStreamUrl } from "../lib/api";
import { fmtSize } from "../lib/utils";

interface PreviewModalProps {
  item: FileItem;
  files?: FileItem[];
  onClose: () => void;
  getStreamUrl?: (item: FileItem) => Promise<string>;
}

export function PreviewModal({ item, files, onClose, getStreamUrl }: PreviewModalProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const previewType = isPreviewable(item);
  const currentIdx = files ? files.findIndex(f => f.id === item.id) : -1;
  const hasPrev = currentIdx > 0;
  const hasNext = currentIdx >= 0 && currentIdx < (files?.length || 0) - 1;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setImageUrl(null);
    setVideoUrl(null);

    (async () => {
      try {
        const resolver = getStreamUrl || (async (f: FileItem) => getPreviewStreamUrl(f.id));
        const url = await resolver(item);
        if (cancelled) return;

        if (previewType === "image") {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (cancelled) return;
          setImageUrl(URL.createObjectURL(blob));
        } else if (previewType === "video") {
          setVideoUrl(url);
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载预览失败");
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [item.id, previewType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const navigateTo = useCallback((dir: -1 | 1) => {
    if (!files) return;
    const newIdx = currentIdx + dir;
    if (newIdx < 0 || newIdx >= files.length) return;
    const target = files[newIdx];
    if (!isPreviewable(target)) return;
    onClose();
    window.dispatchEvent(new CustomEvent("tcd:preview-navigate", { detail: target }));
  }, [files, currentIdx, onClose]);

  const handleDownload = () => {
    if (videoUrl || imageUrl) {
      const a = document.createElement("a");
      a.href = videoUrl || imageUrl!;
      a.download = item.name;
      a.click();
    }
  };

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  return (
    <AnimatePresence>
      <motion.div
        ref={overlayRef}
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={handleOverlayClick}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        >
          <X className="w-5 h-5 text-white" />
        </button>

        <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
          <span className="text-white/90 text-[14px] font-medium max-w-[400px] truncate">{item.name}</span>
          <span className="text-white/50 text-[12px]">{fmtSize(item.size)}</span>
        </div>

        {(videoUrl || imageUrl) && (
          <button
            onClick={handleDownload}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[13px] transition-colors"
          >
            <Download className="w-4 h-4" />
            下载
          </button>
        )}

        {hasPrev && (
          <button onClick={(e) => { e.stopPropagation(); navigateTo(-1); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
            <ChevronLeft className="w-5 h-5 text-white" />
          </button>
        )}
        {hasNext && (
          <button onClick={(e) => { e.stopPropagation(); navigateTo(1); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
            <ChevronRight className="w-5 h-5 text-white" />
          </button>
        )}

        <motion.div
          className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {loading && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-white/60 animate-spin" />
              <span className="text-white/50 text-[13px]">加载预览中...</span>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center gap-3 p-8">
              <p className="text-white/70 text-[14px]">{error}</p>
              <button onClick={onClose} className="px-4 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white text-[13px] transition-colors">
                关闭
              </button>
            </div>
          )}

          {!loading && !error && previewType === "image" && imageUrl && (
            <img src={imageUrl} alt={item.name}
              className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl" draggable={false} />
          )}

          {!loading && !error && previewType === "video" && videoUrl && (
            <video src={videoUrl} controls autoPlay
              className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
              controlsList="nodownload" style={{ background: "black" }}>
              您的浏览器不支持视频播放
            </video>
          )}
        </motion.div>

        {files && files.length > 1 && currentIdx >= 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-[12px]">
            {currentIdx + 1} / {files.length}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
