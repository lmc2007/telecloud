// ============================
// Environment bindings
// ============================

export interface Env {
  // KV (existing)
  METADATA_KV: KVNamespace;

  // D1 (new — for users/shares/upload_sessions)
  DB: D1Database;

  // Telegram
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHANNEL_ID: string;
  WEBHOOK_SECRET: string;

  // Auth
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  ADMIN_PASSWORD: string;

  // Deprecated env vars (kept for backwards compat)
  STORAGE_CHAT_ID?: string;
  WEB_PASSWORD?: string;
  COOKIE_SECRET?: string;
  CHUNK_SIZE?: string;

  // Misc
  ENVIRONMENT?: string;
}

// ============================
// Database models (D1)
// ============================

export interface User {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  avatar_url: string | null;
  storage_used: number;
  tg_thread_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: number;
  user_id: number;
  parent_id: number | null;
  name: string;
  type: "file" | "folder";
  size: number;
  mime_type: string | null;
  hash: string | null;
  tg_message_ids: string | null; // JSON array
  tg_file_ids: string | null; // JSON array
  chunk_count: number;
  deleted: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShareRecord {
  id: number;
  file_id: number;
  user_id: number;
  token: string;
  password: string | null;
  expire_at: string | null;
  download_count: number;
  max_downloads: number | null;
  created_at: string;
}

export interface D1UploadSession {
  id: string;
  user_id: number;
  file_name: string;
  parent_id: number | null;
  total_size: number;
  chunk_size: number;
  total_chunks: number;
  uploaded_chunks: string; // JSON array
  tg_message_ids: string; // JSON array
  tg_file_ids: string; // JSON array
  status: "uploading" | "completed" | "expired";
  created_at: string;
  expire_at: string | null;
}

export interface UploadSession {
  session_id: string;
  filename: string;
  total_size: number;
  chunk_size: number;
  total_chunks: number;
  uploaded_chunks: number[];
  mime_type: string;
  parent_id: string | null;
  created_at: number;
}

// ============================
// JWT
// ============================

export interface JwtPayload {
  sub: number; // user id
  username: string;
  type: "access" | "refresh" | "preview";
  iat?: number;
  exp?: number;
}

export interface PreviewJwtPayload {
  sub: number;        // user id
  type: "preview";
  file_id: string;    // the file to stream
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// ============================
// API request/response
// ============================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

// ============================
// Chunk & file metadata (KV-based, retained from original)
// ============================

export interface ChunkInfo {
  index: number;
  size: number;
  telegram_file_id: string;
  telegram_message_id: number;
  file_path?: string;
}

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  created_at: number;
  updated_at: number;
  parent_id: string | null;
  is_chunks: boolean;
  chunks?: ChunkInfo[];
  telegram_file_id?: string;
  telegram_message_id?: number;
  hash?: string;
  user_id?: number; // new: multi-user isolation
}

export interface BigFileInfo {
  fileName: string;
  fileSize: number;
  fileIds: string[];
  recordFile: boolean;
}

export interface FolderMetadata {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
  updated_at: number;
  topic_id?: number;
  path: string;
  child_count: number;
  user_id?: number; // new: multi-user isolation
}

export interface ShareInfo {
  token: string;
  target_type: "file" | "folder";
  target_id: string;
  created_at: number;
  expires_at?: number;
  max_downloads?: number;
  download_count: number;
  password?: string;
  creator_id: string;
}

export interface SessionData {
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface PathMapping {
  type: "file" | "folder";
  id: string;
}

export interface RootConfig {
  initialized: boolean;
  root_folder_id: string;
  default_topic_id?: number;
}

// ============================
// File list types
// ============================

export interface FileItem {
  id: string;
  name: string;
  size: number;
  size_formatted: string;
  mime_type: string;
  type: "file";
  is_chunks: boolean;
  created_at: number;
  download_url: string;
}

export interface FolderItem {
  id: string;
  name: string;
  type: "folder";
  child_count: number;
  created_at: number;
  path: string;
}

export type DirEntry = FileItem | FolderItem;

export interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

// ============================
// Telegram API types
// ============================

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat?: { id: number };
  message_thread_id?: number;
  document?: {
    file_id: string;
    file_unique_id: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
  };
  video?: {
    file_id: string;
    file_unique_id: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
  };
  photo?: {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
  }[];
}

export interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: {
    retry_after?: number;
  };
}

export interface TelegramForumTopic {
  message_thread_id: number;
  name: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
}
