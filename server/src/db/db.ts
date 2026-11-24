import { DatabaseSync } from 'node:sqlite';

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA foreign_keys=ON');
  return db;
}
