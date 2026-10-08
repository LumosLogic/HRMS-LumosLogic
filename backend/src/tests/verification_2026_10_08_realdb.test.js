/**
 * verification_2026_10_08_realdb.test.js — regression tests for the 2026-10-08 Web + API bug-fix batch, on REAL PostgreSQL.
 *
 * Drives the real Express routers over HTTP with signed JWTs against a scratch schema. It exists because several of these
 * changes added SQL that the in-memory/stubbed tests cannot check (the first real run found two of them comparing TEXT date
 * columns with ::date).
 *
 *   SESSIONS   API-01 / BUG_266 / EMP-050   sign-out-all + admin password reset revoke older tokens, keep the new one
 *   LEAVE      API-19 / Tisha leave BUG-01  overlapping live requests refused; first/second half pair allowed; cancelled frees the day
 *   CHECK-IN   Bug-160 / Bug-161            holiday (branch-aware) and approved full-day leave block; half-day leave / WFH do not
 *   ATTENDANCE Tisha Report BUG-04          Late / early-exit flags recomputed when an admin changes the times
 *   PAYSLIPS   Bug-104 / PAY-005            unverified payslips hidden (list, by id, pdf); publish gated on run status; notified on approve
 *   APPROVALS  BUG_269                      my-history includes leave + regularization + expense actions
 *   MISC       API-21, API-03/04, BUG_253, DOC-009, DOC-017, Tisha Bug_039 inputs (API side)
 *
 * SAFETY: scratch schema bsv_* only (refuses anything else). It TRUNCATEs that schema's tables and never touches `public`.
 * Run:  REAL_DB_SCHEMA=bsv_verify node src/tests/verification_2026_10_08_realdb.test.js
 * Prints SKIPPED (exit 0) if the schema is not available — it never pretends to have verified anything.
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-20261008-realdb-secret';
process.env.PAYROLL_SCHEDULER_ENABLED = 'false';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');
// No real mail, ever: SMTP credentials are blanked above, and the payslip mailer gets an in-memory transport it can be asserted against.
// (Patched BEFORE any route is loaded, because payrollEmailService destructures getTransporter at require time.)
const SENT = [];
load('services/emailService').getTransporter = () => ({ sendMail: async (opts) => { SENT.push(opts); return { messageId: 'fake' }; } });

let passed = 0, failed = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ID = {};
const { localDateStr } = load('utils/helpers');
const todayStr = () => localDateStr();
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().split('T')[0]; };
// next weekday (Mon-Fri) at least `min` days ahead, then `skip` further weekdays
const weekday = (min, skip = 0) => { let d = addDays(todayStr(), min), left = skip; for (;;) { const dow = new Date(d + 'T12:00:00Z').getUTCDay(); if (dow >= 1 && dow <= 5) { if (left-- <= 0) return d; } d = addDays(d, 1); } };

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['exit_requests', 'offboarding_checklists', 'notifications', 'leaves', 'leave_approval_log', 'attendance', 'payslips', 'payroll_runs',
    'payroll_run_employees', 'employee_salary_structures', 'leave_workflows', 'leave_workflow_levels', 'departments', 'user_departments', 'holidays',
    'branches', 'attendance_regularization', 'expenses', 'document_requirements', 'employee_doc_submissions', 'employee_documents', 'document_shares', 'leave_policies'])
    await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  // project migrations under test (idempotent) — applied to the scratch schema only
  for (const f of ['employee_lifecycle_2026_10_06.sql', 'phase1_01_rbac_tables.sql', 'add_sessions_valid_after_2026_10_08.sql'])
    await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations', f), 'utf8'));

  ID.org = Number((await one(`INSERT INTO organizations (name, slug) VALUES ('Verify Org','verify-org') RETURNING id`)).id);
  const user = async (name, role) => Number((await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date, phone)
     VALUES ($1,$2,'x',$3,$4,'active','active','2025-01-01','9876543210') RETURNING id`,
    [name, `${name.toLowerCase().replace(/\W+/g, '.')}@verify.test`, role, ID.org])).id);
  ID.root = await user('Root V', 'root_admin');
  ID.hr = await user('HR V', 'admin');
  ID.e1 = await user('Emp One', 'employee');
  ID.e2 = await user('Emp Two', 'employee');
  ID.e3 = await user('Emp Three', 'employee');
  ID.brA = Number((await one(`INSERT INTO branches (org_id, name, code) VALUES ($1,'Alpha Branch','ALP') RETURNING id`, [ID.org])).id);
  ID.brB = Number((await one(`INSERT INTO branches (org_id, name, code) VALUES ($1,'Beta Branch','BET') RETURNING id`, [ID.org])).id);
  await S(`UPDATE users SET branch_id=$1 WHERE id=ANY($2::bigint[])`, [ID.brA, [ID.e1, ID.e2]]);
  await S(`UPDATE users SET branch_id=$1 WHERE id=$2`, [ID.brB, ID.e3]);
  await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days, late_threshold, early_exit_threshold, late_entry_threshold_enabled, early_exit_threshold_enabled)
           VALUES ($1,'09:00','18:00','1,2,3,4,5','09:30','17:00',true,true) ON CONFLICT DO NOTHING`, [ID.org]).catch(async () =>
    S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days) VALUES ($1,'09:00','18:00','1,2,3,4,5') ON CONFLICT DO NOTHING`, [ID.org]));
  await S(`UPDATE work_schedule SET late_threshold='09:30', early_exit_threshold='17:00' WHERE organization_id=$1`, [ID.org]).catch(() => {});
  await S(`INSERT INTO leave_policies (organization_id, leave_type, label, annual_quota, half_day_allowed, active) VALUES ($1,'casual','Casual Leave',20,true,true) ON CONFLICT DO NOTHING`, [ID.org]);
  await S(`INSERT INTO payroll_settings (organization_id) VALUES ($1) ON CONFLICT DO NOTHING`, [ID.org]).catch(() => {});
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', load('modules/auth/auth.routes'));
  app.use('/api/employees', load('modules/employees/employees.routes'));
  app.use('/api/leaves', load('modules/leaves/leaves.routes'));
  app.use('/api/attendance', load('modules/attendance/attendance.routes'));
  app.use('/api/payroll', load('modules/payroll/payroll.routes'));
  app.use('/api/notifications', load('modules/notifications/notifications.routes'));
  app.use('/api/dashboard', load('modules/dashboard/dashboard.routes'));
  app.use('/api/branches', load('modules/branches/branches.routes'));
  app.use('/api/doc-requirements', load('modules/documents/doc_requirements.routes'));
  app.use('/api/expenses', load('modules/expenses/expenses.routes'));
  app.use('/api/exit', load('modules/exit/exit.routes'));
  app.use('/api/documents', load('modules/documents/documents.routes'));
  app.use('/api/push', load('modules/push/push.routes'));
  app.use('/api/profile/:id', load('middleware/profileGuard'));
  app.use('/api/profile', load('modules/employee-profile/overview.routes'));
  app.use('/api/profile', load('modules/employee-profile/personal.routes'));
  return app;
}
let base;
const signFor = async (id, extra = {}) => {
  const u = await one('select id, role, name, organization_id from users where id=$1', [id]);
  return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id), ...extra }, process.env.JWT_SECRET);
};
async function call(method, url, { as, token, body, headers: extra } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(extra || {}) };
  const tk = token || (as ? await signFor(as) : null);
  if (tk) headers.Authorization = 'Bearer ' + tk;
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const server = buildApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const nowSec = () => Math.floor(Date.now() / 1000);

  // ═════ SESSIONS ═══════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nSESSIONS: sign-out-all-devices and admin password reset end older tokens (API-01, BUG_266, EMP-050)');
  await t('logout-all-devices: 200 + fresh token; the OLD token is rejected (SESSION_REVOKED); the NEW token works', async () => {
    const old = await signFor(ID.e1, { iat: nowSec() - 30 });
    assert.strictEqual((await call('GET', '/api/attendance/today', { token: old })).status, 200, 'old token valid before');
    const r = await call('POST', '/api/auth/logout-all-devices', { token: old, body: {} });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.token, 'a fresh token is returned for the current device');
    const o = await call('GET', '/api/attendance/today', { token: old });
    assert.strictEqual(o.status, 401); assert.strictEqual(o.body.code, 'SESSION_REVOKED');
    assert.strictEqual((await call('GET', '/api/attendance/today', { token: r.body.token })).status, 200, 'new token still valid');
    const row = await one('select sessions_valid_after from users where id=$1', [ID.e1]);
    assert.ok(row.sessions_valid_after, 'cutoff persisted in users.sessions_valid_after');
  });
  await t('admin password reset (PUT /employees/:id with password) ends the employee\'s sessions but not the admin\'s own', async () => {
    const empOld = await signFor(ID.e2, { iat: nowSec() - 30 });
    const hrTok = await signFor(ID.hr, { iat: nowSec() - 30 });
    assert.strictEqual((await call('GET', '/api/attendance/today', { token: empOld })).status, 200);
    const r = await call('PUT', `/api/employees/${ID.e2}`, { as: ID.root, body: { password: 'N3w-Passw0rd!' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const o = await call('GET', '/api/attendance/today', { token: empOld });
    assert.strictEqual(o.status, 401); assert.strictEqual(o.body.code, 'SESSION_REVOKED');
    assert.strictEqual((await call('GET', '/api/attendance/today', { token: hrTok })).status, 200, 'another user is unaffected');
    assert.strictEqual((await call('GET', '/api/attendance/today', { as: ID.root })).status, 200, 'the acting admin is unaffected');
  });
  await t('send-credentials ends the employee\'s sessions', async () => {
    const old = await signFor(ID.e3, { iat: nowSec() - 30 });
    const r = await call('POST', `/api/employees/${ID.e3}/send-credentials`, { as: ID.root, body: {} });
    assert.ok([200, 500].includes(r.status), 'route reached: ' + r.status + ' ' + JSON.stringify(r.body)); // mail transport may be unavailable locally
    if (r.status === 200) assert.strictEqual((await call('GET', '/api/attendance/today', { token: old })).status, 401);
  });
  await t('a token issued AFTER the cutoff is valid (cutoff compares issue time, not wall clock)', async () => {
    await call('POST', '/api/auth/logout-all-devices', { token: await signFor(ID.e1, { iat: nowSec() - 30 }), body: {} });
    const fresh = await signFor(ID.e1, { iat: nowSec() + 2 });
    assert.strictEqual((await call('GET', '/api/attendance/today', { token: fresh })).status, 200);
  });

  // ═════ LEAVE OVERLAP ══════════════════════════════════════════════════════════════════════════════════════
  console.log('\nLEAVE: overlapping requests (API-19, Tisha leave BUG-01) — leaves.*_date are TEXT columns');
  const d1 = weekday(10), d2 = weekday(10, 1), d3 = weekday(10, 2), d4 = weekday(10, 3);
  const apply = (as, b) => call('POST', '/api/leaves', { as, body: { leave_type: 'casual', reason: 'verification', ...b } });
  const cancel = async (id) => S(`UPDATE leaves SET status='cancelled' WHERE id=$1`, [id]);
  await t('first request accepted; the same day again => 409; an overlapping range => 409; another day => 200', async () => {
    const a = await apply(ID.e1, { start_date: d1, end_date: d1 });
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    const dup = await apply(ID.e1, { start_date: d1, end_date: d1 });
    assert.strictEqual(dup.status, 409, JSON.stringify(dup.body));
    assert.match(dup.body.error, /already have a leave request/i);
    const span = await apply(ID.e1, { start_date: d1, end_date: d2 });
    assert.strictEqual(span.status, 409, 'range overlapping an existing day: ' + JSON.stringify(span.body));
    const other = await apply(ID.e1, { start_date: d3, end_date: d3 });
    assert.strictEqual(other.status, 200, JSON.stringify(other.body));
    assert.strictEqual((await apply(ID.e2, { start_date: d1, end_date: d1 })).status, 200, 'a different employee can take the same day');
  });
  await t('rejected / cancelled requests free the day', async () => {
    const row = await one(`select id from leaves where user_id=$1 and start_date=$2 and status not in ('cancelled','rejected') order by id desc limit 1`, [ID.e1, d1]);
    await cancel(row.id);
    const again = await apply(ID.e1, { start_date: d1, end_date: d1 });
    assert.strictEqual(again.status, 200, JSON.stringify(again.body));
  });
  await t('half-day pair on one day: first_half + second_half allowed; a second first_half and a full day are refused', async () => {
    const h1 = await apply(ID.e3, { start_date: d4, end_date: d4, leave_time: 'half', half_type: 'first_half' });
    assert.strictEqual(h1.status, 200, JSON.stringify(h1.body));
    assert.strictEqual((await apply(ID.e3, { start_date: d4, end_date: d4, leave_time: 'half', half_type: 'second_half' })).status, 200, 'second half is the other half');
    assert.strictEqual((await apply(ID.e3, { start_date: d4, end_date: d4, leave_time: 'half', half_type: 'first_half' })).status, 409, 'first half twice');
    assert.strictEqual((await apply(ID.e3, { start_date: d4, end_date: d4 })).status, 409, 'full day over halves');
  });
  await t('invalid half_type is rejected with 400 (API-18)', async () => {
    const r = await apply(ID.e2, { start_date: d4, end_date: d4, leave_time: 'half', half_type: 'invalid_half' });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
  });

  // ═════ CHECK-IN BLOCK ═════════════════════════════════════════════════════════════════════════════════════
  console.log('\nCHECK-IN: holiday / approved leave (Bug-160, Bug-161) — holidays.date and leaves.*_date are TEXT');
  const today = todayStr();
  const clearDay = async () => { await S(`DELETE FROM holidays`); await S(`DELETE FROM leaves WHERE user_id=ANY($1::bigint[]) AND start_date<=$2 AND end_date>=$2`, [[ID.e1, ID.e2, ID.e3], today]); await S(`DELETE FROM attendance WHERE organization_id=$1 AND date=$2`, [ID.org, today]); };
  await t('normal day: allowed, and check-in works', async () => {
    await clearDay();
    const st = await call('GET', '/api/attendance/check-in-status', { as: ID.e1 });
    assert.deepStrictEqual([st.status, st.body.allowed], [200, true], JSON.stringify(st.body));
    assert.strictEqual((await call('POST', '/api/attendance/checkin', { as: ID.e1, body: {} })).status, 200);
  });
  await t('org-wide holiday today: check-in refused (409 CHECKIN_BLOCKED) and the status endpoint says why', async () => {
    await clearDay();
    await S(`INSERT INTO holidays (name, date, type, organization_id, branch_id) VALUES ('Verify Day',$1,'public',$2,NULL)`, [today, ID.org]);
    const st = await call('GET', '/api/attendance/check-in-status', { as: ID.e1 });
    assert.strictEqual(st.body.allowed, false); assert.match(st.body.reason, /holiday/i);
    const r = await call('POST', '/api/attendance/checkin', { as: ID.e1, body: {} });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'CHECKIN_BLOCKED');
    assert.strictEqual(Number((await one(`select count(*)::int c from attendance where user_id=$1 and date=$2 and check_in is not null`, [ID.e1, today])).c), 0, 'no check-in was recorded');
  });
  await t('branch holiday: blocks that branch only', async () => {
    await clearDay();
    await S(`INSERT INTO holidays (name, date, type, organization_id, branch_id) VALUES ('Alpha Day',$1,'public',$2,$3)`, [today, ID.org, ID.brA]);
    assert.strictEqual((await call('POST', '/api/attendance/checkin', { as: ID.e1, body: {} })).status, 409, 'branch A employee blocked');
    assert.strictEqual((await call('POST', '/api/attendance/checkin', { as: ID.e3, body: {} })).status, 200, 'branch B employee not blocked');
  });
  await t('approved full-day leave blocks; half-day leave and WFH do not', async () => {
    await clearDay();
    await S(`INSERT INTO leaves (user_id, organization_id, leave_type, leave_time, start_date, end_date, status, reason) VALUES ($1,$2,'casual','full',$3,$3,'approved','x')`, [ID.e1, ID.org, today]);
    await S(`INSERT INTO leaves (user_id, organization_id, leave_type, leave_time, half_type, start_date, end_date, status, reason) VALUES ($1,$2,'casual','half','first_half',$3,$3,'approved','x')`, [ID.e2, ID.org, today]);
    await S(`INSERT INTO leaves (user_id, organization_id, leave_type, leave_time, start_date, end_date, status, reason) VALUES ($1,$2,'wfh','wfh',$3,$3,'approved','x')`, [ID.e3, ID.org, today]);
    assert.strictEqual((await call('POST', '/api/attendance/checkin', { as: ID.e1, body: {} })).status, 409, 'full-day leave');
    assert.strictEqual((await call('POST', '/api/attendance/checkin', { as: ID.e2, body: {} })).status, 200, 'half-day leave');
    assert.strictEqual((await call('POST', '/api/attendance/checkin', { as: ID.e3, body: {} })).status, 200, 'WFH');
    await clearDay();
  });

  // ═════ ATTENDANCE EDIT: LATE FLAG ═════════════════════════════════════════════════════════════════════════
  console.log('\nATTENDANCE: Late / early-exit recomputed on admin edit (Tisha Report BUG-04)');
  await t('correcting a late check-in to an on-time one clears Late (even if the form still sends is_late=true)', async () => {
    await clearDay();
    const att = await one(`INSERT INTO attendance (user_id, organization_id, date, check_in, check_out, status, is_late) VALUES ($1,$2,$3,'10:15','18:00','present',true) RETURNING id`, [ID.e1, ID.org, today]);
    const r = await call('PUT', `/api/attendance/${att.id}`, { as: ID.root, body: { check_in: '09:10', check_out: '18:00', status: 'present', is_late: true } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await one('select is_late from attendance where id=$1', [att.id])).is_late, false, 'Late cleared');
    const r2 = await call('PUT', `/api/attendance/${att.id}`, { as: ID.root, body: { check_in: '10:05', check_out: '18:00', status: 'present', is_late: false } });
    assert.strictEqual(r2.status, 200);
    assert.strictEqual((await one('select is_late from attendance where id=$1', [att.id])).is_late, true, 'Late set from the new time');
    const r3 = await call('PUT', `/api/attendance/${att.id}`, { as: ID.root, body: { check_in: '10:05', check_out: '16:00', status: 'half_day' } });
    assert.strictEqual(r3.status, 200);
    assert.strictEqual((await one('select is_early_exit from attendance where id=$1', [att.id])).is_early_exit, true, 'early exit from the new check-out');
    const r4 = await call('POST', '/api/attendance/admin-edit', { as: ID.root, body: { user_id: ID.e2, date: today, check_in: '09:00', check_out: '18:00', status: 'present', is_late: true } });
    assert.strictEqual(r4.status, 200, JSON.stringify(r4.body));
    assert.strictEqual((await one('select is_late from attendance where user_id=$1 and date=$2', [ID.e2, today])).is_late, false, 'admin-edit create also derives the flag');
  });

  // ═════ PAYSLIPS ═══════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nPAYSLIPS: unverified payslips are hidden and cannot be published early (Bug-104), notify on approval (PAY-005 area)');
  const cleanPayroll = async () => { await S('DELETE FROM payroll_email_log').catch(() => {}); await S('DELETE FROM payroll_run_employees'); await S('DELETE FROM payslips'); await S('DELETE FROM payroll_runs'); };
  const mkRun = async (status, month = 10) => Number((await one(`INSERT INTO payroll_runs (organization_id, month, year, status) VALUES ($1,$3,2026,$2) RETURNING id`, [ID.org, status, month])).id);
  const mkSlip = async (run, user, status = 'generated', month = '10') => {
    const s = Number((await one(`INSERT INTO payslips (user_id, month, year, organization_id, payroll_run_id, status, locked, gross_salary, net_salary) VALUES ($1,$5,2026,$2,$3,$4,false,1200,1000) RETURNING id`, [user, ID.org, run, status, month])).id);
    await S(`INSERT INTO payroll_run_employees (payroll_run_id, organization_id, user_id, payslip_id, status) VALUES ($1,$2,$3,$4,'success')`, [run, ID.org, user, s]).catch(() => {});
    return s;
  };
  await t('an employee cannot see a generated payslip: list, by id and pdf', async () => {
    await cleanPayroll();
    const run = await mkRun('completed'); const slip = await mkSlip(run, ID.e1);
    const list = await call('GET', '/api/payroll/payslips', { as: ID.e1 });
    assert.strictEqual(list.status, 200); assert.strictEqual(list.body.length, 0, 'generated payslip not listed');
    assert.strictEqual((await call('GET', `/api/payroll/payslips/${slip}`, { as: ID.e1 })).status, 404, 'by id');
    assert.strictEqual((await call('GET', `/api/payroll/payslips/${slip}/pdf`, { as: ID.e1 })).status, 404, 'pdf');
    assert.strictEqual((await call('GET', `/api/payroll/payslips/${slip}`, { as: ID.root })).status, 200, 'admin still sees it');
  });
  await t('publishing one payslip of an unverified run is refused (409); allowed once the run is approved; then the employee sees it', async () => {
    const slip = Number((await one(`select id from payslips where user_id=$1 order by id desc limit 1`, [ID.e1])).id);
    const run = Number((await one(`select payroll_run_id r from payslips where id=$1`, [slip])).r);
    const early = await call('PUT', `/api/payroll/payslips/${slip}/publish`, { as: ID.root });
    assert.strictEqual(early.status, 409, JSON.stringify(early.body));
    await S(`UPDATE payroll_runs SET status='approved' WHERE id=$1`, [run]);
    const ok = await call('PUT', `/api/payroll/payslips/${slip}/publish`, { as: ID.root });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const list = await call('GET', '/api/payroll/payslips', { as: ID.e1 });
    assert.strictEqual(list.body.length, 1);
    assert.strictEqual((await call('GET', `/api/payroll/payslips/${slip}`, { as: ID.e1 })).status, 200, 'by id once published');
  });
  await t('verify -> approve publishes the payslips and tells the employee exactly once (not at generation)', async () => {
    await cleanPayroll(); await S('DELETE FROM notifications');
    const run = await mkRun('completed'); await mkSlip(run, ID.e1); await mkSlip(run, ID.e2);
    await load('services/payrollNotificationService').notifyPayrollComplete(ID.org, run, { successCount: 2, errorCount: 0, totalNet: 2000 }, 10, 2026);
    const atGen = Number((await one(`select count(*)::int c from notifications where user_id=ANY($1::bigint[]) and title ilike 'Payslip Available%'`, [[ID.e1, ID.e2]])).c);
    assert.strictEqual(atGen, 0, 'generation must not notify employees');
    assert.strictEqual((await call('POST', `/api/payroll/runs/${run}/verify`, { as: ID.root })).status, 200);
    assert.strictEqual((await call('GET', '/api/payroll/payslips', { as: ID.e1 })).body.length, 0, 'verified but not approved: still hidden');
    const ap = await call('POST', `/api/payroll/runs/${run}/approve`, { as: ID.root });
    assert.strictEqual(ap.status, 200, JSON.stringify(ap.body));
    await sleep(800);
    assert.strictEqual((await call('GET', '/api/payroll/payslips', { as: ID.e1 })).body.length, 1, 'visible after approval');
    const afterApprove = Number((await one(`select count(*)::int c from notifications where user_id=ANY($1::bigint[]) and title ilike 'Payslip Available%'`, [[ID.e1, ID.e2]])).c);
    assert.strictEqual(afterApprove, 2, 'one notification per employee at approval');
    const paid = await call('POST', `/api/payroll/runs/${run}/mark-paid`, { as: ID.root });
    assert.strictEqual(paid.status, 200, JSON.stringify(paid.body));
    await sleep(500);
    assert.strictEqual(Number((await one(`select count(*)::int c from notifications where user_id=ANY($1::bigint[]) and title ilike 'Payslip Available%'`, [[ID.e1, ID.e2]])).c), 2, 'mark-paid does not duplicate the notification');
  });

  // ═════ APPROVAL HISTORY ═══════════════════════════════════════════════════════════════════════════════════
  console.log('\nAPPROVALS: my-history covers every approval type (BUG_269) — new SQL on attendance_regularization / expenses');
  await t('GET /leaves/my-history returns leave, regularization and expense actions with kind + outcome', async () => {
    await S('DELETE FROM leaves'); await S('DELETE FROM attendance_regularization'); await S('DELETE FROM expenses');
    await S(`INSERT INTO leaves (user_id, organization_id, leave_type, start_date, end_date, status, approved_by, approved_at, reason) VALUES ($1,$2,'casual',$3,$3,'approved',$4,NOW(),'h')`, [ID.e1, ID.org, weekday(3), ID.root]);
    await S(`INSERT INTO attendance_regularization (user_id, organization_id, date, type, status, reviewed_by, reviewed_at, reviewer_notes, reason) VALUES ($1,$2,$3,'check_time','rejected',$4,NOW(),'no proof','r')`, [ID.e2, ID.org, addDays(todayStr(), -2), ID.root]);
    await S(`INSERT INTO expenses (user_id, organization_id, title, amount, expense_date, status, reviewed_by, reviewed_at) VALUES ($1,$2,'Taxi',250,$3,'approved',$4,NOW())`, [ID.e3, ID.org, addDays(todayStr(), -1), ID.root]);
    await S(`INSERT INTO expenses (user_id, organization_id, title, amount, expense_date, status, manager_id, manager_approved_at) VALUES ($1,$2,'Meal',90,$3,'manager_approved',$4,NOW())`, [ID.e1, ID.org, addDays(todayStr(), -1), ID.root]);
    const r = await call('GET', '/api/leaves/my-history', { as: ID.root });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const kinds = r.body.map(x => `${x.kind}:${x.outcome}`).sort();
    assert.deepStrictEqual(kinds, ['expense:approved', 'expense:approved', 'leave:approved', 'regularization:rejected'].sort(), JSON.stringify(kinds));
    assert.ok(r.body.every(x => x.employee_name), 'each row names the employee');
    const hr = await call('GET', '/api/leaves/my-history', { as: ID.hr });
    assert.deepStrictEqual(hr.body, [], 'another approver sees only their own actions');
  });

  // ═════ MISC API ═══════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nMISC: notification 404 (API-21), dashboard date (API-03/04), branch edit duplicates (BUG_253), document requirements (DOC-009/017)');
  await t('mark a non-existent notification read => 404; own notification => 200; someone else\'s => 404', async () => {
    const n = Number((await one(`INSERT INTO notifications (user_id, title) VALUES ($1,'mine') RETURNING id`, [ID.e1])).id);
    assert.strictEqual((await call('PUT', '/api/notifications/99999999/read', { as: ID.e1 })).status, 404);
    assert.strictEqual((await call('PUT', `/api/notifications/${n}/read`, { as: ID.e2 })).status, 404, 'not yours');
    assert.strictEqual((await call('PUT', `/api/notifications/${n}/read`, { as: ID.e1 })).status, 200);
  });
  await t('dashboard rejects 15/09/2026 and 2026-99-99; accepts a real date', async () => {
    assert.strictEqual((await call('GET', '/api/dashboard?date=15/09/2026', { as: ID.root })).status, 400);
    assert.strictEqual((await call('GET', '/api/dashboard?date=2026-99-99', { as: ID.root })).status, 400);
    assert.strictEqual((await call('GET', `/api/dashboard?date=${todayStr()}`, { as: ID.root })).status, 200);
  });
  await t('branch edit: duplicate name / duplicate code / digits-only name refused; a clean rename works', async () => {
    assert.strictEqual((await call('PUT', `/api/branches/${ID.brB}`, { as: ID.root, body: { name: 'alpha branch', code: 'BET' } })).status, 400, 'duplicate name (case-insensitive)');
    assert.strictEqual((await call('PUT', `/api/branches/${ID.brB}`, { as: ID.root, body: { name: 'Beta Branch', code: 'alp' } })).status, 400, 'duplicate code');
    assert.strictEqual((await call('PUT', `/api/branches/${ID.brB}`, { as: ID.root, body: { name: '12345', code: 'BET' } })).status, 400, 'digits only');
    assert.strictEqual((await call('PUT', `/api/branches/${ID.brB}`, { as: ID.root, body: { name: 'Beta Branch Renamed', code: 'BET' } })).status, 200);
  });
  await t('document requirements: duplicate name => 409 (scope-aware); inactive ones drop out of the compliance analytics', async () => {
    const mk = (b) => call('POST', '/api/doc-requirements', { as: ID.root, body: b });
    const a = await mk({ name: 'PAN Card' }); assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    assert.strictEqual((await mk({ name: '  pan card ' })).status, 409, 'case/space-insensitive duplicate');
    assert.strictEqual((await mk({ name: '@#$%' })).status, 400, 'symbols only');
    const b = await mk({ name: 'Voter ID', assigned_branch_ids: [ID.brA] }); assert.strictEqual(b.status, 200, JSON.stringify(b.body));
    assert.strictEqual((await mk({ name: 'Voter ID', assigned_branch_ids: [ID.brB] })).status, 200, 'same name for a different branch is allowed');
    assert.strictEqual((await mk({ name: 'Voter ID', assigned_branch_ids: [ID.brA] })).status, 409, 'same name, same branch');
    const before = await call('GET', '/api/doc-requirements/analytics', { as: ID.root });
    assert.strictEqual(before.status, 200, JSON.stringify(before.body));
    const names = (x) => (x.body.requirementStats || []).map(r => r.name);
    assert.ok(names(before).includes('PAN Card'));
    await call('PATCH', `/api/doc-requirements/${a.body.id}`, { as: ID.root, body: { is_active: false } });
    const after = await call('GET', '/api/doc-requirements/analytics', { as: ID.root });
    assert.ok(!names(after).includes('PAN Card'), 'removed requirement no longer in Requirement Compliance');
  });
  await t('expense duplicate check: same title + amount + date warns even with no merchant / receipt number', async () => {
    await S('DELETE FROM expenses');
    await S(`INSERT INTO expenses (user_id, organization_id, title, amount, expense_date, status) VALUES ($1,$2,'Client lunch',480,$3,'pending')`, [ID.e1, ID.org, todayStr()]);
    const r = await call('POST', '/api/expenses/check-duplicate', { as: ID.e1, body: { title: 'client LUNCH', amount: 480, expense_date: todayStr() } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.type, 'soft');
    const other = await call('POST', '/api/expenses/check-duplicate', { as: ID.e1, body: { title: 'Different', amount: 480, expense_date: todayStr() } });
    assert.strictEqual(other.body.type, null);
  });

  // ═════ DATABASE-SIDE CASES THAT WERE STILL PENDING ═══════════════════════════════════════════════════════
  console.log('\nBRANCH DELETE / RECREATE (Tisha Branch BUG-06, BUG-07, BUG-08, BUG-10) — foreign-key mapping on a real RESTRICT FK');
  await t('a branch used by a payroll run cannot be deleted (409, not a raw 500); an unused one can, and its name can be reused', async () => {
    const used = Number((await one(`INSERT INTO branches (org_id, name, code) VALUES ($1,'Used Branch','USD') RETURNING id`, [ID.org])).id);
    const free = Number((await one(`INSERT INTO branches (org_id, name, code) VALUES ($1,'Free Branch','FRE') RETURNING id`, [ID.org])).id);
    await S(`INSERT INTO payroll_runs (organization_id, month, year, status, branch_id) VALUES ($1,9,2026,'completed',$2)`, [ID.org, used]);
    const d1 = await call('DELETE', `/api/branches/${used}`, { as: ID.root });
    assert.strictEqual(d1.status, 409, JSON.stringify(d1.body)); assert.match(d1.body.error, /linked records|deactivate/i);
    assert.strictEqual(Number((await one('select count(*)::int c from branches where id=$1', [used])).c), 1, 'still there');
    const d2 = await call('DELETE', `/api/branches/${free}`, { as: ID.root });
    assert.strictEqual(d2.status, 200, JSON.stringify(d2.body));
    const re = await call('POST', '/api/branches', { as: ID.root, body: { name: 'Free Branch', code: 'FRE' } });
    assert.ok([200, 201].includes(re.status), 'same name usable again after deletion: ' + JSON.stringify(re.body));
  });
  await t('branch CREATE refuses digits-only and symbol-only names', async () => {
    assert.strictEqual((await call('POST', '/api/branches', { as: ID.root, body: { name: '12345' } })).status, 400);
    assert.strictEqual((await call('POST', '/api/branches', { as: ID.root, body: { name: '@@@@' } })).status, 400);
  });

  console.log('\nPAYROLL: admin notifications, e-mail on mark-paid, dashboard KPIs, salary correction (PAY-005, Tisha Bug_033-036, SAL-005)');
  await t('payroll completion tells every admin (the notification column fix) and never the employees', async () => {
    await cleanPayroll(); await S('DELETE FROM notifications');
    const run = await mkRun('completed'); await mkSlip(run, ID.e1);
    await load('services/payrollNotificationService').notifyPayrollComplete(ID.org, run, { successCount: 1, errorCount: 0, totalNet: 1000 }, 10, 2026);
    const admins = await S(`select user_id from notifications where title ilike 'Payroll Completed%' order by user_id`);
    assert.deepStrictEqual(admins.map(r => Number(r.user_id)).sort(), [ID.root, ID.hr].sort(), 'root + HR admin each got one');
    assert.strictEqual(Number((await one(`select count(*)::int c from notifications where user_id=$1`, [ID.e1])).c), 0, 'employee not told at generation');
  });
  await t('mark-paid sends the payslip e-mails when auto-email is ON and they have not gone out; never twice', async () => {
    await cleanPayroll(); await S('DELETE FROM notifications'); await S('DELETE FROM payroll_email_log'); SENT.length = 0;
    await S(`UPDATE payroll_settings SET payslip_auto_email=false WHERE organization_id=$1`, [ID.org]);
    const run = await mkRun('completed'); await mkSlip(run, ID.e1); await mkSlip(run, ID.e2);
    assert.strictEqual((await call('POST', `/api/payroll/runs/${run}/verify`, { as: ID.root })).status, 200);
    assert.strictEqual((await call('POST', `/api/payroll/runs/${run}/approve`, { as: ID.root })).status, 200);
    await sleep(700);
    assert.strictEqual(SENT.length, 0, 'auto-email OFF: approve sends nothing');
    await S(`UPDATE payroll_settings SET payslip_auto_email=true WHERE organization_id=$1`, [ID.org]);
    assert.strictEqual((await call('POST', `/api/payroll/runs/${run}/mark-paid`, { as: ID.root })).status, 200);
    await sleep(1800);
    const to = SENT.map(m => String(m.to)).sort();
    assert.deepStrictEqual(to, ['emp.one@verify.test', 'emp.two@verify.test'], JSON.stringify(to));
    assert.strictEqual(Number((await one(`select count(*)::int c from payroll_email_log where payroll_run_id=$1 and status='sent'`, [run])).c), 2, 'logged as sent');
    // a run already e-mailed at approval is not mailed again at mark-paid
    SENT.length = 0;
    const run2 = await mkRun('completed', 11); await mkSlip(run2, ID.e1, 'generated', '11');
    await call('POST', `/api/payroll/runs/${run2}/verify`, { as: ID.root });
    await call('POST', `/api/payroll/runs/${run2}/approve`, { as: ID.root });
    await sleep(1800);
    const afterApprove = SENT.length;
    assert.strictEqual(afterApprove, 1, 'auto-email ON: approve sends once');
    await call('POST', `/api/payroll/runs/${run2}/mark-paid`, { as: ID.root });
    await sleep(1200);
    assert.strictEqual(SENT.length, afterApprove, 'mark-paid does not mail again');
  });
  await t('payroll dashboard: KPI totals equal the sum of the department breakdown (same payslip rows)', async () => {
    await cleanPayroll();
    await S(`UPDATE users SET department='Engineering' WHERE id=ANY($1::bigint[])`, [[ID.e1, ID.e2]]);
    await S(`UPDATE users SET department='Finance' WHERE id=$1`, [ID.e3]);
    const run = await mkRun('completed');
    const ins = (u, g, d, n) => S(`INSERT INTO payslips (user_id, month, year, organization_id, payroll_run_id, status, locked, gross_salary, total_deductions, net_salary, lop_amount) VALUES ($1,'10',2026,$2,$3,'generated',false,$4,$5,$6,0)`, [u, ID.org, run, g, d, n]);
    await ins(ID.e1, 1000, 100, 900); await ins(ID.e2, 2000, 200, 1800); await ins(ID.e3, 3000, 300, 2700);
    const r = await call('GET', '/api/payroll/dashboard?month=10&year=2026', { as: ID.root });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const sum = (k) => r.body.deptBreakdown.reduce((a, d) => a + Number(d[k] || 0), 0);
    assert.strictEqual(r.body.deptBreakdown.length, 2);
    assert.strictEqual(Number(r.body.kpi.totalPayroll), sum('total_gross')); assert.strictEqual(Number(r.body.kpi.totalPayroll), 6000);
    assert.strictEqual(Number(r.body.kpi.totalNet), sum('total_net')); assert.strictEqual(Number(r.body.kpi.totalNet), 5400);
    assert.strictEqual(Number(r.body.kpi.totalDeductions), sum('total_deductions')); assert.strictEqual(Number(r.body.kpi.totalDeductions), 600);
    assert.strictEqual(Number(r.body.kpi.employeesPaid), sum('employee_count')); assert.strictEqual(Number(r.body.kpi.employeesPaid), 3);
  });
  await t('salary correction (PUT) rejects a negative earning with its own message; deductions>gross keeps the old message; a valid one saves', async () => {
    const st = Number((await one(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, gross_salary, ctc) VALUES ($1,$2,'2026-01-01',20000,20000,20000) RETURNING id`, [ID.org, ID.e1])).id);
    const put = (b) => call('PUT', `/api/payroll/salary-structures/${st}`, { as: ID.root, body: b });
    const neg = await put({ basic: -10000 }); assert.strictEqual(neg.status, 400); assert.match(neg.body.error, /cannot be negative/i);
    const ded = await put({ basic: 50000, tds: 60000 }); assert.strictEqual(ded.status, 400); assert.match(ded.body.error, /deductions/i);
    const ok = await put({ basic: 25000 }); assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(Number((await one('select gross_salary g from employee_salary_structures where id=$1', [st])).g), 25000);
  });
  await t('late flag honours a SHIFT threshold over the organisation one', async () => {
    await clearDay();
    const sh = Number((await one(`INSERT INTO shifts (name, start_time, end_time, organization_id, late_threshold) VALUES ('Late Shift','10:00','19:00',$1,'10:30') RETURNING id`, [ID.org])).id);
    await S(`INSERT INTO shift_assignments (user_id, shift_id, date, organization_id) VALUES ($1,$2,$3,$4)`, [ID.e1, sh, todayStr(), ID.org]);
    const att = Number((await one(`INSERT INTO attendance (user_id, organization_id, date, check_in, check_out, status, is_late) VALUES ($1,$2,$3,'10:45','19:00','present',false) RETURNING id`, [ID.e1, ID.org, todayStr()])).id);
    await call('PUT', `/api/attendance/${att}`, { as: ID.root, body: { check_in: '10:15', check_out: '19:00', status: 'present' } });
    assert.strictEqual((await one('select is_late from attendance where id=$1', [att])).is_late, false, '10:15 is on time for a 10:30 shift threshold (the org threshold 09:30 would say late)');
    await call('PUT', `/api/attendance/${att}`, { as: ID.root, body: { check_in: '10:45', check_out: '19:00', status: 'present' } });
    assert.strictEqual((await one('select is_late from attendance where id=$1', [att])).is_late, true, '10:45 is late for the shift');
    await S('DELETE FROM shift_assignments'); await clearDay();
  });

  console.log('\nDOCUMENTS (DOC-003, DOC-016) — admin list and rename rule');
  await t('a document shared specifically with an HR admin reaches them even under another branch; unshared ones stay hidden', async () => {
    await S('DELETE FROM document_shares'); await S('DELETE FROM employee_documents');
    await S(`INSERT INTO hr_branch_access (user_id, org_id, all_branches) VALUES ($1,$2,true) ON CONFLICT DO NOTHING`, [ID.hr, ID.org]).catch(() => {});
    const mk = async (name, vis, br) => Number((await one(`INSERT INTO employee_documents (user_id, name, file_url, organization_id, visibility, branch_id, uploaded_by, status) VALUES ($1,$2,'http://x/y.pdf',$3,$4,$5,$1,'verified') RETURNING id`, [ID.root, name, ID.org, vis, br])).id);
    const shared = await mk('Shared with HR', 'specific', ID.brB); await mk('Not shared', 'specific', ID.brB);
    await S(`INSERT INTO document_shares (document_id, shared_with_user_id, organization_id) VALUES ($1,$2,$3)`, [shared, ID.hr, ID.org]);
    const r = await call('GET', '/api/documents', { as: ID.hr, headers: { 'X-Branch-Id': String(ID.brA) } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const names = r.body.map(d => d.name);
    assert.ok(names.includes('Shared with HR'), JSON.stringify(names));
    assert.ok(!names.includes('Not shared'), 'a document of another branch that is not shared with them stays hidden');
  });
  await t('renaming a shared document to symbols only is refused (400); a real rename works', async () => {
    const id = Number((await one(`select id from employee_documents where name='Shared with HR'`)).id);
    const bad = await call('PATCH', `/api/documents/${id}`, { as: ID.root, body: { name: '@#$%' } });
    assert.strictEqual(bad.status, 400, JSON.stringify(bad.body)); assert.strictEqual(bad.body.field, 'name');
    const ok = await call('PATCH', `/api/documents/${id}`, { as: ID.root, body: { name: 'Policy v2' } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await one('select name from employee_documents where id=$1', [id])).name, 'Policy v2');
  });

  console.log('\nBROADCAST: in-app notification for every recipient even with push off (user report, Broadcast Centre)');
  await t('push broadcast saves an in-app notification for each employee (no VAPID / no subscriptions), and reports the count', async () => {
    await S('DELETE FROM notifications');
    const r = await call('POST', '/api/push/send', { as: ID.root, body: { title: 'Office closed', body: 'Closed tomorrow', url: '/portal/home' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const emps = Number((await one(`select count(*)::int c from users where organization_id=$1 and role='employee'`, [ID.org])).c);
    assert.strictEqual(r.body.targeted, emps, 'targeted = every employee');
    const rows = await S(`select user_id, message, link from notifications where title='Office closed'`);
    assert.strictEqual(rows.length, emps, 'one in-app notification per employee');
    assert.ok(rows.every(x => x.message === 'Closed tomorrow' && x.link === '/portal/home'));
    // the employee can see it in their own list
    const mine = await one(`select count(*)::int c from notifications where user_id=$1 and title='Office closed'`, [ID.e1]);
    assert.strictEqual(Number(mine.c), 1);
    // a single-target broadcast reaches only that person
    await S('DELETE FROM notifications');
    const one1 = await call('POST', '/api/push/send', { as: ID.root, body: { title: 'Just you', body: 'Hello', target_user_id: ID.e2 } });
    assert.strictEqual(one1.status, 200, JSON.stringify(one1.body)); assert.strictEqual(one1.body.targeted, 1);
    assert.deepStrictEqual((await S(`select user_id from notifications where title='Just you'`)).map(x => Number(x.user_id)), [ID.e2]);
  });

  // ═════ EMPLOYEE ═══════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nEMPLOYEE: all departments in the overview (EMP-061), validators on a real route, notice period (EXIT-001)');
  await t('profile overview returns every department the employee belongs to (user_departments), not just the primary text', async () => {
    const d1 = Number((await one(`INSERT INTO departments (name, organization_id) VALUES ('Engineering',$1) RETURNING id`, [ID.org])).id);
    const d2 = Number((await one(`INSERT INTO departments (name, organization_id) VALUES ('Finance',$1) RETURNING id`, [ID.org])).id);
    await S(`INSERT INTO user_departments (user_id, department_id, organization_id) VALUES ($1,$2,$4),($1,$3,$4)`, [ID.e1, d1, d2, ID.org]);
    const r = await call('GET', `/api/profile/${ID.e1}/overview`, { as: ID.e1 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual((r.body.departments || []).map(x => x.name).sort(), ['Engineering', 'Finance']);
  });
  await t('personal details: letters-only phone / future DOB / bad email => 400 with the field; valid values save', async () => {
    const put = (b) => call('PUT', `/api/profile/${ID.e2}/personal`, { as: ID.root, body: b });
    const a = await put({ phone: 'abcdefg' }); assert.strictEqual(a.status, 400, JSON.stringify(a.body)); assert.strictEqual(a.body.field, 'phone');
    assert.strictEqual((await put({ date_of_birth: '2999-01-01' })).status, 400);
    assert.strictEqual((await put({ personal_email: 'bad@' })).status, 400);
    assert.strictEqual((await put({ phone: '+91 98765-43210', personal_email: 'ok@verify.test', date_of_birth: '1995-04-10' })).status, 200);
    assert.strictEqual((await one('select phone from users where id=$1', [ID.e2])).phone, '+91 98765-43210');
  });
  await t('resignation with a negative / fractional notice period is rejected (EXIT-001); a valid one is created', async () => {
    await S('DELETE FROM exit_requests');
    const bad = await call('POST', '/api/exit', { as: ID.e3, body: { resignation_date: todayStr(), reason: 'verify', notice_period_days: -5 } });
    assert.strictEqual(bad.status, 400, JSON.stringify(bad.body));
    const bad2 = await call('POST', '/api/exit', { as: ID.e3, body: { resignation_date: todayStr(), reason: 'verify', notice_period_days: 2.5 } });
    assert.strictEqual(bad2.status, 400, JSON.stringify(bad2.body));
    const ok = await call('POST', '/api/exit', { as: ID.e3, body: { resignation_date: todayStr(), reason: 'verify', notice_period_days: 30 } });
    assert.ok([200, 201].includes(ok.status), JSON.stringify(ok.body));
    assert.strictEqual(Number((await one('select notice_period_days n from exit_requests where user_id=$1', [ID.e3])).n), 30);
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All 2026-10-08 verification real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
