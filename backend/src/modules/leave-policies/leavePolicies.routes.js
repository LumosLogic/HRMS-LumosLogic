const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');

const DEFAULT_POLICIES = [
  { leave_type: 'annual',    label: 'Annual Leave',    annual_quota: 18, carry_forward: true,  max_carry_forward: 5,  paid: true },
  { leave_type: 'sick',      label: 'Sick Leave',      annual_quota: 12, carry_forward: false, max_carry_forward: 0,  paid: true },
  { leave_type: 'casual',    label: 'Casual Leave',    annual_quota:  8, carry_forward: false, max_carry_forward: 0,  paid: true },
  { leave_type: 'emergency', label: 'Emergency Leave', annual_quota:  3, carry_forward: false, max_carry_forward: 0,  paid: true },
  { leave_type: 'maternity', label: 'Maternity Leave', annual_quota: 180,carry_forward: false, max_carry_forward: 0,  paid: true },
  { leave_type: 'paternity', label: 'Paternity Leave', annual_quota: 15, carry_forward: false, max_carry_forward: 0,  paid: true },
  { leave_type: 'comp_off',  label: 'Comp Off',        annual_quota:  0, carry_forward: false, max_carry_forward: 0,  paid: true },
];

// GET /api/leave-policies
// Returns branch-specific policies when a branch is selected,
// falling back to org-wide policies (branch_id IS NULL) if none exist for that branch.
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const branchState = getFilterState(req.branchContext);
    let query = db.from('leave_policies').select('*').eq('organization_id', oId).order('leave_type');

    if (branchState.type === 'specific') {
      // Try branch-specific first
      const branchId = branchState.branchId;
      const { data: branchPolicies, error: branchErr } = await db.from('leave_policies')
        .select('*').eq('organization_id', oId).eq('branch_id', branchId).order('leave_type');
      if (!branchErr && branchPolicies && branchPolicies.length > 0) {
        return res.json(branchPolicies);
      }
      // Fall back to org-wide (branch_id IS NULL)
      query = query.is('branch_id', null);
    } else {
      // All/multi/none: show org-wide policies
      query = query.is('branch_id', null);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) {
      return res.json(DEFAULT_POLICIES.map(p => ({ ...p, id: null, organization_id: oId, active: true })));
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/leave-policies — atomic replace-all using a PostgreSQL transaction (admin only).
// HIGH-19: DELETE then INSERT must be atomic — if INSERT fails, no policies should be lost.
// Branch-aware: when a branch is selected, only replaces policies for that branch.
router.post('/', auth, hasPermission('settings', 'manage'), withBranchContext, async (req, res) => {
  const oId = req.user.organization_id;
  const { policies } = req.body;
  if (!Array.isArray(policies) || policies.length === 0)
    return res.status(400).json({ error: 'policies array required and must not be empty' });

  const branchState = getFilterState(req.branchContext);
  const branchId = branchState.type === 'specific' ? branchState.branchId : null;

  // Guard: detect duplicate leave_type values in the incoming payload before touching the DB.
  const typesSeen = new Set();
  for (const p of policies) {
    if (!p.leave_type) return res.status(400).json({ error: 'Each policy must have a leave_type.' });
    if (typesSeen.has(p.leave_type)) {
      return res.status(400).json({ error: `Duplicate leave type "${p.leave_type}" in the submitted policies. Each leave type must be unique.` });
    }
    typesSeen.add(p.leave_type);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // BUG_238: snapshot previous policies for the same scope for audit
    const { rows: beforeRows } = await client.query(
      branchId
        ? `SELECT * FROM leave_policies WHERE organization_id = $1 AND branch_id = $2`
        : `SELECT * FROM leave_policies WHERE organization_id = $1 AND branch_id IS NULL`,
      branchId ? [oId, branchId] : [oId]
    );
    const beforeByType = {};
    beforeRows.forEach(r => { beforeByType[r.leave_type] = r; });

    // Delete only the scoped policies (branch-specific or org-wide)
    await client.query(
      branchId
        ? `DELETE FROM leave_policies WHERE organization_id = $1 AND branch_id = $2`
        : `DELETE FROM leave_policies WHERE organization_id = $1 AND branch_id IS NULL`,
      branchId ? [oId, branchId] : [oId]
    );

    const inserted = [];
    const auditRows = [];
    for (const p of policies) {
      const {
        leave_type, label, annual_quota, carry_forward, max_carry_forward, paid, active,
        half_day_allowed, requires_approval, require_document, min_notice_days,
        max_consecutive_days, description,
      } = p;
      const result = await client.query(
        `INSERT INTO leave_policies
           (organization_id, branch_id, leave_type, label, annual_quota, carry_forward, max_carry_forward,
            paid, active, half_day_allowed, requires_approval, require_document, min_notice_days,
            max_consecutive_days, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [oId, branchId, leave_type, label || leave_type, Number(annual_quota) || 0,
         !!carry_forward, Number(max_carry_forward) || 0, paid !== false, active !== false,
         half_day_allowed !== false, requires_approval !== false, !!require_document,
         Number(min_notice_days) || 0, Number(max_consecutive_days) || 0,
         description || '']
      );
      inserted.push(result.rows[0]);

      // BUG_238: diff against the previous row (if any)
      const prev = beforeByType[leave_type];
      const next = result.rows[0];
      const AUDITABLE = ['annual_quota', 'carry_forward', 'max_carry_forward', 'paid', 'active', 'label'];
      for (const k of AUDITABLE) {
        const oldV = prev ? prev[k] : null;
        if (prev && String(oldV) === String(next[k])) continue;
        if (!prev && k !== 'annual_quota') continue; // seed-insert noise
        auditRows.push({
          organization_id: oId,
          leave_type,
          field_changed:   k,
          old_value:       oldV === null || oldV === undefined ? null : String(oldV),
          new_value:       next[k] === null || next[k] === undefined ? null : String(next[k]),
          changed_by:      req.user.id,
          changed_by_name: req.user.name || '',
        });
      }
    }

    if (auditRows.length) {
      for (const a of auditRows) {
        await client.query(
          `INSERT INTO leave_policy_audit_log
             (organization_id, leave_type, field_changed, old_value, new_value, changed_by, changed_by_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [a.organization_id, a.leave_type, a.field_changed, a.old_value, a.new_value, a.changed_by, a.changed_by_name]
        );
      }
    }

    await client.query('COMMIT');
    res.json(inserted);
  } catch (err) {
    await client.query('ROLLBACK');
    const isUniqueViolation = err.code === '23505' || /unique constraint/i.test(err.message);
    res.status(isUniqueViolation ? 400 : 500).json({
      error: isUniqueViolation
        ? 'Two leave policies have the same type. Please rename one of the cloned policies before saving.'
        : err.message
    });
  } finally {
    client.release();
  }
});

// PUT /api/leave-policies/:id (admin only)
router.put('/:id', auth, hasPermission('settings', 'manage'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const fields = req.body;
    delete fields.id; delete fields.organization_id; delete fields.created_at;

    // BUG_238: capture the previous row so we can record per-field changes
    const { data: before } = await db.from('leave_policies')
      .select('*').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!before) return res.status(404).json({ error: 'Leave policy not found' });

    const { data, error } = await db.from('leave_policies')
      .update(fields).eq('id', req.params.id).eq('organization_id', oId)
      .select().single();
    if (error) throw error;

    // BUG_238: write one audit row per changed field so History shows what
    // changed, the old/new values, who changed it and when.
    const AUDITABLE = ['annual_quota', 'carry_forward', 'max_carry_forward', 'paid', 'active', 'label'];
    const changes = Object.keys(fields)
      .filter(k => AUDITABLE.includes(k) && String(fields[k]) !== String(before[k]));
    if (changes.length) {
      await db.from('leave_policy_audit_log').insert(changes.map(k => ({
        organization_id: oId,
        leave_type:      before.leave_type,
        field_changed:   k,
        old_value:       before[k] === null || before[k] === undefined ? null : String(before[k]),
        new_value:       fields[k] === null || fields[k] === undefined ? null : String(fields[k]),
        changed_by:      req.user.id,
        changed_by_name: req.user.name || '',
      })));
    }

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EHN_LP_001: Leave Policy Audit Log ──────────────────────────────────────
router.get('/:type/history', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data, error } = await db.from('leave_policy_audit_log')
      .select('*').eq('organization_id', oId).eq('leave_type', req.params.type)
      .order('created_at', { ascending: false }).limit(50);
    if (error) {
      if (error.message.includes('does not exist')) return res.json([]);
      throw error;
    }
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
