# Installing Cuest in Home Assistant

This guide is for you if you are not a developer. Follow the steps in order.
It takes about 20 minutes. You need a PC or NAS that stays on (for the Cuest
server) and a working Home Assistant with HACS (the Home Assistant Community
Store integration) installed.

## Part 1: Start the Cuest server

1. On the PC or NAS that stays on, install Docker (with Docker Compose).
2. Get the Cuest files. On <https://github.com/LetsManu/cuest> click the green
   **Code** button, then **Download ZIP**, unzip it and open a terminal in that
   folder. (If you know git, `git clone https://github.com/LetsManu/cuest`
   does the same.)
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

13. On the Cuest integration click **Configure** and choose
    **People and their phones**. Tick the people who play, then continue.
14. Cuest now asks **Phone for <person>** once for each person. Pick that
    person's iPhone so Cuest can send them notifications, or pick
    **No phone** if they should not get any.
15. Click **Configure** again and choose **Devices found in your home**. Cuest
    suggests the appliances it recognised (washing machine, dishwasher and so
    on). Tick the ones you want to turn into quests.

## Part 4: Add the card to your dashboard

16. Open the dashboard you want, click the pencil (**Edit dashboard**), then
    **Add card**.
17. Search for **Cuest** and pick it. If you want a card for one person,
    switch to the code editor and add `person: person.your_name`. Click
    **Save**.

The card shows your hero (wearing your outfit), level, XP bar, gold and your
open quests, each with a **Done** button.

Note: **Done** on the card (and ticking a quest in the to-do list) credits the
player linked to the Home Assistant user who is logged in. On a shared wall
tablet, log in as the person who did the quest, or use their phone.

## Open Cuest

Cuest adds its own page to Home Assistant.

1. Open **Cuest** in the Home Assistant sidebar (the list on the left). The
   same entry is in the Home Assistant app on the iPhone, from anywhere Home
   Assistant is reachable.
2. If your Home Assistant user is not linked to a player yet, Cuest asks
   **Who's playing?**. Pick your hero. This device remembers it.
3. To play as someone else, use **Switch player**. It only shows when there is
   more than one player.

A family member whose Home Assistant user is linked to a player (through their
person) always plays as themselves. A shared account with no linked person,
such as a wall tablet, can switch between players.

People who are not Home Assistant administrators can play (finish quests) and
shop, but they cannot change settings.

## House treats

A house treat is something in your home that a player can buy with gold, for
example a movie-night scene or the gaming PC.

1. Go to **Settings → Devices & services → Cuest → Configure** and choose
   **House treats**.
2. Pick the scenes, scripts, switches or input booleans that may be treats.
3. For each one, give it a name and a price in gold (5 to 1000, in steps of 5).

Cuest can only switch on exactly the things you picked, and it can only turn
them on. It never turns anything off.

### A treat that lasts for a set time

Because Cuest only turns things on, make a script that also turns it off again.
For "Gaming PC for 1 hour":

1. Go to **Settings → Automations & scenes → Scripts → New script**.
2. Add three actions: turn on `switch.gaming_pc`, wait one hour, turn off
   `switch.gaming_pc`. In YAML it looks like this:

   ```yaml
   mode: queued
   sequence:
     - action: switch.turn_on
       target:
         entity_id: switch.gaming_pc
     - delay: "1:00:00"
     - action: switch.turn_off
       target:
         entity_id: switch.gaming_pc
   ```

   `mode: queued` means buying the treat again while it is still running adds
   another hour after the current one, instead of being ignored.
3. Save it with a clear name, then pick that script under **House treats**.

If Home Assistant is not connected to Cuest, the shop shows a message and no
gold is spent.

## The shop

Open **Shop** in the Cuest page. It has four tabs: **House treats**,
**Wardrobe**, **Village** and **Helpers**. Gold is never taken away. It is only
spent when you buy something.

- **House treats**: your own treats from above, at the prices you set. They can
  be bought again and again.
- **Wardrobe** (buy once, then **Wear**; the worn item shows **Wearing**):
  Ember hood (40 gold), Night-sky hood (70), Teal scarf (25), Golden broom (80).
  Your outfit shows on your hero, also on the dashboard card.
- **Village** (buy once, then **In village**): Village lantern (30), Flower bed
  (20), Village cat (60), Little fountain (90).
- **Helpers** (can be bought again):
  - Rest-day token (50): saved for later. It covers a day you could not play,
    so your streak keeps going (see Streaks and rest days below).
  - Mystery chest (40): half the time a wardrobe item you do not own yet,
    otherwise 20 to 80 gold. If you own all wardrobe items, you get gold.
  - Double XP hour (70): quests you finish in the next hour give double XP
    (gold stays the same). Buying again adds another hour.

## Celebrations (optional)

Cuest can flash your lights when someone finishes a quest. Go to
**Settings > Devices & services > Cuest > Configure > Celebrations**.

- **Celebration lights**: pick up to 20 lights. They flash briefly when a quest
  is done and for longer on a level up.
- **Sprint scene** (optional): a scene that switches on when a power sprint
  starts. When the sprint ends, the lights flash to celebrate.

If a light or scene is unavailable, Cuest simply skips it. A problem with your
lights never stops a quest from being finished or its reward from being given.

Sounds are played in the Cuest page itself. Use the **Sound** button there to
switch them on or off. If you would rather have sounds from your own speakers,
automations can listen for the `cuest_quest_done` and `cuest_level_up` events.

## Energy dice

Not sure where to start? Open **Dice** in the Cuest page, say how your energy
is (**Low**, **Okay** or **High**) and tap **Roll**. Cuest picks a waiting quest
that fits. Tap **Another** for a different one.

If nothing matches your energy, you get the closest fit. If there are no quests
at all, Cuest suggests a tiny one: "Quick tidy: put 5 things back where they
belong" (2 minutes, 10 XP) that you can start right away. A quick suggestion
gives a small flat reward: its 10 XP and a little gold, and it counts for your
streak, but it has no bonuses, loot or chest-key progress and is never the
Quest of the day. When a real quest is waiting, Cuest asks you to roll again.

## Power sprint

A power sprint is a timed burst of effort. Pick **5**, **15** or **25** minutes
and start.

- You earn 2 XP for every minute of the sprint.
- Jotted down something small you did along the way? Quick-log it for +5 XP
  each, up to 10 per sprint.
- Quests you finish during a sprint give their normal rewards on top.
- You can end a sprint early and keep what you have earned: the XP counts for
  the whole minutes that passed.

## Streaks and rest days

Finish at least one quest on a day and that day counts toward your streak.

- Every week you get **1 free rest day**. If you miss a day, it is covered
  automatically and your streak carries on.
- After that, a missed day uses one **rest-day token** (buy them in the shop).
- If neither is available, the streak starts again from 1 with a friendly
  "New streak started, welcome back!" Your best streak is always kept, and
  nothing is ever taken away.

## Quest of the day

Each day one waiting quest is picked as the **Quest of the day**. It is marked
in the quest list. Finishing it adds a bonus of **2 times the quest's XP** (so
three times in all, before other bonuses), and it always drops a piece of loot.

## Loot and chests

- **Loot**: every finished quest has a 25% chance to drop an item you do not
  own yet (always for the Quest of the day). Some items can only be found this
  way: the Starry cloak, the Mossy broom and the Sleepy owl.
- **Chest keys**: every 5th quest you finish gives you a chest key. A key opens
  a mystery chest for free (use the chest button on the village page), with the
  usual chest rewards.
- **Collection book**: open **Hero** to see every item. Items you have found are
  shown, the rest wait as a "?" with a hint where to look.

## Optional: finish a quest with an NFC tag

Stick an NFC tag on, for example, the dishwasher. Scan it once with the Home
Assistant app so it is registered, then:

1. Import the blueprint: open
   **Settings → Automations & scenes → Blueprints → Import blueprint** and paste:
   `https://github.com/LetsManu/cuest/blob/main/blueprints/automation/cuest/nfc_complete_quest.yaml`
2. Create an automation from it. Enter the tag's ID and the exact title of the
   quest (for example "Empty the dishwasher").
3. Scanning the tag now completes that quest. The quest is credited to the
   first Cuest player (Home Assistant automations do not say who scanned the
   tag).

## When something goes wrong

**"Could not reach the Cuest server"**
Home Assistant cannot open the address you entered. Check that the server is
running (`docker compose ps`), that the address and port 8787 are right, and
that the PC or NAS is on the same network as Home Assistant. Open
`http://<address>:8787/api/health` in a browser to test it.

**"The Cuest secret does not match" (a repair in Settings)**
The server rejected the secret Home Assistant has. Show the right one with
`docker compose exec cuest cat /data/bridge-secret`. Then go to **Settings →
Devices & services → Cuest**, remove the integration, and add it again
(steps 10 to 12) with that secret.

**The card is missing from the card list**
Reload the page with the browser cache cleared (Ctrl+F5). On the phone app use
**Settings → Companion app → Debugging → Reset frontend cache**.
