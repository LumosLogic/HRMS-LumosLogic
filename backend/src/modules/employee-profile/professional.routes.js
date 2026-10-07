const express = require('express');
const router  = express.Router();
const { db, pool }        = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { hasPermission }   = require('../../middleware/permissions');
const { validateBranchIdList, clearBranchAccessCache } = require('../../services/branchService');
const lifecycle           = require('../../services/employeeLifecycle');
const { orgId }                 = require('../../utils/helpers');

// GET /api/profile/:id/professional
router.get('/:id/professional', auth, async (req, res) => {
  try {
    const empId  = parseInt(req.params.id);
    const isSelf = parseInt(req.user.id) === empId;
    if (!isAdminRole(req.user.role) && !isSelf && !req.teamViewer)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('users').select(`
      id, employee_id, department, position, grade, pay_cadre, cost_centre,
      division, sub_division, location, employment_type, work_mode,
      employee_status, joining_date, confirmation_date,
      probation_applicable, probation_months,
      salary_on, salary_structure, ctc, salary_effective_date,
      weekly_off_day, work_hours_per_day,
      branch_id, department_id, designation_id, reporting_to, hod_id,
      device_enrollment_id
    `).eq('id', empId).eq('organization_id', orgId(req)).maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Employee not found' });

    // Resolve readable names for FK fields
    const [managerRes, hodRes, branchRes, deptRes] = await Promise.all([
      data.reporting_to
        ? db.from('users').select('id, name, position').eq('id', data.reporting_to).maybeSingle()
        : Promise.resolve({ data: null }),
      data.hod_id
        ? db.from('users').select('id, name, position').eq('id', data.hod_id).maybeSingle()
        : Promise.resolve({ data: null }),
      data.branch_id
        ? db.from('branches').select('id, name').eq('id', data.branch_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from('user_departments')
        .select('departments(id, name)')
        .eq('user_id', empId),
    ]);

    // A manager / HOD (req.teamViewer) never receives compensation fields.
    if (req.teamViewer) for (const k of ['salary_on', 'salary_structure', 'ctc', 'salary_effective_date']) delete data[k];

    res.json({
      ...data,
      manager: managerRes.data,
      hod: hodRes.data,
      branch: branchRes.data,
      departments: (deptRes.data || []).map(r => r.departments).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/professional  — admin only
// Only fields present in the request body are updated; absent fields are left
// untouched.  This prevents partial section saves (e.g. Org Structure only)
// from nulling out fields managed by the sibling section (Employment Details).
//
// Employee status / probation / department / branch go through the SAME shared helpers as the Employees form
// (services/employeeLifecycle.js), so the two screens can no longer leave the data in different states.
router.put('/:id/professional', auth, hasPermission('employees', 'edit'), async (req, res) => {
  try {
    // hasPermission() is the RBAC gate; the role check keeps the historical rule that employees never edit this section.
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
    const empId = parseInt(req.params.id);
    const oId   = orgId(req);
    const body  = req.body;

    const { rows: curRows } = await pool.query(
      `SELECT employee_status, branch_id, role, reporting_to, joining_date, date_of_joining, probation_months
         FROM users WHERE id = $1 AND organization_id = $2`, [empId, oId]);
    if (!curRows.length) return res.status(404).json({ error: 'Employee not found' });
    const cur = curRows[0];

    const NULLABLE_FIELDS = [
      'employee_id', 'department', 'position', 'grade', 'pay_cadre', 'cost_centre',
      'division', 'sub_division', 'location', 'employment_type', 'work_mode',
      'employee_status', 'joining_date', 'confirmation_date', 'probation_months',
      'salary_on', 'salary_structure', 'ctc', 'salary_effective_date',
      'weekly_off_day', 'work_hours_per_day',
      'branch_id', 'department_id', 'designation_id', 'reporting_to', 'hod_id',
      'device_enrollment_id',
    ];

    // A destination branch must belong to the org and be inside the caller's access (the Employees form already
    // enforced this; this path only guarded the *target employee*).
    if (Object.hasOwn(body, 'branch_id') && body.branch_id && String(body.branch_id) !== String(cur.branch_id)) {
      const v = await validateBranchIdList(req.user.id, oId, req.user.role, [body.branch_id]);
      if (!v.ok) return res.status(403).json({ error: v.error });
    }

    const update = { updated_at: new Date().toISOString(), updated_by: req.user.id };
    for (const key of NULLABLE_FIELDS) {
      if (Object.hasOwn(body, key)) update[key] = body[key] || null;
    }

    // salary fields here are only a cache of the active salary structure — see employees.routes.js
    if ((Object.hasOwn(update, 'ctc') || Object.hasOwn(update, 'salary_effective_date')) && await lifecycle.hasActiveSalaryStructure(empId, oId)) {
      delete update.ctc; delete update.salary_effective_date;
    }

    // department_id on its own (legacy callers) is the same thing as department_ids:[id] — keep ONE assignment model.
    let deptIds = Array.isArray(body.department_ids) ? body.department_ids : null;
    if (!deptIds && Object.hasOwn(body, 'department_id')) deptIds = body.department_id ? [body.department_id] : [];
    if (deptIds) { delete update.department_id; delete update.department; }

    if (Object.hasOwn(body, 'probation_applicable')) {
      update.probation_applicable = body.probation_applicable;
      if (body.probation_applicable === false) {
        // turned off: clear stale dates so payroll immediately treats the employee as active
        update.probation_start_date = null;
        update.probation_end_date   = null;
      } else if (body.probation_applicable === true) {
        // turned on: identical rule to the Employees form — force status and derive the dates from joining date + months.
        update.employee_status = 'probation';
        const joining = update.joining_date ?? cur.joining_date ?? cur.date_of_joining;
        const months  = update.probation_months ?? cur.probation_months;
        const pd = lifecycle.computeProbationDates(joining, months);
        if (pd) { update.probation_start_date = pd.start; update.probation_end_date = pd.end; }
      }
    }

    // legacy users.status always follows employee_status
    if (Object.hasOwn(update, 'employee_status')) update.status = lifecycle.legacyStatusFor(update.employee_status);

    const { data, error } = await db.from('users')
      .update(update).eq('id', empId).eq('organization_id', oId).select().single();
    if (error) throw error;

    // Multi-department assignment: junction + users.department + users.department_id together
    if (deptIds) {
      const dep = await lifecycle.syncUserDepartments({ orgId: oId, userId: empId, departmentIds: deptIds });
      data.department = dep.primaryName;
      data.department_id = dep.primaryId;
    }
    delete data.password;

    if (Object.hasOwn(body, 'device_enrollment_id')) await lifecycle.syncBiometricPin({ orgId: oId, userId: empId, pin: body.device_enrollment_id });
    if (Object.hasOwn(update, 'branch_id')) clearBranchAccessCache(empId, oId);

    // session block/unblock, exit record + checklist for resigned/terminated, close stale exit on reactivation
    if (Object.hasOwn(update, 'employee_status')) {
      await lifecycle.afterStatusChange({
        orgId: oId, userId: empId, prev: cur.employee_status || 'active',
        next: update.employee_status || 'active', actorId: req.user.id,
      });
    }

    // In-flight leave approvals follow a manager / department change (approver id is stored at submission).
    const managerChanged = Object.hasOwn(update, 'reporting_to') && String(update.reporting_to ?? '') !== String(cur.reporting_to ?? '');
    if (managerChanged || deptIds || Object.hasOwn(update, 'department_id') || Object.hasOwn(update, 'branch_id')) {
      // Manager / HOD team scope + the derived Manager permissions follow reporting-line, department and branch changes.
      require('../../services/teamScope').clearTeamScopeCache(oId);
      if (managerChanged) require('../../services/permissionService').clearOrgCache(oId);
    }
    if (managerChanged || deptIds) {
      try { await require('../../services/leaveWorkflowEngine').reresolvePendingApprovers(oId, [empId]); }
      catch (e) { console.error('[professional] reresolvePendingApprovers:', e.message); }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
