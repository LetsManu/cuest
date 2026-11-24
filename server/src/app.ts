import Fastify, { type FastifyInstance } from 'fastify';
import { systemClock, type Clock } from './clock.js';
import type { BridgeHub } from './bridge/hub.js';
import type { EntityInfo } from './bridge/protocol.js';
import type { PlayersRepo } from './repos/players.js';
import type { TemplatesRepo } from './repos/templates.js';
import type { UnlocksRepo } from './repos/unlocks.js';
import type { ShopService } from './services/shop.js';
import type { QuestService } from './services/quests.js';
import { registerBridgeRoute } from './routes/bridge.js';
import { registerPlayerRoutes } from './routes/players.js';
import { registerQuestRoutes } from './routes/quests.js';
import { registerShopRoutes } from './routes/shop.js';
import { registerUnlockRoutes } from './routes/unlocks.js';
import { registerSuggestionRoutes } from './routes/suggestions.js';
import { registerTemplateRoutes } from './routes/templates.js';

export interface AppDeps {
  bridgeConnected: () => boolean;
  players: PlayersRepo;
  templates: TemplatesRepo;
  quests: QuestService;
  shop: ShopService;
  unlocks: UnlocksRepo;
  onTemplatesChanged: () => void;
  onPlayersChanged?: () => void;
  getEntities?: () => EntityInfo[];
  hub?: BridgeHub;
  questOfDay?: (now: Date) => string | null;
  clock?: Clock;
  /** false silences the request/error logger (tests). Default: warn level. */
  logger?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger === false ? false : { level: 'warn' } });
  const clock = deps.clock ?? systemClock;
  if (deps.hub) await registerBridgeRoute(app, deps.hub);
  app.get('/api/health', async () => ({ ok: true, bridge: deps.bridgeConnected() }));
  registerPlayerRoutes(app, deps.players, clock, deps.onPlayersChanged ?? (() => {}));
  registerQuestRoutes(app, deps.quests, () => deps.questOfDay?.(clock.now()) ?? null);
  registerShopRoutes(app, deps.shop);
  registerUnlockRoutes(app, deps.unlocks, clock);
  registerTemplateRoutes(app, deps.templates, deps.onTemplatesChanged, clock);
  registerSuggestionRoutes(app, deps.templates, deps.getEntities ?? (() => []), deps.onTemplatesChanged, clock);
  return app;
}
