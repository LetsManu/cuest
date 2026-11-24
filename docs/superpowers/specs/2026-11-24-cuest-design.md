# Cuest — Chore Quest: Design

Date: 2026-11-24
Status: Plans 1–4 implemented (server, Home Assistant bridge, sidebar app and shop, game layer)

## 1. Intent

Cuest is a cozy fantasy RPG that turns house tasks into quests, wired into Home Assistant (HA).

It is for adults who find house tasks hard. The owner's two big blockers are:

- **Remembering**: forgetting the washer finished, the vacuum bin is full, trash day, and so on.
- **Starting**: knowing what to do but not being able to begin.

The core idea: **the house does the remembering, the game makes starting small and rewarding.**
HA notices that something needs doing and a quest appears on its own. The game lowers the
barrier to begin ("just 2 minutes") and rewards finishing with XP, a growing hero, and treats
in the house.

Built first for one person (the owner), designed so more people can join later, and published
as an open-source project others can install.

## 2. Goals (v1)

1. **Auto quests from the house** (the core)
   - Washer, dryer, dishwasher finished: detected from an appliance state entity, or from a
     power sensor (power below a threshold for N minutes after it was running).
   - Robot vacuum: cleaning finished (empty the bin), stuck/error, and bin full where the
     vacuum's integration reports it.
   - Recurring quests without sensors (e.g. trash day, change bed sheets), on a simple schedule.
   - Manual quests added by hand.
   - Presets for washer, dryer, dishwasher and vacuum, covering both "smart appliance entity"
     and "power plug" variants, so setup is mostly "pick the entity".
2. **Help with starting**
   - **Just 2 minutes**: a button on every quest that commits only to 2 minutes; bonus XP for
     keeping going past it.
   - **Energy dice**: pick today's energy (low / medium / high) and roll; the game picks one
     fitting quest from open and recurring quests. Each quest has an energy level and a rough
     time estimate.
   - **Power sprint**: a 5 / 15 / 25 minute timer. While it runs, chosen lights switch to a
     sprint scene. During the sprint the player ticks off open quests or quick-logs small
     things done on the spot; the sprint pays base XP for the time plus each quest's XP. At
     the end the lights celebrate.
3. **Nudges** (each optional, set per quest type)
   - Phone notification through the HA Companion app (owner uses iPhone), with action buttons
     ("Start 2 min", "Later", "Done") that work without opening the app where possible.
   - Light signal: a chosen lamp glows a quest color while a quest is waiting.
   - Gentle repeat: if ignored, remind again later, each reminder friendlier rather than
     stricter, with a maximum number of repeats and quiet hours.
   - Spoken announcements: not possible as notifications on iPhone. v1 supports announcing
     through an HA media player (TTS) when one exists; the owner has none yet, so this is
     built but off by default.
4. **Rewards**
   - XP and levels for a cozy pixel-art hero who visibly grows.
   - Gold to spend on **unlocks**: HA actions the user configures (e.g. turn on the gaming PC
     plug, a cozy evening lighting scene), for a set time or until turned off. Unlocks are a
     **treat button only**: Cuest never blocks or turns off a device the user turned on
     themselves.
5. **No shame**
   - No red "overdue" lists. Missed quests quietly move to a "whenever" pool.
   - Never lose XP, gold, or levels. (Spending your own gold on something you chose is not losing it; Cuest itself never takes gold away.)
   - Streaks have freezes / rest days, so one missed day doesn't reset them.
   - Reminder wording is always kind.
6. **Voice through HA Assist** on the phone (and via Siri, which the HA iOS app can hand to
   Assist): "what's my quest", "roll the dice", "start sprint", "<quest> done".
7. **Multiple players, built in from day one**
   - Each player maps to an HA person and that person's phone for notifications.
   - House quests (e.g. washer done) are **shared**: everyone sees them, whoever taps "Start"
     claims it and earns the XP.
   - The wall tablet shows a player switcher (no passwords at home).
   - v1 UI is polished for one player; the data model and flows already work for several.

8. **More incentives** (chosen by the owner to make doing quests more tempting). Built around
   novelty, challenge, urgency and interest rather than duty.
   - **Surprise and collecting**
     - Loot drops: every finished quest has a chance to drop a cosmetic item (hat, cloak color,
       broom skin, village decoration). Rare drops are visibly special.
     - Mystery chest: appears every 5 finished quests; contains gold, an item, or a double-XP
       potion. Can be opened any time, not forced in the moment.
     - Pet companion: hatches from an egg after the first quests, follows the hero, learns
       tricks as quests are done. Never gets sad or sick; at most "sleepy".
     - Collection book: album of all items, pets and badges, with empty slots for undiscovered ones.
   - **Long goals**
     - Build your village: quests yield materials (wood, stone, flowers) to build and decorate
       a cozy village (bakery, garden, fountain...).
     - Story chapters: a short cozy story; a new chapter unlocks every few quests.
     - Badges: achievements such as "Laundry Legend" (50 loads) or "Night Owl" (quest after 22:00).
   - **Boosts in the moment**
     - Fresh-quest bonus: starting a house quest soon after it appears (e.g. within 15 minutes
       of the washer finishing) gives double XP. Never a penalty for starting later.
     - Combo chain: starting another quest within a short window after finishing one raises a
       multiplier (x2, x3...).
     - Quest of the day: one quest per day gives triple XP and a guaranteed loot drop.
     - House celebrates: on finishing, chosen lights flash a happy color and the app plays a
       short fanfare.
   - **Real-life rewards**
     - More house unlocks beyond PC and lights (e.g. favorite playlist on a media player, coffee
       machine pre-heats, bathroom heater warms up), all configured from HA entities.
     - Weekly recap: a Sunday summary of what was done, how the hero grew, new items found.
   - **Rule for all incentives**: rewards never slow down the real task. They arrive
     automatically or with one tap; anything that takes longer (opening chests, building the
     village, reading story) can wait until later.

9. **Works with most integrations: auto-detect** (owner's choice)
   - The bridge sends Cuest the list of HA entities with their registry details: domain,
     device_class, integration (platform), translation key, enum options, device name,
     manufacturer and model. Cuest proposes ready-made quests for what it recognizes; the
     owner confirms with one tap.
   - Recognized out of the box (owner's devices first): Home Connect (Bosch/Siemens), Miele,
     LG ThinQ, SmartThings (Samsung), Roborock, Xiaomi, Dreame, Ecovacs and any HA `vacuum`
     entity, smart plugs measuring power (Shelly, Tasmota, TP-Link and others), vibration
     sensors, and `running` binary sensors.
   - States differ by brand, model and language (e.g. `finished`, `finish`, `program_ended`,
     `end`), so detection must not rely on one exact value. Two generic rule kinds cover this:
     - **finished-state**: the entity changes to a value from a "done" vocabulary
       (normalized: lower case, spaces → underscores; English and German at least).
     - **running-stops**: the entity is "running" (a running-vocabulary value, `on`, or power
       above a threshold) and then stays not-running for N minutes. Pause-like states do not
       count as stopped.
   - Matching uses device and entity names in English and German (washer/Waschmaschine,
     dryer/Trockner, dishwasher/Geschirrspüler/Spülmaschine) to tell appliances apart.
   - Considered but not chosen for now: learn mode, a free rule builder, HA automations creating
     quests.
10. **Two-way with Home Assistant** (owner's choice: all four)
   - **Sensors** in HA: level, XP, gold, open quests count, streak.
   - **Events** in HA for automations: quest opened, quest done, level up (with details).
   - **Finish from HA**: quests can be completed from HA (dashboard button, NFC tag at the
     washer, Zigbee button) through Cuest actions in HA; open quests also appear as an HA
     to-do list so ticking one off there completes it.
   - **Dashboard card**: a small Cuest card for HA dashboards showing the hero and open quests.
11. **Things to spend gold on** (owner's choice: all four)
   - **House treats**: the unlocks from goal 4.
   - **Hero wardrobe**: hats, cloaks, scarves, broom skins and colors for the pixel hero.
   - **Village decor**: lanterns, flowers, a fountain, a village cat and so on, shown in the
     village scene.
   - **Helpers**: rest-day tokens that protect the streak, mystery chests, a "double XP hour"
     potion.
   - Prices are tuned so a normal day of quests buys something small, and bigger items are
     a goal for the week.

## 3. Releases

The feature set is large, so it ships in steps (the owner can reorder):

- **Release 1, daily game loop**: goals 1–5, 7, 9, 10 and 11, plus fresh-quest bonus, combo
  chain, quest of the day, house celebrates, loot drops, mystery chest, collection book, more
  house unlocks.
- **Release 2, friends and pride**: pet companion, badges, weekly recap, Assist voice (goal 6).
- **Release 3, the big world**: build your village, story chapters.

## 3b. Non-goals (v1)

- Leaderboards or competition between players; kids mode.
- Native App Store / Play Store apps.
- Cloud service or accounts outside the owner's home.
- Calendar sync, shopping lists, inventory.
- Assigning quest types to specific people (shared + first claim only in v1).
- Considered but not chosen for now: weekly boss monster, self-written treat list, sharing
  progress with a buddy.

## 4. Anti-goals (failure even if it works)

- Making the user feel guilty, punished, or nagged.
- Losing progress for missing tasks; locking devices away.
- Setup that needs hand-written YAML for normal use.
- Needing the internet or a third-party cloud to work.
- Noticeable extra load on the HA Raspberry Pi.
- So much game that doing the task takes longer than before.

## 5. Constraints

- HA runs on **Home Assistant OS on a Raspberry Pi**. The owner does not want Cuest's load on
  the Pi.
- The Cuest server runs on **a separate always-on PC or NAS at home, in Docker**.
- Owner's phone: **iPhone** with the HA Companion app.
- Devices: washer/dryer/dishwasher (smart or via power plug), smart lights, robot vacuum.
  No smart speaker yet. Exact integrations are not yet known; the owner will test presets
  against their real devices.
- Screens: phone, wall tablet / HA dashboard, voice via HA Assist.
- Public GitHub repository `cuest`. Art and sounds must have licenses that allow
  redistribution in a public repo.
- The owner mostly tests and gives feedback rather than coding; setup must be clickable.

## 6. Approaches considered

| Approach | Summary | Trade-off |
|---|---|---|
| A. HA integration + dashboard card | Everything inside HA, game in a dashboard card | Simplest install, but the cozy RPG look is squeezed into a card, and all load sits on the Pi |
| **B. Separate app (chosen)** | Own server + web app, talking to HA | Most freedom for look and logic; more work; runs off the Pi |
| C. Hybrid | Integration as the brain + full-screen panel inside HA | Middle ground, but still all on the Pi |

**Picked: B**, by the owner, for full freedom of look and logic. The owner then refined it:
the heavy part runs **outside** HA on a home PC/NAS, and only a thin piece is installed in HA.

## 7. Architecture (decided)

Two parts:

**1. Cuest server** (Docker container on the home PC/NAS)
- Holds all game logic, quests, players, XP, gold, unlocks, and the database.
- Holds the shop catalog, inventories and outfits; never serves the UI to the network directly (the UI comes through Home Assistant, see bridge).
- Keeps the full picture of quest rules (which entity, which condition makes a quest).

**2. Cuest bridge** (small HA custom integration, installed via HACS)
- Connects HA to the Cuest server on the home network.
- Forwards the entity state changes the server cares about.
- Runs actions the server asks for: lights, scenes, unlock switches, TTS, and phone
  notifications through `notify.mobile_app_*`; passes notification button presses back.
- Registers Assist voice intents and forwards them to the server.
- Sends the entity list with registry details for auto-detect (goal 9).
- Publishes Cuest's sensors, events, to-do list and "complete quest" actions in HA (goal 10).
- Ships the Cuest dashboard card.
- House treats: the owner picks in the integration options which scenes, scripts or switches Cuest may turn on, with a name and gold price each. The bridge only executes `turn_on` for exactly those entities. Timed treats are HA scripts the owner builds.
- Serves the cozy web app as a Home Assistant sidebar panel ("Cuest", at `/cuest`). The panel talks to the server through the bridge (an authenticated HA API endpoint that forwards over the bridge socket), so it works in the HA Companion app, remotely, and behind the HA login. Decided in plan 3; replaces the earlier "open the server's web page" idea.
- Optionally exposes a few sensors (current quest, level, open quests) for HA dashboards.
- Must stay light: no game logic, no database.
- Setup through the HA UI (config flow): enter the server address, pair once.

The server is written so it could also run on the Pi itself (e.g. as an add-on) later, but v1
ships only the Docker image.

**Look**: cozy fantasy RPG, pixel art, warm and calm (village, hero, soft colors).

## 8. Left to the builder

- Stack choices (suggested: TypeScript server and React frontend with SQLite; the bridge is
  Python, as HA integrations must be).
- How the server and bridge talk (e.g. WebSocket from bridge to server) and how they pair
  securely. The server must not need to be exposed to the internet; anything reachable on the
  home network needs at least a pairing secret between bridge and server.
- How the web app is reached from outside the home (v1 may be home-network only, as long as
  notifications, buttons and voice still work through HA from anywhere).
- Exact XP / gold / level curves, energy dice weighting, sprint XP.
- Quest rule format and preset details (power thresholds, wait times).
- Data model, API shape, folder layout, test setup, CI.
- Pixel-art assets (license-compatible packs or simple self-made art for v1).
- UI language: English first, all text in translation files so other languages can follow.
