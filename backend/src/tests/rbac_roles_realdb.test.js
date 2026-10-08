/**
 * rbac_roles_realdb.test.js — Role Management behaviour (custom roles, "Start from", Assign Users, Manage, Delete)
 * verified against REAL PostgreSQL with the real roles routes and the real permission resolver.
 *
 *   - create a custom role (blank, and "Start from" a system role) — the system role is only READ
 *   - Manage: permissions / name / description of a custom role never touch a system role; system roles are protected
 *   - Assign Users: additive (other roles kept, users.role untouched), multi-user, member counts
 *   - a user with NO explicit role row keeps their baseline access when given a custom role
 *   - deleting a role that is still assigned is refused; deleting an empty one leaves users' access intact
 *
 * SAFETY: scratch schema bsv_* only. Run: REAL_DB_SCHEMA=bsv_verify node src/tests/rbac_roles_realdb.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const assert = require('assert');
// Tests must never send real mail: dotenv does not override variables that are already set, so blank SMTP credentials stay blank.
require('./helpers/realdb_env'); // blanks every provider credential, fakes Cloudinary, blocks non-local network (see helper)
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

const SCHEMA = process.env.REAL_DB_SCHEMA || 'bsv_verify';
if (!/^bsv_[a-z0-9_]+$/.test(SCHEMA)) { console.log(`Refusing schema "${SCHEMA}": must match bsv_* (scratch only)`); process.exit(1); }
process.env.PGOPTIONS = `-c search_path=${SCHEMA}`;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'rbac-roles-realdb-test-secret';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');
const { resolvePermissions, clearOrgCache } = load('services/permissionService');

let passed = 0, failed = 0; const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const ID = {};

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const tb of ['roles', 'role_permissions', 'user_roles']) await S(`TRUNCATE ${tb} RESTART IDENTITY CASCADE`).catch(() => {});
  ID.org = (await one(`INSERT INTO organizations (name, slug) VALUES ('Role Org','role-org') RETURNING id`)).id;
  const user = async (name, role) => (await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date)
     VALUES ($1,$2,'x',$3,$4,'active','active','2024-01-01') RETURNING id`, [name, `${name.toLowerCase().replace(/\W+/g, '.')}@role.test`, role, ID.org])).id;
  ID.root = await user('Root RL', 'root_admin'); ID.hr = await user('HR RL', 'admin');
  ID.e1 = await user('Emp One RL', 'employee'); ID.e2 = await user('Emp Two RL', 'employee'); ID.e3 = await user('Emp NoRows RL', 'employee');
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/phase1_01_rbac_tables.sql'), 'utf8'));
  for (const k of Object.keys(ID)) ID[k] = Number(ID[k]);
  ID.sys = {};
  for (const r of await S(`select id, slug from roles where org_id=$1 and is_system_role`, [ID.org])) ID.sys[r.slug] = Number(r.id);
  // e3: a user that never received an explicit role row (baseline comes only from users.role)
  await S(`DELETE FROM user_roles WHERE user_id=$1`, [ID.e3]);
  clearOrgCache(ID.org);
}
let base;
const tokenFor = async (id) => { const u = await one('select id, role, name, organization_id from users where id=$1', [id]); return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET); };
async function call(method, url, { as, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (as) headers.Authorization = 'Bearer ' + await tokenFor(as);
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const permIds = async (roleId) => (await S(`select permission_id from role_permissions where role_id=$1 order by 1`, [roleId])).map(r => Number(r.permission_id));
const perms = async (uid) => { clearOrgCache(ID.org); return new Set(await resolvePermissions(uid, ID.org)); };

(async () => {
  try { await pool.query('select 1 from organizations limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" is not available (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const app = express(); app.use(express.json()); app.use('/api/roles', load('modules/roles/roles.routes'));
  const server = app.listen(0); base = `http://127.0.0.1:${server.address().port}`;

  let blank, fromDh, fromDhSnapshot;
  console.log('\nCREATE CUSTOM ROLE');
  await t('blank role: no permissions, flagged custom, appears with counts in the list', async () => {
    const r = await call('POST', '/api/roles', { as: ID.root, body: { name: 'Blank Role', description: 'nothing yet' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    blank = r.body;
    assert.strictEqual(blank.is_system_role, false); assert.strictEqual(blank.permission_count, 0); assert.strictEqual(blank.member_count, 0);
    const list = (await call('GET', '/api/roles', { as: ID.root })).body;
    const row = list.find(x => Number(x.id) === Number(blank.id));
    assert.ok(row && row.permission_count === 0 && row.member_count === 0 && row.is_system_role === false);
  });
  await t('"Start from" Department Head copies exactly its permissions; the system role is unchanged', async () => {
    const dh = ID.sys.dept_head;
    fromDhSnapshot = await permIds(dh);
    assert.ok(fromDhSnapshot.length > 5, 'seeded dept_head has permissions');
    // the UI loads the template (GET /roles/:id) and posts the chosen ids
    const tpl = (await call('GET', `/api/roles/${dh}`, { as: ID.root })).body;
    assert.deepStrictEqual([...tpl.permission_ids].map(Number).sort((a, b) => a - b), fromDhSnapshot);
    const r = await call('POST', '/api/roles', { as: ID.root, body: { name: 'Department Head - Limited', description: 'custom', permission_ids: tpl.permission_ids } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    fromDh = r.body;
    assert.deepStrictEqual(await permIds(fromDh.id), fromDhSnapshot, 'copied set equals the source');
    assert.strictEqual(r.body.permission_count, fromDhSnapshot.length);
    assert.deepStrictEqual(await permIds(dh), fromDhSnapshot, 'source system role untouched');
    assert.strictEqual((await one(`select is_system_role from roles where id=$1`, [dh])).is_system_role, true);
  });
  await t('server-side copy_from_role_id gives the same result; Root Admin cannot be a template; duplicate/invalid names refused', async () => {
    const r = await call('POST', '/api/roles', { as: ID.root, body: { name: 'Employee Plus', copy_from_role_id: ID.sys.employee } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(await permIds(r.body.id), await permIds(ID.sys.employee));
    assert.strictEqual((await call('POST', '/api/roles', { as: ID.root, body: { name: 'From Root', copy_from_role_id: ID.sys.root_admin } })).status, 400);
    assert.strictEqual((await call('POST', '/api/roles', { as: ID.root, body: { name: 'Blank Role' } })).status, 400, 'duplicate name');
    assert.strictEqual((await call('POST', '/api/roles', { as: ID.root, body: { name: '   ' } })).status, 400);
  });
  await t('only a caller with roles.manage can create (HR with roles.view only is refused)', async () => {
    assert.strictEqual((await call('POST', '/api/roles', { as: ID.hr, body: { name: 'HR Made' } })).status, 403);
  });

  console.log('\nMANAGE');
  await t('editing a custom role\'s permissions changes only that role; its source system role stays as seeded', async () => {
    const keep = fromDhSnapshot.slice(0, fromDhSnapshot.length - 3);
    const r = await call('PUT', `/api/roles/${fromDh.id}/permissions`, { as: ID.root, body: { permission_ids: keep } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(await permIds(fromDh.id), keep);
    assert.deepStrictEqual(await permIds(ID.sys.dept_head), fromDhSnapshot, 'dept_head unchanged');
  });
  await t('name / description of a custom role are editable; system roles cannot be edited or have permissions changed', async () => {
    const r = await call('PUT', `/api/roles/${fromDh.id}`, { as: ID.root, body: { name: 'Department Head - Limited v2', description: 'updated' } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await one(`select name, description from roles where id=$1`, [fromDh.id])).name, 'Department Head - Limited v2');
    const sysPerm = await call('PUT', `/api/roles/${ID.sys.hr_admin}/permissions`, { as: ID.root, body: { permission_ids: [] } });
    assert.ok([400, 403].includes(sysPerm.status), `system role permissions must be protected, got ${sysPerm.status}`);
    const sysEdit = await call('PUT', `/api/roles/${ID.sys.hr_admin}`, { as: ID.root, body: { name: 'Hacked' } });
    assert.ok([400, 403].includes(sysEdit.status), `system role edit must be refused, got ${sysEdit.status}`);
    assert.ok((await permIds(ID.sys.hr_admin)).length > 0);
    assert.strictEqual((await one(`select name from roles where id=$1`, [ID.sys.hr_admin])).name, 'HR Admin');
  });

  console.log('\nASSIGN USERS');
  await t('assigns the role to several employees: additive, users.role untouched, system role kept, permissions are the UNION, counts update', async () => {
    const base1 = await perms(ID.e1);
    assert.ok(base1.has('leaves.create'), 'employee baseline');
    for (const uid of [ID.e1, ID.e2]) {
      const r = await call('POST', `/api/roles/${fromDh.id}/members`, { as: ID.root, body: { user_id: uid } });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    }
    const custom = await permIds(fromDh.id);
    const got = await perms(ID.e1);
    assert.ok(got.has('leaves.create'), 'baseline employee permission kept');
    const customKeys = (await S(`select p.module_key||'.'||p.action k from permissions p where p.id = ANY($1::bigint[])`, [custom])).map(r => r.k);
    for (const k of customKeys) assert.ok(got.has(k), `custom permission ${k} granted`);
    assert.strictEqual((await one(`select role from users where id=$1`, [ID.e1])).role, 'employee', 'base role untouched');
    assert.ok(await one(`select 1 from user_roles where user_id=$1 and role_id=$2`, [ID.e1, ID.sys.employee]), 'employee system row kept');
    const row = (await call('GET', '/api/roles', { as: ID.root })).body.find(x => Number(x.id) === Number(fromDh.id));
    assert.strictEqual(row.member_count, 2);
    const mem = (await call('GET', `/api/roles/${fromDh.id}/members`, { as: ID.root })).body;
    assert.deepStrictEqual(mem.map(m => Number(m.id)).sort(), [ID.e1, ID.e2]);
  });
  await t('assigning twice is refused cleanly (no duplicate row)', async () => {
    const r = await call('POST', `/api/roles/${fromDh.id}/members`, { as: ID.root, body: { user_id: ID.e1 } });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(Number((await one(`select count(*)::int c from user_roles where user_id=$1 and role_id=$2`, [ID.e1, fromDh.id])).c), 1);
  });
  await t('a user with NO explicit role row keeps their baseline (employee) access when given a custom role', async () => {
    const before = await perms(ID.e3);
    assert.ok(before.has('leaves.create'), 'baseline from users.role');
    const r = await call('POST', `/api/roles/${fromDh.id}/members`, { as: ID.root, body: { user_id: ID.e3 } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const after = await perms(ID.e3);
    for (const k of before) assert.ok(after.has(k), `baseline permission ${k} must not be lost by assigning a custom role`);
  });
  await t('removing a user from the custom role removes only that role (baseline stays, users.role untouched)', async () => {
    const r = await call('DELETE', `/api/roles/${fromDh.id}/members/${ID.e1}`, { as: ID.root });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const got = await perms(ID.e1);
    assert.ok(got.has('leaves.create'));
    assert.ok(!(await S(`select 1 from user_roles where user_id=$1 and role_id=$2`, [ID.e1, fromDh.id])).length);
    assert.strictEqual((await one(`select role from users where id=$1`, [ID.e1])).role, 'employee');
  });
  await t('the HR admin without roles.manage cannot assign; a user from another org cannot be assigned', async () => {
    assert.strictEqual((await call('POST', `/api/roles/${fromDh.id}/members`, { as: ID.hr, body: { user_id: ID.e1 } })).status, 403);
    const foreign = (await one(`INSERT INTO organizations (name, slug) VALUES ('Other','other-org') RETURNING id`)).id;
    const fu = (await one(`INSERT INTO users (name,email,password,role,organization_id) VALUES ('Foreign','f@x.test','x','employee',$1) RETURNING id`, [foreign])).id;
    assert.strictEqual((await call('POST', `/api/roles/${fromDh.id}/members`, { as: ID.root, body: { user_id: Number(fu) } })).status, 404);
  });

  console.log('\nDELETE');
  await t('a role that is still assigned cannot be deleted (409) and nothing is stripped', async () => {
    const members = Number((await one(`select count(*)::int c from user_roles where role_id=$1`, [fromDh.id])).c);
    assert.ok(members >= 2);
    const r = await call('DELETE', `/api/roles/${fromDh.id}`, { as: ID.root });
    assert.strictEqual(r.status, 409, JSON.stringify(r.body));
    assert.strictEqual(Number((await one(`select count(*)::int c from user_roles where role_id=$1`, [fromDh.id])).c), members);
    assert.ok((await permIds(fromDh.id)).length > 0, 'permissions intact');
  });
  await t('after un-assigning everyone the role deletes; those users keep their baseline access; system roles cannot be deleted', async () => {
    for (const uid of [ID.e2, ID.e3]) assert.strictEqual((await call('DELETE', `/api/roles/${fromDh.id}/members/${uid}`, { as: ID.root })).status, 200);
    const r = await call('DELETE', `/api/roles/${fromDh.id}`, { as: ID.root });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!(await S(`select 1 from roles where id=$1`, [fromDh.id])).length);
    for (const uid of [ID.e1, ID.e2, ID.e3]) assert.ok((await perms(uid)).has('leaves.create'), `user ${uid} keeps baseline access`);
    assert.strictEqual((await call('DELETE', `/api/roles/${ID.sys.employee}`, { as: ID.root })).status, 400);
    assert.deepStrictEqual(await permIds(ID.sys.dept_head), fromDhSnapshot, 'system role still as seeded');
  });

  server.close();
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Real-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:\n  - ' + failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All role-management real-database checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
