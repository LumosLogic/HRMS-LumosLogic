/**
 * rbac_client_access.test.js — custom-role navigation logic of the client (no DB, no browser).
 *
 * Loads the REAL client/src/lib/adminAccess.js and reads the REAL Sidebar.jsx / App.jsx / Login.jsx, then checks, for a
 * custom-role employee (users.role = 'employee'):
 *   - where they land after login (first permitted admin page; none ⇒ stays in the Employee portal)
 *   - which direct URLs the admin-shell route guard opens or blocks
 *   - which sidebar entries they see
 *   - that the sidebar and the route guard use the SAME map (no drift), including the payroll sub-pages
 *
 * Run: node src/tests/rbac_client_access.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const CLIENT = path.join(__dirname, '../../../client/src');
const read = (p) => fs.readFileSync(path.join(CLIENT, p), 'utf8');

// adminAccess.js is an ES module without imports → evaluate its source directly.
const src = read('lib/adminAccess.js').replace(/^export (const|function)/gm, '$1');
const A = new Function(`${src}; return { ADMIN_PATH_PERMISSIONS, permissionMatches, canAccessAdminPath, firstAdminPath };`)();

let passed = 0, failed = 0; const failures = [];
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 4).join('\n    ')}`); failed++; failures.push(name); }
}

// The requested test user: Dashboard.view, Employees.view, Payroll.view, Payroll.generate, Payroll.approve
const PM = ['dashboard.view', 'employees.view', 'payroll.view', 'payroll.generate', 'payroll.approve'];
const can = (perms, p) => A.canAccessAdminPath(perms, p);

console.log('\nLANDING PAGE');
t('payroll-manager custom role lands on the Dashboard (not the Employee portal)', () => {
  assert.strictEqual(A.firstAdminPath(PM), '/dashboard');
});
t('without dashboard.view the first permitted module is the landing page', () => {
  assert.strictEqual(A.firstAdminPath(['employees.view']), '/employees');
  assert.strictEqual(A.firstAdminPath(['payroll.view']), '/payroll/dashboard');
  assert.strictEqual(A.firstAdminPath(['leaves.view', 'reports.view']), '/leaves');
});
t('no admin-module permission ⇒ no landing page ⇒ normal Employee portal behaviour', () => {
  assert.strictEqual(A.firstAdminPath([]), null);
  assert.strictEqual(A.firstAdminPath(undefined), null);
  // permissions that map to no admin module (portal-only grants) keep the user in the Employee portal
  assert.strictEqual(A.firstAdminPath(['notifications.view', 'payroll.view_own', 'regularization.create', 'onboarding.complete_task']), null);
});
t('the client applies the SAME inference as the backend (leaves.create ⇒ leaves.view), so landing and API elevation agree', () => {
  assert.strictEqual(A.firstAdminPath(['leaves.create']), '/leaves');
});

console.log('\nDIRECT URLS (route guard)');
t('permitted modules open: dashboard, employees (+detail), payroll dashboard / generate / runs / payslips', () => {
  for (const p of ['/dashboard', '/employees', '/employees/5', '/payroll/dashboard', '/payroll/generate', '/payroll/runs/12', '/payroll/payslips/3'])
    assert.ok(can(PM, p), p);
});
t('modules without a permission are blocked: leaves, calendar, reports, documents, settings, holidays, shifts, branches, biometric', () => {
  for (const p of ['/leaves', '/calendar', '/reports', '/documents', '/settings', '/holidays', '/shifts', '/branches', '/biometric/devices', '/departments', '/expenses', '/assets', '/announcements', '/performance', '/onboarding', '/exit-management', '/regularization', '/leave-policies'])
    assert.ok(!can(PM, p), `${p} must be blocked`);
});
t('payroll sub-pages follow their own permission: reports / salary structures / settings are blocked for the payroll-manager', () => {
  for (const p of ['/payroll/reports', '/payroll/salary', '/payroll/settings']) assert.ok(!can(PM, p), `${p} must be blocked (needs run_reports / manage_structures / manage_settings)`);
  assert.ok(can([...PM, 'payroll.run_reports'], '/payroll/reports'));
  assert.ok(can([...PM, 'payroll.manage_structures'], '/payroll/salary'));
  assert.ok(can([...PM, 'payroll.manage_settings'], '/payroll/settings'));
});
t('payroll.view alone opens the payroll dashboard but not generation', () => {
  assert.ok(can(['payroll.view'], '/payroll/dashboard')); assert.ok(!can(['payroll.view'], '/payroll/generate'));
});
t('roles and pending-approvals stay closed to custom roles; self pages (profile, notifications) are always reachable', () => {
  assert.ok(!can(PM, '/roles') && !can(PM, '/roles/3/permissions') && !can(PM, '/pending-approvals'));
  assert.ok(can([], '/profile') && can([], '/notifications'));
});
t('permission inference matches the backend: any action implies view; manage implies create/edit/delete', () => {
  assert.ok(A.permissionMatches(['payroll.generate'], 'payroll.view'));
  assert.ok(A.permissionMatches(['employees.manage'], 'employees.edit'));
  assert.ok(!A.permissionMatches(['employees.view'], 'employees.edit'));
});

console.log('\nSIDEBAR (real Sidebar.jsx items filtered by the same map)');
const sidebar = read('components/layout/Sidebar.jsx');
const itemPaths = [...new Set([...sidebar.matchAll(/\{\s*to:\s*'(\/[^']*)'/g)].map(m => m[1]))].filter(p => !p.startsWith('/portal'));
t('Sidebar item list was parsed (guards against a silent regex miss)', () => { assert.ok(itemPaths.length >= 25, `only ${itemPaths.length} items found`); });
t('statutory pages need statutory.view (the API returns 403 for payroll.view alone) — not shown to the payroll-manager', () => {
  for (const p of ['/statutory/config', '/statutory/compliance']) { assert.ok(!can(PM, p), p); assert.ok(can([...PM, 'statutory.view'], p), p); }
});
t('payroll-manager sees exactly: Dashboard, Employees, Payroll Dashboard, Payroll Generation (+ always-on Profile/Notifications)', () => {
  const visible = itemPaths.filter(p => can(PM, p));
  const expected = ['/dashboard', '/employees', '/payroll/dashboard', '/payroll/generate'];
  for (const e of expected) assert.ok(visible.includes(e), `${e} must be visible; visible=${visible.join(',')}`);
  const extra = visible.filter(p => !expected.includes(p));
  assert.deepStrictEqual(extra.sort(), ['/notifications', '/profile'].sort(), `unexpected visible items: ${extra.join(',')}`);
});
t('every payroll sub-item the sidebar can show is covered by the shared map (sidebar and route guard cannot drift)', () => {
  const subs = itemPaths.filter(p => p.startsWith('/payroll/'));
  assert.ok(subs.length >= 5);
  for (const p of subs) {
    const entry = A.ADMIN_PATH_PERMISSIONS.find(([prefix]) => prefix === p);
    assert.ok(entry, `${p} has no explicit entry in adminAccess.js`);
  }
  assert.ok(!/PAYROLL_SUB_PERMISSION/.test(sidebar), 'the sidebar must not keep a second permission map');
});
t('an employee with no admin permissions sees no admin module', () => {
  for (const p of itemPaths.filter(x => !['/profile', '/notifications'].includes(x))) assert.ok(!can([], p) || p === '/profile', `${p} visible with no permissions`);
});

console.log('\nWIRING (App / Login / layouts)');
t('login sends employees through HomeRedirect, which waits for permissions and honours the custom landing page', () => {
  const login = read('pages/Login.jsx'), app = read('App.jsx');
  assert.ok(/user\.role === 'employee'\) navigate\('\/'\)/.test(login), 'Login must not hard-code /portal/home for employees');
  assert.ok(/function HomeRedirect[\s\S]*permissionsReady[\s\S]*hasCustomAccess[\s\S]*adminLanding/.test(app));
  assert.ok(/<Route path="\/login"\s+element=\{token \? <HomeRedirect/.test(app));
});
t('the admin-shell route guard blocks a custom-role user from unpermitted URLs and sends them to their landing page', () => {
  const app = read('App.jsx');
  assert.ok(/canAccessAdminPath\(customPermissions, pathname\)\) return <Navigate to=\{adminLanding\}/.test(app));
  assert.ok(/if \(!hasCustomAccess\) return <Navigate to="\/portal\/home"/.test(app), 'no admin permissions ⇒ employee portal');
});
t('the employee portal keeps working for custom-role users (My Workspace / Admin Modules link)', () => {
  assert.ok(/hasCustomAccess[\s\S]*Admin Modules/.test(read('components/layout/EmployeeLayout.jsx')));
  assert.ok(/MY_WORKSPACE_ITEMS/.test(sidebar));
});
t('payroll action buttons are gated by permission (generate, verify/approve …), not by role alone', () => {
  assert.ok(/adminCan\('payroll', 'generate'\)/.test(read('pages/PayrollGeneration.jsx')));
  const run = read('pages/PayrollRunDetails.jsx');
  assert.ok(/customCan\('payroll', action\)/.test(run) && /adminCan\('payroll', 'verify'\)/.test(run));
});

console.log('\n────────────────────────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
console.log('\n✅  All client custom-role access checks passed.');
