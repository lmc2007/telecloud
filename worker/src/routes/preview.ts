import { Hono } from "hono";
import type { Env, JwtPayload } from "../types";
import { authGuard } from "../middleware/auth";
import { signPreviewToken } from "../utils/jwt";

type AppEnv = { Bindings: Env; Variables: { user: JwtPayload } };

export const previewRouter = new Hono<AppEnv>();

/**
 * GET /api/files/:id/preview — 获取预览流媒体短期 token
 * 用于 <img>/<video> 等无法携带 Authorization 头的原生标签
 * 返回 token，前端拼接为 /api/files/:id/stream?token=xxx
 */
previewRouter.get("/:id/preview", authGuard, async (c) => {
  const user = c.get("user");
  const fileId = c.req.param("id");

  if (!fileId) {
    return c.json({ success: false, error: "缺少文件 ID" }, 400);
  }

  // Verify file exists in KV
  const { getFileMeta } = await import("../storage/kv");
  const meta = await getFileMeta(c.env, fileId);
  if (!meta) {
    return c.json({ success: false, error: "文件不存在" }, 404);
  }

  // Generate short-lived preview token (5 min)
  const token = await signPreviewToken(user.sub, fileId, c.env.JWT_SECRET);

  return c.json({
    success: true,
    data: {
      token,
      expires_in: 1800,
      mime_type: meta.mime_type,
      name: meta.name,
      size: meta.size,
      is_chunks: meta.is_chunks,
      chunks_count: meta.chunks?.length || 0,
    },
  });
});
