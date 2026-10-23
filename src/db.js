import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const DEFAULT_DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../data/atlas.db', import.meta.url));
const SCHEMA_PATH = new URL('../db/schema.sql', import.meta.url);

/** Open the database for writing and make sure the schema exists. */
export function openForWrite(path = DEFAULT_DB_PATH) {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  return db;
}

/** Open an existing database read-only (serverless filesystems are read-only). */
export function openForRead(path = DEFAULT_DB_PATH) {
  return new DatabaseSync(path, { readOnly: true });
}
