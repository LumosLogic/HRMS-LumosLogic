'use strict';

const { pool } = require('../config/db');

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// Attempt to insert into notifications table.
// Falls back silently if the column set differs — notifications are advisory.
// NB: the table's flag column is `is_read` (default false); this used to insert into a non-existent `read` column, so every payroll
// notification failed silently and was never delivered (found by the real-database run, 2026-10-08).
async function insertNotification({ userId, orgId, title, message, type = 'payroll', referenceId = null }) {
  try {
    await pool.query(
      `INSERT INTO notifications
         (user_id, organization_id, title, message, type, reference_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, orgId, title, message, type, referenceId]
    );
  } catch (err) {
    if (err.message?.includes('reference_id') || err.message?.includes('column')) {
      // Schema may not have reference_id — insert without it
      await pool.query(
        `INSERT INTO notifications (user_id, organization_id, title, message, type)
         VALUES ($1,$2,$3,$4,$5)`,
        [userId, orgId, title, message, type]
      ).catch(() => {});
    }
    // Any other error: swallow — notifications are non-critical
  }
}

// Notify all HR admins in the org
async function notifyAdmins(orgId, title, message) {
  const { rows } = await pool.query(
    `SELECT id FROM users
      WHERE organization_id = $1
        AND role IN ('admin', 'root_admin')
        AND (status IS NULL OR status != 'inactive')`,
    [orgId]
  );
  await Promise.all(
    rows.map(r => insertNotification({ userId: r.id, orgId, title, message }))
  );
}

// Notify each employee whose payslip was successfully generated
async function notifyEmployeesPayslipsReady(orgId, runId, month, year) {
  const monthLabel = MONTHS[month - 1] || String(month);

  const { rows } = await pool.query(
    `SELECT pre.user_id, ps.net_salary, ps.id AS payslip_id
       FROM payroll_run_employees pre
       JOIN payslips ps ON ps.id = pre.payslip_id
      WHERE pre.payroll_run_id  = $1
        AND pre.organization_id = $2
        AND pre.status          = 'success'`,
    [runId, orgId]
  );

  await Promise.all(
    rows.map(r => {
      const net = Number(r.net_salary || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
      return insertNotification({
        userId:      r.user_id,
        orgId,
        title:       `Payslip Available — ${monthLabel} ${year}`,
        message:     `Your payslip for ${monthLabel} ${year} is ready. Net pay: ₹${net}.`,
        referenceId: r.payslip_id,
      });
    })
  );
}

// Called after a payroll run completes (success or partial)
async function notifyPayrollComplete(orgId, runId, result, month, year) {
  const monthLabel = MONTHS[month - 1] || String(month);
  const hasErrors  = result.errorCount > 0;
  const net        = Number(result.totalNet || 0).toLocaleString('en-IN');

  const title   = hasErrors
    ? `Payroll Completed with Errors — ${monthLabel} ${year}`
    : `Payroll Completed — ${monthLabel} ${year}`;
  const message = hasErrors
    ? `${result.successCount} payslip(s) generated, ${result.errorCount} failed. Total net: ₹${net}.`
    : `${result.successCount} payslip(s) generated. Total net: ₹${net}.`;

  await notifyAdmins(orgId, title, message);
  // Employees are NOT told here: a freshly generated run is still unverified (Bug-104). They are notified when the
  // run is approved and the payslips are published (notifyEmployeesPayslipsReady, called from the approve route).
}

// Called when payroll generation fails entirely
async function notifyPayrollFailed(orgId, errMsg, month, year) {
  const monthLabel = MONTHS[month - 1] || String(month);
  await notifyAdmins(
    orgId,
    `Payroll Generation Failed — ${monthLabel} ${year}`,
    `Automated payroll for ${monthLabel} ${year} failed: ${(errMsg || 'Unknown error').substring(0, 200)}`
  );
}

module.exports = {
  notifyPayrollComplete,
  notifyPayrollFailed,
  notifyEmployeesPayslipsReady,
};
