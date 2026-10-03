/**
 * branch_realdb.test.js — branch separation verified against REAL PostgreSQL.
 *
 * Unlike branch_http.test.js (in-memory fake DB), this drives the real Express routers, the real
 * RBAC (system roles seeded by phase1_01_rbac_tables.sql), the real biometric ingestion handler, the
 * real payroll engine/scheduler and the real configuration-group service against an actual database.
 *
 * SAFETY: it only ever runs inside a SCRATCH schema named bsv_* (it refuses anything else) and it
 * TRUNCATES that schema's tables. It never touches `public`.
 *
 * Prepare the scratch schema (replays the project's schema migrations, ~1 min):
 *     node <tools>/build_scratch.js create bsv_verify        (see docs / final report)
 * Run:
 *     REAL_DB_SCHEMA=bsv_verify node src/tests/branch_realdb.test.js
 * Needs DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD (root .env). If the schema is missing the suite
 * prints SKIPPED and exits 0 — it never pretends to have verified anything.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;          // every pool in the app (and this test) resolves tables here
process.env.JWT_SECRET = process.env.JWT_SECRET || 'branch-realdb-test-secret';
process.env.PAYROLL_SCHEDULER_ENABLED = 'false';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));

const { pool } = load('config/db');

let passed = 0, failed = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000, step = 80) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }

// ── ids (filled during seed) ─────────────────────────────────────────────────────────────────
const ID = {};

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users, branches RESTART IDENTITY CASCADE`);
  for (const t of ['biometric_historical_sync_jobs', 'biometric_raw_logs', 'biometric_employee_map', 'biometric_devices', 'payroll_run_employees', 'payslips', 'payroll_runs',
                   'payroll_scheduler_runs', 'employee_salary_structures', 'attendance', 'attendance_regularization', 'leaves', 'leave_approval_log', 'leave_comments'])
    await S(`TRUNCATE ${t} RESTART IDENTITY CASCADE`).catch(() => {});
  // the project's own idempotent migration — also the migration under test
  const mig = fs.readFileSync(path.join(__dirname, '../../migrations/branch_separation_2026_10_03.sql'), 'utf8');
  await pool.query(mig);

  const org = async (name, slug) => (await one(`INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`, [name, slug])).id;
  ID.orgA = await org('Org A', 'org-a'); ID.orgB = await org('Org B', 'org-b'); ID.orgC = await org('Org C (no branches)', 'org-c');
  const br = async (o, name, code) => (await one(`INSERT INTO branches (org_id, name, code, is_active) VALUES ($1,$2,$3,true) RETURNING id`, [o, name, code])).id;
  ID.dalal = await br(ID.orgA, 'Dalal', 'DAL'); ID.bhuj = await br(ID.orgA, 'Bhuj', 'BHJ'); ID.ahm = await br(ID.orgA, 'Ahmedabad', 'AHM');
  ID.foreignBr = await br(ID.orgB, 'Foreign', 'FOR');

  const user = async (o, name, role, branch, extra = {}) => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, branch_id, employee_status, status, joining_date, employee_id)
     VALUES ($1,$2,'x',$3,$4,$5,'active','active','2025-01-01',$6) RETURNING id`,
    [name, `${name.toLowerCase().replace(/\W+/g, '.')}@t.com`, role, o, branch, extra.employee_id || null])).id;
  ID.root = await user(ID.orgA, 'Root A', 'root_admin', null);
  ID.hrD = await user(ID.orgA, 'HR Dalal', 'admin', null);
  ID.hrB = await user(ID.orgA, 'HR Bhuj', 'admin', null);
  ID.hrAll = await user(ID.orgA, 'HR All', 'admin', null);
  ID.empD = await user(ID.orgA, 'Emp Dalal', 'employee', ID.dalal, { employee_id: 'D001' });
  ID.empB = await user(ID.orgA, 'Emp Bhuj', 'employee', ID.bhuj, { employee_id: 'B001' });
  ID.empB2 = await user(ID.orgA, 'Emp Bhuj Two', 'employee', ID.bhuj, { employee_id: 'B002' });
  ID.head = await user(ID.orgA, 'Head Dalal', 'employee', ID.dalal, { employee_id: 'D002' });
  ID.froot = await user(ID.orgB, 'Foreign Root', 'root_admin', null);
  ID.femp = await user(ID.orgB, 'Foreign Emp', 'employee', ID.foreignBr);
  ID.empC = await user(ID.orgC, 'Emp C', 'employee', null);
  ID.rootC = await user(ID.orgC, 'Root C', 'root_admin', null);

  await S(`INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches) VALUES ($1,$2,$3,false),($4,$2,$5,false),($6,$2,NULL,true)`,
    [ID.hrD, ID.orgA, ID.dalal, ID.hrB, ID.bhuj, ID.hrAll]);

  // real RBAC: the project's migration creates system roles per org and backfills user_roles from users.role
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  await S(`INSERT INTO organization_features (organization_id, feature_key, enabled) VALUES ($1,'branches',true),($2,'branches',true),($3,'branches',false)`, [ID.orgA, ID.orgB, ID.orgC]);
  for (const o of [ID.orgA, ID.orgB, ID.orgC]) {
    await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days) VALUES ($1,'09:00','18:00','1,2,3,4,5') ON CONFLICT DO NOTHING`, [o]);
    await S(`INSERT INTO leave_policies (organization_id, leave_type, label, annual_quota) VALUES ($1,'casual','Casual Leave',8),($1,'sick','Sick Leave',12) ON CONFLICT DO NOTHING`, [o]);
    await S(`INSERT INTO payroll_settings (organization_id) VALUES ($1) ON CONFLICT DO NOTHING`, [o]).catch(() => {});
  }
  // shifts / holidays / assets / announcements
  const shift = async (n, br) => (await one(`INSERT INTO shifts (name, start_time, end_time, organization_id, branch_id) VALUES ($1,'09:00','18:00',$2,$3) RETURNING id`, [n, ID.orgA, br])).id;
  ID.shiftD = await shift('Dalal Day', ID.dalal); ID.shiftB = await shift('Bhuj Day', ID.bhuj); ID.shiftG = await shift('General', null);
  await S(`INSERT INTO holidays (organization_id, branch_id, name, date, type) VALUES ($1,NULL,'Republic Day','2026-01-26','public'),($1,$2,'Dalal Founding','2026-03-01','company'),($1,$3,'Bhuj Fair','2026-11-04','company')`, [ID.orgA, ID.dalal, ID.bhuj]);
  ID.assetD = (await one(`INSERT INTO assets (name, organization_id, branch_id, asset_tag, status, assigned_to) VALUES ('Laptop D',$1,$2,'dal_001','assigned',$3) RETURNING id`, [ID.orgA, ID.dalal, ID.empD])).id;
  ID.assetB = (await one(`INSERT INTO assets (name, organization_id, branch_id, asset_tag, status, assigned_to) VALUES ('Laptop B',$1,$2,'bhj_001','assigned',$3) RETURNING id`, [ID.orgA, ID.bhuj, ID.empB])).id;
  await S(`INSERT INTO announcements (organization_id, title, content, target_audience, created_by, branch_ids) VALUES ($1,'Org-wide','c','all',$2,NULL),($1,'Dalal only','c','all',$2,$3)`, [ID.orgA, ID.root, [ID.dalal]]);
  // biometric devices: device branch = physical location. PIN map = employee ownership.
  ID.devD = (await one(`INSERT INTO biometric_devices (org_id, serial_number, device_name, branch_id) VALUES ($1,'DAL-1','Dalal Gate',$2) RETURNING id`, [ID.orgA, ID.dalal])).id;
  ID.devB = (await one(`INSERT INTO biometric_devices (org_id, serial_number, device_name, branch_id) VALUES ($1,'BHJ-1','Bhuj Gate',$2) RETURNING id`, [ID.orgA, ID.bhuj])).id;
  await S(`INSERT INTO biometric_employee_map (org_id, employee_pin, user_id) VALUES ($1,'431',$2),($1,'480',$3)`, [ID.orgA, ID.empD, ID.empB]);
  await S(`UPDATE users SET device_enrollment_id = '431' WHERE id = $1`, [ID.empD]);
  await S(`UPDATE users SET device_enrollment_id = '480' WHERE id = $1`, [ID.empB]);
  // leaves: a Dalal and a Bhuj employee leave (pending)
  ID.leaveD = (await one(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, status, reason) VALUES ($1,$2,'2026-12-01','2026-12-01','casual','pending','x') RETURNING id`, [ID.empD, ID.orgA])).id;
  ID.leaveB = (await one(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, status, reason) VALUES ($1,$2,'2026-12-01','2026-12-01','casual','pending','x') RETURNING id`, [ID.empB, ID.orgA])).id;
  await S(`INSERT INTO leave_comments (leave_id, user_id, comment, organization_id) VALUES ($1,$2,'private',$3)`, [ID.leaveB, ID.empB, ID.orgA]);
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
}

// ── app with the real routers (+ the biometric ingestion handler) ───────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/holidays', load('modules/holidays/holidays.routes'));
  app.use('/api/shifts', load('modules/shifts/shifts.routes'));
  app.use('/api/assets', load('modules/assets/assets.routes'));
  app.use('/api/announcements', load('modules/announcements/announcements.routes'));
  app.use('/api/employees', load('modules/employees/employees.routes'));
  app.use('/api/leaves', load('modules/leaves/leaves.routes'));
  app.use('/api/expenses', load('modules/expenses/expenses.routes'));
  app.use('/api/attendance', load('modules/attendance/attendance.routes'));
  app.use('/api/regularization', load('modules/regularization/regularization.routes'));
  app.use('/api/biometric', load('modules/biometric/biometric.routes'));
  app.use('/api/payroll', load('modules/payroll/payroll.routes'));
  app.use('/api/settings', load('modules/settings/settings.routes'));
  app.use('/api/leave-policies', load('modules/leave-policies/leavePolicies.routes'));
  app.use('/api/config-groups', load('modules/config-groups/configGroups.routes'));
  app.use('/api/branches', load('modules/branches/branches.routes'));
  app.use('/api/reports', load('modules/reports/reports.routes'));
  app.use('/api/profile/:id', load('middleware/profileGuard'));
  app.use('/api/profile', load('modules/employee-profile/overview.routes'));
  return app;
}
let base;
const tokenFor = async (id) => {
  const u = await one('select id, role, name, organization_id from users where id=$1', [id]);
  return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET);
};
async function call(method, url, { as, branch, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  if (branch != null) headers['X-Branch-Id'] = String(branch);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const names = (rows) => {
  if (!Array.isArray(rows)) throw new Error('expected an array, got ' + JSON.stringify(rows).slice(0, 300));
  return rows.map(r => r.name || r.title).sort();
};
async function clearPayroll(orgId) {
  await S(`DELETE FROM payroll_scheduler_runs WHERE organization_id=$1`, [orgId]);
  for (const t of ['payroll_email_log', 'payroll_attendance_overrides', 'payroll_adjustments'])
    await S(`DELETE FROM ${t} WHERE organization_id=$1`, [orgId]).catch(() => {});
  await S(`DELETE FROM payroll_run_employees WHERE payroll_run_id IN (SELECT id FROM payroll_runs WHERE organization_id=$1)`, [orgId]).catch(() => {});
  await S(`DELETE FROM payslips WHERE organization_id=$1`, [orgId]);
  await S(`DELETE FROM payroll_runs WHERE organization_id=$1`, [orgId]);
}
async function resetAccess() { load('services/branchService').clearBranchAccessCache(); }

// ── ADMS ingestion: the real handler (device pushes an ATTLOG line) ─────────────────────────
async function devicePunch(sn, pin, when) {
  const handler = load('modules/biometric/biometricPush.handler');
  const req = { query: { SN: sn, table: 'ATTLOG' }, body: {}, headers: { 'content-type': 'text/plain' }, _rawAttlog: `${pin}\t${when}\t0\t1\t0\t0\n` };
  let sent = false; await handler(req, { send: () => { sent = true; } });
  return sent;
}

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }

  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const server = buildApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const { DALAL: _d } = {}; // (ids live in ID)

  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nISOLATION MATRIX on real SQL (joins, bigint, json_agg, array filters)');
  await t('holidays: HR Dalal sees org-wide + Dalal only; header for Bhuj → 403', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/holidays?year=2026', { as: ID.hrD, branch: ID.dalal })).body), ['Dalal Founding', 'Republic Day']);
    assert.strictEqual((await call('GET', '/api/holidays', { as: ID.hrD, branch: ID.bhuj })).status, 403);
    assert.deepStrictEqual(names((await call('GET', '/api/holidays?year=2026', { as: ID.hrD })).body), ['Dalal Founding', 'Republic Day'], 'no header ≠ All Branches (multi → real IN list)');
  });
  await t('holidays: employee (Bhuj) → org-wide + Bhuj holidays through the real multi-branch SQL', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/holidays?year=2026', { as: ID.empB })).body), ['Bhuj Fair', 'Republic Day']);
  });
  await t('holidays: HR Dalal cannot edit/delete Bhuj or org-wide holiday; can create in own branch; same date for a 2nd branch works (real unique index)', async () => {
    const bhuj = await one(`select id from holidays where name='Bhuj Fair'`);
    assert.strictEqual((await call('PUT', `/api/holidays/${bhuj.id}`, { as: ID.hrD, branch: ID.dalal, body: { name: 'x', date: '2026-11-04' } })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/holidays/${bhuj.id}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('POST', '/api/holidays', { as: ID.hrD, branch: ID.dalal, body: { name: 'Dalal Diwali', date: '2026-11-04' } })).status, 200); // same date as Bhuj Fair, other branch
    assert.strictEqual((await call('POST', '/api/holidays', { as: ID.hrD, body: { name: 'NoBranch', date: '2026-11-05' } })).status, 403);
    assert.strictEqual((await call('POST', '/api/holidays', { as: ID.hrD, branch: ID.dalal, body: { name: 'dup', date: '2026-11-04' } })).status, 409);
    await S(`DELETE FROM holidays WHERE name='Dalal Diwali'`);
  });
  await t('employees: HR Dalal list = Dalal only; dept head = own branch, NO salary columns; root Bhuj; foreign org never leaks', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/employees', { as: ID.hrD, branch: ID.dalal })).body), ['Emp Dalal', 'Head Dalal']);
    // dept_head permissions come from heading a department (permissionService), not from users.role
    await S(`INSERT INTO departments (name, organization_id, head_user_id) VALUES ('Ops', $1, $2)`, [ID.orgA, ID.head]);
    await S(`UPDATE users SET ctc = 900000 WHERE id=$1`, [ID.empD]);
    load('services/permissionService').clearUserCache && load('services/permissionService').clearUserCache(String(ID.head), ID.orgA);
    const hd = await call('GET', '/api/employees', { as: ID.head });
    assert.strictEqual(hd.status, 200);
    assert.deepStrictEqual(names(hd.body), ['Emp Dalal', 'Head Dalal']);
    assert.ok(hd.body.every(e => !('ctc' in e) && !('salary_structure' in e)));
    await S(`DELETE FROM departments WHERE head_user_id=$1`, [ID.head]);
    assert.deepStrictEqual(names((await call('GET', '/api/employees', { as: ID.root, branch: ID.bhuj })).body), ['Emp Bhuj', 'Emp Bhuj Two']);
    const all = names((await call('GET', '/api/employees', { as: ID.root })).body);
    assert.ok(!all.includes('Foreign Emp') && all.includes('Emp Dalal') && all.includes('Emp Bhuj'));
  });
  await t('employees: HR Dalal cannot read/edit/delete a Bhuj employee; cannot move one into Bhuj; branch_id never silently erased', async () => {
    assert.strictEqual((await call('PUT', `/api/employees/${ID.empB}`, { as: ID.hrD, branch: ID.dalal, body: { name: 'x', role: 'employee' } })).status, 403);
    assert.strictEqual((await call('PUT', `/api/employees/${ID.empD}`, { as: ID.hrD, branch: ID.dalal, body: { name: 'Emp Dalal', role: 'employee', branch_id: ID.bhuj } })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/employees/${ID.empB}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    const r = await call('PUT', `/api/employees/${ID.empD}`, { as: ID.hrD, branch: ID.dalal, body: { name: 'Emp Dalal', email: 'emp.dalal@t.com', role: 'employee' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(String((await one('select branch_id from users where id=$1', [ID.empD])).branch_id), String(ID.dalal));
    assert.strictEqual((await call('PUT', `/api/employees/${ID.hrB}`, { as: ID.hrD, branch: ID.dalal, body: { name: 'x', password: 'newpass12' } })).status, 403, 'HR cannot edit another admin');
  });
  await t('employees: HR cannot create in an inaccessible branch / create admin; creating in own branch works (real INSERT)', async () => {
    assert.strictEqual((await call('POST', '/api/employees', { as: ID.hrD, branch: ID.dalal, body: { name: 'N1', email: 'n1@t.com', branch_id: ID.bhuj } })).status, 403);
    assert.strictEqual((await call('POST', '/api/employees', { as: ID.hrD, branch: ID.dalal, body: { name: 'N2', email: 'n2@t.com', role: 'admin' } })).status, 403);
    const ok = await call('POST', '/api/employees', { as: ID.hrD, branch: ID.dalal, body: { name: 'New Hire', email: 'newhire@t.com' } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(String((await one(`select branch_id from users where email='newhire@t.com'`)).branch_id), String(ID.dalal));
    await sleep(500);
    await S(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email='newhire@t.com')`);
    await S(`DELETE FROM users WHERE email='newhire@t.com'`);
  });
  await t('profile family: cross-branch 403, own branch passes, cross-org 404 (real queries)', async () => {
    assert.strictEqual((await call('GET', `/api/profile/${ID.empB}/overview`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('GET', `/api/profile/${ID.empD}/overview`, { as: ID.hrD, branch: ID.dalal })).status, 200);
    assert.strictEqual((await call('GET', `/api/profile/${ID.empB}/overview`, { as: ID.empD })).status, 403);
    assert.strictEqual((await call('GET', `/api/profile/${ID.empD}/overview`, { as: ID.froot })).status, 404);
  });
  await t('assets (real joins): employee sees only own; HR Dalal no Bhuj assets; cross-branch edit/delete refused', async () => {
    assert.deepStrictEqual(names((await call('GET', `/api/assets?userId=${ID.empB}`, { as: ID.empD })).body), ['Laptop D']);
    assert.ok((await call('GET', '/api/assets', { as: ID.hrD, branch: ID.dalal })).body.every(a => Number(a.branch_id) !== Number(ID.bhuj)));
    assert.strictEqual((await call('PUT', `/api/assets/${ID.assetB}`, { as: ID.hrD, branch: ID.dalal, body: { asset_tag: 'bhj_001', name: 'x', status: 'available' } })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/assets/${ID.assetB}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('POST', '/api/assets', { as: ID.hrD, body: { name: 'x', asset_tag: 't9', status: 'available' } })).status, 403);
  });
  await t('shifts / roster (real): cross-branch assignment refused, shift of another branch unusable, roster IDOR closed', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/shifts', { as: ID.hrD, branch: ID.dalal })).body), ['Dalal Day', 'General']);
    const bulk = (user, shift) => call('POST', '/api/shifts/assignments/bulk', { as: ID.hrD, branch: ID.dalal, body: { assignments: [{ user_id: user, shift_id: shift, date: '2026-12-10' }] } });
    assert.strictEqual((await bulk(ID.empB, ID.shiftD)).status, 403);
    assert.strictEqual((await bulk(ID.empD, ID.shiftB)).status, 404);
    assert.strictEqual((await bulk(ID.empD, ID.shiftG)).status, 200);
    assert.strictEqual((await call('GET', `/api/shifts/assignments?userId=${ID.empB}`, { as: ID.empD })).status, 403);
    const a = await one(`select id from shift_assignments where user_id=$1`, [ID.empD]);
    assert.strictEqual((await call('DELETE', `/api/shifts/assignments/${a.id}`, { as: ID.hrB, branch: ID.bhuj })).status, 403);
  });
  await t('announcements: branch-targeted hidden from other branch; ?org_id ignored', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/announcements', { as: ID.empB })).body), ['Org-wide']);
    assert.deepStrictEqual(names((await call('GET', '/api/announcements', { as: ID.empD })).body), ['Dalal only', 'Org-wide']);
    assert.ok((await call('GET', `/api/announcements?org_id=${ID.orgB}`, { as: ID.root })).body.every(a => Number(a.organization_id) === Number(ID.orgA)));
  });
  await t('branches list scoped to access (employee sees only own branch, HR only granted)', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/branches', { as: ID.hrD })).body), ['Dalal']);
    assert.deepStrictEqual(names((await call('GET', '/api/branches', { as: ID.empB })).body), ['Bhuj']);
    assert.strictEqual((await call('GET', '/api/branches', { as: ID.root })).body.length, 3);
    assert.ok(names((await call('GET', '/api/branches', { as: ID.hrAll })).body).includes('Ahmedabad'));
  });

  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nBIOMETRIC — Bhuj employee punches on the Dalal device');
  const PUNCH_DATE = '2026-10-02';
  await t('ingestion accepts the cross-branch punch (device branch ≠ employee branch) and keeps device_serial', async () => {
    assert.ok(await devicePunch('DAL-1', '480', `${PUNCH_DATE} 09:14:00`), 'device got its immediate OK');
    const raw = await until(() => one(`select * from biometric_raw_logs where employee_pin='480' and device_serial='DAL-1'`));
    assert.ok(raw, 'raw punch stored');
    assert.strictEqual(String(raw.org_id), String(ID.orgA));
    assert.strictEqual(raw.device_serial, 'DAL-1', 'raw punch source preserved (physical device)');
  });
  await t('attendance is created for the Bhuj employee and the employee keeps the Bhuj branch', async () => {
    const att = await until(() => one(`select * from attendance where user_id=$1 and date=$2`, [ID.empB, PUNCH_DATE]));
    assert.ok(att, 'attendance row created from the punch'); assert.ok(att.check_in, 'check_in set');
    assert.strictEqual(String((await one('select branch_id from users where id=$1', [ID.empB])).branch_id), String(ID.bhuj), 'punch device never changes employee branch');
  });
  await t('Bhuj HR sees it; Dalal HR cannot see the employee\'s attendance (list + by id + export)', async () => {
    const bh = await call('GET', `/api/attendance?date=${PUNCH_DATE}`, { as: ID.hrB, branch: ID.bhuj });
    assert.ok(bh.status === 200 && bh.body.some(r => Number(r.user_id) === Number(ID.empB)), 'Bhuj HR sees Bhuj employee punched on Dalal device');
    const dl = await call('GET', `/api/attendance?date=${PUNCH_DATE}`, { as: ID.hrD, branch: ID.dalal });
    assert.ok(dl.status === 200 && !dl.body.some(r => Number(r.user_id) === Number(ID.empB)), 'Dalal HR does not');
    assert.strictEqual((await call('GET', `/api/attendance?userId=${ID.empB}&date=${PUNCH_DATE}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('GET', `/api/reports/attendance?year=2026&month=10&userId=${ID.empB}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    const rep = await call('GET', '/api/reports/attendance?year=2026&month=10', { as: ID.hrD, branch: ID.dalal });
    const repRows = Array.isArray(rep.body) ? rep.body : (rep.body?.rows || rep.body?.data || []);
    assert.ok(rep.status === 200, 'report status ' + rep.status + ' ' + JSON.stringify(rep.body).slice(0, 200));
    assert.ok(!repRows.some(r => Number(r.user_id) === Number(ID.empB)), 'report excludes other-branch employee');
  });
  await t('punch logs: Bhuj HR sees the punch (source device DAL-1); Dalal HR does not; root sees all', async () => {
    const lg = (u, b) => call('GET', '/api/biometric/logs', { as: u, branch: b });
    const bh = await lg(ID.hrB, ID.bhuj); assert.strictEqual(bh.status, 200);
    assert.ok((bh.body.data || []).some(r => r.employee_pin === '480' && r.device_serial === 'DAL-1'), 'Bhuj HR sees punch + physical source');
    const dl = await lg(ID.hrD, ID.dalal); assert.ok(!(dl.body.data || []).some(r => r.employee_pin === '480'), 'Dalal HR must not see the Bhuj employee punch');
    assert.ok(((await lg(ID.root)).body.data || []).some(r => r.employee_pin === '480'));
    assert.strictEqual((await call('GET', `/api/biometric/punches-for-date?userId=${ID.empB}&date=${PUNCH_DATE}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    const pf = await call('GET', `/api/biometric/punches-for-date?userId=${ID.empB}&date=${PUNCH_DATE}`, { as: ID.hrB, branch: ID.bhuj });
    assert.ok(pf.status === 200 && pf.body.length === 1 && pf.body[0].device_serial === 'DAL-1');
  });
  await t('device list is filtered by DEVICE branch; PIN map by EMPLOYEE branch', async () => {
    assert.deepStrictEqual((await call('GET', '/api/biometric/devices', { as: ID.hrD, branch: ID.dalal })).body.map(d => d.serial_number), ['DAL-1']);
    assert.deepStrictEqual((await call('GET', '/api/biometric/devices', { as: ID.hrB, branch: ID.bhuj })).body.map(d => d.serial_number), ['BHJ-1']);
    assert.strictEqual((await call('GET', '/api/biometric/devices', { as: ID.root })).body.length, 2);
    assert.deepStrictEqual((await call('GET', '/api/biometric/employee-map', { as: ID.hrB, branch: ID.bhuj })).body.map(m => m.employee_pin), ['480']);
    assert.deepStrictEqual((await call('GET', '/api/biometric/employee-map', { as: ID.hrD, branch: ID.dalal })).body.map(m => m.employee_pin), ['431']);
  });
  await t('PIN mapping security: HR Dalal cannot map/unmap/steal the Bhuj PIN; foreign user rejected', async () => {
    const m = await one(`select id from biometric_employee_map where employee_pin='480'`);
    assert.strictEqual((await call('POST', '/api/biometric/employee-map', { as: ID.hrD, branch: ID.dalal, body: { employee_pin: '999', user_id: ID.empB } })).status, 403);
    assert.strictEqual((await call('POST', '/api/biometric/employee-map', { as: ID.hrD, branch: ID.dalal, body: { employee_pin: '998', user_id: ID.femp } })).status, 403, 'user of another org');
    assert.strictEqual((await call('DELETE', `/api/biometric/employee-map/${m.id}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('PUT', `/api/employees/${ID.empD}`, { as: ID.hrD, branch: ID.dalal, body: { name: 'Emp Dalal', role: 'employee', device_enrollment_id: '480' } })).status, 403, 'PIN takeover via employee edit');
    assert.strictEqual((await one(`select user_id from biometric_employee_map where employee_pin='480'`)).user_id.toString(), String(ID.empB));
  });
  await t('reprocess: Bhuj HR can reprocess PIN 480; Dalal HR cannot; reprocess is safe/idempotent', async () => {
    assert.strictEqual((await call('POST', '/api/biometric/reprocess', { as: ID.hrD, branch: ID.dalal, body: { employee_pin: '480' } })).status, 403);
    const r = await call('POST', '/api/biometric/reprocess', { as: ID.hrB, branch: ID.bhuj, body: { employee_pin: '480' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const n1 = (await one(`select count(*)::int n from attendance where user_id=$1`, [ID.empB])).n;
    await call('POST', '/api/biometric/reprocess', { as: ID.hrB, branch: ID.bhuj, body: { employee_pin: '480' } });
    assert.strictEqual((await one(`select count(*)::int n from attendance where user_id=$1`, [ID.empB])).n, n1, 'no duplicate attendance');
    assert.strictEqual((await one(`select count(*)::int n from biometric_raw_logs where employee_pin='480'`)).n, 1, 'raw log not duplicated');
  });
  await t('unmapped PIN punch is still stored (ingestion is branch-neutral); duplicate push ignored', async () => {
    await devicePunch('BHJ-1', '777', `${PUNCH_DATE} 10:00:00`);
    assert.ok(await until(() => one(`select 1 from biometric_raw_logs where employee_pin='777' and device_serial='BHJ-1'`)));
    await devicePunch('DAL-1', '480', `${PUNCH_DATE} 09:14:00`); await sleep(400);
    assert.strictEqual((await one(`select count(*)::int n from biometric_raw_logs where employee_pin='480' and punch_time::text like '2026-10-02 09:14%'`)).n, 1);
  });
  await t('historical sync / force-sync: scoped by device branch; bulk import & auto-sync need all-branch', async () => {
    assert.strictEqual((await call('POST', `/api/biometric/devices/${ID.devB}/historical-sync`, { as: ID.hrD, branch: ID.dalal, body: { from: '2026-09-01', to: '2026-09-30', dry_run: true } })).status, 403);
    assert.strictEqual((await call('POST', `/api/biometric/devices/${ID.devB}/force-sync`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    const ok = await call('POST', `/api/biometric/devices/${ID.devD}/historical-sync`, { as: ID.hrD, branch: ID.dalal, body: { from: '2026-09-01', to: '2026-09-30', dry_run: true } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const jobs = await call('GET', '/api/biometric/historical-sync-jobs', { as: ID.hrB, branch: ID.bhuj });
    assert.ok(jobs.status === 200 && !jobs.body.some(j => j.id === ok.body.job_id), 'Bhuj HR cannot see the Dalal device job');
    assert.strictEqual((await call('GET', `/api/biometric/historical-sync-jobs/${ok.body.job_id}`, { as: ID.hrB, branch: ID.bhuj })).status, 403);
    assert.strictEqual((await call('DELETE', '/api/biometric/import-batches/1', { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('PUT', '/api/biometric/auto-sync/config', { as: ID.hrD, branch: ID.dalal, body: { enabled: true } })).status, 403);
  });
  await t('device create/edit/delete: BIGINT branch id compared numerically (own device ok, other branch refused)', async () => {
    assert.strictEqual((await call('PUT', `/api/biometric/devices/${ID.devD}`, { as: ID.hrD, branch: ID.dalal, body: { device_name: 'Dalal Gate 2', branch_id: ID.dalal } })).status, 200, 'own device (was mis-denied by string !== number)');
    assert.strictEqual((await call('PUT', `/api/biometric/devices/${ID.devB}`, { as: ID.hrD, branch: ID.dalal, body: { device_name: 'x' } })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/biometric/devices/${ID.devB}`, { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('PUT', `/api/biometric/devices/${ID.devD}`, { as: ID.hrD, branch: ID.dalal, body: { device_name: 'x', branch_id: ID.bhuj } })).status, 403, 'cannot re-assign device into an inaccessible branch');
  });

  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nLEAVE / ATTENDANCE / REGULARIZATION');
  await t('apply on behalf / comments / history / edit across branches are refused', async () => {
    const probes = {
      onBehalf: await call('POST', '/api/leaves', { as: ID.hrD, branch: ID.dalal, body: { user_id: ID.empB, start_date: '2026-12-07', end_date: '2026-12-07', leave_type: 'casual', reason: 'x' } }),
      commentsGet: await call('GET', `/api/leaves/${ID.leaveB}/comments`, { as: ID.hrD, branch: ID.dalal }),
      commentsPost: await call('POST', `/api/leaves/${ID.leaveB}/comments`, { as: ID.hrD, branch: ID.dalal, body: { comment: 'x' } }),
      history: await call('GET', `/api/leaves/${ID.leaveB}/history`, { as: ID.hrD, branch: ID.dalal }),
      edit: await call('PUT', `/api/leaves/${ID.leaveB}`, { as: ID.hrD, branch: ID.dalal, body: { reason: 'x' } }),
      employeeComments: await call('GET', `/api/leaves/${ID.leaveB}/comments`, { as: ID.empD }),
    };
    const statuses = Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.status]));
    assert.deepStrictEqual(statuses, { onBehalf: 403, commentsGet: 403, commentsPost: 403, history: 403, edit: 403, employeeComments: 403 }, JSON.stringify(Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, v.body]))).slice(0, 400));
  });
  await t('self-service on BIGINT ids: owner can read/post comments on own leave (was 404 for everyone: "1" !== 1)', async () => {
    const own = await call('GET', `/api/leaves/${ID.leaveB}/comments`, { as: ID.empB });
    assert.strictEqual(own.status, 200, JSON.stringify(own.body));
    assert.strictEqual(own.body.length, 1);
    const post = await call('POST', `/api/leaves/${ID.leaveB}/comments`, { as: ID.empB, body: { comment: 'thanks' } });
    assert.strictEqual(post.status, 200, JSON.stringify(post.body));
    assert.strictEqual((await call('GET', `/api/leaves/${ID.leaveB}/history`, { as: ID.empB })).status, 200, 'owner reads own leave history');
    const withdrawable = await call('GET', `/api/leaves/${ID.leaveB}/comments`, { as: ID.hrB, branch: ID.bhuj });
    assert.strictEqual(withdrawable.status, 200, 'own-branch HR also reads them');
  });
  await t('self-service on BIGINT ids: employee edits/deletes OWN expense, not a colleague\'s', async () => {
    const mk = async (u) => (await one(`INSERT INTO expenses (user_id, organization_id, title, amount, status, expense_date) VALUES ($1,$2,'Taxi',100,'pending','2026-10-01') RETURNING id`, [u, ID.orgA])).id;
    const mine = await mk(ID.empB), theirs = await mk(ID.empD);
    assert.strictEqual((await call('DELETE', `/api/expenses/${theirs}`, { as: ID.empB })).status, 403, 'not mine');
    const del = await call('DELETE', `/api/expenses/${mine}`, { as: ID.empB });
    assert.ok([200, 204].includes(del.status), 'own expense delete: ' + del.status + ' ' + JSON.stringify(del.body));
    await S(`DELETE FROM expenses WHERE id=$1`, [theirs]);
  });
  await t('list: Dalal HR sees Dalal leaves only; Bhuj HR cannot approve/reject/revert/delete a Dalal leave', async () => {
    const l = await call('GET', '/api/leaves', { as: ID.hrD, branch: ID.dalal });
    assert.ok(l.status === 200, 'status ' + l.status + ' ' + JSON.stringify(l.body).slice(0, 200));
    assert.ok(l.body.some(x => Number(x.id) === ID.leaveD), 'Dalal HR sees the Dalal leave');
    assert.ok(!l.body.some(x => Number(x.id) === ID.leaveB), 'and not the Bhuj leave');
    assert.strictEqual((await call('PUT', `/api/leaves/${ID.leaveD}/approve`, { as: ID.hrB, branch: ID.bhuj, body: {} })).status, 403);
    assert.strictEqual((await call('PUT', `/api/leaves/${ID.leaveD}/reject`, { as: ID.hrB, branch: ID.bhuj, body: { reason: 'no' } })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/leaves/${ID.leaveD}`, { as: ID.hrB, branch: ID.bhuj })).status, 403);
    assert.strictEqual((await one(`select status from leaves where id=$1`, [ID.leaveD])).status, 'pending');
  });
  await t('employee applies; own-branch HR approves; balance reflects it', async () => {
    const ap = await call('POST', '/api/leaves', { as: ID.empD, body: { start_date: '2026-11-09', end_date: '2026-11-09', leave_type: 'casual', reason: 'family' } });
    assert.ok([200, 201].includes(ap.status), `apply: ${ap.status} ${JSON.stringify(ap.body)}`);
    const id = ap.body.id || ap.body.leave?.id || (await one(`select id from leaves where user_id=$1 and start_date='2026-11-09'`, [ID.empD])).id;
    const approve = await call('PUT', `/api/leaves/${id}/approve`, { as: ID.hrD, branch: ID.dalal, body: {} });
    assert.strictEqual(approve.status, 200, JSON.stringify(approve.body));
    let st = (await one(`select status, current_level from leaves where id=$1`, [id]));
    if (st.status !== 'approved') {                 // multi-level workflow: the next level is the Root Admin
      const fin = await call('PUT', `/api/leaves/${id}/approve`, { as: ID.root, body: {} });
      assert.strictEqual(fin.status, 200, 'final approval: ' + JSON.stringify(fin.body));
      st = (await one(`select status, current_level from leaves where id=$1`, [id]));
    }
    assert.strictEqual(st.status, 'approved', 'leave workflow completed: ' + JSON.stringify(st));
    assert.ok(await one(`select 1 from attendance where user_id=$1 and date='2026-11-09' and status in ('on_leave','leave')`, [ID.empD]), 'attendance marked on leave');
    const bal = await call('GET', '/api/leaves/balance', { as: ID.empD });
    assert.strictEqual(bal.status, 200, JSON.stringify(bal.body)); assert.ok(JSON.stringify(bal.body).length > 2);
  });
  await t('rejection by own-branch HR works', async () => {
    const ap = await call('POST', '/api/leaves', { as: ID.empD, body: { start_date: '2026-11-10', end_date: '2026-11-10', leave_type: 'casual', reason: 'x' } });
    const id = ap.body.id || (await one(`select id from leaves where user_id=$1 and start_date='2026-11-10'`, [ID.empD])).id;
    const rj = await call('PUT', `/api/leaves/${id}/reject`, { as: ID.hrD, branch: ID.dalal, body: { reason: 'busy' } });
    assert.strictEqual(rj.status, 200, JSON.stringify(rj.body));
    assert.strictEqual((await one(`select status from leaves where id=$1`, [id])).status, 'rejected');
  });
  await t('holiday interaction: a Bhuj-only holiday blocks leave for Bhuj, NOT for Dalal (2026-11-04)', async () => {
    const b = await call('POST', '/api/leaves', { as: ID.empB, body: { start_date: '2026-11-04', end_date: '2026-11-04', leave_type: 'casual', reason: 'x' } });
    assert.strictEqual(b.status, 400, `Bhuj employee on Bhuj holiday: ${b.status} ${JSON.stringify(b.body)}`);
    assert.match(String(b.body.error), /holiday/i);
    const d = await call('POST', '/api/leaves', { as: ID.empD, body: { start_date: '2026-11-04', end_date: '2026-11-04', leave_type: 'casual', reason: 'x' } });
    assert.ok([200, 201].includes(d.status), `Dalal employee same date must be allowed: ${d.status} ${JSON.stringify(d.body)}`);
  });
  await t('regularization: employee requests; other-branch HR refused; own-branch HR approves', async () => {
    const rq = await call('POST', '/api/regularization', { as: ID.empD, body: { date: '2026-10-01', requested_check_in: '09:05', requested_check_out: '18:05', reason: 'forgot to punch', type: 'check_time' } });
    assert.ok([200, 201].includes(rq.status), `request: ${rq.status} ${JSON.stringify(rq.body)}`);
    const id = rq.body.id || (await one(`select id from attendance_regularization where user_id=$1`, [ID.empD])).id;
    assert.strictEqual((await call('PUT', `/api/regularization/${id}/review`, { as: ID.hrB, branch: ID.bhuj, body: { status: 'approved' } })).status, 403);
    const lst = await call('GET', '/api/regularization', { as: ID.hrB, branch: ID.bhuj });
    assert.ok(lst.status === 200 && !lst.body.some(r => Number(r.id) === Number(id)), 'Bhuj HR cannot even list the Dalal request');
    const ok = await call('PUT', `/api/regularization/${id}/review`, { as: ID.hrD, branch: ID.dalal, body: { status: 'approved' } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(await one(`select 1 from attendance where user_id=$1 and date='2026-10-01' and check_in is not null`, [ID.empD]), 'attendance corrected');
    assert.strictEqual((await call('DELETE', `/api/regularization/${id}`, { as: ID.hrB, branch: ID.bhuj })).status, 403);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nCONFIGURATION GROUPS on real SQL');
  const grp = (b) => call('POST', '/api/config-groups', { as: ID.root, body: b });
  let gWs, gLp;
  await t('restricted HR cannot manage groups; all-branch HR / root can', async () => {
    assert.strictEqual((await call('POST', '/api/config-groups', { as: ID.hrD, branch: ID.dalal, body: { domain: 'work_schedule', name: 'x', branch_ids: [ID.dalal] } })).status, 403);
    assert.strictEqual((await call('GET', '/api/config-groups?domain=work_schedule', { as: ID.hrD, branch: ID.dalal })).status, 403);
    assert.strictEqual((await call('GET', '/api/config-groups?domain=work_schedule', { as: ID.hrAll })).status, 200);
  });
  await t('work schedule group A = Dalal + Bhuj; both inherit; Ahmedabad stays on the org default', async () => {
    await S(`UPDATE work_schedule SET start_time='10:00', end_time='19:00' WHERE organization_id=$1`, [ID.orgA]);
    const r = await grp({ domain: 'work_schedule', name: 'Group A', branch_ids: [ID.dalal, ID.bhuj] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); gWs = r.body.group.id;
    const rows = await S(`select branch_id, group_id, start_time from branch_work_schedule where organization_id=$1 order by branch_id`, [ID.orgA]);
    assert.strictEqual(rows.length, 2); assert.ok(rows.every(x => String(x.group_id) === String(gWs) && x.start_time === '10:00'), 'seeded from the org default, owned by the group');
    assert.strictEqual((await one(`select count(*)::int n from branch_work_schedule where branch_id=$1`, [ID.ahm])).n, 0);
  });
  await t('editing the group changes BOTH member branches; consumers resolve the group config', async () => {
    const ws = await call('PUT', `/api/config-groups/${gWs}/config`, { as: ID.root, body: { start_time: '08:30', end_time: '17:30', work_days: '1,2,3,4,5,6' } });
    assert.strictEqual(ws.status, 200, JSON.stringify(ws.body)); assert.strictEqual(ws.body.applied.length, 2);
    const rows = await S(`select start_time, end_time, work_days from branch_work_schedule where organization_id=$1`, [ID.orgA]);
    assert.ok(rows.every(x => x.start_time === '08:30' && x.end_time === '17:30' && x.work_days === '1,2,3,4,5,6'));
    const eff = await load('utils/helpers').getEffectiveWorkSchedule(ID.orgA, ID.bhuj);
    assert.strictEqual(eff.start_time, '08:30', 'getEffectiveWorkSchedule (attendance/biometric/payroll resolver) sees the group config');
    assert.strictEqual((await load('utils/helpers').getEffectiveWorkSchedule(ID.orgA, ID.ahm)).start_time, '10:00', 'non-member keeps org default');
  });
  await t('Group B (Ahmedabad) is independent of Group A', async () => {
    const r = await grp({ domain: 'work_schedule', name: 'Group B', branch_ids: [ID.ahm], from_branch_id: ID.dalal });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await call('PUT', `/api/config-groups/${r.body.group.id}/config`, { as: ID.root, body: { start_time: '07:00' } });
    assert.strictEqual((await one(`select start_time from branch_work_schedule where branch_id=$1`, [ID.ahm])).start_time, '07:00');
    assert.strictEqual((await one(`select start_time from branch_work_schedule where branch_id=$1`, [ID.dalal])).start_time, '08:30', 'Group A untouched');
  });
  await t('a branch is in at most ONE group per domain (409 with a readable message)', async () => {
    const r = await grp({ domain: 'work_schedule', name: 'Group C', branch_ids: [ID.dalal] });
    assert.strictEqual(r.status, 409); assert.match(r.body.error, /only one/i);
    assert.strictEqual((await call('PUT', `/api/config-groups/${gWs}`, { as: ID.root, body: { branch_ids: [ID.dalal, ID.bhuj, ID.ahm] } })).status, 409);
  });
  await t('branch custom override wins and survives group edits; reset re-inherits the group', async () => {
    const put = await call('PUT', `/api/settings/branch/${ID.bhuj}`, { as: ID.root, body: { start_time: '12:00' } });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    let b = await one(`select start_time, group_id from branch_work_schedule where branch_id=$1`, [ID.bhuj]);
    assert.strictEqual(b.start_time, '12:00'); assert.strictEqual(b.group_id, null, 'now a custom override');
    const ed = await call('PUT', `/api/config-groups/${gWs}/config`, { as: ID.root, body: { start_time: '08:00' } });
    assert.deepStrictEqual(ed.body.custom.map(Number), [ID.bhuj], 'Bhuj reported as keeping its custom override');
    assert.strictEqual((await one(`select start_time from branch_work_schedule where branch_id=$1`, [ID.bhuj])).start_time, '12:00', 'group edit did not overwrite the custom override');
    assert.strictEqual((await one(`select start_time from branch_work_schedule where branch_id=$1`, [ID.dalal])).start_time, '08:00', 'other member updated');
    const eff = await call('GET', `/api/config-groups/effective?domain=work_schedule&branch_id=${ID.bhuj}`, { as: ID.hrB, branch: ID.bhuj });
    assert.strictEqual(eff.body.source, 'branch');
    const del = await call('DELETE', `/api/settings/branch/${ID.bhuj}`, { as: ID.root });
    assert.strictEqual(del.status, 200); assert.match(del.body.message, /group/i);
    b = await one(`select start_time, group_id from branch_work_schedule where branch_id=$1`, [ID.bhuj]);
    assert.strictEqual(b.start_time, '08:00'); assert.strictEqual(String(b.group_id), String(gWs), 'reset → inherited from the group again');
    assert.strictEqual((await call('GET', `/api/config-groups/effective?domain=work_schedule&branch_id=${ID.bhuj}`, { as: ID.hrB, branch: ID.bhuj })).body.source, 'group');
    assert.strictEqual((await call('GET', `/api/config-groups/effective?domain=work_schedule&branch_id=${ID.dalal}`, { as: ID.hrB, branch: ID.bhuj })).status, 403, 'cannot probe another branch');
  });
  await t('membership: removing a branch drops its inherited rows; custom rows untouched; dissolve returns members to the org default', async () => {
    const r = await call('PUT', `/api/config-groups/${gWs}`, { as: ID.root, body: { branch_ids: [ID.dalal] } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await one(`select count(*)::int n from branch_work_schedule where branch_id=$1`, [ID.bhuj])).n, 0);
    assert.strictEqual((await call('DELETE', `/api/config-groups/${gWs}`, { as: ID.root })).status, 200);
    assert.strictEqual((await one(`select count(*)::int n from branch_work_schedule where branch_id=$1`, [ID.dalal])).n, 0, 'inherited row removed on dissolve');
    assert.strictEqual((await load('utils/helpers').getEffectiveWorkSchedule(ID.orgA, ID.dalal)).start_time, '10:00', 'back to the org default');
  });
  await t('leave-policy group: members inherit, group edit propagates, employee balance uses the group quota', async () => {
    const r = await grp({ domain: 'leave_policies', name: 'LP A', branch_ids: [ID.dalal, ID.bhuj] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); gLp = r.body.group.id;
    assert.strictEqual((await one(`select count(*)::int n from leave_policies where branch_id=$1 and group_id=$2`, [ID.dalal, gLp])).n, 2, 'seeded from the org policies (casual + sick)');
    const edit = await call('PUT', `/api/config-groups/${gLp}/config`, { as: ID.root, body: { policies: [
      { leave_type: 'casual', label: 'Casual Leave', annual_quota: 15, paid: true }, { leave_type: 'sick', label: 'Sick Leave', annual_quota: 20, paid: true }] } });
    assert.strictEqual(edit.status, 200, JSON.stringify(edit.body));
    for (const b of [ID.dalal, ID.bhuj]) assert.strictEqual((await one(`select annual_quota from leave_policies where branch_id=$1 and leave_type='casual'`, [b])).annual_quota, 15);
    assert.strictEqual((await one(`select annual_quota from leave_policies where branch_id IS NULL and organization_id=$1 and leave_type='casual'`, [ID.orgA])).annual_quota, 8, 'org default untouched');
    const bal = await call('GET', '/api/leaves/balance', { as: ID.empB });
    assert.strictEqual(bal.status, 200); assert.ok(JSON.stringify(bal.body).includes('15'), 'Bhuj employee balance uses the group quota: ' + JSON.stringify(bal.body).slice(0, 200));
    assert.strictEqual((await call('GET', `/api/config-groups/effective?domain=leave_policies&branch_id=${ID.dalal}`, { as: ID.hrD, branch: ID.dalal })).body.source, 'group');
  });
  await t('leave policies: branch edit makes a custom override (detaches); reset re-inherits the group; copy keeps working', async () => {
    const one_ = await one(`select id from leave_policies where branch_id=$1 and leave_type='casual'`, [ID.dalal]);
    const put = await call('PUT', `/api/leave-policies/${one_.id}`, { as: ID.hrAll, branch: ID.dalal, body: { annual_quota: 11 } });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    assert.strictEqual((await one(`select count(*)::int n from leave_policies where branch_id=$1 and group_id IS NOT NULL`, [ID.dalal])).n, 0, 'whole branch set detached from the group');
    assert.strictEqual((await call('GET', `/api/config-groups/effective?domain=leave_policies&branch_id=${ID.dalal}`, { as: ID.hrD, branch: ID.dalal })).body.source, 'branch');
    await call('PUT', `/api/config-groups/${gLp}/config`, { as: ID.root, body: { policies: [{ leave_type: 'casual', label: 'Casual Leave', annual_quota: 16, paid: true }] } });
    assert.strictEqual((await one(`select annual_quota from leave_policies where branch_id=$1 and leave_type='casual'`, [ID.dalal])).annual_quota, 11, 'custom survives the group edit');
    assert.strictEqual((await one(`select annual_quota from leave_policies where branch_id=$1 and leave_type='casual'`, [ID.bhuj])).annual_quota, 16, 'other member follows');
    const rs = await call('DELETE', `/api/leave-policies/branch/${ID.dalal}`, { as: ID.hrAll, branch: ID.dalal });
    assert.strictEqual(rs.status, 200); assert.strictEqual(rs.body.inherited_from_group, true);
    assert.strictEqual((await one(`select annual_quota from leave_policies where branch_id=$1 and leave_type='casual'`, [ID.dalal])).annual_quota, 16, 'reset → group config again');
    assert.strictEqual((await call('DELETE', `/api/leave-policies/branch/${ID.dalal}`, { as: ID.hrD, branch: ID.bhuj })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/config-groups/${gLp}`, { as: ID.root })).status, 200);
    assert.strictEqual((await one(`select count(*)::int n from leave_policies where branch_id=$1`, [ID.dalal])).n, 0);
  });
  await t('cross-org: foreign root cannot see/modify org A groups or add org A branches', async () => {
    const r = await grp({ domain: 'work_schedule', name: 'Tmp', branch_ids: [ID.dalal] }); const id = r.body.group.id;
    assert.strictEqual((await call('GET', `/api/config-groups/${id}/config`, { as: ID.froot })).status, 404);
    assert.strictEqual((await call('DELETE', `/api/config-groups/${id}`, { as: ID.froot })).status, 404);
    assert.strictEqual((await call('POST', '/api/config-groups', { as: ID.froot, body: { domain: 'work_schedule', name: 'Steal', branch_ids: [ID.dalal] } })).status, 404, 'org A branch from org B');
    await call('DELETE', `/api/config-groups/${id}`, { as: ID.root });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nPAYROLL — branch lifecycle, scheduler, no duplicates');
  const { year: Y, month: M } = { year: 2026, month: 9 };
  const sched = load('services/payrollScheduler');
  async function seedPayrollData() {
    await S(`UPDATE users SET ctc = NULL`);
    for (const o of [ID.orgA, ID.orgB, ID.orgC]) await clearPayroll(o);
    await S(`DELETE FROM employee_salary_structures`);
    for (const u of [ID.empD, ID.empB, ID.empB2]) {
      await S(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, hra, gross_salary, ctc) VALUES ($1,$2,'2026-01-01',30000,15000,45000,540000)`, [ID.orgA, u]);
      await S(`INSERT INTO attendance (user_id, organization_id, date, status, check_in, check_out) SELECT $1,$2,to_char(d,'YYYY-MM-DD'),'present','09:00','18:00' FROM generate_series('2026-09-01'::date,'2026-09-30','1 day') d WHERE extract(dow from d) NOT IN (0,6) ON CONFLICT DO NOTHING`, [u, ID.orgA]);
    }
    await S(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, hra, gross_salary, ctc) VALUES ($1,$2,'2026-01-01',20000,10000,30000,360000)`, [ID.orgC, ID.empC]);
    await S(`INSERT INTO attendance (user_id, organization_id, date, status, check_in, check_out) SELECT $1,$2,to_char(d,'YYYY-MM-DD'),'present','09:00','18:00' FROM generate_series('2026-09-01'::date,'2026-09-30','1 day') d WHERE extract(dow from d) NOT IN (0,6) ON CONFLICT DO NOTHING`, [ID.empC, ID.orgC]);
  }
  await seedPayrollData();
  let runD, runB;
  await t('restricted HR with no branch / org-wide generation is refused; branch generation works', async () => {
    assert.strictEqual((await call('POST', '/api/payroll/generate', { as: ID.hrD, body: { month: M, year: Y } })).status, 400, 'no branch selected');
    assert.strictEqual((await call('POST', '/api/payroll/generate', { as: ID.root, body: { month: M, year: Y } })).status, 400, 'root All Branches in a branch org');
    const d = await call('POST', '/api/payroll/generate', { as: ID.hrD, branch: ID.dalal, body: { month: M, year: Y } });
    assert.ok([200, 201].includes(d.status), `generate Dalal: ${d.status} ${JSON.stringify(d.body)}`);
    runD = (await one(`select * from payroll_runs where organization_id=$1 and branch_id=$2`, [ID.orgA, ID.dalal]));
    assert.ok(runD, 'Dalal run exists'); assert.strictEqual(Number(runD.employee_count), 1, 'only Dalal employees');
    assert.deepStrictEqual((await S(`select user_id from payslips where payroll_run_id=$1`, [runD.id])).map(r => Number(r.user_id)), [ID.empD]);
  });
  await t('Bhuj branch separately: own run, own employees, no overlap with Dalal', async () => {
    const b = await call('POST', '/api/payroll/generate', { as: ID.hrB, branch: ID.bhuj, body: { month: M, year: Y } });
    assert.ok([200, 201].includes(b.status), `generate Bhuj: ${b.status} ${JSON.stringify(b.body)}`);
    runB = await one(`select * from payroll_runs where organization_id=$1 and branch_id=$2`, [ID.orgA, ID.bhuj]);
    assert.strictEqual(Number(runB.employee_count), 2);
    assert.deepStrictEqual((await S(`select user_id from payslips where payroll_run_id=$1 order by user_id`, [runB.id])).map(r => Number(r.user_id)), [ID.empB, ID.empB2].sort((a, b) => a - b));
    assert.strictEqual((await one(`select count(*)::int n from payroll_runs where organization_id=$1`, [ID.orgA])).n, 2);
    assert.strictEqual((await call('GET', `/api/payroll/runs/${runD.id}`, { as: ID.hrB, branch: ID.bhuj })).status, 403, 'Bhuj HR cannot open the Dalal run');
    const list = await call('GET', '/api/payroll/runs', { as: ID.hrB, branch: ID.bhuj });
    assert.ok(list.status === 200 && list.body.every(r => Number(r.branch_id) === Number(ID.bhuj)));
  });
  await t('re-generating the same branch+period does NOT create a duplicate run', async () => {
    await call('POST', '/api/payroll/generate', { as: ID.hrD, branch: ID.dalal, body: { month: M, year: Y } });
    assert.strictEqual((await one(`select count(*)::int n from payroll_runs where organization_id=$1 and branch_id=$2 and month=$3 and year=$4`, [ID.orgA, ID.dalal, M, Y])).n, 1);
    assert.strictEqual((await one(`select count(*)::int n from payslips where payroll_run_id=$1`, [runD.id])).n, 1, 'one payslip per employee');
  });
  await t('lifecycle (Dalal): verify → approve → publish → payslip → email → cancel approval (reopen) → regenerate', async () => {
    const ver = await call('POST', `/api/payroll/runs/${runD.id}/verify`, { as: ID.root }); assert.strictEqual(ver.status, 200, JSON.stringify(ver.body));
    assert.strictEqual((await call('POST', `/api/payroll/runs/${runD.id}/approve`, { as: ID.hrB, branch: ID.bhuj })).status, 403, 'Bhuj HR cannot approve a Dalal run');
    const app_ = await call('POST', `/api/payroll/runs/${runD.id}/approve`, { as: ID.root }); assert.strictEqual(app_.status, 200, JSON.stringify(app_.body));
    assert.strictEqual((await one(`select status from payroll_runs where id=$1`, [runD.id])).status, 'approved');
    const slip = await one(`select id from payslips where payroll_run_id=$1`, [runD.id]);
    const pub = await call('PUT', `/api/payroll/payslips/${slip.id}/publish`, { as: ID.hrD, branch: ID.dalal });
    assert.strictEqual(pub.status, 200, JSON.stringify(pub.body));
    assert.strictEqual((await one(`select status from payslips where id=$1`, [slip.id])).status, 'published');
    assert.strictEqual((await call('GET', `/api/payroll/payslips/${slip.id}`, { as: ID.empD })).status, 200, 'employee reads own payslip');
    assert.strictEqual((await call('GET', `/api/payroll/payslips/${slip.id}`, { as: ID.empB })).status, 403, 'other employee cannot');
    assert.strictEqual((await call('GET', `/api/payroll/payslips/${slip.id}`, { as: ID.hrB, branch: ID.bhuj })).status, 403, 'other-branch HR cannot');
    const em = await call('POST', `/api/payroll/runs/${runD.id}/send-emails`, { as: ID.root });
    assert.ok([200, 202].includes(em.status), `send-emails: ${em.status} ${JSON.stringify(em.body)}`);
    const re = await call('POST', `/api/payroll/runs/${runD.id}/reopen`, { as: ID.root }); assert.strictEqual(re.status, 200, JSON.stringify(re.body));
    assert.notStrictEqual((await one(`select status from payroll_runs where id=$1`, [runD.id])).status, 'approved', 'cancel approval reopened the run');
    const rg = await call('POST', '/api/payroll/generate', { as: ID.hrD, branch: ID.dalal, body: { month: M, year: Y, force: true } });
    assert.ok([200, 201].includes(rg.status), `regenerate: ${rg.status} ${JSON.stringify(rg.body)}`);
    assert.strictEqual((await one(`select count(*)::int n from payroll_runs where organization_id=$1 and branch_id=$2 and month=$3 and year=$4`, [ID.orgA, ID.dalal, M, Y])).n, 1, 'regenerate reuses the run — no duplicate');
  });
  await t('statutory/payroll maths unchanged: payslip numbers are deterministic for the seeded structure', async () => {
    const s = await one(`select gross_salary, net_salary, present_days from payslips where user_id=$1 and month='09' and year=2026`, [ID.empD]);
    assert.ok(s, 'payslip exists'); assert.ok(Number(s.gross_salary) > 0 && Number(s.net_salary) > 0);
    const s2 = await one(`select gross_salary, net_salary from payslips where user_id=$1 and month='09' and year=2026`, [ID.empB]);
    assert.strictEqual(Number(s.gross_salary), Number(s2.gross_salary), 'identical structures/attendance in two branches → identical results (branch does not change the calculation)');
    assert.strictEqual(Number(s.net_salary), Number(s2.net_salary));
  });
  await t('Paid/Locked: cannot reopen, cannot regenerate (Bhuj run)', async () => {
    await call('POST', `/api/payroll/runs/${runB.id}/verify`, { as: ID.root });
    const ap2 = await call('POST', `/api/payroll/runs/${runB.id}/approve`, { as: ID.root });
    assert.strictEqual(ap2.status, 200, 'approve before lock: ' + JSON.stringify(ap2.body));
    const lk = await call('POST', `/api/payroll/lock/${runB.id}`, { as: ID.root }); assert.ok([200, 201].includes(lk.status), `lock ${lk.status} ${JSON.stringify(lk.body)}`);
    const paid = await call('POST', `/api/payroll/runs/${runB.id}/mark-paid`, { as: ID.root }); assert.ok([200, 201].includes(paid.status), `paid ${paid.status} ${JSON.stringify(paid.body)}`);
    const state = await one(`select status, locked_at from payroll_runs where id=$1`, [runB.id]);
    const snap = async () => JSON.stringify({
      run: await one(`select status, employee_count, total_gross, total_deductions, total_net, error_count, locked_at, paid_at from payroll_runs where id=$1`, [runB.id]),
      emps: (await one(`select count(*)::int n from payroll_run_employees where payroll_run_id=$1`, [runB.id])).n,
      slips: await S(`select user_id, status, locked, gross_salary, net_salary from payslips where payroll_run_id=$1 order by user_id`, [runB.id]),
    });
    const before = await snap();
    const reopen = await call('POST', `/api/payroll/runs/${runB.id}/reopen`, { as: ID.root }); assert.ok(reopen.status >= 400, `reopen of a paid run must be refused (got ${reopen.status} ${JSON.stringify(reopen.body)}; run state ${JSON.stringify(state)})`);
    const regen = await call('POST', '/api/payroll/generate', { as: ID.hrB, branch: ID.bhuj, body: { month: M, year: Y, force: true } }); assert.ok(regen.status >= 400, `regenerate of a paid/locked run must be refused (got ${regen.status} ${JSON.stringify(regen.body).slice(0, 200)}; run state ${JSON.stringify(state)}; payslips ${JSON.stringify(await S('select user_id, status, locked from payslips where payroll_run_id=$1', [runB.id]))})`);
    assert.strictEqual((await one(`select status from payroll_runs where id=$1`, [runB.id])).status, 'paid');
    assert.match(String(regen.body.error), /paid/i, 'clear refusal reason');
    assert.strictEqual(await snap(), before, 'the paid run, its employee rows and its locked payslips are untouched by the refused regeneration');
    assert.strictEqual((await call('POST', `/api/payroll/unlock/${runB.id}`, { as: ID.hrD, branch: ID.dalal })).status, 403, 'other branch HR cannot unlock');
  });
  await t('bank file / reports are branch-scoped', async () => {
    assert.strictEqual((await call('GET', `/api/payroll/bank-file/${runD.id}`, { as: ID.hrB, branch: ID.bhuj })).status, 403);
    const rep = await call('GET', `/api/payroll/reports/summary?month=${M}&year=${Y}`, { as: ID.root, branch: ID.bhuj });
    assert.ok(rep.status === 200, `report ${rep.status} ${JSON.stringify(rep.body).slice(0, 200)}`);
    assert.strictEqual((await call('GET', `/api/payroll/reports/summary?month=${M}&year=${Y}`, { as: ID.hrB, branch: ID.bhuj })).status, 403, 'RBAC still applies on top of branch scope');
  });
  await t('SCHEDULER (branch ON): one run PER active branch, none org-wide, idempotent, no overlap', async () => {
    await clearPayroll(ID.orgA);
    const r1 = await sched.handleGeneration(ID.orgA, {}, { payMonth: M, payYear: Y });
    assert.ok(Array.isArray(r1) && r1.length === 3, 'one result per active branch: ' + JSON.stringify(r1 && r1.map(x => [x.branchId, x.status])));
    const runs = await S(`select branch_id, employee_count from payroll_runs where organization_id=$1 order by branch_id`, [ID.orgA]);
    assert.strictEqual(runs.filter(r => r.branch_id === null).length, 0, 'NO organisation-wide run');
    assert.deepStrictEqual(runs.filter(r => r.branch_id).map(r => String(r.branch_id)).sort(), [ID.dalal, ID.bhuj].map(String).sort(), 'Ahmedabad has no employees → skipped');
    assert.strictEqual((await one(`select count(*)::int n from payslips`)).n, 3, 'each employee exactly once across branch runs');
    const r2 = await sched.handleGeneration(ID.orgA, {}, { payMonth: M, payYear: Y });
    assert.strictEqual((await one(`select count(*)::int n from payroll_runs where organization_id=$1`, [ID.orgA])).n, 2, 'second tick creates nothing new');
    assert.strictEqual((await one(`select count(*)::int n from payslips`)).n, 3);
    assert.ok(r2.every(x => x.status === 'skipped'), 'every branch skipped on the repeat tick');
    const sr = await S(`select branch_id from payroll_scheduler_runs where organization_id=$1 and branch_id is not null`, [ID.orgA]); assert.ok(sr.length >= 2, 'scheduler runs recorded per branch');
  });
  await t('SCHEDULER: an existing org-wide run blocks branch runs (no overlap)', async () => {
    await clearPayroll(ID.orgA);
    await S(`INSERT INTO payroll_runs (organization_id, month, year, status, branch_id) VALUES ($1,$2,$3,'completed',NULL)`, [ID.orgA, M, Y]);
    const r = await sched.handleGeneration(ID.orgA, {}, { payMonth: M, payYear: Y });
    assert.ok(r.every(x => x.status === 'skipped' && /organisation-wide/i.test(x.reason || '')), JSON.stringify(r.map(x => [x.branchId, x.status, x.reason])));
    assert.strictEqual((await one(`select count(*)::int n from payroll_runs where organization_id=$1`, [ID.orgA])).n, 1);
  });
  await t('SCHEDULER (branch OFF org): one organisation-wide run exactly as before', async () => {
    await clearPayroll(ID.orgC);
    assert.strictEqual(await sched.getBranchRunTargets(ID.orgC), null, 'no branch targets for a non-branch org');
    await sched.handleGeneration(ID.orgC, {}, { payMonth: M, payYear: Y });
    const runs = await S(`select branch_id from payroll_runs where organization_id=$1`, [ID.orgC]);
    assert.strictEqual(runs.length, 1); assert.strictEqual(runs[0].branch_id, null);
  });
  await t('manual scheduler trigger: branch HR → own branch only; all-branch → every branch; other branch refused', async () => {
    await clearPayroll(ID.orgA);
    assert.strictEqual((await call('POST', '/api/payroll/scheduler/trigger', { as: ID.hrD, branch: ID.dalal, body: { month: M, year: Y, branch_id: ID.bhuj } })).status, 403);
    const own = await call('POST', '/api/payroll/scheduler/trigger', { as: ID.hrD, branch: ID.dalal, body: { month: M, year: Y } });
    assert.strictEqual(own.status, 201, JSON.stringify(own.body));
    assert.deepStrictEqual((await S(`select branch_id from payroll_runs where organization_id=$1`, [ID.orgA])).map(r => String(r.branch_id)), [String(ID.dalal)]);
    const all = await call('POST', '/api/payroll/scheduler/trigger', { as: ID.root, body: { month: M, year: Y } });
    assert.strictEqual(all.status, 201, JSON.stringify(all.body));
    assert.strictEqual((await one(`select count(*)::int n from payroll_runs where organization_id=$1 and branch_id is null`, [ID.orgA])).n, 0);
    assert.strictEqual((await one(`select count(*)::int n from payroll_runs where organization_id=$1`, [ID.orgA])).n, 2, 'Dalal reused, Bhuj added — still no duplicates');
    const hist = await call('GET', '/api/payroll/scheduler/runs', { as: ID.hrB, branch: ID.bhuj });
    assert.ok(hist.status === 200 && hist.body.every(r => Number(r.branch_id) === Number(ID.bhuj)), 'scheduler history scoped');
  });

  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nTENANT ISOLATION / CONSTRAINTS');
  await t('login refuses a user with no organisation (no fallback to org 1)', async () => {
    const authRoutes = load('modules/auth/auth.routes');
    const a = express(); a.use(express.json()); a.use('/api/auth', authRoutes);
    const s2 = a.listen(0); const b2 = `http://127.0.0.1:${s2.address().port}`;
    const bcrypt = require('bcryptjs');
    await S(`ALTER TABLE users ALTER COLUMN organization_id DROP NOT NULL`);
    await S(`UPDATE users SET password=$1, organization_id=NULL WHERE id=$2`, [bcrypt.hashSync('Passw0rd!', 4), ID.empC]);
    const res = await fetch(b2 + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'emp.c@t.com', password: 'Passw0rd!' }) });
    const body = await res.json().catch(() => ({}));
    await S(`UPDATE users SET organization_id=$1 WHERE id=$2`, [ID.orgC, ID.empC]);
    await S(`ALTER TABLE users ALTER COLUMN organization_id SET NOT NULL`).catch(() => {});
    s2.close();
    assert.strictEqual(res.status, 403, JSON.stringify(body)); assert.strictEqual(body.code, 'NO_ORGANIZATION');
  });
  await t('real unique/exclusion behaviour: one group per branch per domain, one run per branch per period', async () => {
    await clearPayroll(ID.orgA);
    await S(`INSERT INTO payroll_runs (organization_id, month, year, status, branch_id) VALUES ($1,9,2026,'completed',$2)`, [ID.orgA, ID.dalal]);
    await assert.rejects(S(`INSERT INTO payroll_runs (organization_id, month, year, status, branch_id) VALUES ($1,9,2026,'completed',$2)`, [ID.orgA, ID.dalal]), /unique|duplicate/i);
    await S(`INSERT INTO payroll_runs (organization_id, month, year, status, branch_id) VALUES ($1,9,2026,'completed',$2)`, [ID.orgA, ID.bhuj]); // other branch same period is fine
  });

  server.close();
  console.log(`\n${'─'.repeat(64)}\nReal-DB results (PostgreSQL ${(await one('show server_version')).server_version}, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('\n✅  All real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
