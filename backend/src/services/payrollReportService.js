'use strict';
/**
 * payrollReportService.js — Phase 3.6
 * Generates structured payroll reports. All queries are org-scoped.
 * Returns plain JS objects; callers handle formatting (CSV, JSON).
 */

const { pool } = require('../config/db');

function padZ(n) { return String(n).padStart(2, '0'); }
function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

// ── Payroll Summary ───────────────────────────────────────────────────────────
// One row per payroll run for the requested month/year.
// branchIds: null = org-wide, [] = no access (caller must guard), [...] = filter these branches.
// Org-wide runs (branch_id IS NULL) are always included alongside branch-specific runs so that
// payroll generated before the branch feature was enabled remains visible in any branch view.
async function getPayrollSummary({ organizationId, month, year, branchIds = null }) {
  const oId = Number(organizationId);
  if (Array.isArray(branchIds) && branchIds.length === 0) return [];

  const params = [oId, month || null, year || null];
  let branchClause = '';
  if (branchIds !== null) {
    params.push(branchIds);
    branchClause = `AND (pr.branch_id = ANY($${params.length}::bigint[]) OR pr.branch_id IS NULL)`;
  }

  const { rows } = await pool.query(
    `SELECT
         pr.id           AS run_id,
         pr.month,
         pr.year,
         pr.status,
         pr.employee_count,
         pr.total_gross,
         pr.total_deductions,
         pr.total_net,
         pr.total_adjustments,
         pr.error_count,
         pr.generated_at,
         pr.locked_at,
         pr.paid_at,
         u.name AS generated_by_name
       FROM payroll_runs pr
       LEFT JOIN users u ON u.id = pr.generated_by
      WHERE pr.organization_id = $1
        AND ($2::int IS NULL OR pr.month = $2)
        AND ($3::int IS NULL OR pr.year  = $3)
        ${branchClause}
      ORDER BY pr.year DESC, pr.month DESC`,
    params
  );
  return rows;
}

// ── Department Summary ────────────────────────────────────────────────────────
async function getDepartmentSummary({ organizationId, month, year, branchIds = null }) {
  const oId  = Number(organizationId);
  if (Array.isArray(branchIds) && branchIds.length === 0) return [];
  const mStr = month ? padZ(month) : null;

  const params = [oId, mStr, year || null];
  let branchClause = '';
  if (branchIds !== null) {
    params.push(branchIds);
    branchClause = `AND u.branch_id = ANY($${params.length}::bigint[])`;
  }

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.department, 'Unassigned') AS department,
         COUNT(ps.id)::int                    AS employee_count,
         SUM(ps.gross_salary)                 AS total_gross,
         SUM(ps.total_deductions)             AS total_deductions,
         SUM(ps.lop_amount)                   AS total_lop,
         SUM(ps.net_salary + COALESCE(ps.adjustment_total, 0)) AS total_net,
         AVG(ps.net_salary)                   AS avg_net_salary,
         SUM(ps.lop_days)                     AS total_lop_days
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ($2::text IS NULL OR ps.month = $2)
        AND ($3::int  IS NULL OR ps.year  = $3)
        AND ps.status != 'cancelled'
        ${branchClause}
      GROUP BY COALESCE(u.department, 'Unassigned')
      ORDER BY total_gross DESC`,
    params
  );
  return rows.map(r => ({
    ...r,
    total_gross:    round2(r.total_gross),
    total_deductions: round2(r.total_deductions),
    total_lop:      round2(r.total_lop),
    total_net:      round2(r.total_net),
    avg_net_salary: round2(r.avg_net_salary),
    total_lop_days: Number(r.total_lop_days || 0),
  }));
}

// ── Salary Register ───────────────────────────────────────────────────────────
// Full per-employee breakdown for a pay period.
async function getSalaryRegister({ organizationId, month, year, branchIds = null }) {
  const oId  = Number(organizationId);
  if (Array.isArray(branchIds) && branchIds.length === 0) return [];
  const mStr = month ? padZ(month) : null;

  const params = [oId, mStr, year || null];
  let branchClause = '';
  if (branchIds !== null) {
    params.push(branchIds);
    branchClause = `AND u.branch_id = ANY($${params.length}::bigint[])`;
  }

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.employee_id, u.id::text) AS employee_id,
         u.name                   AS employee_name,
         u.department,
         u.position,
         ps.month,
         ps.year,
         ps.status,
         ps.basic,
         ps.hra,
         ps.da,
         ps.transport_allowance,
         ps.medical_allowance,
         ps.special_allowance,
         ps.other_allowances,
         ps.gross_salary,
         ps.pf_employee,
         ps.esi_employee,
         ps.professional_tax,
         ps.tds,
         ps.other_deductions,
         ps.lop_days,
         ps.lop_amount,
         ps.total_deductions,
         ps.pf_employer,
         ps.esi_employer,
         ps.adjustment_total,
         (ps.net_salary + COALESCE(ps.adjustment_total, 0)) AS effective_net,
         ps.working_days,
         ps.present_days,
         ps.absent_days,
         ps.leave_days,
         ps.has_override,
         ps.locked
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ($2::text IS NULL OR ps.month = $2)
        AND ($3::int  IS NULL OR ps.year  = $3)
        AND ps.status != 'cancelled'
        ${branchClause}
      ORDER BY u.department, u.name`,
    params
  );
  return rows;
}

// ── LOP Report ────────────────────────────────────────────────────────────────
async function getLopReport({ organizationId, month, year, branchIds = null }) {
  const oId  = Number(organizationId);
  if (Array.isArray(branchIds) && branchIds.length === 0) return [];
  const mStr = month ? padZ(month) : null;

  const params = [oId, mStr, year || null];
  let branchClause = '';
  if (branchIds !== null) {
    params.push(branchIds);
    branchClause = `AND u.branch_id = ANY($${params.length}::bigint[])`;
  }

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.employee_id, u.id::text) AS employee_id,
         u.name            AS employee_name,
         u.department,
         ps.month,
         ps.year,
         ps.working_days,
         ps.present_days,
         ps.absent_days,
         ps.leave_days,
         ps.lop_days,
         ps.lop_amount,
         ps.gross_salary,
         ps.net_salary,
         ps.has_override
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ($2::text IS NULL OR ps.month = $2)
        AND ($3::int  IS NULL OR ps.year  = $3)
        AND ps.lop_days > 0
        AND ps.status != 'cancelled'
        ${branchClause}
      ORDER BY ps.lop_days DESC, u.name`,
    params
  );
  return rows;
}

// ── Adjustment Summary ────────────────────────────────────────────────────────
async function getAdjustmentSummary({ organizationId, month, year, branchIds = null }) {
  const oId = Number(organizationId);
  if (Array.isArray(branchIds) && branchIds.length === 0) return [];

  const params = [oId, month || null, year || null];
  let branchClause = '';
  if (branchIds !== null) {
    params.push(branchIds);
    branchClause = `AND u.branch_id = ANY($${params.length}::bigint[])`;
  }

  const { rows } = await pool.query(
    `SELECT
         pa.adjustment_category,
         pa.addition_or_deduction,
         COUNT(pa.id)::int   AS count,
         SUM(pa.amount)      AS total_amount,
         STRING_AGG(DISTINCT u.department, ', ') AS departments
       FROM payroll_adjustments pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.organization_id = $1
        AND ($2::int IS NULL OR pa.effective_month = $2)
        AND ($3::int IS NULL OR pa.effective_year  = $3)
        AND pa.deleted_at IS NULL
        ${branchClause}
      GROUP BY pa.adjustment_category, pa.addition_or_deduction
      ORDER BY pa.adjustment_category`,
    params
  );
  return rows.map(r => ({ ...r, total_amount: round2(r.total_amount) }));
}

// ── Monthly Trend (for dashboard chart) ──────────────────────────────────────
async function getMonthlyTrend({ organizationId, months = 6, branchIds = null }) {
  const oId = Number(organizationId);
  if (Array.isArray(branchIds) && branchIds.length === 0) return [];

  const params = [oId];
  let branchClause = '';
  if (branchIds !== null) {
    params.push(branchIds);
    branchClause = `AND (pr.branch_id = ANY($${params.length}::bigint[]) OR pr.branch_id IS NULL)`;
  }
  params.push(months);

  const { rows } = await pool.query(
    `SELECT
         pr.year,
         pr.month,
         pr.total_gross,
         pr.total_net,
         pr.total_deductions,
         pr.employee_count
       FROM payroll_runs pr
      WHERE pr.organization_id = $1
        AND pr.status NOT IN ('draft','processing','failed')
        ${branchClause}
      ORDER BY pr.year DESC, pr.month DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.reverse(); // chronological order
}

// ── CSV formatter ─────────────────────────────────────────────────────────────
function toCsv(rows, fields) {
  if (!rows.length) return fields.map(f => f.label || f.key).join(',') + '\n';

  const header = fields.map(f => `"${(f.label || f.key).replace(/"/g, '""')}"`).join(',');
  const body   = rows.map(row =>
    fields.map(f => {
      const v = row[f.key];
      if (v === null || v === undefined) return '';
      const s = String(v).replace(/"/g, '""');
      return `"${s}"`;
    }).join(',')
  ).join('\n');

  return header + '\n' + body + '\n';
}

const SALARY_REGISTER_FIELDS = [
  { key: 'employee_id',       label: 'Employee ID' },
  { key: 'employee_name',     label: 'Name' },
  { key: 'department',        label: 'Department' },
  { key: 'position',          label: 'Designation' },
  { key: 'month',             label: 'Month' },
  { key: 'year',              label: 'Year' },
  { key: 'basic',             label: 'Basic' },
  { key: 'hra',               label: 'HRA' },
  { key: 'da',                label: 'DA' },
  { key: 'transport_allowance', label: 'Transport' },
  { key: 'medical_allowance', label: 'Medical' },
  { key: 'special_allowance', label: 'Special Allowance' },
  { key: 'other_allowances',  label: 'Other Allowances' },
  { key: 'gross_salary',      label: 'Gross Salary' },
  { key: 'pf_employee',       label: 'PF (Employee)' },
  { key: 'esi_employee',      label: 'ESI (Employee)' },
  { key: 'professional_tax',  label: 'Professional Tax' },
  { key: 'tds',               label: 'TDS' },
  { key: 'lop_days',          label: 'LOP Days' },
  { key: 'lop_amount',        label: 'LOP Amount' },
  { key: 'total_deductions',  label: 'Total Deductions' },
  { key: 'adjustment_total',  label: 'Adjustments' },
  { key: 'effective_net',     label: 'Net Salary' },
  { key: 'working_days',      label: 'Working Days' },
  { key: 'present_days',      label: 'Present Days' },
  { key: 'absent_days',       label: 'Absent Days' },
  { key: 'leave_days',        label: 'Leave Days' },
];

module.exports = {
  getPayrollSummary,
  getDepartmentSummary,
  getSalaryRegister,
  getLopReport,
  getAdjustmentSummary,
  getMonthlyTrend,
  toCsv,
  SALARY_REGISTER_FIELDS,
};
