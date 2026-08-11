import { Hono } from "hono";
import type { Env, RegisterRequest, LoginRequest, User } from "../types";
import { hashPassword, verifyPassword } from "../utils/password";
import { generateTokenPair, verifyToken } from "../utils/jwt";
import { authGuard } from "../middleware/auth";
import { createForumTopic } from "../bot/telegram";

export const authRouter = new Hono<{ Bindings: Env }>();

/**
 * POST /api/auth/register
 */
authRouter.post("/register", async (c) => {
  const body = await c.req.json<RegisterRequest>();
  const { username, password, email } = body;

  if (!username || !password) {
    return c.json({ success: false, error: "用户名和密码不能为空" }, 400);
  }
  if (username.length < 3 || username.length > 32) {
    return c.json({ success: false, error: "用户名长度需为 3-32 个字符" }, 400);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return c.json(
      { success: false, error: "用户名只能包含字母、数字和下划线" },
      400
    );
  }
  if (password.length < 8) {
    return c.json({ success: false, error: "密码至少 8 个字符" }, 400);
  }

  // Check username
  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE username = ?"
  )
    .bind(username)
    .first();

  if (existing) {
    return c.json({ success: false, error: "用户名已存在" }, 409);
  }

  // Check email
  if (email) {
    const emailExists = await c.env.DB.prepare(
      "SELECT id FROM users WHERE email = ?"
    )
      .bind(email)
      .first();
    if (emailExists) {
      return c.json({ success: false, error: "邮箱已被注册" }, 409);
    }
  }

  // Create user
  const passwordHash = await hashPassword(password);
  const result = await c.env.DB.prepare(
    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)"
  )
    .bind(username, email || null, passwordHash)
    .run();

  const userId = result.meta.last_row_id;

  // Create Telegram forum topic for the user
  let threadId: number | null = null;
  try {
    const chatId = c.env.TELEGRAM_CHANNEL_ID || c.env.STORAGE_CHAT_ID || "";
    threadId = (await createForumTopic(c.env, chatId, `${username} 的文件`))
      .message_thread_id;
    await c.env.DB.prepare(
      "UPDATE users SET tg_thread_id = ? WHERE id = ?"
    )
      .bind(threadId, userId)
      .run();
  } catch (err) {
    console.error("Failed to create forum topic:", err);
  }

  // Issue tokens
  const tokens = await generateTokenPair(
    userId as number,
    username,
    c.env.JWT_SECRET,
    c.env.JWT_REFRESH_SECRET
  );

  return c.json(
    {
      success: true,
      data: {
        user: { id: userId, username, email: email || null },
        ...tokens,
      },
    },
    201
  );
});

/**
 * POST /api/auth/login
 */
authRouter.post("/login", async (c) => {
  const body = await c.req.json<LoginRequest>();
  const { username, password } = body;

  if (!username || !password) {
    return c.json({ success: false, error: "用户名和密码不能为空" }, 400);
  }

  // Rate limiting via KV
  const rateLimitKey = `login_limit:${username}`;
  const attempts = await c.env.METADATA_KV.get(rateLimitKey);
  if (attempts && parseInt(attempts) >= 5) {
    return c.json(
      { success: false, error: "登录尝试过于频繁，请 1 分钟后再试" },
      429
    );
  }

  // Find user
  const user = await c.env.DB.prepare(
    "SELECT * FROM users WHERE username = ?"
  )
    .bind(username)
    .first<User>();

  if (!user) {
    await c.env.METADATA_KV.put(
      rateLimitKey,
      String((parseInt(attempts || "0") + 1)),
      { expirationTtl: 60 }
    );
    return c.json({ success: false, error: "用户名或密码错误" }, 401);
  }

  // Verify password
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await c.env.METADATA_KV.put(
      rateLimitKey,
      String((parseInt(attempts || "0") + 1)),
      { expirationTtl: 60 }
    );
    return c.json({ success: false, error: "用户名或密码错误" }, 401);
  }

  // Clear rate limit
  await c.env.METADATA_KV.delete(rateLimitKey);

  // Issue tokens
  const tokens = await generateTokenPair(
    user.id,
    user.username,
    c.env.JWT_SECRET,
    c.env.JWT_REFRESH_SECRET
  );

  return c.json({
    success: true,
    data: {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
        storage_used: user.storage_used,
      },
      ...tokens,
    },
  });
});

/**
 * POST /api/auth/refresh
 */
authRouter.post("/refresh", async (c) => {
  const body = await c.req.json<{ refresh_token: string }>();
  const { refresh_token } = body;

  if (!refresh_token) {
    return c.json({ success: false, error: "缺少 refresh_token" }, 400);
  }

  const payload = await verifyToken(refresh_token, c.env.JWT_REFRESH_SECRET);
  if (!payload || payload.type !== "refresh") {
    return c.json(
      { success: false, error: "refresh_token 无效或已过期" },
      401
    );
  }

  const tokens = await generateTokenPair(
    payload.sub,
    payload.username,
    c.env.JWT_SECRET,
    c.env.JWT_REFRESH_SECRET
  );

  return c.json({ success: true, data: tokens });
});

/**
 * GET /api/auth/me
 */
authRouter.get("/me", authGuard, async (c) => {
  const jwtUser = c.get("user");

  const user = await c.env.DB.prepare(
    "SELECT id, username, email, avatar_url, storage_used, created_at FROM users WHERE id = ?"
  )
    .bind(jwtUser.sub)
    .first();

  if (!user) {
    return c.json({ success: false, error: "用户不存在" }, 404);
  }

  return c.json({ success: true, data: user });
});

/**
 * POST /api/auth/logout
 */
authRouter.post("/logout", authGuard, async (c) => {
  const jwtUser = c.get("user");

  await c.env.METADATA_KV.put(
    `revoked:${jwtUser.sub}:${jwtUser.iat}`,
    "1",
    { expirationTtl: 15 * 60 }
  );

  return c.json({ success: true, message: "已登出" });
});
