-- Jev calls per UTC day, capped by DAILY_CALL_LIMIT. input_tokens sums each call's reported
-- usage.input_tokens, and token_calls counts the calls that reported it, so the rest of a day's
-- calls can be priced as estimates instead of taking a partial total as exact.
CREATE TABLE usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  token_calls INTEGER NOT NULL DEFAULT 0
);

-- Jev calls per signed session cookie, capped by SESSION_CALL_LIMIT. exp is in unix seconds.
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  calls INTEGER NOT NULL,
  exp INTEGER NOT NULL
);

-- Jev calls per client per UTC day, capped by CLIENT_DAILY_CALL_LIMIT. key is an HMAC of the
-- client IP and the day under SESSION_SECRET, so no IP is stored and the key changes every day.
CREATE TABLE clients (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL
);

-- forgetExpired deletes by these columns. Unindexed, each cleanup scans and bills every row.
CREATE INDEX sessions_exp ON sessions (exp);
CREATE INDEX clients_day ON clients (day);
