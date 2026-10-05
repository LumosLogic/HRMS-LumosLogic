/**
 * springverify.client.js — SpringVerify BGV provider (API guide v3.4).
 *
 * V1 flow: HR clicks "Run BGV" -> POST /external/v1/candidate/add with invite:true. SpringVerify emails the
 * employee a personal form link (bgv_url); the employee supplies identity/address/education/employment data
 * to SpringVerify directly. HRMS therefore never sends personal documents. (/v2/submit-bgv is intentionally unused.)
 * Progress arrives by webhook (bearer-authenticated); the report is fetched on demand with the API token.
 *
 * Env: SPRINGVERIFY_BASE_URL (https, *.springverify.com), SPRINGVERIFY_API_TOKEN,
 *      SPRINGVERIFY_PACKAGE_IDENTIFIER (= package.subtype_id, integer, from GET /packages),
 *      SPRINGVERIFY_WEBHOOK_SECRET (the bearer token SpringVerify must send to our webhook).
 * The token is never logged, stored or returned. bgv_url / candidate tokens are never stored.
 */
const crypto = require('crypto');
const { BgvProviderError } = require('./bgv.provider');

const TIMEOUT_MS = 20000;

function cfg() {
  const base = (process.env.SPRINGVERIFY_BASE_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.SPRINGVERIFY_API_TOKEN || '').trim();
  const subtypeId = Number((process.env.SPRINGVERIFY_PACKAGE_IDENTIFIER || '').trim());
  let host = '';
  try { const u = new URL(base); if (u.protocol === 'https:') host = u.hostname; } catch { /* invalid */ }
  if (!host || !/(^|\.)springverify\.com$/i.test(host))
    throw new BgvProviderError('CONFIG_INVALID', 'SPRINGVERIFY_BASE_URL must be an https *.springverify.com URL');
  if (!token) throw new BgvProviderError('CONFIG_INVALID', 'SPRINGVERIFY_API_TOKEN is not set');
  if (!Number.isInteger(subtypeId) || subtypeId <= 0)
    throw new BgvProviderError('CONFIG_INVALID', 'SPRINGVERIFY_PACKAGE_IDENTIFIER must be the integer package subtype_id');
  return { base, token, subtypeId };
}

function httpError(status, json) {
  const msg = String((json && (json.message || json.msg || json.error)) || `HTTP ${status}`).slice(0, 200);
  if (status === 401) return new BgvProviderError('AUTH_FAILED', msg);
  if (status === 409) return new BgvProviderError('DUPLICATE_CANDIDATE', msg);
  if (status === 429) return new BgvProviderError('RATE_LIMITED', msg);
  if (status === 404) return new BgvProviderError('NOT_FOUND', msg);
  if (status >= 500) return new BgvProviderError('PROVIDER_5XX', msg, { outcomeUnknown: true });
  return new BgvProviderError('INVALID_REQUEST', msg); // 400 / 413 / 422
}

async function request(method, path, { query, body } = {}) {
  const c = cfg();
  const url = new URL(c.base + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, {
        method, redirect: 'error', signal: ctrl.signal,
        headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // The request may or may not have reached SpringVerify.
      throw new BgvProviderError(e && e.name === 'AbortError' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK',
        'request to SpringVerify failed', { outcomeUnknown: true });
    }
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) throw httpError(res.status, json);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// Spec: name = letters, spaces, dot, hyphen; min 2 chars.
function cleanName(n) { return String(n || '').replace(/[^\p{L}\s.\-]/gu, ' ').replace(/\s+/g, ' ').trim(); }
// Spec: 10-digit Indian mobile, no 91 / 0 / +91 prefix. Invalid numbers are omitted (not required unless the company says so).
function cleanPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

// overall_status_code -> internal status. Codes per guide: 0 In progress, 1 Completed, 3 Awaiting Input, 4 Processing,
// 5 Discrepancy, 6 Completed with exception, 8 Closed, 9 On Hold, 10 Cancelled, 11 Consent missing, 12 Insufficient funds.
// Finished per the guide: 1, 6, 8, 10. Interim stalls (5, 9, 12) stay in_progress so no second paid request is allowed.
const STATUS_MAP = { 0: 'in_progress', 1: 'completed', 3: 'pending', 4: 'in_progress', 5: 'in_progress',
  6: 'completed', 8: 'cancelled', 9: 'in_progress', 10: 'cancelled', 11: 'pending', 12: 'in_progress' };

module.exports = {
  name: 'springverify',

  /** Throws if configuration is incomplete — called BEFORE a request slot is reserved or any call is made. */
  ensureReady() { cfg(); },

  async createCandidate({ employee, reference }) {
    const c = cfg();
    const name = cleanName(employee && employee.name);
    const email = String((employee && employee.email) || '').trim();
    if (name.length < 2) throw new BgvProviderError('INVALID_INPUT', 'employee name is not valid for SpringVerify');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BgvProviderError('INVALID_INPUT', 'employee email is required');
    // This account's required_fields are EMAIL + PHONE, and the invite flow needs a way to reach the employee,
    // so a missing/invalid mobile fails here instead of as a rejected (or half-created) provider call.
    const phone = cleanPhone(employee.phone);
    if (!phone) throw new BgvProviderError('INVALID_INPUT', 'employee needs a valid 10-digit Indian mobile number');

    const json = await request('POST', '/external/v1/candidate/add', {
      body: {
        candidate: {
          name, email, phone,
          invite: true, // employee completes the form on SpringVerify; email required
          meta_data: { hrms_bgv_request_id: String(reference), hrms_employee_id: String(employee.id) },
        },
        package: { subtype_id: c.subtypeId },
        send_invite_email: true,
      },
    });
    const candidateId = json && json.data && json.data.candidate_id;
    if (candidateId == null) {
      // 200 without an id: the candidate probably exists, so a retry could duplicate a paid request.
      throw new BgvProviderError('PROVIDER_BAD_RESPONSE', 'candidate_id missing in response', { outcomeUnknown: true });
    }
    return {
      candidateId: String(candidateId),
      requestId: null,
      providerStatus: '3', // new candidates land in "Awaiting Input"
      raw: { message: json.message || null, meta_data: json.data.meta_data || null }, // bgv_url / token deliberately dropped
    };
  },

  /** Report PDF is fetched on demand (webhook report_url expires). Returns base64 for the authenticated HRMS user. */
  async getReport({ candidateId }) {
    const json = await request('GET', '/external/v1/candidate/report/pdf', {
      query: { candidate_id: candidateId, report_type: 'base_64' },
    });
    if (!json || typeof json.report !== 'string' || !json.report) throw new BgvProviderError('REPORT_UNAVAILABLE', 'no report returned');
    return { kind: 'pdf', base64: json.report, fileName: `bgv-report-${candidateId}.pdf` };
  },

  /** Webhook auth: SpringVerify is configured with the "bearer" scheme and our SPRINGVERIFY_WEBHOOK_SECRET. */
  verifyWebhook(req) {
    const secret = (process.env.SPRINGVERIFY_WEBHOOK_SECRET || '').trim();
    if (!secret) throw new BgvProviderError('WEBHOOK_SECRET_MISSING', 'webhook secret not configured');
    const got = req.headers && req.headers.authorization;
    if (!got || !safeEqual(got, `Bearer ${secret}`)) throw new BgvProviderError('WEBHOOK_UNAUTHORIZED', 'bad webhook credentials');
    return true;
  },

  parseWebhook(req) {
    const b = req.body || {};
    const cid = b.candidate_id;
    const code = Number(b.overall_status_code);
    if (cid == null || !/^\d+$/.test(String(cid)) || !Number.isInteger(code))
      throw new BgvProviderError('WEBHOOK_INVALID', 'candidate_id and overall_status_code are required');
    return {
      eventId: `${cid}:${code}`, // SpringVerify's documented idempotency key
      candidateId: String(cid),
      providerStatus: String(code),
      reportUrl: null, // signed URL expires — the report is fetched on demand instead
      raw: { event: b.event || null, candidate_id: Number(cid), overall_status_code: code,
             overall_status: b.overall_status || null, completed_date: b.completed_date || null,
             meta_data: b.meta_data || null }, // name/email/report_url intentionally not persisted
    };
  },

  mapStatus(code) { return STATUS_MAP[Number(code)] || null; },
};
