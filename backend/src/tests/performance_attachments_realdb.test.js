/**
 * performance_attachments_realdb.test.js — goal attachment upload against REAL PostgreSQL.
 *
 * goal_attachments was created by three migrations with different MIME column names (`mime_type` / `file_type`).
 * The upload inserted `file_type` unconditionally → `column "file_type" of relation "goal_attachments" does not exist`
 * on databases built the other way. Proves: upload works on BOTH table shapes, and the new migration is idempotent.
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/performance_attachments_realdb.test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('./helpers/realdb_env');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'perf-attachments-test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const ID = {};
let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function upload(goalId, as) {
  const fd = new FormData();
  fd.append('file', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'proof.pdf');
  const r = await fetch(`${base}/api/performance/goals/${goalId}/attachments`, { method: 'POST', headers: { Authorization: 'Bearer ' + await tokenFor(as) }, body: fd });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const cols = async () => (await S(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'goal_attachments'`)).map(r => r.column_name);
const MIME_SHAPE = `CREATE TABLE goal_attachments (id BIGSERIAL PRIMARY KEY, goal_id BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE, organization_id BIGINT NOT NULL, uploaded_by BIGINT REFERENCES users(id), file_name TEXT NOT NULL, file_url TEXT NOT NULL, cloudinary_public_id TEXT, file_size BIGINT, mime_type TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
const FILE_TYPE_SHAPE = `CREATE TABLE goal_attachments (id BIGSERIAL PRIMARY KEY, goal_id BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE, organization_id BIGINT NOT NULL, file_url TEXT NOT NULL, file_name TEXT, file_type TEXT, file_size BIGINT, uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ DEFAULT NOW())`;
// The shared test helper makes every Cloudinary upload fail on purpose (no network). This test is about the DATABASE write,
// so give the route an in-memory "upload succeeded" instead — still no network.
{
  const cloudinary = require('cloudinary').v2;
  cloudinary.uploader.upload_stream = (opts, cb) => {
    const { PassThrough } = require('stream');
    const s = new PassThrough();
    s.on('finish', () => cb(null, { secure_url: 'https://files.invalid/proof.pdf', public_id: 'proof' }));
    s.resume();
    return s;
  };
}
const ROUTE = path.join(SRC, 'modules/performance/performance.routes');
let server;
// The route remembers which column this database has (once per process). A server restart is simulated by reloading it.
async function startServer() {
  if (server) await new Promise(r => server.close(r));
  delete require.cache[require.resolve(ROUTE)];
  const app = express(); app.use(express.json());
  app.use('/api/performance', load('modules/performance/performance.routes'));
  server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
}

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}).`); process.exit(0); }
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  ID.org = Number((await one(`INSERT INTO organizations (name, slug) VALUES ('Perf Org','perf-org') RETURNING id`)).id);
  const user = async (name, role) => Number((await one(`INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date) VALUES ($1,$2,'x',$3,$4,'active','active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@perf.test`, role, ID.org])).id);
  ID.root = await user('Root P', 'root_admin'); ID.emp = await user('Emp P', 'employee');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  ID.goal = Number((await one(`INSERT INTO performance_goals (user_id, title, organization_id) VALUES ($1,'G',$2) RETURNING id`, [ID.emp, ID.org])).id);

  console.log('\nGOAL ATTACHMENT UPLOAD on both table shapes');
  await t('database shaped like add_enhancements_2026_09_10 (mime_type, no file_type): upload succeeds and the type is stored', async () => {
    await S(`DROP TABLE IF EXISTS goal_attachments`); await S(MIME_SHAPE);
    assert.ok(!(await cols()).includes('file_type'));
    await startServer();
    const r = await upload(ID.goal, ID.root);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await one('select mime_type from goal_attachments')).mime_type, 'application/pdf');
  });
  await t('database shaped like qa_bugfix_2026_09_30 (file_type): upload succeeds and the type is stored', async () => {
    await S(`DROP TABLE IF EXISTS goal_attachments`); await S(FILE_TYPE_SHAPE);
    await startServer();
    const r = await upload(ID.goal, ID.root);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await one('select file_type from goal_attachments')).file_type, 'application/pdf');
  });
  await t('the employee who owns the goal can attach too; someone else\'s goal is refused', async () => {
    const other = await user('Emp Other', 'employee');
    assert.strictEqual((await upload(ID.goal, ID.emp)).status, 200);
    assert.strictEqual((await upload(ID.goal, other)).status, 403);
  });
  await t('migration add_goal_attachments_file_type adds file_type, back-fills it from mime_type, and is safe to run twice', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../migrations/add_goal_attachments_file_type_2026_10_09.sql'), 'utf8');
    await S(`DROP TABLE IF EXISTS goal_attachments`); await S(MIME_SHAPE);
    await S(`INSERT INTO goal_attachments (goal_id, organization_id, file_name, file_url, mime_type) VALUES ($1,$2,'a','u','image/png')`, [ID.goal, ID.org]);
    await pool.query(sql); await pool.query(sql);
    assert.ok((await cols()).includes('file_type'));
    assert.strictEqual((await one('select file_type from goal_attachments')).file_type, 'image/png');
    await S(`DROP TABLE goal_attachments`);
    await S(`CREATE TABLE goal_attachments (id BIGSERIAL PRIMARY KEY, goal_id BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE, organization_id BIGINT NOT NULL, file_name TEXT NOT NULL, file_url TEXT NOT NULL)`);
    await pool.query(sql);
    assert.ok((await cols()).includes('file_type'));
  });

  if (server) await new Promise(r => server.close(r));
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All goal-attachment real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
