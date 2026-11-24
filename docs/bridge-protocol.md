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
`target` is optional. The bridge should only execute service calls in the allowed domains `notify` and `light`, and report anything else back as a failed `result`. Plan 2 may extend this list.

`error` (sent before closing the socket)
```json
{ "type": "error", "reason": "unauthorized" }
```
