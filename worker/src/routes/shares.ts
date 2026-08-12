import { Hono } from "hono";
import type { Env, JwtPayload } from "../types";
import { authGuard } from "../middleware/auth";
import { TelegramService } from "../services/telegram";

type AppEnv = { Bindings: Env; Variables: { user: JwtPayload } };

export const sharesRouter = new Hono<AppEnv>();

function generateToken(length: number): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

/** SHA-256 hash a password for storage */
async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Breadcrumb item for folder browsing in shares */
interface Breadcrumb { id: string; name: string; }

/**
 * Walk up the folder tree from `folderId` to the root, returning breadcrumb
 * path [root, ..., folderId]. Stops at 20 levels to prevent infinite loops.
 */
async function getFolderBreadcrumbs(env: Env, folderId: string): Promise<Breadcrumb[]> {
  const { getFolderMeta } = await import("../storage/kv");
  const crumbs: Breadcrumb[] = [];
  let current: string | null = folderId;
  let depth = 0;
  while (current && depth < 20) {
    const meta = await getFolderMeta(env, current);
    if (!meta) break;
    crumbs.unshift({ id: meta.id, name: meta.name });
    current = meta.parent_id;
    depth++;
  }
  return crumbs;
}

/**
 * Query D1 for all non-deleted children of `folderId` belonging to `userId`.
 * Used for folder shares — always reflects current state (real-time sync).
 */
async function resolveFolderContents(
  env: Env,
  folderId: string,
  userId: number,
): Promise<{ id: string; name: string; type: "file" | "folder"; size: number; mime_type: string; is_chunks: boolean; chunks_count: number }[]> {
  const rows = await env.DB.prepare(
    `SELECT kv_id, name, type, size, mime_type, is_chunks
     FROM files
     WHERE user_id = ? AND parent_kv_id = ? AND deleted = 0
     ORDER BY type DESC, name ASC`
  )
    .bind(userId, folderId)
    .all<{ kv_id: string; name: string; type: string; size: number; mime_type: string | null; is_chunks: number }>();

  return (rows.results || []).map(r => ({
    id: r.kv_id,
    name: r.name,
    type: r.type as "file" | "folder",
    size: r.size || 0,
    mime_type: r.mime_type || "",
    is_chunks: r.is_chunks === 1,
    chunks_count: 0, // populated on-demand for file downloads
  }));
}

/**
 * Atomically increment download_count in D1 with limit check.
 * Uses SQLite single-writer serialization to avoid TOCTOU races.
 * Returns the new count, or -1 if the limit was already reached.
 */
async function atomicIncrementDownload(
  env: Env,
  token: string,
): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE shares
     SET download_count = download_count + 1
     WHERE token = ?
       AND (max_downloads IS NULL OR download_count < max_downloads)`
  )
    .bind(token)
    .run();

  if (result.meta.changes === 0) {
    return -1; // limit reached or token not found
  }

  const row = await env.DB.prepare(
    `SELECT download_count FROM shares WHERE token = ?`
  )
    .bind(token)
    .first<{ download_count: number }>();

  return row?.download_count ?? -1;
}

/**
 * POST /api/shares — create share link (single file, multi-file, single folder, or multi-folder)
 * Accepts file_id (legacy), file_ids (multi-file), folder_id (single folder), or folder_ids (multi-folder).
 * Folder shares are dynamic: they reflect the folder's current contents at access time.
 */
sharesRouter.post("/", authGuard, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    file_id?: string;
    file_ids?: string[];
    folder_id?: string;
    folder_ids?: string[];
    password?: string;
    expire_hours?: number;
    max_downloads?: number;
  }>();

  // Resolve folder IDs: folder_ids (multi) takes priority over folder_id (single)
  const folderIds: string[] = (Array.isArray(body.folder_ids) && body.folder_ids.length > 0)
    ? body.folder_ids.filter(id => id && id.trim())
    : body.folder_id
      ? [body.folder_id.trim()]
      : [];

  if (folderIds.length > 0) {
    // Validate all folders exist and belong to user
    const { getFolderMeta } = await import("../storage/kv");
    const metas = await Promise.all(folderIds.map(id => getFolderMeta(c.env, id)));
    const missing = folderIds.filter((_, i) => !metas[i]);
    if (missing.length > 0) {
      return c.json({ success: false, error: `文件夹不存在: ${missing.join(", ")}` }, 404);
    }
    const unauthorized = folderIds.filter((_, i) => {
      const m = metas[i];
      return m && m.user_id !== undefined && m.user_id !== user.sub;
    });
    if (unauthorized.length > 0) {
      return c.json({ success: false, error: "无权分享此文件夹" }, 403);
    }

    const { password, expire_hours, max_downloads } = body;
    const token = generateToken(12);
    const expireAt = expire_hours
      ? new Date(Date.now() + expire_hours * 3600 * 1000).toISOString()
      : null;
    const hashedPassword = password ? await hashPassword(password) : null;

    const folderIdJson = JSON.stringify(folderIds);
    const d1Result = await c.env.DB.prepare(
      `INSERT INTO shares (file_id, user_id, token, password, expire_at, max_downloads)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(folderIdJson, user.sub, token, hashedPassword, expireAt, max_downloads || null)
      .run();

    if (!d1Result.meta.changes) {
      return c.json({ success: false, error: "创建分享失败，请重试" }, 500);
    }

    const isMultiFolder = folderIds.length > 1;
    const shareInfo = {
      token,
      target_type: (isMultiFolder ? "folders" : "folder") as "folder" | "folders",
      target_id: isMultiFolder ? undefined : folderIds[0],
      target_ids: isMultiFolder ? folderIds : undefined,
      creator_id: String(user.sub),
      created_at: Date.now(),
      expires_at: expireAt ? new Date(expireAt).getTime() : undefined,
      max_downloads: max_downloads || undefined,
      download_count: 0,
      password: hashedPassword || undefined,
    };
    const ttl = shareInfo.expires_at
      ? Math.max(60, Math.floor((shareInfo.expires_at - Date.now()) / 1000))
      : undefined;
    await c.env.METADATA_KV.put(`share:${token}`, JSON.stringify(shareInfo), {
      expirationTtl: ttl,
    });

    return c.json({ success: true, data: { token } }, 201);
  }

  // --- File share path (single or multi) ---
  const fileIds: string[] = (Array.isArray(body.file_ids) && body.file_ids.length > 0)
    ? body.file_ids.filter(id => id && id.trim())
    : body.file_id
      ? [body.file_id]
      : [];

  if (fileIds.length === 0) {
    return c.json({ success: false, error: "缺少文件 ID" }, 400);
  }

  // Validate all files exist in KV
  const { getFileMeta } = await import("../storage/kv");
  const metas = await Promise.all(fileIds.map(id => getFileMeta(c.env, id)));
  const missing = fileIds.filter((_, i) => !metas[i]);
  if (missing.length > 0) {
    return c.json({ success: false, error: `文件不存在: ${missing.join(", ")}` }, 404);
  }

  const { password, expire_hours, max_downloads } = body;
  const token = generateToken(12);
  const expireAt = expire_hours
    ? new Date(Date.now() + expire_hours * 3600 * 1000).toISOString()
    : null;

  const hashedPassword = password ? await hashPassword(password) : null;

  // Store file_ids as JSON array in D1 (backward-compatible: old rows have single string)
  const fileIdJson = JSON.stringify(fileIds);
  const d1Result = await c.env.DB.prepare(
    `INSERT INTO shares (file_id, user_id, token, password, expire_at, max_downloads)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      fileIdJson,
      user.sub,
      token,
      hashedPassword,
      expireAt,
      max_downloads || null
    )
    .run();

  if (!d1Result.meta.changes) {
    return c.json({ success: false, error: "创建分享失败，请重试" }, 500);
  }

  // Also store in KV for quick lookups
  const shareInfo = {
    token,
    target_type: "file" as const,
    target_ids: fileIds,
    created_at: Date.now(),
    expires_at: expireAt ? new Date(expireAt).getTime() : undefined,
    max_downloads: max_downloads || undefined,
    download_count: 0,
    password: hashedPassword || undefined,
    creator_id: String(user.sub),
  };
  const ttl = shareInfo.expires_at
    ? Math.max(60, Math.floor((shareInfo.expires_at - Date.now()) / 1000))
    : undefined;
  await c.env.METADATA_KV.put(`share:${token}`, JSON.stringify(shareInfo), {
    expirationTtl: ttl,
  });

  return c.json({ success: true, data: { token } }, 201);
});

/**
 * GET /api/shares — list my shares
 */
sharesRouter.get("/", authGuard, async (c) => {
  const user = c.get("user");

  const shares = await c.env.DB.prepare(
    `SELECT s.*
     FROM shares s
     WHERE s.user_id = ?
     ORDER BY s.created_at DESC`
  )
    .bind(user.sub)
    .all();

  // Resolve file names from KV (shares.file_id may be single UUID or JSON array)
  // Also detect folder shares by looking up KV share info for target_type.
  const { getFileMeta, getFolderMeta } = await import("../storage/kv");
  const results = await Promise.all(
    shares.results.map(async (s: any) => {
      try {
        // Detect whether file_id is a JSON array (multi-file share) or a plain UUID
        let fileIds: string[];
        try {
          const parsed = JSON.parse(s.file_id);
          fileIds = Array.isArray(parsed) ? parsed : [s.file_id];
        } catch {
          fileIds = [s.file_id];
        }

        // Check KV share info for target_type (folder/file/folders)
        const kvShare = await c.env.METADATA_KV.get(`share:${s.token}`, "json") as any;
        const isFolder = kvShare?.target_type === "folder";
        const isFolders = kvShare?.target_type === "folders";

        if (isFolder) {
          // Single-folder share: resolve folder name
          const folderMeta = fileIds[0] ? await getFolderMeta(c.env, fileIds[0]).catch(() => null) : null;
          return {
            id: s.id,
            file_id: s.file_id,
            token: s.token,
            has_password: !!s.password,
            expire_at: s.expire_at,
            download_count: s.download_count,
            max_downloads: s.max_downloads,
            created_at: s.created_at,
            file_name: folderMeta ? `文件夹: ${folderMeta.name}` : "文件夹: (已删除)",
            file_type: "folder",
            file_size: 0,
            file_count: 0,
          };
        }

        if (isFolders) {
          // Multi-folder share: resolve all folder names
          const folderMetas = await Promise.all(
            fileIds.map(id => getFolderMeta(c.env, id).catch(() => null))
          );
          const validMetas = folderMetas.filter(Boolean) as any[];
          const folderNames = validMetas.map(m => m.name).join("、") || "(已删除)";
          return {
            id: s.id,
            file_id: s.file_id,
            token: s.token,
            has_password: !!s.password,
            expire_at: s.expire_at,
            download_count: s.download_count,
            max_downloads: s.max_downloads,
            created_at: s.created_at,
            file_name: `文件夹 (${fileIds.length} 个): ${folderNames}`,
            file_type: "folder",
            file_size: 0,
            file_count: fileIds.length,
          };
        }

        // File share: resolve file names
        const metas = await Promise.all(
          fileIds.map(id => getFileMeta(c.env, id).catch(() => null))
        );
        const validMetas = metas.filter(Boolean) as any[];
        const fileCount = fileIds.length;
        const displayName = fileCount === 1
          ? (validMetas[0]?.name || "(已删除)")
          : `${fileCount} 个文件`;

        return {
          id: s.id,
          file_id: s.file_id,
          token: s.token,
          has_password: !!s.password,
          expire_at: s.expire_at,
          download_count: s.download_count,
          max_downloads: s.max_downloads,
          created_at: s.created_at,
          file_name: displayName,
          file_type: "file",
          file_size: validMetas.reduce((sum, m) => sum + (m.size || 0), 0),
          file_count: fileCount,
        };
      } catch {
        return {
          id: s.id, file_id: s.file_id, token: s.token,
          has_password: !!s.password, expire_at: s.expire_at,
          download_count: s.download_count, max_downloads: s.max_downloads,
          created_at: s.created_at,
          file_name: "(已删除)", file_type: "file", file_size: 0, file_count: 1,
        };
      }
    })
  );

  return c.json({ success: true, data: results });
});

/**
 * DELETE /api/shares/:id — cancel share
 */
sharesRouter.delete("/:id", authGuard, async (c) => {
  const user = c.get("user");
  const shareId = c.req.param("id");

  const share = await c.env.DB.prepare(
    "SELECT id, token FROM shares WHERE id = ? AND user_id = ?"
  )
    .bind(shareId, user.sub)
    .first<{ id: number; token: string }>();

  if (!share) {
    return c.json({ success: false, error: "分享不存在" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM shares WHERE id = ?")
    .bind(shareId)
    .run();
  await c.env.METADATA_KV.delete(`share:${share.token}`);

  return c.json({ success: true, message: "已取消分享" });
});

/** Helper: resolve target file IDs from share KV info (supports legacy target_id and new target_ids) */
function resolveTargetIds(shareInfo: any): string[] {
  if (Array.isArray(shareInfo.target_ids)) return shareInfo.target_ids;
  if (shareInfo.target_id && shareInfo.target_type !== "folder") return [shareInfo.target_id];
  return [];
}

/**
 * GET /api/s/:token — access share (public, password-gated)
 * For file shares: returns file list.
 * For single-folder shares: dynamically resolves the folder's current contents (real-time sync).
 * For multi-folder shares: returns folder list at root, or folder contents when ?folder_id= is given.
 * Query params:
 *   ?pw=        — share password
 *   ?folder_id= — sub-folder to browse (folder shares only, defaults to root shared folder)
 */
sharesRouter.get("/:token", async (c) => {
  const token = c.req.param("token");

  const shareInfo = await c.env.METADATA_KV.get(`share:${token}`, "json") as {
    token: string;
    target_type?: "file" | "folder" | "folders";
    target_id?: string;
    target_ids?: string[];
    creator_id?: string;
    password?: string;
    expires_at?: number;
    max_downloads?: number;
    download_count: number;
  } | null;

  if (!shareInfo) {
    return c.json(
      { success: false, error: "分享不存在或已失效" },
      404
    );
  }

  if (shareInfo.expires_at && shareInfo.expires_at < Date.now()) {
    await c.env.METADATA_KV.delete(`share:${token}`);
    return c.json({ success: false, error: "分享已过期" }, 410);
  }

  if (
    shareInfo.max_downloads &&
    shareInfo.download_count >= shareInfo.max_downloads
  ) {
    return c.json({ success: false, error: "已达到最大下载次数" }, 410);
  }

  // Require password if share is password-protected
  if (shareInfo.password) {
    const pw = c.req.query("pw") || "";
    if (!pw) {
      return c.json({ success: true, data: { need_password: true } });
    }
    const pwHash = await hashPassword(pw);
    if (pwHash !== shareInfo.password) {
      return c.json({ success: false, error: "提取码错误" }, 403);
    }
  }

  // --- Multi-folder share: root listing or sub-folder browse ---
  if (shareInfo.target_type === "folders" && Array.isArray(shareInfo.target_ids) && shareInfo.target_ids.length > 0) {
    const sharedFolderIds = shareInfo.target_ids;
    const subFolderId = c.req.query("folder_id");
    const creatorId = shareInfo.creator_id ? parseInt(shareInfo.creator_id) : 0;
    const { getFolderMeta } = await import("../storage/kv");

    // If browsing into a specific folder, validate and delegate to folder logic
    if (subFolderId) {
      // Validate: subFolderId must belong to the creator and be a folder
      const folderMeta = await getFolderMeta(c.env, subFolderId);
      if (!folderMeta || (folderMeta.user_id !== undefined && folderMeta.user_id !== creatorId)) {
        return c.json({ success: false, error: "文件夹不存在" }, 404);
      }

      // Security: verify subFolderId is a descendant of one of the shared root folders
      const breadcrumbs = await getFolderBreadcrumbs(c.env, subFolderId);
      const isInScope = breadcrumbs.some(b => sharedFolderIds.includes(b.id))
        || sharedFolderIds.includes(subFolderId);
      if (!isInScope) {
        return c.json({ success: false, error: "文件夹不存在" }, 404);
      }

      // Delegate to folder browse logic
      const contents = await resolveFolderContents(c.env, subFolderId, creatorId);
      const crumbs = await getFolderBreadcrumbs(c.env, subFolderId);

      return c.json({
        success: true,
        data: {
          is_folder: true,
          is_folders: true,
          folder_name: folderMeta.name,
          folder_id: subFolderId,
          root_folder_ids: sharedFolderIds,
          breadcrumbs: crumbs,
          files: contents.map((item, index) => ({
            index,
            id: item.id,
            name: item.name,
            type: item.type,
            size: item.size,
            mime_type: item.mime_type,
            is_chunks: item.is_chunks,
            chunks_count: item.chunks_count,
          })),
          has_password: !!shareInfo.password,
          download_count: shareInfo.download_count,
          max_downloads: shareInfo.max_downloads,
        },
      });
    }

    // Root listing: show all shared folders
    const folderMetas = await Promise.all(
      sharedFolderIds.map(async (id) => {
        const meta = await getFolderMeta(c.env, id).catch(() => null);
        return meta && (meta.user_id === undefined || meta.user_id === creatorId) ? meta : null;
      })
    );
    const validFolders = folderMetas.filter(Boolean) as NonNullable<typeof folderMetas[number]>[];

    return c.json({
      success: true,
      data: {
        is_folder: true,
        is_folders: true,
        root_folder_ids: sharedFolderIds,
        files: validFolders.map((meta, index) => ({
          index,
          id: meta.id,
          name: meta.name,
          type: "folder" as const,
          size: 0,
          mime_type: "",
          is_chunks: false,
          chunks_count: 0,
        })),
        has_password: !!shareInfo.password,
        download_count: shareInfo.download_count,
        max_downloads: shareInfo.max_downloads,
      },
    });
  }

  // --- Single-folder share: dynamic resolution ---
  if (shareInfo.target_type === "folder" && shareInfo.target_id) {
    const rootFolderId = shareInfo.target_id;
    const subFolderId = c.req.query("folder_id") || rootFolderId;
    const creatorId = shareInfo.creator_id ? parseInt(shareInfo.creator_id) : 0;

    // Validate: subFolderId must belong to the creator and be a folder
    const { getFolderMeta } = await import("../storage/kv");
    const folderMeta = await getFolderMeta(c.env, subFolderId);
    if (!folderMeta || (folderMeta.user_id !== undefined && folderMeta.user_id !== creatorId)) {
      return c.json({ success: false, error: "文件夹不存在" }, 404);
    }

    // Security: verify subFolderId is a descendant of the shared root folder.
    // Walk up the parent chain; if we don't encounter rootFolderId, the
    // recipient is trying to escape the share scope.
    if (subFolderId !== rootFolderId) {
      const breadcrumbs = await getFolderBreadcrumbs(c.env, subFolderId);
      const isDescendant = breadcrumbs.some(b => b.id === rootFolderId);
      if (!isDescendant) {
        return c.json({ success: false, error: "文件夹不存在" }, 404);
      }
    }

    // Dynamically resolve current folder contents from D1 (real-time sync!)
    const contents = await resolveFolderContents(c.env, subFolderId, creatorId);
    // Get breadcrumbs from root shared folder down to current folder
    const breadcrumbs = await getFolderBreadcrumbs(c.env, subFolderId);

    return c.json({
      success: true,
      data: {
        is_folder: true,
        folder_name: folderMeta.name,
        folder_id: subFolderId,
        root_folder_id: rootFolderId,
        breadcrumbs,
        files: contents.map((item, index) => ({
          index,
          id: item.id,
          name: item.name,
          type: item.type,
          size: item.size,
          mime_type: item.mime_type,
          is_chunks: item.is_chunks,
          chunks_count: item.chunks_count,
        })),
        has_password: !!shareInfo.password,
        download_count: shareInfo.download_count,
        max_downloads: shareInfo.max_downloads,
      },
    });
  }

  // --- File share: existing logic ---
  const targetIds = resolveTargetIds(shareInfo);
  const { getFileMeta } = await import("../storage/kv");
  const files = (await Promise.all(
    targetIds.map(async (id, index) => {
      const file = await getFileMeta(c.env, id);
      if (!file) return null;
      return {
        index,
        id,
        name: file.name,
        size: file.size,
        mime_type: file.mime_type || "",
        is_chunks: file.is_chunks || false,
        chunks_count: file.chunks?.length || 0,
      };
    })
  )).filter(Boolean);

  if (files.length === 0) {
    return c.json({ success: false, error: "文件不存在" }, 404);
  }

  return c.json({
    success: true,
    data: {
      files,
      has_password: !!shareInfo.password,
      download_count: shareInfo.download_count,
      max_downloads: shareInfo.max_downloads,
      is_multi: targetIds.length > 1,
    },
  });
});

/**
 * Resolve a specific file KV id by index from a share.
 * For file shares: looks up target_ids[fileIndex].
 * For folder shares (single or multi): queries D1 for the folder's current children, picks by index.
 * Multi-folder shares require folderId to be provided (root level has no files, only folders).
 * Returns { kvId, fileMeta } or null.
 */
async function resolveShareFileByIndex(
  env: Env,
  shareInfo: any,
  fileIndex: number,
  folderId?: string,
): Promise<{ kvId: string; fileMeta: any } | null> {
  // Folder share (single or multi): resolve from D1
  if ((shareInfo.target_type === "folder" || shareInfo.target_type === "folders") && (shareInfo.target_id || shareInfo.target_ids?.length > 0)) {
    const creatorId = shareInfo.creator_id ? parseInt(shareInfo.creator_id) : 0;
    const targetFolder = folderId || (shareInfo.target_type === "folder" ? shareInfo.target_id : undefined);
    if (!targetFolder) return null; // multi-folder share requires explicit folderId
    const contents = await resolveFolderContents(env, targetFolder, creatorId);
    const filesOnly = contents.filter(c => c.type === "file");
    if (fileIndex < 0 || fileIndex >= filesOnly.length) return null;
    const file = filesOnly[fileIndex];
    const { getFileMeta } = await import("../storage/kv");
    const meta = await getFileMeta(env, file.id);
    if (!meta) return null;
    return { kvId: file.id, fileMeta: meta };
  }

  // File share: use target_ids
  const ids = resolveTargetIds(shareInfo);
  if (fileIndex < 0 || fileIndex >= ids.length) return null;
  const { getFileMeta } = await import("../storage/kv");
  const meta = await getFileMeta(env, ids[fileIndex]);
  if (!meta) return null;
  return { kvId: ids[fileIndex], fileMeta: meta };
}

// Legacy helper kept for backward compat (used only by file-share paths)
function getTargetFileId(shareInfo: any, fileIndex: number): string | null {
  if (shareInfo.target_type === "folder" || shareInfo.target_type === "folders") return null; // not applicable
  const ids = resolveTargetIds(shareInfo);
  if (fileIndex < 0 || fileIndex >= ids.length) return null;
  return ids[fileIndex];
}

/**
 * GET /api/s/:token/chunks — get chunk metadata (public)
 * Query: ?file_index=N (required for multi-file shares, defaults to 0 for legacy)
 *        ?folder_id=X  (for folder shares, the sub-folder containing the file)
 */
sharesRouter.get("/:token/chunks", async (c) => {
  const token = c.req.param("token");
  const fileIndex = parseInt(c.req.query("file_index") || "0") || 0;
  const folderId = c.req.query("folder_id") || undefined;

  const shareInfo = await c.env.METADATA_KV.get(`share:${token}`, "json") as {
    token: string; target_type?: string; target_id?: string; target_ids?: string[]; creator_id?: string;
    password?: string; expires_at?: number; max_downloads?: number; download_count: number;
  } | null;
  if (!shareInfo) return c.json({ success: false, error: "分享不存在" }, 404);
  if (shareInfo.expires_at && shareInfo.expires_at < Date.now()) return c.json({ success: false, error: "分享已过期" }, 410);
  if (shareInfo.max_downloads && shareInfo.download_count >= shareInfo.max_downloads) return c.json({ success: false, error: "已达到最大下载次数" }, 410);
  // Password check (hashed comparison)
  if (shareInfo.password) {
    const pw = c.req.query("pw") || c.req.header("X-Share-Password") || "";
    const pwHash = await hashPassword(pw);
    if (pwHash !== shareInfo.password) return c.json({ success: false, error: "需要提取码", need_password: true }, 403);
  }

  // Resolve file by index (works for both file and folder shares)
  const resolved = await resolveShareFileByIndex(c.env, shareInfo, fileIndex, folderId);
  if (!resolved) return c.json({ success: false, error: "文件不存在" }, 404);

  // Atomic increment via D1 — /chunks is the entry point for chunked downloads.
  const newCount = await atomicIncrementDownload(c.env, token);
  if (newCount < 0) {
    return c.json({ success: false, error: "已达到最大下载次数" }, 410);
  }
  // Sync KV
  shareInfo.download_count = newCount;
  const ttl = shareInfo.expires_at
    ? Math.max(60, Math.floor((shareInfo.expires_at - Date.now()) / 1000))
    : undefined;
  await c.env.METADATA_KV.put(`share:${token}`, JSON.stringify(shareInfo), { expirationTtl: ttl });

  const file = resolved.fileMeta;
  if (!file?.chunks) return c.json({ success: false, error: "不是分块文件" }, 400);

  return c.json({
    success: true,
    data: {
      name: file.name,
      size: file.size,
      mime_type: file.mime_type,
      chunks: file.chunks.map((ch: any) => ({ index: ch.index, size: ch.size })),
    },
  });
});

/**
 * GET /api/s/:token/chunk/:index — download single chunk (public)
 * Query: ?file_index=N & ?folder_id=X (required for multi-file/folder shares)
 */
sharesRouter.get("/:token/chunk/:index", async (c) => {
  const token = c.req.param("token");
  const chunkIdx = parseInt(c.req.param("index"));
  const fileIndex = parseInt(c.req.query("file_index") || "0") || 0;
  const folderId = c.req.query("folder_id") || undefined;
  if (isNaN(chunkIdx) || chunkIdx < 0) return c.json({ success: false, error: "Invalid chunk index" }, 400);

  const shareInfo = await c.env.METADATA_KV.get(`share:${token}`, "json") as {
    token: string; target_type?: string; target_id?: string; target_ids?: string[]; creator_id?: string;
    password?: string; expires_at?: number; max_downloads?: number; download_count: number;
  } | null;
  if (!shareInfo) return c.json({ success: false, error: "分享不存在" }, 404);
  if (shareInfo.expires_at && shareInfo.expires_at < Date.now()) return c.json({ success: false, error: "分享已过期" }, 410);
  // Password check (hashed comparison) — chunk endpoint does NOT increment download_count.
  if (shareInfo.password) {
    const pw = c.req.query("pw") || c.req.header("X-Share-Password") || "";
    const pwHash = await hashPassword(pw);
    if (pwHash !== shareInfo.password) return c.json({ success: false, error: "需要提取码", need_password: true }, 403);
  }

  // Resolve file by index (works for both file and folder shares)
  const resolved = await resolveShareFileByIndex(c.env, shareInfo, fileIndex, folderId);
  if (!resolved) return c.json({ success: false, error: "文件不存在" }, 404);

  const { getFileMeta, setFileMeta } = await import("../storage/kv");
  const meta = resolved.fileMeta;
  if (!meta?.chunks || chunkIdx >= meta.chunks.length) return c.json({ success: false, error: "Chunk not found" }, 404);

  const chunk = meta.chunks[chunkIdx];
  const { getFile, getFileStream, getFileBytes } = await import("../bot/telegram");

  // Shared chunk recovery helper
  const recoverFromRecord = async (): Promise<string | null> => {
    const recordFileId = meta.telegram_file_id;
    if (!recordFileId) return null;
    try {
      const recordFile = await getFile(c.env, recordFileId);
      if (!recordFile.file_path) return null;
      const recordBytes = await getFileBytes(c.env, recordFile.file_path);
      const text = new TextDecoder().decode(recordBytes);
      const parsed = JSON.parse(text) as { recordFile?: boolean; fileIds?: string[] };
      if (parsed.recordFile && Array.isArray(parsed.fileIds) && parsed.fileIds.length > chunkIdx) {
        const recovered = parsed.fileIds[chunkIdx];
        if (recovered && recovered.trim()) return recovered;
      }
    } catch {}
    return null;
  };

  // Resolve file_id
  let effectiveFileId = chunk.telegram_file_id;
  if (!effectiveFileId) {
    const recovered = await recoverFromRecord();
    if (recovered) effectiveFileId = recovered;
  }

  if (!effectiveFileId) {
    return c.json({ success: false, error: `Chunk ${chunkIdx} has empty file_id` }, 500);
  }

  // Resolve file_path with smart retry
  let filePath: string | null = chunk.file_path || null;
  if (!filePath) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const file = await getFile(c.env, effectiveFileId);
        if (file.file_path) { filePath = file.file_path; break; }
        break; // empty file_path means permanent
      } catch (e) {
        const msg = (e as Error).message || "";
        const isPermanent = (msg.includes("file_id") && (msg.includes("invalid") || msg.includes("not found"))) || msg.includes("file is too big");
        if (isPermanent) break;
        if (attempt < 4) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  // Try recovery if primary file_id failed
  if (!filePath) {
    const recovered = await recoverFromRecord();
    if (recovered && recovered !== effectiveFileId) {
      effectiveFileId = recovered;
      try { const f = await getFile(c.env, effectiveFileId); if (f.file_path) filePath = f.file_path; } catch {}
    }
  }

  if (!filePath) {
    return c.json({ success: false, error: `Chunk ${chunkIdx} unavailable` }, 500);
  }

  // Download from CDN
  let resp: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await getFileStream(c.env, filePath);
    if (r.ok && r.body) { resp = r; break; }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }

  if (!resp || !resp.body) {
    return c.json({ success: false, error: `Chunk ${chunkIdx} CDN download failed` }, 500);
  }

  return new Response(resp.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "public, max-age=31536000",
    },
  });
});

/**
 * POST /api/s/:token/download — download shared file
 * Body: { password?, verify_only?, file_index?, folder_id? }
 */
sharesRouter.post("/:token/download", async (c) => {
  const token = c.req.param("token");
  const body = await c.req
    .json<{ password?: string; verify_only?: boolean; file_index?: number; folder_id?: string }>()
    .catch(() => ({ password: undefined, verify_only: false, file_index: 0 }));
  const { password, verify_only } = body;
  const fileIndex = body.file_index ?? 0;
  const folderId = body.folder_id || undefined;

  const shareInfo = await c.env.METADATA_KV.get(
    `share:${token}`,
    "json"
  ) as {
    token: string;
    target_type?: string;
    target_id?: string;
    target_ids?: string[];
    creator_id?: string;
    password?: string;
    expires_at?: number;
    max_downloads?: number;
    download_count: number;
  } | null;

  if (!shareInfo) {
    return c.json(
      { success: false, error: "分享不存在或已失效" },
      404
    );
  }

  if (shareInfo.expires_at && shareInfo.expires_at < Date.now()) {
    return c.json({ success: false, error: "分享已过期" }, 410);
  }

  // Password check (hashed comparison)
  if (shareInfo.password) {
    if (!password) {
      return c.json({ success: false, error: "需要提取码", need_password: true }, 403);
    }
    const pwHash = await hashPassword(password);
    if (pwHash !== shareInfo.password) {
      return c.json({ success: false, error: "提取码错误" }, 403);
    }
  }

  // Resolve file by index (works for both file and folder shares)
  const resolved = await resolveShareFileByIndex(c.env, shareInfo, fileIndex, folderId);
  if (!resolved) {
    return c.json({ success: false, error: "文件不存在" }, 404);
  }

  if (verify_only) {
    return c.json({ success: true, message: "验证通过" });
  }

  // Atomic increment via D1 (avoids TOCTOU race)
  const newCount = await atomicIncrementDownload(c.env, token);
  if (newCount < 0) {
    return c.json({ success: false, error: "已达到最大下载次数" }, 410);
  }

  // Sync KV
  shareInfo.download_count = newCount;
  const ttl = shareInfo.expires_at
    ? Math.max(60, Math.floor((shareInfo.expires_at - Date.now()) / 1000))
    : undefined;
  await c.env.METADATA_KV.put(`share:${token}`, JSON.stringify(shareInfo), {
    expirationTtl: ttl,
  });

  // Delegate to download handler
  const { downloadFile } = await import("../handlers/download");
  return downloadFile(c.env, resolved.kvId, null);
});

/**
 * GET /api/s/:token/stream — preview/stream shared file (public, no download count)
 * Used by <img>/<video> native tags for inline preview.
 * Query: ?file_index=N & ?folder_id=X (defaults to 0 for legacy single-file shares)
 */
sharesRouter.get("/:token/stream", async (c) => {
  const token = c.req.param("token");
  const fileIndex = parseInt(c.req.query("file_index") || "0") || 0;
  const folderId = c.req.query("folder_id") || undefined;

  const shareInfo = await c.env.METADATA_KV.get(
    `share:${token}`,
    "json"
  ) as {
    token: string;
    target_type?: string;
    target_id?: string;
    target_ids?: string[];
    creator_id?: string;
    password?: string;
    expires_at?: number;
    max_downloads?: number;
    download_count: number;
  } | null;

  if (!shareInfo) {
    return c.json({ success: false, error: "分享不存在或已失效" }, 404);
  }

  if (shareInfo.expires_at && shareInfo.expires_at < Date.now()) {
    return c.json({ success: false, error: "分享已过期" }, 410);
  }

  // Check max downloads (read-only, don't increment)
  if (shareInfo.max_downloads && shareInfo.download_count >= shareInfo.max_downloads) {
    return c.json({ success: false, error: "已达到最大下载次数" }, 410);
  }

  // Password check
  if (shareInfo.password) {
    const pw = c.req.query("pw") || c.req.header("X-Share-Password") || "";
    if (!pw) {
      return c.json({ success: false, error: "需要提取码", need_password: true }, 403);
    }
    const pwHash = await hashPassword(pw);
    if (pwHash !== shareInfo.password) {
      return c.json({ success: false, error: "提取码错误" }, 403);
    }
  }

  // Resolve file by index (works for both file and folder shares)
  const resolved = await resolveShareFileByIndex(c.env, shareInfo, fileIndex, folderId);
  if (!resolved) {
    return c.json({ success: false, error: "文件不存在" }, 404);
  }

  // Support Range requests for video seeking
  const rangeHeader = c.req.header("Range");
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      range = {
        start: parseInt(match[1]),
        end: match[2] ? parseInt(match[2]) : Infinity,
      };
    }
  }

  const { downloadFile } = await import("../handlers/download");
  return downloadFile(c.env, resolved.kvId, range);
});
