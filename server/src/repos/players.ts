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
  combo_count: number;
  last_done_at: string | null;
  streak: number;
  best_streak: number;
  last_streak_day: string | null;
  rest_week: string | null;
  chest_keys: number;
  done_count: number;
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
  comboCount: r.combo_count,
  lastDoneAt: r.last_done_at,
  streak: r.streak,
  bestStreak: r.best_streak,
  lastStreakDay: r.last_streak_day,
  restWeek: r.rest_week,
  chestKeys: r.chest_keys,
  doneCount: r.done_count,
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

  /** Spends one rest token; never goes below zero. Returns false when none was left. */
  consumeRestToken(id: string): boolean {
    const res = this.db.prepare('UPDATE players SET rest_tokens = rest_tokens - 1 WHERE id = ? AND rest_tokens > 0').run(id);
    return res.changes > 0;
  }

  /** Counts one finished quest; returns the new total. */
  incrementDoneCount(id: string): number {
    const res = this.db.prepare('UPDATE players SET done_count = done_count + 1 WHERE id = ?').run(id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return (this.get(id) as Player).doneCount;
  }

  addChestKeys(id: string, n: number): Player {
    if (n < 0) throw new Error('keys must not be negative');
    const res = this.db.prepare('UPDATE players SET chest_keys = chest_keys + ? WHERE id = ?').run(n, id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return this.get(id) as Player;
  }

  /** Uses one chest key; never goes below zero. Returns false when none was left. */
  consumeChestKey(id: string): boolean {
    const res = this.db.prepare('UPDATE players SET chest_keys = chest_keys - 1 WHERE id = ? AND chest_keys > 0').run(id);
    return res.changes > 0;
  }

  setStreak(id: string, s: { streak: number; bestStreak: number; lastStreakDay: string; restWeek: string | null }): Player {
    const res = this.db
      .prepare('UPDATE players SET streak = ?, best_streak = ?, last_streak_day = ?, rest_week = ? WHERE id = ?')
      .run(s.streak, s.bestStreak, s.lastStreakDay, s.restWeek, id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return this.get(id) as Player;
  }

  setCombo(id: string, comboCount: number, lastDoneAt: string): Player {
    const res = this.db.prepare('UPDATE players SET combo_count = ?, last_done_at = ? WHERE id = ?').run(comboCount, lastDoneAt, id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return this.get(id) as Player;
  }

  setBoostUntil(id: string, iso: string | null): Player {
    const res = this.db.prepare('UPDATE players SET boost_until = ? WHERE id = ?').run(iso, id);
    if (res.changes === 0) throw new Error(`unknown player ${id}`);
    return this.get(id) as Player;
  }
}
