CREATE TABLE IF NOT EXISTS tickets (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL CHECK(type IN ('bug','feat','ui','other')),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  nickname        TEXT DEFAULT '',
  contact         TEXT DEFAULT '',
  is_public_reply_allowed INTEGER NOT NULL DEFAULT 0,
  context_url     TEXT DEFAULT '',
  status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','replied','closed')),
  admin_reply     TEXT DEFAULT '',
  replied_at      TEXT,
  submitted_at    TEXT DEFAULT (datetime('now')),
  closed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_public_replied ON tickets(is_public_reply_allowed, status);
