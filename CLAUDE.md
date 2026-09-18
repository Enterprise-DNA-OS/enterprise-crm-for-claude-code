# Enterprise CRM for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a deal or an account, read its full history first (`opp <ref>`, `account <name>`).
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| the pipeline, the board, what is open | `/pipeline` |
| the forecast, the quarter, quota coverage | `/forecast` |
| what needs attention, what should I do today | `/attention` |
| everything about one account, before a call | `/account` |
| one deal, or moving it (add, move, next, won, lost) | `/opp` |
| the lead queue, routing, disqualifying | `/leads` |
| a lead that is real now | `/convert` |
| how each rep is doing | `/scorecard` |
| log a call, email, meeting or demo | `/log` |
| set or change a quota | `/quota` |
| the Monday pipeline review | `/weekly-review` |
| a follow-up email for a deal, customer or lead | `/draft-follow-up` (drafts only, never sends) |
| bring data across from Salesforce | `/import` |
| check the records against the rule book | `/compliance` |
| add a field, rename stages, change a rule | `/customise` |
| a new dashboard from a description | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run crm -- --help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- **Never log an email against an opted-out contact.** The CLI refuses, and the refusal is correct (Spam Act 2003 (Cth) s 18; Unsolicited Electronic Messages Act 2007 (NZ) s 11). Do not work around it.
- A won deal carries an amount; a lost deal carries a reason. The CLI enforces both; do not soften either.
- Never delete records without an explicit yes in this session. Prefer `former` accounts and disqualified leads over deletions.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/crm.mjs` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL: territories, reps, quotas, accounts, contacts, leads, opportunities, stage history, activities, tasks, and the views. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `views.json` + `npm run view` the pipeline and quarter dashboards; `documents.json` + `npm run docs` the account briefs, rep forecasts and win-loss review, all in `brand.json` colours.
- `docs/` the thesis, the rule book, and the guide for moving off Salesforce.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/salesforce
