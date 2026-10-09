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
// Tests must never send real mail: dotenv does not override variables that are already set, so blank SMTP credentials stay blank.
require('./helpers/realdb_env'); // blanks every provider credential, fakes Cloudinary, blocks non-local network (see helper)
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
  app.use('/api/pending-approvals', load('modules/pending-approvals/pendingApprovals.routes'));
  app.use('/api/dashboard', load('modules/dashboard/dashboard.routes'));
  app.use('/api/dashboard-before', load('tests/fixtures/dashboard.before_parallelisation.js'));
  app.use('/api/biometric', load('modules/biometric/biometric.routes'));
  app.use('/api/payroll', load('modules/payroll/payroll.routes'));
  app.use('/api/notifications', load('modules/notifications/notifications.routes'));
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
  return { status: r.status, body: json, headers: r.headers };
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

  console.log('\nLIST FILTERS + PENDING-APPROVALS SUMMARY (leaves / regularization / expenses)');
  const lv = async (u, st, sd, ed, reason) => (await one(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, status, reason) VALUES ($1,$2,$3,$4,'casual',$5,$6) RETURNING id`, [u, ID.orgA, sd, ed, st, reason])).id;
  const idsOf = (rows) => rows.map(r => Number(r.id)).sort((a, b) => a - b);
  let L = {};
  await t('seed: leaves/regularizations/expenses in several statuses, dates and both branches', async () => {
    L.oldApprD = await lv(ID.empD, 'approved', '2024-03-01', '2024-03-01', 'old approved');
    L.rejD = await lv(ID.empD, 'rejected', '2026-02-02', '2026-02-03', 'rejected');
    L.deptB = await lv(ID.empB, 'pending_dept', '2026-12-10', '2026-12-10', 'dept pending B');
    L.rootB = await lv(ID.empB, 'pending_root', '2026-12-11', '2026-12-11', 'root pending B');
    const rg = async (u, d, st) => (await one(`INSERT INTO attendance_regularization (user_id, organization_id, date, requested_check_in, requested_check_out, reason, status, type) VALUES ($1,$2,$3,'09:00','18:00','r',$4,'check_time') RETURNING id`, [u, ID.orgA, d, st])).id;
    L.regOldD = await rg(ID.empD, '2024-03-05', 'approved'); L.regPendD = await rg(ID.empD, '2026-09-10', 'pending');
    L.regPendB = await rg(ID.empB, '2026-09-10', 'pending'); L.regRejB = await rg(ID.empB, '2026-09-11', 'rejected');
    const ex = async (u, st, d) => (await one(`INSERT INTO expenses (user_id, organization_id, title, amount, status, expense_date) VALUES ($1,$2,'Cab',50,$3,$4) RETURNING id`, [u, ID.orgA, st, d])).id;
    L.exOldD = await ex(ID.empD, 'approved', '2024-04-01'); L.exPendD = await ex(ID.empD, 'pending', '2026-09-20');
    L.exMgrB = await ex(ID.empB, 'manager_approved', '2026-09-21'); L.exRejB = await ex(ID.empB, 'rejected', '2026-09-22');
    await resetAccess();
  });

  await t('/leaves: no params = unchanged (every status, every date); status/from/to narrow server-side', async () => {
    const all = (await call('GET', '/api/leaves', { as: ID.root })).body;
    for (const id of [L.oldApprD, L.rejD, L.deptB, L.rootB]) assert.ok(idsOf(all).includes(Number(id)), 'unfiltered list still contains leave ' + id);
    const pend = (await call('GET', '/api/leaves?status=pending,pending_dept,pending_root', { as: ID.root })).body;
    assert.ok(pend.length > 0 && pend.every(l => ['pending', 'pending_dept', 'pending_root'].includes(l.status)), 'status filter');
    assert.ok(!idsOf(pend).includes(Number(L.oldApprD)) && !idsOf(pend).includes(Number(L.rejD)));
    const recent = (await call('GET', '/api/leaves?from=2025-01-01', { as: ID.root })).body;
    assert.ok(!idsOf(recent).includes(Number(L.oldApprD)), 'leave that ended before "from" excluded');
    assert.ok(idsOf(recent).includes(Number(L.rejD)), 'recent leave kept');
    const upto = (await call('GET', '/api/leaves?to=2025-01-01', { as: ID.root })).body;
    assert.deepStrictEqual(idsOf(upto), [Number(L.oldApprD)], '"to" excludes leaves that start after it');
  });
  await t('/leaves paging: limit/page slice the same ordering; X-Has-More tells whether more rows exist', async () => {
    const full = (await call('GET', '/api/leaves', { as: ID.root })).body;
    const p1 = await call('GET', '/api/leaves?limit=2&page=1', { as: ID.root });
    const p2 = await call('GET', '/api/leaves?limit=2&page=2', { as: ID.root });
    assert.strictEqual(p1.status, 200); assert.strictEqual(p1.body.length, 2);
    assert.strictEqual(p1.headers.get('x-has-more'), full.length > 2 ? '1' : '0');
    assert.deepStrictEqual(idsOf([...p1.body, ...p2.body]), idsOf(full.slice(0, 2 + p2.body.length)), 'pages are consecutive slices of the unpaged order');
    const last = await call('GET', '/api/leaves?limit=500', { as: ID.root });
    assert.strictEqual(last.headers.get('x-has-more'), '0');
  });
  await t('list params are validated (400, no SQL reaches the DB) and never widen access', async () => {
    for (const q of ['status=pending;drop', 'from=2026-13-45', 'to=yesterday', 'limit=0', 'limit=abc'])
      for (const base of ['/api/leaves', '/api/regularization', '/api/expenses'])
        assert.strictEqual((await call('GET', base + '?' + q, { as: ID.root })).status, 400, base + '?' + q);
    // restricted HR + filters: still only the own branch (Dalal), even when the filter would match Bhuj rows
    const hr = (await call('GET', '/api/leaves?status=pending_dept,pending_root&from=2026-01-01', { as: ID.hrD, branch: ID.dalal })).body;
    assert.ok(!idsOf(hr).includes(Number(L.deptB)) && !idsOf(hr).includes(Number(L.rootB)), 'Bhuj leaves never appear for Dalal HR');
    assert.strictEqual((await call('GET', '/api/leaves?limit=5', { as: ID.hrD, branch: ID.bhuj })).status, 403, 'foreign branch still refused');
    // org isolation
    const foreign = (await call('GET', '/api/leaves?status=pending_dept,pending_root,pending', { as: ID.froot })).body;
    assert.ok(!idsOf(foreign).includes(Number(L.deptB)), 'other organisation never visible');
  });
  await t('/regularization and /expenses: status list, date bounds, paging, branch-safe', async () => {
    const r = (await call('GET', '/api/regularization?status=pending', { as: ID.root })).body;
    assert.ok(r.every(x => x.status === 'pending') && idsOf(r).includes(Number(L.regPendD)) && !idsOf(r).includes(Number(L.regRejB)));
    assert.ok(!idsOf((await call('GET', '/api/regularization?from=2025-01-01', { as: ID.root })).body).includes(Number(L.regOldD)));
    assert.ok(idsOf((await call('GET', '/api/regularization', { as: ID.root })).body).includes(Number(L.regOldD)), 'no params = full history as before');
    const rd = (await call('GET', '/api/regularization?status=pending', { as: ID.hrD, branch: ID.dalal })).body;
    assert.ok(idsOf(rd).includes(Number(L.regPendD)) && !idsOf(rd).includes(Number(L.regPendB)), 'Dalal HR: Dalal pending only');
    const e = (await call('GET', '/api/expenses?status=pending,manager_approved', { as: ID.root })).body;
    assert.ok(e.every(x => ['pending', 'manager_approved'].includes(x.status)) && idsOf(e).includes(Number(L.exMgrB)) && !idsOf(e).includes(Number(L.exRejB)));
    assert.strictEqual((await call('GET', '/api/expenses?status=approved', { as: ID.root })).body.every(x => x.status === 'approved'), true, 'single status still works (legacy)');
    assert.ok(!idsOf((await call('GET', '/api/expenses?from=2025-01-01', { as: ID.root })).body).includes(Number(L.exOldD)));
    const ed = (await call('GET', '/api/expenses?status=pending,manager_approved', { as: ID.hrD, branch: ID.dalal })).body;
    assert.ok(idsOf(ed).includes(Number(L.exPendD)) && !idsOf(ed).includes(Number(L.exMgrB)), 'Dalal HR: Dalal claims only');
    const pg = await call('GET', '/api/expenses?limit=1', { as: ID.root });
    assert.strictEqual(pg.body.length, 1); assert.strictEqual(pg.headers.get('x-has-more'), '1');
  });

  await t('/api/pending-approvals returns EXACTLY what the five old requests returned (same rows, same RBAC + branch scope)', async () => {
    const PEND = ['pending', 'pending_approval', 'pending_dept', 'pending_root'];
    const arr = (r) => (Array.isArray(r.body) ? r.body : []);
    for (const who of [{ as: ID.root }, { as: ID.hrD, branch: ID.dalal }, { as: ID.hrB, branch: ID.bhuj }, { as: ID.hrAll }, { as: ID.empD }, { as: ID.empB }, { as: ID.froot }]) {
      const sum = await call('GET', '/api/pending-approvals', who);
      assert.strictEqual(sum.status, 200, JSON.stringify(sum.body));
      const oldLeaves = arr(await call('GET', '/api/leaves', who)).filter(l => PEND.includes(l.status));
      const oldMy = arr(await call('GET', '/api/leaves/my-approvals', who));
      const oldRegs = arr(await call('GET', '/api/regularization', who)).filter(r => r.status === 'pending');
      const oldExp = arr(await call('GET', '/api/expenses', who)).filter(e => ['pending', 'manager_approved'].includes(e.status));
      const label = JSON.stringify(who);
      // a leave that is in my_approvals is sent once (there); what the page can see is unchanged: leaves ∪ my_approvals
      assert.deepStrictEqual(idsOf([...sum.body.leaves, ...sum.body.my_approvals.filter(m => oldLeaves.some(o => Number(o.id) === Number(m.id)))]), idsOf(oldLeaves), 'leaves ' + label);
      assert.ok(!sum.body.leaves.some(l => sum.body.my_approvals.some(m => Number(m.id) === Number(l.id))), 'no leave is sent twice ' + label);
      assert.deepStrictEqual(idsOf(sum.body.my_approvals), idsOf(oldMy), 'my_approvals ' + label);
      assert.deepStrictEqual(idsOf(sum.body.regularizations), idsOf(oldRegs), 'regularizations ' + label);
      assert.deepStrictEqual(idsOf(sum.body.expenses), idsOf(oldExp), 'expenses ' + label);
      assert.deepStrictEqual(sum.body.failed, [], 'no part failed ' + label);
      // enrichment the page relies on is preserved
      for (const l of sum.body.leaves) assert.ok('name' in l || 'user_id' in l, 'leave rows keep the joined user fields');
    }
  });
  await t('/api/pending-approvals respects branch isolation and role', async () => {
    const d = (await call('GET', '/api/pending-approvals', { as: ID.hrD, branch: ID.dalal })).body;
    assert.ok(!idsOf(d.leaves).includes(Number(L.deptB)) && !idsOf(d.regularizations).includes(Number(L.regPendB)) && !idsOf(d.expenses).includes(Number(L.exMgrB)), 'Dalal HR sees no Bhuj item in any section');
    assert.ok(idsOf(d.regularizations).includes(Number(L.regPendD)) && idsOf(d.expenses).includes(Number(L.exPendD)), 'but does see the Dalal items');
    assert.strictEqual((await call('GET', '/api/pending-approvals', { as: ID.hrD, branch: ID.bhuj })).status, 403, 'foreign branch refused before any data is read');
    const e = (await call('GET', '/api/pending-approvals', { as: ID.empD })).body;
    assert.ok(e.leaves.every(l => Number(l.user_id) === ID.empD) && e.regularizations.every(r => Number(r.user_id) === ID.empD), 'an employee only ever gets their own rows');
    const f = (await call('GET', '/api/pending-approvals', { as: ID.froot })).body;
    assert.ok(![...f.leaves, ...f.regularizations, ...f.expenses].some(x => Number(x.organization_id) === ID.orgA), 'other organisation never leaks');
    assert.strictEqual((await call('GET', '/api/pending-approvals', {})).status, 401, 'unauthenticated');
  });


  console.log('\nDASHBOARD — parallelised handler vs the previous sequential handler (same real data)');
  await t('/dashboard returns identical JSON to the sequential version for every kind of caller', async () => {
    // attendance + approved leave for today so the stats are non-trivial
    const today = new Date().toISOString().slice(0, 10);
    await S(`INSERT INTO attendance (user_id, organization_id, date, check_in, status, is_late) VALUES ($1,$2,$3,'09:40','present',true) ON CONFLICT DO NOTHING`, [ID.empD, ID.orgA, today]);
    await S(`INSERT INTO attendance (user_id, organization_id, date, check_in, status) VALUES ($1,$2,$3,'09:00','present') ON CONFLICT DO NOTHING`, [ID.empB, ID.orgA, today]);
    await lv(ID.empB2, 'approved', today, today, 'on leave today');
    await resetAccess();
    const strip = (b) => JSON.parse(JSON.stringify(b));
    for (const who of [{ as: ID.root }, { as: ID.hrD, branch: ID.dalal }, { as: ID.hrB, branch: ID.bhuj }, { as: ID.hrAll }, { as: ID.hrAll, branch: ID.dalal }, { as: ID.empD }, { as: ID.empB }, { as: ID.froot }, { as: ID.root, branch: ID.bhuj }]) {
      const a = await call('GET', '/api/dashboard-before', who), b = await call('GET', '/api/dashboard', who);
      assert.strictEqual(b.status, a.status, 'status ' + JSON.stringify(who));
      // BUG_116 / BUG_191 (intentional change): for admin callers the Pending Approvals card is counted from the SAME source as
      // the Pending Approvals page, so pendingLeaves / pendingRegCount / pendingExpCount legitimately differ from the old
      // handler's own head-counts. Everything else must stay byte-identical; the counts are asserted against the page below.
      const COUNT_KEYS = ['pendingLeaves', 'pendingRegCount', 'pendingExpCount'];
      const A = strip(a.body), B = strip(b.body);
      const pageCounts = { pendingLeaves: B.pendingLeaves, pendingRegCount: B.pendingRegCount, pendingExpCount: B.pendingExpCount };
      for (const k of COUNT_KEYS) { delete A[k]; delete B[k]; }
      assert.deepStrictEqual(B, A, 'body ' + JSON.stringify(who));
      if (b.status === 200 && who.as !== ID.empD && who.as !== ID.empB) {
        const pa = (await call('GET', '/api/pending-approvals', who)).body;
        const total = (pa.leaves || []).length + (pa.my_approvals || []).length + (pa.regularizations || []).length + (pa.expenses || []).length;
        const cardTotal = pageCounts.pendingLeaves || 0;   // /dashboard's pendingLeaves is already leaves + regularizations + expenses (pendingRegCount / pendingExpCount are its parts)
        assert.strictEqual(cardTotal, total, 'dashboard card total == Pending Approvals page total ' + JSON.stringify(who));
      }
    }
    const r = (await call('GET', '/api/dashboard', { as: ID.root })).body;
    assert.ok(r.totalEmployees >= 4 && r.checkedInToday >= 2 && r.onLeaveToday >= 1 && r.pendingLeaves >= 1, 'non-trivial stats were compared: ' + JSON.stringify({ t: r.totalEmployees, c: r.checkedInToday, l: r.onLeaveToday, p: r.pendingLeaves }));
  });
  await t('/dashboard: a branch with NO active employees shows zeros, never org-wide pending counts/names', async () => {
    const hrE = (await one(`INSERT INTO users (name, email, password, role, organization_id, branch_id, employee_status, status, joining_date) VALUES ('HR Empty','hr.empty@t.com','x','admin',$1,NULL,'active','active','2025-01-01') RETURNING id`, [ID.orgA])).id;
    await S(`INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches) VALUES ($1,$2,$3,false)`, [hrE, ID.orgA, ID.ahm]);
    await resetAccess();
    const d = (await call('GET', '/api/dashboard', { as: hrE, branch: ID.ahm })).body;
    assert.strictEqual(d.totalEmployees, 0);
    assert.strictEqual(d.pendingLeaves, 0, 'no org-wide pending count');
    assert.deepStrictEqual(d.pendingLeaveList, [], 'no other branch\'s pending requests');
    assert.deepStrictEqual(d.recentActivity, []);
    const old = (await call('GET', '/api/dashboard-before', { as: hrE, branch: ID.ahm })).body;
    assert.ok(old.pendingLeaves > 0 || old.pendingLeaveList.length > 0, 'the previous handler DID leak org-wide pending data for an empty branch (this is the fixed defect)');
  });


  console.log('\nBRANCH SCOPE AS A SUBQUERY + MEASURED DB STATEMENTS (no runtime-latency claims)');
  const stmtCount = async (fn) => {
    const { pool: appPool } = load('config/db'); let n = 0; const orig = appPool.query.bind(appPool);
    appPool.query = (...a) => { n++; return orig(...a); };
    const t0 = process.hrtime.bigint();
    try { await fn(); } finally { appPool.query = orig; }
    return { n, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  await t('subquery scope == the old id-list scope for specific, multi-branch and all-branch callers (and never crosses org)', async () => {
    const hrM = (await one(`INSERT INTO users (name, email, password, role, organization_id, branch_id, employee_status, status, joining_date) VALUES ('HR Multi','hr.multi@t.com','x','admin',$1,NULL,'active','active','2025-01-01') RETURNING id`, [ID.orgA])).id;
    await S(`INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches) VALUES ($1,$2,$3,false),($1,$2,$4,false)`, [hrM, ID.orgA, ID.dalal, ID.bhuj]);
    await resetAccess();
    const { resolveEmployeeIds, applyBranchUserScope } = load('utils/branchFilter');
    const { withBranchContext } = load('middleware/branchContext');
    for (const who of [{ as: hrM }, { as: hrM, branch: ID.dalal }, { as: ID.hrD, branch: ID.dalal }, { as: ID.hrB, branch: ID.bhuj }, { as: ID.hrAll }, { as: ID.root }]) {
      const lst = (await call('GET', '/api/leaves', who)).body;
      const ids = await new Promise((resolve, reject) => {
        const req = { user: { id: who.as, role: (who.as === ID.root ? 'root_admin' : 'admin'), organization_id: ID.orgA }, headers: who.branch ? { 'x-branch-id': String(who.branch) } : {}, query: {} };
        withBranchContext(req, { status: () => ({ json: (b) => reject(new Error('ctx ' + JSON.stringify(b))) }) }, async () => {
          try { resolve(await resolveEmployeeIds(req.branchContext, ID.orgA)); } catch (e) { reject(e); }
        });
      });
      const expected = (await S(`SELECT id FROM leaves WHERE organization_id=$1 ${ids === null ? '' : 'AND user_id = ANY($2::bigint[])'} ORDER BY id`, ids === null ? [ID.orgA] : [ID.orgA, ids])).map(r => Number(r.id));
      assert.deepStrictEqual(lst.map(l => Number(l.id)).sort((a, b) => a - b), expected, 'leaves visible to ' + JSON.stringify(who));
    }
    // a branch id of another organisation yields NOTHING (the subquery is always constrained to the caller's organisation)
    const q = load('config/db').db.from('leaves').select('id').eq('organization_id', ID.orgA)
      .inBranchUsers('user_id', { orgId: ID.orgA, branchId: ID.foreignBr });
    assert.deepStrictEqual((await q).data, [], 'foreign-org branch never matches Org A users');
    const none = applyBranchUserScope({ inBranchUsers() { throw new Error('must not build a filter'); } }, 'user_id', { selectedBranchId: null, hasAllBranches: false, accessibleBranchIds: [] }, ID.orgA);
    assert.strictEqual(none.empty, true, "'none' fails closed");
  });
  await t('DB statements per request: the consolidated pending-approvals call vs the five requests it replaces', async () => {
    const who = { as: ID.hrD, branch: ID.dalal };
    const old = await stmtCount(async () => {
      await call('GET', '/api/leaves', who); await call('GET', '/api/leaves/pending-root', who); await call('GET', '/api/leaves/my-approvals', who);
      await call('GET', '/api/regularization', who); await call('GET', '/api/expenses', who);
    });
    const neu = await stmtCount(async () => { await call('GET', '/api/pending-approvals', who); });
    console.log(`       measured on the local test DB — old (5 requests): ${old.n} statements, ${old.ms.toFixed(0)} ms | new (1 request): ${neu.n} statements, ${neu.ms.toFixed(0)} ms (small local data; not a production latency claim)`);
    assert.ok(neu.n < old.n, 'fewer DB statements: ' + neu.n + ' vs ' + old.n);
  });


  console.log('\nLEAVE BALANCE — batch endpoint vs the per-employee endpoint');
  await t('GET /leaves/balance/batch returns exactly what GET /leaves/balance returns for each employee', async () => {
    await S(`INSERT INTO leave_policies (organization_id, branch_id, leave_type, label, annual_quota) VALUES ($1,$2,'casual','Casual (Dalal)',10) ON CONFLICT DO NOTHING`, [ID.orgA, ID.dalal]);   // branch-specific quota for Dalal only
    await S(`INSERT INTO leave_balance_adjustments (user_id, org_id, year, leave_type, delta, reason) VALUES ($1,$2,2026,'casual',1.5,'carry')`, [ID.empD, ID.orgA]).catch(() => {});
    await lv(ID.empD, 'approved', '2026-03-02', '2026-03-04', 'balance check');
    await lv(ID.empB, 'approved', '2026-03-09', '2026-03-09', 'balance check');
    await resetAccess();
    const idsAll = [ID.empD, ID.empB, ID.empB2, ID.head];
    const batch = await call('GET', '/api/leaves/balance/batch?year=2026&userIds=' + idsAll.join(','), { as: ID.root });
    assert.strictEqual(batch.status, 200, JSON.stringify(batch.body));
    assert.strictEqual(batch.body.year, 2026);
    for (const id of idsAll) {
      const single = (await call('GET', `/api/leaves/balance?year=2026&userId=${id}`, { as: ID.root })).body;
      assert.deepStrictEqual(batch.body.balances[id], single.balances, 'employee ' + id);
    }
    assert.strictEqual(batch.body.balances[ID.empD].find(b => b.leave_type === 'casual').allocated, 10, 'Dalal employee uses the branch-specific quota');
    assert.strictEqual(batch.body.balances[ID.empB].find(b => b.leave_type === 'casual').allocated, 8, 'Bhuj employee falls back to the org quota');
    assert.ok(batch.body.balances[ID.empD].find(b => b.leave_type === 'casual').adjustment === 1.5 && batch.body.balances[ID.empD].find(b => b.leave_type === 'casual').used > 0, 'adjustments and used days are included');
  });
  await t('GET /leaves/balance/batch keeps RBAC + branch isolation (all-or-nothing, admin only, bounded)', async () => {
    const q = (ids) => '/api/leaves/balance/batch?year=2026&userIds=' + ids.join(',');
    assert.strictEqual((await call('GET', q([ID.empD, ID.head]), { as: ID.hrD, branch: ID.dalal })).status, 200, 'own branch');
    assert.strictEqual((await call('GET', q([ID.empD, ID.empB]), { as: ID.hrD, branch: ID.dalal })).status, 403, 'one foreign-branch id refuses the whole request');
    assert.strictEqual((await call('GET', q([ID.empB]), { as: ID.hrD })).status, 403, 'limited HR without a selection cannot read another branch');
    assert.strictEqual((await call('GET', q([ID.empB]), { as: ID.hrD, branch: ID.bhuj })).status, 403, 'foreign branch header refused');
    assert.strictEqual((await call('GET', q([ID.empD]), { as: ID.empD })).status, 403, 'employees cannot use the admin batch');
    assert.strictEqual((await call('GET', q([ID.empD]), { as: ID.froot })).status, 403, 'another organisation never reads Org A employees');
    assert.strictEqual((await call('GET', q(['abc', ID.empD]), { as: ID.root })).status, 403, 'garbage id');
    assert.strictEqual((await call('GET', q([999999]), { as: ID.root })).status, 403, 'unknown id');
    assert.strictEqual((await call('GET', q(Array.from({ length: 501 }, (_, i) => i + 1)), { as: ID.root })).status, 400, 'bounded');
    assert.deepStrictEqual((await call('GET', '/api/leaves/balance/batch?year=2026', { as: ID.root })).body.balances, {}, 'empty list = empty answer');
  });


  console.log('\nPAYLOAD: compact list view, type filter, server-side counts');
  const KEPT_LEAVE = ['id', 'user_id', 'start_date', 'end_date', 'leave_type', 'leave_time', 'half_type', 'reason', 'remarks', 'status', 'approved_at', 'created_at',
    'dept_head_status', 'root_admin_status', 'workflow_id', 'current_level', 'current_approver_id', 'name', 'avatar_color', 'department', 'approver_name', 'approval_trail'];
  const DROPPED_LEAVE = ['organization_id', 'google_event_id', 'deleted_at', 'dept_head_id', 'dept_head_reviewed_at', 'root_admin_id', 'root_admin_reviewed_at', 'approved_by', 'email'];
  await t('GET /leaves?view=list drops only unused columns; without view the full row is unchanged; same rows either way', async () => {
    const full = (await call('GET', '/api/leaves', { as: ID.root })).body, lite = (await call('GET', '/api/leaves?view=list', { as: ID.root })).body;
    assert.deepStrictEqual(idsOf(lite), idsOf(full), 'identical set of rows');
    for (const k of DROPPED_LEAVE) { assert.ok(k in full[0], 'full row still has ' + k); assert.ok(!(k in lite[0]), 'compact row dropped ' + k); }
    for (const k of KEPT_LEAVE) assert.ok(k in lite[0], 'compact row keeps ' + k);
    const byId = new Map(full.map(r => [r.id, r]));
    for (const r of lite) for (const k of Object.keys(r)) assert.deepStrictEqual(r[k], byId.get(r.id)[k], k + ' value unchanged');
    assert.ok(JSON.stringify(lite).length < JSON.stringify(full).length, 'smaller');
    assert.strictEqual((await call('GET', '/api/leaves?view=full', { as: ID.root })).status, 400);
  });
  await t('GET /leaves?type= filters server-side; invalid type refused; scope unchanged', async () => {
    await lv(ID.empD, 'approved', '2026-05-05', '2026-05-05', 'sick for type filter');
    await S(`UPDATE leaves SET leave_type='sick' WHERE reason='sick for type filter'`);
    const sick = (await call('GET', '/api/leaves?type=sick', { as: ID.root })).body;
    assert.ok(sick.length > 0 && sick.every(l => l.leave_type === 'sick'));
    const both = (await call('GET', '/api/leaves?type=sick,casual', { as: ID.root })).body;
    assert.ok(both.every(l => ['sick', 'casual'].includes(l.leave_type)) && both.length >= sick.length);
    assert.strictEqual((await call('GET', '/api/leaves?type=casual;drop', { as: ID.root })).status, 400);
    const d = (await call('GET', '/api/leaves?type=casual&view=list', { as: ID.hrD, branch: ID.dalal })).body;
    assert.ok(!idsOf(d).includes(Number(L.deptB)) && !idsOf(d).includes(Number(L.rootB)), 'Dalal HR never gets Bhuj rows');
  });
  await t('GET /leaves/counts equals the counts computed from the rows it replaces (admin scope, branch scope, own, from, userId)', async () => {
    await lv(ID.empD, 'pending', '2026-12-20', '2026-12-20', 'wfh pending test').then(id => S(`UPDATE leaves SET leave_time='wfh', leave_type='wfh' WHERE id=$1`, [id]));
    await resetAccess();
    const PEND = ['pending', 'pending_dept', 'pending_root', 'pending_approval'];
    const fromRows = (rows) => ({ pending: rows.filter(l => PEND.includes(l.status) && l.leave_time !== 'wfh' && l.leave_type !== 'wfh').length,
                                  wfh_pending: rows.filter(l => PEND.includes(l.status) && (l.leave_time === 'wfh' || l.leave_type === 'wfh')).length });
    for (const who of [{ as: ID.root }, { as: ID.hrD, branch: ID.dalal }, { as: ID.hrB, branch: ID.bhuj }, { as: ID.hrAll }, { as: ID.empD }, { as: ID.empB }]) {
      for (const qs of ['', '?from=2026-06-01']) {
        const rows = (await call('GET', '/api/leaves' + qs, who)).body;
        const c = await call('GET', '/api/leaves/counts' + qs, who);
        assert.strictEqual(c.status, 200, JSON.stringify(c.body));
        assert.deepStrictEqual({ pending: c.body.pending, wfh_pending: c.body.wfh_pending }, fromRows(rows), JSON.stringify(who) + ' ' + qs);
      }
    }
    assert.ok((await call('GET', '/api/leaves/counts', { as: ID.root })).body.wfh_pending >= 1, 'wfh pending is counted separately');
    const one = await call('GET', `/api/leaves/counts?userId=${ID.empD}`, { as: ID.hrD, branch: ID.dalal });
    assert.deepStrictEqual({ pending: one.body.pending, wfh_pending: one.body.wfh_pending }, fromRows((await call('GET', `/api/leaves?userId=${ID.empD}`, { as: ID.hrD, branch: ID.dalal })).body));
    assert.strictEqual((await call('GET', `/api/leaves/counts?userId=${ID.empB}`, { as: ID.hrD, branch: ID.dalal })).status, 403, 'other branch employee refused');
    assert.strictEqual((await call('GET', '/api/leaves/counts', { as: ID.hrD, branch: ID.bhuj })).status, 403, 'foreign branch header refused');
    const f = (await call('GET', '/api/leaves/counts', { as: ID.froot })).body;
    assert.ok(f.pending === 0 && f.wfh_pending === 0, 'another organisation counts only its own leaves');
    assert.strictEqual((await call('GET', '/api/leaves/counts?from=not-a-date', { as: ID.root })).status, 400);
  });
  await t('regularization / expenses ?view=list: same rows, unused columns dropped, every field the screens read kept', async () => {
    const rf = (await call('GET', '/api/regularization', { as: ID.root })).body, rl = (await call('GET', '/api/regularization?view=list', { as: ID.root })).body;
    assert.deepStrictEqual(idsOf(rl), idsOf(rf));
    for (const k of ['organization_id', 'reviewed_by']) { assert.ok(k in rf[0]); assert.ok(!(k in rl[0])); }
    for (const k of ['id', 'user_id', 'date', 'requested_check_in', 'requested_check_out', 'reason', 'status', 'reviewer_notes', 'reviewed_at', 'created_at', 'type', 'requested_early_exit_time', 'actual_check_in', 'actual_check_out', 'user_name', 'user_avatar_color', 'user_department', 'user_position', 'reviewer_name']) { if (k in rf[0]) assert.ok(k in rl[0], 'regularization keeps ' + k); }
    const ef = (await call('GET', '/api/expenses', { as: ID.root })).body, el = (await call('GET', '/api/expenses?view=list', { as: ID.root })).body;
    assert.deepStrictEqual(idsOf(el), idsOf(ef));
    for (const k of ['organization_id', 'deleted_at', 'reviewed_by', 'manager_approved_at']) { assert.ok(k in ef[0]); assert.ok(!(k in el[0])); }
    for (const k of ['id', 'user_id', 'title', 'category', 'amount', 'expense_date', 'description', 'receipt_url', 'receipt_filename', 'merchant_name', 'receipt_number', 'status', 'reviewer_notes', 'reviewed_at', 'created_at', 'manager_id', 'manager_notes', 'user_name', 'user_avatar_color', 'user_department', 'reviewer_name', 'manager_name']) { if (k in ef[0]) assert.ok(k in el[0], 'expenses keeps ' + k); }   // (a column the scratch schema lacks cannot be asserted)
    assert.strictEqual((await call('GET', '/api/expenses?view=nope', { as: ID.root })).status, 400);
    const hr = (await call('GET', '/api/regularization?view=list', { as: ID.hrD, branch: ID.dalal })).body;
    assert.ok(!idsOf(hr).includes(Number(L.regPendB)), 'branch isolation unchanged under the compact view');
  });
  await t('pending-approvals summary uses the compact rows and still equals the per-endpoint results (ids)', async () => {
    const sum = (await call('GET', '/api/pending-approvals', { as: ID.root })).body;
    for (const row of sum.leaves) for (const k of DROPPED_LEAVE) assert.ok(!(k in row), 'summary leaf row has no ' + k);
    for (const row of sum.expenses) assert.ok(!('organization_id' in row));
    const PEND = ['pending', 'pending_approval', 'pending_dept', 'pending_root'];
    const oldPend = (await call('GET', '/api/leaves', { as: ID.root })).body.filter(l => PEND.includes(l.status));
    assert.deepStrictEqual(idsOf([...sum.leaves, ...sum.my_approvals.filter(m => oldPend.some(o => Number(o.id) === Number(m.id)))]), idsOf(oldPend), 'every pending leave is present exactly once (in leaves or my_approvals)');
  });

  // ════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nLEAVES PAGINATION + SUMMARY COUNTS (Phase 5) on real SQL');
  const P5 = 'p5bulk';
  async function p5Seed() {
    await resetAccess();
    // Dalal: 60 leaves, Bhuj: 20 leaves. status / type / wfh / dates cycle so every filter has rows to bite on.
    const ins = (uid, n, off) => S(
      `INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason)
       SELECT $1, $2, ('2027-02-01'::date + (g + $4)), ('2027-02-01'::date + (g + $4)),
              (ARRAY['casual','sick','annual','wfh'])[1 + (g % 4)],
              CASE WHEN g % 4 = 3 THEN 'wfh' ELSE 'full' END,
              (ARRAY['pending','approved','rejected','pending_dept','cancelled'])[1 + (g % 5)], $3
         FROM generate_series(1, $5) g`, [uid, ID.orgA, P5, off, n]);
    await ins(ID.empD, 60, 0); await ins(ID.empB, 20, 100);
  }
  await p5Seed();
  const tot = (r) => Number(r.headers.get('x-total'));
  const dalalAll = Number((await one(`SELECT COUNT(*) c FROM leaves l JOIN users u ON u.id=l.user_id WHERE l.organization_id=$1 AND u.branch_id=$2`, [ID.orgA, ID.dalal])).c);
  const orgAll = Number((await one(`SELECT COUNT(*) c FROM leaves WHERE organization_id=$1`, [ID.orgA])).c);

  await t('pagination metadata: X-Total / X-Total-Pages / X-Page / X-Limit / X-Has-More are right on first, middle, last and past-the-end pages', async () => {
    const who = { as: ID.root };
    const p1 = await call('GET', '/api/leaves?view=list&limit=25&page=1', who);
    assert.strictEqual(p1.status, 200); assert.strictEqual(p1.body.length, 25);
    assert.strictEqual(tot(p1), orgAll, 'X-Total is the whole filtered set, not the page');
    assert.strictEqual(Number(p1.headers.get('x-total-pages')), Math.ceil(orgAll / 25));
    assert.strictEqual(p1.headers.get('x-page'), '1'); assert.strictEqual(p1.headers.get('x-limit'), '25'); assert.strictEqual(p1.headers.get('x-has-more'), '1');
    const lastPage = Math.ceil(orgAll / 25);
    const last = await call('GET', `/api/leaves?view=list&limit=25&page=${lastPage}`, who);
    assert.strictEqual(last.body.length, orgAll - 25 * (lastPage - 1)); assert.strictEqual(last.headers.get('x-has-more'), '0');
    const past = await call('GET', `/api/leaves?view=list&limit=25&page=${lastPage + 3}`, who);
    assert.deepStrictEqual(past.body, []); assert.strictEqual(tot(past), orgAll, 'total still reported past the end (client clamps to the last page)');
  });
  await t('pages are a stable partition: no row twice, none missed, equal to the un-paged list', async () => {
    const who = { as: ID.root };
    const all = idsOf((await call('GET', '/api/leaves?view=list', who)).body);
    const seen = [];
    for (let pg = 1; pg <= Math.ceil(orgAll / 20); pg++) seen.push(...(await call('GET', `/api/leaves?view=list&limit=20&page=${pg}`, who)).body.map(r => Number(r.id)));
    assert.strictEqual(new Set(seen).size, seen.length, 'no duplicates across pages');
    assert.deepStrictEqual([...seen].sort((a, b) => a - b), all);
  });
  await t('no limit → unchanged contract: plain array, no paging headers (every other screen keeps working)', async () => {
    const r = await call('GET', '/api/leaves?view=list', { as: ID.root });
    assert.ok(Array.isArray(r.body)); assert.strictEqual(r.headers.get('x-total'), null);
    assert.strictEqual(r.body.length, orgAll);
  });
  await t('filtered total: status / type / kind / date range / employee each narrow BOTH the page and the total identically', async () => {
    const who = { as: ID.root };
    const cases = {
      'status=approved': (l) => l.status === 'approved',
      'status=pending,pending_dept': (l) => ['pending', 'pending_dept'].includes(l.status),
      'type=sick': (l) => l.leave_type === 'sick',
      'kind=wfh': (l) => l.leave_time === 'wfh' || l.leave_type === 'wfh',
      'kind=leave': (l) => l.leave_time !== 'wfh' && l.leave_type !== 'wfh',
      'from=2027-02-10&to=2027-02-20': (l) => l.end_date >= '2027-02-10' && l.start_date <= '2027-02-20',
      [`userId=${ID.empB}`]: (l) => Number(l.user_id) === ID.empB,
      [`kind=leave&type=casual&status=approved&userId=${ID.empD}`]: (l) => l.leave_type === 'casual' && l.status === 'approved' && Number(l.user_id) === ID.empD && l.leave_time !== 'wfh',
    };
    const everything = (await call('GET', '/api/leaves', who)).body.map(l => ({ ...l, start_date: String(l.start_date).slice(0, 10), end_date: String(l.end_date).slice(0, 10) }));
    for (const [qs, pred] of Object.entries(cases)) {
      const expected = everything.filter(pred).length;
      const r = await call('GET', `/api/leaves?view=list&limit=7&page=1&${qs}`, who);
      assert.strictEqual(r.status, 200, qs + ' ' + JSON.stringify(r.body));
      assert.strictEqual(tot(r), expected, 'X-Total for ' + qs);
      assert.strictEqual(r.body.length, Math.min(7, expected), 'page size for ' + qs);
    }
  });
  await t('summary counts describe the WHOLE filtered set (not the page) and equal the list totals', async () => {
    for (const who of [{ as: ID.root }, { as: ID.hrD, branch: ID.dalal }, { as: ID.hrB, branch: ID.bhuj }, { as: ID.hrAll }, { as: ID.empD }, { as: ID.empB }]) {
      for (const qs of ['', 'kind=leave', 'kind=wfh', 'kind=leave&type=sick', 'from=2027-02-05&to=2027-03-10&kind=leave']) {
        const c = (await call('GET', `/api/leaves/counts?${qs}`, who)).body;
        const totalOf = async (extra) => tot(await call('GET', `/api/leaves?view=list&limit=1&${qs}${extra}`, who));
        assert.strictEqual(c.summary.total, await totalOf(''), JSON.stringify(who) + ' total ' + qs);
        assert.strictEqual(c.summary.approved, await totalOf('&status=approved'), 'approved ' + qs);
        assert.strictEqual(c.summary.rejected, await totalOf('&status=rejected'), 'rejected ' + qs);
        assert.strictEqual(c.summary.pending, await totalOf('&status=pending,pending_dept,pending_root,pending_approval'), 'pending ' + qs);
        assert.ok(c.summary.pending + c.summary.approved + c.summary.rejected <= c.summary.total, 'cancelled etc. are only in the total');
        assert.strictEqual(c.filtered_total, c.summary.total, 'no status filter → filtered_total = total');
      }
    }
    const big = (await call('GET', '/api/leaves/counts?kind=leave', { as: ID.root })).body;
    assert.ok(big.summary.total > 25, 'the cards cover far more rows than one 25-row page');
  });
  await t('status filter narrows filtered_total (pagination) but NOT the cards (they stay the breakdown)', async () => {
    const who = { as: ID.root };
    const base = (await call('GET', '/api/leaves/counts?kind=leave', who)).body;
    const ap = (await call('GET', '/api/leaves/counts?kind=leave&status=approved', who)).body;
    assert.deepStrictEqual(ap.summary, base.summary, 'cards identical with or without the status filter');
    assert.strictEqual(ap.filtered_total, base.summary.approved);
    assert.strictEqual(ap.filtered_total, tot(await call('GET', '/api/leaves?view=list&limit=10&kind=leave&status=approved', who)));
    const two = (await call('GET', '/api/leaves/counts?kind=leave&status=approved,rejected', who)).body;
    assert.strictEqual(two.filtered_total, base.summary.approved + base.summary.rejected);
  });
  await t('tab badges (pending / wfh_pending) ignore type/kind/status filters but follow the date window', async () => {
    const who = { as: ID.root };
    const a = (await call('GET', '/api/leaves/counts', who)).body, b = (await call('GET', '/api/leaves/counts?kind=wfh&type=sick&status=approved', who)).body;
    assert.strictEqual(a.pending, b.pending); assert.strictEqual(a.wfh_pending, b.wfh_pending);
    const w = (await call('GET', '/api/leaves/counts?from=2027-02-01&to=2027-02-10', who)).body;
    assert.ok(w.pending <= a.pending && w.wfh_pending <= a.wfh_pending);
  });
  await t('branch isolation: HR Dalal / HR Bhuj / HR All / root totals, counts and pages never cross branches', async () => {
    const d = await call('GET', '/api/leaves?view=list&limit=25', { as: ID.hrD, branch: ID.dalal });
    assert.strictEqual(tot(d), dalalAll);
    for (const r of d.body) assert.strictEqual(Number(r.user_id) === ID.empB, false, 'no Bhuj row on a Dalal page');
    const dc = (await call('GET', '/api/leaves/counts', { as: ID.hrD, branch: ID.dalal })).body;
    assert.strictEqual(dc.summary.total, dalalAll);
    const bc = (await call('GET', '/api/leaves/counts', { as: ID.hrB, branch: ID.bhuj })).body;
    assert.ok(bc.summary.total > 0 && bc.summary.total < dalalAll + bc.summary.total);
    assert.strictEqual(dc.summary.total + bc.summary.total, orgAll, 'Dalal + Bhuj partition the org here');
    // limited HR with NO branch header: multi-branch scope = only their own branch
    assert.strictEqual(tot(await call('GET', '/api/leaves?view=list&limit=5', { as: ID.hrD })), dalalAll);
    assert.strictEqual((await call('GET', '/api/leaves/counts', { as: ID.hrD })).body.summary.total, dalalAll);
    // forbidden header → refused for rows and counts, never silently widened
    assert.strictEqual((await call('GET', '/api/leaves?view=list&limit=5', { as: ID.hrD, branch: ID.bhuj })).status, 403);
    assert.strictEqual((await call('GET', '/api/leaves/counts', { as: ID.hrD, branch: ID.bhuj })).status, 403);
    // all-branch HR and root see the org
    assert.strictEqual(tot(await call('GET', '/api/leaves?view=list&limit=5', { as: ID.hrAll })), orgAll);
    assert.strictEqual(tot(await call('GET', `/api/leaves?view=list&limit=5`, { as: ID.root, branch: ID.bhuj })), bc.summary.total, 'root can narrow to one branch');
    // another organisation sees none of it
    const f = await call('GET', '/api/leaves?view=list&limit=25', { as: ID.froot });
    assert.deepStrictEqual(f.body, []); assert.strictEqual(tot(f), 0);
    assert.strictEqual((await call('GET', '/api/leaves/counts', { as: ID.froot })).body.summary.total, 0);
  });
  await t('employees: pages and counts cover only their own leaves; userId of someone else is ignored for them', async () => {
    const mine = await call('GET', '/api/leaves?view=list&limit=25', { as: ID.empB });
    for (const r of mine.body) assert.strictEqual(Number(r.user_id), ID.empB);
    const own = Number((await one(`SELECT COUNT(*) c FROM leaves WHERE user_id=$1`, [ID.empB])).c);
    assert.strictEqual(tot(mine), own);
    assert.strictEqual((await call('GET', '/api/leaves/counts', { as: ID.empB })).body.summary.total, own);
    assert.strictEqual(tot(await call('GET', `/api/leaves?view=list&limit=5&userId=${ID.empD}`, { as: ID.empB })), own, 'cannot read a colleague through ?userId');
  });
  await t('empty result and single-page result', async () => {
    const empty = await call('GET', '/api/leaves?view=list&limit=25&status=rejected&type=sick&userId=' + ID.empB + '&from=2030-01-01', { as: ID.root });
    assert.deepStrictEqual(empty.body, []); assert.strictEqual(tot(empty), 0); assert.strictEqual(empty.headers.get('x-total-pages'), '1'); assert.strictEqual(empty.headers.get('x-has-more'), '0');
    const c = (await call('GET', '/api/leaves/counts?from=2030-01-01', { as: ID.root })).body;
    assert.deepStrictEqual(c.summary, { total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 }); assert.strictEqual(c.filtered_total, 0);
    const single = await call('GET', `/api/leaves?view=list&limit=100&userId=${ID.empB}`, { as: ID.root });
    assert.ok(single.body.length <= 100 && single.headers.get('x-total-pages') === '1' && single.headers.get('x-has-more') === '0');
  });
  await t('summary cards add up: total = pending + approved + rejected + cancelled/withdrawn', async () => {
    await S(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,'2031-03-03','2031-03-03','casual','full','withdrawn','x'),($1,$2,'2031-03-04','2031-03-04','casual','full','cancelled','x')`, [ID.empB, ID.orgA]);
    const c = (await call('GET', '/api/leaves/counts?from=2031-03-01&to=2031-03-31', { as: ID.root })).body.summary;
    assert.strictEqual(c.cancelled, 2, JSON.stringify(c));
    assert.strictEqual(c.total, c.pending + c.approved + c.rejected + c.cancelled, JSON.stringify(c));
    await S(`DELETE FROM leaves WHERE start_date >= '2031-03-01' AND start_date <= '2031-03-31'`);
  });
  await t('sort=start_asc returns the soonest start first; default stays newest-created first', async () => {
    const rows = (await call('GET', '/api/leaves?view=list&limit=40&sort=start_asc&status=approved', { as: ID.root })).body.map(r => String(r.start_date).slice(0, 10));
    assert.deepStrictEqual(rows, [...rows].sort());
    const def = (await call('GET', '/api/leaves?view=list&limit=40', { as: ID.root })).body.map(r => new Date(r.created_at).getTime());
    assert.deepStrictEqual(def, [...def].sort((a, b) => b - a));
  });
  await t('invalid list params are rejected (400), never silently ignored', async () => {
    for (const qs of ['limit=0', 'limit=abc', 'kind=nope', 'sort=random', 'status=Bad-Status!', 'from=2026-13-45', 'to=tomorrow'])
      assert.strictEqual((await call('GET', '/api/leaves?view=list&' + qs, { as: ID.root })).status, 400, qs);
    for (const qs of ['kind=nope', 'status=x y', 'to=tomorrow'])
      assert.strictEqual((await call('GET', '/api/leaves/counts?' + qs, { as: ID.root })).status, 400, 'counts ' + qs);
    assert.ok(Number((await call('GET', '/api/leaves?view=list&limit=9999', { as: ID.root })).headers.get('x-limit')) <= 500, 'limit is capped');
  });
  await t('approval / rejection / cancellation keep working and the cards + totals move with them', async () => {
    const pend = (await one(`SELECT id FROM leaves WHERE reason=$1 AND status='pending' AND user_id=$2 ORDER BY id LIMIT 1`, [P5, ID.empD])).id;
    const before = (await call('GET', '/api/leaves/counts?kind=leave', { as: ID.hrD, branch: ID.dalal })).body;
    const ap = await call('PUT', `/api/leaves/${pend}/approve`, { as: ID.hrD, branch: ID.dalal, body: {} });
    assert.strictEqual(ap.status, 200, JSON.stringify(ap.body));
    const after = (await call('GET', '/api/leaves/counts?kind=leave', { as: ID.hrD, branch: ID.dalal })).body;
    assert.strictEqual(after.summary.approved, before.summary.approved + 1);
    assert.strictEqual(after.summary.pending, before.summary.pending - 1);
    assert.strictEqual(after.summary.total, before.summary.total, 'total unchanged by a status move');
    assert.strictEqual((await call('PUT', `/api/leaves/${pend}/approve`, { as: ID.hrB, branch: ID.bhuj, body: {} })).status, 403, 'other-branch HR still cannot act');
  });
  await S(`DELETE FROM leaves WHERE reason=$1`, [P5]);
  await resetAccess();

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


  console.log('\nSALARY STRUCTURE READ (GET /api/payroll/structure?userId=) — branch isolation');
  await t('payroll/structure: HR sees own-branch employee, is refused other-branch / all-branches HR sees both / root sees both', async () => {
    await resetAccess();
    await S(`DELETE FROM employee_salary_structures WHERE user_id = ANY($1::bigint[])`, [[ID.empD, ID.empB]]);
    for (const u of [ID.empD, ID.empB])
      await S(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, hra, gross_salary, ctc) VALUES ($1,$2,'2026-01-01',30000,15000,45000,540000)`, [ID.orgA, u]);
    const own = await call('GET', `/api/payroll/structure?userId=${ID.empD}`, { as: ID.hrD, branch: ID.dalal });
    assert.strictEqual(own.status, 200, JSON.stringify(own.body));
    assert.strictEqual(Number(own.body.user_id), ID.empD);
    const cross = await call('GET', `/api/payroll/structure?userId=${ID.empB}`, { as: ID.hrD, branch: ID.dalal });
    assert.strictEqual(cross.status, 403, 'HR Dalal must not read a Bhuj salary structure: ' + JSON.stringify(cross.body));
    const crossNoHdr = await call('GET', `/api/payroll/structure?userId=${ID.empB}`, { as: ID.hrD });
    assert.strictEqual(crossNoHdr.status, 403, 'no header must not widen access');
    assert.strictEqual((await call('GET', `/api/payroll/structure?userId=${ID.empB}`, { as: ID.hrB, branch: ID.bhuj })).status, 200);
    assert.strictEqual((await call('GET', `/api/payroll/structure?userId=${ID.empB}`, { as: ID.hrAll })).status, 200, 'all-branches HR');
    assert.strictEqual((await call('GET', `/api/payroll/structure?userId=${ID.empB}`, { as: ID.root })).status, 200, 'root admin');
    assert.strictEqual((await call('GET', `/api/payroll/structure?userId=${ID.empD}`, { as: ID.root })).status, 200, 'root admin');
  });
  await t('payroll/structure: multi-branch HR reads both of their branches, not a third', async () => {
    const hrX = await one(`INSERT INTO users (name,email,password,role,organization_id,employee_status,status,joining_date) VALUES ('HR Multi2','hr.multi2@t.com','x','admin',$1,'active','active','2025-01-01') RETURNING id`, [ID.orgA]);
    await S(`INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches) VALUES ($1,$2,$3,false),($1,$2,$4,false)`, [hrX.id, ID.orgA, ID.dalal, ID.bhuj]);
    await S(`INSERT INTO user_roles (user_id, role_id, org_id) SELECT $1, r.id, $2 FROM roles r WHERE r.org_id=$2 AND r.slug='hr_admin' ON CONFLICT DO NOTHING`, [hrX.id, ID.orgA]).catch(() => {});
    const ahmEmp = await one(`INSERT INTO users (name,email,password,role,organization_id,branch_id,employee_status,status,joining_date) VALUES ('Emp Ahm','emp.ahm2@t.com','x','employee',$1,$2,'active','active','2025-01-01') RETURNING id`, [ID.orgA, ID.ahm]);
    await S(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, hra, gross_salary, ctc) VALUES ($1,$2,'2026-01-01',1,1,2,24)`, [ID.orgA, ahmEmp.id]);
    await resetAccess();
    assert.strictEqual((await call('GET', `/api/payroll/structure?userId=${ID.empD}`, { as: Number(hrX.id) })).status, 200);
    assert.strictEqual((await call('GET', `/api/payroll/structure?userId=${ID.empB}`, { as: Number(hrX.id) })).status, 200);
    assert.strictEqual((await call('GET', `/api/payroll/structure?userId=${ahmEmp.id}`, { as: Number(hrX.id) })).status, 403, 'third branch refused');
  });
  await t('payroll/structure: cross-organisation read is impossible (root of org B reading an org A employee)', async () => {
    const r = await call('GET', `/api/payroll/structure?userId=${ID.empD}`, { as: ID.froot });
    assert.ok(r.status === 403 || r.body === null, `foreign root must get nothing: ${r.status} ${JSON.stringify(r.body)}`);
    assert.ok(!r.body || !r.body.ctc, 'no salary data leaked across organisations');
  });
  await t('payroll/structure: Branching OFF org -> HR (no branch grants) reads any employee of their own org', async () => {
    const hrC = await one(`INSERT INTO users (name,email,password,role,organization_id,employee_status,status,joining_date) VALUES ('HR C','hr.c@t.com','x','admin',$1,'active','active','2025-01-01') RETURNING id`, [ID.orgC]);
    await S(`INSERT INTO user_roles (user_id, role_id, org_id) SELECT $1, r.id, $2 FROM roles r WHERE r.org_id=$2 AND r.slug='hr_admin' ON CONFLICT DO NOTHING`, [hrC.id, ID.orgC]).catch(() => {});
    await S(`DELETE FROM employee_salary_structures WHERE user_id=$1`, [ID.empC]);
    await S(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, hra, gross_salary, ctc) VALUES ($1,$2,'2026-01-01',20000,10000,30000,360000)`, [ID.orgC, ID.empC]);
    await resetAccess();
    const r = await call('GET', `/api/payroll/structure?userId=${ID.empC}`, { as: Number(hrC.id) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  });
  await t('payroll/structure: an employee still only reads their own structure (userId ignored)', async () => {
    const r = await call('GET', `/api/payroll/structure?userId=${ID.empB}`, { as: ID.empD });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(Number(r.body?.user_id), ID.empD);
  });

  console.log('\nNOTIFICATIONS follow the selected branch (subject_user_id)');
  await t('notification list + unread badge: branch selected -> that branch + employee-independent; legacy untagged stay visible; no header = everything', async () => {
    await S(`DELETE FROM notifications WHERE user_id = $1`, [ID.root]);
    const ins = (title, subj) => S(`INSERT INTO notifications (user_id,title,message,type,organization_id,subject_user_id) VALUES ($1,$2,'m','general',$3,$4)`, [ID.root, title, ID.orgA, subj]);
    await ins('about Dalal emp', ID.empD); await ins('about Bhuj emp', ID.empB); await ins('legacy untagged', null);
    const titles = (r) => r.body.map(n => n.title).sort();
    assert.deepStrictEqual(titles(await call('GET', '/api/notifications', { as: ID.root, branch: ID.dalal })), ['about Dalal emp', 'legacy untagged']);
    assert.deepStrictEqual(titles(await call('GET', '/api/notifications', { as: ID.root, branch: ID.bhuj })), ['about Bhuj emp', 'legacy untagged']);
    assert.deepStrictEqual(titles(await call('GET', '/api/notifications', { as: ID.root })), ['about Bhuj emp', 'about Dalal emp', 'legacy untagged']);
    assert.strictEqual((await call('GET', '/api/notifications/unread-count', { as: ID.root, branch: ID.dalal })).body.count, 2);
    assert.strictEqual((await call('GET', '/api/notifications/unread-count', { as: ID.root })).body.count, 3);
    assert.strictEqual((await call('GET', '/api/notifications', { as: ID.root, branch: ID.foreignBr })).status, 403, 'a foreign branch header is refused');
  });
  await t('notifications: a subject from ANOTHER organisation never matches a branch (org-guarded join)', async () => {
    await S(`DELETE FROM notifications WHERE user_id = $1`, [ID.root]);
    await S(`INSERT INTO notifications (user_id,title,message,type,organization_id,subject_user_id) VALUES ($1,'foreign subject','m','general',$2,$3)`, [ID.root, ID.orgA, ID.femp]);
    assert.deepStrictEqual((await call('GET', '/api/notifications', { as: ID.root, branch: ID.dalal })).body, []);
  });
  await t('notifications: admin alerts are tagged at creation (regularization request carries the requesting employee)', async () => {
    await S(`DELETE FROM notifications WHERE user_id = $1`, [ID.root]);
    await S(`DELETE FROM attendance_regularization WHERE user_id=$1`, [ID.empD]).catch(() => {});
    const r = await call('POST', '/api/regularization', { as: ID.empD, body: { date: '2026-09-02', type: 'check_time', requested_check_in: '09:00', requested_check_out: '18:00', reason: 'forgot' } });
    if (r.status >= 400) console.log('    (regularization create returned', r.status, JSON.stringify(r.body), ')');
    const row = await until(async () => (await S(`SELECT subject_user_id FROM notifications WHERE user_id=$1 AND type='regularization'`, [ID.root]))[0], 3000);
    assert.ok(row, 'root was notified'); assert.strictEqual(Number(row.subject_user_id), ID.empD);
  });


  console.log('\nBRANCHING ON vs OFF: creating an employee');
  await t('create employee, no branch given, 2+ active branches: ON -> "Branch is required"; OFF -> allowed (organisation-wide, nothing guessed)', async () => {
    await S(`INSERT INTO branches (org_id, name, code, is_active) VALUES ($1,'C One','C1',true),($1,'C Two','C2',true)`, [ID.orgC]);
    await S(`UPDATE organization_features SET enabled = true WHERE organization_id=$1 AND feature_key='branches'`, [ID.orgC]);
    await resetAccess();
    const on = await call('POST', '/api/employees', { as: ID.rootC, body: { name: 'New On', email: 'new.on@t.com' } });
    assert.strictEqual(on.status, 400, JSON.stringify(on.body)); assert.match(on.body.error, /Branch is required/);
    await S(`UPDATE organization_features SET enabled = false WHERE organization_id=$1 AND feature_key='branches'`, [ID.orgC]);
    await resetAccess();
    const off = await call('POST', '/api/employees', { as: ID.rootC, body: { name: 'New Off', email: 'new.off@t.com' } });
    assert.ok(off.status < 300, 'OFF must not demand a branch: ' + off.status + ' ' + JSON.stringify(off.body));
    const row = await one(`SELECT branch_id FROM users WHERE email='new.off@t.com'`);
    assert.strictEqual(row.branch_id, null, 'no branch is guessed');
  });

  server.close();
  console.log(`\n${'─'.repeat(64)}\nReal-DB results (PostgreSQL ${(await one('show server_version')).server_version}, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
  console.log('\n✅  All real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
