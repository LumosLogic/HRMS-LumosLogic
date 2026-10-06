/**
 * accessMap.js — the ONE place that says which permission unlocks which legacy "admin-only" route
 * for a user who holds a CUSTOM role.
 *
 * Why this exists
 *   Many routes decide access with a role check (adminOnly / isAdminRole / role === 'admin') — either as
 *   middleware or inside the handler to pick "all employees" vs "my own". A custom-role user is
 *   users.role = 'employee', so those checks reject them even though their role grants the permission.
 *
 * How it is used (see middleware/effectiveAccess.js)
 *   For an `employee` account, when the request matches an entry below AND one of the entry's permissions
 *   is granted by a CUSTOM role, the request is processed with role 'admin' (request-scoped only; the
 *   user's stored role, token and branch scope never change — branchService still binds them to
 *   their own branch). Anything NOT listed here stays exactly as before (fail closed).
 *
 *   System roles are untouched: HR Admin / Root Admin already pass the role checks, the Employee system
 *   role is never elevated, and Department Head access keeps its department-based mechanism.
 *
 * Entry format:  [METHOD, '/api/path/:param', 'module.action' | ['module.action', ...]]   (any-of)
 *   `:name` params match one path segment ( ids match digits only ).
 *
 * Routes already guarded by hasPermission()/hasAnyPermission()/hasPermissionOrLegacyAdmin() are elevated
 * by those middlewares directly for admin-grade permissions; they are listed here only where the permission
 * is also a self-service grant (e.g. performance.create) or the handler additionally checks the role.
 */

const ENTRIES = [
  // ── Dashboard / analytics ─────────────────────────────────────────────────────────────────────
  ['GET',    '/api/analytics',                         'dashboard.view'],
  ['GET',    '/api/dashboard',                         'dashboard.view'],

  // ── Leaves ────────────────────────────────────────────────────────────────────────────────────
  ['GET',    '/api/leaves',                            'leaves.view'],
  ['GET',    '/api/leaves/counts',                     'leaves.view'],
  ['GET',    '/api/leaves/team',                       'leaves.view'],
  ['GET',    '/api/leaves/balance',                    'leaves.view'],
  ['GET',    '/api/leaves/balance/batch',              'leaves.view'],
  ['GET',    '/api/leaves/balance/adjustments',        'leaves.view'],
  ['GET',    '/api/leaves/:id/comments',               'leaves.view'],
  ['GET',    '/api/leaves/:id/history',                'leaves.view'],
  ['POST',   '/api/leaves/:id/comments',               ['leaves.approve', 'leaves.manage']],
  ['PUT',    '/api/leaves/:id',                        'leaves.manage'],
  ['PUT',    '/api/leaves/:id/approve',                'leaves.approve'],
  ['PUT',    '/api/leaves/:id/reject',                 ['leaves.reject', 'leaves.approve']],
  ['PUT',    '/api/leaves/:id/revert',                 ['leaves.manage', 'leaves.approve']],
  ['DELETE', '/api/leaves/:id',                        'leaves.manage'],

  // ── Attendance & regularization ───────────────────────────────────────────────────────────────
  ['GET',    '/api/attendance',                        'attendance.view'],
  ['GET',    '/api/attendance/late-early',             'attendance.view'],
  ['GET',    '/api/attendance/issues',                 'attendance.view'],
  ['GET',    '/api/attendance/audit-log',              'attendance.view'],
  ['GET',    '/api/regularization',                    'attendance.approve_regularization'],
  ['GET',    '/api/regularization/export',             ['attendance.approve_regularization', 'attendance.export']],
  ['DELETE', '/api/regularization/:id',                'attendance.approve_regularization'],

  // ── Employees & profile sections ──────────────────────────────────────────────────────────────
  ['POST',   '/api/employees/:id/avatar',              'employees.edit'],
  ['POST',   '/api/employees/:id/send-credentials',    'employees.edit'],

  // ── Shifts (assignment listing differs for admins) ────────────────────────────────────────────
  ['GET',    '/api/shifts/assignments',                'shifts.view'],

  // ── Documents ─────────────────────────────────────────────────────────────────────────────────
  ['GET',    '/api/documents',                         'documents.view'],
  ['POST',   '/api/documents/upload',                  'documents.manage'],
  ['PATCH',  '/api/documents/:id',                     'documents.manage'],
  ['POST',   '/api/documents/:id/request-delete',      ['documents.delete', 'documents.manage']],
  ['DELETE', '/api/documents/:id',                     ['documents.delete', 'documents.manage']],
  ['GET',    '/api/doc-requirements',                  'documents.view'],
  ['GET',    '/api/doc-requirements/analytics',        'documents.manage'],
  ['GET',    '/api/doc-requirements/employees',        'documents.manage'],
  ['GET',    '/api/doc-requirements/verification-queue', 'documents.manage'],
  ['POST',   '/api/doc-requirements',                  'documents.manage'],
  ['PATCH',  '/api/doc-requirements/:id',              'documents.manage'],
  ['DELETE', '/api/doc-requirements/:id',              'documents.manage'],
  ['POST',   '/api/doc-requirements/:id/assign',       'documents.manage'],
  ['PATCH',  '/api/doc-requirements/submissions/:id/review', 'documents.manage'],
  ['GET',    '/api/doc-requirements/for-employee/:userId',   'documents.manage'],
  ['POST',   '/api/doc-requirements/:id/submit-for/:userId', 'documents.manage'],

  // ── Expenses ──────────────────────────────────────────────────────────────────────────────────
  ['GET',    '/api/expenses',                          ['expenses.approve', 'expenses.manage']],
  ['PUT',    '/api/expenses/:id/manager-approve',      'expenses.approve'],
  ['PUT',    '/api/expenses/:id',                      'expenses.manage'],
  ['DELETE', '/api/expenses/:id',                      'expenses.manage'],

  // ── Performance ───────────────────────────────────────────────────────────────────────────────
  ['GET',    '/api/performance/goals',                 ['performance.view', 'performance.manage']],
  ['GET',    '/api/performance/reviews',               ['performance.view', 'performance.manage']],
  ['POST',   '/api/performance/goals',                 ['performance.create', 'performance.manage']],
  ['POST',   '/api/performance/goals/bulk',            ['performance.create', 'performance.manage']],
  ['POST',   '/api/performance/reviews',               ['performance.create', 'performance.manage']],
  ['PUT',    '/api/performance/goals/:id',             'performance.manage'],
  ['DELETE', '/api/performance/goals/:id',             'performance.manage'],
  ['PUT',    '/api/performance/reviews/:id',           'performance.manage'],
  ['POST',   '/api/performance/goals/:id/comments',    'performance.manage'],

  // ── Onboarding / exit / offboarding ───────────────────────────────────────────────────────────
  ['GET',    '/api/onboarding',                        ['onboarding.view', 'onboarding.manage']],
  ['GET',    '/api/onboarding/overview',               ['onboarding.view', 'onboarding.manage']],
  ['PUT',    '/api/onboarding/:id/complete',           'onboarding.manage'],
  ['GET',    '/api/exit',                              'exit.view'],
  ['GET',    '/api/exit/:id',                          'exit.view'],
  ['POST',   '/api/exit',                              'exit.manage'],
  ['DELETE', '/api/exit/:id',                          'exit.manage'],
  ['GET',    '/api/offboarding',                       'exit.view'],
  ['PUT',    '/api/offboarding/:id/complete',          'exit.manage'],

  // ── Announcements / assets / calendar / branches ──────────────────────────────────────────────
  ['GET',    '/api/announcements',                     ['announcements.create', 'announcements.manage']],
  ['POST',   '/api/announcements/upload',              ['announcements.create', 'announcements.manage']],
  ['POST',   '/api/announcements',                     ['announcements.create', 'announcements.manage']],
  ['GET',    '/api/announcements/:id/reads',           'announcements.manage'],
  ['GET',    '/api/assets',                            'assets.view'],
  ['POST',   '/api/calendar/events',                   'holidays.manage'],
  ['PUT',    '/api/calendar/events/:id',               'holidays.manage'],
  ['DELETE', '/api/calendar/events/:id',               'holidays.manage'],
  ['DELETE', '/api/branches/:id',                      'branches.manage'],

  // ── Reports ───────────────────────────────────────────────────────────────────────────────────
  ['GET',    '/api/reports/attendance',                'reports.view'],
  ['GET',    '/api/reports/leaves',                    'reports.view'],
  ['GET',    '/api/reports/headcount',                 'reports.view'],
  ['GET',    '/api/reports/employees',                 'reports.view'],
];

// Employee profile sub-resources (/api/profile/:id/...). Sensitive sections need edit even to read.
const PROFILE_SENSITIVE = '(?:banking|statutory|government-docs|nominees|immigration|health)';
const REGEX_ENTRIES = [
  { method: 'GET',  re: new RegExp(`^/api/profile/\\d+/${PROFILE_SENSITIVE}(?:/.*)?$`), perms: ['employees.edit'] },
  { method: 'GET',  re: /^\/api\/profile\/\d+(?:\/.*)?$/,                               perms: ['employees.view'] },
  { method: '*',    re: /^\/api\/profile\/\d+(?:\/.*)?$/,                               perms: ['employees.edit'] },
];

const PARAM_DIGITS = /^(id|userId|runId|branchId|shiftId)$/;

function compile([method, pattern, perms]) {
  const re = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_, n) => (PARAM_DIGITS.test(n) ? '\\d+' : '[^/]+')) + '/?$');
  const literals = pattern.split('/').filter(s => s && !s.startsWith(':')).length;
  return { method, re, perms: Array.isArray(perms) ? perms : [perms], literals, pattern };
}

const COMPILED = ENTRIES.map(compile).sort((a, b) => b.literals - a.literals);

/** Permissions (any-of) that unlock this request for a custom-role holder, or null if unmapped. */
function requiredPermissions(method, url) {
  const path = String(url || '').split('?')[0];
  const m = String(method || '').toUpperCase();
  for (const e of COMPILED) if (e.method === m && e.re.test(path)) return e.perms;
  for (const e of REGEX_ENTRIES) if ((e.method === '*' ? m !== 'GET' && m !== 'HEAD' : e.method === m) && e.re.test(path)) return e.perms;
  return null;
}

module.exports = { ENTRIES, REGEX_ENTRIES, requiredPermissions };
