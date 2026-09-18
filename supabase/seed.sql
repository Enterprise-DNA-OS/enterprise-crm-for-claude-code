-- Demo data for enterprise-crm-for-claude-code.
-- Bellbird Filtration Pty Ltd, a fictional Melbourne maker of industrial
-- filtration systems selling B2B across Australia and New Zealand: a sales
-- manager and four reps on quarterly quotas, four territories, eighteen
-- accounts, twenty-four contacts, eight leads and seventeen opportunities
-- from qualification to closed, with the activity record underneath.
--
-- Deliberately messy, so the attention list has something to say:
--   a $132,000 proposal whose close date passed six days ago, still open
--   an $86,000 deal closing in nine days with no dated next step
--   a $240,000 deal engaged with only one contact at the account
--   a $310,000 deal with no activity for thirty days
--   a next step four days overdue on the Fern Engineering contract
--   two leads nobody has touched (six and five days old)
--   a rep with almost nothing closed or weighted against a $500,000 quota
--   a customer worth $91,000 lifetime gone quiet for 75 days
--   a task two days overdue
--
-- Dates are relative to current_date (closed-this-quarter dates are clamped
-- into the current quarter so the forecast always has something to show).
-- Ids are derived from names with seed_uuid and every insert is ON CONFLICT
-- DO NOTHING, so running it twice changes nothing.
--
-- Every company, person, amount and deal is a DEMO VALUE for a fictional
-- business. No real company or person is depicted.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Territories -------------------------------------------------------------------

insert into territories (id, name, region) values
  (seed_uuid('terr:vic'), 'Victoria',        'VIC'),
  (seed_uuid('terr:nsw'), 'New South Wales', 'NSW'),
  (seed_uuid('terr:qld'), 'Queensland',      'QLD'),
  (seed_uuid('terr:nz'),  'New Zealand',     'NZ')
on conflict do nothing;

-- Reps ---------------------------------------------------------------------------

insert into reps (id, full_name, code, email, role, territory_id, active, started_on) values
  (seed_uuid('rep:priya'),  'Priya Raman',  'PR', 'priya@bellbirdfiltration.example.au',  'manager', seed_uuid('terr:vic'), true, current_date - 2600),
  (seed_uuid('rep:dan'),    'Dan Whitaker', 'DW', 'dan@bellbirdfiltration.example.au',    'rep',     seed_uuid('terr:vic'), true, current_date - 1900),
  (seed_uuid('rep:casey'),  'Casey Morton', 'CM', 'casey@bellbirdfiltration.example.au',  'rep',     seed_uuid('terr:nsw'), true, current_date - 1200),
  (seed_uuid('rep:reuben'), 'Reuben Tan',   'RT', 'reuben@bellbirdfiltration.example.au', 'rep',     seed_uuid('terr:qld'), true, current_date - 800),
  (seed_uuid('rep:aroha'),  'Aroha Ngata',  'AN', 'aroha@bellbirdfiltration.example.nz',  'rep',     seed_uuid('terr:nz'),  true, current_date - 600)
on conflict do nothing;

-- Quotas: the current quarter, per rep. The manager carries no quota.

insert into quotas (id, rep_id, period, quota_cents) values
  (seed_uuid('quota:dan'),    seed_uuid('rep:dan'),    to_char(current_date, 'YYYY-"Q"Q'), 60000000),
  (seed_uuid('quota:casey'),  seed_uuid('rep:casey'),  to_char(current_date, 'YYYY-"Q"Q'), 55000000),
  (seed_uuid('quota:reuben'), seed_uuid('rep:reuben'), to_char(current_date, 'YYYY-"Q"Q'), 45000000),
  (seed_uuid('quota:aroha'),  seed_uuid('rep:aroha'),  to_char(current_date, 'YYYY-"Q"Q'), 50000000)
on conflict do nothing;

-- Accounts -----------------------------------------------------------------------

insert into accounts (id, name, account_type, industry, territory_id, rep_id, city, country, website, phone, external_ref) values
  (seed_uuid('acct:alto'),       'Alto Beverage Co',            'customer', 'Beverages',        seed_uuid('terr:vic'), seed_uuid('rep:dan'),    'Melbourne',    'Australia',   'altobeverage.example.au',      '03 9555 0101', 'SF-A001'),
  (seed_uuid('acct:southern'),   'Southern Grain Milling',      'customer', 'Food processing',  seed_uuid('terr:vic'), seed_uuid('rep:dan'),    'Geelong',      'Australia',   'southerngrain.example.au',     '03 9555 0102', 'SF-A002'),
  (seed_uuid('acct:harbour'),    'Harbour City Water',          'customer', 'Water treatment',  seed_uuid('terr:nsw'), seed_uuid('rep:casey'),  'Sydney',       'Australia',   'harbourcitywater.example.au',  '02 8555 0103', 'SF-A003'),
  (seed_uuid('acct:coastline'),  'Coastline Meats',             'customer', 'Food processing',  seed_uuid('terr:qld'), seed_uuid('rep:reuben'), 'Rockhampton',  'Australia',   'coastlinemeats.example.au',    '07 4555 0104', 'SF-A004'),
  (seed_uuid('acct:tui'),        'Tui Dairy Co-op',             'customer', 'Dairy',            seed_uuid('terr:nz'),  seed_uuid('rep:aroha'),  'Hamilton',     'New Zealand', 'tuidairy.example.nz',          '07 855 0105',  'SF-A005'),
  (seed_uuid('acct:ballarat'),   'Ballarat Foundries',          'customer', 'Metals',           seed_uuid('terr:vic'), seed_uuid('rep:dan'),    'Ballarat',     'Australia',   'ballaratfoundries.example.au', '03 5355 0106', 'SF-A006'),
  (seed_uuid('acct:yarra'),      'Yarra Bottling Co',           'customer', 'Beverages',        seed_uuid('terr:vic'), seed_uuid('rep:dan'),    'Melbourne',    'Australia',   'yarrabottling.example.au',     '03 9555 0107', 'SF-A007'),
  (seed_uuid('acct:westgate'),   'Westgate Chemicals',          'customer', 'Chemicals',        seed_uuid('terr:nsw'), seed_uuid('rep:casey'),  'Newcastle',    'Australia',   'westgatechem.example.au',      '02 4955 0108', 'SF-A008'),
  (seed_uuid('acct:northbank'),  'Northbank Breweries',         'prospect', 'Beverages',        seed_uuid('terr:vic'), seed_uuid('rep:dan'),    'Melbourne',    'Australia',   'northbankbrew.example.au',     '03 9555 0109', 'SF-A009'),
  (seed_uuid('acct:bowen'),      'Bowen Basin Minerals Services','prospect','Mining services',  seed_uuid('terr:qld'), seed_uuid('rep:reuben'), 'Mackay',       'Australia',   'bowenbasinms.example.au',      '07 4955 0110', 'SF-A010'),
  (seed_uuid('acct:clearwater'), 'Clearwater Aquaculture',      'prospect', 'Aquaculture',      seed_uuid('terr:qld'), seed_uuid('rep:reuben'), 'Bundaberg',    'Australia',   'clearwateraqua.example.au',    '07 4155 0111', 'SF-A011'),
  (seed_uuid('acct:sunfield'),   'Sunfield Solar',              'prospect', 'Energy',           seed_uuid('terr:nsw'), seed_uuid('rep:casey'),  'Dubbo',        'Australia',   'sunfieldsolar.example.au',     '02 6855 0112', 'SF-A012'),
  (seed_uuid('acct:kauri'),      'Kauri Timber Group',          'prospect', 'Timber',           seed_uuid('terr:nz'),  seed_uuid('rep:aroha'),  'Rotorua',      'New Zealand', 'kauritimber.example.nz',       '07 348 0113',  'SF-A013'),
  (seed_uuid('acct:monaro'),     'Monaro Cement',               'prospect', 'Construction materials', seed_uuid('terr:nsw'), seed_uuid('rep:casey'), 'Cooma',   'Australia',   'monarocement.example.au',      '02 6455 0114', 'SF-A014'),
  (seed_uuid('acct:redgum'),     'Redgum Recycling',            'prospect', 'Waste and recycling', seed_uuid('terr:vic'), seed_uuid('rep:casey'), 'Shepparton', 'Australia',   'redgumrecycling.example.au',   '03 5855 0115', 'SF-A015'),
  (seed_uuid('acct:fern'),       'Fern Engineering',            'prospect', 'Engineering',      seed_uuid('terr:nz'),  seed_uuid('rep:aroha'),  'Christchurch', 'New Zealand', 'fernengineering.example.nz',   '03 365 0116',  'SF-A016'),
  (seed_uuid('acct:filtraparts'),'FiltraParts Distribution',    'partner',  'Distribution',     seed_uuid('terr:vic'), seed_uuid('rep:priya'),  'Melbourne',    'Australia',   'filtraparts.example.au',       '03 9555 0117', 'SF-A017'),
  (seed_uuid('acct:oldmill'),    'Old Mill Paper Co',           'former',   'Pulp and paper',   seed_uuid('terr:vic'), seed_uuid('rep:priya'),  'Traralgon',    'Australia',   null,                           '03 5175 0118', 'SF-A018')
on conflict do nothing;

-- Contacts -----------------------------------------------------------------------
-- Gordon Field opted out 90 days ago; the CLI refuses to log an email to him.
-- Bluey Sanderson has no email and no phone, and Monaro has a $310,000 open
-- deal: the /compliance reachable rule exists for exactly him.

insert into contacts (id, account_id, full_name, title, buying_role, email, phone, opted_out, opted_out_on, external_ref) values
  (seed_uuid('ct:marina'),  seed_uuid('acct:alto'),       'Marina Kovac',      'Operations Director',       'champion',        'marina.kovac@altobeverage.example.au',    '0412 100 001', false, null, 'SF-C001'),
  (seed_uuid('ct:stephen'), seed_uuid('acct:alto'),       'Stephen Lau',       'Chief Financial Officer',   'decision_maker',  's.lau@altobeverage.example.au',           '0412 100 002', false, null, 'SF-C002'),
  (seed_uuid('ct:bill'),    seed_uuid('acct:southern'),   'Bill Harmon',       'Plant Manager',             'decision_maker',  'b.harmon@southerngrain.example.au',       '0412 100 003', false, null, 'SF-C003'),
  (seed_uuid('ct:ingrid'),  seed_uuid('acct:harbour'),    'Ingrid Falk',       'Procurement Lead',          'gatekeeper',      'i.falk@harbourcitywater.example.au',      '0412 100 004', false, null, 'SF-C004'),
  (seed_uuid('ct:ray'),     seed_uuid('acct:harbour'),    'Ray Donnelly',      'Treatment Operations Manager', 'user',         'r.donnelly@harbourcitywater.example.au',  '0412 100 005', false, null, 'SF-C005'),
  (seed_uuid('ct:sofia'),   seed_uuid('acct:coastline'),  'Sofia Marino',      'GM Operations',             'decision_maker',  's.marino@coastlinemeats.example.au',      '0412 100 006', false, null, 'SF-C006'),
  (seed_uuid('ct:jack'),    seed_uuid('acct:coastline'),  'Jack Ewart',        'Maintenance Superintendent','user',            'j.ewart@coastlinemeats.example.au',       '0412 100 007', false, null, 'SF-C007'),
  (seed_uuid('ct:mere'),    seed_uuid('acct:tui'),        'Mere Kingi',        'Site Engineering Manager',  'champion',        'mere.kingi@tuidairy.example.nz',          '021 100 008',  false, null, 'SF-C008'),
  (seed_uuid('ct:colin'),   seed_uuid('acct:tui'),        'Colin Brash',       'Commercial Manager',        'decision_maker',  'c.brash@tuidairy.example.nz',             '021 100 009',  false, null, 'SF-C009'),
  (seed_uuid('ct:ted'),     seed_uuid('acct:ballarat'),   'Ted Novak',         'Works Manager',             'decision_maker',  't.novak@ballaratfoundries.example.au',    '0412 100 010', false, null, 'SF-C010'),
  (seed_uuid('ct:lena'),    seed_uuid('acct:yarra'),      'Lena Duffy',        'Operations Manager',        'champion',        'l.duffy@yarrabottling.example.au',        '0412 100 011', false, null, 'SF-C011'),
  (seed_uuid('ct:gordon'),  seed_uuid('acct:westgate'),   'Gordon Field',      'Procurement Manager',       'gatekeeper',      'g.field@westgatechem.example.au',         '0412 100 012', true,  current_date - 90, 'SF-C012'),
  (seed_uuid('ct:anita'),   seed_uuid('acct:westgate'),   'Anita Rao',         'Process Engineer',          'user',            'a.rao@westgatechem.example.au',           '0412 100 013', false, null, 'SF-C013'),
  (seed_uuid('ct:felix'),   seed_uuid('acct:northbank'),  'Felix Warner',      'Head Brewer',               'champion',        'felix@northbankbrew.example.au',          '0412 100 014', false, null, 'SF-C014'),
  (seed_uuid('ct:craig'),   seed_uuid('acct:bowen'),      'Craig Doyle',       'Site Services Manager',     'champion',        'c.doyle@bowenbasinms.example.au',         '0412 100 015', false, null, 'SF-C015'),
  (seed_uuid('ct:naomi'),   seed_uuid('acct:clearwater'), 'Naomi Yee',         'Founder',                   'decision_maker',  'naomi@clearwateraqua.example.au',         '0412 100 016', false, null, 'SF-C016'),
  (seed_uuid('ct:marcus'),  seed_uuid('acct:sunfield'),   'Marcus Bell',       'Plant Engineer',            'user',            'm.bell@sunfieldsolar.example.au',         '0412 100 017', false, null, 'SF-C017'),
  (seed_uuid('ct:hetariki'),seed_uuid('acct:kauri'),      'Sam Hetariki',      'Mill Manager',              'decision_maker',  's.hetariki@kauritimber.example.nz',       '021 100 018',  false, null, 'SF-C018'),
  (seed_uuid('ct:bluey'),   seed_uuid('acct:monaro'),     'Bluey Sanderson',   'Shift Supervisor',          'user',            null,                                       null,           false, null, 'SF-C019'),
  (seed_uuid('ct:diane'),   seed_uuid('acct:monaro'),     'Diane Wu',          'Plant Manager',             'decision_maker',  'd.wu@monarocement.example.au',            '0412 100 020', false, null, 'SF-C020'),
  (seed_uuid('ct:olive'),   seed_uuid('acct:redgum'),     'Olive Trenwith',    'Managing Director',         'decision_maker',  'olive@redgumrecycling.example.au',        '0412 100 021', false, null, 'SF-C021'),
  (seed_uuid('ct:ana'),     seed_uuid('acct:fern'),       'Ana Sutherland',    'Engineering Lead',          'champion',        'ana@fernengineering.example.nz',          '021 100 022',  false, null, 'SF-C022'),
  (seed_uuid('ct:roger'),   seed_uuid('acct:filtraparts'),'Roger Voss',        'Owner',                     'decision_maker',  'roger@filtraparts.example.au',            '0412 100 023', false, null, 'SF-C023'),
  (seed_uuid('ct:denise'),  seed_uuid('acct:oldmill'),    'Denise Hartley',    'Site Administrator',        null,              'd.hartley@oldmillpaper.example.au',       null,           false, null, 'SF-C024')
on conflict do nothing;

-- Leads --------------------------------------------------------------------------
-- Two have never been touched (six and five days old); one is qualified and
-- ready to convert; one arrived with no rep and waits for `lead route`.

insert into leads (id, full_name, company, title, email, phone, source, region, status, rep_id, received_on, disqualified_reason, external_ref) values
  (seed_uuid('lead:mia'),     'Mia Okafor',     'Brightwater Foods',     'Production Manager', 'mia@brightwaterfoods.example.au',   '0413 200 001', 'website',  'VIC', 'new',          seed_uuid('rep:dan'),    current_date - 6,  null, 'SF-L001'),
  (seed_uuid('lead:sanjay'),  'Sanjay Pillai',  'Torrent Hydraulics',    'Owner',              'sanjay@torrenthyd.example.au',      '0413 200 002', 'referral', 'NSW', 'new',          seed_uuid('rep:casey'),  current_date - 1,  null, 'SF-L002'),
  (seed_uuid('lead:heather'), 'Heather Lloyd',  'Cape Verde Wines',      'Winemaker',          'heather@capeverdewines.example.au', '0413 200 003', 'event',    'VIC', 'working',      seed_uuid('rep:dan'),    current_date - 10, null, 'SF-L003'),
  (seed_uuid('lead:tom'),     'Tom Aldous',     'Karo Packaging',        'Plant Engineer',     'tom@karopackaging.example.nz',      '021 200 004',  'website',  'NZ',  'new',          seed_uuid('rep:aroha'),  current_date - 5,  null, 'SF-L004'),
  (seed_uuid('lead:gina'),    'Gina Marsh',     'Big Sky Feedlots',      'Operations Manager', 'gina@bigskyfeedlots.example.au',    '0413 200 005', 'outbound', 'QLD', 'qualified',    seed_uuid('rep:reuben'), current_date - 15, null, 'SF-L005'),
  (seed_uuid('lead:vera'),    'Vera Lindqvist', 'Nordica Pumps',         'Sales Director',     'vera@nordicapumps.example',         null,           'website',  'VIC', 'disqualified', seed_uuid('rep:dan'),    current_date - 9,  'Reseller enquiry, not an end user', 'SF-L006'),
  (seed_uuid('lead:pete'),    'Pete Rangi',     'Southern Alps Breweries','Head of Production','pete@southernalpsbrew.example.nz',  '021 200 007',  'website',  'NZ',  'new',          null,                    current_date - 2,  null, 'SF-L007'),
  (seed_uuid('lead:alice'),   'Alice Munro',    'Grampians Water Trust', 'Asset Manager',      'alice@grampianswater.example.au',   '0413 200 008', 'referral', 'VIC', 'working',      seed_uuid('rep:dan'),    current_date - 12, null, 'SF-L008')
on conflict do nothing;

-- Opportunities -------------------------------------------------------------------
-- amount_cents in cents; probability defaulted by stage (10/25/50/75).
-- Closed-this-quarter dates are clamped into the quarter with greatest(), so
-- the forecast always has closed business to show whatever today's date is.

insert into opportunities (id, ref, account_id, rep_id, name, stage, amount_cents, probability, opened_on, close_date, next_step, next_step_on, source, stage_entered_on, won_on, lost_on, lost_reason, external_ref) values
  -- The open pipeline.
  (seed_uuid('opp:1001'), 'OPP-1001', seed_uuid('acct:alto'),       seed_uuid('rep:dan'),    'Filtration line upgrade, plant 2',   'negotiation',   18400000, 75, current_date - 55, current_date + 9,  'Final pricing review with Stephen Lau', current_date + 2, 'referral',  current_date - 8,  null, null, null, 'SF-O001'),
  (seed_uuid('opp:1002'), 'OPP-1002', seed_uuid('acct:harbour'),    seed_uuid('rep:casey'),  'Annual filter media replacement',    'proposal',       8600000, 50, current_date - 30, current_date + 9,  null,                                    null,             'renewal',   current_date - 12, null, null, null, 'SF-O002'),
  (seed_uuid('opp:1003'), 'OPP-1003', seed_uuid('acct:bowen'),      seed_uuid('rep:reuben'), 'Dust filtration, two wash plants',   'discovery',     24000000, 25, current_date - 40, current_date + 45, 'Site walk at the Moranbah wash plant',  current_date + 6, 'outbound',  current_date - 20, null, null, null, 'SF-O003'),
  (seed_uuid('opp:1004'), 'OPP-1004', seed_uuid('acct:tui'),        seed_uuid('rep:aroha'),  'CIP filtration retrofit',            'proposal',      13200000, 50, current_date - 70, current_date - 6,  'Revised proposal back to Colin Brash',  current_date - 2, 'customer',  current_date - 30, null, null, null, 'SF-O004'),
  (seed_uuid('opp:1005'), 'OPP-1005', seed_uuid('acct:clearwater'), seed_uuid('rep:reuben'), 'Pilot recirculation system',         'qualification',     null, 10, current_date - 10, current_date + 30, 'Scope call with Naomi',                 current_date + 3, 'website',   current_date - 10, null, null, null, 'SF-O005'),
  (seed_uuid('opp:1006'), 'OPP-1006', seed_uuid('acct:northbank'),  seed_uuid('rep:dan'),    'Brewhouse filtration package',       'discovery',         null, 25, current_date - 25, current_date + 40, 'Demo rig at the tasting room',          current_date + 8, 'event',     current_date - 14, null, null, null, 'SF-O006'),
  (seed_uuid('opp:1007'), 'OPP-1007', seed_uuid('acct:fern'),       seed_uuid('rep:aroha'),  'Spare parts supply contract',        'proposal',       4500000, 50, current_date - 35, current_date + 20, 'Contract redlines back to Ana',         current_date - 4, 'partner',   current_date - 15, null, null, null, 'SF-O007'),
  (seed_uuid('opp:1008'), 'OPP-1008', seed_uuid('acct:monaro'),     seed_uuid('rep:casey'),  'Baghouse rebuild, kiln 3',           'discovery',     31000000, 25, current_date - 60, current_date + 70, 'Engineering review with Diane',         current_date + 14,'outbound',  current_date - 35, null, null, null, 'SF-O008'),
  (seed_uuid('opp:1009'), 'OPP-1009', seed_uuid('acct:sunfield'),   seed_uuid('rep:casey'),  'Coolant filtration skid',            'qualification',  2800000, 10, current_date - 8,  current_date + 55, 'Qualify budget with Marcus',            current_date + 5, 'website',   current_date - 8,  null, null, null, 'SF-O009'),
  (seed_uuid('opp:1010'), 'OPP-1010', seed_uuid('acct:southern'),   seed_uuid('rep:dan'),    'Line 2 duplicate system',            'negotiation',    9700000, 75, current_date - 45, current_date + 6,  'Commercial terms call',                 current_date + 1, 'customer',  current_date - 6,  null, null, null, 'SF-O010'),
  -- Closed this quarter (dates clamped into the quarter).
  (seed_uuid('opp:1011'), 'OPP-1011', seed_uuid('acct:coastline'),  seed_uuid('rep:reuben'), 'Rendering plant filtration',         'closed_won',    15400000, 100, current_date - 95, greatest(date_trunc('quarter', current_date)::date, current_date - 12), null, null, 'referral', greatest(date_trunc('quarter', current_date)::date, current_date - 12), greatest(date_trunc('quarter', current_date)::date, current_date - 12), null, null, 'SF-O011'),
  (seed_uuid('opp:1012'), 'OPP-1012', seed_uuid('acct:ballarat'),   seed_uuid('rep:dan'),    'Quench tank filtration',             'closed_won',     6200000, 100, current_date - 80, greatest(date_trunc('quarter', current_date)::date, current_date - 25), null, null, 'customer', greatest(date_trunc('quarter', current_date)::date, current_date - 25), greatest(date_trunc('quarter', current_date)::date, current_date - 25), null, null, 'SF-O012'),
  (seed_uuid('opp:1013'), 'OPP-1013', seed_uuid('acct:westgate'),   seed_uuid('rep:casey'),  'Solvent recovery filtration',        'closed_lost',   11000000, 0,   current_date - 90, greatest(date_trunc('quarter', current_date)::date, current_date - 18), null, null, 'customer', greatest(date_trunc('quarter', current_date)::date, current_date - 18), null, greatest(date_trunc('quarter', current_date)::date, current_date - 18), 'Stayed with the incumbent on price', 'SF-O013'),
  -- Older history, for cycle times and win rates.
  (seed_uuid('opp:1014'), 'OPP-1014', seed_uuid('acct:alto'),       seed_uuid('rep:dan'),    'Plant 1 filtration upgrade',         'closed_won',     4800000, 100, current_date - 190, current_date - 140, null, null, 'outbound', current_date - 140, current_date - 140, null, null, 'SF-O014'),
  (seed_uuid('opp:1015'), 'OPP-1015', seed_uuid('acct:tui'),        seed_uuid('rep:aroha'),  'Whey line filtration',               'closed_won',     8800000, 100, current_date - 260, current_date - 200, null, null, 'referral', current_date - 200, current_date - 200, null, null, 'SF-O015'),
  (seed_uuid('opp:1016'), 'OPP-1016', seed_uuid('acct:redgum'),     seed_uuid('rep:casey'),  'Wash water treatment',               'closed_lost',    7500000, 0,   current_date - 150, current_date - 100, null, null, 'website',  current_date - 100, null, current_date - 100, 'No budget this financial year', 'SF-O016'),
  (seed_uuid('opp:1017'), 'OPP-1017', seed_uuid('acct:yarra'),      seed_uuid('rep:dan'),    'Bottling hall filtration',           'closed_won',     9100000, 100, current_date - 360, current_date - 300, null, null, 'referral', current_date - 300, current_date - 300, null, null, 'SF-O017')
on conflict do nothing;

-- Stage history --------------------------------------------------------------------

insert into stage_history (id, opportunity_id, from_stage, to_stage, changed_on, days_in_stage) values
  (seed_uuid('sh:1001a'), seed_uuid('opp:1001'), 'qualification', 'discovery',   current_date - 42, 13),
  (seed_uuid('sh:1001b'), seed_uuid('opp:1001'), 'discovery',     'proposal',    current_date - 25, 17),
  (seed_uuid('sh:1001c'), seed_uuid('opp:1001'), 'proposal',      'negotiation', current_date - 8,  17),
  (seed_uuid('sh:1004a'), seed_uuid('opp:1004'), 'qualification', 'discovery',   current_date - 55, 15),
  (seed_uuid('sh:1004b'), seed_uuid('opp:1004'), 'discovery',     'proposal',    current_date - 30, 25),
  (seed_uuid('sh:1010a'), seed_uuid('opp:1010'), 'qualification', 'discovery',   current_date - 35, 10),
  (seed_uuid('sh:1010b'), seed_uuid('opp:1010'), 'discovery',     'proposal',    current_date - 20, 15),
  (seed_uuid('sh:1010c'), seed_uuid('opp:1010'), 'proposal',      'negotiation', current_date - 6,  14),
  (seed_uuid('sh:1011a'), seed_uuid('opp:1011'), 'proposal',      'negotiation', current_date - 20, 30),
  (seed_uuid('sh:1011b'), seed_uuid('opp:1011'), 'negotiation',   'closed_won',  current_date - 12, 8),
  (seed_uuid('sh:1013a'), seed_uuid('opp:1013'), 'proposal',      'closed_lost', current_date - 18, 40)
on conflict do nothing;

-- Activities -------------------------------------------------------------------------
-- OPP-1003 has touched only Craig Doyle: a $240,000 deal on one relationship.
-- OPP-1008 has heard nothing for thirty days. Yarra Bottling has heard nothing
-- for seventy-five. No activity touches Gordon Field after his opt-out,
-- because the CLI will not allow one.

insert into activities (id, kind, account_id, contact_id, opportunity_id, lead_id, rep_id, happened_on, note) values
  (seed_uuid('act:01'), 'meeting', seed_uuid('acct:alto'),       seed_uuid('ct:marina'),  seed_uuid('opp:1001'), null, seed_uuid('rep:dan'),    current_date - 8,  'Negotiation session on the plant 2 upgrade. Scope agreed; price is the open item.'),
  (seed_uuid('act:02'), 'call',    seed_uuid('acct:alto'),       seed_uuid('ct:stephen'), seed_uuid('opp:1001'), null, seed_uuid('rep:dan'),    current_date - 3,  'Stephen wants the service contract priced separately before he signs.'),
  (seed_uuid('act:03'), 'email',   seed_uuid('acct:harbour'),    seed_uuid('ct:ingrid'),  seed_uuid('opp:1002'), null, seed_uuid('rep:casey'),  current_date - 10, 'Sent the media replacement proposal, pricing held from last year.'),
  (seed_uuid('act:04'), 'meeting', seed_uuid('acct:bowen'),      seed_uuid('ct:craig'),   seed_uuid('opp:1003'), null, seed_uuid('rep:reuben'), current_date - 15, 'Walked wash plant 1 with Craig. Dust loads worse than the spec assumed.'),
  (seed_uuid('act:05'), 'call',    seed_uuid('acct:bowen'),      seed_uuid('ct:craig'),   seed_uuid('opp:1003'), null, seed_uuid('rep:reuben'), current_date - 7,  'Craig confirmed budget exists this FY. Nobody above him has been in a meeting yet.'),
  (seed_uuid('act:06'), 'email',   seed_uuid('acct:tui'),        seed_uuid('ct:mere'),    seed_uuid('opp:1004'), null, seed_uuid('rep:aroha'),  current_date - 13, 'Mere pushed back on the membrane spec; revised scope discussed.'),
  (seed_uuid('act:07'), 'meeting', seed_uuid('acct:tui'),        seed_uuid('ct:colin'),   seed_uuid('opp:1004'), null, seed_uuid('rep:aroha'),  current_date - 33, 'Commercial walkthrough with Colin. Wants payment terms over two seasons.'),
  (seed_uuid('act:08'), 'call',    seed_uuid('acct:clearwater'), seed_uuid('ct:naomi'),   seed_uuid('opp:1005'), null, seed_uuid('rep:reuben'), current_date - 6,  'Naomi described the recirculation problem; pilot scope drafting.'),
  (seed_uuid('act:09'), 'meeting', seed_uuid('acct:northbank'),  seed_uuid('ct:felix'),   seed_uuid('opp:1006'), null, seed_uuid('rep:dan'),    current_date - 5,  'Felix keen on the brewhouse package; sizing needs their flow numbers.'),
  (seed_uuid('act:10'), 'email',   seed_uuid('acct:fern'),       seed_uuid('ct:ana'),     seed_uuid('opp:1007'), null, seed_uuid('rep:aroha'),  current_date - 8,  'Ana sent contract redlines; two clauses need our legal read.'),
  (seed_uuid('act:11'), 'meeting', seed_uuid('acct:monaro'),     seed_uuid('ct:diane'),   seed_uuid('opp:1008'), null, seed_uuid('rep:casey'),  current_date - 30, 'Kiln 3 baghouse condition survey presented to Diane.'),
  (seed_uuid('act:12'), 'note',    seed_uuid('acct:monaro'),     seed_uuid('ct:bluey'),   seed_uuid('opp:1008'), null, seed_uuid('rep:casey'),  current_date - 45, 'Bluey walked us through the kiln 3 baghouse on the site visit.'),
  (seed_uuid('act:13'), 'call',    seed_uuid('acct:sunfield'),   seed_uuid('ct:marcus'),  seed_uuid('opp:1009'), null, seed_uuid('rep:casey'),  current_date - 3,  'Marcus checking whether the coolant skid fits this year''s maintenance budget.'),
  (seed_uuid('act:14'), 'call',    seed_uuid('acct:southern'),   seed_uuid('ct:bill'),    seed_uuid('opp:1010'), null, seed_uuid('rep:dan'),    current_date - 2,  'Bill ready to duplicate line 1. Commercial terms call booked.'),
  (seed_uuid('act:15'), 'meeting', seed_uuid('acct:coastline'),  seed_uuid('ct:sofia'),   seed_uuid('opp:1011'), null, seed_uuid('rep:reuben'), current_date - 12, 'Signed the rendering plant order. Kickoff with Jack''s team next month.'),
  (seed_uuid('act:16'), 'call',    seed_uuid('acct:yarra'),      seed_uuid('ct:lena'),    null,                  null, seed_uuid('rep:dan'),    current_date - 75, 'Post-install check on the bottling hall system. All running well.'),
  (seed_uuid('act:17'), 'call',    null,                          null,                    null, seed_uuid('lead:heather'), seed_uuid('rep:dan'), current_date - 8, 'Heather exploring crossflow filtration for the next vintage.'),
  (seed_uuid('act:18'), 'call',    null,                          null,                    null, seed_uuid('lead:gina'),    seed_uuid('rep:reuben'), current_date - 9, 'Gina has board sign-off for effluent filtration. Qualified: convert when scoped.'),
  (seed_uuid('act:19'), 'email',   null,                          null,                    null, seed_uuid('lead:alice'),   seed_uuid('rep:dan'),  current_date - 7,  'Sent Alice the water trust case studies.'),
  (seed_uuid('act:20'), 'call',    seed_uuid('acct:westgate'),   seed_uuid('ct:anita'),   null,                  null, seed_uuid('rep:casey'),  current_date - 20, 'Post-loss check-in with Anita. Door open for the next plant expansion.'),
  (seed_uuid('act:21'), 'meeting', seed_uuid('acct:coastline'),  seed_uuid('ct:jack'),    null,                  null, seed_uuid('rep:reuben'), current_date - 40, 'Maintenance walkthrough with Jack ahead of the rendering proposal.'),
  (seed_uuid('act:22'), 'call',    seed_uuid('acct:oldmill'),    seed_uuid('ct:denise'),  null,                  null, seed_uuid('rep:priya'),  current_date - 800, 'Final site meeting before the mill closure. Account closed out.')
on conflict do nothing;

-- Tasks ---------------------------------------------------------------------------

insert into tasks (id, title, account_id, opportunity_id, rep_id, due_on, status) values
  (seed_uuid('task:tui'),       'Send the revised Tui Dairy proposal',            seed_uuid('acct:tui'),       seed_uuid('opp:1004'), seed_uuid('rep:aroha'),  current_date - 2, 'open'),
  (seed_uuid('task:alto'),      'Book the Alto pricing review with the CFO',      seed_uuid('acct:alto'),      seed_uuid('opp:1001'), seed_uuid('rep:dan'),    current_date + 1, 'open'),
  (seed_uuid('task:coastline'), 'Prepare the QBR pack for Coastline Meats',       seed_uuid('acct:coastline'), null,                  seed_uuid('rep:reuben'), current_date + 5, 'open')
on conflict do nothing;
