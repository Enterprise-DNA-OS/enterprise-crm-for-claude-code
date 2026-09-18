---
description: One deal in full (the numbers, stage history, every touch), and the verbs that move it, add, move, next, won, lost.
---

Reading: `npm run crm -- opp <ref>`. "1001" finds OPP-1001. Present the header lines, then the history and activity only if the operator wants the story.

Moving, one right way each:
- New deal: `opp add <account> --name="..." --close=<date> [--amount=]`. A close date is required from day one.
- Stage move: `opp move <ref> <stage>`. Probability follows the stage; history is written. Never move to closed through this.
- Next step: `opp next <ref> --step="..." --on=<date>`. Every open deal past qualification carries one; /compliance checks.
- Won: `opp won <ref> [--amount=]`. Refuses if the deal has no amount. The account becomes a customer.
- Lost: `opp lost <ref> --reason="..."`. The reason is required: the win rate you quote later is built on these rows.

After any move, say what changed and what the next step now is, one line each.
