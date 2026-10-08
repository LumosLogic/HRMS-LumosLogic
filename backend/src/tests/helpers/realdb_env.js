/**
 * realdb_env.js — shared bootstrap for every *_realdb.test.js suite. REQUIRE IT FIRST, before dotenv or any app module:
 *
 *     require('./helpers/realdb_env');
 *
 * The suites run the real app against a scratch Postgres schema, but the root .env also holds live provider credentials.
 * This file makes an accidental external call impossible rather than merely unlikely:
 *
 *  1. Credentials: every external-service variable is set to '' (never deleted — dotenv re-fills deleted variables from .env
 *     but never overrides ones that are already set). Application code treats '' as "not configured".
 *  2. Cloudinary: the SDK's upload/destroy methods are replaced with in-memory fakes (calls are recorded, nothing is sent).
 *  3. Network tripwire: net.Socket#connect and dns.lookup refuse anything that is not loopback, a unix socket or the
 *     configured DB_HOST. A blocked attempt destroys the socket with EXTERNAL_NETWORK_BLOCKED, is printed, and makes the
 *     process exit non-zero even if the application swallowed the error (e.g. a try/catch around a best-effort call).
 *
 * A suite that genuinely needs one of these services must stub it itself (see bgv_realdb: global.fetch for SpringVerify).
 * When you add a new provider to the backend, add its variables to PROVIDER_VARS below.
 */
'use strict';
const path = require('path');
const net = require('net');
const dns = require('dns');

const backend = path.join(__dirname, '../../..');

// ── 1. credentials / endpoints of external services -> '' ────────────────────────────────────────────────────────────
const PROVIDER_VARS = [
  // e-mail
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_FROM_NAME',
  // background verification (SpringVerify). Suites that test BGV set their own values after this runs.
  'BGV_PROVIDER_MODE', 'SPRINGVERIFY_BASE_URL', 'SPRINGVERIFY_API_TOKEN', 'SPRINGVERIFY_PACKAGE_IDENTIFIER', 'SPRINGVERIFY_WEBHOOK_SECRET',
  // file storage
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CLOUDINARY_URL',
  // push (web + mobile)
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY',
  // Google Calendar
  'GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_CALENDAR_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
  // Supabase (legacy)
  'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
  // biometric collector shared secret
  'BIOMETRIC_COLLECTOR_KEY',
];
for (const k of PROVIDER_VARS) process.env[k] = '';
process.env.MOBILE_PUSH_ENABLED = 'false';

// ── 3. network tripwire (installed before the app is loaded) ─────────────────────────────────────────────────────────
const blocked = [];
const isLocal = (h) => {
  if (h === undefined || h === null || h === '') return true;            // default host = localhost
  h = String(h).toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || h === '0.0.0.0' || /^127\./.test(h) || h === String(process.env.DB_HOST || '').toLowerCase() && !!process.env.DB_HOST;
};
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  // Node passes either (options, cb), (port, host, cb), (path, cb) or the already-normalised array [options, cb].
  let o = Array.isArray(args[0]) ? args[0][0] : args[0];
  let host;
  if (o && typeof o === 'object') { if (o.path) return origConnect.apply(this, args); host = o.host; }
  else if (typeof o === 'string' && isNaN(Number(o))) return origConnect.apply(this, args);   // unix socket path
  else host = typeof args[1] === 'string' ? args[1] : undefined;
  if (isLocal(host)) return origConnect.apply(this, args);
  blocked.push(String(host));
  const err = new Error('EXTERNAL_NETWORK_BLOCKED: tests may not connect to ' + host);
  err.code = 'EXTERNAL_NETWORK_BLOCKED';
  process.nextTick(() => this.destroy(err));
  return this;
};
const origLookup = dns.lookup;
dns.lookup = function (hostname, ...rest) {
  if (!isLocal(hostname)) {
    blocked.push(String(hostname));
    const cb = rest[rest.length - 1];
    const err = new Error('EXTERNAL_NETWORK_BLOCKED: tests may not resolve ' + hostname); err.code = 'EXTERNAL_NETWORK_BLOCKED';
    if (typeof cb === 'function') return process.nextTick(cb, err);
  }
  return origLookup.call(this, hostname, ...rest);
};
process.on('exit', () => {
  if (blocked.length) {
    console.error(`\n❌ EXTERNAL NETWORK ATTEMPTS BLOCKED (${blocked.length}): ${[...new Set(blocked)].join(', ')}`);
    process.exitCode = 1;
  } else if (process.env.REALDB_NET_REPORT) {
    console.log(`\nExternal network attempts: 0 | Cloudinary calls faked: destroy=${fake.destroy.length} upload=${fake.upload.length}`);
  }
});

// ── 2. Cloudinary: in-memory fakes ───────────────────────────────────────────────────────────────────────────────────
const fake = { destroy: [], upload: [] };
try {
  const cloudinary = require(require.resolve('cloudinary', { paths: [backend] })).v2;
  cloudinary.uploader.destroy = async (publicId) => { fake.destroy.push(String(publicId)); return { result: 'not found' }; };
  cloudinary.uploader.upload = async () => { throw new Error('Cloudinary upload is disabled in tests'); };
  cloudinary.uploader.upload_stream = (opts, cb) => {
    const { PassThrough } = require('stream');
    const s = new PassThrough();
    s.on('finish', () => { fake.upload.push(true); if (typeof cb === 'function') cb(new Error('Cloudinary upload is disabled in tests')); });
    s.resume();
    return s;
  };
} catch { /* cloudinary not installed: nothing to fake */ }

module.exports = { blocked, cloudinaryFake: fake, PROVIDER_VARS };
