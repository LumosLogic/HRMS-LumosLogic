const express = require('express');
const router  = express.Router();
const { V, validateBody } = require('../../utils/fieldValidators');
const { db }              = require('../../config/db');
const { auth, adminOnly, isAdminRole } = require('../../middleware/auth');
const { orgId }                 = require('../../utils/helpers');

// ── Training ──────────────────────────────────────────────────

// GET /api/profile/:id/training
router.get('/:id/training', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_training')
      .select('*').eq('employee_id', empId).eq('organization_id', orgId(req))
      .order('start_date', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/training
// Start date vs status: a Planned training may start in the future; In Progress / Completed may not (EMP-031).
const TRAIN_RULES = {
  start_date: (v, body) => {
    const d = String(v).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(new Date(d + 'T00:00:00Z'))) return 'Start date must be a valid date (YYYY-MM-DD).';
    const status = body.completion_status || 'in_progress';
    return (status === 'in_progress' || status === 'completed') && d > new Date().toISOString().slice(0, 10)
      ? `Start date cannot be in the future for a training that is ${status === 'completed' ? 'completed' : 'in progress'}.` : null;
  },
};

router.post('/:id/training', auth, adminOnly, validateBody(TRAIN_RULES), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const {
      training_name, training_type, training_provider, start_date, end_date,
      duration_hours, completion_status, score, certificate_url, remarks,
    } = req.body;
    if (!training_name) return res.status(400).json({ error: 'training_name is required' });

    const { data, error } = await db.from('employee_training').insert({
      employee_id: empId, organization_id: orgId(req),
      training_name, training_type: training_type || 'other',
      training_provider: training_provider || null,
      start_date: start_date || null, end_date: end_date || null,
      duration_hours: duration_hours || null,
      completion_status: completion_status || 'in_progress',
      score: score || null, certificate_url: certificate_url || null,
      remarks: remarks || null,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/training/:recordId
router.put('/:id/training/:recordId', auth, adminOnly, validateBody(TRAIN_RULES), async (req, res) => {
  try {
    const {
      training_name, training_type, training_provider, start_date, end_date,
      duration_hours, completion_status, score, certificate_url, remarks,
    } = req.body;

    const { data, error } = await db.from('employee_training').update({
      training_name:     training_name     || null,
      training_type:     training_type     || 'other',
      training_provider: training_provider || null,
      start_date:        start_date        || null,
      end_date:          end_date          || null,
      duration_hours:    duration_hours    || null,
      completion_status: completion_status || 'in_progress',
      score: score || null,
      certificate_url: certificate_url || null, remarks: remarks || null,
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

// DELETE /api/profile/:id/training/:recordId
router.delete('/:id/training/:recordId', auth, adminOnly, async (req, res) => {
  try {
    const { error } = await db.from('employee_training')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('employee_id', parseInt(req.params.id)).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Certifications ────────────────────────────────────────────

// GET /api/profile/:id/certifications
router.get('/:id/certifications', auth, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role) && parseInt(req.user.id) !== empId)
      return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await db.from('employee_certifications')
      .select('*').eq('employee_id', empId).eq('organization_id', orgId(req))
      .order('issue_date', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/certifications
router.post('/:id/certifications', auth, adminOnly, validateBody({ issue_date: V.pastDate('Issue date') }), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const { certification_name, issuing_authority, issue_date, expiry_date, certification_number, file_url, is_lifetime } = req.body;
    if (!certification_name) return res.status(400).json({ error: 'certification_name is required' });

    const { data, error } = await db.from('employee_certifications').insert({
      employee_id: empId, organization_id: orgId(req),
      certification_name, issuing_authority: issuing_authority || null,
      issue_date: issue_date || null,
      expiry_date: is_lifetime ? null : (expiry_date || null),
      certification_number: certification_number || null,
      file_url: file_url || null, is_lifetime: is_lifetime || false,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/certifications/:recordId
router.put('/:id/certifications/:recordId', auth, adminOnly, validateBody({ issue_date: V.pastDate('Issue date') }), async (req, res) => {
  try {
    const { certification_name, issuing_authority, issue_date, expiry_date, certification_number, file_url, is_lifetime } = req.body;

    const { data, error } = await db.from('employee_certifications').update({
      certification_name, issuing_authority: issuing_authority || null,
      issue_date: issue_date || null,
      expiry_date: is_lifetime ? null : (expiry_date || null),
      certification_number: certification_number || null,
      file_url: file_url || null, is_lifetime: is_lifetime || false,
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

// DELETE /api/profile/:id/certifications/:recordId
router.delete('/:id/certifications/:recordId', auth, adminOnly, async (req, res) => {
  try {
    const { error } = await db.from('employee_certifications')
      .delete().eq('id', parseInt(req.params.recordId))
      .eq('employee_id', parseInt(req.params.id)).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
