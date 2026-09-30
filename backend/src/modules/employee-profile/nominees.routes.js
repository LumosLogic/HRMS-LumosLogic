const express = require('express');
const router  = express.Router();
const { db }              = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

// GET /api/profile/:id/nominees
router.get('/:id/nominees', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_nominees')
      .select('*').eq('employee_id', empId).eq('organization_id', orgId(req))
      .order('is_primary', { ascending: false }).order('created_at');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/nominees
router.post('/:id/nominees', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { nominee_name, relationship, date_of_birth, percentage_share, address, contact_number, is_primary } = req.body;
    if (!nominee_name || !relationship) return res.status(400).json({ error: 'nominee_name and relationship are required' });

    // Validate total percentage won't exceed 100
    if (percentage_share) {
      const { data: existing } = await db.from('employee_nominees')
        .select('percentage_share').eq('employee_id', empId).eq('organization_id', orgId(req));
      const total = (existing || []).reduce((s, r) => s + (parseFloat(r.percentage_share) || 0), 0);
      const newTotal = Math.round((total + parseFloat(percentage_share)) * 100) / 100;
      if (newTotal > 100)
        return res.status(400).json({ error: `Total nominee share would exceed 100% (current: ${Math.round(total * 100) / 100}%, adding: ${parseFloat(percentage_share)}% — total would be ${newTotal}%)` });
    }

    const { data, error } = await db.from('employee_nominees').insert({
      employee_id: empId, organization_id: orgId(req),
      nominee_name, relationship, date_of_birth: date_of_birth || null,
      percentage_share: percentage_share || null,
      address, contact_number, is_primary: is_primary || false,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/nominees/:recordId
router.put('/:id/nominees/:recordId', auth, async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { nominee_name, relationship, date_of_birth, percentage_share, address, contact_number, is_primary } = req.body;

    const { data, error } = await db.from('employee_nominees').update({
      nominee_name:     nominee_name     || null,
      relationship:     relationship     || null,
      date_of_birth:    date_of_birth    || null,
      percentage_share: percentage_share || null,
      address:          address          || null,
      contact_number:   contact_number   || null,
      is_primary,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', recordId).eq('employee_id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/nominees/:recordId
router.delete('/:id/nominees/:recordId', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });
    const { error } = await db.from('employee_nominees')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('employee_id', empId).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
