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
    expect(c).toEqual({ port: 8787, dataDir: '/data', bridgeSecret: 's', tz: 'UTC', tickSeconds: 30 });
  });

  it('falls back to TZ, and CUEST_TZ wins over it', () => {
    const fs = fakeFs();
    expect(loadConfig({ CUEST_BRIDGE_SECRET: 's', TZ: 'Asia/Tokyo' }, fs, () => {}).tz).toBe('Asia/Tokyo');
    expect(loadConfig({ CUEST_BRIDGE_SECRET: 's', TZ: 'Asia/Tokyo', CUEST_TZ: 'Europe/Paris' }, fs, () => {}).tz).toBe('Europe/Paris');
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

  it('warns, but does not fail, on a short bridge secret', () => {
    const logs: string[] = [];
    const c = loadConfig({ CUEST_BRIDGE_SECRET: 'short' }, fakeFs(), (m) => logs.push(m));
    expect(c.bridgeSecret).toBe('short');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/CUEST_BRIDGE_SECRET.*16/);
    const quiet: string[] = [];
    loadConfig({ CUEST_BRIDGE_SECRET: 'x'.repeat(16) }, fakeFs(), (m) => quiet.push(m));
    expect(quiet).toEqual([]);
  });
});
