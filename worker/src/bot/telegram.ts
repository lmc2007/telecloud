import type {
  Env,
  TelegramResponse,
  TelegramMessage,
  TelegramFile,
  TelegramForumTopic,
} from "../types";
import { retryWithBackoff } from "../utils/common";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_FILE_BASE = "https://api.telegram.org/file";

function apiUrl(env: Env, method: string): string {
  return `${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

function fileUrl(env: Env, filePath: string): string {
  return `${TELEGRAM_FILE_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
}

// ==============================
// File upload
// ==============================

/**
 * Upload a document to a Telegram chat.
 * Uses multipart/form-data with sendDocument API.
 */
export async function sendDocument(
  env: Env,
  chatId: string,
  fileData: Blob,
  filename: string,
  messageThreadId?: number,
  caption?: string
): Promise<{ message_id: number; file_id: string; file_size: number }> {
  const formData = new FormData();
  formData.append("chat_id", chatId);
  formData.append("document", fileData, filename);
  formData.append("disable_content_type_detection", "true");
  if (messageThreadId) {
    formData.append("message_thread_id", String(messageThreadId));
  }
  if (caption) {
    formData.append("caption", caption);
  }

  const url = apiUrl(env, "sendDocument");
  const response = await retryWithBackoff(async () => {
    const res = await fetch(url, { method: "POST", body: formData });
    const json = (await res.json()) as TelegramResponse<TelegramMessage>;
    if (!json.ok) {
      const err = new Error(json.description || "sendDocument failed") as Error & {
        parameters?: { retry_after?: number };
      };
      if (json.parameters) err.parameters = json.parameters;
      throw err;
    }
    // Validate that the response has a valid file_id before accepting it.
    // If file_id is empty/undefined, throw so retryWithBackoff retries.
    const doc = (json.result as TelegramMessage)?.document || (json.result as TelegramMessage)?.video;
    if (!doc || !doc.file_id) {
      throw new Error("sendDocument returned empty file_id — retrying");
    }
    return json;
  }, 3, 1000);

  const msg = response.result!;
  const doc = msg.document || msg.video;
  if (!doc || !doc.file_id) {
    throw new Error("sendDocument: exhausted retries with empty file_id");
  }

  return {
    message_id: msg.message_id,
    file_id: doc.file_id,
    file_size: doc.file_size || fileData.size,
  };
}

/**
 * Upload a document from a ReadableStream (for small files).
 */
export async function sendDocumentFromStream(
  env: Env,
  chatId: string,
  stream: ReadableStream<Uint8Array>,
  filename: string,
  messageThreadId?: number
): Promise<{ message_id: number; file_id: string; file_size: number }> {
  // Read entire stream into buffer (Cloudflare Workers have memory limits)
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalSize += value.length;
  }
  const buffer = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return sendDocument(env, chatId, new Blob([buffer]), filename, messageThreadId);
}

// ==============================
// File download
// ==============================

/**
 * Get file metadata from Telegram.
 */
export async function getFile(env: Env, fileId: string): Promise<TelegramFile> {
  const url = apiUrl(env, "getFile") + `?file_id=${encodeURIComponent(fileId)}`;
  const response = await retryWithBackoff(async () => {
    const res = await fetch(url);
    const json = (await res.json()) as TelegramResponse<{ file_id: string; file_unique_id: string; file_size?: number; file_path?: string }>;
    if (!json.ok) {
      const err = new Error(json.description || "getFile failed") as Error & {
        parameters?: { retry_after?: number };
      };
      if (json.parameters) err.parameters = json.parameters;
      throw err;
    }
    return json;
  });
  return response.result!;
}

/**
 * Download a file from Telegram CDN as a ReadableStream.
 * This is used for files UNDER 20MB. For larger files, use chunked download.
 */
export async function getFileStream(env: Env, filePath: string): Promise<Response> {
  const url = fileUrl(env, filePath);
  return fetch(url);
}

/**
 * Download a file as an ArrayBuffer (for small files, like record files).
 */
export async function getFileBytes(env: Env, filePath: string): Promise<ArrayBuffer> {
  const response = await getFileStream(env, filePath);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }
  return response.arrayBuffer();
}

// ==============================
// Message management
// ==============================

/**
 * Delete a message from a chat.
 */
export async function deleteMessage(
  env: Env,
  chatId: string,
  messageId: number
): Promise<boolean> {
  const url = apiUrl(env, "deleteMessage");
  const body = JSON.stringify({ chat_id: chatId, message_id: messageId });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = (await response.json()) as TelegramResponse;
  return json.ok;
}

/**
 * Delete multiple messages from a chat.
 */
export async function deleteMessages(
  env: Env,
  chatId: string,
  messageIds: number[]
): Promise<boolean> {
  const url = apiUrl(env, "deleteMessages");
  const body = JSON.stringify({ chat_id: chatId, message_ids: messageIds });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const json = (await response.json()) as TelegramResponse;
  return json.ok;
}

/**
 * Edit the caption of a document message.
 */
export async function editMessageCaption(
  env: Env,
  chatId: string,
  messageId: number,
  caption: string
): Promise<boolean> {
  const url = apiUrl(env, "editMessageCaption");
  const body = JSON.stringify({
    chat_id: chatId,
    message_id: messageId,
    caption,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return ((await response.json()) as TelegramResponse).ok;
}

// ==============================
// Forum Topic management
// ==============================

/**
 * Create a forum topic (acts as a top-level folder).
 */
export async function createForumTopic(
  env: Env,
  chatId: string,
  name: string
): Promise<TelegramForumTopic> {
  const url = apiUrl(env, "createForumTopic");
  const body = JSON.stringify({
    chat_id: chatId,
    name,
  });
  const response = await retryWithBackoff(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const json = (await res.json()) as TelegramResponse<TelegramForumTopic>;
    if (!json.ok) throw new Error(json.description || "createForumTopic failed");
    return json;
  });
  return response.result!;
}

/**
 * Edit (rename) a forum topic.
 */
export async function editForumTopic(
  env: Env,
  chatId: string,
  messageThreadId: number,
  name: string
): Promise<boolean> {
  const url = apiUrl(env, "editForumTopic");
  const body = JSON.stringify({
    chat_id: chatId,
    message_thread_id: messageThreadId,
    name,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return ((await response.json()) as TelegramResponse).ok;
}

/**
 * Delete a forum topic (deletes ALL messages in it).
 */
export async function deleteForumTopic(
  env: Env,
  chatId: string,
  messageThreadId: number
): Promise<boolean> {
  const url = apiUrl(env, "deleteForumTopic");
  const body = JSON.stringify({
    chat_id: chatId,
    message_thread_id: messageThreadId,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return ((await response.json()) as TelegramResponse).ok;
}
