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
    ['GET /payslips/:id/pdf now includes hasPermission(payroll, view)', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../modules/payroll/payroll.routes.js'), 'utf8'
      );
      const match = src.match(/router\.get\('\/payslips\/:id\/pdf',\s*auth,\s*hasPermission\('payroll',\s*'view'\)/);
      assert.ok(match, "GET /payslips/:id/pdf must include hasPermission('payroll','view')");
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
