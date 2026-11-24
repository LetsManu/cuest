import Fastify, { type FastifyInstance } from 'fastify';
import type { BridgeHub } from './bridge/hub.js';
import type { PlayersRepo } from './repos/players.js';
import type { TemplatesRepo } from './repos/templates.js';
import type { QuestService } from './services/quests.js';
import { registerBridgeRoute } from './routes/bridge.js';
import { registerPlayerRoutes } from './routes/players.js';
import { registerQuestRoutes } from './routes/quests.js';
import { registerTemplateRoutes } from './routes/templates.js';

export interface AppDeps {
  bridgeConnected: () => boolean;
  players: PlayersRepo;
  templates: TemplatesRepo;
  quests: QuestService;
  onTemplatesChanged: () => void;
  hub?: BridgeHub;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify();
  if (deps.hub) await registerBridgeRoute(app, deps.hub);
  app.get('/api/health', async () => ({ ok: true, bridge: deps.bridgeConnected() }));
  registerPlayerRoutes(app, deps.players);
  registerQuestRoutes(app, deps.quests);
  registerTemplateRoutes(app, deps.templates, deps.onTemplatesChanged);
  return app;
}
