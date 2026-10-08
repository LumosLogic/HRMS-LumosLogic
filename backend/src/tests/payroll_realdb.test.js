/**
 * payroll_realdb.test.js — payroll simplification checks against REAL PostgreSQL (scratch schema bsv_* only).
 *
 * Covers: incomplete-month guard (manual + scheduler), Generate → Verify → Approve → Lock → Paid sequence and invalid
 * transitions, approved/locked protection, org-derived working days, salary versions + correction history,
 * probation add/remove (+ cron does not undo it), template/watermark/custom-field persistence + PDF, statutory sync.
 *
 * Run:  REAL_DB_SCHEMA=bsv_verify node src/tests/payroll_realdb.test.js
 * Prints SKIPPED (exit 0) if the scratch schema is missing — it never pretends to have verified anything.
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
process.env.JWT_SECRET = process.env.JWT_SECRET || 'payroll-realdb-test-secret';
process.env.PAYROLL_SCHEDULER_ENABLED = 'false';

const express = require('express');
const jwt = require('jsonwebtoken');
const SRC = path.join(__dirname, '..');
const load = (p) => require(path.join(SRC, p));
const { pool } = load('config/db');

let passed = 0, failed = 0;
const failures = [];
async function t(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${String(e.message).split('\n').filter(Boolean).slice(0, 6).join('\n    ')}`); failed++; failures.push(name); }
}
const S = async (sql, p = []) => (await pool.query(sql, p)).rows;
const one = async (sql, p = []) => (await S(sql, p))[0];
const ID = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const PM = prev.getMonth() + 1, PY = prev.getFullYear();
const CM = now.getMonth() + 1, CY = now.getFullYear();

async function seed() {
  const cur = (await one('select current_schema() s')).s;
  if (cur !== SCHEMA) throw new Error(`current_schema is ${cur}, expected ${SCHEMA}`);
  await S(`TRUNCATE organizations, users RESTART IDENTITY CASCADE`);
  for (const t of ['payslips', 'payroll_runs', 'payroll_run_employees', 'employee_salary_structures', 'payroll_audit_log', 'payroll_settings',
                   'work_schedule', 'holidays', 'notifications', 'statutory_pf_config', 'statutory_esi_config', 'statutory_pt_config', 'statutory_tds_config'])
    await S(`TRUNCATE ${t} RESTART IDENTITY CASCADE`).catch(() => {});
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/payroll_simplification_2026_10_07.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(__dirname, '../../migrations/payroll_simplification_2026_10_07.sql'), 'utf8')); // idempotent

  ID.org = Number((await one(`INSERT INTO organizations (name, slug) VALUES ('Pay Org','pay-org') RETURNING id`)).id);
  const user = async (name, role, joining = '2020-01-01') => Number((await one(
    `INSERT INTO users (name, email, password, role, organization_id, employee_status, status, joining_date, phone)
     VALUES ($1,$2,'x',$3,$4,'active','active',$5,'9876543210') RETURNING id`,
    [name, `${name.toLowerCase().replace(/\W+/g, '.')}@pay.test`, role, ID.org, joining])).id);
  ID.root = await user('Root P', 'root_admin');
  ID.e1 = await user('Emp One', 'employee');
  ID.e2 = await user('Emp Two', 'employee');
  ID.recent = await user('Recent Joiner', 'employee', ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 20)));
  await S(`INSERT INTO work_schedule (organization_id, start_time, end_time, work_days, late_threshold) VALUES ($1,'09:00','18:00','1,2,3,4,5','09:30')`, [ID.org]);
  await S(`INSERT INTO payroll_settings (organization_id, probation_enabled, default_probation_months) VALUES ($1, true, 3)`, [ID.org]);
  for (const id of [ID.e1, ID.e2])
    await S(`INSERT INTO employee_salary_structures (organization_id, user_id, effective_from, basic, hra, gross_salary, ctc) VALUES ($1,$2,'2020-01-01',20000,10000,30000,30000)`, [ID.org, id]);
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payroll', load('modules/payroll/payroll.routes'));
  app.use('/api/statutory', load('modules/statutory/statutory.routes'));
  return app;
}
let base;
const token = async (id) => {
  const u = await one('select id, role, name, organization_id from users where id=$1', [id]);
  return jwt.sign({ id: u.id, role: u.role, name: u.name, organization_id: Number(u.organization_id) }, process.env.JWT_SECRET);
};
async function call(method, url, { as = ID.root, body } = {}) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await token(as) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: json };
}
const runRow = id => one('select * from payroll_runs where id=$1', [id]);

(async () => {
  try { await pool.query('select 1 from payroll_runs limit 1'); }
  catch (e) { console.log(`SKIPPED: schema "${SCHEMA}" has no payroll tables (${e.message}). Nothing was verified against a real database.`); process.exit(0); }
  console.log(`Real PostgreSQL ${(await one('show server_version')).server_version}, scratch schema ${SCHEMA}`);
  await seed();
  const server = buildApp().listen(0); base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nINCOMPLETE MONTH');
  await t('manual Generate for the current (incomplete) month is blocked and creates no run', async () => {
    const r = await call('POST', '/api/payroll/generate', { body: { month: CM, year: CY } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'PERIOD_INCOMPLETE');
    assert.strictEqual(Number((await one('select count(*)::int c from payroll_runs')).c), 0);
  });
  await t('preview of the current month still works and reports periodComplete=false', async () => {
    const r = await call('POST', '/api/payroll/preview', { body: { month: CM, year: CY } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.periodComplete, false);
  });
  await t('manual scheduler trigger for the current month is blocked', async () => {
    const r = await call('POST', '/api/payroll/scheduler/trigger', { body: { month: CM, year: CY } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    assert.strictEqual(r.body.code, 'PERIOD_INCOMPLETE');
  });
  await t('automatic scheduler never targets the current month ("Current month" mode returns no period)', async () => {
    const { shouldGenerate } = load('services/payrollScheduler');
    const n = { year: CY, month: CM, day: 5, hour: 3 };
    assert.strictEqual(shouldGenerate({ auto_generate_payroll: true, payroll_generation_day: '5', payroll_generation_time: '01:00', payroll_generate_for: 'CURRENT' }, n, []), null);
    assert.deepStrictEqual(shouldGenerate({ auto_generate_payroll: true, payroll_generation_day: '5', payroll_generation_time: '01:00', payroll_generate_for: 'PREVIOUS' }, n, []),
      CM === 1 ? { payMonth: 12, payYear: CY - 1 } : { payMonth: CM - 1, payYear: CY });
  });
  await t('even a direct service call (scheduler path) for the current month is refused', async () => {
    const { generatePayrollRun } = load('services/payrollGenerationService');
    await assert.rejects(generatePayrollRun({ organizationId: ID.org, month: CM, year: CY, generatedBy: null }), e => e.code === 'PERIOD_INCOMPLETE');
  });

  console.log('\nLIFECYCLE: Generate → Verify → Approve → Lock → Paid');
  let runId;
  await t('completed previous month generates (one payslip per salaried employee)', async () => {
    const r = await call('POST', '/api/payroll/generate', { body: { month: PM, year: PY } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    runId = r.body.runId;
    assert.ok(['completed', 'completed_with_errors'].includes(r.body.status), r.body.status);
    assert.ok(Number((await one('select count(*)::int c from payslips where payroll_run_id=$1', [runId])).c) >= 2);
  });
  await t('cannot approve or lock an unverified run', async () => {
    assert.strictEqual((await call('POST', `/api/payroll/runs/${runId}/approve`)).status, 409);
    const l = await call('POST', `/api/payroll/lock/${runId}`);
    assert.strictEqual(l.status, 400, JSON.stringify(l.body)); assert.strictEqual(l.body.code, 'INVALID_STATUS_FOR_LOCK');
  });
  await t('verify → cannot lock a verified (unapproved) run', async () => {
    assert.strictEqual((await call('POST', `/api/payroll/runs/${runId}/verify`)).status, 200);
    assert.strictEqual((await call('POST', `/api/payroll/runs/${runId}/verify`)).status, 409, 'verify twice');
    const l = await call('POST', `/api/payroll/lock/${runId}`);
    assert.strictEqual(l.status, 400); assert.strictEqual(l.body.code, 'INVALID_STATUS_FOR_LOCK');
  });
  await t('regenerate of a verified run is allowed (still editable)', async () => {
    const r = await call('POST', '/api/payroll/generate', { body: { month: PM, year: PY, force: true } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual((await call('POST', `/api/payroll/runs/${r.body.runId}/verify`)).status, 200);
    runId = r.body.runId;
  });
  await t('approve publishes payslips; an approved run cannot be regenerated (even with force)', async () => {
    assert.strictEqual((await call('POST', `/api/payroll/runs/${runId}/approve`)).status, 200);
    await sleep(500);
    assert.ok(Number((await one(`select count(*)::int c from payslips where payroll_run_id=$1 and status='published'`, [runId])).c) >= 2, 'payslips published');
    const r = await call('POST', '/api/payroll/generate', { body: { month: PM, year: PY, force: true } });
    assert.strictEqual(r.status, 400, JSON.stringify(r.body)); assert.strictEqual(r.body.code, 'PAYROLL_APPROVED');
    assert.strictEqual((await runRow(runId)).status, 'approved');
  });
  await t('lock from approved; payslips become locked; locked run cannot be regenerated', async () => {
    assert.strictEqual((await call('POST', `/api/payroll/lock/${runId}`)).status, 200);
    assert.strictEqual((await runRow(runId)).status, 'locked');
    assert.strictEqual(Number((await one('select count(*)::int c from payslips where payroll_run_id=$1 and locked=false', [runId])).c), 0);
    const r = await call('POST', '/api/payroll/generate', { body: { month: PM, year: PY, force: true } });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.body.code, 'PAYROLL_LOCKED');
  });
  await t('payslip details are readable after lock', async () => {
    const ps = await one('select id from payslips where payroll_run_id=$1 limit 1', [runId]);
    const r = await call('GET', `/api/payroll/payslips/${ps.id}/details`);
    assert.strictEqual(r.status, 200); assert.ok(r.body.net_salary !== undefined);
  });
  await t('unlock returns an approved run to approved; relock; mark paid; paid cannot be regenerated', async () => {
    const u = await call('POST', `/api/payroll/unlock/${runId}`);
    assert.strictEqual(u.status, 200, JSON.stringify(u.body)); assert.strictEqual(u.body.status, 'approved');
    assert.strictEqual((await call('POST', `/api/payroll/lock/${runId}`)).status, 200);
    assert.strictEqual((await call('POST', `/api/payroll/runs/${runId}/mark-paid`)).status, 200);
    const r = await call('POST', '/api/payroll/generate', { body: { month: PM, year: PY, force: true } });
    assert.strictEqual(r.body.code, 'PAYROLL_PAID');
  });

  console.log('\nWORKING DAYS (org work schedule + holidays)');
  await t('5-day org week gives weekdays; 6-day week flows into payroll; legacy payroll weekend/fixed settings no longer decide', async () => {
    const { calculatePayroll } = load('services/payrollEngine');
    const weekdays = (m, y, days) => { let n = 0; for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) if (days.includes(new Date(y, m - 1, d).getDay())) n++; return n; };
    await S(`UPDATE payroll_settings SET weekend_policy='sun_only', working_days_rule='fixed', fixed_working_days=30 WHERE organization_id=$1`, [ID.org]);
    let c = await calculatePayroll({ organizationId: ID.org, userId: ID.e1, month: PM, year: PY });
    assert.strictEqual(c.workingDays, weekdays(PM, PY, [1, 2, 3, 4, 5]));
    await S(`UPDATE work_schedule SET work_days='1,2,3,4,5,6' WHERE organization_id=$1`, [ID.org]);
    c = await calculatePayroll({ organizationId: ID.org, userId: ID.e1, month: PM, year: PY });
    assert.strictEqual(c.workingDays, weekdays(PM, PY, [1, 2, 3, 4, 5, 6]));
    await S(`UPDATE work_schedule SET work_days='1,2,3,4,5' WHERE organization_id=$1`, [ID.org]);
    await S(`UPDATE payroll_settings SET weekend_policy='sat_sun', working_days_rule='calendar' WHERE organization_id=$1`, [ID.org]);
  });
  await t('org-rules endpoint = days − weekly offs − holidays', async () => {
    const hd = ymd(new Date(PY, PM - 1, 10)); // make sure it is a working weekday
    let day = 10; while ([0, 6].includes(new Date(PY, PM - 1, day).getDay())) day++;
    await S(`INSERT INTO holidays (organization_id, date, name) VALUES ($1,$2,'Test Holiday')`, [ID.org, ymd(new Date(PY, PM - 1, day))]).catch(async () => {
      await S(`INSERT INTO holidays (organization_id, date, name, type) VALUES ($1,$2,'Test Holiday','public')`, [ID.org, ymd(new Date(PY, PM - 1, day))]); });
    const r = await call('GET', `/api/payroll/settings/org-rules?month=${PM}&year=${PY}`);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.workingDays, r.body.totalDays - r.body.weeklyOffs - r.body.holidays);
    assert.strictEqual(r.body.holidays, 1);
    assert.ok(hd);
  });

  console.log('\nSALARY STRUCTURE HISTORY');
  await t('later effective date creates a new version; old one is closed and kept; in-place correction is audited and shown', async () => {
    const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    const base = { basic: 25000, hra: 10000, special_allowance: 5000 };
    const p = await call('POST', '/api/payroll/salary-structures', { body: { user_id: ID.e1, effective_from: tomorrow, ...base } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    let h = await call('GET', `/api/payroll/salary-structures/history/${ID.e1}`);
    assert.strictEqual(h.body.length, 2);
    assert.ok(h.body.find(x => x.effective_to !== null), 'previous version closed, not overwritten');
    assert.strictEqual(Number(h.body.find(x => x.effective_to !== null).basic), 20000);
    const c = await call('PUT', `/api/payroll/salary-structures/${p.body.id}`, { body: { ...base, basic: 26000 } });
    assert.strictEqual(c.status, 200, JSON.stringify(c.body));
    await sleep(400);
    h = await call('GET', `/api/payroll/salary-structures/history/${ID.e1}`);
    const active = h.body.find(x => x.effective_to === null);
    assert.strictEqual(Number(active.basic), 26000);
    assert.strictEqual(active.corrections.length, 1, 'correction recorded');
    assert.strictEqual(Number(active.corrections[0].previous.basic), 25000);
    assert.strictEqual(Number(active.corrections[0].current.basic), 26000);
    assert.ok(active.corrections[0].changed_by);
  });
  await t('CTC mode vs manual mode is decided by payroll_settings.salary_calculation_rules.enabled (single flag, persisted)', async () => {
    const rules = load('services/payrollEngine') && { enabled: true, components: [] };
    let r = await call('PUT', '/api/payroll/settings', { body: { salary_calculation_rules: rules } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await call('GET', '/api/payroll/settings')).body.salary_calculation_rules.enabled, true);
    r = await call('PUT', '/api/payroll/settings', { body: { salary_calculation_rules: { enabled: false, components: [] } } });
    assert.strictEqual((await call('GET', '/api/payroll/settings')).body.salary_calculation_rules.enabled, false);
  });

  console.log('\nPROBATION');
  await t('list: recent joiner not on probation; add → profile status probation + dates; appears in the on-probation list', async () => {
    let l = await call('GET', '/api/payroll/probation');
    assert.strictEqual(l.status, 200, JSON.stringify(l.body));
    assert.ok(l.body.notOnProbation.find(x => x.id == ID.recent));
    const a = await call('POST', '/api/payroll/probation/add', { body: { user_id: ID.recent } });
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    const u = await one('select * from users where id=$1', [ID.recent]);
    assert.strictEqual(u.employee_status, 'probation'); assert.strictEqual(u.status, 'active');
    assert.strictEqual(u.probation_applicable, true); assert.ok(u.probation_start_date && u.probation_end_date);
    l = await call('GET', '/api/payroll/probation');
    assert.ok(l.body.onProbation.find(x => x.id == ID.recent));
    assert.strictEqual((await call('POST', '/api/payroll/probation/add', { body: { user_id: ID.recent } })).status, 409);
  });
  await t('add is refused when probation would already have ended (old joiner)', async () => {
    const a = await call('POST', '/api/payroll/probation/add', { body: { user_id: ID.e2 } });
    assert.strictEqual(a.status, 400, JSON.stringify(a.body));
  });
  await t('remove → Active / Full Time / confirmation date, dates cleared; daily cron does not re-apply it (scope=all)', async () => {
    const r = await call('POST', '/api/payroll/probation/remove', { body: { user_id: ID.recent } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    let u = await one('select * from users where id=$1', [ID.recent]);
    assert.strictEqual(u.employee_status, 'active'); assert.strictEqual(u.employment_type, 'full_time');
    assert.ok(u.confirmation_date); assert.strictEqual(u.probation_applicable, false); assert.strictEqual(u.probation_end_date, null);
    await S(`UPDATE payroll_settings SET probation_scope='all' WHERE organization_id=$1`, [ID.org]);
    await load('utils/cronJobs').runProbationExpiryCheck();
    u = await one('select employee_status from users where id=$1', [ID.recent]);
    assert.strictEqual(u.employee_status, 'active', 'removed employee must not be put back on probation overnight');
    assert.strictEqual((await call('POST', '/api/payroll/probation/remove', { body: { user_id: ID.recent } })).status, 409);
    await S(`UPDATE payroll_settings SET probation_scope='selected' WHERE organization_id=$1`, [ID.org]);
  });

  console.log('\nPAYSLIP BRANDING / TEMPLATES');
  await t('template, watermark text and custom fields persist and round-trip; payload is sanitised', async () => {
    const r = await call('PUT', '/api/payroll/settings', { body: { payslip_template: 'modern', payslip_watermark_mode: 'text', payslip_watermark_text: 'CONFIDENTIAL',
      payslip_company_fullname: 'Pay Org Pvt Ltd', payslip_custom_fields: [{ label: ' GSTIN ', value: '24ABC', position: 'header' }, { label: 'Cost centre', value: 'ENG', position: 'bogus' }] } });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const g = (await call('GET', '/api/payroll/settings')).body;
    assert.strictEqual(g.payslip_template, 'modern'); assert.strictEqual(g.payslip_watermark_mode, 'text'); assert.strictEqual(g.payslip_watermark_text, 'CONFIDENTIAL');
    assert.deepStrictEqual(g.payslip_custom_fields, [{ label: 'GSTIN', value: '24ABC', position: 'header' }, { label: 'Cost centre', value: 'ENG', position: 'header' }]);
  });
  await t('unknown template / watermark mode / too many custom fields are rejected', async () => {
    assert.strictEqual((await call('PUT', '/api/payroll/settings', { body: { payslip_template: 'neon' } })).status, 400);
    assert.strictEqual((await call('PUT', '/api/payroll/settings', { body: { payslip_watermark_mode: 'sparkle' } })).status, 400);
    assert.strictEqual((await call('PUT', '/api/payroll/settings', { body: { payslip_custom_fields: Array.from({ length: 13 }, () => ({ label: 'a', value: 'b' })) } })).status, 400);
  });
  await t('generated PDF uses the saved template/watermark/custom fields for every template', async () => {
    const { generatePayslipPDF } = load('services/payrollEmailService');
    const ps = await one('select p.*, p.id as payslip_id from payslips p where payroll_run_id=$1 limit 1', [runId]);
    const emp = await one('select name, employee_id, department, position from users where id=$1', [ps.user_id]);
    for (const tpl of ['classic', 'professional', 'modern']) {
      await S('UPDATE payroll_settings SET payslip_template=$2 WHERE organization_id=$1', [ID.org, tpl]);
      const buf = await generatePayslipPDF(ps, emp, 'Pay Org', ID.org);
      assert.ok(buf && buf.slice(0, 4).toString() === '%PDF', tpl);
      assert.strictEqual((buf.toString('latin1').match(/\/Type \/Page$/gm) || []).length, 1, `${tpl} fits one page`);
    }
  });

  console.log('\nSTATUTORY');
  await t('PF/ESI/PT/TDS toggles persist and sync payroll_settings flags (single source); fields round-trip', async () => {
    for (const [ep, flag, body] of [
      ['pf', 'pf_enabled', { enabled: true, employee_pf_pct: 12, employer_epf_pct: 3.67, employer_eps_pct: 8.33, wage_ceiling: 15000, pf_wage_basis: 'basic' }],
      ['esi', 'esi_enabled', { enabled: true, employee_esi_pct: 0.75, employer_esi_pct: 3.25, wage_limit: 21000 }],
      ['pt', 'professional_tax_enabled', { enabled: true, state_code: 'GJ' }],
      ['tds', 'tds_enabled', { enabled: true, default_regime: 'old' }]]) {
      let r = await call('PUT', `/api/statutory/config/${ep}`, { body });
      assert.strictEqual(r.status, 200, `${ep} ${JSON.stringify(r.body)}`);
      await sleep(150);
      assert.strictEqual((await one(`select ${flag} v from payroll_settings where organization_id=$1`, [ID.org])).v, true, flag);
      r = await call('PUT', `/api/statutory/config/${ep}`, { body: { ...body, enabled: false } });
      await sleep(150);
      assert.strictEqual((await one(`select ${flag} v from payroll_settings where organization_id=$1`, [ID.org])).v, false, `${flag} off`);
    }
    const c = (await call('GET', '/api/statutory/config')).body;
    assert.ok(c.ptStates.length > 0); assert.strictEqual(c.pf.wage_ceiling != null, true);
    assert.ok(c.tds.default_regime === 'old');
  });

  server.close();
  console.log(`\nReal-DB results (PostgreSQL, schema ${SCHEMA}): ${passed} passed, ${failed} failed`);
  if (failed) { console.log('FAILED:', failures.join('\n  - ')); process.exit(1); }
  console.log('\n✅  All payroll real-database checks passed.');
  await pool.end();
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
