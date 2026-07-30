import type { Env, DirEntry, FileItem, FolderItem, PaginatedList } from "../types";
import { getFileMeta, getFolderMeta, getChildren, setFolderMeta, setPathMapping, deletePathMapping, deleteFolderMeta, addChild, removeChild, setFileMeta, deleteFileMeta, getPathMapping } from "../storage/kv";
import { createForumTopic, editForumTopic as tgEditForumTopic, deleteForumTopic as tgDeleteForumTopic } from "../bot/telegram";
import { generateUUID, humanReadableSize, normalizePath } from "../utils/common";

// ==============================
// List directory contents
// ==============================

export async function listFiles(
  env: Env,
  folderId: string | null,
  page: number = 1,
  size: number = 50,
  keyword?: string
): Promise<PaginatedList<DirEntry>> {
  // If no folderId, get root
  let targetId = folderId;
  if (!targetId) {
    const rootConfig = await env.METADATA_KV.get("config:root", "json") as { root_folder_id: string } | null;
    if (rootConfig) {
      targetId = rootConfig.root_folder_id;
    }
  }

  if (!targetId) {
    return { items: [], total: 0, page, size };
  }

  const childIds = await getChildren(env, targetId);
  const entries: DirEntry[] = [];

  // Fetch all entries (KV doesn't support filtering, we do it in code)
  for (const childId of childIds) {
    const fileMeta = await getFileMeta(env, childId);
    if (fileMeta) {
      if (keyword && !fileMeta.name.toLowerCase().includes(keyword.toLowerCase())) continue;
      entries.push({
        id: fileMeta.id,
        name: fileMeta.name,
        size: fileMeta.size,
        size_formatted: humanReadableSize(fileMeta.size),
        mime_type: fileMeta.mime_type,
        type: "file",
        is_chunks: fileMeta.is_chunks || false,
        created_at: fileMeta.created_at,
        download_url: `/api/files/${fileMeta.id}/download`,
      });
      continue;
    }

    const folderMeta = await getFolderMeta(env, childId);
    if (folderMeta) {
      if (keyword && !folderMeta.name.toLowerCase().includes(keyword.toLowerCase())) continue;
      entries.push({
        id: folderMeta.id,
        name: folderMeta.name,
        type: "folder",
        child_count: folderMeta.child_count,
        created_at: folderMeta.created_at,
        path: folderMeta.path,
      });
    }
  }

  // Sort: folders first, then files, both by name
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const total = entries.length;
  const start = (page - 1) * size;
  const paginated = entries.slice(start, start + size);

  return { items: paginated, total, page, size };
}

// ==============================
// Create folder
// ==============================

export async function createFolder(
  env: Env,
  chatId: string,
  name: string,
  parentId: string | null,
  parentPath: string
): Promise<FolderItem> {
  const folderId = generateUUID();
  const path = normalizePath(parentPath + "/" + name);

  // If parent is null (root-level), create a Telegram Forum Topic
  let topicId: number | undefined;
  if (!parentId) {
    const topic = await createForumTopic(env, chatId, name);
    topicId = topic.message_thread_id;
  }

  const now = Date.now();
  const meta = {
    id: folderId,
    name,
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    topic_id: topicId,
    path,
    child_count: 0,
  };

  await setFolderMeta(env, folderId, meta);
  await setPathMapping(env, path, { type: "folder", id: folderId });

  if (parentId) {
    await addChild(env, parentId, folderId);
    // Update parent child_count
    const parent = await getFolderMeta(env, parentId);
    if (parent) {
      parent.child_count = (parent.child_count || 0) + 1;
      await setFolderMeta(env, parentId, parent);
    }
  } else {
    // Root-level folder: add to root folder
    const rootConfig = await env.METADATA_KV.get("config:root", "json") as { root_folder_id?: string } | null;
    if (rootConfig?.root_folder_id) {
      await addChild(env, rootConfig.root_folder_id, folderId);
      const root = await getFolderMeta(env, rootConfig.root_folder_id);
      if (root) {
        root.child_count = (root.child_count || 0) + 1;
        await setFolderMeta(env, rootConfig.root_folder_id, root);
      }
    }
  }

  return {
    id: folderId,
    name,
    type: "folder",
    child_count: 0,
    created_at: now,
    path,
  };
}

// ==============================
// Delete folder (recursive)
// ==============================

export async function deleteFolder(
  env: Env,
  chatId: string,
  folderId: string
): Promise<boolean> {
  const folder = await getFolderMeta(env, folderId);
  if (!folder) return false;

  // Recursively delete children
  const childIds = await getChildren(env, folderId);
  for (const childId of childIds) {
    const fileMeta = await getFileMeta(env, childId);
    if (fileMeta) {
      // Delete file
      await deleteFileMeta(env, childId);
      const filePath = normalizePath(folder.path + "/" + fileMeta.name);
      await deletePathMapping(env, filePath);
    } else {
      // Recursively delete subfolder
      await deleteFolder(env, chatId, childId);
    }
  }

  // Delete the Telegram Topic if top-level
  if (folder.topic_id) {
    await tgDeleteForumTopic(env, chatId, folder.topic_id);
  }

  // Clean up KV
  await deletePathMapping(env, folder.path);
  await deleteFolderMeta(env, folderId);

  // Remove from parent
  if (folder.parent_id) {
    await removeChild(env, folder.parent_id, folderId);
    const parent = await getFolderMeta(env, folder.parent_id);
    if (parent) {
      parent.child_count = Math.max(0, (parent.child_count || 1) - 1);
      await setFolderMeta(env, folder.parent_id, parent);
    }
  }

  return true;
}

// ==============================
// Rename file/folder
// ==============================

export async function renameEntry(
  env: Env,
  entryId: string,
  entryType: "file" | "folder",
  newName: string
): Promise<boolean> {
  if (entryType === "file") {
    const file = await getFileMeta(env, entryId);
    if (!file) return false;

    const oldPath = normalizePath((file.parent_id ? (await getFolderMeta(env, file.parent_id))?.path || "" : "") + "/" + file.name);
    const newPath = normalizePath((file.parent_id ? (await getFolderMeta(env, file.parent_id))?.path || "" : "") + "/" + newName);

    file.name = newName;
    file.updated_at = Date.now();
    await setFileMeta(env, entryId, file);
    if (oldPath !== newPath) {
      await deletePathMapping(env, oldPath);
      await setPathMapping(env, newPath, { type: "file", id: entryId });
    }
    return true;
  } else {
    const folder = await getFolderMeta(env, entryId);
    if (!folder) return false;

    const oldPath = folder.path;
    const parentPath = folder.parent_id ? (await getFolderMeta(env, folder.parent_id))?.path || "" : "";
    const newPath = normalizePath(parentPath + "/" + newName);

    folder.name = newName;
    folder.path = newPath;
    folder.updated_at = Date.now();
    await setFolderMeta(env, entryId, folder);
    if (oldPath !== newPath) {
      await deletePathMapping(env, oldPath);
      await setPathMapping(env, newPath, { type: "folder", id: entryId });
    }

    // If it has a Telegram topic, rename that too
    const chatId = env.TELEGRAM_CHANNEL_ID || env.STORAGE_CHAT_ID || "";
    if (folder.topic_id) {
      await tgEditForumTopic(env, chatId, folder.topic_id, newName);
    }
    return true;
  }
}

// ==============================
// Delete a single file
// ==============================

export async function deleteFile(
  env: Env,
  fileId: string
): Promise<boolean> {
  const file = await getFileMeta(env, fileId);
  if (!file) return false;

  // Remove from parent's children list
  if (file.parent_id) {
    await removeChild(env, file.parent_id, fileId);
  }

  // Remove path mapping
  const parent = file.parent_id ? await getFolderMeta(env, file.parent_id) : null;
  const filePath = normalizePath((parent?.path || "") + "/" + file.name);
  await deletePathMapping(env, filePath);

  // Delete metadata
  await deleteFileMeta(env, fileId);

  // Note: Actual Telegram messages are NOT deleted here to avoid data loss.
  // They can be cleaned up later via Telegram's auto-delete or manual cleanup.
  return true;
}

// ==============================
// Move file/folder
// ==============================

export async function moveEntry(
  env: Env,
  entryId: string,
  entryType: "file" | "folder",
  newParentId: string
): Promise<boolean> {
  if (entryType === "file") {
    const file = await getFileMeta(env, entryId);
    if (!file) return false;

    // Remove from old parent
    if (file.parent_id) {
      await removeChild(env, file.parent_id, entryId);
    }

    // Add to new parent
    file.parent_id = newParentId;
    file.updated_at = Date.now();
    await setFileMeta(env, entryId, file);
    await addChild(env, newParentId, entryId);

    return true;
  } else {
    const folder = await getFolderMeta(env, entryId);
    if (!folder) return false;

    // Remove from old parent
    if (folder.parent_id) {
      await removeChild(env, folder.parent_id, entryId);
    }

    // Add to new parent
    const newParent = await getFolderMeta(env, newParentId);
    const newPath = normalizePath((newParent?.path || "") + "/" + folder.name);

    folder.parent_id = newParentId;
    folder.path = newPath;
    folder.updated_at = Date.now();
    await setFolderMeta(env, entryId, folder);
    await addChild(env, newParentId, entryId);

    // Update path mapping
    await setPathMapping(env, newPath, { type: "folder", id: entryId });

    return true;
  }
}
