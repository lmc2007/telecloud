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
 * POST /api/shares — create share link (single or multi-file)
 * Accepts file_id (legacy) or file_ids (multi-file batch share).
 */
sharesRouter.post("/", authGuard, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    file_id?: string;
    file_ids?: string[];
    password?: string;
    expire_hours?: number;
    max_downloads?: number;
  }>();

  // Normalize: support both legacy file_id and new file_ids
  // Note: must use Array.isArray + length check — empty array [] is truthy in JS!
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
  const { getFileMeta } = await import("../storage/kv");
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
  if (shareInfo.target_id) return [shareInfo.target_id];
  return [];
}

/**
 * GET /api/s/:token — access share (public, password-gated)
 * Returns file list (single-file shares also return an array for consistency).
 */
sharesRouter.get("/:token", async (c) => {
  const token = c.req.param("token");

  const shareInfo = await c.env.METADATA_KV.get(`share:${token}`, "json") as {
    token: string;
    target_id?: string;
    target_ids?: string[];
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

  // Get all file infos from KV
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
      is_multi: targetIds.length > 1,
    },
  });
});

/** Helper: get a specific target file id by index, with validation */
function getTargetFileId(shareInfo: any, fileIndex: number): string | null {
  const ids = resolveTargetIds(shareInfo);
  if (fileIndex < 0 || fileIndex >= ids.length) return null;
  return ids[fileIndex];
}

/**
 * GET /api/s/:token/chunks — get chunk metadata (public)
 * Query: ?file_index=N (required for multi-file shares, defaults to 0 for legacy)
 */
sharesRouter.get("/:token/chunks", async (c) => {
  const token = c.req.param("token");
  const fileIndex = parseInt(c.req.query("file_index") || "0") || 0;

  const shareInfo = await c.env.METADATA_KV.get(`share:${token}`, "json") as {
    token: string; target_id?: string; target_ids?: string[]; password?: string;
    expires_at?: number; max_downloads?: number; download_count: number;
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

  const targetId = getTargetFileId(shareInfo, fileIndex);
  if (!targetId) return c.json({ success: false, error: "文件不存在" }, 404);

  // Atomic increment via D1 — /chunks is the entry point for chunked downloads.
  // Counting here (once) means max_downloads = complete file downloads, not per-chunk.
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

  const { getFileMeta } = await import("../storage/kv");
  const file = await getFileMeta(c.env, targetId);
  if (!file?.chunks) return c.json({ success: false, error: "不是分块文件" }, 400);

  return c.json({
    success: true,
    data: {
      name: file.name,
      size: file.size,
      mime_type: file.mime_type,
      chunks: file.chunks.map(ch => ({ index: ch.index, size: ch.size })),
    },
  });
});

/**
 * GET /api/s/:token/chunk/:index — download single chunk (public)
 * Query: ?file_index=N (required for multi-file shares, defaults to 0 for legacy)
 */
sharesRouter.get("/:token/chunk/:index", async (c) => {
  const token = c.req.param("token");
  const chunkIdx = parseInt(c.req.param("index"));
  const fileIndex = parseInt(c.req.query("file_index") || "0") || 0;
  if (isNaN(chunkIdx) || chunkIdx < 0) return c.json({ success: false, error: "Invalid chunk index" }, 400);

  const shareInfo = await c.env.METADATA_KV.get(`share:${token}`, "json") as {
    token: string; target_id?: string; target_ids?: string[]; password?: string;
    expires_at?: number; max_downloads?: number; download_count: number;
  } | null;
  if (!shareInfo) return c.json({ success: false, error: "分享不存在" }, 404);
  if (shareInfo.expires_at && shareInfo.expires_at < Date.now()) return c.json({ success: false, error: "分享已过期" }, 410);
  // Password check (hashed comparison) — chunk endpoint does NOT increment download_count.
  // The count is incremented once in GET /:token/chunks (chunked entry point)
  // or POST /:token/download (direct download).
  if (shareInfo.password) {
    const pw = c.req.query("pw") || c.req.header("X-Share-Password") || "";
    const pwHash = await hashPassword(pw);
    if (pwHash !== shareInfo.password) return c.json({ success: false, error: "需要提取码", need_password: true }, 403);
  }

  const targetId = getTargetFileId(shareInfo, fileIndex);
  if (!targetId) return c.json({ success: false, error: "文件不存在" }, 404);

  const { getFileMeta, setFileMeta } = await import("../storage/kv");
  const meta = await getFileMeta(c.env, targetId);
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
 * Body: { password?, verify_only?, file_index? }
 */
sharesRouter.post("/:token/download", async (c) => {
  const token = c.req.param("token");
  const body = await c.req
    .json<{ password?: string; verify_only?: boolean; file_index?: number }>()
    .catch(() => ({ password: undefined, verify_only: false, file_index: 0 }));
  const { password, verify_only } = body;
  const fileIndex = body.file_index ?? 0;

  const shareInfo = await c.env.METADATA_KV.get(
    `share:${token}`,
    "json"
  ) as {
    token: string;
    target_id?: string;
    target_ids?: string[];
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

  const targetId = getTargetFileId(shareInfo, fileIndex);
  if (!targetId) {
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
  return downloadFile(c.env, targetId, null);
});

/**
 * GET /api/s/:token/stream — preview/stream shared file (public, no download count)
 * Used by <img>/<video> native tags for inline preview.
 * Query: ?file_index=N (defaults to 0 for legacy single-file shares)
 */
sharesRouter.get("/:token/stream", async (c) => {
  const token = c.req.param("token");
  const fileIndex = parseInt(c.req.query("file_index") || "0") || 0;

  const shareInfo = await c.env.METADATA_KV.get(
    `share:${token}`,
    "json"
  ) as {
    token: string;
    target_id?: string;
    target_ids?: string[];
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

  const targetId = getTargetFileId(shareInfo, fileIndex);
  if (!targetId) {
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
  return downloadFile(c.env, targetId, range);
});
