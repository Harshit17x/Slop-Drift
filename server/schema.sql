-- Slop Drift D1 schema. Idempotent: safe to run again.
--   local:  npx wrangler d1 execute slop-drift --local  --file=schema.sql
--   remote: npx wrangler d1 execute slop-drift --remote --file=schema.sql

-- One row per player id that has claimed a token. last_submit_at enforces 1 submission / 10 s.
CREATE TABLE IF NOT EXISTS players (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  last_submit_at INTEGER NOT NULL DEFAULT 0
);

-- Each player's best run per event. time for timed events (seconds, lower is better), score for drift.
-- ghost is the base64 replay from src/ghost/ghostCodec.js (<= 64 KiB), only for the best run.
CREATE TABLE IF NOT EXISTS scores (
  mode      TEXT NOT NULL,
  player_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  level     INTEGER NOT NULL DEFAULT 1,
  time      REAL,
  score     REAL,
  ghost     TEXT,
  at        INTEGER NOT NULL,
  PRIMARY KEY (mode, player_id)
);

-- Leaderboard reads walk these indexes, so a top-50 read costs ~50 rows, not the whole table.
CREATE INDEX IF NOT EXISTS scores_by_time  ON scores (mode, time);
CREATE INDEX IF NOT EXISTS scores_by_score ON scores (mode, score DESC);
