import type { Env, SessionData } from "../types";
import { getSession, setSession, deleteSession } from "../storage/kv";
import { generateToken, verifyPassword, hashPassword } from "../utils/common";

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = "tcd_session";

// ==============================
// Password management
// ==============================

/**
 * Initialize the admin password (stored in KV as hash+salt).
 * Called on first setup.
 */
export async function initPassword(env: Env, password: string): Promise<void> {
  const existing = await env.METADATA_KV.get("config:password_hash");
  if (existing) {
    throw new Error("Password already initialized");
  }
  const { hash, salt } = await hashPassword(password);
  await env.METADATA_KV.put("config:password_hash", hash);
  await env.METADATA_KV.put("config:password_salt", salt);
}

/**
 * Verify the admin password.
 */
export async function verifyAdminPassword(env: Env, password: string): Promise<boolean> {
  const hash = await env.METADATA_KV.get("config:password_hash");
  const salt = await env.METADATA_KV.get("config:password_salt");
  if (!hash || !salt) {
    // If no password set in KV, use the WEB_PASSWORD env var directly
    return password === env.WEB_PASSWORD;
  }
  // Verify against stored hash, with env.WEB_PASSWORD as fallback
  const hashValid = await verifyPassword(password, hash, salt);
  if (hashValid) return true;
  // Fallback: also accept raw WEB_PASSWORD (in case hash was corrupted or secret was changed)
  return password === env.WEB_PASSWORD;
}

// ==============================
// Session management
// ==============================

/**
 * Create a new session after successful login.
 */
export async function createSession(env: Env): Promise<string> {
  const sessionId = generateToken(48);
  const session: SessionData = {
    user_id: "admin",
    created_at: Date.now(),
    expires_at: Date.now() + SESSION_DURATION,
  };
  await setSession(env, sessionId, session);
  return sessionId;
}

/**
 * Get the session cookie string.
 */
export function sessionCookie(sessionId: string): string {
  return `${COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=${SESSION_DURATION / 1000}`;
}

/**
 * Clear the session cookie.
 */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=None; Secure; Path=/; Max-Age=0`;
}

/**
 * Check authentication from a request.
 */
export async function checkAuth(
  request: Request,
  env: Env
): Promise<{ valid: boolean; userId?: string }> {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies[COOKIE_NAME];

  if (!sessionId) {
    return { valid: false };
  }

  const session = await getSession(env, sessionId);
  if (!session || session.expires_at < Date.now()) {
    return { valid: false };
  }

  return { valid: true, userId: session.user_id };
}

/**
 * Handle login request.
 */
export async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const body = await request.json() as { password?: string };
  const password = body.password || "";

  const valid = await verifyAdminPassword(env, password);
  if (!valid) {
    return json({ error: "Invalid password" }, 401);
  }

  const sessionId = await createSession(env);
  return json(
    { success: true, message: "Login successful" },
    200,
    { "Set-Cookie": sessionCookie(sessionId) }
  );
}

/**
 * Handle logout request.
 */
export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies[COOKIE_NAME];

  if (sessionId) {
    await deleteSession(env, sessionId);
  }

  return json(
    { success: true, message: "Logged out" },
    200,
    { "Set-Cookie": clearSessionCookie() }
  );
}

// ==============================
// Helpers
// ==============================

function parseCookies(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(";")) {
    const [key, ...val] = pair.trim().split("=");
    if (key) result[key] = decodeURIComponent(val.join("="));
  }
  return result;
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}
