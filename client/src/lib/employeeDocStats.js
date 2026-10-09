/**
 * employeeDocStats — what the employee "My Documents" cards and lists are built from.
 * Pure (no React), so it is unit-tested (backend/src/tests/employee_doc_stats.test.js).
 *
 * `requirements` = GET /doc-requirements as an employee: each requirement with `is_required` and `_submission`
 * (null, or { status: 'under_review' | 'approved' | 'rejected' | 're_upload_requested', ... }).
 *
 * Rules (owner decision 2026-10-09):
 *  • The five cards and the completion ring describe the REQUIRED documents only, so they always add up
 *    (an approved OPTIONAL document used to inflate "Approved": "4 Total Required" next to "7 Approved").
 *  • An optional document that is already uploaded lives in "My Submitted Documents"; the Optional list only offers the
 *    optional documents that have NOT been uploaded yet (a rejected / re-upload-requested optional one is already in
 *    "Action Required").
 */
export function employeeDocStats(requirements = []) {
  const reqs = Array.isArray(requirements) ? requirements : [];
  const required = reqs.filter(r => r.is_required);
  const status = (r) => r._submission?.status;
  const count = (list, s) => list.filter(r => status(r) === s).length;

  const totalRequired = required.length;
  const approved = count(required, 'approved');
  return {
    totalRequired,
    approved,
    underReview: count(required, 'under_review'),
    reuploadRequested: count(required, 're_upload_requested'),
    rejected: count(required, 'rejected'),
    notUploaded: required.filter(r => !r._submission).length,
    progressPct: totalRequired > 0 ? Math.round((approved / totalRequired) * 100) : 0,
    // all optional documents, and the ones still waiting for the employee
    optionalTotal: reqs.filter(r => !r.is_required).length,
    optionalPending: reqs.filter(r => !r.is_required && !r._submission),
    // every uploaded document (required or optional) — the "My Submitted Documents" table
    uploaded: reqs.filter(r => r._submission),
    // needs the employee: required & missing, or anything rejected / re-upload requested
    actionRequired: reqs.filter(r => (r.is_required && !r._submission) || status(r) === 'rejected' || status(r) === 're_upload_requested'),
  };
}
