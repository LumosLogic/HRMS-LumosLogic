/**
 * effectiveAccess.js — lets CUSTOM-role permissions satisfy the legacy role checks, per request.
 *
 * An `employee` account holding a custom role is elevated to role 'admin' for the duration of one request,
 * ONLY when a permission granted by that custom role covers the route being called:
 *   • hasPermission()/hasAnyPermission()/hasPermissionOrLegacyAdmin() → elevateForPermissions()
 *       (admin-grade permissions only — self-service grants such as documents.upload never elevate)
 *   • everything else (adminOnly routes, handler-level isAdminRole checks) → applyAccessMap(), driven by
 *       the explicit route table in accessMap.js. Unlisted routes are never elevated.
 *
 * What does NOT change: the stored role, the JWT, root_admin/admin/system-role behaviour, and branch scope.
 * `req.user.baseRole` keeps the real role, and services/branchService.js resolves branch access from the
 * real DB role, so an elevated user stays bound to their own branch.
 */
const { resolveCustomPermissions, hasPermissionCheck } = require('../services/permissionService');
const { requiredPermissions } = require('./accessMap');

// Grants every Employee-system-role user already holds. They describe self-service, so holding one through a
// custom role must not by itself turn the user into an "admin" on a hasPermission()-guarded route.
const SELF_SERVICE = new Set([
  'dashboard.view', 'attendance.view', 'leaves.view', 'leaves.create', 'documents.view', 'documents.upload',
  'announcements.view', 'holidays.view', 'expenses.view', 'expenses.create', 'performance.view', 'performance.create',
  'onboarding.view', 'onboarding.complete_task', 'notifications.view', 'regularization.view', 'regularization.create',
  'payroll.view_own',
]);

function elevate(req) {
  if (req.user.elevated) return;
  req.user = { ...req.user, role: 'admin', baseRole: req.user.role, elevated: true };
}

/** True when `req.user` is a plain employee account (the only kind a custom role can elevate). */
function canBeElevated(req) {
  return !!req.user && req.user.role === 'employee' && !req.user.elevated;
}

/**
 * Elevate when a CUSTOM role grants any of [module, action] pairs. Used by the permission middlewares.
 * @returns {Promise<boolean>} whether the request is now elevated
 */
async function elevateForPermissions(req, pairs) {
  if (req.user?.elevated) return true;
  if (!canBeElevated(req)) return false;
  const adminGrade = pairs.filter(([m, a]) => !SELF_SERVICE.has(`${m}.${a}`));
  if (!adminGrade.length) return false;
  try {
    const custom = await resolveCustomPermissions(req.user.id, req.user.organization_id);
    if (!custom.length) return false;
    if (adminGrade.some(([m, a]) => hasPermissionCheck(custom, m, a))) { elevate(req); return true; }
  } catch (e) { console.error('[effectiveAccess] elevation skipped:', e.message); } // never deny a request that passed its permission gate
  return false;
}

/** Elevate when the request matches an accessMap entry whose permission a CUSTOM role grants. */
async function applyAccessMap(req) {
  if (!canBeElevated(req)) return false;
  const perms = requiredPermissions(req.method, req.originalUrl || req.url);
  if (!perms) return false;
  try {
    const custom = await resolveCustomPermissions(req.user.id, req.user.organization_id);
    if (!custom.length) return false;
    const ok = perms.some(p => { const [m, a] = p.split('.'); return hasPermissionCheck(custom, m, a); });
    if (ok) elevate(req);
    return ok;
  } catch (e) { console.error('[effectiveAccess] access map skipped:', e.message); return false; }
}

/**
 * For responses that bundle several modules (dashboard, analytics): returns can(module, action).
 * An elevated custom-role request may only receive the sections its CUSTOM role covers; every other
 * caller (Root, HR Admin, system roles) gets `true` — their responses are never trimmed.
 */
async function sectionGuard(req) {
  if (!req.user?.elevated) return () => true;
  let custom = [];
  try { custom = await resolveCustomPermissions(req.user.id, req.user.organization_id); } catch { /* none → nothing extra */ }
  return (m, a = 'view') => hasPermissionCheck(custom, m, a);
}

module.exports = { elevateForPermissions, applyAccessMap, sectionGuard, SELF_SERVICE };
