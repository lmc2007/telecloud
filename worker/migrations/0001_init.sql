-- Migration 0001: Initial schema — users, files, shares, upload_sessions
-- Run this in Cloudflare D1 console or via wrangler:
-- wrangler d1 execute tgdrive-db --remote --file=migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  storage_used  INTEGER DEFAULT 0,
  tg_thread_id  INTEGER DEFAULT NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id       INTEGER REFERENCES files(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('file', 'folder')),
  size            INTEGER DEFAULT 0,
  mime_type       TEXT,
  hash            TEXT,
  tg_message_ids  TEXT,
  tg_file_ids     TEXT,
  chunk_count     INTEGER DEFAULT 1,
  is_starred      INTEGER DEFAULT 0,
  deleted         INTEGER DEFAULT 0,
  deleted_at      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_parent ON files(user_id, parent_id, deleted);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(hash);
CREATE INDEX IF NOT EXISTS idx_files_name ON files(user_id, parent_id, name);

CREATE TABLE IF NOT EXISTS shares (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id         TEXT NOT NULL,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token           TEXT UNIQUE NOT NULL,
  password        TEXT,
  expire_at       TEXT,
  download_count  INTEGER DEFAULT 0,
  max_downloads   INTEGER,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shares_token ON shares(token);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id              TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name       TEXT NOT NULL,
  parent_id       TEXT,
  total_size      INTEGER NOT NULL,
  chunk_size      INTEGER NOT NULL,
  total_chunks    INTEGER NOT NULL,
  uploaded_chunks TEXT DEFAULT '[]',
  tg_message_ids  TEXT DEFAULT '[]',
  tg_file_ids     TEXT DEFAULT '[]',
  status          TEXT DEFAULT 'uploading' CHECK(status IN ('uploading', 'completed', 'expired')),
  created_at      TEXT DEFAULT (datetime('now')),
  expire_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_user ON upload_sessions(user_id, status);
