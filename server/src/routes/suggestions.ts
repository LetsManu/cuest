import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { EntityInfo } from '../bridge/protocol.js';
import type { Clock } from '../clock.js';
import type { TemplatesRepo } from '../repos/templates.js';
import { detect } from '../services/detect.js';
import { parseBody } from './util.js';

const acceptBody = z.object({ keys: z.array(z.string()) });

export function registerSuggestionRoutes(
  app: FastifyInstance,
  templates: TemplatesRepo,
  getEntities: () => EntityInfo[],
  onChanged: () => void,
  clock: Clock,
): void {
  const isAdded = (s: ReturnType<typeof detect>[number]): boolean => {
    const rule = s.templates[0]?.rule;
    if (!rule) return false;
    return templates
      .list({ enabledOnly: true })
      .some((t) => t.rule !== null && t.rule.entityId === rule.entityId && t.rule.type === rule.type);
  };

  app.get('/api/suggestions', async () => ({
    suggestions: detect(getEntities()).map((s) => ({ ...s, added: isAdded(s) })),
  }));

  app.post('/api/suggestions/accept', async (req, reply) => {
    const body = parseBody(acceptBody, req.body, reply);
    if (!body) return reply;
    const byKey = new Map(detect(getEntities()).map((s) => [s.key, s]));
    const unknown = body.keys.filter((k) => !byKey.has(k));
    if (unknown.length > 0) return reply.code(400).send({ error: 'unknown_suggestion', keys: unknown });
    const now = clock.now();
    const created = [];
    for (const key of new Set(body.keys)) {
      const s = byKey.get(key)!;
      if (isAdded(s)) continue;
      for (const draft of s.templates) created.push(templates.create(draft, now));
    }
    onChanged();
    return reply.code(201).send({ templates: created });
  });
}
