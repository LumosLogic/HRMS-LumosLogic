const express = require('express');
const router  = express.Router();
const { db }              = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

// GET /api/profile/:id/skills
router.get('/:id/skills', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId && !req.teamViewer)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_skills')
      .select('*').eq('employee_id', empId).eq('organization_id', orgId(req))
      .order('skill_category').order('skill_name');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/skills
router.post('/:id/skills', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { skill_name, skill_category, proficiency_level, years_of_experience, can_read, can_write, can_speak } = req.body;
    if (!skill_name) return res.status(400).json({ error: 'skill_name is required' });

    // BUG_047: Case-insensitive duplicate skill check
    const { data: existing } = await db.from('employee_skills')
      .select('id').eq('employee_id', empId).eq('organization_id', orgId(req))
      .ilike('skill_name', skill_name.trim()).maybeSingle();
    if (existing) return res.status(409).json({ error: `Skill "${skill_name}" already exists. Skill names are case-insensitive.` });

    const { data, error } = await db.from('employee_skills').insert({
      employee_id: empId, organization_id: orgId(req),
      skill_name, skill_category: skill_category || 'technical',
      proficiency_level: proficiency_level || 'intermediate',
      years_of_experience: years_of_experience || null,
      can_read, can_write, can_speak,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Skill already exists for this employee' });
      throw error;
    }
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/skills/:recordId
router.put('/:id/skills/:recordId', auth, async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { skill_name, skill_category, proficiency_level, years_of_experience, can_read, can_write, can_speak } = req.body;

    const { data, error } = await db.from('employee_skills').update({
      skill_name,
      skill_category:      skill_category      || 'technical',
      proficiency_level:   proficiency_level   || 'intermediate',
      years_of_experience: years_of_experience || null,
      can_read, can_write, can_speak,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', recordId).eq('employee_id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/skills/:recordId
router.delete('/:id/skills/:recordId', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { error } = await db.from('employee_skills')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('employee_id', empId).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
