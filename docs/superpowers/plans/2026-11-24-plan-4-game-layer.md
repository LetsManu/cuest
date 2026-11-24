# Cuest Game Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Release 1's game loop: keep-going, fresh-quest and combo bonuses, quest of the day, streaks with rest days, loot drops and a free mystery chest every 5 quests, the collection book, Energy dice, Power sprint, and the house celebrating with lights and a fanfare.

**Architecture:** All rules live on the server (reward engine, daily state, streaks, loot, dice, sprint). The bridge only gains an owner-chosen "celebration lights" list and a "sprint scene" in the options (allowlisted like house treats). The panel shows the new parts: reward breakdown, streak, quest of the day, chest, dice, sprint and the collection book.

**Tech Stack:** unchanged (server Node/TS/Fastify/node:sqlite/vitest; bridge Python HA integration/pytest; frontend Lit/esbuild/vitest).

**Spec:** `docs/superpowers/specs/2026-11-24-cuest-design.md` (goals 2, 3, 5, 8, 10)

**Builds on:** plans 1–3 (on `main`). Branch `feat/game-layer`.

## Global Constraints

- All plan 1–3 constraints hold: no shame (never take XP/gold/levels; only the player's own purchases spend gold), no "overdue/late/failed/missed/penalty" wording, copy in `server/src/copy.ts` / `frontend/src/strings.ts` / integration `strings.json` (+ identical `translations/en.json`), bridge logic-free, panel only through `/api/cuest/...`, committed bundles up to date.
- Local day = calendar day in `CUEST_TZ`. All randomness injectable (`rng`) for tests.
- Streaks never punish: a missed day is covered by a rest token, else by the free weekly rest day; only when neither is available does the streak start again from 1 — the best streak is always kept and the copy stays kind ("New streak started — welcome back!").
- Rewards are computed only on the server and returned as `Reward.lines` so the panel can show them.

## Exact values

| Rule | Value |
|---|---|
| Keep-going bonus | `+5 XP` per full minute beyond 2 between `startedAt` and done, cap `+50` (line "Kept going") |
| Fresh-quest bonus | started ≤ 15 min after the quest was created/revived → `+quest.xp` (line "Fresh quest") |
| Combo | done ≤ 10 min after the same player's previous done → combo n (2, 3, …); `+round(quest.xp × 0.25 × (n−1))`, cap `+quest.xp` (line "Combo ×n") |
| Quest of the day | one per local day, chosen at the first tick of the day among open/whenever quests (else the first quest opened that day); `+2 × quest.xp` (line "Quest of the day") and a guaranteed loot drop |
| Double XP hour | doubles the total XP after all bonuses (existing line kept) |
| Streak day | ≥ 1 quest done that local day |
| Rest days | 1 free rest day per ISO week, used automatically first; then rest tokens (1 per missed day) |
| Loot drop | on done: 25 % chance (100 % for quest of the day) of a random not-owned item from the loot pool; nothing else otherwise |
| Loot pool | catalog wardrobe + decor items with cost ≤ 60, plus loot-only items below |
| Free chest | every 5th quest done by a player grants 1 chest key (`chestKeys`); opening uses the mystery chest rules at no cost |
| Energy dice | open/whenever quests with matching `energy`; if none, nearest energy (low↔medium↔high); if no quests at all → suggestion "Quick tidy: put 5 things back where they belong" (2 min, 10 XP, low) the player can accept as a manual quest |
| Power sprint | 5/15/25 min; base `minutes × 2` XP when it ends or is finished early (prorated: whole minutes elapsed × 2); quick-log entries `+5 XP` each, max 10 per sprint; quests done during a sprint get their normal rewards |
| Celebration | on quest done: celebration lights `light.turn_on` with `flash: short`; on level up: `flash: long`; sprint start: `scene.turn_on` sprint scene; sprint end: celebration flash |

Loot-only items (add to catalog with `cost: 0`, `lootOnly: true`, not buyable):

| id | kind | name | data |
|---|---|---|---|
| hood_starry | wardrobe (hood) | Starry cloak | G `#1F2A4A`, L `#F7D27A`, g `#141C33` |
| broom_moss | wardrobe (broom) | Mossy broom | T `#5A4630`, F `#6FAE8C`, f `#3B6E57` |
| owl | decor | Sleepy owl | — |

## Review Focus

1. Reward stacking order and caps: base → keep-going → fresh → combo → quest of the day → ×2 double XP hour; gold unchanged by XP bonuses. → Task 1 tests.
2. Day boundaries in `CUEST_TZ` (quest done 23:59 vs 00:01, DST change week) for streaks and quest of the day. → Task 2 tests.
3. Streak with several missed days: free rest day first, then tokens one per day, then a kind restart; best streak kept; tokens never go negative. → Task 2 tests.
4. Sprint edge cases: start while another sprint runs (409), finish early, server restart mid-sprint (sprint stored in DB, still finishable), quick-log cap. → Task 4 tests.
5. Celebration lights / sprint scene not in the owner's list → bridge refuses; server never fails a quest because a celebration failed. → Task 5 tests.

---

## Part A — Server

### Task 1: Reward engine v2 (keep-going, fresh, combo, stacking)

**Files:** Modify `server/src/domain/rewards.ts`, `server/src/services/quests.ts`, `server/src/copy.ts`; Test `server/test/rewards.test.ts`, `server/test/quests.test.ts`

**Interfaces:**
- `computeReward(input: { quest: Quest; startedAt: Date | null; doneAt: Date; boostUntil?: string | null; lastDoneAt?: Date | null; comboCount?: number; questOfDay?: boolean }): Reward` — lines in the exact order of Review Focus 1; labels from `copy.reward.*` ("Quest", "Kept going", "Fresh quest", "Combo ×n", "Quest of the day", "Double XP hour").
- `QuestService.done` supplies `lastDoneAt` (player's previous `quest_done` ledger entry time) and `comboCount` (stored per player: `players.combo_count`, `players.last_done_at`, migration 4), and `questOfDay` (Task 2 provides `isQuestOfDay(questId, now)`; until then always false via an injected predicate defaulting to `() => false`).

- [ ] Tests (RED first): keep-going 7 min → +25; 20 min → +50 cap; fresh start 10 min after creation → +xp; 20 min → none; combo 2nd done 5 min after first → ×2 line +25 % ; 6 in a row capped at +xp; 11 min gap resets combo; quest of the day +2×xp; stacking with double XP doubles the summed XP; gold always quest.gold.
- [ ] Implement, run server suite + typecheck, commit `feat(server): keep-going, fresh-quest and combo bonuses`

### Task 2: Quest of the day and streaks

**Files:** Create `server/src/services/daily.ts`, migration 5 (`daily(date TEXT PRIMARY KEY, quest_id TEXT)`, players `streak INTEGER DEFAULT 0`, `best_streak INTEGER DEFAULT 0`, `last_streak_day TEXT`, `rest_week TEXT`); Modify `engine.ts` (tick), `quests.ts` (predicate), `publisher.ts` + `protocol.ts` (snapshot player `streak`, `bestStreak`; snapshot root `questOfDay: string | null`), `copy.ts`, `docs/bridge-protocol.md`; Test `server/test/daily.test.ts`

**Interfaces:**
- `class DailyService { constructor(deps: { db; quests: QuestsRepo; players: PlayersRepo; clock; tz; rng? }); tick(now: Date): void; questOfDay(now: Date): string | null; isQuestOfDay(questId: string, now: Date): boolean; onQuestDone(playerId: string, doneAt: Date): { streak: number; restarted: boolean; usedRest: 'free' | 'token' | null } }`.
- Streak update on done: if `last_streak_day` is today → nothing; yesterday → +1; else count missed days between, cover them with the free weekly rest day (once per ISO week, tracked in `rest_week`) then rest tokens; if fully covered → +1; else restart at 1 (`restarted: true`). `best_streak = max`. A `quest:done` result carries streak info for the panel toast.
- REST: `GET /api/players/:id/summary` gains `streak`, `bestStreak`, `restTokens`; `GET /api/quests` gains `questOfDay` id.

- [ ] Tests: quest of the day picked once per local day (Europe/Berlin), deterministic with rng, re-picked next day, none when no quests then the first opened that day; streak +1 consecutive days; one missed day uses free rest day; second missed day same week uses a token; no token → restart with best kept; 23:59/00:01 boundary; DST week; tokens never negative.
- [ ] Implement, run, commit `feat(server): quest of the day and kind streaks with rest days`

### Task 3: Loot, free chests and the collection

**Files:** Modify `server/src/shop/catalog.ts` (loot-only items, `lootOnly` flag excluded from buy and shop view, included in collection), `services/shop.ts` (grant loot, chest keys, open chest), migration 6 (`players.chest_keys`, `players.done_count`), `routes/shop.ts`, `publisher.ts`/`protocol.ts` (`chestKeys`), `copy.ts`; Test `server/test/loot.test.ts`

**Interfaces:**
- `ShopService.rollLoot(playerId, guaranteed: boolean): string | null` (called inside the done flow after rewards; 25 % or guaranteed; pool per Exact values; grants item); `QuestService.done` result gains `loot: { itemId, name } | null`, `chestKey: boolean` (every 5th done increments `chest_keys`).
- `POST /api/shop/open-chest { playerId }` → same result shape as buying `mystery_chest` but consumes a key (409 `no_chest_key`, copy "No chest key yet. Every 5 quests brings one!").
- `GET /api/collection?playerId=` → `{ items: { id, kind, name, owned, lootOnly }[] }` (all wardrobe + decor incl. loot-only).

- [ ] Tests: rng 0.2 → loot, 0.3 → none; quest of the day always loot; pool excludes owned and cost > 60; all owned → null; every 5th done grants a key; open-chest consumes a key, no key → 409; loot-only items not buyable, not in shop view, present in collection.
- [ ] Implement, run, commit `feat(server): loot drops, chest keys and the collection book`

### Task 4: Energy dice and Power sprint

**Files:** Create `server/src/services/sprint.ts`, `server/src/routes/play.ts`; migration 7 (`sprints(id, player_id, minutes, started_at, ended_at, logs INTEGER DEFAULT 0, xp INTEGER)`); Modify `app.ts`, `engine.ts`, `copy.ts`; Test `server/test/play.test.ts`

**Interfaces:**
- `GET /api/dice?playerId=&energy=low|medium|high` → `{ quest: Quest } | { suggestion: { title, minutes, xp, energy } }` (rng injectable; Exact values rules).
- `POST /api/dice/accept { playerId, suggestion }` → creates the manual quest and starts it for the player.
- `SprintService`: `start(playerId, minutes: 5|15|25)` (409 `sprint_running` if one is active), `log(playerId, note: string ≤ 80 chars)` (+5 XP each, max 10, 409 `log_limit`), `finish(playerId)` (prorated base XP, ledger `quest_done` kind with meta `{ sprint: true }`), `current(playerId)`; auto-finish in `tick` when time is up. Emits bus `sprint:started` / `sprint:finished`.
- Routes: `POST /api/sprint/start|log|finish`, `GET /api/sprint?playerId=`. Non-admin proxy allowlist (bridge, Task 5) must allow these POSTs for the linked player.

- [ ] Tests: dice matches energy, falls back to nearest, suggestion when empty, accept creates+starts; sprint start/409, log cap, finish early prorated, tick auto-finish, survives engine restart (DB), XP added to player.
- [ ] Implement, run, commit `feat(server): energy dice and power sprint`

## Part B — Bridge

### Task 5: Celebrations and sprint scene (options + allowlist + server calls)

**Files:** Modify `custom_components/cuest/config_flow.py` (options menu "Celebrations": celebration lights multi-select `light.*`, optional sprint scene `scene.*`, sound on/off note), `forwarder.py` (allow `scene.turn_on` only for the configured sprint scene, one entity), `http.py` (non-admin allowlist adds `sprint/start|log|finish`, `dice/accept`, `shop/open-chest`, player-bound like buy), `strings.json`+`en.json`, `sensor.py` (per-player `streak` sensor, attributes `best_streak`, `chest_keys`), coordinator snapshot fields; server: `services/celebrate.ts` listening to `quest:done`, level-up, `sprint:*` → `hub.callService` with the light/scene targets read from a new server setting `PATCH /api/settings { celebrationLights: string[], sprintScene: string | null }` (admin-only via proxy) that the options flow writes; failures only logged.
- Tests (pytest + vitest): options save lights + scene (server settings PATCH), forwarder allows sprint scene only when configured, refuses others; non-admin proxy allows new play routes only for own player; streak sensor; server celebrate calls flash short/long and scene on sprint start; celebration failure never breaks done.
- [ ] Implement, run all suites, commit `feat: house celebrates with lights and sprint scene`

## Part C — Panel

### Task 6: Rewards, streak, quest of the day, chests in the panel

**Files:** Modify `frontend/src/views/village.ts`, `cuest-panel.ts`, `strings.ts`, `api.ts`; Create `frontend/src/sound.ts` (WebAudio fanfare, no files; mute toggle stored in localStorage try/catch; off by default on first visit until the player taps "Sound on")
- Reward toast lists the reward lines ("Kept going +25", "Combo ×3 +15"…), loot ("You found: Starry cloak!"), chest key, streak line ("Streak: 6 days") or restart copy; level-up variant kept.
- Hero card: streak badge with a pixel flame icon (inline SVG, no emoji) + "6-day streak · 1 rest token"; quest of the day badge on that quest card ("Quest of the day ×3"); "Open chest (N)" button when keys > 0.
- [ ] Tests, build, commit `feat(panel): reward breakdown, streaks, quest of the day and chests`

### Task 7: Energy dice screen

**Files:** Create `frontend/src/views/dice.ts`; Modify nav/village (Village shows "Energy dice" and "Power sprint" buttons like the mockup)
- Mockup "Energy dice": Low / Okay / High toggle, pixel die, Roll, result card (title, minutes, XP, why), "Start (just 2 min)" → start + quest view, "Another" → re-roll; suggestion → "Start" accepts it.
- [ ] Tests, build, commit `feat(panel): energy dice`

### Task 8: Power sprint screen

**Files:** Create `frontend/src/views/sprint.ts`
- Mockup "Power sprint": choose 5/15/25, big mm:ss, progress bar, "Sprint XP so far", tick-off list of open quests (done via normal done), quick-log input (max 80 chars, counter, disabled at 10), "End sprint early (keep all XP)", resumes an active sprint after reload.
- [ ] Tests, build, commit `feat(panel): power sprint`

### Task 9: Collection book and docs

**Files:** Create `frontend/src/views/collection.ts` (in Hero: grid of all wardrobe/decor incl. loot-only; owned = mini sprite/decor preview, not owned = silhouette "?" with hint "Found as loot" or "In the shop"); Modify `docs/install-home-assistant.md` (Celebrations options, dice, sprint, streaks & rest days, quest of the day, loot & chests), `README.md` status, spec status "Plans 1–4 implemented".
- [ ] Tests, build, run all suites, commit `feat(panel): collection book; docs: game layer`
