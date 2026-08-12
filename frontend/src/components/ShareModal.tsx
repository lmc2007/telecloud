import { useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Share2 } from "lucide-react";
import type { FileItem } from "../stores/fileStore";
import { api } from "../lib/api";

export function ShareModal({ files, onClose }: { files: FileItem[]; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [expireHours, setExpireHours] = useState(0);
  const [maxDownloads, setMaxDownloads] = useState(0);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const isFolder = files.length > 0 && files.every(f => f.type === "folder");
  const isMultiFolder = isFolder && files.length > 1;

  const handleCreate = async () => {
    if (files.length === 0) return;
    setCreating(true);
    setError("");
    try {
      const body: any = {};
      if (password) body.password = password;
      if (expireHours) body.expire_hours = expireHours;
      if (maxDownloads) body.max_downloads = maxDownloads;

      if (isMultiFolder) {
        // Multi-folder share
        const ids = files.map(f => f.id).filter(Boolean);
        if (ids.length === 0) { setError("没有有效的文件夹 ID"); setCreating(false); return; }
        body.folder_ids = ids;
      } else if (isFolder) {
        // Single folder share
        if (!files[0].id) { setError("文件夹 ID 无效"); setCreating(false); return; }
        body.folder_id = files[0].id;
      } else if (files.length === 1) {
        if (!files[0].id) { setError("文件 ID 无效"); setCreating(false); return; }
        body.file_id = files[0].id;
      } else {
        const ids = files.map(f => f.id).filter(Boolean);
        if (ids.length === 0) { setError("没有有效的文件 ID"); setCreating(false); return; }
        body.file_ids = ids;
      }
      const res = await api.post<{ success: boolean; data: { token: string } }>("/shares", body);
      setShareUrl(`${window.location.origin}/s/${res.data.token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建分享失败，请重试");
    } finally { setCreating(false); }
  };

  const fileNames = files.map(f => f.name).join("、");
  const title = isFolder ? (isMultiFolder ? "分享文件夹" : "分享文件夹") : "分享文件";
  const subtitle = isMultiFolder
    ? `${files.length} 个文件夹: ${fileNames}`
    : isFolder
    ? files[0].name
    : files.length === 1 ? files[0].name : `${files.length} 个文件: ${fileNames}`;

  return createPortal(
    <AnimatePresence>
      {files.length > 0 && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" onClick={onClose} />
          <motion.div className="modal-panel w-full max-w-sm mx-4 p-6" initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} transition={{ duration: 0.2 }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h3>
              <button onClick={onClose} className="btn-ghost text-sm">✕</button>
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] mb-5 truncate" title={fileNames}>
              {subtitle}
            </p>
            {shareUrl ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-[var(--brand-blue-light)] rounded-md">
                  <Share2 className="w-4 h-4 text-[var(--brand-blue)] flex-shrink-0" />
                  <span className="text-[13px] truncate flex-1 text-[var(--brand-blue)]">{shareUrl}</span>
                </div>
                <button onClick={async () => { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="btn-primary w-full py-2.5">
                  {copied ? "已复制" : "复制链接"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-[12px] font-medium text-[var(--text-secondary)] mb-1.5 block">提取码（可选）</label>
                  <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空则无需提取码" className="input-primary" maxLength={6} />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[var(--text-secondary)] mb-1.5 block">有效期</label>
                  <select value={expireHours} onChange={e => setExpireHours(Number(e.target.value))} className="input-primary">
                    <option value={0}>永久有效</option><option value={1}>1 小时</option><option value={24}>1 天</option><option value={168}>7 天</option><option value={720}>30 天</option>
                  </select>
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[var(--text-secondary)] mb-1.5 block">下载次数</label>
                  <select value={maxDownloads} onChange={e => setMaxDownloads(Number(e.target.value))} className="input-primary">
                    <option value={0}>不限制</option><option value={1}>1 次</option><option value={5}>5 次</option><option value={10}>10 次</option><option value={50}>50 次</option>
                  </select>
                </div>
                <button onClick={handleCreate} disabled={creating} className="btn-primary w-full py-2.5">{creating ? "创建中..." : "创建分享链接"}</button>
                {error && <p className="text-[12px] text-[var(--brand-red)] text-center">{error}</p>}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
