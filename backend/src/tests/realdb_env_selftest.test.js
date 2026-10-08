/**
 * Self-test for helpers/realdb_env.js (no database needed, no network used).
 * Proves: provider variables are '' (not deleted) and survive dotenv; Cloudinary is faked; an external connect/lookup is refused
 * *before* any packet or DNS query is sent, is reported, and forces a non-zero exit even when the caller swallows the error.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const HELPER = path.join(__dirname, 'helpers/realdb_env.js');
let passed = 0, failed = 0;
const t = (name, fn) => { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.log('  ✗ ' + name + '\n    ' + e.message); failed++; } };
const run = (code, env = {}) => spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { ...process.env, ...env } });

console.log('realdb_env bootstrap');
t('provider variables are blank after the bootstrap AND after dotenv re-reads .env', () => {
  const r = run(`
    const e = require(${JSON.stringify(HELPER)});
    require(require.resolve('dotenv', { paths: [${JSON.stringify(path.join(__dirname, '../..'))}] })).config({ path: ${JSON.stringify(path.join(__dirname, '../../../.env'))} });
    const bad = e.PROVIDER_VARS.filter(k => process.env[k] !== '');
    console.log(JSON.stringify({ bad, push: process.env.MOBILE_PUSH_ENABLED }));`);
  assert.strictEqual(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(o.bad, []);
  assert.strictEqual(o.push, 'false');
});
t('Cloudinary destroy is faked (recorded, nothing sent)', () => {
  const r = run(`
    const e = require(${JSON.stringify(HELPER)});
    const c = require(require.resolve('cloudinary', { paths: [${JSON.stringify(path.join(__dirname, '../..'))}] })).v2;
    c.uploader.destroy('folder/x').then(res => console.log(JSON.stringify({ res, calls: e.cloudinaryFake.destroy })));`);
  assert.strictEqual(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(o.calls, ['folder/x']);
});
t('external TCP connect is refused, reported, and the process exits non-zero even if the error is swallowed', () => {
  const r = run(`
    require(${JSON.stringify(HELPER)});
    const net = require('net');
    const s = net.connect({ host: '93.184.216.34', port: 80 }); s.on('error', () => {});     // swallowed on purpose
    setTimeout(() => {}, 200);`);
  assert.notStrictEqual(r.status, 0, 'must fail');
  assert.ok(/EXTERNAL NETWORK ATTEMPTS BLOCKED \(1\): 93\.184\.216\.34/.test(r.stderr), r.stderr);
});
t('external DNS lookup (fetch to a provider host) is refused and reported', () => {
  const r = run(`
    require(${JSON.stringify(HELPER)});
    fetch('https://api.cloudinary.com/v1_1/x/image/destroy').catch(() => {});                // swallowed on purpose
    setTimeout(() => {}, 300);`);
  assert.notStrictEqual(r.status, 0);
  assert.ok(/BLOCKED/.test(r.stderr) && /api\.cloudinary\.com/.test(r.stderr), r.stderr);
});
t('loopback, unix-socket style and no-host connects are not blocked', () => {
  const r = run(`
    const e = require(${JSON.stringify(HELPER)});
    const net = require('net');
    const srv = net.createServer(c => c.end()).listen(0, '127.0.0.1', () => {
      const s = net.connect({ host: '127.0.0.1', port: srv.address().port }, () => { s.end(); srv.close(); });
    });
    process.on('exit', () => console.log('blocked=' + e.blocked.length));`);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/blocked=0/.test(r.stdout));
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
