-- One row per Atlas Recovery account. account_number is the natural key.
CREATE TABLE IF NOT EXISTS accounts (
  account_number TEXT    PRIMARY KEY,           -- trimmed + uppercased; leading zeros preserved
  debtor_name    TEXT,
  phone_number   TEXT,                          -- E.164 (+15551234567) when parseable, else as provided
  balance_cents  INTEGER NOT NULL,              -- money stored as integer cents to avoid float drift
  status         TEXT,                          -- Title Case, e.g. Active / Closed
  client_name    TEXT,
  source_file    TEXT    NOT NULL,              -- CSV that last wrote this row
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- The agent's existing lookup path is by phone number.
CREATE INDEX IF NOT EXISTS idx_accounts_phone ON accounts (phone_number);
