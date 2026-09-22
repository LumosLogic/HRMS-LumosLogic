const express = require('express');
const router  = express.Router();
const { db }              = require('../../config/db');
const { auth, isAdminRole }     = require('../../middleware/auth');
const { orgId, localDateStr }   = require('../../utils/helpers');

// GET /api/profile/:id/overview
// Lightweight sticky header — loads once, never reloads on tab switch
router.get('/:id/overview', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const oId   = orgId(req);
    const isSelf = parseInt(req.user.id) === empId;

    if (!isAdminRole(req.user.role) && !isSelf)
      return res.status(403).json({ error: 'Access denied' });

    // Core user row
    const { data: emp, error } = await db.from('users')
      .select(`
        id, name, email, phone, role, employee_id, device_enrollment_id,
        salutation, middle_name, surname,
        department, position, grade, branch_id, employee_status, joining_date,
        employment_type, avatar_color, profile_photo_url, organization_id, created_at,
        reporting_to, cost_centre, pay_cadre,
        current_city, current_state, current_country,
        location, work_hours_per_day, weekly_off_day, hod_id
      `)
      .eq('id', empId).eq('organization_id', oId).maybeSingle();

    if (error) throw error;
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    // Manager name (single lookup, not a join chain)
    let manager = null;
    if (emp.reporting_to) {
      const { data: mgr } = await db.from('users')
        .select('id, name, avatar_color, position')
        .eq('id', emp.reporting_to).maybeSingle();
      manager = mgr;
    }

    // HOD name
    let hod = null;
    if (emp.hod_id) {
      const { data: hodRow } = await db.from('users')
        .select('id, name, position')
        .eq('id', emp.hod_id).maybeSingle();
      hod = hodRow;
    }

    // Branch name
    let branch = null;
    if (emp.branch_id) {
      const { data: br } = await db.from('branches')
        .select('id, name').eq('id', emp.branch_id).maybeSingle();
      branch = br;
    }

    // Today's attendance (for status indicator)
    const today = localDateStr();
    const { data: todayAtt } = await db.from('attendance')
      .select('status, check_in, check_out')
      .eq('user_id', empId).eq('date', today).eq('organization_id', oId).maybeSingle();

    // Profile completion — count of non-empty profile sections
    const [
      { count: famCount },
      { count: eduCount },
      { count: expCount },
      { count: skillCount },
      { count: bankCount },
      { count: docCount },
    ] = await Promise.all([
      db.from('employee_family_members').select('id', { count: 'exact', head: true }).eq('employee_id', empId).eq('organization_id', oId),
      db.from('employee_qualifications').select('id', { count: 'exact', head: true }).eq('user_id', empId).eq('organization_id', oId),
      db.from('employee_experiences').select('id', { count: 'exact', head: true }).eq('user_id', empId).eq('organization_id', oId),
      db.from('employee_skills').select('id', { count: 'exact', head: true }).eq('employee_id', empId).eq('organization_id', oId),
      db.from('employee_bank_accounts').select('id', { count: 'exact', head: true }).eq('employee_id', empId).eq('organization_id', oId),
      db.from('employee_documents').select('id', { count: 'exact', head: true }).eq('user_id', empId).eq('organization_id', oId),
    ]);

    // Completion score: 8 sections, each worth ~12.5%
    const sectionsCompleted = [
      emp.phone && emp.date_of_birth,          // personal
      emp.email,                               // contact
      emp.department && emp.position,          // professional
      famCount > 0,                            // family
      eduCount > 0,                            // education
      expCount > 0,                            // experience
      skillCount > 0,                          // skills
      bankCount > 0,                           // banking
    ].filter(Boolean).length;
    const profileCompletion = Math.round((sectionsCompleted / 8) * 100);

    res.json({
      ...emp,
      manager,
      hod,
      branch,
      todayAttendance: todayAtt || null,
      profileCompletion,
      sectionCounts: {
        family: famCount || 0,
        education: eduCount || 0,
        experience: expCount || 0,
        skills: skillCount || 0,
        banking: bankCount || 0,
        documents: docCount || 0,
      },
    });
  } catch (err) {
    console.error('[profile/overview]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
