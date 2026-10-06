/**
 * branch_http.test.js — request-level self-test matrix for branch-wise separation.
 *
 * Drives the REAL Express routers (holidays, shifts, assets, announcements, employees, leaves,
 * profile guard, biometric, payroll) over HTTP with real signed JWTs, against a small in-memory
 * database that fakes pool.query (the query builder goes through it too). No Postgres required.
 *
 * Data: org 1 has branches 1 (Dalal) and 2 (Bhuj); org 2 is a foreign tenant with branch 7.
 *
 * Run with: node src/tests/branch_http.test.js
 */
'use strict';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'branch-http-test-secret';
const assert = require('assert');
const path = require('path');
const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const req_ = (p) => require(path.join(SRC, p));

// ── permission service stub (RBAC itself is covered elsewhere; here every caller holds the
//    permissions their role normally has, so a 403 can only come from branch/org logic) ─────────
const PERMS = {
  root: null, // root bypasses
  admin: ['employees.view', 'employees.create', 'employees.edit', 'employees.delete', 'holidays.manage', 'shifts.manage', 'assets.create', 'assets.manage',
    'announcements.create', 'announcements.manage', 'leaves.manage', 'leaves.approve', 'payroll.generate', 'payroll.view', 'settings.manage', 'biometric.view', 'biometric.manage',
    'notifications.broadcast', 'performance.create', 'documents.manage', 'documents.upload', 'roles.manage', 'roles.view'],
  employee: [],
};
const permStub = {
  resolvePermissions: async (userId) => {
    const u = DB.users.find(x => x.id === Number(userId));
    return (u && u.perms) || (u && PERMS[u.role === 'admin' ? 'admin' : 'employee']) || [];
  },
  hasPermissionCheck: (perms, m, a) => perms.includes(`${m}.${a}`),
  clearUserCache: () => {},
};
const permPath = require.resolve(path.join(SRC, 'services/permissionService'));
require.cache[permPath] = { id: permPath, filename: permPath, loaded: true, exports: permStub };

// ── in-memory database ──────────────────────────────────────────────────────────────────
const DB = {};
function resetData() {
  DB.branches = [
    { id: 1, org_id: 1, name: 'Dalal', is_active: true }, { id: 2, org_id: 1, name: 'Bhuj', is_active: true }, { id: 7, org_id: 2, name: 'Foreign', is_active: true },
  ];
  DB.users = [
    { id: 1, organization_id: 1, role: 'root_admin', name: 'Root', branch_id: null, employee_status: 'active' },
    { id: 2, organization_id: 1, role: 'admin', name: 'HR Dalal', branch_id: null, employee_status: 'active' },
    { id: 3, organization_id: 1, role: 'admin', name: 'HR Bhuj', branch_id: null, employee_status: 'active' },
    { id: 10, organization_id: 1, role: 'employee', name: 'Emp Dalal', branch_id: 1, employee_status: 'active', ctc: 900000, email: 'a@x.com' },
    { id: 11, organization_id: 1, role: 'employee', name: 'Emp Bhuj', branch_id: 2, employee_status: 'active', ctc: 800000, email: 'b@x.com' },
    { id: 12, organization_id: 1, role: 'employee', name: 'Head Dalal', branch_id: 1, employee_status: 'active', ctc: 700000, email: 'h@x.com', perms: ['employees.view'] },
    { id: 20, organization_id: 2, role: 'root_admin', name: 'Foreign Root', branch_id: null, employee_status: 'active' },
    { id: 21, organization_id: 2, role: 'employee', name: 'Foreign Emp', branch_id: 7, employee_status: 'active' },
  ];
  DB.hr_branch_access = [
    { user_id: 2, org_id: 1, branch_id: 1, all_branches: false }, { user_id: 3, org_id: 1, branch_id: 2, all_branches: false },
  ];
  DB.holidays = [
    { id: 1, organization_id: 1, branch_id: null, name: 'Republic Day', date: '2026-01-26', type: 'public' },
    { id: 2, organization_id: 1, branch_id: 1, name: 'Dalal Foundation Day', date: '2026-03-01', type: 'company' },
    { id: 3, organization_id: 1, branch_id: 2, name: 'Bhuj Local Fair', date: '2026-03-02', type: 'company' },
    { id: 4, organization_id: 2, branch_id: null, name: 'Foreign Holiday', date: '2026-05-05', type: 'public' },
  ];
  DB.shifts = [
    { id: 1, organization_id: 1, branch_id: 1, name: 'Dalal Day', start_time: '09:00', end_time: '18:00' },
    { id: 2, organization_id: 1, branch_id: 2, name: 'Bhuj Day', start_time: '09:30', end_time: '18:30' },
    { id: 3, organization_id: 1, branch_id: null, name: 'General', start_time: '10:00', end_time: '19:00' },
  ];
  DB.shift_assignments = [
    { id: 1, organization_id: 1, user_id: 10, shift_id: 1, date: '2026-04-01' },
    { id: 2, organization_id: 1, user_id: 11, shift_id: 2, date: '2026-04-01' },
    { id: 3, organization_id: 2, user_id: 21, shift_id: 9, date: '2026-04-01' },
  ];
  DB.assets = [
    { id: 1, organization_id: 1, branch_id: 1, asset_tag: 'dalal_asset_001', name: 'Laptop D', status: 'assigned', assigned_to: 10 },
    { id: 2, organization_id: 1, branch_id: 2, asset_tag: 'bhuj_asset_001', name: 'Laptop B', status: 'assigned', assigned_to: 11 },
    { id: 3, organization_id: 1, branch_id: 2, asset_tag: 'bhuj_asset_002', name: 'Spare B', status: 'available', assigned_to: null },
  ];
  DB.announcements = [
    { id: 1, organization_id: 1, title: 'Org-wide', content: 'c', target_audience: 'all', created_by: 1, branch_ids: null, pinned: false },
    { id: 2, organization_id: 1, title: 'Dalal only', content: 'c', target_audience: 'all', created_by: 1, branch_ids: [1], pinned: false },
    { id: 3, organization_id: 2, title: 'Foreign org', content: 'c', target_audience: 'all', created_by: 20, branch_ids: null, pinned: false },
  ];
  DB.leaves = [
    { id: 1, organization_id: 1, user_id: 10, status: 'pending', leave_type: 'casual', start_date: '2026-06-01', end_date: '2026-06-01' },
    { id: 2, organization_id: 1, user_id: 11, status: 'pending', leave_type: 'casual', start_date: '2026-06-01', end_date: '2026-06-01' },
  ];
  DB.leave_comments = [{ id: 1, leave_id: 2, user_id: 11, comment: 'private', organization_id: 1 }];
  DB.biometric_employee_map = [{ id: 1, org_id: 1, employee_pin: '480', user_id: 11 }];
  DB.attendance = [];
  DB._seq = { holidays: 100, shift_assignments: 100, assets: 100, announcements: 100, attendance: 100 };
}

// builder-SQL mini engine ------------------------------------------------------------------
function splitTop(s, sep) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++; if (c === ')') depth--;
    if (depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
function valsOf(list, params) { return list.split(',').map(x => params[Number(x.trim().slice(1)) - 1]); }
function evalTerm(t, row, params) {
  t = t.trim().replace(/^"\w+"\."(\w+)"/, '"$1"'); let m;
  if ((m = t.match(/^"(\w+)" IS NULL$/))) return row[m[1]] == null;
  if ((m = t.match(/^"(\w+)" IS NOT NULL$/))) return row[m[1]] != null;
  if ((m = t.match(/^"(\w+)" = \$(\d+)$/))) return String(row[m[1]]) === String(params[m[2] - 1]);
  if ((m = t.match(/^"(\w+)" (?:<>|!=) \$(\d+)$/))) return String(row[m[1]]) !== String(params[m[2] - 1]);
  if ((m = t.match(/^"(\w+)" >= \$(\d+)$/))) return String(row[m[1]]) >= String(params[m[2] - 1]);
  if ((m = t.match(/^"(\w+)" <= \$(\d+)$/))) return String(row[m[1]]) <= String(params[m[2] - 1]);
  if ((m = t.match(/^"(\w+)" NOT IN \(([^)]*)\)$/))) return !valsOf(m[2], params).map(String).includes(String(row[m[1]]));
  if ((m = t.match(/^"(\w+)" IN \(([^)]*)\)$/))) return valsOf(m[1] ? m[2] : '', params).map(String).includes(String(row[m[1]]));
  if ((m = t.match(/^"(\w+)" LIKE \$(\d+)$/))) return String(row[m[1]]).startsWith(String(params[m[2] - 1]).replace(/%$/, ''));
  throw new Error('fake DB: unsupported term: ' + t);
}
function evalWhere(where, row, params) {
  if (!where) return true;
  return splitTop(where, ' AND ').every(c => {
    c = c.trim();
    if (c.startsWith('(') && c.endsWith(')')) return splitTop(c.slice(1, -1), ' OR ').some(o => evalTerm(o, row, params));
    return evalTerm(c, row, params);
  });
}
function engine(sql, params) {
  let m;
  sql = sql.replace(/ LEFT JOIN "\w+" AS "_jt_\w+" ON "_jt_\w+"\.id = "\w+"\."\w+"/g, '');
  if ((m = sql.match(/^SELECT .+? FROM "(\w+)"(?: WHERE (.+?))?(?: ORDER BY .+?)?(?: LIMIT (\d+))?$/))) {
    let rows = (DB[m[1]] || []).filter(r => evalWhere(m[2], r, params));
    if (m[3]) rows = rows.slice(0, Number(m[3]));
    return { rows: rows.map(r => ({ ...r })), rowCount: rows.length };
  }
  if ((m = sql.match(/^INSERT INTO "(\w+)" \((.+?)\) VALUES (.+?)(?: RETURNING \*)?$/))) {
    const cols = m[2].split(',').map(c => c.trim().replace(/"/g, ''));
    const tuples = m[3].match(/\([^)]*\)/g); const out = [];
    for (const t of tuples) {
      const vals = t.slice(1, -1).split(',').map(x => params[Number(x.trim().slice(1)) - 1]);
      const row = { id: ++DB._seq[m[1]] }; cols.forEach((c, i) => { row[c] = vals[i]; });
      DB[m[1]].push(row); out.push({ ...row });
    }
    return { rows: out, rowCount: out.length };
  }
  if ((m = sql.match(/^UPDATE "(\w+)" SET (.+?) WHERE (.+?)(?: RETURNING \*)?$/))) {
    const sets = m[2].split(', ').map(s => s.match(/^"(\w+)" = \$(\d+)$/));
    const hit = DB[m[1]].filter(r => evalWhere(m[3], r, params));
    hit.forEach(r => sets.forEach(s => { r[s[1]] = params[s[2] - 1]; }));
    return { rows: hit.map(r => ({ ...r })), rowCount: hit.length };
  }
  if ((m = sql.match(/^DELETE FROM "(\w+)" WHERE (.+?)(?: RETURNING \*)?$/))) {
    const hit = DB[m[1]].filter(r => evalWhere(m[2], r, params));
    DB[m[1]] = DB[m[1]].filter(r => !hit.includes(r));
    return { rows: hit, rowCount: hit.length };
  }
  return null;
}

// raw (hand-written) SQL used by the branch helpers / a few routes ------------------------------
function raw(sql, p) {
  let m;
  const org = (r) => String(r.organization_id) === String(p[1] ?? p[0]);
  if (/FROM hr_branch_access\s+WHERE user_id = \$1 AND org_id = \$2/.test(sql))
    return { rows: DB.hr_branch_access.filter(g => g.user_id === Number(p[0]) && g.org_id === Number(p[1])) };
  if (/SELECT COUNT\(\*\)::int AS c FROM branches WHERE org_id = \$1 AND is_active = TRUE/.test(sql))
    return { rows: [{ c: DB.branches.filter(b => b.org_id === Number(p[0]) && b.is_active).length }] };
  if (/SELECT id FROM branches WHERE org_id = \$1 AND is_active = TRUE/.test(sql))
    return { rows: DB.branches.filter(b => b.org_id === Number(p[0]) && b.is_active).map(b => ({ id: b.id })) };
  if (/SELECT 1 FROM branches WHERE org_id = \$1 AND is_active = TRUE/.test(sql))
    return { rows: DB.branches.filter(b => b.org_id === Number(p[0]) && b.is_active).slice(0, 1).map(() => ({ '?column?': 1 })) };
  if (/SELECT id FROM branches WHERE id = \$1 AND org_id = \$2/.test(sql))
    return { rows: DB.branches.filter(b => b.id === Number(p[0]) && b.org_id === Number(p[1])).map(b => ({ id: b.id })) };
  if (/SELECT id FROM branches WHERE org_id = \$1 AND id = ANY/.test(sql))
    return { rows: DB.branches.filter(b => b.org_id === Number(p[0]) && p[1].map(Number).includes(b.id)).map(b => ({ id: b.id })) };
  if ((m = sql.match(/SELECT branch_id FROM users WHERE id = \$1 AND organization_id = \$2/)))
    return { rows: DB.users.filter(u => u.id === Number(p[0]) && u.organization_id === Number(p[1])).map(u => ({ branch_id: u.branch_id })) };
  if (/SELECT id, role, branch_id(, employee_status, department)? FROM users WHERE id = \$1 AND organization_id = \$2/.test(sql))
    return { rows: DB.users.filter(u => u.id === Number(p[0]) && u.organization_id === Number(p[1])).map(u => ({ id: u.id, role: u.role, branch_id: u.branch_id, employee_status: u.employee_status, department: u.department })) };
  if (/SELECT 1 FROM users WHERE id = \$1 AND organization_id = \$2/.test(sql))
    return { rows: DB.users.filter(u => u.id === Number(p[0]) && u.organization_id === Number(p[1])).map(() => ({ x: 1 })) };
  if (/SELECT id FROM users WHERE organization_id = \$1 AND id = ANY\(\$2::bigint\[\]\)/.test(sql)) {
    const extra = p[2]; const hasBr = /branch_id = \$3/.test(sql), hasAny = /branch_id = ANY\(\$3/.test(sql);
    return { rows: DB.users.filter(u => u.organization_id === Number(p[0]) && p[1].map(Number).includes(u.id)
      && (!hasBr || u.branch_id === Number(extra)) && (!hasAny || extra.map(Number).includes(u.branch_id))).map(u => ({ id: u.id })) };
  }
  if (/SELECT id FROM users WHERE organization_id = \$1 AND branch_id = \$2/.test(sql))
    return { rows: DB.users.filter(u => u.organization_id === Number(p[0]) && u.branch_id === Number(p[1])).map(u => ({ id: u.id })) };
  if (/SELECT id FROM users WHERE organization_id = \$1 AND branch_id = ANY/.test(sql))
    return { rows: DB.users.filter(u => u.organization_id === Number(p[0]) && p[1].map(Number).includes(u.branch_id)).map(u => ({ id: u.id })) };
  if (/SELECT u\.employee_status,/.test(sql)) return { rows: [{ employee_status: 'active', last_working_day: null }] };
  if (/FROM users u\s+LEFT JOIN user_departments/.test(sql)) { // GET /employees
    const [oId, roles] = p; const hasAny = /u\.branch_id = ANY/.test(sql), hasEq = /u\.branch_id = \$3/.test(sql);
    const cols = [...sql.matchAll(/u\."(\w+)"/g)].map(x => x[1]);
    return { rows: DB.users.filter(u => u.organization_id === Number(oId) && roles.includes(u.role)
      && (!hasEq || u.branch_id === Number(p[2])) && (!hasAny || p[2].map(Number).includes(u.branch_id))
      && !['inactive', 'resigned', 'terminated'].includes(u.employee_status))
      .map(u => Object.fromEntries(cols.map(c => [c, u[c]]).concat([['departments', []]]))) };
  }
  if (/SELECT user_id FROM biometric_employee_map WHERE id = \$1 AND org_id = \$2/.test(sql))
    return { rows: DB.biometric_employee_map.filter(x => x.id === Number(p[0]) && x.org_id === Number(p[1])).map(x => ({ user_id: x.user_id })) };
  if (/SELECT user_id FROM biometric_employee_map WHERE org_id = \$1 AND employee_pin = \$2/.test(sql))
    return { rows: DB.biometric_employee_map.filter(x => x.org_id === Number(p[0]) && x.employee_pin === String(p[1])).map(x => ({ user_id: x.user_id })) };
  return null;
}

const dbMod = req_('config/db');
const calls = [];
dbMod.pool.query = async (sql, params = []) => {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  calls.push(s);
  const r = raw(s, params) || engine(s, params);
  if (r) return { rowCount: r.rows.length, ...r };
  if (/^(CREATE|ALTER|INSERT INTO platform_activity)/i.test(s)) return { rows: [], rowCount: 0 };
  throw new Error('fake DB: unhandled SQL: ' + s.slice(0, 120));
};
dbMod.pool.connect = async () => ({ query: (...a) => dbMod.pool.query(...a), release() {} });

// ── app with the REAL routers ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use('/api/holidays',  req_('modules/holidays/holidays.routes'));
app.use('/api/shifts',    req_('modules/shifts/shifts.routes'));
app.use('/api/assets',    req_('modules/assets/assets.routes'));
app.use('/api/announcements', req_('modules/announcements/announcements.routes'));
app.use('/api/employees', req_('modules/employees/employees.routes'));
app.use('/api/leaves',    req_('modules/leaves/leaves.routes'));
app.use('/api/biometric', req_('modules/biometric/biometric.routes'));
app.use('/api/payroll',   req_('modules/payroll/payroll.routes'));
app.use('/api/profile/:id', req_('middleware/profileGuard'));
app.use('/api/profile',   req_('modules/employee-profile/overview.routes'));

const tok = (u) => jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: u.organization_id }, process.env.JWT_SECRET);
const as = (id) => tok(DB.users.find(u => u.id === id));
let base;
async function call(method, url, { as: who, branch, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = 'Bearer ' + as(who);
  if (branch !== undefined && branch !== null) headers['X-Branch-Id'] = String(branch);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}

// ── harness ─────────────────────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function t(name, fn) {
  resetData(); req_('services/branchService').clearBranchAccessCache();
  try { await fn(); console.log(`  ✓ ${name}`); passed++; } catch (e) { console.error(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); failed++; }
}
const names = (rows) => rows.map(r => r.name || r.title).sort();
const DALAL = 1, BHUJ = 2, ROOT = 1, HR_D = 2, HR_B = 3, EMP_D = 10, EMP_B = 11, HEAD_D = 12, FROOT = 20;

(async () => {
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nHOLIDAYS — org-wide + branch-specific');
  await t('HR Dalal sees org-wide + Dalal holidays, never Bhuj', async () => {
    const r = await call('GET', '/api/holidays?year=2026', { as: HR_D, branch: DALAL });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(names(r.body), ['Dalal Foundation Day', 'Republic Day']);
  });
  await t('HR Dalal selecting Bhuj via header → 403 (URL/header manipulation)', async () => {
    assert.strictEqual((await call('GET', '/api/holidays', { as: HR_D, branch: BHUJ })).status, 403);
  });
  await t('HR Dalal with no header sees only their branches (null ≠ All Branches)', async () => {
    const r = await call('GET', '/api/holidays', { as: HR_D });
    assert.deepStrictEqual(names(r.body), ['Dalal Foundation Day', 'Republic Day']);
  });
  await t('Root sees everything for All Branches; one branch when selected', async () => {
    assert.strictEqual((await call('GET', '/api/holidays?year=2026', { as: ROOT })).body.length, 3);
    assert.deepStrictEqual(names((await call('GET', '/api/holidays?year=2026', { as: ROOT, branch: BHUJ })).body), ['Bhuj Local Fair', 'Republic Day']);
  });
  await t('Employee (Bhuj) sees org-wide + own branch holidays only', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/holidays?year=2026', { as: EMP_B })).body), ['Bhuj Local Fair', 'Republic Day']);
  });
  await t('HR Dalal cannot edit / delete Bhuj or org-wide holidays', async () => {
    assert.strictEqual((await call('PUT', '/api/holidays/3', { as: HR_D, branch: DALAL, body: { name: 'hacked', date: '2026-03-02' } })).status, 403);
    assert.strictEqual((await call('DELETE', '/api/holidays/3', { as: HR_D, branch: DALAL })).status, 403);
    assert.strictEqual((await call('PUT', '/api/holidays/1', { as: HR_D, branch: DALAL, body: { name: 'hacked', date: '2026-01-26' } })).status, 403, 'org-wide');
    assert.strictEqual(DB.holidays.find(h => h.id === 3).name, 'Bhuj Local Fair');
  });
  await t('HR Dalal can edit their own branch holiday', async () => {
    const r = await call('PUT', '/api/holidays/2', { as: HR_D, branch: DALAL, body: { name: 'Renamed', date: '2026-03-01' } });
    assert.strictEqual(r.status, 200); assert.strictEqual(DB.holidays.find(h => h.id === 2).name, 'Renamed');
  });
  await t('HR Dalal with no branch selected cannot create (no NULL-branch / org-wide bypass)', async () => {
    const r = await call('POST', '/api/holidays', { as: HR_D, body: { name: 'X', date: '2026-07-07' } });
    assert.strictEqual(r.status, 403); assert.ok(!DB.holidays.some(h => h.name === 'X'));
  });
  await t('HR Dalal creates in Dalal; cannot claim org-wide or Bhuj via body', async () => {
    assert.strictEqual((await call('POST', '/api/holidays', { as: HR_D, branch: DALAL, body: { name: 'OK', date: '2026-07-08' } })).status, 200);
    assert.strictEqual(DB.holidays.find(h => h.name === 'OK').branch_id, 1);
    assert.strictEqual((await call('POST', '/api/holidays', { as: HR_D, branch: DALAL, body: { name: 'Org', date: '2026-07-09', org_wide: true } })).status, 403);
    assert.strictEqual((await call('POST', '/api/holidays', { as: HR_D, branch: DALAL, body: { name: 'B', date: '2026-07-10', branch_ids: [BHUJ] } })).status, 403);
  });
  await t('Root: org-wide holiday and "apply to selected branches"', async () => {
    assert.strictEqual((await call('POST', '/api/holidays', { as: ROOT, body: { name: 'AllHands', date: '2026-08-01', org_wide: true } })).status, 200);
    assert.strictEqual(DB.holidays.find(h => h.name === 'AllHands').branch_id, null);
    assert.strictEqual((await call('POST', '/api/holidays', { as: ROOT, body: { name: 'Both', date: '2026-08-02', branch_ids: [DALAL, BHUJ] } })).status, 200);
    assert.deepStrictEqual(DB.holidays.filter(h => h.name === 'Both').map(h => h.branch_id).sort(), [1, 2]);
  });
  await t('bulk import ignores client branch_id / organization_id', async () => {
    await call('POST', '/api/holidays/bulk', { as: HR_D, branch: DALAL, body: { holidays: [{ name: 'Inj', date: '2026-09-09', branch_id: 2, organization_id: 2 }] } });
    const h = DB.holidays.find(x => x.name === 'Inj'); assert.ok(h); assert.strictEqual(h.branch_id, 1); assert.strictEqual(h.organization_id, 1);
  });
  await t('copy-from-year preserves scope and never copies another branch', async () => {
    await call('POST', '/api/holidays/copy-from-year', { as: HR_D, branch: DALAL, body: { from_year: 2026, to_year: 2027 } });
    const copies = DB.holidays.filter(h => String(h.date).startsWith('2027'));
    assert.ok(copies.length >= 1 && copies.every(h => h.branch_id === 1), JSON.stringify(copies.map(c => c.branch_id)));
  });
  await t('CROSS-ORG: foreign root cannot touch org 1 holidays', async () => {
    assert.strictEqual((await call('DELETE', '/api/holidays/1', { as: FROOT })).status, 404);
    assert.strictEqual((await call('PUT', '/api/holidays/2', { as: FROOT, body: { name: 'x', date: '2026-03-01' } })).status, 404);
    assert.ok(DB.holidays.some(h => h.id === 1));
  });

  console.log('\nSHIFTS & ROSTER');
  await t('HR Dalal sees Dalal + org-wide shifts, not Bhuj shifts', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/shifts', { as: HR_D, branch: DALAL })).body), ['Dalal Day', 'General']);
  });
  await t('HR Dalal cannot assign Bhuj employee (bulk) or use a Bhuj shift', async () => {
    const a = await call('POST', '/api/shifts/assignments/bulk', { as: HR_D, branch: DALAL, body: { assignments: [{ user_id: EMP_B, shift_id: 1, date: '2026-04-05' }] } });
    assert.strictEqual(a.status, 403);
    const b = await call('POST', '/api/shifts/assignments/bulk', { as: HR_D, branch: DALAL, body: { assignments: [{ user_id: EMP_D, shift_id: 2, date: '2026-04-05' }] } });
    assert.strictEqual(b.status, 404, 'Bhuj shift is not usable by Dalal HR');
    assert.ok(!DB.shift_assignments.some(x => x.date === '2026-04-05'));
  });
  await t('HR Dalal can assign Dalal employee to Dalal / org-wide shift', async () => {
    const r = await call('POST', '/api/shifts/assignments/bulk', { as: HR_D, branch: DALAL, body: { assignments: [{ user_id: EMP_D, shift_id: 3, date: '2026-04-06' }] } });
    assert.strictEqual(r.status, 200);
  });
  await t('bulk assign cannot smuggle organization_id', async () => {
    await call('POST', '/api/shifts/assignments/bulk', { as: HR_D, branch: DALAL, body: { assignments: [{ user_id: EMP_D, shift_id: 3, date: '2026-04-07', organization_id: 2 }] } });
    assert.strictEqual(DB.shift_assignments.find(x => x.date === '2026-04-07').organization_id, 1);
  });
  await t('assignment delete: other-branch employee → 403; foreign tenant id → 404', async () => {
    assert.strictEqual((await call('DELETE', '/api/shifts/assignments/2', { as: HR_D, branch: DALAL })).status, 403);
    assert.strictEqual((await call('DELETE', '/api/shifts/assignments/3', { as: ROOT })).status, 404);
    assert.ok(DB.shift_assignments.some(x => x.id === 3) && DB.shift_assignments.some(x => x.id === 2));
  });
  await t('roster read: employee cannot read another employee\'s shifts; HR cannot read other branch', async () => {
    assert.strictEqual((await call('GET', `/api/shifts/assignments?userId=${EMP_B}`, { as: EMP_D })).status, 403);
    assert.strictEqual((await call('GET', `/api/shifts/assignments?userId=${EMP_B}`, { as: HR_D, branch: DALAL })).status, 403);
    assert.strictEqual((await call('GET', `/api/shifts/assignments?userId=${EMP_D}`, { as: EMP_D })).status, 200);
  });
  await t('shift edit/delete: other-branch and org-wide shifts protected for restricted HR', async () => {
    assert.strictEqual((await call('PUT', '/api/shifts/2', { as: HR_D, branch: DALAL, body: { name: 'x', start_time: '09:00', end_time: '17:00' } })).status, 403);
    assert.strictEqual((await call('DELETE', '/api/shifts/3', { as: HR_D, branch: DALAL })).status, 403, 'org-wide');
  });

  console.log('\nEMPLOYEES');
  await t('HR Dalal list: only Dalal employees (even with no header)', async () => {
    const r = await call('GET', '/api/employees', { as: HR_D }); assert.strictEqual(r.status, 200); assert.deepStrictEqual(names(r.body), ['Emp Dalal', 'Head Dalal']);
  });
  await t('Root: Bhuj selected → Bhuj only; All Branches → all org employees, never foreign org', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/employees', { as: ROOT, branch: BHUJ })).body), ['Emp Bhuj']);
    const all = names((await call('GET', '/api/employees', { as: ROOT })).body); assert.ok(!all.includes('Foreign Emp') && all.includes('Emp Bhuj') && all.includes('Emp Dalal'));
  });
  await t('Department head (employees.view) is bound to own branch and gets NO salary data', async () => {
    const r = await call('GET', '/api/employees', { as: HEAD_D });
    assert.strictEqual(r.status, 200); assert.deepStrictEqual(names(r.body), ['Emp Dalal', 'Head Dalal']);
    assert.ok(r.body.every(e => !('ctc' in e) && !('salary_structure' in e)), 'directory columns only');
  });
  await t('HR Dalal cannot edit / delete / set statutory on a Bhuj employee', async () => {
    assert.strictEqual((await call('PUT', `/api/employees/${EMP_B}`, { as: HR_D, branch: DALAL, body: { name: 'x', role: 'employee' } })).status, 403);
    assert.strictEqual((await call('PUT', `/api/employees/${EMP_B}/statutory`, { as: HR_D, branch: DALAL, body: { pan_number: 'AAAAA1111A' } })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/employees/${EMP_B}`, { as: HR_D, branch: DALAL })).status, 403);
    assert.ok(DB.users.some(u => u.id === EMP_B));
  });
  await t('HR Dalal cannot create an employee in Bhuj, nor an admin account', async () => {
    assert.strictEqual((await call('POST', '/api/employees', { as: HR_D, branch: DALAL, body: { name: 'N', email: 'n@x.com', branch_id: BHUJ } })).status, 403);
    assert.strictEqual((await call('POST', '/api/employees', { as: HR_D, branch: DALAL, body: { name: 'N2', email: 'n2@x.com', role: 'admin' } })).status, 403);
  });
  await t('HR cannot edit an HR/root admin account (password-reset takeover)', async () => {
    DB.users.find(u => u.id === HR_B).branch_id = 1; // even if branch-visible
    assert.strictEqual((await call('PUT', `/api/employees/${HR_B}`, { as: HR_D, branch: DALAL, body: { name: 'x', password: 'newpass12' } })).status, 403);
  });
  await t('PUT without branch_id keeps the employee\'s branch (no silent NULL)', async () => {
    // reaches the update path; the fake DB then rejects the heavy UPDATE, which is fine — assert the guard output instead
    const before = DB.users.find(u => u.id === EMP_D).branch_id;
    await call('PUT', `/api/employees/${EMP_D}`, { as: HR_D, branch: DALAL, body: { name: 'Emp Dalal', role: 'employee' } });
    assert.strictEqual(DB.users.find(u => u.id === EMP_D).branch_id, before);
  });
  await t('HR Dalal cannot move an employee into an inaccessible branch', async () => {
    const r = await call('PUT', `/api/employees/${EMP_D}`, { as: HR_D, branch: DALAL, body: { name: 'Emp Dalal', role: 'employee', branch_id: BHUJ } });
    assert.strictEqual(r.status, 403); assert.strictEqual(DB.users.find(u => u.id === EMP_D).branch_id, 1);
  });
  await t('CROSS-ORG: foreign root gets 404/403 on org 1 employee', async () => {
    assert.ok([403, 404].includes((await call('PUT', `/api/employees/${EMP_D}`, { as: FROOT, body: { name: 'x' } })).status));
    assert.ok([403, 404].includes((await call('DELETE', `/api/employees/${EMP_D}`, { as: FROOT })).status));
  });

  console.log('\nPROFILE FAMILY (/api/profile/:id/*)');
  await t('HR Dalal → Bhuj employee profile = 403; own-branch passes the guard', async () => {
    assert.strictEqual((await call('GET', `/api/profile/${EMP_B}/overview`, { as: HR_D, branch: DALAL })).status, 403);
    assert.notStrictEqual((await call('GET', `/api/profile/${EMP_D}/overview`, { as: HR_D, branch: DALAL })).status, 403);
  });
  await t('Employee → another employee profile = 403 (URL id manipulation)', async () => {
    assert.strictEqual((await call('GET', `/api/profile/${EMP_B}/overview`, { as: EMP_D })).status, 403);
  });
  await t('Foreign root → org 1 profile = 404; unauthenticated = 401', async () => {
    assert.strictEqual((await call('GET', `/api/profile/${EMP_D}/overview`, { as: FROOT })).status, 404);
    assert.strictEqual((await call('GET', `/api/profile/${EMP_D}/overview`)).status, 401);
  });

  console.log('\nASSETS');
  await t('employees only see their own assets (?userId= ignored)', async () => {
    const r = await call('GET', `/api/assets?userId=${EMP_B}`, { as: EMP_D });
    assert.deepStrictEqual(names(r.body), ['Laptop D']);
  });
  await t('HR Dalal: cannot list / edit / delete Bhuj assets', async () => {
    const l = await call('GET', '/api/assets', { as: HR_D, branch: DALAL }); assert.ok(l.body.every(a => a.branch_id !== 2), 'no Bhuj assets in list');
    assert.strictEqual((await call('PUT', '/api/assets/2', { as: HR_D, branch: DALAL, body: { asset_tag: 'bhuj_asset_001', name: 'x', status: 'available' } })).status, 403);
    assert.strictEqual((await call('DELETE', '/api/assets/3', { as: HR_D, branch: DALAL })).status, 403);
    assert.ok(DB.assets.some(a => a.id === 2) && DB.assets.some(a => a.id === 3));
  });
  await t('HR Dalal cannot create a NULL-branch asset (no branch selected) nor assign to Bhuj employee', async () => {
    assert.strictEqual((await call('POST', '/api/assets', { as: HR_D, body: { name: 'x', asset_tag: 't1', status: 'available' } })).status, 403);
    assert.strictEqual((await call('POST', '/api/assets', { as: HR_D, branch: DALAL, body: { name: 'x', asset_tag: 't2', status: 'assigned', assigned_to: EMP_B } })).status, 403);
  });

  console.log('\nANNOUNCEMENTS');
  await t('branch-targeted announcement is hidden from other-branch employees; org-wide visible', async () => {
    assert.deepStrictEqual(names((await call('GET', '/api/announcements', { as: EMP_B })).body), ['Org-wide']);
    assert.deepStrictEqual(names((await call('GET', '/api/announcements', { as: EMP_D })).body), ['Dalal only', 'Org-wide']);
  });
  await t('?org_id= override is ignored (root cannot read another org)', async () => {
    const r = await call('GET', '/api/announcements?org_id=2', { as: ROOT }); assert.ok(r.body.every(a => a.organization_id === 1));
  });

  console.log('\nLEAVES');
  await t('HR Dalal cannot read comments / history of a Bhuj employee\'s leave', async () => {
    assert.strictEqual((await call('GET', '/api/leaves/2/comments', { as: HR_D, branch: DALAL })).status, 403);
    assert.strictEqual((await call('POST', '/api/leaves/2/comments', { as: HR_D, branch: DALAL, body: { comment: 'x' } })).status, 403);
    assert.strictEqual((await call('GET', '/api/leaves/2/history', { as: HR_D, branch: DALAL })).status, 403);
    assert.strictEqual((await call('PUT', '/api/leaves/2', { as: HR_D, branch: DALAL, body: { reason: 'x' } })).status, 403);
  });
  await t('HR Dalal cannot apply leave on behalf of a Bhuj employee', async () => {
    assert.strictEqual((await call('POST', '/api/leaves', { as: HR_D, branch: DALAL, body: { user_id: EMP_B, start_date: '2026-07-01', end_date: '2026-07-01', leave_type: 'casual' } })).status, 403);
  });
  await t('employee cannot read another employee\'s leave comments', async () => {
    assert.strictEqual((await call('GET', '/api/leaves/2/comments', { as: EMP_D })).status, 403);
  });

  console.log('\nBIOMETRIC — device branch ≠ employee ownership');
  await t('HR Dalal cannot map a PIN to a Bhuj employee', async () => {
    assert.strictEqual((await call('POST', '/api/biometric/employee-map', { as: HR_D, branch: DALAL, body: { employee_pin: '999', user_id: EMP_B } })).status, 403);
  });
  await t('HR Dalal cannot unmap Bhuj employee PIN 480', async () => {
    assert.strictEqual((await call('DELETE', '/api/biometric/employee-map/1', { as: HR_D, branch: DALAL })).status, 403);
    assert.ok(DB.biometric_employee_map.some(m => m.id === 1));
  });
  await t('bulk import rollback / auto-sync control need all-branch access (restricted HR refused)', async () => {
    assert.strictEqual((await call('DELETE', '/api/biometric/import-batches/1', { as: HR_D, branch: DALAL })).status, 403);
    assert.strictEqual((await call('PUT', '/api/biometric/auto-sync/config', { as: HR_D, branch: DALAL, body: { enabled: true } })).status, 403);
    assert.strictEqual((await call('POST', '/api/biometric/auto-sync/trigger', { as: HR_D, branch: DALAL })).status, 403);
  });
  await t('plain employees cannot use the biometric admin API', async () => {
    assert.strictEqual((await call('GET', '/api/biometric/devices', { as: EMP_D })).status, 403);
  });

  console.log('\nPAYROLL');
  await t('restricted HR with no branch selected cannot generate an org-wide run', async () => {
    assert.strictEqual((await call('POST', '/api/payroll/generate', { as: HR_D, body: { month: 4, year: 2026 } })).status, 400);
  });
  await t('root on All Branches cannot generate an org-wide run in a branch-enabled org', async () => {
    assert.strictEqual((await call('POST', '/api/payroll/generate', { as: ROOT, body: { month: 4, year: 2026 } })).status, 400);
    assert.strictEqual((await call('POST', '/api/payroll/preview', { as: ROOT, body: { month: 4, year: 2026 } })).status, 400);
  });
  await t('restricted HR cannot trigger the org-wide scheduler run (no branch) nor a foreign branch run', async () => {
    assert.strictEqual((await call('POST', '/api/payroll/scheduler/trigger', { as: HR_D, body: { month: 4, year: 2026 } })).status, 403, 'no branch selected = org-wide = all-branch access only');
    assert.strictEqual((await call('POST', '/api/payroll/scheduler/trigger', { as: HR_D, branch: DALAL, body: { month: 4, year: 2026, branch_id: BHUJ } })).status, 403, 'explicit foreign branch_id');
  });

  console.log('\nBRANCH CONTEXT');
  await t('every branch-aware endpoint rejects a foreign-org branch id, even for Root', async () => {
    for (const u of ['/api/holidays', '/api/shifts', '/api/employees', '/api/assets'])
      assert.strictEqual((await call('GET', u, { as: ROOT, branch: 7 })).status, 403, u);
  });

  server.close();
  console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n❌  Request-level branch-separation failures detected.'); process.exit(1); }
  console.log('\n✅  All request-level branch-separation checks passed.');
  process.exit(0);
})();
