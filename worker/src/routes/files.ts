import { Hono } from "hono";
import type { Env, JwtPayload, FileMetadata, FolderMetadata } from "../types";
import { authGuard } from "../middleware/auth";
import {
  getFileMeta,
  setFileMeta,
  deleteFileMeta,
  getFolderMeta,
  setFolderMeta,
  deleteFolderMeta,
  addChild,
  removeChild,
  getRootConfig,
} from "../storage/kv";
import { humanReadableSize, generateUUID } from "../utils/common";

type AppEnv = { Bindings: Env; Variables: { user: JwtPayload } };

export const filesRouter = new Hono<AppEnv>();

filesRouter.use("*", authGuard);

// Helper: get or create user root folder
async function getUserRootFolder(
  env: Env,
  userId: number
): Promise<string | null> {
  const rootKey = `user_root:${userId}`;
  let rootId = await env.METADATA_KV.get(rootKey);
  if (rootId) return rootId;

  // Get user's Telegram thread_id from D1
  let topicId: number | undefined;
  try {
    const user = await env.DB.prepare("SELECT tg_thread_id FROM users WHERE id = ?")
      .bind(userId).first<{ tg_thread_id: number | null }>();
    topicId = user?.tg_thread_id ?? undefined;
  } catch {}

  // Create user root folder
  const rootId_new = generateUUID();
  const now = Date.now();
  const meta: FolderMetadata = {
    id: rootId_new,
    name: "全部文件",
    parent_id: null,
    created_at: now,
    updated_at: now,
    path: `/${userId}/`,
    child_count: 0,
    user_id: userId,
    topic_id: topicId,
  };
  await setFolderMeta(env, rootId_new, meta);
  await env.METADATA_KV.put(rootKey, rootId_new);
  return rootId_new;
}

/**
 * GET /api/files?parent_id=
 * Uses D1 for listing (single query, much faster than KV loop + avoids KV quota).
 */
filesRouter.get("/", async (c) => {
  const user = c.get("user");
  const parentId = c.req.query("parent_id") || null;
  const type = c.req.query("type") || null;

  const targetId = parentId || (await getUserRootFolder(c.env, user.sub));
  if (!targetId) {
    return c.json({ success: true, data: [] });
  }

  // root-level files have parent_kv_id=NULL; include them when listing the root folder
  const isRoot = !parentId;
  const rows = await c.env.DB.prepare(
    `SELECT kv_id as id, name, type, size, mime_type, is_chunks, created_at, updated_at
     FROM files
     WHERE user_id = ? AND deleted = 0
       AND (parent_kv_id = ? ${isRoot ? "OR parent_kv_id IS NULL" : ""})
     ORDER BY type DESC, name ASC`
  ).bind(user.sub, targetId).all();

  const entries = rows.results.map((r: any) => {
    const created = parseInt(r.created_at) || 0;
    const updated = r.updated_at ? parseInt(r.updated_at) || undefined : undefined;
    if (r.type === "folder") {
      return {
        id: r.id, name: r.name, type: "folder", size: 0, size_formatted: "",
        child_count: 0, created_at: created, path: "",
      };
    }
    return {
      id: r.id, name: r.name, type: "file", size: r.size || 0,
      size_formatted: humanReadableSize(r.size || 0), mime_type: r.mime_type || undefined,
      is_chunks: !!r.is_chunks, created_at: created, updated_at: updated,
      download_url: `/api/files/${r.id}/download`,
    };
  }).filter((e: any) => {
    if (type === "folder" && e.type !== "folder") return false;
    if (type === "file" && e.type !== "file") return false;
    return true;
  });

  return c.json({ success: true, data: entries });
});

/**
 * POST /api/files/folder
 */
filesRouter.post("/folder", async (c) => {
  const user = c.get("user");
  const { name, parent_id } = await c.req.json<{
    name: string;
    parent_id?: string | null;
  }>();

  if (!name || name.trim().length === 0) {
    return c.json({ success: false, error: "文件夹名称不能为空" }, 400);
  }
  if (name.includes("/") || name.includes("\\")) {
    return c.json(
      { success: false, error: "名称不能包含路径分隔符" },
      400
    );
  }

  const actualParentId =
    parent_id || (await getUserRootFolder(c.env, user.sub));
  if (!actualParentId) {
    return c.json({ success: false, error: "无法创建文件夹" }, 500);
  }

  // Check duplicate via D1
  const dup = await c.env.DB.prepare(
    "SELECT 1 FROM files WHERE user_id = ? AND parent_kv_id = ? AND name = ? AND type = 'folder' AND deleted = 0"
  ).bind(user.sub, actualParentId, name.trim()).first();
  if (dup) {
    return c.json({ success: false, error: "同名文件夹已存在" }, 409);
  }

  const folderId = generateUUID();
  const parentFolder = await getFolderMeta(c.env, actualParentId);
  const parentPath = parentFolder?.path || `/${user.sub}/`;
  const path = parentPath.endsWith("/")
    ? `${parentPath}${name.trim()}`
    : `${parentPath}/${name.trim()}`;

  const now = Date.now();
  const meta: FolderMetadata = {
    id: folderId,
    name: name.trim(),
    parent_id: actualParentId,
    created_at: now,
    updated_at: now,
    path,
    child_count: 0,
    user_id: user.sub,
  };

  await setFolderMeta(c.env, folderId, meta);
  await addChild(c.env, actualParentId, folderId);

  // Update parent child_count
  if (parentFolder) {
    parentFolder.child_count = (parentFolder.child_count || 0) + 1;
    await setFolderMeta(c.env, actualParentId, parentFolder);
  }

  return c.json({ success: true, data: meta }, 201);
});

/**
 * PUT /api/files/:id/rename
 */
filesRouter.put("/:id/rename", async (c) => {
  const user = c.get("user");
  const entryId = c.req.param("id");
  const { name } = await c.req.json<{ name: string }>();

  if (!name || name.trim().length === 0) {
    return c.json({ success: false, error: "名称不能为空" }, 400);
  }

  // Try file
  const file = await getFileMeta(c.env, entryId);
  if (file && (!file.user_id || file.user_id === user.sub)) {
    file.name = name.trim();
    file.updated_at = Date.now();
    await setFileMeta(c.env, entryId, file);
    return c.json({ success: true, message: "重命名成功" });
  }

  // Try folder
  const folder = await getFolderMeta(c.env, entryId);
  if (folder && (!folder.user_id || folder.user_id === user.sub)) {
    folder.name = name.trim();
    folder.updated_at = Date.now();
    await setFolderMeta(c.env, entryId, folder);
    return c.json({ success: true, message: "重命名成功" });
  }

  return c.json({ success: false, error: "文件不存在" }, 404);
});

/**
 * PUT /api/files/:id/move
 */
filesRouter.put("/:id/move", async (c) => {
  const user = c.get("user");
  const entryId = c.req.param("id");
  const { target_parent_id } = await c.req.json<{
    target_parent_id: string | null;
  }>();

  const actualTarget =
    target_parent_id || (await getUserRootFolder(c.env, user.sub));
  if (!actualTarget) {
    return c.json({ success: false, error: "目标不存在" }, 404);
  }

  // Try file
  const file = await getFileMeta(c.env, entryId);
  if (file && (!file.user_id || file.user_id === user.sub)) {
    // Remove from old parent
    if (file.parent_id) {
      await removeChild(c.env, file.parent_id, entryId);
    }
    file.parent_id = actualTarget;
    file.updated_at = Date.now();
    await setFileMeta(c.env, entryId, file);
    await addChild(c.env, actualTarget, entryId);
    return c.json({ success: true, message: "移动成功" });
  }

  // Try folder
  const folder = await getFolderMeta(c.env, entryId);
  if (folder && (!folder.user_id || folder.user_id === user.sub)) {
    if (folder.parent_id) {
      await removeChild(c.env, folder.parent_id, entryId);
    }
    folder.parent_id = actualTarget;
    folder.updated_at = Date.now();
    await setFolderMeta(c.env, entryId, folder);
    await addChild(c.env, actualTarget, entryId);
    return c.json({ success: true, message: "移动成功" });
  }

  return c.json({ success: false, error: "文件不存在" }, 404);
});

/**
 * GET /api/files/trash — D1 indexed
 */
filesRouter.get("/trash", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    `SELECT kv_id as id, name, type, size, mime_type, is_chunks, deleted_at, created_at, updated_at
     FROM files WHERE user_id = ? AND deleted = 1 ORDER BY deleted_at DESC`
  ).bind(user.sub).all();

  return c.json({ success: true, data: rows.results });
});

/**
 * POST /api/files/trash/:id/restore — restore from KV metadata, D1 marks deleted=0
 */
filesRouter.post("/trash/:id/restore", async (c) => {
  const user = c.get("user");
  const entryId = c.req.param("id");

  // Verify deleted in D1
  const row = await c.env.DB.prepare(
    "SELECT kv_id, type, parent_kv_id FROM files WHERE kv_id = ? AND user_id = ? AND deleted = 1"
  ).bind(entryId, user.sub).first<{ kv_id: string; type: string; parent_kv_id: string | null }>();
  if (!row) return c.json({ success: false, error: "文件不存在或未被删除" }, 404);

  // Restore parent-child link in KV
  if (row.parent_kv_id) {
    await addChild(c.env, row.parent_kv_id, entryId);
  } else {
    const rootId = await getUserRootFolder(c.env, user.sub);
    if (rootId) await addChild(c.env, rootId, entryId);
  }

  // Update KV folder metadata if it's a folder
  if (row.type === "folder") {
    const folder = await getFolderMeta(c.env, entryId);
    if (folder) {
      folder.updated_at = Date.now();
      await setFolderMeta(c.env, entryId, folder);
    }
  }

  // Mark as not deleted in D1
  await c.env.DB.prepare(
    "UPDATE files SET deleted = 0, deleted_at = NULL WHERE kv_id = ?"
  ).bind(entryId).run();

  return c.json({ success: true, message: "已恢复" });
});

/**
 * DELETE /api/files/trash/:id (permanent — delete KV + D1)
 */
filesRouter.delete("/trash/:id", async (c) => {
  const user = c.get("user");
  const entryId = c.req.param("id");

  const row = await c.env.DB.prepare(
    "SELECT kv_id FROM files WHERE kv_id = ? AND user_id = ? AND deleted = 1"
  ).bind(entryId, user.sub).first<{ kv_id: string }>();
  if (!row) return c.json({ success: false, error: "文件不存在或未被删除" }, 404);

  await deleteFileMeta(c.env, entryId);
  return c.json({ success: true, message: "已彻底删除" });
});

/**
 * DELETE /api/files/trash (empty trash — batch delete KV + D1)
 */
filesRouter.delete("/trash", async (c) => {
  const user = c.get("user");

  const rows = await c.env.DB.prepare(
    "SELECT kv_id FROM files WHERE user_id = ? AND deleted = 1"
  ).bind(user.sub).all();

  // Delete KV metadata
  for (const r of rows.results) {
    const row = r as { kv_id: string };
    await deleteFileMeta(c.env, row.kv_id).catch(() => {});
    await deleteFolderMeta(c.env, row.kv_id).catch(() => {});
  }

  // Delete D1 rows
  await c.env.DB.prepare(
    "DELETE FROM files WHERE user_id = ? AND deleted = 1"
  ).bind(user.sub).run();

  return c.json({ success: true, message: "回收站已清空" });
});

/**
 * DELETE /api/files/:id (soft delete — D1 marks deleted=1, KV metadata preserved for recovery)
 */
filesRouter.delete("/:id", async (c) => {
  const user = c.get("user");
  const entryId = c.req.param("id");

  // Try file
  const file = await getFileMeta(c.env, entryId);
  if (file && (!file.user_id || file.user_id === user.sub)) {
    if (file.parent_id) await removeChild(c.env, file.parent_id, entryId);
    await c.env.DB.prepare(
      "UPDATE files SET deleted = 1, deleted_at = ? WHERE kv_id = ?"
    ).bind(Date.now(), entryId).run().catch(() => {});
    if (file.telegram_message_id) {
      c.executionCtx.waitUntil((async () => {
        try {
          const { editMessageCaption } = await import("../bot/telegram");
          const chatId = c.env.TELEGRAM_CHANNEL_ID || c.env.STORAGE_CHAT_ID || "";
          const fmt = (ts: number) => new Date(ts).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\//g, "-");
          await editMessageCaption(c.env, chatId, file.telegram_message_id!, `[${user.username}]-上传时间:[${fmt(file.created_at)}]-删除时间:[${fmt(Date.now())}]`);
        } catch {}
      })());
    }
    return c.json({ success: true, message: "已移入回收站" });
  }

  // Try folder (recursive soft delete)
  const folder = await getFolderMeta(c.env, entryId);
  if (folder && (!folder.user_id || folder.user_id === user.sub)) {
    if (folder.parent_id) await removeChild(c.env, folder.parent_id, entryId);
    await softDeleteFolderD1(c.env, user.sub, entryId);
    return c.json({ success: true, message: "已移入回收站" });
  }

  // Fallback: KV metadata missing but D1 record exists (e.g. after KV cleanup)
  const d1row = await c.env.DB.prepare(
    "SELECT kv_id, type FROM files WHERE kv_id = ? AND user_id = ? AND deleted = 0"
  ).bind(entryId, user.sub).first<{ kv_id: string; type: string }>();
  if (d1row) {
    if (d1row.type === "folder") {
      await softDeleteFolderD1(c.env, user.sub, entryId);
    } else {
      await c.env.DB.prepare(
        "UPDATE files SET deleted = 1, deleted_at = ? WHERE kv_id = ?"
      ).bind(Date.now(), entryId).run();
    }
    return c.json({ success: true, message: "已移入回收站" });
  }

  return c.json({ success: false, error: "文件不存在" }, 404);
});

/**
 * GET /api/files/search?q=
 * Uses D1 LIKE query — much faster than KV tree traversal.
 */
filesRouter.get("/search", async (c) => {
  const user = c.get("user");
  const q = c.req.query("q");

  if (!q || q.trim().length === 0) {
    return c.json({ success: false, error: "搜索关键词不能为空" }, 400);
  }

  const keyword = `%${q.trim()}%`;
  const rows = await c.env.DB.prepare(
    `SELECT kv_id as id, name, type, size, mime_type, is_chunks, created_at, updated_at
     FROM files
     WHERE user_id = ? AND name LIKE ? AND deleted = 0
     ORDER BY type DESC, name ASC
     LIMIT 200`
  ).bind(user.sub, keyword).all();

  const results = rows.results.map((r: any) => ({
    id: r.id, name: r.name, type: r.type,
    size: r.size || 0, size_formatted: humanReadableSize(r.size || 0),
    mime_type: r.mime_type || undefined,
    is_chunks: !!r.is_chunks,
    created_at: parseInt(r.created_at) || 0,
    updated_at: r.updated_at ? parseInt(r.updated_at) || undefined : undefined,
  }));

  return c.json({ success: true, data: results });
});

// ============ Helper Functions ============

async function softDeleteFolderD1(
  env: Env,
  userId: number,
  folderId: string
): Promise<void> {
  // Get child IDs from D1
  const children = await env.DB.prepare(
    "SELECT kv_id, type FROM files WHERE user_id = ? AND parent_kv_id = ? AND deleted = 0"
  ).bind(userId, folderId).all();

  for (const r of children.results) {
    const row = r as { kv_id: string; type: string };
    if (row.type === "file") {
      await env.DB.prepare(
        "UPDATE files SET deleted = 1, deleted_at = ? WHERE kv_id = ?"
      ).bind(Date.now(), row.kv_id).run().catch(() => {});
    } else {
      await softDeleteFolderD1(env, userId, row.kv_id);
    }
  }

  await env.DB.prepare(
    "UPDATE files SET deleted = 1, deleted_at = ? WHERE kv_id = ?"
  ).bind(Date.now(), folderId).run().catch(() => {});
}


