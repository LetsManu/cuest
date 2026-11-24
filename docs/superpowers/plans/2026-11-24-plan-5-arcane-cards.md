# Cuest Arcane Hearth Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship eleven "Arcane Hearth" Lovelace cards inside the Cuest Home Assistant integration (one new bundle, no HACS), plus a theme and ready-to-paste YAML so the owner can rebuild the Overview, Quest board, Home control and Desktop dashboards.

**Architecture:** One new esbuild entry `frontend/src/arcane/index.ts` → `custom_components/cuest/frontend/cuest-arcane.js`, served and loaded exactly like `cuest-card.js`. All house logic (areas, lights, online share, faults, resting allies, batteries, players) is pure functions in `frontend/src/arcane/house.ts` over the `hass` object; history fetching and resampling live in `history.ts`; every card is a thin Lit element on a shared `ArcaneCard` base (config validation, re-render gating, fonts, error/warning panels). Only the quest board talks to Cuest (`POST /api/cuest/quests` through the existing admin proxy).

**Tech Stack:** unchanged frontend (Lit 3.3.3, esbuild, TypeScript strict, vitest + happy-dom); bridge (Python HA integration, pytest-homeassistant-custom-component in `bridge-tests/`, venv `.venv-bridge`).

**Spec:** the approved mockups (copied into the repo in Task 1): `docs/superpowers/specs/arcane-hearth/FinalOverview.dc.html`, `FinalFaults.dc.html`, `FinalControl.dc.html`, `FinalDesktop.dc.html`, `ArcaneCards.dc.html`, plus the card list in this plan. Colours, sizes, copy and animations come from those files; where this plan's Exact values differ, this plan wins.

**Builds on:** plans 1–4 (`feat/game-layer`). Branch `feat/arcane-cards`.

**Out of scope (decided):** the mockup's `arcane-flow-card` and `arcane-bars-card` (not in the card list); the trail card's tap-to-switch 24 h / 7 d / 30 d (use the `hours` option instead); a room-chip filter card (Home control uses one heading + tile grid per room); full-bleed edge-to-edge header (it is a rounded card inside the view).

## Global Constraints

- Plan 1–4 constraints hold: no shame, never "overdue/late/failed/missed/penalty"; also never "broken/dead/offline/error/fault" in shown copy (faults are "small quests", offline integrations are "resting allies"). All arcane copy lives in `frontend/src/arcane/copy.ts` (one source; keeps `strings.ts` and the existing bundles unchanged).
- No emoji anywhere. Icons are inline SVG (`aria-hidden="true"`) or `<ha-icon>` for `mdi:` names.
- Every SVG graph has `role="img"` and an `aria-label` with the real numbers (e.g. "Mana: 88 percent of devices online"). Touch targets ≥ 44 × 44 px.
- Animations are CSS only, defined once in `theme.ts`, and all stop under `@media (prefers-reduced-motion: reduce)` (`.spark` and `.shimmer` are also hidden there).
- Fonts: one `<link id="cuest-arcane-fonts">` to Google Fonts added to `document.head` by the first card; stacks fall back to `ui-monospace, monospace` / `system-ui, sans-serif`.
- No rendered `NaN`, `undefined` or `null` text: unknown/unavailable/non-numeric values show `—` (or the card's resting copy).
- Bad config: `setConfig` throws `Error("<tag>: <what is wrong>")` so HA shows its error card. A configured entity that is missing at runtime renders an in-card warning panel ("Entity not found: sensor.x"), never a throw.
- Performance: history fetched at most once per 5 minutes per trail card (and on config change); cards re-render only when their signature (the slice of `hass` they show) changes; the only timer is the header clock, once per minute, aligned to the minute and cleared on disconnect. No per-second re-render (the bard's progress is recomputed only when `hass` changes).
- SVG ids (gradients, clip paths) are unique per element inside one shadow root (`orb-0-clip`, `orb-1-clip`, …).
- The committed bundle `custom_components/cuest/frontend/cuest-arcane.js` is rebuilt and committed in every task that changes `frontend/src/arcane/` (CI runs `git diff --exit-code custom_components/cuest/frontend`). `cuest-card.js` and `cuest-panel.js` must not change.

## Exact values

**Palette (`ARCANE` in `theme.ts`)**

| Token | Value | Token | Value |
|---|---|---|---|
| bg | `#14172A` | panel | `#1D2140` |
| panelBorder | `#33395F` | rim (gold border) | `#6B5A2E` |
| gold | `#C9A14A` | goldText | `#F7D27A` |
| lantern | `#FFE7A8` | text | `#ECE4D2` |
| muted | `#A9A3BE` | soft (status text) | `#CFC8DB` |
| well (orb/bar inside) | `#0E1124` | grid / track / divider | `#2C3256` |
| mana | `#8FDCFF → #3550D6` (back wave `#2B45B8` @ .7) | health | `#FF9A8A → #B8323A` |
| glow | `#FFE7A8 → #D9862B` | ember | `#FF8A5B` |
| ember text | `#FFB27A` | arcane | `#B98CFF` (text `#DCCBFF`, ring `#3A3F66`) |
| water text / ring | `#BFE6FF` / `#2E5E7A` | bard panel | `#2E3450`, control border `#4A5070` |
| parchment | `#F4EAD5`, border 2px `#C9A14A`, radius 6, shadow `3px 3px 0 #6B5A2E`, ink `#2B2620`, detail `#6B5F4E` | XP badge text | `#2E5E4E` |
| scroll badge "!" | `#E0A33A` | scroll badge "↑" (update) | `#8FB3D9` |
| well-done panel | bg `#1F3A2C`, border `#3E7A55`, text `#CFEBD6` | stamina low / ok / empty | `#FF8A7A` / `#7FD17E` / `#2C3256` |
| sky | `linear-gradient(#0F1226, #232A52)`, bottom border 3px `#6B5A2E` | lit tile | bg `#2A2340` (icon) / `#3A2E25` (wide), border `#C9A14A`, text `#FFE7A8` |
| green tile (`tone: green`) | border `#3E7A55`, bg `#1F3A2C`, text `#CFEBD6`, icon `#7FD17E` | icon colours | bulb `#F7D27A`, tv `#B98CFF`, pc `#8FDCFF`, shield `#7FD17E`, spark `#FFE7A8` |

Panels: radius 18px, border 2px (`rim` for hero/orbs/bard, `panelBorder` otherwise), padding 14–16px. Headings: Pixelify Sans, `#F7D27A` (h1 28px phone / 34px wide, h2 18px). Body Inter 13–15px.

**Keyframes and durations (copy verbatim from the mockups)**

| Class | Keyframes | Animation |
|---|---|---|
| `.wave` / `.wave2` | `translateX(0 → -60px)` | 3.2s linear infinite / 5s linear infinite reverse |
| `.spin` / `.spinr` | rotate 360° / −360° (`transform-box: fill-box`, origin 50% 50%) | 18s linear infinite / 9s linear infinite |
| `.draw` | `stroke-dashoffset 1000 → 0` with `pathLength="1000"`, `stroke-dasharray: 1000` | 2.4s ease-out both (once) |
| `.pulse` | opacity .55 → 1 → .55 | 2.4s ease-in-out infinite |
| `.star` | twinkle opacity .25 → 1 | 3s ease-in-out infinite, delays 0, .8, 1.6, .4, 2.2s |
| `.win` | flicker 1 / .8 @45% / .95 @55% | 4s ease-in-out infinite, delays 0, 1, 2s |
| `.shimmer` | 50px white band (`rgba(255,255,255,.35)`), `left: -50px → 100%` | 3s ease-in-out infinite |
| `.spark` | rise: translateY(0 → -60px), opacity 0 → 1 @20% → 0 | 3.6s ease-in infinite, delays 0, 1.2, 2.1s; colours `#BFE6FF`, `#FFD1C4`, `#FFE7A8` |
| `.eq` | scaleY .3 → 1 → .3, origin bottom | 1.1s ease-in-out infinite, delays 0, .2, .5, .3, .7s |
| `.lit` | box-shadow `0 0 10px rgba(247,210,122,.35)` → `0 0 22px rgba(247,210,122,.7)` | 3s ease-in-out infinite |

**Geometry**

| Item | Value |
|---|---|
| Orb | viewBox 120; well r52 `#0E1124`; clip r52; rim r54 stroke `#C9A14A` width 4 (5 at ≤72px); ring r58 width 1.5 dash `3 9` opacity .7 `.spin`; highlight ellipse cx42 cy38 rx14 ry8 white .18; wave path `M0 26 Q15 18 30 26 T60 26 T90 26 T120 26 T150 26 T180 26 T210 26 V140 H0 Z` |
| Orb fill level | front wave `translate(0, t)` with `t = 86 − 104·p` (p clamped 0..1); back wave (`.wave2`) at `t − 2` |
| Orb sizes | card 96px, board summary 80px, header wide 72px |
| Rune | viewBox 120; dotted ring r56 width 2 dash `1 7` `.spin`; track r44 width 10 `#2C3256`; arc r44 width 10 round cap, `stroke-dasharray: {277·p rounded to 0.1} 277`, `rotate(-90 60 60)`; value text y 58 (y 66 without sub-line) 22px Pixelify; sub-line y 78 11px `#A9A3BE`; `arcane` adds triangle `60,14 100,83 20,83` stroke `#3A3F66` `.spinr`; size 110px |
| Rune presets | fire: arc `#FF8A5B`, text `#FFE7A8`, ring `#6B5A2E` · water: arc `#8FDCFF`, text `#BFE6FF`, ring `#2E5E7A` · arcane: arc `#B98CFF`, text `#DCCBFF`, ring `#6B5A2E` |
| Rune buttons | 48×48, radius 12, bg `#14172A`; − border `#33395F` colour `#8FDCFF`; + border `#6B5A2E` colour `#FFB27A` |
| Trail | viewBox 326×110, `preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"`; grid lines y 30 and 70 `#2C3256` dash `2 6`; series 1 line gradient `#FFD27A → #FF7A6B` width 3 + area `#FF8A5B` .45 → 0; series 2 `#8FDCFF` width 2 dash `4 4` (no draw animation); "now" dot r5 `#FFE7A8` `.pulse`; y-range shared by both series, padded 8% top and bottom |
| Header (phone) | height 210px; 5 stars, moon, two houses, lantern and ground copied from `FinalOverview.dc.html`; windows in order W1 (42,66) W2 (68,66) W3 (94,66) W4 (172,50, 12px) W5 lantern (245,74, 16×12); lit `#F7D27A` + glow, dark `#4A5070` |
| Hero bar | 14px, bg `#0E1124`, border 2px `#C9A14A`, radius 8, fill `linear-gradient(90deg, #D9862B, #FFE7A8)` |
| Stamina | 5 segments, height 12, gap 3; name column 120px |
| Allies bar | height 10, radius 3, track `#2C3256`, fill `#FFB27A` when 0 awake else `#8FDCFF`, min width 4% |

**Rules and thresholds**

| Rule | Value |
|---|---|
| Battery fault | `sensor` with `device_class: battery`, unit `%`, value ≤ `battery_threshold` (default **20**); `binary_sensor` `device_class: battery` state `on` |
| Critical battery | value ≤ **5** % |
| Problem fault | `binary_sensor` `device_class: problem`, state `on`; ≥ 2 on devices with the same `model` are grouped into one scroll |
| Impossible temperature | `sensor` `device_class: temperature` with value (°F converted to °C) < **−50** or > **100**; merged into that device's battery scroll if it has one |
| Update fault | `update.*` state `on` |
| XP per scroll (fixed, documented) | critical battery **30**, problem (single or group) **20**, impossible temperature **10**, update **10**, low battery **5** |
| Minutes per added quest | battery 5, problem 10, temperature 5, update 5; energy `low` |
| Scroll order | critical battery, problem, temperature, low battery, update; then name (`localeCompare`) |
| Health % | `checked === 0 ? 100 : round(100·(checked − faultyEntities)/checked)`; `checked` = battery + problem + temperature + update entities inspected (after `exclude`) |
| Online % | share of entities whose state ≠ `unavailable`; default skips domains `automation, script, scene, zone, sun, person, update, input_*`; `domains` / `integrations` filters narrow it |
| Lights | `light.*` that are not groups (no array `entity_id` attribute and platform ≠ `group`) and not `unavailable`; on = state `on` |
| Header lit windows | `on === 0 ? 0 : max(1, round(5·on/total))` (max 5) |
| Resting ally | integration (`hass.entities[id].platform`) with ≥ `min_entities` (default **1**) entities and ≥ **50 %** of them `unavailable`; sorted by unavailable count desc; show top **4** + "+N more allies" |
| Trail | default `hours` **24** (1–168); resample to ≤ **48** points; refetch ≥ **300 000 ms** apart |
| Rune | step = `target_temp_step` ?? **0.5**; min = `min_temp` ?? **7**; max = `max_temp` ?? **35**; taps debounced **800 ms** (one `climate.set_temperature` with the final target) |
| Spell tile hold | **500 ms** → more-info |
| Stamina | default `limit` **8**, `threshold` **20**; filled segments = `ceil(pct/20)` (0 at 0 %) |
| Quest board | default `limit`: full = all, compact = **2** |

**Copy (`copy.ts`, exact)**

| Key | Text |
|---|---|
| boardTitle / boardEmpty | "Quest board" / "Everything is well." |
| quickQuests / allLink | "Quick quests" / "All {n} →" |
| chips | "{n} devices" · "1 device", "{n} batteries" · "1 battery", "{n} updates" · "1 update", "{n} sensors" · "1 sensor" |
| boardFooter | "Everything else is well. New problems appear here by themselves." |
| boardSummary | "{n} small quests. Nothing urgent." (1 → "1 small quest. Nothing urgent.") |
| more | "+ {n} more on the board →" |
| batteryCritical / batteryLow | "Change the {name} battery" / "Charge or change the {name} battery" |
| batteryDetail / batteryLowBinary | "Battery {n} %" / "Battery is low" |
| tempMerged | " · it reads {v} °C until then" |
| tempOwn / tempOwnDetail | "Check the {name} sensor" / "It reads {v} °C, which can't be right" |
| problemOne / problemGroup / problemDetail | "Check {name}" / "Check {n} {model} devices" / "{places} report a small problem" ("Reports a small problem" with no area) |
| updateDetail / install | "{installed} → {latest} ready" ("Update ready" if unknown) / "Install" |
| add / added / already / addFailed | "Add to my Cuest quests" / "Added to your quests" / "Already on your quest list" / "Cuest could not take it right now. Try again soon." |
| alliesTitle / alliesAwake / alliesMore / alliesNone | "Resting allies" / "{awake} of {total}" / "+ {n} more allies" / "All allies are awake." |
| heroLine / heroRest / streak / keys | "Lv {level} {title}" / "{xp} XP to level {next}" / "{n}-day streak" / "1 chest key" · "{n} chest keys" |
| heroMissing | "Your hero is not here yet. Set up Cuest first." |
| roomsTitle / lit / dark / battery / check / noRooms | "Rooms" / "{n} lit" / "dark" / "battery" / "check" / "No rooms yet. Add areas in Home Assistant." |
| bardTitle / bardIdle / bardResting | "Bard · {name}" / "Ready to play" / "The bard is resting" |
| runeTitle / runeTo / runeNow / runeResting | "{Rune} rune · {action}" (heating/cooling/idle, or the sensor name) / "{Rune} rune · to {t}" / "now {v}" / "{Rune} rune · resting" |
| orb labels | online "Mana" / "online"; health "Health" / "{n} quests"; lights "Glow" / "lights on" |
| header defaults | title "Cuest Home", mood "the house is happy", "{t} outside", "{t} inside" |
| staminaTitle / staminaNone | "Stamina" / "Every battery is full of stamina." |
| missing | "Entity not found: {id}" |

## Review Focus

1. Light groups and group members counted twice (`light.alle_lichter_im_haus`, `light.schlafzimmer_lichter` plus their members) inflate Glow, header windows and room "lit" → groups must be skipped everywhere. → Task 2 tests.
2. `unavailable` / `unknown` / non-numeric / missing entities in every card (orb percent, trail gaps, rune on an unavailable thermostat, stamina `unknown`, room with only an impossible reading) → `—` or resting copy, never `NaN`. → `expectClean(el)` helper (Task 1) asserted in every card's tests.
3. Trail history: `callWS` rejects, entity absent from the response, all-null series, a burst of `hass` updates (must not refetch within 5 min), config change mid-fetch (stale response ignored). → Task 4 tests.
4. Rune +/− tapped quickly: one service call with the final target after 800 ms, clamped to min/max, step from the entity; heat_cool thermostats (low/high targets) show the range without buttons. → Task 5 tests.
5. "Add to my Cuest quests" and "Install": never shown to non-admins; double tap sends one request; a title already in `sensor.cuest_open_quests` `quests` shows "Already on your quest list"; an API failure shows the kind message and re-enables the button; entity names with HTML stay text. → Task 6 tests.

---

### Task 1: Foundation — theme, copy, format, base card, fake hass, bundle entry

**Files:**
- Create: `frontend/src/arcane/theme.ts`, `frontend/src/arcane/copy.ts`, `frontend/src/arcane/format.ts`, `frontend/src/arcane/base.ts`, `frontend/src/arcane/index.ts`
- Create: `frontend/test/arcane/fake-hass.ts`, `frontend/test/arcane/foundation.test.ts`
- Create: `docs/superpowers/specs/arcane-hearth/` (copy the five `Final*.dc.html` / `ArcaneCards.dc.html` mockups from the design scratchpad so executors have the spec in the repo)
- Modify: `frontend/src/hass-types.ts`, `frontend/build.mjs` (add entry `'cuest-arcane': 'src/arcane/index.ts'`)
- Build: `custom_components/cuest/frontend/cuest-arcane.js`

**Interfaces:**
- Produces (`hass-types.ts`, all optional so existing code and tests compile):
  - `HassEntity { platform?: string; device_id?: string | null; area_id?: string | null; entity_category?: string | null; hidden?: boolean }`; `HomeAssistant.entities?: Record<string, HassEntity>`
  - `HomeAssistant.devices?: Record<string, { id: string; name?: string | null; name_by_user?: string | null; model?: string | null; area_id?: string | null }>`
  - `HomeAssistant.areas?: Record<string, { area_id: string; name: string }>`
  - `HomeAssistant.user?: { id: string; is_admin: boolean }`; `HomeAssistant.locale?: { language: string }`
- Produces (`theme.ts`): `ARCANE` (palette table keys), `FONT_PIXEL`, `FONT_BODY`, `arcaneBase: CSSResult` (`:host` custom properties `--arc-bg`, `--arc-panel`, …, `.panel`, `.panel.rim`, `.warn`, `h2`, all keyframes and animation classes of the Exact values table, the reduced-motion block), `ensureFonts(doc = document): void`.
- Produces (`copy.ts`): `ARCANE_COPY` (Copy table) and `fill(template: string, vars: Record<string, string | number>): string`.
- Produces (`format.ts`): `num(state: unknown): number | null` (finite numbers only), `fmtNumber(v: number | null, lang = 'en', digits = 1): string` (`—` for null; `Intl.NumberFormat`, max `digits` fraction digits), `fmtTemp(v, lang)` → `"21.5°"` / `"23°"` / `"—"`, `fmtPercent(p: number | null)` → `"88%"`, `clockLine(d: Date, lang = 'en'): string` → `"Tuesday 16:40"` (weekday long + `hourCycle: 'h23'`), `toCelsius(v: number, unit: unknown): number`.
- Produces (`base.ts`):
  - `class ConfigError extends Error`; validators `v.str(raw, key, tag, required?)`, `v.num(raw, key, tag, { def, min, max })`, `v.bool(raw, key, tag, def)`, `v.oneOf(raw, key, tag, values, def)`, `v.list(raw, key, tag, max?)`, `v.entity(raw, key, tag, domains?: string[], required?)` — each throws `ConfigError("<tag>: \"<key>\" …")`.
  - `abstract class ArcaneCard<C> extends LitElement` with `static styles = [arcaneBase]`, `protected config: C`, `protected _hass?: HomeAssistant`, `abstract readonly tag: string`, `protected abstract validate(raw: Record<string, unknown>): C`, `setConfig(raw: unknown): void` (non-object → `"<tag>: config must be an object"`), `set hass(h)` (stores, recomputes `signature(h)`, `requestUpdate()` only if it changed), `protected signature(h): string` (default: `state@last_changed` of `entityIds()`), `protected entityIds(): string[]`, `getCardSize(): number`, `getGridOptions(): { columns: number | 'full'; rows: number | 'auto'; min_columns?: number; min_rows?: number }`, `connectedCallback` calls `ensureFonts()`, `protected missing(id: string): TemplateResult` (warning panel).
  - `registerCard(tag: string, ctor: CustomElementConstructor, meta: { name: string; description: string }): void` (define once; push `{ type: tag, name, description, preview: true }` to `window.customCards` once).
  - `fireMoreInfo(el: HTMLElement, entityId: string): void` (`hass-more-info`, bubbles + composed); `navigate(path: string): void` (`history.pushState` + `location-changed` event on `window`).
- Produces (test helper `fake-hass.ts`): `st(state: string, attributes?: Record<string, unknown>): HassState`; `fakeHass(o?: { states?; entities?; devices?; areas?; user?: { id: string; is_admin: boolean }; history?: Record<string, { s: string; lu: number }[]>; language?: string }): HomeAssistant & { callWS: Mock; callService: Mock; callApi: Mock }` (`callWS` answers `history/history_during_period` from `history`); `mount<T>(tag: string, config: object, hass: HomeAssistant): Promise<T & HTMLElement>`; `text(el): string` (shadow text, whitespace collapsed); `expectClean(el): void` (no `NaN`/`undefined`/`null` in shadow text or any attribute).

- [ ] **Step 1: Write the failing tests** in `frontend/test/arcane/foundation.test.ts`:
  - `fmtTemp(21.46) === '21.5°'`, `fmtTemp(23) === '23°'`, `fmtTemp(-0.7) === '-0.7°'`, `fmtTemp(null) === '—'`; `num('unavailable') === null`, `num('12.5') === 12.5`, `num('') === null`; `toCelsius(212, '°F') === 100`.
  - `clockLine(new Date(2026, 10, 24, 16, 40), 'en') === 'Tuesday 16:40'`.
  - `fill('{n}-day streak', { n: 6 }) === '6-day streak'`.
  - Every string in `ARCANE_COPY` (walked recursively) fails `/\b(overdue|late|failed|missed|penalty|broken|dead|offline|error|fault)\b/i` and has no emoji (`/\p{Extended_Pictographic}/u`).
  - `arcaneBase.cssText` contains `prefers-reduced-motion: reduce` and, inside that block, every animation class from the keyframes table.
  - `ensureFonts()` twice → exactly one `#cuest-arcane-fonts` link with the Pixelify Sans + Inter URL.
  - A tiny test card defined in the test file via `registerCard('cuest-test-card', …)`: `setConfig(null)` throws `/cuest-test-card: config must be an object/`; `v.num` with a string throws `/"hours" must be a number/`; `registerCard` twice leaves one `customCards` entry; setting `hass` with an unchanged signature does not trigger `updated()` (spy).
- [ ] **Step 2: Run to verify RED:** `npm test -w frontend -- test/arcane/foundation.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Implement** the files above; copy the mockups into `docs/superpowers/specs/arcane-hearth/`; `index.ts` only imports `./theme` for now (later tasks add one import per card); add the build entry.
- [ ] **Step 4: Verify GREEN:** `npm test -w frontend` and `npm run typecheck -w frontend` → all pass (old tests untouched).
- [ ] **Step 5: Build and check other bundles unchanged:** `npm run build -w frontend && git status --short custom_components/cuest/frontend` → only `cuest-arcane.js` new.
- [ ] **Step 6: Commit**

```bash
git add frontend/src/hass-types.ts frontend/build.mjs frontend/src/arcane frontend/test/arcane docs/superpowers/specs/arcane-hearth custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat(arcane): theme, copy, formatting and base card for Arcane Hearth cards"
```

### Task 2: House model (pure functions)

**Files:**
- Create: `frontend/src/arcane/house.ts`
- Test: `frontend/test/arcane/house.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `num`, `toCelsius`, `ARCANE_COPY`, `fill`.
- Produces (all `(h: HomeAssistant, …)` pure functions):
  - `areaOf(h, entityId): string | null` (entity `area_id`, else its device's `area_id`); `deviceOf(h, entityId)`; `displayName(h, entityId): string` (device `name_by_user` ?? `name` ?? `friendly_name` with a trailing " Battery"/" Temperature" removed ?? id).
  - `matches(entityId: string, patterns: string[]): boolean` (`*` wildcard).
  - `isLightGroup(h, id): boolean`; `lightStats(h, filter?: (id: string) => boolean): { on: number; total: number }` (Exact values "Lights").
  - `onlineShare(h, opts: { domains?: string[]; integrations?: string[] }): { online: number; total: number; pct: number | null }`.
  - `type FaultKind = 'battery_critical' | 'problem' | 'temperature' | 'battery_low' | 'update'`; `interface Fault { id: string; kind: FaultKind; title: string; detail: string; xp: number; minutes: number; entityIds: string[]; area: string | null }`; `collectFaults(h, opts: { batteryThreshold: number; exclude: string[] }): { faults: Fault[]; checked: number; faultyEntities: number; health: number }` — ids `battery:<entity>`, `problem:<entity>` or `problem:model:<model>`, `temperature:<entity>`, `update:<entity>`; sorted per Exact values.
  - `interface Ally { platform: string; name: string; awake: number; total: number }`; `restingAllies(h, opts: { ignore: string[]; minEntities: number; names?: Record<string, string> }): Ally[]` — built-in names `fritz`/`fritzbox` → "FRITZ!Box", `smartthings` → "SmartThings", `tuya` → "Tuya", `music_assistant` → "Music Assistant", otherwise `snake_case` → "Title Case".
  - `interface Battery { entityId: string; name: string; pct: number }`; `batteries(h, opts: { entities?: string[]; exclude: string[]; limit: number }): Battery[]` (numeric only, low first, then name).
  - `interface RoomRow { areaId: string; name: string; temp: number | null; tempState: 'ok' | 'none' | 'battery' | 'check'; lit: number }`; `roomRows(h, opts: { areas?: (string | { area: string; name?: string; temperature?: string })[]; batteryThreshold: number }): RoomRow[]` — area matched by `area_id` or by name (case-insensitive); default all areas sorted by name; temperature = override, else the area's `sensor` with `device_class: temperature` (entity id order, plausible readings first); `battery` when the sensor's device has a battery ≤ threshold, `check` when unavailable/impossible otherwise.
  - `interface HeroModel { name: string; level: number; title: string; into: number; span: number; remaining: number; pct: number; streak: number; chestKeys: number }`; `heroFor(h, playerId?: string): HeroModel | null` — picks `playerId`, else the player whose `ha_person` entity has `attributes.user_id === h.user?.id`, else the first (uses `playersFromSensors` from `../sensors`); `span = to_next` (the level's full XP cost — see note), `remaining = max(0, span − into)`, `pct = span > 0 ? clamp(round(100·into/span)) : 0`.
  - Note: the server's `toNext` is the whole level's cost (`server/src/domain/levels.ts`: `levelForXp(940) → { intoLevel: 340, toNext: 400 }`); the hero card must not copy the existing card's `into/(into+toNext)` maths.

- [ ] **Step 1: Write the failing tests** (`house.test.ts`, fixtures built with `fakeHass`, German names included):
  - `lightStats`: `light.alle_lichter_im_haus` (attribute `entity_id: [...]`, on), `light.wohnzimmer_spots` (platform `group`, on), `light.wohnzimmer` on, `light.lamp` off, `light.gone` unavailable → `{ on: 1, total: 2 }`.
  - `onlineShare`: 9 sensors, 1 unavailable, plus `automation.x` unavailable → `{ online: 8, total: 9, pct: 89 }`; `integrations: ['tuya']` narrows; empty → `pct: null`.
  - `collectFaults`: battery 0 % on a device that also reads −327.7 °C → one `battery_critical` scroll, title "Change the Thermostat Büro battery", detail "Battery 0 % · it reads -327.7 °C until then", xp 30; battery 14 % → `battery_low` xp 5; 25 % → none; threshold 30 → included; two problem sensors with model "Valve" in Wohnzimmer + one in Küche → one scroll "Check 3 Valve devices", detail "Wohnzimmer ×2 · Küche report a small problem", xp 20; `update.home_assistant_core_update` on with versions → detail "2026.11.1 → 2026.11.2 ready", xp 10; 212 °F sensor → `temperature` "Check the … sensor"; `exclude: ['sensor.macbook_*']` drops the MacBook; order critical → problem → temperature → low → update; `health` with 10 checked and 3 faulty entities → 70; no candidates → health 100.
  - `restingAllies`: fritz 0/122 awake, tuya 0/20, music_assistant 2/8, hue 9/10 → three allies in that order with names "FRITZ!Box", "Tuya", "Music Assistant"; `ignore: ['tuya']` drops it; `names: { fritz: 'Router' }` overrides.
  - `batteries`: `unknown` state skipped; sorted 0, 14, 80; `limit: 2`.
  - `roomRows`: areas `wohnzimmer` "Wohnzimmer", `kuche` "Küche", `buro` "Büro", `schlafzimmer` "Schlafzimmer"; config `['Wohnzimmer', 'kuche', 'Büro']` keeps that order; Wohnzimmer lit counts members only (group skipped); Büro temp −327.7 with battery 0 % → `temp: null, tempState: 'battery'`; Schlafzimmer without sensor → `tempState: 'none'`; unknown area name skipped.
  - `heroFor`: `to_next 400, into_level 340` → `remaining 60, pct 85`; user-linked player picked over the first; explicit `playerId` wins; no sensors → `null`.
- [ ] **Step 2: RED:** `npm test -w frontend -- test/arcane/house.test.ts` → FAIL.
- [ ] **Step 3: Implement** `house.ts`.
- [ ] **Step 4: GREEN:** `npm test -w frontend && npm run typecheck -w frontend`.
- [ ] **Step 5: Commit** (no bundle change: nothing imports `house.ts` yet)

```bash
git add frontend/src/arcane/house.ts frontend/test/arcane/house.test.ts
git commit -m "feat(arcane): house model for lights, online share, faults, allies, batteries, rooms and hero"
```

### Task 3: Orb card and header card

**Files:**
- Create: `frontend/src/arcane/orb.ts` (`cuest-orb-card` + exported renderer), `frontend/src/arcane/header.ts` (`cuest-arcane-header`)
- Modify: `frontend/src/arcane/index.ts`
- Test: `frontend/test/arcane/orb.test.ts`, `frontend/test/arcane/header.test.ts`

**Interfaces:**
- Consumes: Task 1 base/theme/format/copy; Task 2 `lightStats`, `onlineShare`, `collectFaults`.
- Produces:
  - `type OrbColor = 'mana' | 'health' | 'glow'`; `interface OrbItem { preset: 'percent' | 'ratio' | 'online' | 'lights' | 'health'; entity?: string; max?: number | string; color: OrbColor; label?: string; sublabel?: string; domains?: string[]; integrations?: string[]; exclude?: string[]; battery_threshold?: number }`.
  - `validateOrb(raw, tag): OrbItem` (percent/ratio need `entity`; ratio needs `max` number > 0 or an entity id; default colour per preset: online → mana, health → health, lights → glow, else mana).
  - `orbValue(h, item): { p: number | null; text: string; label: string; sublabel: string; aria: string }` (percent → `"88%"`; ratio → `value/max`; lights → `"13"` with p = on/total; health → p from `collectFaults(...).health`, sublabel "{n} quests").
  - `renderOrb(v, color, index: number, size: number, opts: { ring: boolean }): SVGTemplateResult` (unique ids `orb-{index}-*`).
  - `cuest-orb-card` config: a single `OrbItem` **or** `{ orbs: OrbItem[] }` (1–4) rendered as one rim panel, `justify-content: space-around`, three sparks; label line Pixelify 14px in the orb colour ("Mana 88%"), sublabel 11px muted. `getGridOptions` → `{ columns: 12, rows: 3 }`; `getCardSize` → 3; stub `{ preset: 'online' }`.
  - `cuest-arcane-header` config: `{ title?: string; mood?: string; outside?: string; inside?: string; variant?: 'phone' | 'wide'; orbs?: OrbItem[] (wide only, ≤ 4) }`. Phone: 210px night village, lit windows per Exact values, status `"{clockLine} · {mood}"`, right-bottom "-0.7° outside" / "21.5° inside" (each only if configured). Wide: stars only, 34px title, status `"{clock} · {mood} · {t} outside"`, orbs row at 72px with value (Pixelify 18px) and "Mana · online" beside each. Grid `{ columns: 'full', rows: phone 4 / wide 3 }`; card size 4 / 3.
  - Header clock: re-render at the next minute boundary then every 60 000 ms; timers cleared in `disconnectedCallback`.

- [ ] **Step 1: Write the failing tests:**
  - Orb `percent` of `sensor.washer_progress` "72" → label "Mana 72%", front wave `transform="translate(0,11.12)"` (t = 86 − 104·0.72), `aria-label` "Mana: 72 percent"; state `unavailable` → text "—", wave at p 0, `expectClean`.
  - `ratio` with `max: 'sensor.max'` "200" and value "50" → "25%".
  - `online` preset over the Task 2 fixture → "Mana 89%", sublabel "online".
  - `lights` preset → "Glow 1", sublabel "lights on".
  - `orbs: [online, health, lights]` → three SVGs with distinct `clipPath` ids; 5 orbs → throws `/at most 4/`; `{ preset: 'percent' }` without entity → throws `/"entity" is required/`; `color: 'pink'` → throws `/one of mana, health, glow/`.
  - Header phone: 3 non-group lights of 4 on → 4 lit windows (`.win.lit` count) — round(5·3/4) = 4; 0 on → none lit; status text "Tuesday 16:40 · the house is happy" (fake timers at 2026-11-24 16:40); `outside: sensor.outside` "-0.7" → "-0.7° outside"; missing outside entity → line omitted, `expectClean`.
  - Header clock: advance fake time to 16:41:00 → text shows 16:41; after removal no timer remains (`vi.getTimerCount() === 0`).
  - Header wide with `orbs` → three 72px orbs, no `.house` elements; `orbs` with `variant: phone` → throws `/only with variant: wide/`.
  - Both tags present once in `window.customCards` with names "Arcane orb" and "Arcane header".
- [ ] **Step 2: RED:** `npm test -w frontend -- test/arcane/orb.test.ts test/arcane/header.test.ts` → FAIL.
- [ ] **Step 3: Implement** both cards; signature for whole-house presets = `JSON.stringify(orbValue(...))` per orb (+ lit window count for the header).
- [ ] **Step 4: GREEN:** `npm test -w frontend && npm run typecheck -w frontend`.
- [ ] **Step 5: Build and commit**

```bash
npm run build -w frontend
git add frontend/src/arcane frontend/test/arcane custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat(arcane): liquid orb card and night village header"
```

### Task 4: Trail card with history

**Files:**
- Create: `frontend/src/arcane/history.ts`, `frontend/src/arcane/trail.ts` (`cuest-trail-card`)
- Modify: `frontend/src/arcane/index.ts`
- Test: `frontend/test/arcane/history.test.ts`, `frontend/test/arcane/trail.test.ts`

**Interfaces:**
- Consumes: Task 1 base/format/copy.
- Produces:
  - `interface Sample { t: number; v: number | null }` (ms; `v` null for non-numeric states).
  - `fetchHistory(h, entityIds: string[], start: Date, end: Date): Promise<Record<string, Sample[]>>` — one `callWS({ type: 'history/history_during_period', start_time, end_time, entity_ids, minimal_response: true, no_attributes: true, significant_changes_only: false })`; `lu` (seconds) → ms; missing ids → `[]`.
  - `resample(samples: Sample[], start: number, end: number, points = 48): (number | null)[]` — point i sits at `start + (i + 1)·(end − start)/points`; its value is the `v` of the last sample with `t ≤` that time (step function), `null` if none or that sample is null. Length is `min(points, 48)`.
  - `trailGeometry(series: (number | null)[][], w = 326, h = 110, pad = 0.08): { segments: string[][]; area: string; last: { x: number; y: number } | null; min: number; max: number } | null` — `segments[s]` = polyline point strings for each run of non-null values of series s; `area` = closed sub-paths under series 0's segments; y-range shared, padded 8 %; flat data gets ±0.5 range; `null` when every value is null.
  - `cuest-trail-card` config: `{ entity: string; entity2?: string; hours?: number (1–168, default 24); title?: string (default "Warmth trail"); name?: string; name2?: string }`. Header row: title + "{hours} h"; legend "— {name} {current}" (`#FFB27A`) and "- - {name2} {current}" (`#8FDCFF`); last point of each series replaced by the live `hass` state; aria "{name} over the last {hours} hours, between {min} and {max} {unit}". Grid `{ columns: 12, rows: 3 }`, card size 3, stub = first `sensor` with `device_class: temperature`.
  - Refresh: fetch on first `hass` after `setConfig`; afterwards only when `Date.now() − lastFetch ≥ 300_000`; refetch immediately on config change; one request in flight; a response whose request token is stale is dropped. Constant `HISTORY_REFRESH_MS = 300_000` exported.

- [ ] **Step 1: Write the failing tests:**
  - `resample` with samples at t 0 (20), 30 min (21), 60 min ('unavailable' → null), 90 min (22) over 0..2 h, 4 points → `[21, null, 22, 22]`; no samples → all null; 1000 samples over 24 h with default → length 48.
  - `trailGeometry([[1, 2, null, 4]])` → two segments; all-null → `null`; constant series does not divide by zero (`expectClean` on the rendered card).
  - `fetchHistory` passes the exact message above and converts `lu: 1764000000.5` → `1764000000500`.
  - Card: history for two entities → two `polyline`s (first has `class="draw"` and `pathLength="1000"`, second has `stroke-dasharray="4 4"` and no draw), one `.pulse` circle, legend "Wohnzimmer 21.5°" and "outside -0.7°".
  - 20 `hass` updates within 4 minutes → `callWS` called once; at +5 min → twice; `setConfig` with `hours: 48` → refetch with start 48 h back.
  - `callWS` rejects → card shows the title and "—" legend, no throw, `expectClean`; next allowed fetch retries.
  - Config change while the first request is pending; the first resolves last → its data is not rendered.
  - `hours: 0` or `hours: 500` → throws `/"hours" must be between 1 and 168/`; missing `entity` → throws.
- [ ] **Step 2: RED:** `npm test -w frontend -- test/arcane/history.test.ts test/arcane/trail.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN:** `npm test -w frontend && npm run typecheck -w frontend`.
- [ ] **Step 5: Build and commit**

```bash
npm run build -w frontend
git add frontend/src/arcane frontend/test/arcane custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat(arcane): warmth trail history card"
```

### Task 5: Rune gauge and hero card

**Files:**
- Create: `frontend/src/arcane/rune.ts` (`cuest-rune-gauge`), `frontend/src/arcane/hero.ts` (`cuest-hero-card`)
- Modify: `frontend/src/arcane/index.ts`
- Test: `frontend/test/arcane/rune.test.ts`, `frontend/test/arcane/hero.test.ts`

**Interfaces:**
- Consumes: Task 1; Task 2 `heroFor`.
- Produces:
  - `cuest-rune-gauge` config: `{ entity: string (climate.* or sensor.*); rune?: 'fire' | 'water' | 'arcane'; name?: string; min?: number; max?: number (sensor only, default 0 / 100); controls?: boolean (default true; climate only) }`. Default rune: climate → fire, `device_class: humidity` → water, else arcane.
  - Climate with controls: arc p = `(target − min)/(max − min)`; centre text target ("23°"), sub-line "now 21.5°"; title "Fire rune · heating" from `hvac_action`; −/+ buttons (`aria-label` "Cooler" / "Warmer") change a pending target by `step`, clamp to min/max, show it immediately and after 800 ms call `climate.set_temperature { entity_id, temperature }` once. `controls: false` → compact centred layout, centre text current, label "Fire rune · to 23°".
  - `hvac_mode: off` → title "Fire rune · resting", arc empty, no buttons. `target_temp_low/high` without `temperature` → centre "20–23°", no buttons. Unavailable → "Fire rune · resting", "—".
  - Sensor: arc p = `(v − min)/(max − min)`, centre "{v}{unit}" ("38%"), label "Water rune · {friendly_name}".
  - Grid: controls `{ columns: 12, rows: 3 }`, compact `{ columns: 6, rows: 3 }`; card size 3; stub = first `climate`.
  - `cuest-hero-card` config: `{ player?: string }`. Rim panel: "Lv {level} {title}" (Pixelify 17px), right "{n}-day streak" (`#FFB27A`, hidden at 0), shimmer bar at `pct`, sub-line "{remaining} XP to level {level+1}" + " · {keys}" when keys > 0; `role="progressbar"` with `aria-valuenow`. No player → `heroMissing` copy. Grid `{ columns: 12, rows: 2 }`, card size 2, stub `{}`.

- [ ] **Step 1: Write the failing tests:**
  - Rune climate `temperature: 23, current_temperature: 21.5, min_temp: 7, max_temp: 30, target_temp_step: 0.5, hvac_action: 'heating'`: text "23°", "now 21.5°", "Fire rune · heating", arc `stroke-dasharray="192.7 277"` (277·16/23, one decimal).
  - Three quick "+" taps (fake timers) → shows "24.5°", no call before 800 ms, then exactly one `callService('climate', 'set_temperature', { entity_id, temperature: 24.5 })`; at `max_temp` "+" does not exceed it; no `target_temp_step` → step 0.5.
  - heat_cool → "20–23°", no buttons; `hvac_mode: off` → "Fire rune · resting", no buttons; `unavailable` → "—", `expectClean`.
  - Sensor humidity "38", unit "%" → "38%", water colours (`#8FDCFF` arc), label "Water rune · Air"; `controls: false` with climate → label "Fire rune · to 23°" and no buttons.
  - `entity: 'light.x'` → throws `/climate or sensor/`; `min >= max` → throws.
  - Hero with level sensor `{ state: '4', title: 'Hearthkeeper', into_level: 340, to_next: 400 }`, streak sensor `6` with `chest_keys: 2` → "Lv 4 Hearthkeeper", "6-day streak", "60 XP to level 5 · 2 chest keys", `aria-valuenow="85"`; `chest_keys: 1` → "1 chest key"; streak 0 → no streak text; no Cuest sensors → hero missing copy; `player: 'p2'` picks Ben.
- [ ] **Step 2: RED:** `npm test -w frontend -- test/arcane/rune.test.ts test/arcane/hero.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN:** `npm test -w frontend && npm run typecheck -w frontend`.
- [ ] **Step 5: Build and commit**

```bash
npm run build -w frontend
git add frontend/src/arcane frontend/test/arcane custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat(arcane): rune gauge and hero card"
```

### Task 6: Quest board and resting allies

**Files:**
- Create: `frontend/src/arcane/quest-board.ts` (`cuest-quest-board`), `frontend/src/arcane/allies.ts` (`cuest-allies-card`)
- Modify: `frontend/src/arcane/index.ts`
- Test: `frontend/test/arcane/quest-board.test.ts`, `frontend/test/arcane/allies.test.ts`

**Interfaces:**
- Consumes: Task 2 `collectFaults`, `restingAllies`, `Fault`, `Ally`; Task 3 `renderOrb`, `orbValue`; Task 1 `navigate`.
- Cuest API (verified in `server/src/routes/quests.ts` and `custom_components/cuest/http.py`): `POST /api/cuest/quests` body `{ title: string, energy: 'low', minutes: number, xp: number }` → 201 quest. The proxy allows it for HA admins only (non-admins get 403 `admin_only`), so the button renders only when `hass.user?.is_admin`.
- Produces:
  - `cuest-quest-board` config: `{ title?: string; battery_threshold?: number (1–100, default 20); exclude?: string[]; variant?: 'full' | 'compact'; limit?: number; more_path?: string; show_summary?: boolean (default false); allow_add?: boolean (default true) }`.
  - Full: optional summary panel (80px health orb, "Health {n}%", summary copy, chips "{n} devices" / "{n} batteries" / "{n} updates" / "{n} sensors" for non-zero kinds); h2 "Quick quests"; one parchment scroll per fault (badge "!" or "↑", first badge `.pulse`, bold title 15px, detail 13px, "+{xp} XP"); for admins: "Add to my Cuest quests" button on non-update scrolls, "Install" (calls `update.install { entity_id }`) instead of the XP badge on update scrolls; footer well-done panel `boardFooter`. Empty → well-done panel "Everything is well.".
  - Compact: heading row with title and, when `more_path` set, link "All {n} →"; first `limit` (default 2) scrolls as 44px rows that `navigate(more_path)` on tap; "+ {n} more on the board →" when more remain.
  - Add flow: busy flag per fault id (double tap → one request); before posting, if `sensor.cuest_open_quests` attribute `quests` contains the title → show `already`; success → `added` (kept for this card's lifetime); failure → `addFailed`, button enabled again.
  - Grid `{ columns: 12, rows: 'auto' }`; card size `2 + shown scrolls`; stub `{}`.
  - `cuest-allies-card` config: `{ title?: string; ignore?: string[]; limit?: number (default 4); min_entities?: number (default 1); names?: Record<string, string> }`. Rows: name (100px, 600), bar, "{awake} of {total}" (74px, muted); "+ {n} more allies" button (44px) expands the list in place. None → `alliesNone` in a well-done panel. Grid `{ columns: 12, rows: 'auto' }`; stub `{}`.

- [ ] **Step 1: Write the failing tests** (fixture from Task 2 plus `user`):
  - Full board renders the scrolls in Task 2 order with "+30 XP", "+20 XP", "+5 XP"; first badge has `.pulse`; `show_summary` with 1 critical battery, 1 low battery and 1 update among 10 checked entities → "Health 70%", "3 small quests. Nothing urgent.", chips "2 batteries" and "1 update" only.
  - Admin: "Add to my Cuest quests" on the battery scroll → `callApi('POST', 'cuest/quests', { title: 'Change the Thermostat Büro battery', energy: 'low', minutes: 5, xp: 30 })`; two quick taps → one call; then text "Added to your quests"; `callApi` rejects → "Cuest could not take it right now. Try again soon." and button enabled; title already in `sensor.cuest_open_quests.attributes.quests` → "Already on your quest list", no call.
  - Non-admin (`is_admin: false`) → no add and no Install buttons; update scroll shows "+10 XP". Admin "Install" → `callService('update', 'install', { entity_id: 'update.home_assistant_core_update' })`.
  - `allow_add: false` hides add for admins; device named `<b>x</b>` renders as text (no `b` element in the scroll).
  - Compact with 5 faults, `more_path: '/arcane-quests'` → 2 rows, "+ 3 more on the board →"; tapping a row pushes `/arcane-quests` and fires `location-changed`.
  - No faults → "Everything is well."; `variant: 'big'` → throws.
  - Allies: rows "FRITZ!Box" "0 of 122" with fill `#FFB27A` width 4%, "Music Assistant" "2 of 8" fill `#8FDCFF` 25%; `limit: 2` with 3 allies → "+ 1 more allies" button, tap shows all 3; no allies → "All allies are awake."; every button ≥ 44px min-height (computed from the stylesheet text).
- [ ] **Step 2: RED:** `npm test -w frontend -- test/arcane/quest-board.test.ts test/arcane/allies.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Signature = `JSON.stringify` of faults (+ summary) / allies, plus `user.is_admin`.
- [ ] **Step 4: GREEN:** `npm test -w frontend && npm run typecheck -w frontend`.
- [ ] **Step 5: Build and commit**

```bash
npm run build -w frontend
git add frontend/src/arcane frontend/test/arcane custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat(arcane): quest board of small quests and resting allies"
```

### Task 7: Rooms and stamina cards

**Files:**
- Create: `frontend/src/arcane/rooms.ts` (`cuest-rooms-card`), `frontend/src/arcane/stamina.ts` (`cuest-stamina-card`)
- Modify: `frontend/src/arcane/index.ts`
- Test: `frontend/test/arcane/rooms.test.ts`, `frontend/test/arcane/stamina.test.ts`

**Interfaces:**
- Consumes: Task 2 `roomRows`, `batteries`; Task 1 `navigate`, `fmtTemp`.
- Produces:
  - `cuest-rooms-card` config: `{ title?: string | null (default "Rooms"; null hides the heading); areas?: (string | { area: string; name?: string; temperature?: string })[]; path?: string (may contain "{area}" → area_id); battery_threshold?: number; heading?: 'outside' | 'inside' (default outside: h2 above the panel as on the phone; inside: first row of the panel as on desktop) }`. Row: name (600, flex 1), temperature Pixelify 18px (`—` muted for none, `?` `#FFB27A` for battery/check), right 52px "{n} lit" `#FFE7A8` / "dark" muted / "battery" or "check" `#FFB27A`. With `path`, each row is a `button` (min-height 44, full width) that calls `navigate`. No areas → `noRooms`. Grid `{ columns: 12, rows: 'auto' }`; card size `1 + rows`; stub `{}`.
  - `cuest-stamina-card` config: `{ title?: string; entities?: string[]; exclude?: string[]; limit?: number (default 8); threshold?: number (default 20) }`. Row: name (120px), 5 segments (low colour + `.pulse` on the first segment when ≤ threshold, ok colour otherwise, empty `#2C3256`), "{n} %" (40px, muted); row `role="meter"` with `aria-valuenow` and `aria-label` "{name} battery {n} percent". None → `staminaNone`. Grid `{ columns: 12, rows: 'auto' }`; stub `{}`.

- [ ] **Step 1: Write the failing tests:**
  - Rooms (fixture: Wohnzimmer has a light group plus two member lights on, Schlafzimmer one light on): rows "Wohnzimmer 21.5° 2 lit", "Küche 22.5° dark", "Schlafzimmer — 1 lit", "Büro ? battery" (order as configured); `path: '/home-control#{area}'` → tapping Küche pushes `/home-control#kuche`; without `path` rows are not buttons; `areas: [{ area: 'Wohnzimmer', temperature: 'sensor.other' }]` uses the override; `title: null` → no h2; no areas registry → "No rooms yet. Add areas in Home Assistant."; `expectClean`.
  - Stamina: batteries 0, 14, 40, 100 → order 0, 14, 40, 100; 0 % → 0 filled; 14 % → 1 filled `#FF8A7A` with `.pulse`; 40 % → 2 filled `#7FD17E`; `limit: 2` → two rows; `unknown` state skipped; none → "Every battery is full of stamina."; `entities: ['sensor.a_battery']` restricts.
- [ ] **Step 2: RED:** `npm test -w frontend -- test/arcane/rooms.test.ts test/arcane/stamina.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN:** `npm test -w frontend && npm run typecheck -w frontend`.
- [ ] **Step 5: Build and commit**

```bash
npm run build -w frontend
git add frontend/src/arcane frontend/test/arcane custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat(arcane): rooms and stamina cards"
```

### Task 8: Bard card and spell tile

**Files:**
- Create: `frontend/src/arcane/bard.ts` (`cuest-bard-card`), `frontend/src/arcane/spell-tile.ts` (`cuest-spell-tile`), `frontend/src/arcane/icons.ts` (inline SVG paths for `bulb`, `tv`, `pc`, `shield`, `spark`, `play`, `pause`, `prev`, `next` copied from the mockups)
- Modify: `frontend/src/arcane/index.ts`
- Test: `frontend/test/arcane/bard.test.ts`, `frontend/test/arcane/spell-tile.test.ts`

**Interfaces:**
- Consumes: Task 1 `fireMoreInfo`, base, theme.
- Produces:
  - `parseService(s: string): [domain: string, service: string]` (throws `ConfigError` unless `/^[a-z0-9_]+\.[a-z0-9_]+$/`), shared by both cards.
  - `cuest-bard-card` config: `{ entity: string (media_player.*); name?: string (default area name, else friendly_name); variant?: 'full' | 'compact'; sources?: { name: string; service: string; data?: Record<string, unknown> }[] (≤ 4) }`. Full: equaliser box (5 `.eq` bars, animated only while `playing`), "Bard · {name}", sub-line "{media_title} · {media_artist ?? app_name}" or `bardIdle`; progress bar (`media_position` + elapsed since `media_position_updated_at` while playing, over `media_duration`; hidden without duration); prev / play-pause (62px) / next calling `media_player.media_previous_track|media_play_pause|media_next_track`; volume `input type="range"` 0–100 → on `change` `media_player.volume_set { volume_level: v/100 }`; source buttons call their service with `data` (no `entity_id` added unless given); tapping the title area → more-info. Compact: 4 `.pulse` bars, title, sub-line, 48px play-pause. Unavailable/off → `bardResting`, controls disabled. Grid full `{ columns: 12, rows: 5 }`, compact `{ columns: 12, rows: 2 }`; stub = first `media_player`.
  - `cuest-spell-tile` config: `{ entity?: string; name?: string; icon?: string ('bulb' | 'tv' | 'pc' | 'shield' | 'spark' or 'mdi:…' via `<ha-icon>`); variant?: 'icon' | 'wide' | 'scene'; tone?: 'gold' | 'green'; state_text?: string; tap_action?: { action: 'toggle' | 'call-service' | 'more-info' | 'none'; service?: string; data?: Record<string, unknown> } }`; needs `entity` or a `call-service` tap action.
  - Default tap: light/switch/input_boolean/fan → `<domain>.toggle`; scene/script → `<domain>.turn_on`; button → `button.press`; others → more-info. Hold ≥ 500 ms (pointerdown → pointerup) → more-info and no tap. On = state `on` (or `playing`/`cleaning`) → `.lit` glow styles. Wide state line: light on → "On · {brightness%} %" or, for a light group, "{n} on"; off → "Off"; `state_text` overrides. Button is a real `<button>` with `aria-pressed` for toggles. Grid: icon `{ columns: 3, rows: 2 }`, wide `{ columns: 6, rows: 2 }`, scene `{ columns: 4, rows: 1 }`; stub = first `light`.

- [ ] **Step 1: Write the failing tests:**
  - Bard playing with title "Lofi Radio", app "Music Assistant", position 60 of 150 updated 30 s ago (fake time) → "Bard · Wohnzimmer", "Lofi Radio · Music Assistant", progress width 60 %, 5 `.eq` bars, play button `aria-label` "Pause"; paused → "Ready to play", `aria-label` "Play", bars not `.eq`.
  - Next → `callService('media_player', 'media_next_track', { entity_id: 'media_player.wohnzimmer_5' })`; volume change to 35 → `volume_set` with `volume_level: 0.35`; source "Friendflix" `{ service: 'script.turn_on', data: { entity_id: 'script.friendflix' } }` → that call; title tap fires `hass-more-info`.
  - Unavailable → "The bard is resting", buttons disabled, `expectClean`; 5 sources → throws; `service: 'nope'` → throws; `entity: 'light.x'` → throws.
  - Spell tile light on brightness 204 wide → "Ceiling", "On · 80 %", class `lit`; tap → `light.toggle`; light group with 11 members on → "11 on"; scene tile tap → `scene.turn_on`; button entity → `button.press`; `call-service` tap with `vacuum.start` and `state_text: 'Docked · tap to clean'` → that call and text; hold 600 ms → `hass-more-info`, no service call; `icon: 'mdi:robot-vacuum'` renders `ha-icon`; no entity and no call-service → throws; every tile `min-height` ≥ 56px.
- [ ] **Step 2: RED:** `npm test -w frontend -- test/arcane/bard.test.ts test/arcane/spell-tile.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: GREEN:** `npm test -w frontend && npm run typecheck -w frontend`.
- [ ] **Step 5: Build and commit**

```bash
npm run build -w frontend
git add frontend/src/arcane frontend/test/arcane custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat(arcane): bard media card and spell tiles"
```

### Task 9: Ship in the integration, docs, theme and dashboards

**Files:**
- Modify: `custom_components/cuest/__init__.py` (`ARCANE_URL = "/cuest/cuest-arcane.js"`, `ARCANE_PATH`; registered inside `_async_register_card` next to the card: same `StaticPathConfig(..., cache_headers=False)` and `frontend.add_extra_js_url`, same once-per-run guard)
- Modify: `bridge-tests/test_frontend.py`; Create: `bridge-tests/test_arcane_docs.py`
- Create: `docs/arcane-dashboards.md`
- Modify: `README.md` (status "Plans 1–5 implemented" + a line and link "Arcane Hearth dashboard cards: docs/arcane-dashboards.md"), `docs/install-home-assistant.md` (one paragraph in Part 4 pointing to the new doc)

**Interfaces:**
- Consumes: the eleven tags `cuest-arcane-header`, `cuest-orb-card`, `cuest-trail-card`, `cuest-rune-gauge`, `cuest-quest-board`, `cuest-allies-card`, `cuest-hero-card`, `cuest-rooms-card`, `cuest-bard-card`, `cuest-spell-tile`, `cuest-stamina-card` and their configs from Tasks 3–8.
- `docs/arcane-dashboards.md` sections:
  1. Enable: comes with the Cuest integration (no HACS, no resource to add); reload the browser after updating; fonts load from Google Fonts, blocked → pixel fallback.
  2. Theme: a `Cuest Arcane` theme for `frontend: themes:` in `configuration.yaml` — `primary-background-color: "#14172A"`, `lovelace-background: "#14172A"`, `card-background-color: "#1D2140"`, `ha-card-background: "#1D2140"`, `ha-card-border-color: "#33395F"`, `ha-card-border-width: 2px`, `ha-card-border-radius: 18px`, `primary-text-color: "#ECE4D2"`, `secondary-text-color: "#A9A3BE"`, `primary-color: "#F7D27A"`, `accent-color: "#C9A14A"`, `divider-color: "#2C3256"`, `state-icon-color: "#F7D27A"`, `app-header-background-color: "#14172A"`, `app-header-text-color: "#F7D27A"`, `sidebar-background-color: "#14172A"`, `sidebar-text-color: "#ECE4D2"`; how to pick it per dashboard / user profile.
  3. Card reference: per card every option (type, default, allowed values) and a short example, including XP per scroll kind, the health formula, thresholds and the 5-minute history refresh.
  4. Dashboards (full YAML, each entity id that is a guess marked `# replace entity id`):
     - **Overview (phone)** — masonry view, one column: `cuest-arcane-header` (`outside`, `inside`), `cuest-orb-card` `orbs: [online, health, lights]`, `cuest-hero-card`, `cuest-quest-board` (`variant: compact`, `more_path: /arcane-quests`), `cuest-trail-card` (`entity` Wohnzimmer temperature, `entity2` outside), `cuest-rooms-card` (`areas: [Wohnzimmer, Küche, Schlafzimmer, Büro]`, `path: /arcane-control`), `cuest-bard-card` compact `media_player.wohnzimmer_5`.
     - **Quest board** (`/arcane-quests`) — `cuest-quest-board` full with `show_summary: true`, `cuest-allies-card`, `cuest-stamina-card`.
     - **Home control** (`/arcane-control`) — four `icon` spell tiles in a 4-column grid (All lights `light.alle_lichter_im_haus`; TV light, Wake PC, Shield marked replace), `cuest-bard-card` full with sources Radio / Playlists / Friendflix (marked replace), then per room (Wohnzimmer, Schlafzimmer, Küche, Büro, Bad, Vorhaus) a built-in `heading` card and a 2-column grid of `wide` tiles (Wohnzimmer: Ceiling `light.wohnzimmer`, Spots `light.wohnzimmer_spots`, Lamp, Robot vacuum with `call-service vacuum.start`; Schlafzimmer: `light.schlafzimmer_lichter`; others marked replace), `cuest-rune-gauge` (climate marked replace), and a Scenes grid of three `scene` tiles (Cozy evening, Movie night, Power sprint — marked replace).
     - **Desktop overview** — sections view, `max_columns: 3`: header `variant: wide` with orbs (grid `columns: full`); column 1 hero + rooms (`heading: inside`); column 2 trail + two compact rune gauges (fire climate, water humidity); column 3 compact quest board (`more_path`, title "Quest board") + compact bard.
  5. Notes: area names are matched by name or id (Büro or buro both work); light groups never count twice; adding a quest needs an HA admin.
- Pytest (`test_frontend.py`): `test_arcane_bundle_served` (GET `/cuest/cuest-arcane.js` → 200, contains each of the eleven tags and `customCards`); `test_arcane_registered_as_extra_js` (URL in `DATA_EXTRA_MODULE_URL`); extend the reload test so `/cuest/cuest-arcane.js` is also present exactly once after reload.
- Pytest (`test_arcane_docs.py`): every ```` ```yaml ```` block in `docs/arcane-dashboards.md` parses with `homeassistant.util.yaml.parse_yaml`; every `type: custom:cuest-…` found (recursively) is one of the eleven tags; the theme block has key `Cuest Arcane` with `primary-background-color: "#14172A"`.

- [ ] **Step 1: Write the failing pytest tests** above.
- [ ] **Step 2: RED:** `.venv-bridge/bin/pytest bridge-tests/test_frontend.py bridge-tests/test_arcane_docs.py -q` → FAIL (404 / file missing).
- [ ] **Step 3: Implement** the `__init__.py` change, write `docs/arcane-dashboards.md`, README and install-doc lines.
- [ ] **Step 4: GREEN, full verification:**
  - `.venv-bridge/bin/pytest -q` → all pass
  - `npm run typecheck && npm test` (root: server + frontend) → all pass
  - `npm run build -w frontend && git diff --exit-code custom_components/cuest/frontend/cuest-card.js custom_components/cuest/frontend/cuest-panel.js` → no diff; `git status --short` shows only intended files
- [ ] **Step 5: Commit**

```bash
git add custom_components/cuest/__init__.py bridge-tests/test_frontend.py bridge-tests/test_arcane_docs.py docs/arcane-dashboards.md docs/install-home-assistant.md README.md custom_components/cuest/frontend/cuest-arcane.js
git commit -m "feat: ship Arcane Hearth cards with the integration; docs, theme and dashboards"
```
