import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Cloud, Download, Lock, Folder, Archive, ChevronRight, LayoutGrid, List, Eye } from "lucide-react";
import JSZip from "jszip";
import { FileIcon, LargeIcon } from "../components/FileIcon";
import { ContextMenu } from "../components/ContextMenu";
import { PreviewModal } from "../components/PreviewModal";
import { API_BASE, api, getShareStreamUrl } from "../lib/api";
import { fmtSize, isPreviewable } from "../lib/utils";
import { useIsMobile } from "../hooks/useIsMobile";
import type { FileItem } from "../stores/fileStore";
import type { ViewMode } from "../types/ui";

interface ShareFile {
  index: number;
  id: string;
  name: string;
  type?: "file" | "folder";
  size: number;
  mime_type: string;
  is_chunks: boolean;
  chunks_count: number;
}

interface Breadcrumb { id: string; name: string; }

interface ShareData {
  need_password?: boolean;
  files?: ShareFile[];
  has_password?: boolean;
  download_count?: number;
  max_downloads?: number;
  is_multi?: boolean;
  is_folder?: boolean;
  is_folders?: boolean;
  folder_name?: string;
  folder_id?: string;
  root_folder_id?: string;
  root_folder_ids?: string[];
  breadcrumbs?: Breadcrumb[];
  file_name?: string; file_size?: number; file_type?: string; mime_type?: string;
  is_chunks?: boolean; created_at?: number;
}

interface ChunkInfo { index: number; size: number; file_id: string; }

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** ShareFile → FileItem adapter for FileTable/FileGrid */
function toFileItem(f: ShareFile): FileItem {
  return {
    id: f.id || f.name,
    name: f.name,
    type: f.type || "file",
    size: f.size,
    mime_type: f.mime_type || "",
    is_chunks: f.is_chunks || false,
    created_at: 0,
    updated_at: 0,
  };
}

export function ShareAccessPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ShareData | null>(null);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [allProgress, setAllProgress] = useState({ current: 0, total: 0, fileName: "", percent: 0 });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [ctx, setCtx] = useState<{ item: FileItem; x: number; y: number } | null>(null);
  const isMobile = useIsMobile();
  const pwRef = useRef(password);
  pwRef.current = password;

  useEffect(() => { load(false); }, [token]);

  const shareUrl = (path: string, fileIndex?: number, folderId?: string): string => {
    const params = new URLSearchParams();
    if (pwRef.current) params.set("pw", pwRef.current);
    if (fileIndex !== undefined && fileIndex > 0) params.set("file_index", String(fileIndex));
    if (folderId) params.set("folder_id", folderId);
    const qs = params.toString();
    return `${API_BASE}${path}${qs ? `?${qs}` : ""}`;
  };

  const load = async (withPw = false, folderId?: string) => {
    setLoading(true);
    try {
      let url = `${API_BASE}/s/${token}`;
      const params = new URLSearchParams();
      if (withPw && pwRef.current) params.set("pw", pwRef.current);
      if (folderId) params.set("folder_id", folderId);
      const qs = params.toString();
      if (qs) url += `?${qs}`;

      const r = await fetch(url); const d = await r.json();
      if (d.need_password) { setData({ need_password: true } as any); setLoading(false); return; }
      if (d.success) {
        const raw = d.data;
        if (!raw.files && raw.file_name) {
          raw.files = [{ index: 0, id: "", name: raw.file_name, size: raw.file_size, mime_type: raw.mime_type || "", is_chunks: raw.is_chunks || false, chunks_count: 0 }];
        }
        if (raw.is_folder) {
          if (!currentFolderId) setCurrentFolderId(raw.folder_id);
          setBreadcrumbs(raw.breadcrumbs || []);
        }
        setData(raw);
      } else setPwError(d.error || "加载失败");
    } catch { setPwError("网络错误"); } finally { setLoading(false); }
  };

  const handlePassword = () => { setPwError(""); load(true); };
  const handleNavigateFolder = (folderId: string) => { setCurrentFolderId(folderId); load(false, folderId); };
  const handleBreadcrumbClick = (folderId: string) => { setCurrentFolderId(folderId); load(false, folderId); };

  const files: ShareFile[] = data?.files || [];
  const fileItems: FileItem[] = useMemo(() => files.map(toFileItem), [files]);
  const isFolderShare = data?.is_folder === true;
  const fileOnlyTotal = files.filter(f => f.type !== "folder").reduce((s, f) => s + f.size, 0);

  // ===== Download logic (unchanged) =====

  const handleDownload = async (file: ShareFile) => {
    if (!token) return;
    setDownloadingIdx(file.index); setProgress(0); setStatusText("准备下载...");
    try {
      const folderId = currentFolderId || undefined;
      const vBody: any = { password: pwRef.current || undefined, verify_only: true, file_index: file.index };
      if (folderId) vBody.folder_id = folderId;
      const vRes = await api.post<{ success: boolean; error?: string }>(`/s/${token}/download`, vBody);
      if (!vRes.success) { setStatusText(vRes.error || "验证失败"); setDownloadingIdx(null); return; }

      if (!file.is_chunks) {
        const dBody: any = { password: pwRef.current || undefined, file_index: file.index };
        if (folderId) dBody.folder_id = folderId;
        const r = await fetch(`${API_BASE}/s/${token}/download`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dBody),
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || "下载失败"); }
        downloadBlob(await r.blob(), file.name);
        setStatusText("下载完成");
      } else {
        setStatusText("获取分块信息...");
        const cRes = await fetch(shareUrl(`/s/${token}/chunks`, file.index, folderId));
        const cData = await cRes.json();
        if (!cData.success) throw new Error(cData.error || "获取分块失败");
        const chunks: ChunkInfo[] = cData.data.chunks || [];
        const blobParts: Blob[] = new Array(chunks.length);
        for (let i = 0; i < chunks.length; i++) {
          setStatusText(`下载中 ${i + 1}/${chunks.length}`);
          setProgress(Math.round(((i + 1) / chunks.length) * 100));
          const cr = await fetch(shareUrl(`/s/${token}/chunk/${i}`, file.index, folderId));
          if (!cr.ok) throw new Error(`分块 ${i} 下载失败`);
          const cblob = await cr.blob();
          const expected = chunks[i]?.size;
          if (expected > 0 && cblob.size !== expected) throw new Error(`分块 ${i} 不完整`);
          if ((!expected || expected === 0) && cblob.size === 0) throw new Error(`分块 ${i} 为空`);
          blobParts[i] = cblob;
        }
        setStatusText("组装文件中...");
        const blob = new Blob(blobParts);
        if (blob.size !== file.size) throw new Error(`文件不完整: 期望 ${file.size} 字节, 实际 ${blob.size} 字节`);
        downloadBlob(blob, file.name);
        setStatusText("下载完成");
      }
    } catch (err) { setStatusText(err instanceof Error ? err.message : "下载失败"); } finally { setDownloadingIdx(null); }
  };

  const handleDownloadAll = async () => {
    if (!token || files.length === 0) return;
    const fileItems = files.filter(f => f.type !== "folder");
    const totalBytes = fileItems.reduce((s, f) => s + f.size, 0);
    if (totalBytes > 500 * 1024 * 1024) {
      if (!window.confirm(`全部文件总大小 ${fmtSize(totalBytes)}，超过 500MB 可能导致浏览器卡顿或崩溃。\n\n建议逐个下载。\n\n是否继续？`)) return;
    }
    const maxDl = data?.max_downloads;
    const currentDl = data?.download_count || 0;
    if (maxDl && maxDl > 0 && currentDl + fileItems.length > maxDl) {
      const remaining = maxDl - currentDl;
      alert(`下载次数限制：最多 ${maxDl} 次，已使用 ${currentDl} 次，剩余 ${Math.max(0, remaining)} 次。\n\n当前操作需要下载 ${fileItems.length} 个文件，超出配额。请减少选择或逐个下载。`);
      return;
    }
    setDownloadingAll(true);
    setAllProgress({ current: 0, total: fileItems.length, fileName: "准备中...", percent: 0 });
    const zip = new JSZip();
    const folderId = currentFolderId || undefined;
    for (let i = 0; i < fileItems.length; i++) {
      const file = fileItems[i];
      setAllProgress({ current: i + 1, total: fileItems.length, fileName: file.name, percent: 0 });
      try {
        const dBody: any = { password: pwRef.current || undefined, verify_only: true, file_index: file.index };
        if (folderId) dBody.folder_id = folderId;
        const vRes = await api.post<{ success: boolean; error?: string }>(`/s/${token}/download`, dBody);
        if (!vRes.success) { setAllProgress(p => ({ ...p, fileName: `${file.name} — 验证失败，已跳过` })); continue; }
        let blob: Blob;
        if (!file.is_chunks) {
          const r = await fetch(`${API_BASE}/s/${token}/download`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pwRef.current || undefined, file_index: file.index, ...(folderId ? { folder_id: folderId } : {}) }),
          });
          if (!r.ok) { const d = await r.json(); throw new Error(d.error || "下载失败"); }
          blob = await r.blob(); setAllProgress(p => ({ ...p, percent: 100 }));
        } else {
          const cRes = await fetch(shareUrl(`/s/${token}/chunks`, file.index, folderId));
          const cData = await cRes.json();
          if (!cData.success) throw new Error(cData.error || "获取分块失败");
          const chunks: ChunkInfo[] = cData.data.chunks || [];
          const blobParts: Blob[] = new Array(chunks.length);
          for (let ci = 0; ci < chunks.length; ci++) {
            const cr = await fetch(shareUrl(`/s/${token}/chunk/${ci}`, file.index, folderId));
            if (!cr.ok) throw new Error(`分块 ${ci} 下载失败`);
            const cblob = await cr.blob();
            const expected = chunks[ci]?.size;
            if (expected > 0 && cblob.size !== expected) throw new Error(`分块 ${ci} 不完整`);
            if ((!expected || expected === 0) && cblob.size === 0) throw new Error(`分块 ${ci} 为空`);
            blobParts[ci] = cblob;
            setAllProgress(p => ({ ...p, percent: Math.round(((ci + 1) / chunks.length) * 100) }));
          }
          blob = new Blob(blobParts);
          if (blob.size !== file.size) throw new Error(`文件不完整`);
        }
        zip.file(file.name, blob);
      } catch (err) {
        setAllProgress(p => ({ ...p, fileName: `${file.name} — ${err instanceof Error ? err.message : "下载失败"}` }));
      }
      if (i < fileItems.length - 1) await new Promise(r => setTimeout(r, 200));
    }
    setAllProgress({ current: fileItems.length, total: fileItems.length, fileName: "打包中...", percent: 100 });
    try {
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setAllProgress(p => ({ ...p, fileName: `打包中... ${meta.percent.toFixed(0)}%` }));
      });
      downloadBlob(zipBlob, "分享文件.zip");
      setAllProgress(p => ({ ...p, fileName: "下载完成" }));
    } catch (err) {
      setAllProgress(p => ({ ...p, fileName: `打包失败: ${err instanceof Error ? err.message : "未知错误"}` }));
    } finally { setTimeout(() => setDownloadingAll(false), 1500); }
  };

  // ===== Rendering =====

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Cloud className="w-10 h-10 text-[var(--text-disabled)] animate-pulse" />
          <p className="text-[var(--text-tertiary)] text-[13px]">加载中...</p>
        </div>
      </div>
    );
  }

  // ===== MOBILE UI =====
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
        {/* Mobile Header */}
        <header className="h-12 flex items-center px-4 flex-shrink-0 z-30"
          style={{ background: 'rgba(245,245,247,0.8)', backdropFilter: 'blur(20px)', borderBottom: '0.5px solid rgba(0,0,0,0.08)' }}>
          <button onClick={() => navigate("/app")} className="flex items-center gap-2 cursor-pointer">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0071E3, #5AC8FA)' }}>
              <Cloud className="w-3.5 h-3.5 text-white" strokeWidth={2} />
            </div>
            <span className="text-[14px] font-semibold text-[var(--text-primary)]">
              {data?.is_folders && breadcrumbs.length === 0
                ? `${files.length} 个共享文件夹`
                : isFolderShare ? "分享的文件夹" : "分享的文件"}
            </span>
          </button>
        </header>

        {data?.need_password ? (
          <div className="flex-1 flex items-center justify-center px-4">
            <motion.div className="card p-6 w-full max-w-sm" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <div className="flex flex-col items-center gap-4">
                <Lock className="w-10 h-10 text-[var(--text-tertiary)]" />
                <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">此分享需要提取码</h2>
                <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入提取码" className="input-primary text-center" onKeyDown={e => e.key === "Enter" && handlePassword()} />
                {pwError && <p className="text-[12px] text-[var(--brand-red)]">{pwError}</p>}
                <button onClick={handlePassword} className="btn-primary w-full py-2.5">确认</button>
              </div>
            </motion.div>
          </div>
        ) : files.length > 0 ? (
          <>
            {/* Breadcrumbs */}
            {isFolderShare && breadcrumbs.length > 0 && (
              <div className="h-10 flex items-center px-4 overflow-x-auto flex-shrink-0"
                style={{ background: 'rgba(245,245,247,0.7)', backdropFilter: 'blur(12px)', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                <div className="flex items-center gap-1 text-[12px] whitespace-nowrap">
                  {breadcrumbs.map((b, i) => (
                    <span key={b.id} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="w-3 h-3 text-[var(--text-disabled)]" />}
                      <button onClick={() => handleBreadcrumbClick(b.id)}
                        className={`px-1 rounded ${i === breadcrumbs.length - 1 ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}>{b.name}</button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Action bar */}
            <div className="flex items-center justify-between px-4 py-2 flex-shrink-0" style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
              <div className="flex bg-[rgba(0,0,0,0.04)] rounded-full p-0.5">
                {[{ m: "list" as ViewMode, ico: List }, { m: "grid" as ViewMode, ico: LayoutGrid }].map(({ m, ico: Icon }) => (
                  <button key={m} onClick={() => setViewMode(m)} className={`p-1.5 rounded-full transition-colors ${viewMode === m ? "bg-white shadow-sm text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}><Icon className="w-3.5 h-3.5" /></button>
                ))}
              </div>
              <span className="text-[11px] text-[var(--text-tertiary)]">{files.length} 项{fileOnlyTotal > 0 ? ` · ${fmtSize(fileOnlyTotal)}` : ""}</span>
              {files.filter(f => f.type !== "folder").length > 1 && (
                <button onClick={handleDownloadAll} disabled={downloadingAll}
                  className="btn-primary text-[12px] px-3 py-1">
                  <Archive className="w-3 h-3" />全部下载
                </button>
              )}
            </div>

            {/* Download progress */}
            <AnimatePresence>
              {downloadingAll && (
                <motion.div className="px-4 py-1.5 flex-shrink-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] mb-1">
                    <span className="truncate">{allProgress.fileName}</span>
                    <span>{allProgress.current}/{allProgress.total}</span>
                  </div>
                  <div className="h-1.5 bg-[var(--border-light)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--brand-blue)] rounded-full transition-all duration-300" style={{ width: `${Math.max(allProgress.percent, 3)}%` }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
              {viewMode === "list" ? (
                <div className="px-3 py-2 space-y-1">
                  {files.map((f, i) => {
                    const isFile = f.type !== "folder";
                    const item = fileItems[i];
                    return (
                      <div key={f.index}
                        className="flex items-center gap-3 px-3 py-2.5 bg-[var(--bg-card)] rounded-xl transition-all cursor-pointer active:scale-[0.98]"
                        onClick={() => isFile ? handleDownload(f) : handleNavigateFolder(f.id)}
                        onContextMenu={e => { e.preventDefault(); setCtx({ item, x: e.clientX, y: e.clientY }); }}>
                        <FileIcon item={item} />
                        <div className="flex-1 min-w-0">
                          <span className="text-[13px] font-medium text-[var(--text-primary)] truncate block">{f.name}</span>
                          <span className="text-[11px] text-[var(--text-tertiary)]">
                            {isFile ? `${fmtSize(f.size)}` : "文件夹"}
                          </span>
                        </div>
                        {isFile && (
                          <button onClick={e => { e.stopPropagation(); handleDownload(f); }}
                            className="btn-primary text-[11px] px-2.5 py-1 flex-shrink-0">
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 grid grid-cols-3 gap-2.5">
                  {files.map((f, i) => {
                    const isFile = f.type !== "folder";
                    const item = fileItems[i];
                    return (
                      <div key={f.index}
                        className="card p-2.5 cursor-pointer active:scale-[0.97] transition-all"
                        onClick={() => isFile ? handleDownload(f) : handleNavigateFolder(f.id)}
                        onContextMenu={e => { e.preventDefault(); setCtx({ item, x: e.clientX, y: e.clientY }); }}>
                        <LargeIcon item={item} />
                        <p className="text-[11px] font-medium text-[var(--text-primary)] truncate mt-1.5 text-center">{f.name}</p>
                        <p className="text-[10px] text-[var(--text-tertiary)] text-center">{isFile ? fmtSize(f.size) : "文件夹"}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="card p-8 text-center">
              <Folder className="w-10 h-10 text-[var(--text-disabled)] mx-auto mb-3" />
              <p className="text-[var(--text-tertiary)]">{pwError || "分享不存在或已过期"}</p>
            </div>
          </div>
        )}

        {/* Context menu */}
        <AnimatePresence>
          {ctx && (
            <div className="fixed inset-0 z-[99]" onClick={() => setCtx(null)}>
              <div style={{ position: "fixed", left: Math.min(ctx.x, window.innerWidth - 170), top: Math.min(ctx.y, window.innerHeight - 150) }}>
                <ContextMenu item={ctx.item} onClose={() => setCtx(null)}
                  onShare={() => setCtx(null)}
                  onRename={() => setCtx(null)}
                  onDownload={() => { const sf = files.find(f => (f.id || f.name) === ctx.item.id); if (sf) handleDownload(sf); setCtx(null); }}
                  onMove={() => setCtx(null)}
                  onDelete={() => setCtx(null)}
                  onPreview={isPreviewable(ctx.item) ? () => { setPreviewFile(ctx.item); setCtx(null); } : undefined} />
              </div>
            </div>
          )}
        </AnimatePresence>

        {/* Preview modal */}
        <AnimatePresence>
          {previewFile && (
            <PreviewModal key={previewFile.id} item={previewFile} files={fileItems} onClose={() => setPreviewFile(null)} />
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ===== DESKTOP UI =====
  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <header className="h-12 flex items-center px-4 flex-shrink-0"
        style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border)' }}>
        <button onClick={() => navigate("/app")} title="返回网盘" className="flex items-center gap-2 cursor-pointer transition-opacity hover:opacity-75">
          <Cloud className="w-5 h-5 text-[var(--brand-blue)]" />
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">Cloud Nine</span>
        </button>
        <span className="mx-3 text-[var(--text-disabled)]">|</span>
        <span className="text-[13px] text-[var(--text-secondary)] truncate">分享的文件</span>
      </header>

      {/* Password gate */}
      {data?.need_password ? (
        <div className="flex-1 flex items-center justify-center">
          <motion.div className="card p-8 w-[360px] max-w-[90vw]" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex flex-col items-center gap-4">
              <Lock className="w-10 h-10 text-[var(--text-tertiary)]" />
              <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">此分享需要提取码</h2>
              <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入提取码" className="input-primary text-center" onKeyDown={e => e.key === "Enter" && handlePassword()} />
              {pwError && <p className="text-[12px] text-[var(--brand-red)]">{pwError}</p>}
              <button onClick={handlePassword} className="btn-primary w-full py-2.5">确认</button>
            </div>
          </motion.div>
        </div>
      ) : files.length > 0 ? (
        <>
          {/* Finder toolbar */}
          <div className="h-[60px] flex items-center justify-between px-5 flex-shrink-0"
            style={{ background: 'var(--bg-glass)', backdropFilter: 'blur(24px) saturate(180%)', borderBottom: '0.5px solid var(--border)' }}>
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Breadcrumbs or title */}
              {isFolderShare && breadcrumbs.length > 0 ? (
                <div className="flex items-baseline gap-1.5 min-w-0">
                  {breadcrumbs.map((b, i) => (
                    <span key={b.id} className="flex items-center gap-1.5 flex-shrink-0">
                      {i > 0 && <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-disabled)' }} />}
                      <button onClick={() => handleBreadcrumbClick(b.id)}
                        className={`truncate max-w-[220px] transition-colors rounded ${i === breadcrumbs.length - 1 ? "text-[26px] font-semibold tracking-tight" : "text-[22px] font-medium hover:text-[var(--text)]"}`}
                        style={{ color: i === breadcrumbs.length - 1 ? 'var(--text)' : 'var(--text-tertiary)' }}>
                        {b.name}
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <h1 className="text-[26px] font-semibold tracking-tight truncate" style={{ color: 'var(--text)' }}>
                  {data?.is_folders && breadcrumbs.length === 0
                    ? `${files.length} 个共享文件夹`
                    : isFolderShare
                    ? data?.folder_name || "文件夹"
                    : data?.is_multi ? "分享的文件" : files[0]?.name || "分享的文件"}
                </h1>
              )}
            </div>

            {/* Right: view toggle + download-all */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex rounded-full p-[3px]" style={{ background: 'var(--bg-input)' }}>
                {[{ m: "list" as ViewMode, ico: List }, { m: "grid" as ViewMode, ico: LayoutGrid }].map(({ m, ico: Icon }) => (
                  <button key={m} onClick={() => setViewMode(m)} className={`p-1.5 rounded-full transition-colors ${viewMode === m ? "bg-[var(--bg-elev)] shadow-sm text-[var(--text)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
              {files.filter(f => f.type !== "folder").length > 1 && (
                <button onClick={handleDownloadAll} disabled={downloadingAll}
                  className="btn-primary text-[13px] px-4 py-1.5">
                  <Archive className="w-3.5 h-3.5" />全部下载 (.zip)
                </button>
              )}
            </div>
          </div>

          {/* Bulk download progress bar */}
          <AnimatePresence>
            {downloadingAll && (
              <motion.div className="flex items-center gap-3 px-4 py-1.5 bg-[rgba(91,135,49,0.1)] border-b border-[#5B8731]/20 flex-shrink-0"
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 40 }} exit={{ opacity: 0, height: 0 }}>
                <Archive className="w-3.5 h-3.5 text-[#5B8731] flex-shrink-0" />
                <span className="text-[11px] text-[#9CA3AF] truncate flex-1">{allProgress.fileName}</span>
                <span className="text-[11px] text-[#9CA3AF] flex-shrink-0">{allProgress.current}/{allProgress.total}</span>
                <div className="w-20 flex-shrink-0">
                  <div className="h-2 bg-[rgba(0,0,0,0.06)] rounded-full overflow-hidden">
                    <div className="h-full bg-[#5B8731] rounded-full transition-all duration-300" style={{ width: `${Math.max(allProgress.percent, 3)}%` }} />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* File list area */}
          <div className="flex-1 overflow-y-auto">
            {viewMode === "list" ? (
              <ListView files={files} fileItems={fileItems} isFolderShare={isFolderShare}
                downloadingIdx={downloadingIdx} progress={progress} statusText={statusText}
                onNavigateFolder={handleNavigateFolder}
                onDownload={handleDownload} onPreview={setPreviewFile}
                onContextMenu={(item, x, y) => setCtx({ item, x, y })} />
            ) : (
              <GridView files={files} fileItems={fileItems} isFolderShare={isFolderShare}
                onNavigateFolder={handleNavigateFolder}
                onDownload={handleDownload} onPreview={setPreviewFile}
                onContextMenu={(item, x, y) => setCtx({ item, x, y })} />
            )}
          </div>

          {/* Status bar */}
          <div className="h-8 flex items-center justify-between px-4 flex-shrink-0"
            style={{ background: 'var(--bg-glass)', borderTop: '0.5px solid var(--border)' }}>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {files.length} 个项目
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {fileOnlyTotal > 0 ? fmtSize(fileOnlyTotal) : ""}
              {data?.download_count !== undefined ? ` · 已下载 ${data.download_count} 次` : ""}
            </span>
          </div>
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="card p-8 text-center">
            <Folder className="w-10 h-10 text-[var(--text-disabled)] mx-auto mb-3" />
            <p className="text-[var(--text-tertiary)]">{pwError || "分享不存在或已过期"}</p>
          </div>
        </div>
      )}

      {/* Context menu */}
      <AnimatePresence>
        {ctx && (
          <div className="fixed inset-0 z-[99]" onClick={() => setCtx(null)}>
            <div style={{ position: "fixed", left: Math.min(ctx.x, window.innerWidth - 180), top: Math.min(ctx.y, window.innerHeight - 180) }}>
              <ShareContextMenu item={ctx.item}
                onClose={() => setCtx(null)}
                onDownload={() => { const sf = files.find(f => (f.id || f.name) === ctx.item.id); if (sf) handleDownload(sf); setCtx(null); }}
                onPreview={isPreviewable(ctx.item) ? () => { setPreviewFile(ctx.item); setCtx(null); } : undefined} />
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Preview modal */}
      <AnimatePresence>
        {previewFile && (
          <PreviewModal key={previewFile.id} item={previewFile} files={fileItems} onClose={() => setPreviewFile(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== Sub-components =====

function ShareContextMenu({ item, onClose, onDownload, onPreview }: {
  item: FileItem; onClose: () => void; onDownload: () => void; onPreview?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const menuItems = [
    ...(onPreview ? [{ icon: Eye, label: "预览", action: onPreview }] : []),
    { icon: Download, label: "下载", action: onDownload },
  ];

  return (
    <motion.div ref={ref} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.12 }}
      className="context-menu fixed z-[100] w-36">
      {menuItems.map((e, i) => {
        const IconComp = e.icon as React.FC<{ className?: string; strokeWidth?: number }>;
        return (
          <button key={i} className="context-menu-item" onClick={e.action}>
            <IconComp className="w-[18px] h-[18px]" strokeWidth={1.4} />{e.label}
          </button>
        );
      })}
    </motion.div>
  );
}

function ListView({ files, fileItems, isFolderShare, downloadingIdx, progress, statusText, onNavigateFolder, onDownload, onPreview, onContextMenu }: {
  files: ShareFile[]; fileItems: FileItem[]; isFolderShare: boolean; downloadingIdx: number | null; progress: number; statusText: string;
  onNavigateFolder: (id: string) => void; onDownload: (f: ShareFile) => void; onPreview: (f: FileItem) => void;
  onContextMenu: (item: FileItem, x: number, y: number) => void;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th className="text-left px-4 py-2.5 text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>名称</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>大小</th>
          <th className="text-left px-4 py-2.5 text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>类型</th>
          <th className="text-right px-4 py-2.5 text-[11px] font-medium" style={{ color: 'var(--text-tertiary)' }}>操作</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f, i) => {
          const isFile = f.type !== "folder";
          const isDownloading = downloadingIdx === f.index && isFile;
          const item = fileItems[i];
          return (
            <tr key={f.index}
              className={`cursor-pointer ${isFile ? "hover:bg-[var(--brand-blue-light)]" : ""}`}
              onClick={() => isFile ? onDownload(f) : onNavigateFolder(f.id)}
              onDoubleClick={() => isFile && isPreviewable(item) ? onPreview(item) : undefined}
              onContextMenu={(e) => { e.preventDefault(); onContextMenu(item, e.clientX, e.clientY); }}>
              <td className="px-4 py-2">
                <div className="flex items-center gap-2.5">
                  <FileIcon item={item} />
                  <span className="text-[13px] font-medium text-[var(--text-primary)] truncate max-w-[300px]">{f.name}</span>
                </div>
              </td>
              <td className="px-4 py-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                {isFile ? fmtSize(f.size) : "—"}
              </td>
              <td className="px-4 py-2 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                {isFile ? (f.mime_type?.split("/")[1]?.toUpperCase() || "文件") : "文件夹"}
              </td>
              <td className="px-4 py-2 text-right">
                {isFile && (
                  <button onClick={(e) => { e.stopPropagation(); onDownload(f); }} disabled={isDownloading}
                    className="btn-primary text-[11px] px-2.5 py-1">
                    <Download className="w-3 h-3" />{isDownloading ? `${progress}%` : "下载"}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function GridView({ files, fileItems, isFolderShare, onNavigateFolder, onDownload, onPreview, onContextMenu }: {
  files: ShareFile[]; fileItems: FileItem[]; isFolderShare: boolean;
  onNavigateFolder: (id: string) => void; onDownload: (f: ShareFile) => void; onPreview: (f: FileItem) => void;
  onContextMenu: (item: FileItem, x: number, y: number) => void;
}) {
  return (
    <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {files.map((f, i) => {
        const isFile = f.type !== "folder";
        const item = fileItems[i];
        const previewable = isFile && isPreviewable(item);
        return (
          <div key={f.index}
            className="flex flex-col items-center gap-2 p-3 rounded-xl cursor-pointer transition-all hover:bg-[var(--bg-secondary)]"
            onClick={() => isFile ? onDownload(f) : onNavigateFolder(f.id)}
            onDoubleClick={() => previewable ? onPreview(item) : undefined}
            onContextMenu={(e) => { e.preventDefault(); onContextMenu(item, e.clientX, e.clientY); }}>
            <LargeIcon item={item} />
            <span className="text-[12px] font-medium text-[var(--text-primary)] truncate max-w-full text-center leading-tight">{f.name}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {isFile ? fmtSize(f.size) : "文件夹"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
