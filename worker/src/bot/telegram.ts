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
 *
 * CPU safety: for payloads > STREAM_THRESHOLD the multipart body is built as a
 * ReadableStream and sent with duplex:"half". A single synchronous multipart
 * serialization of 10-15MB exceeds the Workers free-plan 10ms CPU limit and
 * kills the request ("Worker exceeded CPU time limit"). Streaming lets the
 * runtime send small chunks and reset the CPU clock on every I/O yield.
 */
export async function sendDocument(
  env: Env,
  chatId: string,
  fileData: Blob,
  filename: string,
  messageThreadId?: number,
  caption?: string
): Promise<{ message_id: number; file_id: string; file_size: number }> {
  const url = apiUrl(env, "sendDocument");
  const useStreaming = fileData.size > 2 * 1024 * 1024; // >2MB → streaming multipart
  const boundary = `----CloudDrive${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const enc = new TextEncoder();
  const safeName = filename.replace(/["\\\r\n]/g, "_");
  const safeCaption = caption ? caption.replace(/\r?\n/g, " ") : undefined;

  // Streaming multipart body — rebuilt on every retry (a stream is one-shot).
  const buildStreamingBody = (): ReadableStream<Uint8Array> =>
    new ReadableStream<Uint8Array>({
      async start(controller) {
        const push = (s: string) => controller.enqueue(enc.encode(s));
        try {
          push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`);
          push(`--${boundary}\r\nContent-Disposition: form-data; name="disable_content_type_detection"\r\n\r\ntrue\r\n`);
          if (messageThreadId) {
            push(`--${boundary}\r\nContent-Disposition: form-data; name="message_thread_id"\r\n\r\n${messageThreadId}\r\n`);
          }
          if (safeCaption) {
            push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${safeCaption}\r\n`);
          }
          push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${safeName}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
          // Stream file bytes in small chunks, yielding between chunks so the
          // CPU clock resets on every I/O — stays well under the 10ms limit.
          const CHUNK = 256 * 1024;
          for (let off = 0; off < fileData.size; off += CHUNK) {
            const slice = fileData.slice(off, Math.min(off + CHUNK, fileData.size));
            controller.enqueue(new Uint8Array(await slice.arrayBuffer()));
            await new Promise<void>(r => setTimeout(r, 0));
          }
          push(`\r\n--${boundary}--\r\n`);
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      },
    });

  const response = await retryWithBackoff(async () => {
    const res = useStreaming
      ? await fetch(url, {
          method: "POST",
          body: buildStreamingBody(),
          headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
          duplex: "half",
        } as RequestInit)
      : await fetch(url, {
          method: "POST",
          body: (() => {
            const fd = new FormData();
            fd.append("chat_id", chatId);
            fd.append("document", fileData, safeName);
            fd.append("disable_content_type_detection", "true");
            if (messageThreadId) fd.append("message_thread_id", String(messageThreadId));
            if (caption) fd.append("caption", caption);
            return fd;
          })(),
        });
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

  // DEBUG: integrity check — Telegram's stored file_size vs what we sent.
  // If Telegram stored noticeably FEWER bytes than sent, the chunk was
  // truncated server-side. Throwing here surfaces the error to the caller
  // (WS flush → client volume retry, or HTTP upload handler → request fails)
  // instead of silently storing a broken chunk.
  const tgSize = doc.file_size;
  const sentSize = fileData.size;
  if (tgSize === undefined) {
    console.warn(`[sendDocument] name="${filename}" tgSize=undefined (cannot verify integrity) sent=${sentSize}`);
  } else if (tgSize !== sentSize) {
    console.warn(`[sendDocument] SIZE MISMATCH name="${filename}" sent=${sentSize} tg=${tgSize} diff=${tgSize - sentSize}`);
    const MAX_DEVIATION = Math.max(1024, Math.floor(sentSize * 0.001)); // 1KB or 0.1%
    if (sentSize - tgSize > MAX_DEVIATION) {
      throw new Error(`sendDocument size mismatch (sent=${sentSize}, tg=${tgSize}) — treating as upload corruption`);
    }
  } else {
    console.log(`[sendDocument] ok name="${filename}" sent=${sentSize} tg=${tgSize}`);
  }

  return {
    message_id: msg.message_id,
    file_id: doc.file_id,
    file_size: tgSize || sentSize,
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
