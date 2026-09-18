---
description: One account's whole relationship before the call, the contacts, every deal, the activity trail, open tasks.
---

1. Run `npm run crm -- account "<name>"`. Partial names resolve; an ambiguous one lists candidates.
2. Present it as a pre-call brief, not a data dump:
   - the relationship in one line (type, owner, lifetime value, last touch),
   - open deals with close dates and next steps,
   - who the people are and what role they buy in (and any OPTED OUT flag: no email to them, ever),
   - the last three activities, so the next conversation starts where the last one ended.
3. If the operator is walking into a meeting, `npm run docs -- account-brief` renders the same thing as a branded page.
