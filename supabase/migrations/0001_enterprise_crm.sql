-- enterprise-crm-for-claude-code: core schema.
-- A B2B sales team's CRM the way Salesforce sells it: territories, reps and
-- quotas, accounts and contacts, leads with routing, opportunities with
-- stages, probabilities and close dates, the activity record under every
-- deal, and the forecast. The objects keep Salesforce's names deliberately,
-- so a team walking across does not have to learn a new vocabulary for the
-- same work.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
--
-- Money is stored in cents. Probability is a whole number 0-100, defaulted by
-- stage and overridable per deal, and the weighted pipeline is amount times
-- probability: the arithmetic Salesforce sells back as "forecasting".
--
-- Marketing consent is enforced, not decorated: contacts carry opted_out, and
-- the CLI refuses to log an email against an opted-out contact (Spam Act 2003
-- (Cth) s 18; Unsolicited Electronic Messages Act 2007 (NZ) s 11). Nothing in
-- this system sends anything: drafts go to drafts/, a person sends.

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Territories -----------------------------------------------------------------
-- Where the market is carved up. region is the routing word a lead arrives
-- with (a state, a country), and `lead route` matches on it.

create table if not exists territories (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  region        text,                                  -- 'VIC', 'NSW', 'QLD', 'NZ'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists territories_name_lower_idx on territories (lower(name));

-- Reps ------------------------------------------------------------------------
-- The sales team. Salesforce charges one of its most expensive seats for each
-- of these people; here they are rows.

create table if not exists reps (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null,
  code          text,
  email         text,
  role          text not null default 'rep',           -- manager | rep
  territory_id  uuid references territories(id) on delete set null,
  active        boolean not null default true,
  started_on    date,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists reps_name_lower_idx on reps (lower(full_name));

-- Quotas ----------------------------------------------------------------------
-- One row per rep per quarter. period matches to_char(date, 'YYYY-"Q"Q'),
-- e.g. '2026-Q3'. The forecast view reads the current quarter's row.

create table if not exists quotas (
  id            uuid primary key default gen_random_uuid(),
  rep_id        uuid not null references reps(id) on delete cascade,
  period        text not null,                          -- '2026-Q3'
  quota_cents   bigint not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (rep_id, period)
);

-- Accounts ----------------------------------------------------------------------
-- One account is one business you sell to. account_type is the relationship:
-- prospect (never bought), customer, partner, former.

create table if not exists accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  account_type  text not null default 'prospect',       -- prospect | customer | partner | former
  industry      text,
  territory_id  uuid references territories(id) on delete set null,
  rep_id        uuid references reps(id) on delete set null,
  city          text,
  country       text,
  website       text,
  phone         text,
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists accounts_name_lower_idx on accounts (lower(name));
create index if not exists accounts_rep_idx on accounts (rep_id);

-- Contacts ----------------------------------------------------------------------
-- The people at the accounts. buying_role is how the deal reads them
-- (champion, decision maker, user, gatekeeper), and the single-thread check
-- counts distinct contacts under each big deal. opted_out is law, not
-- preference: once true, the CLI refuses to log an email to them.

create table if not exists contacts (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references accounts(id) on delete cascade,
  full_name     text not null,
  title         text,
  buying_role   text,                                    -- champion | decision_maker | user | gatekeeper
  email         text,
  phone         text,
  opted_out     boolean not null default false,
  opted_out_on  date,
  note          text,
  external_ref  text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists contacts_account_idx on contacts (account_id);
create index if not exists contacts_name_idx on contacts (lower(full_name));

-- Leads ---------------------------------------------------------------------------
-- Raw demand: someone from a company you may never have heard of. Leads route
-- to a territory's rep, get worked, and either convert (into an account, a
-- contact and usually an opportunity) or get disqualified with a reason.

create table if not exists leads (
  id                       uuid primary key default gen_random_uuid(),
  full_name                text not null,
  company                  text not null,
  title                    text,
  email                    text,
  phone                    text,
  source                   text,                          -- website | referral | event | outbound | partner
  region                   text,                          -- routing word: 'VIC', 'NZ' ...
  status                   text not null default 'new',   -- new | working | qualified | converted | disqualified
  rep_id                   uuid references reps(id) on delete set null,
  received_on              date not null default current_date,
  converted_account_id     uuid references accounts(id) on delete set null,
  converted_opportunity_id uuid,
  disqualified_reason      text,
  note                     text,
  external_ref             text unique,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (status);

-- Opportunities -------------------------------------------------------------------
-- The deals. Stage carries a default probability (qualification 10, discovery
-- 25, proposal 50, negotiation 75), overridable per deal. close_date is a
-- commitment, not a wish: the attention list and /compliance both hold it to
-- account. next_step / next_step_on is the one field that keeps a pipeline
-- honest: an open deal with no dated next step is a deal drifting.

create table if not exists opportunities (
  id                uuid primary key default gen_random_uuid(),
  ref               text unique,
  account_id        uuid not null references accounts(id) on delete cascade,
  rep_id            uuid references reps(id) on delete set null,
  name              text not null,
  stage             text not null default 'qualification',  -- qualification | discovery | proposal | negotiation | closed_won | closed_lost
  amount_cents      bigint,
  probability       int not null default 10 check (probability between 0 and 100),
  opened_on         date not null default current_date,
  close_date        date not null,
  next_step         text,
  next_step_on      date,
  source            text,
  stage_entered_on  date not null default current_date,
  won_on            date,
  lost_on           date,
  lost_reason       text,
  note              text,
  external_ref      text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists opps_account_idx on opportunities (account_id);
create index if not exists opps_stage_idx on opportunities (stage);
create index if not exists opps_rep_idx on opportunities (rep_id);

-- Stage history -----------------------------------------------------------------
-- Every stage move, with how long the deal sat in the stage it left. This is
-- the raw material for cycle analysis, and the table Salesforce keeps behind
-- its reporting tiers.

create table if not exists stage_history (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  from_stage      text,
  to_stage        text not null,
  changed_on      date not null default current_date,
  days_in_stage   int,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists stage_history_opp_idx on stage_history (opportunity_id);

-- Activities --------------------------------------------------------------------
-- The record of the selling: calls, emails, meetings, demos, notes, against an
-- account and optionally a contact, an opportunity or a lead. Stalled deals,
-- quiet customers and single-threaded deals are all read from here.

create table if not exists activities (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'call',          -- call | email | meeting | demo | note
  account_id      uuid references accounts(id) on delete cascade,
  contact_id      uuid references contacts(id) on delete set null,
  opportunity_id  uuid references opportunities(id) on delete set null,
  lead_id         uuid references leads(id) on delete set null,
  rep_id          uuid references reps(id) on delete set null,
  happened_on     date not null default current_date,
  note            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists activities_account_idx on activities (account_id);
create index if not exists activities_opp_idx on activities (opportunity_id);

-- Tasks --------------------------------------------------------------------------

create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  account_id      uuid references accounts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  rep_id          uuid references reps(id) on delete set null,
  due_on          date,
  status          text not null default 'open',          -- open | done
  done_on         date,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- updated_at triggers -------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['territories','reps','quotas','accounts','contacts','leads','opportunities','tasks']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =============================================================================
-- Views: the questions a sales manager asks every Monday, as SQL.
-- =============================================================================

-- The open pipeline, one row per live deal, with everything that judges it.
create or replace view v_pipeline as
select
  o.id as opportunity_id,
  o.ref,
  a.name as account,
  a.id as account_id,
  a.account_type,
  coalesce(r.full_name, 'unassigned') as rep,
  o.name as opportunity,
  o.stage,
  o.amount_cents,
  o.probability,
  (o.amount_cents * o.probability / 100)::bigint as weighted_cents,
  o.close_date,
  (o.close_date - current_date) as days_to_close,
  o.opened_on,
  (current_date - o.opened_on) as age_days,
  o.stage_entered_on,
  (current_date - o.stage_entered_on) as days_in_stage,
  o.next_step,
  o.next_step_on,
  (select max(x.happened_on) from activities x where x.opportunity_id = o.id) as last_activity_on,
  (current_date - coalesce((select max(x.happened_on) from activities x where x.opportunity_id = o.id), o.opened_on)) as days_since_touch,
  (select count(distinct x.contact_id) from activities x where x.opportunity_id = o.id and x.contact_id is not null) as contacts_engaged,
  o.source,
  o.note
from opportunities o
join accounts a on a.id = o.account_id
left join reps r on r.id = o.rep_id
where o.stage not in ('closed_won', 'closed_lost');

-- The funnel: each open stage, plus the closed columns, as one table.
create or replace view v_funnel as
select
  s.stage,
  s.ord,
  count(o.id) as deals,
  coalesce(sum(o.amount_cents), 0)::bigint as value_cents,
  coalesce(sum(o.amount_cents * o.probability / 100), 0)::bigint as weighted_cents,
  round(avg(current_date - o.stage_entered_on) filter (where o.stage not in ('closed_won','closed_lost')), 1) as avg_days_in_stage
from (values ('qualification', 1), ('discovery', 2), ('proposal', 3), ('negotiation', 4), ('closed_won', 5), ('closed_lost', 6)) as s(stage, ord)
left join opportunities o on o.stage = s.stage
group by s.stage, s.ord;

-- The forecast: one row per active rep, the current quarter. Closed-won plus
-- the weighted pipeline committed to close this quarter, against quota. The
-- report the incumbent gates behind its top editions is four columns of
-- arithmetic here.
create or replace view v_forecast as
select
  r.id as rep_id,
  r.full_name as rep,
  to_char(current_date, 'YYYY-"Q"Q') as period,
  q.quota_cents,
  coalesce((select sum(o.amount_cents) from opportunities o
            where o.rep_id = r.id and o.stage = 'closed_won'
              and o.won_on >= date_trunc('quarter', current_date)
              and o.won_on < date_trunc('quarter', current_date) + interval '3 months'), 0)::bigint as closed_won_cents,
  coalesce((select sum(o.amount_cents * o.probability / 100) from opportunities o
            where o.rep_id = r.id and o.stage not in ('closed_won','closed_lost')
              and o.close_date >= date_trunc('quarter', current_date)::date
              and o.close_date < (date_trunc('quarter', current_date) + interval '3 months')::date), 0)::bigint as weighted_quarter_cents,
  coalesce((select sum(o.amount_cents) from opportunities o
            where o.rep_id = r.id and o.stage not in ('closed_won','closed_lost')
              and o.close_date >= date_trunc('quarter', current_date)::date
              and o.close_date < (date_trunc('quarter', current_date) + interval '3 months')::date), 0)::bigint as best_case_quarter_cents,
  coalesce((select sum(o.amount_cents) from opportunities o
            where o.rep_id = r.id and o.stage not in ('closed_won','closed_lost')), 0)::bigint as open_pipeline_cents,
  ((date_trunc('quarter', current_date) + interval '3 months')::date - current_date) as days_left_in_quarter
from reps r
join quotas q on q.rep_id = r.id and q.period = to_char(current_date, 'YYYY-"Q"Q')
where r.active;

-- The lead queue: everything not yet converted or disqualified, oldest first.
create or replace view v_leads as
select
  l.id as lead_id,
  l.full_name,
  l.company,
  l.title,
  l.email,
  l.phone,
  l.source,
  l.region,
  l.status,
  coalesce(r.full_name, 'UNASSIGNED') as rep,
  l.rep_id,
  l.received_on,
  (current_date - l.received_on) as days_old,
  (select max(x.happened_on) from activities x where x.lead_id = l.id) as last_touch_on,
  l.note
from leads l
left join reps r on r.id = l.rep_id
where l.status in ('new', 'working', 'qualified');

-- One account, one line: the whole relationship.
create or replace view v_account_position as
select
  a.id as account_id,
  a.name as account,
  a.account_type,
  a.industry,
  coalesce(t.name, '') as territory,
  coalesce(r.full_name, 'unassigned') as rep,
  (select count(*) from contacts c where c.account_id = a.id) as contacts,
  (select count(*) from opportunities o where o.account_id = a.id and o.stage not in ('closed_won','closed_lost')) as open_opps,
  coalesce((select sum(o.amount_cents) from opportunities o where o.account_id = a.id and o.stage not in ('closed_won','closed_lost')), 0)::bigint as open_cents,
  coalesce((select sum(o.amount_cents) from opportunities o where o.account_id = a.id and o.stage = 'closed_won'), 0)::bigint as lifetime_won_cents,
  (select max(x.happened_on) from activities x where x.account_id = a.id) as last_activity_on,
  (current_date - (select max(x.happened_on) from activities x where x.account_id = a.id)) as days_quiet,
  (select count(*) from tasks k where k.account_id = a.id and k.status = 'open') as open_tasks
from accounts a
left join territories t on t.id = a.territory_id
left join reps r on r.id = a.rep_id;

-- The rep scorecard: the numbers a sales manager actually manages by.
create or replace view v_scorecard as
select
  r.full_name as rep,
  r.id as rep_id,
  (select count(*) from opportunities o where o.rep_id = r.id and o.stage not in ('closed_won','closed_lost')) as open_deals,
  coalesce((select sum(o.amount_cents) from opportunities o where o.rep_id = r.id and o.stage not in ('closed_won','closed_lost')), 0)::bigint as open_cents,
  coalesce((select sum(o.amount_cents * o.probability / 100) from opportunities o where o.rep_id = r.id and o.stage not in ('closed_won','closed_lost')), 0)::bigint as weighted_cents,
  (select count(*) from opportunities o where o.rep_id = r.id and o.stage = 'closed_won' and o.won_on >= current_date - 90) as won_90d,
  coalesce((select sum(o.amount_cents) from opportunities o where o.rep_id = r.id and o.stage = 'closed_won' and o.won_on >= current_date - 90), 0)::bigint as won_90d_cents,
  (select count(*) from opportunities o where o.rep_id = r.id and o.stage = 'closed_lost' and o.lost_on >= current_date - 90) as lost_90d,
  round(avg(o2.won_on - o2.opened_on), 0) as avg_cycle_days,
  (select count(*) from activities x where x.rep_id = r.id and x.happened_on >= current_date - 14) as activities_14d,
  (select count(*) from opportunities o where o.rep_id = r.id and o.stage not in ('closed_won','closed_lost') and o.next_step_on < current_date) as next_steps_overdue
from reps r
left join opportunities o2 on o2.rep_id = r.id and o2.stage = 'closed_won' and o2.won_on >= current_date - 365
where r.active
group by r.id, r.full_name;

-- Everything that wants a decision, one union, worst first. Each reason is a
-- way deals die or forecasts lie.
create or replace view v_attention as
-- The close date has passed and the deal is still open. The forecast is wrong
-- until somebody moves it or closes it.
select 'close_missed' as reason, p.ref as label, p.account, p.rep,
       abs(p.days_to_close) as days, p.amount_cents,
       'close date was ' || to_char(p.close_date, 'YYYY-MM-DD') || ' and ' || p.opportunity || ' is still open at ' || p.stage as detail
from v_pipeline p
where p.days_to_close < 0
union all
-- Closing inside fourteen days with no dated next step.
select 'closing_no_next_step', p.ref, p.account, p.rep,
       p.days_to_close, p.amount_cents,
       p.opportunity || ' closes ' || to_char(p.close_date, 'YYYY-MM-DD') || ' and has no dated next step'
from v_pipeline p
where p.days_to_close between 0 and 14 and p.next_step_on is null
union all
-- The next step's date has passed.
select 'next_step_overdue', p.ref, p.account, p.rep,
       (current_date - p.next_step_on), p.amount_cents,
       '"' || p.next_step || '" was due ' || to_char(p.next_step_on, 'YYYY-MM-DD')
from v_pipeline p
where p.next_step_on < current_date
union all
-- No activity on an open deal for three weeks.
select 'deal_stalled', p.ref, p.account, p.rep,
       p.days_since_touch, p.amount_cents,
       p.opportunity || ' (' || p.stage || ') has had no activity for ' || p.days_since_touch || ' days'
from v_pipeline p
where p.days_since_touch > 21
union all
-- A six-figure deal running through one person's relationship.
select 'single_threaded', p.ref, p.account, p.rep,
       p.days_to_close, p.amount_cents,
       p.opportunity || ' is a ' || to_char(p.amount_cents / 100.0, 'FM$999,999,990') || ' deal engaged with ' ||
       case p.contacts_engaged when 0 then 'no logged contacts' when 1 then 'only one contact' else p.contacts_engaged || ' contacts' end
from v_pipeline p
where p.amount_cents >= 10000000 and p.contacts_engaged < 2
union all
-- A lead nobody has touched in three days.
select 'lead_unworked', l.company, l.company, l.rep,
       l.days_old, null::bigint,
       l.full_name || ' (' || coalesce(l.source, 'unknown source') || ') arrived ' || to_char(l.received_on, 'YYYY-MM-DD') || ' and has never been touched'
from v_leads l
where l.status = 'new' and l.days_old > 3
union all
-- A rep whose quarter is going quiet: closed plus weighted under 60% of quota.
select 'quota_gap', f.rep, f.rep, f.rep,
       f.days_left_in_quarter, (f.quota_cents - f.closed_won_cents - f.weighted_quarter_cents),
       to_char(f.closed_won_cents / 100.0, 'FM$999,999,990') || ' closed + ' || to_char(f.weighted_quarter_cents / 100.0, 'FM$999,999,990') ||
       ' weighted against a ' || to_char(f.quota_cents / 100.0, 'FM$999,999,990') || ' quota, ' || f.days_left_in_quarter || ' days left in the quarter'
from v_forecast f
where (f.closed_won_cents + f.weighted_quarter_cents) < f.quota_cents * 0.6
union all
-- A customer nobody has spoken to in two months.
select 'customer_quiet', a.account, a.account, a.rep,
       a.days_quiet, a.lifetime_won_cents,
       'customer worth ' || to_char(a.lifetime_won_cents / 100.0, 'FM$999,999,990') || ' lifetime, no activity for ' || a.days_quiet || ' days'
from v_account_position a
where a.account_type = 'customer' and a.days_quiet > 60
union all
-- A task past its date.
select 'task_overdue', t.title, coalesce(a.name, ''), coalesce(r.full_name, ''),
       (current_date - t.due_on), null::bigint,
       'due ' || to_char(t.due_on, 'YYYY-MM-DD')
from tasks t
left join accounts a on a.id = t.account_id
left join reps r on r.id = t.rep_id
where t.status = 'open' and t.due_on < current_date;
