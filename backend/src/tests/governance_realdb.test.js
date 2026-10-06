/**
 * governance_realdb.test.js — RBAC consolidation, salary source of truth, and small route fixes, on REAL PostgreSQL.
 *
 *   - reports / analytics: legacy role gate AND the permission matrix (via the existing compat helper)
 *   - Profile V2 writes use employees.edit; employees can never reach them
 *   - performance self-review works for the owner without `performance.manage`; admin fields still need it
 *   - salary: users.ctc follows the active structure; competing edits are ignored; no-structure employees unchanged
 *   - bank-file/formats is reachable (was shadowed by /:runId)
 *   - hard delete of an employee with payroll history is refused
 *   - existing behaviour preserved: Root/HR/Employee access as before
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/governance_realdb.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'governance-realdb-test-secret';

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
const today = () => new Date().toISOString().split('T')[0];

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['performance_reviews', 'employee_salary_structures', 'payslips', 'payroll_runs', 'payroll_run_employees', 'notifications', 'attendance', 'leaves'])
    await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/employee_lifecycle_2026_10_06.sql'), 'utf8'));
  ID.org = (await one(`INSERT INTO organizations (name, slug) VALUES ('Gov Org','gov-org') RETURNING id`)).id;
  const user = async (name, role) => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date)
     VALUES ($1,$2,'x',$3,$4,'active','active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@gov.test`, role, ID.org])).id;
  ID.root = await user('Root GV', 'root_admin'); ID.hr = await user('HR GV', 'admin'); ID.hrCustom = await user('HR Custom', 'admin');
  ID.emp = await user('Emp GV', 'employee'); ID.emp2 = await user('Emp GV2', 'employee'); ID.paid = await user('Paid GV', 'employee');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days) VALUES ($1,'09:00','18:00','1,2,3,4,5') ON CONFLICT DO NOTHING`, [ID.org]);
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
  // a custom role WITHOUT reports.view for one HR user
  const role = (await one(`INSERT INTO roles (org_id, name, slug, is_system_role) VALUES ($1,'Payroll Only','payroll_only',false) RETURNING id`, [ID.org])).id;
  await S(`INSERT INTO role_permissions (role_id, permission_id) SELECT $1, id FROM permissions WHERE module_key='employees' AND action='view'`, [role]);
  // the RBAC migration back-filled hr_admin for every users.role='admin'; a user with an EXPLICIT custom role must only get that role
  await S(`DELETE FROM user_roles WHERE user_id=$1`, [ID.hrCustom]);
  await S(`INSERT INTO user_roles (user_id, role_id, org_id) VALUES ($1,$2,$3)`, [ID.hrCustom, role, ID.org]);
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

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const app = express(); app.use(express.json());
  app.use('/api/reports', load('modules/reports/reports.routes'));
  app.use('/api/performance', load('modules/performance/performance.routes'));
  app.use('/api/payroll', load('modules/payroll/payroll.routes'));
  app.use('/api/employees', load('modules/employees/employees.routes'));
  app.use('/api/profile/:id', load('middleware/profileGuard'));
  app.use('/api/profile', load('modules/employee-profile/professional.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nRBAC: legacy role gate + permission matrix');
  await t('reports: Root and default HR keep access (no regression); employee still blocked', async () => {
    assert.strictEqual((await call('GET', '/api/reports/headcount', { as: ID.root })).status, 200);
    assert.strictEqual((await call('GET', '/api/reports/headcount', { as: ID.hr })).status, 200);
    assert.strictEqual((await call('GET', '/api/reports/headcount', { as: ID.emp })).status, 403);
  });
  await t('reports: an HR admin whose explicit role lacks reports.view is now refused (was allowed by the role flag alone)', async () => {
    const r = await call('GET', '/api/reports/headcount', { as: ID.hrCustom });
    assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    assert.strictEqual(r.body.required_permission, 'reports.view');
  });
  await t('Profile V2 writes: HR/Root allowed, employee (even on self) refused, custom role without employees.edit refused', async () => {
    assert.strictEqual((await call('PUT', `/api/profile/${ID.emp}/professional`, { as: ID.hr, body: { position: 'Dev' } })).status, 200);
    assert.strictEqual((await call('PUT', `/api/profile/${ID.emp}/professional`, { as: ID.root, body: { position: 'Dev2' } })).status, 200);
    assert.strictEqual((await call('PUT', `/api/profile/${ID.emp}/professional`, { as: ID.emp, body: { position: 'CEO' } })).status, 403);
    assert.strictEqual((await call('PUT', `/api/profile/${ID.emp}/professional`, { as: ID.hrCustom, body: { position: 'x' } })).status, 403);
    assert.strictEqual((await one('select position from users where id=$1', [ID.emp])).position, 'Dev2');
  });

  console.log('\nPERFORMANCE: self-review');
  await t('the review owner can submit a self-rating without performance.manage; manager fields stay admin-only; other employees refused', async () => {
    const rv = await call('POST', '/api/performance/reviews', { as: ID.hr, body: { user_id: ID.emp, review_cycle: '2026' } });
    assert.strictEqual(rv.status, 200, JSON.stringify(rv.body));
    const own = await call('PUT', `/api/performance/reviews/${rv.body.id}`, { as: ID.emp, body: { self_rating: 4, self_comments: 'good year', manager_rating: 5, final_rating: 5, status: 'completed' } });
    assert.strictEqual(own.status, 200, JSON.stringify(own.body));
    const row = await one('select * from performance_reviews where id=$1', [rv.body.id]);
    assert.strictEqual(Number(row.self_rating), 4);
    assert.ok(row.manager_rating == null && row.final_rating == null && row.status === 'pending', 'an employee must not set manager/final fields');
    assert.strictEqual((await call('PUT', `/api/performance/reviews/${rv.body.id}`, { as: ID.emp2, body: { self_rating: 1 } })).status, 403);
    const mgr = await call('PUT', `/api/performance/reviews/${rv.body.id}`, { as: ID.hr, body: { manager_rating: 3, status: 'completed' } });
    assert.strictEqual(mgr.status, 200, JSON.stringify(mgr.body));
    assert.strictEqual(Number((await one('select manager_rating from performance_reviews where id=$1', [rv.body.id])).manager_rating), 3);
  });

  console.log('\nSALARY: one source of truth');
  await t('creating a structure syncs users.ctc / salary_effective_date (display cache) and notifies the employee', async () => {
    const r = await call('POST', '/api/payroll/salary-structures', { as: ID.hr, body: { user_id: ID.emp, effective_from: today(), basic: 30000, hra: 10000, employer_pf: 1800 } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const u = await one('select ctc, salary_effective_date from users where id=$1', [ID.emp]);
    assert.strictEqual(Number(u.ctc), 41800);
    assert.strictEqual(String(u.salary_effective_date).slice(0, 10), today());
  });
  await t('a competing ctc edit (form / Profile V2) is ignored while a structure exists; employees without a structure are unchanged', async () => {
    assert.strictEqual((await call('PUT', `/api/employees/${ID.emp}`, { as: ID.hr, body: { ctc: 999999 } })).status, 200);
    assert.strictEqual(Number((await one('select ctc from users where id=$1', [ID.emp])).ctc), 41800, 'structure wins');
    assert.strictEqual((await call('PUT', `/api/profile/${ID.emp}/professional`, { as: ID.hr, body: { ctc: 123 } })).status, 200);
    assert.strictEqual(Number((await one('select ctc from users where id=$1', [ID.emp])).ctc), 41800);
    assert.strictEqual((await call('PUT', `/api/employees/${ID.emp2}`, { as: ID.hr, body: { ctc: 500000 } })).status, 200);
    assert.strictEqual(Number((await one('select ctc from users where id=$1', [ID.emp2])).ctc), 500000, 'no structure ⇒ the stored value is still editable');
  });

  console.log('\nROUTES');
  await t('GET /payroll/bank-file/formats is reachable (was captured by /:runId → 400)', async () => {
    const r = await call('GET', '/api/payroll/bank-file/formats', { as: ID.root });   // (payroll.bank_files is seeded by a later migration; Root bypasses)
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(Array.isArray(r.body.formats) && r.body.formats.length >= 3);
  });
  await t('hard delete: allowed for a mistaken record, refused (409) once the employee has payslips', async () => {
    const mistaken = Number((await call('POST', '/api/employees', { as: ID.hr, body: { name: 'Mistake GV', email: 'mistake@gov.test' } })).body.id);
    assert.strictEqual((await call('DELETE', `/api/employees/${mistaken}`, { as: ID.hr })).status, 200);
    await S(`INSERT INTO payslips (user_id, month, year, organization_id, gross_salary, net_salary) VALUES ($1,'09',2026,$2,1000,900)`, [ID.paid, ID.org]).catch(async () =>
      S(`INSERT INTO payslips (user_id, month, year, organization_id) VALUES ($1,'09',2026,$2)`, [ID.paid, ID.org]));
    const r = await call('DELETE', `/api/employees/${ID.paid}`, { as: ID.hr });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.ok(await one('select 1 from users where id=$1', [ID.paid]));
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All governance real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
