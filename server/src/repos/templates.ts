import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Energy, NudgeConfig, QuestTemplate, Rule, Schedule } from '../domain/types.js';
import { newId } from '../clock.js';

interface Row {
  id: string;
  title: string;
  energy: string;
  minutes: number;
  xp: number;
  gold: number;
  source: string;
  rule: string | null;
  schedule: string | null;
  nudge: string;
  whenever_after_hours: number;
  enabled: number;
  last_spawned_at: string | null;
  created_at: string;
}

const toTemplate = (r: Row): QuestTemplate => ({
  id: r.id,
  title: r.title,
  energy: r.energy as Energy,
  minutes: r.minutes,
  xp: r.xp,
  gold: r.gold,
  source: r.source as QuestTemplate['source'],
  rule: r.rule ? (JSON.parse(r.rule) as Rule) : null,
  schedule: r.schedule ? (JSON.parse(r.schedule) as Schedule) : null,
  nudge: JSON.parse(r.nudge) as NudgeConfig,
  wheneverAfterHours: r.whenever_after_hours,
  enabled: r.enabled === 1,
  lastSpawnedAt: r.last_spawned_at,
  createdAt: r.created_at,
});

const json = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

export class TemplatesRepo {
  constructor(private db: DatabaseSync) {}

  create(t: Omit<QuestTemplate, 'id' | 'createdAt' | 'lastSpawnedAt'>, now: Date): QuestTemplate {
    const id = newId();
    const iso = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO quest_templates (id, title, energy, minutes, xp, gold, source, rule, schedule, nudge,
           whenever_after_hours, enabled, last_spawned_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id, t.title, t.energy, t.minutes, t.xp, t.gold, t.source,
        json(t.rule), json(t.schedule), JSON.stringify(t.nudge),
        t.wheneverAfterHours, t.enabled ? 1 : 0, iso, iso,
      );
    return this.get(id) as QuestTemplate;
  }

  get(id: string): QuestTemplate | null {
    const r = this.db.prepare('SELECT * FROM quest_templates WHERE id = ?').get(id) as Row | undefined;
    return r ? toTemplate(r) : null;
  }

  list(opts: { enabledOnly?: boolean } = {}): QuestTemplate[] {
    const sql = `SELECT * FROM quest_templates ${opts.enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY created_at, id`;
    return (this.db.prepare(sql).all() as unknown as Row[]).map(toTemplate);
  }

  update(id: string, patch: Partial<Omit<QuestTemplate, 'id' | 'createdAt'>>): QuestTemplate | null {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    const vals: SQLInputValue[] = [
      n.title, n.energy, n.minutes, n.xp, n.gold, n.source,
      json(n.rule), json(n.schedule), JSON.stringify(n.nudge),
      n.wheneverAfterHours, n.enabled ? 1 : 0, n.lastSpawnedAt, id,
    ];
    this.db
      .prepare(
        `UPDATE quest_templates SET title = ?, energy = ?, minutes = ?, xp = ?, gold = ?, source = ?,
           rule = ?, schedule = ?, nudge = ?, whenever_after_hours = ?, enabled = ?, last_spawned_at = ?
         WHERE id = ?`,
      )
      .run(...vals);
    return this.get(id);
  }
}
