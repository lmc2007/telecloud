import type { Env, TelegramMessage } from "../types";
import { json } from "../handlers/auth";
import { deleteMessage } from "../bot/telegram";
import { getFileMeta, setFileMeta, addChild } from "../storage/kv";
import { generateUUID, getMimeType } from "../utils/common";

/**
 * Handle incoming Telegram webhook updates.
 * Supports:
 * - Bot commands (future expansion)
 * - Auto-indexing files sent directly to the storage chat
 */
export async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  // Verify webhook secret
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== env.WEBHOOK_SECRET) {
    return json({ error: "Invalid webhook secret" }, 403);
  }

  const update = (await request.json()) as {
    message?: TelegramMessage & { text?: string; caption?: string };
    callback_query?: unknown;
  };

  // Handle commands
  if (update.message?.text?.startsWith("/")) {
    return handleCommand(update.message, env);
  }

  // Handle auto-index: file sent directly to the chat
  if (update.message?.document || update.message?.video || update.message?.photo) {
    return handleAutoIndex(update.message, env);
  }

  return json({ ok: true });
}

async function handleCommand(
  message: TelegramMessage & { text?: string },
  env: Env
): Promise<Response> {
  const text = message.text || "";
  const chatId = String(message.chat?.id || "");

  if (text.startsWith("/start")) {
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "👋 欢迎使用 Telegram Cloud Drive!\n\n发送文件到群组即可自动入库。",
        }),
      }
    );
  } else if (text.startsWith("/help")) {
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "发送文件到群组即可自动入库。\n通过网页端浏览和管理文件。",
        }),
      }
    );
  }

  return json({ ok: true });
}

/**
 * Auto-index: when a file is sent directly to the storage group,
 * automatically create metadata in KV.
 */
async function handleAutoIndex(
  message: TelegramMessage & { caption?: string },
  env: Env
): Promise<Response> {
  const doc = message.document || message.video || (message.photo?.[message.photo.length - 1]);
  const telegramFileId = doc?.file_id;
  const fileName = (doc && "file_name" in doc ? (doc as unknown as { file_name: string }).file_name : undefined) || message.caption || `file_${message.message_id}`;
  const fileSize = doc?.file_size || 0;

  if (!telegramFileId) {
    return json({ ok: true });
  }

  // Get root folder
  const rootConfig = await env.METADATA_KV.get("config:root", "json") as { root_folder_id: string } | null;
  const parentId = rootConfig?.root_folder_id || null;

  const fileId = generateUUID();
  const meta = {
    id: fileId,
    name: fileName,
    size: fileSize,
    mime_type: getMimeType(fileName),
    created_at: Date.now(),
    updated_at: Date.now(),
    parent_id: parentId,
    is_chunks: false,
    telegram_file_id: telegramFileId,
    telegram_message_id: message.message_id,
  };

  await setFileMeta(env, fileId, meta);

  if (parentId) {
    await addChild(env, parentId, fileId);
  }

  console.log(`Auto-indexed file: ${fileName} (${fileId})`);

  // Send a confirmation
  await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: message.chat?.id || env.STORAGE_CHAT_ID,
        message_thread_id: message.message_thread_id,
        text: `✅ 文件 "${fileName}" 已自动入库`,
      }),
    }
  );

  return json({ ok: true });
}
