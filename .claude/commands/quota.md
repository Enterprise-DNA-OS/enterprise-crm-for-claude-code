---
description: Set or change a rep's quarterly quota, the line the forecast is measured against.
---

1. `npm run crm -- quota set <rep> --amount=<dollars> [--period=2026-Q4]`. Period defaults to the current quarter; re-running overwrites.
2. Then show the effect: `npm run crm -- forecast`.
3. A quota is a commitment made once a quarter, not a dial to turn when the forecast looks bad. If the operator is lowering one mid-quarter, ask once whether the close dates are the real problem.
