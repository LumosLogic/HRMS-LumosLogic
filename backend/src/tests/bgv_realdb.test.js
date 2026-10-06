/**
 * bgv_realdb.test.js — BGV (SpringVerify) integration against a REAL PostgreSQL scratch schema.
 * Same safety model as branch_realdb.test.js: only bsv_* schemas are accepted; only rows this test
 * creates (orgs with slug bgvtest-*) are inserted/deleted — nothing else in the schema is touched.
 *
 *   JWT_SECRET=x REAL_DB_SCHEMA=bsv_verify node src/tests/bgv_realdb.test.js
 */
const path = require('path');
const fs = require('fs');
const assert = require('assert');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_*`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'bgv-realdb-test-secret';
process.env.PAYROLL_SCHEDULER_ENABLED = 'false';
// Hermetic: never let real SpringVerify credentials from .env reach this test (no live calls, ever).
for (const k of ['SPRINGVERIFY_BASE_URL', 'SPRINGVERIFY_API_TOKEN', 'SPRINGVERIFY_PACKAGE_IDENTIFIER']) delete process.env[k];
process.env.BGV_PROVIDER_MODE = 'mock';
// The legacy invite route is disabled by default in the app; these older tests exercise it, so opt in here only.
process.env.BGV_LEGACY_INVITE_ENABLED = 'true';
process.env.SPRINGVERIFY_WEBHOOK_SECRET = 'whsec-test';
delete process.env.NODE_ENV;

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').slice(0, 5).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const ID = {};
let base;

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await cleanup();
  // project's own migration (BUG_157): scratch schema predates 'hr_approved' in the status CHECK
  await pool.query(fs.readFileSync(path.join(__dirname, '../migrations/fix_doc_submissions_status_constraint.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/add_bgv_springverify_2026_10_05.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/add_bgv_springverify_2026_10_05.sql'), 'utf8')); // idempotent

  const org = async (n, s) => Number((await one(`INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id`, [n, s])).id);
  ID.orgA = await org('BGV Org A', 'bgvtest-a'); ID.orgB = await org('BGV Org B', 'bgvtest-b');
  const br = async (o, n, c) => Number((await one(`INSERT INTO branches (org_id, name, code, is_active) VALUES ($1,$2,$3,true) RETURNING id`, [o, n, c])).id);
  ID.dalal = await br(ID.orgA, 'Dalal', 'BGD'); ID.bhuj = await br(ID.orgA, 'Bhuj', 'BGB');
  const user = async (o, name, role, branch) => Number((await one(
    `INSERT INTO users (name, email, password, role, organization_id, branch_id, employee_status, status, joining_date, phone)
     VALUES ($1,$2,'x',$3,$4,$5,'active','active','2025-01-01','9999999999') RETURNING id`,
    [name, `${name.toLowerCase().replace(/\W+/g, '.')}@bgvtest.com`, role, o, branch])).id);
  ID.root = await user(ID.orgA, 'BGV Root A', 'root_admin', null);
  ID.hrD = await user(ID.orgA, 'BGV HR Dalal', 'admin', null);
  ID.hrB = await user(ID.orgA, 'BGV HR Bhuj', 'admin', null);
  ID.empD = await user(ID.orgA, 'BGV Emp Dalal', 'employee', ID.dalal);
  ID.empB = await user(ID.orgA, 'BGV Emp Bhuj', 'employee', ID.bhuj);
  ID.empD2 = await user(ID.orgA, 'BGV Emp Dalal Two', 'employee', ID.dalal);
  ID.rootB = await user(ID.orgB, 'BGV Root B', 'root_admin', null);
  await S(`INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches) VALUES ($1,$2,$3,false),($4,$2,$5,false)`,
    [ID.hrD, ID.orgA, ID.dalal, ID.hrB, ID.bhuj]);
  await S(`INSERT INTO organization_features (organization_id, feature_key, enabled) VALUES ($1,'branches',true)`, [ID.orgA]);
  const rq = await one(`INSERT INTO document_requirements (organization_id, name) VALUES ($1,'BGV PAN') RETURNING id`, [ID.orgA]);
  ID.sub = Number((await one(`INSERT INTO employee_doc_submissions (requirement_id, user_id, organization_id, file_url) VALUES ($1,$2,$3,'http://x/f.pdf') RETURNING id`,
    [rq.id, ID.empD, ID.orgA])).id);
  ID.subB = Number((await one(`INSERT INTO employee_doc_submissions (requirement_id, user_id, organization_id, file_url) VALUES ($1,$2,$3,'http://x/g.pdf') RETURNING id`,
    [rq.id, ID.empB, ID.orgA])).id);
}
async function cleanup() {
  const orgs = (await S(`SELECT id FROM organizations WHERE slug LIKE 'bgvtest-%'`)).map(r => r.id);
  if (!orgs.length) return;
  for (const q of [
    `DELETE FROM bgv_events WHERE organization_id = ANY($1)`, `DELETE FROM bgv_requests WHERE organization_id = ANY($1)`,
    `DELETE FROM doc_submission_activity WHERE organization_id = ANY($1)`, `DELETE FROM notifications WHERE organization_id = ANY($1)`,
    `DELETE FROM employee_doc_submissions WHERE organization_id = ANY($1)`, `DELETE FROM document_requirements WHERE organization_id = ANY($1)`,
    `DELETE FROM hr_branch_access WHERE org_id = ANY($1)`, `DELETE FROM organization_features WHERE organization_id = ANY($1)`,
    `DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE organization_id = ANY($1))`,
    `DELETE FROM users WHERE organization_id = ANY($1)`, `DELETE FROM branches WHERE org_id = ANY($1)`,
    `DELETE FROM organizations WHERE id = ANY($1)`,
  ]) await pool.query(q, [orgs]).catch(e => { if (!/does not exist/.test(e.message)) throw e; });
}

function buildApp() {
  const app = express(); app.use(express.json());
  app.use('/api', load('middleware/featureFlag').featureGate);
  app.use('/api', load('modules/org/org.routes'));
  app.use('/api/platform', load('modules/platform/platform.routes'));
  app.use('/api/doc-requirements', load('modules/documents/doc_requirements.routes'));
  app.use('/api/bgv', load('modules/bgv/bgv.routes'));
  return app;
}
const tokenFor = async (id) => {
  const u = await one('select id, role, name, organization_id from users where id=$1', [id]);
  return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET);
};
async function call(method, url, { as, platform, body, headers: h = {} } = {}) {
  const headers = { 'Content-Type': 'application/json', ...h };
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  if (platform) headers.Authorization = 'Bearer ' + jwt.sign({ id: 1, role: 'platform_admin', email: 'p@x.com', name: 'P' }, process.env.JWT_SECRET);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const setFlag = (org, on) => S(`INSERT INTO organization_features (organization_id, feature_key, enabled) VALUES ($1,'bgv',$2)
  ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled`, [org, on]);
const hook = (body, secret = 'whsec-test') => call('POST', '/api/bgv/webhook', { body, headers: { 'x-bgv-mock-secret': secret } });
const bgvRow = (id) => one('SELECT * FROM bgv_requests WHERE id=$1', [id]);

(async () => {
  await seed();
  const server = buildApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nFeature flag');
  await t('missing row => bgv OFF in /features (org A has other flags)', async () => {
    const r = await call('GET', '/api/features', { as: ID.root });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.bgv, false);
    assert.strictEqual(r.body.branches, true, 'existing flag untouched');
  });
  await t('platform GET features: bgv false, plan platinum does NOT enable it', async () => {
    await S(`UPDATE organizations SET plan='free' WHERE id=$1`, [ID.orgA]);
    let r = await call('PATCH', `/api/platform/organizations/${ID.orgA}/plan`, { platform: true, body: { plan: 'platinum' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    r = await call('GET', `/api/platform/organizations/${ID.orgA}/features`, { platform: true });
    assert.strictEqual(r.body.bgv, false); assert.strictEqual(r.body.payroll, true, 'platinum still enables the rest');
    assert.strictEqual((await S(`SELECT 1 FROM organization_features WHERE organization_id=$1 AND feature_key='bgv'`, [ID.orgA])).length, 0);
  });
  await t('start BGV while OFF => 403, nothing created', async () => {
    const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD } });
    assert.strictEqual(r.status, 403);
    assert.strictEqual((await S('SELECT 1 FROM bgv_requests WHERE organization_id=$1', [ID.orgA])).length, 0);
  });
  await t('Platform Admin PUT bgv:true enables; /features reflects it', async () => {
    const r = await call('PUT', `/api/platform/organizations/${ID.orgA}/features`, { platform: true, body: { bgv: true, not_a_feature: true } });
    assert.strictEqual(r.body.updated, 1);
    assert.strictEqual((await call('GET', '/api/features', { as: ID.root })).body.bgv, true);
  });
  await t('new org (no rows) has bgv OFF', async () => {
    assert.strictEqual((await call('GET', '/api/features', { as: ID.rootB })).body.bgv, false);
  });

  console.log('\nStart / duplicate / concurrency');
  let reqD;
  await t('root starts BGV => 201 pending, links submission, no raw/report leaked', async () => {
    const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD, submission_id: ID.sub } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body)); reqD = r.body;
    assert.strictEqual(r.body.status, 'pending');
    assert.ok(!('raw_response' in r.body) && !('report_url' in r.body) && !('provider_candidate_id' in r.body));
    assert.strictEqual(Number(r.body.employee_doc_submission_id), ID.sub);
  });
  await t('duplicate active request => 409 with existing, no 2nd row', async () => {
    const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD } });
    assert.strictEqual(r.status, 409); assert.strictEqual(Number(r.body.existing.id), Number(reqD.id));
    assert.strictEqual((await S('SELECT 1 FROM bgv_requests WHERE employee_id=$1', [ID.empD])).length, 1);
  });
  await t('8 concurrent clicks => exactly one created', async () => {
    const rs = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } })));
    assert.strictEqual(rs.filter(r => r.status === 201).length, 1, rs.map(r => r.status).join());
    assert.strictEqual(rs.filter(r => r.status === 409).length, 7);
    assert.strictEqual((await S('SELECT 1 FROM bgv_requests WHERE employee_id=$1', [ID.empD2])).length, 1);
  });
  await t('submission of a different employee rejected (400)', async () => {
    const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2, submission_id: ID.sub } });
    assert.ok([400, 409].includes(r.status)); // 400 validation happens before slot reservation
    assert.strictEqual(r.status, 400);
  });

  console.log('\nSecurity (RBAC / branch / org)');
  await t('employee cannot list/start/read', async () => {
    for (const [m, u, b] of [['GET', '/api/bgv/requests'], ['POST', '/api/bgv/requests', { employee_id: ID.empD }], ['GET', `/api/bgv/requests/${reqD.id}`]])
      assert.strictEqual((await call(m, u, { as: ID.empD, body: b })).status, 403);
  });
  await t('unauthenticated => 401', async () => {
    assert.strictEqual((await call('GET', '/api/bgv/requests')).status, 401);
  });
  await t('HR Dalal: sees Dalal request, not Bhuj; cannot start for Bhuj employee', async () => {
    const list = (await call('GET', '/api/bgv/requests', { as: ID.hrD })).body;
    assert.ok(list.length >= 1 && list.every(r => [ID.empD, ID.empD2].includes(Number(r.employee_id))));
    const r = await call('POST', '/api/bgv/requests', { as: ID.hrD, body: { employee_id: ID.empB } });
    assert.strictEqual(r.status, 403);
  });
  await t('HR Bhuj cannot read Dalal request by id (404) or its report', async () => {
    assert.strictEqual((await call('GET', `/api/bgv/requests/${reqD.id}`, { as: ID.hrB })).status, 404);
    assert.strictEqual((await call('GET', `/api/bgv/requests/${reqD.id}/report`, { as: ID.hrB })).status, 404);
    assert.strictEqual((await call('GET', '/api/bgv/requests', { as: ID.hrB })).body.length, 0);
  });
  await t('Org B root cannot see or start for Org A employee', async () => {
    assert.strictEqual((await call('GET', `/api/bgv/requests/${reqD.id}`, { as: ID.rootB })).status, 404);
    assert.strictEqual((await call('GET', '/api/bgv/requests', { as: ID.rootB })).body.length, 0);
    await setFlag(ID.orgB, true);
    assert.strictEqual((await call('POST', '/api/bgv/requests', { as: ID.rootB, body: { employee_id: ID.empD } })).status, 403);
    await setFlag(ID.orgB, false);
  });

  console.log('\nWebhook');
  const cand = (await bgvRow(reqD.id)).provider_candidate_id;
  await t('bad / missing secret => 401, state unchanged', async () => {
    assert.strictEqual((await hook({ event_id: 'e0', candidate_id: cand, status: 'completed' }, 'wrong')).status, 401);
    assert.strictEqual((await call('POST', '/api/bgv/webhook', { body: { event_id: 'e0', candidate_id: cand, status: 'completed' } })).status, 401);
    assert.strictEqual((await bgvRow(reqD.id)).status, 'pending');
  });
  await t('malformed payload => 400', async () => {
    assert.strictEqual((await hook({ candidate_id: cand })).status, 400);
  });
  await t('in_progress event updates request; org/employee in payload are ignored', async () => {
    const r = await hook({ event_id: 'e1', candidate_id: cand, status: 'in_progress', organization_id: ID.orgB, employee_id: ID.empB });
    assert.strictEqual(r.status, 200);
    const row = await bgvRow(reqD.id);
    assert.strictEqual(row.status, 'in_progress'); assert.strictEqual(Number(row.organization_id), ID.orgA); assert.strictEqual(Number(row.employee_id), ID.empD);
  });
  await t('duplicate event id => processed once', async () => {
    const r = await hook({ event_id: 'e1', candidate_id: cand, status: 'failed' });
    assert.strictEqual(r.body.duplicate, true);
    assert.strictEqual((await bgvRow(reqD.id)).status, 'in_progress');
    assert.strictEqual((await S(`SELECT 1 FROM bgv_events WHERE provider_event_id='e1'`)).length, 1);
  });
  await t('unknown candidate => 200, stored without org, nothing updated', async () => {
    assert.strictEqual((await hook({ event_id: 'e-unk', candidate_id: 'nope', status: 'completed' })).status, 200);
    const ev = await one(`SELECT * FROM bgv_events WHERE provider_event_id='e-unk'`);
    assert.ok(ev && ev.organization_id === null && ev.bgv_request_id === null);
  });
  await t('unmapped provider status recorded, state unchanged', async () => {
    assert.strictEqual((await hook({ event_id: 'e-x', candidate_id: cand, status: 'weird_status' })).status, 200);
    assert.strictEqual((await bgvRow(reqD.id)).status, 'in_progress');
  });
  await t('completed with non-https report URL: completes, URL not stored', async () => {
    await hook({ event_id: 'e2', candidate_id: cand, status: 'completed', report_url: 'javascript:alert(1)' });
    const row = await bgvRow(reqD.id); assert.strictEqual(row.status, 'completed'); assert.strictEqual(row.report_url, null);
  });
  await t('terminal state is not regressed by later/late events', async () => {
    await hook({ event_id: 'e3', candidate_id: cand, status: 'in_progress' });
    await hook({ event_id: 'e4', candidate_id: cand, status: 'failed' });
    assert.strictEqual((await bgvRow(reqD.id)).status, 'completed');
  });

  console.log('\nReport + audit + re-run');
  // use a second completed request with a valid https report
  await S(`UPDATE bgv_requests SET report_url='https://reports.example/r1.pdf', status='completed' WHERE id=$1`, [reqD.id]);
  await t('HR (in-branch) gets report URL, access is audited; has_report true', async () => {
    const r = await call('GET', `/api/bgv/requests/${reqD.id}/report`, { as: ID.hrD });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.url, 'https://reports.example/r1.pdf');
    assert.strictEqual((await call('GET', `/api/bgv/requests/${reqD.id}`, { as: ID.hrD })).body.has_report, true);
    assert.ok(await one(`SELECT 1 x FROM bgv_events WHERE bgv_request_id=$1 AND event_type='report_accessed' AND actor_id=$2`, [reqD.id, ID.hrD]));
  });
  await t('audit trail has requested + completed', async () => {
    const types = (await S(`SELECT event_type FROM bgv_events WHERE bgv_request_id=$1 AND source='audit'`, [reqD.id])).map(r => r.event_type);
    assert.ok(types.includes('requested') && types.includes('completed'), types.join());
  });
  await t('after completion a NEW request is allowed (slot released)', async () => {
    assert.strictEqual((await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD } })).status, 201);
  });
  await t('disabling bgv: history still readable, start blocked', async () => {
    await setFlag(ID.orgA, false);
    assert.strictEqual((await call('GET', '/api/bgv/requests', { as: ID.root })).status, 200);
    assert.strictEqual((await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empB } })).status, 403);
    assert.strictEqual((await call('GET', '/api/features', { as: ID.root })).body.bgv, false);
    await setFlag(ID.orgA, true);
  });

  console.log('\nProvider failures');
  await t('springverify mode with incomplete config => 503, no row reserved, webhook refused', async () => {
    process.env.BGV_PROVIDER_MODE = 'springverify';
    const before = (await S('SELECT 1 FROM bgv_requests')).length;
    const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empB } });
    assert.strictEqual(r.status, 503);
    assert.strictEqual((await S('SELECT 1 FROM bgv_requests')).length, before);
    assert.notStrictEqual((await hook({ candidate_id: 1, overall_status_code: 1 })).status, 200);
    process.env.BGV_PROVIDER_MODE = 'mock';
  });
  await t('no provider configured / mock in production => 503, no row reserved', async () => {
    const before = (await S('SELECT 1 FROM bgv_requests')).length;
    delete process.env.BGV_PROVIDER_MODE;
    assert.strictEqual((await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } })).status, 503, 'provider checked before reserving a slot');
    process.env.BGV_PROVIDER_MODE = 'mock'; process.env.NODE_ENV = 'production';
    await S(`UPDATE bgv_requests SET status='cancelled' WHERE employee_id=$1`, [ID.empD2]);
    const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } });
    delete process.env.NODE_ENV;
    assert.strictEqual(r.status, 503);
    assert.strictEqual((await S('SELECT 1 FROM bgv_requests')).length, before);
  });

  console.log('\nSpringVerify provider (outbound HTTP stubbed, DB real)');
  {
    const realFetch = global.fetch; const sent = [];
    const BASE_SV = 'https://api-acceptance-2-sa.in.springverify.com';
    let addReply = () => ({ status: 200, json: { message: 'Candidate added successfully', data: { candidate_id: 777001, bgv_url: 'https://portal/candidate/bgv?token=SECRETLINK', meta_data: {} } } });
    global.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.startsWith(BASE_SV)) return realFetch(url, opts);
      sent.push({ url: u, opts });
      if (u.includes('/candidate/add')) { const x = addReply(); if (x.throw) throw x.throw; return new Response(JSON.stringify(x.json), { status: x.status }); }
      if (u.includes('/report/pdf')) return new Response(JSON.stringify({ report: Buffer.from('%PDF-fake').toString('base64') }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    Object.assign(process.env, { BGV_PROVIDER_MODE: 'springverify', SPRINGVERIFY_BASE_URL: BASE_SV,
      SPRINGVERIFY_API_TOKEN: 'tok-secret', SPRINGVERIFY_PACKAGE_IDENTIFIER: '525', SPRINGVERIFY_WEBHOOK_SECRET: 'whsec-sv' });
    await S(`UPDATE bgv_requests SET status='cancelled' WHERE organization_id=$1 AND status IN ('pending','in_progress')`, [ID.orgA]);
    await setFlag(ID.orgA, true);
    const svHook = (body, auth = 'Bearer whsec-sv') => call('POST', '/api/bgv/webhook', { body, headers: auth ? { authorization: auth } : {} });
    const addCalls = () => sent.filter(x => x.url.endsWith('/candidate/add')).length;
    const lastErr = async (emp) => (await one(`SELECT error_message FROM bgv_requests WHERE employee_id=$1 ORDER BY id DESC LIMIT 1`, [emp])).error_message;
    let svReq;

    await t('start => POST /candidate/add with bearer token, invite:true, subtype_id; candidate id stored; bgv_url NOT stored', async () => {
      const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empB, submission_id: ID.subB } });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body)); svReq = r.body;
      const c = sent.find(x => x.url.endsWith('/external/v1/candidate/add'));
      assert.strictEqual(c.opts.method, 'POST'); assert.strictEqual(c.opts.headers.Authorization, 'Bearer tok-secret');
      const body = JSON.parse(c.opts.body);
      assert.strictEqual(body.package.subtype_id, 525); assert.strictEqual(body.candidate.invite, true);
      assert.strictEqual(body.candidate.phone, '9999999999'); assert.ok(/^[\p{L}\s.\-]+$/u.test(body.candidate.name), body.candidate.name);
      const row = await bgvRow(svReq.id);
      assert.strictEqual(row.provider, 'springverify'); assert.strictEqual(row.provider_candidate_id, '777001');
      assert.strictEqual(row.status, 'pending'); assert.strictEqual(row.provider_status, '3');
      assert.ok(!JSON.stringify(row.raw_response).includes('SECRETLINK'), 'candidate link must not be persisted');
      assert.ok(!JSON.stringify(r.body).includes('tok-secret'));
    });
    await t('webhook auth: missing / wrong bearer => 401; correct => 200', async () => {
      assert.strictEqual((await svHook({ candidate_id: 777001, overall_status_code: 4 }, null)).status, 401);
      assert.strictEqual((await svHook({ candidate_id: 777001, overall_status_code: 4 }, 'Bearer nope')).status, 401);
      assert.strictEqual((await bgvRow(svReq.id)).status, 'pending');
      assert.strictEqual((await svHook({ event: 'status_update', candidate_id: 777001, overall_status_code: 4, overall_status: 'Processing', name: 'PII', email: 'pii@x.com' })).status, 200);
      assert.strictEqual((await bgvRow(svReq.id)).status, 'in_progress');
    });
    await t('webhook payload minimised in bgv_events (no name/email/report_url)', async () => {
      const ev = await one(`SELECT payload FROM bgv_events WHERE provider='springverify' AND provider_event_id='777001:4'`);
      assert.ok(ev && !('name' in ev.payload) && !('email' in ev.payload) && !('report_url' in ev.payload));
    });
    await t('idempotency key candidate_id:status_code => duplicate push ignored', async () => {
      const r = await svHook({ event: 'status_update', candidate_id: 777001, overall_status_code: 4 });
      assert.strictEqual(r.body.duplicate, true);
    });
    await t('duplicate active request blocked (409), no 2nd POST to provider', async () => {
      const n = addCalls();
      assert.strictEqual((await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empB } })).status, 409);
      assert.strictEqual(addCalls(), n);
    });
    await t('completed (code 1; signed report_url ignored) => report fetched on demand as base64 PDF, audited', async () => {
      await svHook({ event: 'completed', candidate_id: 777001, overall_status_code: 1, overall_status: 'completed', report_url: 'https://signed.example/expiring.pdf' });
      const row = await bgvRow(svReq.id); assert.strictEqual(row.status, 'completed'); assert.strictEqual(row.report_url, null);
      assert.strictEqual((await call('GET', `/api/bgv/requests/${svReq.id}`, { as: ID.root })).body.has_report, true);
      const r = await call('GET', `/api/bgv/requests/${svReq.id}/report`, { as: ID.root });
      assert.strictEqual(r.status, 200); assert.strictEqual(Buffer.from(r.body.pdf_base64, 'base64').toString(), '%PDF-fake');
      const g = sent.find(x => x.url.includes('/report/pdf')); assert.ok(g.url.includes('candidate_id=777001') && g.url.includes('report_type=base_64'));
      assert.ok(await one(`SELECT 1 x FROM bgv_events WHERE bgv_request_id=$1 AND event_type='report_accessed'`, [svReq.id]));
    });
    await t('report: HR of another branch => 404 and no provider call', async () => {
      const n = sent.filter(x => x.url.includes('/report/pdf')).length;
      assert.strictEqual((await call('GET', `/api/bgv/requests/${svReq.id}/report`, { as: ID.hrD })).status, 404);
      assert.strictEqual(sent.filter(x => x.url.includes('/report/pdf')).length, n);
    });
    await t('409 duplicate candidate => 502 friendly message, row failed, slot free', async () => {
      addReply = () => ({ status: 409, json: { message: 'Candidate already exists' } });
      const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } });
      assert.strictEqual(r.status, 502); assert.strictEqual(r.body.code, 'DUPLICATE_CANDIDATE'); assert.ok(/already exists/.test(r.body.error));
      assert.ok(!/unknown/i.test(await lastErr(ID.empD2)));
    });
    await t('network failure and 5xx => failed with "Outcome unknown" warning', async () => {
      addReply = () => ({ throw: new TypeError('fetch failed') });
      assert.strictEqual((await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } })).status, 502);
      assert.ok(/Outcome unknown/.test(await lastErr(ID.empD2)));
      addReply = () => ({ status: 500, json: {} });
      assert.strictEqual((await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } })).status, 502);
      assert.ok(/Outcome unknown/.test(await lastErr(ID.empD2)));
    });
    await t('401 from SpringVerify => AUTH_FAILED; token never in response', async () => {
      addReply = () => ({ status: 401, json: { msg: 'Invalid token' } });
      const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } });
      assert.strictEqual(r.body.code, 'AUTH_FAILED'); assert.ok(!JSON.stringify(r.body).includes('tok-secret'));
    });
    await t('200 without candidate_id => PROVIDER_BAD_RESPONSE + outcome unknown', async () => {
      addReply = () => ({ status: 200, json: { message: 'ok', data: {} } });
      const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empD2 } });
      assert.strictEqual(r.body.code, 'PROVIDER_BAD_RESPONSE'); assert.ok(/Outcome unknown/.test(await lastErr(ID.empD2)));
    });
    await t('status code mapping', async () => {
      const sv = load('modules/bgv/springverify.client');
      assert.deepStrictEqual([0, 1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 99].map(c => sv.mapStatus(c)),
        ['in_progress', 'completed', 'pending', 'in_progress', 'in_progress', 'completed', 'cancelled', 'in_progress', 'cancelled', 'pending', 'in_progress', null]);
    });
    await t('config guards: non-springverify host / http / non-integer package => refused before any call', async () => {
      const n = sent.length; const sv = load('modules/bgv/springverify.client');
      for (const [k, v] of [['SPRINGVERIFY_BASE_URL', 'https://evil.example.com'], ['SPRINGVERIFY_BASE_URL', 'http://api-acceptance-2-sa.in.springverify.com'],
                            ['SPRINGVERIFY_PACKAGE_IDENTIFIER', 'ID+ADD+EDU+EMP']]) {
        const old = process.env[k]; process.env[k] = v;
        assert.throws(() => sv.ensureReady(), /SPRINGVERIFY_/); process.env[k] = old;
      }
      assert.strictEqual(sent.length, n);
    });
    global.fetch = realFetch;
    process.env.BGV_PROVIDER_MODE = 'mock';
    for (const k of ['SPRINGVERIFY_BASE_URL', 'SPRINGVERIFY_API_TOKEN', 'SPRINGVERIFY_PACKAGE_IDENTIFIER']) delete process.env[k];
    await S(`UPDATE bgv_requests SET status='cancelled' WHERE organization_id=$1 AND status IN ('pending','in_progress')`, [ID.orgA]);
  }

  console.log('\nDocuments regression (BGV ON)');
  await t('review endpoint unchanged: HR hr_approved, root approved; statuses intact', async () => {
    let r = await call('PATCH', `/api/doc-requirements/submissions/${ID.sub}/review`, { as: ID.hrD, body: { action: 'hr_approved' } });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body.status, 'hr_approved');
    r = await call('PATCH', `/api/doc-requirements/submissions/${ID.sub}/review`, { as: ID.hrD, body: { action: 'approved' } });
    assert.strictEqual(r.status, 403, 'HR still cannot give final approval');
    r = await call('PATCH', `/api/doc-requirements/submissions/${ID.sub}/review`, { as: ID.root, body: { action: 'approved' } });
    assert.strictEqual(r.body.status, 'approved');
    r = await call('PATCH', `/api/doc-requirements/submissions/${ID.sub}/review`, { as: ID.root, body: { action: 'rejected' } });
    assert.strictEqual(r.status, 400, 'reason still required');
    r = await call('PATCH', `/api/doc-requirements/submissions/${ID.sub}/review`, { as: ID.root, body: { action: 'rejected', reason: 'blurry' } });
    assert.strictEqual(r.body.status, 'rejected');
    r = await call('GET', '/api/doc-requirements/verification-queue', { as: ID.root });
    assert.ok(Array.isArray(r.body) && r.body.length === 2);
    assert.ok(!r.body.some(s => 'bgv' in s), 'verification-queue response format unchanged');
  });
  await t('documents unaffected with BGV OFF (feature gate still works)', async () => {
    await setFlag(ID.orgA, false);
    const r = await call('GET', '/api/doc-requirements/verification-queue', { as: ID.root });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await call('PATCH', `/api/doc-requirements/submissions/${ID.subB}/review`, { as: ID.root, body: { action: 'approved' } })).body.status, 'approved');
  });
  await t('auto-trigger absent: review/upload never creates BGV rows', async () => {
    const n = (await S(`SELECT count(*)::int c FROM bgv_requests WHERE employee_doc_submission_id IN ($1,$2) AND requested_by IS NULL`, [ID.sub, ID.subB]))[0].c;
    assert.strictEqual(n, 0);
  });

  console.log('\nScaffold: legacy disabled / review / submit / refresh (fail-closed, no network)');
  {
    const realFetch = global.fetch; const outbound = [];
    global.fetch = async (url, opts) => {
      if (/springverify\.com/i.test(String(url))) { outbound.push(String(url)); throw new Error('NO NETWORK ALLOWED IN SCAFFOLD TESTS'); }
      return realFetch(url, opts);
    };
    Object.assign(process.env, { BGV_PROVIDER_MODE: 'springverify', SPRINGVERIFY_BASE_URL: 'https://api-acceptance-2-sa.in.springverify.com',
      SPRINGVERIFY_API_TOKEN: 'tok-secret', SPRINGVERIFY_PACKAGE_IDENTIFIER: '525' });
    await setFlag(ID.orgA, true);
    const count = async () => (await S('SELECT 1 FROM bgv_requests WHERE organization_id=$1', [ID.orgA])).length;

    await t('legacy POST /requests is disabled by default (410): no provider call, no row, even for a fully configured springverify', async () => {
      delete process.env.BGV_LEGACY_INVITE_ENABLED;
      const n = await count();
      const r = await call('POST', '/api/bgv/requests', { as: ID.root, body: { employee_id: ID.empB } });
      process.env.BGV_LEGACY_INVITE_ENABLED = 'true';
      assert.strictEqual(r.status, 410); assert.strictEqual(r.body.code, 'LEGACY_INVITE_DISABLED');
      assert.strictEqual(await count(), n); assert.deepStrictEqual(outbound, []);
    });

    await t('review: only APPROVED docs, no file URLs, employee-level, submit not enabled', async () => {
      const r = await call('GET', `/api/bgv/employees/${ID.empB}/review`, { as: ID.root });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.documents.length, 1); assert.strictEqual(Number(r.body.documents[0].submission_id), ID.subB);
      assert.ok(!JSON.stringify(r.body).includes('http://x'), 'file_url must not reach the browser');
      assert.strictEqual(r.body.ready, true); assert.strictEqual(r.body.submit_enabled, false);
      const d = await call('GET', `/api/bgv/employees/${ID.empD}/review`, { as: ID.root }); // its only doc is rejected
      assert.strictEqual(d.body.documents.length, 0); assert.strictEqual(d.body.ready, false);
      assert.ok(d.body.missing.some(m => m.field === 'documents'));
    });

    await t('review/submit RBAC: employee 403, HR of other branch 403, other org 403, BGV off 403', async () => {
      for (const [m, u] of [['GET', `/api/bgv/employees/${ID.empB}/review`], ['POST', `/api/bgv/employees/${ID.empB}/submit`]]) {
        assert.strictEqual((await call(m, u, { as: ID.empB })).status, 403);
        assert.strictEqual((await call(m, u, { as: ID.hrD })).status, 403, 'Dalal HR vs Bhuj employee');
        assert.strictEqual((await call(m, u, { as: ID.rootB })).status, 403);
      }
      assert.strictEqual((await call('GET', `/api/bgv/employees/${ID.empB}/review`)).status, 401);
      await setFlag(ID.orgA, false);
      assert.strictEqual((await call('GET', `/api/bgv/employees/${ID.empB}/review`, { as: ID.root })).status, 403);
      await setFlag(ID.orgA, true);
    });

    await t('submit is FAIL-CLOSED (501): no network, no bgv_requests row, HR edits NOT saved to the profile, audited', async () => {
      const before = await one('SELECT phone, address, date_of_birth FROM users WHERE id=$1', [ID.empB]);
      const n = await count();
      const r = await call('POST', `/api/bgv/employees/${ID.empB}/submit`, { as: ID.hrB,
        body: { fields: { phone: '8888888888', address: 'Temp address', date_of_birth: '1990-01-01', is_admin: true } } });
      assert.strictEqual(r.status, 501, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'SUBMIT_CONTRACT_NOT_CONFIRMED');
      assert.deepStrictEqual(outbound, []); assert.strictEqual(await count(), n);
      assert.deepStrictEqual(await one('SELECT phone, address, date_of_birth FROM users WHERE id=$1', [ID.empB]), before);
      assert.ok(await one(`SELECT 1 x FROM bgv_events WHERE event_type='submit_blocked' AND actor_id=$1`, [ID.hrB]));
    });

    await t('submit with missing info / no approved docs => 400 listing what is missing (nothing sent)', async () => {
      const r = await call('POST', `/api/bgv/employees/${ID.empD}/submit`, { as: ID.root, body: {} });
      assert.strictEqual(r.status, 400); assert.ok(r.body.missing.some(m => m.field === 'documents'));
      assert.deepStrictEqual(outbound, []);
    });

    await t('submit in mock mode (no submitBgv) is also blocked 501', async () => {
      process.env.BGV_PROVIDER_MODE = 'mock';
      const r = await call('POST', `/api/bgv/employees/${ID.empB}/submit`, { as: ID.root, body: {} });
      process.env.BGV_PROVIDER_MODE = 'springverify';
      assert.strictEqual(r.status, 501); assert.strictEqual(r.body.code, 'SUBMIT_CONTRACT_NOT_CONFIRMED');
    });

    let activeId;
    await t('refresh is FAIL-CLOSED (501): no network, request state untouched, audited', async () => {
      activeId = Number((await one(`INSERT INTO bgv_requests (organization_id, employee_id, provider, provider_candidate_id, status, provider_status)
        VALUES ($1,$2,'springverify','888001','in_progress','0') RETURNING id`, [ID.orgA, ID.empB])).id);
      const r = await call('POST', `/api/bgv/requests/${activeId}/refresh`, { as: ID.hrB });
      assert.strictEqual(r.status, 501, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'STATUS_CONTRACT_NOT_CONFIRMED');
      assert.deepStrictEqual(outbound, []);
      const row = await bgvRow(activeId); assert.strictEqual(row.status, 'in_progress'); assert.strictEqual(row.provider_status, '0');
      assert.ok(await one(`SELECT 1 x FROM bgv_events WHERE bgv_request_id=$1 AND event_type='refresh_blocked'`, [activeId]));
    });
    await t('refresh RBAC/scope: employee 403, other-branch HR 404, other org 403, unauth 401, BGV off 403', async () => {
      assert.strictEqual((await call('POST', `/api/bgv/requests/${activeId}/refresh`, { as: ID.empB })).status, 403);
      assert.strictEqual((await call('POST', `/api/bgv/requests/${activeId}/refresh`, { as: ID.hrD })).status, 404);
      assert.strictEqual((await call('POST', `/api/bgv/requests/${activeId}/refresh`, { as: ID.rootB })).status, 403);
      assert.strictEqual((await call('POST', `/api/bgv/requests/${activeId}/refresh`)).status, 401);
      await setFlag(ID.orgA, false);
      assert.strictEqual((await call('POST', `/api/bgv/requests/${activeId}/refresh`, { as: ID.root })).status, 403);
      await setFlag(ID.orgA, true);
    });
    await t('refresh of a finished BGV => 409; webhook still applies (unchanged logic)', async () => {
      process.env.SPRINGVERIFY_WEBHOOK_SECRET = 'whsec-sv';
      const w = await call('POST', '/api/bgv/webhook', { body: { candidate_id: 888001, overall_status_code: 1 }, headers: { authorization: 'Bearer whsec-sv' } });
      assert.strictEqual(w.status, 200); assert.strictEqual((await bgvRow(activeId)).status, 'completed');
      assert.strictEqual((await call('POST', `/api/bgv/requests/${activeId}/refresh`, { as: ID.root })).status, 409);
    });

    await t('employee my-status: own latest status only (no error/report/provider fields); BGV off => enabled:false', async () => {
      const r = await call('GET', '/api/bgv/my-status', { as: ID.empB });
      assert.strictEqual(r.body.enabled, true); assert.deepStrictEqual(Object.keys(r.body.request).sort(), ['completed_at', 'requested_at', 'status']);
      await setFlag(ID.orgA, false);
      assert.strictEqual((await call('GET', '/api/bgv/my-status', { as: ID.empB })).body.enabled, false);
      await setFlag(ID.orgA, true);
    });

    assert.deepStrictEqual(outbound, [], 'no outbound SpringVerify request happened anywhere in the scaffold tests');
    global.fetch = realFetch;
    process.env.BGV_PROVIDER_MODE = 'mock';
    for (const k of ['SPRINGVERIFY_BASE_URL', 'SPRINGVERIFY_API_TOKEN', 'SPRINGVERIFY_PACKAGE_IDENTIFIER']) delete process.env[k];
  }

  server.close();
  await cleanup();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:', failures.join(' | ')); process.exitCode = 1; }
  await pool.end();
  process.exit(process.exitCode || 0); // test-harness keep-alive sockets would otherwise hold the process open
})().catch(async (e) => { console.error('FATAL', e); try { await cleanup(); } catch {} process.exit(1); });
