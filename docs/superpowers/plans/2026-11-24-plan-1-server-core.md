# Cuest Server Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Dockerized Cuest server that turns Home Assistant state changes into quests, tracks players/XP/gold/levels, sends kind nudges through a connected bridge, and exposes a REST API for the future web app.

**Architecture:** Single Node.js process (Fastify) with SQLite storage via the built-in `node:sqlite`. All time-based behavior (power timers, recurring quests, whenever pool, nudge repeats) runs through one `tick(now)` so tests drive time with a fake clock. The HA bridge (built in plan 2) connects over a WebSocket at `/bridge`; the server never talks to HA directly. Services talk to each other through a small typed event bus.

**Tech Stack:** Node 22 (ESM), TypeScript (strict, `^5.9`), Fastify 5, `@fastify/websocket` 11, zod 4, `node:sqlite`, vitest, tsx. npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-24-cuest-design.md`

**Plan series:** 1 server core (this) → 2 HA bridge (Python, HACS) → 3 web app → 4 Release-1 game layer (keep-going/fresh/combo bonuses, quest of the day, streaks with rest days, energy dice, power sprint, unlocks, loot, mystery chest, collection book, celebrations, optional TTS announcements).

## Global Constraints

- No shame: code never subtracts XP, gold or levels; quests are never deleted (only `done` or `whenever`); templates are disabled, never deleted.
- Player-facing text never uses the words "overdue", "late", "failed", "missed", "penalty". All player-facing strings live in `server/src/copy.ts` (English first, translation-ready).
- No internet or cloud needed at runtime.
- No game logic in the bridge: the server decides everything; the bridge only forwards states/events and executes service calls.
- The bridge must authenticate with a shared secret before anything else.
- Timestamps stored as ISO-8601 UTC strings; schedules and quiet hours use the configured IANA timezone `CUEST_TZ`.
- Default HTTP port `8787`; data in `CUEST_DATA_DIR` (default `/data`).
- Run with `node --no-warnings` (silences the `node:sqlite` experimental warning).

## Review Focus

1. Bridge disconnects or reconnects: quests must still be created from later events, service calls while disconnected are dropped with a log line (never crash), and subscriptions are re-sent after every successful `hello`. → Task 7 tests.
2. Washer power dips between cycles: a dip shorter than `forMinutes` must not create a quest; a second wash while the laundry quest is still open must not create a duplicate. → Task 5 tests.
3. HA reports `unavailable` / `unknown` / non-numeric power: ignored, never triggers a quest and never resets the running state. → Task 5 tests.
4. Two players tap "Start" on the same quest (tablet + phone): first wins, second gets HTTP 409 with a friendly message. → Tasks 4 and 9 tests.
5. A notification button arrives for a quest that is already done, unknown, or malformed: ignored without error. Quiet hours crossing midnight (22:00–08:00) hold nudges and send the first one when quiet ends. → Task 8 tests.

---

### Task 1: Monorepo scaffold, health endpoint, CI

**Files:**
- Create: `package.json` (root, `"private": true`, `"workspaces": ["server"]`, scripts `test`, `typecheck` delegating to workspace)
- Create: `.gitignore` (`node_modules`, `dist`, `*.db`, `.env`)
- Create: `LICENSE` (MIT, holder "Cuest contributors")
- Create: `server/package.json` (`"type": "module"`, scripts: `test` = `vitest run`, `typecheck` = `tsc --noEmit`, `build` = `tsc -p tsconfig.build.json`, `dev` = `tsx watch src/main.ts`)
- Create: `server/tsconfig.json` (strict, `module`/`moduleResolution` `NodeNext`, `target` `ES2023`, `types: ["node"]`), `server/tsconfig.build.json` (extends, `outDir: dist`, excludes `test`)
- Create: `server/vitest.config.ts`
- Create: `server/src/app.ts`
- Create: `.github/workflows/ci.yml` (Node 22, `npm ci`, `npm run typecheck`, `npm test`)
- Test: `server/test/app.test.ts`

**Interfaces:**
- Produces: `buildApp(deps: AppDeps): Promise<FastifyInstance>` in `server/src/app.ts`. In this task `AppDeps = { bridgeConnected: () => boolean }`; Task 9 widens it.

- [ ] **Step 1: Write the failing test**

```ts
test('GET /api/health reports ok and bridge status', async () => {
  const app = await buildApp({ bridgeConnected: () => false });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, bridge: false });
});
```

- [ ] **Step 2: Install deps and run test to verify it fails**

Run: `npm install` then `npm test -w server`
Expected: FAIL (cannot find `../src/app.js`)

- [ ] **Step 3: Implement `buildApp`** registering `GET /api/health`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -w server && npm run typecheck -w server`
Expected: PASS, no type errors

- [ ] **Step 5: Commit** `chore: scaffold server workspace with health endpoint and CI`

---

### Task 2: Domain types, clock, levels

**Files:**
- Create: `server/src/domain/types.ts`
- Create: `server/src/clock.ts`
- Create: `server/src/domain/levels.ts`
- Test: `server/test/clock.test.ts`, `server/test/levels.test.ts`

**Interfaces:**
- Produces (types.ts, exact):
```ts
export type Energy = 'low' | 'medium' | 'high';
export type QuestStatus = 'open' | 'active' | 'done' | 'whenever';
export type Rule =
  | { type: 'state'; entityId: string; to: string[]; from?: string[] }
  | { type: 'power_below'; entityId: string; runningAboveW: number; idleBelowW: number; forMinutes: number };
export type Schedule =
  | { type: 'weekly'; days: number[]; time: string }                       // days 0=Sunday, time "HH:MM" local
  | { type: 'every_n_days'; n: number; time: string; startDate: string };  // startDate "YYYY-MM-DD" local
export interface NudgeConfig {
  notify: boolean;
  light: { entityId: string; rgb: [number, number, number] } | null;
  repeatEveryMinutes: number; maxRepeats: number;
  quietStart: string; quietEnd: string;                                   // "HH:MM" local
}
export interface Player { id: string; name: string; haPerson: string | null; notifyService: string | null; xp: number; gold: number; createdAt: string }
export interface QuestTemplate {
  id: string; title: string; energy: Energy; minutes: number; xp: number; gold: number;
  source: 'manual' | 'recurring' | 'rule'; rule: Rule | null; schedule: Schedule | null;
  nudge: NudgeConfig; wheneverAfterHours: number; enabled: boolean;
  lastSpawnedAt: string | null; createdAt: string;
}
export interface Quest {
  id: string; templateId: string | null; title: string; energy: Energy; minutes: number; xp: number; gold: number;
  status: QuestStatus; createdAt: string; wheneverAfterHours: number;
  claimedBy: string | null; startedAt: string | null; doneAt: string | null; doneBy: string | null;
  wheneverAt: string | null; snoozedUntil: string | null; nudgeCount: number; lastNudgeAt: string | null;
}
export interface LedgerEntry { id: string; playerId: string; questId: string | null; kind: 'quest_done'; xp: number; gold: number; at: string; meta: Record<string, unknown> }
export interface StateEvent { entityId: string; oldState: string | null; newState: string; at: Date }
export const DEFAULT_NUDGE: NudgeConfig = { notify: true, light: null, repeatEveryMinutes: 60, maxRepeats: 2, quietStart: '22:00', quietEnd: '08:00' };
```
- Produces (clock.ts): `interface Clock { now(): Date }`, `systemClock: Clock`, `class FakeClock implements Clock { constructor(start: Date); set(d: Date): void; advance(minutes: number): void }`, `localParts(d: Date, tz: string): { y: number; m: number; d: number; hh: number; mm: number; weekday: number }` (weekday 0=Sunday, via `Intl.DateTimeFormat`), `minutesOfDay(hhmm: string): number`, `isQuiet(now: Date, tz: string, start: string, end: string): boolean` (handles ranges crossing midnight; `start === end` means never quiet), `newId(): string` (`crypto.randomUUID()`).
- Produces (levels.ts): `levelForXp(xp: number): { level: number; intoLevel: number; toNext: number }` where reaching level L+1 from L costs `100 * L` XP (cumulative start of level L = `50 * L * (L - 1)`); `titleForLevel(level: number): 'Apprentice' | 'Hearthkeeper' | 'Hearth Warden'` (1–3, 4–7, 8+).

- [ ] **Step 1: Write failing tests**

```ts
// levels.test.ts
expect(levelForXp(0)).toEqual({ level: 1, intoLevel: 0, toNext: 100 });
expect(levelForXp(100)).toEqual({ level: 2, intoLevel: 0, toNext: 200 });
expect(levelForXp(940)).toEqual({ level: 4, intoLevel: 340, toNext: 400 });
expect(titleForLevel(3)).toBe('Apprentice'); expect(titleForLevel(4)).toBe('Hearthkeeper'); expect(titleForLevel(8)).toBe('Hearth Warden');
// clock.test.ts (tz 'Europe/Berlin', winter = UTC+1)
expect(isQuiet(new Date('2026-11-24T22:30:00Z'), 'Europe/Berlin', '22:00', '08:00')).toBe(true);  // 23:30 local
expect(isQuiet(new Date('2026-11-24T06:30:00Z'), 'Europe/Berlin', '22:00', '08:00')).toBe(true);  // 07:30 local
expect(isQuiet(new Date('2026-11-24T07:30:00Z'), 'Europe/Berlin', '22:00', '08:00')).toBe(false); // 08:30 local
expect(isQuiet(new Date('2026-11-24T12:00:00Z'), 'Europe/Berlin', '13:00', '13:00')).toBe(false);
expect(localParts(new Date('2026-11-24T23:30:00Z'), 'Europe/Berlin')).toMatchObject({ d: 25, hh: 0, mm: 30, weekday: 3 });
const c = new FakeClock(new Date('2026-01-01T00:00:00Z')); c.advance(90); expect(c.now().toISOString()).toBe('2026-01-01T01:30:00.000Z');
```

- [ ] **Step 2: Run to verify failure** — `npm test -w server` → FAIL (modules missing)
- [ ] **Step 3: Implement** the three files per Interfaces.
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): domain types, clock helpers and level curve`

---

### Task 3: Database and repositories

**Files:**
- Create: `server/src/db/db.ts`, `server/src/db/migrate.ts`
- Create: `server/src/repos/players.ts`, `server/src/repos/templates.ts`, `server/src/repos/quests.ts`, `server/src/repos/ledger.ts`
- Test: `server/test/repos.test.ts`

**Interfaces:**
- Produces: `openDb(file: string): DatabaseSync` (`':memory:'` allowed; enables `PRAGMA journal_mode=WAL` for files, `foreign_keys=ON`), `migrate(db: DatabaseSync): void` (idempotent; tracks `schema_version` table; version 1 creates tables `players`, `quest_templates`, `quests`, `ledger`; JSON columns `rule`, `schedule`, `nudge`, `meta` stored as TEXT).
- Produces repos (constructor takes `DatabaseSync`; all map snake_case columns ↔ camelCase types from Task 2):
  - `PlayersRepo`: `create(p: { name: string; haPerson?: string | null; notifyService?: string | null }, now: Date): Player`, `get(id): Player | null`, `list(): Player[]`, `update(id, patch: Partial<Pick<Player,'name'|'haPerson'|'notifyService'>>): Player | null`, `addRewards(id, xp: number, gold: number): Player` (throws if `xp < 0 || gold < 0`)
  - `TemplatesRepo`: `create(t: Omit<QuestTemplate,'id'|'createdAt'|'lastSpawnedAt'>, now: Date): QuestTemplate` (sets `lastSpawnedAt = now`), `get(id)`, `list(opts?: { enabledOnly?: boolean }): QuestTemplate[]`, `update(id, patch: Partial<Omit<QuestTemplate,'id'|'createdAt'>>): QuestTemplate | null`
  - `QuestsRepo`: `insert(q: Quest): void`, `get(id): Quest | null`, `update(id, patch: Partial<Quest>): Quest`, `listByStatus(statuses: QuestStatus[]): Quest[]` (oldest first), `findLiveByTemplate(templateId): Quest | null` (status in open/active/whenever)
  - `LedgerRepo`: `add(e: Omit<LedgerEntry,'id'>): LedgerEntry`, `listForPlayer(playerId): LedgerEntry[]`

- [ ] **Step 1: Write failing tests** (all on `openDb(':memory:')` + `migrate`)
  - `migrate is idempotent`: calling twice does not throw; `schema_version` = 1.
  - `players round-trip`: create → get returns same name, `xp 0`, `gold 0`.
  - `addRewards refuses negatives`: `expect(() => players.addRewards(id, -5, 0)).toThrow()`.
  - `templates round-trip JSON fields`: a template with `rule: { type: 'power_below', entityId: 'sensor.washer_power', runningAboveW: 10, idleBelowW: 3, forMinutes: 3 }` comes back deep-equal; `lastSpawnedAt` equals creation time.
  - `findLiveByTemplate ignores done quests`.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** db, migration and repos.
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): sqlite storage and repositories`

---

### Task 4: Event bus, rewards, quest lifecycle

**Files:**
- Create: `server/src/bus.ts`
- Create: `server/src/domain/rewards.ts`
- Create: `server/src/services/quests.ts`
- Test: `server/test/quests.test.ts`

**Interfaces:**
- Consumes: Task 2 types/clock, Task 3 repos.
- Produces:
  - `bus.ts`: `type BusEvents = { 'quest:opened': Quest; 'quest:started': Quest; 'quest:done': { quest: Quest; reward: Reward; player: Player }; 'quest:whenever': Quest; 'quest:snoozed': Quest }`; `class Bus { on<K extends keyof BusEvents>(k: K, fn: (e: BusEvents[K]) => void): void; emit<K>(k: K, e: BusEvents[K]): void }` (a throwing listener is caught and logged, other listeners still run).
  - `rewards.ts`: `interface Reward { xp: number; gold: number; lines: { label: string; xp: number; gold: number }[] }`; `computeReward(input: { quest: Quest; startedAt: Date | null; doneAt: Date }): Reward` — plan 1 returns base only: one line `{ label: 'Quest', xp: quest.xp, gold: quest.gold }`. Plan 4 adds bonus lines here.
  - `quests.ts`: `class QuestError extends Error { code: 'not_found' | 'already_claimed' | 'already_done' | 'unknown_player' }`; `class QuestService { constructor(deps: { quests: QuestsRepo; players: PlayersRepo; ledger: LedgerRepo; bus: Bus; clock: Clock }) }` with:
    - `open(input: { templateId?: string | null; title: string; energy: Energy; minutes: number; xp: number; gold?: number; wheneverAfterHours?: number }): { quest: Quest; created: boolean }` — `gold` defaults to `Math.round(xp / 3)`, `wheneverAfterHours` to 12. If `templateId` has a live quest: status `whenever` → set back to `open` (reset `nudgeCount` 0, `wheneverAt` null, emit `quest:opened`), return `created: false`; `open`/`active` → return it unchanged, `created: false`. Otherwise insert, emit `quest:opened`, `created: true`.
    - `start(questId: string, playerId: string): Quest` — open/whenever → active with `claimedBy`, `startedAt`; already active by same player → unchanged; active by other → `already_claimed`; done → `already_done`; emits `quest:started`.
    - `done(questId: string, playerId: string): { quest: Quest; reward: Reward; player: Player }` — allowed from open/active/whenever unless active and claimed by another player (`already_claimed`); `already_done` if done; awards via `computeReward` + `players.addRewards` + ledger entry `kind: 'quest_done'`; emits `quest:done`.
    - `later(questId: string, minutes = 60): Quest` — sets `snoozedUntil`; status unchanged; emits `quest:snoozed`.
    - `listVisible(): { active: Quest[]; open: Quest[]; whenever: Quest[] }`
    - `sweep(now: Date): void` — `open` quests with `createdAt + wheneverAfterHours <= now` → `whenever` (sets `wheneverAt`), emits `quest:whenever`. Never touches `active`.

- [ ] **Step 1: Write failing tests** (fake clock, in-memory db, two players A and B)
  - `open creates once per template`: two `open({ templateId: 't1', ... })` calls → second returns `created: false`, same id, only one live quest.
  - `whenever quest is revived by a new trigger`: open → `clock.advance(13*60)` → `sweep` → status `whenever` → `open` again with same template → status `open`, `created: false`.
  - `second player cannot steal an active quest` (Review Focus 4): `start(q, A)` then `expect(() => service.start(q, B)).toThrow(expect.objectContaining({ code: 'already_claimed' }))`.
  - `done awards xp and gold and never twice`: quest xp 30 → player A has `xp 30, gold 10`; ledger has 1 entry; second `done` throws `already_done`.
  - `done straight from whenever pool works`.
  - `sweep never moves active quests`.
  - `unknown player`: `start(q, 'nope')` throws `unknown_player`.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** bus, rewards, QuestService.
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): quest lifecycle with shared claiming and whenever pool`

---

### Task 5: Rule engine and presets

**Files:**
- Create: `server/src/services/rules.ts`
- Create: `server/src/domain/presets.ts`
- Test: `server/test/rules.test.ts`, `server/test/presets.test.ts`

**Interfaces:**
- Consumes: `TemplatesRepo`, `QuestService.open`, `Clock`.
- Produces:
  - Uses `StateEvent` from `domain/types.ts`.
  - `class RuleEngine { constructor(deps: { templates: TemplatesRepo; quests: QuestService }); entities(): string[]; onState(ev: StateEvent): void; tick(now: Date): void }` — `entities()` = sorted unique `entityId`s of enabled templates with a rule. Ignores states `unavailable`, `unknown`, and (for `power_below`) non-numeric values entirely (no state change). `state` rule fires when `newState ∈ to`, `newState !== oldState`, and (`from` absent or `oldState ∈ from`). `power_below` keeps per-template in-memory `{ running: boolean; belowSince: Date | null }`: reading `> runningAboveW` → running, `belowSince = null`; running and reading `< idleBelowW` → `belowSince ??= at`; otherwise `belowSince = null`. It fires (in `onState` or `tick`) when running and `now - belowSince >= forMinutes`, then resets to not running. Firing calls `quests.open({ templateId, title, energy, minutes, xp, gold, wheneverAfterHours })` from the template.
  - `presets.ts`: `type PresetName = 'washer_power' | 'washer_state' | 'dryer_power' | 'dryer_state' | 'dishwasher_power' | 'dishwasher_state' | 'vacuum' | 'vacuum_bin_sensor'`; `presetTemplates(preset: PresetName, opts: { entityId: string; doneStates?: string[] }): Omit<QuestTemplate, 'id' | 'createdAt' | 'lastSpawnedAt'>[]` — all `source: 'rule'`, `nudge: DEFAULT_NUDGE`, `wheneverAfterHours: 12`, `enabled: true`, `gold = Math.round(xp/3)`. Values:

    | preset | title | energy | min | xp | rule |
    |---|---|---|---|---|---|
    | washer_* | Hang up the laundry | low | 5 | 30 | power: >10 W running, <3 W idle, 3 min · state: `to = doneStates ?? ['finished','complete','completed','end','done']` |
    | dryer_* | Fold the dry laundry | medium | 10 | 40 | same thresholds/default states |
    | dishwasher_* | Unload the dishwasher | medium | 6 | 35 | same thresholds/default states |
    | vacuum | Empty the vacuum bin (low, 1, 10, state `to ['docked']`, `from ['cleaning','returning']`) **and** Rescue the robot vacuum (low, 2, 15, state `to ['error']`) | | | | |
    | vacuum_bin_sensor | Empty the vacuum bin | low | 1 | 10 | state `to ['on']` |

- [ ] **Step 1: Write failing tests** (template from `presetTemplates('washer_power', { entityId: 'sensor.washer_power' })[0]`)
  - `washer quest after power stays low for 3 minutes`: readings 1800 W at t0, 2 W at t0+40min, `tick(t0+42)` → no quest; `tick(t0+43)` → one open quest "Hang up the laundry".
  - `short dip between cycles does not finish` (Review Focus 2): 1800 W, 2 W at +10, 1500 W at +11, `tick(+20)` → no quest.
  - `second wash while laundry quest open does not duplicate` (Review Focus 2): complete two full cycles → one live quest.
  - `unavailable and garbage are ignored` (Review Focus 3): 1800 W, `'unavailable'` at +5, `'abc'` at +6, 2 W at +10, `tick(+13)` → one quest (running state survived).
  - `state rule respects from`: vacuum `docked` from `cleaning` → quest; `docked` from `idle` → none; `error` → rescue quest.
  - `entities() lists enabled rule entities only`.
  - presets test: `presetTemplates('vacuum', …)` returns 2 templates; washer_state uses given `doneStates`.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** RuleEngine and presets.
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): rule engine for appliance and vacuum quests`

---

### Task 6: Recurring quests

**Files:**
- Create: `server/src/services/recurring.ts`
- Test: `server/test/recurring.test.ts`

**Interfaces:**
- Consumes: `TemplatesRepo`, `QuestService.open`, `localParts`.
- Produces: `lastOccurrence(schedule: Schedule, now: Date, tz: string): Date | null` (most recent occurrence `<= now`, DST-safe by computing local wall time → UTC via `Intl`); `class RecurringScheduler { constructor(deps: { templates: TemplatesRepo; quests: QuestService; tz: string }); tick(now: Date): void }` — for each enabled template with a schedule: if `lastOccurrence > lastSpawnedAt` → `quests.open(...)` and `templates.update(id, { lastSpawnedAt: now })`. Only the latest missed occurrence spawns (no backfill flood).

- [ ] **Step 1: Write failing tests** (tz `Europe/Berlin`)
  - `weekly trash day`: schedule `{ type: 'weekly', days: [2], time: '18:00' }` created Mon 2026-11-23 10:00 local → tick Tue 17:59 local: none; Tue 18:00: one quest; another tick Tue 19:00: still one.
  - `no backfill flood`: template created, server "down" 3 weeks → one tick spawns exactly one quest.
  - `every_n_days`: `{ n: 3, time: '09:00', startDate: '2026-11-01' }` → `lastOccurrence` at `2026-11-24T10:00` local is `2026-11-22 09:00` local.
  - `created after today's time does not spawn today`: created Tue 19:00, tick Tue 19:01 → none.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): recurring quests on weekly and every-n-days schedules`

---

### Task 7: Bridge protocol and WebSocket hub

**Files:**
- Create: `server/src/bridge/protocol.ts`
- Create: `server/src/bridge/hub.ts`
- Create: `server/src/routes/bridge.ts`
- Create: `docs/bridge-protocol.md` (message reference for plan 2)
- Test: `server/test/bridge.test.ts`

**Interfaces:**
- Produces (protocol.ts, zod schemas + inferred types, JSON text frames):
  - Bridge → server: `{ type: 'hello'; secret: string; version: string }` | `{ type: 'state'; entityId: string; oldState: string | null; newState: string; at: string }` | `{ type: 'notification_action'; action: string; at: string }` | `{ type: 'result'; id: string; ok: boolean; error?: string }`
  - Server → bridge: `{ type: 'welcome' }` | `{ type: 'subscribe'; entities: string[] }` | `{ type: 'call_service'; id: string; domain: string; service: string; data: Record<string, unknown>; target?: { entity_id: string | string[] } }` | `{ type: 'error'; reason: string }`
- Produces (hub.ts): `class BridgeHub { constructor(opts: { secret: string; log: (msg: string) => void }); attach(socket: WebSocketLike): void; isConnected(): boolean; setSubscriptions(entities: string[]): void; callService(domain: string, service: string, data: Record<string, unknown>, target?: { entity_id: string | string[] }): boolean; onState(fn: (ev: StateEvent) => void): void; onNotificationAction(fn: (action: string) => void): void }` where `WebSocketLike = { send(data: string): void; close(code?: number, reason?: string): void; on(ev: 'message' | 'close', fn: (...args: any[]) => void): void }`.
  - Auth: first message must be `hello` with matching secret (`crypto.timingSafeEqual` on equal-length buffers) within 5 s, else send `error` and close with code `4001`. On success: send `welcome`, then `subscribe` with current subscriptions. A newly authenticated bridge replaces the previous one (old one closed with `4002`). Invalid JSON / unknown messages after auth are logged and ignored. `callService` returns `false` and logs when disconnected.
- Produces (routes/bridge.ts): `registerBridgeRoute(app: FastifyInstance, hub: BridgeHub): void` mounting WebSocket at `GET /bridge`.

- [ ] **Step 1: Write failing tests** (real app on port 0 with `ws` client; helper `connect(secret)` returning received messages)
  - `wrong secret is rejected`: close code 4001.
  - `hello gets welcome and current subscriptions`: `hub.setSubscriptions(['sensor.washer_power'])` before connect → client receives `welcome` then `{ type: 'subscribe', entities: ['sensor.washer_power'] }`.
  - `subscriptions are re-sent on reconnect` (Review Focus 1): disconnect, reconnect → `subscribe` received again.
  - `state messages reach onState with Date at`.
  - `callService while disconnected returns false and does not throw` (Review Focus 1).
  - `garbage after auth is ignored`: send `'not json'` then a valid `state` → handler still called once.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** protocol, hub, route; write `docs/bridge-protocol.md` listing each message with one example.
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): authenticated websocket bridge protocol`

---

### Task 8: Nudges (notifications, light signal, gentle repeats)

**Files:**
- Create: `server/src/copy.ts`
- Create: `server/src/services/nudges.ts`
- Test: `server/test/nudges.test.ts`, `server/test/copy.test.ts`

**Interfaces:**
- Consumes: `Bus` events, `BridgeHub.callService`, `QuestService.start/done/later`, repos, `isQuiet`.
- Produces:
  - `copy.ts`: `copy.newQuestTitle(q: Quest): string` → `New quest: ${q.title}`; `copy.newQuestMessage(q)` → `A ${q.minutes}-minute quest is waiting. +${q.xp} XP.`; `copy.repeatMessage(q, n: number): string` cycling through exactly these templates: `No rush. "${title}" is still here whenever you're ready.`, `Even 2 minutes counts. "${title}" is waiting for you.`, `Your hero believes in you. "${title}" whenever you like.`; `copy.actions` = `{ start: 'Start 2 min', done: 'Already done', later: 'Later' }`.
  - `nudges.ts`: `encodeAction(verb: 'START' | 'DONE' | 'LATER', questId: string, playerId: string): string` → `CUEST|<verb>|<questId>|<playerId>`; `decodeAction(s: string): { verb; questId; playerId } | null`; `class NudgeService { constructor(deps: { bus: Bus; hub: BridgeHub; quests: QuestService; questsRepo: QuestsRepo; templates: TemplatesRepo; players: PlayersRepo; clock: Clock; tz: string }); tick(now: Date): void; handleAction(action: string): void }`.
  - Behavior:
    - On `quest:opened`: if the quest has a template with `nudge.notify` and it is not quiet → send to every player with `notifyService`: `callService('notify', notifyService, { title, message, data: { tag: 'cuest-<questId>', url: '/cuest', actions: [{ action: encodeAction('START',…), title: copy.actions.start }, { action: DONE… }, { action: LATER… }] } })`; set `nudgeCount = 1`, `lastNudgeAt = now`. If `nudge.light` → `callService('light', 'turn_on', { rgb_color: rgb }, { entity_id })` (also during quiet hours). Quests without template (manual) get `DEFAULT_NUDGE` with `notify: false`.
    - `tick(now)`: for `open` quests with notify on, not snoozed (`snoozedUntil <= now` or null), not quiet: if `nudgeCount === 0` → send first nudge; else if `nudgeCount <= maxRepeats` and `now - lastNudgeAt >= repeatEveryMinutes` → send repeat using `copy.repeatMessage(q, nudgeCount)` (same tag, so it replaces the old notification), increment.
    - On `quest:started` / `quest:done` / `quest:whenever`: send `{ message: 'clear_notification', data: { tag } }` to each notify service; turn the light off unless another `open` quest uses the same light entity.
    - `handleAction`: decode; START → `quests.start`, DONE → `quests.done`, LATER → `quests.later(id, 60)`; null decode or any `QuestError` → log and ignore.

- [ ] **Step 1: Write failing tests** (fake hub recording `callService` calls; player A with `notifyService: 'mobile_app_iphone'`; tz `Europe/Berlin`)
  - `new quest sends actionable notification`: one notify call with 3 actions whose `action` strings decode back to quest + player A.
  - `light glows while quest waits and turns off when done`.
  - `light stays on while another quest uses it`.
  - `gentle repeats stop after maxRepeats`: advance 60 min twice → 2 repeats with the first two repeat messages; third hour → no more.
  - `quiet hours hold the first nudge until morning` (Review Focus 5): quest opened 23:30 local → no notify call; tick 07:59 → none; tick 08:00 → first notification.
  - `LATER snoozes repeats for 60 minutes`.
  - `stale or malformed actions are ignored` (Review Focus 5): `handleAction('CUEST|DONE|<doneQuestId>|A')`, `handleAction('hello')`, unknown quest id → no throw, no extra rewards.
  - copy test: every string from `copy` (render each with a sample quest, n = 1..3) contains none of `overdue|late|failed|missed|penalty` (case-insensitive, whole word — note "Later" button is allowed: match `\blate\b`).
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** copy and NudgeService.
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): kind nudges via phone notifications and light signal`

---

### Task 9: REST API

**Files:**
- Modify: `server/src/app.ts` (widen `AppDeps`)
- Create: `server/src/routes/players.ts`, `server/src/routes/quests.ts`, `server/src/routes/templates.ts`
- Test: `server/test/api.test.ts`

**Interfaces:**
- Consumes: services and repos from Tasks 3–8.
- Produces: `AppDeps = { bridgeConnected: () => boolean; players: PlayersRepo; templates: TemplatesRepo; quests: QuestService; onTemplatesChanged: () => void; hub?: BridgeHub }` (when `hub` given, `/bridge` route is registered). Routes (zod-validated bodies; invalid → 400 `{ error: 'invalid', issues }`):
  - `GET /api/players` → `Player[]`; `POST /api/players` `{ name, haPerson?, notifyService? }` → 201 `Player`; `PATCH /api/players/:id` → `Player` | 404
  - `GET /api/players/:id/summary` → `{ player, level, title, intoLevel, toNext }`
  - `GET /api/quests` → `{ active, open, whenever }`; `POST /api/quests` `{ title, energy, minutes, xp?=20, gold? }` → 201 `Quest` (manual)
  - `POST /api/quests/:id/start` `{ playerId }` → 200 `Quest`; `POST /api/quests/:id/done` `{ playerId }` → 200 `{ quest, reward, player }`; `POST /api/quests/:id/later` `{ minutes? }` → 200 `Quest`
  - QuestError mapping: `not_found`/`unknown_player` → 404, `already_claimed`/`already_done` → 409, body `{ error: code, message }` with messages `Someone else is already on this one. Thanks for checking!` and `This quest is already done. Nice!`
  - `GET /api/templates`; `POST /api/templates` (full template minus id/createdAt/lastSpawnedAt, `nudge` defaults to `DEFAULT_NUDGE`) → 201; `PATCH /api/templates/:id`; `DELETE /api/templates/:id` → sets `enabled: false`, 200; `POST /api/templates/presets` `{ preset, entityId, doneStates? }` → 201 `QuestTemplate[]`. Every template change calls `onTemplatesChanged()`.

- [ ] **Step 1: Write failing tests** (Fastify `inject`)
  - `create player then summary shows level 1 Apprentice`.
  - `manual quest full flow`: POST quest → start → done → player xp increased; `GET /api/quests` shows it gone from open.
  - `second claim gets friendly 409` (Review Focus 4): body `{ error: 'already_claimed', message: 'Someone else is already on this one. Thanks for checking!' }`.
  - `invalid body gives 400`: `POST /api/quests` with `energy: 'extreme'`.
  - `preset endpoint creates washer template and triggers onTemplatesChanged`.
  - `DELETE disables, never removes`: template still in `GET /api/templates` with `enabled: false`.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** routes.
- [ ] **Step 4: Run tests + typecheck** → PASS
- [ ] **Step 5: Commit** `feat(server): REST API for players, quests and templates`

---

### Task 10: Engine wiring, config, Docker

**Files:**
- Create: `server/src/config.ts`, `server/src/engine.ts`, `server/src/main.ts`
- Create: `server/Dockerfile`, `docker-compose.example.yml`, `README.md`
- Test: `server/test/engine.test.ts`, `server/test/config.test.ts`

**Interfaces:**
- Produces:
  - `loadConfig(env: NodeJS.ProcessEnv, fs?: { readFile, writeFile, exists }): Config` with `Config = { port: number; dataDir: string; bridgeSecret: string; tz: string; tickSeconds: number }` from `CUEST_PORT` (8787), `CUEST_DATA_DIR` (`/data`), `CUEST_BRIDGE_SECRET` (if unset: read `<dataDir>/bridge-secret`, else generate 32 random bytes hex, save it there, and log `Bridge secret created. Find it in <path>`), `CUEST_TZ` (fallback `process.env.TZ` then `'UTC'`; invalid zone → throw with clear message), `CUEST_TICK_SECONDS` (30).
  - `createEngine(deps: { db: DatabaseSync; clock: Clock; config: Config; log?: (m: string) => void }): Promise<{ app: FastifyInstance; hub: BridgeHub; tick(): void; refreshSubscriptions(): void }>` — builds repos, bus, services, hub; wires `hub.onState → rules.onState`, `hub.onNotificationAction → nudges.handleAction`; `tick()` runs `rules.tick`, `recurring.tick`, `quests.sweep`, `nudges.tick` in that order with `clock.now()`, each guarded so one failure doesn't stop the rest; `refreshSubscriptions()` = `hub.setSubscriptions(rules.entities())`, also called at startup and via `onTemplatesChanged`.
  - `main.ts`: load config, `openDb(<dataDir>/cuest.db)`, `migrate`, `createEngine`, `listen({ host: '0.0.0.0', port })`, `setInterval(tick, tickSeconds*1000)`, graceful shutdown on SIGTERM/SIGINT.
  - Dockerfile: multi-stage `node:22-alpine`; build stage `npm ci` + `npm run build -w server`; runtime copies `server/dist`, prod deps; `ENV CUEST_DATA_DIR=/data`; `VOLUME /data`; `EXPOSE 8787`; `CMD ["node","--no-warnings","dist/main.js"]`; runs as non-root `node` user.
  - `docker-compose.example.yml`: service `cuest`, image built from `./server`, port `8787:8787`, volume `./cuest-data:/data`, env `CUEST_TZ`, `restart: unless-stopped`.
  - README: what Cuest is (2–3 lines from spec intent), status "early development", install on a PC/NAS with Docker compose, where the bridge secret is, link to spec and mockups note.

- [ ] **Step 1: Write failing tests**
  - `end-to-end washer flow through a fake bridge`: engine with FakeClock + in-memory db; create player with notifyService via API; create `washer_power` preset via API; connect `ws` client with the secret → receives `subscribe` containing `sensor.washer_power`; send states 1800 W then 2 W; `clock.advance(3)`; `tick()` → client receives a `call_service` with `domain: 'notify'`; send `notification_action` with the START action → `GET /api/quests` shows it active for that player.
  - config tests: generates and persists secret when missing (in-memory fs fake), invalid `CUEST_TZ` throws.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement** config, engine, main, Docker files, README.
- [ ] **Step 4: Verify**
  - Run: `npm test -w server && npm run typecheck -w server` → PASS
  - Run: `docker build -t cuest-server -f server/Dockerfile .` → succeeds
  - Run: `docker run -d --rm -p 8787:8787 -e CUEST_BRIDGE_SECRET=test --name cuest-smoke cuest-server && sleep 2 && curl -s localhost:8787/api/health; docker stop cuest-smoke` → `{"ok":true,"bridge":false}`
- [ ] **Step 5: Commit** `feat(server): engine wiring, config and Docker image`
