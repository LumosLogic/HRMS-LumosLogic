const express = require('express');
const router  = express.Router();
const { V, validateBody } = require('../../utils/fieldValidators');
const { db }              = require('../../config/db');
const { auth, adminOnly, isAdminRole } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

// GET /api/profile/:id/immigration
router.get('/:id/immigration', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_immigration')
      .select('*').eq('employee_id', empId).eq('organization_id', orgId(req))
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/immigration
const IMM_RULES = { citizenship: V.text('Citizenship', { max: 60 }), country: V.text('Country', { max: 60 }) };

router.post('/:id/immigration', auth, adminOnly, validateBody(IMM_RULES), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const {
      citizenship, immigration_type, immigration_no, passport_number,
      visa_type, issue_date, expiry_date, country, file_url, remarks,
    } = req.body;

    const { data, error } = await db.from('employee_immigration').insert({
      employee_id: empId, organization_id: orgId(req),
      citizenship, immigration_type, immigration_no: immigration_no || null,
      passport_number: passport_number || null, visa_type: visa_type || null,
      issue_date: issue_date || null, expiry_date: expiry_date || null,
      country: country || null, file_url: file_url || null,
      remarks: remarks || null,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/immigration/:recordId
router.put('/:id/immigration/:recordId', auth, adminOnly, validateBody(IMM_RULES), async (req, res) => {
  try {
    const {
      citizenship, immigration_type, immigration_no, passport_number,
      visa_type, issue_date, expiry_date, country, file_url, remarks,
    } = req.body;

    const { data, error } = await db.from('employee_immigration').update({
      citizenship, immigration_type, immigration_no: immigration_no || null,
      passport_number: passport_number || null, visa_type: visa_type || null,
      issue_date: issue_date || null, expiry_date: expiry_date || null,
      country: country || null, file_url: file_url || null,
      remarks: remarks || null,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', parseInt(req.params.recordId))
      .eq('employee_id', parseInt(req.params.id))
      .eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/immigration/:recordId
router.delete('/:id/immigration/:recordId', auth, adminOnly, async (req, res) => {
  try {
    const { error } = await db.from('employee_immigration')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('employee_id', parseInt(req.params.id)).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
