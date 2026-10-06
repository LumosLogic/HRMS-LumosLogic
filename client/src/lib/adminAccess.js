// Admin-shell access for users who hold a CUSTOM role (users.role = 'employee' + custom-role permissions).
//
// Mirrors backend/src/middleware/accessMap.js: the permissions below are the ones the API needs for the
// page's data, so a page is shown only when the API would actually serve it. The backend stays the source
// of truth — this only decides what the sidebar lists and which URLs the admin shell will open.
//
// HR Admin and Root Admin never use this: their sidebar/route behaviour is unchanged.

// [path prefix, any-of permissions]. An empty list means "never for a custom-role user".
// Longest prefix wins; a path matching no entry (profile, notifications …) is always allowed.
export const ADMIN_PATH_PERMISSIONS = [
  ['/dashboard',        ['dashboard.view']],
  ['/employees',        ['employees.view']],
  ['/departments',      ['departments.view']],
  ['/branches',         ['branches.view']],
  ['/onboarding',       ['onboarding.view', 'onboarding.manage']],
  ['/exit-management',  ['exit.view', 'exit.manage']],
  ['/leaves',           ['leaves.view']],
  ['/calendar',         ['attendance.view']],
  ['/regularization',   ['attendance.approve_regularization']],
  ['/holidays',         ['holidays.view']],
  ['/leave-policies',   ['settings.view']],
  ['/leave-workflow',   ['settings.manage']],
  ['/shifts',           ['shifts.view']],
  ['/documents',        ['documents.view']],
  ['/payroll',          ['payroll.view']],
  ['/statutory',        ['payroll.view', 'statutory.view']],
  ['/assets',           ['assets.view']],
  ['/expenses',         ['expenses.approve', 'expenses.manage']],
  ['/reports',          ['reports.view']],
  ['/performance',      ['performance.view', 'performance.manage']],
  ['/announcements',    ['announcements.create', 'announcements.manage']],
  ['/settings',         ['settings.view']],
  ['/biometric',        ['biometric.view']],
  ['/pending-approvals', []],
  ['/roles',            []],
];

/** Same inference rules as the backend: any action on a module implies view; manage implies create/edit/delete. */
export function permissionMatches(granted, perm) {
  if (granted.includes(perm)) return true;
  const [module, action] = perm.split('.');
  if (action === 'view') return granted.some(p => p.startsWith(`${module}.`));
  if (['create', 'edit', 'delete'].includes(action)) return granted.includes(`${module}.manage`);
  return false;
}

const SORTED = [...ADMIN_PATH_PERMISSIONS].sort((a, b) => b[0].length - a[0].length);

/** May a custom-role user open this admin-shell path? */
export function canAccessAdminPath(customPermissions, pathname) {
  const entry = SORTED.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  if (!entry) return true;
  return entry[1].some(p => permissionMatches(customPermissions || [], p));
}

/** First admin page a custom-role user may open (their landing page), or null when none apply. */
export function firstAdminPath(customPermissions) {
  const order = ['/dashboard', '/employees', '/leaves', '/calendar', '/payroll/dashboard', '/documents', '/reports', '/performance',
    '/expenses', '/assets', '/announcements', '/departments', '/holidays', '/shifts', '/onboarding', '/exit-management',
    '/regularization', '/settings', '/branches', '/biometric/devices', '/statutory/config'];
  return order.find(p => canAccessAdminPath(customPermissions, p) && ADMIN_PATH_PERMISSIONS.some(([x, perms]) => perms.length && (p === x || p.startsWith(x + '/')))) || null;
}
