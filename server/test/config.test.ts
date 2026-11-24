import { describe, expect, it } from 'vitest';
import { loadConfig, type ConfigFs } from '../src/config.js';

function fakeFs(files: Record<string, string> = {}): ConfigFs & { files: Record<string, string> } {
  return {
    files,
    readFile: (p) => files[p] as string,
    writeFile: (p, d) => {
      files[p] = d;
    },
    exists: (p) => p in files,
  };
}

describe('loadConfig', () => {
  it('applies defaults', () => {
    const fs = fakeFs();
    const c = loadConfig({ CUEST_BRIDGE_SECRET: 's' }, fs, () => {});
    expect(c).toEqual({ port: 8787, dataDir: '/data', bridgeSecret: 's', tz: process.env.TZ || 'UTC', tickSeconds: 30 });
  });

  it('reads env overrides', () => {
    const c = loadConfig(
      { CUEST_PORT: '9000', CUEST_DATA_DIR: '/x', CUEST_BRIDGE_SECRET: 's', CUEST_TZ: 'Europe/Amsterdam', CUEST_TICK_SECONDS: '5' },
      fakeFs(),
      () => {},
    );
    expect(c).toMatchObject({ port: 9000, dataDir: '/x', tz: 'Europe/Amsterdam', tickSeconds: 5 });
  });

  it('generates and persists a secret when missing', () => {
    const fs = fakeFs();
    const logs: string[] = [];
    const c = loadConfig({ CUEST_DATA_DIR: '/d' }, fs, (m) => logs.push(m));
    expect(c.bridgeSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.files['/d/bridge-secret']?.trim()).toBe(c.bridgeSecret);
    expect(logs).toEqual(['Bridge secret created. Find it in /d/bridge-secret']);
    const again = loadConfig({ CUEST_DATA_DIR: '/d' }, fs, () => {});
    expect(again.bridgeSecret).toBe(c.bridgeSecret);
  });

  it('rejects an invalid timezone', () => {
    expect(() => loadConfig({ CUEST_BRIDGE_SECRET: 's', CUEST_TZ: 'Mars/Base' }, fakeFs(), () => {})).toThrow(/CUEST_TZ/);
  });
});
