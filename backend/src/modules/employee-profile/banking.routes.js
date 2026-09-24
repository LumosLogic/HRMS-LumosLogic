const express = require('express');
const router  = express.Router();
const { db }                      = require('../../config/db');
const { auth, adminOnly, isAdminRole, selfOrAdmin } = require('../../middleware/auth');
const { orgId }                         = require('../../utils/helpers');
const { withBranchContext }             = require('../../middleware/branchContext');
const { canAdminAccessUser }            = require('../../utils/branchFilter');

const SELF_EDITABLE = [
  'bank_name','branch_name','branch_code','account_number','account_holder_name',
  'account_type','ifsc_code','payment_method','is_primary','is_salary_account',
];

// GET /api/profile/:id/banking
router.get('/:id/banking', auth, withBranchContext, async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    if (!isAdminRole(req.user.role)) {
      // Employee self-access: only own record
      if (parseInt(req.user.id) !== empId)
        return res.status(403).json({ error: 'Access denied' });
    } else if (parseInt(req.user.id) !== empId) {
      // Admin accessing another employee's banking — verify same org and branch access.
      const { data: emp } = await db.from('users')
        .select('id').eq('id', empId).eq('organization_id', orgId(req)).maybeSingle();
      if (!emp) return res.status(404).json({ error: 'Employee not found' });
      if (!await canAdminAccessUser(req.branchContext, empId, orgId(req)))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    const { data, error } = await db.from('employee_bank_accounts')
      .select('*').eq('employee_id', empId).eq('organization_id', orgId(req)).eq('is_active', true)
      .order('is_primary', { ascending: false }).order('created_at');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profile/:id/banking
router.post('/:id/banking', auth, selfOrAdmin(SELF_EDITABLE), async (req, res) => {
  try {
    const empId = parseInt(req.params.id);
    const {
      bank_name, branch_name, branch_code, account_number, account_holder_name,
      account_type, ifsc_code, swift_code, payment_method, is_primary, is_salary_account,
    } = req.body;
    if (!bank_name || !account_number) return res.status(400).json({ error: 'bank_name and account_number are required' });

    // BUG_045: Duplicate account number check for same employee
    const { data: dupAcc } = await db.from('employee_bank_accounts')
      .select('id').eq('employee_id', empId).eq('organization_id', orgId(req))
      .eq('account_number', account_number).eq('is_active', true).maybeSingle();
    if (dupAcc) return res.status(409).json({ error: 'This account number is already added for this employee.' });

    // Unset primary if this one is primary
    if (is_primary) {
      await db.from('employee_bank_accounts')
        .update({ is_primary: false }).eq('employee_id', empId).eq('organization_id', orgId(req));
    }

    // Admin-added accounts are auto-verified; employee-added require HR review
    const isAdmin = isAdminRole(req.user.role);

    const { data, error } = await db.from('employee_bank_accounts').insert({
      employee_id: empId, organization_id: orgId(req),
      bank_name, branch_name, branch_code, account_number,
      account_holder_name: account_holder_name || null,
      account_type: account_type || 'savings',
      ifsc_code: ifsc_code || null, swift_code: swift_code || null,
      payment_method: payment_method || 'bank_transfer',
      is_primary: is_primary || false,
      is_salary_account: is_salary_account !== false,
      is_active: true,
      hr_verified: isAdmin,
      hr_verified_by: isAdmin ? req.user.id : null,
      hr_verified_at: isAdmin ? new Date().toISOString() : null,
      created_by: req.user.id, updated_at: new Date().toISOString(),
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/banking/:recordId
router.put('/:id/banking/:recordId', auth, selfOrAdmin(SELF_EDITABLE), async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);
    const {
      bank_name, branch_name, branch_code, account_number, account_holder_name,
      account_type, ifsc_code, swift_code, payment_method, is_primary, is_salary_account,
    } = req.body;

    if (is_primary) {
      await db.from('employee_bank_accounts')
        .update({ is_primary: false }).eq('employee_id', empId).eq('organization_id', orgId(req));
    }

    const { data, error } = await db.from('employee_bank_accounts').update({
      bank_name:            bank_name             || null,
      branch_name:          branch_name           || null,
      branch_code:          branch_code           || null,
      account_number:       account_number        || null,
      account_holder_name:  account_holder_name   || null,
      account_type:         account_type          || 'savings',
      ifsc_code:            ifsc_code             || null,
      swift_code:           swift_code            || null,
      payment_method:       payment_method        || 'bank_transfer',
      is_primary,
      is_salary_account,
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', recordId).eq('employee_id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profile/:id/banking/:recordId/verify  — HR only: mark account as verified
router.put('/:id/banking/:recordId/verify', auth, adminOnly, async (req, res) => {
  try {
    const empId    = parseInt(req.params.id);
    const recordId = parseInt(req.params.recordId);

    const { data, error } = await db.from('employee_bank_accounts').update({
      hr_verified: true,
      hr_verified_by: req.user.id,
      hr_verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), updated_by: req.user.id,
    }).eq('id', recordId).eq('employee_id', empId).eq('organization_id', orgId(req)).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profile/:id/banking/:recordId  — soft delete (admin only)
router.delete('/:id/banking/:recordId', auth, adminOnly, async (req, res) => {
  try {
    const { error } = await db.from('employee_bank_accounts')
      .update({ is_active: false, updated_at: new Date().toISOString(), updated_by: req.user.id })
      .eq('id', parseInt(req.params.recordId))
      .eq('employee_id', parseInt(req.params.id)).eq('organization_id', orgId(req));
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
