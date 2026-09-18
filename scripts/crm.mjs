#!/usr/bin/env node
// enterprise-crm-for-claude-code: the one CLI. Claude Code slash commands call
// this; so can you.
//
//   node scripts/crm.mjs <command> [args] [--flags] [--json]
//
// Run with no arguments (or `help`) for the command list.
//
// This system is a B2B sales team's CRM the way Salesforce sells it:
// territories, reps and quotas, accounts and contacts, leads with routing,
// opportunities with stages and probabilities, the activity record and the
// forecast. It sends nothing: follow-ups draft to drafts/, a person sends.
// Marketing consent is enforced at the gate: an email cannot be logged
// against an opted-out contact (Spam Act 2003 (Cth) s 18; Unsolicited
// Electronic Messages Act 2007 (NZ) s 11).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick, yesNo } from './lib/csv.mjs';
import { table, money as moneyRaw, isoDate, short, truncate, heading } from './lib/format.mjs';

const money = (cents) => moneyRaw(cents, 'AUD');

// ---------------------------------------------------------------------------
// Argument parsing

const BOOL_FLAGS = new Set(['json', 'help', 'all', 'dry-run', 'force', 'unassigned', 'won', 'lost']);

function parseArgv(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      flags.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      let name;
      let value;
      if (eq > -1) {
        name = a.slice(2, eq);
        value = a.slice(eq + 1);
      } else {
        name = a.slice(2);
        const next = argv[i + 1];
        if (BOOL_FLAGS.has(name) || next === undefined || next.startsWith('--')) value = true;
        else value = argv[++i];
      }
      flags[name] = value;
    } else {
      args.push(a);
    }
  }
  return { args, flags };
}

class CliError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

const num = (v) => Number(v ?? 0);
const str = (v) => (v === true || v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------------------
// Dates and money

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function parseDate(v, what = 'date') {
  if (!v || v === true) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const lower = s.toLowerCase();
  if (lower === 'today') return today();
  if (lower === 'yesterday') return addDays(today(), -1);
  if (lower === 'tomorrow') return addDays(today(), 1);
  // Australian and NZ exports write DD/MM/YYYY, so the first number is the
  // day unless the second one is too big to be a month.
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const [day, month] = b > 12 ? [b, a] : [a, b];
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new CliError(`"${v}" is not a ${what}. Use YYYY-MM-DD.`);
  return isoDate(d);
}

function parseMoney(v, what = 'amount') {
  if (v === undefined || v === null || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(n)) throw new CliError(`"${v}" is not an ${what}. Money in dollars: 184000 means $184,000.`);
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// The pipeline vocabulary

const STAGES = ['qualification', 'discovery', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];
const OPEN_STAGES = STAGES.slice(0, 4);
const STAGE_PROB = { qualification: 10, discovery: 25, proposal: 50, negotiation: 75, closed_won: 100, closed_lost: 0 };
const ACCOUNT_TYPES = ['prospect', 'customer', 'partner', 'former'];
const ACTIVITY_KINDS = ['call', 'email', 'meeting', 'demo', 'note'];
const LEAD_SOURCES = ['website', 'referral', 'event', 'outbound', 'partner'];

// ---------------------------------------------------------------------------
// Lookups: full id, first 4+ characters of an id, exact ref or name, then
// contains. One hit wins. Several hits list the candidates and exit 1.

const RESOLVERS = {
  account: {
    from: 'accounts c left join reps r on r.id = c.rep_id',
    cols: 'c.*, r.full_name as rep_name',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.industry ilike $1 or c.city ilike $1',
    label: (r) => `${r.name} (${r.account_type}${r.city ? ', ' + r.city : ''})`,
    order: 'c.name',
    listing: 'accounts',
  },
  contact: {
    from: 'contacts c join accounts a on a.id = c.account_id',
    cols: 'c.*, a.name as account_name',
    exact: "lower(c.full_name) = lower($1) or lower(coalesce(c.email, '')) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.full_name ilike $1 or a.name ilike $1 or c.email ilike $1',
    label: (r) => `${r.full_name}, ${r.title || 'no title'} at ${r.account_name}${r.opted_out ? ' (OPTED OUT)' : ''}`,
    order: 'c.full_name',
    listing: 'contacts',
  },
  rep: {
    from: 'reps c',
    cols: 'c.*',
    exact: "lower(c.full_name) = lower($1) or lower(coalesce(c.code, '')) = lower($1) or lower(coalesce(c.email, '')) = lower($1)",
    fuzzy: 'c.full_name ilike $1 or c.code ilike $1',
    label: (r) => `${r.full_name} (${r.role})`,
    order: 'c.full_name',
    listing: 'team',
  },
  opportunity: {
    from: 'opportunities c join accounts a on a.id = c.account_id',
    cols: 'c.*, a.name as account_name',
    exact: "lower(coalesce(c.ref, '')) = lower($1) or lower(coalesce(c.ref, '')) = lower('OPP-' || $1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.ref ilike $1 or a.name ilike $1 or c.name ilike $1',
    label: (r) => `${r.ref}  ${r.account_name}: ${truncate(r.name, 40)} (${r.stage})`,
    order: 'c.close_date',
    listing: 'pipeline --all',
  },
  lead: {
    from: 'leads c',
    cols: 'c.*',
    exact: "lower(c.company) = lower($1) or lower(c.full_name) = lower($1) or lower(coalesce(c.external_ref, '')) = lower($1)",
    fuzzy: 'c.company ilike $1 or c.full_name ilike $1 or c.email ilike $1',
    label: (r) => `${r.full_name}, ${r.company} (${r.status})`,
    order: 'c.received_on',
    listing: 'leads --all',
  },
  territory: {
    from: 'territories c',
    cols: 'c.*',
    exact: "lower(c.name) = lower($1) or lower(coalesce(c.region, '')) = lower($1)",
    fuzzy: 'c.name ilike $1 or c.region ilike $1',
    label: (r) => `${r.name} (${r.region || 'no region'})`,
    order: 'c.name',
    listing: 'territories',
  },
  task: {
    from: 'tasks c left join accounts a on a.id = c.account_id',
    cols: 'c.*, a.name as account_name',
    exact: 'lower(c.title) = lower($1)',
    fuzzy: 'c.title ilike $1 or a.name ilike $1',
    label: (r) => `${short(r.id)}  ${truncate(r.title, 50)} (${r.status})`,
    order: 'c.due_on',
    listing: 'tasks --all',
  },
};

const ID_RE = /^[0-9a-f]{4,8}(-[0-9a-f-]*)?$/i;

async function resolve(db, kind, q, { optional = false } = {}) {
  const spec = RESOLVERS[kind];
  q = String(q ?? '').trim();
  if (!q || q === 'true') {
    if (optional) return null;
    throw new CliError(`Give me a ${kind} name, reference or id.`);
  }
  const select = `select ${spec.cols} from ${spec.from}`;
  let rows = [];
  if (ID_RE.test(q)) {
    rows = await db.query(`${select} where c.id::text like $1 order by ${spec.order}`, [q.toLowerCase() + '%']);
    if (rows.length === 1) return rows[0];
  }
  if (!rows.length) rows = await db.query(`${select} where ${spec.exact} order by ${spec.order}`, [q]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) rows = await db.query(`${select} where ${spec.fuzzy} order by ${spec.order}`, [`%${q}%`]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    if (optional) return null;
    throw new CliError(`No ${kind} matches "${q}". Run \`${spec.listing}\` to see what exists.`);
  }
  throw new CliError(
    `"${q}" matches ${rows.length} ${kind} records. Use a reference, an id, or a longer name:\n` +
      rows.map((r) => `  ${short(r.id)}  ${spec.label(r)}`).join('\n'),
  );
}

// The person doing the work: --rep, CRM_REP, or the only active person.
async function whoIs(db, flags, { optional = true } = {}) {
  const named = flags.rep || process.env.CRM_REP;
  if (named && named !== true) return resolve(db, 'rep', named);
  const rows = await db.query('select * from reps where active order by full_name');
  if (rows.length === 1) return rows[0];
  if (optional) return null;
  if (!rows.length) throw new CliError('Nobody on the team yet. Add someone: add rep "<name>"');
  throw new CliError(
    'Several people work here. Pass --rep= (or set CRM_REP):\n' +
      rows.map((r) => `  ${r.code || short(r.id)}  ${r.full_name}`).join('\n'),
  );
}

// The one gate on consent: an email cannot be logged against an opted-out
// contact. The law is not a preference field.
function refuseOptedOutEmail(contact, kind) {
  if (kind === 'email' && contact?.opted_out) {
    throw new CliError(
      `No. ${contact.full_name} opted out${contact.opted_out_on ? ` on ${isoDate(contact.opted_out_on)}` : ''}, and an email to an opted-out contact\n` +
        'is a breach, not a judgment call (Spam Act 2003 (Cth) s 18; Unsolicited Electronic Messages Act 2007 (NZ) s 11).\n' +
        'Ring them, or log the call you had. The opt-out stands until they opt back in, in writing.',
    );
  }
}

async function nextRef(db) {
  const [r] = await db.query(
    "select coalesce(max(substring(ref from 5)::int), 1000) + 1 as n from opportunities where ref ~ '^OPP-[0-9]+$'",
  );
  return `OPP-${r.n}`;
}

// ---------------------------------------------------------------------------
// Shared column sets

const PIPELINE_COLS = [
  { key: 'ref', label: 'ref' },
  { key: 'account', label: 'account', width: 26 },
  { key: 'opportunity', label: 'opportunity', width: 34 },
  { key: 'stage', label: 'stage' },
  { key: 'amount_cents', label: 'amount', align: 'right', format: (v) => (v === null || v === undefined ? 'UNPRICED' : money(v)) },
  { key: 'weighted_cents', label: 'weighted', align: 'right', format: (v) => (v === null || v === undefined ? '' : money(v)) },
  { key: 'close_date', label: 'close', format: (v) => isoDate(v) },
  { key: 'days_to_close', label: 'left', align: 'right', format: (v) => (num(v) < 0 ? `${Math.abs(num(v))}d AGO` : `${v}d`) },
  { key: 'next_step', label: 'next step', width: 30, format: (v) => v || 'NONE' },
  { key: 'next_step_on', label: 'next due', format: (v) => isoDate(v) },
  { key: 'rep', label: 'rep', width: 14 },
];

// ---------------------------------------------------------------------------
// Reads

async function cmdTeam(db) {
  const rows = await db.query(
    `select r.*, t.name as territory from reps r left join territories t on t.id = r.territory_id order by r.role desc, r.full_name`,
  );
  return {
    json: rows,
    text:
      heading('The team') +
      '\n' +
      table(rows, [
        { key: 'code', label: 'code' },
        { key: 'full_name', label: 'name' },
        { key: 'role', label: 'role' },
        { key: 'territory', label: 'territory' },
        { key: 'email', label: 'email' },
        { key: 'active', label: 'active', format: (v) => (v ? 'yes' : 'no') },
      ]),
  };
}

async function cmdTerritories(db) {
  const rows = await db.query(`
    select t.name, t.region,
           (select count(*) from reps r where r.territory_id = t.id and r.active) as reps,
           (select count(*) from accounts a where a.territory_id = t.id) as accounts,
           coalesce((select sum(o.amount_cents) from opportunities o join accounts a on a.id = o.account_id
                     where a.territory_id = t.id and o.stage not in ('closed_won','closed_lost')), 0)::bigint as open_cents
    from territories t order by t.name`);
  return {
    json: rows,
    text:
      heading('Territories') +
      '\n' +
      table(rows, [
        { key: 'name', label: 'territory' },
        { key: 'region', label: 'region' },
        { key: 'reps', label: 'reps', align: 'right' },
        { key: 'accounts', label: 'accounts', align: 'right' },
        { key: 'open_cents', label: 'open pipeline', align: 'right', format: (v) => (num(v) ? money(v) : '') },
      ]),
  };
}

async function cmdAccounts(db, args, flags) {
  const where = [];
  const params = [];
  if (flags.type) {
    if (!ACCOUNT_TYPES.includes(str(flags.type))) throw new CliError(`--type= is one of: ${ACCOUNT_TYPES.join(', ')}`);
    params.push(str(flags.type));
    where.push(`account_type = $${params.length}`);
  }
  if (flags.rep) {
    const r = await resolve(db, 'rep', flags.rep);
    params.push(r.full_name);
    where.push(`rep = $${params.length}`);
  }
  const rows = await db.query(
    `select * from v_account_position ${where.length ? 'where ' + where.join(' and ') : ''} order by open_cents desc, account`,
    params,
  );
  return {
    json: rows,
    text:
      heading(`Accounts (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'account', label: 'account', width: 30 },
        { key: 'account_type', label: 'type' },
        { key: 'industry', label: 'industry', width: 20 },
        { key: 'rep', label: 'rep', width: 14 },
        { key: 'open_opps', label: 'open', align: 'right' },
        { key: 'open_cents', label: 'open value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'lifetime_won_cents', label: 'lifetime won', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'days_quiet', label: 'quiet', align: 'right', format: (v) => (v === null || v === undefined ? 'never touched' : `${v}d`) },
      ]),
  };
}

async function cmdAccount(db, args) {
  const a = await resolve(db, 'account', args.join(' '));
  const [position] = await db.query('select * from v_account_position where account_id = $1', [a.id]);
  const contacts = await db.query('select * from contacts where account_id = $1 order by full_name', [a.id]);
  const opps = await db.query(
    `select o.ref, o.name, o.stage, o.amount_cents, o.probability, o.close_date, o.next_step, o.next_step_on, o.won_on, o.lost_on, o.lost_reason,
            coalesce(r.full_name, 'unassigned') as rep
     from opportunities o left join reps r on r.id = o.rep_id where o.account_id = $1
     order by case when o.stage in ('closed_won','closed_lost') then 1 else 0 end, o.close_date`,
    [a.id],
  );
  const activities = await db.query(
    `select x.happened_on, x.kind, c.full_name as contact, r.full_name as rep, x.note
     from activities x left join contacts c on c.id = x.contact_id left join reps r on r.id = x.rep_id
     where x.account_id = $1 order by x.happened_on desc limit 12`,
    [a.id],
  );
  const tasks = await db.query(`select title, due_on, status from tasks where account_id = $1 and status = 'open' order by due_on`, [a.id]);
  const json = { account: a, position, contacts, opportunities: opps, activities, tasks };
  let text = heading(a.name) + `\n  ${a.account_type} | ${a.industry || 'no industry'} | ${position.territory || 'no territory'} | ${a.rep_name || 'unassigned'}`;
  text += `\n  ${[a.city, a.country].filter(Boolean).join(', ')}${a.website ? ' | ' + a.website : ''}${a.phone ? ' | ' + a.phone : ''}`;
  if (num(position.open_cents)) text += `\n  ${position.open_opps} open ${num(position.open_opps) === 1 ? 'deal' : 'deals'} worth ${money(position.open_cents)}`;
  if (num(position.lifetime_won_cents)) text += ` | ${money(position.lifetime_won_cents)} won lifetime`;
  if (position.days_quiet !== null && position.days_quiet !== undefined) text += `\n  last activity ${isoDate(position.last_activity_on)} (${position.days_quiet} days ago)`;
  if (contacts.length) {
    text += '\n' + heading('Contacts') + '\n' + table(contacts, [
      { key: 'full_name', label: 'name', width: 22 },
      { key: 'title', label: 'title', width: 28 },
      { key: 'buying_role', label: 'role' },
      { key: 'email', label: 'email', width: 34, format: (v, r) => (r.opted_out ? (v || '') + '  OPTED OUT' : v) },
      { key: 'phone', label: 'phone' },
    ]);
  }
  if (opps.length) {
    text += '\n' + heading('Opportunities') + '\n' + table(opps, [
      { key: 'ref', label: 'ref' },
      { key: 'name', label: 'opportunity', width: 34 },
      { key: 'stage', label: 'stage' },
      { key: 'amount_cents', label: 'amount', align: 'right', format: (v) => (v === null ? 'UNPRICED' : money(v)) },
      { key: 'close_date', label: 'close', format: (v) => isoDate(v) },
      { key: 'rep', label: 'rep', width: 14 },
      { key: 'lost_reason', label: 'outcome', width: 30, format: (v, r) => (r.won_on ? 'won ' + isoDate(r.won_on) : v ? 'lost: ' + v : '') },
    ]);
  }
  if (activities.length) {
    text += '\n' + heading('Recent activity') + '\n' + table(activities, [
      { key: 'happened_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'kind', label: 'kind' },
      { key: 'contact', label: 'with', width: 20 },
      { key: 'rep', label: 'rep', width: 14 },
      { key: 'note', label: 'note', width: 60 },
    ]);
  }
  if (tasks.length) {
    text += '\n' + heading('Open tasks') + '\n' + table(tasks, [
      { key: 'title', label: 'task', width: 56 },
      { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
    ]);
  }
  return { json, text };
}

async function cmdPipeline(db, args, flags) {
  const where = [];
  const params = [];
  if (flags.rep) {
    const r = await resolve(db, 'rep', flags.rep);
    params.push(r.full_name);
    where.push(`rep = $${params.length}`);
  }
  if (flags.stage) {
    if (!STAGES.includes(str(flags.stage))) throw new CliError(`--stage= is one of: ${STAGES.join(', ')}`);
    params.push(str(flags.stage));
    where.push(`stage = $${params.length}`);
  }
  if (flags.account) {
    const a = await resolve(db, 'account', flags.account);
    params.push(a.id);
    where.push(`account_id = $${params.length}`);
  }
  const rows = await db.query(
    `select * from v_pipeline ${where.length ? 'where ' + where.join(' and ') : ''}
     order by case stage when 'negotiation' then 1 when 'proposal' then 2 when 'discovery' then 3 else 4 end, close_date`,
    params,
  );
  const total = rows.reduce((s, r) => s + num(r.amount_cents), 0);
  const weighted = rows.reduce((s, r) => s + num(r.weighted_cents), 0);
  return {
    json: rows,
    text:
      heading(`The pipeline (${rows.length} open, ${money(total)} total, ${money(weighted)} weighted)`) +
      '\n' +
      table(rows, PIPELINE_COLS) +
      (rows.some((r) => r.amount_cents === null) ? '\n\n  UNPRICED past qualification fails /compliance: an unpriced deal cannot be forecast.' : ''),
  };
}

async function cmdOpp(db, args) {
  const o = await resolve(db, 'opportunity', args.join(' '));
  const open = OPEN_STAGES.includes(o.stage);
  const [p] = open ? await db.query('select * from v_pipeline where opportunity_id = $1', [o.id]) : [null];
  const [repRow] = o.rep_id ? await db.query('select full_name from reps where id = $1', [o.rep_id]) : [null];
  const history = await db.query('select from_stage, to_stage, changed_on, days_in_stage, note from stage_history where opportunity_id = $1 order by changed_on', [o.id]);
  const activities = await db.query(
    `select x.happened_on, x.kind, c.full_name as contact, r.full_name as rep, x.note
     from activities x left join contacts c on c.id = x.contact_id left join reps r on r.id = x.rep_id
     where x.opportunity_id = $1 order by x.happened_on desc`,
    [o.id],
  );
  const tasks = await db.query('select title, due_on, status from tasks where opportunity_id = $1 order by due_on', [o.id]);
  const json = { opportunity: o, pipeline: p, history, activities, tasks };
  let text = heading(`${o.ref}  ${o.name}`) + `\n  ${o.account_name} | ${o.stage} | ${repRow?.full_name || 'unassigned'}`;
  text += `\n  ${o.amount_cents === null ? 'UNPRICED' : money(o.amount_cents)} at ${o.probability}% = ${o.amount_cents === null ? 'nothing to weight' : money((o.amount_cents * o.probability) / 100)}`;
  text += `\n  opened ${isoDate(o.opened_on)}, close date ${isoDate(o.close_date)}`;
  if (p) {
    text += ` (${num(p.days_to_close) < 0 ? Math.abs(p.days_to_close) + ' days AGO' : p.days_to_close + ' days left'})`;
    text += `\n  in ${o.stage} for ${p.days_in_stage} days | last touch ${p.last_activity_on ? isoDate(p.last_activity_on) + ` (${p.days_since_touch}d ago)` : 'NEVER'} | ${p.contacts_engaged} contact${num(p.contacts_engaged) === 1 ? '' : 's'} engaged`;
    text += `\n  next step: ${o.next_step ? `${o.next_step} (${isoDate(o.next_step_on) || 'no date'})` : 'NONE RECORDED'}`;
  }
  if (o.won_on) text += `\n  WON ${isoDate(o.won_on)}`;
  if (o.lost_on) text += `\n  LOST ${isoDate(o.lost_on)}: ${o.lost_reason || 'no reason recorded'}`;
  if (o.note) text += `\n  note: ${o.note}`;
  if (history.length) {
    text += '\n' + heading('Stage history') + '\n' + table(history, [
      { key: 'changed_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'from_stage', label: 'from' },
      { key: 'to_stage', label: 'to' },
      { key: 'days_in_stage', label: 'days in stage', align: 'right' },
      { key: 'note', label: 'note', width: 40 },
    ]);
  }
  if (activities.length) {
    text += '\n' + heading('Activity') + '\n' + table(activities, [
      { key: 'happened_on', label: 'date', format: (v) => isoDate(v) },
      { key: 'kind', label: 'kind' },
      { key: 'contact', label: 'with', width: 20 },
      { key: 'rep', label: 'rep', width: 14 },
      { key: 'note', label: 'note', width: 60 },
    ]);
  }
  if (tasks.length) {
    text += '\n' + heading('Tasks') + '\n' + table(tasks, [
      { key: 'title', label: 'task', width: 56 },
      { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
      { key: 'status', label: 'status' },
    ]);
  }
  return { json, text };
}

async function cmdFunnel(db) {
  const rows = await db.query('select * from v_funnel order by ord');
  return {
    json: rows,
    text:
      heading('The funnel') +
      '\n' +
      table(rows, [
        { key: 'stage', label: 'stage' },
        { key: 'deals', label: 'deals', align: 'right' },
        { key: 'value_cents', label: 'value', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'weighted_cents', label: 'weighted', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'avg_days_in_stage', label: 'avg days in stage', align: 'right', format: (v) => (v === null || v === undefined ? '' : String(v)) },
      ]) +
      '\n\n  Weighted is amount times stage probability: the arithmetic the incumbent calls forecasting.',
  };
}

async function cmdForecast(db) {
  const rows = await db.query('select * from v_forecast order by rep');
  if (!rows.length) {
    throw new CliError(`No quotas for ${currentPeriod()}. Set them: quota set <rep> --amount=<dollars> [--period=${currentPeriod()}]`);
  }
  const cols = [
    { key: 'rep', label: 'rep', width: 16 },
    { key: 'quota_cents', label: 'quota', align: 'right', format: (v) => money(v) },
    { key: 'closed_won_cents', label: 'closed won', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'weighted_quarter_cents', label: 'weighted (qtr)', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'gap_cents', label: 'gap', align: 'right', format: (v) => (num(v) > 0 ? money(v) : 'covered') },
    { key: 'coverage', label: 'coverage', align: 'right' },
    { key: 'best_case_quarter_cents', label: 'best case (qtr)', align: 'right', format: (v) => (num(v) ? money(v) : '') },
    { key: 'open_pipeline_cents', label: 'all open', align: 'right', format: (v) => (num(v) ? money(v) : '') },
  ];
  const enriched = rows.map((r) => {
    const committed = num(r.closed_won_cents) + num(r.weighted_quarter_cents);
    return {
      ...r,
      committed_cents: committed,
      gap_cents: Math.max(0, num(r.quota_cents) - committed),
      coverage: `${Math.round((committed / num(r.quota_cents)) * 100)}%`,
    };
  });
  const totals = {
    quota: enriched.reduce((s, r) => s + num(r.quota_cents), 0),
    committed: enriched.reduce((s, r) => s + num(r.committed_cents), 0),
  };
  return {
    json: enriched,
    text:
      heading(`The forecast, ${rows[0].period} (${rows[0].days_left_in_quarter} days left)`) +
      '\n' +
      table(enriched, cols) +
      `\n\n  Team: ${money(totals.committed)} closed plus weighted against ${money(totals.quota)} quota (${Math.round((totals.committed / totals.quota) * 100)}%).` +
      '\n  Weighted counts open deals with a close date inside the quarter, at stage probability.',
  };
}

async function cmdScorecard(db) {
  const rows = await db.query('select * from v_scorecard order by rep');
  return {
    json: rows,
    text:
      heading('The scorecard, per rep') +
      '\n' +
      table(rows, [
        { key: 'rep', label: 'rep', width: 16 },
        { key: 'open_deals', label: 'open', align: 'right' },
        { key: 'open_cents', label: 'pipeline', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'weighted_cents', label: 'weighted', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'won_90d', label: 'won 90d', align: 'right' },
        { key: 'won_90d_cents', label: 'won 90d $', align: 'right', format: (v) => (num(v) ? money(v) : '') },
        { key: 'lost_90d', label: 'lost 90d', align: 'right' },
        { key: 'avg_cycle_days', label: 'cycle days', align: 'right', format: (v) => (v === null || v === undefined ? '' : String(v)) },
        { key: 'activities_14d', label: 'activity 14d', align: 'right' },
        { key: 'next_steps_overdue', label: 'steps overdue', align: 'right', format: (v) => (num(v) ? String(v) : '') },
      ]) +
      '\n\n  Cycle days is opened-to-won over the last year. Activity is logged work, not busyness claimed.',
  };
}

async function cmdLeads(db, args, flags) {
  const rows = await db.query(`select * from v_leads ${flags.unassigned ? 'where rep_id is null' : ''} order by received_on`);
  const all = flags.all ? await db.query(`select * from leads where status in ('converted','disqualified') order by received_on desc`) : [];
  return {
    json: flags.all ? { open: rows, closed: all } : rows,
    text:
      heading(`The lead queue (${rows.length} open)`) +
      '\n' +
      table(rows, [
        { key: 'full_name', label: 'who', width: 18 },
        { key: 'company', label: 'company', width: 26 },
        { key: 'source', label: 'source' },
        { key: 'region', label: 'region' },
        { key: 'status', label: 'status' },
        { key: 'rep', label: 'rep', width: 14 },
        { key: 'days_old', label: 'age', align: 'right', format: (v) => `${v}d` },
        { key: 'last_touch_on', label: 'last touch', format: (v) => (v ? isoDate(v) : 'NEVER') },
      ]) +
      (rows.some((r) => !r.rep_id) ? '\n\n  UNASSIGNED leads first: `lead route` assigns them by territory.' : '') +
      (flags.all && all.length
        ? '\n' + heading('Converted and disqualified') + '\n' + table(all, [
            { key: 'full_name', label: 'who', width: 18 },
            { key: 'company', label: 'company', width: 26 },
            { key: 'status', label: 'status' },
            { key: 'disqualified_reason', label: 'reason', width: 40 },
          ])
        : ''),
  };
}

async function cmdAttention(db) {
  const rows = await db.query(`
    select * from v_attention
    order by case reason
      when 'close_missed' then 1
      when 'closing_no_next_step' then 2
      when 'next_step_overdue' then 3
      when 'quota_gap' then 4
      when 'deal_stalled' then 5
      when 'single_threaded' then 6
      when 'lead_unworked' then 7
      when 'customer_quiet' then 8
      when 'task_overdue' then 9
      else 10 end,
      days desc nulls last
  `);
  return {
    json: rows,
    text:
      heading(`Needs a decision (${rows.length})`) +
      '\n' +
      table(rows, [
        { key: 'reason', label: 'why' },
        { key: 'label', label: 'record', width: 24 },
        { key: 'account', label: 'account', width: 26 },
        { key: 'rep', label: 'rep', width: 14 },
        { key: 'days', label: 'days', align: 'right' },
        { key: 'amount_cents', label: 'amount', align: 'right', format: (v) => (v === null || v === undefined ? '' : money(Math.abs(num(v)))) },
        { key: 'detail', label: 'detail', width: 70 },
      ]),
  };
}

async function cmdTasks(db, args, flags) {
  const rows = await db.query(
    `select t.title, a.name as account, r.full_name as rep, t.due_on, t.status, t.done_on
     from tasks t left join accounts a on a.id = t.account_id left join reps r on r.id = t.rep_id
     where ($1 or t.status = 'open') order by t.due_on nulls last`,
    [Boolean(flags.all)],
  );
  return {
    json: rows,
    text:
      heading(flags.all ? 'Tasks, all' : 'Open tasks') +
      '\n' +
      table(rows, [
        { key: 'title', label: 'task', width: 56 },
        { key: 'account', label: 'account', width: 24 },
        { key: 'rep', label: 'rep', width: 14 },
        { key: 'due_on', label: 'due', format: (v) => isoDate(v) },
        { key: 'status', label: 'status' },
      ]),
  };
}

async function cmdStats(db) {
  const [c] = await db.query(`
    select (select count(*) from reps where active)                                         as reps,
           (select count(*) from territories)                                               as territories,
           (select count(*) from accounts)                                                  as accounts,
           (select count(*) from accounts where account_type = 'customer')                  as customers,
           (select count(*) from contacts)                                                  as contacts,
           (select count(*) from leads where status in ('new','working','qualified'))       as open_leads,
           (select count(*) from opportunities where stage not in ('closed_won','closed_lost')) as open_opps,
           (select coalesce(sum(amount_cents), 0) from opportunities where stage not in ('closed_won','closed_lost'))::bigint as open_cents,
           (select coalesce(sum(amount_cents * probability / 100), 0) from opportunities where stage not in ('closed_won','closed_lost'))::bigint as weighted_cents,
           (select count(*) from opportunities where stage = 'closed_won')                  as won_all_time,
           (select count(*) from v_attention)                                               as attention_items
  `);
  const json = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  return {
    json,
    text:
      heading('The business') +
      `\n  ${json.accounts} accounts (${json.customers} customers), ${json.contacts} contacts, ${json.reps} on the team across ${json.territories} territories` +
      `\n  ${json.open_opps} open deals worth ${money(json.open_cents)} (${money(json.weighted_cents)} weighted), ${json.open_leads} leads in the queue` +
      `\n  ${json.attention_items} items on the attention list`,
  };
}

// ---------------------------------------------------------------------------
// Opportunities: add, move, next, won, lost

async function cmdOppCmd(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const account = await resolve(db, 'account', args.slice(1).join(' '));
    const name = str(flags.name);
    if (!name) throw new CliError('What is the deal? opp add <account> --name="Filtration line upgrade" --close= [--amount= --stage= --rep=]');
    const close = parseDate(flags.close, 'close date');
    if (!close) throw new CliError('Every deal carries a close date from day one; that is what makes a forecast possible. --close=YYYY-MM-DD');
    const stage = str(flags.stage) || 'qualification';
    if (!OPEN_STAGES.includes(stage)) throw new CliError(`--stage= is one of: ${OPEN_STAGES.join(', ')}. Deals close through \`opp won\` and \`opp lost\`.`);
    const amount = parseMoney(flags.amount);
    const rep = flags.rep ? await whoIs(db, flags) : account.rep_id ? { id: account.rep_id } : await whoIs(db, flags);
    const probability = flags.probability !== undefined ? Number(flags.probability) : STAGE_PROB[stage];
    if (Number.isNaN(probability) || probability < 0 || probability > 100) throw new CliError('--probability= is 0 to 100.');
    const ref = await nextRef(db);
    const [row] = await db.query(
      `insert into opportunities (ref, account_id, rep_id, name, stage, amount_cents, probability, close_date, next_step, next_step_on, source, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
      [ref, account.id, rep?.id || null, name, stage, amount, probability, close, str(flags.next) || null, parseDate(flags['next-on']), str(flags.source) || null, str(flags.note) || null],
    );
    await db.query(`insert into stage_history (opportunity_id, from_stage, to_stage, changed_on) values ($1, null, $2, current_date)`, [row.id, stage]);
    let text = `${ref} in the pipeline: ${account.name}, "${name}", ${stage}${amount !== null ? `, ${money(amount)} at ${probability}%` : ' (UNPRICED: price it before it leaves qualification)'}, closing ${close}.`;
    if (!row.next_step) text += `\nGive it a next step now: opp next ${ref} --step="..." --on=<date>`;
    return { json: row, text };
  }
  if (sub === 'move') {
    const o = await resolve(db, 'opportunity', args[1]);
    const stage = str(args[2] || flags.stage);
    if (!STAGES.includes(stage)) throw new CliError(`Which stage? One of: ${OPEN_STAGES.join(', ')}.`);
    if (stage === 'closed_won') throw new CliError(`Winning is its own command, so the record is complete: opp won ${o.ref}`);
    if (stage === 'closed_lost') throw new CliError(`Losing is its own command, and it needs the reason: opp lost ${o.ref} --reason="..."`);
    if (!OPEN_STAGES.includes(o.stage)) throw new CliError(`${o.ref} is ${o.stage}. Closed deals do not move.`);
    if (o.stage === stage) throw new CliError(`${o.ref} is already at ${stage}.`);
    const probability = flags.probability !== undefined ? Number(flags.probability) : STAGE_PROB[stage];
    const [row] = await db.query(
      `update opportunities set stage = $1, probability = $2, stage_entered_on = current_date where id = $3 returning *`,
      [stage, probability, o.id],
    );
    await db.query(
      `insert into stage_history (opportunity_id, from_stage, to_stage, changed_on, days_in_stage, note) values ($1, $2, $3, current_date, current_date - $4::date, $5)`,
      [o.id, o.stage, stage, isoDate(o.stage_entered_on), str(flags.note) || null],
    );
    const backwards = STAGES.indexOf(stage) < STAGES.indexOf(o.stage);
    let text = `${o.ref}: ${o.stage} -> ${stage} at ${probability}%${backwards ? ' (moved BACKWARDS; the history records it)' : ''}.`;
    if (row.amount_cents === null && stage !== 'qualification') text += `\nStill UNPRICED. /compliance will keep saying so: opp set is not a command, price it with opp won later or --amount on the next move.`;
    if (flags.amount) {
      const amount = parseMoney(flags.amount);
      await db.query('update opportunities set amount_cents = $1 where id = $2', [amount, o.id]);
      text = `${o.ref}: ${o.stage} -> ${stage} at ${probability}%, priced ${money(amount)}.`;
    }
    text += `\nNext step: ${row.next_step ? `"${row.next_step}" (${isoDate(row.next_step_on) || 'no date'})` : `none. opp next ${o.ref} --step="..." --on=<date>`}`;
    return { json: row, text };
  }
  if (sub === 'next') {
    const o = await resolve(db, 'opportunity', args[1]);
    if (!OPEN_STAGES.includes(o.stage)) throw new CliError(`${o.ref} is ${o.stage}; closed deals have no next step.`);
    const step = str(flags.step);
    if (!step) throw new CliError(`opp next ${o.ref} --step="what happens next" --on=<date>`);
    const on = parseDate(flags.on, 'next step date');
    if (!on) throw new CliError('A next step without a date is a wish. --on=YYYY-MM-DD (or tomorrow).');
    const [row] = await db.query(`update opportunities set next_step = $1, next_step_on = $2 where id = $3 returning *`, [step, on, o.id]);
    return { json: row, text: `${o.ref}: next step "${step}" on ${on}.` };
  }
  if (sub === 'won') {
    const o = await resolve(db, 'opportunity', args[1]);
    if (!OPEN_STAGES.includes(o.stage)) throw new CliError(`${o.ref} is already ${o.stage}.`);
    const amount = parseMoney(flags.amount) ?? o.amount_cents;
    if (amount === null || amount === undefined) {
      throw new CliError(
        `${o.ref} has no amount, and a won deal with no amount is a forecast lie waiting to be told.\n` +
          `What did they sign for? opp won ${o.ref} --amount=<dollars>`,
      );
    }
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(
      `update opportunities set stage = 'closed_won', probability = 100, amount_cents = $1, won_on = $2, close_date = $2,
         next_step = null, next_step_on = null, stage_entered_on = $2 where id = $3 returning *`,
      [amount, on, o.id],
    );
    await db.query(
      `insert into stage_history (opportunity_id, from_stage, to_stage, changed_on, days_in_stage) values ($1, $2, 'closed_won', $3, $3::date - $4::date)`,
      [o.id, o.stage, on, isoDate(o.stage_entered_on)],
    );
    const [acct] = await db.query('select * from accounts where id = $1', [o.account_id]);
    let promo = '';
    if (acct.account_type === 'prospect') {
      await db.query(`update accounts set account_type = 'customer' where id = $1`, [acct.id]);
      promo = `\n${acct.name} is now a customer.`;
    }
    return { json: row, text: `${o.ref} WON: ${money(amount)}, ${isoDate(row.won_on)}. ${o.account_name}.${promo}` };
  }
  if (sub === 'lost') {
    const o = await resolve(db, 'opportunity', args[1]);
    if (!OPEN_STAGES.includes(o.stage)) throw new CliError(`${o.ref} is already ${o.stage}.`);
    const reason = str(flags.reason);
    if (!reason) {
      throw new CliError(
        `A lost deal with no reason teaches nobody anything, and the win rate you quote next quarter is built on these rows.\n` +
          `opp lost ${o.ref} --reason="who won it and why, or what killed it"`,
      );
    }
    const on = parseDate(flags.on) || today();
    const [row] = await db.query(
      `update opportunities set stage = 'closed_lost', probability = 0, lost_on = $1, close_date = $1, lost_reason = $2,
         next_step = null, next_step_on = null, stage_entered_on = $1 where id = $3 returning *`,
      [on, reason, o.id],
    );
    await db.query(
      `insert into stage_history (opportunity_id, from_stage, to_stage, changed_on, days_in_stage, note) values ($1, $2, 'closed_lost', $3, $3::date - $4::date, $5)`,
      [o.id, o.stage, on, isoDate(o.stage_entered_on), reason],
    );
    return { json: row, text: `${o.ref} lost: ${reason}. The history keeps it; the win rate owns it.` };
  }
  throw new CliError('opp add <account> --name= --close= [--amount=] | opp move <ref> <stage> | opp next <ref> --step= --on= | opp won <ref> [--amount=] | opp lost <ref> --reason=');
}

// ---------------------------------------------------------------------------
// Leads: route, assign, disqualify, convert

async function cmdLead(db, args, flags) {
  const sub = args[0];
  if (sub === 'route') {
    const unassigned = await db.query(`select * from leads where rep_id is null and status in ('new','working','qualified') order by received_on`);
    if (!unassigned.length) return { json: [], text: 'Every open lead has an owner.' };
    const results = [];
    for (const lead of unassigned) {
      // Territory whose region matches the lead's region word, then the
      // active rep in it holding the fewest open leads. No match: the rep
      // with the fewest open leads anywhere. Nobody is skipped silently.
      const candidates = await db.query(
        `select r.*, (select count(*) from leads l where l.rep_id = r.id and l.status in ('new','working','qualified')) as open_leads
         from reps r left join territories t on t.id = r.territory_id
         where r.active and r.role = 'rep' and ($1 = '' or lower(coalesce(t.region, '')) = lower($1))
         order by open_leads, r.full_name`,
        [str(lead.region)],
      );
      const fallback = candidates.length
        ? null
        : (await db.query(
            `select r.*, (select count(*) from leads l where l.rep_id = r.id and l.status in ('new','working','qualified')) as open_leads
             from reps r where r.active and r.role = 'rep' order by open_leads, r.full_name`,
          ))[0];
      const rep = candidates[0] || fallback;
      if (!rep) throw new CliError('No active reps to route to. add rep "<name>" first.');
      await db.query('update leads set rep_id = $1 where id = $2', [rep.id, lead.id]);
      results.push({ lead: `${lead.full_name}, ${lead.company}`, region: lead.region, rep: rep.full_name, matched: Boolean(candidates.length) });
    }
    return {
      json: results,
      text:
        `Routed ${results.length} lead${results.length === 1 ? '' : 's'}:\n` +
        results.map((r) => `  ${r.lead} (${r.region || 'no region'}) -> ${r.rep}${r.matched ? '' : ' (no territory match; fewest open leads)'}`).join('\n'),
    };
  }
  if (sub === 'assign') {
    const lead = await resolve(db, 'lead', args[1]);
    const rep = await resolve(db, 'rep', args.slice(2).join(' ') || str(flags.rep));
    const [row] = await db.query('update leads set rep_id = $1 where id = $2 returning *', [rep.id, lead.id]);
    return { json: row, text: `${lead.full_name}, ${lead.company} -> ${rep.full_name}.` };
  }
  if (sub === 'disqualify') {
    const lead = await resolve(db, 'lead', args.slice(1).join(' '));
    const reason = str(flags.reason);
    if (!reason) throw new CliError(`Disqualified for what? lead disqualify <lead> --reason="..." (the queue stays honest when the reasons are written down)`);
    const [row] = await db.query(`update leads set status = 'disqualified', disqualified_reason = $1 where id = $2 returning *`, [reason, lead.id]);
    return { json: row, text: `${lead.full_name}, ${lead.company} disqualified: ${reason}.` };
  }
  throw new CliError('lead route | lead assign <lead> <rep> | lead disqualify <lead> --reason=');
}

async function cmdConvert(db, args, flags) {
  const lead = await resolve(db, 'lead', args.join(' '));
  if (lead.status === 'converted') throw new CliError(`${lead.company} was already converted.`);
  if (lead.status === 'disqualified') {
    throw new CliError(`${lead.company} was disqualified (${lead.disqualified_reason || 'no reason recorded'}). Requalify it deliberately first: there is no accidental way back.`);
  }
  let account = await resolve(db, 'account', str(flags.account) || lead.company, { optional: true });
  let createdAccount = false;
  if (!account) {
    const [terr] = await db.query('select * from territories where lower(coalesce(region, \'\')) = lower($1)', [str(lead.region)]);
    [account] = await db.query(
      `insert into accounts (name, account_type, territory_id, rep_id, note) values ($1, 'prospect', $2, $3, $4) returning *`,
      [lead.company, terr?.id || null, lead.rep_id, lead.note || null],
    );
    createdAccount = true;
  }
  const existing = await db.query('select * from contacts where account_id = $1 and lower(full_name) = lower($2)', [account.id, lead.full_name]);
  const contact =
    existing[0] ||
    (
      await db.query(
        `insert into contacts (account_id, full_name, title, email, phone) values ($1, $2, $3, $4, $5) returning *`,
        [account.id, lead.full_name, lead.title || null, lead.email || null, lead.phone || null],
      )
    )[0];
  let opp = null;
  if (flags.opp) {
    const close = parseDate(flags.close, 'close date');
    if (!close) throw new CliError('The new deal needs a close date: --close=YYYY-MM-DD');
    const ref = await nextRef(db);
    [opp] = await db.query(
      `insert into opportunities (ref, account_id, rep_id, name, stage, amount_cents, probability, close_date, source)
       values ($1, $2, $3, $4, 'qualification', $5, 10, $6, $7) returning *`,
      [ref, account.id, lead.rep_id, str(flags.opp), parseMoney(flags.amount), close, lead.source || null],
    );
    await db.query(`insert into stage_history (opportunity_id, from_stage, to_stage, changed_on) values ($1, null, 'qualification', current_date)`, [opp.id]);
  }
  const [row] = await db.query(
    `update leads set status = 'converted', converted_account_id = $1, converted_opportunity_id = $2 where id = $3 returning *`,
    [account.id, opp?.id || null, lead.id],
  );
  let text = `${lead.full_name}, ${lead.company} converted: account ${createdAccount ? 'created' : 'matched'} (${account.name}), contact ${existing[0] ? 'matched' : 'created'}.`;
  if (opp) text += `\n${opp.ref} opened: "${opp.name}"${opp.amount_cents !== null ? `, ${money(opp.amount_cents)}` : ''}, closing ${isoDate(opp.close_date)}.`;
  else text += `\nNo deal opened. When there is one: opp add "${account.name}" --name="..." --close=`;
  return { json: { lead: row, account, contact, opportunity: opp }, text };
}

// ---------------------------------------------------------------------------
// Log, tasks, add, quota, optout

async function cmdLog(db, args, flags) {
  const first = args[0];
  const kind = str(flags.kind) || 'call';
  if (!ACTIVITY_KINDS.includes(kind)) throw new CliError(`--kind= is one of: ${ACTIVITY_KINDS.join(', ')}`);
  let opp = null;
  let account = null;
  let lead = null;
  if (/^(opp-)?\d{3,}$/i.test(str(first))) opp = await resolve(db, 'opportunity', first, { optional: true });
  if (opp) {
    [account] = await db.query('select * from accounts where id = $1', [opp.account_id]);
  } else {
    account = await resolve(db, 'account', first, { optional: true });
    if (!account) lead = await resolve(db, 'lead', first);
  }
  const note = args.slice(1).join(' ');
  if (!note) throw new CliError('What happened? log <account, OPP-ref or lead> "what was said or done" [--kind=call|email|meeting|demo|note --contact=]');
  let contact = null;
  if (flags.contact) {
    contact = await resolve(db, 'contact', flags.contact);
    if (account && contact.account_id !== account.id) throw new CliError(`${contact.full_name} is at ${contact.account_name}, not ${account.name}.`);
  }
  refuseOptedOutEmail(contact, kind);
  const rep = await whoIs(db, flags);
  const [row] = await db.query(
    `insert into activities (kind, account_id, contact_id, opportunity_id, lead_id, rep_id, happened_on, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [kind, account?.id || null, contact?.id || null, opp?.id || null, lead?.id || null, rep?.id || null, parseDate(flags.on) || today(), note],
  );
  if (lead && lead.status === 'new') await db.query(`update leads set status = 'working' where id = $1`, [lead.id]);
  return {
    json: row,
    text: `Logged ${kind} against ${opp ? `${opp.ref} (${account.name})` : account ? account.name : `${lead.full_name}, ${lead.company}${lead.status === 'new' ? ' (now working)' : ''}`}${contact ? `, with ${contact.full_name}` : ''}.`,
  };
}

async function cmdTask(db, args, flags) {
  const sub = args[0];
  if (sub === 'add') {
    const title = args.slice(1).join(' ');
    if (!title) throw new CliError('task add "the thing to do" [--account= --opp= --due= --rep=]');
    const account = flags.account ? await resolve(db, 'account', flags.account) : null;
    const opp = flags.opp ? await resolve(db, 'opportunity', flags.opp) : null;
    const rep = await whoIs(db, flags);
    const [row] = await db.query(
      `insert into tasks (title, account_id, opportunity_id, rep_id, due_on, note) values ($1, $2, $3, $4, $5, $6) returning *`,
      [title, account?.id || opp?.account_id || null, opp?.id || null, rep?.id || null, parseDate(flags.due), str(flags.note) || null],
    );
    return { json: row, text: `Task on the list: "${title}"${row.due_on ? `, due ${isoDate(row.due_on)}` : ''}.` };
  }
  if (sub === 'done') {
    const t = await resolve(db, 'task', args.slice(1).join(' '));
    const [row] = await db.query(`update tasks set status = 'done', done_on = $1 where id = $2 returning *`, [parseDate(flags.on) || today(), t.id]);
    return { json: row, text: `Done: "${t.title}".` };
  }
  throw new CliError('task add "title" [--account= --opp= --due=], or task done <match>');
}

async function cmdAdd(db, args, flags) {
  const kind = args[0];
  const name = args.slice(1).join(' ');
  if (!name) throw new CliError(`add ${kind || 'account|contact|lead|rep|territory'} "<name>" [--flags]`);
  if (kind === 'account') {
    const type = str(flags.type) || 'prospect';
    if (!ACCOUNT_TYPES.includes(type)) throw new CliError(`--type= is one of: ${ACCOUNT_TYPES.join(', ')}`);
    const terr = flags.territory ? await resolve(db, 'territory', flags.territory) : null;
    const rep = flags.rep ? await whoIs(db, flags) : null;
    const [row] = await db.query(
      `insert into accounts (name, account_type, industry, territory_id, rep_id, city, country, website, phone, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [name, type, str(flags.industry) || null, terr?.id || null, rep?.id || null, str(flags.city) || null, str(flags.country) || null, str(flags.website) || null, str(flags.phone) || null, str(flags.note) || null],
    );
    return { json: row, text: `Account on the list: ${name} (${type})${terr ? `, ${terr.name}` : ''}.` };
  }
  if (kind === 'contact') {
    const account = await resolve(db, 'account', str(flags.account));
    const [row] = await db.query(
      `insert into contacts (account_id, full_name, title, buying_role, email, phone, note) values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [account.id, name, str(flags.title) || null, str(flags.role) || null, str(flags.email) || null, str(flags.phone) || null, str(flags.note) || null],
    );
    return { json: row, text: `${name} added at ${account.name}${row.title ? ` (${row.title})` : ''}.` };
  }
  if (kind === 'lead') {
    const [row] = await db.query(
      `insert into leads (full_name, company, title, email, phone, source, region, rep_id, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [
        name,
        str(flags.company) || name,
        str(flags.title) || null,
        str(flags.email) || null,
        str(flags.phone) || null,
        str(flags.source) || null,
        str(flags.region) || null,
        flags.rep ? (await whoIs(db, flags))?.id : null,
        str(flags.note) || null,
      ],
    );
    return { json: row, text: `Lead in the queue: ${name}${row.company !== name ? `, ${row.company}` : ''}${row.rep_id ? '' : '. Unassigned: `lead route` gives it an owner.'}` };
  }
  if (kind === 'rep') {
    const terr = flags.territory ? await resolve(db, 'territory', flags.territory) : null;
    const [row] = await db.query(
      `insert into reps (full_name, code, email, role, territory_id) values ($1, $2, $3, $4, $5) returning *`,
      [name, str(flags.code) || null, str(flags.email) || null, str(flags.role) || 'rep', terr?.id || null],
    );
    return { json: row, text: `${name} on the team (${row.role}${terr ? `, ${terr.name}` : ''}). Set the quota: quota set "${name}" --amount=<dollars>` };
  }
  if (kind === 'territory') {
    const [row] = await db.query(`insert into territories (name, region) values ($1, $2) returning *`, [name, str(flags.region) || null]);
    return { json: row, text: `Territory added: ${name}${row.region ? ` (routes on "${row.region}")` : ''}.` };
  }
  throw new CliError('add account|contact|lead|rep|territory "<name>" [--flags]');
}

async function cmdQuota(db, args, flags) {
  if (args[0] !== 'set') throw new CliError('quota set <rep> --amount=<dollars> [--period=' + currentPeriod() + ']');
  const rep = await resolve(db, 'rep', args.slice(1).join(' '));
  const amount = parseMoney(flags.amount, 'quota');
  if (!amount) throw new CliError('How much? quota set <rep> --amount=450000 means a $450,000 quarter.');
  const period = str(flags.period) || currentPeriod();
  if (!/^\d{4}-Q[1-4]$/.test(period)) throw new CliError('--period= looks like 2026-Q3.');
  const [row] = await db.query(
    `insert into quotas (rep_id, period, quota_cents) values ($1, $2, $3)
     on conflict (rep_id, period) do update set quota_cents = excluded.quota_cents returning *`,
    [rep.id, period, amount],
  );
  return { json: row, text: `${rep.full_name}: ${money(amount)} quota for ${period}.` };
}

async function cmdOptout(db, args, flags) {
  const contact = await resolve(db, 'contact', args.join(' '));
  const [row] = await db.query(`update contacts set opted_out = true, opted_out_on = $1 where id = $2 returning *`, [parseDate(flags.on) || today(), contact.id]);
  return {
    json: row,
    text:
      `${contact.full_name} (${contact.account_name}) is opted out as of ${isoDate(row.opted_out_on)}.\n` +
      'The gate is now closed: no email can be logged against them, and every draft-follow-up skips them\n' +
      '(Spam Act 2003 (Cth) s 18; Unsolicited Electronic Messages Act 2007 (NZ) s 11).',
  };
}

// ---------------------------------------------------------------------------
// Compliance: the rule book, run against the records. docs/compliance.md
// carries each rule's source; this is the executable half.

const RULES = [
  {
    key: 'optout',
    title: 'No email to an opted-out contact, ever',
    source: 'Spam Act 2003 (Cth) s 18 (unsubscribe must be honoured); Unsolicited Electronic Messages Act 2007 (NZ) s 11',
    sql: `select c.full_name || ' (' || a.name || ')' as label,
                 'email logged ' || to_char(x.happened_on, 'YYYY-MM-DD') || ', after the opt-out of ' || to_char(c.opted_out_on, 'YYYY-MM-DD') as detail
          from activities x join contacts c on c.id = x.contact_id join accounts a on a.id = c.account_id
          where x.kind = 'email' and c.opted_out and c.opted_out_on is not null and x.happened_on > c.opted_out_on`,
    fix: 'The CLI refuses to log these; if this rule ever reports a breach, someone went around it. Stop emailing that contact today and record how it happened.',
  },
  {
    key: 'close-dates',
    title: 'No open deal past its close date',
    source: 'The standard this team sets for itself: the forecast is only as honest as its dates',
    sql: `select ref || ' ' || account as label,
                 'close date was ' || to_char(close_date, 'YYYY-MM-DD') || ', ' || abs(days_to_close) || ' days ago, still ' || stage as detail
          from v_pipeline where days_to_close < 0 order by days_to_close`,
    fix: 'Move the date to when it will actually close, or close the deal. A stale date inflates the quarter until it quietly deflates it.',
  },
  {
    key: 'next-steps',
    title: 'Every open deal past qualification has a dated next step',
    source: 'The standard this team sets for itself: a deal with no next step is drifting, whatever the stage says',
    sql: `select ref || ' ' || account as label,
                 stage || ', ' || case when next_step is null then 'no next step recorded' else 'next step has no date' end as detail
          from v_pipeline where stage <> 'qualification' and (next_step is null or next_step_on is null)`,
    fix: 'opp next <ref> --step="..." --on=<date> for each one. The step is what you will do, not what you hope they do.',
  },
  {
    key: 'amounts',
    title: 'No deal past qualification without an amount',
    source: 'The standard this team sets for itself: an unpriced deal cannot be forecast, so it is not really in the pipeline',
    sql: `select ref || ' ' || account as label, stage || ' with no amount' as detail
          from v_pipeline where stage <> 'qualification' and amount_cents is null`,
    fix: 'Price it, even roughly, before it moves again: opp move <ref> <stage> --amount=<dollars>, or ask the customer what budget the project carries.',
  },
  {
    key: 'leads-3-days',
    title: 'Every lead touched inside three days',
    source: 'The standard this team sets for itself: lead response time decides conversion long before product does',
    sql: `select full_name || ', ' || company as label,
                 'arrived ' || to_char(received_on, 'YYYY-MM-DD') || ', ' || days_old || ' days ago, never touched' as detail
          from v_leads where status = 'new' and days_old > 3 order by days_old desc`,
    fix: 'Ring them today and log the call. If nobody owns them, `lead route` first.',
  },
  {
    key: 'retention',
    title: 'No personal data kept at former accounts beyond need',
    source: 'Privacy Act 1988 (Cth) APP 11.2 (destroy or de-identify when no longer needed); Privacy Act 2020 (NZ) IPP 9',
    sql: `select c.full_name || ' (' || a.name || ')' as label,
                 'contact at a former account, no activity for ' || coalesce((current_date - (select max(x.happened_on) from activities x where x.contact_id = c.id))::text, 'ever, and none') || ' days' as detail
          from contacts c join accounts a on a.id = c.account_id
          where a.account_type = 'former'
            and coalesce((select max(x.happened_on) from activities x where x.contact_id = c.id), a.updated_at::date) < current_date - 730`,
    fix: 'Decide per contact: a real reason to keep them (write it in the note), or delete the row. Keeping everything forever is a liability, not an asset.',
  },
  {
    key: 'reachable',
    title: 'Every contact at an account with an open deal is reachable',
    source: 'The standard this team sets for itself, leaning on APP 10 (keep personal information accurate, complete and up to date)',
    sql: `select c.full_name || ' (' || a.name || ')' as label, 'no email and no phone on a live deal' as detail
          from contacts c join accounts a on a.id = c.account_id
          where c.email is null and c.phone is null
            and exists (select 1 from opportunities o where o.account_id = a.id and o.stage not in ('closed_won','closed_lost'))`,
    fix: 'Get a number or an address on the record next time you are on site. Deals stall on people you cannot reach.',
  },
];

async function cmdCompliance(db, args) {
  const only = args[0];
  const rules = only ? RULES.filter((r) => r.key === only) : RULES;
  if (!rules.length) throw new CliError(`No rule "${only}". Rules: ${RULES.map((r) => r.key).join(', ')}`);
  const results = [];
  for (const rule of rules) {
    const breaches = await db.query(rule.sql);
    results.push({ key: rule.key, title: rule.title, source: rule.source, fix: rule.fix, breaches });
  }
  let text = heading('The rule book, run against the records');
  for (const r of results) {
    text += `\n\n${r.breaches.length ? 'FAIL' : ' ok '} ${r.key}: ${r.title}`;
    text += `\n      ${r.source}`;
    for (const b of r.breaches) text += `\n      - ${b.label}: ${b.detail}`;
    if (r.breaches.length) text += `\n      fix: ${r.fix}`;
  }
  const failed = results.filter((r) => r.breaches.length).length;
  text += `\n\n${results.length - failed} of ${results.length} rules pass. Sources and the fuller reading: docs/compliance.md. None of this is legal advice.`;
  return { json: results, text };
}

// ---------------------------------------------------------------------------
// Import and export

function mapSfAccountType(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('customer') || s.includes('client')) return 'customer';
  if (s.includes('partner') || s.includes('reseller')) return 'partner';
  if (s.includes('former') || s.includes('inactive')) return 'former';
  return 'prospect';
}

function mapSfStage(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('closed won') || s === 'won') return 'closed_won';
  if (s.includes('closed lost') || s === 'lost') return 'closed_lost';
  if (s.includes('negotiat') || s.includes('review') || s.includes('contract')) return 'negotiation';
  if (s.includes('proposal') || s.includes('quote') || s.includes('value proposition')) return 'proposal';
  if (s.includes('discovery') || s.includes('needs') || s.includes('analysis') || s.includes('decision makers')) return 'discovery';
  return 'qualification';
}

function mapSfLeadStatus(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.includes('convert')) return 'converted';
  if (s.includes('unqualified') || s.includes('disqualified') || s.includes('closed')) return 'disqualified';
  if (s.includes('qualified')) return 'qualified';
  if (s.includes('working') || s.includes('contacted') || s.includes('nurtur')) return 'working';
  return 'new';
}

function sfName(row) {
  const full = pick(row, 'Name', 'Full Name', 'Contact Name', 'Lead Name');
  if (full) return full;
  const first = pick(row, 'FirstName', 'First Name') || '';
  const last = pick(row, 'LastName', 'Last Name') || '';
  return `${first} ${last}`.trim();
}

async function cmdImport(db, args, flags) {
  const source = args[0];
  if (!['salesforce', 'csv'].includes(source || '')) {
    throw new CliError('import salesforce|csv --accounts=Account.csv [--contacts=Contact.csv --opportunities=Opportunity.csv --leads=Lead.csv] [--dry-run]');
  }
  const dryRun = Boolean(flags['dry-run']);
  const readCsvFile = (flag) => {
    const file = str(flags[flag]);
    if (!file) return null;
    if (!existsSync(file)) throw new CliError(`No ${flag} file at ${file}.`);
    return parseCsv(readFileSync(file, 'utf8'));
  };
  const acctRows = readCsvFile('accounts');
  const contactRows = readCsvFile('contacts');
  const oppRows = readCsvFile('opportunities');
  const leadRows = readCsvFile('leads');
  if (!acctRows && !contactRows && !oppRows && !leadRows) {
    throw new CliError('Nothing to import. Point at least one file: --accounts= --contacts= --opportunities= --leads=');
  }

  const counts = {
    accounts: 0, accounts_updated: 0, contacts: 0, contacts_updated: 0,
    opportunities: 0, opportunities_updated: 0, leads: 0, leads_updated: 0,
    skipped: 0, opt_outs: 0,
  };
  const skips = [];
  // Records created earlier in this same run. On a dry run nothing is written,
  // so later rows resolve against these maps and the counts match the real run.
  const pendingAccounts = new Map(); // key: lower name and lower Id

  const findAccount = async (name, ref) => {
    if (ref) {
      const byRef = await db.query("select * from accounts where lower(coalesce(external_ref, '')) = lower($1)", [ref]);
      if (byRef.length === 1) return byRef[0];
      const pendingByRef = pendingAccounts.get(String(ref).toLowerCase());
      if (pendingByRef) return pendingByRef;
    }
    if (!name) return null;
    const rows = await db.query('select * from accounts where lower(name) = lower($1)', [name]);
    if (rows.length === 1) return rows[0];
    return pendingAccounts.get(String(name).toLowerCase()) || null;
  };

  const repByOwner = async (row) => {
    const owner = pick(row, 'Owner', 'Owner Name', 'Opportunity Owner', 'Account Owner');
    if (!owner) return null;
    return resolve(db, 'rep', owner, { optional: true });
  };

  if (acctRows) {
    for (const row of acctRows) {
      const name = pick(row, 'Name', 'Account Name');
      if (!name) {
        counts.skipped++;
        skips.push('account row with no Name column value');
        continue;
      }
      const ref = pick(row, 'Id', 'Account ID', 'ACCOUNT_ID') || null;
      const existing = await findAccount(name, ref);
      const rep = await repByOwner(row);
      const values = [
        mapSfAccountType(pick(row, 'Type', 'Account Type')),
        pick(row, 'Industry') || null,
        pick(row, 'BillingCity', 'Billing City', 'City') || null,
        pick(row, 'BillingCountry', 'Billing Country', 'Country') || null,
        pick(row, 'Website') || null,
        pick(row, 'Phone') || null,
      ];
      if (existing) {
        counts.accounts_updated++;
        if (!dryRun) {
          await db.query(
            `update accounts set account_type = $1, industry = coalesce($2, industry), city = coalesce($3, city),
               country = coalesce($4, country), website = coalesce($5, website), phone = coalesce($6, phone),
               rep_id = coalesce($7, rep_id), external_ref = coalesce($8, external_ref) where id = $9`,
            [...values, rep?.id || null, ref, existing.id],
          );
        }
      } else {
        counts.accounts++;
        if (dryRun) {
          const stub = { id: null, name, __pending: true };
          pendingAccounts.set(name.toLowerCase(), stub);
          if (ref) pendingAccounts.set(String(ref).toLowerCase(), stub);
        } else {
          const [created] = await db.query(
            `insert into accounts (name, account_type, industry, city, country, website, phone, rep_id, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
            [name, ...values, rep?.id || null, ref],
          );
          pendingAccounts.set(name.toLowerCase(), created);
          if (ref) pendingAccounts.set(String(ref).toLowerCase(), created);
        }
      }
    }
  }

  if (contactRows) {
    for (const row of contactRows) {
      const name = sfName(row);
      if (!name) {
        counts.skipped++;
        skips.push('contact row with no name column value');
        continue;
      }
      const account = await findAccount(pick(row, 'Account Name', 'Account'), pick(row, 'AccountId', 'Account ID'));
      if (!account) {
        counts.skipped++;
        skips.push(`contact "${name}" matches no account on file (AccountId ${pick(row, 'AccountId', 'Account ID') || 'missing'})`);
        continue;
      }
      const optedOut = yesNo(pick(row, 'HasOptedOutOfEmail', 'Email Opt Out'), false);
      if (optedOut) counts.opt_outs++;
      const ref = pick(row, 'Id', 'Contact ID') || null;
      const existing = ref
        ? await db.query("select * from contacts where lower(coalesce(external_ref, '')) = lower($1)", [ref])
        : account.id
          ? await db.query('select * from contacts where account_id = $1 and lower(full_name) = lower($2)', [account.id, name])
          : [];
      const values = [
        pick(row, 'Title') || null,
        pick(row, 'Email') || null,
        pick(row, 'Phone', 'MobilePhone', 'Mobile') || null,
      ];
      if (existing.length) {
        counts.contacts_updated++;
        if (!dryRun) {
          await db.query(
            `update contacts set title = coalesce($1, title), email = coalesce($2, email), phone = coalesce($3, phone),
               opted_out = (opted_out or $4), opted_out_on = case when $4 and opted_out_on is null then current_date else opted_out_on end
             where id = $5`,
            [...values, optedOut, existing[0].id],
          );
        }
      } else {
        counts.contacts++;
        if (!dryRun && account.id) {
          await db.query(
            `insert into contacts (account_id, full_name, title, email, phone, opted_out, opted_out_on, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [account.id, name, ...values, optedOut, optedOut ? today() : null, ref],
          );
        }
      }
    }
  }

  if (oppRows) {
    for (const row of oppRows) {
      const name = pick(row, 'Name', 'Opportunity Name');
      if (!name) {
        counts.skipped++;
        skips.push('opportunity row with no Name column value');
        continue;
      }
      const account = await findAccount(pick(row, 'Account Name', 'Account'), pick(row, 'AccountId', 'Account ID'));
      if (!account) {
        counts.skipped++;
        skips.push(`opportunity "${truncate(name, 40)}" matches no account on file`);
        continue;
      }
      const stage = mapSfStage(pick(row, 'StageName', 'Stage'));
      const amountRaw = pick(row, 'Amount');
      const amount = amountRaw ? parseMoney(amountRaw) : null;
      const closeRaw = pick(row, 'CloseDate', 'Close Date');
      const close = closeRaw ? parseDate(closeRaw) : today();
      const probRaw = pick(row, 'Probability', 'Probability (%)');
      const probability = probRaw !== undefined && probRaw !== null && String(probRaw).trim() !== ''
        ? Math.max(0, Math.min(100, Math.round(Number(String(probRaw).replace('%', '')))))
        : STAGE_PROB[stage];
      const ref = pick(row, 'Id', 'Opportunity ID') || null;
      const rep = await repByOwner(row);
      const existing = ref ? await db.query("select * from opportunities where lower(coalesce(external_ref, '')) = lower($1)", [ref]) : [];
      if (existing.length) {
        counts.opportunities_updated++;
        if (!dryRun) {
          await db.query(
            `update opportunities set stage = $1, amount_cents = coalesce($2, amount_cents), probability = $3, close_date = $4,
               won_on = case when $1 = 'closed_won' then coalesce(won_on, $4) else won_on end,
               lost_on = case when $1 = 'closed_lost' then coalesce(lost_on, $4) else lost_on end
             where id = $5`,
            [stage, amount, probability, close, existing[0].id],
          );
        }
      } else {
        counts.opportunities++;
        if (!dryRun && account.id) {
          const oppRef = await nextRef(db);
          await db.query(
            `insert into opportunities (ref, account_id, rep_id, name, stage, amount_cents, probability, opened_on, close_date, won_on, lost_on, lost_reason, source, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              oppRef,
              account.id,
              rep?.id || account.rep_id || null,
              name,
              stage,
              amount,
              probability,
              pick(row, 'CreatedDate', 'Created Date') ? parseDate(pick(row, 'CreatedDate', 'Created Date')) : close,
              close,
              stage === 'closed_won' ? close : null,
              stage === 'closed_lost' ? close : null,
              stage === 'closed_lost' ? pick(row, 'Loss Reason', 'Closed Lost Reason') || 'imported as closed lost, no reason in the export' : null,
              pick(row, 'LeadSource', 'Lead Source') || null,
              ref,
            ],
          );
        }
      }
    }
  }

  if (leadRows) {
    for (const row of leadRows) {
      const name = sfName(row);
      const company = pick(row, 'Company');
      if (!name || !company) {
        counts.skipped++;
        skips.push(`lead row missing ${!name ? 'a name' : 'a Company'} column value`);
        continue;
      }
      const status = mapSfLeadStatus(pick(row, 'Status'));
      const converted = yesNo(pick(row, 'IsConverted', 'Converted'), false);
      const ref = pick(row, 'Id', 'Lead ID') || null;
      const existing = ref ? await db.query("select * from leads where lower(coalesce(external_ref, '')) = lower($1)", [ref]) : [];
      if (existing.length) {
        counts.leads_updated++;
        if (!dryRun) {
          await db.query(`update leads set status = $1, email = coalesce($2, email), phone = coalesce($3, phone) where id = $4`, [
            converted ? 'converted' : status,
            pick(row, 'Email') || null,
            pick(row, 'Phone', 'MobilePhone') || null,
            existing[0].id,
          ]);
        }
      } else {
        counts.leads++;
        if (!dryRun) {
          await db.query(
            `insert into leads (full_name, company, title, email, phone, source, region, status, received_on, external_ref)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              name,
              company,
              pick(row, 'Title') || null,
              pick(row, 'Email') || null,
              pick(row, 'Phone', 'MobilePhone') || null,
              pick(row, 'LeadSource', 'Lead Source') || null,
              pick(row, 'State', 'State/Province', 'Country') || null,
              converted ? 'converted' : status,
              pick(row, 'CreatedDate', 'Created Date') ? parseDate(pick(row, 'CreatedDate', 'Created Date')) : today(),
              ref,
            ],
          );
        }
      }
    }
  }

  const json = { ...counts, dry_run: dryRun, skips };
  let text = `${dryRun ? 'DRY RUN, nothing written. Would import' : 'Imported'}: ` +
    `${counts.accounts} accounts (${counts.accounts_updated} updated), ${counts.contacts} contacts (${counts.contacts_updated} updated), ` +
    `${counts.opportunities} opportunities (${counts.opportunities_updated} updated), ${counts.leads} leads (${counts.leads_updated} updated).`;
  if (counts.opt_outs) {
    text += `\n${counts.opt_outs} email opt-out${counts.opt_outs === 1 ? '' : 's'} carried across and enforced from day one: the CLI will refuse to log an email to them.`;
  }
  if (skips.length) text += `\nSkipped ${counts.skipped}:\n` + skips.map((x) => `  - ${x}`).join('\n');
  text += dryRun ? '\nRun again without --dry-run to write it.' : '\nCheck it: stats, accounts, pipeline, leads. Then `lead route` and set quotas.';
  return { json, text };
}

async function cmdExport(db, args, flags) {
  const tables = ['territories', 'reps', 'quotas', 'accounts', 'contacts', 'leads', 'opportunities', 'stage_history', 'activities', 'tasks'];
  const out = {};
  for (const t of tables) out[t] = await db.query(`select * from ${t} order by created_at`);
  const counts = Object.fromEntries(tables.map((t) => [t, out[t].length]));
  const file = str(flags.out) || path.join(REPO_ROOT, 'exports', `crm-export-${today()}.json`);
  const dir = path.dirname(file);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(out, null, 2));
  return {
    json: { file, counts },
    text: `Exported the whole database to ${file}.\n  ` + Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join(', ') +
      '\nPlain JSON of plain tables. There is no export request form, because there is nothing to leave.',
  };
}

// ---------------------------------------------------------------------------
// Help and dispatch

const HELP = `
Enterprise CRM for Claude Code: the CLI behind the slash commands.

  node scripts/crm.mjs <command> [args] [--flags]     (or: npm run crm -- <command>)

Reads:
  pipeline [--rep= --stage= --account=]   every open deal: amount, weighted, close, next step
  forecast                 the quarter per rep: quota, closed, weighted, gap, coverage
  funnel                   deals and value by stage, with average days in stage
  attention                everything that wants a decision, worst first
  scorecard                per rep: pipeline, win rate 90d, cycle days, activity, overdue steps
  opp <ref>                one deal: the numbers, the stage history, every touch
  account <name>           one account: contacts, deals, activity, tasks
  accounts [--type= --rep=]   leads [--all --unassigned]   team   territories   tasks [--all]   stats
  compliance [rule]        the rule book run against the records

The deal verbs:
  opp add <account> --name= --close= [--amount= --stage= --next= --next-on=]
  opp move <ref> <stage> [--amount= --note=]        stage history written, probability defaulted
  opp next <ref> --step="..." --on=<date>           the one field that keeps a pipeline honest
  opp won <ref> [--amount= --on=]                   refuses a won deal with no amount
  opp lost <ref> --reason="..."                     refuses a lost deal with no reason

Leads:
  add lead "<name>" --company= [--email= --source= --region=]
  lead route               assigns every unassigned lead by territory, fewest-open first
  lead assign <lead> <rep> | lead disqualify <lead> --reason=
  convert <lead> [--opp="deal name" --amount= --close=]   account + contact + deal in one move

Everything else:
  log <account, ref or lead> "what happened" [--kind=call|email|meeting|demo|note --contact= --on=]
  task add "title" [--account= --opp= --due=]   task done <match>
  add account|contact|rep|territory "<name>" [--flags]
  quota set <rep> --amount=<dollars> [--period=${currentPeriod()}]
  optout <contact> [--on=]                          closes the email gate for good
  import salesforce --accounts=Account.csv [--contacts= --opportunities= --leads=] [--dry-run]
  export [--out=file.json]

Money in dollars: --amount=184000 means $184,000. Any command takes --json. Names and refs match
case-insensitively ("1001" finds OPP-1001); an ambiguous one lists the candidates rather than guessing.
An email cannot be logged against an opted-out contact (Spam Act 2003 (Cth) s 18; UEMA 2007 (NZ) s 11).
Nothing sends from here: follow-ups draft to drafts/, a person sends.
`;

const COMMANDS = {
  team: cmdTeam,
  territories: cmdTerritories,
  accounts: cmdAccounts,
  account: cmdAccount,
  pipeline: cmdPipeline,
  opp: async (db, args, flags) =>
    ['add', 'move', 'next', 'won', 'lost'].includes(args[0]) ? cmdOppCmd(db, args, flags) : cmdOpp(db, args, flags),
  funnel: cmdFunnel,
  forecast: cmdForecast,
  scorecard: cmdScorecard,
  leads: cmdLeads,
  lead: cmdLead,
  convert: cmdConvert,
  attention: cmdAttention,
  log: cmdLog,
  task: cmdTask,
  tasks: cmdTasks,
  add: cmdAdd,
  quota: cmdQuota,
  optout: cmdOptout,
  compliance: cmdCompliance,
  stats: cmdStats,
  import: cmdImport,
  export: cmdExport,
};

async function main() {
  const { args, flags } = parseArgv(process.argv.slice(2));
  const [command, ...rest] = args;
  if (!command || command === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const fn = COMMANDS[command];
  if (!fn) {
    process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
    return 1;
  }
  const db = await getDb();
  try {
    const result = await fn(db, rest, flags);
    if (flags.json) process.stdout.write(JSON.stringify(result.json, null, 2) + '\n');
    else process.stdout.write(result.text.replace(/^\n/, '') + '\n');
    return 0;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n`);
      return e.code;
    }
    if (/relation "?\w+"? does not exist/.test(e.message)) {
      process.stderr.write('The database has no tables yet. Run: npm run migrate\n');
      return 1;
    }
    throw e;
  } finally {
    await db.close();
  }
}

process.exitCode = await main();
