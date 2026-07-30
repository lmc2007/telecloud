import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Shield, Users, FolderOpen, Share2, HardDrive, Trash2, LogOut, Download, ChevronRight, ChevronDown } from "lucide-react";
import { API_BASE } from "../lib/api";

interface Stats { users: number; files: number; folders: number; shares: number; trash: number; storage_bytes: number; }
interface UserRow { id: number; username: string; email: string | null; storage_used: number; created_at: string; }
interface FileRow { id: string; name: string; size: number; mime_type: string; is_chunks?: boolean; created_at: number; }
interface ShareRow { id: number; token: string; file_name: string; username: string; password: string | null; download_count: number; max_downloads: number | null; expire_at: string | null; created_at: string; }

type Tab = "stats" | "users" | "shares";

function fmtBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fmtDate(v: string | number): string {
  if (typeof v === "number") return new Date(v).toLocaleDateString("zh-CN");
  return new Date(v).toLocaleDateString("zh-CN");
}

export function AdminPanel() {
  const [token, setToken] = useState(() => sessionStorage.getItem("admin_token") || "");
  const [password, setPassword] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("stats");
  const [expandedUser, setExpandedUser] = useState<number | null>(null);
  const [userFiles, setUserFiles] = useState<Record<number, FileRow[]>>({});
  const [loadingFiles, setLoadingFiles] = useState<number | null>(null);
  const [dlProgress, setDlProgress] = useState<{ fileId: string; fileName: string; pct: number; status: string } | null>(null);

  useEffect(() => {
    if (token) { loadStats(token); loadUsers(token); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const h = (t?: string) => ({ Authorization: `Bearer ${t || token}` });

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError("");
    try {
      const res = await fetch(`${API_BASE}/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const data = await res.json();
      if (data.success) { const t = data.data.token; setToken(t); sessionStorage.setItem("admin_token", t); await loadStats(t); await loadUsers(t); }
      else setError(data.error || "登录失败");
    } catch { setError("网络错误"); }
    setLoading(false);
  };

  const loadStats = async (t: string) => { const r = await fetch(`${API_BASE}/admin/stats`, { headers: h(t) }); const d = await r.json(); if (d.success) setStats(d.data); };
  const loadUsers = async (t: string) => { const r = await fetch(`${API_BASE}/admin/users`, { headers: h(t) }); const d = await r.json(); if (d.success) setUsers(d.data.users); };

  const toggleUserFiles = async (userId: number) => {
    if (expandedUser === userId) { setExpandedUser(null); return; }
    setExpandedUser(userId);
    if (!userFiles[userId]) {
      setLoadingFiles(userId);
      try {
        const r = await fetch(`${API_BASE}/admin/users/${userId}/files`, { headers: h() });
        const d = await r.json();
        if (d.success) setUserFiles(prev => ({ ...prev, [userId]: d.data || [] }));
      } catch {}
      setLoadingFiles(null);
    }
  };

  const loadShares = async () => { const r = await fetch(`${API_BASE}/admin/shares`, { headers: h() }); const d = await r.json(); if (d.success) setShares(d.data); };

  const delUser = async (id: number, name: string) => {
    if (!confirm(`确定删除 ${name}？`)) return;
    await fetch(`${API_BASE}/admin/users/${id}`, { method: "DELETE", headers: h() });
    setUsers(p => p.filter(u => u.id !== id));
    setExpandedUser(null);
    await loadStats(token);
  };

  const delFile = async (fileId: string, name: string, userId: number) => {
    if (!confirm(`确定删除 "${name}"？`)) return;
    await fetch(`${API_BASE}/admin/files/${fileId}`, { method: "DELETE", headers: h() });
    setUserFiles(prev => ({ ...prev, [userId]: (prev[userId] || []).filter(f => f.id !== fileId) }));
    await loadStats(token);
  };

  const delShare = async (id: number) => {
    if (!confirm("确定删除此分享？")) return;
    await fetch(`${API_BASE}/admin/shares/${id}`, { method: "DELETE", headers: h() });
    setShares(p => p.filter(s => s.id !== id));
    await loadStats(token);
  };

  const downloadFile = async (fileId: string, fileName: string, isChunks?: boolean) => {
    setDlProgress({ fileId, fileName, pct: 0, status: "获取信息..." });
    try {
      if (isChunks) {
        const infoRes = await fetch(`${API_BASE}/admin/files/${fileId}/chunks`, { headers: h() });
        const infoData = await infoRes.json();
        if (!infoData.success) { alert(infoData.error || "获取分块信息失败"); setDlProgress(null); return; }
        const chunks: { index: number; size: number }[] = infoData.data.chunks || [];
        if (chunks.length <= 1) {
          const res = await fetch(`${API_BASE}/admin/files/${fileId}/download`, { headers: h() });
          if (!res.ok) { alert("下载失败"); setDlProgress(null); return; }
          triggerSave(await res.blob(), fileName);
          setDlProgress({ fileId, fileName, pct: 100, status: "完成" });
          setTimeout(() => setDlProgress(null), 1500);
          return;
        }
        const chunkBlobs: Blob[] = new Array(chunks.length);
        let done = 0;
        const fetchChunk = async (i: number, retries = 3): Promise<Blob> => {
          for (let attempt = 0; attempt <= retries; attempt++) {
            try {
              const r = await fetch(`${API_BASE}/admin/files/${fileId}/chunk/${i}`, { headers: h() });
              if (!r.ok) throw new Error(`chunk ${i} HTTP ${r.status}`);
              return await r.blob();
            } catch (e) {
              if (attempt === retries) throw e;
              await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) + Math.random() * 500));
            }
          }
          throw new Error("unreachable");
        };
        for (let i = 0; i < chunks.length; i++) {
          chunkBlobs[i] = await fetchChunk(i);
          done++;
          setDlProgress({ fileId, fileName, pct: Math.round((done / chunks.length) * 100), status: `下载中 ${done}/${chunks.length}` });
          if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200));
        }
        setDlProgress({ fileId, fileName, pct: 100, status: "组装中..." });
        triggerSave(new Blob(chunkBlobs), fileName);
        setDlProgress({ fileId, fileName, pct: 100, status: "完成" });
        setTimeout(() => setDlProgress(null), 1500);
      } else {
        const res = await fetch(`${API_BASE}/admin/files/${fileId}/download`, { headers: h() });
        if (!res.ok) { alert("下载失败"); setDlProgress(null); return; }
        setDlProgress({ fileId, fileName, pct: 50, status: "下载中..." });
        triggerSave(await res.blob(), fileName);
        setDlProgress({ fileId, fileName, pct: 100, status: "完成" });
        setTimeout(() => setDlProgress(null), 1500);
      }
    } catch (err) {
      alert("下载失败: " + (err instanceof Error ? err.message : "网络错误"));
      setDlProgress(null);
    }
  };

  const triggerSave = (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };

  const logout = () => { setToken(""); sessionStorage.removeItem("admin_token"); setStats(null); setUsers([]); setShares([]); setExpandedUser(null); setUserFiles({}); };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F6F7]">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md mx-4">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-lg bg-gradient-to-br from-[#F53F3F] to-[#FF8F1F] shadow-lg shadow-red-500/25 mb-5">
              <Shield className="w-8 h-8 text-white" strokeWidth={1.8} />
            </div>
            <h1 className="text-3xl font-bold text-[#1F2329]">管理后台</h1>
            <p className="mt-2 text-[#646A73] text-sm">Cloud Nine 系统管理</p>
          </div>
          <div className="bg-white rounded-lg p-8 shadow-[0_2px_20px_rgba(0,0,0,0.06)] border border-[#E5E6EB]">
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-[12px] font-medium text-[#646A73] mb-1.5">管理密码</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="input-primary" placeholder="输入管理员密码" required />
              </div>
              {error && <motion.p initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="text-[#F53F3F] text-[12px] text-center">{error}</motion.p>}
              <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 py-3 text-[15px] font-medium text-white bg-[#1677FF] hover:bg-[#4096FF] rounded-md transition-all active:scale-[0.98] disabled:opacity-50">{loading ? "验证中..." : "登录管理后台"}</button>
            </form>
          </div>
        </motion.div>
      </div>
    );
  }

  const tabs: { key: Tab; icon: any; label: string }[] = [
    { key: "stats", icon: HardDrive, label: "概览" },
    { key: "users", icon: Users, label: "用户" },
    { key: "shares", icon: Share2, label: "分享" },
  ];

  return (
    <div className="min-h-screen bg-[#F5F6F7]">
      <header className="sticky top-0 z-10 bg-white border-b border-[#E5E6EB]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#F53F3F] to-[#FF8F1F] flex items-center justify-center"><Shield className="w-3.5 h-3.5 text-white" /></div>
            <h1 className="text-[15px] font-semibold text-[#1F2329]">Cloud Nine 管理后台</h1>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-[12px] text-[#646A73] hover:text-[#F53F3F] transition-colors"><LogOut className="w-3.5 h-3.5" />退出</button>
        </div>
      </header>

      {dlProgress && (
        <div className="sticky top-12 z-10 bg-white border-b border-[#E5E6EB] px-4 py-2">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <span className="text-[12px] font-medium text-[#1F2329] truncate flex-1">{dlProgress.fileName}</span>
            <span className="text-[11px] text-[#646A73]">{dlProgress.status}</span>
            <div className="w-24 h-1.5 bg-[#E5E6EB] rounded-full overflow-hidden flex-shrink-0">
              <div className="h-full bg-[#1677FF] rounded-full transition-all duration-300" style={{ width: `${dlProgress.pct}%` }} />
            </div>
            <span className="text-[11px] text-[#646A73] w-8 text-right">{dlProgress.pct}%</span>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-center gap-1 mb-6 bg-white rounded-lg p-1 border border-[#E5E6EB] overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); if (t.key === "shares" && shares.length === 0) loadShares(); }} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] transition-all whitespace-nowrap flex-shrink-0 ${tab === t.key ? "bg-[var(--brand-blue-light)] text-[var(--brand-blue)] font-medium" : "text-[#646A73] hover:text-[#1F2329]"}`}>
              <t.icon className="w-3.5 h-3.5" />{t.label}
            </button>
          ))}
        </div>

        {tab === "stats" && stats && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { icon: Users, label: "用户", value: stats.users, color: "text-[#1677FF]" },
              { icon: FolderOpen, label: "文件", value: stats.files, color: "text-[#00B578]" },
              { icon: FolderOpen, label: "文件夹", value: stats.folders, color: "text-[#7C5CFC]" },
              { icon: Share2, label: "分享", value: stats.shares, color: "text-[#FF8F1F]" },
              { icon: Trash2, label: "回收站", value: stats.trash, color: "text-[#F53F3F]" },
              { icon: HardDrive, label: "存储", value: fmtBytes(stats.storage_bytes), color: "text-[#1677FF]" },
            ].map((s: any, i) => (
              <motion.div key={s.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="card p-4">
                <s.icon className={`w-4 h-4 ${s.color} mb-2`} />
                <p className="text-xl font-bold text-[#1F2329]">{s.value}</p>
                <p className="text-[11px] text-[#646A73] mt-1">{s.label}</p>
              </motion.div>
            ))}
          </div>
        )}

        {tab === "users" && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#FAFBFC]"><tr>
                  <th className="w-8" />
                  {["ID","用户名","邮箱","存储","注册"].map(h => <th key={h} className="text-left px-4 py-2.5 text-[11px] font-medium text-[#646A73]">{h}</th>)}
                  <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#646A73]">操作</th>
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <>
                      <tr key={u.id} className="hover:bg-[rgba(22,119,255,0.03)] cursor-pointer border-b border-[#E5E6EB]" onClick={() => toggleUserFiles(u.id)}>
                        <td className="pl-3 py-2.5 text-[#BCC0C6]">
                          {expandedUser === u.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="px-4 py-2.5 text-[#646A73]">{u.id}</td>
                        <td className="px-4 py-2.5 font-medium text-[#1F2329]">{u.username}</td>
                        <td className="px-4 py-2.5 text-[#646A73]">{u.email || "-"}</td>
                        <td className="px-4 py-2.5 text-[#646A73]">{fmtBytes(u.storage_used)}</td>
                        <td className="px-4 py-2.5 text-[#646A73]">{fmtDate(u.created_at)}</td>
                        <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                          <button onClick={() => delUser(u.id, u.username)} className="text-[12px] text-[#F53F3F] hover:text-[#F76560]">删除</button>
                        </td>
                      </tr>
                      {expandedUser === u.id && (
                        <tr key={`${u.id}-files`}>
                          <td colSpan={7} className="p-0 bg-[#FAFBFC]">
                            {loadingFiles === u.id ? (
                              <div className="p-4 text-center text-[#BCC0C6] text-[12px]">加载中...</div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-[12px]">
                                  <thead className="bg-[rgba(0,0,0,0.02)]">
                                    <tr>
                                      <th className="text-left px-4 py-1.5 text-[10px] font-medium text-[#8F959E]">文件名</th>
                                      <th className="text-left px-4 py-1.5 text-[10px] font-medium text-[#8F959E]">类型</th>
                                      <th className="text-left px-4 py-1.5 text-[10px] font-medium text-[#8F959E]">大小</th>
                                      <th className="text-left px-4 py-1.5 text-[10px] font-medium text-[#8F959E]">日期</th>
                                      <th className="text-left px-4 py-1.5 text-[10px] font-medium text-[#8F959E]">操作</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {((userFiles[u.id] || []).length === 0) ? (
                                      <tr><td colSpan={5} className="px-4 py-6 text-center text-[#BCC0C6] text-[12px]">暂无文件</td></tr>
                                    ) : (
                                      (userFiles[u.id] || []).map(f => (
                                        <tr key={f.id} className="hover:bg-white/50 border-b border-[#E5E6EB]/50">
                                          <td className="px-4 py-1.5 font-medium text-[#1F2329] truncate max-w-[250px]">{f.name}</td>
                                          <td className="px-4 py-1.5 text-[#646A73]">{f.mime_type || "文件"}</td>
                                          <td className="px-4 py-1.5 text-[#646A73]">{fmtBytes(f.size)}</td>
                                          <td className="px-4 py-1.5 text-[#646A73]">{fmtDate(f.created_at)}</td>
                                          <td className="px-4 py-1.5">
                                            <div className="flex items-center gap-2">
                                              <button onClick={() => downloadFile(f.id, f.name, f.is_chunks)} className="text-[12px] text-[#1677FF] hover:text-[#4096FF]">下载</button>
                                              <button onClick={() => delFile(f.id, f.name, u.id)} className="text-[12px] text-[#F53F3F] hover:text-[#F76560]">删除</button>
                                            </div>
                                          </td>
                                        </tr>
                                      ))
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {users.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-[#BCC0C6] text-[12px]">暂无用户</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "shares" && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-[#FAFBFC]"><tr>{["Token","文件","创建者","下载数","提取码","过期","创建时间","操作"].map(h => <th key={h} className="text-left px-4 py-2.5 text-[11px] font-medium text-[#646A73]">{h}</th>)}</tr></thead>
                <tbody>
                  {shares.map((s: ShareRow) => (
                    <tr key={s.id} className="hover:bg-[rgba(22,119,255,0.03)] border-b border-[#E5E6EB]">
                      <td className="px-4 py-2.5"><code className="text-[11px] bg-[#FAFBFC] px-1.5 py-0.5 rounded text-[#1677FF]">{s.token}</code></td>
                      <td className="px-4 py-2.5 font-medium text-[#1F2329] truncate max-w-[200px]">{s.file_name}</td>
                      <td className="px-4 py-2.5 text-[#646A73]">{s.username}</td>
                      <td className="px-4 py-2.5 text-[#646A73]">{s.download_count}{s.max_downloads ? `/${s.max_downloads}` : ""}</td>
                      <td className="px-4 py-2.5 text-[#646A73]">{s.password ? "有" : "无"}</td>
                      <td className="px-4 py-2.5 text-[#646A73]">{s.expire_at ? fmtDate(s.expire_at) : "永不过期"}</td>
                      <td className="px-4 py-2.5 text-[#646A73]">{fmtDate(s.created_at)}</td>
                      <td className="px-4 py-2.5"><button onClick={() => delShare(s.id)} className="text-[12px] text-[#F53F3F] hover:text-[#F76560]">删除</button></td>
                    </tr>
                  ))}
                  {shares.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-[#BCC0C6] text-[12px]">暂无数据</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
