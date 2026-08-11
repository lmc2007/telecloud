import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileIcon } from "../components/FileIcon";
import { useAuthStore } from "../stores/authStore";
import { API_BASE } from "../lib/api";

interface ShareItem {
  id: string; token: string; file_name: string; file_size: number; file_type: string;
  has_password: boolean; expire_at: string | null; max_downloads: number; download_count: number;
  created_at: string; file_count: number;
}

export function SharesPage() {
  const { accessToken } = useAuthStore();
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);
  const load = async () => {
    try { const r = await fetch(`${API_BASE}/shares`, { headers: { Authorization: `Bearer ${accessToken}` } }); const d = await r.json(); if (d.success) setShares(d.data); } catch {} finally { setLoading(false); }
  };

  const remove = async (id: string) => {
    try { await fetch(`${API_BASE}/shares/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }); load(); } catch {}
  };

  if (loading) return <div className="p-6 text-[var(--text-tertiary)] text-[13px]">加载中...</div>;
  if (shares.length === 0) return <div className="p-6 text-center"><p className="text-[var(--text-tertiary)] py-12">暂无分享</p></div>;

  return (
    <div className="p-6">
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)] mb-4">我的分享</h2>
      <div className="space-y-2">
        {shares.map(s => (
          <div key={s.id} className="card p-3 flex items-center gap-3">
            <FileIcon item={{ id: s.id, name: s.file_name, type: s.file_type === "folder" ? "folder" : "file", size: s.file_size, mime_type: "", created_at: 0, updated_at: 0 }} />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{s.file_name}{s.file_count > 1 ? ` (${s.file_count} 个文件)` : ""}</p>
              <p className="text-[11px] text-[var(--text-tertiary)]">
                <Link to={`/s/${s.token}`} className="text-[var(--brand-blue)] hover:underline mr-2">/s/{s.token}</Link>
                下载 {s.download_count}{s.max_downloads > 0 ? `/${s.max_downloads}` : ""}
                {s.has_password ? " · 🔒" : ""}
              </p>
            </div>
            <button onClick={() => remove(s.id)} className="text-[12px] text-[var(--brand-red)] hover:underline flex-shrink-0">删除</button>
          </div>
        ))}
      </div>
    </div>
  );
}
