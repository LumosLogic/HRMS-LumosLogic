/**
 * Static contract checks over the React client's data layer (no browser needed):
 *   cache keys, branch scoping, config invalidation, search behaviour, today's-attendance freshness.
 * These check SOURCE, not runtime behaviour — they guard against regressions of the Phase 1/2 performance work.
 *
 * Run: node src/tests/client_query_contract.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '../../../client/src');
const walk = (d, o = []) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p, o) : /\.jsx?$/.test(f) && o.push(p); } return o; };
const files = walk(CLIENT).map(f => ({ rel: path.relative(CLIENT, f).split(path.sep).join('/'), src: fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') }));
const read = (rel) => files.find(f => f.rel === rel)?.src || assert.fail('missing client file ' + rel);

function findBlocks(s) {
  const out = []; let i = 0;
  while ((i = s.indexOf('useQuery({', i)) >= 0) {
    let depth = 0, j = i + 'useQuery('.length;
    for (; j < s.length; j++) { const ch = s[j]; if (ch === '{' || ch === '(' || ch === '[') depth++; else if (ch === '}' || ch === ')' || ch === ']') { depth--; if (depth === 0) break; } }
    const end = s.indexOf(')', j) + 1; out.push(s.slice(i, end)); i = end;
  }
  return out;
}
const queries = [];
for (const f of files) for (const b of findBlocks(f.src)) {
  const key = (b.match(/queryKey:\s*(\[[^\]]*\])/) || [])[1];
  const api = (b.match(/apiGet\(\s*[`'"]([^`'"?$]+)/) || [])[1];
  if (key) queries.push({ file: f.rel, key: key.replace(/\s+/g, ' '), api, block: b });
}

// load lib/queryScopes.js (ESM, dependency-free) without a bundler
const scopes = new Function(read('lib/queryScopes.js').replace(/^export /gm, '') + '\nreturn { needsBranchInvalidation, ORG_LEVEL_QUERY_KEYS, isBranchIndependent };')();

let passed = 0, failed = 0; const failures = [];
function t(name, fn) { try { fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; failures.push(name); console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); } }

console.log('\nQUERY KEYS');
t('a key literal never maps to two different endpoints (the old org-settings / work-schedule collisions)', () => {
  const byKey = {};
  for (const q of queries) if (q.api) (byKey[q.key] = byKey[q.key] || new Set()).add(q.api);
  const clashes = Object.entries(byKey).filter(([, s]) => s.size > 1).map(([k, s]) => `${k} → ${[...s].join(' & ')}`);
  assert.deepStrictEqual(clashes, []);
});
t('no v4-style invalidateQueries([...]) (in v5 an array means "invalidate everything")', () => {
  const bad = files.flatMap(f => (f.src.match(/(invalidateQueries|refetchQueries|cancelQueries|removeQueries|resetQueries)\(\s*\[/g) || []).map(() => f.rel));
  assert.deepStrictEqual(bad, []);
});
t('retired duplicate keys are gone (my-leaves, my-leaves-recent, my-regularization, my-expenses-recent, shifts-list, holidays-att, leaves-month, calendar-leaves, root-pending-regs, pending-approvals-*)', () => {
  const gone = /['"](my-leaves|my-leaves-recent|my-regularization|my-expenses-recent|shifts-list|holidays-att|holidays-report|leaves-month|calendar-leaves|my-leaves-att|root-pending-regs|pending-approvals-(leaves|regs|expenses|all-leaves)|pending-root-leaves|my-workflow-approvals|my-shared-docs|employees-list|announcements-dash|branches-for-hr-form)['"]/;
  const bad = files.filter(f => gone.test(f.src)).map(f => f.rel);
  assert.deepStrictEqual(bad, []);
});
t('branch-dependent endpoints are fetched through branch-keyed hooks (no raw /leaves, /regularization, /expenses list reads)', () => {
  const raw = queries.filter(q => ['/leaves', '/regularization', '/expenses', '/announcements', '/shifts'].includes(q.api) && !/userId/.test(q.block) && !/^\['(emp-|drawer-|epv2-)/.test(q.key));   // per-employee reads are keyed by employee + period
  assert.deepStrictEqual(raw.map(q => `${q.file} ${q.key}`), []);
});
t('no malformed BRANCH_KEYED markers (a bad codemod once produced "10meta:")', () => {
  assert.deepStrictEqual(files.filter(f => /d+meta: BRANCH_KEYED/.test(f.src)).map(f => f.rel), []);
});
t('every raw query whose key carries the branch declares meta: BRANCH_KEYED', () => {
  const bad = queries.filter(q => /selectedBranchId|_bk\d/.test(q.key) && !/meta:\s*BRANCH_KEYED/.test(q.block));
  assert.deepStrictEqual(bad.map(q => `${q.file} ${q.key}`), []);
});
t('shared hooks put the selected branch in the key of branch-dependent data and none in organisation-level data', () => {
  const lq = read('hooks/useListQueries.js'), rd = read('hooks/useReferenceData.js');
  assert.match(lq, /queryKey: \[\.\.\.root, \.\.\.extraKey, selectedBranchId, query\]/);
  assert.match(lq, /queryKey: \['leave-policies', selectedBranchId\]/);
  assert.match(rd, /queryKey: \[\.\.\.rootKey, \.\.\.extraKey, selectedBranchId\]/);
  for (const org of ['branches', 'departments', 'org-settings', 'settings', 'work-schedule', 'payroll-settings'])
    assert.match(rd, new RegExp(`useOrgQuery\\(\\['${org}'\\]`), org + ' is organisation-level (no branch in key)');
  assert.doesNotMatch(rd.split('// ── organisation-level')[1].split('// ── branch-dependent')[0], /selectedBranchId/, 'org-level hooks never read the branch');
});

console.log('\nBRANCH SWITCH');
const q = (root, extra = {}) => ({ queryKey: [root], ...extra });
t('branch-keyed queries are NOT re-invalidated (they refetch under their new key)', () => {
  assert.strictEqual(scopes.needsBranchInvalidation(q('leaves', { meta: { branchKeyed: true } })), false);
});
t('organisation-level data is never refetched by a switch', () => {
  for (const r of ['branches', 'departments', 'org-settings', 'settings', 'work-schedule', 'payroll-settings', 'statutory-config', 'org-features', 'notif-count'])
    assert.strictEqual(scopes.needsBranchInvalidation(q(r)), false, r);
});
t('single-record / own-data queries are not invalidated', () => {
  for (const r of ['payroll-run', 'payslip-details', 'epv2-overview', 'emp-att-cur', 'my-leave-balance', 'profile-personal', 'drawer-leaves', 'goal-comments', 'att-day'])
    assert.strictEqual(scopes.needsBranchInvalidation(q(r)), false, r);
});
t('an UNCLASSIFIED query is invalidated (fail-safe: stale other-branch data must never look current)', () => {
  assert.strictEqual(scopes.needsBranchInvalidation(q('some-new-list')), true);
  assert.strictEqual(scopes.needsBranchInvalidation(q('role-members')), true);
});
t('every raw useQuery in the app is classified (only role / role-members remain invalidated on a switch)', () => {
  const roots = new Set();
  for (const x of queries) { const r = (x.key.match(/\[\s*['"]([^'"]+)['"]/) || [])[1]; if (r && !/selectedBranchId|_bk\d/.test(x.key) && !/meta:\s*BRANCH_KEYED/.test(x.block)) roots.add(r); }
  const open = [...roots].filter(r => scopes.needsBranchInvalidation(q(r))).sort();
  assert.deepStrictEqual(open, ['role', 'role-members']);
});
t('BranchSwitchGuard is mounted around the page outlet of the admin layouts, and blocks interaction while the old branch data is shown', () => {
  for (const l of ['components/layout/AppLayout.jsx', 'components/layout/RootLayout.jsx']) assert.match(read(l), /<BranchSwitchGuard><Outlet \/><\/BranchSwitchGuard>/, l);
  const g = read('components/layout/BranchSwitchGuard.jsx');
  assert.match(g, /pointer-events-none/); assert.match(g, /inert/); assert.match(g, /Updating branch data/);
  assert.match(g, /meta\?\.branchKeyed === true && q\.state\.data === undefined/);
});
t('while the branch context is settling, a gated list reports "loading" — never an empty state', () => {
  for (const h of ['hooks/useListQueries.js', 'hooks/useReferenceData.js', 'hooks/usePendingApprovals.js', 'hooks/useEmployees.js'])
    assert.match(read(h), /gateLoading\(query, /, h);
});

console.log('\nCACHE CLASSIFICATION');
t('the global default stays 3 minutes (not raised) and tiers are explicit', () => {
  assert.match(read('main.jsx'), /staleTime: 3 \* 60 \* 1000/);
  const tiers = read('lib/queryTiers.js');
  assert.match(tiers, /realtime: 15 \* 1000/); assert.match(tiers, /frequent: 60 \* 1000/); assert.match(tiers, /config:\s+10 \* 60 \* 1000/);
});
t("today's attendance is never served stale; own check-in/out/break refreshes every cache that shows it", () => {
  const a = read('hooks/useAttendanceDay.js');
  assert.match(a, /date === todayStr\(\) \? 0 : PAST_DAY_STALE_MS/);
  assert.match(a, /staleTime: 0, gcTime: 0, refetchOnMount: 'always'/, 'override preview is always fresh');
  const calls = (rel, re) => (read(rel).match(re) || []).length;
  assert.strictEqual(calls('pages/MyAttendance.jsx', /invalidateMyAttendance\(qc\)/g), 4);
  assert.strictEqual(calls('pages/Dashboard.jsx', /invalidateMyAttendance\(qc\)/g), 4);
  assert.strictEqual(calls('pages/EmployeeHome.jsx', /invalidateMyAttendance\(qc\)/g), 4);
  for (const k of ['my-attendance', 'my-att-recent', 'att-day', 'dashboard']) assert.ok(a.includes(`'${k}'`), k);
});
t('attendance / dashboard / approval / notification queries use the shorter tiers', () => {
  for (const [rel, tier] of [['pages/Dashboard.jsx', 'frequent'], ['pages/MyAttendance.jsx', 'frequent'], ['components/OrgCalendarPanel.jsx', 'frequent'], ['pages/TeamCalendar.jsx', 'frequent'],
    ['components/layout/Sidebar.jsx', 'realtime'], ['components/layout/RootLayout.jsx', 'realtime'], ['hooks/usePendingApprovals.js', 'realtime'], ['pages/BiometricDevices.jsx', 'realtime']])
    assert.match(read(rel), new RegExp(`STALE\\.${tier}`), rel);
  assert.match(read('hooks/useListQueries.js'), /staleTime = STALE\.frequent/);
});
t('configuration is cached longer ONLY because every save invalidates it', () => {
  const must = [
    ['pages/OrgSettings.jsx', "['org-settings']"], ['pages/Settings.jsx', "['org-settings']"], ['pages/Settings.jsx', "['settings']"], ['pages/Settings.jsx', "['work-schedule']"],
    ['pages/Settings.jsx', "['shifts']"], ['pages/PayrollSettings.jsx', "['payroll-settings']"], ['pages/StatutoryConfig.jsx', "['statutory-config']"],
    ['pages/Holidays.jsx', "['holidays']"], ['pages/Dashboard.jsx', "['holidays']"], ['pages/Shifts.jsx', "['shifts']"], ['pages/Departments.jsx', "['departments']"],
    ['pages/Branches.jsx', "['branches']"], ['pages/LeavePolicies.jsx', "['leave-policies']"], ['components/ConfigGroupsManager.jsx', "['leave-policies']"],
  ];
  for (const [rel, key] of must) assert.ok(read(rel).includes(`invalidateQueries({ queryKey: ${key}`), `${rel} invalidates ${key}`);
  // editors always load fresh values (a stale form could overwrite another admin's change)
  for (const rel of ['pages/OrgSettings.jsx', 'pages/PayrollSettings.jsx']) assert.match(read(rel), /staleTime: 0/, rel + ' loads fresh');
});

console.log('\nREQUEST FAN-OUT (found by measuring the running app)');
t('Leaves page loads every employee balance with ONE batch request (was one request per employee: 107 requests per load)', () => {
  const l = read('pages/Leaves.jsx');
  assert.match(l, /fetchBalanceMap\(uniqueUserIds, curYear\)/);
  assert.doesNotMatch(l, /Promise\.all\(uniqueUserIds/);
  assert.doesNotMatch(l, /apiGet\('\/leaves\/balance', \{ userId: uid/);
  assert.match(read('hooks/useLeaveBalances.js'), /\/leaves\/balance\/batch/);
});
t('Employees list primes the per-employee balance cache with one batch request; cards only fall back to their own request if it fails', () => {
  const e = read('pages/Employees.jsx');
  assert.match(e, /usePrimedBalances\(pageRows\.map/);
  assert.strictEqual((e.match(/<LeaveBalanceChips empId=\{emp\.id\} ready=\{balancesReady\}/g) || []).length, 2, 'grid and table cards');
  assert.match(e, /enabled: ready,/);
  assert.match(read('hooks/useLeaveBalances.js'), /qc\.setQueryData\(\['emp-balance'/);
});
t('admin pages wait for the branch context before fetching (no first-load duplicate requests)', () => {
  const g = read('components/layout/BranchSwitchGuard.jsx');
  assert.match(g, /if \(!isBranchContextReady && !gaveUp\) return/);
  assert.match(g, /GATE_TIMEOUT_MS = 5000/);
});

console.log('\nPAYLOAD (Phase 4)');
t('list hooks request the compact view; Leaves narrows by date on the server and takes badge counts from /leaves/counts', () => {
  const h = read('hooks/useListQueries.js');
  for (const ep of ["'/leaves', { view: 'list', ...params }", "'/regularization', { view: 'list', ...params }", "'/expenses', { view: 'list', ...params }"]) assert.ok(h.includes(ep), ep);
  assert.match(h, /useLeaveCounts = /);
  const l = read('pages/Leaves.jsx');
  // Phase 5: the window + every filter go to the server (rows, counts and cards share one filter object); the tab badges come from /leaves/counts
  assert.match(l, /const windowFrom = hasDateFilter \? \(filterStart \|\| undefined\)/); assert.match(l, /const windowTo   = hasDateFilter \? \(filterEnd \|\| undefined\)/);
  assert.match(l, /from: windowFrom, to: windowTo/);
  assert.match(l, /const pendingCount    = counts\?\.pending \?\? 0/);
});
t('no screen reads a column the compact view drops (list screens only)', () => {
  const dropped = ['google_event_id', 'dept_head_id', 'dept_head_reviewed_at', 'root_admin_id', 'root_admin_reviewed_at', 'manager_approved_at'];
  const screens = ['pages/Leaves.jsx', 'pages/MyLeaves.jsx', 'pages/Regularization.jsx', 'pages/Expenses.jsx', 'pages/PendingApprovals.jsx', 'pages/EmployeeHome.jsx', 'components/LeaveTimeline.jsx'];
  for (const rel of screens) for (const col of dropped) assert.ok(!new RegExp('\\b' + col + '\\b').test(read(rel)), rel + ' reads ' + col);
});

console.log('\nGLOBAL SEARCH');
t('search reuses shared hooks and makes no API call of its own', () => {
  const s = read('components/ui/GlobalSearchModal.jsx');
  assert.doesNotMatch(s, /apiGet\(/); assert.doesNotMatch(s, /\bfetch\(/);
  for (const h of ['useEmployees', 'useLeavesList', 'useDocumentsList', 'useAnnouncements']) assert.match(s, new RegExp(h));
});
t('no request per keystroke: debounced, minimum length, data loaded once then filtered locally', () => {
  const s = read('components/ui/GlobalSearchModal.jsx');
  assert.match(s, /const MIN_CHARS = 2/); assert.match(s, /const DEBOUNCE_MS = 300/);
  assert.match(s, /setTimeout\(\(\) => setDebounced\(query\), DEBOUNCE_MS\)/);
  assert.match(s, /const searchable = open && q\.length >= MIN_CHARS/);
  assert.match(s, /enabled: searchable/g);
  assert.ok((s.match(/enabled: searchable/g) || []).length >= 4, 'all four data sets are gated on `searchable`');
});
t('stale responses cannot overwrite newer results: results are derived synchronously from (data, current query)', () => {
  const s = read('components/ui/GlobalSearchModal.jsx');
  assert.match(s, /const results = useMemo\(/);
  assert.doesNotMatch(s, /setResults\(/, 'no async setResults that a late response could win');
  assert.match(s, /\[q, open, searchable, isEmployee, empsQ\.data, lvsQ\.data, docsQ\.data, annsQ\.data\]/);
});

console.log('\nMUTATION UX');
t('optimistic updates exist only for reversible notification read-state, with rollback and server re-sync', () => {
  const opt = files.filter(f => /onMutate/.test(f.src)).map(f => f.rel);
  assert.deepStrictEqual(opt, ['pages/NotificationCenter.jsx']);
  const n = read('pages/NotificationCenter.jsx');
  assert.match(n, /onError: \(e, _id, ctx\) => \{ restore\(ctx\)/); assert.match(n, /onSettled: invalidateNotifs/);
  for (const sensitive of ['pages/PendingApprovals.jsx', 'pages/PayrollGeneration.jsx', 'pages/Leaves.jsx', 'pages/Regularization.jsx'])
    assert.doesNotMatch(read(sensitive), /onMutate/, sensitive + ' stays server-confirmed');
});

console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
console.log('\n✅  All client data-layer contract checks passed.');
