import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "../stores/authStore";
import { API_BASE } from "../lib/api";
import { fmtSize } from "../lib/utils";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, accessToken, setUser } = useAuthStore();
  const [tab, setTab] = useState<"profile" | "password">("profile");
  const [email, setEmail] = useState(user?.email || "");
  const [profileMsg, setProfileMsg] = useState("");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [storage, setStorage] = useState<{ used: number; files: number; folders: number } | null>(null);

  useEffect(() => { if (open) { setEmail(user?.email || ""); setTab("profile"); loadStorage(); } }, [open]);

  const loadStorage = async () => {
    try { const r = await fetch(`${API_BASE}/user/storage`, { headers: { Authorization: `Bearer ${accessToken}` } }); const d = await r.json(); if (d.success) setStorage(d.data); } catch {}
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" onClick={onClose} />
          <motion.div className="modal-panel w-[420px]" initial={{ scale: 0.95, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 10 }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border-light)]">
              <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">设置</h3>
              <button onClick={onClose} className="btn-ghost text-sm">✕</button>
            </div>
            <div className="flex border-b border-[var(--border-light)]">
              {[{ k: "profile" as const, l: "个人信息" }, { k: "password" as const, l: "修改密码" }].map(t => (
                <button key={t.k} onClick={() => setTab(t.k)} className={`tab-item flex-1 ${tab === t.k ? "active" : ""}`}>{t.l}</button>
              ))}
            </div>
            <div className="p-5">
              {tab === "profile" ? (
                <div className="space-y-4">
                  <div className="text-[13px] text-[var(--text-secondary)]">
                    用户名: <span className="font-medium text-[var(--text-primary)]">{user?.username}</span>
                  </div>
                  {storage && (
                    <div className="text-[13px] text-[var(--text-secondary)]">
                      已用: <span className="font-medium text-[var(--text-primary)]">{fmtSize(user?.storage_used || 0)}</span> · {storage.files} 文件, {storage.folders} 文件夹
                    </div>
                  )}
                  <div>
                    <label className="text-[12px] font-medium text-[var(--text-secondary)] mb-1 block">邮箱</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="input-primary" placeholder="可选" />
                  </div>
                  {profileMsg && <p className="text-[12px] text-[var(--brand-green)]">{profileMsg}</p>}
                  <button onClick={async () => {
                    try {
                      const r = await fetch(`${API_BASE}/user/profile`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ email: email.trim() || null }) });
                      const d = await r.json();
                      if (d.success) { setProfileMsg("已保存"); if (user) setUser({ ...user, email: email.trim() || null }); }
                    } catch {}
                  }} className="btn-primary w-full py-2 text-[13px]">保存</button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div><input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} className="input-primary" placeholder="当前密码" /></div>
                  <div><input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} className="input-primary" placeholder="新密码（至少8位）" /></div>
                  <div><input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} className="input-primary" placeholder="确认新密码" /></div>
                  {pwMsg && <p className="text-[12px] text-[var(--brand-green)]">{pwMsg}</p>}{pwErr && <p className="text-[12px] text-[var(--brand-red)]">{pwErr}</p>}
                  <button onClick={async () => {
                    setPwErr(""); if (newPw.length < 8) { setPwErr("至少8个字符"); return; } if (newPw !== confirmPw) { setPwErr("两次输入不一致"); return; }
                    try { const r = await fetch(`${API_BASE}/user/password`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ old_password: oldPw, new_password: newPw }) }); const d = await r.json(); if (d.success) { setPwMsg("密码已更新"); setOldPw(""); setNewPw(""); setConfirmPw(""); } else setPwErr(d.error); } catch { setPwErr("网络错误"); }
                  }} className="btn-primary w-full py-2 text-[13px]">修改密码</button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
