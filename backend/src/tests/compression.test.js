// Response compression: real HTTP round trips through express with the SAME options server.js uses.
// Run: node src/tests/compression.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), zlib = require('zlib');
const express = require('express');
const { compression, compressionOptions } = require('../utils/compression');
const { setStaticHeaders } = require('../utils/staticHeaders');

let passed = 0, failed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n     ', String(e.message).split('\n')[0]); } };

const BIG_JSON = JSON.stringify(Array.from({ length: 400 }, (_, i) => ({ id: i, name: 'Employee ' + i, department: 'Engineering', status: 'approved', reason: 'family function' })));
const SMALL_JSON = JSON.stringify({ pending: 3, wfh_pending: 0 });
const JS = '/* app */\n' + 'export const fn = (a, b) => { return a + b + "some repeated text"; };\n'.repeat(400);
const PNG = crypto_random(5000);
function crypto_random(n) { return require('crypto').randomBytes(n); }   // incompressible

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmp-')); fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>' + 'x'.repeat(3000) + '</html>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-LP3RzaB8.js'), JS);
  fs.writeFileSync(path.join(dir, 'assets', 'logo-AbCdEf12.png'), PNG);

  const app = express();
  app.use('/iclock/', express.text({ type: '*/*' }));
  app.use(compression(compressionOptions));                       // same position as server.js: before static + API
  app.use(express.static(dir, { setHeaders: setStaticHeaders }));
  app.get('/api/big', (req, res) => res.set('Cache-Control', 'private, no-store').json(JSON.parse(BIG_JSON)));
  app.get('/api/small', (req, res) => res.json(JSON.parse(SMALL_JSON)));
  app.get('/api/csv', (req, res) => res.type('text/csv').send('a,b,c\n'.repeat(500)));
  app.get('/iclock/getrequest', (req, res) => res.type('text/plain').send('OK'.repeat(2000)));
  app.get('/api/sse', (req, res) => { res.setHeader('Content-Type', 'text/event-stream'); res.flushHeaders(); res.write('data: ' + 'x'.repeat(3000) + '\n\n'); setTimeout(() => res.end(), 50); });
  app.get('/api/zip', (req, res) => res.type('application/zip').send(PNG));
  const server = app.listen(0); const port = server.address().port;

  const get = (p, headers = {}) => new Promise((resolve, reject) => http.get({ port, path: p, headers, agent: false }, (r) => {
    const chunks = []; r.on('data', c => chunks.push(c)); r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, raw: Buffer.concat(chunks) }));
  }).on('error', reject));
  const gz = { 'Accept-Encoding': 'gzip' };
  const body = (r) => ({ gzip: () => zlib.gunzipSync(r.raw), br: () => zlib.brotliDecompressSync(r.raw) }[r.headers['content-encoding']] || (() => r.raw))().toString();

  try {
    console.log('\nCOMPRESSION');
    await t('JSON API response is gzipped, Vary set, and decompresses to the identical body', async () => {
      const r = await get('/api/big', gz);
      assert.strictEqual(r.headers['content-encoding'], 'gzip'); assert.match(r.headers.vary, /Accept-Encoding/i);
      assert.deepStrictEqual(JSON.parse(body(r)), JSON.parse(BIG_JSON));
      assert.ok(r.raw.length < BIG_JSON.length / 5, `expected >80% smaller, got ${r.raw.length} of ${BIG_JSON.length}`);
    });
    await t('hashed JS asset is gzipped AND keeps Cache-Control: public, max-age=31536000, immutable', async () => {
      const r = await get('/assets/index-LP3RzaB8.js', gz);
      assert.strictEqual(r.headers['content-encoding'], 'gzip');
      assert.strictEqual(r.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.strictEqual(body(r), JS);
    });
    await t('index.html is gzipped when large, and stays no-store', async () => {
      const r = await get('/index.html', gz);
      assert.strictEqual(r.headers['content-encoding'], 'gzip'); assert.match(r.headers['cache-control'], /no-store/);
    });
    await t('the app\'s own Cache-Control on an authenticated API response is untouched (not made cacheable)', async () => {
      assert.strictEqual((await get('/api/big', gz)).headers['cache-control'], 'private, no-store');
    });
    await t('CSV export is compressed too', async () => {
      assert.strictEqual((await get('/api/csv', gz)).headers['content-encoding'], 'gzip');
    });
    await t('responses under 1 KB are left alone (no Content-Encoding)', async () => {
      const r = await get('/api/small', gz);
      assert.strictEqual(r.headers['content-encoding'], undefined); assert.deepStrictEqual(JSON.parse(r.raw.toString()), JSON.parse(SMALL_JSON));
    });
    await t('already-compressed / binary types are not re-compressed (png, zip)', async () => {
      assert.strictEqual((await get('/assets/logo-AbCdEf12.png', gz)).headers['content-encoding'], undefined);
      assert.strictEqual((await get('/api/zip', gz)).headers['content-encoding'], undefined);
    });
    await t('a client that does not accept gzip gets the plain body (old browsers / tools)', async () => {
      for (const h of [{}, { 'Accept-Encoding': 'identity' }]) {
        const r = await get('/api/big', h);
        assert.strictEqual(r.headers['content-encoding'], undefined); assert.deepStrictEqual(JSON.parse(r.raw.toString()), JSON.parse(BIG_JSON));
      }
    });
    await t('a browser-style Accept-Encoding (gzip, deflate, br, zstd) gets a valid compressed body (Brotli q4 or gzip)', async () => {
      const r = await get('/api/big', { 'Accept-Encoding': 'gzip, deflate, br, zstd' });
      assert.ok(['br', 'gzip'].includes(r.headers['content-encoding']), 'got ' + r.headers['content-encoding']);
      assert.deepStrictEqual(JSON.parse(body(r)), JSON.parse(BIG_JSON));
    });
    await t('a gzip-only client always gets gzip (never an encoding it did not ask for)', async () => {
      assert.strictEqual((await get('/api/big', { 'Accept-Encoding': 'gzip' })).headers['content-encoding'], 'gzip');
      assert.strictEqual((await get('/api/big', { 'Accept-Encoding': 'br;q=0, gzip' })).headers['content-encoding'], 'gzip');
    });
    await t('biometric /iclock endpoints are never compressed', async () => {
      const r = await get('/iclock/getrequest', gz);
      assert.strictEqual(r.headers['content-encoding'], undefined); assert.strictEqual(r.raw.length, 4000);
    });
    await t('text/event-stream (live biometric logs) is never compressed, so it is not buffered', async () => {
      const r = await get('/api/sse', gz);
      assert.strictEqual(r.headers['content-encoding'], undefined); assert.match(r.raw.toString(), /^data: x+/);
    });
    await t('X-No-Compression opts a request out', async () => {
      assert.strictEqual((await get('/api/big', { ...gz, 'X-No-Compression': '1' })).headers['content-encoding'], undefined);
    });
    await t('server.js mounts compression before the body parsers, static files and routes', () => {
      const s = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
      const c = s.indexOf('app.use(compression(compressionOptions))');
      assert.ok(c > 0, 'compression is mounted');
      for (const later of ['app.use(express.json())', 'app.use(express.static(']) assert.ok(c < s.indexOf(later), 'compression precedes ' + later);
      assert.ok(c < s.indexOf("app.use('/api/"), 'compression precedes the API routes');
    });
  } finally { server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(`\n${'─'.repeat(60)}\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
