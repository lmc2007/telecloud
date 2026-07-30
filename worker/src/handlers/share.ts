import type { Env, ShareInfo } from "../types";
import { getShare, setShare, deleteShare, getFileMeta } from "../storage/kv";
import { generateToken } from "../utils/common";

/**
 * Create a share link for a file.
 */
export async function createShare(
  env: Env,
  fileId: string,
  options: {
    expires_at?: number;
    max_downloads?: number;
    password?: string;
  }
): Promise<{ token: string; url: string }> {
  const file = await getFileMeta(env, fileId);
  if (!file) {
    throw new Error("File not found");
  }

  const token = generateToken(32);
  const share: ShareInfo = {
    token,
    target_type: "file",
    target_id: fileId,
    created_at: Date.now(),
    expires_at: options.expires_at,
    max_downloads: options.max_downloads,
    download_count: 0,
    password: options.password || undefined,
    creator_id: "admin",
  };

  await setShare(env, token, share);

  return {
    token,
    url: `/s/${token}`,
  };
}

/**
 * Get share info by token.
 */
export async function getShareInfo(env: Env, token: string): Promise<ShareInfo | null> {
  const share = await getShare(env, token);
  if (!share) return null;

  // Check expiry
  if (share.expires_at && share.expires_at < Date.now()) {
    await deleteShare(env, token);
    return null;
  }

  // Check download limit
  if (share.max_downloads && share.download_count >= share.max_downloads) {
    return null;
  }

  return share;
}

/**
 * Increment download count for a share.
 */
export async function incrementDownloadCount(env: Env, token: string): Promise<void> {
  const share = await getShareInfo(env, token);
  if (share) {
    share.download_count++;
    await setShare(env, token, share);
  }
}
