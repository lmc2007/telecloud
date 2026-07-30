import { createMiddleware } from "hono/factory";
import type { Env, JwtPayload } from "../types";
import { verifyToken } from "../utils/jwt";

type AuthVariables = {
  user: JwtPayload;
};

/**
 * JWT 认证中间件
 * 从 Authorization: Bearer <token> 中提取并验证 access_token
 */
export const authGuard = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      { success: false, error: "Unauthorized: missing token" },
      401
    );
  }

  const token = authHeader.slice(7);
  const payload = await verifyToken(token, c.env.JWT_SECRET);

  if (!payload) {
    return c.json(
      { success: false, error: "Unauthorized: invalid or expired token" },
      401
    );
  }

  if (payload.type !== "access") {
    return c.json(
      { success: false, error: "Unauthorized: invalid token type" },
      401
    );
  }

  // Check token revocation (KV blacklist)
  const revoked = await c.env.METADATA_KV.get(
    `revoked:${payload.sub}:${payload.iat}`
  );
  if (revoked) {
    return c.json(
      { success: false, error: "Unauthorized: token revoked" },
      401
    );
  }

  c.set("user", payload);
  await next();
});
