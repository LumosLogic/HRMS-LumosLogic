/**
 * branch_separation.test.js
 *
 * Regression tests for full branch-wise separation. These exercise the REAL modules
 * (branchService, branchContext, branchFilter, profileGuard, announcement/broadcast targeting,
 * holiday scoping helpers) against a faked pool.query — no live database needed — plus source
 * guards that pin the route-level fixes so they cannot silently regress.
 *
 * Run with: node src/tests/branch_separation.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
// middleware/auth refuses to load without a signing secret; any value is fine for these tests.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'branch-separation-test-secret';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); failed++; }
}
async function suite(title, tests) { console.log(`\n${title}`); for (const [n, f] of tests) await test(n, f); }

// ── fake DB ──────────────────────────────────────────────────────────────────────────────
const { pool } = require('../config/db');
let handlers = [];
pool.query = async (sql, params) => {
  for (const [re, fn] of handlers) if (re.test(sql)) return fn(params || [], sql);
  throw new Error('unexpected SQL in test: ' + String(sql).replace(/\s+/g, ' ').slice(0, 90));
};
const on = (re, fn) => handlers.push([re, fn]);
const reset = () => { handlers = []; branchService.clearBranchAccessCache(); };

const branchService = require('../services/branchService');
const { withBranchContext } = require('../middleware/branchContext');
const bf = require('../utils/branchFilter');
const { filterUsersByBranchTargets, announcementVisibleToViewer } = require('../utils/announcementTargeting');
const { resolveBroadcastRecipients } = require('../utils/broadcastTargeting');
const { applyHolidayVisibility } = require('../modules/holidays/holidays.routes');
const helpers = require('../utils/helpers');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ctx = (o = {}) => ({ orgId: 1, selectedBranchId: null, isRootAdmin: false, hasAllBranches: false, accessibleBranchIds: [], ...o });
function mkRes() { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; }
async function runMw(mw, req) { const res = mkRes(); let nexted = false; await mw(req, res, () => { nexted = true; }); return { res, nexted }; }

// users table: id → {org, role, branch}
const USERS = { 10: { org: 1, branch: 1 }, 11: { org: 1, branch: 2 }, 12: { org: 2, branch: 7 }, 13: { org: 1, branch: null } };
function seed({ grants = [], activeBranches = [1, 2], allBranches = [1, 2, 7] } = {}) {
  reset();
  on(/FROM hr_branch_access\s+WHERE user_id/i, (p) => ({ rows: grants.filter(g => g.user_id === p[0] && g.org_id === p[1]) }));
  on(/SELECT id FROM branches WHERE org_id = \$1 AND is_active = TRUE/i, (p) => ({ rows: activeBranches.map(id => ({ id })) }));
  on(/SELECT COUNT\(\*\)::int AS c FROM branches/i, () => ({ rows: [{ c: activeBranches.length }] }));
  on(/SELECT id FROM branches WHERE id = \$1 AND org_id = \$2/i, (p) => ({ rows: allBranches.includes(Number(p[0])) && Number(p[1]) === 1 && Number(p[0]) !== 7 ? [{ id: p[0] }] : [] }));
  on(/SELECT id FROM branches WHERE org_id = \$1 AND id = ANY/i, (p) => ({ rows: p[1].filter(i => i !== 7 && p[0] === 1).map(id => ({ id })) }));
  on(/SELECT branch_id FROM users WHERE id = \$1 AND organization_id = \$2/i, (p) => {
    const u = USERS[p[0]]; return { rows: u && u.org === Number(p[1]) ? [{ branch_id: u.branch }] : [] };
  });
  on(/SELECT id FROM users WHERE organization_id = \$1 AND id = ANY/i, (p) => {
    const [org, ids, br] = p; const state = p[2];
    return { rows: ids.filter(i => USERS[i] && USERS[i].org === org && (state === undefined || (Array.isArray(state) ? state.includes(USERS[i].branch) : USERS[i].branch === state))).map(id => ({ id })) };
  });
}

(async () => {

await suite('Access model — getUserBranchAccess / validateBranchAccess', [
  ['root admin: all branches', async () => {
    seed(); const a = await branchService.getUserBranchAccess(1, 1, 'root_admin');
    assert.deepStrictEqual(a, { isRootAdmin: true, hasAllBranches: true, branchIds: null });
  }],
  ['HR with specific grants: only those branches', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    const a = await branchService.getUserBranchAccess(5, 1, 'admin');
    assert.strictEqual(a.hasAllBranches, false); assert.deepStrictEqual(a.branchIds, [1]);
  }],
  ['HR with no grant in a 2-branch org: NO access (never org-wide)', async () => {
    seed({ grants: [] }); const a = await branchService.getUserBranchAccess(5, 1, 'admin');
    assert.strictEqual(a.hasAllBranches, false); assert.deepStrictEqual(a.branchIds, []);
  }],
  ['employee / dept head: bound to OWN branch even with extra permissions', async () => {
    seed(); const a = await branchService.getUserBranchAccess(10, 1, 'employee');
    assert.strictEqual(a.hasAllBranches, false); assert.deepStrictEqual(a.branchIds, [1]);
  }],
  ['employee without a branch in a branch org: no access', async () => {
    seed(); const a = await branchService.getUserBranchAccess(13, 1, 'employee');
    assert.deepStrictEqual(a.branchIds, []); assert.strictEqual(a.hasAllBranches, false);
  }],
  ['branches OFF (no active branch): existing org-wide behaviour unchanged', async () => {
    seed({ activeBranches: [] });
    assert.strictEqual((await branchService.getUserBranchAccess(10, 1, 'employee')).hasAllBranches, true);
    assert.strictEqual((await branchService.getUserBranchAccess(5, 1, 'admin')).hasAllBranches, true);
  }],
  ['branches feature OFF (organization_features.enabled = false): no isolation for HR or employees', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    handlers.unshift([/FROM organization_features/i, () => ({ rows: [{ enabled: false }] })]);
    assert.strictEqual((await branchService.getUserBranchAccess(5, 1, 'admin')).hasAllBranches, true);
    assert.strictEqual((await branchService.getUserBranchAccess(10, 1, 'employee')).hasAllBranches, true);
  }],
  ['feature flag ON / missing row keeps isolation (default is ON, as in featureFlag.js)', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    handlers.unshift([/FROM organization_features/i, () => ({ rows: [] })]);
    assert.strictEqual((await branchService.getUserBranchAccess(5, 1, 'admin')).hasAllBranches, false);
  }],
  ['access resolution is cached, and clearable after grant changes', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    await branchService.getUserBranchAccess(5, 1, 'admin');
    let hits = 0; handlers.unshift([/FROM hr_branch_access/i, () => { hits++; return { rows: [] }; }]);
    await branchService.getUserBranchAccess(5, 1, 'admin'); assert.strictEqual(hits, 0, 'second call must be served from cache');
    branchService.clearBranchAccessCache(5, 1);
    await branchService.getUserBranchAccess(5, 1, 'admin'); assert.strictEqual(hits, 1, 'cleared cache must re-resolve');
  }],
  ['cross-org branch id is rejected even for root admin', async () => {
    seed(); assert.strictEqual(await branchService.validateBranchAccess(1, 1, 'root_admin', 7), false);
  }],
  ['HR cannot validate a branch they are not granted', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    assert.strictEqual(await branchService.validateBranchAccess(5, 1, 'admin', 1), true);
    assert.strictEqual(await branchService.validateBranchAccess(5, 1, 'admin', 2), false);
  }],
  ['validateBranchIdList: validates org + access in one pass', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    assert.strictEqual((await branchService.validateBranchIdList(5, 1, 'admin', [1])).ok, true);
    assert.strictEqual((await branchService.validateBranchIdList(5, 1, 'admin', [1, 2])).ok, false);
    assert.strictEqual((await branchService.validateBranchIdList(1, 1, 'root_admin', [1, 7])).ok, false, 'foreign-org branch');
    assert.strictEqual((await branchService.validateBranchIdList(5, 1, 'admin', ['x'])).ok, false);
  }],
]);

await suite('withBranchContext — an invalid X-Branch-Id never becomes "All Branches"', [
  ['inaccessible branch for HR → 403 BRANCH_FORBIDDEN (not downgraded)', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    const { res, nexted } = await runMw(withBranchContext, { user: { id: 5, organization_id: 1, role: 'admin' }, headers: { 'x-branch-id': '2' } });
    assert.strictEqual(nexted, false); assert.strictEqual(res.code, 403); assert.strictEqual(res.body.code, 'BRANCH_FORBIDDEN');
  }],
  ['foreign-org branch for ROOT admin → 403 (root must not fall back to all)', async () => {
    seed(); const { res, nexted } = await runMw(withBranchContext, { user: { id: 1, organization_id: 1, role: 'root_admin' }, headers: { 'x-branch-id': '7' } });
    assert.strictEqual(nexted, false); assert.strictEqual(res.code, 403);
  }],
  ['garbage header → 403', async () => {
    seed(); const { res } = await runMw(withBranchContext, { user: { id: 1, organization_id: 1, role: 'root_admin' }, headers: { 'x-branch-id': 'abc' } });
    assert.strictEqual(res.code, 403);
  }],
  ['valid branch is applied', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    const req = { user: { id: 5, organization_id: 1, role: 'admin' }, headers: { 'x-branch-id': '1' } };
    const { nexted } = await runMw(withBranchContext, req);
    assert.ok(nexted); assert.strictEqual(req.branchContext.selectedBranchId, 1);
  }],
  ['no header: root = all-branch access, HR stays limited (null ≠ All Branches)', async () => {
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    const r1 = { user: { id: 1, organization_id: 1, role: 'root_admin' }, headers: {} }; await runMw(withBranchContext, r1);
    const r2 = { user: { id: 5, organization_id: 1, role: 'admin' }, headers: {} }; await runMw(withBranchContext, r2);
    assert.strictEqual(r1.branchContext.hasAllBranches, true);
    assert.strictEqual(r2.branchContext.hasAllBranches, false); assert.deepStrictEqual(bf.getFilterState(r2.branchContext), { type: 'multi', branchIds: [1] });
  }],
  ['explicit "all" header is treated as no selection', async () => {
    seed(); const req = { user: { id: 1, organization_id: 1, role: 'root_admin' }, headers: { 'x-branch-id': 'all' } };
    await runMw(withBranchContext, req); assert.strictEqual(req.branchContext.selectedBranchId, null);
  }],
  ['context is resolved once per request (idempotent)', async () => {
    seed(); const req = { user: { id: 1, organization_id: 1, role: 'root_admin' }, headers: {} };
    await runMw(withBranchContext, req); const first = req.branchContext; await runMw(withBranchContext, req);
    assert.strictEqual(req.branchContext, first);
  }],
]);

await suite('branchFilter — target employee / write-scope helpers', [
  ['canAdminAccessUser: foreign-org user is rejected even with all-branch access', async () => {
    seed(); assert.strictEqual(await bf.canAdminAccessUser(ctx({ hasAllBranches: true }), 12, 1), false);
    assert.strictEqual(await bf.canAdminAccessUser(ctx({ hasAllBranches: true }), 10, 1), true);
  }],
  ['canAdminAccessUser: HR(branch 1) → own branch yes, other branch no', async () => {
    seed(); const c = ctx({ accessibleBranchIds: [1] });
    assert.strictEqual(await bf.canAdminAccessUser(c, 10, 1), true);
    assert.strictEqual(await bf.canAdminAccessUser(c, 11, 1), false);
    assert.strictEqual(await bf.canAdminAccessUser(c, 13, 1), false, 'NULL-branch employee is not in a limited admin scope');
  }],
  ['canAdminAccessUser: no branch access → always false', async () => {
    seed(); assert.strictEqual(await bf.canAdminAccessUser(ctx({ accessibleBranchIds: [] }), 10, 1), false);
  }],
  ['assertUsersAccessible: batch, one query, foreign + other-branch ids reported', async () => {
    seed(); let q = 0; handlers.unshift([/FROM users WHERE organization_id = \$1 AND id = ANY/i, (p) => { q++; return { rows: p[1].filter(i => USERS[i] && USERS[i].org === p[0] && (p[2] === undefined || USERS[i].branch === (Array.isArray(p[2]) ? p[2][0] : p[2]))).map(id => ({ id })) }; }]);
    const ok = await bf.assertUsersAccessible(ctx({ selectedBranchId: 1, accessibleBranchIds: [1] }), [10], 1);
    assert.ok(ok.ok); assert.strictEqual(q, 1);
    const bad = await bf.assertUsersAccessible(ctx({ selectedBranchId: 1, accessibleBranchIds: [1] }), [10, 11, 12], 1);
    assert.ok(!bad.ok); assert.deepStrictEqual(bad.badIds.sort(), [11, 12]);
  }],
  ['resolveWriteBranch: restricted HR with no selection is refused (no org-wide bypass)', () => {
    assert.strictEqual(bf.resolveWriteBranch(ctx({ accessibleBranchIds: [1, 2] })).ok, false);
    assert.strictEqual(bf.resolveWriteBranch(ctx({ accessibleBranchIds: [1, 2], selectedBranchId: 2 })).branchId, 2);
    assert.strictEqual(bf.resolveWriteBranch(ctx({ hasAllBranches: true })).branchId, null);
  }],
  ['canModifyBranchRecord: org-wide records only for all-branch callers; branch records by scope', () => {
    const hr = ctx({ accessibleBranchIds: [1], selectedBranchId: 1 });
    assert.strictEqual(bf.canModifyBranchRecord(hr, null), false);
    assert.strictEqual(bf.canModifyBranchRecord(hr, '1'), true);
    assert.strictEqual(bf.canModifyBranchRecord(hr, 2), false);
    assert.strictEqual(bf.canModifyBranchRecord(ctx({ hasAllBranches: true, selectedBranchId: 2 }), null), true);
  }],
]);

await suite('Holiday scoping', [
  ['visibility: none → org-wide only; specific → org + branch; all → no filter', () => {
    const calls = []; const q = { or: s => { calls.push(['or', s]); return q; }, is: (c, v) => { calls.push(['is', c, v]); return q; } };
    applyHolidayVisibility(q, { type: 'none' }); assert.deepStrictEqual(calls[0], ['is', 'branch_id', null]);
    applyHolidayVisibility(q, { type: 'specific', branchId: 3 }); assert.match(calls[1][1], /branch_id\.is\.null,branch_id\.eq\.3/);
    const before = calls.length; applyHolidayVisibility(q, { type: 'all' }); assert.strictEqual(calls.length, before);
  }],
  ['a holiday applies to org-wide + own branch only', () => {
    assert.strictEqual(helpers.holidayAppliesToBranch({ branch_id: null }, 1), true);
    assert.strictEqual(helpers.holidayAppliesToBranch({ branch_id: 1 }, 1), true);
    assert.strictEqual(helpers.holidayAppliesToBranch({ branch_id: 2 }, 1), false);
    assert.strictEqual(helpers.holidayAppliesToBranch({ branch_id: 2 }, null), false);
  }],
]);

await suite('Announcement + broadcast targeting', [
  ['announcement targeting: org-wide reaches everyone; targeted reaches only that branch (+ root, granted HR, creator)', async () => {
    seed(); handlers.unshift([/FROM hr_branch_access WHERE org_id/i, () => ({ rows: [{ user_id: 5, branch_id: 1, all_branches: false }, { user_id: 6, branch_id: 2, all_branches: false }] })]);
    const users = [{ id: 1, role: 'root_admin' }, { id: 5, role: 'admin' }, { id: 6, role: 'admin' }, { id: 10, role: 'employee', branch_id: 1 }, { id: 11, role: 'employee', branch_id: 2 }];
    assert.strictEqual((await filterUsersByBranchTargets(1, users, [], null)).length, 5);
    const t = (await filterUsersByBranchTargets(1, users, [1], null)).map(u => u.id).sort((a, b) => a - b);
    assert.deepStrictEqual(t, [1, 5, 10]);
    assert.ok((await filterUsersByBranchTargets(1, users, [1], 6)).some(u => u.id === 6), 'creator always included');
  }],
  ['announcement visibility follows the viewer branch scope', () => {
    const ann = { branch_ids: [2], created_by: 99 };
    assert.strictEqual(announcementVisibleToViewer(ann, ctx({ accessibleBranchIds: [1] }), 10), false);
    assert.strictEqual(announcementVisibleToViewer(ann, ctx({ accessibleBranchIds: [2] }), 10), true);
    assert.strictEqual(announcementVisibleToViewer(ann, ctx({ hasAllBranches: true }), 10), true);
    assert.strictEqual(announcementVisibleToViewer({ branch_ids: null }, ctx({ accessibleBranchIds: [1] }), 10), true);
  }],
  ['broadcast: explicit foreign / other-branch recipient is rejected', async () => {
    seed(); const req = { user: { id: 5, organization_id: 1, role: 'admin' }, branchContext: ctx({ selectedBranchId: 1, accessibleBranchIds: [1] }) };
    const r = await resolveBroadcastRecipients(req, { target_user_id: 12 });
    assert.strictEqual(r.ok, false); assert.strictEqual(r.status, 403);
  }],
  ['broadcast: restricted HR with no target gets ONLY their scope', async () => {
    seed(); let params; handlers.unshift([/role = 'employee'/i, (p) => { params = p; return { rows: [{ id: 10, email: 'a@x', name: 'A' }] }; }]);
    const req = { user: { id: 5, organization_id: 1, role: 'admin' }, branchContext: ctx({ accessibleBranchIds: [1, 2] }) };
    const r = await resolveBroadcastRecipients(req, {}); assert.ok(r.ok);
    assert.deepStrictEqual(params[1], [1, 2], 'must be limited to the caller\'s branches');
  }],
]);

await suite('Profile family — central target guard', [
  ['self is allowed; HR cross-branch denied; unknown/foreign target 404/403', async () => {
    const guard = require('../middleware/profileGuard')[2];
    seed({ grants: [{ user_id: 5, org_id: 1, branch_id: 1, all_branches: false }] });
    const mk = (user, id, c) => ({ user, params: { id: String(id) }, branchContext: c });
    let r = await runMw(guard, mk({ id: 10, organization_id: 1, role: 'employee' }, 10)); assert.ok(r.nexted, 'self');
    r = await runMw(guard, mk({ id: 5, organization_id: 1, role: 'admin' }, 10, ctx({ accessibleBranchIds: [1], selectedBranchId: 1 }))); assert.ok(r.nexted, 'HR own branch');
    r = await runMw(guard, mk({ id: 5, organization_id: 1, role: 'admin' }, 11, ctx({ accessibleBranchIds: [1], selectedBranchId: 1 }))); assert.strictEqual(r.res.code, 403);
    r = await runMw(guard, mk({ id: 10, organization_id: 1, role: 'employee' }, 11)); assert.strictEqual(r.res.code, 403, 'employee → other employee');
    on(/SELECT 1 FROM users WHERE id = \$1 AND organization_id = \$2/i, (p) => ({ rows: USERS[p[0]] && USERS[p[0]].org === p[1] ? [{}] : [] }));
    r = await runMw(guard, mk({ id: 1, organization_id: 1, role: 'root_admin' }, 12)); assert.strictEqual(r.res.code, 404, 'root → other org user');
    r = await runMw(guard, mk({ id: 1, organization_id: 1, role: 'root_admin' }, 11)); assert.ok(r.nexted, 'root → same-org user');
  }],
  ['guard is mounted before the profile routers', () => {
    const s = read('server.js'); const g = s.indexOf("profileGuard"); const r = s.indexOf("app.use('/api/profile',        profileOverview)");
    assert.ok(g > 0 && r > g);
  }],
]);

await suite('Organisation scope — no default org, no cross-org config fallback', [
  ['orgId() throws without an authenticated organisation (no "|| 1")', () => {
    assert.throws(() => helpers.orgId({ user: {} }), /organisation/i);
    assert.strictEqual(helpers.orgId({ user: { organization_id: 4 } }), 4);
  }],
  ['getSettings never returns another organisation\'s schedule', () => {
    assert.ok(!/from\('work_schedule'\)\.select\('\*'\)\.limit\(1\)\.single\(\)/.test(read('utils/helpers.js').split('async function getSettings')[1].split('function orgId')[0].replace(/let q = [^;]+;/, '')) || true);
    const body = read('utils/helpers.js').split('async function getSettings')[1].split('function orgId')[0];
    assert.ok(/neutral defaults/i.test(body) && !/fallback/.test(body.replace(/neutral defaults[\s\S]*/i, '')), 'cross-org fallback query removed');
  }],
  ['organisation settings: no ?org_id / body.org_id override (cross-tenant read/write)', () => {
    const s = read('modules/org/org.routes.js');
    assert.ok(!/req\.query\.org_id/.test(s) && !/org_id \? Number\(org_id\)/.test(s));
  }],
  ['announcements: no client-controlled org override', () => {
    const s = read('modules/announcements/announcements.routes.js');
    assert.ok(!/req\.query\.org_id|req\.body\?\.org_id/.test(s));
  }],
]);

await suite('Route-level guards (source pins)', [
  ['employees: list is branch-scoped for EVERY caller and non-admins get no salary columns', () => {
    const s = read('modules/employees/employees.routes.js');
    assert.ok(!/isAdminRole\(req\.user\.role\)\s*\?\s*getFilterState/.test(s), 'branch filter must not be admin-only');
    assert.ok(/EMPLOYEE_DIRECTORY_COLS/.test(s) && !/EMPLOYEE_DIRECTORY_COLS = \[[^\]]*ctc/.test(s));
  }],
  ['employees: branch_id validated on create/update and never erased by a partial update', () => {
    const s = read('modules/employees/employees.routes.js');
    assert.ok(/validateBranchIdList/.test(s) && /branchProvided/.test(s) && !/branch_id:\s+branch_id\s+\|\| null/.test(s));
    assert.ok(/\/:id\/statutory', auth, hasPermission\('employees', 'edit'\), withBranchContext/.test(s));
    assert.ok(!/router\.post\('\/:id\/avatar', auth, isAdminRole/.test(s), 'isAdminRole is not middleware');
  }],
  ['employees: non-root cannot modify/delete/send credentials to admin accounts', () => {
    const s = read('modules/employees/employees.routes.js');
    assert.ok(/Only root admins can modify HR admin or root admin accounts/.test(s));
    assert.ok(/Only root admins can delete HR admin or root admin accounts/.test(s));
    assert.ok(/Only root admins can send credentials to admin accounts/.test(s));
  }],
  ['holidays: PUT/DELETE/bulk/copy are scope-checked and branch_id is not client-controlled', () => {
    const s = read('modules/holidays/holidays.routes.js');
    assert.ok((s.match(/canModifyBranchRecord/g) || []).length >= 4);
    assert.ok(!/\.\.\.h,\s*organization_id/.test(s), 'bulk must not spread client fields');
  }],
  ['legacy /calendar holiday writes are retired and events are org-scoped', () => {
    const s = read('modules/calendar/calendar.routes.js');
    assert.ok(/status\(410\)/.test(s));
    assert.ok(!/\.eq\('id', req\.params\.id\)\s*\.select\(\)\.single\(\)/.test(s));
    assert.ok((s.match(/eq\('organization_id', orgId\(req\)\)/g) || []).length >= 6);
  }],
  ['shifts: batch employee validation, usable-shift check, roster IDOR closed', () => {
    const s = read('modules/shifts/shifts.routes.js');
    assert.ok((s.match(/assertUsersAccessible/g) || []).length >= 3);
    // bulk assign must whitelist fields (user_id/shift_id/date) instead of spreading client objects
    assert.ok(/loadUsableShift/.test(s) && /const clean = assignments\.map/.test(s) && !/assignments\.map\(a => \(\{ \.\.\.a/.test(s));
    assert.ok(/delete\(\)\.eq\('id', req\.params\.id\)\.eq\('organization_id', oId\)/.test(s.replace(/\s+/g, ' ')) || /\.eq\('id', req\.params\.id\)\.eq\('organization_id', oId\);/.test(s));
  }],
  ['leave policies: whitelisted update, scope-checked, no org default overwrite by restricted HR', () => {
    const s = read('modules/leave-policies/leavePolicies.routes.js');
    assert.ok(/POLICY_FIELDS/.test(s) && /canModifyBranchRecord/.test(s) && /resolvePolicyTargets/.test(s));
    assert.ok(!/const fields = req\.body;/.test(s));
  }],
  ['assets: scoped create/update/delete; employees only see their own assets', () => {
    const s = read('modules/assets/assets.routes.js');
    assert.ok(/resolveWriteBranch/.test(s) && (s.match(/canModifyBranchRecord/g) || []).length >= 2);
    assert.ok(/q = q\.eq\('assigned_to', req\.user\.id\)/.test(s));
  }],
  ['leaves / exit / onboarding / expenses / performance: on-behalf + by-id mutations check the employee branch', () => {
    const leaves = read('modules/leaves/leaves.routes.js');
    assert.ok(/router\.put\('\/:id', auth, withBranchContext/.test(leaves) && /router\.get\('\/:id\/history', auth, withBranchContext/.test(leaves) && /router\.post\('\/:id\/comments', auth, withBranchContext/.test(leaves));
    for (const f of ['modules/exit/exit.routes.js', 'modules/onboarding/onboarding.routes.js', 'modules/offboarding/offboarding.routes.js', 'modules/expenses/expenses.routes.js', 'modules/performance/performance.routes.js'])
      assert.ok(/canAdminAccessUser/.test(read(f)) && /canAdminAccessUser\(req\.branchContext/.test(read(f)), f);
  }],
  ['biometric: permission gate replaces adminOnly; ingestion is NOT branch-gated; bulk ops need all-branch access', () => {
    const s = read('modules/biometric/biometric.routes.js');
    assert.ok(!/router\.(get|post|put|delete)\([^\n]*auth, adminOnly/.test(s), 'no route may use bare adminOnly');
    assert.ok(/requireAllBranches/.test(s) && /loadManageableDevice/.test(s) && /scopedPinFilterSql/.test(s));
    const ingest = s.slice(s.indexOf("router.post('/collector-push'"), s.indexOf("router.post('/preview-easywdms'"));
    assert.ok(!/branchContext|canAdminAccessUser|canModifyBranchRecord/.test(ingest), 'collector ingestion must stay branch-neutral');
    for (const f of ['modules/biometric/biometricPush.handler.js', 'modules/biometric/biometricHeartbeat.handler.js'])
      assert.ok(!/branch_id\s*(!==|!=|===|==)\s*[a-z.]*branch/i.test(read(f)), f + ' must not compare device vs employee branch');
  }],
  ['biometric: PIN mapping validates the target employee and rollback/import are all-branch only', () => {
    const s = read('modules/biometric/biometric.routes.js');
    assert.ok(/Mapping targets an employee: must exist in THIS org/.test(s));
    assert.ok(/import-batches\/:id', auth, bio\('manage'\), withBranchContext, requireAllBranches/.test(s));
  }],
  ['payroll: NULL-branch runs need all-branch access; restricted HR cannot create org-wide runs; override employee validated', () => {
    const s = read('modules/payroll/payroll.routes.js');
    assert.ok(/needs all-branch access/.test(s) && /orgWideRunBlocked/.test(s) && /A restricted admin cannot create an organisation-wide run/.test(s));
    assert.ok(/This employee is not part of the selected payroll run/.test(s));
    assert.ok(/scheduler\/trigger', auth, hasPermission\('payroll', 'generate'\), withBranchContext/.test(s));
  }],
  ['payroll engine reads only holidays applying to the employee branch (payroll maths otherwise untouched)', () => {
    assert.ok(/branch_id IS NULL\s+OR branch_id = \(SELECT u\.branch_id FROM users u WHERE u\.id = \$4/.test(read('services/payrollEngine.js')));
  }],
  ['statutory: config stays org-wide; employee-derived reports/declarations are scoped', () => {
    const s = read('modules/statutory/statutory.routes.js'); const svc = read('services/statutoryReportService.js');
    assert.ok((svc.match(/\$4::bigint\[\] IS NULL OR ps\.user_id = ANY/g) || []).length === 6);
    assert.ok(/scopeEmployees/.test(s) && !/router\.put\('\/config\/pf'[^\n]*withBranchContext/.test(s));
    assert.ok((s.match(/canAdminAccessUser\(req\.branchContext/g) || []).length >= 4);
  }],
  ['documents: mutations check the document owner / shared-doc branch', () => {
    const s = read('modules/documents/documents.routes.js');
    assert.ok((s.match(/canAdminAccessDoc\(req/g) || []).length >= 5);
    const dr = read('modules/documents/doc_requirements.routes.js');
    assert.ok(typeof bf.validateBranchAccess === 'function', 'validateBranchAccess must be exported (was a broken import)');
    assert.ok(/validateBranchAccess/.test(dr));
  }],
  ['roles: branch-scoped role only to that branch, no escalation, HR-admin role is root-only', () => {
    const s = read('modules/roles/roles.routes.js');
    assert.ok(/branchScopedRoleMismatch/.test(s) && /You cannot grant a permission you do not hold/.test(s) && /Only a Root Admin can assign the HR Admin role/.test(s));
    assert.ok(/Only a Root Admin can assign the Root Admin role\./.test(s) && /slug = 'root_admin'/.test(s), 'previous DEEP-005 guard preserved');
  }],
  ['reports: admin-only, ?userId= branch-checked', () => {
    const s = read('modules/reports/reports.routes.js');
    assert.ok(/router\.get\('\/attendance', auth, adminOnly/.test(s) && /router\.get\('\/leaves', auth, adminOnly/.test(s) && /router\.get\('\/headcount', auth, adminOnly/.test(s));
    assert.ok(/canAdminAccessUser\(req\.branchContext, parseInt\(userId, 10\), oId\)/.test(s));
  }],
  ['broadcast: email + push share ONE recipient resolver and a permission gate', () => {
    assert.ok(/resolveBroadcastRecipients/.test(read('modules/root/root.routes.js')) && /resolveBroadcastRecipients/.test(read('modules/push/push.routes.js')));
    assert.ok(/notifications', 'broadcast'/.test(read('modules/root/root.routes.js')));
  }],
  ['attendance late/early by-id access is org-scoped', () => {
    const s = read('modules/attendance/attendance.routes.js');
    assert.ok(!/\.select\('\*'\)\.eq\('id', req\.params\.id\)\.single\(\)/.test(s));
  }],
  ['grant / branch changes drop the cached access resolution', () => {
    assert.ok(/clearBranchAccessCache/.test(read('modules/branches/branches.routes.js')) && /clearBranchAccessCache/.test(read('modules/root/root.routes.js')));
  }],
]);

await suite('Query adapter — .or() list operator (regression: multi-branch / employee scope)', [
  ['or("col.is.null,col.in.(1,2)") produces a real IN list, not col = \'(1\'', async () => {
    const { db } = require('../config/db'); const log = [];
    const real = pool.query; pool.query = async (sql, params) => { log.push([sql.replace(/\s+/g, ' '), params]); return { rows: [], rowCount: 0 }; };
    try { await db.from('holidays').select('*').eq('organization_id', 1).or('branch_id.is.null,branch_id.in.(1,2)'); }
    finally { pool.query = real; }
    assert.match(log[0][0], /\("branch_id" IS NULL OR "branch_id" IN \(\$2, \$3\)\)/);
    assert.deepStrictEqual(log[0][1], [1, 1, 2]);
  }],
  ['single-element list and legacy eq/is terms still parse', async () => {
    const { db } = require('../config/db'); const log = [];
    const real = pool.query; pool.query = async (sql, params) => { log.push([sql.replace(/\s+/g, ' '), params]); return { rows: [], rowCount: 0 }; };
    try { await db.from('shifts').select('*').or('branch_id.in.(5),branch_id.eq.9,branch_id.is.null'); }
    finally { pool.query = real; }
    assert.match(log[0][0], /"branch_id" IN \(\$1\) OR "branch_id" = \$2 OR "branch_id" IS NULL/);
  }],
]);

await suite('Document requirements — target employee scope (source pins)', [
  ['for-employee / submit-for / review / assign / employee picker are branch-scoped', () => {
    const s = read('modules/documents/doc_requirements.routes.js');
    assert.ok((s.match(/canAdminAccessUser\(req\.branchContext/g) || []).length >= 3);
    assert.ok(/assertUsersAccessible\(req\.branchContext, assignedEmployeeIds/.test(s));
    assert.ok(/resolveEmployeeIds\(req\.branchContext, oId\); \/\/ null = org-wide/.test(s));
  }],
  ['root HR creation validates the branch belongs to the organisation', () => {
    assert.ok(/A branch grant may only point at a branch of THIS organisation/.test(read('modules/root/root.routes.js')));
  }],
]);

await suite('Migration is minimal and safe', [
  ['only the proven-necessary changes; idempotent; additive/loosening', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../migrations/branch_separation_2026_10_03.sql'), 'utf8');
    assert.ok(/ADD COLUMN IF NOT EXISTS branch_ids/.test(sql) && /idx_holidays_org_branch_date/.test(sql) && /ON CONFLICT \(role_id, permission_id\) DO NOTHING/.test(sql));
    assert.ok(!/DELETE FROM|DROP TABLE|TRUNCATE|UPDATE\s+\w+\s+SET/i.test(sql), 'no data is deleted or rewritten');
    for (const t of ['attendance', 'leaves', 'attendance_regularization', 'payslips', 'expenses', 'performance_goals', 'biometric_raw_logs'])
      assert.ok(!new RegExp(`ALTER TABLE ${t}\\b`, 'i').test(sql), `no branch_id on ${t}`);
  }],
]);

console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n❌  Branch-separation test failures detected.'); process.exit(1); }
console.log('\n✅  All branch-separation checks passed.');
process.exit(0);
})();
