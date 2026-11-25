# Arcane Hearth dashboard cards

Eleven Home Assistant dashboard cards in the Arcane Hearth look: a pixel-art
house header, liquid orbs, a warmth trail, rune gauges, a quest board, a bard,
spell tiles and more. They ship inside the Cuest integration. The four dashboards in
[section 4](#4-dashboards) are ready to paste.

## 1. Enable

The cards come with the Cuest integration. There is no HACS card to add and no
Lovelace resource to create: when Cuest is set up, it serves
`/cuest/cuest-arcane.js` and Home Assistant loads it on every page.

- After you update Cuest, reload the browser (a hard reload on the first
  try) so the new card file is fetched.
- The fonts (Pixelify Sans and Inter) load from Google Fonts. If that is
  blocked (offline, an ad blocker, a DNS filter), the cards fall back to a
  monospace and a system font and still work.

### Install Cuest

The integration also needs the Cuest server and the bridge secret: follow
[install-home-assistant.md](install-home-assistant.md) for that setup.

With HACS (here called **Marketplace**):

1. Fix the Marketplace token if it shows as disabled: Settings, Devices &
   services, Marketplace, the three dots, Reconfigure (sign in with GitHub
   again).
2. Marketplace, the three dots, **Custom repositories**: add
   `https://github.com/LetsManu/cuest` as type **Integration**.
3. Open Cuest in Marketplace, **Download**, then restart Home Assistant.
4. Settings, Devices & services, **Add integration**, **Cuest**.

By hand: copy the folder `custom_components/cuest` from this repository into
`custom_components/cuest` on your Home Assistant (for example through the
Samba share `config`: `\\homeassistant\config\custom_components\cuest`),
restart Home Assistant, then add the integration **Cuest** as above.

## 2. Theme

The cards bring their own colours: panels, and a night background behind
headings and quest scrolls, so they look the same on Home Assistant's light and
dark themes. The dashboards in section 4 also set the view background
(`background: "#14172A"`), so the page around the cards is the night sky of the
mockups; keep that line. The theme below makes the rest of Home Assistant
(sidebar, toolbar, built-in cards) match. Add it once in
`configuration.yaml` (skip this if you already have a `frontend:` block; just
add the `themes:` line to it):

```yaml
frontend:
  themes: !include_dir_merge_named themes
```

Create the folder `themes` next to `configuration.yaml` and put this in
`themes/cuest_arcane.yaml`. Restart Home Assistant once if the `frontend:`
block is new; otherwise use Developer tools, Actions, **Frontend: Reload
themes**.

```yaml
Cuest Arcane:
  primary-background-color: "#14172A"
  lovelace-background: "#14172A"
  card-background-color: "#1D2140"
  ha-card-background: "#1D2140"
  ha-card-border-color: "#33395F"
  ha-card-border-width: 2px
  ha-card-border-radius: 18px
  primary-text-color: "#ECE4D2"
  secondary-text-color: "#A9A3BE"
  primary-color: "#F7D27A"
  accent-color: "#C9A14A"
  divider-color: "#2C3256"
  state-icon-color: "#F7D27A"
  app-header-background-color: "#14172A"
  app-header-text-color: "#F7D27A"
  sidebar-background-color: "#14172A"
  sidebar-text-color: "#ECE4D2"
```

Pick it for yourself under your profile, **Theme**, **Cuest Arcane**. To use
it on one dashboard only, edit the dashboard, open the pencil next to the
view name, and set **Theme**.

## 3. Card reference

All cards check their options when the dashboard loads. A wrong option shows
Home Assistant's red error card with the card name and the reason, for example
`cuest-trail-card: "hours" must be between 1 and 168`. A configured entity that
does not exist shows a small "Entity not found" panel inside the card.
Unknown, unavailable and non-numeric values show a dash, never `NaN`.

Entity ids in the options always look like `domain.name`.

### cuest-arcane-header

The pixel-art house under a night sky. Lit windows follow the lights that are
on: none on gives none lit, otherwise at least 1 and at most 5 lit. The clock
uses Home Assistant's time zone, or the browser's when your profile's time
zone setting says so. The `phone` and `wide` variants show `outside` and `inside`.

The same card also draws page titles (`variant: title`, 28 px, for example
"Spells") and section headings (`variant: section`, 18 px, for example
"Scenes") in the Arcane look. Use them instead of Home Assistant's `heading`
card: they paint their own night background, so they read the same on a light
or dark Home Assistant theme. These two variants need `title`, take an optional
`link`, and have no village, clock or orbs.

| Option | Default | Notes |
|---|---|---|
| `title` | `Cuest Home` | Heading text. |
| `mood` | `the house is happy` | Line under the heading. |
| `outside` | none | Temperature entity (`sensor.*` or `climate.*`). Shown as "{t} outside". The line is left out when the entity is missing or has no number. |
| `inside` | none | Same, shown as "{t} inside". |
| `variant` | `phone` | `phone` (210 px tall village), `wide` (heading and orbs side by side), `title` (page title) or `section` (section heading). |
| `orbs` | none | Only with `variant: wide`. Up to 4 orb items, same options as in `cuest-orb-card`. |
| `link` | none | Only with `variant: title` or `section`: `name` and `path`, shown as a link on the right, for example `{ name: Home, path: /system-ok/ok }`. |

```yaml
type: custom:cuest-arcane-header
title: Cuest Home
outside: sensor.cuest_outside_temperature  # replace entity id
inside: sensor.climate_sensor_temperature
```

### cuest-orb-card

One to four liquid orbs in one panel. Use either one orb directly on the
card (it still needs `preset:`), or `orbs:` with up to 4 items. Each orb
takes:

| Option | Default | Notes |
|---|---|---|
| `preset` | required | `online` (share of entities that are not unavailable), `lights` (lights on), `health` (quest board health), `percent` (an entity that already holds 0 to 100), `ratio` (entity divided by `max`). |
| `color` | by preset | `mana` (online, percent, ratio), `health` (health), `glow` (lights). |
| `entity` | none | Required for `percent` and `ratio`. |
| `max` | none | Required for `ratio`: a number above 0 or an entity id. |
| `label` | by colour | Word before the number: Mana, Health or Glow. |
| `sublabel` | by preset | Small text under the number, for example "online", "3 quests", "lights on". |
| `domains` | none | `online` only: count only these domains. Without it, automation, script, scene, zone, sun, person, update and `input_*` are skipped. |
| `integrations` | none | `online` only: count only these integrations. |
| `exclude` | none | Entity ids to leave out; `*` is a wildcard. Works for `online`, `lights` and `health`. |
| `battery_threshold` | `20` | `health` only, 1 to 100. |

Online share is the share of counted entities whose state is not
`unavailable`. Lights count only real lights: light groups (a group helper, a
Zigbee2MQTT or Hue group) are skipped, so a group and its members never count
twice. Health is `100 * (checked - faulty) / checked` rounded, or 100 when
nothing is checked (see Quest board for what is checked).

```yaml
type: custom:cuest-orb-card
orbs:
  - preset: online
  - preset: health
  - preset: lights
```

### cuest-trail-card

A line chart of one or two sensors from the Home Assistant history. The
history is fetched when the card loads and then at most once every 5 minutes.
The chart is resampled to at most 48 points. With two sensors each line gets
its own scale by default: the main sensor in the upper part of the chart, the
second one in a strip below it, as in the mockup (`scale: shared` puts both on
one scale over the full height).

| Option | Default | Notes |
|---|---|---|
| `entity` | required | Main sensor (gradient line). |
| `entity2` | none | Second sensor (dashed blue line). |
| `name`, `name2` | friendly names | Legend names. |
| `hours` | `24` | Span, 1 to 168. |
| `scale` | `separate` | `separate` (each line on its own range, main above, second below) or `shared` (one range for both lines). Only matters with `entity2`. |
| `title` | `Warmth trail` | Heading. |

```yaml
type: custom:cuest-trail-card
entity: sensor.climate_sensor_temperature
entity2: sensor.cuest_outside_temperature
hours: 24
```

### cuest-rune-gauge

A round gauge. For a thermostat it shows the target and has minus and plus
buttons; for a sensor it shows the value. Taps are debounced for 800 ms and
send one `climate.set_temperature` with the final target. The step is the
thermostat's `target_temp_step` (default 0.5); the range is its `min_temp` and
`max_temp` (default 7 to 35). Thermostats in `heat_cool` mode show their range
without buttons.

| Option | Default | Notes |
|---|---|---|
| `entity` | required | `climate.*` or `sensor.*`. |
| `rune` | `fire` for climate; `water` for humidity sensors, else `arcane` | `fire`, `water` or `arcane`. |
| `name` | friendly name | Shown in the title. |
| `controls` | `true` | `false` hides the buttons and makes the card compact. |
| `min`, `max` | sensors: 0 and 100 | Scale of a sensor. `min` must be below `max`. |

```yaml
type: custom:cuest-rune-gauge
entity: climate.thermostat_buero  # replace entity id
rune: fire
```

### cuest-quest-board

Everything that needs a hand, as small quests with XP, found by itself:

| Quest | When | XP |
|---|---|---|
| Critical battery | `sensor` with `device_class: battery` and unit `%`, at or below 5 % | 30 |
| Problem | `binary_sensor` with `device_class: problem` that is `on`; two or more on devices of the same model become one scroll | 20 |
| Impossible temperature | temperature sensor below -50 or above 100 degrees C (Fahrenheit is converted); merged into the device's battery scroll if it has one | 10 |
| Update | an `update.*` entity that is `on` | 10 |
| Low battery | a battery `sensor` at or below `battery_threshold`; or a `binary_sensor` with `device_class: battery` that is `on` | 5 |

Order: critical battery, problem, temperature, low battery, update, then by
name. The compact teaser uses shorter wording: a battery quest reads
"{device model} at {n} %" (for example "Thermostat at 0 %") and a group of
problems reads "Check 3 thermostat valves" with just the rooms underneath. A
model that is a product code (digits, dots or underscores, or longer than 20
characters, such as TS0601) is left out: "Battery at 14 %", "Check 3 devices".
The full board keeps the long wording. Health is `100 * (checked - faulty) / checked`, where `checked` is the
number of battery, problem, temperature and update entities inspected after
`exclude`, and `faulty` the distinct entities among them that have a quest.

Home Assistant admins also see **Add to my Cuest quests** (adds the small
quest to the Cuest quest list; battery 5 minutes, problem 10, temperature 5,
energy low) and **Install** on updates. Everyone else sees neither button.

| Option | Default | Notes |
|---|---|---|
| `title` | `Quest board` | Heading. |
| `variant` | `full` | `full` or `compact`. |
| `limit` | `full`: all, `compact`: 2 | 1 to 100. |
| `battery_threshold` | `20` | 1 to 100. |
| `exclude` | none | Entity ids to ignore; `*` is a wildcard. |
| `more_path` | none | Where the "more on the board" link goes, for example `/system-faults`. |
| `show_summary` | `false` | Adds the health orb and the summary line. |
| `allow_add` | `true` | `false` hides the add button for admins too. |

```yaml
type: custom:cuest-quest-board
variant: compact
more_path: /system-faults
```

### cuest-allies-card

Integrations that are resting: an integration (from the entity registry) with
at least `min_entities` entities of which half or more are `unavailable`.
Sorted by the number of unavailable entities; the first `limit` are shown with
a "+ N more allies" button for the rest.

| Option | Default | Notes |
|---|---|---|
| `title` | `Resting allies` | Heading. |
| `limit` | `4` | 1 to 50. |
| `min_entities` | `1` | Ignore integrations with fewer entities. |
| `ignore` | none | Integration names to skip, for example `ibeacon`. |
| `names` | none | Map of integration name to display name. |

```yaml
type: custom:cuest-allies-card
ignore:
  - ibeacon
```

### cuest-hero-card

Your Cuest hero: level, title, XP bar, streak and chest keys. XP needed
comes from the Cuest sensors.

| Option | Default | Notes |
|---|---|---|
| `player` | the player linked to the logged-in user | A Cuest player id, for a card about one person. |

```yaml
type: custom:cuest-hero-card
```

### cuest-rooms-card

One row per room with the number of lit lights and the temperature. A row shows
"check" when the only reading is impossible and "battery" when the sensor's
battery is at or below `battery_threshold`.

| Option | Default | Notes |
|---|---|---|
| `title` | `Rooms` | `null` hides the heading. |
| `heading` | `outside` | `outside` puts the heading above the panel, `inside` inside it. |
| `areas` | all areas | A list of area names or ids, or items `{ area, name, temperature }`. |
| `path` | none | Makes rows tappable. `{area}` is replaced by the area id. |
| `battery_threshold` | `20` | 1 to 100. |

```yaml
type: custom:cuest-rooms-card
areas:
  - Wohnzimmer
  - area: Küche
    name: Kitchen
    temperature: sensor.thermostat_kueche_local_temperature
path: /home-control
```

### cuest-bard-card

A media player card with title, progress, transport buttons, volume and up to
4 source buttons. The progress is recomputed only when the player reports a new
state. Source buttons call a service when tapped.

| Option | Default | Notes |
|---|---|---|
| `entity` | required | `media_player.*`. |
| `variant` | `full` | `full` or `compact`. |
| `name` | area name or friendly name | Shown as "Bard · name". |
| `sources` | none | Up to 4 items: `name`, `service` (`domain.service`), optional `data` (sent as the service data). |

```yaml
type: custom:cuest-bard-card
entity: media_player.wohnzimmer_3  # replace entity id
sources:
  - name: Radio
    service: script.turn_on  # replace entity id
    data:
      entity_id: script.radio  # replace entity id
```

### cuest-spell-tile

A tile that casts a spell: toggle a light, activate a scene or call a service.
Hold a tile for half a second to open its more-info dialog.

| Option | Default | Notes |
|---|---|---|
| `variant` | `icon` | `icon` (square), `wide` (with state text) or `scene` (slim). |
| `entity` | none | Needed unless the tap action is `call-service`. |
| `name` | friendly name | Label. |
| `icon` | by entity | `bulb`, `tv`, `pc`, `shield`, `spark`, or an `mdi:` name. |
| `tone` | `gold` | `gold` or `green`. |
| `state_text` | the state | `wide` only: replaces the state text. |
| `tap_action` | toggle for light, switch, input_boolean and fan; activate for scene and script; press for button; otherwise more-info | `action`: `toggle`, `call-service`, `more-info` or `none`. With `call-service`: `service` and optional `data`. A `tap_action` without `action` toggles a light, switch, input_boolean or fan tile; for any other tile, or with a `service`, `action` is required. |

```yaml
type: custom:cuest-spell-tile
variant: icon
entity: light.alle_lichter_im_haus
name: All lights
icon: bulb
```

### cuest-stamina-card

The weakest batteries as five-segment bars. Segments filled are
`ceil(percent / 20)`; at or below `threshold` the bar turns coral.

| Option | Default | Notes |
|---|---|---|
| `title` | `Stamina` | Heading. |
| `entities` | every battery sensor | A fixed list of entity ids instead. |
| `exclude` | none | Entity ids to ignore; `*` is a wildcard. |
| `limit` | `8` | 1 to 100. |
| `threshold` | `20` | 0 to 100. |

```yaml
type: custom:cuest-stamina-card
limit: 8
```

## 4. Dashboards

Four ready dashboards. They are drop-in replacements for your current
dashboards **Cuest Home** (`/system-ok`, views `ok` and `desktop`), **Quest
board** (`/system-faults`, view `faults`) and **Spells** (`/home-control`, view
`control`). To paste one: open the dashboard, pencil, three dots, **Raw
configuration editor**, replace everything, Save. Cuest Home has two views
(phone and desktop), shown as two blocks: paste the Overview block, then add
the desktop view as a second entry under its `views:`.

The views keep the tab icons of the interim build. The old markdown header
banner of each view is not repeated: the Cuest cards carry their own headings
(masonry views have no header area).

Entity ids come from your Home Assistant. A line ending with
`# replace entity id` is a guess or something that does not exist right now
(for example the Music Assistant players are unavailable at the moment).

### Overview (phone)

View `ok`, one column.

```yaml
title: Cuest Home
views:
  - title: Home
    path: ok
    icon: mdi:home-heart
    type: masonry
    background: "#14172A"
    cards:
      - type: custom:cuest-arcane-header
        outside: sensor.cuest_outside_temperature
        inside: sensor.climate_sensor_temperature
      - type: custom:cuest-orb-card
        orbs:
          - preset: online
          - preset: health
          - preset: lights
      - type: custom:cuest-hero-card
      - type: custom:cuest-quest-board
        variant: compact
        more_path: /system-faults
      - type: custom:cuest-trail-card
        entity: sensor.climate_sensor_temperature
        entity2: sensor.cuest_outside_temperature
        name: Wohnzimmer
        name2: outside
      - type: custom:cuest-rooms-card
        areas:
          - Wohnzimmer
          - Küche
          - Schlafzimmer
          - Büro
        path: /home-control
      - type: custom:cuest-bard-card
        variant: compact
        entity: media_player.wohnzimmer_3  # replace entity id
```

### Quest board

Dashboard at `/system-faults`, view `faults`.

```yaml
title: Quest board
views:
  - title: Quests
    path: faults
    icon: mdi:script-text-outline
    type: masonry
    background: "#14172A"
    cards:
      - type: custom:cuest-arcane-header
        variant: title
        title: Quest board
        link:
          name: Home
          path: /system-ok/ok
      - type: custom:cuest-quest-board
        variant: full
        show_summary: true
      - type: custom:cuest-allies-card
        ignore:
          - ibeacon
```

Want the weakest batteries too? Add `- type: custom:cuest-stamina-card` at the
end (the mockup leaves it out; the battery quests are on the board already).

### Home control

Dashboard at `/home-control`, view `control`: the page title, four spell
tiles, the bard, one block per room, and scenes. Headings are
`cuest-arcane-header` cards with `variant: section`, so they look the same on
every Home Assistant theme.

```yaml
title: Spells
views:
  - title: Spells
    path: control
    icon: mdi:wizard-hat
    type: masonry
    background: "#14172A"
    cards:
      - type: custom:cuest-arcane-header
        variant: title
        title: Spells
      - type: grid
        columns: 4
        square: false
        cards:
          - type: custom:cuest-spell-tile
            variant: icon
            entity: light.alle_lichter_im_haus
            name: All lights
            icon: bulb
          - type: custom:cuest-spell-tile
            variant: icon
            entity: scene.tv_beleuchtung  # replace entity id
            name: TV light
            icon: tv
          - type: custom:cuest-spell-tile
            variant: icon
            entity: button.wake_on_lan_18_31_bf_cf_d9_8b  # replace entity id
            name: Wake PC
            icon: pc
          - type: custom:cuest-spell-tile
            variant: icon
            entity: switch.adguard_home_schutz  # replace entity id
            name: Shield
            icon: shield
            tone: green
      - type: custom:cuest-bard-card
        entity: media_player.wohnzimmer_3  # replace entity id
        sources:
          - name: Radio
            service: script.turn_on  # replace entity id
            data:
              entity_id: script.radio  # replace entity id
          - name: Playlists
            service: script.turn_on  # replace entity id
            data:
              entity_id: script.playlists  # replace entity id
          - name: Friendflix
            service: script.turn_on  # replace entity id
            data:
              entity_id: script.friendflix  # replace entity id
      - type: custom:cuest-arcane-header
        variant: section
        title: Wohnzimmer
      - type: grid
        columns: 2
        square: false
        cards:
          - type: custom:cuest-spell-tile
            variant: wide
            entity: light.wohnzimmer
            name: Ceiling
          - type: custom:cuest-spell-tile
            variant: wide
            entity: light.wohnzimmer_spots
            name: Spots
          - type: custom:cuest-spell-tile
            variant: wide
            entity: light.lampe_wohnzimmer
            name: Lamp
          - type: custom:cuest-spell-tile
            variant: wide
            entity: vacuum.monsga_ms1_max
            name: Robot vacuum
            tap_action:
              action: call-service
              service: vacuum.start
              data:
                entity_id: vacuum.monsga_ms1_max
      - type: custom:cuest-rune-gauge
        entity: climate.0x54ef4410009a9a50
        name: Wohnzimmer
      - type: custom:cuest-arcane-header
        variant: section
        title: Schlafzimmer
      - type: grid
        columns: 2
        square: false
        cards:
          - type: custom:cuest-spell-tile
            variant: wide
            entity: light.schlafzimmer_lichter
            name: Lights
      - type: custom:cuest-arcane-header
        variant: section
        title: Küche
      - type: custom:cuest-rune-gauge
        entity: climate.0x54ef441000a5b789
        name: Küche
      - type: custom:cuest-arcane-header
        variant: section
        title: Büro
      - type: grid
        columns: 2
        square: false
        cards:
          - type: custom:cuest-spell-tile
            variant: wide
            entity: light.buero  # replace entity id
            name: Lights
      - type: custom:cuest-rune-gauge
        entity: climate.thermostat_buero
        name: Büro
      - type: custom:cuest-arcane-header
        variant: section
        title: Bad
      - type: grid
        columns: 2
        square: false
        cards:
          - type: custom:cuest-spell-tile
            variant: wide
            entity: light.bad  # replace entity id
            name: Lights
      - type: custom:cuest-arcane-header
        variant: section
        title: Vorhaus
      - type: grid
        columns: 2
        square: false
        cards:
          - type: custom:cuest-spell-tile
            variant: wide
            entity: light.vorhaus  # replace entity id
            name: Lights
      - type: custom:cuest-arcane-header
        variant: section
        title: Scenes
      - type: grid
        columns: 3
        square: false
        cards:
          - type: custom:cuest-spell-tile
            variant: scene
            entity: scene.cozy_evening  # replace entity id
            name: Cozy evening
          - type: custom:cuest-spell-tile
            variant: scene
            entity: scene.tv_beleuchtung  # replace entity id
            name: Movie night
          - type: custom:cuest-spell-tile
            variant: scene
            entity: scene.power_sprint  # replace entity id
            name: Power sprint
```

### Desktop overview

View `desktop` of Cuest Home: a sections view with three columns. The wide
header sits in its own first section that spans all three columns
(`column_span: 3`, Home Assistant 2024.9 or newer), so it runs the full width of
the view; the other cards follow in three column sections below it. On a narrow
screen the sections stack. Add it as a second entry under `views:` of the
Overview, or paste it alone while testing.

```yaml
title: Cuest Home
views:
  - title: Desktop
    path: desktop
    icon: mdi:monitor-dashboard
    type: sections
    max_columns: 3
    dense_section_placement: true
    background: "#14172A"
    sections:
      - type: grid
        column_span: 3
        cards:
          - type: custom:cuest-arcane-header
            variant: wide
            outside: sensor.cuest_outside_temperature
            orbs:
              - preset: online
              - preset: health
              - preset: lights
            grid_options:
              columns: full
      - type: grid
        cards:
          - type: custom:cuest-hero-card
          - type: custom:cuest-rooms-card
            heading: inside
            areas:
              - Wohnzimmer
              - Küche
              - Schlafzimmer
              - Büro
            path: /home-control
      - type: grid
        cards:
          - type: custom:cuest-trail-card
            entity: sensor.climate_sensor_temperature
            entity2: sensor.cuest_outside_temperature
            name: Wohnzimmer
            name2: outside
          - type: custom:cuest-rune-gauge
            entity: climate.0x54ef441000a5b789
            rune: fire
            controls: false
          - type: custom:cuest-rune-gauge
            entity: sensor.climate_sensor_humidity  # replace entity id
            rune: water
            controls: false
      - type: grid
        cards:
          - type: custom:cuest-quest-board
            variant: compact
            title: Quest board
            more_path: /system-faults
          - type: custom:cuest-bard-card
            variant: compact
            entity: media_player.wohnzimmer_3  # replace entity id
```

### Swap from the built-in cards

If you are using the interim dashboards built from Home Assistant's own
cards, change each card's `type:` (card, three dots, **Edit in YAML**) and
drop options the new card does not know:

| Place | Built-in card now | Cuest card |
|---|---|---|
| Header line (time, mood, temperatures) | `markdown` | `custom:cuest-arcane-header` |
| Mana / Health / Glow | three `gauge` cards on `sensor.cuest_mana`, `sensor.cuest_small_quests`, `sensor.cuest_glow` | one `custom:cuest-orb-card` with three `orbs` items: `- preset: online`, `- preset: health`, `- preset: lights` |
| Warmth trail | `history-graph` | `custom:cuest-trail-card` |
| Fire rune / Water rune | `gauge` (desktop) and `thermostat` (spells) | `custom:cuest-rune-gauge` |
| Quests, quest teaser | `markdown` with `ha-alert` lines | `custom:cuest-quest-board` |
| Resting allies | `markdown` with bars | `custom:cuest-allies-card` |
| Low batteries | `entities` or markdown | `custom:cuest-stamina-card` |
| Hero | tiles of the Cuest entities | `custom:cuest-hero-card` |
| Rooms | `area` cards | `custom:cuest-rooms-card` |
| Bard | `media-control` | `custom:cuest-bard-card` |
| Quick spells and lights | `tile` | `custom:cuest-spell-tile` |
| Scenes | `tile` on scenes | `custom:cuest-spell-tile` with `variant: scene` |

The helper sensors `sensor.cuest_mana`, `sensor.cuest_small_quests` and
`sensor.cuest_glow` are no longer needed once the orb card is in place: the
orbs work them out from your entities. You can delete the helpers later.

## 5. Notes

- Area names are matched by name or by id and ignoring case, so `Büro` and
  `buero` both work.
- Light groups never count twice: a group helper, a Zigbee2MQTT group and a Hue
  group are skipped by Glow, the header windows and the rooms' lit counts.
- Adding a quest from the quest board needs a Home Assistant admin. Other
  users see the quests but no buttons.
- The cards do not poll, except that the trail card refreshes its history at
  most every 5 minutes. They redraw when the part of Home Assistant
  they show changes; the header clock ticks once a minute.
- Motion (waves, spinning rings, sparks, twinkling stars) stops when the
  device asks for reduced motion.
