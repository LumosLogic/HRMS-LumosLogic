'use strict';
/**
 * employeeStatus.js — dependency-free definitions of what an employee status means.
 * (Side-effects live in services/employeeLifecycle.js; this file is safe to require from anywhere, incl. the
 * payroll engine and unit tests, because it imports nothing.)
 */

// "Not part of the working headcount": lists, KPIs, absent cron, e-mail automations, payroll (unless still employed).
const EXCLUDED_STATUSES = ['inactive', 'resigned', 'terminated'];
// Lock the account immediately. 'resigned' keeps access until the last working day.
const ACCESS_BLOCKED_STATUSES = ['inactive', 'terminated'];
const ACTIVE_LIKE_STATUSES = ['active', 'probation', 'on_leave'];
const DEFAULT_NOTICE_DAYS = 30;

const isExcluded = (s) => EXCLUDED_STATUSES.includes(s);
const isAccessBlocked = (s) => ACCESS_BLOCKED_STATUSES.includes(s);

/** users.status (legacy active/inactive flag read by login) as a pure function of employee_status. */
function legacyStatusFor(employeeStatus) {
  return isAccessBlocked(employeeStatus) ? 'inactive' : 'active';
}

/** SQL fragment: employee belongs to the working headcount. */
function notExcludedSql(alias = 'u') {
  const c = alias ? `${alias}.employee_status` : 'employee_status';
  return `(${c} IS NULL OR ${c} NOT IN ('inactive','resigned','terminated'))`;
}

/**
 * SQL predicate deciding whether an employee is payable for a pay month: still in the working headcount, OR left
 * during/after this month (approved/completed exit whose last working day >= first day of the month) — so the
 * final month of a resigned/terminated employee is produced by the normal run instead of being silently dropped.
 * `periodStartParam` is a TEXT parameter placeholder ('$5') holding 'YYYY-MM-01'.
 */
function payrollEligibilitySql(periodStartParam, alias = 'u') {
  return `(${notExcludedSql(alias)}
           OR EXISTS (SELECT 1 FROM exit_requests xr
                       WHERE xr.user_id = ${alias}.id AND xr.organization_id = ${alias}.organization_id
                         AND xr.status IN ('approved','completed')
                         AND xr.last_working_day >= ${periodStartParam}))`;
}

/** { start, end } for joining date + N months, or null when either is missing/invalid. */
function computeProbationDates(joiningDate, months) {
  const m = parseInt(months, 10);
  if (!joiningDate || !Number.isFinite(m) || m <= 0) return null;
  const start = String(joiningDate).slice(0, 10);
  const end = new Date(start + 'T12:00:00Z');
  if (isNaN(end.getTime())) return null;
  end.setMonth(end.getMonth() + m);
  return { start, end: end.toISOString().split('T')[0] };
}

module.exports = {
  EXCLUDED_STATUSES, ACCESS_BLOCKED_STATUSES, ACTIVE_LIKE_STATUSES, DEFAULT_NOTICE_DAYS,
  isExcluded, isAccessBlocked, legacyStatusFor, notExcludedSql, payrollEligibilitySql, computeProbationDates,
};
