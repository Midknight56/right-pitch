-- The shared Qloo key's calls left this month, read from X-Month-RateLimit-Remaining on the last live answer.
CREATE TABLE IF NOT EXISTS qloo_quota (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  remaining INTEGER NOT NULL,
  at INTEGER NOT NULL
);
