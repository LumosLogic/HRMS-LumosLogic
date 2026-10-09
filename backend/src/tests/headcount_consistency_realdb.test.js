/**
 * headcount_consistency_realdb.test.js — "Total Employees" is ONE number on every screen (Tisha Bug_030 / 046-050), REAL PostgreSQL.
 *
 * Definition (owner decision 2026-10-09): active employees only — role 'employee', employee_status NOT in
 * (inactive, resigned, terminated), NULL status counts as active — HR admins and the root admin are not employees.
 * Proves that the HR dashboard, the Root dashboard, the Organization Overview (analytics) and the Departments list agree,
 * and that the Org Overview percentages are shares of that same total.
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/headcount_consistency_realdb.test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('./helpers/realdb_env');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'headcount-test-secret';
process.env.PAYROLL_SCHEDULER_ENABLED = 'false';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 8).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const num = (v) => Number(v);
const ID = {};
let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function call(url, as) {
  const r = await fetch(base + url, { headers: { Authorization: 'Bearer ' + await tokenFor(as) } });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}).`); process.exit(0); }
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);

  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['attendance', 'leaves', 'attendance_regularization', 'expenses', 'departments', 'user_departments']) await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  ID.org = num((await one(`INSERT INTO organizations (name, slug) VALUES ('HC Org','hc-org') RETURNING id`)).id);
  const user = async (name, role, status, dept) => num((await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date, department)
     VALUES ($1,$2,'x',$3,$4,$5,'active','2024-01-01',$6) RETURNING id`,
    [name, `${name.toLowerCase().replace(/\W+/g, '.')}@hc.test`, role, ID.org, status, dept])).id);
  ID.root = await user('Root HC', 'root_admin', 'active', null);
  ID.hr = await user('HR HC', 'admin', 'active', 'People');
  // 6 active employees (one with NULL status = active), 3 who must NOT be counted
  await user('A1', 'employee', 'active', 'Engineering'); await user('A2', 'employee', 'active', 'Engineering'); await user('A3', 'employee', 'active', 'Engineering');
  await user('A4', 'employee', 'probation', 'QA'); await user('A5', 'employee', 'active', 'QA'); ID.nullStatus = await user('A6', 'employee', 'active', 'Sales');
  await S(`UPDATE users SET employee_status = NULL WHERE id = $1`, [ID.nullStatus]);
  await user('G1', 'employee', 'resigned', 'Sales'); await user('G2', 'employee', 'terminated', 'QA'); await user('G3', 'employee', 'inactive', 'Engineering');
  await S(`INSERT INTO departments (name, organization_id) VALUES ('Engineering',$1),('QA',$1),('Sales',$1)`, [ID.org]);

  const app = express(); app.use(express.json());
  app.use('/api/dashboard', load('modules/dashboard/dashboard.routes'));
  app.use('/api/analytics', load('modules/analytics/analytics.routes'));
  app.use('/api/root', load('modules/root/root.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const EXPECTED = 6;

  console.log('\nTOTAL EMPLOYEES — one definition, every screen');
  await t('HR dashboard KPI = active employees (inactive / resigned / terminated and HR admins excluded)', async () => {
    const r = await call('/api/dashboard', ID.hr);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.totalEmployees, EXPECTED);
  });
  await t('Root dashboard KPI = the same number (it used to count every status)', async () => {
    const r = await call('/api/root/dashboard', ID.root);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.totalEmployees, EXPECTED);
    assert.strictEqual(r.body.totalActiveEmployees, EXPECTED);
  });
  await t('Organization Overview total = the same number; NULL status counts as active; percentages are shares of it', async () => {
    const r = await call('/api/analytics', ID.root);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.totalEmpCount, EXPECTED);
    const by = Object.fromEntries(r.body.deptDistribution.map(d => [d.name, d]));
    assert.strictEqual(by.Engineering.count, 3); assert.strictEqual(by.QA.count, 2); assert.strictEqual(by.Sales.count, 1, 'the NULL-status employee is counted');
    for (const d of r.body.deptDistribution) assert.strictEqual(d.pct, Math.round(d.count / EXPECTED * 100), `${d.name} % is of the total`);
    assert.strictEqual(r.body.deptDistribution.reduce((s, d) => s + d.count, 0), EXPECTED, 'the departments add up to the total');
  });
  await t('the HR admin sees the same Organization Overview total (branch scope is org-wide here)', async () => {
    const r = await call('/api/analytics', ID.hr);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.totalEmpCount, EXPECTED);
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All headcount real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
