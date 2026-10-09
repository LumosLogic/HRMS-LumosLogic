/**
 * Static contract for page-navigation smoothness (no browser, no DB). Fails when someone re-introduces the patterns that made
 * module switching blink:
 *   • a layout rendering a bare <Outlet /> (a lazy page would then suspend to the app-level fallback and replace the sidebar)
 *   • the router without v7_startTransition
 *   • FeatureRoute showing the lock screen before the org's feature flags have loaded
 *   • a lazy route that has no entry in lib/routePrefetch.js
 *   • full-page reloads (window.location.href = / assign / replace) used for in-app navigation
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, '../../../client/src');
const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; } };

console.log('Navigation smoothness contract');

for (const f of ['AppLayout', 'RootLayout', 'EmployeeLayout']) {
  t(`${f}: pages render through <PageOutlet> (Suspense inside the content area), never a bare <Outlet />`, () => {
    const s = read(`components/layout/${f}.jsx`);
    assert.ok(/<PageOutlet\b/.test(s), 'PageOutlet missing');
    assert.ok(!/<Outlet\b/.test(s), 'bare <Outlet /> found');
  });
}

t('PageOutlet owns the Suspense boundary, resets scroll and fades with opacity only', () => {
  const s = read('components/layout/PageOutlet.jsx');
  assert.ok(/<Suspense fallback=\{<PageFallback \/>\}><Outlet \/><\/Suspense>/.test(s));
  assert.ok(/scrollTop = 0/.test(s));
  assert.ok(!/translate|transform/.test(s.replace(/\/\*[\s\S]*?\*\//g, '')), 'fade must be opacity only');
  const css = read('index.css');
  assert.ok(/@keyframes page-in \{ from \{ opacity: 0; \} to \{ opacity: 1; \} \}/.test(css));
  assert.ok(/prefers-reduced-motion[^}]*\.page-in/.test(css), 'reduced-motion opt-out missing');
  const dur = /\.page-in \{ animation: page-in (\d+)ms/.exec(css);
  assert.ok(dur && +dur[1] >= 120 && +dur[1] <= 180, 'duration must be 120-180 ms');
});

t('router uses v7_startTransition so the current page stays until the next one is ready', () => {
  assert.ok(/<BrowserRouter future=\{\{ v7_startTransition: true \}\}>/.test(read('App.jsx')));
});

t('FeatureRoute waits for the feature flags instead of flashing "Feature Not Available"', () => {
  const s = read('App.jsx');
  assert.ok(/useContext\(FeatureFlagsLoadedContext\)/.test(s));
  assert.ok(/if \(!flagsLoaded && !flagsLate\) return <PageFallback \/>/.test(s));
});

t('every lazy route in App.jsx has a chunk-prefetch entry (lib/routePrefetch.js is generated from them)', () => {
  const app = read('App.jsx'), pre = read('lib/routePrefetch.js');
  const lazy = {};
  for (const m of app.matchAll(/const (\w+)\s*=\s*lazy\(\(\) => import\('([^']+)'\)\)/g)) lazy[m[1]] = m[2];
  const missing = [];
  for (const m of app.matchAll(/<Route path="([^"]+)"\s+element=\{(.*?)\}\s*\/>/g)) {
    if (m[1].includes('*')) continue;
    const comps = [...m[2].matchAll(/<(\w+)\s*\/>/g)].map(x => x[1]).filter(c => lazy[c]);
    if (!comps.length) continue;
    if (!pre.includes(`'${m[1]}': PAGES.${comps[comps.length - 1]}`)) missing.push(m[1]);
  }
  assert.deepStrictEqual(missing, [], 'add these routes to client/src/lib/routePrefetch.js: ' + missing.join(', '));
});

t('sidebar links prefetch on hover / focus / touch', () => {
  for (const f of ['Sidebar', 'RootLayout', 'EmployeeLayout']) assert.ok(/prefetchProps\(/.test(read(`components/layout/${f}.jsx`)), f);
});

t('no full-page reload used for in-app navigation (location.href/assign/replace assignments)', () => {
  const bad = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(e.name) && /window\.location\.(href\s*=|assign\(|replace\()|\blocation\.href\s*=/.test(fs.readFileSync(p, 'utf8'))) bad.push(path.relative(SRC, p));
  } };
  walk(SRC);
  assert.deepStrictEqual(bad, [], 'in-app navigation must use the router: ' + bad.join(', '));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log('✅  All navigation contract checks passed.');
