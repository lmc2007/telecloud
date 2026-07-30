import { useState } from "react";
import { useTransferStore } from "../stores/transferStore";
import { fmtSize } from "../lib/utils";

export function TransferManager() {
  const transfers = useTransferStore(s => s.transfers);
  const cancelTransfer = useTransferStore(s => s.cancelTransfer);
  const removeTransfer = useTransferStore(s => s.removeTransfer);
  const [expanded, setExpanded] = useState(true);
  if (transfers.length === 0) return null;

  const active = transfers.filter(t => t.status === "transferring" || t.status === "pending" || t.status === "assembling").length;
  const avg = active > 0 ? Math.round(transfers.filter(t => t.status === "transferring" || t.status === "assembling").reduce((s, t) => s + t.progress, 0) / active) : 0;

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80">
      <div className="card shadow-lg overflow-hidden">
        <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-[rgba(0,0,0,0.02)]">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">{active > 0 ? `${active} 项传输中` : "传输完成"}</span>
          <span className="text-[11px] text-[var(--text-tertiary)]">{active > 0 ? `${avg}%` : "✓"}</span>
        </button>
        {active > 0 && <div className="h-[2px] bg-[var(--border-light)]"><div className="h-full bg-[var(--brand-blue)] transition-all duration-300" style={{ width: `${avg}%` }} /></div>}
        {expanded && (
          <div className="max-h-56 overflow-y-auto">
            {transfers.map(t => (
              <div key={t.id} className="px-3 py-2 border-b border-[var(--border-light)] last:border-0">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="truncate flex-1 font-medium text-[var(--text-primary)]">{t.type === "upload" ? "📤" : "📥"} {t.fileName}</span>
                  <span className="text-[11px] text-[var(--text-tertiary)] ml-1">{t.progress}%</span>
                  {t.status === "done" || t.status === "cancelled" || t.status === "error" ? (
                    <button onClick={() => removeTransfer(t.id)} className="ml-1 text-[var(--text-disabled)] hover:text-[var(--text-secondary)]">✕</button>
                  ) : (
                    <button onClick={() => cancelTransfer(t.id)} className="ml-1 text-[var(--text-disabled)] hover:text-[var(--brand-red)]">✕</button>
                  )}
                </div>
                {(t.status === "transferring" || t.status === "assembling") && (
                  <div className="mt-1">
                    <div className="h-[3px] bg-[var(--border-light)] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${t.type === "upload" ? "bg-[var(--brand-blue)]" : "bg-[var(--brand-green)]"}`} style={{ width: `${t.progress}%` }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-[var(--text-tertiary)] mt-0.5">
                      <span>{t.uploadedBytes !== undefined ? `${fmtSize(t.uploadedBytes)} / ${fmtSize(t.fileSize)}` : ""}</span>
                      <span>{t.speed > 0 ? `${fmtSize(t.speed)}/s` : ""}{t.chunksTotal ? ` · 卷${t.chunksDone}/${t.chunksTotal}` : ""}</span>
                    </div>
                  </div>
                )}
                {(t.status === "error" || t.status === "cancelled") && (
                  <p className="text-[10px] text-[var(--brand-red)] mt-0.5">{t.error}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
