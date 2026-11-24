import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Config {
  port: number;
  dataDir: string;
  bridgeSecret: string;
  tz: string;
  tickSeconds: number;
}

export interface ConfigFs {
  readFile(path: string): string;
  writeFile(path: string, data: string): void;
  exists(path: string): boolean;
}

const realFs: ConfigFs = {
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, d) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, d, { mode: 0o600 });
  },
  exists: (p) => existsSync(p),
};

function intFrom(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive whole number, got "${raw}"`);
  return n;
}

export function loadConfig(
  env: NodeJS.ProcessEnv,
  fs: ConfigFs = realFs,
  log: (m: string) => void = console.log,
): Config {
  const dataDir = env.CUEST_DATA_DIR || '/data';
  const tz = env.CUEST_TZ || env.TZ || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(`CUEST_TZ "${tz}" is not a valid time zone name (try something like "Europe/Amsterdam")`);
  }

  let bridgeSecret = env.CUEST_BRIDGE_SECRET;
  if (!bridgeSecret) {
    const file = join(dataDir, 'bridge-secret');
    if (fs.exists(file)) {
      bridgeSecret = fs.readFile(file).trim();
    }
    if (!bridgeSecret) {
      bridgeSecret = randomBytes(32).toString('hex');
      fs.writeFile(file, `${bridgeSecret}\n`);
      log(`Bridge secret created. Find it in ${file}`);
    }
  }

  if (bridgeSecret.length < 16) {
    log('Warning: CUEST_BRIDGE_SECRET is shorter than 16 characters. Use a longer secret.');
  }

  return {
    port: intFrom('CUEST_PORT', env.CUEST_PORT, 8787),
    dataDir,
    bridgeSecret,
    tz,
    tickSeconds: intFrom('CUEST_TICK_SECONDS', env.CUEST_TICK_SECONDS, 30),
  };
}
