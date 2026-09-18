---
description: Every open deal with its amount, weighted value, close date, days left, next step and owner. The board without the board.
---

1. Run `npm run crm -- pipeline` (add `--rep=`, `--stage=` or `--account=` if the operator narrowed it).
2. Present it in stage order, negotiation first: those are the deals that pay this quarter.
3. Call out inline, not in a separate lecture:
   - any close date already past (`d AGO` in the left column): the forecast is wrong until it moves,
   - any `NONE` in the next step column,
   - any `UNPRICED` amount past qualification.
4. Finish with the two totals the header already computed: total open and weighted, one line.

If the operator asks "what should I push this week", answer from close dates and next steps, not stage names.
