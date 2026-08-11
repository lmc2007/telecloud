import type { Env } from "../types";
import { retryWithBackoff } from "../utils/common";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * Telegram Bot API 服务封装
 * 用于多用户路由（auth/files/shares）
 */
export class TelegramService {
  private token: string;
  private channelId: string;
  private apiBase: string;

  constructor(env: Env) {
    this.token = env.TELEGRAM_BOT_TOKEN;
    this.channelId = env.TELEGRAM_CHANNEL_ID || env.STORAGE_CHAT_ID || "";
    this.apiBase = `${TELEGRAM_API_BASE}/bot${this.token}`;
  }

  /**
   * 创建论坛话题
   */
  async createForumTopic(name: string): Promise<number> {
    const result = await retryWithBackoff(async () => {
      const res = await fetch(`${this.apiBase}/createForumTopic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.channelId, name }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        result?: { message_thread_id: number };
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (!json.ok) {
        const err = new Error(
          json.description || "createForumTopic failed"
        ) as Error & { parameters?: { retry_after?: number } };
        if (json.parameters) err.parameters = json.parameters;
        throw err;
      }
      return json.result!;
    });
    return result.message_thread_id;
  }

  /**
   * 发送文件
   */
  async sendDocument(
    fileData: ArrayBuffer,
    fileName: string,
    caption?: string,
    threadId?: number | null
  ): Promise<{ message_id: number; file_id: string }> {
    // Strip .gif extension to prevent Telegram from converting to animation
    let uploadName = fileName;
    if (fileName.toLowerCase().endsWith(".gif")) {
      uploadName = fileName.substring(0, fileName.lastIndexOf(".gif"));
    }

    const result = await retryWithBackoff(async () => {
      const formData = new FormData();
      formData.append("chat_id", this.channelId);
      formData.append(
        "document",
        new Blob([fileData]),
        uploadName
      );
      formData.append("disable_content_type_detection", "true");
      if (caption) formData.append("caption", caption);
      if (threadId)
        formData.append("message_thread_id", String(threadId));

      const res = await fetch(`${this.apiBase}/sendDocument`, {
        method: "POST",
        body: formData,
      });
      const json = (await res.json()) as {
        ok: boolean;
        result?: {
          message_id: number;
          document?: { file_id: string };
        };
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (!json.ok) {
        const err = new Error(
          `sendDocument failed: ${json.description}`
        ) as Error & { parameters?: { retry_after?: number } };
        if (json.parameters) err.parameters = json.parameters;
        throw err;
      }
      return json.result!;
    });

    return {
      message_id: result.message_id,
      file_id: result.document?.file_id || "",
    };
  }

  /**
   * 获取文件信息
   */
  async getFile(
    fileId: string
  ): Promise<{ file_id: string; file_path?: string; file_size?: number }> {
    const result = await retryWithBackoff(async () => {
      const res = await fetch(
        `${this.apiBase}/getFile?file_id=${encodeURIComponent(fileId)}`
      );
      const json = (await res.json()) as {
        ok: boolean;
        result?: {
          file_id: string;
          file_path?: string;
          file_size?: number;
        };
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (!json.ok) {
        const err = new Error(
          `getFile failed: ${json.description}`
        ) as Error & { parameters?: { retry_after?: number } };
        if (json.parameters) err.parameters = json.parameters;
        throw err;
      }
      return json.result!;
    });
    return result;
  }

  getFileDownloadUrl(filePath: string): string {
    return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
  }

  /**
   * 回复消息
   */
  async replyToMessage(
    messageId: number,
    text: string
  ): Promise<boolean> {
    const res = await fetch(`${this.apiBase}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.channelId,
        text,
        reply_to_message_id: messageId,
      }),
    });
    const json = (await res.json()) as { ok: boolean };
    return json.ok;
  }

  /**
   * 删除消息
   */
  async deleteMessage(messageId: number): Promise<boolean> {
    const res = await fetch(`${this.apiBase}/deleteMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.channelId,
        message_id: messageId,
      }),
    });
    const json = (await res.json()) as { ok: boolean };
    return json.ok;
  }
}
