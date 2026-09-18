---
description: The Monday pipeline review, written from three commands. The forecast, the decisions, the deals to push, one page.
---

Run these three, in this order, and write the review from what they return. Do not write anything they do not support.

```
npm run crm -- forecast
npm run crm -- attention
npm run crm -- pipeline
```

Then write it in this shape, no more than a page:

1. **The quarter in one line.** Team closed plus weighted against quota, days left, and whether that is ahead or behind last week.
2. **Per rep.** Quota, closed, weighted, gap. Flag coverage under 60% with the deals that would close it.
3. **The decisions.** From attention, in its order: missed close dates, deals with no next step, the single-threaded six-figure deals. Each with its owner and the one action.
4. **Deals to push this week.** Closing inside 14 days: ref, amount, next step, owner. If the next step is NONE, that is the action.
5. **The leads.** Untouched ones by name and age. Three days is the standard.
6. **Customers going quiet.** From attention; one call each.
7. **One thing to decide.** The single item that needs the manager, not the process.

Add `npm run view` if the operator wants the pipeline and quarter pages for a meeting: same numbers, the company's brand, and they print.

Numbers come from the commands. If a number is not in the output, it does not go in the review.
