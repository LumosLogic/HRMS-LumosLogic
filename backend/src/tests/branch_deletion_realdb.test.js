/**
 * branch_deletion_realdb.test.js — branch delete (move / soft-delete) against REAL PostgreSQL.
 *
 *   • before the migration: a clear 409, nothing changes, lists keep working
 *   • preview: counts, blockers, destination list; Root Admin only
 *   • move: employees + their assets / shifts / devices go to the destination, HR admins are re-granted, holidays / leave
 *     policies / payroll history stay with the hidden branch (NOT nulled to "org-wide"), other branches untouched
 *   • soft delete: employee accounts deactivated + sessions revoked, everything else untouched
 *   • both: branch hidden from lists, name reusable, repeat delete = 404, audit row written
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/branch_deletion_realdb.test.js
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'branch-delete-test-secret';
process.env.PAYROLL_SCHEDULER_ENABLED = 'false';

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
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ID = {};
let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function call(method, url, { as, token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token; else if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const num = (v) => Number(v);

async function seedBranchWorld(tag) {
  // a fresh set per scenario: source S, destination T, an unrelated branch X (must never change)
  const br = async (name, code) => num((await one(`INSERT INTO branches (org_id, name, code, is_active) VALUES ($1,$2,$3,true) RETURNING id`, [ID.org, `${name} ${tag}`, `${code}${tag}`])).id);
  const w = { S: await br('Source', 'S'), T: await br('Target', 'T'), X: await br('Other', 'X') };
  const user = async (name, role, branch, status = 'active') => num((await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date, branch_id)
     VALUES ($1,$2,'x',$3,$4,$5,$6,'2024-01-01',$7) RETURNING id`,
    [`${name} ${tag}`, `${name.toLowerCase().replace(/\W+/g, '.')}.${tag}@bd.test`, role, ID.org, status, status === 'inactive' || status === 'terminated' ? 'inactive' : 'active', branch])).id);
  w.e1 = await user('Emp One', 'employee', w.S); w.e2 = await user('Emp Two', 'employee', w.S);
  w.eOld = await user('Emp Terminated', 'employee', w.S, 'terminated');
  w.eT = await user('Emp Target', 'employee', w.T); w.eX = await user('Emp Other', 'employee', w.X);
  w.hrS = await user('HR Source', 'admin', null);      // administers S only
  w.hrAll = await user('HR All', 'admin', null);       // all branches
  await S(`INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches) VALUES ($1,$2,$3,false),($4,$2,NULL,true)`, [w.hrS, ID.org, w.S, w.hrAll]);
  const asset = async (n, b, who) => num((await one(`INSERT INTO assets (name, organization_id, branch_id, asset_tag, status, assigned_to) VALUES ($1,$2,$3,$4,'assigned',$5) RETURNING id`, [`${n} ${tag}`, ID.org, b, `${n}-${tag}`.toLowerCase(), who])).id);
  w.assetS = await asset('LapS', w.S, w.e1); w.assetX = await asset('LapX', w.X, w.eX);
  const shift = async (n, b) => num((await one(`INSERT INTO shifts (name, start_time, end_time, organization_id, branch_id) VALUES ($1,'09:00','18:00',$2,$3) RETURNING id`, [`${n} ${tag}`, ID.org, b])).id);
  w.shiftS = await shift('ShiftS', w.S); w.shiftX = await shift('ShiftX', w.X);
  w.devS = num((await one(`INSERT INTO biometric_devices (org_id, serial_number, device_name, branch_id) VALUES ($1,$2,'Gate S',$3) RETURNING id`, [ID.org, `SN-S-${tag}`, w.S])).id);
  w.holS = num((await one(`INSERT INTO holidays (organization_id, branch_id, name, date, type) VALUES ($1,$2,'Source Day','2027-03-01','company') RETURNING id`, [ID.org, w.S])).id);
  w.polS = num((await one(`INSERT INTO leave_policies (organization_id, branch_id, leave_type, label, annual_quota) VALUES ($1,$2,'casual','Casual (S)',10) RETURNING id`, [ID.org, w.S])).id);
  w.runPaid = num((await one(`INSERT INTO payroll_runs (organization_id, month, year, status, branch_id) VALUES ($1,1,2026,'paid',$2) RETURNING id`, [ID.org, w.S])).id);
  await S(`INSERT INTO attendance (user_id, date, status, organization_id) VALUES ($1,'2026-09-01','present',$2)`, [w.e1, ID.org]);
  await S(`INSERT INTO leaves (user_id, organization_id, start_date, end_date, leave_type, leave_time, status, reason) VALUES ($1,$2,'2026-09-02','2026-09-02','casual','full','approved','x')`, [w.e1, ID.org]);
  return w;
}
const branchRow = (id) => one('select * from branches where id=$1', [id]);
const userRow = (id) => one('select id, branch_id, employee_status, status, sessions_valid_after from users where id=$1', [id]);

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}).`); process.exit(0); }
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);

  // start from a schema WITHOUT the migration under test
  await S(`TRUNCATE organizations, users, branches RESTART IDENTITY CASCADE`);
  for (const tb of ['payroll_runs', 'attendance', 'leaves', 'leave_approval_log', 'branch_deletion_log']) await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  await S(`ALTER TABLE branches DROP COLUMN IF EXISTS deleted_at, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS delete_mode, DROP COLUMN IF EXISTS moved_to_branch_id`);
  await S(`DROP TABLE IF EXISTS branch_deletion_log`);
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/branch_separation_2026_10_03.sql'), 'utf8'));
  ID.org = num((await one(`INSERT INTO organizations (name, slug) VALUES ('BD Org','bd-org') RETURNING id`)).id);
  ID.org2 = num((await one(`INSERT INTO organizations (name, slug) VALUES ('BD Org 2','bd-org-2') RETURNING id`)).id);
  const root = async (o, n) => num((await one(`INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date) VALUES ($1,$2,'x','root_admin',$3,'active','active','2024-01-01') RETURNING id`, [n, `${n.toLowerCase().replace(/\W+/g, '.')}@bd.test`, o])).id);
  ID.root = await root(ID.org, 'Root BD'); ID.root2 = await root(ID.org2, 'Root BD2');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));

  const app = express(); app.use(express.json());
  app.use('/api/branches', load('modules/branches/branches.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nBEFORE the migration');
  let w0;
  await t('delete / preview answer 409 "run the migration"; the branch list keeps working; nothing changes', async () => {
    w0 = await seedBranchWorld('a');
    const p = await call('GET', `/api/branches/${w0.S}/delete-preview`, { as: ID.root });
    assert.strictEqual(p.status, 409, JSON.stringify(p.body)); assert.match(p.body.error, /add_branch_soft_delete/);
    const d = await call('DELETE', `/api/branches/${w0.S}`, { as: ID.root, body: { mode: 'soft_delete' } });
    assert.strictEqual(d.status, 409, JSON.stringify(d.body));
    assert.strictEqual(num((await userRow(w0.e1)).branch_id), w0.S);
    const list = await call('GET', '/api/branches', { as: ID.root });
    assert.strictEqual(list.status, 200); assert.ok(list.body.some(b => num(b.id) === w0.S));
  });

  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/add_branch_soft_delete_2026_10_09.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/add_branch_soft_delete_2026_10_09.sql'), 'utf8'));   // idempotent

  console.log('\nPREVIEW + permissions');
  await t('preview (Root Admin): counts, destinations exclude the branch itself, no blockers', async () => {
    const p = await call('GET', `/api/branches/${w0.S}/delete-preview`, { as: ID.root });
    assert.strictEqual(p.status, 200, JSON.stringify(p.body));
    const s = p.body.summary;
    assert.strictEqual(s.employees_total, 3); assert.strictEqual(s.employees_active, 2); assert.strictEqual(s.employees_inactive, 1);
    assert.strictEqual(s.assets, 1); assert.strictEqual(s.shifts, 1); assert.strictEqual(s.biometric_devices, 1);
    assert.strictEqual(s.holidays, 1); assert.strictEqual(s.leave_policies, 1); assert.strictEqual(s.payroll_runs, 1);
    assert.strictEqual(s.hr_admins_with_access, 1);
    assert.deepStrictEqual(p.body.blockers, []);
    const ids = p.body.targets.map(x => num(x.id)); assert.ok(ids.includes(w0.T) && ids.includes(w0.X) && !ids.includes(w0.S));
  });
  await t('only a Root Admin may preview or delete (HR admin 403), other organisations get 404', async () => {
    assert.strictEqual((await call('GET', `/api/branches/${w0.S}/delete-preview`, { as: w0.hrAll })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/branches/${w0.S}`, { as: w0.hrAll, body: { mode: 'soft_delete' } })).status, 403);
    assert.strictEqual((await call('DELETE', `/api/branches/${w0.S}`, { as: ID.root2, body: { mode: 'soft_delete' } })).status, 404);
    assert.strictEqual(num((await userRow(w0.e1)).branch_id), w0.S);
  });
  await t('validation: no mode, move without / to itself / to an inactive or unknown destination → 400, nothing changes', async () => {
    const bad = async (body) => { const r = await call('DELETE', `/api/branches/${w0.S}`, { as: ID.root, body }); assert.strictEqual(r.status, 400, JSON.stringify([body, r.body])); };
    await bad({}); await bad({ mode: 'purge' }); await bad({ mode: 'move' }); await bad({ mode: 'move', target_branch_id: w0.S }); await bad({ mode: 'move', target_branch_id: 999999 });
    await S(`UPDATE branches SET is_active=false WHERE id=$1`, [w0.X]);
    await bad({ mode: 'move', target_branch_id: w0.X });
    await S(`UPDATE branches SET is_active=true WHERE id=$1`, [w0.X]);
    assert.strictEqual(num((await userRow(w0.e1)).branch_id), w0.S); assert.strictEqual((await branchRow(w0.S)).deleted_at, null);
  });
  await t('a payroll run being generated blocks the delete (409); an unpaid finished run only warns', async () => {
    const r = num((await one(`INSERT INTO payroll_runs (organization_id, month, year, status, branch_id) VALUES ($1,2,2026,'processing',$2) RETURNING id`, [ID.org, w0.S])).id);
    const d = await call('DELETE', `/api/branches/${w0.S}`, { as: ID.root, body: { mode: 'soft_delete' } });
    assert.strictEqual(d.status, 409, JSON.stringify(d.body)); assert.ok(d.body.blockers.length);
    assert.strictEqual((await branchRow(w0.S)).deleted_at, null);
    await S(`UPDATE payroll_runs SET status='locked' WHERE id=$1`, [r]);
    const p = await call('GET', `/api/branches/${w0.S}/delete-preview`, { as: ID.root });
    assert.deepStrictEqual(p.body.blockers, []); assert.ok(p.body.warnings.move.some(x => /not marked paid/.test(x)));
    await S(`DELETE FROM payroll_runs WHERE id=$1`, [r]);
  });

  console.log('\nMODE: move to another branch');
  await t('employees, assets, shifts, devices move; HR admins re-granted; holidays / policies / payroll stay with the hidden branch', async () => {
    const w = await seedBranchWorld('m');
    const before = { eT: await userRow(w.eT), eX: await userRow(w.eX), assetX: await one('select branch_id from assets where id=$1', [w.assetX]) };
    const r = await call('DELETE', `/api/branches/${w.S}`, { as: ID.root, body: { mode: 'move', target_branch_id: w.T } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.moved.employees, 3, 'all statuses move, history stays attached');
    for (const e of [w.e1, w.e2, w.eOld]) assert.strictEqual(num((await userRow(e)).branch_id), w.T);
    assert.strictEqual((await userRow(w.e1)).employee_status, 'active', 'moved employees stay active');
    assert.strictEqual(num((await one('select branch_id from assets where id=$1', [w.assetS])).branch_id), w.T);
    assert.strictEqual(num((await one('select branch_id from shifts where id=$1', [w.shiftS])).branch_id), w.T);
    assert.strictEqual(num((await one('select branch_id from biometric_devices where id=$1', [w.devS])).branch_id), w.T);
    // NOT moved, NOT turned org-wide: still on the (hidden) source branch
    assert.strictEqual(num((await one('select branch_id from holidays where id=$1', [w.holS])).branch_id), w.S);
    assert.strictEqual(num((await one('select branch_id from leave_policies where id=$1', [w.polS])).branch_id), w.S);
    assert.strictEqual(num((await one('select branch_id from payroll_runs where id=$1', [w.runPaid])).branch_id), w.S);
    // history rows untouched
    assert.strictEqual(num((await one(`select count(*)::int c from attendance where user_id=$1`, [w.e1])).c), 1);
    assert.strictEqual((await one(`select status from leaves where user_id=$1`, [w.e1])).status, 'approved');
    // HR: re-granted T, lost S; the all-branches admin unchanged
    const acc = await S(`select branch_id, all_branches from hr_branch_access where user_id=$1`, [w.hrS]);
    assert.deepStrictEqual(acc.map(a => num(a.branch_id)), [w.T]);
    assert.strictEqual(r.body.hr_admins_regranted, 1);
    assert.strictEqual((await S(`select 1 from hr_branch_access where user_id=$1 and all_branches`, [w.hrAll])).length, 1);
    // other branches untouched
    assert.deepStrictEqual(await userRow(w.eT), before.eT); assert.deepStrictEqual(await userRow(w.eX), before.eX);
    assert.strictEqual(num((await one('select branch_id from assets where id=$1', [w.assetX])).branch_id), w.X);
    assert.strictEqual(num((await one('select branch_id from shifts where id=$1', [w.shiftX])).branch_id), w.X);
    // the branch itself
    const b = await branchRow(w.S);
    assert.ok(b.deleted_at); assert.strictEqual(b.delete_mode, 'move'); assert.strictEqual(num(b.moved_to_branch_id), w.T); assert.strictEqual(b.is_active, false);
    assert.strictEqual(num(b.deleted_by), ID.root);
    const log = await one(`select * from branch_deletion_log where branch_id=$1`, [w.S]);
    assert.ok(log && log.mode === 'move' && num(log.target_branch_id) === w.T && log.summary.moved.employees === 3, JSON.stringify(log));
  });
  await t('the deleted branch is hidden from the branch list and the selector list; its name and code can be reused; deleting again is 404', async () => {
    const w = await seedBranchWorld('n');
    assert.strictEqual((await call('DELETE', `/api/branches/${w.S}`, { as: ID.root, body: { mode: 'move', target_branch_id: w.T } })).status, 200);
    const list = await call('GET', '/api/branches', { as: ID.root });
    assert.ok(!list.body.some(b => num(b.id) === w.S) && list.body.some(b => num(b.id) === w.T));
    const mine = await call('GET', '/api/branches/my-access', { as: ID.root });
    assert.ok(!(mine.body.branches || []).some(b => num(b.id) === w.S), 'selector must not offer it');
    const again = await call('DELETE', `/api/branches/${w.S}`, { as: ID.root, body: { mode: 'soft_delete' } });
    assert.strictEqual(again.status, 404);
    const reuse = await call('POST', '/api/branches', { as: ID.root, body: { name: `Source n`, code: `Sn` } });
    assert.strictEqual(reuse.status, 200, JSON.stringify(reuse.body));
    // a deleted branch cannot be re-activated or edited through the normal endpoints
    const re = await call('PUT', `/api/branches/${w.S}`, { as: ID.root, body: { is_active: true } });
    assert.strictEqual(re.status, 404, JSON.stringify(re.body));
    assert.strictEqual((await branchRow(w.S)).is_active, false);
  });

  console.log('\nMODE: soft delete');
  await t('remaining employees are deactivated and their sessions revoked; assets, holidays, policies, payroll, attendance and leave stay as they were', async () => {
    const w = await seedBranchWorld('s');
    const oldTok = await tokenFor(w.e1);
    await sleep(1100);                                  // JWT iat has second resolution
    const r = await call('DELETE', `/api/branches/${w.S}`, { as: ID.root, body: { mode: 'soft_delete' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.deactivated_employees, 2, 'the already-terminated employee is not touched again');
    for (const e of [w.e1, w.e2]) { const u = await userRow(e); assert.strictEqual(u.employee_status, 'inactive'); assert.strictEqual(u.status, 'inactive'); assert.ok(u.sessions_valid_after, 'sessions revoked'); }
    assert.strictEqual((await userRow(w.eOld)).employee_status, 'terminated');
    assert.strictEqual(num((await userRow(w.e1)).branch_id), w.S, 'they keep their branch for history');
    const stale = await call('GET', '/api/branches/my-access', { token: oldTok });
    assert.strictEqual(stale.status, 401, 'a token issued before the delete no longer works');
    // nothing else changed
    assert.strictEqual(num((await one('select branch_id from assets where id=$1', [w.assetS])).branch_id), w.S);
    assert.strictEqual(num((await one('select branch_id from shifts where id=$1', [w.shiftS])).branch_id), w.S);
    assert.strictEqual(num((await one('select branch_id from holidays where id=$1', [w.holS])).branch_id), w.S);
    assert.strictEqual(num((await one('select branch_id from leave_policies where id=$1', [w.polS])).branch_id), w.S);
    assert.strictEqual(num((await one('select branch_id from payroll_runs where id=$1', [w.runPaid])).branch_id), w.S);
    assert.strictEqual(num((await one(`select count(*)::int c from attendance where user_id=$1`, [w.e1])).c), 1);
    assert.strictEqual((await one(`select status from leaves where user_id=$1`, [w.e1])).status, 'approved');
    assert.strictEqual((await S(`select 1 from hr_branch_access where branch_id=$1`, [w.S])).length, 0, 'HR access to the hidden branch is gone');
    assert.deepStrictEqual((await userRow(w.eT)).employee_status, 'active'); assert.strictEqual((await userRow(w.eX)).employee_status, 'active');
    const b = await branchRow(w.S); assert.ok(b.deleted_at); assert.strictEqual(b.delete_mode, 'soft_delete'); assert.strictEqual(b.moved_to_branch_id, null);
    const list = await call('GET', '/api/branches', { as: ID.root });
    assert.ok(!list.body.some(x => num(x.id) === w.S));
  });
  await t('the move runs in one transaction: a failure part-way leaves everything exactly as it was', async () => {
    const w = await seedBranchWorld('t');
    // make the LAST write of the transaction fail (audit insert is optional, so break the branch UPDATE with a check constraint)
    await S(`ALTER TABLE branches ADD CONSTRAINT tmp_block_delete CHECK (deleted_by IS NULL OR deleted_by <> ${ID.root}) NOT VALID`);   // applies to new writes only
    try {
      const r = await call('DELETE', `/api/branches/${w.S}`, { as: ID.root, body: { mode: 'move', target_branch_id: w.T } });
      assert.strictEqual(r.status, 500, JSON.stringify(r.body));
    } finally { await S(`ALTER TABLE branches DROP CONSTRAINT tmp_block_delete`); }
    for (const e of [w.e1, w.e2, w.eOld]) assert.strictEqual(num((await userRow(e)).branch_id), w.S, 'employees rolled back');
    assert.strictEqual(num((await one('select branch_id from assets where id=$1', [w.assetS])).branch_id), w.S, 'assets rolled back');
    assert.strictEqual((await S(`select 1 from hr_branch_access where user_id=$1 and branch_id=$2`, [w.hrS, w.S])).length, 1, 'HR access rolled back');
    assert.strictEqual((await S(`select 1 from hr_branch_access where user_id=$1 and branch_id=$2`, [w.hrS, w.T])).length, 0, 'no half-granted access');
    assert.strictEqual((await branchRow(w.S)).deleted_at, null);
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All branch-deletion real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
