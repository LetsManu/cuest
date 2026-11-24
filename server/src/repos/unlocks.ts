import type { DatabaseSync } from 'node:sqlite';
import { newId } from '../clock.js';

export interface Unlock {
  id: string;
  name: string;
  cost: number;
  entityId: string;
  enabled: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  name: string;
  cost: number;
  entity_id: string;
  enabled: number;
  created_at: string;
}

const toUnlock = (r: Row): Unlock => ({
  id: r.id,
  name: r.name,
  cost: r.cost,
  entityId: r.entity_id,
  enabled: r.enabled === 1,
  createdAt: r.created_at,
});

/** Owner-configured house treats. Never deleted, only disabled. */
export class UnlocksRepo {
  constructor(private db: DatabaseSync) {}

  create(u: { name: string; cost: number; entityId: string }, now: Date): Unlock {
    const id = newId();
    this.db
      .prepare('INSERT INTO unlocks (id, name, cost, entity_id, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .run(id, u.name, u.cost, u.entityId, now.toISOString());
    return this.get(id) as Unlock;
  }

  get(id: string): Unlock | null {
    const r = this.db.prepare('SELECT * FROM unlocks WHERE id = ?').get(id) as Row | undefined;
    return r ? toUnlock(r) : null;
  }

  list(opts: { enabledOnly?: boolean } = {}): Unlock[] {
    const sql = `SELECT * FROM unlocks ${opts.enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY created_at, id`;
    return (this.db.prepare(sql).all() as unknown as Row[]).map(toUnlock);
  }

  update(id: string, patch: Partial<Pick<Unlock, 'name' | 'cost' | 'entityId' | 'enabled'>>): Unlock | null {
    const cur = this.get(id);
    if (!cur) return null;
    const n = { ...cur, ...patch };
    this.db
      .prepare('UPDATE unlocks SET name = ?, cost = ?, entity_id = ?, enabled = ? WHERE id = ?')
      .run(n.name, n.cost, n.entityId, n.enabled ? 1 : 0, id);
    return this.get(id);
  }
}
