import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../clock.js';
import { copy } from '../copy.js';
import type { UnlocksRepo } from '../repos/unlocks.js';
import { defined, nonNegInt, parseBody } from './util.js';

const createBody = z.object({
  name: z.string().min(1),
  cost: nonNegInt,
  entityId: z.string().regex(/^(scene|script|switch|input_boolean)\.[a-z0-9_]+$/),
});
const patchBody = createBody.partial().extend({ enabled: z.boolean().optional() });

export function registerUnlockRoutes(app: FastifyInstance, unlocks: UnlocksRepo, clock: Clock): void {
  app.get('/api/unlocks', async () => unlocks.list());

  app.post('/api/unlocks', async (req, reply) => {
    const body = parseBody(createBody, req.body, reply);
    if (!body) return reply;
    return reply.code(201).send(unlocks.create(body, clock.now()));
  });

  app.patch<{ Params: { id: string } }>('/api/unlocks/:id', async (req, reply) => {
    const body = parseBody(patchBody, req.body, reply);
    if (!body) return reply;
    const u = unlocks.update(req.params.id, defined(body));
    if (!u) return reply.code(404).send({ error: 'not_found', message: copy.notFound });
    return u;
  });

  app.delete<{ Params: { id: string } }>('/api/unlocks/:id', async (req, reply) => {
    const u = unlocks.update(req.params.id, { enabled: false });
    if (!u) return reply.code(404).send({ error: 'not_found', message: copy.notFound });
    return u;
  });
}
