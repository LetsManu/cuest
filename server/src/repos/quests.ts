import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Energy, Quest, QuestSource, QuestStatus } from '../domain/types.js';

interface Row {
  id: string;
  template_id: string | null;
  title: string;
  energy: string;
  minutes: number;
  xp: number;
  gold: number;
  status: string;
  created_at: string;
  whenever_after_hours: number;
  claimed_by: string | null;
  started_at: string | null;
  done_at: string | null;
  done_by: string | null;
  whenever_at: string | null;
  snoozed_until: string | null;
  nudge_count: number;
  last_nudge_at: string | null;
  source: string | null;
}

const toQuest = (r: Row): Quest => ({
  id: r.id,
  templateId: r.template_id,
  title: r.title,
  energy: r.energy as Energy,
  minutes: r.minutes,
  xp: r.xp,
  gold: r.gold,
  status: r.status as QuestStatus,
  createdAt: r.created_at,
  wheneverAfterHours: r.whenever_after_hours,
  claimedBy: r.claimed_by,
  startedAt: r.started_at,
  doneAt: r.done_at,
  doneBy: r.done_by,
  wheneverAt: r.whenever_at,
  snoozedUntil: r.snoozed_until,
  nudgeCount: r.nudge_count,
  lastNudgeAt: r.last_nudge_at,
  source: (r.source as QuestSource | null) ?? null,
});

const values = (q: Quest): SQLInputValue[] => [
  q.id, q.templateId, q.title, q.energy, q.minutes, q.xp, q.gold, q.status, q.createdAt,
  q.wheneverAfterHours, q.claimedBy, q.startedAt, q.doneAt, q.doneBy, q.wheneverAt,
  q.snoozedUntil, q.nudgeCount, q.lastNudgeAt, q.source ?? null,
];

export class QuestsRepo {
  constructor(private db: DatabaseSync) {}

  insert(q: Quest): void {
    this.db
      .prepare(
        `INSERT INTO quests (id, template_id, title, energy, minutes, xp, gold, status, created_at,
           whenever_after_hours, claimed_by, started_at, done_at, done_by, whenever_at,
           snoozed_until, nudge_count, last_nudge_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...values(q));
  }

  get(id: string): Quest | null {
    const r = this.db.prepare('SELECT * FROM quests WHERE id = ?').get(id) as Row | undefined;
    return r ? toQuest(r) : null;
  }

  update(id: string, patch: Partial<Quest>): Quest {
    const cur = this.get(id);
    if (!cur) throw new Error(`unknown quest ${id}`);
    const n: Quest = { ...cur, ...patch, id };
    this.db
      .prepare(
        `UPDATE quests SET id = ?, template_id = ?, title = ?, energy = ?, minutes = ?, xp = ?, gold = ?,
           status = ?, created_at = ?, whenever_after_hours = ?, claimed_by = ?, started_at = ?,
           done_at = ?, done_by = ?, whenever_at = ?, snoozed_until = ?, nudge_count = ?, last_nudge_at = ?,
           source = ?
         WHERE id = ?`,
      )
      .run(...values(n), id);
    return this.get(id) as Quest;
  }

  listByStatus(statuses: QuestStatus[]): Quest[] {
    if (statuses.length === 0) return [];
    const marks = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM quests WHERE status IN (${marks}) ORDER BY created_at, id`)
      .all(...statuses) as unknown as Row[];
    return rows.map(toQuest);
  }

  findLiveByTemplate(templateId: string): Quest | null {
    const r = this.db
      .prepare(
        `SELECT * FROM quests WHERE template_id = ? AND status IN ('open', 'active', 'whenever')
         ORDER BY created_at, id LIMIT 1`,
      )
      .get(templateId) as Row | undefined;
    return r ? toQuest(r) : null;
  }
}
