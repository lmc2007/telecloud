import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env, ChunkInfo, JwtPayload } from "./types";
import { authRouter } from "./routes/auth";
import { filesRouter } from "./routes/files";
import { userRouter } from "./routes/user";
import { sharesRouter } from "./routes/shares";
import { adminRouter } from "./routes/admin";
import { previewRouter } from "./routes/preview";
import { verifyToken, verifyPreviewToken } from "./utils/jwt";
import { generateUUID, getMimeType } from "./utils/common";

const app = new Hono<{ Bindings: Env }>();

// ============ Global middleware ============
app.use("*", logger());
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Filename", "X-Chunk-Index", "X-Total-Chunks", "X-Parent-Id"],
  maxAge: 86400,
}));

// CORS helper for custom handlers (outside Hono)
function withCors(response: Response, origin?: string): Response {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin || "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Filename, X-Chunk-Index, X-Total-Chunks, X-Parent-Id");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ============ Health check ============
app.get("/", (c) => {
  return c.json({
    success: true,
    data: { name: "Cloud Nine API", version: "2.0.0", status: "ok" },
  });
});

app.get("/health", (c) =>
  c.json({ success: true, data: { status: "healthy" } })
);

// ============ Mount Hono routers ============
app.route("/api/auth", authRouter);
app.route("/api/files", previewRouter); // preview must be before filesRouter so /:id/preview is not eaten by filesRouter
app.route("/api/files", filesRouter);
app.route("/api/user", userRouter);
app.route("/api/shares", sharesRouter);
app.route("/api/s", sharesRouter); // public share access
app.route("/api/admin", adminRouter);

// ============ 404 ============
app.notFound((c) => {
  return c.json({ success: false, error: "Not Found" }, 404);
});

// ============ Global error handler ============
app.onError((err, c) => {
  console.error(`[Error] ${err.message}`, err.stack);
  return c.json(
    {
      success: false,
      error:
        c.env.ENVIRONMENT === "production"
          ? "Internal Server Error"
          : err.message,
    },
    500
  );
});

// ============ Main fetch handler ============
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ========== WebSocket routes (before Hono) ==========

    // WebSocket upload
    if (
      (path === "/ws/upload" || path === "/api/ws/upload") &&
      request.headers.get("Upgrade") === "websocket"
    ) {
      const token = url.searchParams.get("token");
      if (!token) return new Response("Unauthorized", { status: 401 });
      const jwtPayload = await verifyToken(token, env.JWT_SECRET);
      if (!jwtPayload || jwtPayload.type !== "access") return new Response("Unauthorized", { status: 401 });
      return handleWsUpload(request, env, jwtPayload.sub);
    }

    // WebSocket download
    if (
      (path === "/ws/download" || path === "/api/ws/download") &&
      request.headers.get("Upgrade") === "websocket"
    ) {
      const token = url.searchParams.get("token");
      if (!token || !(await verifyToken(token, env.JWT_SECRET))) {
        return new Response("Unauthorized", { status: 401 });
      }
      return handleWsDownload(request, env);
    }

    // ========== Telegram Webhook (no auth) ==========
    if (path === "/webhook/telegram" && method === "POST") {
      const { handleTelegramWebhook } = await import("./bot/webhook");
      return handleTelegramWebhook(request, env);
    }

    // ========== Upload/Download custom routes ==========
    // These are handled before Hono to override the generic files router

    // Upload chunk (sessionless)
    if (path === "/api/files/upload/chunk" && method === "POST") {
      return withCors(await handleUploadChunk(request, env, ctx));
    }

    // Complete chunked upload
    if (path === "/api/files/upload/complete" && method === "POST") {
      return withCors(await handleUploadComplete(request, env, ctx));
    }

    // Single file upload
    if (path === "/api/files/upload" && method === "POST") {
      return withCors(await handleSingleUpload(request, env, ctx));
    }

    // Get chunk list for a file
    if (path.match(/^\/api\/files\/[^\/]+\/chunks$/) && method === "GET") {
      return withCors(await handleGetChunks(request, env, path));
    }

    // Download single chunk
    if (path.match(/^\/api\/files\/[^\/]+\/chunk\/\d+$/) && method === "GET") {
      return withCors(await handleDownloadChunk(request, env, path));
    }

    // Download file
    if (
      path.match(/^\/api\/files\/[^\/]+\/download$/) &&
      method === "GET"
    ) {
      return withCors(await handleFileDownload(request, env, path));
    }

    // Preview stream (short-lived token auth — for <img>/<video> native tags)
    if (
      path.match(/^\/api\/files\/[^\/]+\/stream$/) &&
      method === "GET"
    ) {
      return withCors(await handleFileStream(request, env, path));
    }

    // Download via share token — now handled by Hono /api/s/* routes
    // (legacy /api/share/* and /s/* removed — migrated to sharesRouter)

    // Admin init
    if (path === "/api/admin/init" && method === "POST") {
      return withCors(await handleInit(request, env));
    }

    // ========== Delegate to Hono for all other routes ==========
    return app.fetch(request, env, ctx);
  },
};

// ==============================
// Auth helper
// ==============================

async function authenticateRequest(
  request: Request,
  env: Env
): Promise<JwtPayload | null> {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return verifyToken(authHeader.slice(7), env.JWT_SECRET);
  }
  // Also check query token for WebSocket
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token) {
    const payload = await verifyToken(token, env.JWT_SECRET);
    if (payload && payload.type === "access") return payload;
  }
  return null;
}

// ==============================
// Upload handlers (retained from original)
// ==============================

async function handleSingleUpload(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { success: false, error: "Use multipart/form-data" },
      { status: 400 }
    );
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const parentId = formData.get("parent_id") as string | null;

  if (!file) {
    return Response.json(
      { success: false, error: "No file provided" },
      { status: 400 }
    );
  }

  const chatId =
    env.TELEGRAM_CHANNEL_ID || env.STORAGE_CHAT_ID || "";
  const { uploadFile } = await import("./handlers/upload");
  const messageThreadId = parentId
    ? (await resolveTopicId(env, parentId)) ?? await getUserThreadId(env, user.sub)
    : await getUserThreadId(env, user.sub);

  // Build caption: [用户名]-上传时间:[时间]
  const uploadTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\//g, "-");
  let caption = "";
  try {
    const u = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(user.sub).first<{ username: string }>();
    caption = `[${u?.username || user.username}]-上传时间:[${uploadTime}]`;
  } catch {}

  const meta = await uploadFile(
    env, chatId, file, file.name, parentId || null, messageThreadId, user.sub, caption
  );

  return Response.json({
    success: true,
    data: {
      file_id: meta.id,
      name: meta.name,
      size: meta.size,
      mime_type: meta.mime_type,
      is_chunks: meta.is_chunks,
      download_url: `/api/files/${meta.id}/download`,
    },
  });
}

async function handleUploadChunk(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const filename =
    request.headers.get("X-Filename") || "chunk";
  const chunkIndex = parseInt(
    request.headers.get("X-Chunk-Index") || "0"
  );
  const parentId = request.headers.get("X-Parent-Id");

  const chunkBlob = await request.blob();
  const { sendDocument } = await import("./bot/telegram");
  const chatId =
    env.TELEGRAM_CHANNEL_ID || env.STORAGE_CHAT_ID || "";
  const messageThreadId = parentId
    ? (await resolveTopicId(env, parentId)) ?? await getUserThreadId(env, user.sub)
    : await getUserThreadId(env, user.sub);

  const result = await sendDocument(
    env,
    chatId,
    chunkBlob,
    `${filename}_part${chunkIndex}`,
    messageThreadId
  );

  return Response.json({
    success: true,
    data: {
      index: chunkIndex,
      file_id: result.file_id,
      message_id: result.message_id,
    },
  });
}

async function handleUploadComplete(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const body = (await request.json()) as {
    filename: string;
    total_size: number;
    parent_id?: string | null;
    file_ids: { index: number; file_id: string }[];
  };

  if (!body.file_ids || body.file_ids.length === 0) {
    return Response.json(
      { success: false, error: "No chunk file_ids" },
      { status: 400 }
    );
  }

  // Filter and validate: reject empty file_ids from client
  body.file_ids = body.file_ids.filter((c) => c.file_id && c.file_id.trim());
  if (body.file_ids.length === 0) {
    return Response.json(
      { success: false, error: "All file_ids are empty (upload corruption)" },
      { status: 400 }
    );
  }
  console.log(`[upload/complete] received ${body.file_ids.length} file_ids, first fid=${body.file_ids[0].file_id.substring(0,8)}...`);

  body.file_ids.sort((a, b) => a.index - b.index);
  const { sendDocument } = await import("./bot/telegram");
  const chatId =
    env.TELEGRAM_CHANNEL_ID || env.STORAGE_CHAT_ID || "";

  const record: Record<string, unknown> = {
    fileName: body.filename,
    fileSize: body.total_size,
    fileIds: body.file_ids.map((c) => c.file_id),
    recordFile: true,
  };

  const recordBytes = new TextEncoder().encode(JSON.stringify(record));
  const messageThreadId = body.parent_id
    ? (await resolveTopicId(env, body.parent_id)) ?? await getUserThreadId(env, user.sub)
    : await getUserThreadId(env, user.sub);

  // Build caption for record file
  const uploadTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/\//g, "-");
  let caption = "";
  try {
    const u = await env.DB.prepare("SELECT username FROM users WHERE id = ?").bind(user.sub).first<{ username: string }>();
    caption = `[${u?.username || user.username}]-上传时间:[${uploadTime}]`;
  } catch {}

  const recordResult = await sendDocument(
    env, chatId, new Blob([recordBytes]),
    `${generateUUID()}.record.json`, messageThreadId, caption
  );

  // Resolve actual chunk sizes from Telegram before storing metadata.
  // Batch getFile calls (max 10 concurrent) to stay within the 50 sub-request limit.
  const { getFile } = await import("./bot/telegram");
  const chunkInfos: ChunkInfo[] = [];
  const BATCH = 10;
  for (let i = 0; i < body.file_ids.length; i += BATCH) {
    const batch = body.file_ids.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (c): Promise<ChunkInfo> => {
        try {
          const f = await getFile(env, c.file_id);
          return {
            index: c.index,
            size: f.file_size || 0,
            telegram_file_id: c.file_id,
            telegram_message_id: 0,
            file_path: f.file_path || undefined,
          };
        } catch {
          return {
            index: c.index,
            size: 0,
            telegram_file_id: c.file_id,
            telegram_message_id: 0,
          };
        }
      })
    );
    chunkInfos.push(...results);
  }

  const fileId = generateUUID();
  const parentId = body.parent_id || null;

  const { getRootConfig } = await import("./storage/kv");
  const rootFolderId =
    parentId ||
    (await env.METADATA_KV.get(`user_root:${user.sub}`)) ||
    (await getRootConfig(env))?.root_folder_id ||
    null;

  const { setFileMeta, getFileMeta, addChild } = await import("./storage/kv");
  const now = Date.now();
  // Compute hash of record for integrity verification
  const recordHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", recordBytes)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  await setFileMeta(env, fileId, {
    id: fileId,
    name: body.filename,
    size: body.total_size,
    mime_type: getMimeType(body.filename),
    created_at: now,
    updated_at: now,
    parent_id: rootFolderId,
    is_chunks: true,
    chunks: chunkInfos,
    telegram_file_id: recordResult.file_id,
    telegram_message_id: recordResult.message_id,
    user_id: user.sub,
    hash: recordHash,
  });

  if (rootFolderId) {
    await addChild(env, rootFolderId, fileId);
  }

  // file_path and size are already resolved above — no need for async retry.

  return Response.json({
    success: true,
    data: { file_id: fileId, is_chunks: true },
  });
}

// ==============================
// Download handlers (retained from original)
// ==============================

async function handleGetChunks(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const fileId = path.split("/")[3];
  if (!fileId) {
    return Response.json(
      { success: false, error: "Missing file ID" },
      { status: 400 }
    );
  }

  const { getFileMeta } = await import("./storage/kv");
  const meta = await getFileMeta(env, fileId);
  if (
    !meta ||
    (meta.user_id && meta.user_id !== user.sub)
  ) {
    return Response.json(
      { success: false, error: "File not found" },
      { status: 404 }
    );
  }

  if (!meta.is_chunks || !meta.chunks) {
    return Response.json(
      { success: false, error: "Not a chunked file" },
      { status: 400 }
    );
  }

  return Response.json({
    success: true,
    data: {
      name: meta.name,
      size: meta.size,
      mime_type: meta.mime_type,
      chunks: meta.chunks.map((c) => ({
        index: c.index,
        size: c.size,
      })),
    },
  });
}

async function handleDownloadChunk(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const parts = path.split("/");
  const fileId = parts[3];
  const chunkIdx = parseInt(parts[5]);

  if (!fileId || isNaN(chunkIdx)) {
    return Response.json(
      { success: false, error: "Invalid request" },
      { status: 400 }
    );
  }

  const { getFileMeta } = await import("./storage/kv");
  const meta = await getFileMeta(env, fileId);
  if (
    !meta?.chunks ||
    (meta.user_id && meta.user_id !== user.sub)
  ) {
    return Response.json(
      { success: false, error: "Chunk not found" },
      { status: 404 }
    );
  }

  const chunk = meta.chunks[chunkIdx];
  if (!chunk) {
    return Response.json(
      {
        success: false,
        error: "Chunk index out of range",
      },
      { status: 404 }
    );
  }

  const { getFile, getFileStream, getFileBytes } = await import("./bot/telegram");
  const { setFileMeta } = await import("./storage/kv");

  // Helper: try to recover chunk file_id from the record file
  const recoverFromRecord = async (): Promise<string | null> => {
    const recordFileId = meta.telegram_file_id;
    if (!recordFileId) return null;
    try {
      console.log(`[download] chunk ${chunkIdx}: attempting recovery from record file fid=${recordFileId.substring(0,8)}...`);
      // Use a simple fetch with one retry for record file (don't want to get stuck here)
      let recordFile;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { recordFile = await getFile(env, recordFileId); break; }
        catch { if (attempt === 1) throw new Error("record getFile failed"); await new Promise(r => setTimeout(r, 1000)); }
      }
      if (!recordFile!.file_path) return null;
      const recordBytes = await getFileBytes(env, recordFile!.file_path);
      const text = new TextDecoder().decode(recordBytes);
      const parsed = JSON.parse(text) as { recordFile?: boolean; fileIds?: string[] };
      if (parsed.recordFile && Array.isArray(parsed.fileIds) && parsed.fileIds.length > chunkIdx) {
        const recovered = parsed.fileIds[chunkIdx];
        if (recovered && recovered.trim()) {
          console.log(`[download] chunk ${chunkIdx}: recovered file_id from record: ${recovered.substring(0,8)}...`);
          return recovered;
        }
        console.warn(`[download] chunk ${chunkIdx}: record fileIds[${chunkIdx}] is empty — upload was corrupted`);
      }
    } catch (e) {
      console.error(`[download] chunk ${chunkIdx}: record recovery failed: ${(e as Error).message}`);
    }
    return null;
  };

  // Helper: smart getFile with error classification
  // - "file_id is invalid" → permanent error, returns null immediately
  // - 429 / network errors → retries up to 5 times with exponential backoff
  const resolveFilePath = async (fileId: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const file = await getFile(env, fileId);
        if (file.file_path) return file.file_path;
        // getFile succeeded but file_path is empty (rare)
        console.warn(`[download] chunk ${chunkIdx}: getFile ok but file_path empty for fid=${fileId.substring(0,8)}...`);
        return null;
      } catch (e) {
        const msg = (e as Error).message || "";
        // Permanent errors: don't retry, just return null
        const isPermanent = 
          (msg.includes("file_id") && (msg.includes("invalid") || msg.includes("not found"))) ||
          msg.includes("file is too big");  // Telegram getFile 20MB limit — can never succeed
        if (isPermanent) {
          console.warn(`[download] chunk ${chunkIdx}: permanent getFile error, skipping retries: ${msg}`);
          return null;
        }
        // Rate limit (429) or network error — retry with backoff
        if (attempt < 4) {
          const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
          console.warn(`[download] chunk ${chunkIdx}: getFile attempt ${attempt+1}/5 failed: ${msg}, retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          console.error(`[download] chunk ${chunkIdx}: getFile exhausted 5 retries: ${msg}`);
          return null;
        }
      }
    }
    return null;
  };

  try {
    let effectiveFileId = chunk.telegram_file_id;
    
    // If chunk file_id is empty, try recovery from record file
    if (!effectiveFileId) {
      const recovered = await recoverFromRecord();
      if (recovered) {
        effectiveFileId = recovered;
        try {
          meta.chunks[chunkIdx].telegram_file_id = recovered;
          await setFileMeta(env, fileId, meta);
          console.log(`[download] chunk ${chunkIdx}: updated KV with recovered file_id`);
        } catch {}
      }
      if (!effectiveFileId) {
        return Response.json(
          { success: false, error: `Chunk ${chunkIdx} has empty file_id (upload corruption) and recovery failed` },
          { status: 500 }
        );
      }
    }

    // Resolve file_path with smart retry
    let filePath: string | null = chunk.file_path || null;
    if (!filePath) {
      filePath = await resolveFilePath(effectiveFileId);
      
      // If getFile failed (invalid file_id or rate limit exhausted), try recovery
      if (!filePath) {
        console.log(`[download] chunk ${chunkIdx}: primary file_id failed, attempting record recovery...`);
        const recovered = await recoverFromRecord();
        if (recovered && recovered !== effectiveFileId) {
          effectiveFileId = recovered;
          filePath = await resolveFilePath(effectiveFileId);
          if (filePath) {
            // Update KV with recovered file_id
            try {
              meta.chunks[chunkIdx].telegram_file_id = recovered;
              meta.chunks[chunkIdx].file_path = filePath;
              await setFileMeta(env, fileId, meta);
              console.log(`[download] chunk ${chunkIdx}: KV updated with recovered file_id+path`);
            } catch {}
          }
        }
      }
    }

    if (!filePath) {
      return Response.json(
        {
          success: false,
          error: `Chunk ${chunkIdx} unavailable: file may be deleted or rate-limited`,
          chunk: chunkIdx,
          file_id: effectiveFileId.substring(0, 8) + "...",
        },
        { status: 500 }
      );
    }

    // Download from CDN with retries
    let resp: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await getFileStream(env, filePath);
      if (r.ok && r.body) { resp = r; break; }
      if (!r.ok && chunk.file_path && attempt === 0) {
        // Cached file_path may be stale — re-resolve
        const freshPath = await resolveFilePath(effectiveFileId);
        if (freshPath && freshPath !== filePath) {
          filePath = freshPath;
          console.log(`[download] chunk ${chunkIdx}: refreshed stale file_path`);
        }
      }
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }

    if (!resp || !resp.body) {
      return Response.json(
        { success: false, error: `Chunk ${chunkIdx} CDN download failed after retries` },
        { status: 500 }
      );
    }

    return new Response(resp.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (e: unknown) {
    return Response.json(
      {
        success: false,
        error: `Chunk ${chunkIdx} failed: ${(e as Error).message}`,
      },
      { status: 500 }
    );
  }
}

async function handleFileDownload(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const user = await authenticateRequest(request, env);
  if (!user) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const fileId = path.split("/")[3];
  const { getFileMeta } = await import("./storage/kv");
  const meta = await getFileMeta(env, fileId);

  if (!meta || (meta.user_id && meta.user_id !== user.sub)) {
    return Response.json(
      { success: false, error: "File not found" },
      { status: 404 }
    );
  }

  const rangeHeader = request.headers.get("Range");
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

  const { downloadFile } = await import("./handlers/download");
  return downloadFile(env, fileId, range);
}

/**
 * Preview stream handler — validates a short-lived preview token (query param)
 * and streams the file. Used by <img>/<video> native tags that can't send
 * Authorization headers.
 */
async function handleFileStream(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return Response.json(
      { success: false, error: "Missing preview token" },
      { status: 401 }
    );
  }

  const payload = await verifyPreviewToken(token, env.JWT_SECRET);
  if (!payload) {
    return Response.json(
      { success: false, error: "Invalid or expired preview token" },
      { status: 401 }
    );
  }

  const fileId = path.split("/")[3];
  if (payload.file_id !== fileId) {
    return Response.json(
      { success: false, error: "Token does not match file" },
      { status: 403 }
    );
  }

  // Verify file still exists
  const { getFileMeta } = await import("./storage/kv");
  const meta = await getFileMeta(env, fileId);
  if (!meta) {
    return Response.json(
      { success: false, error: "File not found" },
      { status: 404 }
    );
  }

  // Support Range requests for video seeking.
  // Note: browsers often send "bytes=0-" (equivalent to no Range) as an initial probe.
  // Treat end=Infinity as "no effective range" to trigger video lazy-full-stream path.
  const rangeHeader = request.headers.get("Range");
  let range: { start: number; end: number } | null = null;
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const reqStart = parseInt(match[1]);
      const reqEnd = match[2] ? parseInt(match[2]) : Infinity;
      // "bytes=0-" is semantically equivalent to no Range — don't treat as a real range
      if (reqStart === 0 && reqEnd === Infinity) {
        // leave range=null so video exemption + lazy full-stream path kicks in
      } else {
        range = {
          start: reqStart,
          end: reqEnd === Infinity ? meta.size - 1 : reqEnd,
        };
      }
    }
  }

  console.log(`[stream] file=${fileId} name="${meta.name}" size=${meta.size} mime=${meta.mime_type} chunks=${meta.chunks?.length || 0} rangeHdr="${rangeHeader || "none"}" effectiveRange=${range ? `${range.start}-${range.end}` : "none"}`);

  // === Small file (non-chunked): stream directly ===
  if (!meta.is_chunks || !meta.chunks || meta.chunks.length === 0) {
    const { downloadFile } = await import("./handlers/download");
    return downloadFile(env, fileId, range);
  }

  const chunks = meta.chunks;
  const totalSize = meta.size;

  // Fix legacy zero-size chunks with an estimate for range→chunk mapping
  const avgChunkSize = Math.ceil(totalSize / chunks.length);
  for (const c of chunks) {
    if (!c.size || c.size <= 0) c.size = avgChunkSize;
  }

  // === No Range header or "bytes=0-" probe: return first chunk only (206) ===
  if (!range) {
    const firstChunkSize = chunks[0]?.size || Math.min(totalSize, 15 * 1024 * 1024);
    range = { start: 0, end: Math.min(firstChunkSize - 1, totalSize - 1) };
    console.log(`[stream] forcing first-chunk range: 0-${range.end}`);
  }

  // === Direct chunk serving for Range requests (bypasses heavy streamMergedDownload) ===
  // Each /chunk/:index request only needs 2 sub-requests (getFile + getFileStream),
  // well within the free-plan 50 sub-request and 10ms CPU limits.
  return serveChunkRange(env, meta, chunks, range, totalSize);
}

/**
 * Serve a byte range directly from Telegram chunks — no heavy stream merging.
 * Only downloads the chunk(s) that cover the requested byte range.
 */
async function serveChunkRange(
  env: Env,
  meta: { name: string; mime_type: string },
  chunks: { index: number; size: number; telegram_file_id: string; file_path?: string }[],
  range: { start: number; end: number },
  totalSize: number,
): Promise<Response> {
  const { getFile, getFileStream } = await import("./bot/telegram");

  // Find which chunks cover the range (with ±3 safety margin for estimated sizes)
  let startIdx = 0, endIdx = chunks.length - 1;
  let byteOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (byteOffset + chunks[i].size > range.start) { startIdx = i; break; }
    byteOffset += chunks[i].size;
  }
  byteOffset = 0;
  for (let i = 0; i < chunks.length; i++) {
    if (byteOffset + chunks[i].size > range.end) { endIdx = i; break; }
    byteOffset += chunks[i].size;
  }
  // For requests near the end of the file (e.g. moov atom seek), estimation error
  // is worst — just grab the last few chunks directly instead of guessing.
  // Bypass the general MAX_CHUNKS clamp: moov requests are tiny (a few KB) so
  // memory is negligible, and we need enough chunks to absorb cumulative error.
  let isEndOfFile = false;
  if (range.start > totalSize * 0.85) {
    startIdx = Math.max(0, chunks.length - 12);
    endIdx = chunks.length - 1;
    isEndOfFile = true;
  } else {
    // ±5 safety margin for estimated chunk sizes
    startIdx = Math.max(0, startIdx - 5);
    endIdx = Math.min(chunks.length - 1, endIdx + 5);
  }

  const neededChunks = chunks.slice(startIdx, endIdx + 1);

  // Limit single request to at most 8 chunks (16 sub-requests) to stay well
  // within the 50 sub-request limit and 128MB memory.
  if (!isEndOfFile && neededChunks.length > 8) {
    endIdx = startIdx + 8 - 1;
    if (endIdx < chunks.length) {
      const newRangeEnd = Math.min(
        chunks.slice(0, endIdx + 1).reduce((s, c) => s + c.size, 0) - 1,
        totalSize - 1
      );
      console.log(`[stream] direct-chunk: clamping range ${range.start}-${range.end} → ${range.start}-${newRangeEnd} (chunks ${startIdx}-${endIdx})`);
      range = { start: range.start, end: newRangeEnd };
    }
  }

  const finalNeededChunks = chunks.slice(startIdx, endIdx + 1);
  console.log(`[stream] direct-chunk: range=${range.start}-${range.end} needed=${finalNeededChunks.length} (indices ${startIdx}-${endIdx})`);

  // Resolve and download chunks. To avoid memory pressure, we extract only the
  // byte range needed by the request — raw chunk data is discarded after extraction.
  const slices: Uint8Array[] = [];
  let slicesTotal = 0;

  // Estimate where the first needed chunk starts in the file (has cumulative error)
  const estimatedStart = startIdx > 0
    ? chunks.slice(0, startIdx).reduce((s, c) => s + c.size, 0)
    : 0;

  let filePos = estimatedStart;

  for (const chunk of finalNeededChunks) {
    let fileId = chunk.telegram_file_id;
    let filePath = chunk.file_path || null;

    if (!filePath) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const file = await getFile(env, fileId);
          if (file.file_path) { filePath = file.file_path; break; }
        } catch { if (attempt === 1) throw new Error(`Failed to resolve chunk ${chunk.index}`); }
      }
    }
    if (!filePath) throw new Error(`Chunk ${chunk.index}: no file_path`);

    let resp: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await getFileStream(env, filePath);
      if (r.ok && r.body) { resp = r; break; }
      if (attempt === 1) throw new Error(`Chunk ${chunk.index}: CDN download failed`);
    }
    if (!resp || !resp.body) throw new Error(`Chunk ${chunk.index}: empty response`);

    const chunkData = new Uint8Array(await resp.arrayBuffer());
    const chunkFileStart = filePos;
    const chunkFileEnd = filePos + chunkData.length;

    // Extract the portion of this chunk that overlaps with the target range
    if (chunkFileEnd > range.start && chunkFileStart <= range.end) {
      const sliceStart = Math.max(0, range.start - chunkFileStart);
      const sliceEnd = Math.min(chunkData.length, range.end + 1 - chunkFileStart);
      if (sliceEnd > sliceStart) {
        const piece = chunkData.slice(sliceStart, sliceEnd); // copy — chunkData can be GC'd
        slices.push(piece);
        slicesTotal += piece.length;
      }
    }

    // Update file position using actual chunk size
    filePos = chunkFileEnd;
    // chunkData falls out of scope here — available for GC
  }

  if (slices.length === 0) {
    console.log(`[stream] direct-chunk: no data in range, returning empty`);
    return new Response(null, {
      status: 206,
      headers: {
        "Content-Type": meta.mime_type || "application/octet-stream",
        "Content-Range": `bytes */${totalSize}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  // Concatenate only the extracted slices
  const combined = new Uint8Array(slicesTotal);
  let offset = 0;
  for (const s of slices) { combined.set(s, offset); offset += s.length; }

  const sliced = combined;
  const sentFileStart = range.start;
  const sentFileEnd = sentFileStart + sliced.length - 1;
  const totalDownloaded = slicesTotal;

  const headers: Record<string, string> = {
    "Content-Type": meta.mime_type || "application/octet-stream",
    "Content-Length": String(sliced.length),
    "Content-Range": `bytes ${sentFileStart}-${sentFileEnd}/${totalSize}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000",
  };

  console.log(`[stream] direct-chunk done: downloaded=${totalDownloaded} sliced=${sliced.length} subReqs≈${finalNeededChunks.length * 2} rangeStart=${sentFileStart}`);
  return new Response(sliced, { status: 206, headers });
}

// Share handlers removed — migrated to sharesRouter (/api/s/*)

// ==============================
// Topic resolution helper
// ==============================

async function resolveTopicId(
  env: Env,
  folderId: string | null
): Promise<number | undefined> {
  if (!folderId) return undefined;
  const { getFolderMeta } = await import("./storage/kv");
  const folder = await getFolderMeta(env, folderId);
  if (!folder) return undefined;
  if (folder.topic_id) return folder.topic_id;
  return resolveTopicId(env, folder.parent_id);
}

async function getUserThreadId(
  env: Env,
  userId: number
): Promise<number | undefined> {
  const userRecord = await env.DB.prepare(
    "SELECT tg_thread_id FROM users WHERE id = ?"
  )
    .bind(userId)
    .first<{ tg_thread_id: number | null }>();
  return userRecord?.tg_thread_id ?? undefined;
}

// ==============================
// Admin init
// ==============================

async function handleInit(
  request: Request,
  env: Env
): Promise<Response> {
  const authHeader = request.headers.get("Authorization");
  if (authHeader !== `Bearer ${env.ADMIN_PASSWORD}`) {
    return Response.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const chatId =
      env.TELEGRAM_CHANNEL_ID || env.STORAGE_CHAT_ID || "";
    const rootId = generateUUID();
    const now = Date.now();

    const { setFolderMeta, setRootConfig } = await import(
      "./storage/kv"
    );
    await setFolderMeta(env, rootId, {
      id: rootId,
      name: "我的文件",
      parent_id: null,
      created_at: now,
      updated_at: now,
      path: "/",
      child_count: 0,
    });
    await setRootConfig(env, {
      initialized: true,
      root_folder_id: rootId,
    });

    return Response.json({
      success: true,
      message: "System initialized successfully",
      data: { root_folder_id: rootId },
    });
  } catch (e: unknown) {
    const msg =
      e instanceof Error ? e.message : "Init failed";
    return Response.json(
      { success: false, error: msg },
      { status: 500 }
    );
  }
}

// ==============================
// WebSocket Upload (retained from original)
// ==============================

async function handleWsUpload(
  request: Request,
  env: Env,
  userId: number
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  const state = {
    chunks: [] as Blob[],
    bytes: 0,
    filename: "",
    totalSize: 0,
    volumeIndex: 0,
    received: 0,
    closed: false,
    flushing: false,
    drain: false,
    fileIds: [] as { index: number; file_id: string }[],
  };

  // Keepalive: prevent CF "hung" detection during TG retry_after waits.
  // The WS message handler is serial — when flush() awaits retryWithBackoff → sleep(26s),
  // incoming ping messages are queued and can't be processed. This independent timer
  // sends a heartbeat every 10s so CF never sees the WS idle for >30s.
  const keepalive = setInterval(() => {
    if (state.closed) { clearInterval(keepalive); return; }
    try { server.send(JSON.stringify({ type: "ka" })); } catch { clearInterval(keepalive); }
  }, 10_000);

  const url = new URL(request.url);
  const parentId = url.searchParams.get("parent_id");
  let cachedTopicId: number | undefined;

  const flush = async () => {
    if (state.chunks.length === 0) return;

    // Telegram getFile API limit: cannot resolve file_path for files >20MB.
    // We must keep each sendDocument payload ≤15MB so getFile always works.
    const MAX_FLUSH_SIZE = 15 * 1024 * 1024; // 15MB — safe margin below 20MB limit

    // Calculate how many chunks fit within MAX_FLUSH_SIZE
    let takeBytes = 0;
    let takeCount = 0;
    for (let i = 0; i < state.chunks.length; i++) {
      const c = state.chunks[i] as unknown as { byteLength?: number; size?: number };
      const chunkSize = c.byteLength || c.size || 0;
      // Stop before exceeding limit, but always take at least one chunk
      if (takeCount > 0 && takeBytes + chunkSize > MAX_FLUSH_SIZE) break;
      takeBytes += chunkSize;
      takeCount++;
    }

    const toSend = state.chunks.splice(0, takeCount);
    state.bytes = Math.max(0, state.bytes - takeBytes);
    const merged = new Blob(toSend);
    const partIdx = state.fileIds.length;
    const { sendDocument } = await import("./bot/telegram");
    const chatId = env.TELEGRAM_CHANNEL_ID || env.STORAGE_CHAT_ID || "";
    const result = await sendDocument(
      env, chatId, merged,
      state.filename + "_v" + state.volumeIndex + "_p" + partIdx,
      cachedTopicId
    );
    console.log(`[WS v${state.volumeIndex}] flush #${partIdx}: ${(merged.size/1048576).toFixed(1)}MB msg=${result.message_id} fid=${result.file_id.substring(0,8)}...`);
    if (!result.file_id) {
      console.error(`[WS v${state.volumeIndex}] flush #${partIdx}: EMPTY file_id after retries! msg=${result.message_id}`);
      throw new Error(`Flush #${partIdx} returned empty file_id — volume will be retried by client`);
    }
    state.fileIds.push({
      index: state.volumeIndex * 100 + partIdx,
      file_id: result.file_id,
    });
  };

  const scheduleFlush = () => {
    if (state.closed) return;
    if (state.chunks.length === 0) {
      if (state.drain) {
        console.log(`[WS v${state.volumeIndex}] done: received=${(state.received/1048576).toFixed(1)}MB expected=${(state.totalSize/1048576).toFixed(1)}MB flushCount=${state.fileIds.length}`);
        server.send(JSON.stringify({ type: "volume_ok", volume: state.volumeIndex, fileIds: state.fileIds, received: state.received }));
        state.closed = true;
      }
      return;
    }
    if (state.flushing) return;
    if (!state.drain && state.bytes < 5 * 1024 * 1024) return;

    // Enforce minimum gap between flushes to smooth Telegram API load
    const now = Date.now();
    const gap = now - (state as any)._lastFlushTime;
    const MIN_FLUSH_GAP = 100; // 100ms minimum between flushes
    if ((state as any)._lastFlushTime && gap < MIN_FLUSH_GAP) {
      setTimeout(() => scheduleFlush(), MIN_FLUSH_GAP - gap);
      return;
    }

    state.flushing = true;
    setTimeout(async () => {
      try { await flush(); } catch {} finally {
        (state as any)._lastFlushTime = Date.now();
        state.flushing = false;
        scheduleFlush();
      }
    }, 0);
  };

  server.addEventListener("message", (event: MessageEvent) => {
    if (state.closed) return;
    const data = event.data;

    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "ping") {
          server.send(JSON.stringify({ type: "pong" }));
          return;
        }
        if (msg.type === "meta") {
          state.filename = msg.filename || "file";
          state.totalSize = Number(msg.totalSize) || 0;
          state.volumeIndex = Number(msg.volumeIndex) || 0;
          console.log(`[WS v${state.volumeIndex}] meta: ${state.filename} ${(state.totalSize/1048576).toFixed(1)}MB`);
          (async () => {
            cachedTopicId = parentId
              ? (await resolveTopicId(env, parentId)) ?? await getUserThreadId(env, userId)
              : await getUserThreadId(env, userId);
            console.log(`[WS v${state.volumeIndex}] topicId=${cachedTopicId} ready`);
            server.send(JSON.stringify({ type: "ready" }));
          })();
        } else if (msg.type === "volume_done") {
          state.drain = true;
          scheduleFlush();
        }
      } catch (e: unknown) {
        server.send(
          JSON.stringify({
            type: "error",
            error: (e as Error).message || "Parse",
          })
        );
      }
      return;
    }

    // Binary data
    const byteLen =
      data instanceof ArrayBuffer
        ? data.byteLength
        : (data as Blob).size ||
          (data as any)?.byteLength ||
          0;

    if (
      state.bytes + byteLen > 5 * 1024 * 1024 &&
      state.chunks.length > 0
    ) {
      scheduleFlush();
    }

    state.chunks.push(data);
    state.bytes += byteLen;
    state.received += byteLen;

    if (state.bytes >= 5 * 1024 * 1024) {
      scheduleFlush();
    }

    if (state.totalSize > 0) {
      const pct = Math.min(
        99,
        Math.round((state.received / state.totalSize) * 100)
      );
      server.send(
        JSON.stringify({
          type: "progress",
          percent: pct,
          mb: (state.received / 1048576).toFixed(1),
        })
      );
    }
  });

  server.addEventListener("error", () => {
    state.closed = true;
  });
  server.addEventListener("close", () => {
    state.closed = true;
  });

  return new Response(null, { status: 101, webSocket: client });
}

// ==============================
// WebSocket Download (retained from original)
// ==============================

async function handleWsDownload(
  request: Request,
  env: Env
): Promise<Response> {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();

  let closed = { value: false };
  let subReqCount = 0;
  const MAX_SUBREQ = 45;

  server.addEventListener(
    "message",
    async (event: MessageEvent) => {
      if (closed.value) return;

      let msg: {
        type: string;
        fileId?: string;
        startChunk?: number;
        endChunk?: number;
      };
      try {
        msg = JSON.parse(
          typeof event.data === "string"
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer)
        );
      } catch {
        server.send(
          JSON.stringify({
            type: "error",
            message: "Invalid message",
          })
        );
        return;
      }

      if (msg.type !== "download" || !msg.fileId) {
        server.send(
          JSON.stringify({
            type: "error",
            message: "Expected {type:'download', fileId}",
          })
        );
        return;
      }

      const startChunk = msg.startChunk || 0;

      try {
        const { getFileMeta, setFileMeta } = await import(
          "./storage/kv"
        );
        const meta = await getFileMeta(env, msg.fileId!);
        if (!meta?.chunks || meta.chunks.length === 0) {
          server.send(
            JSON.stringify({
              type: "error",
              message: "File not found or not chunked",
            })
          );
          return;
        }

        const chunks = meta.chunks;
        const endChunk = msg.endChunk || chunks.length;

        let sentBytes = 0;
        for (let i = 0; i < startChunk; i++) {
          sentBytes += chunks[i].size || 0;
        }

        server.send(
          JSON.stringify({
            type: "meta",
            name: meta.name,
            size: meta.size,
            mimeType:
              meta.mime_type || "application/octet-stream",
            totalChunks: chunks.length,
            startChunk,
            sentBytes,
          })
        );

        const { getFile, getFileStream } = await import(
          "./bot/telegram"
        );

        for (
          let i = startChunk;
          i < Math.min(endChunk, chunks.length);
          i++
        ) {
          if (closed.value) return;
          if (subReqCount >= MAX_SUBREQ) {
            server.send(
              JSON.stringify({
                type: "error",
                message:
                  "Too many subrequests, please retry",
              })
            );
            return;
          }

          const c = chunks[i];

          let filePath = c.file_path;
          if (!filePath) {
            subReqCount++;
            const file = await getFile(
              env,
              c.telegram_file_id
            );
            filePath = file.file_path;
          }

          if (!filePath) {
            server.send(
              JSON.stringify({
                type: "error",
                message: `Chunk ${i} has no file_path`,
              })
            );
            return;
          }

          subReqCount++;
          const resp = await getFileStream(env, filePath);

          if (!resp.ok && c.file_path) {
            subReqCount++;
            const file = await getFile(
              env,
              c.telegram_file_id
            );
            if (file.file_path) {
              filePath = file.file_path;
              subReqCount++;
              const retryResp = await getFileStream(
                env,
                filePath
              );
              if (retryResp.ok && retryResp.body) {
                sentBytes += await streamChunkToWs(
                  retryResp.body,
                  server,
                  closed
                );
                server.send(
                  JSON.stringify({
                    type: "progress",
                    index: i,
                    totalChunks: chunks.length,
                    sentBytes,
                    totalSize: meta.size,
                  })
                );
                continue;
              }
            }
            server.send(
              JSON.stringify({
                type: "error",
                message: `Chunk ${i} download failed after retry`,
              })
            );
            return;
          }

          if (!resp.ok || !resp.body) {
            server.send(
              JSON.stringify({
                type: "error",
                message: `Chunk ${i} download failed: ${resp.status}`,
              })
            );
            return;
          }

          sentBytes += await streamChunkToWs(
            resp.body,
            server,
            closed
          );

          if (!c.file_path && filePath) {
            c.file_path = filePath;
            c.size = c.size || 0;
            try {
              const updatedChunks = meta.chunks!.map(
                (ch, idx) => (idx === i ? c : ch)
              );
              await setFileMeta(env, msg.fileId!, {
                id: meta.id,
                name: meta.name,
                size: meta.size,
                mime_type: meta.mime_type,
                created_at: meta.created_at,
                updated_at: Date.now(),
                parent_id: meta.parent_id,
                is_chunks: true,
                chunks: updatedChunks,
                telegram_file_id: meta.telegram_file_id,
                telegram_message_id:
                  meta.telegram_message_id,
                user_id: meta.user_id,
              });
            } catch {
              /* best-effort cache update */
            }
          }

          server.send(
            JSON.stringify({
              type: "progress",
              index: i,
              totalChunks: chunks.length,
              sentBytes,
              totalSize: meta.size,
            })
          );
        }

        server.send(JSON.stringify({ type: "done" }));
      } catch (e: unknown) {
        server.send(
          JSON.stringify({
            type: "error",
            message:
              (e as Error).message || "Download failed",
          })
        );
      }
    }
  );

  server.addEventListener("error", () => {
    closed.value = true;
  });
  server.addEventListener("close", () => {
    closed.value = true;
  });

  return new Response(null, { status: 101, webSocket: client });
}

/**
 * Read entire Telegram CDN stream into memory, then send as ONE binary frame.
 */
async function streamChunkToWs(
  body: ReadableStream<Uint8Array>,
  server: WebSocket,
  closed: { value: boolean }
): Promise<number> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || closed.value) break;
      parts.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (total > 0 && !closed.value) {
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      merged.set(p, offset);
      offset += p.byteLength;
    }
    server.send(merged);
  }
  return total;
}
