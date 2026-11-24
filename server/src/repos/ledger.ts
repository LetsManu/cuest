import type { DatabaseSync } from 'node:sqlite';
import type { LedgerEntry } from '../domain/types.js';
import { newId } from '../clock.js';

interface Row {
  id: string;
  player_id: string;
  quest_id: string | null;
  kind: string;
  xp: number;
  gold: number;
  at: string;
  meta: string;
}

const toEntry = (r: Row): LedgerEntry => ({
  id: r.id,
  playerId: r.player_id,
  questId: r.quest_id,
  kind: r.kind as LedgerEntry['kind'],
  xp: r.xp,
  gold: r.gold,
  at: r.at,
  meta: JSON.parse(r.meta) as Record<string, unknown>,
});

export class LedgerRepo {
  constructor(private db: DatabaseSync) {}

  add(e: Omit<LedgerEntry, 'id'>): LedgerEntry {
    if ((e.gold < 0 || e.xp < 0) && e.kind !== 'purchase') throw new Error('negative ledger amounts are only allowed for purchases');
    const id = newId();
    this.db
      .prepare('INSERT INTO ledger (id, player_id, quest_id, kind, xp, gold, at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, e.playerId, e.questId, e.kind, e.xp, e.gold, e.at, JSON.stringify(e.meta));
    return { id, ...e };
  }

  listForPlayer(playerId: string): LedgerEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM ledger WHERE player_id = ? ORDER BY at, id')
      .all(playerId) as unknown as Row[];
    return rows.map(toEntry);
  }
}
