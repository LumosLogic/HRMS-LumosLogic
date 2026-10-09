/**
 * bgv.routes.js — Background Verification (SpringVerify) — ADDITIVE module, mounted at /api/bgv.
 *
 *   GET  /requests                list BGV requests for employees the caller may access
 *   POST /requests                LEGACY invite-based start — DISABLED unless BGV_LEGACY_INVITE_ENABLED=true
 *   GET  /employees/:id/review    employee-level review data (approved HRMS documents)
 *   POST /employees/:id/submit    add candidate (invite:false) + submit-bgv with ALL approved docs, one call per employee
 *   POST /requests/:id/refresh    pull status from SpringVerify (candidate/details)
 *   GET  /requests/:id            one request
 *   GET  /requests/:id/report     authorised access to the report URL (audited)
 *   POST /webhook                 provider callback (authenticated by the provider's own scheme)
 *
 * Security: org/branch scope always comes from the authenticated user (req.user / branchContext), never
 * from the body. The webhook resolves the request from the provider candidate id stored at creation time.
 * The `bgv` flag is strict: a missing organization_features row means OFF.
 */
const express = require('express');
const router  = express.Router();
const { pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, canAdminAccessUser } = require('../../utils/branchFilter');
const { getProvider, BgvProviderError } = require('./bgv.provider');
const { prepareEmployeeBgv, toReviewView, classifyDoc } = require('./bgv.prepare');

const ACTIVE = ['pending', 'in_progress'];
const TERMINAL = ['completed', 'failed', 'cancelled'];

const isAdmin = (role) => role === 'admin' || role === 'root_admin';

// Strict flag: only an explicit enabled=true row turns BGV on (unlike other features, missing = OFF).
async function isBgvEnabled(orgId) {
  const { rows } = await pool.query(
    `SELECT enabled FROM organization_features WHERE organization_id = $1 AND feature_key = 'bgv' LIMIT 1`, [orgId]);
  return rows.length > 0 && rows[0].enabled === true;
}

// Fields safe to send to the browser (no raw provider response, no report URL).
const PUBLIC_COLS = `id, employee_id, employee_doc_submission_id, status, requested_by, requested_at,
  completed_at, error_message, created_at, updated_at,
  (report_url IS NOT NULL OR status = 'completed') AS has_report`;

async function audit(client, { orgId, requestId, provider, type, actorId, payload }) {
  await client.query(
    `INSERT INTO bgv_events (organization_id, bgv_request_id, provider, event_type, source, actor_id, payload, processed_at)
     VALUES ($1,$2,$3,$4,'audit',$5,$6,NOW())`,
    [orgId, requestId, provider, type, actorId || null, payload ? JSON.stringify(payload) : null]);
}

const requireAdmin = (req, res, next) =>
  isAdmin(req.user?.role) ? next() : res.status(403).json({ error: 'Forbidden' });

// ── GET /requests ───────────────────────────────────────────────────────────────
router.get('/requests', auth, requireAdmin, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const ids = await resolveEmployeeIds(req.branchContext, oId); // null = org-wide, [] = none
    if (ids !== null && ids.length === 0) return res.json([]);
    const params = [oId];
    let sql = `SELECT ${PUBLIC_COLS} FROM bgv_requests WHERE organization_id = $1`;
    if (ids !== null) { params.push(ids); sql += ` AND employee_id = ANY($2::bigint[])`; }
    sql += ' ORDER BY created_at DESC LIMIT 1000';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[bgv] list failed:', err.message);
    res.status(500).json({ error: 'Failed to load BGV requests' });
  }
});

// ── GET /eligibility ────────────────────────────────────────────────────────────
// Which document submissions are BGV-verified types (identity / address / employment / education) and which employees
// have at least one APPROVED one. The Verification Queue shows Run BGV only on those rows; other documents are ignored.
router.get('/eligibility', auth, requireAdmin, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    if (!(await isBgvEnabled(oId))) return res.json({ docs: {}, employees: {} });
    const ids = await resolveEmployeeIds(req.branchContext, oId);
    if (ids !== null && ids.length === 0) return res.json({ docs: {}, employees: {} });
    const params = [oId];
    let sql = `SELECT s.id, s.user_id, s.status, r.name FROM employee_doc_submissions s
                 JOIN document_requirements r ON r.id = s.requirement_id WHERE s.organization_id = $1`;
    if (ids !== null) { params.push(ids); sql += ` AND s.user_id = ANY($2::bigint[])`; }
    const { rows } = await pool.query(sql, params);
    const docs = {}, employees = {};
    for (const s of rows) {
      const c = classifyDoc(s.name);
      if (!c) continue;
      docs[s.id] = { section: c.section };
      const e = employees[s.user_id] || (employees[s.user_id] = { eligible: false });
      if (s.status === 'approved') e.eligible = true;
    }
    res.json({ docs, employees });
  } catch (err) {
    console.error('[bgv] eligibility failed:', err.message);
    res.status(500).json({ error: 'Failed to load BGV eligibility' });
  }
});

async function loadScopedRequest(req, id) {
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return null;
  const { rows } = await pool.query(
    'SELECT * FROM bgv_requests WHERE id = $1 AND organization_id = $2', [rid, req.user.organization_id]);
  const r = rows[0];
  if (!r) return null;
  if (!(await canAdminAccessUser(req.branchContext, r.employee_id, req.user.organization_id))) return null;
  return r;
}

const toPublic = (r) => ({
  id: r.id, employee_id: r.employee_id, employee_doc_submission_id: r.employee_doc_submission_id,
  status: r.status, requested_by: r.requested_by, requested_at: r.requested_at, completed_at: r.completed_at,
  error_message: r.error_message, created_at: r.created_at, updated_at: r.updated_at,
  has_report: !!r.report_url || r.status === 'completed',
});

// ── GET /requests/:id ───────────────────────────────────────────────────────────
router.get('/requests/:id', auth, requireAdmin, withBranchContext, async (req, res) => {
  try {
    const r = await loadScopedRequest(req, req.params.id);
    if (!r) return res.status(404).json({ error: 'BGV request not found' });
    res.json(toPublic(r));
  } catch (err) {
    console.error('[bgv] get failed:', err.message);
    res.status(500).json({ error: 'Failed to load BGV request' });
  }
});

// ── GET /requests/:id/report ────────────────────────────────────────────────────
// Authenticated + scoped. The provider report is fetched on demand (provider links expire); nothing is public.
router.get('/requests/:id/report', auth, requireAdmin, withBranchContext, async (req, res) => {
  try {
    const r = await loadScopedRequest(req, req.params.id);
    if (!r || r.status !== 'completed') return res.status(404).json({ error: 'Report not available' });
    let provider;
    try { provider = getProvider(); if (provider.name !== r.provider) throw new Error('provider mismatch'); }
    catch { return res.status(503).json({ error: 'BGV service is not configured. Please contact support.' }); }
    let rep;
    try { rep = await provider.getReport({ candidateId: r.provider_candidate_id, storedUrl: r.report_url }); }
    catch (e) {
      console.error('[bgv] report fetch failed:', e.code || e.message);
      return res.status(e.code === 'REPORT_UNAVAILABLE' ? 404 : 502).json({ error: 'Report is not available right now.' });
    }
    await audit(pool, { orgId: r.organization_id, requestId: r.id, provider: r.provider,
                        type: 'report_accessed', actorId: req.user.id, payload: { employee_id: r.employee_id } });
    res.json(rep.kind === 'pdf' ? { pdf_base64: rep.base64, file_name: rep.fileName } : { url: rep.url });
  } catch (err) {
    console.error('[bgv] report failed:', err.message);
    res.status(500).json({ error: 'Failed to open report' });
  }
});

// ── POST /requests  (start BGV — paid, manual only) ─────────────────────────────
// DISABLED BY DEFAULT. This is the legacy invite flow: createCandidate() makes SpringVerify email the employee a form
// link, which the HRMS-submit flow forbids. The code is kept (not deleted) but unreachable unless a server operator
// deliberately sets BGV_LEGACY_INVITE_ENABLED=true. Use POST /employees/:employeeId/submit instead.
const legacyInviteEnabled = () => String(process.env.BGV_LEGACY_INVITE_ENABLED || '').trim().toLowerCase() === 'true';
router.post('/requests', auth, requireAdmin, withBranchContext, async (req, res) => {
  if (!legacyInviteEnabled()) {
    return res.status(410).json({ code: 'LEGACY_INVITE_DISABLED',
      error: 'This BGV start method is disabled. Use the BGV review flow instead.' });
  }
  const oId = req.user.organization_id;
  try {
    if (!(await isBgvEnabled(oId))) return res.status(403).json({ error: 'BGV is not enabled for your organization.' });

    const employeeId = Number(req.body?.employee_id);
    if (!Number.isInteger(employeeId) || employeeId <= 0) return res.status(400).json({ error: 'employee_id is required' });
    if (!(await canAdminAccessUser(req.branchContext, employeeId, oId)))
      return res.status(403).json({ error: 'You do not have access to this employee.' });

    // Optional link to the document submission — must belong to the same org + employee.
    let submissionId = null;
    if (req.body?.submission_id != null) {
      const sid = Number(req.body.submission_id);
      const { rows } = await pool.query(
        'SELECT id FROM employee_doc_submissions WHERE id = $1 AND organization_id = $2 AND user_id = $3',
        [sid, oId, employeeId]);
      if (!rows.length) return res.status(400).json({ error: 'Invalid submission for this employee.' });
      submissionId = rows[0].id;
    }

    let provider;
    try { provider = getProvider(); }
    catch (e) {
      console.error('[bgv] provider unavailable:', e.code);
      return res.status(503).json({ error: 'BGV service is not configured. Please contact support.' });
    }
    try { if (provider.ensureReady) provider.ensureReady(); }
    catch (e) {
      console.error('[bgv] provider config incomplete:', e.code, e.message);
      return res.status(503).json({ error: 'BGV service is not configured. Please contact support.' });
    }
    const packageIdentifier = (process.env.SPRINGVERIFY_PACKAGE_IDENTIFIER || '').trim() || null;

    const { rows: emp } = await pool.query(
      'SELECT id, name, email, phone FROM users WHERE id = $1 AND organization_id = $2', [employeeId, oId]);
    if (!emp.length) return res.status(404).json({ error: 'Employee not found' });

    // Reserve the single active slot BEFORE any paid call. The partial unique index makes concurrent clicks safe.
    const ins = await pool.query(
      `INSERT INTO bgv_requests (organization_id, employee_id, employee_doc_submission_id, provider,
                                 package_identifier, status, requested_by)
       VALUES ($1,$2,$3,$4,$5,'pending',$6)
       ON CONFLICT (organization_id, employee_id, provider) WHERE status IN ('pending','in_progress') DO NOTHING
       RETURNING id`,
      [oId, employeeId, submissionId, provider.name, packageIdentifier, req.user.id]);
    if (!ins.rows.length) {
      const { rows: existing } = await pool.query(
        `SELECT ${PUBLIC_COLS} FROM bgv_requests
          WHERE organization_id = $1 AND employee_id = $2 AND provider = $3 AND status = ANY($4)
          ORDER BY created_at DESC LIMIT 1`, [oId, employeeId, provider.name, ACTIVE]);
      return res.status(409).json({ error: 'A BGV request is already active for this employee.', existing: existing[0] || null });
    }
    const requestId = ins.rows[0].id;
    await audit(pool, { orgId: oId, requestId, provider: provider.name, type: 'requested', actorId: req.user.id,
                        payload: { employee_id: employeeId, submission_id: submissionId } });

    try {
      const out = await provider.createCandidate({ employee: emp[0], packageIdentifier, reference: String(requestId) });
      const mapped = (out.providerStatus && provider.mapStatus(out.providerStatus)) || 'pending';
      const { rows } = await pool.query(
        `UPDATE bgv_requests SET provider_candidate_id = $2, provider_request_id = $3, provider_status = $4,
                status = $5, raw_response = $6, updated_at = NOW()
          WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
        [requestId, out.candidateId, out.requestId || null, out.providerStatus || null, mapped,
         out.raw ? JSON.stringify(out.raw) : null]);
      return res.status(201).json(rows[0]);
    } catch (e) {
      const code = e instanceof BgvProviderError ? e.code : 'PROVIDER_ERROR';
      // If the call may have reached the provider (timeout), keep the evidence in the message so HR can check
      // the provider portal before retrying — a retry here would be a second paid request.
      const msg = e.outcomeUnknown ? `Outcome unknown (${code}) — verify in provider portal before retrying`
                                   : `Provider error (${code})`;
      await pool.query(`UPDATE bgv_requests SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
        [requestId, msg]).catch(() => {});
      await audit(pool, { orgId: oId, requestId, provider: provider.name, type: 'request_failed', actorId: req.user.id,
                          payload: { code, outcome_unknown: !!e.outcomeUnknown } }).catch(() => {});
      console.error('[bgv] provider call failed:', code, e.message);
      const FRIENDLY = {
        DUPLICATE_CANDIDATE: 'This person already exists in SpringVerify (same email, phone or employee id).',
        INVALID_INPUT: 'The employee needs a valid name, email address and 10-digit mobile number before BGV can be requested.',
        INVALID_REQUEST: 'SpringVerify rejected the request. Check the employee details and your SpringVerify account/credits.',
        RATE_LIMITED: 'SpringVerify is busy. Please try again in a few minutes.',
      };
      return res.status(502).json({ error: FRIENDLY[code] || 'Could not submit the BGV request. Please try again later.', code });
    }
  } catch (err) {
    console.error('[bgv] start failed:', err.message);
    res.status(500).json({ error: 'Failed to start BGV' });
  }
});

// ── Employee-level review + submit (HRMS → SpringVerify) ────────────────────────
// ONE candidate per employee; ALL of their approved HRMS documents go to SpringVerify in a single submit-bgv call
// (API guide v3.4: candidate/add with invite:false, then v2/submit-bgv). The employee never gets a SpringVerify email.
async function loadEmployeeGuard(req, res) {
  const oId = req.user.organization_id;
  if (!(await isBgvEnabled(oId))) { res.status(403).json({ error: 'BGV is not enabled for your organization.' }); return null; }
  const employeeId = Number(req.params.employeeId);
  if (!Number.isInteger(employeeId) || employeeId <= 0) { res.status(400).json({ error: 'Invalid employee' }); return null; }
  if (!(await canAdminAccessUser(req.branchContext, employeeId, oId))) {
    res.status(403).json({ error: 'You do not have access to this employee.' }); return null;
  }
  return { oId, employeeId };
}

// GET /employees/:employeeId/review — employee data + approved documents + what is missing
router.get('/employees/:employeeId/review', auth, requireAdmin, withBranchContext, async (req, res) => {
  try {
    const g = await loadEmployeeGuard(req, res); if (!g) return;
    const prepared = await prepareEmployeeBgv(pool, { orgId: g.oId, employeeId: g.employeeId });
    if (!prepared) return res.status(404).json({ error: 'Employee not found' });
    const { rows: active } = await pool.query(
      `SELECT ${PUBLIC_COLS} FROM bgv_requests
        WHERE organization_id = $1 AND employee_id = $2 AND status = ANY($3) ORDER BY created_at DESC LIMIT 1`,
      [g.oId, g.employeeId, ACTIVE]);
    let submitEnabled = false;
    try { const p = getProvider(); submitEnabled = typeof p.submitBgv === 'function' && typeof p.addCandidate === 'function'; } catch { /* not configured */ }
    res.json({ ...toReviewView(prepared), active_request: active[0] || null,
               submit_enabled: submitEnabled,
               submit_blocked_reason: submitEnabled ? null : 'BGV service is not configured. Please contact support.' });
  } catch (err) {
    console.error('[bgv] review failed:', err.message);
    res.status(500).json({ error: 'Failed to load BGV review' });
  }
});

const SUBMIT_FRIENDLY = {
  INVALID_INPUT: 'The employee needs a valid name, email address and 10-digit mobile number before BGV can be requested.',
  DUPLICATE_CANDIDATE: 'This person already exists in SpringVerify (same email, phone or employee id).',
  INVALID_REQUEST: 'SpringVerify rejected the request. Check the details below and your SpringVerify account/credits.',
  RATE_LIMITED: 'SpringVerify is busy. Please try again in a few minutes.',
  AUTH_FAILED: 'BGV service credentials were rejected. Please contact support.',
};

// POST /employees/:employeeId/submit — body { fields?: { phone?, date_of_birth?, address? }, doc_details?: { [submissionId]: { id_number?, course_type? } } }
router.post('/employees/:employeeId/submit', auth, requireAdmin, withBranchContext, async (req, res) => {
  try {
    const g = await loadEmployeeGuard(req, res); if (!g) return;
    const { oId, employeeId } = g;

    let provider;
    try { provider = getProvider(); if (typeof provider.submitBgv !== 'function' || typeof provider.addCandidate !== 'function') throw new Error('unsupported'); }
    catch (e) { console.error('[bgv] provider unavailable:', e.code || e.message); return res.status(503).json({ error: 'BGV service is not configured. Please contact support.' }); }
    try { if (provider.ensureReady) provider.ensureReady(); }
    catch (e) { console.error('[bgv] provider config incomplete:', e.code, e.message); return res.status(503).json({ error: 'BGV service is not configured. Please contact support.' }); }

    // One BGV per employee: refuse while one is active.
    const { rows: active } = await pool.query(
      `SELECT ${PUBLIC_COLS} FROM bgv_requests
        WHERE organization_id = $1 AND employee_id = $2 AND provider = $3 AND status = ANY($4) LIMIT 1`,
      [oId, employeeId, provider.name, ACTIVE]);
    if (active.length) return res.status(409).json({ error: 'A BGV request is already active for this employee.', existing: active[0] });

    const prepared = await prepareEmployeeBgv(pool, { orgId: oId, employeeId, overrides: req.body?.fields, docDetails: req.body?.doc_details });
    if (!prepared) return res.status(404).json({ error: 'Employee not found' });
    if (!prepared.ready) return res.status(400).json({ error: 'Required information is missing.', missing: prepared.missing });

    // A previous attempt that created the candidate but was rejected at submit (validation) is resubmitted on the SAME
    // candidate (SpringVerify leaves it untouched on a 400) — a fresh add would be a duplicate (409) / second paid candidate.
    const { rows: reusable } = await pool.query(
      `SELECT provider_candidate_id FROM bgv_requests
        WHERE organization_id = $1 AND employee_id = $2 AND provider = $3 AND status = 'failed'
          AND provider_candidate_id IS NOT NULL AND provider_status = '3'
        ORDER BY created_at DESC LIMIT 1`, [oId, employeeId, provider.name]);
    const reuseCandidateId = reusable[0]?.provider_candidate_id || null;
    const packageIdentifier = (process.env.SPRINGVERIFY_PACKAGE_IDENTIFIER || '').trim() || null;

    // Reserve the single active slot BEFORE any paid call (partial unique index makes concurrent clicks safe).
    const ins = await pool.query(
      `INSERT INTO bgv_requests (organization_id, employee_id, provider, package_identifier, status, requested_by)
       VALUES ($1,$2,$3,$4,'pending',$5)
       ON CONFLICT (organization_id, employee_id, provider) WHERE status IN ('pending','in_progress') DO NOTHING
       RETURNING id`, [oId, employeeId, provider.name, packageIdentifier, req.user.id]);
    if (!ins.rows.length) return res.status(409).json({ error: 'A BGV request is already active for this employee.' });
    const requestId = ins.rows[0].id;
    const reference = `hrms-${oId}-${employeeId}`;
    await audit(pool, { orgId: oId, requestId, provider: provider.name, type: 'requested', actorId: req.user.id,
                        payload: { employee_id: employeeId, documents: prepared.documents.filter(d => d.sv).length, reused_candidate: !!reuseCandidateId } });

    const fail = async (e, stage, candidateId) => {
      const code = e instanceof BgvProviderError ? e.code : 'PROVIDER_ERROR';
      const fieldErrors = (e && e.fieldErrors) || [];
      let msg = e.outcomeUnknown ? `Outcome unknown (${code}) — verify in the SpringVerify portal before retrying`
                                 : `Provider error (${code})`;
      if (fieldErrors.length) msg = 'SpringVerify rejected: ' + fieldErrors.map(f => `${f.field}: ${f.error}`).join('; ');
      msg = msg.slice(0, 900);
      // provider_status '3' = candidate exists but nothing was submitted -> the next attempt reuses it.
      await pool.query(
        `UPDATE bgv_requests SET status = 'failed', error_message = $2, provider_candidate_id = COALESCE($3, provider_candidate_id),
                provider_status = CASE WHEN $3 IS NOT NULL AND $4 THEN '3' ELSE provider_status END, updated_at = NOW() WHERE id = $1`,
        [requestId, msg, candidateId || null, stage === 'submit' && !e.outcomeUnknown]).catch(() => {});
      await audit(pool, { orgId: oId, requestId, provider: provider.name, type: 'request_failed', actorId: req.user.id,
                          payload: { code, stage, outcome_unknown: !!e.outcomeUnknown, fields: fieldErrors.length } }).catch(() => {});
      console.error('[bgv] provider call failed:', stage, code, e.message);
      const status = code === 'INVALID_INPUT' || code === 'INVALID_REQUEST' ? 422 : 502;
      const friendly = SUBMIT_FRIENDLY[code] || 'Could not submit the BGV request. Please try again later.';
      // apiFetch on the client only surfaces `error`, so the field-level reasons are folded into it as well.
      return res.status(status).json({
        error: fieldErrors.length ? `${friendly} ${fieldErrors.map(f => `${f.field}: ${f.error}`).join('; ')}`.slice(0, 900) : friendly,
        code, field_errors: fieldErrors });
    };

    let candidateId = reuseCandidateId;
    if (!candidateId) {
      try {
        const out = await provider.addCandidate({ employee: prepared.employee, reference });
        candidateId = out.candidateId;
        await pool.query(`UPDATE bgv_requests SET provider_candidate_id = $2, provider_status = $3, updated_at = NOW() WHERE id = $1`,
          [requestId, candidateId, out.providerStatus || null]);
      } catch (e) { return fail(e, 'add', null); }
    } else {
      // uq_bgv_provider_candidate allows one row per candidate id: hand it over from the earlier failed row.
      await pool.query(`UPDATE bgv_requests SET provider_candidate_id = NULL WHERE provider = $1 AND provider_candidate_id = $2 AND id <> $3`,
        [provider.name, candidateId, requestId]);
      await pool.query(`UPDATE bgv_requests SET provider_candidate_id = $2, provider_status = '3', updated_at = NOW() WHERE id = $1`, [requestId, candidateId]);
    }

    try {
      const out = await provider.submitBgv({ candidateId, employee: prepared.employee, documents: prepared.documents });
      const { rows } = await pool.query(
        `UPDATE bgv_requests SET status = 'in_progress', provider_status = $2, raw_response = $3, error_message = NULL, updated_at = NOW()
          WHERE id = $1 RETURNING ${PUBLIC_COLS}`,
        [requestId, out.providerStatus || null, out.raw ? JSON.stringify(out.raw) : null]);
      await audit(pool, { orgId: oId, requestId, provider: provider.name, type: 'submitted', actorId: req.user.id,
                          payload: { employee_id: employeeId, documents: prepared.documents.filter(d => d.sv).length } });
      return res.status(201).json(rows[0]);
    } catch (e) { return fail(e, 'submit', candidateId); }
  } catch (err) {
    console.error('[bgv] submit failed:', err.message);
    res.status(500).json({ error: 'Failed to submit BGV' });
  }
});

// POST /requests/:id/refresh — pull the latest status from the provider (fallback to the webhook).
router.post('/requests/:id/refresh', auth, requireAdmin, withBranchContext, async (req, res) => {
  try {
    if (!(await isBgvEnabled(req.user.organization_id))) return res.status(403).json({ error: 'BGV is not enabled for your organization.' });
    const r = await loadScopedRequest(req, req.params.id);
    if (!r) return res.status(404).json({ error: 'BGV request not found' });
    if (TERMINAL.includes(r.status)) return res.status(409).json({ error: 'This BGV is already finished.' });
    if (!r.provider_candidate_id) return res.status(409).json({ error: 'This BGV has no provider reference to refresh.' });

    let provider;
    try { provider = getProvider(); if (provider.name !== r.provider || typeof provider.refreshStatus !== 'function') throw new Error('provider mismatch'); }
    catch { return res.status(503).json({ error: 'BGV service is not configured. Please contact support.' }); }

    let out;
    try { out = await provider.refreshStatus({ candidateId: r.provider_candidate_id, requestId: r.provider_request_id }); }
    catch (e) {
      console.error('[bgv] refresh failed:', e.code || e.message);
      return res.status(502).json({ error: 'Could not refresh the status right now. Please try again later.' });
    }
    // Same rule as the webhook: unknown provider statuses are recorded but never change state; finished is final.
    const mapped = provider.mapStatus(out.providerStatus);
    const { rows } = await pool.query(
      `UPDATE bgv_requests
          SET status = COALESCE($2, status), provider_status = $3,
              completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END,
              error_message = CASE WHEN $2 = 'failed' THEN 'Reported failed by provider' ELSE error_message END,
              updated_at = NOW()
        WHERE id = $1 AND status = ANY($4) RETURNING ${PUBLIC_COLS}`,
      [r.id, mapped, String(out.providerStatus), ACTIVE]);
    await audit(pool, { orgId: r.organization_id, requestId: r.id, provider: r.provider, type: 'refreshed',
                        actorId: req.user.id, payload: { provider_status: String(out.providerStatus), mapped } }).catch(() => {});
    res.json(rows[0] || toPublic(r));
  } catch (err) {
    console.error('[bgv] refresh failed:', err.message);
    res.status(500).json({ error: 'Failed to refresh BGV status' });
  }
});

// GET /my-status — the signed-in employee's OWN latest BGV status (status only; no report, no error detail)
router.get('/my-status', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    if (!(await isBgvEnabled(oId))) return res.json({ enabled: false });
    const { rows } = await pool.query(
      `SELECT status, requested_at, completed_at FROM bgv_requests
        WHERE organization_id = $1 AND employee_id = $2 ORDER BY created_at DESC LIMIT 1`, [oId, req.user.id]);
    res.json({ enabled: true, request: rows[0] || null });
  } catch (err) {
    console.error('[bgv] my-status failed:', err.message);
    res.status(500).json({ error: 'Failed to load BGV status' });
  }
});

// ── POST /webhook ───────────────────────────────────────────────────────────────
// No JWT: authenticity is established by provider.verifyWebhook() per the provider's official scheme.
router.post('/webhook', async (req, res) => {
  let provider;
  try { provider = getProvider(); } catch { return res.status(503).json({ error: 'unavailable' }); }

  let evt;
  try {
    provider.verifyWebhook(req);
    evt = provider.parseWebhook(req);
  } catch (e) {
    const code = e instanceof BgvProviderError ? e.code : 'ERROR';
    const status = code === 'WEBHOOK_INVALID' ? 400 : code === 'WEBHOOK_UNAUTHORIZED' ? 401 : 503;
    return res.status(status).json({ error: 'rejected' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Org/employee come from OUR row found by provider candidate id — never from the payload.
    const { rows: reqRows } = await client.query(
      'SELECT * FROM bgv_requests WHERE provider = $1 AND provider_candidate_id = $2 FOR UPDATE',
      [provider.name, evt.candidateId]);
    const r = reqRows[0] || null;

    // Idempotency: first insert wins; a retry of the same event id is a no-op.
    const ev = await client.query(
      `INSERT INTO bgv_events (organization_id, bgv_request_id, provider, provider_event_id, event_type, source, payload)
       VALUES ($1,$2,$3,$4,$5,'webhook',$6)
       ON CONFLICT (provider, provider_event_id) WHERE provider_event_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [r ? r.organization_id : null, r ? r.id : null, provider.name, evt.eventId, String(evt.providerStatus),
       JSON.stringify(evt.raw || {})]);
    if (!ev.rows.length) { await client.query('COMMIT'); return res.json({ ok: true, duplicate: true }); }

    if (r) {
      const mapped = provider.mapStatus(evt.providerStatus);
      // Never move a finished request; unknown provider statuses are recorded but do not change state.
      if (mapped && !TERMINAL.includes(r.status)) {
        const safeReport = typeof evt.reportUrl === 'string' && /^https:\/\//i.test(evt.reportUrl) ? evt.reportUrl : null;
        await client.query(
          `UPDATE bgv_requests
              SET status = $2, provider_status = $3, report_url = COALESCE($4, report_url),
                  completed_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE completed_at END,
                  error_message = CASE WHEN $2 = 'failed' THEN 'Reported failed by provider' ELSE error_message END,
                  updated_at = NOW()
            WHERE id = $1`, [r.id, mapped, String(evt.providerStatus), safeReport]);
        if (mapped === 'completed' || mapped === 'failed' || mapped === 'cancelled') {
          await audit(client, { orgId: r.organization_id, requestId: r.id, provider: provider.name,
                                type: mapped, payload: { provider_event_id: evt.eventId } });
        }
      }
    }
    await client.query('UPDATE bgv_events SET processed_at = NOW() WHERE id = $1', [ev.rows[0].id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[bgv] webhook failed:', err.message);
    res.status(500).json({ error: 'processing failed' }); // provider will retry; idempotency makes that safe
  } finally {
    client.release();
  }
});

module.exports = router;
module.exports.isBgvEnabled = isBgvEnabled;
