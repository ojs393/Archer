import type { DatabaseSync } from "node:sqlite";
import { transaction } from "./transaction.ts";

const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE lists (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    source_label TEXT NOT NULL,
    consent_text TEXT NOT NULL,
    consent_at TEXT NOT NULL,
    exclude_roles INTEGER NOT NULL DEFAULT 1,
    email_column TEXT,
    status TEXT NOT NULL DEFAULT 'importing' CHECK (status IN ('importing','ready','failed')),
    total_rows INTEGER NOT NULL DEFAULT 0,
    valid_count INTEGER NOT NULL DEFAULT 0,
    invalid_count INTEGER NOT NULL DEFAULT 0,
    duplicate_count INTEGER NOT NULL DEFAULT 0,
    suppressed_count INTEGER NOT NULL DEFAULT 0,
    role_count INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    domain TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE (list_id, email)
  );
  CREATE INDEX contacts_list_domain ON contacts (list_id, domain);

  CREATE TABLE suppression (
    email TEXT PRIMARY KEY,
    reason TEXT NOT NULL CHECK (reason IN ('unsubscribe','hard_bounce','manual','complaint')),
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    subject TEXT NOT NULL,
    html TEXT NOT NULL,
    text TEXT,
    variable_map_json TEXT NOT NULL DEFAULT '{}',
    link_check_json TEXT,
    last_test_ok_version INTEGER,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE campaigns (
    id INTEGER PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES lists(id),
    template_id INTEGER NOT NULL REFERENCES templates(id),
    template_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN
      ('draft','running','paused','waiting_window','waiting_network','safety_stop','completed','stopped')),
    pause_reason TEXT,
    schedule_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE sends (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN
      ('pending','sending','sent','retry','failed','uncertain','skipped_suppressed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    smtp_response TEXT,
    message_id TEXT,
    updated_at TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (campaign_id, contact_id)
  );
  CREATE INDEX sends_campaign_state_next ON sends (campaign_id, state, next_attempt_at);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    campaign_id INTEGER,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX events_campaign_id ON events (campaign_id, id);
  `,
  `
  CREATE TABLE campaign_days (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    sent INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (campaign_id, day)
  );
  CREATE INDEX sends_campaign_state_contact ON sends (campaign_id, state, contact_id);
  `,
  `
  CREATE INDEX contacts_list_id ON contacts (list_id, id);
  `,
  // The provider setting defaults to Amazon SES; an install that already configured a generic SMTP host keeps it.
  `
  INSERT OR IGNORE INTO settings (key, value)
  SELECT 'provider', 'smtp' WHERE EXISTS (SELECT 1 FROM settings WHERE key = 'smtp_host' AND value <> '');
  `,
  `
  CREATE INDEX events_type_created ON events (type, created_at);
  `,
  // Opaque unsubscribe tokens (email stays in the DB; URLs carry only id + HMAC).
  `
  CREATE TABLE unsubscribe_tokens (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX unsubscribe_tokens_email ON unsubscribe_tokens (email);
  `,
  // SES → SNS bounce/complaint ingest (public POST /sns).
  `
  CREATE TABLE feedback_events (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('bounce', 'complaint')),
    email TEXT NOT NULL,
    detail TEXT,
    message_id TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX feedback_events_kind_created ON feedback_events (kind, created_at);
  `,
  // Operator labels + optional campaign title (audience/runs filter & rename).
  `
  ALTER TABLE campaigns ADD COLUMN title TEXT;

  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    color TEXT
  );

  CREATE TABLE list_tags (
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (list_id, tag_id)
  );

  CREATE TABLE campaign_tags (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, tag_id)
  );

  CREATE INDEX list_tags_tag ON list_tags (tag_id, list_id);
  CREATE INDEX campaign_tags_tag ON campaign_tags (tag_id, campaign_id);
  `,
  // Multi-step send chains: ordered templates on one list; campaigns may point at a step.
  `
  CREATE TABLE chains (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    list_id INTEGER NOT NULL REFERENCES lists(id),
    schedule_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE chain_steps (
    chain_id INTEGER NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    template_id INTEGER NOT NULL REFERENCES templates(id),
    delay_hours INTEGER NOT NULL DEFAULT 0 CHECK (delay_hours >= 0),
    PRIMARY KEY (chain_id, position)
  );

  ALTER TABLE campaigns ADD COLUMN chain_id INTEGER REFERENCES chains(id) ON DELETE SET NULL;
  ALTER TABLE campaigns ADD COLUMN chain_step INTEGER;
  CREATE INDEX campaigns_chain ON campaigns (chain_id, chain_step);
  `,
];

export function runMigrations(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT ${NOW}
  )`);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  MIGRATIONS.forEach((sql, i) => {
    const version = i + 1;
    if (applied.has(version)) return;
    transaction(db, () => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(version);
    });
  });
}
