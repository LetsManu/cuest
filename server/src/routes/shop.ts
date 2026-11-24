import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ShopService } from '../services/shop.js';
import { parseBody, sendShopError } from './util.js';

const buyBody = z.object({ playerId: z.string().min(1), itemId: z.string().min(1) });
const equipBody = z.object({
  playerId: z.string().min(1),
  slot: z.enum(['hood', 'scarf', 'broom']),
  itemId: z.string().min(1).nullable(),
});
const viewQuery = z.object({ playerId: z.string().min(1) });

export function registerShopRoutes(app: FastifyInstance, shop: ShopService): void {
  app.get('/api/shop', async (req, reply) => {
    const q = parseBody(viewQuery, req.query, reply);
    if (!q) return reply;
    try {
      return shop.view(q.playerId);
    } catch (e) {
      return sendShopError(e, reply);
    }
  });

  app.post('/api/shop/buy', async (req, reply) => {
    const body = parseBody(buyBody, req.body, reply);
    if (!body) return reply;
    try {
      return shop.buy(body.playerId, body.itemId);
    } catch (e) {
      return sendShopError(e, reply);
    }
  });

  app.post('/api/shop/equip', async (req, reply) => {
    const body = parseBody(equipBody, req.body, reply);
    if (!body) return reply;
    try {
      return shop.equip(body.playerId, body.slot, body.itemId);
    } catch (e) {
      return sendShopError(e, reply);
    }
  });
}
