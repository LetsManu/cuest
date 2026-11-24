import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { levelForXp, titleForLevel } from '../domain/levels.js';
import type { PlayersRepo } from '../repos/players.js';
import { defined, parseBody } from './util.js';

const createBody = z.object({
  name: z.string().min(1),
  haPerson: z.string().nullable().optional(),
  notifyService: z.string().nullable().optional(),
});
const patchBody = createBody.partial();

export function registerPlayerRoutes(app: FastifyInstance, players: PlayersRepo): void {
  app.get('/api/players', async () => players.list());

  app.post('/api/players', async (req, reply) => {
    const body = parseBody(createBody, req.body, reply);
    if (!body) return reply;
    return reply.code(201).send(players.create(body, new Date()));
  });

  app.patch<{ Params: { id: string } }>('/api/players/:id', async (req, reply) => {
    const body = parseBody(patchBody, req.body, reply);
    if (!body) return reply;
    const p = players.update(req.params.id, defined(body) as Parameters<PlayersRepo['update']>[1]);
    return p ?? reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });

  app.get<{ Params: { id: string } }>('/api/players/:id/summary', async (req, reply) => {
    const player = players.get(req.params.id);
    if (!player) return reply.code(404).send({ error: 'not_found', message: 'Not found' });
    const { level, intoLevel, toNext } = levelForXp(player.xp);
    return { player, level, title: titleForLevel(level), intoLevel, toNext };
  });
}
