'use strict';
/**
 * payrollAdjustmentService.js — Phase 3.6
 * CRUD for payroll_adjustments + attendance overrides.
 * All operations are org-scoped. Soft delete preserves audit trail.
 */

const { pool } = require('../config/db');

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

// ─── Fire-and-forget audit ────────────────────────────────────────────────────
function logAudit({ oId, actorId, actorName, action, entityType, entityId, targetUserId, oldValues, newValues, ip }) {
  pool.query(
    `INSERT INTO payroll_audit_log
       (organization_id, actor_id, actor_name, action, entity_type, entity_id,
        target_user_id, old_values, new_values, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [oId, actorId || null, actorName || null, action, entityType,
     entityId || null, targetUserId || null,
     oldValues  ? JSON.stringify(oldValues)  : null,
     newValues  ? JSON.stringify(newValues)  : null,
     ip || null]
  ).catch(() => {});
}

// ─── Guard: payroll run must not be locked or paid ────────────────────────────
async function assertRunEditable(oId, runId) {
  const { rows } = await pool.query(
    `SELECT id, status FROM payroll_runs WHERE id = $1 AND organization_id = $2`,
    [runId, oId]
  );
  if (!rows.length) throw Object.assign(new Error('Payroll run not found'), { status: 404 });
  const { status } = rows[0];
  if (['locked', 'paid'].includes(status)) {
    throw Object.assign(
      new Error(`Cannot modify adjustments on a ${status} payroll run`),
      { status: 409, code: 'RUN_LOCKED' }
    );
  }
  return rows[0];
}

// ─── Recalculate adjustment_total on payslip ──────────────────────────────────
// Called after any create / update / delete to keep the aggregate current.
async function syncAdjustmentTotal(payslipId, oId, client) {
  const db = client || pool;
  await db.query(
    `UPDATE payslips
        SET adjustment_total = COALESCE((
            SELECT SUM(
                CASE WHEN addition_or_deduction = 'addition' THEN amount
                     ELSE -amount
                END
            )
              FROM payroll_adjustments
             WHERE payslip_id      = $1
               AND organization_id = $2
               AND deleted_at IS NULL
        ), 0)
      WHERE id = $1 AND organization_id = $2`,
    [payslipId, oId]
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADJUSTMENTS
// ═══════════════════════════════════════════════════════════════════════════════

async function createAdjustment({
  organizationId, payrollRunId, payslipId, userId,
  adjustmentType, adjustmentCategory,
  amount, additionOrDeduction,
  effectiveMonth, effectiveYear,
  remarks, createdBy, ip,
}) {
  const oId = Number(organizationId);

  if (payrollRunId) await assertRunEditable(oId, payrollRunId);

  const { rows } = await pool.query(
    `INSERT INTO payroll_adjustments
       (organization_id, payroll_run_id, payslip_id, user_id,
        adjustment_type, adjustment_category,
        amount, addition_or_deduction,
        effective_month, effective_year,
        remarks, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      oId, payrollRunId || null, payslipId || null, Number(userId),
      adjustmentType || 'one_time', adjustmentCategory,
      round2(amount), additionOrDeduction || 'addition',
      Number(effectiveMonth), Number(effectiveYear),
      remarks || null, Number(createdBy),
    ]
  );
  const adj = rows[0];

  if (payslipId) await syncAdjustmentTotal(payslipId, oId);

  // Update payroll run's total_adjustments aggregate
  if (payrollRunId) await refreshRunAdjTotal(oId, payrollRunId);

  logAudit({
    oId, actorId: createdBy, action: 'adjustment_added',
    entityType: 'adjustment', entityId: adj.id,
    targetUserId: userId, newValues: adj, ip,
  });

  return adj;
}

async function updateAdjustment({ organizationId, adjustmentId, payload, updatedBy, ip }) {
  const oId = Number(organizationId);

  const old = await pool.query(
    `SELECT * FROM payroll_adjustments WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [adjustmentId, oId]
  );
  if (!old.rows.length) throw Object.assign(new Error('Adjustment not found'), { status: 404 });
  const existing = old.rows[0];

  if (existing.payroll_run_id) await assertRunEditable(oId, existing.payroll_run_id);

  const allowed = ['adjustment_type','adjustment_category','amount','addition_or_deduction','effective_month','effective_year','remarks'];
  const sets    = [];
  const vals    = [];
  for (const k of allowed) {
    if (payload[k] !== undefined) {
      sets.push(`${k} = $${vals.length + 1}`);
      vals.push(k === 'amount' ? round2(payload[k]) : payload[k]);
    }
  }
  if (!sets.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });

  sets.push(`updated_at = NOW()`);
  vals.push(adjustmentId, oId);

  const { rows } = await pool.query(
    `UPDATE payroll_adjustments SET ${sets.join(', ')}
      WHERE id = $${vals.length - 1} AND organization_id = $${vals.length} AND deleted_at IS NULL
     RETURNING *`,
    vals
  );
  const updated = rows[0];

  if (existing.payslip_id) await syncAdjustmentTotal(existing.payslip_id, oId);
  if (existing.payroll_run_id) await refreshRunAdjTotal(oId, existing.payroll_run_id);

  logAudit({
    oId, actorId: updatedBy, action: 'adjustment_updated',
    entityType: 'adjustment', entityId: adjustmentId,
    targetUserId: existing.user_id, oldValues: existing, newValues: updated, ip,
  });

  return updated;
}

async function deleteAdjustment({ organizationId, adjustmentId, deletedBy, ip }) {
  const oId = Number(organizationId);

  const { rows: found } = await pool.query(
    `SELECT * FROM payroll_adjustments WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [adjustmentId, oId]
  );
  if (!found.length) throw Object.assign(new Error('Adjustment not found'), { status: 404 });
  const existing = found[0];

  if (existing.payroll_run_id) await assertRunEditable(oId, existing.payroll_run_id);

  await pool.query(
    `UPDATE payroll_adjustments
        SET deleted_at = NOW(), deleted_by = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3`,
    [Number(deletedBy), adjustmentId, oId]
  );

  if (existing.payslip_id) await syncAdjustmentTotal(existing.payslip_id, oId);
  if (existing.payroll_run_id) await refreshRunAdjTotal(oId, existing.payroll_run_id);

  logAudit({
    oId, actorId: deletedBy, action: 'adjustment_deleted',
    entityType: 'adjustment', entityId: adjustmentId,
    targetUserId: existing.user_id, oldValues: existing, ip,
  });
}

async function listAdjustments({ organizationId, payrollRunId, userId, userIds, month, year }) {
  const oId    = Number(organizationId);
  const conds  = ['pa.organization_id = $1', 'pa.deleted_at IS NULL'];
  const params = [oId];

  if (payrollRunId) { conds.push(`pa.payroll_run_id = $${params.length + 1}`); params.push(payrollRunId); }
  if (userId)       { conds.push(`pa.user_id = $${params.length + 1}`);        params.push(userId); }
  // Branch-scope filter: restrict to a specific set of employee IDs (from resolveEmployeeIds)
  if (userIds && userIds.length > 0) { conds.push(`pa.user_id = ANY($${params.length + 1}::int[])`); params.push(userIds); }
  if (month)        { conds.push(`pa.effective_month = $${params.length + 1}`); params.push(month); }
  if (year)         { conds.push(`pa.effective_year  = $${params.length + 1}`); params.push(year); }

  const { rows } = await pool.query(
    `SELECT pa.*,
            u.name    AS employee_name,
            u.employee_id,
            u.department,
            cb.name   AS created_by_name
       FROM payroll_adjustments pa
       JOIN users u   ON u.id  = pa.user_id
       LEFT JOIN users cb ON cb.id = pa.created_by
      WHERE ${conds.join(' AND ')}
      ORDER BY pa.created_at DESC`,
    params
  );
  return rows;
}

// ─── Helper: refresh payroll_runs.total_adjustments ──────────────────────────
async function refreshRunAdjTotal(oId, runId) {
  await pool.query(
    `UPDATE payroll_runs
        SET total_adjustments = COALESCE((
            SELECT SUM(CASE WHEN addition_or_deduction = 'addition' THEN amount ELSE -amount END)
              FROM payroll_adjustments
             WHERE payroll_run_id = $1 AND organization_id = $2 AND deleted_at IS NULL
        ), 0)
      WHERE id = $1 AND organization_id = $2`,
    [runId, oId]
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════════

async function createOverride({
  organizationId, payrollRunId, userId,
  originalValues, overrideValues,
  reason, createdBy, ip,
}) {
  const oId = Number(organizationId);
  await assertRunEditable(oId, payrollRunId);

  const { rows } = await pool.query(
    `INSERT INTO payroll_attendance_overrides
       (organization_id, payroll_run_id, user_id,
        original_present_days, original_absent_days, original_paid_days,
        original_half_days, original_lop_days, original_late_count,
        override_present_days, override_absent_days, override_paid_days,
        override_half_days, override_lop_days, override_late_count,
        reason, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
        original_present_days = EXCLUDED.original_present_days,
        original_absent_days  = EXCLUDED.original_absent_days,
        original_paid_days    = EXCLUDED.original_paid_days,
        original_half_days    = EXCLUDED.original_half_days,
        original_lop_days     = EXCLUDED.original_lop_days,
        original_late_count   = EXCLUDED.original_late_count,
        override_present_days = EXCLUDED.override_present_days,
        override_absent_days  = EXCLUDED.override_absent_days,
        override_paid_days    = EXCLUDED.override_paid_days,
        override_half_days    = EXCLUDED.override_half_days,
        override_lop_days     = EXCLUDED.override_lop_days,
        override_late_count   = EXCLUDED.override_late_count,
        reason     = EXCLUDED.reason,
        updated_at = NOW()
     RETURNING *`,
    [
      oId, Number(payrollRunId), Number(userId),
      originalValues.presentDays ?? null, originalValues.absentDays ?? null,
      originalValues.paidDays   ?? null,  originalValues.halfDays   ?? null,
      originalValues.lopDays    ?? null,  originalValues.lateCount  ?? null,
      overrideValues.presentDays ?? null, overrideValues.absentDays ?? null,
      overrideValues.paidDays   ?? null,  overrideValues.halfDays   ?? null,
      overrideValues.lopDays    ?? null,  overrideValues.lateCount  ?? null,
      reason, Number(createdBy),
    ]
  );
  const ov = rows[0];

  // Mark the payslip as having an override
  await pool.query(
    `UPDATE payslips SET has_override = TRUE
      WHERE payroll_run_id = $1 AND user_id = $2 AND organization_id = $3`,
    [payrollRunId, userId, oId]
  );

  logAudit({
    oId, actorId: createdBy, action: 'override_added',
    entityType: 'override', entityId: ov.id,
    targetUserId: userId, newValues: ov, ip,
  });

  return ov;
}

async function deleteOverride({ organizationId, overrideId, deletedBy, ip }) {
  const oId = Number(organizationId);

  const { rows: found } = await pool.query(
    `SELECT * FROM payroll_attendance_overrides WHERE id = $1 AND organization_id = $2`,
    [overrideId, oId]
  );
  if (!found.length) throw Object.assign(new Error('Override not found'), { status: 404 });
  const ov = found[0];

  await assertRunEditable(oId, ov.payroll_run_id);

  await pool.query(
    `DELETE FROM payroll_attendance_overrides WHERE id = $1 AND organization_id = $2`,
    [overrideId, oId]
  );

  await pool.query(
    `UPDATE payslips SET has_override = FALSE
      WHERE payroll_run_id = $1 AND user_id = $2 AND organization_id = $3`,
    [ov.payroll_run_id, ov.user_id, oId]
  );

  logAudit({
    oId, actorId: deletedBy, action: 'override_deleted',
    entityType: 'override', entityId: overrideId,
    targetUserId: ov.user_id, oldValues: ov, ip,
  });
}

async function listOverrides({ organizationId, payrollRunId, userId }) {
  const oId    = Number(organizationId);
  const conds  = ['pao.organization_id = $1'];
  const params = [oId];

  if (payrollRunId) { conds.push(`pao.payroll_run_id = $${params.length + 1}`); params.push(payrollRunId); }
  if (userId)       { conds.push(`pao.user_id = $${params.length + 1}`);        params.push(userId); }

  const { rows } = await pool.query(
    `SELECT pao.*,
            u.name    AS employee_name,
            u.employee_id,
            cb.name   AS created_by_name
       FROM payroll_attendance_overrides pao
       JOIN users u   ON u.id  = pao.user_id
       LEFT JOIN users cb ON cb.id = pao.created_by
      WHERE ${conds.join(' AND ')}
      ORDER BY pao.created_at DESC`,
    params
  );
  return rows;
}

// ─── Fetch override for a single employee (used by generation service) ────────
async function getOverrideForEmployee(organizationId, payrollRunId, userId) {
  const { rows } = await pool.query(
    `SELECT * FROM payroll_attendance_overrides
      WHERE organization_id = $1 AND payroll_run_id = $2 AND user_id = $3`,
    [Number(organizationId), Number(payrollRunId), Number(userId)]
  );
  return rows[0] || null;
}

module.exports = {
  createAdjustment,
  updateAdjustment,
  deleteAdjustment,
  listAdjustments,
  createOverride,
  deleteOverride,
  listOverrides,
  getOverrideForEmployee,
  syncAdjustmentTotal,
  refreshRunAdjTotal,
};
