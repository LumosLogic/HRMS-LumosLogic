/**
 * bgv.routes.js — Background Verification (SpringVerify) — ADDITIVE module, mounted at /api/bgv.
 *
 *   GET  /requests                list BGV requests for employees the caller may access
 *   POST /requests                start a (paid) BGV for one employee            [feature `bgv` must be ON]
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
router.post('/requests', auth, requireAdmin, withBranchContext, async (req, res) => {
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
