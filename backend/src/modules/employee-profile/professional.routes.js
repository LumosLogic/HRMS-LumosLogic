const express = require('express');
const router  = express.Router();
const { db }              = require('../../config/db');
const { auth, adminOnly, isAdminRole } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

// GET /api/profile/:id/professional
router.get('/:id/professional', auth, async (req, res) => {
  try {
    const empId  = parseInt(req.params.id);
    const isSelf = parseInt(req.user.id) === empId;
    if (!isAdminRole(req.user.role) && !isSelf)
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
router.put('/:id/professional', auth, adminOnly, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const body  = req.body;

    const NULLABLE_FIELDS = [
      'employee_id', 'department', 'position', 'grade', 'pay_cadre', 'cost_centre',
      'division', 'sub_division', 'location', 'employment_type', 'work_mode',
      'employee_status', 'joining_date', 'confirmation_date', 'probation_months',
      'salary_on', 'salary_structure', 'ctc', 'salary_effective_date',
      'weekly_off_day', 'work_hours_per_day',
      'branch_id', 'department_id', 'designation_id', 'reporting_to', 'hod_id',
      'device_enrollment_id',
    ];

    const update = { updated_at: new Date().toISOString(), updated_by: req.user.id };

    for (const key of NULLABLE_FIELDS) {
      if (Object.hasOwn(body, key)) {
        update[key] = body[key] || null;
      }
    }

    if (Object.hasOwn(body, 'probation_applicable')) {
      update.probation_applicable = body.probation_applicable;
      // When probation is turned off, clear stale dates so payroll
      // immediately treats the employee as active (mirrors employees.routes.js:299-301)
      if (body.probation_applicable === false) {
        update.probation_start_date = null;
        update.probation_end_date   = null;
      }
    }

    const { data, error } = await db.from('users')
      .update(update).eq('id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;

    // Sync multi-department assignments if provided
    if (Array.isArray(body.department_ids)) {
      await db.from('user_departments').delete().eq('user_id', empId);
      if (body.department_ids.length > 0) {
        await db.from('user_departments').insert(
          body.department_ids.map(did => ({ user_id: empId, department_id: did, organization_id: orgId(req) }))
        );
      }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
