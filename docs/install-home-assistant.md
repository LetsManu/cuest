# Installing Cuest in Home Assistant

This guide is for you if you are not a developer. Follow the steps in order.
It takes about 20 minutes. You need a PC or NAS that stays on (for the Cuest
server) and a working Home Assistant with the HACS add-on installed.

## Part 1: Start the Cuest server

1. On the PC or NAS that stays on, install Docker (with Docker Compose).
2. Download the Cuest files from <https://github.com/LetsManu/cuest> and open
   that folder in a terminal.
3. Copy `docker-compose.example.yml` to `docker-compose.yml`. Open it and set
   `CUEST_TZ` to your time zone, for example `Europe/Amsterdam`.
4. Start the server:

   ```
   docker compose up -d
   ```

5. Check that it runs: open `http://<your-pc-or-nas>:8787/api/health` in a
   browser. You should see `{"ok":true,...}`.
6. Find the secret. Cuest made a password (the "bridge secret") the first time
   it started. Show it with:

   ```
   docker compose exec cuest cat /data/bridge-secret
   ```

   Copy it. You will paste it into Home Assistant in step 12.

## Part 2: Install the Cuest integration

7. In Home Assistant open **HACS**. Click the three dots in the top right and
   choose **Custom repositories**.
8. Paste `https://github.com/LetsManu/cuest`, choose the category
   **Integration**, and click **Add**.
9. Find **Cuest** in HACS, click **Download**, then restart Home Assistant
   (**Settings → System → Restart**).
10. Go to **Settings → Devices & services → Add integration** and search for
    **Cuest**.
11. Enter the server address, for example `http://192.168.1.20:8787` (the
    address of your PC or NAS, with port 8787).
12. Paste the secret from step 6 and click **Submit**.

## Part 3: Tell Cuest who is who

13. On the Cuest integration click **Configure** and choose **People**.
14. Pick yourself, and pick your iPhone (so Cuest can send you
    notifications). Repeat for everyone who plays.
15. Click **Configure** again and choose **Devices**. Cuest suggests the
    appliances it recognised (washing machine, dishwasher and so on). Tick the
    ones you want to turn into quests.

## Part 4: Add the card to your dashboard

16. Open the dashboard you want, click the pencil (**Edit dashboard**), then
    **Add card**.
17. Search for **Cuest** and pick it. If you want a card for one person,
    switch to the code editor and add `person: person.your_name`. Click
    **Save**.

The card shows your hero, level, XP bar, gold and your open quests, each with
a **Done** button.

## Optional: finish a quest with an NFC tag

Stick an NFC tag on, for example, the dishwasher. Scan it once with the Home
Assistant app so it is registered, then:

1. Import the blueprint: open
   **Settings → Automations & scenes → Blueprints → Import blueprint** and paste:
   `https://github.com/LetsManu/cuest/blob/main/blueprints/automation/cuest/nfc_complete_quest.yaml`
2. Create an automation from it. Enter the tag's ID and the exact title of the
   quest (for example "Empty the dishwasher").
3. Scanning the tag now completes that quest. The credit goes to the player
   linked to whoever runs the automation, or the first player if there is
   none.

## When something goes wrong

**"Could not reach the Cuest server"**
Home Assistant cannot open the address you entered. Check that the server is
running (`docker compose ps`), that the address and port 8787 are right, and
that the PC or NAS is on the same network as Home Assistant. Open
`http://<address>:8787/api/health` in a browser to test it.

**"The secret doesn't match" (a repair appears in Settings)**
The secret in Home Assistant is not the one the server uses. Show it again
with `docker compose exec cuest cat /data/bridge-secret`, then open the repair
and paste the new secret.

**The card is missing from the card list**
Reload the page with the browser cache cleared (Ctrl+F5). On the phone app use
**Settings → Companion app → Debugging → Reset frontend cache**.
