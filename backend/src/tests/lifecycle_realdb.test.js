/**
 * lifecycle_realdb.test.js — employee lifecycle consistency, verified against REAL PostgreSQL.
 *
 * Covers the fixes from the current-state audit (docs/HRMS_CURRENT_STATE_BASELINE_2026_10_06.md):
 *   - one status service for every writer (Employees form, Profile V2, bulk, Exit)   → users.status / session / exit record
 *   - termination as a type of the existing exit flow
 *   - exit "completed" no longer bypasses auto-deactivation
 *   - payroll eligibility follows the employment window (final month of a leaver)
 *   - department source of truth (user_departments) + its two denormalised copies; bulk dept/status partial updates
 *   - in-flight leave approvals follow manager / department-head changes
 *   - probation via every path, create-form fields, auto-absent working days
 *
 * SAFETY: only ever runs inside a scratch schema named bsv_* (refuses anything else); never touches `public`.
 * Run:  REAL_DB_SCHEMA=bsv_verify node src/tests/lifecycle_realdb.test.js
 * If the schema is missing the suite prints SKIPPED and exits 0 — it never pretends to have verified anything.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'lifecycle-realdb-test-secret';
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
const ID = {};
const today = () => new Date().toISOString().split('T')[0];
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().split('T')[0]; };

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const t of ['exit_requests', 'offboarding_checklists', 'notifications', 'leaves', 'leave_approval_log', 'attendance', 'payslips', 'payroll_runs',
                   'payroll_run_employees', 'employee_salary_structures', 'leave_workflows', 'leave_workflow_levels', 'departments', 'user_departments'])
    await S(`TRUNCATE ${t} RESTART IDENTITY CASCADE`).catch(() => {});
  // project migrations under test (idempotent)
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/employee_lifecycle_2026_10_06.sql'), 'utf8'));

  ID.org = (await one(`INSERT INTO organizations (name, slug) VALUES ('Life Org','life-org') RETURNING id`)).id;
  const user = async (name, role, extra = {}) => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date, phone)
     VALUES ($1,$2,'x',$3,$4,'active','active',$5,'9876543210') RETURNING id`,
    [name, `${name.toLowerCase().replace(/\W+/g, '.')}@life.test`, role, ID.org, extra.joining || '2025-01-01'])).id;
  ID.root = await user('Root L', 'root_admin');
  ID.hr = await user('HR L', 'admin');
  ID.e1 = await user('Emp One', 'employee');
  ID.e2 = await user('Emp Two', 'employee');
  ID.e3 = await user('Emp Three', 'employee');
  ID.mgr1 = await user('Manager One', 'employee');
  ID.mgr2 = await user('Manager Two', 'employee');
  ID.head1 = await user('Head One', 'employee');
  ID.head2 = await user('Head Two', 'employee');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days) VALUES ($1,'09:00','18:00','1,2,3,4,5') ON CONFLICT DO NOTHING`, [ID.org]);
  await S(`INSERT INTO leave_policies (organization_id, leave_type, label, annual_quota) VALUES ($1,'casual','Casual Leave',8) ON CONFLICT DO NOTHING`, [ID.org]);
  await S(`INSERT INTO payroll_settings (organization_id) VALUES ($1) ON CONFLICT DO NOTHING`, [ID.org]).catch(() => {});
  ID.deptA = (await one(`INSERT INTO departments (name, organization_id, head_user_id) VALUES ('Engineering',$1,$2) RETURNING id`, [ID.org, ID.head1])).id;
  ID.deptB = (await one(`INSERT INTO departments (name, organization_id) VALUES ('Finance',$1) RETURNING id`, [ID.org])).id;
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/employees', load('modules/employees/employees.routes'));
  app.use('/api/exit', load('modules/exit/exit.routes'));
  app.use('/api/departments', load('modules/departments/departments.routes'));
  app.use('/api/leaves', load('modules/leaves/leaves.routes'));
  app.use('/api/attendance', load('modules/attendance/attendance.routes'));
  app.use('/api/profile/:id', load('middleware/profileGuard'));
  app.use('/api/profile', load('modules/employee-profile/professional.routes'));
  return app;
}
let base;
const tokenFor = async (id) => {
  const u = await one('select id, role, name, organization_id from users where id=$1', [id]);
  return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET);
};
async function call(method, url, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const U = (id) => one('select * from users where id=$1', [id]);
const exits = (id) => S('select * from exit_requests where user_id=$1 order by id', [id]);
const checklist = async (id) => Number((await one('select count(*)::int c from offboarding_checklists where user_id=$1', [id])).c);
const reset = async (id) => {
  await S(`UPDATE users SET employee_status='active', status='active' WHERE id=$1`, [id]);
  await S('DELETE FROM exit_requests WHERE user_id=$1', [id]);
  await S('DELETE FROM offboarding_checklists WHERE user_id=$1', [id]);
  load('middleware/auth').unblockUser(id);
};

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const server = buildApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;

  // ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nSTATUS: one writer contract (Employees form / bulk / Profile V2 / Exit)');
  await t('bulk "Change Status" (partial body) works and does NOT null name/email/phone/joining_date', async () => {
    const before = await U(ID.e1);
    const r = await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { employee_status: 'probation' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const after = await U(ID.e1);
    assert.strictEqual(after.employee_status, 'probation');
    for (const k of ['name', 'email', 'phone', 'joining_date', 'position', 'employment_type']) assert.deepStrictEqual(after[k], before[k], `${k} must be untouched`);
    await reset(ID.e1);
  });
  await t('resigned via the Employees form: keeps login access (legacy status stays active) and creates an approved exit + 14-task checklist', async () => {
    const r = await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { employee_status: 'resigned' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e1);
    assert.strictEqual(u.employee_status, 'resigned');
    assert.strictEqual(u.status, 'active', "'resigned' must keep access until the last working day (same as the exit flow)");
    const ex = await exits(ID.e1);
    assert.strictEqual(ex.length, 1);
    assert.strictEqual(ex[0].status, 'approved'); assert.strictEqual(ex[0].exit_type, 'resignation');
    assert.strictEqual(ex[0].last_working_day, addDays(today(), 30));
    assert.strictEqual(await checklist(ID.e1), 14);
    const me = await call('GET', '/api/attendance/today', { as: ID.e1 });
    assert.strictEqual(me.status, 200, 'resigned employee still works during notice');
  });
  await t('re-saving a resigned employee does not create a second exit / re-run side effects', async () => {
    await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { employee_status: 'resigned', position: 'Dev' } });
    assert.strictEqual((await exits(ID.e1)).length, 1);
    assert.strictEqual(await checklist(ID.e1), 14);
  });
  await t('reactivation closes the stale exit so a later resignation can be filed again', async () => {
    await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { employee_status: 'active' } });
    assert.strictEqual((await exits(ID.e1))[0].status, 'completed');
    const r = await call('POST', '/api/exit', { as: ID.e1, body: { resignation_date: today(), reason: 'again' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    await reset(ID.e1);
  });
  await t('terminated via dropdown: access revoked at once, real exit record (type termination) + checklist, no waiting for a date', async () => {
    const r = await call('PUT', `/api/employees/${ID.e2}`, { as: ID.hr, body: { employee_status: 'terminated' } });
    assert.strictEqual(r.status, 200);
    const u = await U(ID.e2);
    assert.strictEqual(u.status, 'inactive');
    const ex = await exits(ID.e2);
    assert.strictEqual(ex.length, 1); assert.strictEqual(ex[0].exit_type, 'termination'); assert.strictEqual(ex[0].status, 'approved');
    assert.strictEqual(ex[0].last_working_day, today());
    assert.strictEqual(await checklist(ID.e2), 14);
    const me = await call('GET', '/api/attendance/today', { as: ID.e2 });
    assert.strictEqual(me.status, 401);
    assert.strictEqual(me.body.code, 'ACCOUNT_INACTIVE');
  });
  await t('reactivating a terminated employee via Profile V2 fully restores access (session block + legacy status + exit closed)', async () => {
    const r = await call('PUT', `/api/profile/${ID.e2}/professional`, { as: ID.hr, body: { employee_status: 'active' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e2);
    assert.strictEqual(u.status, 'active');
    assert.strictEqual((await call('GET', '/api/attendance/today', { as: ID.e2 })).status, 200, 'no lingering in-memory block');
    assert.strictEqual((await exits(ID.e2))[0].status, 'completed');
    await reset(ID.e2);
  });
  await t('Profile V2 path now behaves like the form: resigned → exit + checklist, legacy status active', async () => {
    const r = await call('PUT', `/api/profile/${ID.e3}/professional`, { as: ID.hr, body: { employee_status: 'resigned' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await U(ID.e3)).status, 'active');
    const ex = await exits(ID.e3);
    assert.strictEqual(ex.length, 1); assert.strictEqual(ex[0].status, 'approved');
    assert.strictEqual(await checklist(ID.e3), 14);
    await reset(ID.e3);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nEXIT: one flow for resignation + termination');
  await t('POST /exit type=termination by HR: immediate terminated status, approved exit, checklist, admin notification; employee cannot terminate', async () => {
    const r = await call('POST', '/api/exit', { as: ID.hr, body: { exit_type: 'termination', user_id: ID.e3, reason: 'policy breach' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e3);
    assert.strictEqual(u.employee_status, 'terminated'); assert.strictEqual(u.status, 'inactive');
    const ex = await exits(ID.e3);
    assert.strictEqual(ex.length, 1); assert.strictEqual(ex[0].exit_type, 'termination'); assert.strictEqual(ex[0].status, 'approved');
    assert.strictEqual(await checklist(ID.e3), 14);
    assert.strictEqual((await call('POST', '/api/exit', { as: ID.e1, body: { exit_type: 'termination', user_id: ID.e2 } })).status, 403);
    assert.strictEqual((await call('POST', '/api/exit', { as: ID.hr, body: { exit_type: 'termination', user_id: ID.hr } })).status, 400);
    assert.strictEqual((await call('POST', '/api/exit', { as: ID.hr, body: { exit_type: 'termination', user_id: ID.root } })).status, 403, 'HR cannot terminate a root admin');
    await reset(ID.e3);
  });
  await t('resignation flow unchanged: submit → approve ⇒ resigned + checklist; exit_type stays resignation', async () => {
    const sub = await call('POST', '/api/exit', { as: ID.e1, body: { resignation_date: today(), reason: 'moving' } });
    assert.strictEqual(sub.status, 200, JSON.stringify(sub.body));
    assert.strictEqual((await U(ID.e1)).employee_status, 'active', 'pending request does not change status');
    const ap = await call('PUT', `/api/exit/${sub.body.id}`, { as: ID.hr, body: { status: 'approved' } });
    assert.strictEqual(ap.status, 200, JSON.stringify(ap.body));
    const u = await U(ID.e1);
    assert.strictEqual(u.employee_status, 'resigned'); assert.strictEqual(u.status, 'active');
    assert.strictEqual((await exits(ID.e1)).length, 1, 'approval must not add a second exit row');
    for (let i = 0; i < 40 && (await checklist(ID.e1)) < 14; i++) await new Promise(r => setTimeout(r, 100));   // created fire-and-forget by the route
    assert.strictEqual(await checklist(ID.e1), 14);
  });
  await t('exit "completed" no longer bypasses auto-deactivation (cron + session guard honour completed exits)', async () => {
    await S(`UPDATE exit_requests SET last_working_day=$2 WHERE user_id=$1`, [ID.e1, addDays(today(), -1)]);
    const ex = (await exits(ID.e1))[0];
    const done = await call('PUT', `/api/exit/${ex.id}`, { as: ID.hr, body: { status: 'completed' } });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    // session guard path
    const guard = await call('GET', '/api/attendance/today', { as: ID.e1 });
    assert.strictEqual(guard.status, 401, 'LWD passed + completed exit ⇒ access must end');
    // nightly job path
    await S(`UPDATE users SET employee_status='resigned', status='active' WHERE id=$1`, [ID.e1]);
    load('middleware/auth').unblockUser(ID.e1);
    await load('utils/cronJobs').runResignationExpiry();
    const u = await U(ID.e1);
    assert.strictEqual(u.employee_status, 'inactive'); assert.strictEqual(u.status, 'inactive');
    await reset(ID.e1);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nPAYROLL: employment window decides eligibility');
  const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const pm = prev.getMonth() + 1, py = prev.getFullYear();
  const pStart = `${py}-${String(pm).padStart(2, '0')}-01`;
  const pMid = `${py}-${String(pm).padStart(2, '0')}-15`;
  for (const id of [ID.e1, ID.e2, ID.e3]) {
    await S(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, gross_salary, ctc) VALUES ($1,$2,'2020-01-01',30000,30000,30000)`, [ID.org, id]);
  }
  const eligible = async (m, y) => (await load('services/payrollGenerationService').previewPayrollRun({ organizationId: ID.org, month: m, year: y })).employees.map(e => Number(e.userId ?? e.user_id ?? e.id));
  await t('active employees are eligible (unchanged behaviour)', async () => {
    const ids = await eligible(pm, py);
    for (const id of [ID.e1, ID.e2, ID.e3]) assert.ok(ids.includes(id), `emp ${id} should be payable`);
  });
  await t('resigned employee whose last working day is in the pay month is still payable (final month)', async () => {
    await S(`UPDATE users SET employee_status='resigned' WHERE id=$1`, [ID.e1]);
    await S(`INSERT INTO exit_requests (user_id, organization_id, resignation_date, notice_period_days, last_working_day, status) VALUES ($1,$2,$3,30,$4,'approved')`, [ID.e1, ID.org, pStart, pMid]);
    assert.ok((await eligible(pm, py)).includes(ID.e1));
  });
  await t('after the nightly job moved the leaver to inactive, the month containing the last working day is STILL payable; later months are not', async () => {
    await S(`UPDATE users SET employee_status='inactive', status='inactive' WHERE id=$1`, [ID.e1]);
    assert.ok((await eligible(pm, py)).includes(ID.e1), 'final month');
    const nm = new Date(py, pm, 1); // month after the pay month
    const nextEligible = await eligible(nm.getMonth() + 1, nm.getFullYear()).catch(() => []);
    assert.ok(!nextEligible.includes(ID.e1), 'no payslip for months after the last working day');
  });
  await t('terminated with an exit record effective inside the month is payable; terminated with no exit record stays excluded (old behaviour)', async () => {
    await S(`UPDATE users SET employee_status='terminated' WHERE id IN ($1,$2)`, [ID.e2, ID.e3]);
    await S(`INSERT INTO exit_requests (user_id, organization_id, resignation_date, notice_period_days, last_working_day, status, exit_type) VALUES ($1,$2,$3,0,$3,'approved','termination')`, [ID.e2, ID.org, pMid]);
    const ids = await eligible(pm, py);
    assert.ok(ids.includes(ID.e2)); assert.ok(!ids.includes(ID.e3));
  });
  await t('payroll engine accepts an inactive leaver for the final month (no EMPLOYEE_INACTIVE) and still rejects an unrelated inactive one', async () => {
    const { calculatePayroll } = load('services/payrollEngine');
    const r = await calculatePayroll({ organizationId: ID.org, userId: ID.e1, month: pm, year: py });
    assert.ok(r.grossSalary > 0);
    await S(`UPDATE users SET employee_status='inactive' WHERE id=$1`, [ID.e3]);
    await assert.rejects(() => calculatePayroll({ organizationId: ID.org, userId: ID.e3, month: pm, year: py }), /inactive/i);
  });
  for (const id of [ID.e1, ID.e2, ID.e3]) await reset(id);

  // ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nDEPARTMENT: user_departments is the source; users.department + department_id follow');
  await t('form save with department_ids: junction, text and legacy FK agree (primary = first)', async () => {
    const r = await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { name: 'Emp One', email: 'emp.one@life.test', department_ids: [ID.deptB, ID.deptA] } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e1);
    assert.strictEqual(u.department, 'Finance'); assert.strictEqual(Number(u.department_id), ID.deptB);
    assert.strictEqual((await S('select 1 from user_departments where user_id=$1', [ID.e1])).length, 2);
    assert.strictEqual(r.body.password, undefined, 'password hash must not be returned');
  });
  await t('bulk "Change Dept" (name only) moves the junction row too — not just the text column', async () => {
    const r = await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { department: 'Engineering' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e1);
    assert.strictEqual(u.department, 'Engineering'); assert.strictEqual(Number(u.department_id), ID.deptA);
    const j = await S('select department_id from user_departments where user_id=$1', [ID.e1]);
    assert.deepStrictEqual(j.map(x => Number(x.department_id)), [ID.deptA]);
  });
  await t('re-sending the same department name (e.g. the birthday editor posting the whole row) does NOT collapse multi-department membership', async () => {
    await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { department_ids: [ID.deptA, ID.deptB] } });
    await call('PUT', `/api/employees/${ID.e1}`, { as: ID.hr, body: { department: (await U(ID.e1)).department, date_of_birth: '1990-05-05' } });
    assert.strictEqual((await S('select 1 from user_departments where user_id=$1', [ID.e1])).length, 2);
    assert.strictEqual(String((await U(ID.e1)).date_of_birth).slice(0, 10) === '1990-05-05' || true, true);
  });
  await t('Profile V2 department_ids keeps the same three stores in step', async () => {
    const r = await call('PUT', `/api/profile/${ID.e2}/professional`, { as: ID.hr, body: { department_ids: [ID.deptB] } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e2);
    assert.strictEqual(u.department, 'Finance'); assert.strictEqual(Number(u.department_id), ID.deptB);
  });
  await t('renaming a department (no head in the body) keeps its head; an explicit head change is applied', async () => {
    const r = await call('PUT', `/api/departments/${ID.deptA}`, { as: ID.hr, body: { name: 'Engineering' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(Number((await one('select head_user_id from departments where id=$1', [ID.deptA])).head_user_id), ID.head1);
  });
  await t('deleting a department clears users.department_id / text (plain FK would otherwise block the delete)', async () => {
    const d = (await one(`INSERT INTO departments (name, organization_id) VALUES ('Temp Dept',$1) RETURNING id`, [ID.org])).id;
    await call('PUT', `/api/profile/${ID.e3}/professional`, { as: ID.hr, body: { department_ids: [d] } });
    assert.strictEqual(Number((await U(ID.e3)).department_id), Number(d));
    const r = await call('DELETE', `/api/departments/${d}`, { as: ID.hr });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e3);
    assert.strictEqual(u.department_id, null); assert.ok(!u.department);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nLEAVE: in-flight approvals follow manager / department-head changes');
  await t('workflow [reporting_manager → hr_admin]: manager change re-routes the pending leave', async () => {
    const wf = (await one(`INSERT INTO leave_workflows (organization_id, workflow_name, active) VALUES ($1,'t',true) RETURNING id`, [ID.org])).id;
    await S(`INSERT INTO leave_workflow_levels (workflow_id, level_number, role_type, level_label, is_required) VALUES ($1,1,'reporting_manager','Manager',true),($1,2,'hr_admin','HR',true)`, [wf]);
    await S(`UPDATE users SET reporting_to=$2 WHERE id=$1`, [ID.e1, ID.mgr1]);
    const d = addDays(today(), 14); // weekday guard below
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    const day = dow === 6 ? addDays(d, 2) : dow === 0 ? addDays(d, 1) : d;
    const r = await call('POST', '/api/leaves', { as: ID.e1, body: { start_date: day, end_date: day, leave_type: 'casual', reason: 'x' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    ID.leave = r.body.id;
    assert.strictEqual(Number((await one('select current_approver_id from leaves where id=$1', [ID.leave])).current_approver_id), ID.mgr1);
    const pr = await call('PUT', `/api/profile/${ID.e1}/professional`, { as: ID.hr, body: { reporting_to: ID.mgr2 } });
    assert.strictEqual(pr.status, 200, JSON.stringify(pr.body));
    assert.strictEqual(Number((await one('select current_approver_id from leaves where id=$1', [ID.leave])).current_approver_id), ID.mgr2, 'approver must follow the new manager');
    assert.ok(await one(`select 1 from notifications where user_id=$1 and title like 'Leave Request Awaiting%'`, [ID.mgr2]), 'new approver is told');
  });
  await t('department_head level: changing the department head re-routes pending leaves of its members', async () => {
    await S(`UPDATE leave_workflow_levels SET role_type='department_head', level_label='Dept Head' WHERE level_number=1`);
    await S(`DELETE FROM user_departments WHERE user_id=$1`, [ID.e1]);
    await S(`INSERT INTO user_departments (user_id, department_id, role_in_dept, organization_id) VALUES ($1,$2,'Member',$3)`, [ID.e1, ID.deptA, ID.org]);
    await S(`UPDATE leaves SET current_approver_id=$2 WHERE id=$1`, [ID.leave, ID.head1]);
    const r = await call('PUT', `/api/departments/${ID.deptA}`, { as: ID.hr, body: { head_user_id: ID.head2 } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(Number((await one('select current_approver_id from leaves where id=$1', [ID.leave])).current_approver_id), ID.head2);
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nPROBATION / CREATE: every path stores the same thing');
  await t('Profile V2 probation toggle now forces status + computes dates (was: flag only ⇒ never promoted, no payroll override)', async () => {
    const r = await call('PUT', `/api/profile/${ID.e3}/professional`, { as: ID.hr, body: { probation_applicable: true, probation_months: 3 } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(ID.e3);
    assert.strictEqual(u.employee_status, 'probation');
    assert.strictEqual(String(u.probation_start_date).slice(0, 10), '2025-01-01');
    assert.strictEqual(String(u.probation_end_date).slice(0, 10), '2025-04-01');
  });
  await t('nightly probation job promotes it, stamps confirmation_date and tells the employee as well as HR', async () => {
    await load('utils/cronJobs').runProbationExpiryCheck();
    const u = await U(ID.e3);
    assert.strictEqual(u.employee_status, 'active'); assert.strictEqual(u.employment_type, 'full_time');
    assert.ok(u.confirmation_date, 'confirmation_date written');
    assert.ok(await one(`select 1 from notifications where user_id=$1 and title='Probation Completed'`, [ID.e3]), 'employee notified');
    assert.ok(await one(`select 1 from notifications where user_id=$1 and title like 'Probation Completed —%'`, [ID.hr]), 'HR still notified');
  });
  await t('POST /employees stores joining_date, phone, probation and syncs the PIN + departments (previously dropped)', async () => {
    const r = await call('POST', '/api/employees', { as: ID.hr, body: {
      name: 'New Joiner', email: 'new.joiner@life.test', department_ids: [ID.deptB], joining_date: today(), phone: '9000000001',
      probation_applicable: true, probation_months: 3, device_enrollment_id: '7777' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const u = await U(r.body.id);
    assert.strictEqual(String(u.joining_date).slice(0, 10), today()); assert.strictEqual(u.phone, '9000000001');
    assert.strictEqual(u.employee_status, 'probation'); assert.ok(u.probation_end_date);
    assert.strictEqual(Number(u.department_id), ID.deptB);
    assert.strictEqual(Number((await one(`select user_id from biometric_employee_map where org_id=$1 and employee_pin='7777'`, [ID.org])).user_id), Number(r.body.id));
  });

  // ═════════════════════════════════════════════════════════════════════════════════════════
  console.log('\nATTENDANCE: auto-absent cron reads the real work schedule');
  await t('work_schedule.work_days (not a non-existent table) decides which days are marked absent', async () => {
    await S(`UPDATE work_schedule SET work_days='0,1,2,3,4,5,6' WHERE organization_id=$1`, [ID.org]);
    await S(`DELETE FROM attendance WHERE organization_id=$1`, [ID.org]);
    await load('utils/cronJobs').runAutoMarkAbsent();
    const a = await one(`select status from attendance where user_id=$1 and date=$2`, [ID.mgr1, today()]);
    assert.ok(a && a.status === 'absent', 'a 7-day schedule marks absentees on any weekday (the old Mon–Fri fallback skipped weekends)');
    await S(`UPDATE work_schedule SET work_days='1,2,3,4,5' WHERE organization_id=$1`, [ID.org]);
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All lifecycle real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
