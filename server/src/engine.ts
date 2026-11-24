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
import { TemplatesRepo } from './repos/templates.js';
import { Publisher } from './services/publisher.js';
import type { EntityInfo } from './bridge/protocol.js';
import { NudgeService } from './services/nudges.js';
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
  const bus = new Bus();
  const quests = new QuestService({ quests: questsRepo, players, ledger, bus, clock, tx: (fn) => transaction(db, fn) });
  const rules = new RuleEngine({ templates, quests });
  const recurring = new RecurringScheduler({ templates, quests, tz: config.tz });
  const hub = new BridgeHub({ secret: config.bridgeSecret, log });
  const nudges = new NudgeService({ bus, hub, quests, questsRepo, templates, players, clock, tz: config.tz });

  let entities: EntityInfo[] = [];
  hub.onEntities((e) => {
    entities = e;
  });
  const publisher = new Publisher({ bus, hub, players, quests, items, clock });

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
    guard('sweep', () => quests.sweep(now));
    guard('nudges', () => nudges.tick(now));
  };

  const app = await buildApp({
    bridgeConnected: () => hub.isConnected(),
    players,
    templates,
    quests,
    onTemplatesChanged: refreshSubscriptions,
    onPlayersChanged: () => publisher.publishSnapshot(),
    getEntities: () => entities,
    hub,
    clock,
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
