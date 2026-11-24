import { expect, test } from 'vitest';
import { buildApp } from '../src/app.js';

test('GET /api/health reports ok and bridge status', async () => {
  const app = await buildApp({ bridgeConnected: () => false });
  const res = await app.inject({ method: 'GET', url: '/api/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ ok: true, bridge: false });
});
