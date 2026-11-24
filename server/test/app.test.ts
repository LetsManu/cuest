import { expect, test } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';

test('GET /api/health reports ok and bridge status', async () => {
  const app = await buildApp(makeDeps());
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, bridge: false });
});

test('buildApp logs at warn level by default and can be turned off', async () => {
  const noisy = await buildApp(makeDeps({ logger: true }));
  expect(noisy.log.level).toBe('warn');
  const quiet = await buildApp(makeDeps());
  expect(quiet.log.level).not.toBe('warn');
});
