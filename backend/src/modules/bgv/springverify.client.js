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

// Field-level validation problems. /add uses errors[{path,msg}], /v2/submit-bgv uses errors[{field,error}].
function fieldErrorsOf(json) {
  const arr = json && Array.isArray(json.errors) ? json.errors : [];
  return arr.slice(0, 20).map(e => ({
    field: String(e.field || e.path || '').slice(0, 120),
    error: String(e.error || e.msg || '').slice(0, 200),
  })).filter(e => e.field || e.error);
}

function httpError(status, json) {
  const msg = String((json && (json.message || json.msg || json.error)) || `HTTP ${status}`).slice(0, 200);
  let err;
  if (status === 401) err = new BgvProviderError('AUTH_FAILED', msg);
  else if (status === 409) err = new BgvProviderError('DUPLICATE_CANDIDATE', msg);
  else if (status === 429) err = new BgvProviderError('RATE_LIMITED', msg);
  else if (status === 404) err = new BgvProviderError('NOT_FOUND', msg);
  else if (status >= 500) err = new BgvProviderError('PROVIDER_5XX', msg, { outcomeUnknown: true });
  else err = new BgvProviderError('INVALID_REQUEST', msg); // 400 / 413 / 422
  err.httpStatus = status;
  err.fieldErrors = fieldErrorsOf(json);
  return err;
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

// Accepts YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY or a Date; anything else is omitted rather than guessed.
function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
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

  /**
   * HRMS-submitted flow, step 1: POST /external/v1/candidate/add with invite:false — SpringVerify sends the
   * employee NO email/form; HRMS submits everything by API in step 2 (submitBgv). Creates the candidate only.
   */
  async addCandidate({ employee, reference }) {
    const c = cfg();
    const name = cleanName(employee && employee.name);
    const email = String((employee && employee.email) || '').trim();
    if (name.length < 2) throw new BgvProviderError('INVALID_INPUT', 'employee name is not valid for SpringVerify');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BgvProviderError('INVALID_INPUT', 'employee email is required');
    const phone = cleanPhone(employee.phone);
    if (!phone) throw new BgvProviderError('INVALID_INPUT', 'employee needs a valid 10-digit Indian mobile number');

    const json = await request('POST', '/external/v1/candidate/add', {
      body: {
        candidate: {
          name, email, phone, invite: false,
          employee_id: String(reference),
          meta_data: { hrms_reference: String(reference), hrms_employee_id: String(employee.id) },
        },
        package: { subtype_id: c.subtypeId },
      },
    });
    const candidateId = json && json.data && json.data.candidate_id;
    if (candidateId == null) throw new BgvProviderError('PROVIDER_BAD_RESPONSE', 'candidate_id missing in response', { outcomeUnknown: true });
    // bgv_url / token are deliberately dropped.
    return { candidateId: String(candidateId), providerStatus: '3', raw: { message: json.message || null } };
  },

  /**
   * Step 2: POST /external/v2/candidate/submit-bgv — basic details + the employee's approved HRMS documents
   * (sent as hosted https URLs; SpringVerify downloads and stores its own copy). One call covers ALL documents.
   * A 400 leaves the candidate unchanged, so the same candidate can be resubmitted after fixing the payload.
   */
  async submitBgv({ candidateId, employee, documents }) {
    const docUrl = (d) => {
      let u; try { u = new URL(d.file_url); } catch { u = null; }
      if (!u || u.protocol !== 'https:') throw new BgvProviderError('INVALID_INPUT', `document "${d.requirement_name}" has no https file link`);
      return { url: u.toString(), tag: d.sv.tag };
    };
    const body = { candidate_id: Number(candidateId), basic_details: { full_name: cleanName(employee.name), email: employee.email } };
    const mobile = cleanPhone(employee.phone); if (mobile) body.basic_details.mobile_number = mobile;
    const dob = toIsoDate(employee.date_of_birth); if (dob) body.basic_details.dob = dob;
    const gender = { male: '1', female: '2', 'non-binary': '3', other: '3' }[String(employee.gender || '').trim().toLowerCase()];
    if (gender) body.basic_details.gender = gender;

    const sent = documents.filter(d => d.sv);
    const merged = (list) => Object.assign({}, ...list.map(d => d.detail || {})); // HR-entered details, per section
    const bySection = (s) => sent.filter(d => d.sv.section === s);

    // Identity: exactly ONE document is verified (selectDocuments() already picked the best-ranked one).
    const [idDoc] = bySection('identity');
    if (idDoc) {
      const e = { id_type: idDoc.sv.id_type, name_on_document: cleanName(employee.name), combined_document: true, documents: [docUrl(idDoc)] };
      if (idDoc.detail && idDoc.detail.id_number) e.id_number = idDoc.detail.id_number;
      body.identity = { identity_1: e };
    }
    // Employment (last 1), education (highest 1): one entry each carrying all of its documents.
    const emp = bySection('employment');
    if (emp.length) {
      const m = merged(emp); const e = { documents: emp.map(docUrl) };
      if (m.company_name) e.company_name = m.company_name;
      if (m.designation) e.designation = m.designation;
      if (m.start_date) e.start_date = m.start_date;
      if (m.end_date) e.end_date = m.end_date;
      body.employment = { employment_1: e };
    }
    const edu = bySection('education');
    if (edu.length) body.education = { education_1: { course_type: merged(edu).course_type || 'UNDERGRAD', documents: edu.map(docUrl) } };
    // Address (physical, any 1): current address with the proof documents.
    const addr = bySection('address');
    if (addr.length) {
      const m = merged(addr);
      const cur = { documents: addr.map(docUrl), country: 'India' };
      const line = employee.address && String(employee.address).trim();
      if (line) cur.address_line_1 = line.slice(0, 300);
      if (m.city) cur.city = m.city;
      if (m.state) cur.state = m.state;
      if (m.pin_code) cur.pin_code = m.pin_code;
      body.address = { current: cur };
    }

    const json = await request('POST', '/external/v2/candidate/submit-bgv', { body });
    if (!json || json.success !== true) throw new BgvProviderError('PROVIDER_BAD_RESPONSE', 'submit not confirmed', { outcomeUnknown: true });
    return { candidateId: String(candidateId), providerStatus: null, raw: { message: json.message || null, documents: sent.length } };
  },

  /** Status pull (the webhook is the primary channel): GET /external/v1/candidate/details?candidate_id= */
  async refreshStatus({ candidateId }) {
    const json = await request('GET', '/external/v1/candidate/details', { query: { candidate_id: candidateId } });
    const d = json && json.data;
    const code = d && Number(d.overall_status_code);
    if (!d || !Number.isInteger(code)) throw new BgvProviderError('PROVIDER_BAD_RESPONSE', 'overall_status_code missing in response');
    return { providerStatus: String(code), raw: { overall_status: d.overall_status || null, overall_status_code: code, completion_date: d.completion_date || null } };
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
