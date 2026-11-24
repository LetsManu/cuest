# Cuest

Cuest turns everyday chores into small, friendly quests. It connects to your
Home Assistant, notices things like "the washing machine just finished", and
offers a quest to whoever is home. Finish quests to earn XP and gold and level
up. There are no penalties: quests never expire in a scary way, they just wait
until you are ready.

**Status: early development.** Only the server core exists so far. It is not
ready for everyday use yet.

## Install (PC or NAS with Docker)

1. Install Docker (and Docker Compose) on your PC or NAS.
2. Copy `docker-compose.example.yml` to `docker-compose.yml` and set `CUEST_TZ`
   to your own time zone, for example `Europe/Amsterdam`.
3. Start it:

   ```
   docker compose up -d
   ```

4. Check that it runs: open `http://<your-pc-or-nas>:8787/api/health` in a
   browser. You should see `{"ok":true,"bridge":false}`.

Your data lives in the `cuest-data` folder next to the compose file.

## The bridge secret

The Home Assistant bridge proves who it is with a shared secret. The first time
Cuest starts it creates one for you and saves it in
`cuest-data/bridge-secret` (the log says "Bridge secret created"). Copy it into
the bridge settings in Home Assistant. If you prefer your own, set
`CUEST_BRIDGE_SECRET` in the compose file.

## More

- Design: [docs/superpowers/specs/2026-11-24-cuest-design.md](docs/superpowers/specs/2026-11-24-cuest-design.md)
- Bridge protocol: [docs/bridge-protocol.md](docs/bridge-protocol.md)
