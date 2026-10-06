/**
 * permissions.js — RBAC middleware factory
 *
 * Usage:
 *   const { hasPermission } = require('../../middleware/permissions');
 *
 *   router.get('/', auth, hasPermission('leaves', 'view'), handler);
 *   router.post('/', auth, hasPermission('leaves', 'create'), handler);
 *
 * Phase 4: a permission granted by a CUSTOM role also satisfies the handler-level admin checks on the
 *          route it guards (see middleware/effectiveAccess.js); adminOnly()/isAdminRole routes are covered
 *          by the explicit table in middleware/accessMap.js.
 */

const { resolvePermissions, hasPermissionCheck } = require('../services/permissionService');
const { elevateForPermissions } = require('./effectiveAccess');

/**
 * Returns an Express middleware that checks if the authenticated user
 * has the specified permission within their organization.
 *
 * Requires auth() middleware to run first (sets req.user).
 *
 * @param {string} module  — e.g. 'leaves', 'payroll', 'roles'
 * @param {string} action  — e.g. 'view', 'create', 'approve', 'manage'
 */
function hasPermission(module, action) {
  return async function permissionGate(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Root admin always has all permissions — no DB lookup needed.
    if (req.user.role === 'root_admin') return next();

    try {
      const permissions = await resolvePermissions(
        req.user.id,
        req.user.organization_id
      );

      if (hasPermissionCheck(permissions, module, action)) {
        await elevateForPermissions(req, [[module, action]]); // custom-role holders pass handler-level admin checks
        return next();
      }

      return res.status(403).json({
        error: 'You don\'t have permission to perform this action',
        required_permission: `${module}.${action}`,
      });
    } catch (err) {
      console.error('[permissions] hasPermission error:', err.message);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/**
 * Checks multiple permissions (OR logic — passes if user has ANY of the given permissions).
 * Useful for routes accessible by multiple roles.
 *
 * Usage:
 *   router.get('/', auth, hasAnyPermission(['leaves.approve', 'leaves.forward']), handler);
 */
function hasAnyPermission(permissionList) {
  return async function permissionGateAny(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.user.role === 'root_admin') return next();

    try {
      const permissions = await resolvePermissions(
        req.user.id,
        req.user.organization_id
      );

      const hasOne = permissionList.some(p => permissions.includes(p));
      if (hasOne) {
        await elevateForPermissions(req, permissionList.map(p => p.split('.')));
        return next();
      }

      return res.status(403).json({
        error: 'You don\'t have permission to perform this action',
        required_permissions: permissionList,
      });
    } catch (err) {
      console.error('[permissions] hasAnyPermission error:', err.message);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

// ─── Permission with legacy-admin compatibility ──────────────────────────────
// Some modules (biometric) historically gated on adminOnly, and the seeded hr_admin role
// does not hold every action those routes need. Switching straight to hasPermission() would
// lock HR admins out until a grant migration runs. This wrapper enforces the permission, but
// while the org's hr_admin role has NOT been provisioned with it (migration not applied) an
// HR admin keeps their previous access. Custom-role users and employees are never widened.
const _provisioned = new Map(); // `${orgId}:${module}.${action}` → { value, exp }
async function hrRoleHasPermission(orgId, module, action) {
  const key = `${orgId}:${module}.${action}`;
  const hit = _provisioned.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  let value = false;
  try {
    const { pool } = require('../config/db');
    const { rows } = await pool.query(
      `SELECT 1
         FROM roles r
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE r.org_id = $1 AND r.slug = 'hr_admin' AND r.is_system_role = true
          AND p.module_key = $2 AND p.action = $3
        LIMIT 1`, [orgId, module, action]);
    value = rows.length > 0;
  } catch { value = false; }
  _provisioned.set(key, { value, exp: Date.now() + 60 * 1000 });
  return value;
}

function hasPermissionOrLegacyAdmin(module, action) {
  return async function gate(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'root_admin') return next();
    try {
      const permissions = await resolvePermissions(req.user.id, req.user.organization_id);
      if (hasPermissionCheck(permissions, module, action)) {
        await elevateForPermissions(req, [[module, action]]);
        return next();
      }
      if (req.user.role === 'admin' && !(await hrRoleHasPermission(req.user.organization_id, module, action))) {
        return next(); // legacy behaviour until the hr_admin grant is provisioned
      }
      return res.status(403).json({
        error: "You don't have permission to perform this action",
        required_permission: `${module}.${action}`,
      });
    } catch (err) {
      console.error('[permissions] hasPermissionOrLegacyAdmin error:', err.message);
      return res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

module.exports = { hasPermission, hasAnyPermission, hasPermissionOrLegacyAdmin };
