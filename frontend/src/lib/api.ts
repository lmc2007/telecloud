// API base URL — runtime configurable, no build-time env required.
// Priority:
//   1. window.__TCD_API_BASE__ (set via inline script in index.html or external config)
//   2. Same-origin /api (works when Pages and Worker share the same domain)
declare global { interface Window { __TCD_API_BASE__?: string; } }
const API_BASE: string =
  (typeof window !== "undefined" && window.__TCD_API_BASE__)
  || (typeof window !== "undefined" ? window.location.origin + "/api" : "/api");

export { API_BASE };

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  skipAuth?: boolean;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  setToken(token: string | null) {
    this.accessToken = token;
  }

  setRefreshToken(token: string | null) {
    this.refreshToken = token;
  }

  getToken(): string | null {
    return this.accessToken;
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken) return false;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: this.refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (data.success && data.data?.access_token) {
          this.accessToken = data.data.access_token;
          if (data.data.refresh_token) {
            this.refreshToken = data.data.refresh_token;
          }
          localStorage.setItem("tcd_access_token", this.accessToken as string);
          if (data.data.refresh_token) {
            localStorage.setItem("tcd_refresh_token", this.refreshToken!);
          }
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async request<T>(
    path: string,
    options: ApiOptions = {}
  ): Promise<T> {
    const { method = "GET", body, token, skipAuth } = options;
    const headers: Record<string, string> = {};

    const authToken = token ?? this.accessToken;
    if (authToken && !skipAuth) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }
    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (
      res.status === 401 &&
      authToken &&
      !skipAuth &&
      !path.startsWith("/auth/")
    ) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        const retryHeaders: Record<string, string> = {};
        if (this.accessToken) {
          retryHeaders["Authorization"] = `Bearer ${this.accessToken}`;
        }
        if (body) {
          retryHeaders["Content-Type"] = "application/json";
        }
        const retryRes = await fetch(`${API_BASE}${path}`, {
          method,
          headers: retryHeaders,
          body: body ? JSON.stringify(body) : undefined,
        });
        const retryData = await retryRes.json();
        if (!retryRes.ok) {
          throw new ApiError(
            retryData.error || "Request failed",
            retryRes.status
          );
        }
        return retryData;
      }
    }

    const data = await res.json();
    if (!res.ok) {
      throw new ApiError(data.error || "Request failed", res.status);
    }
    return data;
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "POST", body });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>(path, { method: "PUT", body });
  }

  delete<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }

  /**
   * Low-level fetch with automatic 401 → token refresh → retry.
   * Returns the raw Response object (no JSON parsing), suitable for
   * binary downloads (chunks, blobs) that need auth.
   */
  async rawFetch(
    path: string,
    options: { method?: string; body?: BodyInit | null; headers?: Record<string, string>; skipAuth?: boolean } = {}
  ): Promise<Response> {
    const { method = "GET", body, headers: extraHeaders, skipAuth } = options;
    const headers: Record<string, string> = { ...extraHeaders };

    const authToken = this.accessToken;
    if (authToken && !skipAuth) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const doFetch = (token: string | null): Promise<Response> => {
      const h: Record<string, string> = { ...headers };
      if (token && !skipAuth) h["Authorization"] = `Bearer ${token}`;
      return fetch(`${API_BASE}${path}`, { method, headers: h, body });
    };

    const res = await doFetch(authToken);

    if (res.status === 401 && authToken && !skipAuth && !path.startsWith("/auth/")) {
      const refreshed = await this.tryRefresh();
      if (refreshed && this.accessToken) {
        return doFetch(this.accessToken);
      }
    }

    return res;
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export const api = new ApiClient();

// ==============================
// Preview helpers
// ==============================

interface PreviewTokenData {
  token: string;
  expires_in: number;
  mime_type: string;
  name: string;
  size: number;
  is_chunks: boolean;
  chunks_count: number;
}

/**
 * Get a short-lived preview stream URL for an authenticated user's file.
 * Used by <img>/<video> tags that cannot send Authorization headers.
 */
export async function getPreviewStreamUrl(fileId: string): Promise<string> {
  const res = await api.get<{ success: boolean; data?: PreviewTokenData; error?: string }>(
    `/files/${fileId}/preview`
  );
  if (!res.success || !res.data?.token) {
    throw new Error(res.error || "获取预览 token 失败");
  }
  return `${API_BASE}/files/${fileId}/stream?token=${encodeURIComponent(res.data.token)}`;
}

/**
 * Build a share stream URL for public share preview.
 */
export function getShareStreamUrl(token: string, password?: string, fileIndex?: number, folderId?: string): string {
  const params = new URLSearchParams();
  if (password) params.set("pw", password);
  if (fileIndex !== undefined && fileIndex > 0) params.set("file_index", String(fileIndex));
  if (folderId) params.set("folder_id", folderId);
  const qs = params.toString();
  return `${API_BASE}/s/${token}/stream${qs ? `?${qs}` : ""}`;
}
