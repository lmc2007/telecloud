import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { FileItem } from "../stores/fileStore";
import { useFileStore } from "../stores/fileStore";

export function RenameModal({ file, onClose }: { file: FileItem | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const { renameFile } = useFileStore();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (file) { setName(file.name); setTimeout(() => { ref.current?.focus(); ref.current?.select(); }, 100); }
  }, [file]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    try { await renameFile(file.id, name.trim()); onClose(); } catch {}
  };

  return (
    <AnimatePresence>
      {file && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" onClick={onClose} />
          <motion.div className="modal-panel w-full max-w-sm mx-4 p-6" initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-4">重命名</h3>
            <form onSubmit={submit}>
              <input ref={ref} type="text" value={name} onChange={e => setName(e.target.value)} className="input-primary" placeholder="新名称" />
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={onClose} className="btn-secondary py-1.5 text-[12px]">取消</button>
                <button type="submit" className="btn-primary py-1.5 text-[12px]">确认</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
