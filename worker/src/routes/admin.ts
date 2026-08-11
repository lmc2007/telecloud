import { Hono } from "hono";
import type { Env } from "../types";
import { signToken, verifyToken } from "../utils/jwt";

type AppEnv = { Bindings: Env; Variables: { isAdmin: boolean } };

export const adminRouter = new Hono<AppEnv>();

/**
 * POST /api/admin/login
 */
adminRouter.post("/login", async (c) => {
  const { password } = await c.req.json<{ password: string }>();

  if (password !== c.env.ADMIN_PASSWORD) {
    return c.json({ success: false, error: "管理密码错误" }, 401);
  }

  const token = await signToken(
    { sub: 0, username: "admin", type: "access" },
    c.env.JWT_SECRET,
    24 * 3600
  );

  return c.json({ success: true, data: { token } });
});

// ============ Admin-only middleware ============
adminRouter.use("*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const payload = await verifyToken(authHeader.slice(7), c.env.JWT_SECRET);
  if (!payload || payload.username !== "admin") {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  if (payload.type !== "access") {
    return c.json({ success: false, error: "Unauthorized: invalid token type" }, 401);
  }

  // Check token revocation (KV blacklist)
  const revoked = await c.env.METADATA_KV.get(
    `revoked:${payload.sub}:${payload.iat}`
  );
  if (revoked) {
    return c.json({ success: false, error: "Unauthorized: token revoked" }, 401);
  }

  c.set("isAdmin", true);
  await next();
});

/**
 * GET /api/admin/stats — D1 indexed (KV is System of Record)
 */
adminRouter.get("/stats", async (c) => {
  const [users, fileStats, shares, trash] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as count FROM users").first<{ count: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(CASE WHEN type='file' THEN 1 END) as files, COUNT(CASE WHEN type='folder' THEN 1 END) as folders, COALESCE(SUM(CASE WHEN type='file' THEN size ELSE 0 END), 0) as storage FROM files WHERE deleted = 0"
    ).first<{ files: number; folders: number; storage: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM shares").first<{ count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM files WHERE deleted = 1").first<{ count: number }>(),
  ]);

  return c.json({
    success: true,
    data: {
      users: users?.count || 0,
      files: fileStats?.files || 0,
      folders: fileStats?.folders || 0,
      shares: shares?.count || 0,
      trash: trash?.count || 0,
      storage_bytes: fileStats?.storage || 0,
    },
  });
});

/**
 * GET /api/admin/users
 */
adminRouter.get("/users", async (c) => {
  const page = Number(c.req.query("page") || "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  const users = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.email, COALESCE(SUM(CASE WHEN f.type='file' AND f.deleted=0 THEN f.size ELSE 0 END), 0) as storage_used, u.created_at
     FROM users u LEFT JOIN files f ON f.user_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(limit, offset)
    .all();

  const total = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM users"
  ).first<{ count: number }>();

  return c.json({
    success: true,
    data: {
      users: users.results,
      total: total?.count || 0,
      page,
      limit,
    },
  });
});

/**
 * GET /api/admin/users/:id/files — D1 indexed
 */
adminRouter.get("/users/:id/files", async (c) => {
  const userId = parseInt(c.req.param("id"));
  if (isNaN(userId)) return c.json({ success: false, error: "无效的用户ID" }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT kv_id as id, name, size, mime_type, is_chunks, created_at, updated_at
     FROM files WHERE user_id = ? AND type = 'file' AND deleted = 0
     ORDER BY created_at DESC`
  ).bind(userId).all();

  // Normalise: D1 stores created_at/updated_at as TEXT (epoch ms number string).
  // Frontend expects number for fmtDate(). Parse to integer.
  const data = rows.results.map((r: any) => ({
    ...r,
    created_at: parseInt(r.created_at) || r.created_at,
    updated_at: parseInt(r.updated_at) || r.updated_at,
  }));

  return c.json({ success: true, data });
});

/**
 * DELETE /api/admin/users/:id
 */
adminRouter.delete("/users/:id", async (c) => {
  const userId = c.req.param("id");

  const user = await c.env.DB.prepare(
    "SELECT id, username FROM users WHERE id = ?"
  )
    .bind(userId)
    .first();

  if (!user) {
    return c.json({ success: false, error: "用户不存在" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM shares WHERE user_id = ?")
    .bind(userId)
    .run();
  await c.env.DB.prepare("DELETE FROM files WHERE user_id = ?")
    .bind(userId)
    .run();
  await c.env.DB.prepare("DELETE FROM upload_sessions WHERE user_id = ?")
    .bind(userId)
    .run();
  await c.env.DB.prepare("DELETE FROM users WHERE id = ?")
    .bind(userId)
    .run();

  return c.json({
    success: true,
    message: `用户已删除`,
  });
});

/**
 * GET /api/admin/files — D1 indexed
 */
adminRouter.get("/files", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT kv_id as id, name, size, mime_type, is_chunks, created_at, user_id
     FROM files WHERE type = 'file' AND deleted = 0
     ORDER BY created_at DESC`
  ).all();

  const data = rows.results.map((r: any) => ({
    ...r,
    created_at: parseInt(r.created_at) || r.created_at,
  }));

  return c.json({ success: true, data: { files: data, total: data.length } });
});

/**
 * GET /api/admin/migrate — backfill D1 from KV (run once after migration)
 */
adminRouter.get("/migrate", async (c) => {
  let fileCount = 0, folderCount = 0;

  try {
    // Backfill files
    let cursor: string | undefined;
    do {
      const opts: { prefix: string; cursor?: string } = { prefix: "file:" };
      if (cursor) opts.cursor = cursor;
      const list = await c.env.METADATA_KV.list(opts);
      for (const key of list.keys) {
        try {
          const raw = await c.env.METADATA_KV.get(key.name, "json");
          const meta = raw as Record<string, any> | null;
          if (!meta) continue;
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO files(kv_id, user_id, parent_kv_id, name, type, size, mime_type, is_chunks, created_at, updated_at)
             VALUES(?, ?, ?, ?, 'file', ?, ?, ?, ?, ?)`
          ).bind(meta.id, meta.user_id||0, meta.parent_id, meta.name, meta.size, meta.mime_type||"", meta.is_chunks?1:0, meta.created_at, meta.updated_at).run();
          fileCount++;
        } catch (e) { console.error("migrate file error:", (e as Error).message); }
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    // Backfill folders
    cursor = undefined;
    do {
      const opts: { prefix: string; cursor?: string } = { prefix: "folder:" };
      if (cursor) opts.cursor = cursor;
      const list = await c.env.METADATA_KV.list(opts);
      for (const key of list.keys) {
        try {
          const raw = await c.env.METADATA_KV.get(key.name, "json");
          const meta = raw as Record<string, any> | null;
          if (!meta) continue;
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO files(kv_id, user_id, parent_kv_id, name, type, size, created_at, updated_at)
             VALUES(?, ?, ?, ?, 'folder', 0, ?, ?)`
          ).bind(meta.id, meta.user_id||0, meta.parent_id, meta.name, meta.created_at, meta.updated_at).run();
          folderCount++;
        } catch (e) { console.error("migrate folder error:", (e as Error).message); }
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);

    return c.json({ success: true, data: { files: fileCount, folders: folderCount } });
  } catch (e) {
    return c.json({ success: false, error: (e as Error).message || "迁移失败" }, 500);
  }
});

/**
 * GET /api/admin/files/:id/download — admin download any file
 */
adminRouter.get("/files/:id/download", async (c) => {
  const fileId = c.req.param("id");
  const { downloadFile } = await import("../handlers/download");
  return downloadFile(c.env, fileId, null);
});

/**
 * GET /api/admin/files/:id/chunks — admin get chunk metadata
 */
adminRouter.get("/files/:id/chunks", async (c) => {
  const fileId = c.req.param("id");
  const { getFileMeta } = await import("../storage/kv");
  const meta = await getFileMeta(c.env, fileId);
  if (!meta) return c.json({ success: false, error: "文件不存在" }, 404);
  if (!meta.chunks) return c.json({ success: false, error: "不是分块文件" }, 400);
  return c.json({
    success: true,
    data: {
      name: meta.name,
      size: meta.size,
      chunks: meta.chunks.map(ch => ({ index: ch.index, size: ch.size })),
    },
  });
});

/**
 * GET /api/admin/files/:id/chunk/:index — admin download single chunk
 */
adminRouter.get("/files/:id/chunk/:index", async (c) => {
  const fileId = c.req.param("id");
  const chunkIdx = parseInt(c.req.param("index"));
  if (isNaN(chunkIdx)) return c.json({ success: false, error: "Invalid chunk index" }, 400);

  const { getFileMeta, setFileMeta } = await import("../storage/kv");
  const meta = await getFileMeta(c.env, fileId);
  if (!meta?.chunks || chunkIdx >= meta.chunks.length) return c.json({ success: false, error: "Chunk not found" }, 404);

  const chunk = meta.chunks[chunkIdx];
  const { getFile, getFileStream, getFileBytes } = await import("../bot/telegram");

  // Chunk recovery helper
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

  let effectiveFileId = chunk.telegram_file_id;
  if (!effectiveFileId) {
    const recovered = await recoverFromRecord();
    if (recovered) effectiveFileId = recovered;
  }
  if (!effectiveFileId) return c.json({ success: false, error: `Chunk ${chunkIdx} has empty file_id` }, 500);

  let filePath = chunk.file_path || null;
  if (!filePath) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const f = await getFile(c.env, effectiveFileId);
        if (f.file_path) { filePath = f.file_path; break; }
        break;
      } catch (e) {
        const msg = (e as Error).message || "";
        if (msg.includes("file_id") || msg.includes("file is too big")) break;
        if (attempt < 4) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }

  if (!filePath && effectiveFileId) {
    const recovered = await recoverFromRecord();
    if (recovered && recovered !== effectiveFileId) {
      effectiveFileId = recovered;
      try { const f = await getFile(c.env, effectiveFileId); if (f.file_path) filePath = f.file_path; } catch {}
    }
  }

  if (!filePath) return c.json({ success: false, error: `Chunk ${chunkIdx} unavailable` }, 500);

  let resp: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await getFileStream(c.env, filePath);
    if (r.ok && r.body) { resp = r; break; }
    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
  }
  if (!resp || !resp.body) return c.json({ success: false, error: `Chunk ${chunkIdx} CDN failed` }, 500);

  return new Response(resp.body, {
    headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=31536000" },
  });
});

/**
 * DELETE /api/admin/files/:id
 * Deletes file metadata from KV and cleans up DB shares referencing it
 */
adminRouter.delete("/files/:id", async (c) => {
  const fileId = c.req.param("id");

  // Clean up shares that reference this file_id (TEXT column, matches KV UUID)
  await c.env.DB.prepare("DELETE FROM shares WHERE file_id = ?")
    .bind(fileId)
    .run();

  // Delete KV file metadata
  const { deleteFileMeta } = await import("../storage/kv");
  await deleteFileMeta(c.env, fileId);

  return c.json({ success: true, message: "文件已删除" });
});

/**
 * GET /api/admin/shares
 */
adminRouter.get("/shares", async (c) => {
  const shares = await c.env.DB.prepare(
    `SELECT s.id, s.token, s.file_id, s.password, s.expire_at, s.download_count, s.max_downloads, s.created_at,
            u.username
     FROM shares s
     JOIN users u ON s.user_id = u.id
     ORDER BY s.created_at DESC LIMIT 50`
  ).all();

  // Resolve file names from KV (shares.file_id is KV UUID, not D1 INTEGER id)
  const { getFileMeta } = await import("../storage/kv");
  const results = await Promise.all(
    shares.results.map(async (s: any) => {
      try {
        const meta = await getFileMeta(c.env, s.file_id);
        return { ...s, file_name: meta?.name || "(已删除)" };
      } catch {
        return { ...s, file_name: "(已删除)" };
      }
    })
  );

  return c.json({ success: true, data: results });
});

/**
 * DELETE /api/admin/shares/:id
 */
adminRouter.delete("/shares/:id", async (c) => {
  const shareId = c.req.param("id");

  const share = await c.env.DB.prepare(
    "SELECT id, token FROM shares WHERE id = ?"
  )
    .bind(shareId)
    .first<{ id: number; token: string }>();

  if (!share) {
    return c.json({ success: false, error: "分享不存在" }, 404);
  }

  await c.env.DB.prepare("DELETE FROM shares WHERE id = ?")
    .bind(shareId)
    .run();
  await c.env.METADATA_KV.delete(`share:${share.token}`);

  return c.json({ success: true, message: "分享已删除" });
});
