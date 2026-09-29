/**
 * permissions.js — RBAC middleware factory
 *
 * Usage:
 *   const { hasPermission } = require('../../middleware/permissions');
 *
 *   router.get('/', auth, hasPermission('leaves', 'view'), handler);
 *   router.post('/', auth, hasPermission('leaves', 'create'), handler);
 *
 * Phase 1: All existing adminOnly() calls remain unchanged.
 *           This middleware is only used on new RBAC-managed routes.
 *
 * Phase 4: Will replace adminOnly() across all existing routes.
 */

const { resolvePermissions, hasPermissionCheck } = require('../services/permissionService');

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
      if (hasOne) return next();

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

module.exports = { hasPermission, hasAnyPermission };
