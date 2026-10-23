# Atlas Recovery: Account Lookup by Account Number

Lets the CollectWise AI agent look up Atlas Recovery debtor accounts by **account number**. It has two parts: a script that loads Atlas's inventory CSV into a database, and an HTTP endpoint the agent calls during a call.

**Live API:** https://veera-collectwise-fde.vercel.app

```bash
curl https://veera-collectwise-fde.vercel.app/accounts/ACC-100001
curl "https://veera-collectwise-fde.vercel.app/accounts?account_number=00012345"
curl https://veera-collectwise-fde.vercel.app/accounts/ACC-999   # 404
```

## Stack

- **Node.js 24**, **Express 5**
- **SQLite** via Node's built-in `node:sqlite` (no native module to compile, single file DB)
- `csv-parse` for CSV handling, `node:test` for tests

## Quick start (local)

```bash
npm install
npm run ingest -- path/to/atlas_inventory.csv   # defaults to ./atlas_inventory.csv
npm start                                       # http://localhost:3000
curl localhost:3000/accounts/ACC-100001
npm test
```

A sample file with deliberately messy rows is at [`data/atlas_inventory.csv`](data/atlas_inventory.csv).

The database is written to `data/atlas.db` (override with `DB_PATH`). The schema is in [`db/schema.sql`](db/schema.sql) and is applied automatically by the ingest script.

## Schema

| column | type | notes |
|---|---|---|
| `account_number` | TEXT, primary key | trimmed and uppercased; leading zeros kept (`00012345` stays a string) |
| `debtor_name` | TEXT | |
| `phone_number` | TEXT, indexed | normalized to E.164 (`+14155550132`) when it's a US number, otherwise stored as given |
| `balance_cents` | INTEGER | money stored in cents to avoid floating-point drift; the API returns dollars |
| `status` | TEXT | Title Case (`active`/`ACTIVE` become `Active`) |
| `client_name` | TEXT | |
| `source_file` | TEXT | which CSV last wrote the row |
| `created_at`, `updated_at` | TEXT | ISO-8601 UTC |

## Ingestion rules

Run with `npm run ingest -- <file.csv>`. It prints a summary of rows inserted, updated, rejected and warned.

**Headers:** matched ignoring case, spacing, and column order (`Account Number` works). All six columns (`account_number, debtor_name, phone_number, balance, status, client_name`) must be present, otherwise the **whole file is refused** and nothing changes. A missing column means the export format changed, and guessing would be worse than stopping.

**Rejected rows** (skipped; everything else in the file still loads):
- missing `account_number`
- missing or non-numeric `balance`. `$1,234.50` and `1234.5` are fine; `N/A` is not.

Rejected rows are written to `<file>.rejects.csv` with the line number and reason, so Atlas can fix and re-send them.

**Warnings** (the row loads; the warning is printed): missing name/phone/status/client, a phone number that isn't a recognizable US number, a status outside `Active, Closed, Paid, Settled, Disputed`, or a negative balance.

**Duplicates: upsert, last row wins.**
- Within one file, if the same `account_number` appears twice, the later row is kept and the duplicate is reported.
- Across uploads, if an account already exists, the new file's values replace it (balance, status, etc.). `created_at` is preserved.
- Why: Atlas uploads inventory periodically, so the newest file is the source of truth for balances and statuses. Erroring would block every routine refresh, and skipping would leave stale balances that the agent would read to debtors.
- Accounts that are *absent* from a new file are left untouched, not deleted, so a partial file can't silently wipe accounts.

**Atomicity:** each file loads in a single transaction, so a crash mid-file leaves the database as it was.

## API

`GET /accounts/:accountNumber` or `GET /accounts?account_number=...`

```json
200 OK
{
  "account_number": "ACC-100001",
  "debtor_name": "Maria Gonzalez",
  "phone_number": "+14155550132",
  "balance": 1250,
  "status": "Active",
  "client_name": "Summit Medical Group",
  "updated_at": "2026-10-23T03:23:56.535Z"
}
```

| status | when | body |
|---|---|---|
| 200 | found | account JSON |
| 400 | empty or malformed account number | `{"error":{"code":"invalid_account_number", ...}}` |
| 404 | not in the database | `{"error":{"code":"account_not_found", ...}}` |
| 401 | `API_KEY` is set and the `x-api-key` header is wrong | `{"error":{"code":"unauthorized", ...}}` |

Lookups ignore case and surrounding whitespace (`acc-100001` matches `ACC-100001`). `GET /health` returns `{"ok":true}`.

**For AI-agent tool calls:** `POST /accounts/lookup` with a JSON body `{"account_number": "..."}`, or Retell's envelope `{"args": {"account_number": "..."}}`. It returns the same responses as the GET endpoints. It exists because Retell's GET custom functions can't send LLM-filled arguments (see [Retell agent](#retell-agent)).

```bash
curl -X POST https://veera-collectwise-fde.vercel.app/accounts/lookup \
  -H 'content-type: application/json' -d '{"account_number":"ACC-100010"}'
```

**Auth:** set the `API_KEY` env var to require an `x-api-key` header. It's off in the public demo so reviewers can call it freely. In production it should be on, since the endpoint returns PII.

## Deployment (Vercel)

The API is deployed as one Vercel serverless function ([`api/index.js`](api/index.js)), and every path is rewritten to it ([`vercel.json`](vercel.json)).

Vercel functions have a read-only, non-persistent filesystem, so the database can't be written at request time. Instead:

1. Vercel's build step runs `npm run build`, which is `npm run ingest -- data/atlas_inventory.csv`, producing `data/atlas.db`.
2. That file is bundled into the function (`includeFiles`) and opened read-only.

**To update the live data:** replace `data/atlas_inventory.csv` and push to `main`. Vercel rebuilds and redeploys in about a minute.

To deploy your own copy: import the repo at vercel.com/new (Framework Preset: **Other**, no other settings), or run `npx vercel --prod`. Use the project's production domain. Per-deployment URLs (`<project>-<hash>-<team>.vercel.app`) are behind Vercel Authentication by default.

**Production next step:** uploads that don't need a deploy. Swap SQLite for hosted Postgres (e.g. Neon through the Vercel Marketplace) and point the same ingest script at it, triggered by an SFTP/S3 drop. The schema and validation code stay the same.

## Retell agent

[`retell/atlas-recovery-agent.json`](retell/atlas-recovery-agent.json) is the exported Conversation Flow agent ("Atlas Recovery Agent"). To use it, go to Retell, then **Agents**, then **Import**.

```
Greeting ─yes─► Verify SSN ─1234─► lookup_account (this API) ─Active─► Negotiation ─agreed─► End
   │                │ 2 wrong                │ not found / not Active   │ declined ─► End
   no               ▼                        ▼                          │ dispute / human ─► Transfer
   ▼             Transfer                 Transfer
Ask for John ─available─► Verify SSN
   ├─ unavailable ─► Take message (no debt disclosed) ─► End
   └─ wrong number ─► End
```

- **Live account data:** after verification, a function node calls `POST /accounts/lookup` with `{{account_number}}`. The response's `balance` and `status` become `{{balance}}` / `{{account_status}}`, so the agent quotes the balance from the database instead of a hard-coded figure. `account_number` is a per-call dynamic variable; it defaults to `ACC-100010`, the John Doe test account in the sample CSV.
- **Negotiation ladder:**
  1. full payment
  2. 3-month plan
  3. the caller's affordable monthly amount, capped at 24 months
  4. a 90% settlement, then an 80% settlement

  The 24-month and 80% limits are restated as hard limits. Payments that don't divide evenly adjust the final installment so the plan totals exactly the balance.
- **Compliance guardrails** (in the global prompt):
  - no mention of the debt to anyone but the verified debtor (FDCPA third-party disclosure);
  - the "attempt to collect a debt" disclosure is said after verification;
  - no threats;
  - a dispute, a lawyer mention, or a request for a human leads to a transfer.
- **Verification:** two attempts; digits offered as a question count as an attempt; the expected digits are never revealed.
- **Failure handling:** if the lookup fails, the account is missing, or the account isn't Active, the call transfers instead of quoting a number. If the transfer fails, the agent ends gracefully with a call-back promise.
- `transfer_number` is a placeholder (`+14155550100`); set it to Atlas's live-agent line.

**Tested** in Retell's LLM test chat:

| Scenario | Result |
|---|---|
| Happy path down the whole ladder | Held the 80% floor against a $1,500 counter, closed at $2,000 |
| 3-month plan | $833.33 / $833.33 / $833.34 |
| Wrong SSN twice | Transferred |
| SSN guess phrased as a question | Counted as an attempt; no hints given |
| Spouse asks "does he owe you money?" | Deflected; left a neutral message |
| Wrong number | Ended politely |
| Unknown account | 404, then transfer, with no balance stated |

## Assumptions and notes

- `account_number` is an opaque string (it may contain letters, dashes, leading zeros) and is unique per account across all of Atlas's clients.
- Phone normalization assumes US numbers.
- Balances are dollars with at most two decimals; anything finer is rounded to the cent.
- **Retell agent / SSN check:** the provided call script hard-codes the expected last four SSN digits, and I kept the agent faithful to the script. The CSV has no SSN field. In production, verification should check against data from the account record (e.g. an `ssn_last4` column, or DOB/ZIP), returned by the API only as a match/no-match and never read to the LLM.

## Layout

```
api/index.js          Vercel entry point
src/app.js            Express app (routes, errors, optional auth)
src/server.js         local server
src/ingest.js         CSV ingest CLI
src/normalize.js      header/field normalization and row validation
src/db.js             SQLite open helpers
db/schema.sql         schema
data/atlas_inventory.csv  sample inventory (deployed data)
test/                 node:test suite
docs/                 email to Atlas's COO
retell/               exported Retell AI agent (JSON)
```
