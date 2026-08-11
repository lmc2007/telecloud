import { useState, useEffect, useCallback, useRef } from "react";
import { useTransferStore } from "../stores/transferStore";
import { fmtSize } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { Cloud, X } from "lucide-react";
import { RingProgress } from "./RingProgress";

/* ── Top Bar: Apple thin line (1.5px) ── */
function TopBar({ onClick, avgProgress, activeCount, allDone }: { onClick: () => void; avgProgress: number; activeCount: number; allDone: boolean }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed top-0 left-0 right-0 h-[3px] z-[110] cursor-pointer"
      style={{ background: "rgba(128,128,128,0.15)" }}
    >
      <div
        className="h-full transition-all duration-300 rounded-r-full"
        style={{
          width: `${Math.max(1, avgProgress)}%`,
          background: allDone ? "var(--green)" : "var(--accent)",
          boxShadow: "0 0 6px var(--accent-light)",
        }}
      />
      <div className="absolute top-[3px] right-3 mt-1 px-2 py-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{ background: "var(--bg-elev)", border: "0.5px solid var(--border)", boxShadow: "var(--shadow)" }}>
        <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
          {allDone ? "传输完成" : `${activeCount} 项传输中 · ${Math.round(avgProgress)}%`}
        </span>
      </div>
    </motion.button>
  );
}

/* ── Transfer Modal (Apple 风格) ── */
function TransferModal({ onClose }: { onClose: () => void }) {
  const transfers = useTransferStore(s => s.transfers);
  const cancelTransfer = useTransferStore(s => s.cancelTransfer);
  const removeTransfer = useTransferStore(s => s.removeTransfer);
  const allDone = transfers.every(t => t.status === "done" || t.status === "error" || t.status === "cancelled");

  useEffect(() => {
    if (allDone) {
      const t = setTimeout(onClose, 2500);
      return () => clearTimeout(t);
    }
  }, [allDone, onClose]);

  const escRef = useCallback((e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }, [onClose]);
  useEffect(() => {
    window.addEventListener("keydown", escRef);
    return () => window.removeEventListener("keydown", escRef);
  }, [escRef]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 10 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-[400px] max-w-[95vw] max-h-[520px] overflow-hidden rounded-2xl"
        style={{ background: "var(--bg-elev)", border: "0.5px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: "0.5px solid var(--border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, var(--accent), #5AC8FA)" }}>
              <Cloud className="w-3.5 h-3.5 text-white" strokeWidth={2} />
            </div>
            <div>
              <span className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>传输中心</span>
              <span className="text-[11px] ml-2" style={{ color: "var(--text-tertiary)" }}>
                {allDone ? "全部完成" : `${transfers.filter(t => t.status === "transferring" || t.status === "assembling").length} 活跃`}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost w-7 h-7"><X className="w-4 h-4" /></button>
        </div>

        {/* List */}
        <div className="max-h-[400px] overflow-y-auto">
          {transfers.map((t, i) => {
            const isActive = t.status === "transferring" || t.status === "assembling" || t.status === "pending";
            const isDone = t.status === "done";
            const isErr = t.status === "error" || t.status === "cancelled";
            return (
              <div key={t.id} className={`px-5 py-3.5 flex items-center gap-4 transition-colors ${i < transfers.length - 1 ? "" : ""}`}
                style={{ borderBottom: i < transfers.length - 1 ? "0.5px solid var(--border)" : "none" }}>
                {/* Ring progress */}
                <RingProgress
                  progress={isDone ? 100 : isErr ? 100 : t.progress}
                  status={isDone ? "done" : isErr ? "error" : "active"}
                  size={34}
                  stroke={3.5}
                />
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] truncate" style={{ color: "var(--text)" }}>{t.fileName}</span>
                    <span className="text-[11px] flex-shrink-0" style={{ fontFamily: "'SF Mono', 'Courier New', monospace", color: isDone ? "var(--green)" : isErr ? "var(--red)" : "var(--text-secondary)" }}>
                      {isDone ? "完成" : isErr ? (t.error || "已取消") : `${t.progress}%`}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] mt-1" style={{ fontFamily: "'SF Mono', 'Courier New', monospace", color: "var(--text-tertiary)" }}>
                    <span>{(() => { const transferred = t.downloadedBytes ?? t.uploadedBytes; return transferred !== undefined ? `${fmtSize(transferred)} / ${fmtSize(t.fileSize)}` : fmtSize(t.fileSize); })()}</span>
                    <span>{t.speed > 0 ? `${fmtSize(t.speed)}/s` : ""}{t.chunksTotal ? ` · ${t.chunksDone}/${t.chunksTotal}` : ""}</span>
                  </div>
                </div>
                {/* Action */}
                {isActive && (
                  <button onClick={() => cancelTransfer(t.id)} className="text-[var(--text-tertiary)] hover:text-[var(--red)] transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
                {(isDone || isErr) && (
                  <div className="flex items-center gap-1">
                    {isErr && t.onRetry && (
                      <button onClick={() => t.onRetry?.()} className="text-[11px] text-[var(--brand-blue)] hover:underline">重试</button>
                    )}
                    <button onClick={() => removeTransfer(t.id)} className="text-[var(--text-tertiary)] hover:text-[var(--text)] transition-colors text-[11px]">清除</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-2.5 flex justify-between items-center" style={{ borderTop: "0.5px solid var(--border)" }}>
          <span className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            {allDone ? "即将自动关闭 · ESC 或点击遮罩关闭" : "ESC 关闭"}
          </span>
          {!allDone && (
            <button onClick={onClose} className="text-[11px] transition-colors" style={{ color: "var(--accent-text)" }}>最小化</button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Error Toast ── */
function ErrorToast({ msg, onClose }: { msg: string; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[130] flex items-center gap-2.5 pl-3 pr-2 py-2.5 rounded-xl max-w-[85vw]"
      style={{ background: "var(--bg-elev)", border: "0.5px solid var(--border)", boxShadow: "var(--shadow-lg)" }}
    >
      <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "var(--red)" }}>
        <X className="w-3 h-3 text-white" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-medium" style={{ color: "var(--text)" }}>传输失败</p>
        <p className="text-[11px] text-[var(--red)] truncate max-w-[280px]">{msg}</p>
      </div>
      <button onClick={onClose} className="btn-ghost p-1 ml-1"><X className="w-3.5 h-3.5" /></button>
    </motion.div>
  );
}

/* ── Main ── */
export function TransferManager() {
  const transfers = useTransferStore(s => s.transfers);
  const removeTransfer = useTransferStore(s => s.removeTransfer);
  const [showModal, setShowModal] = useState(false);
  const [errorToast, setErrorToast] = useState<{ id: string; msg: string } | null>(null);
  const prevActiveRef = useState(0);
  const prevErrRef = useRef<string[]>([]);

  // Auto-cleanup: done → 5s, error/cancelled → 30s (keep visible long enough to read)
  useEffect(() => {
    const done = transfers.filter(t => t.status === "done");
    const doneTimers = done.map(t => setTimeout(() => removeTransfer(t.id), 5000));
    const err = transfers.filter(t => t.status === "error" || t.status === "cancelled");
    const errTimers = err.map(t => setTimeout(() => removeTransfer(t.id), 30000));
    return () => [...doneTimers, ...errTimers].forEach(clearTimeout);
  }, [transfers]);

  // Auto-show modal on new transfers
  useEffect(() => {
    const active = transfers.filter(t => t.status === "transferring" || t.status === "pending" || t.status === "assembling").length;
    if (active > prevActiveRef[0] && active > 0) setShowModal(true);
    prevActiveRef[0] = active;
  }, [transfers]);

  // Show toast for new errors
  useEffect(() => {
    const errs = transfers.filter(t => t.status === "error" && t.error);
    const newErr = errs.find(t => !prevErrRef.current.includes(t.id));
    if (newErr) {
      prevErrRef.current = [...prevErrRef.current, newErr.id];
      setErrorToast({ id: newErr.id, msg: newErr.error! });
      const t = setTimeout(() => setErrorToast(null), 6000);
      return () => clearTimeout(t);
    }
    if (transfers.length === 0) prevErrRef.current = [];
  }, [transfers]);

  const active = transfers.filter(t => t.status === "transferring" || t.status === "pending" || t.status === "assembling");
  const hasAny = transfers.length > 0;
  if (!hasAny) return null;

  const avg = active.length > 0
    ? transfers.filter(t => t.status === "transferring" || t.status === "assembling").reduce((s, t) => s + t.progress, 0) / Math.max(1, active.length)
    : 100;
  const allDone = active.length === 0 && transfers.length > 0;

  return (
    <>
      <AnimatePresence>
        {(active.length > 0 || allDone) && (
          <TopBar onClick={() => setShowModal(p => !p)} avgProgress={avg} activeCount={active.length} allDone={allDone} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showModal && <TransferModal onClose={() => setShowModal(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {errorToast && <ErrorToast msg={errorToast.msg} onClose={() => setErrorToast(null)} />}
      </AnimatePresence>
    </>
  );
}
