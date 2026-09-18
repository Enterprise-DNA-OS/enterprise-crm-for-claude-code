# The rule book

`/compliance` (and `npm run crm -- compliance`) runs these rules against the records and reports what is breached. Each rule names its source. The sharpest one is enforced at the gate, not just checked after the fact: the CLI refuses to log an email against an opted-out contact, so the first rule can only ever fail if someone goes around the system.

Change these rules to match your team: the executable half lives in `scripts/crm.mjs` (the `RULES` table), and `/customise` edits both this file and the check together. Nothing here is legal advice; these are the rules the operator has told the system to enforce, with the sources they lean on.

## 1. No email to an opted-out contact, ever

**Source:** Spam Act 2003 (Cth) ss 16 and 18: commercial electronic messages need consent, and an unsubscribe must be honoured within five business days. Unsolicited Electronic Messages Act 2007 (NZ) ss 9 and 11 say the same for New Zealand.

**Enforced at the gate.** `contacts.opted_out` is not a preference field. The CLI refuses to log an email against an opted-out contact, `/draft-follow-up` refuses to draft to one, and the importer carries `HasOptedOutOfEmail` across as a locked gate. The check exists to catch anyone who went around the CLI.

## 2. No open deal past its close date

**Source:** the standard this team sets for itself. The forecast is only as honest as its dates, and a close date left in the past inflates the quarter until it quietly deflates it.

**Fix:** move the date to when the deal will actually close, or close the deal.

## 3. Every open deal past qualification has a dated next step

**Source:** the standard this team sets for itself. A deal with no dated next step is drifting, whatever the stage says.

**Fix:** `opp next <ref> --step="..." --on=<date>`. The step is what you will do, not what you hope they do.

## 4. No deal past qualification without an amount

**Source:** the standard this team sets for itself. An unpriced deal cannot be weighted, so it sits in the pipeline shaped like revenue and worth nothing to the forecast.

**Fix:** price it, even roughly, before it moves again.

## 5. Every lead touched inside three days

**Source:** the standard this team sets for itself. Lead response time decides conversion long before product does, and "touched" here means a logged activity, not an intention.

**Fix:** ring them today and log the call. `lead route` first if nobody owns them.

## 6. No personal data kept at former accounts beyond need

**Source:** Privacy Act 1988 (Cth) APP 11.2: destroy or de-identify personal information once it is no longer needed for a permitted purpose. Privacy Act 2020 (NZ) IPP 9 is the same obligation. A CRM that keeps every contact forever is a liability register.

**Check:** contacts at `former` accounts with no activity for two years.

**Fix:** per contact, either a written reason to keep them or a deleted row.

## 7. Every contact at an account with an open deal is reachable

**Source:** the standard this team sets for itself, leaning on APP 10 (keep personal information accurate, complete and up to date). You are forecasting revenue through people; a contact with no email and no phone on a live deal is a stall waiting to happen.

**Fix:** get a number or an address on the record next time you are on site.
