---
description: The lead queue, oldest first, who owns each, who has never been touched, and the routing and disqualifying verbs.
---

1. Run `npm run crm -- leads`. Add `--unassigned` if the operator only wants the orphans, `--all` to include converted and disqualified.
2. Call out NEVER in the last-touch column: every lead touched inside three days is the standard, and /compliance counts the breaches.
3. The verbs:
   - `lead route` assigns every unassigned lead by territory region, fewest-open first. Run it whenever UNASSIGNED shows.
   - `log <lead> "what was said"` starts working it (status moves off new by itself).
   - `lead disqualify <lead> --reason="..."`: reasons are required and written down.
   - `/convert` when it is real.
4. Finish with the one lead to ring first and why (oldest untouched, or the qualified one going stale).
