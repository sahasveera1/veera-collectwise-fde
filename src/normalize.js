// Field normalization + row validation shared by the ingest script and the API.

export const REQUIRED_COLUMNS = [
  'account_number',
  'debtor_name',
  'phone_number',
  'balance',
  'status',
  'client_name',
];

export const KNOWN_STATUSES = ['Active', 'Closed', 'Paid', 'Settled', 'Disputed'];

/** "Account Number" / "ACCOUNT-NUMBER" / " account_number " -> "account_number" */
export function normalizeHeader(header) {
  return String(header).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/** Account numbers are opaque strings: keep leading zeros, ignore case and surrounding spaces. */
export function normalizeAccountNumber(value) {
  return String(value ?? '').trim().toUpperCase();
}

/** "$1,234.50" -> 123450. Returns null when the value is not a number. */
export function parseBalanceCents(value) {
  const cleaned = String(value ?? '').trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** US numbers -> E.164. Anything else is kept as provided (and flagged by the caller). */
export function normalizePhone(value) {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return { phone: `+1${digits}`, ok: true };
  if (digits.length === 11 && digits.startsWith('1')) return { phone: `+${digits}`, ok: true };
  return { phone: raw || null, ok: false };
}

/** "active" / "ACTIVE" -> "Active" */
export function normalizeStatus(value) {
  const s = String(value ?? '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;
}

/**
 * Validate one CSV row.
 * Returns { account, warnings } for a usable row, or { error } for a rejected one.
 */
export function validateRow(row) {
  const accountNumber = normalizeAccountNumber(row.account_number);
  if (!accountNumber) return { error: 'missing account_number' };

  const balanceCents = parseBalanceCents(row.balance);
  if (balanceCents === null) {
    const shown = String(row.balance ?? '').trim();
    return { error: shown ? `non-numeric balance "${shown}"` : 'missing balance' };
  }

  const warnings = [];
  const { phone, ok: phoneOk } = normalizePhone(row.phone_number);
  if (!phone) warnings.push('missing phone_number');
  else if (!phoneOk) warnings.push(`unrecognized phone_number "${phone}" stored as-is`);

  const status = normalizeStatus(row.status);
  if (!status) warnings.push('missing status');
  else if (!KNOWN_STATUSES.includes(status)) warnings.push(`unknown status "${status}"`);

  const debtorName = String(row.debtor_name ?? '').trim() || null;
  if (!debtorName) warnings.push('missing debtor_name');

  const clientName = String(row.client_name ?? '').trim() || null;
  if (!clientName) warnings.push('missing client_name');

  if (balanceCents < 0) warnings.push('negative balance');

  return {
    account: {
      account_number: accountNumber,
      debtor_name: debtorName,
      phone_number: phone,
      balance_cents: balanceCents,
      status,
      client_name: clientName,
    },
    warnings,
  };
}
