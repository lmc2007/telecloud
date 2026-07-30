import { useRef, useEffect } from "react";
import { Cloud } from "lucide-react";
import { useFileStore } from "../stores/fileStore";
import { useAuthStore } from "../stores/authStore";
import { useTransferStore } from "../stores/transferStore";
import { API_BASE } from "../lib/api";

export function UploadZone() {
  const fileRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const isDraggingRef = useRef(false);
  const { fetchFiles, currentFolder } = useFileStore();
  const accessToken = useAuthStore(s => s.accessToken);
  const { addTransfer, updateTransfer } = useTransferStore();

  const folderRef = useRef(currentFolder);
  folderRef.current = currentFolder;

  const setDragging = (v: boolean) => { isDraggingRef.current = v; const el = document.getElementById("drag-overlay"); if (el) el.style.display = v ? "flex" : "none"; };

  useEffect(() => {
    const h = () => fileRef.current?.click();
    window.addEventListener("tcd:open-upload", h);
    return () => window.removeEventListener("tcd:open-upload", h);
  }, []);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => { e.preventDefault(); dragCounter.current++; if (e.dataTransfer?.types.includes("Files")) setDragging(true); };
    const onDragLeave = (e: DragEvent) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current <= 0) { setDragging(false); dragCounter.current = 0; } };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); dragCounter.current = 0; if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files); };
    window.addEventListener("dragenter", onDragEnter); window.addEventListener("dragleave", onDragLeave); window.addEventListener("dragover", onDragOver); window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("dragover", onDragOver); window.removeEventListener("drop", onDrop); };
  }, []);

  const VOLUME = 45 * 1024 * 1024, BUF = 256 * 1024, INT = 65;
  const WS = (api: string) => api;

  const wsVol = (file: File, vi: number, s: number, e: number, onProg: (bytes: number, ts: number) => void): Promise<{ ids: { index: number; file_id: string }[]; received: number }> =>
    new Promise((resolve, reject) => {
      const url = `${WS(API_BASE)}/ws/upload?token=${encodeURIComponent(accessToken!)}${folderRef.current ? `&parent_id=${folderRef.current}` : ""}`;
      const ws = new WebSocket(url); ws.binaryType = "blob";
      let closed = false, volBytes = 0, lastPong = Date.now();
      const hb = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastPong > 60000) { closed = true; clearInterval(hb); try { ws.close(); } catch {} reject(new Error("心跳超时")); return; }
        try { ws.send(JSON.stringify({ type: "ping" })); } catch {}
      }, 15000);
      ws.onopen = () => { ws.send(JSON.stringify({ type: "meta", filename: file.name, totalSize: e - s, volumeIndex: vi })); };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        try { const m = JSON.parse(ev.data);
          if (m.type === "pong") { lastPong = Date.now(); return; }
          if (m.type === "ready") { (async () => { for (let o = s; o < e; o += BUF) { if (closed) return; ws.send(file.slice(o, Math.min(o + BUF, e))); await new Promise(r => setTimeout(r, INT)); } ws.send(JSON.stringify({ type: "volume_done" })); })(); }
          else if (m.type === "progress") { volBytes = s + Math.round((m.percent || 0) / 100 * (e - s)); onProg(volBytes, Date.now()); }
          else if (m.type === "volume_ok") { closed = true; clearInterval(hb); resolve({ ids: m.fileIds || [], received: m.received || 0 }); ws.close(); }
          else if (m.type === "error") { closed = true; clearInterval(hb); reject(new Error(m.error)); ws.close(); }
        } catch(ex) { closed = true; clearInterval(hb); reject(ex as Error); ws.close(); }
      };
      ws.onclose = (ev) => { if (!closed) { closed = true; clearInterval(hb); reject(new Error(`WS关闭 code=${ev.code} ${ev.reason || ""}`)); } };
      ws.onerror = () => { if (!closed) { closed = true; clearInterval(hb); reject(new Error("WS连接失败")); } };
    });

  const uploadWs = async (file: File, tid: string, signal: AbortSignal) => {
    const vols = Math.ceil(file.size / VOLUME);
    updateTransfer(tid, { status: "transferring", uploadedBytes: 0, chunksTotal: vols, chunksDone: 0 });
    try {
      const all: { index: number; file_id: string }[] = [];
      let doneVols = 0, totalBytes = 0;
      const volWithRetry = async (i: number, vs: number, ve: number, maxRetry = 1): Promise<{ index: number; file_id: string }[]> => {
        for (let attempt = 0; attempt <= maxRetry; attempt++) {
          try {
            let lastProgTs = 0;
            const r = await wsVol(file, i, vs, ve, (bytes, ts) => {
              if (ts - lastProgTs < 1000) return; lastProgTs = ts;
              updateTransfer(tid, { uploadedBytes: totalBytes + (bytes - vs), progress: Math.round(((totalBytes + (bytes - vs)) / file.size) * 100) });
            });
            const expSize = ve - vs;
            if (Math.abs(r.received - expSize) > 1024) throw new Error(`卷${i}字节不匹配`);
            if (r.ids.some(x => !x.file_id)) throw new Error(`卷${i}包含空file_id`);
            doneVols++; totalBytes += expSize;
            return r.ids;
          } catch (e) {
            if (attempt === maxRetry) throw e;
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        throw new Error("unreachable");
      };
      for (let vi = 0; vi < vols; vi += 2) {
        if (signal.aborted) throw new Error("已取消");
        const b = [];
        for (let i = vi; i < Math.min(vi + 2, vols); i++) {
          const vs = i * VOLUME, ve = Math.min((i + 1) * VOLUME, file.size);
          b.push(volWithRetry(i, vs, ve));
        }
        (await Promise.all(b)).forEach(r => all.push(...r));
        updateTransfer(tid, { progress: Math.round((totalBytes / file.size) * 100), uploadedBytes: totalBytes, chunksDone: doneVols, chunksTotal: vols });
      }
      if (totalBytes !== file.size) throw new Error(`数据丢失: 已传${(totalBytes/1048576).toFixed(1)}MB, 预期${(file.size/1048576).toFixed(1)}MB`);
      const res = await fetch(`${API_BASE}/files/upload/complete`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ filename: file.name, total_size: file.size, parent_id: folderRef.current || null, file_ids: all }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "完成失败");
      updateTransfer(tid, { status: "done", progress: 100 }); fetchFiles();
    } catch (err) { if (!signal.aborted) updateTransfer(tid, { status: "error", error: err instanceof Error ? err.message : "上传失败" }); }
  };

  const uploadHttp = async (file: File, tid: string, signal: AbortSignal) => {
    updateTransfer(tid, { status: "transferring", uploadedBytes: 0 });
    try {
      if (signal.aborted) throw new Error("已取消");
      const fd = new FormData(); fd.append("file", file); if (folderRef.current) fd.append("parent_id", folderRef.current);
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open("POST", `${API_BASE}/files/upload`);
        xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        signal.addEventListener("abort", () => { xhr.abort(); reject(new Error("已取消")); });
        let lt = Date.now(), ll = 0;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) { const n = Date.now(), el = (n - lt) / 1000; if (el > 1) { updateTransfer(tid, { progress: Math.round((e.loaded / e.total) * 100), speed: Math.round((e.loaded - ll) / el), uploadedBytes: e.loaded }); lt = n; ll = e.loaded; } } };
        xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else { try { reject(new Error(JSON.parse(xhr.responseText).error || "上传失败")); } catch { reject(new Error("上传失败")); } } };
        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.send(fd);
      });
      updateTransfer(tid, { status: "done", progress: 100, uploadedBytes: file.size }); fetchFiles();
    } catch (err) { if (!signal.aborted) updateTransfer(tid, { status: "error", error: err instanceof Error ? err.message : "上传失败" }); }
  };

  const uploadFile = (file: File, tid: string, signal: AbortSignal) =>
    file.size > 95 * 1024 * 1024 ? uploadWs(file, tid, signal) : uploadHttp(file, tid, signal);

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    // Register all transfers immediately so the UI shows the full queue.
    const tasks = list.map(f => {
      const id = crypto.randomUUID(); const ac = new AbortController();
      addTransfer({ id, type: "upload", fileName: f.name, fileSize: f.size, progress: 0, status: "pending", speed: 0, abortController: ac });
      return { file: f, tid: id, signal: ac.signal };
    });
    // Process one at a time — uploadHttp/uploadWs set "transferring" on start.
    for (const t of tasks) {
      await uploadFile(t.file, t.tid, t.signal);
    }
  };

  return (<>
    <input ref={fileRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) { addFiles(e.target.files); e.target.value = ""; } }} />
    <div id="drag-overlay" className="fixed inset-0 z-[100] items-center justify-center" style={{ display: "none", background: "rgba(255,255,255,0.85)" }}>
      <div className="card p-10 flex flex-col items-center gap-3 shadow-lg">
        <Cloud className="w-12 h-12 text-[var(--brand-blue)]" />
        <p className="text-[15px] font-medium text-[var(--text-primary)]">松开以上传文件</p>
        <p className="text-[12px] text-[var(--text-tertiary)]">≤95MB直传  ·  &gt;95MB自动WebSocket分片</p>
      </div>
    </div>
  </>);
}
