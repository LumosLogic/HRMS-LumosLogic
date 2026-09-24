/**
 * permissionService.js
 *
 * Resolves RBAC permissions for a user within an org.
 * Phase 1: DB lookup with in-memory TTL cache.
 * Phase 4: Will be replaced with JWT-embedded permissions.
 *
 * DOES NOT modify auth.js or any existing middleware.
 * Existing adminOnly() checks remain untouched.
 */

const { pool } = require('../config/db');

// ─── In-memory cache ─────────────────────────────────────────────────────────
// key: `${userId}:${orgId}`   value: { permissions: string[], expiresAt: number }
const _cache    = new Map();
const CACHE_TTL_MS  = 60 * 1000;       // 60 seconds — reduced from 5 min for faster revocation
const CACHE_MAX     = 5000;            // evict oldest when over this size
const CLEANUP_EVERY = 10 * 60 * 1000; // periodic full sweep every 10 minutes

function _cacheKey(userId, orgId) {
  return `${userId}:${orgId}`;
}

function _getCached(userId, orgId) {
  const entry = _cache.get(_cacheKey(userId, orgId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(_cacheKey(userId, orgId));
    return null;
  }
  return entry.permissions;
}

function _setCache(userId, orgId, permissions) {
  // Evict oldest entry when cache is full (prevents unbounded growth)
  if (_cache.size >= CACHE_MAX) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(_cacheKey(userId, orgId), {
    permissions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// Periodic cleanup: sweep entire cache and remove expired entries.
// Prevents memory accumulation from entries that were never re-accessed.
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _cache.entries()) {
    if (now > entry.expiresAt) _cache.delete(key);
  }
}, CLEANUP_EVERY);
// Allow the process to exit normally even if this timer is active
if (_cleanupTimer.unref) _cleanupTimer.unref();

// ─── Core: Resolve permissions ────────────────────────────────────────────────

/**
 * Resolves all permissions for a user within an org.
 * Returns array of "module.action" strings, e.g. ['leaves.view', 'payroll.generate'].
 * Cached for 5 minutes. Call clearCache() after role changes.
 */
async function resolvePermissions(userId, orgId) {
  if (!userId || !orgId) return [];

  const cached = _getCached(userId, orgId);
  if (cached) return cached;

  try {
    // BUG_144 fix: union permissions from two sources:
    //   1. Explicitly assigned roles (user_roles entries — both custom & system roles)
    //   2. The user's system role derived from users.role column (admin→hr_admin,
    //      employee→employee, root_admin→root_admin) mapped to the seeded system
    //      role record for this org.  This ensures HR/employee users always get
    //      their baseline permissions even when no explicit user_roles row exists.
    const result = await pool.query(
      `SELECT DISTINCT p.module_key || '.' || p.action AS permission
       FROM user_roles ur
       JOIN role_permissions rp ON rp.role_id = ur.role_id
       JOIN permissions p       ON p.id = rp.permission_id
       WHERE ur.user_id = $1
         AND ur.org_id  = $2

       UNION

       -- BUG_161 fix: system-role baseline only applies when the user has NO explicit
       -- user_roles assignment. If a custom role is assigned, its permission set is
       -- authoritative — the system role fallback must not silently re-grant revoked ones.
       SELECT DISTINCT p.module_key || '.' || p.action AS permission
       FROM users u
       JOIN roles r ON r.org_id = $2
                   AND r.is_system_role = true
                   AND r.slug = CASE u.role
                                  WHEN 'root_admin' THEN 'root_admin'
                                  WHEN 'admin'      THEN 'hr_admin'
                                  WHEN 'employee'   THEN 'employee'
                                  ELSE NULL
                                END
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p       ON p.id = rp.permission_id
       WHERE u.id = $1
         AND u.organization_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM user_roles ur2
           WHERE ur2.user_id = $1 AND ur2.org_id = $2
         )

       UNION

       -- Department Head system role permissions for users set as head_user_id
       -- in any department — always applied regardless of user_roles assignment.
       SELECT DISTINCT p.module_key || '.' || p.action AS permission
       FROM departments d
       JOIN roles r  ON r.org_id        = d.organization_id
                    AND r.is_system_role = true
                    AND r.slug           = 'dept_head'
       JOIN role_permissions rp ON rp.role_id = r.id
       JOIN permissions p       ON p.id       = rp.permission_id
       WHERE d.head_user_id    = $1
         AND d.organization_id = $2`,
      [userId, orgId]
    );

    const permissions = result.rows.map(r => r.permission);
    _setCache(userId, orgId, permissions);
    return permissions;
  } catch (err) {
    // If RBAC tables don't exist yet (pre-migration), return empty
    if (err.message && err.message.includes('does not exist')) return [];
    console.error('[permissionService] resolvePermissions error:', err.message);
    return [];
  }
}

// ─── Pure permission check ─────────────────────────────────────────────────────

/**
 * Checks if a permission array includes module.action.
 * Pure function — no DB, no cache.
 *
 * Inference rules (BUG_172):
 *   • Any non-view action on module X implies X.view
 *   • `manage` implies create, edit and delete for the same module
 */
function hasPermissionCheck(permissions, module, action) {
  if (!Array.isArray(permissions)) return false;

  // 1. Direct match
  if (permissions.includes(`${module}.${action}`)) return true;

  // 2. Any permission on the module implies 'view'
  if (action === 'view') {
    return permissions.some(p => p.startsWith(`${module}.`));
  }

  // 3. 'manage' implies create / edit / delete
  if (['create', 'edit', 'delete'].includes(action)) {
    return permissions.includes(`${module}.manage`);
  }

  return false;
}

// ─── Cache invalidation ────────────────────────────────────────────────────────

/**
 * Clear cached permissions for a specific user+org pair.
 * Call this after assigning or removing roles from a user.
 */
function clearUserCache(userId, orgId) {
  _cache.delete(_cacheKey(userId, orgId));
}

/**
 * Clear ALL cached permissions for an org.
 * Call this after modifying a role's permissions.
 */
function clearOrgCache(orgId) {
  for (const key of _cache.keys()) {
    if (key.endsWith(`:${orgId}`)) _cache.delete(key);
  }
}

// ─── System role seeding for new orgs ─────────────────────────────────────────

/**
 * Seeds system roles and permission mappings for a brand-new organization.
 * Called from platform.routes.js after org approval creates the org + root user.
 *
 * @param {number} orgId       — The new organization's id
 * @param {number} rootUserId  — The root_admin user's id created for this org
 * @param {object} client      — Optional pg transaction client. If null, uses pool.
 */
async function seedSystemRolesForOrg(orgId, rootUserId, client) {
  const db = client || pool;

  // Insert the 4 system roles
  const rolesRes = await db.query(
    `INSERT INTO roles (org_id, name, slug, description, is_system_role)
     VALUES
       ($1, 'Root Admin',       'root_admin', 'Full system access.',              true),
       ($1, 'HR Admin',         'hr_admin',   'HR management access.',            true),
       ($1, 'Department Head',  'dept_head',  'Department-level team access.',     true),
       ($1, 'Employee',         'employee',   'Standard employee self-service.',   true)
     ON CONFLICT (org_id, slug) DO NOTHING
     RETURNING id, slug`,
    [orgId]
  );

  // Build slug → id map from what was actually inserted or already existed
  let slugToId = {};
  rolesRes.rows.forEach(r => { slugToId[r.slug] = r.id; });

  // If some already existed (re-run safety), fetch them
  if (Object.keys(slugToId).length < 4) {
    const existing = await db.query(
      `SELECT id, slug FROM roles WHERE org_id = $1 AND is_system_role = true`,
      [orgId]
    );
    existing.rows.forEach(r => { slugToId[r.slug] = r.id; });
  }

  const rootRoleId = slugToId['root_admin'];
  const hrRoleId   = slugToId['hr_admin'];
  const dhRoleId   = slugToId['dept_head'];
  const empRoleId  = slugToId['employee'];

  // Assign ALL permissions to Root Admin
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, id FROM permissions
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [rootRoleId]
  );

  // HR Admin permissions
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, p.id FROM permissions p
     WHERE (p.module_key, p.action) IN (
       ('dashboard','view'),('employees','view'),('employees','create'),('employees','edit'),
       ('employees','delete'),('employees','export'),('departments','view'),('departments','create'),
       ('departments','edit'),('departments','delete'),('designations','view'),('designations','manage'),
       ('attendance','view'),('attendance','edit'),('attendance','export'),('attendance','approve_regularization'),
       ('leaves','view'),('leaves','approve'),('leaves','reject'),('leaves','export'),
       ('payroll','view'),('payroll','generate'),('payroll','export'),('payroll','lock'),
       ('payroll','manage_structures'),('payroll','manage_adjustments'),
       ('reports','view'),('reports','export'),('settings','view'),('settings','manage'),
       ('documents','view'),('documents','upload'),('documents','manage'),('documents','delete'),
       ('onboarding','view'),('onboarding','manage'),('onboarding','complete_task'),
       ('announcements','view'),('announcements','create'),('announcements','manage'),
       ('holidays','view'),('holidays','create'),('holidays','manage'),
       ('shifts','view'),('shifts','create'),('shifts','manage'),
       ('biometric','view'),('branches','view'),
       ('assets','view'),('assets','create'),('assets','manage'),('assets','assign'),
       ('expenses','view'),('expenses','approve'),('expenses','manage'),
       ('performance','view'),('performance','create'),('performance','manage'),
       ('exit','view'),('exit','approve'),('exit','manage'),
       ('roles','view'),('notifications','view'),('notifications','broadcast')
     )
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [hrRoleId]
  );

  // Department Head permissions
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, p.id FROM permissions p
     WHERE (p.module_key, p.action) IN (
       ('dashboard','view'),('employees','view'),('departments','view'),
       ('attendance','view'),('leaves','view'),('leaves','forward'),
       ('documents','view'),('announcements','view'),('holidays','view'),
       ('onboarding','view'),('performance','view'),('expenses','view'),
       ('reports','view'),('notifications','view')
     )
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [dhRoleId]
  );

  // Employee permissions
  await db.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, p.id FROM permissions p
     WHERE (p.module_key, p.action) IN (
       ('dashboard','view'),('attendance','view'),
       ('leaves','view'),('leaves','create'),
       ('documents','view'),('documents','upload'),
       ('announcements','view'),('holidays','view'),
       ('expenses','view'),('expenses','create'),
       ('performance','view'),('performance','create'),
       ('onboarding','view'),('onboarding','complete_task'),
       ('notifications','view')
     )
     ON CONFLICT (role_id, permission_id) DO NOTHING`,
    [empRoleId]
  );

  // Assign root_admin role to the new root user
  if (rootUserId && rootRoleId) {
    await db.query(
      `INSERT INTO user_roles (user_id, role_id, org_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, role_id, org_id) DO NOTHING`,
      [rootUserId, rootRoleId, orgId]
    );
  }
}

module.exports = {
  resolvePermissions,
  hasPermissionCheck,
  clearUserCache,
  clearOrgCache,
  seedSystemRolesForOrg,
};
