# Cuest Web App and Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cozy Cuest app as a Home Assistant sidebar panel ("Cuest", `/cuest`) with the village, quests, the 2-minute quest timer, the hero, and a shop where gold buys house treats, hero wardrobe, village decor and helpers.

**Architecture:** Server gains a shop (catalog in code, owned items, equipped outfit, decor, rest-day tokens, double-XP potion) and owner-configured house treats ("unlocks"). The UI is a Lit web component bundle built from a new `frontend/` workspace with esbuild and served by the integration; the panel reaches the server through a new authenticated Home Assistant HTTP endpoint (`/api/cuest/...`) that forwards over the existing bridge `api` tunnel. The dashboard card moves into the same build and shares the sprite code, so both show the player's outfit.

**Tech Stack:** Server as before (Node 22, TS, Fastify 5, zod 4, node:sqlite, vitest). Bridge as before (Python 3.13, HA custom integration, pytest-homeassistant-custom-component). Frontend: TypeScript, `lit@3.3.3`, `esbuild@0.28.2`, vitest + `happy-dom@21.0.4`.

**Spec:** `docs/superpowers/specs/2026-11-24-cuest-design.md` (goals 2, 4, 5, 11; §7 bridge panel + house treats)

**Builds on:** plans 1 and 2 (merged to `main`). Branch `feat/web-app`.

## Global Constraints

- No shame: Cuest never takes XP, gold or levels away. The only gold decrease is a purchase the player chose; it must never make gold negative and must be recorded in the ledger (`kind: 'purchase'`). Quests/templates never deleted.
- Player-facing text lives in `server/src/copy.ts` (server), `custom_components/cuest/strings.json` + `translations/en.json` (identical; integration), and `frontend/src/strings.ts` (UI). English first, translation-ready. Never use "overdue", "late", "failed", "missed", "penalty".
- The bridge stays logic-free. It executes `call_service` only for `notify`/`light` (any entity, as before) and for `turn_on` on entities the owner listed in the options as house treats (domains `scene`, `script`, `switch`, `input_boolean`), with exactly one target entity.
- The panel never talks to the Cuest server directly; only through `/api/cuest/...` on Home Assistant (authenticated by HA).
- UI look matches the mockups and test run: cozy fantasy RPG, Pixelify-style pixel headings with a local fallback (no external font requests), Nunito-like body via system font stack, parchment `#F4EAD5`, card `#FFF9EC`, line `#E3D3B2`, ink `#2B2A33`, muted `#6B5E4B`, forest `#2F5D50`, amber `#E0A43A`, dusk `#2E3550`, grass `#3F6B4F`. Touch targets ≥ 44 px. Must work at 360 px phone width and on a wall tablet. No external network requests from the UI.
- Built bundles (`custom_components/cuest/frontend/cuest-panel.js`, `cuest-card.js`) are committed (HACS installs from the repo) and CI fails if they are out of date with `frontend/src`.

## Shop catalog (exact values)

| id | kind | name | cost | data |
|---|---|---|---|---|
| hood_ember | wardrobe (slot hood) | Ember hood | 40 | palette G `#B5523B`, L `#D47A5E`, g `#8E3E2C` |
| hood_night | wardrobe (slot hood) | Night-sky hood | 70 | G `#3D5A8A`, L `#F7D27A`, g `#2C4370` |
| scarf_teal | wardrobe (slot scarf) | Teal scarf | 25 | y `#7CC4BF`, Y `#3E8E8A` |
| broom_gold | wardrobe (slot broom) | Golden broom | 80 | T `#B07A1E`, F `#F7D27A`, f `#E0A43A` |
| lantern | decor | Village lantern | 30 | — |
| flowers | decor | Flower bed | 20 | — |
| cat | decor | Village cat | 60 | — |
| fountain | decor | Little fountain | 90 | — |
| rest_token | helper | Rest-day token | 50 | +1 rest token (used by streaks in plan 4) |
| mystery_chest | helper | Mystery chest | 40 | 50 %: a random not-yet-owned wardrobe item; otherwise 20–80 gold (inclusive); if all wardrobe owned → gold |
| xp_potion | helper | Double XP hour | 70 | `boostUntil = max(now, boostUntil) + 60 min`; quests finished while boosted give double XP (gold unchanged) |
| treat:<unlockId> | treat | owner-defined | owner-defined | `turn_on` on the unlock's entity |

Wardrobe and decor are owned once (buying again → 409 `already_owned`). Helpers and treats can be bought repeatedly.

## Review Focus

1. Bridge offline when buying a house treat: no gold is spent, the player sees a friendly "Home Assistant isn't connected right now" message. → Task 3 tests.
2. Double tap / two devices buying at once: one purchase per request, gold never negative, no item granted without payment. → Tasks 1, 3 tests.
3. Server asks the bridge to `turn_on` an entity the owner did not list (or `turn_off`, or two targets): refused with `result.ok = false`. → Task 5 tests.
4. Panel opened by a Home Assistant user who is not linked to a player, or with no players at all: a friendly picker/onboarding, never a blank page or a crash. → Task 7 tests.
5. The HA proxy endpoint: path traversal (`../`, encoded), non-API paths and unsupported methods are refused; anonymous requests get 401 from HA. → Task 4 tests.

---

## Part A — Server

### Task 1: Shop core (catalog, inventory, purchases, outfit)

**Files:**
- Modify: `server/src/db/migrate.ts` (migration 2), `server/src/domain/types.ts`, `server/src/repos/players.ts`, `server/src/repos/ledger.ts`
- Create: `server/src/shop/catalog.ts`, `server/src/repos/items.ts`, `server/src/services/shop.ts`
- Modify: `server/src/copy.ts`
- Test: `server/test/shop.test.ts`, `server/test/repos.test.ts` (extend)

**Interfaces:**
- Migration 2: `players` + `rest_tokens INTEGER NOT NULL DEFAULT 0`, `boost_until TEXT`; new tables `player_items(player_id TEXT REFERENCES players(id), item_id TEXT, count INTEGER NOT NULL, PRIMARY KEY(player_id,item_id))`, `equipped(player_id TEXT REFERENCES players(id), slot TEXT, item_id TEXT NOT NULL, PRIMARY KEY(player_id,slot))`. Existing DBs upgrade in place.
- Types: `Player` gains `restTokens: number`, `boostUntil: string | null`; `LedgerEntry.kind` = `'quest_done' | 'purchase'`; `type Slot = 'hood' | 'scarf' | 'broom'`; `type ShopItem = { id; kind: 'wardrobe' | 'decor' | 'helper' | 'treat'; name; cost; slot?: Slot; palette?: Record<string,string> }`.
- `catalog.ts`: `CATALOG: readonly ShopItem[]` (exact table above, names from `copy.shop.*`), `findItem(id): ShopItem | null`.
- `PlayersRepo.spendGold(id, amount): Player` — single `UPDATE ... SET gold = gold - ? WHERE id = ? AND gold >= ?`; throws `ShopError('not_enough_gold')` when no row changed. `addRestTokens(id, n)`, `setBoostUntil(id, iso | null)`.
- `ItemsRepo`: `owned(playerId): Record<string, number>`, `grant(playerId, itemId, n = 1)`, `equipped(playerId): Partial<Record<Slot,string>>`, `equip(playerId, slot, itemId | null)`.
- `class ShopError extends Error { code: 'unknown_item' | 'already_owned' | 'not_enough_gold' | 'not_owned' | 'unknown_player' | 'bridge_offline' }`.
- `class ShopService { constructor(deps: { players; items; ledger; tx: <T>(fn: () => T) => T; clock: Clock; rng?: () => number }) ; buy(playerId: string, itemId: string): BuyResult ; equip(playerId: string, slot: Slot, itemId: string | null): Player ; view(playerId): ShopView }` where `BuyResult = { player: Player; result: { kind: 'item'; itemId } | { kind: 'rest_token' } | { kind: 'potion'; boostUntil: string } | { kind: 'chest'; itemId: string } | { kind: 'chest'; gold: number } }` and `ShopView = { gold; restTokens; boostUntil; owned; equipped; catalog: (ShopItem & { owned: boolean })[] }`. `buy` runs spend + grant + ledger (`{ kind: 'purchase', gold: -cost, xp: 0, meta: { itemId } }`) in one transaction; chest gold is added inside the same transaction. Equipping an item not owned → `not_owned`. Treat items are handled in Task 3 (here `buy('treat:…')` → `unknown_item`).

- [ ] **Step 1: Write failing tests**: migration 2 upgrades a v1 DB (players keep xp/gold); buying `hood_ember` with 100 gold → gold 60, owned, ledger purchase −40; buying it again → `already_owned`, gold unchanged; buying with 10 gold → `not_enough_gold`, nothing granted (Review Focus 2); two sequential buys of `xp_potion` extend boost to +120 min; chest with rng 0.2 grants an unowned wardrobe item, with rng 0.8 grants gold in 20–80; chest when all wardrobe owned gives gold; equip owned/unowned; `spendGold` never goes below zero.
- [ ] **Step 2: Run** `npm test -w server` → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** full server tests + typecheck → PASS
- [ ] **Step 5: Commit** `feat(server): shop catalog, inventory, purchases and outfits`

### Task 2: Double XP, snapshot with outfit and decor

**Files:**
- Modify: `server/src/domain/rewards.ts`, `server/src/services/quests.ts` (pass player to reward), `server/src/bridge/protocol.ts`, `server/src/services/publisher.ts`, `server/src/copy.ts`, `docs/bridge-protocol.md`
- Test: `server/test/rewards.test.ts`, `server/test/publisher.test.ts` (extend)

**Interfaces:**
- `computeReward(input: { quest; startedAt; doneAt; boostUntil?: string | null })`: when `boostUntil > doneAt` add line `{ label: copy.rewardDoubleXp ('Double XP hour'), xp: quest.xp, gold: 0 }` (total XP doubled). `QuestService.done` passes the player's `boostUntil`.
- `SnapshotPlayer` gains `outfit: { items: { hood: string | null; scarf: string | null; broom: string | null }; palette: Record<string,string> }` (palette = merged overrides of the equipped items), `decor: string[]` (owned decor ids), `restTokens: number`, `boostUntil: string | null`.
- Publisher also publishes a snapshot after each purchase/equip (bus event `shop:changed` emitted by ShopService).

- [ ] **Step 1: Write failing tests**: done during boost → XP doubled, line present, gold unchanged; after boost ends → normal; snapshot contains equipped palette merge and decor ids; purchase triggers snapshot.
- [ ] **Step 2–4:** run → FAIL, implement, run full suite + typecheck → PASS
- [ ] **Step 5: Commit** `feat(server): double XP hour and outfit/decor in snapshots`

### Task 3: House treats (unlocks) and shop API

**Files:**
- Modify: `server/src/db/migrate.ts` (migration 3: `unlocks(id TEXT PRIMARY KEY, name TEXT NOT NULL, cost INTEGER NOT NULL, entity_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)`)
- Create: `server/src/repos/unlocks.ts`, `server/src/routes/shop.ts`, `server/src/routes/unlocks.ts`
- Modify: `server/src/services/shop.ts`, `server/src/app.ts`, `server/src/engine.ts`, `server/src/copy.ts`
- Test: `server/test/shop-api.test.ts`

**Interfaces:**
- `UnlocksRepo`: `create({ name, cost, entityId }, now)`, `list({ enabledOnly? })`, `get`, `update`, never delete (disable).
- ShopService gains deps `unlocks: UnlocksRepo; hub: Pick<BridgeHub, 'callService' | 'isConnected'>`. `buy(playerId, 'treat:<id>')`: unknown/disabled → `unknown_item`; bridge not connected → `bridge_offline` (nothing spent); else spend + ledger in a transaction, then `hub.callService(domainOf(entityId), 'turn_on', {}, { entity_id: entityId })`; if `callService` returns false → refund in the same request (add gold back with ledger `purchase` +cost, meta `{ refund: true }`) and throw `bridge_offline`. `view()` lists enabled treats as catalog items `treat:<id>`.
- Routes (zod-validated; errors → 404 unknown_player/unknown_item, 409 already_owned/not_enough_gold/not_owned, 503 bridge_offline, body `{ error, message }` with messages from `copy.shop.errors`):
  - `GET /api/shop?playerId=` → `ShopView`
  - `POST /api/shop/buy` `{ playerId, itemId }` → 200 `BuyResult`
  - `POST /api/shop/equip` `{ playerId, slot, itemId | null }` → 200 `Player`
  - `GET /api/unlocks`, `POST /api/unlocks` `{ name, cost, entityId }` (entityId `^(scene|script|switch|input_boolean)\.[a-z0-9_]+$`), `PATCH /api/unlocks/:id`, `DELETE /api/unlocks/:id` (disable).
- Friendly copy (exact): `not_enough_gold`: "Not quite enough gold yet. A few more quests and it's yours!"; `already_owned`: "You already have this one."; `bridge_offline`: "Home Assistant isn't connected right now, so this treat can't switch on. Your gold is safe."; `not_owned`: "Get this one in the shop first."

- [ ] **Step 1: Write failing tests**: treat purchase calls `turn_on` with the entity and spends gold; bridge offline → 503, gold unchanged (Review Focus 1); callService false after spend → refunded, 503; unlock entity validation rejects `lock.front_door`; API happy paths and each error code; disabled unlock not in catalog.
- [ ] **Step 2–4:** run → FAIL, implement, run full suite + typecheck → PASS
- [ ] **Step 5: Commit** `feat(server): house treats and shop API`

## Part B — Bridge

### Task 4: Authenticated proxy endpoint for the panel

**Files:**
- Create: `custom_components/cuest/http.py`
- Modify: `custom_components/cuest/__init__.py`
- Test: `bridge-tests/test_http.py`

**Interfaces:**
- `class CuestProxyView(HomeAssistantView)`: `url = "/api/cuest/{path:.+}"`, `name = "api:cuest"`, `requires_auth = True`; methods `get`, `post`, `patch`, `delete` → validate `path` (reject `..`, `%2e`, `%2f`, `%5c` case-insensitive, backslash, control chars; must match `^[a-z0-9_/\-]+$` before the query string) → `client.api(method, "/api/" + path + query, body)` → `web.json_response(body, status=status)`. Not connected / timeout → 503 `{ "error": "bridge_offline" }`. Body: JSON for POST/PATCH (invalid JSON → 400).
- `class CuestWhoAmIView(HomeAssistantView)`: `url = "/api/cuest_whoami"`, requires_auth; returns `{ "playerId": str | None, "isAdmin": bool, "players": [{id, name}] }` using the request's `hass_user` → person (`user_id` attribute) → snapshot player with that `haPerson`.
- Registered once per HA run (guard like the card registration).

- [ ] **Step 1: Write failing tests** with `hass_client`: GET proxied with status/body passthrough; POST body forwarded; traversal/encoded paths → 400 and client.api not called (Review Focus 5); unauthenticated client (`hass_client_no_auth`) → 401; bridge down → 503; whoami maps linked user → playerId, unlinked → null with players list.
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS
- [ ] **Step 5: Commit** `feat(bridge): authenticated proxy endpoint for the Cuest panel`

### Task 5: House treats in options + entity allowlist

**Files:**
- Modify: `custom_components/cuest/config_flow.py`, `forwarder.py`, `const.py`, `strings.json`, `translations/en.json`
- Test: `bridge-tests/test_config_flow.py`, `bridge-tests/test_forwarder.py` (extend)

**Interfaces:**
- Options menu gains `treats` ("House treats"): step 1 multi-select `EntitySelector(domain=["scene","script","switch","input_boolean"], multiple=True)` pre-filled from `entry.options["treats"]`; step 2 one form per selected entity: `name` (default friendly name) and `cost` (NumberSelector 5–1000, default 50). On save: for each entity create or update the server unlock (`GET/POST/PATCH /api/unlocks`, matched by `entityId`), disable server unlocks whose entity was removed, then save `entry.options["treats"] = [entity_id, ...]` (options save keeps other keys). Server errors → `cannot_connect` / `server_rejected` as in plan 2.
- Forwarder: `call_service` allowed if (domain in `ALLOWED_DOMAINS`) OR (`service == "turn_on"` and domain in `TREAT_DOMAINS = {"scene","script","switch","input_boolean"}` and `target.entity_id` is a single string in `entry.options["treats"]` and starts with `domain + "."`). Anything else → `result ok:false error:'not_allowed'`. Forwarder reads the current options on each call (options can change at runtime).

- [ ] **Step 1: Write failing tests**: treats options create unlocks and store allowlist; removing an entity disables its unlock; forwarder executes `script.turn_on` for an allowlisted script; refuses non-listed entity, `turn_off`, list target, domain mismatch (Review Focus 3).
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS
- [ ] **Step 5: Commit** `feat(bridge): house treats with an owner-chosen allowlist`

## Part C — Frontend

### Task 6: Frontend workspace, shared sprite, card rebuild, CI

**Files:**
- Create: `frontend/package.json` (workspace `frontend`, scripts `build` = `node build.mjs`, `test` = `vitest run`, `typecheck` = `tsc --noEmit`), `frontend/tsconfig.json`, `frontend/build.mjs` (esbuild: entries `src/cuest-card.ts` → `../custom_components/cuest/frontend/cuest-card.js`, `src/cuest-panel.ts` → `../custom_components/cuest/frontend/cuest-panel.js` (placeholder panel element until Task 7), `format: 'esm'`, `bundle: true`, `minify: true`, `target: 'es2020'`, `legalComments: 'none'`), `frontend/vitest.config.ts` (environment happy-dom)
- Create: `frontend/src/sprite.ts` (ROWS, palette, stage rules, `spriteShadow(stage, px, overrides?)`, `stageForLevel(level)`), `frontend/src/palette.ts` (UI colors), `frontend/src/strings.ts`, `frontend/src/hass-types.ts` (minimal `HomeAssistant` type), `frontend/src/cuest-card.ts` (Lit port of the current card: same behaviour, Ruling-1 attribute lookup, plus outfit palette from the level sensor attribute `outfit_palette` and decor list `decor`)
- Modify: root `package.json` (`workspaces: ["server", "frontend"]`, root scripts run both), `.github/workflows/ci.yml` (job `frontend`: `npm ci`, `npm run typecheck -w frontend`, `npm test -w frontend`, `npm run build -w frontend`, `git diff --exit-code custom_components/cuest/frontend`), `custom_components/cuest/sensor.py` (level sensor attributes `outfit_palette`, `decor`, `rest_tokens`, `boost_until` from the snapshot)
- Test: `frontend/test/sprite.test.ts`, `frontend/test/card.test.ts`; `bridge-tests/test_entities.py` (new attributes)

- [ ] **Step 1: Write failing tests**: `stageForLevel` 3→1, 4→2, 8→3; `spriteShadow` applies overrides (an Ember hood changes the `G` color); card renders player name/level from fake hass, escapes a `<img onerror>` quest title (no element created), shows empty state with no players; level sensor exposes `outfit_palette`.
- [ ] **Step 2: Install** (`npm install -w frontend lit@3.3.3 && npm install -D -w frontend esbuild@0.28.2 vitest happy-dom@21.0.4 typescript@^5.9`), run → FAIL
- [ ] **Step 3: Implement**; build; delete nothing else (the built `cuest-card.js` replaces the hand-written one).
- [ ] **Step 4: Run** frontend tests + typecheck + build, bridge tests (card served test still passes), server tests → PASS; `git diff --exit-code` after a rebuild is clean.
- [ ] **Step 5: Commit** `feat(frontend): Lit build for the card with shared pixel sprite`

### Task 7: Panel shell, registration and the Village

**Files:**
- Create: `frontend/src/api.ts`, `frontend/src/cuest-panel.ts`, `frontend/src/views/village.ts`
- Modify: `custom_components/cuest/__init__.py` (serve `/cuest/cuest-panel.js`; register panel once: `frontend.async_register_built_in_panel(hass, "custom", sidebar_title="Cuest", sidebar_icon="mdi:sword", frontend_url_path="cuest", config={"_panel_custom": {"name": "cuest-panel", "module_url": "/cuest/cuest-panel.js", "embed_iframe": False, "trust_external": False}}, require_admin=False)`; remove it on last unload)
- Test: `frontend/test/panel.test.ts`, `bridge-tests/test_frontend.py` (extend)

**Interfaces:**
- `api.ts`: `class CuestApi { constructor(hass); whoami(): Promise<{playerId, isAdmin, players}>; quests(); summary(playerId); shop(playerId); start(questId, playerId); done(questId, playerId); later(questId); buy(playerId, itemId); equip(playerId, slot, itemId | null) }` using `hass.callApi(method, 'cuest/...')` and `hass.callApi('GET', 'cuest_whoami')`; errors carry the server's friendly `message`.
- `<cuest-panel>` (properties `hass`, `narrow`, `route`, `panel`): loads whoami; if `playerId` null → "Who's playing?" picker (players list) remembered in `localStorage` (try/catch); if no players → onboarding text ("Open Settings → Devices & services → Cuest → Configure → People and their phones"). Bottom nav: Village, Shop, Hero. Refetch on Cuest sensor state changes (same signature trick as the card) and every 30 s while visible. Bridge offline → friendly banner, last data kept.
- Village view: matches the mockup — top bar (Cuest + gold), dusk hero card with sprite (outfit + decor), level/title, XP bar, "The house needs you" quest cards (title, source line, minutes, +XP, "Just 2 minutes" → start + go to Quest screen, "Later"), "N quests resting in the Whenever pool. No rush." with expandable list ("Do it now"). Empty state "All quiet".
- Panel works with `narrow` (phone) and wide (tablet: max content width 720 px centered).

- [ ] **Step 1: Write failing tests** (happy-dom, fake hass with `callApi` stub): linked user sees their village; unlinked user sees picker and picking stores the choice; no players → onboarding (Review Focus 4); quest card "Just 2 minutes" calls start; bridge offline banner on 503. Bridge: panel registered once, URL `/cuest`, module served.
- [ ] **Step 2–4:** run → FAIL, implement, build, run all suites → PASS
- [ ] **Step 5: Commit** `feat(panel): Cuest sidebar panel with village and quests`

### Task 8: Quest timer and Hero screens

**Files:**
- Create: `frontend/src/views/quest.ts`, `frontend/src/views/hero.ts`
- Modify: `frontend/src/cuest-panel.ts`, `frontend/src/strings.ts`
- Test: `frontend/test/quest-hero.test.ts`

**Interfaces:**
- Quest view (mockup "Just 2 minutes"): dusk background, "Quest started", title, SVG ring counting down 2:00 from `startedAt` (uses `Date.now()`, injectable clock for tests), "Only 2 minutes. Stop whenever you like, it still counts.", buttons "Done! +N XP" (→ done, reward toast showing XP/gold and level-up), "Stop for now (still counts)" (→ done), "Back to the village". If boost active, the done button shows "Done! +2N XP".
- Hero view: big sprite with outfit, title + level, XP bar, "Path of the hero" (Apprentice L1, Hearthkeeper L4, Hearth Warden L8; unreached = silhouette), stats (quests done from summary if available else omitted, total XP, gold, rest tokens).
- Reward toast with level-up variant (amber) — copy from strings.ts, no shame words.

- [ ] **Step 1: Write failing tests**: ring shows 1:30 after 30 s (fake clock); done calls API and shows toast; level-up toast when level increases; hero shows silhouette for unreached stages and outfit palette applied.
- [ ] **Step 2–4:** run → FAIL, implement, build, run → PASS
- [ ] **Step 5: Commit** `feat(panel): quest timer and hero screens`

### Task 9: Shop, wardrobe and village decor

**Files:**
- Create: `frontend/src/views/shop.ts`
- Modify: `frontend/src/views/village.ts` (decor in the hero scene), `frontend/src/cuest-panel.ts`, `frontend/src/strings.ts`
- Test: `frontend/test/shop.test.ts`

**Interfaces:**
- Shop view (mockup "Treasure shop"): gold header ("Earned from quests. Never taken away."), tabs House treats / Wardrobe / Village / Helpers; each item row with swatch (wardrobe swatch = mini sprite with that palette), name, description, button: `N gold` (amber) when affordable, `N to go` (dashed, disabled) when not, `Wear`/`Wearing` for owned wardrobe (toggle equip), `In village` for owned decor. Buying shows a toast with the result (chest reveals item or gold; potion shows "Double XP until HH:MM"; treat "Enjoy!"). Server error messages shown as friendly toasts. Footer: "Treats only switch things on. Your devices always work normally too." Double-tap guard: a pending purchase disables its button until the response arrives (Review Focus 2).
- Village decor drawn in the hero scene for owned `lantern`, `flowers`, `cat`, `fountain` (CSS pixel shapes as in the test run; fountain: small blue/stone pixel shape).
- Boost banner "Double XP until HH:MM" on Village while active.

- [ ] **Step 1: Write failing tests**: affordable/unaffordable button states; buy calls API once even on double click; equip toggles; chest result toast; owned decor appears in village scene; treat purchase 503 shows "Your gold is safe" message.
- [ ] **Step 2–4:** run → FAIL, implement, build, run all suites → PASS
- [ ] **Step 5: Commit** `feat(panel): shop, wardrobe and village decor`

### Task 10: Docs

**Files:**
- Modify: `docs/install-home-assistant.md` (new sections: open the Cuest sidebar page; set up House treats incl. how to make a "1 hour" script; buying and wearing), `README.md` (status), `docs/bridge-protocol.md` (snapshot fields), `docs/superpowers/specs/2026-11-24-cuest-design.md` status line ("Plans 1–3 implemented")

- [ ] **Step 1:** Update docs; check every UI label quoted exists in `frontend/src/strings.ts` / `strings.json`.
- [ ] **Step 2: Run** all suites once (server, bridge, frontend) → PASS
- [ ] **Step 3: Commit** `docs: panel, house treats and shop`
