import type { DatabaseSync } from 'node:sqlite';
import type { Slot } from '../domain/types.js';

export class ItemsRepo {
  constructor(private db: DatabaseSync) {}

  owned(playerId: string): Record<string, number> {
    const rows = this.db
      .prepare('SELECT item_id, count FROM player_items WHERE player_id = ? ORDER BY item_id')
      .all(playerId) as unknown as { item_id: string; count: number }[];
    return Object.fromEntries(rows.map((r) => [r.item_id, r.count]));
  }

  grant(playerId: string, itemId: string, n = 1): void {
    this.db
      .prepare(
        'INSERT INTO player_items (player_id, item_id, count) VALUES (?, ?, ?) ON CONFLICT(player_id, item_id) DO UPDATE SET count = count + excluded.count',
      )
      .run(playerId, itemId, n);
  }

  equipped(playerId: string): Partial<Record<Slot, string>> {
    const rows = this.db
      .prepare('SELECT slot, item_id FROM equipped WHERE player_id = ?')
      .all(playerId) as unknown as { slot: Slot; item_id: string }[];
    return Object.fromEntries(rows.map((r) => [r.slot, r.item_id])) as Partial<Record<Slot, string>>;
  }

  equip(playerId: string, slot: Slot, itemId: string | null): void {
    if (itemId === null) {
      this.db.prepare('DELETE FROM equipped WHERE player_id = ? AND slot = ?').run(playerId, slot);
      return;
    }
    this.db
      .prepare(
        'INSERT INTO equipped (player_id, slot, item_id) VALUES (?, ?, ?) ON CONFLICT(player_id, slot) DO UPDATE SET item_id = excluded.item_id',
      )
      .run(playerId, slot, itemId);
  }
}
