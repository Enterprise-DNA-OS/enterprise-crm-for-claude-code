---
description: Turn a qualified lead into an account, a contact and (usually) an open deal, in one move.
---

1. Confirm the lead: `npm run crm -- leads`. Converting a disqualified lead is refused on purpose.
2. Run `npm run crm -- convert <lead> --opp="<deal name>" --amount=<dollars> --close=<date>`.
   - The account is matched by company name if it already exists, created in the lead's territory if not.
   - The contact carries across with title, email and phone.
   - Omit `--opp` only when there genuinely is no deal yet.
3. Report the three things made (account, contact, deal ref) and the deal's first next step: `opp next <ref> --step="..." --on=`.
