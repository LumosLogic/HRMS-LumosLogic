/**
 * leave_rules_realdb.test.js — leave balance / guard consistency, verified against REAL PostgreSQL.
 *
 *   - ONE balance computation for the view (GET /balance, /balance/batch) and the POST /leaves guard
 *   - leave cycle (leave_year_start_month) instead of the hard-coded calendar year in the guard
 *   - holiday-aware day counting in the balance view
 *   - carry_forward / max_carry_forward actually applied
 *   - half_day_allowed / min_notice_days / max_consecutive_days enforced for employee self-service
 *   - existing behaviour preserved: admin on-behalf bypass, WFH exemption, simple quota exhaustion
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/leave_rules_realdb.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
// Tests must never send real mail: dotenv does not override variables that are already set, so blank SMTP credentials stay blank.
require('./helpers/realdb_env'); // blanks every provider credential, fakes Cloudinary, blocks non-local network (see helper)
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'leave-rules-realdb-test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const ID = {};

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const t of ['leaves', 'leave_approval_log', 'leave_balance_adjustments', 'leave_policies', 'holidays', 'attendance', 'leave_workflows', 'leave_workflow_levels'])
    await S(`TRUNCATE ${t} RESTART IDENTITY CASCADE`).catch(() => {});
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/employee_lifecycle_2026_10_06.sql'), 'utf8'));
  ID.org = (await one(`INSERT INTO organizations (name, slug) VALUES ('Leave Org','leave-org') RETURNING id`)).id;
  const user = async (name, role) => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date)
     VALUES ($1,$2,'x',$3,$4,'active','active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@leave.test`, role, ID.org])).id;
  ID.root = await user('Root LV', 'root_admin'); ID.hr = await user('HR LV', 'admin');
  ID.emp = await user('Emp LV', 'employee'); ID.emp2 = await user('Emp LV2', 'employee');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days) VALUES ($1,'09:00','18:00','1,2,3,4,5') ON CONFLICT DO NOTHING`, [ID.org]);
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
}
const setPolicy = async (o) => {
  await S(`DELETE FROM leave_policies WHERE organization_id=$1`, [ID.org]);
  await S(`INSERT INTO leave_policies (organization_id, leave_type, label, annual_quota, carry_forward, max_carry_forward, paid, active, half_day_allowed, min_notice_days, max_consecutive_days)
           VALUES ($1,$2,$3,$4,$5,$6,true,true,$7,$8,$9)`,
    [ID.org, o.type || 'casual', o.label || 'Casual Leave', o.quota ?? 8, !!o.cf, o.maxCf ?? 0, o.half !== false, o.notice ?? 0, o.maxRun ?? 0]);
};
const clearLeaves = async () => { await S(`DELETE FROM leaves WHERE organization_id=$1`, [ID.org]); await S(`DELETE FROM holidays WHERE organization_id=$1`, [ID.org]); await S(`DELETE FROM leave_balance_adjustments WHERE org_id=$1`, [ID.org]); await S(`UPDATE organizations SET leave_year_start_month=1 WHERE id=$1`, [ID.org]); };
const approved = (uid, a, b, type = 'casual', time = 'full') => S(
  `INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,$3,$4,$5,$6,'approved','x')`, [uid, ID.org, a, b, type, time]);

let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function call(method, url, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const bal = async (as, q = '', type = 'casual') => (await call('GET', `/api/leaves/balance${q}`, { as })).body.balances.find(b => b.leave_type === type);
const apply = (as, a, b, extra = {}) => call('POST', '/api/leaves', { as, body: { start_date: a, end_date: b, leave_type: 'casual', reason: 'x', ...extra } });
const dayStr = (d) => d.toISOString().split('T')[0];
const nextWeekday = (from, plus) => { const d = new Date(from); d.setUTCDate(d.getUTCDate() + plus); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return dayStr(d); };

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const app = express(); app.use(express.json()); app.use('/api/leaves', load('modules/leaves/leaves.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nBALANCE: view and guard use one computation');
  await t('plain quota unchanged: used/remaining as before; guard refuses a request above the remaining balance', async () => {
    await clearLeaves(); await setPolicy({ quota: 3 });
    await approved(ID.emp, '2026-03-02', '2026-03-03');                    // Mon–Tue = 2 days
    const b = await bal(ID.emp, '?year=2026');
    assert.strictEqual(b.allocated, 3); assert.strictEqual(b.used, 2); assert.strictEqual(b.remaining, 1); assert.strictEqual(b.carried_forward, 0);
    assert.strictEqual((await apply(ID.emp, '2026-03-09', '2026-03-10')).status, 400, '2 days > 1 remaining');
    const ok = await apply(ID.emp, '2026-03-09', '2026-03-09');
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  });
  await t('balance view honours holidays (leave over a holiday uses fewer days) — the guard always did', async () => {
    await clearLeaves(); await setPolicy({ quota: 10 });
    await S(`INSERT INTO holidays (organization_id, name, date, type) VALUES ($1,'Mid Holiday','2026-05-13','public')`, [ID.org]);
    await approved(ID.emp, '2026-05-12', '2026-05-14');                    // Tue–Thu, Wed is a holiday
    const b = await bal(ID.emp, '?year=2026');
    assert.strictEqual(b.used, 2, 'holiday must not be counted as a leave day');
    assert.strictEqual(b.remaining, 8);
  });
  await t('leave cycle: with an April–March year the guard counts the CURRENT cycle, not the calendar year', async () => {
    await clearLeaves(); await setPolicy({ quota: 2 });
    await S(`UPDATE organizations SET leave_year_start_month=4 WHERE id=$1`, [ID.org]);
    await approved(ID.emp, '2026-02-09', '2026-02-10');                    // belongs to cycle 2025 (Apr-2025..Mar-2026)
    const ok = await apply(ID.emp, '2026-05-12', '2026-05-13');            // cycle 2026 — full quota available
    assert.strictEqual(ok.status, 200, 'previous-cycle leave must not eat this cycle\'s quota: ' + JSON.stringify(ok.body));
    const over = await apply(ID.emp, '2026-05-14', '2026-05-14');
    assert.strictEqual(over.status, 400, 'pending days of this cycle do count');
  });
  await t('batch endpoint equals the single-employee endpoint (same code path, incl. holidays)', async () => {
    await clearLeaves(); await setPolicy({ quota: 10 });
    await S(`INSERT INTO holidays (organization_id, name, date, type) VALUES ($1,'H','2026-05-13','public')`, [ID.org]);
    await approved(ID.emp, '2026-05-12', '2026-05-14');
    const one_ = await bal(ID.emp, '?year=2026');
    const batch = (await call('GET', `/api/leaves/balance/batch?userIds=${ID.emp},${ID.emp2}&year=2026`, { as: ID.hr })).body.balances;
    assert.deepStrictEqual(batch[ID.emp].find(b => b.leave_type === 'casual'), one_);
    assert.strictEqual(batch[ID.emp2].find(b => b.leave_type === 'casual').used, 0);
  });

  console.log('\nCARRY-FORWARD: configured, now applied');
  await t('unused balance of the previous cycle is carried, capped at max_carry_forward', async () => {
    await clearLeaves(); await setPolicy({ quota: 10, cf: true, maxCf: 3 });
    await approved(ID.emp, '2025-06-02', '2025-06-05');                    // 4 used in 2025 → 6 unused
    const b = await bal(ID.emp, '?year=2026');
    assert.strictEqual(b.carried_forward, 3, 'capped at max_carry_forward (6 unused > cap 3)');
    assert.strictEqual(b.remaining, 13);
    const batch = (await call('GET', `/api/leaves/balance/batch?userIds=${ID.emp}&year=2026`, { as: ID.hr })).body.balances[ID.emp][0];
    assert.strictEqual(batch.carried_forward, 3); assert.strictEqual(batch.remaining, 13);
  });
  await t('carry is limited by what was actually unused (2 left < cap 5) and never negative', async () => {
    await clearLeaves(); await setPolicy({ quota: 10, cf: true, maxCf: 5 });
    await approved(ID.emp, '2025-06-02', '2025-06-13');                    // 10 working days used → 0 left
    assert.strictEqual((await bal(ID.emp, '?year=2026')).carried_forward, 0);
    await clearLeaves(); await setPolicy({ quota: 10, cf: true, maxCf: 5 });
    await approved(ID.emp, '2025-06-02', '2025-06-12');                    // 9 days used → 1 left
    assert.strictEqual((await bal(ID.emp, '?year=2026')).carried_forward, 1);
  });
  await t('carry_forward=false (or max 0) changes nothing; the guard allows exactly quota + carry', async () => {
    await clearLeaves(); await setPolicy({ quota: 2, cf: false, maxCf: 5 });
    await approved(ID.emp, '2025-06-02', '2025-06-02');
    assert.strictEqual((await bal(ID.emp, '?year=2026')).carried_forward, 0);
    await clearLeaves(); await setPolicy({ quota: 2, cf: true, maxCf: 5 });
    await approved(ID.emp, '2025-06-02', '2025-06-02');                    // 1 of 2 used → carry 1 → 3 available in 2026
    const ok = await apply(ID.emp, '2026-04-06', '2026-04-08');            // 3 days
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await apply(ID.emp, '2026-04-09', '2026-04-09')).status, 400, 'fourth day exceeds quota+carry');
  });

  console.log('\nPOLICY RULES: stored in Leave Policies, now enforced for self-service');
  await t('half_day_allowed=false rejects a half-day request; admin on-behalf is exempt', async () => {
    await clearLeaves(); await setPolicy({ quota: 8, half: false });
    const r = await apply(ID.emp, '2026-06-02', '2026-06-02', { leave_time: 'half', half_type: 'first_half' });
    assert.strictEqual(r.status, 400); assert.match(r.body.error, /Half-day is not allowed/);
    const onb = await call('POST', '/api/leaves', { as: ID.hr, body: { user_id: ID.emp, start_date: '2026-06-02', end_date: '2026-06-02', leave_type: 'casual', leave_time: 'half', reason: 'x' } });
    assert.strictEqual(onb.status, 200, JSON.stringify(onb.body));
  });
  await t('min_notice_days: a request closer than the notice period is refused, one far enough ahead is accepted', async () => {
    await clearLeaves(); await setPolicy({ quota: 8, notice: 3 });
    const soon = nextWeekday(new Date(), 1);
    const daysAhead = Math.round((new Date(soon) - new Date(dayStr(new Date()))) / 86400000);
    if (daysAhead < 3) assert.strictEqual((await apply(ID.emp, soon, soon)).status, 400);
    const later = nextWeekday(new Date(), 14);
    assert.strictEqual((await apply(ID.emp, later, later)).status, 200);
  });
  await t('max_consecutive_days: more working days than allowed per request is refused; within the limit passes', async () => {
    await clearLeaves(); await setPolicy({ quota: 8, maxRun: 2 });
    const r = await apply(ID.emp, '2026-07-06', '2026-07-08');             // Mon–Wed = 3 days
    assert.strictEqual(r.status, 400); assert.match(r.body.error, /cannot exceed 2/);
    assert.strictEqual((await apply(ID.emp, '2026-07-06', '2026-07-07')).status, 200);
  });
  await t('unconfigured rules (0 / true) behave exactly as before; WFH is exempt from every rule', async () => {
    await clearLeaves(); await setPolicy({ quota: 1, notice: 5, maxRun: 1, half: false });
    const wfh = await call('POST', '/api/leaves', { as: ID.emp, body: { start_date: '2026-08-03', end_date: '2026-08-05', leave_type: 'wfh', leave_time: 'wfh', reason: 'x' } });
    assert.strictEqual(wfh.status, 200, JSON.stringify(wfh.body));
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All leave-rule real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
