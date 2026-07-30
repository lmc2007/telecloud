import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud, Upload, Search, FolderPlus, Folder,
  ChevronRight, Home, LayoutGrid, List, Settings, LogOut, Menu,
  Clock, Share2, Trash2, Archive, Download,
} from "lucide-react";
import JSZip from "jszip";
import { useNavigate } from "react-router-dom";
import { useFileStore, type FileItem } from "../stores/fileStore";
import { useAuthStore } from "../stores/authStore";
import { useTransferStore } from "../stores/transferStore";
import { API_BASE, api } from "../lib/api";
import { useIsMobile } from "../hooks/useIsMobile";
import { fmtSize, fmtDate, kindLabel } from "../lib/utils";
import { FileIcon, LargeIcon } from "../components/FileIcon";
import { ContextMenu } from "../components/ContextMenu";
import { ShareModal } from "../components/ShareModal";
import { RenameModal } from "../components/RenameModal";
import { MoveModal } from "../components/MoveModal";
import { SettingsModal } from "../components/SettingsModal";
import { TransferManager } from "../components/TransferManager";
import { UploadZone } from "../components/UploadZone";
import { Sidebar } from "../components/Sidebar";
import { FileTable } from "../components/FileTable";
import { FileGrid } from "../components/FileGrid";
import { PreviewModal } from "../components/PreviewModal";
import { TrashPage } from "./TrashPage";
import { SharesPage } from "./SharesPage";
import { ShareAccessPage } from "./ShareAccessPage";
import { isPreviewable } from "../lib/utils";
import type { PageView, ViewMode, SortKey, SortDir } from "../types/ui";

export type { PageView, ViewMode, SortKey, SortDir };

// ===== MAIN FILEMANAGER =====
export function FileManager() {
  const navigate = useNavigate();
  const { files, isLoading, fetchFiles, navigateTo, breadcrumbs, createFolder, deleteFile } = useFileStore();
  const { user, logout } = useAuthStore();
  const { addTransfer, updateTransfer } = useTransferStore();
  const accessToken = useAuthStore(s => s.accessToken);

  const [currentPage, setCurrentPage] = useState<PageView>("files");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [shareFiles, setShareFiles] = useState<FileItem[]>([]);
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [moveFiles, setMoveFiles] = useState<FileItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [ctx, setCtx] = useState<{ item: FileItem; x: number; y: number } | null>(null);
  const [searchRes, setSearchRes] = useState<FileItem[] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [downloadingMulti, setDownloadingMulti] = useState(false);
  const [multiProgress, setMultiProgress] = useState({ current: 0, total: 0, fileName: "", percent: 0 });
  const st = useRef<ReturnType<typeof setTimeout>>();
  const isMobile = useIsMobile();

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // Listen for preview navigation events (from PreviewModal arrows)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FileItem>).detail;
      if (detail) setPreviewFile(detail);
    };
    window.addEventListener("tcd:preview-navigate", handler);
    return () => window.removeEventListener("tcd:preview-navigate", handler);
  }, []);

  const handleLogout = async () => {
    try { await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } }); } catch {}
    logout(); navigate("/login");
  };

  const handleSearch = (v: string) => {
    setSearchQuery(v);
    if (st.current) clearTimeout(st.current);
    if (!v.trim()) { setSearchRes(null); return; }
    st.current = setTimeout(async () => {
      try { const r = await fetch(`${API_BASE}/files/search?q=${encodeURIComponent(v.trim())}`, { headers: { Authorization: `Bearer ${accessToken}` } }); const d = await r.json(); if (d.success) setSearchRes(d.data); } catch {}
    }, 300);
  };

  const handleCreateFolder = async (e: React.FormEvent) => { e.preventDefault(); if (!folderName.trim()) return; try { await createFolder(folderName.trim()); setFolderName(""); setShowNewFolder(false); } catch {} };

  // Shared: download a single file and return its Blob
  const downloadFileBlob = async (item: FileItem, onChunk?: (done: number, total: number) => void): Promise<Blob> => {
    if (!item.is_chunks) {
      const res = await api.rawFetch(`/files/${item.id}/download`);
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
      return await res.blob();
    }
    const infoRes = await api.rawFetch(`/files/${item.id}/chunks`);
    const infoData = await infoRes.json();
    if (!infoData.success) throw new Error(infoData.error || "获取分块信息失败");
    const chunks: { index: number; size: number }[] = infoData.data.chunks || [];
    if (chunks.length <= 1) {
      const res = await api.rawFetch(`/files/${item.id}/download`);
      if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
      return await res.blob();
    }
    const chunkBlobs: Blob[] = new Array(chunks.length);
    const fetchChunk = async (i: number, retries = 3): Promise<Blob> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const r = await api.rawFetch(`/files/${item.id}/chunk/${i}`);
          if (!r.ok) throw new Error(`chunk ${i} HTTP ${r.status}`);
          return await r.blob();
        } catch (e) {
          if (attempt === retries) throw e;
          const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          await new Promise(r => setTimeout(r, delay));
        }
      }
      throw new Error("unreachable");
    };
    for (let i = 0; i < chunks.length; i++) {
      chunkBlobs[i] = await fetchChunk(i);
      if (onChunk) onChunk(i + 1, chunks.length);
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200));
    }
    return new Blob(chunkBlobs);
  };

  const handleDownload = async (item: FileItem) => {
    const tid = crypto.randomUUID();
    const ac = new AbortController();
    addTransfer({ id: tid, type: "download", fileName: item.name, fileSize: item.size, progress: 0, status: "pending", speed: 0, abortController: ac });
    try {
      updateTransfer(tid, { status: "transferring" });
      const blob = await downloadFileBlob(item, (done, total) => {
        updateTransfer(tid, { chunksDone: done, progress: Math.round((done / total) * 100) });
      });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = item.name; a.click(); URL.revokeObjectURL(url);
      updateTransfer(tid, { status: "done", progress: 100 });
    } catch (err) { updateTransfer(tid, { status: "error", error: err instanceof Error ? err.message : "下载失败" }); }
  };

  const handleDownloadSelected = async () => {
    const items = filteredFiles.filter(f => selected.has(f.id) && f.type === "file");
    if (items.length === 0) return;
    const totalBytes = items.reduce((s, f) => s + f.size, 0);
    if (totalBytes > 500 * 1024 * 1024) {
      if (!window.confirm(`全部文件总大小 ${fmtSize(totalBytes)}，超过 500MB 可能导致浏览器卡顿。\n\n是否继续？`)) return;
    }
    setDownloadingMulti(true);
    setMultiProgress({ current: 0, total: items.length, fileName: "准备中...", percent: 0 });
    setCtx(null);
    const zip = new JSZip();
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      setMultiProgress({ current: i + 1, total: items.length, fileName: f.name, percent: 0 });
      try {
        const blob = await downloadFileBlob(f, (done, total) => {
          setMultiProgress(p => ({ ...p, percent: Math.round((done / total) * 100) }));
        });
        zip.file(f.name, blob);
      } catch (err) {
        setMultiProgress(p => ({ ...p, fileName: `${f.name} — ${err instanceof Error ? err.message : "下载失败"}` }));
        await new Promise(r => setTimeout(r, 800));
      }
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 200));
    }
    setMultiProgress({ current: items.length, total: items.length, fileName: "打包中...", percent: 100 });
    try {
      const zipBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
        setMultiProgress(p => ({ ...p, fileName: `打包中... ${meta.percent.toFixed(0)}%` }));
      });
      const url = URL.createObjectURL(zipBlob); const a = document.createElement("a"); a.href = url; a.download = "文件.zip"; a.click(); URL.revokeObjectURL(url);
      setMultiProgress(p => ({ ...p, fileName: "下载完成" }));
    } catch (err) {
      setMultiProgress(p => ({ ...p, fileName: `打包失败: ${err instanceof Error ? err.message : "未知错误"}` }));
    } finally {
      setTimeout(() => setDownloadingMulti(false), 2000);
    }
  };

  const handleNavigate = (page: PageView) => {
    setCurrentPage(page);
    setSelected(new Set());
    if (page === "trash") useFileStore.getState().fetchTrash();
    if (page !== "trash" && page !== "shares") useFileStore.getState().fetchFiles();
  };

  const filteredFiles = useMemo(() => {
    if (searchRes && searchQuery.trim()) return searchRes;
    let result = [...files];
    if (currentPage === "recent") result = result.sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0)).slice(0, 50);
    else if (currentPage === "docs") result = result.filter(f => f.type === "file" && (f.mime_type?.includes("pdf") || f.mime_type?.includes("text") || f.mime_type?.includes("document")));
    else if (currentPage === "images") result = result.filter(f => f.type === "file" && f.mime_type?.startsWith("image/"));
    else if (currentPage === "videos") result = result.filter(f => f.type === "file" && f.mime_type?.startsWith("video/"));
    else if (currentPage === "audio") result = result.filter(f => f.type === "file" && f.mime_type?.startsWith("audio/"));
    if (currentPage !== "recent") {
      result.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        let cmp = 0;
        switch (sortKey) { case "name": cmp = a.name.localeCompare(b.name, "zh-CN"); break; case "size": cmp = a.size - b.size; break; case "type": cmp = kindLabel(a).localeCompare(kindLabel(b), "zh-CN"); break; case "date": cmp = (a.updated_at || 0) - (b.updated_at || 0); break; }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  }, [files, currentPage, searchRes, searchQuery, sortKey, sortDir]);

  const totalSize = filteredFiles.filter(f => f.type === "file").reduce((s, f) => s + f.size, 0);

  const handleSelect = (id: string, checked: boolean) => {
    setSelected(prev => { const next = new Set(prev); if (checked) next.add(id); else next.delete(id); return next; });
  };
  const handleSelectAll = (checked: boolean) => {
    setSelected(checked ? new Set(filteredFiles.map(f => f.id)) : new Set());
  };

  const handleDeleteSelected = async () => {
    const ids = [...selected];
    for (const id of ids) {
      try { await deleteFile(id); } catch {}
    }
    setSelected(new Set());
  };

  const handleShareSelected = () => {
    const items = filteredFiles.filter(f => selected.has(f.id) && f.type === "file");
    if (items.length > 0) { setShareFiles(items); setCtx(null); }
  };

  const handleMoveSelected = () => {
    const items = filteredFiles.filter(f => selected.has(f.id));
    if (items.length > 0) { setMoveFiles(items); setCtx(null); }
  };

  // ===== MOBILE UI (unchanged rendering style, only color tokens update) =====
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
        {/* Mobile Header */}
        <header className="h-12 flex items-center justify-between px-4 bg-white border-b border-[var(--border-light)] flex-shrink-0 z-30">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[var(--brand-blue)]" /><span className="text-[14px] font-semibold text-[var(--text-primary)]">Cloud Nine</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input value={searchQuery} onChange={e => handleSearch(e.target.value)} placeholder="搜索..."
                className="pl-7 pr-2 py-1 text-[12px] bg-[var(--bg-secondary)] rounded-md outline-none w-28 focus:w-36 transition-all border border-transparent focus:border-[var(--brand-blue)]" />
            </div>
            <button onClick={() => setShowSettings(true)} className="btn-ghost"><Settings className="w-4 h-4" /></button>
            <button onClick={handleLogout} className="btn-ghost"><LogOut className="w-4 h-4" /></button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {currentPage === "trash" ? <TrashPage /> :
           currentPage === "shares" ? <SharesPage /> :
           <>
             {/* Breadcrumb */}
             <div className="h-10 flex items-center px-4 border-b border-[var(--border-light)] bg-white overflow-x-auto">
               <div className="flex items-center gap-1 text-[12px] whitespace-nowrap">
                 {breadcrumbs.map((b, i) => (
                   <span key={b.id ?? "root"} className="flex items-center gap-1">
                     {i > 0 && <ChevronRight className="w-3 h-3 text-[var(--text-disabled)]" />}
                     <button onClick={() => { navigateTo(b.id, b.name); setCurrentPage("files"); }}
                       className={`px-1 rounded ${i === breadcrumbs.length - 1 ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}>{b.name}</button>
                   </span>
                 ))}
               </div>
             </div>

             {/* Action bar */}
             <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-[var(--border-light)]">
               <div className="flex bg-[var(--bg-secondary)] rounded-md p-0.5">
                 {[{ m: "list" as ViewMode, ico: List }, { m: "grid" as ViewMode, ico: LayoutGrid }].map(({ m, ico: Icon }) => (
                   <button key={m} onClick={() => setViewMode(m)} className={`p-1 rounded ${viewMode === m ? "bg-white shadow-sm text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}><Icon className="w-3.5 h-3.5" /></button>
                 ))}
               </div>
               <div className="flex items-center gap-1.5">
                 <button onClick={() => setShowNewFolder(true)} className="btn-ghost"><FolderPlus className="w-4 h-4" /></button>
                 <button onClick={() => window.dispatchEvent(new Event("tcd:open-upload"))} className="btn-primary text-[12px]"><Upload className="w-3 h-3" />上传</button>
               </div>
             </div>

             {/* File list */}
             {isLoading ? <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 bg-[var(--bg-secondary)] rounded-md animate-pulse" />)}</div> :
              filteredFiles.length === 0 ? <div className="flex flex-col items-center justify-center py-20"><Folder className="w-12 h-12 text-[var(--text-disabled)] mb-3" /><p className="text-[var(--text-tertiary)] text-[14px]">没有文件</p></div> :
              viewMode === "list" ? (
                <div className="px-3 py-2 space-y-1">
                  {filteredFiles.map(item => {
                    const isSel = selected.has(item.id);
                    return (
                    <div key={item.id}
                      className={`flex items-center gap-3 px-3 py-2.5 bg-white rounded-md border transition-all cursor-pointer ${isSel ? "border-[var(--brand-blue)] bg-[var(--brand-blue-light)]" : "border-[var(--border-light)] active:scale-[0.98]"}`}
                      onClick={() => item.type === "folder" ? navigateTo(item.id, item.name) : undefined}
                      onContextMenu={e => { e.preventDefault(); setCtx({ item, x: e.clientX, y: e.clientY }); }}>
                      <input type="checkbox" checked={isSel} onChange={e => handleSelect(item.id, e.target.checked)}
                        onClick={e => e.stopPropagation()}
                        className="w-3.5 h-3.5 rounded border-[var(--border-default)] text-[var(--brand-blue)] cursor-pointer flex-shrink-0" />
                      <FileIcon item={item} />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium text-[var(--text-primary)] truncate block">{item.name}</span>
                        <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                          {kindLabel(item)}{item.type === "file" && ` · ${fmtSize(item.size)}`} · {fmtDate(item.updated_at || item.created_at)}
                        </p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); setCtx({ item, x: e.clientX, y: e.clientY }); }} className="btn-ghost flex-shrink-0">
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="12" cy="8" r="1.5"/></svg>
                      </button>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 grid grid-cols-3 gap-2.5">
                  {filteredFiles.map(item => {
                    const isSel = selected.has(item.id);
                    return (
                    <div key={item.id} className={`card p-2.5 cursor-pointer active:scale-[0.97] transition-all relative ${isSel ? "border-[var(--brand-blue)] bg-[var(--brand-blue-light)]" : "card-hover"}`}
                      onClick={() => item.type === "folder" ? navigateTo(item.id, item.name) : undefined}
                      onContextMenu={e => { e.preventDefault(); setCtx({ item, x: e.clientX, y: e.clientY }); }}>
                      <div className="absolute top-1 left-1" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={e => handleSelect(item.id, e.target.checked)}
                          className={`w-3 h-3 rounded border-[var(--border-default)] text-[var(--brand-blue)] cursor-pointer ${isSel ? "" : "opacity-0"}`} />
                      </div>
                      <div className="flex justify-center py-1.5"><LargeIcon item={item} /></div>
                      <p className="text-[11px] font-medium text-[var(--text-primary)] truncate text-center mt-1">{item.name}</p>
                      <p className="text-[10px] text-[var(--text-tertiary)] text-center">{item.type === "folder" ? "文件夹" : fmtSize(item.size)}</p>
                    </div>
                    );
                  })}
                </div>
              )}
           </>}

          {/* Status bar */}
          {currentPage !== "trash" && currentPage !== "shares" && (
            <div className="h-7 flex items-center px-4 bg-[var(--bg-secondary)] border-t border-[var(--border-light)]">
              <span className="text-[11px] text-[var(--text-tertiary)]">
                {selected.size > 0 ? `已选择 ${selected.size} 项` : `${filteredFiles.length} 个项目`}
              </span>
            </div>
          )}
          <div className="h-4" />
        </div>

        {/* Bottom TabBar */}
        <nav className="h-14 flex items-center bg-white border-t border-[var(--border-light)] flex-shrink-0 z-30" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {[{ page: "files" as PageView, label: "文件", ico: Folder }, { page: "recent" as PageView, label: "最近", ico: Clock }, { page: "shares" as PageView, label: "分享", ico: Share2 }, { page: "trash" as PageView, label: "回收站", ico: Trash2 }].map(t => (
            <button key={t.page} onClick={() => handleNavigate(t.page)} className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[10px] transition-colors ${currentPage === t.page ? "text-[var(--brand-blue)]" : "text-[var(--text-tertiary)]"}`}>
              <t.ico className="w-4 h-4" />{t.label}
            </button>
          ))}
        </nav>

        {/* Modals */}
        <AnimatePresence>{showNewFolder && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0" onClick={() => setShowNewFolder(false)} />
            <motion.div className="modal-panel w-72 p-5" initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-4">新建文件夹</h3>
              <form onSubmit={handleCreateFolder}><input type="text" value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="文件夹名称" className="input-primary" autoFocus />
                <div className="flex justify-end gap-2 mt-4"><button type="button" onClick={() => setShowNewFolder(false)} className="btn-secondary py-1.5 text-[13px]">取消</button><button type="submit" className="btn-primary py-1.5 text-[13px]">创建</button></div>
              </form>
            </motion.div>
          </motion.div>
        )}</AnimatePresence>

        <AnimatePresence>{ctx && (
          <div className="fixed inset-0 z-[99]" onClick={() => setCtx(null)}>
            <div style={{ position: "fixed", left: Math.min(ctx.x, window.innerWidth - 170), top: Math.min(ctx.y, window.innerHeight - 250) }}>
              <ContextMenu item={ctx.item} onClose={() => setCtx(null)}
                onShare={() => { setShareFiles([ctx.item]); setCtx(null); }}
                onRename={() => { setRenameFile(ctx.item); setCtx(null); }}
                onDownload={() => { handleDownload(ctx.item); setCtx(null); }}
                onMove={() => { setMoveFiles([ctx.item]); setCtx(null); }}
                onDelete={() => { deleteFile(ctx.item.id); setCtx(null); }}
                onDeleteSelected={() => { handleDeleteSelected(); setCtx(null); }}
                onShareSelected={handleShareSelected}
                onMoveSelected={handleMoveSelected}
                onDownloadSelected={handleDownloadSelected}
                selected={selected}
                selectedCount={selected.size}
                onPreview={isPreviewable(ctx.item) ? () => { setPreviewFile(ctx.item); setCtx(null); } : undefined} />
            </div>
          </div>
        )}</AnimatePresence>

        <ShareModal files={shareFiles} onClose={() => setShareFiles([])} />
        <RenameModal file={renameFile} onClose={() => setRenameFile(null)} />
        <MoveModal files={moveFiles} onClose={() => setMoveFiles([])} />
        <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
        <TransferManager />
        <UploadZone />
        <AnimatePresence>{previewFile && <PreviewModal key={previewFile.id} item={previewFile} files={filteredFiles} onClose={() => setPreviewFile(null)} />}</AnimatePresence>
      </div>
    );
  }

  // ===== DESKTOP UI (123云盘风格) =====
  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="h-14 flex items-center justify-between px-5 bg-white border-b border-[var(--border-light)] flex-shrink-0 z-30">
        <div className="flex items-center gap-3">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="btn-ghost md:hidden">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-[var(--brand-blue)] flex items-center justify-center">
              <Cloud className="w-5 h-5 text-white" strokeWidth={2} />
            </div>
            <span className="text-[15px] font-semibold text-[var(--text-primary)]">Cloud Nine</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
            <input
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder="搜索文件..."
              className="pl-9 pr-3 py-1.5 text-[13px] bg-[var(--bg-secondary)] rounded-md outline-none w-64 transition-all border border-transparent focus:bg-white focus:border-[var(--brand-blue)] focus:w-80 focus:shadow-[0_0_0_2px_rgba(22,119,255,0.1)]"
            />
            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--text-disabled)] bg-white px-1 rounded hidden sm:inline">Ctrl+K</kbd>
          </div>
          <button onClick={() => setShowSettings(true)} className="btn-ghost" title="设置">
            <Settings className="w-[18px] h-[18px]" />
          </button>
          <button onClick={handleLogout} className="btn-ghost" title="退出登录">
            <LogOut className="w-[18px] h-[18px]" />
          </button>
          <div className="flex items-center gap-2 ml-1 pl-3 border-l border-[var(--border-light)]">
            <div className="w-7 h-7 rounded-full bg-[var(--brand-blue-light)] flex items-center justify-center text-[var(--brand-blue)] text-[11px] font-semibold">
              {(user?.username || "U")[0].toUpperCase()}
            </div>
            <span className="text-[13px] text-[var(--text-primary)] hidden sm:inline">{user?.username}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar currentPage={currentPage} onNavigate={handleNavigate} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="h-11 flex items-center justify-between px-4 bg-white border-b border-[var(--border-light)] flex-shrink-0">
            <div className="flex items-center gap-1 text-[13px] min-w-0">
              <button onClick={() => { navigateTo(null, "全部文件"); setCurrentPage("files"); }} className="btn-ghost p-1">
                <Home className="w-4 h-4" />
              </button>
              {breadcrumbs.map((b, i) => (
                <span key={b.id ?? "root"} className="flex items-center gap-1 flex-shrink-0">
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-disabled)]" />
                  <button
                    onClick={() => { navigateTo(b.id, b.name); setCurrentPage("files"); }}
                    className={`px-1 py-0.5 rounded transition-colors truncate max-w-[200px] ${i === breadcrumbs.length - 1 ? "font-medium text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"}`}
                  >{b.name}</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex bg-[var(--bg-secondary)] rounded-md p-0.5">
                {[{ m: "list" as ViewMode, ico: List }, { m: "grid" as ViewMode, ico: LayoutGrid }].map(({ m, ico: Icon }) => (
                  <button key={m} onClick={() => setViewMode(m)} className={`p-1.5 rounded transition-colors ${viewMode === m ? "bg-white shadow-sm text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
              <button onClick={() => setShowNewFolder(true)} className="btn-secondary text-[12px]">
                <FolderPlus className="w-3.5 h-3.5" />新建文件夹
              </button>
              <button onClick={() => window.dispatchEvent(new Event("tcd:open-upload"))} className="btn-primary text-[12px]">
                <Upload className="w-3.5 h-3.5" />上传文件
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {currentPage === "trash" ? <TrashPage /> :
             currentPage === "shares" ? <SharesPage /> :
             isLoading ? (
               <div className="p-4 space-y-1">
                 {Array.from({ length: 8 }).map((_, i) => (
                   <div key={i} className="h-[42px] bg-[var(--bg-secondary)] rounded-md animate-pulse" />
                 ))}
               </div>
             ) : filteredFiles.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-full">
                 <div className="w-16 h-16 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
                   <Folder className="w-8 h-8 text-[var(--text-disabled)]" />
                 </div>
                 <p className="text-[var(--text-tertiary)] text-[14px]">暂无文件</p>
                 <button onClick={() => window.dispatchEvent(new Event("tcd:open-upload"))} className="btn-primary mt-4 text-[13px]">
                   <Upload className="w-4 h-4" />上传第一个文件
                 </button>
               </div>
             ) : viewMode === "list" ? (
               <FileTable
                 files={filteredFiles}
                 sortKey={sortKey}
                 sortDir={sortDir}
                 onSort={(k) => { if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(k); setSortDir("asc"); } }}
                 onNavigate={(id, name) => navigateTo(id, name)}
                 onContextMenu={(item, x, y) => setCtx({ item, x, y })}
                 onPreview={setPreviewFile}
                 selected={selected}
                 onSelect={handleSelect}
                 onSelectAll={handleSelectAll}
               />
             ) : (
               <FileGrid
                 files={filteredFiles}
                 onNavigate={(id, name) => navigateTo(id, name)}
                 onContextMenu={(item, x, y) => setCtx({ item, x, y })}
                 onPreview={setPreviewFile}
                 selected={selected}
                 onSelect={handleSelect}
                 onSelectAll={handleSelectAll}
               />
             )}
          </div>

          {/* Status bar */}
          {currentPage !== "trash" && currentPage !== "shares" && (
            <div className="h-8 flex items-center justify-between px-4 bg-[var(--bg-secondary)] border-t border-[var(--border-light)] flex-shrink-0">
              <span className="text-[12px] text-[var(--text-tertiary)]">
                {selected.size > 0 ? `已选择 ${selected.size} 项` : `${filteredFiles.length} 个项目`}
              </span>
              <span className="text-[12px] text-[var(--text-tertiary)] hidden sm:inline">
                {selected.size > 0 ? "" : totalSize > 0 ? fmtSize(totalSize) : ""}
              </span>
            </div>
          )}
          {/* Bulk download progress */}
          <AnimatePresence>
            {downloadingMulti && (
              <motion.div className="h-8 flex items-center gap-3 px-4 bg-[var(--brand-blue-light)] border-t border-[var(--brand-blue)]/20 flex-shrink-0" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 32 }} exit={{ opacity: 0, height: 0 }}>
                <Archive className="w-3.5 h-3.5 text-[var(--brand-blue)] flex-shrink-0" />
                <span className="text-[11px] text-[var(--brand-blue)] truncate flex-1">{multiProgress.fileName}</span>
                <span className="text-[11px] text-[var(--brand-blue)] flex-shrink-0">{multiProgress.current}/{multiProgress.total}</span>
                <div className="w-20 h-1 bg-[var(--brand-blue)]/20 rounded-full overflow-hidden flex-shrink-0">
                  <div className="h-full bg-[var(--brand-blue)] rounded-full transition-all duration-300" style={{ width: `${Math.max(multiProgress.percent, 3)}%` }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>{showNewFolder && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" onClick={() => setShowNewFolder(false)} />
          <motion.div className="modal-panel w-80 p-5" initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)] mb-4">新建文件夹</h3>
            <form onSubmit={handleCreateFolder}>
              <input type="text" value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="文件夹名称" className="input-primary" autoFocus />
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowNewFolder(false)} className="btn-secondary py-1.5 text-[13px]">取消</button>
                <button type="submit" className="btn-primary py-1.5 text-[13px]">创建</button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}</AnimatePresence>

      <AnimatePresence>{ctx && (
        <div className="fixed inset-0 z-[99]" onClick={() => setCtx(null)}>
          <div style={{ position: "fixed", left: Math.min(ctx.x, window.innerWidth - 180), top: Math.min(ctx.y, window.innerHeight - 300) }}>
            <ContextMenu item={ctx.item} onClose={() => setCtx(null)}
              onShare={() => { setShareFiles([ctx.item]); setCtx(null); }}
              onRename={() => { setRenameFile(ctx.item); setCtx(null); }}
              onDownload={() => { handleDownload(ctx.item); setCtx(null); }}
              onMove={() => { setMoveFiles([ctx.item]); setCtx(null); }}
              onDelete={() => { deleteFile(ctx.item.id); setCtx(null); }}
              onDeleteSelected={() => { handleDeleteSelected(); setCtx(null); }}
              onShareSelected={handleShareSelected}
              onMoveSelected={handleMoveSelected}
              selected={selected}
              selectedCount={selected.size}
              onPreview={isPreviewable(ctx.item) ? () => { setPreviewFile(ctx.item); setCtx(null); } : undefined} />
          </div>
        </div>
      )}</AnimatePresence>

      <ShareModal files={shareFiles} onClose={() => setShareFiles([])} />
      <RenameModal file={renameFile} onClose={() => setRenameFile(null)} />
      <MoveModal files={moveFiles} onClose={() => setMoveFiles([])} />
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <TransferManager />
      <UploadZone />
      <AnimatePresence>{previewFile && <PreviewModal key={previewFile.id} item={previewFile} files={filteredFiles} onClose={() => setPreviewFile(null)} />}</AnimatePresence>
    </div>
  );
}

// Re-export SharePage
export const SharePage = ShareAccessPage;
