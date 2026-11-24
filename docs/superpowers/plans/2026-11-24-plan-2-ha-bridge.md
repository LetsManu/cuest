# Cuest Home Assistant Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Cuest to a real Home Assistant: a HACS custom integration ("Cuest bridge") that forwards states and notification buttons, auto-detects appliances from many brands, and gives Home Assistant sensors, events, a to-do list, "complete quest" actions, an NFC blueprint and a dashboard card — so the owner can use Cuest end to end from Home Assistant and the iPhone before the web app exists.

**Architecture:** The server stays the brain. Plan 1's WebSocket protocol gains four message kinds: `entities` (bridge → server, the HA entity registry for auto-detect), `api` / `api_result` (bridge → server REST calls tunnelled over the authenticated socket, executed with Fastify `inject`), `snapshot` (server → bridge, players + visible quests, pushed on change) and `fire_event` (server → bridge, HA bus events). Auto-detect is a pure server module that turns the entity list into suggested quest templates using two new generic rule kinds. The bridge is a Python custom integration at `custom_components/cuest/` (repo root, as HACS requires) with a config flow (server URL + secret) and an options flow (link people to phones, pick suggested devices).

**Tech Stack:** Server: as plan 1 (Node 22, TypeScript, Fastify 5, zod 4, vitest). Bridge: Python 3.13, Home Assistant custom integration APIs (config entries, `async_track_state_change_event`, `todo`, `sensor`, services, `aiohttp` WebSocket client), tests with `pytest-homeassistant-custom-component`. Card: plain JS custom element, no build step.

**Spec:** `docs/superpowers/specs/2026-11-24-cuest-design.md` (goals 3, 7, 9, 10; §7 architecture)

**Builds on:** plan 1 (branch `feat/server-core`). Work on branch `feat/ha-bridge` created from `feat/server-core`.

## Global Constraints

- Plan 1 constraints still hold: no shame (never subtract XP/gold, never delete quests or templates), player-facing strings in `server/src/copy.ts` (bridge: in `custom_components/cuest/strings.json` / `translations/en.json`), no internet/cloud at runtime, timestamps ISO-8601 UTC.
- No game logic in the bridge. The bridge forwards, executes allowed service calls, renders data the server sends, and calls server APIs. Auto-detect decisions are made by the server.
- The bridge only executes `call_service` for domains `notify` and `light`; anything else is refused with `result.ok = false`.
- State messages are real transitions only (never replay current states as transitions on connect/reconnect); `at` = the new state's `last_changed` in ISO-8601 UTC.
- The bridge must authenticate (`hello` with secret) before sending anything else, and must reconnect automatically with backoff (1 s doubling to 60 s max) without user action.
- The integration must not block the HA event loop (all I/O async) and must keep CPU/memory negligible on a Raspberry Pi.
- Normal setup needs no YAML: config flow + options flow only. Integration domain `cuest`; HA events `cuest_quest_opened`, `cuest_quest_done`, `cuest_level_up`; services `cuest.complete_quest`, `cuest.start_quest`.
- Done vocabulary (normalized): `finished, finish, program_ended, programme_ended, end, ended, complete, completed, done, fertig, beendet, programmende, ende`. Running vocabulary: `run, running, washing, wash, main_wash, rinse, rinsing, spin, spinning, drying, dry, in_use, program_running, active, läuft, waschen, trocknen, spülen`. Pause vocabulary: `pause, paused, delayed_start, delayedstart, action_required, actionrequired, pausiert`. Normalize = trim, lower case, spaces and hyphens → `_`.

## Review Focus

1. Bridge reconnects (HA restart, server restart, Wi-Fi drop): it must re-authenticate, re-subscribe, never send stale states as transitions, and never pile up duplicate listeners or duplicate sensors. → Task 7 tests.
2. A washer-dryer combo or a device named "Dishwasher" must not be detected as a plain washer ("dishwasher" contains "washer"). → Task 2 tests.
3. Ticking a quest off in the HA to-do list while the same quest is already done (e.g. from the phone) or unknown: no error shown to the user, the list just refreshes. → Task 9 tests.
4. Server unreachable while the owner runs the config/options flow: a clear form error ("cannot_connect"), never a stack trace or a half-created entry. → Task 8 tests.
5. Many entities (large HA installs: 2000+ entities): the `entities` message must stay under the 64 KB frame limit — the bridge sends only candidate domains (`sensor`, `binary_sensor`, `vacuum`) and chunks if needed. → Tasks 1 and 7 tests.

---

## Part A — Server

### Task 1: Protocol extensions (entities, api, snapshot, fire_event)

**Files:**
- Modify: `server/src/bridge/protocol.ts`, `server/src/bridge/hub.ts`
- Modify: `docs/bridge-protocol.md`
- Test: `server/test/bridge.test.ts`

**Interfaces:**
- Produces (protocol, zod + inferred types):
  - Bridge → server: `{ type: 'entities'; chunk: number; last: boolean; entities: EntityInfo[] }` with `EntityInfo = { entityId: string; domain: string; deviceId: string | null; deviceClass: string | null; platform: string | null; translationKey: string | null; options: string[] | null; unit: string | null; name: string | null; deviceName: string | null; manufacturer: string | null; model: string | null; state: string | null }`; `{ type: 'api'; id: string; method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; path: string; body?: unknown }` (path must start with `/api/`).
  - Server → bridge: `{ type: 'api_result'; id: string; status: number; body: unknown }`; `{ type: 'snapshot'; players: SnapshotPlayer[]; quests: SnapshotQuest[] }` with `SnapshotPlayer = { id; name; haPerson: string | null; level: number; title: string; xp: number; gold: number; intoLevel: number; toNext: number }`, `SnapshotQuest = { id; title; status: 'open' | 'active' | 'whenever'; claimedBy: string | null; xp: number; minutes: number; templateId: string | null; createdAt: string }`; `{ type: 'fire_event'; event: 'cuest_quest_opened' | 'cuest_quest_done' | 'cuest_level_up'; data: Record<string, unknown> }`.
- Produces (hub): `onEntities(fn: (entities: EntityInfo[]) => void)` — called once per complete chunk set (`last: true`), with all chunks of that set concatenated; `setApiHandler(fn: (req: { method; path; body? }) => Promise<{ status: number; body: unknown }>)`; `send(msg: ServerMessage): boolean` (public, used by publisher); `onAuthenticated(fn: () => void)` called right after each successful `welcome` (after the `subscribe` message). `api` requests with a path not starting `/api/` → `api_result` status 400 without calling the handler; handler errors → status 500 + log.

- [ ] **Step 1: Write failing tests**: `entities chunks are joined and delivered once` (2 chunks → one call with both lists); `api request is answered via the handler` (`GET /api/players` → `api_result` with same id, status 200); `api path outside /api is refused with 400`; `handler throwing gives 500 and keeps the socket open`; `send returns false when no bridge`.
- [ ] **Step 2: Run** `npm test -w server -- bridge` → FAIL
- [ ] **Step 3: Implement**; document the four messages with one example each in `docs/bridge-protocol.md` (note: `entities` chunks must each stay < 64 KB; bridge sends only `sensor`, `binary_sensor`, `vacuum`).
- [ ] **Step 4: Run** `npm test -w server && npm run typecheck -w server` → PASS
- [ ] **Step 5: Commit** `feat(server): bridge protocol for entities, api tunnel, snapshot and events`

### Task 2: Auto-detect (rule kinds + detector)

**Files:**
- Modify: `server/src/domain/types.ts` (Rule union), `server/src/services/rules.ts`
- Create: `server/src/domain/vocab.ts`, `server/src/services/detect.ts`
- Test: `server/test/vocab.test.ts`, `server/test/detect.test.ts`, `server/test/rules.test.ts` (extend)

**Interfaces:**
- Produces (`vocab.ts`): `normalizeState(s: string): string`; `DONE_WORDS`, `RUNNING_WORDS`, `PAUSE_WORDS` (readonly string arrays, exact lists from Global Constraints); `classifyAppliance(text: string): 'dishwasher' | 'dryer' | 'washer' | null` — checks, on normalized lower-case text, dishwasher words first (`dishwasher, dish_washer, geschirrspüler, geschirrspueler, spülmaschine, spuelmaschine`), then dryer (`dryer, tumble, trockner`) unless a washer word is also present (washer-dryer combo → `washer`), then washer (`washer, washing, waschmaschine, laundry`).
- Rule union gains:
  - `{ type: 'state'; ...; normalize?: boolean }` — when true, compare `normalizeState(newState)` against `to`/`from` (which are stored normalized).
  - `{ type: 'running_stops'; entityId: string; runningStates: string[]; pauseStates: string[]; numericAbove?: number; forMinutes: number }` — "running" when normalized state ∈ `runningStates`, or state is `on`, or (numericAbove set and numeric value > numericAbove). Becomes "stopped" when not running, not in `pauseStates`, not unavailable/unknown; fires when stopped for `forMinutes` after having been running (same in-memory timer pattern and last-good handling as `power_below`).
- Produces (`detect.ts`): `interface Suggestion { key: string; kind: 'washer' | 'dryer' | 'dishwasher' | 'vacuum'; deviceName: string; entityId: string; method: 'finished_state' | 'running_stops' | 'power' | 'vacuum_state' | 'bin_sensor'; templates: TemplateDraft[] }` where `TemplateDraft = Omit<QuestTemplate, 'id' | 'createdAt' | 'lastSpawnedAt'>`; `detect(entities: EntityInfo[]): Suggestion[]`.
  - Group entities by `deviceId` (entities without device are their own group). Classify a group by `deviceName`, `name`, `model`, `translationKey` joined.
  - For an appliance group pick the first matching method in this order: (1) `sensor` with `options` containing a DONE word after normalizing, or with `translationKey` in `operation_state, status, job_state, machine_state, run_state, current_status, program_phase` → `finished_state` (state rule, `normalize: true`, `to` = DONE words found in options, else all DONE words); (2) `binary_sensor` with `deviceClass` `running` or `power` → `running_stops` (`forMinutes` 2); (3) `binary_sensor` `deviceClass` `vibration` → `running_stops` (`forMinutes` 5); (4) `sensor` with `deviceClass` `power` and unit `W` → `power` (reuse `presetTemplates('<kind>_power')`); (5) `sensor` whose state is in RUNNING words → `running_stops` (`forMinutes` 3).
  - Quest values per kind come from plan 1's presets (washer: Hang up the laundry…, dryer, dishwasher).
  - Every `vacuum` domain entity → `vacuum_state` suggestion with plan 1's two vacuum templates. A `binary_sensor` whose `translationKey`/`name` normalized contains `bin_full` or `dustbin` → `bin_sensor` suggestion.
  - `key` = `${method}:${entityId}`. Sorted: appliances, then vacuums.

- [ ] **Step 1: Write failing tests** (fixtures as plain objects): Home Connect washer (`platform: 'home_connect'`, sensor `translationKey: 'operation_state'`, options `['inactive','ready','run','finished','pause']`) → `finished_state` with `to` = `['finished']`; Miele (`status` options incl. `program_ended`) → `to ['program_ended']`; SmartThings dryer (`job_state` options incl. `finish`) → dryer; device named "Dishwasher" with a power sensor → kind `dishwasher` (Review Focus 2); "Washer Dryer" → `washer`; German "Waschmaschine Keller" Shelly power sensor (`deviceClass: 'power'`, unit `W`) → washer `power`; Roborock `vacuum.robo` → vacuum with 2 templates; unrelated entities (lights, temperature sensors) → no suggestions. Rules: `running_stops` fires after `forMinutes` stopped; pause state doesn't count as stopped; normalized state rule matches `"Program ended"` to `program_ended`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** full server tests + typecheck → PASS
- [ ] **Step 5: Commit** `feat(server): auto-detect appliances and vacuums from HA entities`

### Task 3: Suggestions API and snapshot/event publisher

**Files:**
- Create: `server/src/routes/suggestions.ts`, `server/src/services/publisher.ts`
- Modify: `server/src/app.ts`, `server/src/engine.ts`
- Test: `server/test/suggestions.test.ts`, `server/test/publisher.test.ts`

**Interfaces:**
- Consumes: `detect`, `hub.onEntities`, `hub.setApiHandler`, `hub.send`, Bus, repos, `levelForXp`, `titleForLevel`.
- Produces:
  - Engine keeps the latest entity list in memory (`entities: EntityInfo[]`) from `hub.onEntities`; `hub.setApiHandler` runs requests through `app.inject` (so the bridge reaches the same validated routes).
  - `GET /api/suggestions` → `{ suggestions: (Suggestion & { added: boolean })[] }` where `added` = an enabled template exists with the same rule `entityId` and type. `POST /api/suggestions/accept` `{ keys: string[] }` → 201 `{ templates: QuestTemplate[] }` creating each suggestion's templates once (already-added keys are skipped), then `onTemplatesChanged()`. Unknown key → 400 `{ error: 'unknown_suggestion', keys }`.
  - `class Publisher { constructor(deps: { bus; hub: Pick<BridgeHub,'send'>; players; quests: QuestService; clock }); publishSnapshot(): void }` — sends a `snapshot` after every bus quest event and on each `hub.onAuthenticated`; sends `fire_event` for `quest:opened` (`{ quest_id, title, xp, minutes }`), `quest:done` (`{ quest_id, title, player_id, player_name, xp, gold }`) and `cuest_level_up` when the player's level after the reward is higher than before (`{ player_id, player_name, level, title }`). Player create/update via REST also publishes a snapshot.

- [ ] **Step 1: Write failing tests**: suggestions list marks `added`; accept twice creates templates once; unknown key 400; publisher sends snapshot with level/title after done; `cuest_level_up` fires exactly when crossing 100 XP; snapshot excludes `done` quests.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** full server tests + typecheck → PASS
- [ ] **Step 5: Commit** `feat(server): suggestions API and snapshot/event publishing to the bridge`

## Part B — Home Assistant integration

### Task 4: Integration scaffold, HACS metadata, test harness, CI

**Files:**
- Create: `hacs.json` (`{ "name": "Cuest", "render_readme": true, "homeassistant": "2025.1.0" }`)
- Create: `custom_components/cuest/__init__.py`, `manifest.json` (`domain: cuest`, `name: Cuest`, `config_flow: true`, `iot_class: local_push`, `integration_type: service`, `version: 0.1.0`, `requirements: []`, `dependencies: ["http"]`, `codeowners: ["@LetsManu"]`, `documentation`/`issue_tracker` → GitHub repo URLs), `const.py` (`DOMAIN = "cuest"`, event and service names from Global Constraints, `ALLOWED_DOMAINS = {"notify", "light"}`), `strings.json`, `translations/en.json`
- Create: `bridge-tests/` with `conftest.py` (enables custom integrations), `requirements_test.txt` (`pytest-homeassistant-custom-component==0.13.316`), `pytest.ini` (`asyncio_mode = auto`, `testpaths = bridge-tests`)
- Modify: `.github/workflows/ci.yml` (job `bridge`: Python 3.13, install requirements, `pytest`)
- Test: `bridge-tests/test_init.py`

**Interfaces:**
- Produces: `async_setup_entry(hass, entry) -> bool` / `async_unload_entry(hass, entry) -> bool` (no-op client yet: stores `hass.data[DOMAIN][entry.entry_id] = {}`); `entry.data = { "url": str, "secret": str }`.

- [ ] **Step 1: Write failing test** `test_setup_and_unload_entry` (MockConfigEntry with url/secret → setup True → unload True, `hass.data[DOMAIN]` cleaned).
- [ ] **Step 2: Create venv** `python3 -m venv .venv-bridge && .venv-bridge/bin/pip install -r bridge-tests/requirements_test.txt`; run `.venv-bridge/bin/pytest` → FAIL. Add `.venv-bridge/` to `.gitignore`.
- [ ] **Step 3: Implement** scaffold.
- [ ] **Step 4: Run** `.venv-bridge/bin/pytest` → PASS (no warnings from our code)
- [ ] **Step 5: Commit** `feat(bridge): Home Assistant integration scaffold with HACS metadata and tests`

### Task 5: Bridge WebSocket client (connect, auth, reconnect, api)

**Files:**
- Create: `custom_components/cuest/client.py`
- Modify: `custom_components/cuest/__init__.py`
- Test: `bridge-tests/test_client.py` (uses an in-test aiohttp WebSocket server that speaks the protocol)

**Interfaces:**
- Produces: `class CuestClient: __init__(hass, url: str, secret: str)`; `async start()`, `async stop()`; `connected: bool`; `async api(method: str, path: str, body: Any | None = None, timeout: float = 10) -> tuple[int, Any]` (raises `CuestNotConnected` when down, `asyncio.TimeoutError` on timeout); `on_message(type: str, cb: Callable[[dict], None])` registration; `async send(msg: dict)`. Connects to `<url>/bridge` (http→ws, https→wss), sends `hello` (`version` = manifest version), waits for `welcome`, then dispatches messages to registered callbacks. Reconnect loop with backoff 1 s × 2 up to 60 s, reset after a successful welcome. Close code 4001 (bad secret) → log an error once, raise a repair issue (`ir.async_create_issue`, key `bad_secret`) and keep retrying at 60 s.
- `async_setup_entry` creates and starts the client, stores it in `hass.data[DOMAIN][entry_id]["client"]`; unload stops it.

- [ ] **Step 1: Write failing tests**: `test_client_authenticates_and_receives_welcome`; `test_client_reconnects_after_server_drop` (server closes socket → client reconnects, sends a second hello); `test_api_roundtrip` (`api('GET','/api/players')` → `(200, [...])`); `test_bad_secret_creates_repair_issue`; `test_stop_cancels_reconnect_loop` (no pending tasks after stop).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** with `aiohttp_client.async_get_clientsession(hass)`.
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bridge): websocket client with auth, reconnect and api tunnel`

### Task 6: Forwarding: states, notification buttons, service calls

**Files:**
- Create: `custom_components/cuest/forwarder.py`
- Modify: `custom_components/cuest/__init__.py`
- Test: `bridge-tests/test_forwarder.py`

**Interfaces:**
- Consumes: `CuestClient.on_message`, `send`.
- Produces: `class Forwarder: __init__(hass, client)`, `async_start()`, `async_stop()`:
  - On `subscribe`: replace the tracked entity set (unsubscribe previous listener first — Review Focus 1) using `async_track_state_change_event`; for each event with both old and new state and `old.state != new.state`, send `{type:'state', entityId, oldState, newState, at: new_state.last_changed.isoformat()}`. Never sends current states on subscribe.
  - Listens to `mobile_app_notification_action`; if `event.data["action"]` starts with `CUEST|`, sends `{type:'notification_action', action, at}`.
  - On `call_service`: if `domain` ∉ `ALLOWED_DOMAINS` → send `{type:'result', id, ok:false, error:'domain_not_allowed'}`; else `await hass.services.async_call(domain, service, data, target=target, blocking=True)` and send `result` ok true, or ok false with the exception message (never raises).

- [ ] **Step 1: Write failing tests**: state transition forwarded with ISO `at`; attribute-only change not forwarded; re-subscribe replaces listeners (one change → one message); notification action with `CUEST|` prefix forwarded, others ignored; `switch.turn_on` refused with `domain_not_allowed`; `light.turn_on` executed (mock service registered) and `result ok`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bridge): forward states and notification buttons, run allowed service calls`

### Task 7: Entity export for auto-detect

**Files:**
- Create: `custom_components/cuest/entities_export.py`
- Modify: `custom_components/cuest/__init__.py`
- Test: `bridge-tests/test_entities_export.py`

**Interfaces:**
- Produces: `build_entity_infos(hass) -> list[dict]` (entity + device registry → `EntityInfo` dicts from Task 1; only domains `sensor`, `binary_sensor`, `vacuum`; `options` from state attribute `options` if present; `unit` from `unit_of_measurement`; `name` = registry name or original name or friendly name); `chunk_entity_infos(infos, max_bytes=48_000) -> list[list[dict]]`; `async_send_entities(hass, client)` sends chunks `{type:'entities', chunk, last, entities}`. Called after each successful welcome and (debounced 10 s) on `entity_registry_updated` / `device_registry_updated`.

- [ ] **Step 1: Write failing tests**: a registered Home Connect-like sensor with device → info has `deviceName`, `manufacturer`, `options`; `light.*` excluded; 3000 synthetic entities chunk into pieces each < 48 000 bytes JSON and the last has `last: true` (Review Focus 5); entities resent after reconnect (welcome).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bridge): export HA entities for auto-detect`

### Task 8: Config flow and options flow

**Files:**
- Create: `custom_components/cuest/config_flow.py`
- Modify: `strings.json`, `translations/en.json`
- Test: `bridge-tests/test_config_flow.py`

**Interfaces:**
- Config flow `user` step: fields `url` (default `http://homeassistant-nas.local:8787` placeholder text only; required), `secret` (required). Validates by opening a temporary connection and completing hello/welcome (helper `async_validate(hass, url, secret) -> None` raising `CannotConnect` / `InvalidAuth`). Errors: `cannot_connect`, `invalid_auth`. Unique id = normalized url; abort `already_configured`. Title "Cuest".
- Options flow (menu): `people` and `devices`.
  - `people`: multi-select of HA `person.*` entities; for each selected person a dropdown of `notify` services starting with `mobile_app_` (from `hass.services.async_services()["notify"]`). On submit, for each person: find player with that `haPerson` via `GET /api/players` → `PATCH` or `POST /api/players { name: person friendly name, haPerson: entity_id, notifyService }`.
  - `devices`: `GET /api/suggestions`; multi-select of suggestions not yet added (label `"{deviceName}: {first template title}"`); submit → `POST /api/suggestions/accept`. If none: show "No new devices found" description.
  - Any `CuestNotConnected` / timeout → form error `cannot_connect` (Review Focus 4).

- [ ] **Step 1: Write failing tests**: happy path creates entry; wrong secret → `invalid_auth`; unreachable → `cannot_connect`; duplicate url aborts; options `people` creates a player with normalized notify service; options `devices` accepts selected keys; server down during options → `cannot_connect` and no entry change.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bridge): config flow and options for people and auto-detected devices`

### Task 9: Sensors, to-do list, services and events in Home Assistant

**Files:**
- Create: `custom_components/cuest/coordinator.py`, `sensor.py`, `todo.py`, `services.py`, `services.yaml`
- Modify: `__init__.py` (forward platforms `sensor`, `todo`; register services; `fire_event` → `hass.bus.async_fire`)
- Test: `bridge-tests/test_entities.py`, `bridge-tests/test_todo.py`, `bridge-tests/test_services.py`

**Interfaces:**
- `CuestData` (coordinator-like holder, `DataUpdateCoordinator` not needed): latest `snapshot`, listeners notified on each `snapshot` message.
- Sensors per player (unique ids `cuest_<playerId>_<key>`): `level` (attributes `title`, `into_level`, `to_next`), `xp`, `gold`; one global `cuest_open_quests` (count of open+active, attribute `quests` = list of titles). Players added later create new sensors without duplicates (Review Focus 1).
- To-do entity `todo.cuest_quests` ("Cuest quests"): items = snapshot quests (uid = quest id, summary = title, status `needs_action`); feature `UPDATE_TODO_ITEM`; marking an item `completed` → `api('POST', f'/api/quests/{id}/done', {playerId})` where playerId = player whose `haPerson` matches the calling user's person (`person` entity with `user_id == context.user_id`), else the first player. 409/404 → ignored, list refreshes (Review Focus 3).
- Services `cuest.complete_quest` / `cuest.start_quest` with fields `quest_id` (optional), `template_title` (optional, matches the newest visible quest with that title, case-insensitive), `person` (optional person entity → player). Missing match → `ServiceValidationError` with translation key `quest_not_found`.
- `fire_event` messages → `hass.bus.async_fire(event, data)`.

- [ ] **Step 1: Write failing tests**: snapshot creates sensors with right values and updates them; second snapshot with new player adds sensors once; todo lists open quests; completing a todo item calls the done API with the mapped player; completing an already-done item (API 409) raises nothing; `cuest.complete_quest` by `template_title`; unknown title → `ServiceValidationError`; `fire_event` reaches the HA bus.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(bridge): sensors, to-do list, services and events in Home Assistant`

### Task 10: Dashboard card, NFC blueprint, owner install guide

**Files:**
- Create: `custom_components/cuest/frontend/cuest-card.js` (custom element `cuest-card`, registered in `window.customCards`), served via `hass.http.async_register_static_paths` at `/cuest/cuest-card.js` and added with `frontend.add_extra_js_url` in `async_setup_entry`
- Create: `blueprints/automation/cuest/nfc_complete_quest.yaml` (input: NFC tag, quest title; trigger `tag_scanned`; action `cuest.complete_quest` with `template_title` and the scanning person if available)
- Create: `docs/install-home-assistant.md`
- Modify: `README.md` (link the guide)
- Test: `bridge-tests/test_frontend.py`

**Interfaces:**
- Card config: `{ type: 'custom:cuest-card', person?: 'person.x' }`. Renders (from `hass.states`): the player's pixel hero (same 24×28 sprite and stage rules as the mockups: level 1–3 / 4–7 / 8+), `Level N · Title`, XP bar from `cuest_<player>_level` attributes, gold, and the open quests from `todo.cuest_quests` with a "Done" button each calling `cuest.complete_quest` with `quest_id`. No external requests; cozy palette from the mockups; works in HA light and dark themes using HA CSS variables for the card background/text.
- Install guide for a non-developer: start the server (docker compose on PC/NAS, find the bridge secret), add the HACS custom repository `https://github.com/LetsManu/cuest`, install Cuest, add integration (URL + secret), options → People (pick yourself + your iPhone), options → Devices (tick suggestions), add the dashboard card, optional NFC blueprint. Plain language, numbered steps.

- [ ] **Step 1: Write failing test**: after setup, `GET /cuest/cuest-card.js` via `hass_client` returns 200 with `customElements.define('cuest-card'`; blueprint YAML parses and declares `domain: automation`.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** card, blueprint, guide.
- [ ] **Step 4: Run** bridge tests + server tests → PASS
- [ ] **Step 5: Commit** `feat(bridge): dashboard card, NFC blueprint and install guide`
