import { SettingsRepo } from './repos/settings.js';
import { CelebrateService } from './services/celebrate.js';
import { ItemsRepo } from './repos/items.js';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.js';
import { BridgeHub } from './bridge/hub.js';
import { Bus } from './bus.js';
import type { Clock } from './clock.js';
import type { Config } from './config.js';
import { transaction } from './db/db.js';
import { LedgerRepo } from './repos/ledger.js';
import { PlayersRepo } from './repos/players.js';
import { QuestsRepo } from './repos/quests.js';
import { UnlocksRepo } from './repos/unlocks.js';
import { ShopService } from './services/shop.js';
import { TemplatesRepo } from './repos/templates.js';
import { Publisher } from './services/publisher.js';
import type { EntityInfo } from './bridge/protocol.js';
import { NudgeService } from './services/nudges.js';
import { DailyService } from './services/daily.js';
import { DiceService } from './services/dice.js';
import { SprintService } from './services/sprint.js';
import { QuestService } from './services/quests.js';
import { RecurringScheduler } from './services/recurring.js';
import { RuleEngine } from './services/rules.js';

export interface Engine {
  app: FastifyInstance;
  hub: BridgeHub;
  tick(): void;
  refreshSubscriptions(): void;
}

export async function createEngine(deps: {
  db: DatabaseSync;
  clock: Clock;
  config: Config;
  log?: (m: string) => void;
  logger?: boolean;
}): Promise<Engine> {
  const { db, clock, config } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));

  const players = new PlayersRepo(db);
  const templates = new TemplatesRepo(db);
  const questsRepo = new QuestsRepo(db);
  const ledger = new LedgerRepo(db);
  const items = new ItemsRepo(db);
  const unlocks = new UnlocksRepo(db);
  const settings = new SettingsRepo(db);
  const bus = new Bus();
  // The Publisher republishes on 'daily:picked', so listener order against 'quest:opened' does not matter.
  const daily = new DailyService({ db, quests: questsRepo, players, clock, tz: config.tz,
    onPicked: (questId) => bus.emit('daily:picked', { questId }),
  });
  const quests = new QuestService({
    quests: questsRepo,
    players,
    ledger,
    bus,
    clock,
    tx: (fn) => transaction(db, fn),
    isQuestOfDay: (id, now) => daily.isQuestOfDay(id, now),
    onDone: (playerId, doneAt) => daily.onQuestDone(playerId, doneAt),
    onLoot: (playerId, guaranteed) => shop.rollLoot(playerId, guaranteed),
  });
  const dice = new DiceService({ quests, tx: (fn) => transaction(db, fn) });
  const sprints = new SprintService({ db, players, ledger, bus, clock, tx: (fn) => transaction(db, fn), log });
  bus.on('quest:opened', (q) => daily.onQuestOpened(q, clock.now()));
  const hub = new BridgeHub({ secret: config.bridgeSecret, log });
  const shop = new ShopService({ players, items, ledger, unlocks, hub, bus, clock, tx: (fn) => transaction(db, fn) });
  new CelebrateService({ bus, hub, settings, log });
  const rules = new RuleEngine({ templates, quests });
  const recurring = new RecurringScheduler({ templates, quests, tz: config.tz });
  const nudges = new NudgeService({ bus, hub, quests, questsRepo, templates, players, clock, tz: config.tz });

  let entities: EntityInfo[] = [];
  hub.onEntities((e) => {
    entities = e;
  });
  const publisher = new Publisher({ bus, hub, players, quests, items, clock, questOfDay: (now) => daily.questOfDay(now) });

  hub.onState((ev) => rules.onState(ev));
  hub.onNotificationAction((action) => nudges.handleAction(action));

  const refreshSubscriptions = (): void => hub.setSubscriptions(rules.entities());

  const guard = (name: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      log(`tick: ${name} failed: ${String(err)}`);
    }
  };

  const tick = (): void => {
    const now = clock.now();
    guard('rules', () => rules.tick(now));
    guard('recurring', () => recurring.tick(now));
    guard('daily', () => daily.tick(now));
    guard('sweep', () => quests.sweep(now));
    guard('sprints', () => sprints.tick(now));
    guard('nudges', () => nudges.tick(now));
  };

  const app = await buildApp({
    bridgeConnected: () => hub.isConnected(),
    players,
    templates,
    quests,
    shop,
    dice,
    sprints,
    unlocks,
    settings,
    onTemplatesChanged: refreshSubscriptions,
    onPlayersChanged: () => publisher.publishSnapshot(),
    getEntities: () => entities,
    hub,
    clock,
    questOfDay: (now) => daily.questOfDay(now),
    ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
  });
  hub.setApiHandler(async ({ method, path, body }) => {
    const res = await app.inject({ method, url: path, ...(body !== undefined ? { payload: body as object } : {}) });
    const isJson = String(res.headers['content-type'] ?? '').includes('application/json');
    return { status: res.statusCode, body: isJson ? res.json() : res.body };
  });
  refreshSubscriptions();

  return { app, hub, tick, refreshSubscriptions };
}
