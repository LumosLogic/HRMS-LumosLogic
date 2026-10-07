const express = require('express');
const router  = express.Router();
const { db }              = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

// GET /api/profile/:id/experience
router.get('/:id/experience', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId && !req.teamViewer)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_experiences')
      .select('*').eq('user_id', empId).eq('organization_id', orgId(req))
      .order('start_date', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/experience
router.post('/:id/experience', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const {
      company_name, designation, industry, department, employment_type,
      start_date, end_date, ctc, last_salary, total_years, manager_name, reason_leaving,
    } = req.body;
    if (!company_name) return res.status(400).json({ error: 'company_name is required' });
    // BUG_049: End date must be after start date
    if (start_date && end_date && new Date(end_date) <= new Date(start_date)) {
      return res.status(400).json({ error: 'End date must be after start date.' });
    }

    const { data, error } = await db.from('employee_experiences').insert({
      user_id: empId, organization_id: orgId(req),
      company_name,
      designation:     designation     || null,
      industry:        industry        || null,
      department:      department      || null,
      employment_type: employment_type || null,
      start_date: start_date || null, end_date: end_date || null,
      ctc: ctc || null, last_salary: last_salary || null,
      total_years: total_years || null, manager_name, reason_leaving,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/experience/:recordId
router.put('/:id/experience/:recordId', auth, async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const {
      company_name, designation, industry, department, employment_type,
      start_date, end_date, ctc, last_salary, total_years, manager_name, reason_leaving,
    } = req.body;
    // BUG_049: End date must be after start date
    if (start_date && end_date && new Date(end_date) <= new Date(start_date)) {
      return res.status(400).json({ error: 'End date must be after start date.' });
    }

    const { data, error } = await db.from('employee_experiences').update({
      company_name:    company_name    || null,
      designation:     designation     || null,
      industry:        industry        || null,
      department:      department      || null,
      employment_type: employment_type || null,
      start_date: start_date || null, end_date: end_date || null,
      ctc: ctc || null, last_salary: last_salary || null,
      total_years: total_years || null, manager_name, reason_leaving,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', recordId).eq('user_id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/experience/:recordId
router.delete('/:id/experience/:recordId', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { error } = await db.from('employee_experiences')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('user_id', empId).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
