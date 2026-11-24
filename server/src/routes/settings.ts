import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SettingsRepo } from '../repos/settings.js';
import { defined, parseBody } from './util.js';

const light = z.string().regex(/^light\.[a-z0-9_]+$/);
const scene = z.string().regex(/^scene\.[a-z0-9_]+$/);
const patchBody = z
  .object({
    celebrationLights: z.array(light).max(20),
    sprintScene: scene.nullable(),
  })
  .partial()
  .strict();

export function registerSettingsRoutes(app: FastifyInstance, settings: SettingsRepo): void {
  app.get('/api/settings', async () => settings.get());

  app.patch('/api/settings', async (req, reply) => {
    const body = parseBody(patchBody, req.body, reply);
    if (!body) return reply;
    const saved = settings.update(defined(body));
    return saved;
  });
}
