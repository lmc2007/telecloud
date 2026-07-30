import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Folder, CheckCircle, XCircle } from "lucide-react";
import type { FileItem } from "../stores/fileStore";
import { useFileStore } from "../stores/fileStore";

export function MoveModal({ files, onClose }: { files: FileItem[]; onClose: () => void }) {
  const { moveFile, files: allFiles } = useFileStore();
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; error?: string }[]>([]);
  const abortRef = useRef(false);

  useEffect(() => {
    if (files.length > 0) {
      const fileIds = new Set(files.map(f => f.id));
      const flds = allFiles.filter(f => f.type === "folder" && !fileIds.has(f.id));
      setFolders(flds);
      setSel(null);
      setResults([]);
      abortRef.current = false;
    }
    return () => { abortRef.current = true; };
  }, [files, allFiles]);

  const submit = async () => {
    if (files.length === 0) return;
    setSubmitting(true);
    abortRef.current = false;
    const res: { name: string; ok: boolean; error?: string }[] = [];
    for (const f of files) {
      if (abortRef.current) break;
      try {
        await moveFile(f.id, sel);
        res.push({ name: f.name, ok: true });
      } catch (err) {
        res.push({ name: f.name, ok: false, error: err instanceof Error ? err.message : "移动失败" });
      }
    }
    if (!abortRef.current) {
      setResults(res);
      setSubmitting(false);
    }
  };

  const done = results.length > 0;
  const okCount = results.filter(r => r.ok).length;

  return (
    <AnimatePresence>
      {files.length > 0 && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" onClick={onClose} />
          <motion.div className="modal-panel w-[360px]" initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-light)]">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">
                移动到{files.length > 1 ? ` (${files.length} 项)` : ""}
              </h3>
              <button onClick={onClose} className="btn-ghost text-sm">✕</button>
            </div>

            {done ? (
              <div className="max-h-[280px] overflow-y-auto p-4 space-y-2">
                <p className="text-[13px] text-[var(--text-secondary)] mb-2">
                  完成：{okCount}/{results.length} 项成功
                </p>
                {results.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px]">
                    {r.ok ? (
                      <CheckCircle className="w-3.5 h-3.5 text-[var(--brand-green)] flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-[var(--brand-red)] flex-shrink-0" />
                    )}
                    <span className="truncate">{r.name}</span>
                    {r.error && <span className="text-[var(--brand-red)] flex-shrink-0">— {r.error}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="max-h-[280px] overflow-y-auto p-2">
                  <button onClick={() => setSel(null)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${sel === null ? "bg-[var(--brand-blue-light)] text-[var(--brand-blue)] font-medium" : "text-[var(--text-primary)] hover:bg-[rgba(0,0,0,0.03)]"}`}>
                    <Folder className="w-4 h-4 text-[#FFB020] flex-shrink-0" />全部文件（根目录）
                  </button>
                  {folders.map(f => (
                    <button key={f.id} onClick={() => setSel(f.id)} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${sel === f.id ? "bg-[var(--brand-blue-light)] text-[var(--brand-blue)] font-medium" : "text-[var(--text-primary)] hover:bg-[rgba(0,0,0,0.03)]"}`}>
                      <Folder className="w-4 h-4 text-[#FFB020] flex-shrink-0" />{f.name}
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--border-light)] bg-[var(--bg-secondary)]">
                  <button onClick={onClose} className="btn-secondary py-1.5 text-[12px]">取消</button>
                  <button onClick={submit} disabled={submitting} className="btn-primary py-1.5 text-[12px]">{submitting ? "移动中..." : "移动"}</button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
