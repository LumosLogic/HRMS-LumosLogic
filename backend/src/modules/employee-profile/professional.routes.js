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
router.put('/:id/professional', auth, adminOnly, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const {
      employee_id, department, position, grade, pay_cadre, cost_centre,
      division, sub_division, location, employment_type, work_mode,
      employee_status, joining_date, confirmation_date,
      probation_applicable, probation_months,
      salary_on, salary_structure, ctc, salary_effective_date,
      weekly_off_day, work_hours_per_day,
      branch_id, department_id, designation_id, reporting_to, hod_id,
      device_enrollment_id, department_ids,
    } = req.body;

    const update = {
      employee_id:     employee_id     || null,
      department:      department      || null,
      position:        position        || null,
      grade:           grade           || null,
      pay_cadre:       pay_cadre       || null,
      cost_centre:     cost_centre     || null,
      division:        division        || null,
      sub_division:    sub_division    || null,
      location:        location        || null,
      employment_type: employment_type || null,
      work_mode:       work_mode       || null,
      employee_status: employee_status || null,
      joining_date:    joining_date    || null,
      confirmation_date: confirmation_date || null,
      probation_applicable, probation_months: probation_months || null,
      // When probation is turned off, clear stale dates so payroll
      // immediately treats the employee as active (mirrors employees.routes.js:299-301)
      ...(probation_applicable === false && { probation_start_date: null, probation_end_date: null }),
      salary_on: salary_on || null, salary_structure: salary_structure || null,
      ctc: ctc || null,
      salary_effective_date: salary_effective_date || null,
      weekly_off_day: weekly_off_day || null,
      work_hours_per_day: work_hours_per_day || null,
      branch_id: branch_id || null,
      department_id: department_id || null,
      designation_id: designation_id || null,
      reporting_to: reporting_to || null,
      hod_id: hod_id || null,
      device_enrollment_id: device_enrollment_id || null,
      updated_at: new Date().toISOString(),
      updated_by: req.user.id,
    };

    const { data, error } = await db.from('users')
      .update(update).eq('id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;

    // Sync multi-department assignments if provided
    if (Array.isArray(department_ids)) {
      await db.from('user_departments').delete().eq('user_id', empId);
      if (department_ids.length > 0) {
        await db.from('user_departments').insert(
          department_ids.map(did => ({ user_id: empId, department_id: did, organization_id: orgId(req) }))
        );
      }
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
