---
description: A call, email, meeting or demo onto the record, against an account, a deal ref or a lead, with the consent gate enforced.
---

1. `npm run crm -- log <account, OPP-ref or lead> "what was said or done" --kind=call|email|meeting|demo|note [--contact= --rep= --on=]`.
2. Name the contact whenever there was one: the single-thread check counts distinct contacts per deal.
3. The gate: logging an email against an opted-out contact is refused, and that refusal is correct (Spam Act 2003 s 18; UEMA 2007 (NZ) s 11). Log the call instead, or draft nothing.
4. Logging against a new lead moves it to working by itself.

One line back: what was logged, against what.
