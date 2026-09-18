#!/usr/bin/env node
// End-to-end smoke test on a throwaway embedded database.
// Runs migrate, seed, then every CLI command that matters, and asserts on the JSON.
// Passes on Windows and Linux. No network, no Postgres install.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = mkdtempSync(path.join(tmpdir(), 'crm-smoke-'));
const env = { ...process.env, DATA_DIR: dataDir };
delete env.DATABASE_URL; // the smoke test always runs embedded
delete env.CRM_REP;

let step = 0;
function run(label, args, { json = true, expectFail = false } = {}) {
  step++;
  const argv = [path.join(root, 'scripts', args[0]), ...args.slice(1), ...(json ? ['--json'] : [])];
  const res = spawnSync(process.execPath, argv, { cwd: root, env, encoding: 'utf8' });
  const ok = expectFail ? res.status !== 0 : res.status === 0;
  if (!ok) {
    console.error(`\nFAIL step ${step} (${label}): exit ${res.status}\n--- stdout\n${res.stdout}\n--- stderr\n${res.stderr}`);
    process.exit(1);
  }
  console.log(`  ok  ${String(step).padStart(2)}  ${label}`);
  if (!json || expectFail) return { stdout: res.stdout, stderr: res.stderr };
  try {
    return JSON.parse(res.stdout);
  } catch {
    console.error(`\nFAIL step ${step} (${label}): output is not JSON\n${res.stdout}\n${res.stderr}`);
    process.exit(1);
  }
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`\nFAIL assertion: ${msg}`);
    process.exit(1);
  }
}

const n = (v) => Number(v ?? 0);

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Local date, the same way the CLI computes "today". Never UTC: Melbourne is
// ten hours ahead of it.
const todayIso = (() => {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

console.log(`smoke: data dir ${dataDir}`);
try {
  run('migrate', ['migrate.mjs'], { json: false });
  run('migrate again (idempotent)', ['migrate.mjs'], { json: false });
  run('seed', ['seed.mjs'], { json: false });
  run('seed again (idempotent)', ['seed.mjs'], { json: false });

  // ---- the business ---------------------------------------------------------

  const team = run('team', ['crm.mjs', 'team']);
  assert(team.length === 5, `five on the team (${team.length})`);

  const territories = run('territories', ['crm.mjs', 'territories']);
  assert(territories.length === 4, `four territories (${territories.length})`);
  assert(territories.some((t) => t.region === 'NZ' && n(t.accounts) > 0), 'New Zealand has accounts');

  const stats = run('stats', ['crm.mjs', 'stats']);
  assert(stats.accounts === 18, `eighteen accounts (${stats.accounts})`);
  assert(stats.contacts === 24, `twenty-four contacts (${stats.contacts})`);
  assert(stats.open_opps === 10, `ten open deals (${stats.open_opps})`);

  const accounts = run('accounts', ['crm.mjs', 'accounts']);
  assert(accounts.length === 18, `accounts view lists them all (${accounts.length})`);
  assert(accounts.some((a) => n(a.lifetime_won_cents) > 0), 'lifetime won value shows');

  const account = run('account card', ['crm.mjs', 'account', 'Alto Beverage']);
  assert(account.account.name === 'Alto Beverage Co', 'resolved by partial name');
  assert(account.contacts.length === 2, 'with its contacts');
  assert(account.opportunities.some((o) => o.ref === 'OPP-1001'), 'and its deals');

  const noSuch = run('an unknown account exits 1', ['crm.mjs', 'account', 'nothing here at all'], { json: false, expectFail: true });
  assert(/No account matches/.test(noSuch.stderr), 'and says so plainly');

  const ambiguous = run('an ambiguous name exits 1 and lists candidates', ['crm.mjs', 'account', 'water'], { json: false, expectFail: true });
  assert(/matches \d+ account records/.test(ambiguous.stderr), 'with the candidates listed');

  // ---- the pipeline ---------------------------------------------------------

  const pipeline = run('pipeline', ['crm.mjs', 'pipeline']);
  assert(pipeline.length === 10, `ten open deals (${pipeline.length})`);
  assert(pipeline.some((p) => p.amount_cents === null), 'including the unpriced ones');
  assert(pipeline.every((p) => p.close_date), 'every deal carries a close date');

  const byRep = run('pipeline filtered by rep', ['crm.mjs', 'pipeline', '--rep=Aroha']);
  assert(byRep.length === 2 && byRep.every((p) => p.rep === 'Aroha Ngata'), `Aroha holds two deals (${byRep.length})`);

  const opp = run('deal card by bare number', ['crm.mjs', 'opp', '1001']);
  assert(opp.opportunity.ref === 'OPP-1001', 'OPP-1001 resolves from "1001"');
  assert(n(opp.opportunity.amount_cents) === 18400000, 'with its amount');
  assert(opp.history.length === 3, 'and its stage history');
  assert(n(opp.pipeline.contacts_engaged) === 2, 'two contacts engaged on the Alto deal');

  const funnel = run('funnel', ['crm.mjs', 'funnel']);
  assert(funnel.length === 6, `six stages (${funnel.length})`);
  const neg = funnel.find((f) => f.stage === 'negotiation');
  assert(n(neg.deals) === 2, `two deals in negotiation (${neg.deals})`);

  // ---- the forecast and the scorecard --------------------------------------

  const forecast = run('forecast', ['crm.mjs', 'forecast']);
  assert(forecast.length === 4, `four reps carry quotas (${forecast.length})`);
  const aroha = forecast.find((f) => f.rep === 'Aroha Ngata');
  assert(n(aroha.quota_cents) === 50000000, 'Aroha has a $500,000 quota');
  assert(n(aroha.closed_won_cents) === 0, 'nothing closed this quarter');
  assert(n(aroha.gap_cents) > n(aroha.quota_cents) * 0.4, 'and a gap the attention list will shout about');
  assert(forecast.some((f) => n(f.closed_won_cents) > 0), 'somebody has closed business this quarter');

  const scorecard = run('scorecard', ['crm.mjs', 'scorecard']);
  assert(scorecard.length === 5, 'everyone on the scorecard');
  const reuben = scorecard.find((s) => s.rep === 'Reuben Tan');
  assert(n(reuben.won_90d) >= 1, 'Reuben won in the last 90 days');
  assert(scorecard.some((s) => s.avg_cycle_days !== null), 'cycle days compute');

  // ---- leads ----------------------------------------------------------------

  const leads = run('leads', ['crm.mjs', 'leads']);
  assert(leads.length === 7, `seven open leads (${leads.length})`);
  assert(leads.some((l) => l.rep === 'UNASSIGNED'), 'including the unrouted one');
  assert(leads.some((l) => l.status === 'new' && n(l.days_old) > 3 && !l.last_touch_on), 'and the untouched ones');

  // ---- attention and compliance ---------------------------------------------

  const attention = run('attention', ['crm.mjs', 'attention']);
  assert(attention.length >= 10, `the attention list is loud (${attention.length})`);
  for (const reason of ['close_missed', 'closing_no_next_step', 'next_step_overdue', 'deal_stalled', 'single_threaded', 'lead_unworked', 'quota_gap', 'customer_quiet', 'task_overdue']) {
    assert(attention.some((a) => a.reason === reason), `attention carries ${reason}`);
  }
  assert(attention[0].reason === 'close_missed', 'the missed close date outranks everything');
  assert(attention.some((a) => a.reason === 'quota_gap' && a.rep === 'Aroha Ngata'), 'the quota gap names Aroha');
  assert(attention.some((a) => a.reason === 'single_threaded' && a.label === 'OPP-1003'), 'the $240,000 single-threaded deal is called out');

  const compliance = run('compliance', ['crm.mjs', 'compliance']);
  assert(compliance.length === 7, 'seven rules in the book');
  const failed = compliance.filter((r) => r.breaches.length).map((r) => r.key).sort();
  assert(failed.join(',') === 'amounts,close-dates,leads-3-days,next-steps,reachable,retention',
    `the seeded breaches are exactly the story (${failed.join(',')})`);
  assert(!failed.includes('optout'), 'the opt-out rule passes because the gate makes it impossible to fail');

  const oneRule = run('one compliance rule', ['crm.mjs', 'compliance', 'reachable']);
  assert(oneRule.length === 1 && oneRule[0].breaches.length === 1, 'Bluey Sanderson is the one unreachable contact on a live deal');

  // ---- the consent gate ------------------------------------------------------

  const optoutRefused = run('an email to an opted-out contact is refused', ['crm.mjs', 'log', 'Westgate', 'Checking in on the expansion', '--kind=email', '--contact=Gordon Field', '--rep=Casey'], { json: false, expectFail: true });
  assert(/opted out/.test(optoutRefused.stderr) && /Spam Act/.test(optoutRefused.stderr), 'and the refusal cites the Act');

  run('a call to the same contact is fine', ['crm.mjs', 'log', 'Westgate', 'Gordon rang about the expansion timeline.', '--kind=call', '--contact=Gordon Field', '--rep=Casey']);

  // ---- the deal verbs, end to end --------------------------------------------

  run('add an account', ['crm.mjs', 'add', 'account', 'Kingfisher Cold Storage', '--type=prospect', '--territory=Queensland', '--industry=Cold chain', '--rep=Reuben']);
  run('add a contact', ['crm.mjs', 'add', 'contact', 'Priyanka Nair', '--account=Kingfisher', '--title=Facilities Manager', '--email=p.nair@kingfishercold.example.au', '--phone=0417 400 001']);

  const noClose = run('a deal without a close date is refused', ['crm.mjs', 'opp', 'add', 'Kingfisher', '--name=Ammonia room filtration'], { json: false, expectFail: true });
  assert(/close date/.test(noClose.stderr), 'close dates are not optional');

  const added = run('open the deal', ['crm.mjs', 'opp', 'add', 'Kingfisher', '--name=Ammonia room filtration', '--amount=76000', '--close=' + addDays(todayIso, 35), '--rep=Reuben']);
  const ref = added.ref;
  assert(/^OPP-\d+$/.test(ref), `the ref is minted (${ref})`);
  assert(added.probability === 10, 'qualification starts at 10%');

  run('give it a next step', ['crm.mjs', 'opp', 'next', ref, '--step=Site survey of the ammonia room', '--on=' + addDays(todayIso, 7)]);

  const blockedWon = run('closing won through move is refused', ['crm.mjs', 'opp', 'move', ref, 'closed_won'], { json: false, expectFail: true });
  assert(/opp won/.test(blockedWon.stderr), 'winning is its own command');

  const moved = run('move it to proposal', ['crm.mjs', 'opp', 'move', ref, 'proposal']);
  assert(moved.probability === 50, 'proposal defaults to 50%');

  const oppCard = run('the move wrote history', ['crm.mjs', 'opp', ref]);
  assert(oppCard.history.length === 2, `two history rows (${oppCard.history.length})`);

  const unpricedWon = run('winning an unpriced deal is refused', ['crm.mjs', 'opp', 'won', 'OPP-1006'], { json: false, expectFail: true });
  assert(/no amount/.test(unpricedWon.stderr), 'a won deal with no amount is refused');

  const noReason = run('losing without a reason is refused', ['crm.mjs', 'opp', 'lost', 'OPP-1009'], { json: false, expectFail: true });
  assert(/reason/.test(noReason.stderr), 'the reason is the point');

  const won = run('win the Kingfisher deal', ['crm.mjs', 'opp', 'won', ref]);
  assert(won.stage === 'closed_won' && n(won.amount_cents) === 7600000, 'won at the recorded amount');

  const promoted = run('winning promoted the account', ['crm.mjs', 'account', 'Kingfisher']);
  assert(promoted.account.account_type === 'customer', 'prospect became customer');

  // ---- leads: route, work, convert -------------------------------------------

  const routed = run('lead route assigns the unassigned', ['crm.mjs', 'lead', 'route']);
  assert(routed.length === 1 && routed[0].rep === 'Aroha Ngata' && routed[0].matched, 'Pete Rangi routes to the NZ territory');

  const logged = run('logging a call starts working a lead', ['crm.mjs', 'log', 'Brightwater', 'Rang Mia; sending the food-grade spec sheet.', '--rep=Dan']);
  assert(logged.lead_id, 'the activity landed on the lead');

  const workingNow = run('the lead is now working', ['crm.mjs', 'leads']);
  assert(workingNow.find((l) => l.company === 'Brightwater Foods').status === 'working', 'status moved off new');

  const converted = run('convert the qualified lead', ['crm.mjs', 'convert', 'Big Sky', '--opp=Effluent filtration system', '--amount=98000', '--close=' + addDays(todayIso, 40)]);
  assert(converted.account.name === 'Big Sky Feedlots' && converted.opportunity, 'account and deal created together');
  assert(converted.contact.full_name === 'Gina Marsh', 'with Gina as the contact');

  const reconvert = run('converting twice is refused', ['crm.mjs', 'convert', 'Big Sky'], { json: false, expectFail: true });
  assert(/already converted/.test(reconvert.stderr), 'no accidental duplicates');

  const disqualified = run('disqualifying needs a reason', ['crm.mjs', 'lead', 'disqualify', 'Torrent'], { json: false, expectFail: true });
  assert(/reason/.test(disqualified.stderr), 'reasons are written down');
  run('disqualify with the reason', ['crm.mjs', 'lead', 'disqualify', 'Torrent', '--reason=Fifty dollar parts order, not a system sale']);

  // ---- quota and optout -------------------------------------------------------

  run('set a quota', ['crm.mjs', 'quota', 'set', 'Priya', '--amount=250000']);
  const forecastAfter = run('the manager appears on the forecast', ['crm.mjs', 'forecast']);
  assert(forecastAfter.length === 5, `five quota rows now (${forecastAfter.length})`);

  const opted = run('opt a contact out', ['crm.mjs', 'optout', 'Priyanka Nair']);
  assert(opted.opted_out === true, 'the flag is set');
  const gateClosed = run('and the email gate closes', ['crm.mjs', 'log', 'Kingfisher', 'Following up', '--kind=email', '--contact=Priyanka', '--rep=Reuben'], { json: false, expectFail: true });
  assert(/opted out/.test(gateClosed.stderr), 'immediately');

  // ---- import: Salesforce Data Loader CSVs ------------------------------------

  const acctCsv = path.join(dataDir, 'Account.csv');
  const contactCsv = path.join(dataDir, 'Contact.csv');
  const oppCsv = path.join(dataDir, 'Opportunity.csv');
  const leadCsv = path.join(dataDir, 'Lead.csv');
  writeFileSync(acctCsv, [
    'Id,Name,Type,Industry,BillingCity,BillingCountry,Phone,Website',
    '001AAA01,Glasshouse Nurseries,Customer,Horticulture,Caboolture,Australia,07 5495 0001,glasshousenurseries.example.au',
    '001AAA02,Straitline Marine,Prospect,Marine services,Nelson,New Zealand,03 546 0002,straitlinemarine.example.nz',
    '001AAA03,Alto Beverage Co,Customer,Beverages,Melbourne,Australia,,',
  ].join('\n'));
  writeFileSync(contactCsv, [
    'Id,FirstName,LastName,Title,Email,Phone,AccountId,HasOptedOutOfEmail',
    '003BBB01,Judy,Okonkwo,Nursery Manager,judy@glasshousenurseries.example.au,0414 300 001,001AAA01,0',
    '003BBB02,Neil,Prasad,Operations Lead,n.prasad@straitlinemarine.example.nz,027 300 002,001AAA02,1',
    '003BBB03,Ghost,Person,,ghost@example.com,,001ZZZ99,0',
  ].join('\n'));
  writeFileSync(oppCsv, [
    'Id,Name,StageName,Amount,CloseDate,AccountId,Probability,LeadSource',
    `006CCC01,Glasshouse misting filtration,Negotiation,54000,${addDays(todayIso, 30)},001AAA01,80,Referral`,
    `006CCC02,Straitline workshop system,Closed Won,23500,${addDays(todayIso, -40)},001AAA02,,Website`,
  ].join('\n'));
  writeFileSync(leadCsv, [
    'Id,FirstName,LastName,Company,Title,Email,Phone,Status,LeadSource,State',
    '00QDDD01,Rita,Calloway,Meadowbrook Dairy,Ops Manager,rita@meadowbrook.example.au,0415 300 004,Open - Not Contacted,Web,VIC',
  ].join('\n'));

  const dry = run('import dry run writes nothing', ['crm.mjs', 'import', 'salesforce', `--accounts=${acctCsv}`, `--contacts=${contactCsv}`, `--opportunities=${oppCsv}`, `--leads=${leadCsv}`, '--dry-run']);
  assert(n(dry.accounts) === 2 && n(dry.accounts_updated) === 1, 'the dry run counts what it would do');
  assert(n(dry.opt_outs) === 1, 'and the opt-out it would carry across');
  assert(dry.skips.length === 1, 'the contact with the unknown AccountId is a named skip, not a silent one');

  const imported = run('import for real', ['crm.mjs', 'import', 'salesforce', `--accounts=${acctCsv}`, `--contacts=${contactCsv}`, `--opportunities=${oppCsv}`, `--leads=${leadCsv}`]);
  assert(n(imported.accounts) === 2 && n(imported.contacts) === 2 && n(imported.opportunities) === 2 && n(imported.leads) === 1, 'and the real run does it');

  const glasshouse = run('the imported account reads back', ['crm.mjs', 'account', 'Glasshouse']);
  assert(glasshouse.account.account_type === 'customer' && glasshouse.account.external_ref === '001AAA01', 'with its Salesforce Id kept');
  assert(glasshouse.opportunities.length === 1 && n(glasshouse.opportunities[0].amount_cents) === 5400000, 'and its $54,000 deal at negotiation');

  const importedGate = run('the imported opt-out is enforced from day one', ['crm.mjs', 'log', 'Straitline', 'Intro email', '--kind=email', '--contact=Neil Prasad', '--rep=Aroha'], { json: false, expectFail: true });
  assert(/opted out/.test(importedGate.stderr), 'Neil Prasad cannot be emailed');

  const reimport = run('re-importing updates rather than duplicating', ['crm.mjs', 'import', 'salesforce', `--accounts=${acctCsv}`, `--contacts=${contactCsv}`, `--opportunities=${oppCsv}`, `--leads=${leadCsv}`]);
  assert(n(reimport.accounts) === 0 && n(reimport.accounts_updated) === 3 && n(reimport.opportunities) === 0 && n(reimport.opportunities_updated) === 2, 'the second run creates nothing new');

  const missingFile = run('a missing import file fails loudly', ['crm.mjs', 'import', 'salesforce', `--accounts=${path.join(dataDir, 'not-there.csv')}`], { json: false, expectFail: true });
  assert(/No accounts file/.test(missingFile.stderr), 'it exits non zero rather than importing nothing quietly');

  // ---- export ------------------------------------------------------------------

  const outFile = path.join(dataDir, 'dump.json');
  const dump = run('export', ['crm.mjs', 'export', `--out=${outFile}`]);
  assert(existsSync(outFile), 'the export file is on disk');
  const parsed = JSON.parse(readFileSync(outFile, 'utf8'));
  assert(parsed.opportunities.length === n(dump.counts.opportunities), 'the counts match the file');
  assert(parsed.quotas.length >= 5, 'quotas come out too');

  // ---- the branded HTML -----------------------------------------------------------

  const views = run('npm run view', ['view.mjs'], { json: false });
  assert(/views[\\/]pipeline\.html/.test(views.stdout) && /views[\\/]quarter\.html/.test(views.stdout), 'both views rendered');
  const pipelineHtml = readFileSync(path.join(root, 'views', 'pipeline.html'), 'utf8');
  assert(pipelineHtml.includes('Needs a decision') && pipelineHtml.includes('The open pipeline'), 'the pipeline view has its sections');
  const quarterHtml = readFileSync(path.join(root, 'views', 'quarter.html'), 'utf8');
  assert(quarterHtml.includes('The forecast') && quarterHtml.includes('The scorecard'), 'the quarter view has its sections');

  const docsOut = run('npm run docs', ['docs.mjs'], { json: false });
  assert(/account-brief/.test(docsOut.stdout), 'the account briefs rendered');
  assert(/rep-forecast/.test(docsOut.stdout), 'the rep forecast pages rendered');
  assert(/win-loss-review/.test(docsOut.stdout), 'the win-loss review rendered');
  const briefFiles = docsOut.stdout.split('\n').filter((l) => l.includes('account-brief'));
  assert(briefFiles.length >= 5, 'a brief per account with open deals');

  // ---- the human readable side ------------------------------------------------------

  run('team (text)', ['crm.mjs', 'team'], { json: false });
  run('territories (text)', ['crm.mjs', 'territories'], { json: false });
  run('accounts (text)', ['crm.mjs', 'accounts'], { json: false });
  run('account (text)', ['crm.mjs', 'account', 'Monaro'], { json: false });
  run('pipeline (text)', ['crm.mjs', 'pipeline'], { json: false });
  run('opp (text)', ['crm.mjs', 'opp', 'OPP-1004'], { json: false });
  run('funnel (text)', ['crm.mjs', 'funnel'], { json: false });
  run('forecast (text)', ['crm.mjs', 'forecast'], { json: false });
  run('scorecard (text)', ['crm.mjs', 'scorecard'], { json: false });
  run('leads (text)', ['crm.mjs', 'leads', '--all'], { json: false });
  run('attention (text)', ['crm.mjs', 'attention'], { json: false });
  run('compliance (text)', ['crm.mjs', 'compliance'], { json: false });
  run('tasks (text)', ['crm.mjs', 'tasks', '--all'], { json: false });
  run('stats (text)', ['crm.mjs', 'stats'], { json: false });
  run('help', ['crm.mjs', 'help'], { json: false });
  run('an unknown command exits 1', ['crm.mjs', 'nonsense'], { json: false, expectFail: true });

  console.log(`\n${step} checks, PASS`);
} finally {
  if (existsSync(dataDir)) {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the handle briefly; a leftover temp dir is harmless.
    }
  }
}
