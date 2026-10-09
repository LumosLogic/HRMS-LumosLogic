/**
 * attendance_lifecycle_realdb.test.js — attendance ↔ lifecycle propagation fixes, verified against REAL PostgreSQL.
 *
 *   - web check-in/out resolves the employee's per-date shift (the old query matched no column)
 *   - biometric ingestion: late / early-exit flags (same rule as web), live punches of locked accounts ignored,
 *     history & resigned-employee punches untouched
 *   - holiday delete / move undoes the materialised attendance rows (payroll would treat them as absent)
 *   - regularization approval no longer leaves orphan on_leave rows behind
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/attendance_lifecycle_realdb.test.js
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'attendance-realdb-test-secret';

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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(80); } }
const ID = {};
const dstr = (d) => d.toISOString().split('T')[0];
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return dstr(d); };

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['attendance', 'leaves', 'leave_approval_log', 'holidays', 'shifts', 'shift_assignments', 'biometric_raw_logs', 'biometric_employee_map', 'biometric_devices',
                    'attendance_regularization', 'notifications'])
    await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/employee_lifecycle_2026_10_06.sql'), 'utf8'));
  ID.org = (await one(`INSERT INTO organizations (name, slug, attendance_policy) VALUES ('Att Org','att-org','standard') RETURNING id`)).id;
  const user = async (name, role, status = 'active') => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date)
     VALUES ($1,$2,'x',$3,$4,$5,'active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@att.test`, role, ID.org, status])).id;
  ID.root = await user('Root AT', 'root_admin'); ID.hr = await user('HR AT', 'admin');
  ID.emp = await user('Emp AT', 'employee'); ID.emp2 = await user('Emp AT2', 'employee');
  ID.left = await user('Left AT', 'employee', 'terminated');
  ID.resigned = await user('Resigned AT', 'employee', 'resigned');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, late_threshold, early_exit_threshold, half_day_hours, full_day_hours, work_days)
           VALUES ($1,'09:00','18:00','09:30','17:00',4.5,8,'1,2,3,4,5')`, [ID.org]);
  await S(`INSERT INTO biometric_devices (org_id, serial_number, device_name) VALUES ($1,'ATT-1','Gate')`, [ID.org]);
  await S(`INSERT INTO biometric_employee_map (org_id, employee_pin, user_id) VALUES ($1,'11',$2),($1,'12',$3),($1,'13',$4),($1,'14',$5)`, [ID.org, ID.emp, ID.emp2, ID.left, ID.resigned]);
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
}
let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function call(method, url, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const punch = async (pin, when, type = 0) => {
  const handler = load('modules/biometric/biometricPush.handler');
  await handler({ query: { SN: 'ATT-1', table: 'ATTLOG' }, body: {}, headers: { 'content-type': 'text/plain' }, _rawAttlog: `${pin}\t${when}\t${type}\t1\t0\t0\n` }, { send: () => {} });
  await sleep(350);      // the handler processes in setImmediate after replying
};
const att = (uid, d) => one('select * from attendance where user_id=$1 and date=$2', [uid, d]);

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const app = express(); app.use(express.json());
  app.use('/api/holidays', load('modules/holidays/holidays.routes'));
  app.use('/api/regularization', load('modules/regularization/regularization.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nSHIFT: web check-in/out reads the per-date roster');
  await t('getActiveShiftConfig returns the shift assigned to TODAY (it returned null for everyone before)', async () => {
    const sid = (await one(`INSERT INTO shifts (name, start_time, end_time, organization_id, late_threshold) VALUES ('Late Shift','11:00','20:00',$1,'11:15') RETURNING id`, [ID.org])).id;
    const today = dstr(new Date());
    await S(`INSERT INTO shift_assignments (user_id, shift_id, date, organization_id) VALUES ($1,$2,$3,$4)`, [ID.emp, sid, today, ID.org]);
    const cfg = await load('modules/attendance/attendance.routes').getActiveShiftConfig(ID.emp, today);
    assert.ok(cfg, 'shift must be found'); assert.strictEqual(String(cfg.late_threshold).slice(0, 5), '11:15');
    assert.strictEqual(await load('modules/attendance/attendance.routes').getActiveShiftConfig(ID.emp2, today), null, 'no assignment ⇒ org rules');
  });

  console.log('\nBIOMETRIC: late / early-exit flags + locked-account gate');
  await t('standard policy: a punch after the late threshold sets is_late; an on-time punch does not', async () => {
    const d1 = daysAgo(5), d2 = daysAgo(6);
    await punch('11', `${d1} 10:45:00`, 0);
    await punch('12', `${d2} 09:05:00`, 0);
    assert.strictEqual((await att(ID.emp, d1)).is_late, true);
    assert.strictEqual((await att(ID.emp2, d2)).is_late, false);
  });
  await t('standard policy: a check-out before the early-exit threshold sets is_early_exit', async () => {
    const d1 = daysAgo(5);
    await punch('11', `${d1} 16:00:00`, 1);
    const a = await att(ID.emp, d1);
    assert.strictEqual(a.is_early_exit, true); assert.ok(a.check_out);
  });
  await t('FILO policy sets the same flags (and a shift late_threshold overrides the org one)', async () => {
    await S(`UPDATE organizations SET attendance_policy='first_in_last_out' WHERE id=$1`, [ID.org]);
    load('utils/orgPolicy').invalidateOrgPolicyCache(ID.org);
    const d = daysAgo(8);
    await punch('12', `${d} 10:10:00`, 0);
    await punch('12', `${d} 18:30:00`, 1);
    const a = await att(ID.emp2, d);
    assert.strictEqual(a.is_late, true, 'org threshold 09:30');
    assert.strictEqual(a.is_early_exit, false);
    const sid = (await one(`INSERT INTO shifts (name, start_time, end_time, organization_id, late_threshold) VALUES ('Flex','10:00','19:00',$1,'10:30') RETURNING id`, [ID.org])).id;
    const d2 = daysAgo(9);
    await S(`INSERT INTO shift_assignments (user_id, shift_id, date, organization_id) VALUES ($1,$2,$3,$4)`, [ID.emp2, sid, d2, ID.org]);
    await punch('12', `${d2} 10:10:00`, 0);
    await punch('12', `${d2} 19:10:00`, 1);
    assert.strictEqual((await att(ID.emp2, d2)).is_late, false, 'shift threshold 10:30 wins over org 09:30');
  });
  await t('a LIVE punch from a terminated account creates no attendance (raw log kept, marked processed); history of the same account is still importable', async () => {
    const now = new Date();
    const live = `${dstr(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
    await punch('13', live, 0);
    assert.strictEqual(await att(ID.left, dstr(now)), undefined, 'no attendance for a terminated account');
    const raw = await one(`select processed from biometric_raw_logs where employee_pin='13'`);
    assert.strictEqual(raw.processed, true);
    const old = daysAgo(20);
    await punch('13', `${old} 09:00:00`, 0);
    assert.ok(await att(ID.left, old), 'old punches (history) are not gated');
  });
  await t('a RESIGNED employee (notice period) still gets attendance from live punches', async () => {
    const now = new Date();
    const live = `${dstr(now)} 09:00:00`;
    await punch('14', live, 0);
    assert.ok(await att(ID.resigned, dstr(now)));
  });

  console.log('\nHOLIDAY: delete / move undoes the materialised attendance');
  await t('creating a holiday marks attendance; deleting it removes the marker rows but keeps a real punch (status back to present)', async () => {
    const day = daysAgo(2);
    await S(`DELETE FROM attendance WHERE date=$1`, [day]);
    await S(`INSERT INTO attendance (user_id, date, check_in, status, organization_id) VALUES ($1,$2,'09:10','present',$3)`, [ID.emp2, day, ID.org]);
    const h = await call('POST', '/api/holidays', { as: ID.hr, body: { name: 'Temp Holiday', date: day, org_wide: true } });
    assert.strictEqual(h.status, 200, JSON.stringify(h.body));
    const hid = Array.isArray(h.body) ? h.body[0].id : h.body.id;
    assert.ok(await until(async () => (await att(ID.emp, day))?.status === 'holiday'), 'marker row created');
    await S(`UPDATE attendance SET status='holiday' WHERE user_id=$1 AND date=$2`, [ID.emp2, day]);   // a punch on the holiday
    const del = await call('DELETE', `/api/holidays/${hid}`, { as: ID.hr });
    assert.strictEqual(del.status, 200, JSON.stringify(del.body));
    assert.strictEqual(await att(ID.emp, day), undefined, 'marker-only row removed');
    assert.strictEqual((await att(ID.emp2, day)).status, 'present', 'row with a real punch survives and is no longer labelled holiday');
  });
  await t('moving a holiday to another date moves the markers with it', async () => {
    const d1 = daysAgo(3), d2 = daysAgo(4);
    await S(`DELETE FROM attendance WHERE date IN ($1,$2)`, [d1, d2]);
    const h = await call('POST', '/api/holidays', { as: ID.hr, body: { name: 'Move Me', date: d1, org_wide: true } });
    const hid = Array.isArray(h.body) ? h.body[0].id : h.body.id;
    assert.ok(await until(async () => (await att(ID.emp, d1))?.status === 'holiday'));
    const up = await call('PUT', `/api/holidays/${hid}`, { as: ID.hr, body: { name: 'Move Me', date: d2, type: 'public' } });
    assert.strictEqual(up.status, 200, JSON.stringify(up.body));
    assert.ok(await until(async () => (await att(ID.emp, d2))?.status === 'holiday'), 'new date marked');
    assert.strictEqual(await att(ID.emp, d1), undefined, 'old date unmarked');
  });

  console.log('\nREGULARIZATION: correcting a day inside approved leave');
  const leaveRows = () => S(`SELECT id, start_date, end_date, status, leave_time FROM leaves WHERE user_id=$1 ORDER BY start_date, id`, [ID.emp]);
  const correct = async (date, body = { requested_check_in: '09:00', requested_check_out: '18:00' }) => {
    const reg = await call('POST', '/api/regularization', { as: ID.emp, body: { date, reason: 'I actually worked', ...body } });
    assert.strictEqual(reg.status, 200, JSON.stringify(reg.body));
    const rv = await call('PUT', `/api/regularization/${reg.body.id}/review`, { as: ID.hr, body: { status: 'approved', reviewer_notes: 'ok' } });
    assert.strictEqual(rv.status, 200, JSON.stringify(rv.body));
    return reg.body.id;
  };
  await t('a correction needs at least one of check-in / check-out', async () => {
    const r = await call('POST', '/api/regularization', { as: ID.emp, body: { date: '2026-06-10', reason: 'x' } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    const one1 = await call('POST', '/api/regularization', { as: ID.emp, body: { date: '2026-06-10', reason: 'forgot to punch out', requested_check_in: '09:00' } });
    assert.strictEqual(one1.status, 200, 'a single time is enough');
    await S(`DELETE FROM attendance_regularization WHERE user_id=$1`, [ID.emp]);
  });
  await t('multi-day leave: only the corrected day leaves the leave (split), other days keep their cover, 1 day restored', async () => {
    const mon = '2026-06-01', tue = '2026-06-02', wed = '2026-06-03', thu = '2026-06-04', fri = '2026-06-05';
    await S(`DELETE FROM attendance WHERE user_id=$1`, [ID.emp]); await S(`DELETE FROM leaves WHERE user_id=$1`, [ID.emp]);
    await S(`DELETE FROM leave_approval_log`);
    await S(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,$3,$4,'casual','full','approved','x')`, [ID.emp, ID.org, mon, fri]);
    for (const d of [mon, tue, wed, thu, fri]) await S(`INSERT INTO attendance (user_id, date, status, organization_id) VALUES ($1,$2,'on_leave',$3)`, [ID.emp, d, ID.org]);
    const regId = await correct(wed);
    const ls = await leaveRows();
    assert.deepStrictEqual(ls.map(l => [l.start_date, l.end_date, l.status]), [[mon, tue, 'approved'], [thu, fri, 'approved']], JSON.stringify(ls));
    assert.strictEqual((await att(ID.emp, wed)).status, 'present');
    for (const d of [mon, tue, thu, fri]) assert.strictEqual((await att(ID.emp, d)).status, 'on_leave', `${d} keeps its leave cover`);
    const logs = await S(`SELECT leave_id, action, notes FROM leave_approval_log ORDER BY id`);
    assert.ok(logs.length >= 2 && logs.every(l => l.action === 'leave_overridden_by_attendance'), JSON.stringify(logs));
    assert.ok(logs[0].notes.includes(`#${regId}`) && logs[0].notes.includes('1 day restored'), logs[0].notes);
    // repeat edits must not move the balance again: nothing approved covers Wednesday any more
    const before = JSON.stringify(await leaveRows());
    await S(`UPDATE attendance_regularization SET status='pending' WHERE id=$1`, [regId]);
    const again = await call('PUT', `/api/regularization/${regId}/review`, { as: ID.hr, body: { status: 'approved' } });
    assert.strictEqual(again.status, 200, JSON.stringify(again.body));
    assert.strictEqual(JSON.stringify(await leaveRows()), before, 'second approval leaves the leave rows unchanged');
  });
  await t('leave starting on the corrected day is trimmed, not split', async () => {
    await S(`DELETE FROM attendance WHERE user_id=$1`, [ID.emp]); await S(`DELETE FROM leaves WHERE user_id=$1`, [ID.emp]);
    await S(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,'2026-06-08','2026-06-10','casual','full','approved','x')`, [ID.emp, ID.org]);
    await correct('2026-06-08');
    const ls = await leaveRows();
    assert.deepStrictEqual(ls.map(l => [l.start_date, l.end_date, l.status]), [['2026-06-09', '2026-06-10', 'approved']], JSON.stringify(ls));
  });
  await t('single-day and half-day leave are cancelled', async () => {
    await S(`DELETE FROM attendance WHERE user_id=$1`, [ID.emp]); await S(`DELETE FROM leaves WHERE user_id=$1`, [ID.emp]);
    await S(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, half_type, status, reason) VALUES ($1,$2,'2026-06-15','2026-06-15','casual','half','first_half','approved','x')`, [ID.emp, ID.org]);
    await S(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,'2026-06-16','2026-06-16','casual','full','approved','x')`, [ID.emp, ID.org]);
    await correct('2026-06-15'); await correct('2026-06-16');
    assert.deepStrictEqual((await leaveRows()).map(l => l.status), ['cancelled', 'cancelled']);
  });
  await t('a correction on a weekly off leaves an approved leave untouched', async () => {
    await S(`DELETE FROM attendance WHERE user_id=$1`, [ID.emp]); await S(`DELETE FROM leaves WHERE user_id=$1`, [ID.emp]);
    await S(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,'2026-06-19','2026-06-23','casual','full','approved','x')`, [ID.emp, ID.org]); // Fri..Tue, Sat 20th is off
    await correct('2026-06-20');
    const ls = await leaveRows();
    assert.deepStrictEqual(ls.map(l => [l.start_date, l.end_date, l.status]), [['2026-06-19', '2026-06-23', 'approved']], JSON.stringify(ls));
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All attendance-lifecycle real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
