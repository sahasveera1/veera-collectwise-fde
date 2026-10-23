import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openForWrite } from '../src/db.js';
import { ingestFile } from '../src/ingest.js';
import { createApp } from '../src/app.js';
import { parseBalanceCents, normalizePhone } from '../src/normalize.js';

const dir = mkdtempSync(join(tmpdir(), 'atlas-test-'));
const csv = (name, body) => {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};

let db;
let server;
let baseUrl;

before(async () => {
  db = openForWrite(join(dir, 'test.db'));
  const app = createApp({ db, apiKey: '' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('balance and phone parsing', () => {
  assert.equal(parseBalanceCents('$1,234.56'), 123456);
  assert.equal(parseBalanceCents('0'), 0);
  assert.equal(parseBalanceCents('N/A'), null);
  assert.equal(parseBalanceCents(''), null);
  assert.equal(normalizePhone('(415) 555-0132').phone, '+14155550132');
  assert.equal(normalizePhone('1-718-555-0123').phone, '+17185550123');
  assert.equal(normalizePhone('555-0100').ok, false);
});

test('ingest validates, de-duplicates and upserts', () => {
  const first = ingestFile(csv('first.csv', [
    'Account Number,Debtor Name,Phone Number,Balance,Status,Client Name',
    'a-1,Ann,4155550100,100.00,active,Client A',
    ',No Number,4155550101,5,Active,Client A',
    'A-2,Bob,4155550102,abc,Active,Client A',
    'A-1,Ann,4155550100,150.00,Active,Client A',
  ].join('\n')), db);

  assert.equal(first.inserted, 1);
  assert.deepEqual(first.rejects.map((r) => r.reason), ['missing account_number', 'non-numeric balance "abc"']);
  assert.equal(first.duplicates.length, 1);

  const second = ingestFile(csv('second.csv', [
    'account_number,debtor_name,phone_number,balance,status,client_name',
    'A-1,Ann,4155550100,90,Closed,Client A',
    '007,Zed,4155550103,1,Active,Client B',
  ].join('\n')), db);

  assert.equal(second.updated, 1);
  assert.equal(second.inserted, 1);
  const row = db.prepare('SELECT * FROM accounts WHERE account_number = ?').get('A-1');
  assert.equal(row.balance_cents, 9000);
  assert.equal(row.status, 'Closed');
});

test('ingest refuses a file missing required columns', () => {
  assert.throws(
    () => ingestFile(csv('bad.csv', 'account_number,balance\nA-9,10\n'), db),
    /missing required column\(s\): debtor_name, phone_number, status, client_name/,
  );
  assert.equal(db.prepare('SELECT 1 FROM accounts WHERE account_number = ?').get('A-9'), undefined);
});

test('GET /accounts/:accountNumber returns the account', async () => {
  const res = await fetch(`${baseUrl}/accounts/a-1`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.account_number, 'A-1');
  assert.equal(body.balance, 90);
  assert.equal(body.phone_number, '+14155550100');
  for (const key of ['debtor_name', 'status', 'client_name']) assert.ok(key in body);
});

test('leading zeros are preserved', async () => {
  const res = await fetch(`${baseUrl}/accounts?account_number=007`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).debtor_name, 'Zed');
});

test('POST /accounts/lookup accepts root args and the Retell envelope', async () => {
  const post = (body) => fetch(`${baseUrl}/accounts/lookup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const root = await post({ account_number: 'a-1' });
  assert.equal(root.status, 200);
  assert.equal((await root.json()).account_number, 'A-1');

  const envelope = await post({ name: 'lookup_account', call: {}, args: { account_number: '007' } });
  assert.equal(envelope.status, 200);
  assert.equal((await envelope.json()).debtor_name, 'Zed');

  assert.equal((await post({})).status, 400);
  assert.equal((await post({ account_number: 'NOPE-1' })).status, 404);
});

test('unknown account returns 404, bad input returns 400', async () => {
  const missing = await fetch(`${baseUrl}/accounts/NOPE-1`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'account_not_found');

  const bad = await fetch(`${baseUrl}/accounts?account_number=`);
  assert.equal(bad.status, 400);
});

test('API key is enforced when configured', async () => {
  const locked = createApp({ db, apiKey: 'secret' }).listen(0);
  await new Promise((r) => locked.once('listening', r));
  const url = `http://localhost:${locked.address().port}/accounts/A-1`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { 'x-api-key': 'secret' } })).status, 200);
  } finally {
    locked.close();
  }
});
