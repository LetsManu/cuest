import type { DatabaseSync } from 'node:sqlite';

export interface Settings {
  /** Lights that flash on celebrations. Always `light.*` entity ids. */
  celebrationLights: string[];
  /** The one scene switched on when a power sprint starts, or null. */
  sprintScene: string | null;
}

const DEFAULTS: Settings = { celebrationLights: [], sprintScene: null };

export class SettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[];
    const out: Settings = { celebrationLights: [], sprintScene: null };
    for (const r of rows) {
      try {
        const v: unknown = JSON.parse(r.value);
        if (r.key === 'celebrationLights' && Array.isArray(v) && v.every((x) => typeof x === 'string')) out.celebrationLights = v as string[];
        if (r.key === 'sprintScene' && (v === null || typeof v === 'string')) out.sprintScene = v;
      } catch {
        // ignore a corrupt row and fall back to the default
      }
    }
    return { ...DEFAULTS, ...out };
  }

  update(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) stmt.run(k, JSON.stringify(v));
    }
    return this.get();
  }
}
