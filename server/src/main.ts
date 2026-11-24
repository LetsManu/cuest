import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { systemClock } from './clock.js';
import { loadConfig } from './config.js';
import { openDb } from './db/db.js';
import { migrate } from './db/migrate.js';
import { createEngine } from './engine.js';

const config = loadConfig(process.env);
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(join(config.dataDir, 'cuest.db'));
migrate(db);

const engine = await createEngine({ db, clock: systemClock, config });
await engine.app.listen({ host: '0.0.0.0', port: config.port });
console.log(`Cuest is listening on port ${config.port}`);

const timer = setInterval(() => engine.tick(), config.tickSeconds * 1000);

const shutdown = (): void => {
  clearInterval(timer);
  engine.app
    .close()
    .catch((err) => console.error('shutdown error', err))
    .finally(() => {
      db.close();
      process.exit(0);
    });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
