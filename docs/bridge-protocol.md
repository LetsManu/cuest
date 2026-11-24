# Bridge protocol

The Home Assistant bridge connects to the Cuest server at `GET /bridge` (WebSocket). All frames are JSON text, at most 64 KB. The bridge holds no game logic: it forwards states and events and executes service calls.

## Handshake

The first message must be `hello` with the shared secret, within 5 seconds. Otherwise the server sends `error` and closes with code `4001`. A newly authenticated bridge replaces the previous one (the old socket is closed with `4002`). After a successful hello the server sends `welcome`, then `subscribe` with the current entity list (re-sent on every reconnect). Invalid or unknown messages after auth are logged and ignored.

## Bridge to server

`hello`
```json
{ "type": "hello", "secret": "shared-secret", "version": "0.1.0" }
```

`state` (a subscribed entity changed; `at` is ISO-8601 UTC)
```json
{ "type": "state", "entityId": "sensor.washer_power", "oldState": "3.1", "newState": "0.4", "at": "2026-01-01T10:00:00.000Z" }
```

`notification_action` (the user tapped an action button on a mobile notification)
```json
{ "type": "notification_action", "action": "CUEST_DONE_12", "at": "2026-01-01T10:00:00.000Z" }
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
`target` is optional.

`error` (sent before closing the socket)
```json
{ "type": "error", "reason": "unauthorized" }
```
