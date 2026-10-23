// Load an Atlas Recovery inventory CSV into the accounts table.
//   npm run ingest -- path/to/atlas_inventory.csv
//
// Duplicates: upsert, last row wins (within the file and across uploads).
// Invalid rows (no account_number, non-numeric balance) are skipped and written
// to <file>.rejects.csv; the rest of the file still loads. The whole file is
// applied in one transaction, so a crash never leaves a half-loaded upload.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'csv-parse/sync';
import { openForWrite } from './db.js';
import { REQUIRED_COLUMNS, normalizeHeader, validateRow } from './normalize.js';

export function ingestFile(csvPath, db) {
  const records = parse(readFileSync(csvPath), {
    bom: true,
    columns: (headers) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    relax_column_count: true,
    info: true,
  });

  const columns = records.length ? Object.keys(records[0].record) : [];
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (records.length && missing.length) {
    throw new Error(`CSV is missing required column(s): ${missing.join(', ')}`);
  }

  const rejects = [];
  const warnings = [];
  const duplicates = [];
  const accounts = new Map(); // account_number -> { account, line }

  for (const { record, info } of records) {
    const line = info.lines;
    const result = validateRow(record);
    if (result.error) {
      rejects.push({ line, reason: result.error, record });
      continue;
    }
    const { account } = result;
    const previous = accounts.get(account.account_number);
    if (previous) {
      duplicates.push({ account_number: account.account_number, kept: line, replaced: previous.line });
    }
    result.warnings.forEach((w) => warnings.push({ line, account_number: account.account_number, warning: w }));
    accounts.set(account.account_number, { account, line });
  }

  const exists = db.prepare('SELECT 1 FROM accounts WHERE account_number = ?');
  const upsert = db.prepare(`
    INSERT INTO accounts (account_number, debtor_name, phone_number, balance_cents, status, client_name, source_file)
    VALUES (:account_number, :debtor_name, :phone_number, :balance_cents, :status, :client_name, :source_file)
    ON CONFLICT (account_number) DO UPDATE SET
      debtor_name   = excluded.debtor_name,
      phone_number  = excluded.phone_number,
      balance_cents = excluded.balance_cents,
      status        = excluded.status,
      client_name   = excluded.client_name,
      source_file   = excluded.source_file,
      updated_at    = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);

  let inserted = 0;
  let updated = 0;
  const sourceFile = basename(csvPath);

  db.exec('BEGIN');
  try {
    for (const { account } of accounts.values()) {
      if (exists.get(account.account_number)) updated++;
      else inserted++;
      upsert.run({ ...account, source_file: sourceFile });
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { rows: records.length, inserted, updated, rejects, warnings, duplicates };
}

function writeRejects(csvPath, rejects) {
  const out = csvPath.replace(/\.csv$/i, '') + '.rejects.csv';
  const cols = ['line', 'reason', ...REQUIRED_COLUMNS];
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const lines = rejects.map((r) => [r.line, r.reason, ...REQUIRED_COLUMNS.map((c) => r.record[c])].map(esc).join(','));
  writeFileSync(out, [cols.join(','), ...lines].join('\n') + '\n');
  return out;
}

function main() {
  const csvPath = resolve(process.argv[2] ?? 'atlas_inventory.csv');
  if (!existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}\nUsage: npm run ingest -- path/to/atlas_inventory.csv`);
    process.exit(1);
  }

  const db = openForWrite();
  let summary;
  try {
    summary = ingestFile(csvPath, db);
  } catch (err) {
    console.error(`Ingest failed, no changes were saved: ${err.message}`);
    process.exit(1);
  } finally {
    db.close();
  }

  const { rows, inserted, updated, rejects, warnings, duplicates } = summary;
  console.log(`Ingested ${basename(csvPath)}: ${rows} rows read`);
  console.log(`  inserted: ${inserted}  updated: ${updated}  rejected: ${rejects.length}  warnings: ${warnings.length}`);
  for (const d of duplicates) {
    console.log(`  duplicate ${d.account_number}: line ${d.kept} replaces line ${d.replaced}`);
  }
  for (const w of warnings) console.log(`  warning line ${w.line} (${w.account_number}): ${w.warning}`);
  for (const r of rejects) console.log(`  rejected line ${r.line}: ${r.reason}`);
  if (rejects.length) console.log(`  rejected rows written to ${writeRejects(csvPath, rejects)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
