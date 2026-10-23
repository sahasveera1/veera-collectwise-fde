import express from 'express';
import { openForRead } from './db.js';
import { normalizeAccountNumber } from './normalize.js';

const ACCOUNT_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;

function toResponse(row) {
  return {
    account_number: row.account_number,
    debtor_name: row.debtor_name,
    phone_number: row.phone_number,
    balance: row.balance_cents / 100,
    status: row.status,
    client_name: row.client_name,
    updated_at: row.updated_at,
  };
}

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

export function createApp({ db = openForRead(), apiKey = process.env.API_KEY } = {}) {
  const app = express();
  app.disable('x-powered-by');

  const findAccount = db.prepare('SELECT * FROM accounts WHERE account_number = ?');

  app.get('/health', (req, res) => res.json({ ok: true }));

  // Optional shared-secret auth. Off unless API_KEY is set, so reviewers can curl freely.
  if (apiKey) {
    app.use('/accounts', (req, res, next) => {
      if (req.get('x-api-key') === apiKey) return next();
      sendError(res, 401, 'unauthorized', 'Missing or invalid x-api-key header.');
    });
  }

  const lookup = (raw, res) => {
    const accountNumber = normalizeAccountNumber(raw);
    if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) {
      return sendError(res, 400, 'invalid_account_number',
        'account_number must be 1-64 characters: letters, digits, "-" or "_".');
    }
    const row = findAccount.get(accountNumber);
    if (!row) {
      return sendError(res, 404, 'account_not_found', `No account found with account_number ${accountNumber}.`);
    }
    res.json(toResponse(row));
  };

  app.get('/accounts/:accountNumber', (req, res) => lookup(req.params.accountNumber, res));
  app.get('/accounts', (req, res) => lookup(req.query.account_number, res));

  app.use((req, res) => sendError(res, 404, 'not_found', `No route for ${req.method} ${req.path}.`));
  app.use((err, req, res, next) => {
    console.error(err);
    sendError(res, 500, 'internal_error', 'Something went wrong looking up the account.');
  });

  return app;
}
