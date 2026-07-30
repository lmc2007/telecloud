import { useEffect, useState } from "react";
import { Folder, Clock, FileText, FileImage, FileVideo, FileAudio, Share2, Trash2 } from "lucide-react";
import type { PageView } from "../types/ui";
import { useAuthStore } from "../stores/authStore";
import { useTransferStore } from "../stores/transferStore";
import { API_BASE } from "../lib/api";
import { fmtSize } from "../lib/utils";

interface SidebarProps {
  currentPage: PageView;
  onNavigate: (page: PageView) => void;
  sidebarOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ currentPage, onNavigate, sidebarOpen, onClose }: SidebarProps) {
  const { user, accessToken } = useAuthStore();
  const transfers = useTransferStore(s => s.transfers);
  const [storage, setStorage] = useState<{ used: number; files: number; folders: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // 传输完成时递增 key → 触发存储用量重新获取
  const doneCount = transfers.filter(t => t.status === "done").length;
  useEffect(() => { if (doneCount > 0) setRefreshKey(k => k + 1); }, [doneCount]);

  useEffect(() => {
    const ac = new AbortController();
    const loadStorage = async () => {
      try {
        const r = await fetch(`${API_BASE}/user/storage`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: ac.signal,
        });
        const d = await r.json();
        if (d.success) setStorage(d.data);
      } catch {
        if (ac.signal.aborted) return;
        console.error("获取存储用量失败");
      }
    };
    if (accessToken) loadStorage();
    return () => ac.abort();
  }, [accessToken, user?.storage_used, refreshKey]);

  const used = storage?.used ?? user?.storage_used ?? 0;
  const total = 10 * 1024 * 1024 * 1024 * 1024; // 10TB 视觉上限
  const pct = used > 0 ? Math.min((used / total) * 100, 100) : 0;

  const sections = [
    { title: "浏览", items: [{ id: "files" as PageView, icon: Folder, label: "全部文件" }, { id: "recent" as PageView, icon: Clock, label: "最近" }] },
    { title: "分类", items: [{ id: "docs" as PageView, icon: FileText, label: "文档" }, { id: "images" as PageView, icon: FileImage, label: "图片" }, { id: "videos" as PageView, icon: FileVideo, label: "视频" }, { id: "audio" as PageView, icon: FileAudio, label: "音频" }] },
    { title: "", items: [{ id: "shares" as PageView, icon: Share2, label: "我的分享" }, { id: "trash" as PageView, icon: Trash2, label: "回收站" }] },
  ];

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={onClose} />
      )}
      <aside className={`w-56 bg-white border-r border-[var(--border-light)] flex-shrink-0 overflow-y-auto flex flex-col
        ${sidebarOpen ? "fixed inset-y-0 left-0 z-50" : "hidden"} md:relative md:flex md:z-auto`}>
        {/* Storage bar */}
        <div className="px-4 py-3 border-b border-[var(--border-light)]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[12px] text-[var(--text-tertiary)]">存储空间</span>
            <span className="text-[12px] text-[var(--text-secondary)]">{fmtSize(used)} / ∞</span>
          </div>
          <div className="h-1.5 bg-[var(--border-light)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--brand-blue)] rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Nav items */}
        <div className="flex-1 py-2">
          {sections.map((sec, i) => (
            <div key={i} className="mb-1">
              {sec.title && <p className="text-[11px] font-medium text-[var(--text-tertiary)] px-4 py-2">{sec.title}</p>}
              {sec.items.map(item => (
                <button key={item.id}
                  onClick={() => { onNavigate(item.id); onClose(); }}
                  className={`sidebar-nav-item ${currentPage === item.id ? "active" : ""}`}>
                  <item.icon className="w-[18px] h-[18px]" strokeWidth={1.8} />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
