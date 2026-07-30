import type { Env, FileMetadata, ChunkInfo, BigFileInfo, UploadSession } from "../types";
import { sendDocument } from "../bot/telegram";
import { setFileMeta, addChild } from "../storage/kv";
import { generateUUID, humanReadableSize, getMimeType } from "../utils/common";

const MAX_CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_CONCURRENT = 3;

export async function uploadSmallFile(
  env: Env, chatId: string, data: Blob, filename: string,
  parentId: string | null, messageThreadId?: number, userId?: number, caption?: string
): Promise<FileMetadata> {
  let uploadName = filename;
  if (filename.toLowerCase().endsWith(".gif")) {
    uploadName = filename.substring(0, filename.lastIndexOf(".gif"));
  }
  const result = await sendDocument(env, chatId, data, uploadName, messageThreadId, caption);

  const fileId = generateUUID();
  const targetFolderId = parentId || (await getRootFolderId(env, userId));
  const meta: FileMetadata = {
    id: fileId, name: filename, size: result.file_size,
    mime_type: getMimeType(filename), created_at: Date.now(), updated_at: Date.now(),
    parent_id: targetFolderId, is_chunks: false,
    telegram_file_id: result.file_id, telegram_message_id: result.message_id,
    user_id: userId,
  };
  await setFileMeta(env, fileId, meta);
  if (targetFolderId) await addChild(env, targetFolderId, fileId);
  return meta;
}

async function getRootFolderId(env: Env, userId?: number): Promise<string | null> {
  if (userId) { const r = await env.METADATA_KV.get(`user_root:${userId}`); if (r) return r; }
  const raw = await env.METADATA_KV.get("config:root", "json");
  return (raw as { root_folder_id?: string } | null)?.root_folder_id || null;
}

export async function uploadLargeFile(
  env: Env, chatId: string, data: Blob, filename: string,
  parentId: string | null, messageThreadId?: number, userId?: number, caption?: string
): Promise<FileMetadata> {
  const totalSize = data.size;
  const chunks: Blob[] = [];
  for (let offset = 0; offset < totalSize; offset += MAX_CHUNK_SIZE) {
    chunks.push(data.slice(offset, Math.min(offset + MAX_CHUNK_SIZE, totalSize)));
  }
  const totalChunks = chunks.length;

  const chunkResults: { file_id: string; message_id: number; index: number; size: number }[] = [];
  const errors: Error[] = [];

  for (let batchStart = 0; batchStart < totalChunks; batchStart += MAX_CONCURRENT) {
    const batch = chunks.slice(batchStart, Math.min(batchStart + MAX_CONCURRENT, totalChunks));
    const batchPromises = batch.map(async (_c, i) => {
      const idx = batchStart + i, chunkData = chunks[idx];
      try {
        const result = await sendDocument(env, chatId, chunkData, `${filename}_part${idx}`, messageThreadId);
        return { file_id: result.file_id, message_id: result.message_id, index: idx, size: chunkData.size };
      } catch (e) { errors.push(e as Error); return null; }
    });
    for (const r of await Promise.all(batchPromises)) { if (r) chunkResults.push(r); }
    if (errors.length > 0) throw new Error(`Chunk upload failed: ${errors.map(e => (e as Error).message).join("; ")}`);
  }

  chunkResults.sort((a, b) => a.index - b.index);
  // Defense: verify no empty file_ids slipped through
  const emptyFileIds = chunkResults.filter(c => !c.file_id);
  if (emptyFileIds.length > 0) {
    throw new Error(`uploadLargeFile: ${emptyFileIds.length} chunks have empty file_id at indices ${emptyFileIds.map(c => c.index).join(",")}`);
  }
  const fileId = generateUUID();
  const record: BigFileInfo = { fileName: filename, fileSize: totalSize, fileIds: chunkResults.map(c => c.file_id), recordFile: true };
  const recordBytes = new TextEncoder().encode(JSON.stringify(record));
  const recordResult = await sendDocument(env, chatId, new Blob([recordBytes]), `${fileId}.record.json`, messageThreadId, caption);

  const chunkInfos: ChunkInfo[] = chunkResults.map(c => ({
    index: c.index, size: c.size, telegram_file_id: c.file_id, telegram_message_id: c.message_id,
  }));

  const targetFolderId = parentId || (await getRootFolderId(env, userId));
  const meta: FileMetadata = {
    id: fileId, name: filename, size: totalSize, mime_type: getMimeType(filename),
    created_at: Date.now(), updated_at: Date.now(), parent_id: targetFolderId, is_chunks: true,
    chunks: chunkInfos, telegram_file_id: recordResult.file_id, telegram_message_id: recordResult.message_id,
    user_id: userId,
  };
  await setFileMeta(env, fileId, meta);
  if (targetFolderId) await addChild(env, targetFolderId, fileId);
  return meta;
}

export async function uploadFile(
  env: Env, chatId: string, data: Blob, filename: string,
  parentId: string | null, messageThreadId?: number, userId?: number, caption?: string
): Promise<FileMetadata> {
  if (data.size <= MAX_CHUNK_SIZE) return uploadSmallFile(env, chatId, data, filename, parentId, messageThreadId, userId, caption);
  return uploadLargeFile(env, chatId, data, filename, parentId, messageThreadId, userId, caption);
}

// Upload session management
const SESSION_PREFIX = "upload_session:";
const SESSION_TTL = 3600;

export async function createUploadSession(env: Env, filename: string, totalSize: number, chunkSize: number, mimeType: string, parentId: string | null): Promise<UploadSession> {
  const session: UploadSession = {
    session_id: generateUUID(), filename, total_size: totalSize,
    chunk_size: chunkSize || MAX_CHUNK_SIZE, total_chunks: Math.ceil(totalSize / (chunkSize || MAX_CHUNK_SIZE)),
    uploaded_chunks: [], mime_type: mimeType, parent_id: parentId, created_at: Date.now(),
  };
  await env.METADATA_KV.put(`${SESSION_PREFIX}${session.session_id}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  return session;
}
export async function getUploadSession(env: Env, sessionId: string): Promise<UploadSession | null> {
  return await env.METADATA_KV.get(`${SESSION_PREFIX}${sessionId}`, "json") as UploadSession | null;
}
export async function updateUploadSession(env: Env, session: UploadSession): Promise<void> {
  await env.METADATA_KV.put(`${SESSION_PREFIX}${session.session_id}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
}
export async function deleteUploadSession(env: Env, sessionId: string): Promise<void> {
  await env.METADATA_KV.delete(`${SESSION_PREFIX}${sessionId}`);
}
