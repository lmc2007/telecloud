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
import { MCProgressBar } from "../components/MCProgressBar";
import { ThemeToggle } from "../components/ThemeToggle";
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
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; name: string; all?: boolean } | null>(null);
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

  // Keyboard shortcuts: Cmd/Ctrl+A 全选, Delete 删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (inInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        if (currentPage !== "trash" && currentPage !== "shares" && files.length > 0) {
          e.preventDefault();
          setSelected(new Set(files.map(f => f.id)));
        }
      } else if (e.key === "Delete" && selected.size > 0) {
        e.preventDefault();
        const first = [...selected][0];
        const firstItem = files.find(f => f.id === first);
        setConfirmDelete({ ids: [...selected], name: selected.size > 1 ? "" : (firstItem?.name || "") });
      } else if (e.key === "Escape") {
        setSelected(new Set());
        setCtx(null);
        setPreviewFile(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentPage, files, selected]);

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
  const downloadFileBlob = async (item: FileItem, onChunk?: (done: number, total: number, downloadedBytes: number, totalBytes: number) => void): Promise<Blob> => {
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
          const blob = await r.blob();
          // Integrity check: a truncated CDN stream would silently corrupt the
          // final file — fail loudly instead so the client retries or errors out.
          const expected = chunks[i]?.size;
          if (expected > 0 && blob.size !== expected) {
            throw new Error(`chunk ${i} 不完整: 期望 ${expected} 字节, 实际 ${blob.size} 字节`);
          }
          // Legacy uploads may have size=0 in metadata — we can't verify the
          // exact size, but an empty body is always wrong.
          if ((!expected || expected === 0) && blob.size === 0) {
            throw new Error(`chunk ${i} 为空（未收到数据）`);
          }
          return blob;
        } catch (e) {
          if (attempt === retries) throw e;
          const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
          await new Promise(r => setTimeout(r, delay));
        }
      }
      throw new Error("unreachable");
    };
    let downloadedBytes = 0;
    for (let i = 0; i < chunks.length; i++) {
      chunkBlobs[i] = await fetchChunk(i);
      downloadedBytes += chunkBlobs[i].size;
      if (onChunk) onChunk(i + 1, chunks.length, downloadedBytes, item.size);
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 50));
    }
    const blob = new Blob(chunkBlobs);
    // Final guard: assembled size must match the file metadata.
    if (blob.size !== item.size) {
      throw new Error(`文件不完整: 期望 ${item.size} 字节, 实际 ${blob.size} 字节`);
    }
    return blob;
  };

  const handleDownload = async (item: FileItem) => {
    // Proactively refresh token for long downloads (200+ chunks ≈ 4 min)
    const rt = localStorage.getItem("tcd_refresh_token");
    if (rt) { try { await fetch(`${API_BASE}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: rt }) }); } catch {} }
    
    const tid = crypto.randomUUID();
    const ac = new AbortController();
    addTransfer({ id: tid, type: "download", fileName: item.name, fileSize: item.size, progress: 0, status: "pending", speed: 0, abortController: ac });
    try {
      updateTransfer(tid, { status: "transferring" });
      const blob = await downloadFileBlob(item, (done, total, downloadedBytes, totalBytes) => {
        updateTransfer(tid, {
          downloadedBytes,
          chunksDone: done,
          progress: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : Math.round((done / total) * 100),
        });
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
      if (i < items.length - 1) await new Promise(r => setTimeout(r, 50));
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
    setConfirmDelete({ ids: [...selected], name: selected.size > 1 ? `${selected.size} 个项目` : "", all: true });
  };

  const doDelete = async (ids: string[]) => {
    for (const id of ids) {
      try { await deleteFile(id); } catch {}
    }
    setSelected(new Set());
  };

  const handleShareSelected = () => {
    const items = filteredFiles.filter(f => selected.has(f.id));
    if (items.length === 0) return;
    // Allow multi-folder selection, but don't mix files and folders
    const folders = items.filter(f => f.type === "folder");
    const files = items.filter(f => f.type === "file");
    if (folders.length > 0 && files.length > 0) {
      // Mixed selection: only share files (existing behavior)
      setShareFiles(files);
    } else {
      setShareFiles(items);
    }
    setCtx(null);
  };

  const handleMoveSelected = () => {
    const items = filteredFiles.filter(f => selected.has(f.id));
    if (items.length > 0) { setMoveFiles(items); setCtx(null); }
  };

  // ===== MOBILE UI (unchanged rendering style, only color tokens update) =====
  if (isMobile) {
    return (
      <div className="h-screen flex flex-col bg-[#F5F5F7]">
        {/* Mobile Header */}
        <header className="h-12 flex items-center justify-between px-4 flex-shrink-0 z-30"
          style={{ background: 'rgba(245,245,247,0.8)', backdropFilter: 'blur(20px)', borderBottom: '0.5px solid rgba(0,0,0,0.08)' }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #0071E3, #5AC8FA)' }}>
              <Cloud className="w-3.5 h-3.5 text-white" strokeWidth={2} />
            </div>
            <span className="text-[14px] font-semibold text-[#1D1D1F]">Cloud Nine</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-[#86868B]" />
              <input value={searchQuery} onChange={e => handleSearch(e.target.value)} placeholder="搜索..."
                className="pl-7 pr-2 py-1 text-[12px] bg-[rgba(0,0,0,0.03)] rounded-md outline-none w-28 focus:w-36 transition-all border border-transparent focus:border-[var(--brand-blue)]" />
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
             <div className="h-10 flex items-center px-4 overflow-x-auto"
               style={{ background: 'rgba(245,245,247,0.7)', backdropFilter: 'blur(12px)', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
               <div className="flex items-center gap-1 text-[12px] whitespace-nowrap">
                 {breadcrumbs.map((b, i) => (
                   <span key={b.id ?? "root"} className="flex items-center gap-1">
                     {i > 0 && <ChevronRight className="w-3 h-3 text-[var(--text-disabled)]" />}
                     <button onClick={() => { navigateTo(b.id, b.name); setCurrentPage("files"); }}
                       className={`px-1 rounded ${i === breadcrumbs.length - 1 ? "font-medium text-[#1D1D1F]" : "text-[#86868B]"}`}>{b.name}</button>
                   </span>
                 ))}
               </div>
             </div>

             {/* Action bar */}
             <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
               <div className="flex bg-[rgba(0,0,0,0.04)] rounded-full p-0.5">
                 {[{ m: "list" as ViewMode, ico: List }, { m: "grid" as ViewMode, ico: LayoutGrid }].map(({ m, ico: Icon }) => (
                   <button key={m} onClick={() => setViewMode(m)} className={`p-1.5 rounded-full transition-colors ${viewMode === m ? "bg-white shadow-sm text-[#1D1D1F]" : "text-[#AEAEB2]"}`}><Icon className="w-3.5 h-3.5" /></button>
                 ))}
               </div>
               <div className="flex items-center gap-1.5">
                 <button onClick={() => setShowNewFolder(true)} className="btn-ghost"><FolderPlus className="w-4 h-4" /></button>
                 <button onClick={() => window.dispatchEvent(new Event("tcd:open-upload"))} className="btn-primary text-[12px]"><Upload className="w-3 h-3" />上传</button>
               </div>
             </div>

             {/* File list */}
             {isLoading ? <div className="p-6 space-y-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[42px] bg-[rgba(0,0,0,0.03)] rounded-xl animate-pulse" />)}</div> :
              filteredFiles.length === 0 ? <div className="flex flex-col items-center justify-center py-24"><Cloud className="w-16 h-16 text-[#D1D1D6] mb-4 opacity-50" strokeWidth={1} /><p className="text-[#AEAEB2] text-[15px]">将文件拖到这里</p><p className="text-[#D1D1D6] text-[13px] mt-1">或点击右上角上传</p></div> :
              viewMode === "list" ? (
                <div className="px-3 py-2 space-y-1">
                  {filteredFiles.map(item => {
                    const isSel = selected.has(item.id);
                    return (
                    <div key={item.id}
                      className={`flex items-center gap-3 px-3 py-2.5 bg-white rounded-xl transition-all cursor-pointer ${isSel ? "bg-[#0071E3]/8 ring-2 ring-[#0071E3]/20" : "hover:bg-[rgba(0,0,0,0.02)]"}`}
                      onClick={() => item.type === "folder" ? navigateTo(item.id, item.name) : undefined}
                      onContextMenu={e => { e.preventDefault(); setCtx({ item, x: e.clientX, y: e.clientY }); }}>
                      <input type="checkbox" checked={isSel} onChange={e => handleSelect(item.id, e.target.checked)}
                        onClick={e => e.stopPropagation()}
                        className="w-3.5 h-3.5 rounded border-[var(--border-default)] text-[var(--brand-blue)] cursor-pointer flex-shrink-0" />
                      <FileIcon item={item} />
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-medium text-[#1D1D1F] truncate block">{item.name}</span>
                        <p className="text-[11px] text-[#86868B] mt-0.5">
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
                      <p className="text-[11px] font-medium text-[#1D1D1F] truncate text-center mt-1">{item.name}</p>
                      <p className="text-[10px] text-[#86868B] text-center">{item.type === "folder" ? "文件夹" : fmtSize(item.size)}</p>
                    </div>
                    );
                  })}
                </div>
              )}
           </>}

          {/* Status bar */}
          {currentPage !== "trash" && currentPage !== "shares" && (
            <div className="h-7 flex items-center px-4 bg-[rgba(0,0,0,0.03)] border-t border-[var(--border-light)]">
              <span className="text-[11px] text-[#86868B]">
                {selected.size > 0 ? `已选择 ${selected.size} 项` : `${filteredFiles.length} 个项目`}
              </span>
            </div>
          )}
          <div className="h-4" />
        </div>

        {/* Bottom TabBar */}
        <nav className="h-14 flex items-center bg-[var(--bg-card)] border-t border-[var(--border-light)] flex-shrink-0 z-30" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
          {[{ page: "files" as PageView, label: "文件", ico: Folder }, { page: "recent" as PageView, label: "最近", ico: Clock }, { page: "shares" as PageView, label: "分享", ico: Share2 }, { page: "trash" as PageView, label: "回收站", ico: Trash2 }].map(t => (
            <button key={t.page} onClick={() => handleNavigate(t.page)} className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 text-[10px] transition-colors ${currentPage === t.page ? "text-[var(--brand-blue)]" : "text-[#86868B]"}`}>
              <t.ico className="w-4 h-4" />{t.label}
            </button>
          ))}
        </nav>

        {/* Modals */}
        <AnimatePresence>{showNewFolder && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0" onClick={() => setShowNewFolder(false)} />
            <motion.div className="modal-panel w-72 p-5" initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
              <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-4">新建文件夹</h3>
              <form onSubmit={handleCreateFolder}><input type="text" value={folderName} onChange={e => setFolderName(e.target.value)} placeholder="文件夹名称" className="input-primary" autoFocus />
                <div className="flex justify-end gap-2 mt-4"><button type="button" onClick={() => setShowNewFolder(false)} className="btn-secondary py-1.5 text-[13px]">取消</button><button type="submit" className="btn-primary py-1.5 text-[13px]">创建</button></div>
              </form>
            </motion.div>
          </motion.div>
        )}</AnimatePresence>

        {/* Delete confirm */}
        <AnimatePresence>{confirmDelete && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0" onClick={() => setConfirmDelete(null)} />
            <motion.div className="modal-panel w-[320px] p-6 text-center" initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--red)', boxShadow: 'var(--shadow)' }}>
                <Trash2 className="w-5 h-5 text-white" strokeWidth={1.6} />
              </div>
              <h3 className="text-[16px] font-semibold text-[#1D1D1F] mb-2">删除文件</h3>
              <p className="text-[13px] text-[#86868B] mb-1">
                {confirmDelete.name ? `确定要删除「${confirmDelete.name}」吗？` : `确定要删除 ${confirmDelete.ids.length} 个项目吗？`}
              </p>
              <p className="text-[12px] text-[#AEAEB2] mb-5">删除后可在回收站中恢复</p>
              <div className="flex justify-center gap-2">
                <button onClick={() => setConfirmDelete(null)} className="btn-secondary py-2 px-5 text-[13px]">取消</button>
                <button
                  onClick={() => { doDelete(confirmDelete.ids); setConfirmDelete(null); }}
                  className="btn-danger py-2 px-5 text-[13px]"
                >删除</button>
              </div>
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
                onDelete={() => { setConfirmDelete({ ids: [ctx.item.id], name: ctx.item.name }); setCtx(null); }}
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

        <ShareModal key={shareFiles.map(f => f.id).join(",") || "empty"} files={shareFiles} onClose={() => setShareFiles([])} />
        <RenameModal file={renameFile} onClose={() => setRenameFile(null)} />
        <MoveModal files={moveFiles} onClose={() => setMoveFiles([])} />
        <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
        <TransferManager />
        <UploadZone />
        <AnimatePresence>{previewFile && <PreviewModal key={previewFile.id} item={previewFile} files={filteredFiles} onClose={() => setPreviewFile(null)} />}</AnimatePresence>
      </div>
    );
  }

  // ===== DESKTOP UI (iCloud Finder 风格) =====
  return (
    <div className="h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar currentPage={currentPage} onNavigate={handleNavigate} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Finder toolbar */}
          <div className="h-[60px] flex items-center justify-between px-5 flex-shrink-0"
            style={{ background: 'var(--bg-glass)', backdropFilter: 'blur(24px) saturate(180%)', borderBottom: '0.5px solid var(--border)' }}>
            {/* Left: back + big title */}
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {currentPage === "files" ? (
                <>
                  <button onClick={() => { navigateTo(null, "全部文件"); setCurrentPage("files"); }} className="btn-ghost p-1.5">
                    <Home className="w-[18px] h-[18px]" />
                  </button>
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    {breadcrumbs.map((b, i) => (
                      <span key={b.id ?? "root"} className="flex items-center gap-1.5 flex-shrink-0">
                        {i > 0 && <ChevronRight className="w-3.5 h-3.5" style={{ color: 'var(--text-disabled)' }} />}
                        <button
                          onClick={() => { navigateTo(b.id, b.name); setCurrentPage("files"); }}
                          className={`truncate max-w-[220px] transition-colors rounded ${i === breadcrumbs.length - 1 ? "text-[26px] font-semibold tracking-tight" : "text-[22px] font-medium hover:text-[var(--text)]"}`}
                          style={{ color: i === breadcrumbs.length - 1 ? 'var(--text)' : 'var(--text-tertiary)' }}
                        >{b.name}</button>
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <h1 className="text-[26px] font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                  {currentPage === "recent" ? "最近" :
                   currentPage === "docs" ? "文档" :
                   currentPage === "images" ? "图片" :
                   currentPage === "videos" ? "视频" :
                   currentPage === "audio" ? "音频" :
                   currentPage === "shares" ? "我的分享" :
                   currentPage === "trash" ? "回收站" : "全部文件"}
                </h1>
              )}
            </div>

            {/* Right: view toggle + search + actions + avatar */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex rounded-full p-[3px]" style={{ background: 'var(--bg-input)' }}>
                {[{ m: "list" as ViewMode, ico: List }, { m: "grid" as ViewMode, ico: LayoutGrid }].map(({ m, ico: Icon }) => (
                  <button key={m} onClick={() => setViewMode(m)} className={`p-1.5 rounded-full transition-colors ${viewMode === m ? "bg-[var(--bg-elev)] shadow-sm text-[var(--text)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}>
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
              <div className="relative hidden sm:block" style={{ display: currentPage !== "trash" && currentPage !== "shares" ? undefined : "none" }}>
                <Search className="w-[15px] h-[15px] absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                <input value={searchQuery} onChange={e => handleSearch(e.target.value)} placeholder="搜索"
                  className="pl-8 pr-3 py-1.5 text-[13px] rounded-full outline-none w-36 focus:w-56 transition-all duration-200 border border-transparent"
                  style={{ background: 'var(--bg-input)', color: 'var(--text)' }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--glow)' }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.boxShadow = 'none' }} />
              </div>
              <div className="w-px h-5" style={{ background: 'var(--border)' }} />
              <ThemeToggle />
              <button onClick={() => setShowSettings(true)} className="btn-ghost" title="设置"><Settings className="w-[18px] h-[18px]" /></button>
              {currentPage !== "trash" && currentPage !== "shares" && (
                <>
                  <button onClick={() => setShowNewFolder(true)} className="btn-ghost" title="新建文件夹"><FolderPlus className="w-[18px] h-[18px]" /></button>
                  <button onClick={() => window.dispatchEvent(new Event("tcd:open-upload"))} className="btn-primary text-[13px] px-4 py-1.5"><Upload className="w-3.5 h-3.5" />上传</button>
                </>
              )}
              <button onClick={handleLogout} className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[13px] font-semibold transition-transform hover:scale-105 active:scale-95"
                style={{ background: 'linear-gradient(135deg, var(--accent), #5AC8FA)', boxShadow: 'var(--shadow-sm)' }}
                title={`${user?.username || ""} · 点击退出`}>
                {(user?.username || "U")[0].toUpperCase()}
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {currentPage === "trash" ? <TrashPage /> :
             currentPage === "shares" ? <SharesPage /> :
             isLoading ? (
               <div className="p-8">
                 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                   {Array.from({ length: 10 }).map((_, i) => (
                     <div key={i} className="flex flex-col items-center gap-3">
                       <div className="w-full aspect-square rounded-2xl bg-[rgba(0,0,0,0.03)] animate-pulse" />
                       <div className="w-24 h-3 bg-[rgba(0,0,0,0.03)] rounded animate-pulse" />
                     </div>
                   ))}
                 </div>
               </div>
             ) : filteredFiles.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-full py-20 relative overflow-hidden">
                 <motion.div className="w-28 h-28 rounded-full flex items-center justify-center mb-6"
                   style={{ background: 'var(--accent-light)' }}
                   animate={{ scale: [1, 1.04, 1] }} transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}>
                   <Cloud className="w-14 h-14" style={{ color: 'var(--accent)', opacity: 0.5 }} strokeWidth={1.1} />
                 </motion.div>
                 <p className="text-[16px] font-medium" style={{ color: 'var(--text-secondary)' }}>这个文件夹是空的</p>
                 <p className="text-[13px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>点击右上角上传，或将文件直接拖进来</p>
                 <button onClick={() => window.dispatchEvent(new Event("tcd:open-upload"))} className="btn-primary mt-6 text-[13px] px-5 py-2">
                   <Upload className="w-4 h-4" />上传文件
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
            <div className="h-8 flex items-center justify-between px-4 flex-shrink-0"
              style={{ background: 'var(--bg-glass)', borderTop: '0.5px solid var(--border)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {selected.size > 0 ? `已选择 ${selected.size} 项` : `${filteredFiles.length} 个项目`}
              </span>
              <span className="text-[11px] hidden sm:inline" style={{ color: 'var(--text-tertiary)' }}>
                {selected.size > 0 ? "" : totalSize > 0 ? fmtSize(totalSize) : ""}
              </span>
            </div>
          )}
          {/* Bulk download progress */}
          <AnimatePresence>
            {downloadingMulti && (
              <motion.div className="flex items-center gap-3 px-4 py-1.5 bg-[rgba(91,135,49,0.1)] border-t border-[#5B8731]/20 flex-shrink-0" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 40 }} exit={{ opacity: 0, height: 0 }}>
                <Archive className="w-3.5 h-3.5 text-[#5B8731] flex-shrink-0" />
                <span className="text-[11px] text-[#9CA3AF] truncate flex-1">{multiProgress.fileName}</span>
                <span className="text-[11px] text-[#9CA3AF] flex-shrink-0">{multiProgress.current}/{multiProgress.total}</span>
                <div className="w-20 flex-shrink-0">
                  <MCProgressBar progress={Math.max(multiProgress.percent, 1)} height={8} />
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
            <h3 className="text-[15px] font-semibold text-[#1D1D1F] mb-4">新建文件夹</h3>
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

      {/* Delete confirm */}
      <AnimatePresence>{confirmDelete && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" onClick={() => setConfirmDelete(null)} />
          <motion.div className="modal-panel w-[340px] p-6 text-center" initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--red)', boxShadow: 'var(--shadow)' }}>
              <Trash2 className="w-5 h-5 text-white" strokeWidth={1.6} />
            </div>
            <h3 className="text-[16px] font-semibold text-[#1D1D1F] mb-2">删除文件</h3>
            <p className="text-[13px] text-[#86868B] mb-1">
              {confirmDelete.name ? `确定要删除「${confirmDelete.name}」吗？` : `确定要删除 ${confirmDelete.ids.length} 个项目吗？`}
            </p>
            <p className="text-[12px] text-[#AEAEB2] mb-5">删除后可在回收站中恢复</p>
            <div className="flex justify-center gap-2">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary py-2 px-5 text-[13px]">取消</button>
              <button
                onClick={() => { doDelete(confirmDelete.ids); setConfirmDelete(null); }}
                className="btn-danger py-2 px-5 text-[13px]"
              >删除</button>
            </div>
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
              onDelete={() => { setConfirmDelete({ ids: [ctx.item.id], name: ctx.item.name }); setCtx(null); }}
              onDeleteSelected={() => { handleDeleteSelected(); setCtx(null); }}
              onShareSelected={handleShareSelected}
              onMoveSelected={handleMoveSelected}
              selected={selected}
              selectedCount={selected.size}
              onPreview={isPreviewable(ctx.item) ? () => { setPreviewFile(ctx.item); setCtx(null); } : undefined} />
          </div>
        </div>
      )}</AnimatePresence>

      <ShareModal key={shareFiles.map(f => f.id).join(",") || "empty"} files={shareFiles} onClose={() => setShareFiles([])} />
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
