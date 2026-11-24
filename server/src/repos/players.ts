import type { DatabaseSync } from 'node:sqlite';
import type { Player } from '../domain/types.js';
import { newId } from '../clock.js';
import { ShopError } from '../services/shop.js';

interface Row {
  id: string;
  name: string;
  ha_person: string | null;
  notify_service: string | null;
  xp: number;
  gold: number;
  rest_tokens: number;
  boost_until: string | null;
  created_at: string;
}

const toPlayer = (r: Row): Player => ({
  id: r.id,
  name: r.name,
  haPerson: r.ha_person,
  notifyService: r.notify_service,
  xp: r.xp,
  gold: r.gold,
  restTokens: r.rest_tokens,
  boostUntil: r.boost_until,
  createdAt: r.created_at,
});

export class PlayersRepo {
  constructor(private db: DatabaseSync) {}

  create(p: { name: string; haPerson?: string | null; notifyService?: string | null }, now: Date): Player {
    const id = newId();
    this.db
      .prepare(
        'INSERT INTO players (id, name, ha_person, notify_service, xp, gold, created_at) VALUES (?, ?, ?, ?, 0, 0, ?)',
      )
      .run(id, p.name, p.haPerson ?? null, p.notifyService ?? null, now.toISOString());
    return this.get(id) as Player;
  }

  get(id: string): Player | null {
    const r = this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Row | undefined;
    return r ? toPlayer(r) : null;
  }

  list(): Player[] {
    const rows = this.db.prepare('SELECT * FROM players ORDER BY created_at, id').all() as unknown as Row[];
    return rows.map(toPlayer);
  }

  update(id: string, patch: Partial<Pick<Player, 'name' | 'haPerson' | 'notifyService'>>): Player | null {
    const cur = this.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.db
      .prepare('UPDATE players SET name = ?, ha_person = ?, notify_service = ? WHERE id = ?')
      .run(next.name, next.haPerson, next.notifyService, id);
    return this.get(id);
  }

  addRewards(id: string, xp: number, gold: number): Player {
    if (xp < 0 || gold < 0) throw new Error('rewards must not be negative');
    const res = this.db.prepare('UPDATE players SET xp = xp + ?, gold = gold + ? WHERE id = ?').run(xp, gold, id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return this.get(id) as Player;
  }

  spendGold(id: string, amount: number): Player {
    if (!Number.isInteger(amount) || amount < 0) throw new Error('amount must be a non-negative integer');
    const res = this.db.prepare('UPDATE players SET gold = gold - ? WHERE id = ? AND gold >= ?').run(amount, id, amount);
    if (res.changes === 0) {
      if (!this.get(id)) throw new ShopError('unknown_player');
      throw new ShopError('not_enough_gold');
    }
    return this.get(id) as Player;
  }

  addRestTokens(id: string, n: number): Player {
    if (n < 0) throw new Error('tokens must not be negative');
    const res = this.db.prepare('UPDATE players SET rest_tokens = rest_tokens + ? WHERE id = ?').run(n, id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return this.get(id) as Player;
  }

  setBoostUntil(id: string, iso: string | null): Player {
    const res = this.db.prepare('UPDATE players SET boost_until = ? WHERE id = ?').run(iso, id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return this.get(id) as Player;
  }
}
