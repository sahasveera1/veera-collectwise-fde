**Subject:** Your AI agent can now find accounts by account number

Hi [Name],

Good news: the CollectWise agent can now look up accounts by **account number**, not just by phone number. When a debtor calls from a different phone, or reads their account number off a letter, the agent can find their account during the call and continue the conversation without a transfer.

**How it works**

1. Your team sends us your inventory file (`atlas_inventory.csv`) as you do today.
2. We load it into a secure database. Each upload refreshes balances and statuses.
3. When a caller gives an account number, the agent looks it up and gets the debtor's name, balance, status and client. If no match is found, the agent knows to ask again or route the call, so it never guesses.

**What the file needs**

- **Six columns:** `account_number`, `debtor_name`, `phone_number`, `balance`, `status`, `client_name`. Column order and capitalization don't matter. If a column is missing, we don't load the file at all, and nothing changes. We'll let you know so it can be re-exported.
- **Every row needs an account number.** Rows without one are set aside.
- **Balance must be a number.** `1250.00`, `$1,250.00` and `1250` all work. Text like "N/A" or a blank balance means that row is set aside.
- **Account numbers should be unique.** If the same account appears twice in a file, we keep the last one. If an account was in an earlier upload, the new file's values replace the old ones, so the most recent file always wins.
- **Accounts missing from a new file are not deleted.** To close an account, send it with status `Closed` rather than leaving it out.

Rows that are set aside don't hold up the rest of the file. After each upload we send you a short list of those rows and the reason for each, so your team can correct them and include them next time.

**What would help on your side**

- Keep the column names consistent from one export to the next.
- Export account numbers as text, so Excel doesn't strip leading zeros (`00012345` can become `12345`).
- Send the full current inventory each time, and use status `Closed` or `Paid` for resolved accounts.
- Tell us before any changes to the file format, or if you'd like a different upload schedule.

Happy to walk your team through it or run a test upload together.

Best,
Sahas Veera
Forward Deployed Engineer, CollectWise
