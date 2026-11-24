import Fastify, { type FastifyInstance } from 'fastify';

export interface AppDeps {
  bridgeConnected: () => boolean;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify();
  app.get('/api/health', async () => ({ ok: true, bridge: deps.bridgeConnected() }));
  return app;
}
