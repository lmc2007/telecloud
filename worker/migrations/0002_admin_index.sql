-- Migration 0002: D1 admin index tables (KV remains System of Record)
-- Run this in Cloudflare D1 console or via wrangler d1 execute

-- Drop old empty files table and recreate with kv_id as PK
DROP TABLE IF EXISTS files;

CREATE TABLE files (
  kv_id         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_kv_id  TEXT,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('file', 'folder')),
  size          INTEGER DEFAULT 0,
  mime_type     TEXT,
  is_chunks     INTEGER DEFAULT 0,
  is_starred    INTEGER DEFAULT 0,
  deleted       INTEGER DEFAULT 0,
  deleted_at    TEXT,
  created_at    TEXT,
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_files_user ON files(user_id, deleted);
CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_kv_id);
CREATE INDEX IF NOT EXISTS idx_files_type ON files(type, deleted);

-- Starred files (sync from KV star:*)
CREATE TABLE IF NOT EXISTS starred (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_kv_id TEXT NOT NULL,
  PRIMARY KEY (user_id, file_kv_id)
);

-- Shares index (existing table, just better index)
CREATE INDEX IF NOT EXISTS idx_shares_file_kv ON shares(file_id);
