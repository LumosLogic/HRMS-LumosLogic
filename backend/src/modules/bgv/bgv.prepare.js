/**
 * bgv.prepare.js — server-side data/document preparation for the employee-level BGV review step.
 *
 * Collects the employee's profile data and their APPROVED HRMS documents (read-only: the Documents workflow
 * tables are never written). Nothing here talks to SpringVerify and nothing is persisted.
 *
 * The field list below is PROVISIONAL — it is only what HRMS itself needs to identify the person. The real
 * required-field list, document mapping and format come from the SpringVerify submit contract (not yet
 * confirmed) and must replace/extend EDITABLE_FIELDS when that contract is supplied.
 */

// key -> { label, required, max }. `required` here = HRMS-side minimum, NOT a SpringVerify requirement.
const EDITABLE_FIELDS = {
  phone:         { label: 'Mobile number (10-digit Indian)', required: true,  max: 20 },
  date_of_birth: { label: 'Date of birth',                   required: false, max: 30 },
  address:       { label: 'Address',                         required: false, max: 500 },
};

const cleanName = (n) => String(n || '').replace(/[^\p{L}\s.\-]/gu, ' ').replace(/\s+/g, ' ').trim();

function cleanPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

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

/**
 * @returns {Promise<null | { employee, documents, missing, ready }>}
 *   documents[] include file_url for server use only — strip with toReviewView() before sending to a browser.
 */
async function prepareEmployeeBgv(pool, { orgId, employeeId, overrides }) {
  const { rows: emp } = await pool.query(
    `SELECT id, name, email, phone, date_of_birth, address
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
  };

  // Only FINAL-approved submissions (status 'approved'); under_review / hr_approved / rejected are excluded.
  const { rows: documents } = await pool.query(
    `SELECT s.id AS submission_id, s.requirement_id, r.name AS requirement_name, r.category,
            s.file_name, s.file_type, s.file_size, s.file_url, s.expiry_date, s.reviewed_at
       FROM employee_doc_submissions s
       JOIN document_requirements r ON r.id = s.requirement_id
      WHERE s.organization_id = $1 AND s.user_id = $2 AND s.status = 'approved'
      ORDER BY r.display_order NULLS LAST, r.name`, [orgId, employeeId]);

  const missing = [];
  if (cleanName(employee.name).length < 2)
    missing.push({ field: 'name', label: 'Name', reason: 'Employee name is missing or invalid — fix it in the employee profile.', editable: false });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email.trim()))
    missing.push({ field: 'email', label: 'Email', reason: 'Employee email is missing or invalid — fix it in the employee profile.', editable: false });
  if (!cleanPhone(employee.phone))
    missing.push({ field: 'phone', label: EDITABLE_FIELDS.phone.label, reason: 'A valid 10-digit Indian mobile number is needed.', editable: true });
  if (documents.length === 0)
    missing.push({ field: 'documents', label: 'Approved documents', reason: 'No approved HRMS documents yet. Approve the employee\'s documents first.', editable: false });

  return { employee, documents, missing, ready: missing.length === 0 };
}

/** Browser-safe view: no file URLs (documents are opened through the existing Documents flow). */
function toReviewView(prepared) {
  return {
    employee: prepared.employee,
    documents: prepared.documents.map(({ file_url, ...d }) => d),
    missing: prepared.missing,
    ready: prepared.ready,
    editable_fields: Object.entries(EDITABLE_FIELDS).map(([key, s]) => ({ key, label: s.label, required: s.required })),
  };
}

module.exports = { prepareEmployeeBgv, toReviewView, sanitizeOverrides, EDITABLE_FIELDS };
