import type { JwtPayload, PreviewJwtPayload } from "../types";

/**
 * Web Crypto API JWT (HS256)
 * Cloudflare Workers 兼容，无需外部依赖
 */

function base64UrlEncode(data: ArrayBuffer | string): string {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * 签发 JWT
 */
export async function signToken(
  payload: Omit<JwtPayload, "iat" | "exp">,
  secret: string,
  expiresInSeconds: number
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${header}.${body}`;

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * 验证并解析 JWT
 */
export async function verifyToken(
  token: string,
  secret: string
): Promise<JwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${bodyB64}`;

    const key = await getHmacKey(secret);
    const signatureBytes = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(bodyB64))
    ) as JwtPayload;

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * 生成 token 对 (access + refresh)
 */
export async function generateTokenPair(
  userId: number,
  username: string,
  jwtSecret: string,
  refreshSecret: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const ACCESS_TTL = 15 * 60; // 15 minutes
  const REFRESH_TTL = 7 * 24 * 3600; // 7 days

  const [access_token, refresh_token] = await Promise.all([
    signToken({ sub: userId, username, type: "access" }, jwtSecret, ACCESS_TTL),
    signToken({ sub: userId, username, type: "refresh" }, refreshSecret, REFRESH_TTL),
  ]);

  return { access_token, refresh_token, expires_in: ACCESS_TTL };
}

/**
 * 签发预览流媒体短期 token（30 分钟有效）
 * 用于 <img>/<video> 等无法携带 Authorization 头的原生标签
 */
export async function signPreviewToken(
  userId: number,
  fileId: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: PreviewJwtPayload & { iat: number; exp: number } = {
    sub: userId,
    type: "preview",
    file_id: fileId,
    iat: now,
    exp: now + 1800, // 30 minutes
  };

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * 验证预览流媒体 token
 */
export async function verifyPreviewToken(
  token: string,
  secret: string
): Promise<PreviewJwtPayload | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, bodyB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${bodyB64}`;

    const key = await getHmacKey(secret);
    const signatureBytes = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(bodyB64))
    ) as PreviewJwtPayload;

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    if (payload.type !== "preview") return null;

    return payload;
  } catch {
    return null;
  }
}
