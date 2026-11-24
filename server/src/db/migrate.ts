import type { DatabaseSync } from 'node:sqlite';

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ha_person TEXT,
    notify_service TEXT,
    xp INTEGER NOT NULL DEFAULT 0,
    gold INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE quest_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    energy TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    gold INTEGER NOT NULL,
    source TEXT NOT NULL,
    rule TEXT,
    schedule TEXT,
    nudge TEXT NOT NULL,
    whenever_after_hours INTEGER NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_spawned_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE quests (
    id TEXT PRIMARY KEY,
    template_id TEXT REFERENCES quest_templates(id),
    title TEXT NOT NULL,
    energy TEXT NOT NULL,
    minutes INTEGER NOT NULL,
    xp INTEGER NOT NULL,
    gold INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    whenever_after_hours INTEGER NOT NULL,
    claimed_by TEXT REFERENCES players(id),
    started_at TEXT,
    done_at TEXT,
    done_by TEXT REFERENCES players(id),
    whenever_at TEXT,
    snoozed_until TEXT,
    nudge_count INTEGER NOT NULL DEFAULT 0,
    last_nudge_at TEXT
  );
  CREATE INDEX idx_quests_status ON quests(status);
  CREATE INDEX idx_quests_template ON quests(template_id);
  CREATE TABLE ledger (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    quest_id TEXT REFERENCES quests(id),
    kind TEXT NOT NULL,
    xp INTEGER NOT NULL,
    gold INTEGER NOT NULL,
    at TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX idx_ledger_player ON ledger(player_id);
  `,
  `
  ALTER TABLE players ADD COLUMN rest_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN boost_until TEXT;
  CREATE TABLE player_items (
    player_id TEXT REFERENCES players(id),
    item_id TEXT,
    count INTEGER NOT NULL,
    PRIMARY KEY (player_id, item_id)
  );
  CREATE TABLE equipped (
    player_id TEXT REFERENCES players(id),
    slot TEXT,
    item_id TEXT NOT NULL,
    PRIMARY KEY (player_id, slot)
  );
  `,
  `
  CREATE TABLE unlocks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    cost INTEGER NOT NULL,
    entity_id TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE players ADD COLUMN combo_count INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN last_done_at TEXT;
  `,
  `
  CREATE TABLE daily (
    date TEXT PRIMARY KEY,
    quest_id TEXT
  );
  ALTER TABLE players ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN best_streak INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN last_streak_day TEXT;
  ALTER TABLE players ADD COLUMN rest_week TEXT;
  `,
  `
  ALTER TABLE players ADD COLUMN chest_keys INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN done_count INTEGER NOT NULL DEFAULT 0;
  `,
  `
  CREATE TABLE sprints (
    id TEXT PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id),
    minutes INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    logs INTEGER NOT NULL DEFAULT 0,
    xp INTEGER
  );
  CREATE INDEX idx_sprints_player ON sprints(player_id, ended_at);
  CREATE UNIQUE INDEX sprints_one_active ON sprints(player_id) WHERE ended_at IS NULL;
  `,
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i] as string);
      db.prepare('DELETE FROM schema_version').run();
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
