import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../clock.js';
import { copy } from '../copy.js';
import { levelForXp, titleForLevel } from '../domain/levels.js';
import type { PlayersRepo } from '../repos/players.js';
import { defined, parseBody } from './util.js';

// Owners copy `notify.mobile_app_x` from Home Assistant; we store the bare service name.
const notifyService = z
  .string()
  .transform((s) => s.replace(/^notify\./, ''))
  .pipe(z.string().regex(/^[a-z0-9_]+$/, 'use the notify service name, like mobile_app_my_phone'));

const createBody = z.object({
  name: z.string().min(1),
  haPerson: z.string().nullable().optional(),
  notifyService: notifyService.nullable().optional(),
});
const patchBody = createBody.partial();

export function registerPlayerRoutes(app: FastifyInstance, players: PlayersRepo, clock: Clock, onChanged: () => void = () => {}): void {
  app.get('/api/players', async () => players.list());

  app.post('/api/players', async (req, reply) => {
    const body = parseBody(createBody, req.body, reply);
    if (!body) return reply;
    const created = players.create(body, clock.now());
    onChanged();
    return reply.code(201).send(created);
  });

  app.patch<{ Params: { id: string } }>('/api/players/:id', async (req, reply) => {
    const body = parseBody(patchBody, req.body, reply);
    if (!body) return reply;
    const p = players.update(req.params.id, defined(body) as Parameters<PlayersRepo['update']>[1]);
    if (!p) return reply.code(404).send({ error: 'not_found', message: copy.notFound });
    onChanged();
    return p;
  });

  app.get<{ Params: { id: string } }>('/api/players/:id/summary', async (req, reply) => {
    const player = players.get(req.params.id);
    if (!player) return reply.code(404).send({ error: 'not_found', message: copy.notFound });
    const { level, intoLevel, toNext } = levelForXp(player.xp);
    return {
      player,
      level,
      title: titleForLevel(level),
      intoLevel,
      toNext,
      streak: player.streak,
      bestStreak: player.bestStreak,
      restTokens: player.restTokens,
      chestKeys: player.chestKeys,
    };
  });
}
