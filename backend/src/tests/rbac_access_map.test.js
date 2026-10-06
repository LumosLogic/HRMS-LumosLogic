/**
 * rbac_access_map.test.js — RBAC Phase 4 (custom roles control access): static + unit checks. No database.
 *
 *   • every permission named in the backend access map / client admin map really exists in the catalog
 *   • elevation rules: only an `employee` account, only via CUSTOM-role grants, only on mapped / admin-grade routes
 *   • System roles (root_admin, admin) are never touched
 *   • the Employee system role's self-service grants never elevate on their own
 *   • routes that must stay closed to custom roles are not mapped
 *
 * Run with: node src/tests/rbac_access_map.test.js
 */
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'access-map-test';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

// ── permission service stub: custom grants per user id ───────────────────────────────────
const CUSTOM = {};
const permPath = require.resolve('../services/permissionService');
const real = require(permPath);
require.cache[permPath].exports = {
  ...real,
  resolveCustomPermissions: async (userId) => CUSTOM[userId] || [],
};
const { requiredPermissions, ENTRIES } = require('../middleware/accessMap');
const { elevateForPermissions, applyAccessMap } = require('../middleware/effectiveAccess');

const req = (role, id, method, url) => ({ method, originalUrl: url, user: { id, role, organization_id: 1 } });

(async () => {
  console.log('\nCATALOG');
  const catalog = new Set();
  const migDir = path.join(__dirname, '../../migrations');
  for (const f of fs.readdirSync(migDir).filter(x => x.endsWith('.sql')))
    for (const m of fs.readFileSync(path.join(migDir, f), 'utf8').matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*,\s*'/g)) catalog.add(`${m[1]}.${m[2]}`);
  await t('every permission in the backend access map exists in the permission catalog', () => {
    const missing = ENTRIES.flatMap(e => (Array.isArray(e[2]) ? e[2] : [e[2]])).filter(p => !catalog.has(p));
    assert.deepStrictEqual([...new Set(missing)], []);
  });
  await t('every permission in the client admin-shell map exists in the permission catalog', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../client/src/lib/adminAccess.js'), 'utf8');
    const block = src.slice(src.indexOf('ADMIN_PATH_PERMISSIONS = ['), src.indexOf('];', src.indexOf('ADMIN_PATH_PERMISSIONS = [')));
    const perms = [...block.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]);
    assert.ok(perms.length > 20);
    assert.deepStrictEqual([...new Set(perms.filter(p => !catalog.has(p)))], []);
  });

  console.log('\nMAP SHAPE (fail closed)');
  await t('listed routes resolve; look-alike and unlisted routes do not', () => {
    assert.deepStrictEqual(requiredPermissions('GET', '/api/leaves?status=pending'), ['leaves.view']);
    assert.deepStrictEqual(requiredPermissions('PUT', '/api/leaves/42/approve'), ['leaves.approve']);
    assert.deepStrictEqual(requiredPermissions('GET', '/api/leaves/counts'), ['leaves.view']);       // static route wins over /:id
    assert.strictEqual(requiredPermissions('GET', '/api/leaves/notanid'), null);                     // ids are digits only
    for (const [m, u] of [['POST', '/api/leaves'], ['GET', '/api/roles'], ['POST', '/api/roles'], ['PUT', '/api/roles/1/permissions'],
      ['GET', '/api/admin'], ['POST', '/api/payroll/runs/1/approve'], ['GET', '/api/pending-approvals'], ['GET', '/api/root/x'],
      ['POST', '/api/leaves/1/final-approve']])
      assert.strictEqual(requiredPermissions(m, u), null, `${m} ${u} must stay closed`);
  });
  await t('profile sub-resources: reads need employees.view, sensitive reads and writes need employees.edit', () => {
    assert.deepStrictEqual(requiredPermissions('GET', '/api/profile/7/family'), ['employees.view']);
    assert.deepStrictEqual(requiredPermissions('GET', '/api/profile/7/banking'), ['employees.edit']);
    assert.deepStrictEqual(requiredPermissions('PUT', '/api/profile/7/family'), ['employees.edit']);
    assert.strictEqual(requiredPermissions('GET', '/api/profile/me'), null);
  });

  console.log('\nELEVATION RULES');
  await t('employee + custom grant on a mapped route → processed as admin (stored role and baseRole preserved)', async () => {
    CUSTOM[10] = ['leaves.approve'];
    const r = req('employee', 10, 'PUT', '/api/leaves/5/approve');
    assert.strictEqual(await applyAccessMap(r), true);
    assert.strictEqual(r.user.role, 'admin'); assert.strictEqual(r.user.baseRole, 'employee'); assert.strictEqual(r.user.elevated, true);
  });
  await t('a grant that does not cover the route does not elevate', async () => {
    CUSTOM[11] = ['leaves.view'];
    const r = req('employee', 11, 'PUT', '/api/leaves/5/approve');
    assert.strictEqual(await applyAccessMap(r), false); assert.strictEqual(r.user.role, 'employee');
  });
  await t('an employee with NO custom role is never elevated (system Employee grants do not count)', async () => {
    const r = req('employee', 12, 'GET', '/api/leaves');
    assert.strictEqual(await applyAccessMap(r), false); assert.strictEqual(r.user.role, 'employee');
  });
  await t('HR Admin and Root Admin are never modified', async () => {
    CUSTOM[1] = ['leaves.approve']; CUSTOM[2] = ['leaves.approve'];
    for (const role of ['admin', 'root_admin']) {
      const r = req(role, role === 'admin' ? 1 : 2, 'PUT', '/api/leaves/5/approve');
      assert.strictEqual(await applyAccessMap(r), false); assert.strictEqual(r.user.role, role); assert.strictEqual(r.user.elevated, undefined);
    }
  });
  await t('hasPermission-routes: admin-grade custom grants elevate; self-service grants alone do not', async () => {
    CUSTOM[20] = ['documents.upload', 'performance.create'];
    const a = req('employee', 20, 'POST', '/api/documents/upload');
    assert.strictEqual(await elevateForPermissions(a, [['documents', 'upload']]), false);
    assert.strictEqual(a.user.role, 'employee');
    CUSTOM[21] = ['payroll.generate'];
    const b = req('employee', 21, 'POST', '/api/payroll/generate');
    assert.strictEqual(await elevateForPermissions(b, [['payroll', 'generate']]), true);
    assert.strictEqual(b.user.role, 'admin');
  });
  await t('a failing permission lookup never elevates and never throws', async () => {
    require.cache[permPath].exports.resolveCustomPermissions = async () => { throw new Error('db down'); };
    const r = req('employee', 30, 'GET', '/api/leaves');
    const orig = console.error; console.error = () => {};
    try { assert.strictEqual(await applyAccessMap(r), false); assert.strictEqual(await elevateForPermissions(r, [['payroll', 'view']]), false); }
    finally { console.error = orig; }
    assert.strictEqual(r.user.role, 'employee');
  });

  console.log('\nWIRING');
  await t('auth() applies the access map for employee tokens; hasPermission middlewares elevate; branch scope follows the REAL role', () => {
    const rd = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
    assert.ok(/decoded\.role === 'employee'[\s\S]{0,200}applyAccessMap\(req\)/.test(rd('../middleware/auth.js')));
    const perms = rd('../middleware/permissions.js');
    assert.strictEqual((perms.match(/elevateForPermissions\(req/g) || []).length, 3, 'hasPermission, hasAnyPermission, hasPermissionOrLegacyAdmin');
    const branch = rd('../services/branchService.js');
    assert.ok(/SELECT role FROM users WHERE id = \$1 AND organization_id = \$2/.test(branch) && /real\.rows\[0\]\.role !== 'admin'/.test(branch),
      'an elevated request must still resolve branch access from users.role');
  });
  await t('only the stored admin role is resolved through hr_branch_access (custom-role employees stay bound to their own branch)', () => {
    const branch = fs.readFileSync(path.join(__dirname, '../services/branchService.js'), 'utf8');
    assert.ok(branch.indexOf("if (role !== 'admin')") > branch.indexOf('real.rows[0].role'), 'role is normalised before the employee/admin split');
  });

  console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
  console.log('\n✅  All access-map checks passed.\n');
  process.exit(0);
})();
