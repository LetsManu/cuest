import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import type { BridgeHub } from '../bridge/hub.js';

export async function registerBridgeRoute(app: FastifyInstance, hub: BridgeHub): Promise<void> {
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  app.get('/bridge', { websocket: true }, (socket) => {
    hub.attach(socket);
  });
}
