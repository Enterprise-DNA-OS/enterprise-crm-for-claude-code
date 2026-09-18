<h1 align="center">Enterprise CRM for Claude Code</h1>

<p align="center">
  <strong>The open-source enterprise CRM for sales teams that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Salesforce data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/salesforce">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#the-rule-book-checked-against-the-data">The rule book</a> &bull;
  <a href="#ten-questions-salesforce-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-salesforce">Instead of Salesforce</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Enterprise CRM for Claude Code does the job a sales team pays Salesforce for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and run the pipeline in plain language. It runs the right query, and it can answer questions the Salesforce dashboard cannot.

A 10 to 50 person business on Sales Cloud pays per seat, per month, per edition: the current list runs USD $100 a seat for the Pro Suite, $195 for the core edition and $395 for Advanced, billed annually, with forecasting and meaningful reporting living in the upper tiers. By the time the licences, the add-ons and the admin or partner hours are counted, mid five figures to six figures a year is normal; we have sat across the desk from a business paying $80,000 a year for it. What that money buys, underneath, is four tables: accounts, contacts, opportunities, leads.

This repo is those four tables in Postgres you own, with the machine around them rebuilt as commands:

```
/pipeline                         every open deal: amount, weighted, close date, next step, owner
/forecast                         the quarter per rep: quota, closed, weighted, gap, coverage
/attention                        everything that wants a decision this morning, worst first
/account Alto                     the whole relationship, read before the call
/opp 1001                         one deal: the numbers, the stage history, every touch
/leads                            the queue, who owns each, who has never been touched
/convert                          lead to account + contact + deal, one move
/scorecard                        per rep: wins, cycle days, activity, overdue next steps
/weekly-review                    the Monday pipeline review, written from three commands
/compliance                       seven rules (Spam Act, Privacy Act, and your own standards) run against the records
```

The deal verbs carry the discipline Salesforce sells as validation rules: every deal carries a close date from day one, stage moves write history and set probability, **a won deal without an amount is refused**, **a lost deal without a reason is refused**, and winning promotes the account from prospect to customer. Leads route by territory (`lead route`), and converting one creates the account, the contact and the deal together.

**Consent is enforced, not decorated.** A contact's email opt-out closes a gate: the CLI refuses to log an email against them, the follow-up drafter skips them, and the importer carries Salesforce's `HasOptedOutOfEmail` across as the same locked gate (Spam Act 2003 (Cth) s 18; Unsolicited Electronic Messages Act 2007 (NZ) s 11). **Nothing sends from here.** Follow-ups draft to `drafts/`; a person sends them.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your pipeline sits in plain Postgres tables you own. Any tool can read them. No export request, no access ending when a subscription does.
- No seats, no editions, no add-on clouds, no admin retainer. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/enterprise-crm-for-claude-code.git
cd enterprise-crm-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Bellbird Filtration (a demo Melbourne industrial filtration maker: five on the sales team across four territories, eighteen accounts, seventeen deals, and a quarter going slightly wrong: a $132,000 proposal whose close date passed six days ago, an $86,000 deal closing in nine days with no next step, a $240,000 deal riding on one relationship, and a rep at 13% of quota), then prints the pipeline, the forecast, the attention list and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/pipeline`, `/forecast`, `/account Alto`, `/opp 1004`, `/scorecard`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md) so the system knows your business, and put your name and colours in [brand.json](brand.json) so every brief and dashboard carries them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. A team shares one database: each person clones the repo, points at the same `DATABASE_URL`, sets `CRM_REP` to their own name, and works in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/pipeline` | Every open deal: amount, weighted value, close date, days left, next step, owner. The board without the board. |
| `/forecast` | The quarter per rep: quota, closed won, weighted pipeline, gap, coverage. The report Salesforce gates behind its top editions. |
| `/attention` | Everything that wants a decision, worst first: missed close dates outrank all. |
| `/account` | One account's whole relationship before the call: contacts, deals, activity, tasks. |
| `/opp` | One deal in full, and the verbs that move it: add, move, next, won (amount required), lost (reason required). |
| `/leads` | The queue oldest first, `lead route` by territory, disqualify with reasons written down. |
| `/convert` | A qualified lead becomes an account, a contact and a deal, in one move. |
| `/scorecard` | Per rep: pipeline held, won and lost in 90 days, real cycle days, activity, overdue next steps. |
| `/log` | A call, email, meeting or demo onto the record, with the consent gate enforced. |
| `/quota` | Set the quarterly quota the forecast is measured against. |
| `/weekly-review` | The Monday pipeline review, written from three commands. |
| `/draft-follow-up` | The follow-up email for a deal, quiet customer or lead, drafted from the full trail into `drafts/`. Never sent. |
| `/import` | Bring the business across from the Salesforce Data Loader exports. Dry run first. |
| `/compliance` | Seven rules from the Acts and your own standards, run against the records, each with its source. |
| `/customise` | Add a field, rename stages, change a rule, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run crm -- help`. Any command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # account briefs, per-rep forecast one-pagers, the 90-day win-loss review
npm run view    # the pipeline and the quarter, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your company's name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser. `/new-view` adds a view, `documents.json` adds a document.

## The rule book, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached. Each rule cites its source, and the sharpest one is enforced at the gate rather than checked after the fact.

1. No email to an opted-out contact, ever (Spam Act 2003 (Cth) ss 16 and 18; UEMA 2007 (NZ) ss 9 and 11). Enforced by the CLI itself.
2. No open deal past its close date: the forecast is only as honest as its dates.
3. Every open deal past qualification has a dated next step.
4. No deal past qualification without an amount: an unpriced deal cannot be forecast.
5. Every lead touched inside three days.
6. No personal data kept at former accounts beyond need (Privacy Act 1988 (Cth) APP 11.2; Privacy Act 2020 (NZ) IPP 9).
7. Every contact at an account with an open deal is reachable (leaning on APP 10).

Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your team.

## Ten questions Salesforce cannot answer

Not without an admin, a report builder session, or the next edition up. Every one of these is answered by the demo data today, in one command or one sentence to the agent.

1. Which open deals have a close date already in the past, and what does the forecast look like with them moved out honestly?
2. Which deals over $100,000 are engaged with only one contact at the account, and who is the second person we should know there?
3. Which rep's committed quarter (closed plus weighted, close dates inside the quarter) is under 60% of quota, and which specific deals would close the gap?
4. Which open deals have had no logged activity for three weeks, ranked by what they are worth?
5. What is each rep's real cycle time from opened to won over the last year, computed from the records rather than remembered?
6. Which customers with five-figure lifetime value have not had a conversation in sixty days?
7. Which leads have never been touched, how old is each, and who is meant to own them?
8. What did we actually lose in the last 90 days, and what do the written-down reasons say when read together?
9. Which stage does each deal die in, and how long does a deal sit in proposal before it wins versus before it loses?
10. Which opted-out contacts are attached to open deals, so the follow-up plan has to be calls, not email?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your team.

1. "Put our team in with their territories, and set everyone's quota for this quarter."
2. "Put our logo and colours on the briefs and dashboards, and change the company name to ours."
3. "Our stages are Qualify, Scope, Quote, Verbal, Won. Rename them and keep the probabilities sensible."
4. "Deals under $10,000 should not clutter the forecast; give me a way to mark them run-rate."
5. "Import our Salesforce export, then route the leads."
6. "Add a rule to `/compliance`: no discount over 15% without a note saying who approved it."
7. "Track the competitor on every lost deal, and show me the loss reasons by competitor."
8. "Build me a page per rep for Monday: their forecast, their overdue next steps, their week."
9. "When a deal moves to negotiation, add a task to get the second contact engaged if there is only one."
10. "Write me a command that drafts the quarterly business review pack for a customer account."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of Salesforce

Export Accounts, Contacts, Opportunities and Leads with Data Loader (or Setup, then Data Export), run one command, and the pipeline comes with you. Step by step, with what maps and what deliberately does not: [docs/replace-salesforce.md](docs/replace-salesforce.md).

```bash
npm run crm -- import salesforce --accounts=Account.csv --contacts=Contact.csv --opportunities=Opportunity.csv --leads=Lead.csv --dry-run
npm run crm -- import salesforce --accounts=Account.csv --contacts=Contact.csv --opportunities=Opportunity.csv --leads=Lead.csv
```

Stage names map to the six stages here, records match on their Salesforce Id so re-running updates rather than duplicates, and every `HasOptedOutOfEmail` becomes a locked gate on day one, with the import telling you how many it carried.

## Architecture

```
enterprise-crm-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your company's name, logo and colours on every brief and view
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/crm.mjs           the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-salesforce.md  moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  whole database dumps
  drafts/                   anything written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, the consent gate intact, and nothing that sends.

## Want it installed and run for you?

Enterprise DNA installs Enterprise CRM for Claude Code for your business, migrates your Salesforce data, wires it into the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call
- Read more: https://enterprisedna.co/omni/instead-of/salesforce

## License

MIT. Copyright (c) 2026 Enterprise DNA.
