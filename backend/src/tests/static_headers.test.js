// Cache-Control rules for the built frontend (utils/staticHeaders.js) + a real express.static round trip.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const express = require('express');
const { setStaticHeaders } = require('../utils/staticHeaders');

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n')[0]); } };
const cc = (p) => { const h = {}; setStaticHeaders({ setHeader: (k, v) => { h[k] = v; } }, p); return h['Cache-Control']; };

(async () => {
  console.log('\nSTATIC ASSET HEADERS');
  await t('hashed build output under /assets is cached for a year, immutable', () => {
    for (const f of ['/app/public/assets/index-LP3RzaB8.js', '/app/public/assets/Employees-Jvbhon8p.js', '/app/public/assets/index-BFVsz3TB.css', '/app/public/admin/assets/main-AbCdEf12.js', 'C:\\app\\public\\assets\\index-BFVsz3TB.css'])
      assert.strictEqual(cc(f), 'public, max-age=31536000, immutable', f);
  });
  await t('html is never cached; un-hashed files keep the default', () => {
    assert.match(cc('/app/public/index.html'), /no-store/);
    for (const f of ['/app/public/assets/logo.svg', '/app/public/sw.js', '/app/public/LogoWithoutName.svg', '/app/public/other/index-LP3RzaB8.js'])
      assert.strictEqual(cc(f), undefined, f);
  });
  await t('over real HTTP: immutable for a hashed asset, no-store for index.html', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-')); fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>'); fs.writeFileSync(path.join(dir, 'assets', 'index-LP3RzaB8.js'), 'x');
    const app = express(); app.use(express.static(dir, { setHeaders: setStaticHeaders }));
    const server = app.listen(0); const port = server.address().port;
    const get = (u) => new Promise((res) => http.get({ port, path: u }, (r) => { r.resume(); res(r.headers); }));
    try {
      assert.strictEqual((await get('/assets/index-LP3RzaB8.js'))['cache-control'], 'public, max-age=31536000, immutable');
      assert.match((await get('/index.html'))['cache-control'], /no-store/);
    } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
