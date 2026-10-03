/**
 * roles.routes.js
 *
 * IMPORTANT — Route ordering is deliberate:
 *   Static-path routes (/user/:userId) MUST come before parameterised (:id)
 *   routes, otherwise Express matches /user/5 as /:id with id='user'.
 *
 * Order:
 *   1. GET  /                  — list all roles for org
 *   2. GET  /user/:userId      — get roles assigned to a user   ← BEFORE /:id
 *   3. PUT  /user/:userId      — replace roles for a user        ← BEFORE /:id
 *   4. POST /                  — create custom role
 *   5. GET  /:id               — get single role detail
 *   6. PUT  /:id               — rename/edit custom role
 *   7. DELETE /:id             — delete custom role
 *   8. GET  /:id/permissions   — get role's permission set
 *   9. PUT  /:id/permissions   — replace role's permission set
 *  10. GET  /:id/members       — list members of a role
 *  11. POST /:id/members       — add member to a role
 *  12. DELETE /:id/members/:userId — remove member from role
 */

const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { orgId } = require('../../utils/helpers');
const { clearUserCache, clearOrgCache } = require('../../services/permissionService');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState, canAdminAccessUser, resolveWriteBranch } = require('../../utils/branchFilter');
const { resolvePermissions } = require('../../services/permissionService');

// A branch-scoped custom role (roles.branch_id) may only be held by employees of that branch.
async function branchScopedRoleMismatch(pool, roleIds, targetBranchId, oId) {
  const { rows } = await pool.query(
    `SELECT id, branch_id FROM roles
      WHERE id = ANY($1::bigint[]) AND org_id = $2 AND branch_id IS NOT NULL`, [roleIds, oId]);
  return rows.find(r => targetBranchId == null || Number(r.branch_id) !== Number(targetBranchId)) || null;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

function parseId(raw) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function validatePermissionIds(ids) {
  if (!Array.isArray(ids)) return 'permission_ids must be an array';
  for (const id of ids) {
    const n = parseInt(id, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return `Invalid permission_id: "${id}" — must be a positive integer`;
    }
  }
  return null; // valid
}

function validateRoleIds(ids) {
  if (!Array.isArray(ids)) return 'role_ids must be an array';
  for (const id of ids) {
    const n = parseInt(id, 10);
    if (!Number.isFinite(n) || n <= 0) {
      return `Invalid role_id: "${id}" — must be a positive integer`;
    }
  }
  return null; // valid
}

function slugify(name) {
  return 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

// ─── 1. GET /api/roles — list all roles for org ───────────────────────────────
// member_count is branch-aware when a specific branch is selected.
// Role definitions and permissions are always organization-wide.
router.get('/', auth, hasPermission('roles', 'view'), withBranchContext, async (req, res) => {
  try {
    const oId = orgId(req);

    const { data: roles, error } = await db
      .from('roles')
      .select('id, name, slug, description, is_system_role, branch_id, created_at')
      .eq('org_id', oId)
      .order('is_system_role', { ascending: false })
      .order('name');
    if (error) throw error;

    if (!roles?.length) return res.json([]);

    // BUG-117: branch isolation for custom roles. System roles are always visible;
    // custom roles are visible only in the branch they were created for (legacy
    // custom roles with no branch_id remain org-wide so existing permissions stay intact).
    const branchState = getFilterState(req.branchContext);
    let visibleRoles = roles;
    if (branchState.type === 'specific') {
      visibleRoles = roles.filter(r =>
        r.is_system_role || r.branch_id == null || Number(r.branch_id) === Number(branchState.branchId)
      );
      if (!visibleRoles.length) return res.json([]);
    }

    const roleIds = visibleRoles.map(r => r.id);

    // Permission counts per role (single batched query, no N+1) — always org-wide
    const pcRes = await pool.query(
      `SELECT role_id, COUNT(*) AS count
       FROM role_permissions
       WHERE role_id = ANY($1::bigint[])
       GROUP BY role_id`,
      [roleIds]
    );
    const permCounts = {};
    pcRes.rows.forEach(r => { permCounts[r.role_id] = parseInt(r.count, 10); });

    // Member counts per role — branch-aware when a specific branch is selected
    let mcRes;
    if (branchState.type === 'specific') {
      // Count only members whose users.branch_id matches the selected branch
      mcRes = await pool.query(
        `SELECT ur.role_id, COUNT(*) AS count
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id AND u.organization_id = $2
         WHERE ur.role_id = ANY($1::bigint[])
           AND ur.org_id = $2
           AND u.branch_id = $3
         GROUP BY ur.role_id`,
        [roleIds, oId, branchState.branchId]
      );
    } else if (branchState.type === 'multi') {
      mcRes = await pool.query(
        `SELECT ur.role_id, COUNT(*) AS count
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id AND u.organization_id = $2
         WHERE ur.role_id = ANY($1::bigint[])
           AND ur.org_id = $2
           AND u.branch_id = ANY($3::bigint[])
         GROUP BY ur.role_id`,
        [roleIds, oId, branchState.branchIds]
      );
    } else {
      // type=all or type=none (no branch selected / all branches) — org-wide count
      mcRes = await pool.query(
        `SELECT role_id, COUNT(*) AS count
         FROM user_roles
         WHERE role_id = ANY($1::bigint[]) AND org_id = $2
         GROUP BY role_id`,
        [roleIds, oId]
      );
    }
    const memberCounts = {};
    mcRes.rows.forEach(r => { memberCounts[r.role_id] = parseInt(r.count, 10); });

    res.json(visibleRoles.map(r => ({
      ...r,
      permission_count: permCounts[r.id] || 0,
      member_count:     memberCounts[r.id] || 0,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 2. GET /api/roles/user/:userId — get roles assigned to a user ────────────
// MUST be before GET /:id to avoid Express shadowing this route.
router.get('/user/:userId', auth, hasPermission('roles', 'view'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const { data, error } = await db
      .from('user_roles')
      .select('role_id, assigned_at, roles(id, name, slug, is_system_role, description)')
      .eq('user_id', userId)
      .eq('org_id', oId);

    if (error) throw error;

    res.json((data || []).map(r => ({ ...r.roles, assigned_at: r.assigned_at })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 3. PUT /api/roles/user/:userId — replace all roles for a user ────────────
// MUST be before PUT /:id to avoid Express shadowing this route.
router.put('/user/:userId', auth, hasPermission('roles', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId    = orgId(req);
    const userId = parseId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    const { role_ids } = req.body;
    const validationError = validateRoleIds(role_ids);
    if (validationError) return res.status(400).json({ error: validationError });

    // Cast to integers
    const safeRoleIds = role_ids.map(id => parseInt(id, 10));

    // Ensure the target user exists in this org
    const { data: targetUser } = await db
      .from('users')
      .select('id, name, role, branch_id')
      .eq('id', userId)
      .eq('organization_id', oId)
      .maybeSingle();
    if (!targetUser) return res.status(404).json({ error: 'User not found in this organization' });
    // Non-root callers: target must be in their branch scope and must be a plain employee account.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, userId, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      if (targetUser.role !== 'employee')
        return res.status(403).json({ error: 'Only a Root Admin can change roles of admin accounts.' });
    }

    // BUG_243: Ensure all provided roles belong to this org.
    // Use a fetch instead of count-only so it works reliably across all adapter paths.
    if (safeRoleIds.length > 0) {
      const { data: orgRoles, error: orgRolesErr } = await db
        .from('roles')
        .select('id')
        .in('id', safeRoleIds)
        .eq('org_id', oId);

      if (!orgRolesErr && orgRoles !== null && orgRoles.length !== safeRoleIds.length) {
        return res.status(400).json({ error: 'One or more roles do not belong to this organization' });
      }
    }

    // Branch-scoped roles can only go to employees of that branch.
    if (safeRoleIds.length > 0) {
      const bad = await branchScopedRoleMismatch(pool, safeRoleIds, targetUser.branch_id, oId);
      if (bad) return res.status(400).json({ error: "A branch-specific role can only be assigned to employees of that branch." });
    }

    // DEEP-005: Only a Root Admin may assign the root_admin system role.
    // A user holding only roles.manage (e.g. custom role) must not be able to
    // escalate another user — or themselves — to Root Admin.
    if (req.user.role !== 'root_admin' && safeRoleIds.length > 0) {
      const { rows: rootRoleRows } = await pool.query(
        `SELECT 1 FROM roles
          WHERE id = ANY($1::bigint[])
            AND org_id = $2
            AND is_system_role = true
            AND slug = 'root_admin'
          LIMIT 1`,
        [safeRoleIds, oId]
      );
      if (rootRoleRows.length > 0) {
        return res.status(403).json({ error: 'Only a Root Admin can assign the Root Admin role.' });
      }
      // hr_admin is admin-level too: promoting an employee to HR Admin is a Root Admin action.
      const { rows: hrRoleRows } = await pool.query(
        `SELECT 1 FROM roles
          WHERE id = ANY($1::bigint[]) AND org_id = $2 AND is_system_role = true AND slug = 'hr_admin'
          LIMIT 1`,
        [safeRoleIds, oId]
      );
      if (hrRoleRows.length > 0) {
        return res.status(403).json({ error: 'Only a Root Admin can assign the HR Admin role.' });
      }
    }

    // BUG_194: resolve the users.role column value from the assigned system role.
    // This keeps legacy isAdmin() checks and frontend navigation in sync.
    const SLUG_TO_ROLE = { root_admin: 'root_admin', hr_admin: 'admin', employee: 'employee' };
    // dept_head is still users.role='employee'; access comes from departments.head_user_id
    let newUserRole = null;
    if (safeRoleIds.length > 0) {
      const assignedRolesRes = await pool.query(
        `SELECT slug FROM roles WHERE id = ANY($1::bigint[]) AND org_id = $2 AND is_system_role = true`,
        [safeRoleIds, oId]
      );
      for (const r of assignedRolesRes.rows) {
        const mapped = SLUG_TO_ROLE[r.slug];
        if (mapped && (mapped === 'root_admin' || (mapped === 'admin' && newUserRole !== 'root_admin'))) {
          newUserRole = mapped;
        }
      }
      if (!newUserRole) newUserRole = 'employee'; // custom role or dept_head only
    } else {
      newUserRole = 'employee'; // cleared all roles → back to employee
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Delete existing role assignments for this user in this org
      await client.query(
        'DELETE FROM user_roles WHERE user_id = $1 AND org_id = $2',
        [userId, oId]
      );

      // Insert new assignments
      for (const roleId of safeRoleIds) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, org_id, assigned_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, role_id, org_id) DO NOTHING`,
          [userId, roleId, oId, req.user.id]
        );
      }

      // Sync users.role so legacy isAdmin() checks and frontend navigation stay correct
      await client.query(
        `UPDATE users SET role = $1 WHERE id = $2 AND organization_id = $3`,
        [newUserRole, userId, oId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    clearUserCache(userId, oId);

    // Return updated role list
    const { data } = await db
      .from('user_roles')
      .select('role_id, assigned_at, roles(id, name, slug, is_system_role, description)')
      .eq('user_id', userId)
      .eq('org_id', oId);

    res.json((data || []).map(r => ({ ...r.roles, assigned_at: r.assigned_at })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 4. POST /api/roles — create a custom role ────────────────────────────────
router.post('/', auth, hasPermission('roles', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId = orgId(req);
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Role name is required' });
    }
    const trimmedName = name.trim();
    if (trimmedName.length > 50) {
      return res.status(400).json({ error: 'Role name must be 50 characters or fewer' });
    }

    const roleBranch = resolveWriteBranch(req.branchContext);
    if (!roleBranch.ok) return res.status(roleBranch.status).json({ error: roleBranch.error });

    const slug = slugify(trimmedName) + '_' + Date.now();

    const { data, error } = await db
      .from('roles')
      .insert({
        org_id:         oId,
        name:           trimmedName,
        slug,
        description:    (description || '').slice(0, 500),
        is_system_role: false,
        created_by:     req.user.id,
        // BUG-117: scope custom roles to the currently selected branch
        branch_id:      roleBranch.branchId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: `A role named "${trimmedName}" already exists in this organization` });
      }
      throw error;
    }

    res.json({ ...data, permission_count: 0, member_count: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 5. GET /api/roles/:id — get single role with permissions + members ────────
router.get('/:id', auth, hasPermission('roles', 'view'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    const { data: role, error } = await db
      .from('roles')
      .select('id, name, slug, description, is_system_role, created_at')
      .eq('id', roleId)
      .eq('org_id', oId)    // multi-tenant guard: role must belong to caller's org
      .maybeSingle();

    if (error) throw error;
    if (!role) return res.status(404).json({ error: 'Role not found' });

    // Permission IDs for this role
    const { data: rp, error: rpErr } = await db
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', roleId);
    if (rpErr) throw rpErr;

    const permissionIds = (rp || []).map(r => r.permission_id);

    // Members of this role — scoped to org via user_roles.org_id
    const { data: members, error: memErr } = await db
      .from('user_roles')
      .select('user_id, assigned_at, users!user_roles_user_id_fkey(id, name, email, avatar_color, department, role)')
      .eq('role_id', roleId)
      .eq('org_id', oId);   // multi-tenant guard
    if (memErr) throw memErr;

    res.json({
      ...role,
      permission_ids: permissionIds,
      members: (members || []).map(m => ({
        ...m.users,
        assigned_at: m.assigned_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 6. PUT /api/roles/:id — update custom role name / description ────────────
router.put('/:id', auth, hasPermission('roles', 'manage'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    const { name, description } = req.body;

    const { data: existing } = await db
      .from('roles')
      .select('id, is_system_role')
      .eq('id', roleId)
      .eq('org_id', oId)    // multi-tenant guard
      .maybeSingle();

    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.is_system_role) {
      return res.status(400).json({ error: 'System roles cannot be renamed. You can adjust their permissions.' });
    }

    const update = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) return res.status(400).json({ error: 'Role name cannot be empty' });
      if (trimmed.length > 50) return res.status(400).json({ error: 'Role name must be 50 characters or fewer' });
      update.name = trimmed;
    }
    if (description !== undefined) update.description = description.slice(0, 500);

    if (!Object.keys(update).length) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    const { data, error } = await db
      .from('roles')
      .update(update)
      .eq('id', roleId)
      .eq('org_id', oId)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: `A role named "${update.name}" already exists in this organization` });
      }
      throw error;
    }

    clearOrgCache(oId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 7. DELETE /api/roles/:id — delete custom role (cascade: revokes all member assignments + permissions) ─
router.delete('/:id', auth, hasPermission('roles', 'manage'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    const { data: role } = await db
      .from('roles')
      .select('id, name, is_system_role')
      .eq('id', roleId)
      .eq('org_id', oId)    // multi-tenant guard
      .maybeSingle();

    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system_role) {
      return res.status(400).json({ error: 'System roles cannot be deleted.' });
    }

    // Collect affected user IDs before deletion so we can clear their permission caches
    const { rows: affectedUsers } = await pool.query(
      'SELECT user_id FROM user_roles WHERE role_id = $1 AND org_id = $2',
      [roleId, oId]
    );

    // Cascade everything in a single transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Revoke all member assignments for this role (within this org)
      await client.query(
        'DELETE FROM user_roles WHERE role_id = $1 AND org_id = $2',
        [roleId, oId]
      );

      // 2. Revoke all permissions granted to this role
      await client.query(
        'DELETE FROM role_permissions WHERE role_id = $1',
        [roleId]
      );

      // 3. Delete the role itself
      await client.query(
        'DELETE FROM roles WHERE id = $1 AND org_id = $2',
        [roleId, oId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Clear permission caches for all users who had this role
    affectedUsers.forEach(u => clearUserCache(u.user_id, oId));
    clearOrgCache(oId);

    res.json({ ok: true, members_removed: affectedUsers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 8. GET /api/roles/:id/permissions — get permissions for a role ───────────
router.get('/:id/permissions', auth, hasPermission('roles', 'view'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    // Verify role belongs to this org before revealing its permissions
    const { data: role } = await db
      .from('roles')
      .select('id')
      .eq('id', roleId)
      .eq('org_id', oId)
      .maybeSingle();

    if (!role) return res.status(404).json({ error: 'Role not found' });

    const { data, error } = await db
      .from('role_permissions')
      .select('permission_id, permissions(id, module_key, action, label)')
      .eq('role_id', roleId);

    if (error) throw error;

    res.json((data || []).map(r => r.permissions).filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 9. PUT /api/roles/:id/permissions — replace permission set for a role ────
router.put('/:id/permissions', auth, hasPermission('roles', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    const { permission_ids } = req.body;
    const validationError = validatePermissionIds(permission_ids);
    if (validationError) return res.status(400).json({ error: validationError });

    // Cast to integers after validation
    const safeIds = permission_ids.map(id => parseInt(id, 10));

    // Verify role belongs to this org
    const { data: role } = await db
      .from('roles')
      .select('id, name, slug')
      .eq('id', roleId)
      .eq('org_id', oId)
      .maybeSingle();

    if (!role) return res.status(404).json({ error: 'Role not found' });

    // No privilege escalation: a non-root caller may only ADD permissions they hold themselves.
    if (req.user.role !== 'root_admin') {
      const mine = new Set(await resolvePermissions(req.user.id, oId));
      const { rows: curRows } = await pool.query('SELECT permission_id FROM role_permissions WHERE role_id = $1', [roleId]);
      const cur = new Set(curRows.map(r => Number(r.permission_id)));
      const added = safeIds.filter(id => !cur.has(Number(id)));
      if (added.length) {
        const { rows: addRows } = await pool.query(
          'SELECT module_key, action FROM permissions WHERE id = ANY($1::bigint[])', [added]);
        const denied = addRows.find(r => !mine.has(`${r.module_key}.${r.action}`));
        if (denied) return res.status(403).json({ error: `You cannot grant a permission you do not hold (${denied.module_key}.${denied.action}).` });
      }
    }

    // Root Admin role always has all permissions and cannot be restricted
    if (role.slug === 'root_admin') {
      return res.status(400).json({ error: 'The Root Admin role always has all permissions and cannot be restricted.' });
    }

    // BUG_160: Employee system role is limited to self-service permissions only.
    // Any permission not in this allowlist is silently filtered out to prevent
    // admin-level access being granted to the employee role.
    if (role.is_system_role && role.slug === 'employee') {
      const EMPLOYEE_ALLOWED = new Set([
        'dashboard:view',
        'attendance:view',
        'leaves:view', 'leaves:create',
        'documents:view', 'documents:upload',
        'announcements:view',
        'holidays:view',
        'expenses:view', 'expenses:create',
        'performance:view', 'performance:create',
        'onboarding:view', 'onboarding:complete_task',
        'notifications:view',
        'regularization:view', 'regularization:create',
        'payroll:view_own',
      ]);
      // Map requested permission IDs to module_key:action and filter
      const { rows: permRows } = await pool.query(
        `SELECT id, module_key, action FROM permissions WHERE id = ANY($1::bigint[])`,
        [safeIds]
      );
      const allowedIds = permRows
        .filter(p => EMPLOYEE_ALLOWED.has(`${p.module_key}:${p.action}`))
        .map(p => p.id);
      const blockedCount = safeIds.length - allowedIds.length;
      if (blockedCount > 0) {
        // Replace the requested list with only the allowed subset
        safeIds.splice(0, safeIds.length, ...allowedIds);
      }
    }

    // BUG_193: System roles now allow full permission editing EXCEPT for a small
    // set of minimum core permissions that are protected per slug.
    // Admin can remove any non-core permission (e.g. remove payroll from HR Admin).
    if (role.is_system_role) {
      // Fetch the permission IDs for this role's minimum core set
      const CORE_PERMS = {
        hr_admin:   [['dashboard','view'],['employees','view'],['leaves','view'],['attendance','view']],
        dept_head:  [['dashboard','view'],['leaves','view'],['leaves','forward']],
        employee:   [['dashboard','view'],['leaves','view'],['leaves','create'],['attendance','view']],
        root_admin: [], // root_admin is fully managed separately
      };
      const coreList = CORE_PERMS[role.slug] || [];
      let coreIds = new Set();
      if (coreList.length) {
        const coreRes = await pool.query(
          `SELECT id FROM permissions WHERE (module_key, action) IN (${coreList.map((_, i) => `($${i*2+1},$${i*2+2})`).join(',')})`,
          coreList.flat()
        );
        coreIds = new Set(coreRes.rows.map(r => r.id));
      }
      // Final set: everything the admin requested + core permissions (always kept)
      const finalIds = new Set([...safeIds, ...coreIds]);

      const client2 = await pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
        if (finalIds.size > 0) {
          const finalArr = Array.from(finalIds);
          const values   = finalArr.map((_, i) => `($1, $${i + 2})`).join(', ');
          await client2.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             VALUES ${values}
             ON CONFLICT (role_id, permission_id) DO NOTHING`,
            [roleId, ...finalArr]
          );
        }
        await client2.query('COMMIT');
      } catch (err2) {
        await client2.query('ROLLBACK');
        throw err2;
      } finally { client2.release(); }
      clearOrgCache(oId);
      const { data: result } = await db.from('role_permissions').select('permission_id, permissions(id, module_key, action, label)').eq('role_id', roleId);
      return res.json((result || []).map(r => r.permissions).filter(Boolean));
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Replace entire permission set atomically
      await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

      if (safeIds.length > 0) {
        const values = safeIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           VALUES ${values}
           ON CONFLICT (role_id, permission_id) DO NOTHING`,
          [roleId, ...safeIds]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    clearOrgCache(oId);

    // EHN_RM_007: notify all members of this role that permissions changed
    try {
      const { data: roleMembers } = await db.from('user_roles').select('user_id').eq('role_id', roleId);
      if (roleMembers?.length) {
        await db.from('notifications').insert(
          roleMembers.map(m => ({
            user_id:         m.user_id,
            organization_id: oId,
            title:           'Your role permissions have been updated',
            message:         `The permissions for your "${role.name}" role were updated by an administrator. Your access level may have changed.`,
            type:            'system',
          }))
        );
      }
    } catch (_) {}

    // Return updated permission list
    const { data } = await db
      .from('role_permissions')
      .select('permission_id, permissions(id, module_key, action, label)')
      .eq('role_id', roleId);

    res.json((data || []).map(r => r.permissions).filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 10. GET /api/roles/:id/members — list members of a role ─────────────────
router.get('/:id/members', auth, hasPermission('roles', 'view'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    // Verify role belongs to this org
    const { data: role } = await db
      .from('roles')
      .select('id')
      .eq('id', roleId)
      .eq('org_id', oId)
      .maybeSingle();

    if (!role) return res.status(404).json({ error: 'Role not found' });

    const { data, error } = await db
      .from('user_roles')
      .select('user_id, assigned_at, assigned_by, users!user_roles_user_id_fkey(id, name, email, avatar_color, department, position, role)')
      .eq('role_id', roleId)
      .eq('org_id', oId)    // multi-tenant guard
      .order('assigned_at', { ascending: false });

    if (error) throw error;

    res.json((data || []).map(m => ({
      ...m.users,
      assigned_at: m.assigned_at,
      assigned_by: m.assigned_by,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BUG_194/243: keep users.role in sync whenever a system role is added/removed
// via the per-role member endpoints (mirrors PUT /api/roles/user/:userId).
const SLUG_TO_ROLE = { root_admin: 'root_admin', hr_admin: 'admin', employee: 'employee' };
// dept_head is still users.role='employee'; access comes from departments.head_user_id
async function syncUserRoleFromRoles(client, userId, oId) {
  const { rows } = await client.query(
    `SELECT slug FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = $1 AND ur.org_id = $2 AND r.is_system_role = true`,
    [userId, oId]
  );
  let newUserRole = null;
  for (const r of rows) {
    const mapped = SLUG_TO_ROLE[r.slug];
    if (mapped && (mapped === 'root_admin' || (mapped === 'admin' && newUserRole !== 'root_admin')))
      newUserRole = mapped;
  }
  if (!newUserRole) newUserRole = 'employee';
  await client.query(
    `UPDATE users SET role = $1 WHERE id = $2 AND organization_id = $3`,
    [newUserRole, userId, oId]
  );
}

// ─── 11. POST /api/roles/:id/members — add a user to a role ──────────────────
router.post('/:id/members', auth, hasPermission('roles', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    const userId = parseId(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id must be a positive integer' });

    // Verify role belongs to this org
    const { data: role } = await db
      .from('roles')
      .select('id, name, slug, is_system_role, branch_id')
      .eq('id', roleId)
      .eq('org_id', oId)
      .maybeSingle();

    if (!role) return res.status(404).json({ error: 'Role not found' });

    // Verify target user belongs to this org
    const { data: user } = await db
      .from('users')
      .select('id, name, email, role, branch_id')
      .eq('id', userId)
      .eq('organization_id', oId)
      .maybeSingle();

    if (!user) return res.status(404).json({ error: 'User not found in this organization' });

    // DEEP-005: only a Root Admin may grant the Root Admin system role
    if (req.user.role !== 'root_admin' && role.slug === 'root_admin' && role.is_system_role) {
      return res.status(403).json({ error: 'Only a Root Admin can assign the Root Admin role.' });
    }
    if (req.user.role !== 'root_admin' && role.slug === 'hr_admin' && role.is_system_role) {
      return res.status(403).json({ error: 'Only a Root Admin can assign the HR Admin role.' });
    }
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, user.id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      if (user.role !== 'employee')
        return res.status(403).json({ error: 'Only a Root Admin can change roles of admin accounts.' });
    }
    if (role.branch_id != null && Number(role.branch_id) !== Number(user.branch_id))
      return res.status(400).json({ error: 'A branch-specific role can only be assigned to employees of that branch.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO user_roles (user_id, role_id, org_id, assigned_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, role_id, org_id) DO NOTHING
         RETURNING *`,
        [userId, roleId, oId, req.user.id]
      );
      if (!ins.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `${user.name} already has the "${role.name}" role` });
      }
      // BUG_194/243: promote users.role so the member actually gains the role.
      // Only for system roles — adding a custom role must never recompute (and possibly
      // demote) the user's base role.
      if (role.is_system_role) await syncUserRoleFromRoles(client, userId, oId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    clearUserCache(userId, oId);
    const { markRoleChanged } = require('../../middleware/auth');
    markRoleChanged(userId); // force re-login so the JWT picks up the new role
    res.json({ user_id: userId, role_id: roleId, org_id: oId, assigned_by: req.user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 12. DELETE /api/roles/:id/members/:userId — remove a user from a role ───
router.delete('/:id/members/:userId', auth, hasPermission('roles', 'manage'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    const userId = parseId(req.params.userId);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    // Prevent root admin from removing themselves from the Root Admin role
    // Fix: include org_id filter so we're only reading our org's role
    // (the role is also needed below to decide whether users.role must be re-synced)
    const { data: role } = await db
      .from('roles')
      .select('slug, is_system_role')
      .eq('id', roleId)
      .eq('org_id', oId)    // FIXED: must include org_id guard
      .maybeSingle();
    if (userId === req.user.id && role?.slug === 'root_admin') {
      return res.status(400).json({ error: 'You cannot remove yourself from the Root Admin role.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM user_roles WHERE role_id = $1 AND user_id = $2 AND org_id = $3`,
        [roleId, userId, oId]
      );
      // BUG_194/243: demote users.role if the removed system role was authoritative.
      // Removing a custom role never touches the user's base role.
      if (role?.is_system_role) await syncUserRoleFromRoles(client, userId, oId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    clearUserCache(userId, oId);
    const { markRoleChanged } = require('../../middleware/auth');
    markRoleChanged(userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
