import { useEffect, useState } from "react";
import { Folder, Clock, FileText, FileImage, FileVideo, FileAudio, Share2, Trash2, Cloud } from "lucide-react";
import type { PageView } from "../types/ui";
import { useAuthStore } from "../stores/authStore";
import { useTransferStore } from "../stores/transferStore";
import { API_BASE } from "../lib/api";
import { fmtSize } from "../lib/utils";

interface SidebarProps { currentPage: PageView; onNavigate: (page: PageView) => void; sidebarOpen: boolean; onClose: () => void; }

export function Sidebar({ currentPage, onNavigate, sidebarOpen, onClose }: SidebarProps) {
  const { user, accessToken } = useAuthStore();
  const transfers = useTransferStore(s => s.transfers);
  const [storage, setStorage] = useState<{ used: number } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const doneCount = transfers.filter(t => t.status === "done").length;
  useEffect(() => { if (doneCount > 0) setRefreshKey(k => k + 1); }, [doneCount]);
  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try { const r = await fetch(`${API_BASE}/user/storage`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: ac.signal }); const d = await r.json(); if (d.success) setStorage(d.data) } catch { if (!ac.signal.aborted) {} }
    })();
    return () => ac.abort();
  }, [accessToken, refreshKey]);

  const used = storage?.used ?? 0;

  const groups: { label: string; items: { id: PageView; icon: any; label: string; color: string }[] }[] = [
    {
      label: "",
      items: [
        { id: "files" as PageView, icon: Folder, label: "全部文件", color: "var(--icon-folder)" },
        { id: "recent" as PageView, icon: Clock, label: "最近", color: "var(--icon-doc)" },
      ],
    },
    {
      label: "媒体",
      items: [
        { id: "docs" as PageView, icon: FileText, label: "文档", color: "var(--icon-doc)" },
        { id: "images" as PageView, icon: FileImage, label: "图片", color: "var(--icon-image)" },
        { id: "videos" as PageView, icon: FileVideo, label: "视频", color: "var(--icon-video)" },
        { id: "audio" as PageView, icon: FileAudio, label: "音频", color: "var(--icon-audio)" },
      ],
    },
    {
      label: "更多",
      items: [
        { id: "shares" as PageView, icon: Share2, label: "我的分享", color: "var(--icon-share)" },
        { id: "trash" as PageView, icon: Trash2, label: "回收站", color: "var(--icon-trash)" },
      ],
    },
  ];

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm md:hidden" onClick={onClose} />}
      <aside className={`w-[220px] flex-shrink-0 flex flex-col overflow-y-auto ${sidebarOpen ? "fixed inset-y-0 left-0 z-50" : "hidden"} md:relative md:flex md:z-auto`}
        style={{ background: 'var(--bg-glass)', backdropFilter: 'blur(24px) saturate(180%)', borderRight: '0.5px solid var(--border)', boxShadow: '1px 0 12px rgba(0,0,0,0.03)' }}>
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[8px] flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--accent), #5AC8FA)', boxShadow: 'var(--shadow-sm)' }}>
              <Cloud className="w-4 h-4 text-white" strokeWidth={2} />
            </div>
            <span className="text-[14px] font-semibold" style={{ color: 'var(--text)' }}>Cloud Nine</span>
          </div>
        </div>

        <nav className="flex-1 px-3 pb-4 space-y-5">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && <p className="text-[11px] font-medium px-3 mb-1.5 tracking-wide" style={{ color: 'var(--text-tertiary)' }}>{g.label}</p>}
              <div className="space-y-1">
                {g.items.map(item => (
                  <button key={item.id} onClick={() => { onNavigate(item.id); onClose(); }}
                    className={`sidebar-nav-item ${currentPage === item.id ? "active" : ""}`}>
                    <item.icon className="w-[19px] h-[19px] flex-shrink-0" strokeWidth={1.5}
                      style={{ color: currentPage === item.id ? item.color : 'var(--icon-default)' }} />
                    <span className="text-[13px] truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 mt-auto" style={{ borderTop: '0.5px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>存储空间</span>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{fmtSize(used)}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-input)' }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (used / (10*1024*1024*1024*1024))*100)}%`, background: 'linear-gradient(90deg, var(--accent), #5AC8FA)' }} />
          </div>
          {user && (
            <div className="flex items-center gap-2.5 mt-4 pt-3" style={{ borderTop: '0.5px solid var(--border)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-semibold flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--accent), #5AC8FA)' }}>
                {(user.username || "U")[0].toUpperCase()}
              </div>
              <span className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>{user.username}</span>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}