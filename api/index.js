// Vercel serverless entry point. The database is built from data/atlas_inventory.csv
// during `npm run build` and bundled with the function (see vercel.json).
import { createApp } from '../src/app.js';

export default createApp();
