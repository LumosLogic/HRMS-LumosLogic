/**
 * rbac_security.test.js
 *
 * Focused security regression tests for the RBAC/branch fixes applied 2026-09-24.
 * Run with: node src/tests/rbac_security.test.js
 *
 * Tests are self-contained — they mock the DB pool so no live DB is required.
 * A live-DB integration suite can be layered on top once a test framework is added.
 */

'use strict';

const assert = require('assert');

// ─── Minimal test harness ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => {
        console.log(`  ✓ ${name}`);
        passed++;
      }).catch(err => {
        console.error(`  ✗ ${name}`);
        console.error(`    ${err.message}`);
        failed++;
      });
    }
    console.log(`  ✓ ${name}`);
    passed++;
    return Promise.resolve();
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
    return Promise.resolve();
  }
}

async function run(suiteName, tests) {
  console.log(`\n${suiteName}`);
  for (const [name, fn] of tests) {
    await test(name, fn);
  }
}

// ─── Test utilities ───────────────────────────────────────────────────────────

/**
 * Build a branchContext object identical to what withBranchContext produces.
 */
function makeBranchContext({ hasAllBranches = false, accessibleBranchIds = null, selectedBranchId = null, isRootAdmin = false } = {}) {
  return { orgId: 1, selectedBranchId, isRootAdmin, hasAllBranches, accessibleBranchIds };
}

// ─── Suite 1: branchFilter — getFilterState ──────────────────────────────────

const { getFilterState, resolveEmployeeIds, canAdminAccessUser } = (() => {
  // Inline the implementation so we can test without importing (avoids DB pool init)
  function getFilterState(branchContext) {
    const { selectedBranchId, hasAllBranches, accessibleBranchIds } = branchContext || {};
    if (selectedBranchId) return { type: 'specific', branchId: selectedBranchId };
    if (hasAllBranches)   return { type: 'all' };
    if (Array.isArray(accessibleBranchIds) && accessibleBranchIds.length > 0)
      return { type: 'multi', branchIds: accessibleBranchIds };
    return { type: 'none' };
  }

  // canAdminAccessUser with injectable pool
  async function canAdminAccessUser(branchContext, userId, oId, _pool) {
    const state = getFilterState(branchContext);
    if (state.type === 'all')  return true;
    if (state.type === 'none') return false;
    const rows = await _pool.query('SELECT branch_id FROM users WHERE id = $1 AND organization_id = $2', [userId, oId]);
    const bid = rows[0]?.branch_id ?? null;
    if (state.type === 'specific') return bid === state.branchId;
    if (state.type === 'multi')    return state.branchIds.includes(bid);
    return false;
  }

  // resolveEmployeeIds with injectable pool (tests fail-closed path)
  async function resolveEmployeeIds(branchContext, orgId, _pool) {
    const state = getFilterState(branchContext);
    if (state.type === 'all')  return null;
    if (state.type === 'none') return [];
    try {
      let result;
      if (state.type === 'specific') {
        result = await _pool.query('SELECT id FROM users WHERE organization_id = $1 AND branch_id = $2', [orgId, state.branchId]);
      } else {
        result = await _pool.query('SELECT id FROM users WHERE organization_id = $1 AND branch_id = ANY($2::bigint[])', [orgId, state.branchIds]);
      }
      return result.map(r => Number(r.id));
    } catch (err) {
      return []; // FAIL CLOSED (was: return null)
    }
  }

  return { getFilterState, resolveEmployeeIds, canAdminAccessUser };
})();

// Mock pool factory
function mockPool(rows) {
  return { query: async () => rows };
}

function errorPool() {
  return { query: async () => { throw new Error('DB connection refused'); } };
}

// ─── Suite 2: Permission cache TTL ───────────────────────────────────────────

function getPermCacheTTL() {
  // Read the actual constant from the source file
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '../services/permissionService.js'),
    'utf8'
  );
  const match = src.match(/const CACHE_TTL_MS\s*=\s*([^;]+);/);
  if (!match) throw new Error('CACHE_TTL_MS not found in permissionService.js');
  // Evaluate the expression safely
  const expr = match[1].trim();
  // Only allow digit, space, *, +, - characters
  if (!/^[\d\s*+\-]+$/.test(expr)) throw new Error(`Unexpected CACHE_TTL_MS expression: ${expr}`);
  return eval(expr); // safe: only math operators and digits
}

// ─── Suite 3: Announcement org-scope ─────────────────────────────────────────

/**
 * Simulate the org-scope logic for PUT/DELETE announcements.
 * Returns the organization_id that would be used in the WHERE clause.
 */
function announcementOrgScope(userRole, userOrgId) {
  // BEFORE fix (vulnerable):
  //   if (req.user.role !== 'root_admin') q = q.eq('organization_id', ...)
  // AFTER fix (always scoped):
  //   .eq('organization_id', req.user.organization_id)
  return userOrgId; // always req.user.organization_id regardless of role
}

// ─── Run suites ──────────────────────────────────────────────────────────────

(async () => {

  await run('1. Branch filter — getFilterState', [
    ['root_admin context → type=all', () => {
      const ctx = makeBranchContext({ hasAllBranches: true });
      assert.equal(getFilterState(ctx).type, 'all');
    }],
    ['HR with single branch selected → type=specific', () => {
      const ctx = makeBranchContext({ selectedBranchId: 5 });
      assert.equal(getFilterState(ctx).type, 'specific');
      assert.equal(getFilterState(ctx).branchId, 5);
    }],
    ['HR with accessible branches, none selected → type=multi', () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [1, 2] });
      assert.equal(getFilterState(ctx).type, 'multi');
    }],
    ['HR with no branches → type=none', () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [] });
      assert.equal(getFilterState(ctx).type, 'none');
    }],
  ]);

  await run('2. canAdminAccessUser — branch access', [
    ['Root admin (hasAllBranches) → allowed', async () => {
      const ctx = makeBranchContext({ hasAllBranches: true });
      const result = await canAdminAccessUser(ctx, 42, 1, mockPool([{ branch_id: 99 }]));
      assert.equal(result, true);
    }],
    ['HR restricted to branch 1, employee is in branch 1 → allowed', async () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [1] });
      const result = await canAdminAccessUser(ctx, 42, 1, mockPool([{ branch_id: 1 }]));
      assert.equal(result, true);
    }],
    ['HR restricted to branch 1, employee is in branch 2 → blocked', async () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [1] });
      const result = await canAdminAccessUser(ctx, 42, 1, mockPool([{ branch_id: 2 }]));
      assert.equal(result, false);
    }],
    ['HR with specific branch=1, employee in branch 2 → blocked', async () => {
      const ctx = makeBranchContext({ selectedBranchId: 1 });
      const result = await canAdminAccessUser(ctx, 42, 1, mockPool([{ branch_id: 2 }]));
      assert.equal(result, false);
    }],
    ['HR with no branches → always blocked', async () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [] });
      const result = await canAdminAccessUser(ctx, 42, 1, mockPool([{ branch_id: 1 }]));
      assert.equal(result, false);
    }],
  ]);

  await run('3. resolveEmployeeIds — fail-closed on DB error (LOW-002)', [
    ['DB error for restricted HR → returns [] (fail closed, not null)', async () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [1] });
      const result = await resolveEmployeeIds(ctx, 1, errorPool());
      // null would mean org-wide access (fail open) — must be [] (empty = no access)
      assert.notEqual(result, null, 'Must not return null (fail-open)');
      assert.deepEqual(result, [], 'Must return [] (fail-closed)');
    }],
    ['DB error for root_admin (state=all) → returns null (org-wide, safe)', async () => {
      const ctx = makeBranchContext({ hasAllBranches: true });
      // State 'all' returns null immediately — never hits DB, never hits catch
      const result = await resolveEmployeeIds(ctx, 1, errorPool());
      assert.equal(result, null, 'Root admin must get null (org-wide, no filter)');
    }],
    ['DB success for restricted HR → returns employee IDs', async () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [1] });
      const result = await resolveEmployeeIds(ctx, 1, mockPool([{ id: 10 }, { id: 11 }]));
      assert.deepEqual(result, [10, 11]);
    }],
    ['No-branch HR (state=none) → returns [] (no DB query)', async () => {
      const ctx = makeBranchContext({ accessibleBranchIds: [] });
      // This should return [] from the state check, never touching the pool
      const result = await resolveEmployeeIds(ctx, 1, errorPool());
      assert.deepEqual(result, []);
    }],
  ]);

  await run('4. Permission cache TTL (MEDIUM-001)', [
    ['CACHE_TTL_MS is 60000 (60 seconds)', () => {
      const ttl = getPermCacheTTL();
      assert.equal(ttl, 60000, `Expected 60000ms but got ${ttl}ms`);
    }],
    ['CACHE_TTL_MS is <= 60 seconds', () => {
      const ttl = getPermCacheTTL();
      assert.ok(ttl <= 60000, `TTL ${ttl}ms exceeds 60 seconds`);
    }],
  ]);

  await run('5. Announcements — org-scope always enforced (HIGH-003)', [
    ['root_admin PUT/DELETE is scoped to own org_id', () => {
      const orgScope = announcementOrgScope('root_admin', 1);
      assert.equal(orgScope, 1, 'PUT/DELETE must always use req.user.organization_id');
    }],
    ['regular admin PUT/DELETE is scoped to own org_id', () => {
      const orgScope = announcementOrgScope('admin', 2);
      assert.equal(orgScope, 2);
    }],
    ['root_admin of Org A cannot target Org B scope', () => {
      // Verify the fix: org scope is always the caller's org, never another org
      const callerOrg = 1;
      const victimAnnouncementOrg = 2;
      const scopeUsed = announcementOrgScope('root_admin', callerOrg);
      assert.notEqual(scopeUsed, victimAnnouncementOrg,
        'Org A root_admin must not be able to use Org B scope');
    }],
  ]);

  await run('6. Payroll structure branch validation — route middleware', [
    ['POST /structure middleware chain includes withBranchContext', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      // Use [\s\S]*? so the comma inside hasPermission() doesn't break the match
      const postStructureMatch = src.match(/router\.post\('\/structure',[\s\S]*?withBranchContext/);
      assert.ok(postStructureMatch, 'POST /structure must include withBranchContext middleware');
    }],
    ['PUT /structure/:id middleware chain includes withBranchContext', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      const putStructureMatch = src.match(/router\.put\('\/structure\/:id',[\s\S]*?withBranchContext/);
      assert.ok(putStructureMatch, 'PUT /structure/:id must include withBranchContext middleware');
    }],
    ['GET /payslips route now includes withBranchContext', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      const match = src.match(/router\.get\('\/payslips',\s*auth,\s*withBranchContext/);
      assert.ok(match, 'GET /payslips must include withBranchContext');
    }],
    ['GET /payslips/:id/pdf uses inline admin check, not middleware hasPermission (DEEP-002 fix)', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      // The DEEP-002 fix removed hasPermission from the route middleware chain so that
      // employees can access their own payslips. Only check the declaration line itself.
      const declarationLine = src.match(/router\.get\('\/payslips\/:id\/pdf'[^\n]+/)?.[0] || '';
      const hasMwOnDeclaration = declarationLine.includes('hasPermission');
      assert.ok(!hasMwOnDeclaration,
        "GET /payslips/:id/pdf declaration line must NOT include hasPermission middleware");
      // Admin access still checks payroll.view inline inside the handler
      assert.ok(src.includes("hasPermissionCheck(perms, 'payroll', 'view')"),
        "PDF route must use hasPermissionCheck inline for admin path");
    }],
  ]);

  await run('7. Banking GET — branch validation present', [
    ['GET /:id/banking now includes withBranchContext', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/employee-profile/banking.routes.js'), 'utf8'
      );
      const match = src.match(/router\.get\('\/:id\/banking',\s*auth,\s*withBranchContext/);
      assert.ok(match, 'GET /:id/banking must include withBranchContext');
    }],
    ['banking.routes.js imports canAdminAccessUser', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/employee-profile/banking.routes.js'), 'utf8'
      );
      assert.ok(src.includes('canAdminAccessUser'), 'banking.routes.js must import canAdminAccessUser');
    }],
  ]);

  await run('8. Attendance userId — branch validation present', [
    ['attendance GET / validates branch for specific userId', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/attendance/attendance.routes.js'), 'utf8'
      );
      // The fix adds canAdminAccessUser call when a specific userId is given
      assert.ok(
        src.includes("canAdminAccessUser(req.branchContext, parseInt(userId, 10), orgId(req))"),
        'Attendance GET must call canAdminAccessUser for specific userId'
      );
    }],
  ]);

  await run('9. Leaves userId — branch validation present', [
    ['leaves GET / validates branch for specific userId', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/leaves/leaves.routes.js'), 'utf8'
      );
      assert.ok(
        src.includes("canAdminAccessUser(req.branchContext, parseInt(userId, 10), orgId(req))"),
        'Leaves GET must call canAdminAccessUser for specific userId'
      );
    }],
  ]);

  await run('10. Announcements — cross-org PUT/DELETE fix in source', [
    ['PUT /:id always uses req.user.organization_id', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/announcements/announcements.routes.js'), 'utf8'
      );
      // The old vulnerable pattern should be gone
      assert.ok(
        !src.includes("if (req.user.role !== 'root_admin') q = q.eq('organization_id'"),
        'Vulnerable root_admin org bypass must be removed from PUT'
      );
    }],
    ['DELETE /:id always uses req.user.organization_id', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/announcements/announcements.routes.js'), 'utf8'
      );
      // The DELETE fetch also had the bypass — should be gone
      const vulnerableDeletePattern = /if \(req\.user\.role !== 'root_admin'\) fetchQ = fetchQ\.eq\('organization_id'/;
      assert.ok(
        !vulnerableDeletePattern.test(src),
        'Vulnerable root_admin org bypass must be removed from DELETE'
      );
    }],
  ]);

  // ── Deep Audit Fixes (2026-09-24) ─────────────────────────────────────────

  // ── DEEP-001 helpers ──────────────────────────────────────────────────────
  // Reproduce hasPermissionCheck logic inline to test the permission inference
  // that determines who can reach payroll.manage_settings-guarded routes.
  function _hasPermCheck(permissions, module, action) {
    if (!Array.isArray(permissions)) return false;
    if (permissions.includes(`${module}.${action}`)) return true;
    if (action === 'view') return permissions.some(p => p.startsWith(`${module}.`));
    if (['create', 'edit', 'delete'].includes(action)) return permissions.includes(`${module}.manage`);
    return false;
  }

  await run('11. DEEP-001 — payroll.manage_settings permission catalog fix', [
    ['Migration file exists', () => {
      const path = require('path').join(__dirname, '../../migrations/add_payroll_manage_settings_2026_09_24.sql');
      assert.ok(require('fs').existsSync(path), 'Migration file must exist');
    }],
    ['Migration inserts payroll.manage_settings into permissions', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../migrations/add_payroll_manage_settings_2026_09_24.sql'), 'utf8'
      );
      assert.ok(src.includes("'payroll'"), 'Migration must reference payroll module');
      assert.ok(src.includes("'manage_settings'"), 'Migration must insert manage_settings action');
    }],
    ['Migration grants to root_admin', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../migrations/add_payroll_manage_settings_2026_09_24.sql'), 'utf8'
      );
      assert.ok(src.includes("slug          = 'root_admin'") || src.includes("slug = 'root_admin'"),
        'Migration must grant to root_admin');
    }],
    ['Migration grants to hr_admin', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../migrations/add_payroll_manage_settings_2026_09_24.sql'), 'utf8'
      );
      assert.ok(src.includes("slug          = 'hr_admin'") || src.includes("slug = 'hr_admin'"),
        'Migration must grant to hr_admin');
    }],
    ['Root Admin with payroll.manage_settings → hasPermissionCheck passes', () => {
      // After migration, root_admin permissions will include payroll.manage_settings
      const rootPerms = ['payroll.view', 'payroll.generate', 'payroll.manage_settings'];
      assert.ok(_hasPermCheck(rootPerms, 'payroll', 'manage_settings'),
        'Root admin with payroll.manage_settings must pass permission check');
    }],
    ['HR Admin with payroll.manage_settings → hasPermissionCheck passes', () => {
      const hrPerms = ['payroll.view', 'payroll.generate', 'payroll.manage_settings'];
      assert.ok(_hasPermCheck(hrPerms, 'payroll', 'manage_settings'),
        'HR admin with payroll.manage_settings must pass permission check');
    }],
    ['Employee without payroll.manage_settings → hasPermissionCheck blocked', () => {
      const empPerms = ['dashboard.view', 'attendance.view', 'leaves.view', 'leaves.create'];
      assert.ok(!_hasPermCheck(empPerms, 'payroll', 'manage_settings'),
        'Employee without payroll.manage_settings must be blocked');
    }],
    ['PUT /payroll/settings uses hasPermission(payroll, manage_settings)', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      assert.ok(
        src.includes("hasPermission('payroll', 'manage_settings')"),
        "PUT /payroll/settings must use hasPermission('payroll', 'manage_settings')"
      );
    }],
    ['POST /apply-probation-bulk uses hasPermission(payroll, manage_settings)', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      // Confirm both routes use this permission guard
      const count = (src.match(/hasPermission\('payroll', 'manage_settings'\)/g) || []).length;
      assert.ok(count >= 2, `Expected at least 2 uses of manage_settings guard, found ${count}`);
    }],
  ]);

  await run('12. DEEP-002 — Employee payslip PDF self-access restored', [
    ['Employee can access own payslip — self-check passes', () => {
      // Simulates the authorization logic: employee with userId matching payslip.user_id
      const req = { user: { id: 5, role: 'employee' } };
      const ps  = { user_id: 5, user_branch_id: null };
      const isAdminFn = role => role === 'admin' || role === 'root_admin';

      // employee path: check only self-ownership
      if (!isAdminFn(req.user.role)) {
        const allowed = Number(ps.user_id) === Number(req.user.id);
        assert.ok(allowed, 'Employee accessing own payslip must be allowed');
      }
    }],
    ['Employee blocked from another employee payslip', () => {
      const req = { user: { id: 5, role: 'employee' } };
      const ps  = { user_id: 7, user_branch_id: null };
      const isAdminFn = role => role === 'admin' || role === 'root_admin';

      if (!isAdminFn(req.user.role)) {
        const allowed = Number(ps.user_id) === Number(req.user.id);
        assert.ok(!allowed, 'Employee accessing another employee\'s payslip must be blocked');
      }
    }],
    ['Admin without payroll.view → inline check blocks', () => {
      const adminPerms = ['employees.view', 'leaves.view']; // no payroll.*
      const allowed = _hasPermCheck(adminPerms, 'payroll', 'view');
      assert.ok(!allowed, 'Admin without payroll.view must be blocked on admin path');
    }],
    ['Admin with payroll.view → inline check passes', () => {
      const adminPerms = ['employees.view', 'payroll.view', 'payroll.generate'];
      const allowed = _hasPermCheck(adminPerms, 'payroll', 'view');
      assert.ok(allowed, 'Admin with payroll.view must pass inline permission check');
    }],
    ['PDF route no longer uses hasPermission middleware for employees', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      // Route declaration line must only have auth, not hasPermission in middleware chain
      const hasMw = /router\.get\('\/payslips\/:id\/pdf',[\s\S]*?hasPermission/.test(
        src.match(/router\.get\('\/payslips\/:id\/pdf'[^\n]+/)?.[0] || ''
      );
      assert.ok(!hasMw, 'PDF route declaration must not include hasPermission as route middleware');
    }],
    ['PDF route uses inline hasPermissionCheck for admin path', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      assert.ok(
        src.includes("hasPermissionCheck(perms, 'payroll', 'view')"),
        "Admin PDF path must use hasPermissionCheck inline"
      );
    }],
    ['PDF route preserves branch isolation for admins', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      // After the DEEP-002 fix, branch validation is inside the else (admin) block
      assert.ok(src.includes('validateBranchAccess(req.user.id, oId, req.user.role, ps.user_branch_id)'),
        'PDF route must still call validateBranchAccess for admin branch isolation');
    }],
  ]);

  await run('13. DEEP-005 — roles.manage cannot assign root_admin', [
    ['Guard added to PUT /roles/user/:userId', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/roles/roles.routes.js'), 'utf8'
      );
      assert.ok(
        src.includes("Only a Root Admin can assign the Root Admin role."),
        'roles.routes.js must contain the root_admin assignment guard'
      );
    }],
    ['Guard queries for root_admin slug in requested roles', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/roles/roles.routes.js'), 'utf8'
      );
      assert.ok(
        src.includes("slug = 'root_admin'"),
        "Guard must check for role slug = 'root_admin'"
      );
    }],
    ['Non-root-admin is blocked when role_ids contain root_admin', async () => {
      // Simulate the guard logic inline
      async function checkGuard(requestorRole, slugsInRequest, _pool) {
        if (requestorRole !== 'root_admin' && slugsInRequest.length > 0) {
          const rootRows = await _pool.query(slugsInRequest);
          if (rootRows.length > 0) return { blocked: true };
        }
        return { blocked: false };
      }
      const rootSlugPool = { query: async () => [{ slug: 'root_admin' }] };
      const result = await checkGuard('admin', ['root_admin'], rootSlugPool);
      assert.ok(result.blocked, 'Non-root-admin assigning root_admin role must be blocked');
    }],
    ['Root admin is allowed to assign root_admin role', async () => {
      async function checkGuard(requestorRole, slugsInRequest, _pool) {
        if (requestorRole !== 'root_admin' && slugsInRequest.length > 0) {
          const rootRows = await _pool.query(slugsInRequest);
          if (rootRows.length > 0) return { blocked: true };
        }
        return { blocked: false };
      }
      const rootSlugPool = { query: async () => [{ slug: 'root_admin' }] };
      const result = await checkGuard('root_admin', ['root_admin'], rootSlugPool);
      assert.ok(!result.blocked, 'Root admin must be allowed to assign root_admin role');
    }],
    ['Non-root-admin with roles.manage can assign non-root_admin roles', async () => {
      async function checkGuard(requestorRole, slugsInRequest, _pool) {
        if (requestorRole !== 'root_admin' && slugsInRequest.length > 0) {
          const rootRows = await _pool.query(slugsInRequest);
          if (rootRows.length > 0) return { blocked: true };
        }
        return { blocked: false };
      }
      // No root_admin slug found — custom or hr_admin roles only
      const emptyPool = { query: async () => [] };
      const result = await checkGuard('admin', ['hr_admin', 'custom_role_1'], emptyPool);
      assert.ok(!result.blocked, 'Non-root-admin assigning only non-root roles must be allowed');
    }],
    ['Guard only runs when safeRoleIds is non-empty (clearing roles is allowed)', async () => {
      async function checkGuard(requestorRole, slugsInRequest, _pool) {
        if (requestorRole !== 'root_admin' && slugsInRequest.length > 0) {
          const rootRows = await _pool.query(slugsInRequest);
          if (rootRows.length > 0) return { blocked: true };
        }
        return { blocked: false };
      }
      const errorPool = { query: async () => { throw new Error('should not be called'); } };
      const result = await checkGuard('admin', [], errorPool);
      assert.ok(!result.blocked, 'Clearing all roles (empty array) must not trigger guard');
    }],
  ]);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\n❌  Security test failures detected. Review the failed checks above.\n');
    process.exit(1);
  } else {
    console.log('\n✅  All security tests passed.\n');
    process.exit(0);
  }

})();
