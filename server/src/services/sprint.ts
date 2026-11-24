import type { DatabaseSync } from 'node:sqlite';
import type { Bus } from '../bus.js';
import { newId, type Clock } from '../clock.js';
import { copy } from '../copy.js';
import { levelUp } from '../domain/levels.js';
import type { Player } from '../domain/types.js';
import type { LedgerRepo } from '../repos/ledger.js';
import type { PlayersRepo } from '../repos/players.js';

export const SPRINT_MINUTES = [5, 15, 25] as const;
export const XP_PER_MINUTE = 2;
export const XP_PER_LOG = 5;
export const MAX_LOGS = 10;
export const MAX_NOTE = 80;

export interface Sprint {
  id: string;
  playerId: string;
  minutes: number;
  startedAt: string;
  endedAt: string | null;
  logs: number;
  xp: number | null;
}

/** Sprint XP credit; `levelUp` is set when it crossed a level. */
export interface SprintCredit {
  sprint: Sprint;
  xp: number;
  levelUp: ReturnType<typeof levelUp>;
}

export type SprintErrorCode = 'sprint_running' | 'no_sprint' | 'log_limit' | 'unknown_player';

export class SprintError extends Error {
  constructor(public readonly code: SprintErrorCode) {
    super(code);
    this.name = 'SprintError';
  }
}

interface Row {
  id: string;
  player_id: string;
  minutes: number;
  started_at: string;
  ended_at: string | null;
  logs: number;
  xp: number | null;
}

const toSprint = (r: Row): Sprint => ({
  id: r.id,
  playerId: r.player_id,
  minutes: r.minutes,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  logs: r.logs,
  xp: r.xp,
});

/** Power sprint: a timed focus block. Base XP is whole minutes elapsed x 2; quick-log notes add +5 each. */
export class SprintService {
  private readonly db: DatabaseSync;
  private readonly players: PlayersRepo;
  private readonly ledger: LedgerRepo;
  private readonly bus: Bus;
  private readonly clock: Clock;
  private readonly tx: <T>(fn: () => T) => T;
  private readonly log_: (m: string) => void;

  constructor(deps: {
    db: DatabaseSync;
    players: PlayersRepo;
    ledger: LedgerRepo;
    bus: Bus;
    clock: Clock;
    tx?: <T>(fn: () => T) => T;
    log?: (m: string) => void;
  }) {
    this.log_ = deps.log ?? ((m) => console.error(m));
    this.db = deps.db;
    this.players = deps.players;
    this.ledger = deps.ledger;
    this.bus = deps.bus;
    this.clock = deps.clock;
    this.tx = deps.tx ?? ((fn) => fn());
  }

  current(playerId: string): Sprint | null {
    const r = this.db.prepare('SELECT * FROM sprints WHERE player_id = ? AND ended_at IS NULL').get(playerId) as Row | undefined;
    return r ? toSprint(r) : null;
  }

  start(playerId: string, minutes: number): Sprint {
    if (!(SPRINT_MINUTES as readonly number[]).includes(minutes)) throw new Error(`unsupported sprint length ${minutes}`);
    const sprint = this.tx(() => {
      this.requirePlayer(playerId);
      if (this.current(playerId)) throw new SprintError('sprint_running');
      const s: Sprint = { id: newId(), playerId, minutes, startedAt: this.clock.now().toISOString(), endedAt: null, logs: 0, xp: null };
      this.db
        .prepare('INSERT INTO sprints (id, player_id, minutes, started_at, logs) VALUES (?, ?, ?, ?, 0)')
        .run(s.id, playerId, minutes, s.startedAt);
      return s;
    });
    this.bus.emit('sprint:started', { playerId, sprint });
    return sprint;
  }

  log(playerId: string, note: string): SprintCredit {
    const text = note.trim().slice(0, MAX_NOTE);
    const result = this.tx(() => {
      const cur = this.current(playerId);
      if (!cur) throw new SprintError('no_sprint');
      if (cur.logs >= MAX_LOGS) throw new SprintError('log_limit');
      const now = this.clock.now().toISOString();
      this.db.prepare('UPDATE sprints SET logs = logs + 1 WHERE id = ?').run(cur.id);
      const player = this.players.addRewards(playerId, XP_PER_LOG, 0);
      this.ledger.add({
        playerId,
        questId: null,
        kind: 'quest_done',
        xp: XP_PER_LOG,
        gold: 0,
        at: now,
        meta: { sprint: true, log: true, sprintId: cur.id, note: text, lines: [{ label: copy.sprint.logLabel, xp: XP_PER_LOG, gold: 0 }] },
      });
      return { sprint: { ...cur, logs: cur.logs + 1 }, xp: XP_PER_LOG, player };
    });
    this.bus.emit('sprint:logged', { playerId, sprint: result.sprint, xp: result.xp, player: result.player });
    return this.credit(result);
  }

  finish(playerId: string): SprintCredit {
    return this.end(playerId, this.clock.now(), false);
  }

  /** Auto-finish every sprint whose time is up. Called from the engine tick. */
  tick(now: Date): void {
    const rows = this.db.prepare('SELECT * FROM sprints WHERE ended_at IS NULL').all() as unknown as Row[];
    for (const r of rows) {
      const endsAt = new Date(r.started_at).getTime() + r.minutes * 60_000;
      if (endsAt > now.getTime()) continue;
      try {
        this.end(r.player_id, new Date(endsAt), true);
      } catch (err) {
        this.log_(`sprint tick: could not finish sprint ${r.id}: ${String(err)}`);
      }
    }
  }

  private end(playerId: string, at: Date, auto: boolean): SprintCredit {
    const result = this.tx(() => {
      const cur = this.current(playerId);
      if (!cur) throw new SprintError('no_sprint');
      const elapsed = Math.floor((at.getTime() - new Date(cur.startedAt).getTime()) / 60_000);
      const minutes = Math.min(cur.minutes, Math.max(0, elapsed));
      const xp = minutes * XP_PER_MINUTE;
      const endedAt = at.toISOString();
      this.db.prepare('UPDATE sprints SET ended_at = ?, xp = ? WHERE id = ?').run(endedAt, xp, cur.id);
      const player = xp > 0 ? this.players.addRewards(playerId, xp, 0) : this.requirePlayer(playerId);
      this.ledger.add({
        playerId,
        questId: null,
        kind: 'quest_done',
        xp,
        gold: 0,
        at: endedAt,
        meta: { sprint: true, sprintId: cur.id, minutes, lines: [{ label: copy.sprint.finishLabel, xp, gold: 0 }] },
      });
      return { sprint: { ...cur, endedAt, xp }, xp, player };
    });
    this.bus.emit('sprint:finished', { playerId, sprint: result.sprint, xp: result.xp, auto, player: result.player });
    return this.credit(result);
  }

  private credit(r: { sprint: Sprint; xp: number; player: Player }): SprintCredit {
    return { sprint: r.sprint, xp: r.xp, levelUp: levelUp(r.player.xp, r.xp) };
  }

  private requirePlayer(id: string): Player {
    const p = this.players.get(id);
    if (!p) throw new SprintError('unknown_player');
    return p;
  }
}
