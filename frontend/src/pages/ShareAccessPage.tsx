import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Cloud, Download, Lock, Folder, Eye, Archive } from "lucide-react";
import JSZip from "jszip";
import { FileIcon, LargeIcon } from "../components/FileIcon";
import { API_BASE, api, getShareStreamUrl } from "../lib/api";
import { fmtSize, fmtDate, kindLabel } from "../lib/utils";

interface ShareFile {
  index: number;
  id: string;
  name: string;
  size: number;
  mime_type: string;
  is_chunks: boolean;
  chunks_count: number;
}

interface ShareData {
  need_password?: boolean;
  files?: ShareFile[];
  has_password?: boolean;
  download_count?: number;
  is_multi?: boolean;
  // Legacy single-file fields (for backward compat with old shares)
  file_name?: string; file_size?: number; file_type?: string; mime_type?: string;
  is_chunks?: boolean; created_at?: number;
}

interface ChunkInfo { index: number; size: number; file_id: string; }

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function ShareAccessPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [password, setPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [previewFile, setPreviewFile] = useState<ShareFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewType, setPreviewType] = useState<"image" | "video" | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [allProgress, setAllProgress] = useState({ current: 0, total: 0, fileName: "", percent: 0 });
  const pwRef = useRef(password);
  pwRef.current = password;

  useEffect(() => { load(false); }, [token]);

  const pwQuery = () => pwRef.current ? `?pw=${encodeURIComponent(pwRef.current)}` : "";

  const load = async (withPw = false) => {
    try {
      const url = `${API_BASE}/s/${token}${withPw && pwRef.current ? `?pw=${encodeURIComponent(pwRef.current)}` : ""}`;
      const r = await fetch(url); const d = await r.json();
      if (d.need_password) { setData({ need_password: true } as any); setLoading(false); return; }
      if (d.success) {
        // Normalize: if old format (single file), wrap in files array
        const raw = d.data;
        if (!raw.files && raw.file_name) {
          raw.files = [{ index: 0, id: "", name: raw.file_name, size: raw.file_size, mime_type: raw.mime_type || "", is_chunks: raw.is_chunks || false, chunks_count: 0 }];
        }
        setData(raw);
      } else setPwError(d.error || "加载失败");
    } catch { setPwError("网络错误"); } finally { setLoading(false); }
  };

  const handlePassword = () => { setPwError(""); load(true); };

  const handlePreview = async (file: ShareFile) => {
    if (!token) return;
    setPreviewFile(file);
    setPreviewLoading(true);
    try {
      const mime = file.mime_type || "";
      const isImage = mime.startsWith("image/");
      const isVideo = mime.startsWith("video/");
      if (!isImage && !isVideo) { setPreviewLoading(false); return; }
      setPreviewType(isImage ? "image" : "video");
      const url = getShareStreamUrl(token, pwRef.current || undefined, file.index);
      if (isImage) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        setPreviewUrl(URL.createObjectURL(blob));
      } else {
        setPreviewUrl(url);
      }
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "预览加载失败");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async (file: ShareFile) => {
    if (!token) return;
    setDownloadingIdx(file.index); setProgress(0); setStatusText("准备下载...");
    try {
      // Step 1: Verify password
      const vRes = await api.post<{ success: boolean; error?: string }>(`/s/${token}/download`, {
        password: pwRef.current || undefined,
        verify_only: true,
        file_index: file.index,
      });
      if (!vRes.success) { setStatusText(vRes.error || "验证失败"); setDownloadingIdx(null); return; }

      if (!file.is_chunks) {
        // Direct download
        const r = await fetch(`${API_BASE}/s/${token}/download`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pwRef.current || undefined, file_index: file.index }),
        });
        if (!r.ok) { const d = await r.json(); throw new Error(d.error || "下载失败"); }
        const blob = await r.blob();
        downloadBlob(blob, file.name);
        setStatusText("下载完成");
      } else {
        // Chunked download
        setStatusText("获取分块信息...");
        const fiParam = file.index > 0 ? `&file_index=${file.index}` : "";
        const cRes = await fetch(`${API_BASE}/s/${token}/chunks${pwQuery()}${fiParam}`);
        const cData = await cRes.json();
        if (!cData.success) throw new Error(cData.error || "获取分块失败");
        const chunks: ChunkInfo[] = cData.data.chunks || [];
        const blobParts: Blob[] = new Array(chunks.length);

        for (let i = 0; i < chunks.length; i++) {
          setStatusText(`下载中 ${i + 1}/${chunks.length}`);
          setProgress(Math.round(((i + 1) / chunks.length) * 100));
          const fiQ = file.index > 0 ? `&file_index=${file.index}` : "";
          const cr = await fetch(`${API_BASE}/s/${token}/chunk/${i}${pwQuery()}${fiQ}`);
          if (!cr.ok) throw new Error(`分块 ${i} 下载失败`);
          blobParts[i] = await cr.blob();
        }
        setStatusText("组装文件中...");
        const blob = new Blob(blobParts);
        downloadBlob(blob, file.name);
        setStatusText("下载完成");
      }
    } catch (err) { setStatusText(err instanceof Error ? err.message : "下载失败"); } finally { setDownloadingIdx(null); }
  };

  const handleDownloadAll = async () => {
    if (!token || files.length === 0) return;
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    // 500MB warning
    if (totalBytes > 500 * 1024 * 1024) {
      if (!window.confirm(`全部文件总大小 ${fmtSize(totalBytes)}，超过 500MB 可能导致浏览器卡顿或崩溃。\n\n建议逐个下载。\n\n是否继续？`)) return;
    }

    setDownloadingAll(true);
    setAllProgress({ current: 0, total: files.length, fileName: "准备中...", percent: 0 });
    const zip = new JSZip();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setAllProgress({ current: i + 1, total: files.length, fileName: file.name, percent: 0 });

      try {
        // Verify password
        const vRes = await api.post<{ success: boolean; error?: string }>(`/s/${token}/download`, {
          password: pwRef.current || undefined,
          verify_only: true,
          file_index: file.index,
        });
        if (!vRes.success) {
          setAllProgress(p => ({ ...p, fileName: `${file.name} — 验证失败，已跳过` }));
          continue;
        }

        let blob: Blob;
        if (!file.is_chunks) {
          // Direct download
          const r = await fetch(`${API_BASE}/s/${token}/download`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pwRef.current || undefined, file_index: file.index }),
          });
          if (!r.ok) { const d = await r.json(); throw new Error(d.error || "下载失败"); }
          blob = await r.blob();
          setAllProgress(p => ({ ...p, percent: 100 }));
        } else {
          // Chunked download
          const fiParam = file.index > 0 ? `&file_index=${file.index}` : "";
          const cRes = await fetch(`${API_BASE}/s/${token}/chunks${pwQuery()}${fiParam}`);
          const cData = await cRes.json();
          if (!cData.success) throw new Error(cData.error || "获取分块失败");
          const chunks: ChunkInfo[] = cData.data.chunks || [];
          const blobParts: Blob[] = new Array(chunks.length);

          for (let ci = 0; ci < chunks.length; ci++) {
            const fiQ = file.index > 0 ? `&file_index=${file.index}` : "";
            const cr = await fetch(`${API_BASE}/s/${token}/chunk/${ci}${pwQuery()}${fiQ}`);
            if (!cr.ok) throw new Error(`分块 ${ci} 下载失败`);
            blobParts[ci] = await cr.blob();
            setAllProgress(p => ({ ...p, percent: Math.round(((ci + 1) / chunks.length) * 100) }));
          }
          blob = new Blob(blobParts);
        }
        zip.file(file.name, blob);
      } catch (err) {
        setAllProgress(p => ({ ...p, fileName: `${file.name} — ${err instanceof Error ? err.message : "下载失败"}` }));
      }
      // Small delay between files
      if (i < files.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    // Generate ZIP and trigger download
    setAllProgress({ current: files.length, total: files.length, fileName: "打包中...", percent: 100 });
    try {
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setAllProgress(p => ({ ...p, fileName: `打包中... ${meta.percent.toFixed(0)}%` }));
      });
      downloadBlob(zipBlob, "分享文件.zip");
      setAllProgress(p => ({ ...p, fileName: "下载完成" }));
    } catch (err) {
      setAllProgress(p => ({ ...p, fileName: `打包失败: ${err instanceof Error ? err.message : "未知错误"}` }));
    } finally {
      setTimeout(() => setDownloadingAll(false), 1500);
    }
  };

  const files: ShareFile[] = data?.files || [];

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

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="h-12 flex items-center px-4 bg-white border-b border-[var(--border-light)]">
        <div className="flex items-center gap-2">
          <Cloud className="w-5 h-5 text-[var(--brand-blue)]" />
          <span className="text-[14px] font-semibold text-[var(--text-primary)]">Cloud Nine</span>
        </div>
      </header>

      <div className="max-w-lg mx-auto mt-12 px-4">
        {data?.need_password ? (
          <motion.div className="card p-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex flex-col items-center gap-4">
              <Lock className="w-10 h-10 text-[var(--text-tertiary)]" />
              <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">此分享需要提取码</h2>
              <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="请输入提取码" className="input-primary text-center" onKeyDown={e => e.key === "Enter" && handlePassword()} />
              {pwError && <p className="text-[12px] text-[var(--brand-red)]">{pwError}</p>}
              <button onClick={handlePassword} className="btn-primary w-full py-2.5">确认</button>
            </div>
          </motion.div>
        ) : files.length > 0 ? (
          <motion.div className="card p-6" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-1">
              {data?.is_multi ? `${files.length} 个文件` : files[0].name}
            </h2>
            <p className="text-[12px] text-[var(--text-tertiary)] mb-4">
              {fmtSize(files.reduce((s, f) => s + f.size, 0))}
              {data?.download_count !== undefined ? ` · 已下载 ${data.download_count} 次` : ""}
              {data?.has_password ? " · 🔒" : ""}
            </p>

            {/* Download-all button for multi-file shares */}
            {files.length > 1 && (
              <button onClick={handleDownloadAll} disabled={downloadingAll}
                className="btn-primary w-full py-2.5 mb-3 text-[13px]">
                <Archive className="w-4 h-4" />全部下载 (.zip) · {fmtSize(files.reduce((s, f) => s + f.size, 0))}
              </button>
            )}

            {/* Bulk download progress */}
            <AnimatePresence>
              {downloadingAll && (
                <motion.div className="w-full space-y-2 mb-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-secondary)]">
                    <span>{allProgress.fileName}</span>
                    <span>{allProgress.current}/{allProgress.total}</span>
                  </div>
                  <div className="h-1.5 bg-[var(--border-light)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--brand-blue)] rounded-full transition-all duration-300" style={{ width: `${Math.max(allProgress.percent, 3)}%` }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="space-y-2">
              {files.map(f => {
                const isDownloading = downloadingIdx === f.index;
                return (
                  <div key={f.index} className="flex items-center gap-3 p-2.5 rounded-md border border-[var(--border-light)] bg-[var(--bg-secondary)]">
                    <FileIcon item={{ id: f.id || f.name, name: f.name, type: "file", size: f.size, mime_type: f.mime_type, created_at: 0, updated_at: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{f.name}</p>
                      <p className="text-[11px] text-[var(--text-tertiary)]">
                        {kindLabel({ id: "", name: "", type: "file", size: f.size, mime_type: f.mime_type, created_at: 0, updated_at: 0 })} · {fmtSize(f.size)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {(f.mime_type || "").match(/^(image|video)\//) && (
                        <button onClick={() => handlePreview(f)} disabled={previewLoading} className="btn-ghost text-[11px] px-2 py-1">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => handleDownload(f)} disabled={isDownloading} className="btn-primary text-[11px] px-2.5 py-1">
                        <Download className="w-3 h-3" />{isDownloading ? "下载中" : "下载"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Download progress */}
            <AnimatePresence>
              {downloadingIdx !== null && (
                <motion.div className="w-full space-y-2 mt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="h-1.5 bg-[var(--border-light)] rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--brand-blue)] rounded-full transition-all duration-300" style={{ width: `${Math.max(progress, 5)}%` }} />
                  </div>
                  <p className="text-[12px] text-[var(--text-tertiary)] text-center">{statusText}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Inline preview */}
            <AnimatePresence>
              {previewUrl && previewType === "image" && previewFile && (
                <motion.div className="w-full mt-4" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <p className="text-[12px] text-[var(--text-secondary)] mb-2">{previewFile.name}</p>
                  <img src={previewUrl} alt={previewFile.name} className="w-full max-h-64 object-contain rounded-md bg-black/5" />
                </motion.div>
              )}
              {previewUrl && previewType === "video" && previewFile && (
                <motion.div className="w-full mt-4" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  <p className="text-[12px] text-[var(--text-secondary)] mb-2">{previewFile.name}</p>
                  <video src={previewUrl} controls className="w-full max-h-64 rounded-md bg-black" controlsList="nodownload">
                    您的浏览器不支持视频播放
                  </video>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <div className="card p-8 text-center">
            <Folder className="w-10 h-10 text-[var(--text-disabled)] mx-auto mb-3" />
            <p className="text-[var(--text-tertiary)]">{pwError || "分享不存在或已过期"}</p>
          </div>
        )}
      </div>
    </div>
  );
}
