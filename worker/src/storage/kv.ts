import type { Env, FileMetadata, FolderMetadata, ShareInfo, SessionData, PathMapping, RootConfig } from "../types";

// ==============================
// File metadata
// ==============================

export async function getFileMeta(env: Env, fileId: string): Promise<FileMetadata | null> {
  const raw = await env.METADATA_KV.get(`file:${fileId}`, "json");
  return raw as FileMetadata | null;
}

export async function setFileMeta(env: Env, fileId: string, meta: FileMetadata): Promise<void> {
  await env.METADATA_KV.put(`file:${fileId}`, JSON.stringify(meta));
  // Sync to D1 admin index — await to ensure consistency
  await env.DB.prepare(
    `INSERT OR REPLACE INTO files(kv_id, user_id, parent_kv_id, name, type, size, mime_type, is_chunks, created_at, updated_at)
     VALUES(?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)`
  ).bind(fileId, meta.user_id||0, meta.parent_id, meta.name, meta.size, meta.mime_type||"", meta.is_chunks?1:0, meta.created_at, meta.updated_at).run().catch((e: any) => { console.error("[D1 sync] setFileMeta failed:", e?.message); });
}

export async function deleteFileMeta(env: Env, fileId: string): Promise<void> {
  await env.METADATA_KV.delete(`file:${fileId}`);
  await env.DB.prepare("DELETE FROM files WHERE kv_id = ?").bind(fileId).run().catch((e: any) => { console.error("[D1 sync] deleteFileMeta failed:", e?.message); });
}

// ==============================
// Folder metadata
// ==============================

export async function getFolderMeta(env: Env, folderId: string): Promise<FolderMetadata | null> {
  const raw = await env.METADATA_KV.get(`folder:${folderId}`, "json");
  return raw as FolderMetadata | null;
}

export async function setFolderMeta(env: Env, folderId: string, meta: FolderMetadata): Promise<void> {
  await env.METADATA_KV.put(`folder:${folderId}`, JSON.stringify(meta));
  await env.DB.prepare(
    `INSERT OR REPLACE INTO files(kv_id, user_id, parent_kv_id, name, type, size, created_at, updated_at)
     VALUES(?, ?, ?, ?, 'folder', 0, ?, ?)`
  ).bind(folderId, meta.user_id||0, meta.parent_id, meta.name, meta.created_at, meta.updated_at).run().catch((e: any) => { console.error("[D1 sync] setFolderMeta failed:", e?.message); });
}

export async function deleteFolderMeta(env: Env, folderId: string): Promise<void> {
  await env.METADATA_KV.delete(`folder:${folderId}`);
  await env.DB.prepare("DELETE FROM files WHERE kv_id = ?").bind(folderId).run().catch((e: any) => { console.error("[D1 sync] deleteFolderMeta failed:", e?.message); });
}

// ==============================
// Path mapping
// ==============================

export async function getPathMapping(env: Env, path: string): Promise<PathMapping | null> {
  const raw = await env.METADATA_KV.get(`path:${path}`, "json");
  return raw as PathMapping | null;
}

export async function setPathMapping(env: Env, path: string, mapping: PathMapping): Promise<void> {
  await env.METADATA_KV.put(`path:${path}`, JSON.stringify(mapping));
}

export async function deletePathMapping(env: Env, path: string): Promise<void> {
  await env.METADATA_KV.delete(`path:${path}`);
}

// ==============================
// Children list (for folder contents)
// ==============================
//
// Uses independent KV keys per child to avoid read-modify-write races.
// child:{folderId}:{childId} → "1"
// Two concurrent addChild calls can't lose each other's writes.

const CHILD_KEY_PREFIX = "child:";

export async function getChildren(env: Env, folderId: string): Promise<string[]> {
  // New-style: scan independent child keys
  const prefix = `${CHILD_KEY_PREFIX}${folderId}:`;
  const listed = await env.METADATA_KV.list({ prefix });
  const childIds = listed.keys.map(k => k.name.slice(prefix.length));
  
  // Migration: if no new-style keys, try old-style array and migrate
  if (childIds.length === 0) {
    const raw = await env.METADATA_KV.get(`children:${folderId}`, "json");
    const oldChildren = (raw as string[]) || [];
    if (oldChildren.length > 0) {
      // Migrate each child to new-style keys
      await Promise.all(oldChildren.map(cid =>
        env.METADATA_KV.put(`${CHILD_KEY_PREFIX}${folderId}:${cid}`, "1")
      ));
      // Delete old key (non-critical, best-effort)
      await env.METADATA_KV.delete(`children:${folderId}`).catch(() => {});
      return oldChildren;
    }
  }
  
  return childIds;
}

export async function setChildren(env: Env, folderId: string, children: string[]): Promise<void> {
  // Bulk write for migration/recovery (not used in normal flow)
  await Promise.all(children.map(cid =>
    env.METADATA_KV.put(`${CHILD_KEY_PREFIX}${folderId}:${cid}`, "1")
  ));
}

export async function addChild(env: Env, folderId: string, childId: string): Promise<void> {
  await env.METADATA_KV.put(`${CHILD_KEY_PREFIX}${folderId}:${childId}`, "1");
  await env.DB.prepare("UPDATE files SET parent_kv_id = ? WHERE kv_id = ?").bind(folderId, childId).run().catch(() => {});
}

export async function removeChild(env: Env, folderId: string, childId: string): Promise<void> {
  await env.METADATA_KV.delete(`${CHILD_KEY_PREFIX}${folderId}:${childId}`);
  await env.DB.prepare("UPDATE files SET parent_kv_id = NULL WHERE kv_id = ?").bind(childId).run().catch(() => {});
}

// ==============================
// Shares
// ==============================

export async function getShare(env: Env, token: string): Promise<ShareInfo | null> {
  const raw = await env.METADATA_KV.get(`share:${token}`, "json");
  return raw as ShareInfo | null;
}

export async function setShare(env: Env, token: string, info: ShareInfo): Promise<void> {
  // Set expiry based on the share's own expires_at
  const ttl = info.expires_at ? Math.max(60, Math.floor((info.expires_at - Date.now()) / 1000)) : undefined;
  await env.METADATA_KV.put(`share:${token}`, JSON.stringify(info), { expirationTtl: ttl });
}

export async function deleteShare(env: Env, token: string): Promise<void> {
  await env.METADATA_KV.delete(`share:${token}`);
}

// ==============================
// Sessions
// ==============================

export async function getSession(env: Env, sessionId: string): Promise<SessionData | null> {
  const raw = await env.METADATA_KV.get(`session:${sessionId}`, "json");
  return raw as SessionData | null;
}

export async function setSession(env: Env, sessionId: string, data: SessionData): Promise<void> {
  const ttl = Math.max(60, Math.floor((data.expires_at - Date.now()) / 1000));
  await env.METADATA_KV.put(`session:${sessionId}`, JSON.stringify(data), { expirationTtl: ttl });
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.METADATA_KV.delete(`session:${sessionId}`);
}

// ==============================
// Root config
// ==============================

export async function getRootConfig(env: Env): Promise<RootConfig | null> {
  const raw = await env.METADATA_KV.get("config:root", "json");
  return raw as RootConfig | null;
}

export async function setRootConfig(env: Env, config: RootConfig): Promise<void> {
  await env.METADATA_KV.put("config:root", JSON.stringify(config));
}
