'use strict';
/**
 * statutoryReportService.js — Phase 3.7
 * Generates statutory compliance reports:
 *  - PF ECR (Electronic Challan cum Return)
 *  - ESI return dataset
 *  - PT challan
 *  - TDS challan
 *  - Form 16 dataset
 *  - Compliance summary
 */

const { pool } = require('../config/db');

function padZ(n) { return String(n).padStart(2, '0'); }
function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

function toCsv(rows, fields) {
  if (!rows.length) return fields.map(f => f.label || f.key).join(',') + '\n';
  const header = fields.map(f => `"${(f.label || f.key).replace(/"/g, '""')}"`).join(',');
  const body   = rows.map(row =>
    fields.map(f => {
      const v = row[f.key];
      if (v === null || v === undefined) return '""';
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(',')
  ).join('\n');
  return header + '\n' + body + '\n';
}

// ── PF ECR (Electronic Challan cum Return) ────────────────────────────────────
// EPFO ECR format: member UAN, name, gross, EPF wages, EPS wages,
//                  employee PF, employer EPF, employer EPS
async function getPFECR({ organizationId, month, year }) {
  const oId  = Number(organizationId);
  const mStr = padZ(month);

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.employee_id, u.id::TEXT) AS employee_id,
         u.name            AS member_name,
         u.uan_number,
         u.pan_number,
         ps.gross_salary,
         ps.pf_employee    AS employee_pf,
         ps.eps_amount,
         ps.epf_employer_amount,
         ps.pf_employer    AS total_employer_pf,
         ps.basic,
         ps.da,
         (ps.basic + COALESCE(ps.da, 0)) AS basic_da,
         ps.statutory_snapshot
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ps.month = $2
        AND ps.year  = $3
        AND ps.status NOT IN ('draft','cancelled')
        AND COALESCE(ps.pf_employee, 0) > 0
      ORDER BY u.name`,
    [oId, mStr, year]
  );

  return rows.map(r => {
    const snap      = r.statutory_snapshot || {};
    const pfSnap    = snap.pf || {};
    const pfWages   = round2(pfSnap.pfWages || (Number(r.basic) || 0));
    const epsWages  = Math.min(pfWages, 15000); // EPS always capped at 15000

    return {
      uan:            r.uan_number || '',
      employee_id:    r.employee_id || '',
      member_name:    r.member_name,
      gross_salary:   round2(r.gross_salary),
      epf_wages:      pfWages,
      eps_wages:      epsWages,
      employee_pf:    round2(r.employee_pf || 0),
      employer_epf:   round2(r.epf_employer_amount || 0),
      employer_eps:   round2(r.eps_amount || 0),
      total_employer: round2(r.total_employer_pf || 0),
      total_pf_contribution: round2((r.employee_pf || 0) + (r.total_employer_pf || 0)),
    };
  });
}

const PF_ECR_FIELDS = [
  { key: 'uan',            label: 'UAN' },
  { key: 'employee_id',    label: 'Member ID' },
  { key: 'member_name',    label: 'Member Name' },
  { key: 'gross_salary',   label: 'Gross Wages' },
  { key: 'epf_wages',      label: 'EPF Wages' },
  { key: 'eps_wages',      label: 'EPS Wages' },
  { key: 'employee_pf',    label: 'Employee Share (EPF)' },
  { key: 'employer_epf',   label: 'Employer Share (EPF)' },
  { key: 'employer_eps',   label: 'Employer Share (EPS)' },
  { key: 'total_employer', label: 'Total Employer' },
  { key: 'total_pf_contribution', label: 'Total Contribution' },
];

// ── ESI Return ────────────────────────────────────────────────────────────────
async function getESIReturn({ organizationId, month, year }) {
  const oId  = Number(organizationId);
  const mStr = padZ(month);

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.employee_id, u.id::TEXT) AS employee_id,
         u.name         AS employee_name,
         u.esi_number,
         ps.gross_salary,
         ps.esi_employee,
         ps.esi_employer
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ps.month = $2
        AND ps.year  = $3
        AND ps.status NOT IN ('draft','cancelled')
        AND COALESCE(ps.esi_employee, 0) > 0
      ORDER BY u.name`,
    [oId, mStr, year]
  );

  return rows.map(r => ({
    employee_id:    r.employee_id || '',
    employee_name:  r.employee_name,
    esi_number:     r.esi_number  || '',
    gross_wages:    round2(r.gross_salary),
    employee_esi:   round2(r.esi_employee || 0),
    employer_esi:   round2(r.esi_employer || 0),
    total_esi:      round2((r.esi_employee || 0) + (r.esi_employer || 0)),
  }));
}

const ESI_FIELDS = [
  { key: 'esi_number',    label: 'ESI Number' },
  { key: 'employee_id',   label: 'Emp ID' },
  { key: 'employee_name', label: 'Name' },
  { key: 'gross_wages',   label: 'Gross Wages' },
  { key: 'employee_esi',  label: 'Employee Contribution' },
  { key: 'employer_esi',  label: 'Employer Contribution' },
  { key: 'total_esi',     label: 'Total ESI' },
];

// ── PT Challan ────────────────────────────────────────────────────────────────
async function getPTChallan({ organizationId, month, year }) {
  const oId  = Number(organizationId);
  const mStr = padZ(month);

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.employee_id, u.id::TEXT) AS employee_id,
         u.name          AS employee_name,
         u.department,
         ps.gross_salary,
         ps.professional_tax AS pt_amount
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ps.month = $2
        AND ps.year  = $3
        AND ps.status NOT IN ('draft','cancelled')
        AND COALESCE(ps.professional_tax, 0) > 0
      ORDER BY u.name`,
    [oId, mStr, year]
  );

  const total = rows.reduce((s, r) => s + Number(r.pt_amount || 0), 0);
  return {
    rows: rows.map(r => ({
      employee_id:    r.employee_id || '',
      employee_name:  r.employee_name,
      department:     r.department  || '',
      gross_salary:   round2(r.gross_salary),
      pt_amount:      round2(r.pt_amount || 0),
    })),
    total_pt: round2(total),
  };
}

// ── TDS Challan (24Q) ─────────────────────────────────────────────────────────
async function getTDSChallan({ organizationId, month, year }) {
  const oId  = Number(organizationId);
  const mStr = padZ(month);

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.employee_id, u.id::TEXT) AS employee_id,
         u.name          AS employee_name,
         u.pan_number,
         ps.gross_salary,
         ps.tds           AS monthly_tds,
         ps.tds_annual_projected,
         ps.tds_ytd,
         COALESCE(ps.regime, 'old') AS regime
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ps.month = $2
        AND ps.year  = $3
        AND ps.status NOT IN ('draft','cancelled')
        AND COALESCE(ps.tds, 0) > 0
      ORDER BY u.name`,
    [oId, mStr, year]
  );

  const total = rows.reduce((s, r) => s + Number(r.monthly_tds || 0), 0);
  return {
    rows: rows.map(r => ({
      employee_id:    r.employee_id || '',
      employee_name:  r.employee_name,
      pan:            r.pan_number  || '',
      gross_salary:   round2(r.gross_salary),
      monthly_tds:    round2(r.monthly_tds || 0),
      annual_projected: round2(r.tds_annual_projected || 0),
      ytd_tds:        round2(r.tds_ytd || 0),
      regime:         r.regime || 'old',
    })),
    total_tds: round2(total),
  };
}

// ── Form 16 Dataset (annual, per employee) ────────────────────────────────────
async function getForm16Dataset({ organizationId, financialYear }) {
  const oId = Number(organizationId);
  // FY e.g. '2024-25' → April 2024 – March 2025
  const [startY, endYStr] = financialYear.split('-');
  const startYear = Number(startY);
  const endYear   = startYear + 1;

  const { rows } = await pool.query(
    `SELECT
         COALESCE(u.employee_id, u.id::TEXT) AS employee_id,
         u.name          AS employee_name,
         u.pan_number,
         u.department,
         u.position,
         SUM(ps.gross_salary)           AS annual_gross,
         SUM(ps.total_deductions)       AS annual_deductions,
         SUM(ps.tds)                    AS annual_tds,
         SUM(ps.pf_employee)            AS annual_pf,
         SUM(ps.professional_tax)       AS annual_pt,
         SUM(ps.esi_employee)           AS annual_esi,
         SUM(ps.net_salary)             AS annual_net,
         MAX(ps.tds_annual_projected)   AS projected_tax,
         MAX(ps.regime)                 AS regime
       FROM payslips ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.organization_id = $1
        AND ps.status NOT IN ('draft','cancelled')
        AND (
              (ps.year = $2 AND ps.month::int >= 4) OR
              (ps.year = $3 AND ps.month::int <= 3)
            )
      GROUP BY u.id, u.employee_id, u.name, u.pan_number, u.department, u.position
      ORDER BY u.name`,
    [oId, startYear, endYear]
  );

  return rows.map(r => ({
    employee_id:    r.employee_id || '',
    employee_name:  r.employee_name,
    pan:            r.pan_number  || '',
    department:     r.department  || '',
    designation:    r.position    || '',
    financial_year: financialYear,
    annual_gross:   round2(r.annual_gross),
    annual_pf:      round2(r.annual_pf),
    annual_esi:     round2(r.annual_esi),
    annual_pt:      round2(r.annual_pt),
    annual_tds:     round2(r.annual_tds),
    annual_deductions: round2(r.annual_deductions),
    annual_net:     round2(r.annual_net),
    projected_tax:  round2(r.projected_tax),
    regime:         r.regime || 'old',
  }));
}

// ── Compliance Summary (for dashboard) ───────────────────────────────────────
async function getComplianceSummary({ organizationId, month, year }) {
  const oId  = Number(organizationId);
  const mStr = padZ(month);

  const { rows: agg } = await pool.query(
    `SELECT
         COALESCE(SUM(ps.pf_employee + ps.pf_employer), 0) AS total_pf,
         COALESCE(SUM(ps.esi_employee + ps.esi_employer), 0) AS total_esi,
         COALESCE(SUM(ps.professional_tax), 0) AS total_pt,
         COALESCE(SUM(ps.tds), 0)             AS total_tds,
         COALESCE(SUM(ps.lwf_employee + ps.lwf_employer), 0) AS total_lwf,
         COALESCE(SUM(ps.gratuity_accrual), 0) AS total_gratuity,
         COUNT(*) FILTER (WHERE ps.pf_employee > 0) AS pf_count,
         COUNT(*) FILTER (WHERE ps.esi_employee > 0) AS esi_count,
         COUNT(*) FILTER (WHERE ps.professional_tax > 0) AS pt_count,
         COUNT(*) FILTER (WHERE ps.tds > 0) AS tds_count
       FROM payslips ps
      WHERE ps.organization_id = $1
        AND ps.month = $2 AND ps.year = $3
        AND ps.status NOT IN ('draft','cancelled')`,
    [oId, mStr, year]
  );

  const { rows: pendingReturns } = await pool.query(
    `SELECT return_type, due_date, amount
       FROM statutory_compliance_returns
      WHERE organization_id = $1
        AND status IN ('pending','overdue')
      ORDER BY due_date ASC
      LIMIT 10`,
    [oId]
  );

  // Mark overdue
  const now = new Date();
  await pool.query(
    `UPDATE statutory_compliance_returns
        SET status = 'overdue'
      WHERE organization_id = $1
        AND status = 'pending'
        AND due_date < CURRENT_DATE`,
    [oId]
  );

  return {
    liabilities: {
      pf:       round2(agg[0]?.total_pf      || 0),
      esi:      round2(agg[0]?.total_esi     || 0),
      pt:       round2(agg[0]?.total_pt      || 0),
      tds:      round2(agg[0]?.total_tds     || 0),
      lwf:      round2(agg[0]?.total_lwf     || 0),
      gratuity: round2(agg[0]?.total_gratuity|| 0),
    },
    coverage: {
      pf:  Number(agg[0]?.pf_count  || 0),
      esi: Number(agg[0]?.esi_count || 0),
      pt:  Number(agg[0]?.pt_count  || 0),
      tds: Number(agg[0]?.tds_count || 0),
    },
    pendingReturns,
  };
}

module.exports = {
  getPFECR,
  getESIReturn,
  getPTChallan,
  getTDSChallan,
  getForm16Dataset,
  getComplianceSummary,
  toCsv,
  PF_ECR_FIELDS,
  ESI_FIELDS,
};
