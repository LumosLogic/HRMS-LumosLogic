/**
 * bgv.prepare.js — server-side data/document preparation for the employee-level BGV review step.
 *
 * Collects the employee's profile data and their APPROVED HRMS documents that SpringVerify actually verifies
 * (read-only: the Documents workflow tables are never written). Nothing here talks to SpringVerify and nothing is persisted.
 *
 * The verified checks are FIXED for BGV-enabled organizations (package "ID+ADD+EDU+EMP"):
 *   Identity    any 1 of PAN / Driving License / Passport / Voter ID   (Aadhaar is NOT part of this package)
 *   Address     physical, any 1 (current or permanent)
 *   Employment  last 1
 *   Education   highest 1
 * Any other HRMS document is ignored — it is not sent (SpringVerify would reject it) and never blocks BGV.
 */

// key -> { label, required, max }. `required` here = HRMS-side minimum, NOT a SpringVerify requirement.
const EDITABLE_FIELDS = {
  phone:         { label: 'Mobile number (10-digit Indian)', required: true,  max: 20 },
  date_of_birth: { label: 'Date of birth',                   required: false, max: 30 },
  address:       { label: 'Address',                         required: false, max: 500 },
  uan_number:    { label: 'UAN number (12 digits)',          required: false, max: 20 },
};

const cleanName = (n) => String(n || '').replace(/[^\p{L}\s.\-]/gu, ' ').replace(/\s+/g, ' ').trim();

function cleanPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

const cleanUan = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length === 12 ? d : ''; };

/** Whitelist + trim HR-supplied values. Unknown keys are dropped; values are strings only. */
function sanitizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, spec] of Object.entries(EDITABLE_FIELDS)) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, spec.max);
  }
  return out;
}

// ── HRMS document -> SpringVerify section/tag (SpringVerify API guide v3.4, "Document types") ──────────────────
// Derived from the requirement NAME. Order matters (first match wins). Aadhaar is deliberately absent: the package
// does not accept it as an identity document.
const COURSE_TYPES = ['10', '12', 'DIPLOMA', 'UNDERGRAD', 'POSTGRAD', 'PHD', 'OTHER'];
const IDENTITY_RULES = [ // rank = which one is sent when several exist (only ONE identity is verified)
  { re: /\bpan\b/i,                  id_type: 'PAN',      tag: 'pan',             rank: 1 },
  { re: /driv(ing|er)|\bdl\b/i,      id_type: 'DL',       tag: 'driving_license', rank: 2 },
  { re: /passport/i,                 id_type: 'PASSPORT', tag: 'passport',        rank: 3 },
  { re: /voter/i,                    id_type: 'VOTER_ID', tag: 'voter_id',        rank: 4 },
];
const EMPLOYMENT_RE = /offer|appointment|relieving|relieved|experience|pay ?slip|salary slip|resignation|employment|employer/i;
const ADDRESS_RE    = /rent|lease|electricity|water|gas bill|utility|telephone bill|internet bill|address proof|ration|passbook|\baddress\b/i;
const EDUCATION_RE  = /degree|education|marksheet|mark sheet|graduat|diploma|qualification|academic|provisional/i;

function employmentTag(n) {
  if (/offer/i.test(n)) return 'offer_letter';
  if (/appointment/i.test(n)) return 'appointment_letter';
  if (/relieving|relieved/i.test(n)) return 'relieving_letter';
  if (/pay ?slip|salary slip/i.test(n)) return 'payslip';
  if (/resignation/i.test(n)) return 'resignation_letter';
  return 'experience_letter';
}
function addressTag(n) {
  if (/electricity/i.test(n)) return 'electricity_bill';
  if (/water/i.test(n)) return 'water_bill';
  if (/gas/i.test(n)) return 'gas_bill';
  if (/telephone/i.test(n)) return 'telephone_bill';
  if (/internet/i.test(n)) return 'internet_bill';
  if (/ration/i.test(n)) return 'ration_card';
  if (/passbook/i.test(n)) return 'bank_passbook';
  return 'rental_agreement';
}
const educationTag = (n) => (/marksheet|mark sheet/i.test(n) ? 'consolidated_marksheet' : 'degree_certificate');

/** -> { section, id_type, tag, rank } for a verified document type, or null (ignored). */
function classifyDoc(name) {
  const n = String(name || '');
  const idr = IDENTITY_RULES.find(x => x.re.test(n));
  if (idr) return { section: 'identity', id_type: idr.id_type, tag: idr.tag, rank: idr.rank };
  if (EMPLOYMENT_RE.test(n)) return { section: 'employment', id_type: null, tag: employmentTag(n), rank: 0 };
  if (ADDRESS_RE.test(n))    return { section: 'address',    id_type: null, tag: addressTag(n),    rank: 0 };
  if (EDUCATION_RE.test(n))  return { section: 'education',  id_type: null, tag: educationTag(n),  rank: 0 };
  return null;
}

const DETAIL_KEYS = {
  id_number:    (v) => v.replace(/\s+/g, '').slice(0, 30),
  course_type:  (v) => (COURSE_TYPES.includes(v) ? v : null),
  company_name: (v) => v.trim().slice(0, 150),
  designation:  (v) => v.trim().slice(0, 100),
  start_date:   (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null),
  end_date:     (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null),
  city:         (v) => v.trim().slice(0, 80),
  state:        (v) => v.trim().slice(0, 80),
  pin_code:     (v) => (/^\d{6}$/.test(v.trim()) ? v.trim() : null),
};

/** Whitelist per-document details HR may add: { [submissionId]: { id_number, course_type, company_name, ... } }. */
function sanitizeDocDetails(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [sid, v] of Object.entries(raw)) {
    if (!/^\d+$/.test(sid) || !v || typeof v !== 'object') continue;
    const d = {};
    for (const [k, fn] of Object.entries(DETAIL_KEYS)) {
      if (typeof v[k] === 'string' && v[k].trim()) { const c = fn(v[k]); if (c) d[k] = c; }
    }
    if (Object.keys(d).length) out[sid] = d;
  }
  return out;
}

/**
 * Marks which documents are sent: d.sv = {section, id_type, tag} for sent ones, null otherwise, with d.skip_reason.
 * Only ONE identity (best rank) is sent; address / employment / education documents are grouped into a single entry.
 */
function selectDocuments(documents) {
  let bestId = null;
  for (const d of documents) {
    d.sv = classifyDoc(d.requirement_name);
    if (d.sv && d.sv.section === 'identity' && (!bestId || d.sv.rank < bestId.sv.rank)) bestId = d;
  }
  for (const d of documents) {
    if (!d.sv) d.skip_reason = 'Not verified by BGV';
    else if (d.sv.section === 'identity' && d !== bestId) { d.sv = null; d.skip_reason = 'Only one identity document is verified'; }
  }
  return documents;
}

/**
 * @returns {Promise<null | { employee, documents, missing, ready }>}
 *   documents[] include file_url for server use only — strip with toReviewView() before sending to a browser.
 */
async function prepareEmployeeBgv(pool, { orgId, employeeId, overrides, docDetails }) {
  const { rows: emp } = await pool.query(
    `SELECT id, name, email, phone, date_of_birth, address, gender, uan_no
       FROM users WHERE id = $1 AND organization_id = $2`, [employeeId, orgId]);
  if (!emp.length) return null;
  const ov = sanitizeOverrides(overrides);
  const u = emp[0];
  const employee = {
    id: u.id,
    name: u.name || '',
    email: u.email || '',
    phone: ov.phone ?? u.phone ?? '',
    date_of_birth: ov.date_of_birth ?? u.date_of_birth ?? '',
    address: ov.address ?? u.address ?? '',
    gender: u.gender || '',
    uan_number: cleanUan(ov.uan_number ?? u.uan_no),
  };

  // Only FINAL-approved submissions (status 'approved'); under_review / hr_approved / rejected are excluded.
  const { rows: documents } = await pool.query(
    `SELECT s.id AS submission_id, s.requirement_id, r.name AS requirement_name, r.category,
            s.file_name, s.file_type, s.file_size, s.file_url, s.expiry_date, s.reviewed_at
       FROM employee_doc_submissions s
       JOIN document_requirements r ON r.id = s.requirement_id
      WHERE s.organization_id = $1 AND s.user_id = $2 AND s.status = 'approved'
      ORDER BY r.display_order NULLS LAST, r.name`, [orgId, employeeId]);
  const details = sanitizeDocDetails(docDetails);
  selectDocuments(documents);
  for (const d of documents) d.detail = details[String(d.submission_id)] || {};

  const missing = [];
  if (cleanName(employee.name).length < 2)
    missing.push({ field: 'name', label: 'Name', reason: 'Employee name is missing or invalid — fix it in the employee profile.', editable: false });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email.trim()))
    missing.push({ field: 'email', label: 'Email', reason: 'Employee email is missing or invalid — fix it in the employee profile.', editable: false });
  if (!cleanPhone(employee.phone))
    missing.push({ field: 'phone', label: EDITABLE_FIELDS.phone.label, reason: 'A valid 10-digit Indian mobile number is needed.', editable: true });
  if (!documents.some(d => d.sv))
    missing.push({ field: 'documents', label: 'Documents to verify', editable: false,
      reason: 'No approved document that BGV verifies (PAN / Driving License / Passport / Voter ID, address proof, employment record or education record).' });

  return { employee, documents, missing, ready: missing.length === 0 };
}

/** Browser-safe view: no file URLs (documents are opened through the existing Documents flow). */
function toReviewView(prepared) {
  return {
    employee: prepared.employee,
    documents: prepared.documents.map(({ file_url, sv, detail, ...d }) => ({
      ...d,
      sends: !!sv,
      section: sv ? sv.section : null,
      id_number: detail.id_number || '',
      course_type: detail.course_type || (sv && sv.section === 'education' ? 'UNDERGRAD' : ''),
      company_name: detail.company_name || '', designation: detail.designation || '',
      start_date: detail.start_date || '', end_date: detail.end_date || '',
      city: detail.city || '', state: detail.state || '', pin_code: detail.pin_code || '',
    })),
    course_types: COURSE_TYPES,
    missing: prepared.missing,
    ready: prepared.ready,
    editable_fields: Object.entries(EDITABLE_FIELDS).map(([key, s]) => ({ key, label: s.label, required: s.required })),
  };
}

module.exports = { prepareEmployeeBgv, toReviewView, sanitizeOverrides, sanitizeDocDetails, classifyDoc, selectDocuments, COURSE_TYPES, EDITABLE_FIELDS };
