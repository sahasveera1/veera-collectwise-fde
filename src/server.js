import { existsSync } from 'node:fs';
import { DEFAULT_DB_PATH } from './db.js';
import { createApp } from './app.js';

if (!existsSync(DEFAULT_DB_PATH)) {
  console.error(`No database at ${DEFAULT_DB_PATH}. Run "npm run ingest -- path/to/atlas_inventory.csv" first.`);
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, () => console.log(`Account lookup API listening on http://localhost:${port}`));
