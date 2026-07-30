import { Hono } from "hono";
import type { Env, JwtPayload } from "../types";
import { authGuard } from "../middleware/auth";
import { hashPassword, verifyPassword } from "../utils/password";

type AppEnv = { Bindings: Env; Variables: { user: JwtPayload } };

export const userRouter = new Hono<AppEnv>();

userRouter.use("*", authGuard);

/**
 * GET /api/user/storage
 */
userRouter.get("/storage", async (c) => {
  const user = c.get("user");

  const stats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total_files,
       COALESCE(SUM(CASE WHEN type = 'file' THEN size ELSE 0 END), 0) as total_size,
       COALESCE(SUM(CASE WHEN type = 'folder' THEN 1 ELSE 0 END), 0) as total_folders
     FROM files
     WHERE user_id = ? AND deleted = 0`
  )
    .bind(user.sub)
    .first<{
      total_files: number;
      total_size: number;
      total_folders: number;
    }>();

  return c.json({
    success: true,
    data: {
      used: stats?.total_size || 0,
      files: stats?.total_files || 0,
      folders: stats?.total_folders || 0,
    },
  });
});

/**
 * PUT /api/user/profile
 */
userRouter.put("/profile", async (c) => {
  const user = c.get("user");
  const { email, avatar_url } = await c.req.json<{
    email?: string;
    avatar_url?: string;
  }>();

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (email !== undefined) {
    if (email) {
      const existing = await c.env.DB.prepare(
        "SELECT id FROM users WHERE email = ? AND id != ?"
      )
        .bind(email, user.sub)
        .first();
      if (existing) {
        return c.json({ success: false, error: "邮箱已被使用" }, 409);
      }
    }
    updates.push("email = ?");
    params.push(email || "");
  }

  if (avatar_url !== undefined) {
    updates.push("avatar_url = ?");
    params.push(avatar_url || "");
  }

  if (updates.length === 0) {
    return c.json(
      { success: false, error: "没有需要更新的字段" },
      400
    );
  }

  updates.push("updated_at = datetime('now')");
  params.push(user.sub);

  await c.env.DB.prepare(
    `UPDATE users SET ${updates.join(", ")} WHERE id = ?`
  )
    .bind(...params)
    .run();

  return c.json({ success: true, message: "更新成功" });
});

/**
 * PUT /api/user/password
 */
userRouter.put("/password", async (c) => {
  const user = c.get("user");
  const { old_password, new_password } = await c.req.json<{
    old_password: string;
    new_password: string;
  }>();

  if (!old_password || !new_password) {
    return c.json(
      { success: false, error: "请提供旧密码和新密码" },
      400
    );
  }
  if (new_password.length < 8) {
    return c.json(
      { success: false, error: "新密码至少 8 个字符" },
      400
    );
  }

  const dbUser = await c.env.DB.prepare(
    "SELECT password_hash FROM users WHERE id = ?"
  )
    .bind(user.sub)
    .first<{ password_hash: string }>();

  if (!dbUser) {
    return c.json({ success: false, error: "用户不存在" }, 404);
  }

  const valid = await verifyPassword(old_password, dbUser.password_hash);
  if (!valid) {
    return c.json({ success: false, error: "旧密码错误" }, 401);
  }

  const newHash = await hashPassword(new_password);
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(newHash, user.sub)
    .run();

  return c.json({ success: true, message: "密码修改成功" });
});
