-- History table for BananaPod generated media (image/video)
-- D1 (SQLite) migration 0001

CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('image','video')),
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  extra_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_user_created ON history(user_key, created_at DESC);


