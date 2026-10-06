'use strict';
/**
 * employeeLifecycle.js — the ONE place that knows what an employee status means.
 *
 * Source of truth: users.employee_status (+ exit_requests for the exit record / last working day).
 * Every writer of employee_status (Employees form, Profile V2, Exit approval, cron, bulk actions) goes
 * through the helpers here so that the legacy users.status column, the in-memory session block, the
 * exit record and the offboarding checklist can never disagree with employee_status again.
 *
 * Also holds the other "employee master" helpers that used to be implemented 2–3 times:
 *   - probation date arithmetic            (computeProbationDates)
 *   - department assignment + its two denormalised copies (syncUserDepartments)
 *   - biometric PIN <-> user mapping       (syncBiometricPin)
 *   - employment window used by payroll    (payrollEligibilitySql)
 */

const { pool } = require('../config/db');
const { blockUser, unblockUser } = require('../middleware/auth');

const {
  EXCLUDED_STATUSES, ACCESS_BLOCKED_STATUSES, ACTIVE_LIKE_STATUSES, DEFAULT_NOTICE_DAYS,
  isExcluded, isAccessBlocked, legacyStatusFor, notExcludedSql, payrollEligibilitySql, computeProbationDates,
} = require('../utils/employeeStatus');

const ymd = (d) => new Date(d).toISOString().split('T')[0];
const addDays = (dateStr, n) => { const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().split('T')[0]; };

// ─── Department assignment ───────────────────────────────────────────────────────────────────
/**
 * Replace a user's department assignments. `user_departments` is the source of truth; users.department (text)
 * and users.department_id (legacy FK read by the legacy approval list / exit notification) are kept in step
 * with the PRIMARY (first) department. Must be called with the caller's transaction client when there is one.
 */
async function syncUserDepartments({ client = pool, orgId, userId, departmentIds }) {
  const ids = [...new Set((departmentIds || []).map(n => parseInt(n, 10)).filter(Number.isInteger))];
  await client.query('DELETE FROM user_departments WHERE user_id = $1 AND organization_id = $2', [userId, orgId]);
  for (const dId of ids) {
    await client.query(
      `INSERT INTO user_departments (user_id, department_id, role_in_dept, organization_id)
       VALUES ($1,$2,'Member',$3) ON CONFLICT (user_id, department_id) DO NOTHING`, [userId, dId, orgId]);
  }
  let name = null;
  if (ids.length) {
    const r = await client.query('SELECT name FROM departments WHERE id = $1 AND organization_id = $2', [ids[0], orgId]);
    name = r.rows[0]?.name || null;
  }
  await client.query(
    'UPDATE users SET department = $3, department_id = $4 WHERE id = $1 AND organization_id = $2',
    [userId, orgId, name, name ? ids[0] : null]);
  return { primaryId: name ? ids[0] : null, primaryName: name };
}

// ─── Biometric PIN ───────────────────────────────────────────────────────────────────────────
/** Keep biometric_employee_map consistent with users.device_enrollment_id. Never throws. */
async function syncBiometricPin({ orgId, userId, pin }) {
  const clean = pin ? String(pin).trim() : null;
  try {
    if (clean) {
      await pool.query(
        `INSERT INTO biometric_employee_map (org_id, employee_pin, user_id) VALUES ($1,$2,$3)
         ON CONFLICT (org_id, employee_pin) DO UPDATE SET user_id = EXCLUDED.user_id`, [orgId, clean, userId]);
      await pool.query('DELETE FROM biometric_employee_map WHERE org_id = $1 AND user_id = $2 AND employee_pin != $3', [orgId, userId, clean]);
    } else {
      await pool.query('DELETE FROM biometric_employee_map WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
    }
  } catch (e) { console.error('[employeeLifecycle] biometric_employee_map sync error:', e.message); }
}

// ─── Salary source of truth ──────────────────────────────────────────────────────────────────
/** True when the employee has an ACTIVE employee_salary_structures row (payroll's source of truth). */
async function hasActiveSalaryStructure(userId, orgId) {
  try {
    const r = await pool.query('SELECT 1 FROM employee_salary_structures WHERE user_id = $1 AND organization_id = $2 AND effective_to IS NULL LIMIT 1', [userId, orgId]);
    return r.rows.length > 0;
  } catch { return false; }
}

// ─── Exit record linkage ─────────────────────────────────────────────────────────────────────
/** Latest approved/completed exit (the employment end) for a user, or null. */
async function getEmploymentEnd(userId, orgId, db = pool) {
  const { rows } = await db.query(
    `SELECT id, status, last_working_day, exit_type FROM exit_requests
      WHERE user_id = $1 AND organization_id = $2 AND status IN ('approved','completed')
      ORDER BY created_at DESC LIMIT 1`, [userId, orgId]).catch(async () => (
    await db.query(
      `SELECT id, status, last_working_day, NULL::text AS exit_type FROM exit_requests
        WHERE user_id = $1 AND organization_id = $2 AND status IN ('approved','completed')
        ORDER BY created_at DESC LIMIT 1`, [userId, orgId])));
  return rows[0] || null;
}

async function notify(userIds, orgId, title, message) {
  if (!userIds.length) return;
  const vals = []; const ph = userIds.map((id, i) => { vals.push(id, title, message, 'exit', orgId); const b = i * 5; return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`; });
  await pool.query(`INSERT INTO notifications (user_id, title, message, type, organization_id) VALUES ${ph.join(',')}`, vals).catch(() => {});
}

/**
 * Resigned/Terminated must always have an approved exit record (so there is a last working day, a checklist and an
 * audit trail), no matter which screen set the status. A pending request is approved; an approved one is left alone.
 */
async function ensureExitRecord({ orgId, userId, status, actorId, reason }) {
  const type = status === 'terminated' ? 'termination' : 'resignation';
  const { rows: open } = await pool.query(
    `SELECT id, status FROM exit_requests WHERE user_id = $1 AND organization_id = $2 AND status IN ('pending','approved')
      ORDER BY created_at DESC LIMIT 1`, [userId, orgId]);
  const today = ymd(new Date());
  let created = false;
  if (open[0]?.status === 'approved') return { created, id: open[0].id };
  if (open[0]?.status === 'pending') {
    await pool.query(`UPDATE exit_requests SET status = 'approved', reviewed_by = $3, reviewed_at = NOW() WHERE id = $1 AND organization_id = $2`,
      [open[0].id, orgId, actorId]);
    try { await pool.query(`UPDATE exit_requests SET exit_type = $3 WHERE id = $1 AND organization_id = $2`, [open[0].id, orgId, type]); } catch { /* column not migrated */ }
  } else {
    const notice = type === 'termination' ? 0 : DEFAULT_NOTICE_DAYS;
    const base = [userId, orgId, today, reason || `Status set to ${status}`, notice, addDays(today, notice), actorId];
    try {
      const r = await pool.query(
        `INSERT INTO exit_requests (user_id, organization_id, resignation_date, reason, notice_period_days, last_working_day, status, reviewed_by, reviewed_at, exit_type)
         VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,NOW(),$8) RETURNING id`, [...base, type]);
      open.push(r.rows[0]);
    } catch {
      const r = await pool.query(
        `INSERT INTO exit_requests (user_id, organization_id, resignation_date, reason, notice_period_days, last_working_day, status, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,'approved',$7,NOW()) RETURNING id`, base);
      open.push(r.rows[0]);
    }
    created = true;
  }
  try { await require('../modules/offboarding/offboardingService').initOffboarding(userId, orgId); } catch (e) { console.error('[employeeLifecycle] initOffboarding:', e.message); }
  try {
    const { getAdminsForEmployee } = require('../utils/branchFilter');
    const admins = (await getAdminsForEmployee(userId, orgId)).filter(id => String(id) !== String(actorId));
    const { rows: u } = await pool.query('SELECT name FROM users WHERE id = $1', [userId]);
    await notify(admins, orgId, type === 'termination' ? 'Employee Terminated — Action Required' : 'Exit Initiated — Action Required',
      `${u[0]?.name || 'An employee'} is now ${status}. Please complete the offboarding checklist (IT access, asset return, final settlement).`);
  } catch { /* notification only */ }
  return { created, id: open[0]?.id };
}

/** Reactivation: an approved exit that is still open must not block a future resignation. */
async function closeApprovedExits({ orgId, userId }) {
  await pool.query(
    `UPDATE exit_requests SET status = 'completed',
            notes = COALESCE(NULLIF(notes,''), '') || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END || 'Closed: employee reactivated'
      WHERE user_id = $1 AND organization_id = $2 AND status = 'approved'`, [userId, orgId]).catch(async () => {
    await pool.query(`UPDATE exit_requests SET status = 'completed' WHERE user_id = $1 AND organization_id = $2 AND status = 'approved'`, [userId, orgId]);
  });
}

/**
 * Run AFTER users.employee_status has been written. `prev` is the status before the write.
 * No-op when nothing changed (a form re-save that still says "active" must not close a pending resignation).
 */
async function afterStatusChange({ orgId, userId, prev, next, actorId = null, reason = null }) {
  if (!next || prev === next) return { changed: false };
  if (isAccessBlocked(next)) blockUser(userId); else unblockUser(userId);
  if (next === 'resigned' || next === 'terminated') await ensureExitRecord({ orgId, userId, status: next, actorId, reason });
  else if (ACTIVE_LIKE_STATUSES.includes(next) && (prev === 'resigned' || prev === 'terminated' || prev === 'inactive')) await closeApprovedExits({ orgId, userId });
  return { changed: true };
}

/**
 * Convenience for writers that only change the status (Profile V2, bulk, cron): writes employee_status AND the
 * legacy status together, then runs the side-effects.
 */
async function setEmployeeStatus({ orgId, userId, status, actorId = null, reason = null, extra = {} }) {
  const { rows } = await pool.query('SELECT employee_status FROM users WHERE id = $1 AND organization_id = $2', [userId, orgId]);
  if (!rows.length) return null;
  const prev = rows[0].employee_status || 'active';
  const sets = { employee_status: status, status: legacyStatusFor(status), ...extra };
  const keys = Object.keys(sets);
  await pool.query(`UPDATE users SET ${keys.map((k, i) => `"${k}" = $${i + 3}`).join(', ')} WHERE id = $1 AND organization_id = $2`,
    [userId, orgId, ...keys.map(k => sets[k])]);
  await afterStatusChange({ orgId, userId, prev, next: status, actorId, reason });
  return { prev, next: status };
}

module.exports = {
  EXCLUDED_STATUSES, ACCESS_BLOCKED_STATUSES, ACTIVE_LIKE_STATUSES, DEFAULT_NOTICE_DAYS,
  isExcluded, isAccessBlocked, legacyStatusFor, notExcludedSql,
  computeProbationDates, syncUserDepartments, syncBiometricPin, hasActiveSalaryStructure,
  getEmploymentEnd, ensureExitRecord, closeApprovedExits, afterStatusChange, setEmployeeStatus,
  payrollEligibilitySql,
};
