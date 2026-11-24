import type { AppDeps } from '../src/app.js';
import { Bus } from '../src/bus.js';
import { systemClock } from '../src/clock.js';
import { openDb } from '../src/db/db.js';
import { migrate } from '../src/db/migrate.js';
import { LedgerRepo } from '../src/repos/ledger.js';
import { ItemsRepo } from '../src/repos/items.js';
import { UnlocksRepo } from '../src/repos/unlocks.js';
import { ShopService } from '../src/services/shop.js';
import { transaction } from '../src/db/db.js';
import { PlayersRepo } from '../src/repos/players.js';
import { QuestsRepo } from '../src/repos/quests.js';
import { TemplatesRepo } from '../src/repos/templates.js';
import { QuestService } from '../src/services/quests.js';

export function makeDeps(over: Partial<AppDeps> = {}): AppDeps {
  const db = openDb(':memory:');
  migrate(db);
  const players = new PlayersRepo(db);
  const templates = new TemplatesRepo(db);
  const quests = new QuestService({
    quests: new QuestsRepo(db),
    players,
    ledger: new LedgerRepo(db),
    bus: new Bus(),
    clock: systemClock,
  });
  const unlocks = new UnlocksRepo(db);
  const shop = new ShopService({
    players,
    items: new ItemsRepo(db),
    ledger: new LedgerRepo(db),
    unlocks,
    hub: { isConnected: () => false, callService: () => false },
    tx: (fn) => transaction(db, fn),
    clock: systemClock,
  });
  return { bridgeConnected: () => false, players, templates, quests, shop, unlocks, onTemplatesChanged: () => {}, logger: false, ...over };
}
