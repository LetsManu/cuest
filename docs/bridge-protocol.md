# Bridge protocol

The Home Assistant bridge connects to the Cuest server at `GET /bridge` (WebSocket). All frames are JSON text, at most 64 KB. The bridge holds no game logic: it forwards states and events and executes service calls.

## Handshake

The first message must be `hello` with the shared secret, within 5 seconds. Otherwise the server sends `error` and closes with code `4001`. A newly authenticated bridge replaces the previous one (the old socket is closed with `4002`). After a successful hello the server sends `welcome`, then `subscribe` with the current entity list (re-sent on every reconnect). Invalid or unknown messages after auth are logged and ignored.

## Bridge to server

`hello`
```json
{ "type": "hello", "secret": "shared-secret", "version": "0.1.0" }
```

`state` (a subscribed entity changed)
```json
{ "type": "state", "entityId": "sensor.washer_power", "oldState": "3.1", "newState": "0.4", "at": "2026-01-01T10:00:00.000Z" }
```

- `state` messages are real transitions only. The bridge must not replay current-state snapshots as transitions when it subscribes or reconnects; the server would treat each one as a state change.
- `at` is the HA state's `last_changed` time, as an ISO-8601 UTC timestamp (a `Z` or numeric offset is required). The server clamps `at` to its own receive time, so a clock running ahead cannot make events appear to be from the future.

`notification_action` (the user tapped an action button on a mobile notification). `action` is the opaque string the server put on the button, forwarded unchanged; its format is `CUEST|<VERB>|<questId>|<playerId>` with `VERB` one of `START`, `DONE`, `LATER`.
```json
{ "type": "notification_action", "action": "CUEST|DONE|8f2c1a|b71d09", "at": "2026-01-01T10:00:00.000Z" }
```

`result` (outcome of a `call_service`)
```json
{ "type": "result", "id": "7c1e...", "ok": false, "error": "service not found" }
```

`entities` (the HA entity registry, sent after `welcome`; the bridge sends only domains `sensor`, `binary_sensor` and `vacuum`). The list is split into chunks; each chunk frame must stay below 64 KB. `chunk` counts from 0; `chunk: 0` (or a new connection) starts a new set, and the server delivers the set once the chunk with `last: true` arrives. Fields without a value are `null`.
```json
{ "type": "entities", "chunk": 0, "last": true, "entities": [ { "entityId": "sensor.washer_state", "domain": "sensor", "deviceId": "d1", "deviceClass": "enum", "platform": "miele", "translationKey": "status", "options": ["running", "finished"], "unit": null, "name": "Washer", "deviceName": "Washer", "manufacturer": "Miele", "model": "WWB", "state": "running" } ] }
```

`api` (tunnel to the Cuest REST API, answered by `api_result` with the same `id`). `method` is `GET`, `POST`, `PATCH` or `DELETE`; `path` must start with `/api/`, otherwise the server answers status `400` without handling it. Paths containing `..` segments, backslashes, control characters or percent-encoded `.`, `/` or `\` are refused the same way. If the server has no API handler it answers status `503`. `body` is optional.
```json
{ "type": "api", "id": "a1", "method": "POST", "path": "/api/quests/8f2c1a/done", "body": { "playerId": "b71d09" } }
```

## Server to bridge

`welcome`
```json
{ "type": "welcome" }
```

`subscribe` (the full list of entities to watch; replaces any previous list)
```json
{ "type": "subscribe", "entities": ["sensor.washer_power", "vacuum.robo"] }
```

`call_service`
```json
{ "type": "call_service", "id": "7c1e...", "domain": "notify", "service": "mobile_app_phone", "data": { "message": "Quest ready" }, "target": { "entity_id": "light.hall" } }
```
`target` is optional. The bridge executes service calls in the fixed domains `notify` and `light`. It also executes `turn_on` for a `scene`, `script`, `switch` or `input_boolean` entity, but only when `target.entity_id` is a single string that is on the owner's treat list (chosen in the integration options, read on every call). Anything else is reported back as a failed `result` with `error: "not_allowed"`.

`error` (sent before closing the socket)
```json
{ "type": "error", "reason": "unauthorized" }
```

`api_result` (answer to `api`; handler failures give status `500`, an unsupported path `400`, no handler `503`; a body that cannot be serialised gives `500` with `{ "error": "unserializable" }`)
```json
{ "type": "api_result", "id": "a1", "status": 200, "body": { "ok": true } }
```

`snapshot` (current players and open/active/whenever quests; the bridge renders it into HA entities). Each player also carries `outfit` (`items` per slot, `null` if empty; `palette` is the merged colour overrides of the equipped items), `decor` (owned decor item ids), `restTokens`, `streak` (current kind streak in days), `bestStreak` and `boostUntil` (ISO time while a double-XP boost runs, else `null`). The root also carries `questOfDay`: the id of today's quest of the day (local day in `CUEST_TZ`), or `null` when there is none yet. Bridges must ignore snapshot keys they do not know.
```json
{ "type": "snapshot", "players": [ { "id": "b71d09", "name": "Ada", "haPerson": "person.ada", "level": 3, "title": "Squire", "xp": 120, "gold": 15, "intoLevel": 20, "toNext": 80, "outfit": { "items": { "hood": "hood_ember", "scarf": null, "broom": null }, "palette": { "G": "#B5523B", "L": "#D47A5E", "g": "#8E3E2C" } }, "decor": ["lantern"], "restTokens": 1, "streak": 4, "bestStreak": 9, "boostUntil": null } ], "quests": [ { "id": "8f2c1a", "title": "Empty the washer", "status": "open", "claimedBy": null, "xp": 10, "minutes": 5, "templateId": null, "createdAt": "2026-01-01T10:00:00.000Z" } ], "questOfDay": "8f2c1a" }
```

`fire_event` (the bridge fires this HA event on the event bus). `event` is one of `cuest_quest_opened`, `cuest_quest_done`, `cuest_level_up`. The `data` keys are:
- `cuest_quest_opened`: `quest_id`, `title`, `xp`, `minutes`
- `cuest_quest_done`: `quest_id`, `title`, `player_id`, `player_name`, `xp`, `gold`
- `cuest_level_up`: `player_id`, `player_name`, `level`, `title`

```json
{ "type": "fire_event", "event": "cuest_level_up", "data": { "player_id": "b71d09", "player_name": "Ada", "level": 4, "title": "Hearthkeeper" } }
```
