/**
 * doc_requirement_edit_realdb.test.js — editing a document requirement UPDATES it in place, REAL PostgreSQL.
 *
 * Owner rule (2026-10-09): when HR edits a requirement (e.g. Required → Optional) the employee side must NOT see a new
 * requirement; each employee's existing submission (submitted / approved / rejected / re-upload requested) stays attached.
 * Proves: same id, same row count, submissions untouched, the employee sees the updated settings on the SAME entry,
 * and "Create" is the only action that adds a requirement.
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/doc_requirement_edit_realdb.test.js
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'doc-req-edit-test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 8).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const num = (v) => Number(v);
const ID = {};
let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function call(method, url, { as, body } = {}) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await tokenFor(as) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}).`); process.exit(0); }
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);

  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['document_requirements', 'employee_doc_submissions', 'doc_submission_activity']) await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  ID.org = num((await one(`INSERT INTO organizations (name, slug) VALUES ('Doc Org','doc-org') RETURNING id`)).id);
  const user = async (name, role) => num((await one(`INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date) VALUES ($1,$2,'x',$3,$4,'active','active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@doc.test`, role, ID.org])).id);
  ID.root = await user('Root D', 'root_admin');
  ID.approved = await user('Emp Approved', 'employee'); ID.rejected = await user('Emp Rejected', 'employee');
  ID.reup = await user('Emp ReUpload', 'employee'); ID.none = await user('Emp None', 'employee');
  ID.req = num((await one(
    `INSERT INTO document_requirements (organization_id, name, description, category, is_required, accepted_formats, max_file_size_mb, created_by)
     VALUES ($1,'Medical Certificate','Employee Health Record','other',true,ARRAY['pdf','jpg','png'],10,$2) RETURNING id`, [ID.org, ID.root])).id);
  const sub = async (uid, status, extra = {}) => num((await one(
    `INSERT INTO employee_doc_submissions (requirement_id, user_id, organization_id, file_url, file_name, status, rejection_reason, version)
     VALUES ($1,$2,$3,'https://files.invalid/x.pdf','x.pdf',$4,$5,2) RETURNING id`, [ID.req, uid, ID.org, status, extra.reason || null])).id);
  ID.sApproved = await sub(ID.approved, 'approved'); ID.sRejected = await sub(ID.rejected, 'rejected', { reason: 'blurry' }); ID.sReup = await sub(ID.reup, 're_upload_requested');

  const app = express(); app.use(express.json());
  app.use('/api/doc-requirements', load('modules/documents/doc_requirements.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;
  const mine = async (uid) => (await call('GET', '/api/doc-requirements', { as: uid })).body;
  const subsSnapshot = async () => JSON.stringify(await S(`SELECT id, requirement_id, user_id, status, rejection_reason, version, file_url FROM employee_doc_submissions ORDER BY id`));

  console.log('\nEDIT A REQUIREMENT');
  await t('Required → Optional (+ other settings): same requirement row, no new requirement, no submission touched', async () => {
    const before = await subsSnapshot();
    const r = await call('PATCH', `/api/doc-requirements/${ID.req}`, { as: ID.root, body: { is_required: false, accepted_formats: ['pdf'], max_file_size_mb: 5, display_order: 4 } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(num(r.body.id), ID.req);
    assert.strictEqual(num((await one('select count(*)::int c from document_requirements')).c), 1, 'still ONE requirement');
    assert.strictEqual(await subsSnapshot(), before, 'every submission is exactly as it was');
  });
  await t('each employee sees the SAME requirement, now optional, with their own submission unchanged (approved / rejected + reason / re-upload requested / none)', async () => {
    const view = async (uid) => { const l = await mine(uid); assert.strictEqual(l.length, 1, 'exactly one entry, not a second "new" requirement'); assert.strictEqual(num(l[0].id), ID.req); assert.strictEqual(l[0].is_required, false); assert.deepStrictEqual(l[0].accepted_formats, ['pdf']); return l[0]; };
    const a = await view(ID.approved); assert.strictEqual(a._submission.status, 'approved'); assert.strictEqual(num(a._submission.id), ID.sApproved);
    const b = await view(ID.rejected); assert.strictEqual(b._submission.status, 'rejected'); assert.strictEqual(b._submission.rejection_reason, 'blurry');
    const c = await view(ID.reup); assert.strictEqual(c._submission.status, 're_upload_requested'); assert.strictEqual(num(c._submission.id), ID.sReup);
    const d = await view(ID.none); assert.strictEqual(d._submission, null);
  });
  await t('renaming keeps the same row too (the label changes, the submissions stay attached)', async () => {
    const r = await call('PATCH', `/api/doc-requirements/${ID.req}`, { as: ID.root, body: { name: 'Medical Fitness Certificate' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const l = await mine(ID.approved);
    assert.strictEqual(l.length, 1); assert.strictEqual(l[0].name, 'Medical Fitness Certificate'); assert.strictEqual(l[0]._submission.status, 'approved');
  });
  await t('Optional → Required again also keeps everything (and deactivate / reactivate just hides / shows the same entry)', async () => {
    await call('PATCH', `/api/doc-requirements/${ID.req}`, { as: ID.root, body: { is_required: true } });
    assert.strictEqual((await mine(ID.rejected))[0].is_required, true);
    await call('PATCH', `/api/doc-requirements/${ID.req}`, { as: ID.root, body: { is_active: false } });
    assert.deepStrictEqual(await mine(ID.approved), []);
    await call('PATCH', `/api/doc-requirements/${ID.req}`, { as: ID.root, body: { is_active: true } });
    const l = await mine(ID.approved); assert.strictEqual(l.length, 1); assert.strictEqual(l[0]._submission.status, 'approved');
    assert.strictEqual(num((await one('select count(*)::int c from employee_doc_submissions')).c), 3);
  });
  await t('only CREATE adds a requirement', async () => {
    const r = await call('POST', '/api/doc-requirements', { as: ID.root, body: { name: 'Driving Licence', category: 'other', is_required: false, accepted_formats: ['pdf'] } });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    assert.strictEqual(num((await one('select count(*)::int c from document_requirements')).c), 2);
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All requirement-edit real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
