/**
 * realdb_guard.js — safety guard for running the *_realdb.test.js suites.
 *
 * Why it exists: the real-DB suites connect to the database named in the root .env and are meant to touch ONLY a scratch
 * schema (bsv_*) via PGOPTIONS="-c search_path=bsv_*". On a developer machine that same database can also hold a copy of real
 * client data in `public`, and the suites TRUNCATE unqualified table names. This script lets you PROVE isolation before and
 * after a run. It never prints row contents and never writes to the database.
 *
 *   node backend/src/tests/helpers/realdb_guard.js fingerprint <file.json>   # per-table row count + md5 of all rows (schema public)
 *   node backend/src/tests/helpers/realdb_guard.js compare <file.json>       # exit 2 if public differs from the saved fingerprint
 *   PGOPTIONS="-c search_path=bsv_verify" node backend/src/tests/helpers/realdb_guard.js preflight
 *                                                                           # exit 3 unless current_schema is bsv_* and public is NOT on the path
 *
 * Typical run:
 *   node …/realdb_guard.js fingerprint /tmp/public_before.json
 *   PGOPTIONS="-c search_path=bsv_verify" node …/realdb_guard.js preflight
 *   REAL_DB_SCHEMA=bsv_verify node backend/src/tests/<suite>_realdb.test.js
 *   node …/realdb_guard.js compare /tmp/public_before.json
 *
 * Keep the fingerprint file OUT of the repo (it is derived from real data). Every *_realdb suite blanks SMTP_USER/SMTP_PASS so
 * it can never send real mail — do not remove that.
 */
'use strict';
const path = require('path');
const fs = require('fs');

const backend = path.join(__dirname, '../../..');                 // backend/
require(require.resolve('dotenv', { paths: [backend] })).config({ path: path.join(backend, '../.env') });
const { Pool } = require(require.resolve('pg', { paths: [backend] }));

const p = new Pool({ host: process.env.DB_HOST, port: +process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
const q = async (s, a) => (await p.query(s, a)).rows;

async function fingerprint() {
  const tabs = (await q("select tablename from pg_tables where schemaname='public' order by 1")).map(r => r.tablename);
  const out = {};
  for (const t of tabs) {
    out[t] = (await q(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)),'') h from public."${t}" x`))[0];
  }
  out.__sequences = await q("select sequencename, last_value from pg_sequences where schemaname='public' order by 1");
  out.__tables = tabs.length;
  return out;
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'fingerprint') {
    const f = await fingerprint();
    fs.writeFileSync(process.argv[3], JSON.stringify(f));
    console.log('public fingerprint saved:', f.__tables, 'tables,', Object.values(f).filter(v => v && v.n !== undefined).reduce((s, v) => s + v.n, 0), 'rows');
  } else if (cmd === 'compare') {
    const before = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
    const after = await fingerprint();
    const diffs = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    console.log(diffs.length ? 'PUBLIC CHANGED: ' + diffs.join(', ') : 'PUBLIC UNCHANGED (all ' + after.__tables + ' tables: identical row counts + hashes + sequences)');
    process.exitCode = diffs.length ? 2 : 0;
  } else if (cmd === 'preflight') {
    const sp = (await q('show search_path'))[0].search_path, cs = (await q('select current_schema() s'))[0].s;
    console.log('search_path =', sp, '| current_schema =', cs);
    if (!/^bsv_[a-z0-9_]+$/.test(cs) || /public/.test(sp)) { console.log('ABORT: not isolated'); process.exitCode = 3; } else console.log('preflight OK');
  } else {
    console.log('usage: realdb_guard.js fingerprint <file> | compare <file> | preflight');
    process.exitCode = 1;
  }
  await p.end();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
