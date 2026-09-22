const express    = require('express');
const router     = express.Router();
const { db, pool } = require('../../config/db');
const { auth }   = require('../../middleware/auth');
const cloudinary = require('cloudinary').v2;
const multer     = require('multer');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState, validateBranchAccess, resolveEmployeeIds } = require('../../utils/branchFilter');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// ─── Applicability helpers ─────────────────────────────────────────────────

/**
 * Returns true if a requirement applies to an employee.
 *
 * Rules (both must pass):
 *   Branch check:   assigned_branch_ids IS NULL/empty  →  no restriction
 *                   OR empBranchId IS in assigned_branch_ids
 *
 *   Employee check: assigned_employee_ids IS NULL/empty  →  no restriction
 *                   OR empId IS in assigned_employee_ids
 *
 * If the employee has no branch (branch_id = NULL), the branch check passes
 * only when the requirement has no branch restriction.
 */
function requirementAppliesTo(req, empId, empBranchId) {
  const branchPass = (
    !req.assigned_branch_ids ||
    req.assigned_branch_ids.length === 0 ||
    (empBranchId != null && req.assigned_branch_ids.includes(Number(empBranchId)))
  );
  const empPass = (
    !req.assigned_employee_ids ||
    req.assigned_employee_ids.length === 0 ||
    req.assigned_employee_ids.includes(Number(empId))
  );
  return branchPass && empPass;
}

/**
 * Returns true if a requirement is relevant for a given set of branch IDs (admin listing).
 *
 * A requirement is relevant when:
 *   - It has no branch restriction (assigned_branch_ids IS NULL/empty)
 *   - OR at least one of the admin's accessible branch IDs is in its assigned_branch_ids
 *
 * Used for the admin requirement list to show only requirements applicable to the
 * currently selected/accessible branches.
 */
function requirementRelevantForBranches(req, branchIds) {
  if (!req.assigned_branch_ids || req.assigned_branch_ids.length === 0) return true;
  return branchIds.some(bid => req.assigned_branch_ids.includes(Number(bid)));
}

/**
 * Validates that each branch ID belongs to the org and (for non-root admins)
 * that the requesting user has access to it.
 * Returns { valid: true } or { valid: false, error: string }.
 */
async function validateBranchIds(branchIds, orgId, userId, role) {
  if (!Array.isArray(branchIds) || branchIds.length === 0) return { valid: true };
  const nums = branchIds.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (nums.length !== branchIds.length) return { valid: false, error: 'Invalid branch ID(s)' };

  for (const bid of nums) {
    // validateBranchAccess checks org ownership first, then role access
    const ok = await validateBranchAccess(userId, orgId, role, bid);
    if (!ok) {
      return {
        valid: false,
        error: `Branch ID ${bid} is not accessible or does not belong to your organization.`,
      };
    }
  }
  return { valid: true };
}

const ALLOWED_MIMES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// GET /api/doc-requirements
// Admin: all requirements + submission stats (branch-filtered)
// Employee: active requirements applicable to them (branch + employee targeting)
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;

    let query = db
      .from('document_requirements')
      .select('*')
      .eq('organization_id', oId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (!isAdmin(req.user.role)) query = query.eq('is_active', true);

    const { data: requirements, error } = await query;
    if (error) throw error;

    let allReqs = requirements || [];

    if (isAdmin(req.user.role)) {
      // ── Admin: apply branch-context filter ────────────────────────────────
      const branchState = getFilterState(req.branchContext);

      if (branchState.type === 'none') return res.json([]);

      // Filter which requirements are relevant to the selected/accessible branches.
      // type=all → no filter (all org requirements returned).
      // type=specific → show requirements with no branch restriction OR that include this branch.
      // type=multi → show requirements with no branch restriction OR that include any accessible branch.
      if (branchState.type === 'specific') {
        allReqs = allReqs.filter(r => requirementRelevantForBranches(r, [branchState.branchId]));
      } else if (branchState.type === 'multi') {
        allReqs = allReqs.filter(r => requirementRelevantForBranches(r, branchState.branchIds));
      }
      // type=all: no filter

      const reqIds = allReqs.map(r => r.id);
      if (!reqIds.length) return res.json([]);

      const { data: subs } = await db
        .from('employee_doc_submissions')
        .select('requirement_id, status')
        .in('requirement_id', reqIds)
        .eq('organization_id', oId);

      const statsMap = {};
      (subs || []).forEach(s => {
        if (!statsMap[s.requirement_id]) statsMap[s.requirement_id] = { total: 0, approved: 0, hr_approved: 0, under_review: 0, rejected: 0, re_upload_requested: 0 };
        statsMap[s.requirement_id].total++;
        statsMap[s.requirement_id][s.status] = (statsMap[s.requirement_id][s.status] || 0) + 1;
      });

      return res.json(allReqs.map(r => ({ ...r, _stats: statsMap[r.id] || { total: 0 } })));
    }

    // ── Employee: filter by both branch and employee targeting ─────────────
    // Fetch the employee's actual branch_id from DB — never infer from X-Branch-Id.
    const { data: empRow } = await db
      .from('users')
      .select('branch_id')
      .eq('id', req.user.id)
      .eq('organization_id', oId)
      .maybeSingle();
    const empBranchId = empRow?.branch_id ?? null;

    const reqIds = allReqs.map(r => r.id);
    if (!reqIds.length) return res.json([]);

    const { data: mySubs } = await db
      .from('employee_doc_submissions')
      .select('*, reviewer:users!employee_doc_submissions_reviewed_by_fkey(name)')
      .eq('user_id', req.user.id)
      .eq('organization_id', oId)
      .in('requirement_id', reqIds);

    const subMap = {};
    (mySubs || []).forEach(s => { subMap[s.requirement_id] = s; });

    // Apply both branch and employee applicability
    const visible = allReqs.filter(r => requirementAppliesTo(r, req.user.id, empBranchId));

    res.json(visible.map(r => ({ ...r, _submission: subMap[r.id] || null })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/doc-requirements/analytics — real compliance metrics for admin (branch-filtered)
router.get('/analytics', auth, withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;

    // Resolve accessible employee IDs for branch isolation
    const accessibleIds = await resolveEmployeeIds(req.branchContext, oId);

    let empQuery = db.from('users').select('id').eq('organization_id', oId).eq('role', 'employee').eq('status', 'active');
    let subsQuery = db.from('employee_doc_submissions').select('id, status, uploaded_at, requirement_id, user_id, expiry_date').eq('organization_id', oId);

    if (accessibleIds !== null) {
      if (accessibleIds.length === 0) {
        return res.json({
          totalRequirements: 0, activeRequired: 0, totalEmployees: 0,
          compliancePercent: 0, expiringCount: 0, totalSubmissions: 0,
          approved: 0, hr_approved: 0, under_review: 0, rejected: 0, re_upload_requested: 0,
          requirementStats: [], weeklyTrend: [],
        });
      }
      empQuery  = empQuery.in('id', accessibleIds);
      subsQuery = subsQuery.in('user_id', accessibleIds);
    }

    const [{ data: requirements }, { data: subs }, { data: employees }] = await Promise.all([
      db.from('document_requirements').select('id, name, is_required, is_active').eq('organization_id', oId),
      subsQuery,
      empQuery,
    ]);

    const reqList  = requirements || [];
    const subsList = subs        || [];
    const empList  = employees   || [];

    const totalRequirements = reqList.length;
    const activeRequired    = reqList.filter(r => r.is_required && r.is_active).length;
    const totalEmployees    = empList.length;

    const statusCounts = { approved: 0, hr_approved: 0, under_review: 0, rejected: 0, re_upload_requested: 0 };
    subsList.forEach(s => { if (s.status in statusCounts) statusCounts[s.status]++; });

    const today = new Date().toISOString().split('T')[0];
    const soon  = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];
    const expiringCount = subsList.filter(s => s.status === 'approved' && s.expiry_date && s.expiry_date >= today && s.expiry_date <= soon).length;

    const maxPossible      = activeRequired * totalEmployees;
    const compliancePercent = maxPossible > 0 ? Math.round((statusCounts.approved / maxPossible) * 100) : 0;

    // Per-requirement breakdown
    const reqMap = {};
    reqList.forEach(r => { reqMap[r.id] = { ...r, total: 0, approved: 0, under_review: 0, rejected: 0 }; });
    subsList.forEach(s => {
      if (reqMap[s.requirement_id]) {
        reqMap[s.requirement_id].total++;
        if (['approved','under_review','rejected'].includes(s.status))
          reqMap[s.requirement_id][s.status]++;
      }
    });

    // Weekly upload trend (last 8 weeks)
    const weeklyTrend = [];
    for (let i = 7; i >= 0; i--) {
      const wStart = new Date(Date.now() - (i + 1) * 7 * 864e5);
      const wEnd   = new Date(Date.now() - i       * 7 * 864e5);
      const count  = subsList.filter(s => { const d = new Date(s.uploaded_at); return d >= wStart && d < wEnd; }).length;
      weeklyTrend.push({ week: wStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), count });
    }

    res.json({
      totalRequirements, activeRequired, totalEmployees,
      compliancePercent, expiringCount,
      totalSubmissions: subsList.length,
      ...statusCounts,
      requirementStats: Object.values(reqMap),
      weeklyTrend,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/doc-requirements/my-activity — employee recent activity
router.get('/my-activity', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data, error } = await db
      .from('doc_submission_activity')
      .select('*, requirement:document_requirements!doc_submission_activity_requirement_id_fkey(name)')
      .eq('user_id', req.user.id)
      .eq('organization_id', oId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/doc-requirements/verification-queue — HR all submissions (branch-filtered)
router.get('/verification-queue', auth, withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;
    const { status } = req.query; // optional filter: under_review | approved | rejected | re_upload_requested

    // Branch isolation: only show submissions from accessible-branch employees
    const accessibleIds = await resolveEmployeeIds(req.branchContext, oId);
    if (accessibleIds !== null && accessibleIds.length === 0) return res.json([]);

    let query = db
      .from('employee_doc_submissions')
      .select('*, employee:users(id, name, email, avatar_color, department, position), requirement:document_requirements!employee_doc_submissions_requirement_id_fkey(id, name, description, category), reviewer:users!employee_doc_submissions_reviewed_by_fkey(name)')
      .eq('organization_id', oId)
      .order('uploaded_at', { ascending: false });

    if (accessibleIds !== null) {
      query = query.in('user_id', accessibleIds);
    }

    if (status && ['under_review', 'hr_approved', 'approved', 'rejected', 're_upload_requested'].includes(status)) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/doc-requirements — create requirement (admin only)
router.post('/', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;
    const {
      name, description, category, is_required, applicable_to,
      accepted_formats, max_file_size_mb, expiry_required,
      expiry_reminder_days, verification_required, allow_reupload, display_order,
      assigned_branch_ids,
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'Document name is required' });

    // Validate assigned_branch_ids if provided
    let validatedBranchIds = null;
    if (Array.isArray(assigned_branch_ids) && assigned_branch_ids.length > 0) {
      const check = await validateBranchIds(assigned_branch_ids, oId, req.user.id, req.user.role);
      if (!check.valid) return res.status(400).json({ error: check.error });
      validatedBranchIds = assigned_branch_ids.map(Number);
    }

    const { data, error } = await db.from('document_requirements').insert({
      organization_id:       oId,
      name:                  name.trim(),
      description:           description?.trim() || null,
      category:              category || 'other',
      is_required:           is_required !== false,
      applicable_to:         applicable_to || 'everyone',
      accepted_formats:      accepted_formats || ['pdf', 'jpg', 'png'],
      max_file_size_mb:      max_file_size_mb || 10,
      expiry_required:       expiry_required || false,
      expiry_reminder_days:  expiry_reminder_days || 30,
      verification_required: verification_required !== false,
      allow_reupload:        allow_reupload !== false,
      display_order:         display_order || 0,
      is_active:             true,
      created_by:            req.user.id,
      assigned_branch_ids:   validatedBranchIds,
    }).select().single();

    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/doc-requirements/submissions/:id/review — HR review action
router.patch('/submissions/:id/review', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;
    const { action, reason } = req.body;

    if (!['approved', 'hr_approved', 'rejected', 're_upload_requested'].includes(action))
      return res.status(400).json({ error: 'Invalid action' });
    if ((action === 'rejected' || action === 're_upload_requested') && !reason?.trim())
      return res.status(400).json({ error: 'Reason is required for rejection or re-upload request' });
    // Only root_admin can set final 'approved'; HR admin can set 'hr_approved'
    if (action === 'approved' && req.user.role !== 'root_admin')
      return res.status(403).json({ error: 'Only Root Admin can give final document approval. Use "HR Approve" to forward for Root Admin review.' });

    const { data: sub } = await db
      .from('employee_doc_submissions')
      .select('*, requirement:document_requirements!employee_doc_submissions_requirement_id_fkey(name)')
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .single();
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    const updates = {
      status:      action,
      reviewed_by: req.user.id,
      reviewed_at: new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    };
    updates.rejection_reason = (action === 'approved' || action === 'hr_approved') ? null : (reason?.trim() || null);

    const { data, error } = await db.from('employee_doc_submissions')
      .update(updates)
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .select().single();
    if (error) throw error;

    // Log activity
    const activityDetails = {
      approved:            `"${sub.requirement?.name}" approved`,
      hr_approved:         `"${sub.requirement?.name}" HR-approved, pending Root Admin final approval`,
      rejected:            `"${sub.requirement?.name}" rejected: ${reason || ''}`,
      re_upload_requested: `"${sub.requirement?.name}" re-upload requested: ${reason || ''}`,
    }[action] || `"${sub.requirement?.name}" ${action}`;

    await db.from('doc_submission_activity').insert({
      requirement_id:  sub.requirement_id,
      user_id:         sub.user_id,
      organization_id: oId,
      action,
      details:         activityDetails,
      actor_id:        req.user.id,
    });

    // Notify employee (hr_approved notifies employee that it is under further review)
    const notifTitle = {
      approved:            'Document Approved',
      hr_approved:         'Document Under Final Review',
      rejected:            'Document Rejected',
      re_upload_requested: 'Re-upload Requested',
    }[action];
    const notifMsg = {
      approved:            `Your "${sub.requirement?.name}" has been approved.`,
      hr_approved:         `Your "${sub.requirement?.name}" has been reviewed by HR and is pending final approval by Root Admin.`,
      rejected:            `Your "${sub.requirement?.name}" was rejected. Reason: ${reason}`,
      re_upload_requested: `Please re-upload "${sub.requirement?.name}". Reason: ${reason}`,
    }[action];

    await db.from('notifications').insert({
      user_id: sub.user_id, title: notifTitle, message: notifMsg,
      type: 'document', organization_id: oId,
    });

    // If HR approved, also notify root_admins to give final approval
    if (action === 'hr_approved') {
      const { data: rootAdmins } = await db.from('users')
        .select('id')
        .eq('organization_id', oId)
        .eq('role', 'root_admin');
      if (rootAdmins?.length) {
        await db.from('notifications').insert(
          rootAdmins.map(a => ({
            user_id:         a.id,
            title:           'Document Awaiting Final Approval',
            message:         `${req.user.name} (HR) has reviewed and pre-approved "${sub.requirement?.name}". Please give final approval in the Verification Queue.`,
            type:            'document',
            organization_id: oId,
          }))
        );
      }
    }

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/doc-requirements/:id/assign — assign to specific employees and/or branches (admin only)
// employee_ids = null/[] → clears employee targeting (org-wide).
// branch_ids   = null/[] → clears branch targeting (org-wide).
// Both can be set independently.
router.post('/:id/assign', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;
    const { employee_ids, branch_ids } = req.body;

    const assignedEmployeeIds = (Array.isArray(employee_ids) && employee_ids.length > 0)
      ? employee_ids.map(Number)
      : null;

    // Validate and resolve branch IDs
    let assignedBranchIds = null;
    if (Array.isArray(branch_ids) && branch_ids.length > 0) {
      const check = await validateBranchIds(branch_ids, oId, req.user.id, req.user.role);
      if (!check.valid) return res.status(400).json({ error: check.error });
      assignedBranchIds = branch_ids.map(Number);
    }

    const updates = {
      updated_at: new Date().toISOString(),
    };
    // Only update fields explicitly sent in the request
    if ('employee_ids' in req.body) updates.assigned_employee_ids = assignedEmployeeIds;
    if ('branch_ids'   in req.body) updates.assigned_branch_ids   = assignedBranchIds;

    const { data, error } = await db.from('document_requirements')
      .update(updates)
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .select().single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Requirement not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/doc-requirements/:id — update requirement (admin only)
router.patch('/:id', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;
    const {
      name, description, category, is_required, applicable_to,
      accepted_formats, max_file_size_mb, expiry_required,
      expiry_reminder_days, verification_required, allow_reupload,
      display_order, is_active, assigned_branch_ids,
    } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined)                 updates.name = name;
    if (description !== undefined)          updates.description = description || null;
    if (category !== undefined)             updates.category = category;
    if (is_required !== undefined)          updates.is_required = is_required;
    if (applicable_to !== undefined)        updates.applicable_to = applicable_to;
    if (accepted_formats !== undefined)     updates.accepted_formats = accepted_formats;
    if (max_file_size_mb !== undefined)     updates.max_file_size_mb = max_file_size_mb;
    if (expiry_required !== undefined)      updates.expiry_required = expiry_required;
    if (expiry_reminder_days !== undefined) updates.expiry_reminder_days = expiry_reminder_days;
    if (verification_required !== undefined) updates.verification_required = verification_required;
    if (allow_reupload !== undefined)       updates.allow_reupload = allow_reupload;
    if (display_order !== undefined)        updates.display_order = display_order;
    if (is_active !== undefined)            updates.is_active = is_active;

    // Validate and apply assigned_branch_ids when explicitly sent
    if (assigned_branch_ids !== undefined) {
      if (Array.isArray(assigned_branch_ids) && assigned_branch_ids.length > 0) {
        const check = await validateBranchIds(assigned_branch_ids, oId, req.user.id, req.user.role);
        if (!check.valid) return res.status(400).json({ error: check.error });
        updates.assigned_branch_ids = assigned_branch_ids.map(Number);
      } else {
        updates.assigned_branch_ids = null; // explicitly clear
      }
    }

    const { data, error } = await db.from('document_requirements')
      .update(updates)
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/doc-requirements/:id — delete requirement (admin only)
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const { error } = await db.from('document_requirements')
      .delete()
      .eq('id', req.params.id)
      .eq('organization_id', req.user.organization_id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/doc-requirements/:id/submit — employee submits/re-submits a document
router.post('/:id/submit', auth, upload.single('file'), async (req, res) => {
  try {
    const oId  = req.user.organization_id;
    const reqId = Number(req.params.id);

    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!ALLOWED_MIMES.includes(req.file.mimetype))
      return res.status(400).json({ error: 'Invalid file type. Only PDF, Images, and Word documents are allowed.' });

    const { data: requirement } = await db.from('document_requirements')
      .select('*').eq('id', reqId).eq('organization_id', oId).single();
    if (!requirement)          return res.status(404).json({ error: 'Requirement not found' });
    if (!requirement.is_active) return res.status(400).json({ error: 'This document requirement is no longer active' });

    // Server-side per-requirement file size enforcement (before Cloudinary upload)
    const maxBytes = (requirement.max_file_size_mb || 10) * 1024 * 1024;
    if (req.file.size > maxBytes) {
      return res.status(400).json({
        error: `File size (${(req.file.size / 1048576).toFixed(1)} MB) exceeds the ${requirement.max_file_size_mb || 10} MB limit for "${requirement.name}".`
      });
    }
    if (req.file.size === 0) {
      return res.status(400).json({ error: 'Empty files are not allowed.' });
    }

    const { data: existing } = await db.from('employee_doc_submissions')
      .select('*').eq('requirement_id', reqId).eq('user_id', req.user.id).maybeSingle();

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `hrms/${oId}/doc-submissions`, resource_type: 'auto' },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });

    // Delete old Cloudinary file if re-uploading
    if (existing?.cloudinary_public_id) {
      try { await cloudinary.uploader.destroy(existing.cloudinary_public_id); } catch {}
    }

    const { expiry_date } = req.body;
    let submission;

    if (existing) {
      const { data, error } = await db.from('employee_doc_submissions')
        .update({
          file_url:            result.secure_url,
          file_type:           req.file.mimetype,
          file_size:           req.file.size,
          file_name:           req.file.originalname,
          cloudinary_public_id: result.public_id,
          status:              'under_review',
          rejection_reason:    null,
          expiry_date:         expiry_date || null,
          reviewed_by:         null,
          reviewed_at:         null,
          uploaded_at:         new Date().toISOString(),
          updated_at:          new Date().toISOString(),
          version:             (existing.version || 1) + 1,
        })
        .eq('id', existing.id)
        .select().single();
      if (error) throw error;
      submission = data;

      await db.from('doc_submission_activity').insert({
        requirement_id: reqId, user_id: req.user.id, organization_id: oId,
        action: 're_uploaded', details: `Re-uploaded "${requirement.name}"`, actor_id: req.user.id,
      });
    } else {
      const { data, error } = await db.from('employee_doc_submissions').insert({
        requirement_id:      reqId,
        user_id:             req.user.id,
        organization_id:     oId,
        file_url:            result.secure_url,
        file_type:           req.file.mimetype,
        file_size:           req.file.size,
        file_name:           req.file.originalname,
        cloudinary_public_id: result.public_id,
        status:              'under_review',
        expiry_date:         expiry_date || null,
        version:             1,
      }).select().single();
      if (error) throw error;
      submission = data;

      await db.from('doc_submission_activity').insert({
        requirement_id: reqId, user_id: req.user.id, organization_id: oId,
        action: 'uploaded', details: `Uploaded "${requirement.name}"`, actor_id: req.user.id,
      });
    }

    // Notify HR admins
    db.from('users').select('id')
      .eq('organization_id', oId).in('role', ['admin', 'root_admin'])
      .then(({ data: admins }) => {
        if (!admins?.length) return;
        return db.from('notifications').insert(admins.map(a => ({
          user_id: a.id,
          title:   'Document Uploaded for Review',
          message: `${req.user.name} uploaded "${requirement.name}". Review in Verification Queue.`,
          type:    'document', organization_id: oId,
        })));
      }).catch(() => {});

    res.json(submission);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/doc-requirements/for-employee/:userId
// Admin: fetch active requirements applicable to a specific employee + that employee's submission status
router.get('/for-employee/:userId', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId   = req.user.organization_id;
    const empId = parseInt(req.params.userId);
    if (isNaN(empId)) return res.status(400).json({ error: 'Invalid employee ID' });

    const { data: emp } = await db.from('users')
      .select('id, organization_id, branch_id')
      .eq('id', empId).eq('organization_id', oId).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    const { data: requirements, error } = await db
      .from('document_requirements')
      .select('*')
      .eq('organization_id', oId)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('created_at',    { ascending: true });
    if (error) throw error;

    // Apply both branch and employee applicability using the employee's actual branch_id.
    // The admin's currently selected branch (X-Branch-Id) is not used here —
    // only the employee's real users.branch_id determines which requirements apply.
    const applicable = (requirements || []).filter(r =>
      requirementAppliesTo(r, empId, emp.branch_id)
    );
    if (!applicable.length) return res.json([]);

    const reqIds = applicable.map(r => r.id);
    const { data: subs } = await db
      .from('employee_doc_submissions')
      .select('*, reviewer:users!employee_doc_submissions_reviewed_by_fkey(name)')
      .eq('user_id', empId)
      .eq('organization_id', oId)
      .in('requirement_id', reqIds);

    const subMap = {};
    (subs || []).forEach(s => { subMap[s.requirement_id] = s; });

    res.json(applicable.map(r => ({ ...r, _submission: subMap[r.id] || null })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/doc-requirements/:id/submit-for/:userId
// Admin uploads a document on behalf of a specific employee
router.post('/:id/submit-for/:userId', auth, upload.single('file'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId   = req.user.organization_id;
    const reqId = Number(req.params.id);
    const empId = Number(req.params.userId);
    if (isNaN(reqId) || isNaN(empId)) return res.status(400).json({ error: 'Invalid ID' });

    const { data: emp } = await db.from('users')
      .select('id, name, organization_id, branch_id')
      .eq('id', empId).eq('organization_id', oId).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    if (!ALLOWED_MIMES.includes(req.file.mimetype))
      return res.status(400).json({ error: 'Invalid file type. Only PDF, images, and Word documents are allowed.' });

    const { data: requirement } = await db.from('document_requirements')
      .select('*').eq('id', reqId).eq('organization_id', oId).single();

    // Step 4: requirement belongs to same organization (enforced by .eq above)
    if (!requirement)           return res.status(404).json({ error: 'Requirement not found' });
    if (!requirement.is_active) return res.status(400).json({ error: 'This document requirement is no longer active' });

    // Step 5: requirement must be applicable to this specific employee.
    // Uses both branch targeting (assigned_branch_ids) and employee targeting (assigned_employee_ids).
    // Employee's actual users.branch_id is authoritative — not the admin's selected X-Branch-Id.
    if (!requirementAppliesTo(requirement, empId, emp.branch_id))
      return res.status(403).json({ error: 'This document requirement does not apply to the selected employee' });

    const maxBytes = (requirement.max_file_size_mb || 10) * 1024 * 1024;
    if (req.file.size > maxBytes)
      return res.status(400).json({ error: `File size exceeds the ${requirement.max_file_size_mb || 10} MB limit for "${requirement.name}".` });
    if (req.file.size === 0)
      return res.status(400).json({ error: 'Empty files are not allowed.' });

    const { data: existing } = await db.from('employee_doc_submissions')
      .select('*').eq('requirement_id', reqId).eq('user_id', empId).maybeSingle();

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `hrms/${oId}/doc-submissions`, resource_type: 'auto' },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });

    if (existing?.cloudinary_public_id) {
      try { await cloudinary.uploader.destroy(existing.cloudinary_public_id); } catch {}
    }

    const { expiry_date } = req.body;
    let submission;

    // Admin uploads are auto-approved — no verification queue needed
    const now = new Date().toISOString();
    const adminPayload = {
      file_url:             result.secure_url,
      file_type:            req.file.mimetype,
      file_size:            req.file.size,
      file_name:            req.file.originalname,
      cloudinary_public_id: result.public_id,
      status:               'approved',
      rejection_reason:     null,
      expiry_date:          expiry_date || null,
      reviewed_by:          req.user.id,
      reviewed_at:          now,
      uploaded_at:          now,
      updated_at:           now,
    };

    if (existing) {
      const { data, error } = await db.from('employee_doc_submissions')
        .update({ ...adminPayload, version: (existing.version || 1) + 1 })
        .eq('id', existing.id)
        .select().single();
      if (error) throw error;
      submission = data;
    } else {
      const { data, error } = await db.from('employee_doc_submissions').insert({
        requirement_id:   reqId,
        user_id:          empId,
        organization_id:  oId,
        ...adminPayload,
        version:          1,
      }).select().single();
      if (error) throw error;
      submission = data;
    }

    // Log activity (fire-and-forget, must not throw)
    try {
      await db.from('doc_submission_activity').insert({
        requirement_id:  reqId,
        user_id:         empId,
        organization_id: oId,
        action:          'approved',
        details:         `"${requirement.name}" uploaded and approved by admin ${req.user.name} on behalf of ${emp.name}`,
        actor_id:        req.user.id,
      });
    } catch (_) {}

    // Notify employee that document was uploaded and approved by admin
    try {
      await db.from('notifications').insert({
        user_id:         empId,
        title:           'Document Uploaded & Approved',
        message:         `Your "${requirement.name}" has been uploaded and approved by ${req.user.name}.`,
        type:            'document',
        organization_id: oId,
      });
    } catch (_) {}

    res.json(submission);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
