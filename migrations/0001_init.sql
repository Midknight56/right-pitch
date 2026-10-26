CREATE TABLE IF NOT EXISTS qloo_cache (
  key TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Built quizzes, kept so a host can open a room from one and a judge can open the same link.
CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  quiz TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- A setup built before answers from here with no Qloo or model call. The six presets are recorded here once, live.
CREATE TABLE IF NOT EXISTS run_cache (
  key TEXT PRIMARY KEY,
  events TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- What a host has used, so next week's quiz does not repeat it (filter.exclude.entities). host is a salted hash.
CREATE TABLE IF NOT EXISTS host_history (
  host TEXT NOT NULL,
  qloo_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  PRIMARY KEY (host, qloo_id)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz TEXT NOT NULL,
  question TEXT NOT NULL,
  why TEXT NOT NULL,
  at INTEGER NOT NULL
);

-- The same shape as the shared hackathon-ledger's table, used when that database is not bound.
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  neurons REAL NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ai_calls_day ON ai_calls(day, app);
