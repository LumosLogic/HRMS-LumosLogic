'use strict';
/**
 * payrollGenerationService.js — Phase 3.3 (extended Phase 3.7)
 * Orchestrates payroll runs: creates payslip snapshots, manages locking,
 * handles partial failures. All writes are org-scoped. No cross-tenant access.
 *
 * Delegates ALL salary arithmetic to payrollEngine.calculatePayroll().
 * Phase 3.7: After upsert, applyStatutoryCalculations() overrides PF/ESI/PT/TDS/LWF
 *            with org-configured statutory values (backward-compatible; no-op if unconfigured).
 */

const { pool } = require('../config/db');
const { calculatePayroll } = require('./payrollEngine');
const { applyStatutoryCalculations } = require('./statutoryCalculationService');

// ─── Custom error ─────────────────────────────────────────────────────────────
class GenerationError extends Error {
  constructor(message, code, meta = {}) {
    super(message);
    this.name = 'GenerationError';
    this.code = code;
    this.meta = meta;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function padZ(n) { return String(n).padStart(2, '0'); }

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

// Fire-and-forget audit record. Never blocks the caller.
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

// ─── Eligible employees query ─────────────────────────────────────────────────
// Returns employees who are active and have a salary structure for the period.
//
// Optional `employeeIds` array: when provided, restricts the selection to those
// user IDs only (branch-scoped generation). Eligibility checks (role=employee,
// active status, salary structure) still apply on top of the ID filter —
// the payroll calculation logic is entirely unchanged.
async function fetchEligibleEmployees(oId, month, year, employeeIds = null) {
  const mStr  = padZ(month);
  const start = `${year}-${mStr}-01`;
  const end   = `${year}-${mStr}-${padZ(daysInMonth(year, month))}`;

  // Build optional branch-filter clause. Params are already $1-$3; branch filter
  // adds $4 only when employeeIds is provided.
  const branchClause = employeeIds ? `AND u.id = ANY($4::bigint[])` : '';
  const params = employeeIds
    ? [oId, end, start, employeeIds]
    : [oId, end, start];

  const { rows } = await pool.query(
    `SELECT DISTINCT u.id, u.name, u.department, u.employee_id
       FROM users u
       INNER JOIN employee_salary_structures ess
               ON ess.user_id        = u.id
              AND ess.organization_id = $1
              AND ess.effective_from <= $2
              AND (ess.effective_to IS NULL OR ess.effective_to >= $3)
      WHERE u.organization_id = $1
        AND u.role            = 'employee'
        AND (u.employee_status IS NULL OR u.employee_status NOT IN ('inactive','resigned','terminated'))
        ${branchClause}
      ORDER BY u.name ASC`,
    params
  );
  return rows;
}

// ─── generateEmployeePayslip ─────────────────────────────────────────────────
/**
 * Calculates payroll for one employee and upserts an immutable snapshot payslip.
 * Throws GenerationError if the existing payslip is locked.
 *
 * @returns {object}  The inserted/updated payslips row
 */
async function generateEmployeePayslip({ organizationId, userId, month, year, payrollRunId, generatedBy }) {
  const oId  = Number(organizationId);
  const uId  = Number(userId);
  const m    = Number(month);
  const y    = Number(year);
  const mStr = padZ(m);

  // Block regeneration of locked payslips
  const lockCheck = await pool.query(
    `SELECT id, locked FROM payslips
      WHERE user_id = $1 AND month = $2 AND year = $3 AND organization_id = $4`,
    [uId, mStr, y, oId]
  );
  if (lockCheck.rows.length > 0 && lockCheck.rows[0].locked) {
    throw new GenerationError(
      `Payslip for employee ${uId} in ${mStr}/${y} is locked and cannot be regenerated`,
      'PAYSLIP_LOCKED',
      { payslipId: lockCheck.rows[0].id }
    );
  }

  // Delegate all arithmetic to the engine (Phase 3.2)
  const calc = await calculatePayroll({ organizationId: oId, userId: uId, month: m, year: y });

  const sal = calc.salaryStructure;
  const att = calc.attendance;
  const lop = calc.lop;
  const ded = calc.deductions;
  const emp = calc.employerContribution;

  const presentDays = round2(
    att.presentFull +
    (att.presentHalf   * 0.5) +
    (att.paidHalfLeave * 0.5)
  );
  const leaveDays = att.paidLeave + att.unpaidLeave;

  // BUG_131 FIX: the payslips table has no unique constraint on (user_id, month, year)
  // so ON CONFLICT cannot be used. Instead: check for an existing row, then UPDATE or INSERT.
  const existingPayslip = await pool.query(
    `SELECT id FROM payslips
      WHERE user_id = $1 AND month = $2 AND year = $3 AND organization_id = $4`,
    [uId, mStr, y, oId]
  );

  const payslipValues = [
    uId, mStr, y, `${mStr}/${y}`, oId, generatedBy,         // 1-6
    payrollRunId ?? null, '3.3', sal.id,                     // 7-9
    JSON.stringify(att), JSON.stringify(lop),                // 10-11
    sal.basic, sal.hra, sal.da,                              // 12-14
    sal.transportAllowance, sal.medicalAllowance,            // 15-16
    sal.specialAllowance, sal.otherAllowance,                // 17-18
    calc.grossSalary,                                        // 19
    ded.pf, ded.esi, ded.professionalTax, ded.tds,          // 20-23
    ded.otherDeductions,                                     // 24
    ded.retention,                                           // 25
    emp.pf, emp.esi,                                         // 26-27
    ded.total, lop.total, ded.lopDeduction,                  // 28-30
    calc.netSalary,                                          // 31
    calc.workingDays, presentDays, att.absent, leaveDays,   // 32-35
  ];

  let rows;
  if (existingPayslip.rows.length > 0) {
    // UPDATE existing payslip (lock already checked above)
    ({ rows } = await pool.query(
      `UPDATE payslips SET
          pay_period          = $4,
          generated_by        = $6,
          payroll_run_id      = $7,
          formula_version     = $8,
          salary_structure_id = $9,
          attendance_snapshot = $10,
          lop_snapshot        = $11,
          basic               = $12,
          hra                 = $13,
          da                  = $14,
          transport_allowance = $15,
          medical_allowance   = $16,
          special_allowance   = $17,
          other_allowances    = $18,
          gross_salary        = $19,
          pf_employee         = $20,
          esi_employee        = $21,
          professional_tax    = $22,
          tds                 = $23,
          other_deductions    = $24,
          retention           = $25,
          pf_employer         = $26,
          esi_employer        = $27,
          total_deductions    = $28,
          lop_days            = $29,
          lop_amount          = $30,
          net_salary          = $31,
          working_days        = $32,
          present_days        = $33,
          absent_days         = $34,
          leave_days          = $35,
          status              = 'generated'
        WHERE user_id = $1 AND month = $2 AND year = $3 AND organization_id = $5
        RETURNING id, gross_salary, total_deductions, net_salary`,
      payslipValues
    ));
  } else {
    // INSERT new payslip
    ({ rows } = await pool.query(
      `INSERT INTO payslips (
          user_id, month, year, pay_period, organization_id, generated_by,
          payroll_run_id, formula_version, salary_structure_id,
          attendance_snapshot, lop_snapshot,
          basic, hra, da, transport_allowance, medical_allowance,
          special_allowance, other_allowances,
          gross_salary,
          pf_employee, esi_employee, professional_tax, tds, other_deductions,
          retention,
          pf_employer, esi_employer,
          total_deductions, lop_days, lop_amount,
          net_salary, working_days, present_days, absent_days, leave_days,
          status
       )
       VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,$18,$19,
          $20,$21,$22,$23,$24,
          $25,
          $26,$27,
          $28,$29,$30,$31,$32,$33,$34,$35,
          'generated'
       )
       RETURNING id, gross_salary, total_deductions, net_salary`,
      payslipValues
    ));
  }

  const payslipRow = rows[0];

  // ── Phase 3.7: Apply statutory calculations (PF/ESI/PT/TDS/LWF/Gratuity) ──
  // Fire-and-forget: if statutory config is absent nothing changes; errors are silent.
  // BUG_131 FIX: removed invalid `data.salary` / `data.employee` references (data is not in
  // scope here; use calc.salaryStructure and calc.employee instead).
  try {
    await applyStatutoryCalculations({
      organizationId: oId,
      userId:         uId,
      month:          m,
      year:           y,
      payslipId:      payslipRow.id,
      grossSalary:    calc.grossSalary,
      basicSalary:    sal.basic,
      salary:         { basic: sal.basic, da: sal.da },
      joiningDate:    calc.employee?.joining_date || null,
      pfCalcMode:     sal.pfCalcMode,
      esiCalcMode:    sal.esiCalcMode,
    });
  } catch (e) {
    // Log but don't fail payslip generation
    console.warn(`[Statutory] Calculation warning for user ${uId}:`, e.message);
  }

  // Re-fetch updated payslip (statutory may have changed totals)
  const updated = await pool.query(
    `SELECT id, gross_salary, total_deductions, net_salary FROM payslips WHERE id = $1`,
    [payslipRow.id]
  );

  return updated.rows[0] || payslipRow;
}

// ─── generatePayrollRun ───────────────────────────────────────────────────────
/**
 * Creates a payroll run for an organisation / period. Processes every eligible
 * employee; individual failures are recorded but do NOT abort the run.
 *
 * @param {object}    p
 * @param {number}    p.organizationId
 * @param {number}    p.month
 * @param {number}    p.year
 * @param {number}    p.generatedBy    — user ID of the actor
 * @param {string}    [p.notes]
 * @param {boolean}   [p.force=false]  — allow regenerating an existing (non-locked) run
 * @param {string}    [p.ip]
 * @param {number[]|null} [p.employeeIds]  — optional branch-scoped employee subset;
 *                        null/undefined = process all eligible org employees.
 *                        The payroll calculation per employee is IDENTICAL regardless
 *                        of whether this filter is active.
 * @param {number|null} [p.branchId]   — branch this run belongs to.
 *                        null  = organisation-wide run (All Branches or legacy).
 *                        <id>  = branch-specific run; only that branch's employees
 *                                are included and the run is isolated from other branches.
 */
async function generatePayrollRun({ organizationId, month, year, generatedBy, notes, force = false, ip, employeeIds = null, branchId = null }) {
  const oId  = Number(organizationId);
  const m    = Number(month);
  const y    = Number(year);

  if (m < 1 || m > 12)        throw new GenerationError(`Invalid month: ${m}`, 'INVALID_MONTH');
  if (y < 2000 || y > 2100)   throw new GenerationError(`Invalid year: ${y}`, 'INVALID_YEAR');
  // null is explicitly allowed — used by the scheduler for system-generated runs.
  // undefined means the caller omitted the parameter entirely, which is always a bug.
  if (generatedBy === undefined) throw new GenerationError('generatedBy is required', 'INVALID_PARAMS');

  // Block generating payroll for a future month (attendance data doesn't exist yet)
  const now    = new Date();
  const nowY   = now.getFullYear();
  const nowM   = now.getMonth() + 1;
  if (y > nowY || (y === nowY && m > nowM)) {
    throw new GenerationError(
      `Cannot generate payroll for a future period (${padZ(m)}/${y}). ` +
      `Current period is ${padZ(nowM)}/${nowY}.`,
      'FUTURE_PERIOD'
    );
  }

  // ── Step 1: advisory lock + create/reset run ────────────────────────────
  // pg_advisory_xact_lock ensures only one concurrent generation per period
  // and per branch.  Using 0 as the sentinel for "All Branches" (null) is safe
  // because branch IDs are BIGSERIAL and always >= 1.
  //
  // Key layout (all decimal): oId × 10 000 000 + branchKey × 10 000 + (y % 100) × 100 + m
  //   org=1, branch=null, 2026-08  →  10_002_608
  //   org=1, branch=2,    2026-08  →  10_022_608   (no collision with above)
  //   org=2, branch=2,    2026-08  →  20_022_608   (different org)
  const bKey    = BigInt(branchId ?? 0);
  const lockKey = BigInt(oId) * 10_000_000n
                + bKey          * 10_000n
                + BigInt(y % 100) *   100n
                + BigInt(m);

  let runId;
  let isRegenerate = false;

  const setupClient = await pool.connect();
  try {
    await setupClient.query('BEGIN');
    await setupClient.query('SELECT pg_advisory_xact_lock($1)', [String(lockKey)]);

    // Branch-isolated lookup: use IS NOT DISTINCT FROM so NULL = NULL holds true.
    // This prevents Branch A from finding Branch B's run (and vice versa) and
    // ensures the org-wide (NULL) run is only matched when branchId is also NULL.
    const existing = await setupClient.query(
      `SELECT id, status FROM payroll_runs
        WHERE organization_id = $1
          AND branch_id IS NOT DISTINCT FROM $2
          AND month = $3
          AND year  = $4`,
      [oId, branchId ?? null, m, y]
    );

    const branchLabel = branchId ? `branch ${branchId} ` : '';

    if (existing.rows.length > 0) {
      const run = existing.rows[0];

      if (run.status === 'locked') {
        await setupClient.query('ROLLBACK');
        throw new GenerationError(
          `Payroll ${branchLabel}for ${padZ(m)}/${y} is locked. Unlock it first.`,
          'PAYROLL_LOCKED',
          { existingRunId: run.id }
        );
      }
      if (run.status === 'processing') {
        await setupClient.query('ROLLBACK');
        throw new GenerationError(
          `Payroll ${branchLabel}for ${padZ(m)}/${y} is already being processed.`,
          'ALREADY_PROCESSING',
          { existingRunId: run.id }
        );
      }
      if (!force) {
        await setupClient.query('ROLLBACK');
        throw new GenerationError(
          `Payroll ${branchLabel}for ${padZ(m)}/${y} already exists (status: ${run.status}). ` +
          'Pass force=true to regenerate.',
          'PAYROLL_EXISTS',
          { existingRunId: run.id, currentStatus: run.status }
        );
      }

      // Reset ONLY this run — identified by primary key so a force-regen of
      // Branch A can never touch Branch B's run for the same period.
      await setupClient.query(
        `UPDATE payroll_runs SET
           status = 'processing', generated_by = $1, generated_at = NOW(),
           completed_at = NULL, employee_count = 0, total_gross = 0,
           total_deductions = 0, total_net = 0, error_count = 0, notes = $2
         WHERE id = $3 AND organization_id = $4`,
        [generatedBy, notes ?? null, run.id, oId]
      );
      // Delete employee rows only for THIS run's ID — never by period alone.
      await setupClient.query(
        `DELETE FROM payroll_run_employees WHERE payroll_run_id = $1`,
        [run.id]
      );
      runId         = run.id;
      isRegenerate  = true;
    } else {
      const res = await setupClient.query(
        `INSERT INTO payroll_runs (organization_id, branch_id, month, year, status, generated_by, notes)
         VALUES ($1, $2, $3, $4, 'processing', $5, $6) RETURNING id`,
        [oId, branchId ?? null, m, y, generatedBy, notes ?? null]
      );
      runId = res.rows[0].id;
    }

    await setupClient.query('COMMIT');
  } catch (err) {
    await setupClient.query('ROLLBACK');
    throw err;
  } finally {
    setupClient.release();
  }

  // ── Step 2: fetch eligible employees (branch-scoped if employeeIds provided) ─
  const employees = await fetchEligibleEmployees(oId, m, y, employeeIds || null);

  if (employees.length === 0) {
    await pool.query(
      `UPDATE payroll_runs SET status = 'failed', completed_at = NOW(),
       error_count = 0, employee_count = 0
       WHERE id = $1 AND organization_id = $2`,
      [runId, oId]
    );
    throw new GenerationError(
      'No eligible employees found. Ensure employees have active salary structures.',
      'NO_ELIGIBLE_EMPLOYEES',
      { runId }
    );
  }

  // ── Step 3: process each employee sequentially ────────────────────────────
  let successCount = 0, errorCount = 0;
  let totalGross = 0, totalDeductions = 0, totalNet = 0;

  for (const emp of employees) {
    try {
      const payslip = await generateEmployeePayslip({
        organizationId: oId,
        userId:         emp.id,
        month:          m,
        year:           y,
        payrollRunId:   runId,
        generatedBy,
      });

      await pool.query(
        `INSERT INTO payroll_run_employees
           (payroll_run_id, organization_id, user_id, payslip_id, status, processed_at)
         VALUES ($1, $2, $3, $4, 'success', NOW())
         ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
           payslip_id    = EXCLUDED.payslip_id,
           status        = 'success',
           error_message = NULL,
           processed_at  = NOW()`,
        [runId, oId, emp.id, payslip.id]
      );

      successCount++;
      totalGross      += Number(payslip.gross_salary);
      totalDeductions += Number(payslip.total_deductions);
      totalNet        += Number(payslip.net_salary);
    } catch (err) {
      const msg = (err.message || 'Unknown error').substring(0, 500);
      await pool.query(
        `INSERT INTO payroll_run_employees
           (payroll_run_id, organization_id, user_id, status, error_message, processed_at)
         VALUES ($1, $2, $3, 'failed', $4, NOW())
         ON CONFLICT (payroll_run_id, user_id) DO UPDATE SET
           status        = 'failed',
           error_message = $4,
           payslip_id    = NULL,
           processed_at  = NOW()`,
        [runId, oId, emp.id, msg]
      );
      errorCount++;
    }
  }

  // ── Step 4: finalise run ──────────────────────────────────────────────────
  const finalStatus = successCount === 0
    ? 'failed'
    : errorCount > 0
      ? 'completed_with_errors'
      : 'completed';

  await pool.query(
    `UPDATE payroll_runs SET
       status = $1, completed_at = NOW(),
       employee_count = $2, total_gross = $3,
       total_deductions = $4, total_net = $5, error_count = $6
     WHERE id = $7 AND organization_id = $8`,
    [finalStatus, successCount, round2(totalGross), round2(totalDeductions),
     round2(totalNet), errorCount, runId, oId]
  );

  logAudit({
    oId,
    actorId:    generatedBy,
    action:     isRegenerate
      ? 'payroll_regenerated'
      : (generatedBy === null ? 'payroll_auto_generated' : 'payroll_generated'),
    entityType: 'payroll_run',
    entityId:   runId,
    newValues:  { month: m, year: y, branchId: branchId ?? null, status: finalStatus, successCount, errorCount },
    ip,
  });

  return {
    runId,
    status:       finalStatus,
    month:        m,
    year:         y,
    branchId:     branchId ?? null,
    successCount,
    errorCount,
    totalGross:   round2(totalGross),
    totalDeductions: round2(totalDeductions),
    totalNet:     round2(totalNet),
  };
}

// ─── previewPayrollRun ────────────────────────────────────────────────────────
/**
 * Runs calculations for all eligible employees without writing anything.
 * Returns a summary for HR to review before triggering generation.
 *
 * @param {object}    p
 * @param {number}    p.organizationId
 * @param {number}    p.month
 * @param {number}    p.year
 * @param {number[]|null} [p.employeeIds] — optional branch-scoped employee subset
 * @param {number|null}  [p.branchId]    — branch context; mirrors generatePayrollRun's semantics.
 *                                         Used to find the correct existing run for the preview banner.
 */
async function previewPayrollRun({ organizationId, month, year, employeeIds = null, branchId = null }) {
  const oId = Number(organizationId);
  const m   = Number(month);
  const y   = Number(year);

  if (m < 1 || m > 12)       throw new GenerationError(`Invalid month: ${m}`, 'INVALID_MONTH');
  if (y < 2000 || y > 2100)  throw new GenerationError(`Invalid year: ${y}`, 'INVALID_YEAR');

  const employees = await fetchEligibleEmployees(oId, m, y, employeeIds || null);

  // Preview is read-only: run all employees concurrently for speed.
  // No partial-failure isolation needed here since nothing is written.
  const items = await Promise.all(
    employees.map(async emp => {
      try {
        const calc = await calculatePayroll({ organizationId: oId, userId: emp.id, month: m, year: y });
        return {
          userId:      emp.id,
          name:        emp.name,
          department:  emp.department,
          employeeId:  emp.employee_id,
          grossSalary: calc.grossSalary,
          deductions:  calc.deductions.total,
          netSalary:   calc.netSalary,
          payableDays: calc.payableDays,
          lopDays:     calc.lop.total,
          status:      'eligible',
        };
      } catch (err) {
        return {
          userId:     emp.id,
          name:       emp.name,
          department: emp.department,
          employeeId: emp.employee_id,
          status:     'error',
          error:      err.message,
        };
      }
    })
  );

  const eligible = items.filter(i => i.status === 'eligible');

  // Check if a run already exists for this period + branch combination.
  // Must mirror generatePayrollRun's lookup so the preview banner is accurate:
  // Dalal preview shows Dalal's run; Bhuj preview shows Bhuj's run.
  const existing = await pool.query(
    `SELECT id, status, branch_id FROM payroll_runs
      WHERE organization_id = $1
        AND branch_id IS NOT DISTINCT FROM $2
        AND month = $3
        AND year  = $4`,
    [oId, branchId ?? null, m, y]
  );

  return {
    organizationId:  oId,
    month:           m,
    year:            y,
    employeeCount:   items.length,
    eligibleCount:   eligible.length,
    errorCount:      items.filter(i => i.status === 'error').length,
    totalGross:      round2(eligible.reduce((s, i) => s + i.grossSalary, 0)),
    totalDeductions: round2(eligible.reduce((s, i) => s + i.deductions,  0)),
    totalNet:        round2(eligible.reduce((s, i) => s + i.netSalary,   0)),
    existingRun:     existing.rows[0] ?? null,
    employees:       items,
  };
}

// ─── lockPayrollRun ───────────────────────────────────────────────────────────
/**
 * Locks a completed payroll run. Payslips become immutable.
 * Only runs with status 'completed' or 'completed_with_errors' can be locked.
 */
async function lockPayrollRun({ organizationId, runId, actorId, actorName, ip }) {
  const oId = Number(organizationId);
  const rId = Number(runId);

  const runRes = await pool.query(
    `SELECT id, status, month, year FROM payroll_runs
      WHERE id = $1 AND organization_id = $2`,
    [rId, oId]
  );
  if (!runRes.rows.length) throw new GenerationError('Payroll run not found', 'RUN_NOT_FOUND');
  const run = runRes.rows[0];

  if (run.status === 'locked') return { id: rId, status: 'locked' }; // idempotent

  if (!['completed', 'completed_with_errors'].includes(run.status)) {
    throw new GenerationError(
      `Cannot lock a run with status '${run.status}'. Complete generation first.`,
      'INVALID_STATUS_FOR_LOCK',
      { currentStatus: run.status }
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE payroll_runs
          SET status = 'locked', locked_by = $1, locked_at = NOW()
        WHERE id = $2 AND organization_id = $3`,
      [actorId, rId, oId]
    );

    await client.query(
      `UPDATE payslips
          SET locked = TRUE, locked_by = $1, locked_at = NOW()
        WHERE payroll_run_id = $2 AND organization_id = $3`,
      [actorId, rId, oId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }

  logAudit({
    oId, actorId, actorName,
    action:     'payroll_locked',
    entityType: 'payroll_run',
    entityId:   rId,
    newValues:  { status: 'locked', month: run.month, year: run.year },
    ip,
  });

  return { id: rId, status: 'locked' };
}

// ─── unlockPayrollRun ─────────────────────────────────────────────────────────
/**
 * Unlocks a payroll run (Root Admin only — enforced at route level via RBAC).
 */
async function unlockPayrollRun({ organizationId, runId, actorId, actorName, ip }) {
  const oId = Number(organizationId);
  const rId = Number(runId);

  const runRes = await pool.query(
    `SELECT id, status, month, year FROM payroll_runs
      WHERE id = $1 AND organization_id = $2`,
    [rId, oId]
  );
  if (!runRes.rows.length) throw new GenerationError('Payroll run not found', 'RUN_NOT_FOUND');
  const run = runRes.rows[0];

  if (run.status !== 'locked') {
    return { id: rId, status: run.status }; // idempotent
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE payroll_runs
          SET status = 'completed', locked_by = NULL, locked_at = NULL
        WHERE id = $1 AND organization_id = $2`,
      [rId, oId]
    );

    await client.query(
      `UPDATE payslips
          SET locked = FALSE, locked_by = NULL, locked_at = NULL
        WHERE payroll_run_id = $1 AND organization_id = $2`,
      [rId, oId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }

  logAudit({
    oId, actorId, actorName,
    action:     'payroll_unlocked',
    entityType: 'payroll_run',
    entityId:   rId,
    newValues:  { status: 'completed', month: run.month, year: run.year },
    ip,
  });

  return { id: rId, status: 'completed' };
}

module.exports = {
  generatePayrollRun,
  generateEmployeePayslip,
  lockPayrollRun,
  unlockPayrollRun,
  previewPayrollRun,
  GenerationError,
};
