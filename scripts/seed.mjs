#!/usr/bin/env node
// Loads supabase/seed.sql: Bellbird Filtration, a fictional Melbourne
// industrial filtration maker with 5 on the sales team, 4 territories, 18
// accounts, 24 contacts, 8 leads and 17 opportunities from qualification to
// closed, plus the activity record underneath. Every row has a derived id and
// inserts with ON CONFLICT DO NOTHING, so re-running it is harmless.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';

export async function seed(db) {
  const sql = readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8');
  await db.exec(sql);
  const [c] = await db.query(`
    select (select count(*) from reps)          as reps,
           (select count(*) from territories)   as territories,
           (select count(*) from accounts)      as accounts,
           (select count(*) from contacts)      as contacts,
           (select count(*) from leads)         as leads,
           (select count(*) from opportunities) as opportunities,
           (select count(*) from activities)    as activities,
           (select count(*) from quotas)        as quotas,
           (select count(*) from tasks)         as tasks
  `);
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const db = await getDb();
  try {
    const n = await seed(db);
    console.log(
      `seed: ${n.reps} reps, ${n.territories} territories, ${n.accounts} accounts, ${n.contacts} contacts, ` +
        `${n.leads} leads, ${n.opportunities} opportunities, ${n.activities} activities, ${n.quotas} quotas, ${n.tasks} tasks`,
    );
  } finally {
    await db.close();
  }
}
