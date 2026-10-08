const express = require('express');
const router  = express.Router();
const { V, validateBody } = require('../../utils/fieldValidators');
const { db }              = require('../../config/db');
const { auth, adminOnly, isAdminRole, selfOrAdmin } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

const SELF_EDITABLE = ['contact_name','relationship','mobile_number','alternate_number','email','address','is_primary'];

// GET /api/profile/:id/emergency-contacts
router.get('/:id/emergency-contacts', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_emergency_contacts')
      .select('*').eq('employee_id', empId).eq('organization_id', orgId(req))
      .order('is_primary', { ascending: false }).order('created_at');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/emergency-contacts
const EMERGENCY_RULES = {
  contact_name: V.text('Contact name', { min: 2, max: 100 }), relationship: V.text('Relationship', { min: 2, max: 50 }),
  mobile_number: V.phone('Mobile number'), alternate_number: V.phone('Alternate number'), email: V.email('Email'),
};

router.post('/:id/emergency-contacts', auth, selfOrAdmin(SELF_EDITABLE), validateBody(EMERGENCY_RULES), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const { contact_name, relationship, mobile_number, alternate_number, email, address, is_primary } = req.body;
    if (!contact_name || !mobile_number) return res.status(400).json({ error: 'contact_name and mobile_number are required' });

    // If marking as primary, unset existing primary first
    if (is_primary) {
      await db.from('employee_emergency_contacts')
        .update({ is_primary: false }).eq('employee_id', empId).eq('organization_id', orgId(req));
    }

    const { data, error } = await db.from('employee_emergency_contacts').insert({
      employee_id: empId, organization_id: orgId(req),
      contact_name, relationship, mobile_number,
      alternate_number: alternate_number || null,
      email: email || null, address: address || null,
      is_primary: is_primary || false,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/emergency-contacts/:recordId
router.put('/:id/emergency-contacts/:recordId', auth, selfOrAdmin(SELF_EDITABLE), validateBody(EMERGENCY_RULES), async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    const { contact_name, relationship, mobile_number, alternate_number, email, address, is_primary } = req.body;

    if (is_primary) {
      await db.from('employee_emergency_contacts')
        .update({ is_primary: false }).eq('employee_id', empId).eq('organization_id', orgId(req));
    }

    const { data, error } = await db.from('employee_emergency_contacts').update({
      contact_name, relationship, mobile_number,
      alternate_number: alternate_number || null,
      email: email || null, address: address || null,
      is_primary: is_primary || false,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', recordId).eq('employee_id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/emergency-contacts/:recordId
router.delete('/:id/emergency-contacts/:recordId', auth, adminOnly, async (req, res) => {
  try {
    const { error } = await db.from('employee_emergency_contacts')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('employee_id', parseInt(req.params.id)).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
