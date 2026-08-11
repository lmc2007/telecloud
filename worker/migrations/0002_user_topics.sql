-- Migration 0002: Add tg_thread_id to users for per-user forum topics
ALTER TABLE users ADD COLUMN tg_thread_id INTEGER DEFAULT NULL;
