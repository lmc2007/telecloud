import { useEffect } from "react";
import { useFileStore } from "../stores/fileStore";
import { FileIcon } from "../components/FileIcon";
import { fmtSize } from "../lib/utils";

export function TrashPage() {
  const { trashFiles, fetchTrash, restoreFile, permanentDelete, emptyTrash, error, clearError } = useFileStore();
  useEffect(() => { fetchTrash(); }, []);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">回收站</h2>
        <button onClick={emptyTrash} className="text-[12px] text-[var(--brand-red)] hover:text-[var(--brand-red-hover)] transition-colors">清空回收站</button>
      </div>
      {error && <p className="text-[var(--brand-red)] text-[12px] mb-3 cursor-pointer" onClick={clearError}>{error} ✕</p>}
      {trashFiles.length === 0 ? (
        <p className="text-[var(--text-tertiary)] text-center py-12">回收站为空</p>
      ) : (
        <div className="space-y-1">
          {trashFiles.map(f => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-2 bg-white rounded-md border border-[var(--border-light)]">
              <FileIcon item={f} />
              <span className="flex-1 text-[13px] truncate text-[var(--text-primary)]">{f.name}</span>
              <span className="text-[11px] text-[var(--text-tertiary)]">{fmtSize(f.size)}</span>
              <button onClick={() => restoreFile(f.id)} className="text-[12px] text-[var(--brand-blue)] hover:underline">恢复</button>
              <button onClick={() => permanentDelete(f.id)} className="text-[12px] text-[var(--brand-red)] hover:underline">彻底删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
