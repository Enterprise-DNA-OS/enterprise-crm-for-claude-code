---
description: The quarter per rep, closed won plus weighted pipeline against quota, with the gap and days left. The report Salesforce gates behind its top editions.
---

1. Run `npm run crm -- forecast`.
2. Read it as a manager would:
   - **Coverage under 60%** with the quarter running out is the headline. Name the rep, the gap, and the deals that would close it (`pipeline --rep=`).
   - **"covered"** in the gap column means quota is met by arithmetic, not hope. Say who.
   - Weighted counts only deals with a close date inside the quarter. A big "all open" next to a small "weighted (qtr)" means the pipeline is real but late: say so.
3. Finish with the team line: closed plus weighted against total quota, one sentence.
4. If quotas are missing the CLI will say so: set them with `quota set <rep> --amount=<dollars>`.

Numbers come from the command. Never adjust a forecast by feel; adjust the close dates and stages that feed it.
