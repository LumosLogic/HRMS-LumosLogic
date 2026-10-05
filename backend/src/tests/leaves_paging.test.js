/**
 * leaves_paging.test.js — Phase 5 (Leaves pagination + summary cards), no database needed.
 *   1. server list-param parsing (kind / sort / paging headers)
 *   2. the client's pure paging helpers (page reset after ANY filter change, clamping, range)
 *   3. static contract of pages/Leaves.jsx: cards come from server counts, not from the rows of the current page
 * The data-level behaviour (totals, filtered counts, branch isolation, approvals) is covered against real PostgreSQL in
 * branch_realdb.test.js → "LEAVES PAGINATION + SUMMARY COUNTS (Phase 5)".
 *
 * Run: node src/tests/leaves_paging.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SRC = path.join(__dirname, '..');
const CLIENT = path.join(__dirname, '../../../client/src');
const { parseListParams, parseKind, parseSort, setPagingHeaders, ListParamError, MAX_LIMIT } = require(path.join(SRC, 'utils/listParams'));

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 5).join('\n    ')}`); failed++; failures.push(name); }
}
const throwsList = (fn) => assert.throws(fn, (e) => e instanceof ListParamError);

(async () => {
  console.log('\nSERVER PARAMS');
  await t('kind accepts leave|wfh only; sort accepts start_asc only', () => {
    assert.strictEqual(parseKind('wfh'), 'wfh'); assert.strictEqual(parseKind('leave'), 'leave'); assert.strictEqual(parseKind(undefined), null); assert.strictEqual(parseKind(''), null);
    throwsList(() => parseKind('all')); throwsList(() => parseKind('WFH'));
    assert.strictEqual(parseSort('start_asc'), 'start_asc'); assert.strictEqual(parseSort(undefined), null);
    throwsList(() => parseSort('start_desc')); throwsList(() => parseSort('1; DROP TABLE leaves'));
  });
  await t('parseListParams carries kind + sort alongside the existing filters', () => {
    const p = parseListParams({ status: 'pending,approved', type: 'sick', kind: 'leave', sort: 'start_asc', from: '2026-01-01', to: '2026-01-31', limit: '25', page: '3' });
    assert.deepStrictEqual(p.statuses, ['pending', 'approved']); assert.deepStrictEqual(p.types, ['sick']);
    assert.strictEqual(p.kind, 'leave'); assert.strictEqual(p.sort, 'start_asc');
    assert.deepStrictEqual(p.paging, { limit: 25, page: 3, offset: 50 });
  });
  await t('a request without the new params parses exactly as before', () => {
    const p = parseListParams({});
    assert.strictEqual(p.kind, null); assert.strictEqual(p.sort, null); assert.strictEqual(p.paging, null); assert.strictEqual(p.statuses, null);
  });
  await t('limit is capped, page floors at 1, bad limit rejected', () => {
    assert.strictEqual(parseListParams({ limit: '99999' }).paging.limit, MAX_LIMIT);
    assert.strictEqual(parseListParams({ limit: '10', page: '-4' }).paging.page, 1);
    assert.strictEqual(parseListParams({ limit: '10', page: 'abc' }).paging.offset, 0);
    throwsList(() => parseListParams({ limit: '0' })); throwsList(() => parseListParams({ limit: 'x' }));
  });
  await t('setPagingHeaders: total + totalPages are optional and exposed to the browser', () => {
    const h = {}; const res = { set: (o) => Object.assign(h, o) };
    setPagingHeaders(res, { page: 2, limit: 25 }, true);
    assert.strictEqual(h['X-Total'], undefined); assert.strictEqual(h['X-Has-More'], '1');
    const g = {}; setPagingHeaders({ set: (o) => Object.assign(g, o) }, { page: 2, limit: 25 }, false, 137);
    assert.strictEqual(g['X-Total'], '137'); assert.strictEqual(g['X-Total-Pages'], '6'); assert.strictEqual(g['X-Has-More'], '0');
    assert.match(g['Access-Control-Expose-Headers'], /X-Total-Pages/);
    const z = {}; setPagingHeaders({ set: (o) => Object.assign(z, o) }, { page: 1, limit: 25 }, false, 0);
    assert.strictEqual(z['X-Total'], '0'); assert.strictEqual(z['X-Total-Pages'], '1', 'empty result is still "page 1 of 1"');
  });

  console.log('\nCLIENT PAGING HELPERS');
  const pg = await import(pathToFileURL(path.join(CLIENT, 'lib/leavePaging.js')).href);
  const base = { branchId: 1, tab: 'all', status: 'all', type: '', from: '', to: '', userId: '', allHistory: false, pageSize: 25 };
  await t('page resets to 1 after a change of date range / employee / leave type / status / branch / tab / page size / history window', () => {
    const sig = pg.leaveFilterSig(base);
    const state = { sig, page: 4 };
    assert.strictEqual(pg.resolvePage(state, sig), 4, 'unchanged filters keep the page');
    const changes = { from: '2026-01-01', to: '2026-02-01', userId: '77', type: 'sick', status: 'pending', branchId: 2, tab: 'wfh', pageSize: 50, allHistory: true };
    for (const [k, v] of Object.entries(changes))
      assert.strictEqual(pg.resolvePage(state, pg.leaveFilterSig({ ...base, [k]: v })), 1, `changing ${k} resets to page 1`);
  });
  await t('"no branch" (null/undefined) is a stable signature, and switching A→B→A does not resurrect an old page', () => {
    assert.strictEqual(pg.leaveFilterSig({ ...base, branchId: null }), pg.leaveFilterSig({ ...base, branchId: undefined }));
    const a = pg.leaveFilterSig(base), b = pg.leaveFilterSig({ ...base, branchId: 2 });
    let state = { sig: a, page: 3 };
    assert.strictEqual(pg.resolvePage(state, b), 1);
    state = { sig: b, page: 1 };                       // the page the user is on after switching
    assert.strictEqual(pg.resolvePage(state, a), 1);   // back on A: page 1, not the old page 3
  });
  await t('pageCount / clampPage / pageRange', () => {
    assert.strictEqual(pg.pageCount(0, 25), 1); assert.strictEqual(pg.pageCount(25, 25), 1); assert.strictEqual(pg.pageCount(26, 25), 2); assert.strictEqual(pg.pageCount(137, 25), 6); assert.strictEqual(pg.pageCount(null, 25), null);
    assert.strictEqual(pg.clampPage(9, 6), 6); assert.strictEqual(pg.clampPage(3, 6), 3); assert.strictEqual(pg.clampPage(0, 6), 1); assert.strictEqual(pg.clampPage(5, null), 5);
    assert.deepStrictEqual(pg.pageRange(1, 25, 25), { from: 1, to: 25 }); assert.deepStrictEqual(pg.pageRange(6, 25, 12), { from: 126, to: 137 }); assert.deepStrictEqual(pg.pageRange(1, 25, 0), { from: 0, to: 0 });
  });
  await t('page sizes: 25 default, selectable 25/50/100', () => {
    assert.strictEqual(pg.DEFAULT_PAGE_SIZE, 25); assert.deepStrictEqual(pg.PAGE_SIZES, [25, 50, 100]);
  });

  console.log('\nLEAVES PAGE CONTRACT (source)');
  const leaves = fs.readFileSync(path.join(CLIENT, 'pages/Leaves.jsx'), 'utf8').replace(/\r\n/g, '\n');
  const hooks = fs.readFileSync(path.join(CLIENT, 'hooks/useListQueries.js'), 'utf8').replace(/\r\n/g, '\n');
  await t('cards read the server summary, never the rows of the current page', () => {
    assert.match(leaves, /<LeaveSummaryCards counts=\{counts\?\.summary\}/);
    const cardsFn = leaves.slice(leaves.indexOf('function LeaveSummaryCards'), leaves.indexOf('function LeavePagination'));
    assert.ok(cardsFn.length > 100);
    assert.doesNotMatch(cardsFn, /leaves\b|displayList|\.filter\(|\.length/, 'the card component never derives a number from rows');
    // no client-side count of status over the loaded rows anywhere in the page
    assert.doesNotMatch(leaves, /(?:leaves|displayList|allLeaves)\.filter\([^)]*status/, 'no status counting over loaded rows');
  });
  await t('cards show a placeholder while the NEW filter counts load (never the previous filter\'s numbers)', () => {
    assert.match(leaves, /stale=\{countsStale \|\| counts == null\}/);
    assert.match(leaves, /const value = !stale && counts \?/);
  });
  await t('rows, counts and cards share ONE filter object (same filters → consistent state)', () => {
    assert.match(leaves, /const sharedFilters = \{/);
    assert.match(leaves, /useLeavesList\(\n?\s*\/\/[^\n]*\n\s*\{ \.\.\.sharedFilters,/);
    assert.match(leaves, /useLeaveCounts\(\{ \.\.\.sharedFilters, kind \}/);
  });
  await t('the table asks the server for one page (limit + page), keeps old rows dimmed while loading, never flashes "No records" while pending', () => {
    assert.match(leaves, /limit: highlightId \? HIGHLIGHT_PAGE_SIZE : pageSize, page: highlightId \? 1 : page/);
    assert.match(hooks, /placeholderData: keepPreviousData/);
    assert.match(leaves, /<RefreshingOverlay active=\{leavesStale\}>/);
    assert.match(leaves, /displayList\.length === 0 && leavesLoading/);
  });
  await t('page reset is derived from the filter signature (all filters + branch + tab + size are in it)', () => {
    assert.match(leaves, /leaveFilterSig\(\{ branchId: selectedBranchId, tab, status: statusFilter, type: filterType, from: filterStart, to: filterEnd, userId: userIdParam, allHistory, pageSize \}\)/);
    assert.match(leaves, /const page = resolvePage\(pageState, filterSig\)/);
  });
  await t('?page= and ?limit= are synced to the URL with replace; existing params are preserved', () => {
    assert.match(leaves, /n\.set\('page', String\(page\)\)/); assert.match(leaves, /n\.set\('limit', String\(pageSize\)\)/);
    assert.match(leaves, /\{ replace: true \}\);\n\s*\}, \[page, pageSize, setSearchParams\]\)/);
    for (const k of ['tab', 'date', 'status', 'type', 'userId', 'highlight']) assert.match(leaves, new RegExp(`searchParams\\.get\\('${k}'\\)`), 'still reads ?' + k);
  });
  await t('mutations refresh rows + counts + cards together (prefix invalidation of the leaves cache)', () => {
    assert.match(leaves, /invalidateQueries\(\{ queryKey: \['leaves'\] \}\)/);
    assert.doesNotMatch(leaves, /refetchLeaves/);
  });
  await t('no per-employee balance calls reintroduced (one batch request per page); Employees API untouched', () => {
    assert.match(leaves, /fetchBalanceMap\(uniqueUserIds, curYear\)/);
    assert.doesNotMatch(leaves, /apiGet\(`\/leaves\/balance\?user/);
    assert.doesNotMatch(leaves, /from '@\/hooks\/useEmployees'[^;]*;[\s\S]{0,40}page/);
  });
  await t('the whole-set consumers do not depend on the page: summary tab, upcoming card and apply modal fetch their own data', () => {
    assert.match(leaves, /const \{ data: summaryLeaves = \[\] \} = useLeavesList\(/); assert.match(leaves, /leaves=\{summaryLeaves\}/);
    assert.match(leaves, /const \{ data: upcomingRows = \[\] \} = useLeavesList\(/);
    assert.match(leaves, /allLeaves=\{modalLeaves\}/);
  });

  console.log('\n────────────────────────────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFAILED:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('\n✅  All Leaves pagination checks passed.');
})();
