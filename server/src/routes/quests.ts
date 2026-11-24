import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { QuestService } from '../services/quests.js';
import { nonNegInt, parseBody, sendQuestError } from './util.js';

const createBody = z.object({
  title: z.string().min(1),
  energy: z.enum(['low', 'medium', 'high']),
  minutes: nonNegInt,
  xp: nonNegInt.optional(),
  gold: nonNegInt.optional(),
});
const playerBody = z.object({ playerId: z.string().min(1) });
const laterBody = z.object({ minutes: nonNegInt.max(7 * 24 * 60).optional() });

export function registerQuestRoutes(
  app: FastifyInstance,
  quests: QuestService,
  questOfDay: () => string | null = () => null,
): void {
  app.get('/api/quests', async () => ({ ...quests.listVisible(), questOfDay: questOfDay() }));

  app.post('/api/quests', async (req, reply) => {
    const body = parseBody(createBody, req.body, reply);
    if (!body) return reply;
    const { quest } = quests.open({
      title: body.title,
      energy: body.energy,
      minutes: body.minutes,
      xp: body.xp ?? 20,
      ...(body.gold !== undefined ? { gold: body.gold } : {}),
    });
    return reply.code(201).send(quest);
  });

  app.post<{ Params: { id: string } }>('/api/quests/:id/start', async (req, reply) => {
    const body = parseBody(playerBody, req.body, reply);
    if (!body) return reply;
    try {
      return quests.start(req.params.id, body.playerId);
    } catch (e) {
      return sendQuestError(e, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/api/quests/:id/done', async (req, reply) => {
    const body = parseBody(playerBody, req.body, reply);
    if (!body) return reply;
    try {
      return quests.done(req.params.id, body.playerId);
    } catch (e) {
      return sendQuestError(e, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/api/quests/:id/later', async (req, reply) => {
    const body = parseBody(laterBody, req.body, reply);
    if (!body) return reply;
    try {
      return quests.later(req.params.id, body.minutes);
    } catch (e) {
      return sendQuestError(e, reply);
    }
  });
}
