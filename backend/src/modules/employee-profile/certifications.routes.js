const express = require('express');
const router  = express.Router();
const { V, validateBody } = require('../../utils/fieldValidators');
const { db }                       = require('../../config/db');
const { auth, adminOnly, isAdminRole }   = require('../../middleware/auth');
const { orgId }                          = require('../../utils/helpers');

// GET /api/profile/:id/certifications
router.get('/:id/certifications', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db
      .from('employee_certifications')
      .select('*')
      .eq('employee_id', empId)
      .eq('organization_id', orgId(req))
      .order('issue_date', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/certifications
const CERT_RULES = { issue_date: V.pastDate('Issue date') };

router.post('/:id/certifications', auth, adminOnly, validateBody(CERT_RULES), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const {
      certification_name, issuing_authority, issue_date,
      expiry_date, certification_number, file_url, is_lifetime,
    } = req.body;
    if (!certification_name)
      return res.status(400).json({ error: 'certification_name is required' });

    const { data, error } = await db
      .from('employee_certifications')
      .insert({
        employee_id:          empId,
        organization_id:      orgId(req),
        certification_name,
        issuing_authority:    issuing_authority    || null,
        issue_date:           issue_date           || null,
        expiry_date:          expiry_date          || null,
        certification_number: certification_number || null,
        file_url:             file_url             || null,
        is_lifetime:          is_lifetime          || false,
        created_by:           req.user.id,
        updated_at:           new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/certifications/:recordId
router.put('/:id/certifications/:recordId', auth, adminOnly, validateBody(CERT_RULES), async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    const {
      certification_name, issuing_authority, issue_date,
      expiry_date, certification_number, file_url, is_lifetime,
    } = req.body;

    const { data, error } = await db
      .from('employee_certifications')
      .update({
        certification_name,
        issuing_authority:    issuing_authority    || null,
        issue_date:           issue_date           || null,
        expiry_date:          expiry_date          || null,
        certification_number: certification_number || null,
        file_url:             file_url             || null,
        is_lifetime:          is_lifetime          || false,
        updated_at:           new Date().toISOString(),
        updated_by:           req.user.id,
      })
      .eq('id', recordId)
      .eq('employee_id', empId)
      .eq('organization_id', orgId(req))
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/certifications/:recordId
router.delete('/:id/certifications/:recordId', auth, adminOnly, async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    const { error } = await db
      .from('employee_certifications')
      .delete()
      .eq('id', recordId)
      .eq('employee_id', empId)
      .eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
