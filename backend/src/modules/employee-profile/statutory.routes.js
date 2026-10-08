const express = require('express');
const router  = express.Router();
const { V, validateBody } = require('../../utils/fieldValidators');
const { db }          = require('../../config/db');
const { auth, adminOnly }   = require('../../middleware/auth');
const { orgId }             = require('../../utils/helpers');

// GET /api/profile/:id/statutory  — admin only (sensitive)
router.get('/:id/statutory', auth, adminOnly, async (req, res) => {
  try {
    const { data, error } = await db.from('users').select(`
      aadhar_no, pan_number, pan_name, uan_no, voter_id,
      pf_applicable, pf_no, vpf_applicable, vpf_percentage, max_pf_amount, pran, is_pf_on_gross,
      esi_applicable, esi_no, esi_dispensary, esi_office,
      pt_applicable, pt_rule, lwf_applicable,
      gratuity_applicable, gratuity_id, gl_code, bonus_applicable,
      ot_applicable, ot_rate, ot_paid_with_salary,
      salary_structure, salary_on, per_hour_rate, per_day_wages,
      salary_slip_format, max_weekoff_in_month, special_allowance
    `).eq('id', parseInt(req.params.id)).eq('organization_id', orgId(req)).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Employee not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/statutory  — admin only
router.put('/:id/statutory', auth, adminOnly, validateBody({
  aadhar_no: V.digits('Aadhaar number', 12), pan_number: V.pan('PAN number'), pan_name: V.text('Name on PAN'),
  uan_no: V.digits('UAN number', 12), esi_no: V.digits('ESI number', 17), pf_no: V.pfNumber('PF number'),
}), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const {
      aadhar_no, pan_number, pan_name, uan_no, voter_id,
      pf_applicable, pf_no, vpf_applicable, vpf_percentage, max_pf_amount, pran, is_pf_on_gross,
      esi_applicable, esi_no, esi_dispensary, esi_office,
      pt_applicable, pt_rule, lwf_applicable,
      gratuity_applicable, gratuity_id, gl_code, bonus_applicable,
      ot_applicable, ot_rate, ot_paid_with_salary,
      salary_structure, salary_on, per_hour_rate, per_day_wages,
      salary_slip_format, max_weekoff_in_month, special_allowance,
    } = req.body;

    const { data, error } = await db.from('users').update({
      aadhar_no: aadhar_no || null,
      pan_number: pan_number || null, pan_name: pan_name || null,
      uan_no: uan_no || null, voter_id: voter_id || null,
      pf_applicable, pf_no: pf_no || null,
      vpf_applicable, vpf_percentage: vpf_percentage || 0,
      max_pf_amount: max_pf_amount || 0,
      pran: pran || null, is_pf_on_gross,
      esi_applicable, esi_no: esi_no || null,
      esi_dispensary: esi_dispensary || null, esi_office: esi_office || null,
      pt_applicable, pt_rule: pt_rule || null, lwf_applicable,
      gratuity_applicable, gratuity_id: gratuity_id || null,
      gl_code: gl_code || null, bonus_applicable,
      ot_applicable, ot_rate: ot_rate || 0, ot_paid_with_salary,
      salary_structure: salary_structure || 'GROSS',
      salary_on: salary_on || 'Month',
      per_hour_rate: per_hour_rate || 0,
      per_day_wages: per_day_wages || 0,
      salary_slip_format: salary_slip_format || 'Format1',
      max_weekoff_in_month: max_weekoff_in_month || 8,
      special_allowance: special_allowance || 0,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', empId).eq('organization_id', orgId(req)).select().single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
