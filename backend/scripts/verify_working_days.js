/**
 * Read-only check: old payroll working-day rule vs the new org-derived rule, per organisation / branch schedule.
 *   Run against the target DB (e.g. Relitrade):  node scripts/verify_working_days.js [month] [year]
 * Prints, for each org, the payroll_settings weekend/fixed values, the work_schedule.work_days, and the working
 * days under the OLD rule vs the NEW rule for the month. Any row marked DIFFERS changes LOP per-day maths.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { pool } = require('../src/config/db');

const now = new Date();
const month = parseInt(process.argv[2], 10) || now.getMonth() + 1;
const year  = parseInt(process.argv[3], 10) || now.getFullYear();

function oldWeekend(dow, policy, satSeq) {
  switch (policy) {
    case 'sun_only': return dow === 0;
    case 'none': return false;
    case 'alternate_sat': return dow === 0 || (dow === 6 && satSeq % 2 === 0);
    default: return dow === 0 || dow === 6;
  }
}

function count(policy, fixed, rule, workDays) {
  const total = new Date(year, month, 0).getDate();
  let oldN = 0, newN = 0, sat = 0;
  for (let d = 1; d <= total; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow === 6) sat++;
    if (!oldWeekend(dow, policy, sat)) oldN++;
    let off = workDays.size ? !workDays.has(dow) : oldWeekend(dow, policy, sat);
    if (!off && dow === 6 && policy === 'alternate_sat') off = oldWeekend(dow, policy, sat);
    if (!off) newN++;
  }
  return { old: rule === 'fixed' ? Number(fixed) : oldN, next: newN };
}

(async () => {
  const { rows: orgs } = await pool.query(`
    SELECT o.id, o.name, ps.weekend_policy, ps.working_days_rule, ps.fixed_working_days, ps.per_day_salary_basis,
           ws.work_days
      FROM organizations o
      LEFT JOIN payroll_settings ps ON ps.organization_id = o.id
      LEFT JOIN work_schedule ws    ON ws.organization_id = o.id
     ORDER BY o.id`);
  console.log(`Working days for ${month}/${year}\n`);
  for (const o of orgs) {
    const wd = new Set(String(o.work_days || '').split(',').map(Number).filter(n => !isNaN(n) && String(o.work_days || '') !== ''));
    const c = count(o.weekend_policy || 'sat_sun', o.fixed_working_days, o.working_days_rule || 'calendar', wd);
    console.log(`${c.old === c.next ? 'same   ' : 'DIFFERS'} org ${o.id} ${o.name}: old=${c.old} new=${c.next}  ` +
      `(payroll: ${o.working_days_rule || 'calendar'}/${o.weekend_policy || 'sat_sun'}/${o.fixed_working_days ?? '-'}, schedule work_days=${o.work_days ?? 'none'}, per-day basis=${o.per_day_salary_basis ?? '-'})`);
  }
  try {
    const { rows } = await pool.query(`
      SELECT b.organization_id, b.branch_id, b.work_days FROM branch_work_schedule b ORDER BY 1, 2`);
    for (const b of rows) console.log(`  branch override: org ${b.organization_id} branch ${b.branch_id} work_days=${b.work_days}`);
  } catch { /* no branch schedules table */ }
  await pool.end();
})().catch(e => { console.error(e.message); process.exit(1); });
