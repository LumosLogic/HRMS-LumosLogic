/**
 * documents_lifecycle_realdb.test.js — Documents ↔ Onboarding / lifecycle fixes, verified against REAL PostgreSQL.
 *
 *   - final document approval completes the onboarding "Verify Documents" task (when ALL required docs are approved)
 *   - allow_reupload=false is enforced for employee self-service
 *   - expiry reminders actually fire (employee + responsible admins) on the configured lead time / 7 / 1 / 0 days
 *   - exited employees drop out of the verification queue and the compliance analytics
 *   - the existing review flow is unchanged (HR cannot give final approval; Root can)
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/documents_lifecycle_realdb.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'documents-realdb-test-secret';

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
const dstr = (d) => d.toISOString().split('T')[0];
const inDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return dstr(d); };

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['employee_doc_submissions', 'document_requirements', 'onboarding_checklists', 'notifications', 'doc_submission_activity'])
    await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  ID.org = (await one(`INSERT INTO organizations (name, slug) VALUES ('Doc Org','doc-org') RETURNING id`)).id;
  const user = async (name, role, status = 'active') => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date)
     VALUES ($1,$2,'x',$3,$4,$5,'active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@doc.test`, role, ID.org, status])).id;
  ID.root = await user('Root DC', 'root_admin'); ID.hr = await user('HR DC', 'admin');
  ID.emp = await user('Emp DC', 'employee'); ID.emp2 = await user('Emp DC2', 'employee'); ID.gone = await user('Gone DC', 'employee', 'terminated');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
  const req = async (name, o = {}) => (await one(
    `INSERT INTO document_requirements (organization_id, name, category, is_required, is_active, allow_reupload, expiry_reminder_days, applicable_to)
     VALUES ($1,$2,'identity',$3,true,$4,$5,'everyone') RETURNING id`, [ID.org, name, o.required !== false, o.reupload !== false, o.lead ?? 30])).id;
  ID.reqA = Number(await req('Aadhaar')); ID.reqB = Number(await req('PAN')); ID.reqNoReup = Number(await req('Offer Letter', { reupload: false, required: false }));
  ID.reqExp = Number(await req('Visa', { required: false, lead: 14 }));
}
const sub = async (uid, rid, status, extra = {}) => (await one(
  `INSERT INTO employee_doc_submissions (requirement_id, user_id, organization_id, file_url, file_name, file_type, status, expiry_date)
   VALUES ($1,$2,$3,'http://x/f.pdf','f.pdf','application/pdf',$4,$5) RETURNING id`, [rid, uid, ID.org, status, extra.expiry || null])).id;
const checklist = (uid) => S(`INSERT INTO onboarding_checklists (user_id, organization_id, title, assigned_to, order_index) VALUES ($1,$2,'Verify Documents','hr',6),($1,$2,'Create Company Email','hr',7) RETURNING id`, [uid, ID.org]);
const verifyDone = async (uid) => (await one(`select completed from onboarding_checklists where user_id=$1 and title='Verify Documents'`, [uid])).completed;

let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function call(method, url, { as, body, form } = {}) {
  const headers = {};
  if (!form) headers['Content-Type'] = 'application/json';
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  const r = await fetch(base + url, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const app = express(); app.use(express.json()); app.use('/api/doc-requirements', load('modules/documents/doc_requirements.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nDOCUMENTS → ONBOARDING');
  await t('HR can only HR-approve; that alone does not touch onboarding (existing two-step rule intact)', async () => {
    await checklist(ID.emp);
    const a = await sub(ID.emp, ID.reqA, 'under_review');
    await sub(ID.emp, ID.reqB, 'under_review');
    const r = await call('PATCH', `/api/doc-requirements/submissions/${a}/review`, { as: ID.hr, body: { action: 'approved' } });
    assert.strictEqual(r.status, 403);
    const h = await call('PATCH', `/api/doc-requirements/submissions/${a}/review`, { as: ID.hr, body: { action: 'hr_approved' } });
    assert.strictEqual(h.status, 200, JSON.stringify(h.body));
    assert.strictEqual(await verifyDone(ID.emp), false);
  });
  await t('final approval of the FIRST of two required documents does not complete "Verify Documents"; the second one does', async () => {
    const [a, b] = (await S(`select id, requirement_id from employee_doc_submissions where user_id=$1 order by id`, [ID.emp])).map(r => r.id);
    assert.strictEqual((await call('PATCH', `/api/doc-requirements/submissions/${a}/review`, { as: ID.root, body: { action: 'approved' } })).status, 200);
    assert.strictEqual(await verifyDone(ID.emp), false, 'one required document is still pending');
    assert.strictEqual((await call('PATCH', `/api/doc-requirements/submissions/${b}/review`, { as: ID.root, body: { action: 'approved' } })).status, 200);
    assert.strictEqual(await verifyDone(ID.emp), true, 'all required documents approved ⇒ task ticked');
    assert.strictEqual((await one(`select completed from onboarding_checklists where user_id=$1 and title='Create Company Email'`, [ID.emp])).completed, false, 'other tasks untouched');
  });
  await t('an employee with a rejected required document is NOT auto-verified', async () => {
    await checklist(ID.emp2);
    const a = await sub(ID.emp2, ID.reqA, 'under_review'); await sub(ID.emp2, ID.reqB, 'rejected');
    await call('PATCH', `/api/doc-requirements/submissions/${a}/review`, { as: ID.root, body: { action: 'approved' } });
    assert.strictEqual(await verifyDone(ID.emp2), false);
  });

  console.log('\nRE-UPLOAD RULE');
  await t('allow_reupload=false: employee cannot replace a submission already in the pipeline; can after HR rejects it', async () => {
    const id = await sub(ID.emp, ID.reqNoReup, 'under_review');
    const form = () => { const f = new FormData(); f.append('file', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'offer.pdf'); return f; };
    const r = await call('POST', `/api/doc-requirements/${ID.reqNoReup}/submit`, { as: ID.emp, form: form() });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.match(r.body.error, /re-upload is not allowed/);
    await S(`UPDATE employee_doc_submissions SET status='re_upload_requested' WHERE id=$1`, [id]);
    const r2 = await call('POST', `/api/doc-requirements/${ID.reqNoReup}/submit`, { as: ID.emp, form: form() });
    assert.notStrictEqual(r2.status, 400, 'once HR asks for a re-upload the employee may submit (Cloudinary is not configured here, so it fails later — not on the rule)');
  });

  console.log('\nEXPIRY REMINDERS');
  await t('approved document expiring on the configured lead time (14 days) notifies the employee and the admins; other days stay silent', async () => {
    await S(`DELETE FROM notifications`);
    await sub(ID.emp, ID.reqExp, 'approved', { expiry: inDays(14) });
    const n = await load('utils/cronJobs').runDocumentExpiryReminders(ID.org, dstr(new Date()));
    assert.ok(n >= 2, `expected employee + admin notifications, got ${n}`);
    assert.ok(await one(`select 1 from notifications where user_id=$1 and title='Document Expiring'`, [ID.emp]));
    assert.ok(await one(`select 1 from notifications where user_id=$1 and title='Employee Document Expiring'`, [ID.hr]));
    await S(`DELETE FROM notifications`);
    await S(`UPDATE employee_doc_submissions SET expiry_date=$1 WHERE requirement_id=$2`, [inDays(20), ID.reqExp]);
    assert.strictEqual(await load('utils/cronJobs').runDocumentExpiryReminders(ID.org, dstr(new Date())), 0, '20 days out: no reminder');
    await S(`UPDATE employee_doc_submissions SET expiry_date=$1 WHERE requirement_id=$2`, [inDays(1), ID.reqExp]);
    assert.ok(await load('utils/cronJobs').runDocumentExpiryReminders(ID.org, dstr(new Date())) >= 2, '1 day out: final reminder');
  });
  await t('no expiry reminders for an employee who has left', async () => {
    await S(`DELETE FROM notifications`); await S(`DELETE FROM employee_doc_submissions`);
    await sub(ID.gone, ID.reqExp, 'approved', { expiry: inDays(7) });
    assert.strictEqual(await load('utils/cronJobs').runDocumentExpiryReminders(ID.org, dstr(new Date())), 0);
  });

  console.log('\nLIFECYCLE VISIBILITY');
  await t('verification queue and analytics ignore exited employees', async () => {
    await S(`DELETE FROM employee_doc_submissions`);
    await sub(ID.emp, ID.reqA, 'under_review'); await sub(ID.gone, ID.reqA, 'under_review');
    const q = await call('GET', '/api/doc-requirements/verification-queue', { as: ID.hr });
    assert.strictEqual(q.status, 200, JSON.stringify(q.body));
    assert.deepStrictEqual([...new Set(q.body.map(r => Number(r.user_id)))], [ID.emp]);
    const a = await call('GET', '/api/doc-requirements/analytics', { as: ID.hr });
    assert.strictEqual(a.body.totalSubmissions, 1, 'terminated employee\'s submission is not counted');
    assert.strictEqual(a.body.totalEmployees, 2, 'working headcount = employee_status based (terminated excluded)');
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All documents-lifecycle real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
