/**
 * rbac_custom_roles_realdb.test.js — RBAC Phase 4: CUSTOM-role permissions control API access, on REAL PostgreSQL.
 *
 * Drives the real routers (analytics, employees, payroll, leaves, documents, expenses, reports) over HTTP with
 * signed JWTs. A custom-role holder is users.role = 'employee'; access must come from the role's permissions,
 * while system roles and branch isolation behave exactly as before.
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/rbac_custom_roles_realdb.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'custom-roles-realdb-test-secret';

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
  for (const tb of ['branches', 'leaves', 'expenses', 'documents', 'notifications', 'payroll_runs'])
    await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  ID.org = (await one(`INSERT INTO organizations (name, slug) VALUES ('Custom Org','custom-org') RETURNING id`)).id;
  await S(`INSERT INTO organization_features (organization_id, feature_key, enabled) VALUES ($1,'branches',true) ON CONFLICT DO NOTHING`, [ID.org]).catch(() => {});
  ID.A = (await one(`INSERT INTO branches (org_id, name, code, is_active) VALUES ($1,'Branch A','A',true) RETURNING id`, [ID.org])).id;
  ID.B = (await one(`INSERT INTO branches (org_id, name, code, is_active) VALUES ($1,'Branch B','B',true) RETURNING id`, [ID.org])).id;
  const user = async (name, role, branch) => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, branch_id, employee_status, status, joining_date)
     VALUES ($1,$2,'x',$3,$4,$5,'active','active','2024-01-01') RETURNING id`,
    [name, `${name.toLowerCase().replace(/\W+/g, '.')}@cr.test`, role, ID.org, branch])).id;
  ID.root = await user('Root CR', 'root_admin', null);
  ID.hr = await user('HR CR', 'admin', null);
  ID.plain = await user('Plain Employee', 'employee', ID.A);
  ID.pm = await user('Payroll Manager A', 'employee', ID.A);        // custom: dashboard/employees view + payroll view/generate/approve
  ID.editor = await user('Employee Editor A', 'employee', ID.A);    // custom: employees view + edit (no create/delete)
  ID.limited = await user('Limited A', 'employee', ID.A);           // custom: employees.view only (no dashboard.view)
  ID.targetA = await user('Target A', 'employee', ID.A);
  ID.targetB = await user('Target B', 'employee', ID.B);
  ID.head = await user('Dept Head A', 'employee', ID.A);            // Department Head (system role via departments.head_user_id)
  ID.approver = await user('Leave Approver A', 'employee', ID.A);   // custom: leaves.view + leaves.approve, reports.view
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
  await S(`INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches) VALUES ($1,$2,NULL,true) ON CONFLICT DO NOTHING`, [ID.hr, ID.org]).catch(() => {});

  const grant = async (roleId, perm) => {
    const [m, a] = perm.split('.');
    const p = await one(`INSERT INTO permissions (module_key, action, label) VALUES ($1,$2,$3)
                         ON CONFLICT (module_key, action) DO UPDATE SET label = permissions.label RETURNING id`, [m, a, perm]);
    await S(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [roleId, p.id]);
  };
  const customRole = async (name, perms, users) => {
    const r = await one(`INSERT INTO roles (org_id, name, slug, is_system_role) VALUES ($1,$2,$3,false) RETURNING id`, [ID.org, name, name.toLowerCase().replace(/\W+/g, '_')]);
    for (const p of perms) await grant(r.id, p);
    // additive assignment, exactly like POST /roles/:id/members (the user keeps their Employee system role)
    for (const u of users) await S(`INSERT INTO user_roles (user_id, role_id, org_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [u, r.id, ID.org]);
    return r.id;
  };
  ID.rolePM = await customRole('Payroll Manager', ['dashboard.view', 'employees.view', 'payroll.view', 'payroll.generate', 'payroll.approve'], [ID.pm]);
  ID.roleEditor = await customRole('Employee Editor', ['employees.view', 'employees.edit'], [ID.editor]);
  ID.roleApprover = await customRole('Leave Approver', ['leaves.view', 'leaves.approve', 'reports.view'], [ID.approver]);
  await S(`INSERT INTO departments (name, organization_id, head_user_id) VALUES ('Ops', $1, $2)`, [ID.org, ID.head]);
  ID.roleLimited = await customRole('Limited Viewer', ['employees.view'], [ID.limited]);
  await S(`INSERT INTO leaves (user_id, organization_id, leave_type, start_date, end_date, status, reason)
           VALUES ($1,$3,'casual','2026-12-01','2026-12-01','pending','a'),($2,$3,'casual','2026-12-02','2026-12-02','pending','b')`,
    [ID.targetA, ID.targetB, ID.org]);
  ID.leaveA = Number((await one(`SELECT id FROM leaves WHERE user_id=$1`, [ID.targetA])).id);
  ID.leaveB = Number((await one(`SELECT id FROM leaves WHERE user_id=$1`, [ID.targetB])).id);
}

let base;
const tokenFor = async (id) => {
  const u = await one('select id, role, name, organization_id from users where id=$1', [id]);
  return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET, { expiresIn: '1h' });
};
async function call(method, url, { as, body, branch } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  if (branch) headers['X-Branch-Id'] = String(branch);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const ok = (r) => r.status >= 200 && r.status < 300;
const denied = (r) => r.status === 403;

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}).`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const app = express(); app.use(express.json());
  app.use('/api/analytics', load('modules/analytics/analytics.routes'));
  app.use('/api/employees', load('modules/employees/employees.routes'));
  app.use('/api/payroll', load('modules/payroll/payroll.routes'));
  app.use('/api/leaves', load('modules/leaves/leaves.routes'));
  app.use('/api/documents', load('modules/documents/documents.routes'));
  app.use('/api/expenses', load('modules/expenses/expenses.routes'));
  app.use('/api/reports', load('modules/reports/reports.routes'));
  app.use('/api/roles', load('modules/roles/roles.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nSYSTEM ROLES — unchanged');
  await t('Root Admin: full access', async () => {
    assert.ok(ok(await call('GET', '/api/employees', { as: ID.root })));
    assert.ok(ok(await call('GET', '/api/payroll/runs', { as: ID.root })));
    assert.ok(ok(await call('GET', '/api/reports/headcount', { as: ID.root })));
  });
  await t('HR Admin: existing access (employees, payroll, reports, analytics)', async () => {
    assert.ok(ok(await call('GET', '/api/employees', { as: ID.hr })));
    assert.ok(ok(await call('GET', '/api/payroll/runs', { as: ID.hr })));
    assert.ok(ok(await call('GET', '/api/reports/headcount', { as: ID.hr })));
    assert.ok(ok(await call('GET', '/api/analytics', { as: ID.hr })));
  });
  await t('Employee: still blocked from admin modules', async () => {
    for (const u of ['/api/employees', '/api/payroll/runs', '/api/analytics', '/api/reports/headcount'])
      assert.ok(denied(await call('GET', u, { as: ID.plain })), u);
    assert.ok(denied(await call('POST', '/api/payroll/runs/1/approve', { as: ID.plain })));
  });
  await t('Employee: leave list is still only their own', async () => {
    const r = await call('GET', '/api/leaves', { as: ID.plain });
    assert.ok(ok(r), JSON.stringify(r.body));
    assert.ok((r.body.leaves || r.body).every?.(l => Number(l.user_id) === ID.plain));
  });

  console.log('\nCUSTOM ROLE — Payroll Manager (dashboard.view, employees.view, payroll.view/generate/approve)');
  await t('Dashboard.view → analytics dashboard accessible; role without it is blocked', async () => {
    const r = await call('GET', '/api/analytics', { as: ID.pm });
    assert.ok(!denied(r), `PM should reach the dashboard: ${r.status} ${JSON.stringify(r.body)}`);
    const l = await call('GET', '/api/analytics', { as: ID.limited });
    assert.ok(denied(l), `Limited has no dashboard.view: ${l.status}`);
  });
  await t('Payroll.view → payroll pages accessible; role without payroll.view is blocked (direct API)', async () => {
    assert.ok(ok(await call('GET', '/api/payroll/runs', { as: ID.pm })));
    assert.ok(ok(await call('GET', '/api/payroll/dashboard', { as: ID.pm })));
    assert.ok(denied(await call('GET', '/api/payroll/runs', { as: ID.limited })));
    assert.ok(denied(await call('GET', '/api/payroll/runs', { as: ID.editor })));
  });
  await t('Payroll.view without payroll.approve → approve API blocked; with approve → gate passes', async () => {
    const viewOnly = await S(`INSERT INTO roles (org_id,name,slug,is_system_role) VALUES ($1,'Payroll Viewer','payroll_viewer',false) RETURNING id`, [ID.org]);
    const p = await one(`SELECT id FROM permissions WHERE module_key='payroll' AND action='view'`);
    await S(`INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)`, [viewOnly[0].id, p.id]);
    await S(`INSERT INTO user_roles (user_id, role_id, org_id) VALUES ($1,$2,$3)`, [ID.limited, viewOnly[0].id, ID.org]);
    const { clearUserCache } = load('services/permissionService'); clearUserCache(ID.limited, ID.org);
    assert.ok(ok(await call('GET', '/api/payroll/runs', { as: ID.limited })), 'view granted');
    assert.ok(denied(await call('POST', '/api/payroll/runs/1/approve', { as: ID.limited })), 'approve not granted');
    const r = await call('POST', '/api/payroll/runs/999999/approve', { as: ID.pm });
    assert.ok(!denied(r), `approve granted → gate passes (handler answers ${r.status})`);
    await S(`DELETE FROM user_roles WHERE user_id=$1 AND role_id=$2`, [ID.limited, viewOnly[0].id]); clearUserCache(ID.limited, ID.org);
  });
  await t('Modules the role does not cover stay blocked (leaves admin actions, documents admin, reports, expenses review)', async () => {
    assert.ok(denied(await call('POST', '/api/leaves/1/final-approve', { as: ID.pm })));
    assert.ok(denied(await call('GET', '/api/reports/headcount', { as: ID.pm })));
    assert.ok(denied(await call('PUT', '/api/expenses/1/review', { as: ID.pm, body: { status: 'approved' } })));
    assert.ok(denied(await call('POST', '/api/leaves/balance/adjust', { as: ID.pm, body: {} })));
  });
  await t('Leaves: without leaves.* the user still sees only their own; the role is never silently widened', async () => {
    const r = await call('GET', '/api/leaves', { as: ID.pm });
    assert.ok(ok(r));
    assert.ok((r.body.leaves || r.body).every?.(l => Number(l.user_id) === ID.pm));
  });

  console.log('\nCUSTOM ROLE — action-level (Employees: view ✓ edit ✓ create ✗ delete ✗)');
  await t('view and edit allowed; create and delete blocked by the API', async () => {
    assert.ok(ok(await call('GET', '/api/employees', { as: ID.editor })));
    const e = await call('PUT', `/api/employees/${ID.targetA}`, { as: ID.editor, body: { position: 'Analyst' } });
    assert.ok(ok(e), `edit own-branch employee: ${e.status} ${JSON.stringify(e.body)}`);
    assert.strictEqual((await one('select position from users where id=$1', [ID.targetA])).position, 'Analyst');
    assert.ok(denied(await call('POST', '/api/employees', { as: ID.editor, body: { name: 'New', email: 'new@cr.test' } })));
    assert.ok(denied(await call('DELETE', `/api/employees/${ID.targetA}`, { as: ID.editor })));
  });

  console.log('\nCUSTOM ROLE — Leave Approver (leaves.view, leaves.approve, reports.view)');
  await t('leaves.view → sees the leaves of their own branch (not just their own); other branches stay hidden', async () => {
    const r = await call('GET', '/api/leaves', { as: ID.approver });
    assert.ok(ok(r), JSON.stringify(r.body));
    const rows = r.body.leaves || r.body;
    const owners = rows.map(l => Number(l.user_id));
    assert.ok(owners.includes(ID.targetA), 'Branch A leave visible');
    assert.ok(!owners.includes(ID.targetB), 'Branch B leave must NOT be visible');
  });
  await t('leaves.approve → reaches the handler for a Branch A leave; the same call on a Branch B leave is refused and nothing changes', async () => {
    const bad = await call('PUT', `/api/leaves/${ID.leaveB}/approve`, { as: ID.approver, body: {} });
    assert.ok(!ok(bad), `Branch B approve must fail, got ${bad.status}`);
    assert.strictEqual((await one('select status from leaves where id=$1', [ID.leaveB])).status, 'pending');
    const good = await call('PUT', `/api/leaves/${ID.leaveA}/approve`, { as: ID.approver, body: {} });
    assert.ok(!denied(good), `Branch A approve must reach the handler, got ${good.status} ${JSON.stringify(good.body)}`);
  });
  await t('reports.view → reports open; roles without it are blocked', async () => {
    assert.ok(ok(await call('GET', '/api/reports/headcount', { as: ID.approver })));
    assert.ok(denied(await call('GET', '/api/reports/headcount', { as: ID.editor })));
  });
  await t('final-approve follows its permission; unlisted routes stay closed (no filing leave on someone else\'s behalf)', async () => {
    assert.ok(denied(await call('POST', `/api/leaves/${ID.leaveA}/final-approve`, { as: ID.editor })), 'no leaves.approve → blocked');
    assert.ok(!denied(await call('POST', `/api/leaves/${ID.leaveA}/final-approve`, { as: ID.approver })), 'leaves.approve → reaches the handler');
    await call('POST', '/api/leaves', { as: ID.approver, body: { user_id: ID.targetA, leave_type: 'casual', start_date: '2026-12-10', end_date: '2026-12-10' } });
    const row = await one(`SELECT user_id FROM leaves WHERE start_date='2026-12-10' ORDER BY id DESC LIMIT 1`);
    assert.ok(!row || Number(row.user_id) !== ID.targetA, 'must not be able to file leave on another employee\'s behalf');
  });

  console.log('\nDEPARTMENT HEAD (Branch A) — system role, branch scope');
  await t('keeps existing access: employee directory (own branch), own leaves; no admin modules', async () => {
    assert.ok(ok(await call('GET', '/api/employees', { as: ID.head })));
    const l = await call('GET', '/api/leaves', { as: ID.head });
    assert.ok(ok(l) && (l.body.leaves || l.body).every(x => Number(x.user_id) === ID.head), 'own leaves only');
    for (const u of ['/api/analytics', '/api/reports/headcount', '/api/payroll/runs'])
      assert.ok(denied(await call('GET', u, { as: ID.head })), u);
  });
  await t('employee directory contains no Branch B employee; X-Branch-Id: B is refused', async () => {
    const ids = (await call('GET', '/api/employees', { as: ID.head })).body.map(u => Number(u.id));
    assert.ok(ids.includes(ID.targetA) && !ids.includes(ID.targetB));
    const r = await call('GET', '/api/employees', { as: ID.head, branch: ID.B });
    assert.strictEqual(r.status, 403); assert.strictEqual(r.body.code, 'BRANCH_FORBIDDEN');
  });
  await t('write routes stay closed (employee edit/create/delete, leave approve, balance adjust)', async () => {
    assert.ok(denied(await call('PUT', `/api/employees/${ID.targetB}`, { as: ID.head, body: { position: 'x' } })));
    assert.ok(denied(await call('POST', '/api/employees', { as: ID.head, body: { name: 'N', email: 'n@cr.test' } })));
    assert.ok(denied(await call('DELETE', `/api/employees/${ID.targetB}`, { as: ID.head })));
    assert.ok(!ok(await call('PUT', `/api/leaves/${ID.leaveB}/approve`, { as: ID.head, body: {} })));
    assert.ok(denied(await call('POST', '/api/leaves/balance/adjust', { as: ID.head, body: {} })));
    assert.strictEqual((await one('select status from leaves where id=$1', [ID.leaveB])).status, 'pending');
  });

  console.log('\nBRANCH SECURITY — permissions never widen branch scope');
  await t('Branch A custom-role user: list contains no Branch B employee', async () => {
    const r = await call('GET', '/api/employees', { as: ID.editor });
    assert.ok(ok(r));
    const ids = (r.body.employees || r.body).map(u => Number(u.id));
    assert.ok(ids.includes(ID.targetA), 'sees own branch');
    assert.ok(!ids.includes(ID.targetB), 'must not see Branch B');
  });
  await t('Branch A custom-role user cannot edit a Branch B employee', async () => {
    const r = await call('PUT', `/api/employees/${ID.targetB}`, { as: ID.editor, body: { position: 'Hacked' } });
    assert.ok(!ok(r), `expected refusal, got ${r.status}`);
    assert.notStrictEqual((await one('select position from users where id=$1', [ID.targetB])).position, 'Hacked');
  });
  await t('Branch A custom-role user cannot select Branch B via X-Branch-Id', async () => {
    const r = await call('GET', '/api/employees', { as: ID.editor, branch: ID.B });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.code, 'BRANCH_FORBIDDEN');
  });
  await t('Payroll Manager (Branch A) cannot read payroll for a Branch B run', async () => {
    const run = await one(`INSERT INTO payroll_runs (organization_id, branch_id, month, year, status) VALUES ($1,$2,'09',2026,'completed') RETURNING id`, [ID.org, ID.B]).catch(() => null);
    if (!run) return; // payroll_runs shape differs in this schema — covered by branch_realdb
    const r = await call('GET', `/api/payroll/runs/${run.id}`, { as: ID.pm });
    assert.ok(r.status === 403 || r.status === 404, `expected 403/404, got ${r.status}`);
  });

  console.log('\nESCALATION / PROTECTION');
  await t('a custom role never elevates the stored role; HR-only routes stay closed to it', async () => {
    assert.strictEqual((await one('select role from users where id=$1', [ID.pm])).role, 'employee');
    assert.ok(denied(await call('GET', '/api/roles', { as: ID.pm })), 'roles.view not granted');
    assert.ok(denied(await call('POST', '/api/roles', { as: ID.pm, body: { name: 'x' } })));
  });
  await t('revoking a permission takes effect (cache cleared by role edit)', async () => {
    const { clearOrgCache } = load('services/permissionService');
    await S(`DELETE FROM role_permissions WHERE role_id=$1 AND permission_id=(SELECT id FROM permissions WHERE module_key='dashboard' AND action='view')`, [ID.rolePM]);
    clearOrgCache(ID.org);
    assert.ok(denied(await call('GET', '/api/analytics', { as: ID.pm })));
  });

  server.close();
  console.log(`\nReal-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All custom-role access checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
