/**
 * leave_termination_realdb.test.js — terminating an employee removes the FUTURE part of their leave, against REAL PostgreSQL.
 *
 *   - future single-day / multi-day / pending / WFH leave is cancelled; balance comes back through the normal calculation
 *   - past leave and attendance are never touched
 *   - a leave spanning the termination date is trimmed (past days stay), not cancelled
 *   - other employees' leave is never touched
 *   - re-processing the termination changes nothing and restores nothing twice
 *   - audit trail: actor, reason "employee termination", original and remaining range
 *   - the real termination path (employeeLifecycle.afterStatusChange) does it end to end
 *
 * SAFETY: scratch schema bsv_* only, synthetic data. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/leave_termination_realdb.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('./helpers/realdb_env'); // blanks every provider credential, fakes Cloudinary, blocks non-local network
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'leave-termination-realdb-test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');
const { localDateStr } = load('utils/helpers');

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const ID = {};

const TODAY = localDateStr();
const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().split('T')[0]; };
const isWeekday = (ds) => ![0, 6].includes(new Date(ds + 'T12:00:00Z').getUTCDay());
const nextWeekday = (from, plus) => { let d = addDays(from, plus); while (!isWeekday(d)) d = addDays(d, 1); return d; };
const weekdaysBetween = (a, b) => { let n = 0; for (let d = a; d <= b; d = addDays(d, 1)) if (isWeekday(d)) n++; return n; };
const YEAR = TODAY.slice(0, 4);

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['leaves', 'leave_approval_log', 'leave_balance_adjustments', 'leave_policies', 'holidays', 'attendance', 'exit_requests'])
    await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/employee_lifecycle_2026_10_06.sql'), 'utf8'));
  ID.org = (await one(`INSERT INTO organizations (name, slug) VALUES ('Term Org','term-org') RETURNING id`)).id;
  const user = async (name, role) => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date)
     VALUES ($1,$2,'x',$3,$4,'active','active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@term.test`, role, ID.org])).id;
  ID.hr = await user('HR Term', 'admin');
  ID.emp = await user('Emp Terminated', 'employee');
  ID.other = await user('Emp Other', 'employee');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days) VALUES ($1,'09:00','18:00','1,2,3,4,5') ON CONFLICT DO NOTHING`, [ID.org]);
  await S(`INSERT INTO leave_policies (organization_id, leave_type, label, annual_quota, paid, active) VALUES ($1,'casual','Casual Leave',60,true,true)`, [ID.org]);
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
}
const reset = async () => {
  await S(`DELETE FROM leaves WHERE organization_id=$1`, [ID.org]);
  await S(`DELETE FROM attendance WHERE organization_id=$1`, [ID.org]);
  await S(`DELETE FROM leave_approval_log WHERE org_id=$1`, [ID.org]);
  await S(`DELETE FROM exit_requests WHERE organization_id=$1`, [ID.org]);
  await S(`UPDATE users SET employee_status='active', status='active' WHERE organization_id=$1`, [ID.org]);
};
const leave = async (uid, a, b, { status = 'approved', type = 'casual', time = 'full' } = {}) => (await one(
  `INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,'x') RETURNING id`,
  [uid, ID.org, a, b, type, time, status])).id;
const getLeave = (id) => one(`SELECT id, start_date, end_date, status FROM leaves WHERE id=$1`, [id]);
const logRows = (id) => S(`SELECT * FROM leave_approval_log WHERE leave_id=$1 ORDER BY id`, [id]);

let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
const balance = async (uid) => {
  const r = await fetch(`${base}/api/leaves/balance?year=${YEAR}`, { headers: { Authorization: 'Bearer ' + await tokenFor(uid) } });
  const j = await r.json();
  return (j.balances || []).find(b => b.leave_type === 'casual');
};
const terminate = async (effective = null) => {
  // effective = null → termination recorded today (what the Employees form / profile does with no explicit date)
  const { cancelFutureLeavesForTermination } = load('services/leaveCorrection');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await cancelFutureLeavesForTermination(client, { oId: ID.org, userId: ID.emp, effectiveDate: effective, today: TODAY, actorId: ID.hr, actorName: 'HR Term' });
    await client.query('COMMIT');
    return r;
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
};

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}, today ${TODAY}`);
  await seed();
  const app = express(); app.use(express.json()); app.use('/api/leaves', load('modules/leaves/leaves.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  const f1 = nextWeekday(TODAY, 10);          // future single day
  const f2a = nextWeekday(TODAY, 14), f2b = nextWeekday(f2a, 2);   // future multi-day
  const past = nextWeekday(addDays(TODAY, -40), 0);                 // well in the past

  console.log('\nFUTURE LEAVE IS REMOVED, BALANCE COMES BACK');
  await t('future single-day leave is cancelled and its day is restored', async () => {
    await reset(); const id = await leave(ID.emp, f1, f1);
    const before = await balance(ID.emp); assert.strictEqual(before.used, 1);
    const r = await terminate();
    assert.strictEqual((await getLeave(id)).status, 'cancelled');
    assert.strictEqual(r.restoredDays, 1);
    const after = await balance(ID.emp); assert.strictEqual(after.used, 0); assert.strictEqual(after.remaining, before.remaining + 1);
  });
  await t('future multi-day leave is cancelled; every working day comes back', async () => {
    await reset(); const id = await leave(ID.emp, f2a, f2b);
    const days = weekdaysBetween(f2a, f2b);
    assert.strictEqual((await balance(ID.emp)).used, days);
    await terminate();
    assert.strictEqual((await getLeave(id)).status, 'cancelled');
    assert.strictEqual((await balance(ID.emp)).used, 0);
  });
  await t('a request still waiting for approval and a future WFH are cancelled too (nothing left in approvers\' queues / calendars)', async () => {
    await reset();
    const p = await leave(ID.emp, f1, f1, { status: 'pending_approval' });
    const w = await leave(ID.emp, f2a, f2a, { type: 'wfh', time: 'wfh' });
    await terminate();
    assert.strictEqual((await getLeave(p)).status, 'cancelled');
    assert.strictEqual((await getLeave(w)).status, 'cancelled');
  });

  console.log('\nHISTORY IS PRESERVED');
  await t('past leave is untouched and keeps counting as used', async () => {
    await reset(); const id = await leave(ID.emp, past, past);
    const r = await terminate();
    assert.strictEqual((await getLeave(id)).status, 'approved'); assert.strictEqual(r.changes.length, 0);
    assert.strictEqual((await balance(ID.emp)).used, 1);
  });
  await t('leave spanning the termination date is TRIMMED to the termination date: past days stay approved, only future days are removed', async () => {
    await reset();
    const start = addDays(TODAY, -3), end = addDays(TODAY, 6);
    const id = await leave(ID.emp, start, end);
    const keptDays = weekdaysBetween(start, TODAY);
    assert.strictEqual((await balance(ID.emp)).used, weekdaysBetween(start, end));
    const r = await terminate();
    const row = await getLeave(id);
    assert.strictEqual(row.status, 'approved'); assert.strictEqual(String(row.start_date).slice(0, 10), start); assert.strictEqual(String(row.end_date).slice(0, 10), TODAY);
    assert.strictEqual(r.changes[0].action, 'trimmed');
    assert.strictEqual((await balance(ID.emp)).used, keptDays, 'only the days up to the termination date still count');
  });
  await t('real attendance is never deleted; only future leave placeholders go', async () => {
    await reset(); const id = await leave(ID.emp, f2a, f2b);
    await S(`INSERT INTO attendance (user_id, date, status, organization_id) VALUES ($1,$2,'on_leave',$3)`, [ID.emp, f2a, ID.org]);          // future placeholder
    await S(`INSERT INTO attendance (user_id, date, status, check_in, organization_id) VALUES ($1,$2,'present','09:00',$3)`, [ID.emp, past, ID.org]);  // real past day
    await S(`INSERT INTO attendance (user_id, date, status, organization_id) VALUES ($1,$2,'on_leave',$3)`, [ID.emp, past, ID.org]).catch(() => {});  // (same key: ignored if it conflicts)
    await terminate();
    assert.strictEqual((await S(`SELECT 1 FROM attendance WHERE user_id=$1 AND date=$2`, [ID.emp, f2a])).length, 0, 'future placeholder removed');
    const kept = await one(`SELECT status, check_in FROM attendance WHERE user_id=$1 AND date=$2`, [ID.emp, past]);
    assert.strictEqual(kept.status, 'present'); assert.strictEqual(kept.check_in, '09:00');
    assert.ok(id);
  });
  await t('other employees\' leave is never touched', async () => {
    await reset(); const mine = await leave(ID.emp, f1, f1); const theirs = await leave(ID.other, f1, f1);
    await terminate();
    assert.strictEqual((await getLeave(mine)).status, 'cancelled'); assert.strictEqual((await getLeave(theirs)).status, 'approved');
    assert.strictEqual((await balance(ID.other)).used, 1);
  });

  console.log('\nSAFE TO REPEAT');
  await t('processing the termination again changes nothing and restores nothing twice (balance, rows and audit log are stable)', async () => {
    await reset(); const a = await leave(ID.emp, f1, f1); const b = await leave(ID.emp, addDays(TODAY, -2), addDays(TODAY, 5));
    await terminate();
    const bal1 = await balance(ID.emp); const logs1 = (await logRows(a)).length + (await logRows(b)).length; const rowB = await getLeave(b);
    const again = await terminate();
    assert.strictEqual(again.changes.length, 0); assert.strictEqual(again.restoredDays, 0);
    assert.deepStrictEqual(await balance(ID.emp), bal1);
    assert.strictEqual((await logRows(a)).length + (await logRows(b)).length, logs1, 'no duplicate audit rows');
    assert.deepStrictEqual(await getLeave(b), rowB);
  });

  console.log('\nAUDIT TRAIL');
  await t('each change is logged with actor, reason "employee termination", original range and days restored', async () => {
    await reset(); const id = await leave(ID.emp, f2a, f2b); const sp = await leave(ID.emp, addDays(TODAY, -1), addDays(TODAY, 4));
    await terminate();
    const l = (await logRows(id))[0];
    assert.strictEqual(l.action, 'cancelled'); assert.strictEqual(l.from_status, 'approved'); assert.strictEqual(l.to_status, 'cancelled');
    assert.strictEqual(Number(l.actor_id), ID.hr); assert.strictEqual(l.actor_name, 'HR Term'); assert.ok(l.created_at, 'timestamp');
    assert.match(l.notes, /employee termination/); assert.ok(l.notes.includes(`${f2a}..${f2b}`), 'original range recorded');
    const s = (await logRows(sp))[0];
    assert.match(s.notes, /trimmed/); assert.match(s.notes, /employee termination/);
  });

  console.log('\nEFFECTIVE DATE');
  await t('a future-dated termination keeps leave up to the effective date and removes only what comes after it', async () => {
    await reset(); const eff = nextWeekday(TODAY, 12);
    const keep = await leave(ID.emp, f1, f1);                           // before the effective date
    const drop = await leave(ID.emp, nextWeekday(eff, 3), nextWeekday(eff, 3));   // after it
    await terminate(eff);
    assert.strictEqual((await getLeave(keep)).status, 'approved'); assert.strictEqual((await getLeave(drop)).status, 'cancelled');
  });
  await t('a back-dated termination does NOT cancel leave that is already behind us, and still removes what is ahead', async () => {
    await reset(); const eff = addDays(TODAY, -10);
    const yesterday = await leave(ID.emp, addDays(TODAY, -1), addDays(TODAY, -1)); const ahead = await leave(ID.emp, f1, f1);
    await terminate(eff);
    assert.strictEqual((await getLeave(yesterday)).status, 'approved'); assert.strictEqual((await getLeave(ahead)).status, 'cancelled');
  });

  console.log('\nTHE REAL TERMINATION PATH');
  await t('employeeLifecycle.afterStatusChange(next=terminated) cancels the future leave end to end (exit record included)', async () => {
    await reset(); const id = await leave(ID.emp, f1, f1);
    await S(`UPDATE users SET employee_status='terminated', status='inactive' WHERE id=$1`, [ID.emp]);
    await load('services/employeeLifecycle').afterStatusChange({ orgId: ID.org, userId: ID.emp, prev: 'active', next: 'terminated', actorId: ID.hr });
    assert.strictEqual((await getLeave(id)).status, 'cancelled');
    assert.strictEqual((await one(`SELECT exit_type FROM exit_requests WHERE user_id=$1`, [ID.emp])).exit_type, 'termination');
    const again = await load('services/employeeLifecycle').afterStatusChange({ orgId: ID.org, userId: ID.emp, prev: 'terminated', next: 'terminated', actorId: ID.hr });
    assert.strictEqual(again.changed, false, 'a repeated status write is a no-op');
  });
  await t('a resignation does NOT cancel leave (only terminations do)', async () => {
    await reset(); const id = await leave(ID.emp, f1, f1);
    await S(`UPDATE users SET employee_status='resigned' WHERE id=$1`, [ID.emp]);
    await load('services/employeeLifecycle').afterStatusChange({ orgId: ID.org, userId: ID.emp, prev: 'active', next: 'resigned', actorId: ID.hr });
    assert.strictEqual((await getLeave(id)).status, 'approved');
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All leave-on-termination real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
