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
router.get('/', auth, hasPermission('roles', 'view'), async (req, res) => {
  try {
    const oId = orgId(req);

    const { data: roles, error } = await db
      .from('roles')
      .select('id, name, slug, description, is_system_role, created_at')
      .eq('org_id', oId)
      .order('is_system_role', { ascending: false })
      .order('name');
    if (error) throw error;

    if (!roles?.length) return res.json([]);

    const roleIds = roles.map(r => r.id);

    // Permission counts per role (single batched query, no N+1)
    const pcRes = await pool.query(
      `SELECT role_id, COUNT(*) AS count
       FROM role_permissions
       WHERE role_id = ANY($1::bigint[])
       GROUP BY role_id`,
      [roleIds]
    );
    const permCounts = {};
    pcRes.rows.forEach(r => { permCounts[r.role_id] = parseInt(r.count, 10); });

    // Member counts per role (single batched query, no N+1)
    const mcRes = await pool.query(
      `SELECT role_id, COUNT(*) AS count
       FROM user_roles
       WHERE role_id = ANY($1::bigint[]) AND org_id = $2
       GROUP BY role_id`,
      [roleIds, oId]
    );
    const memberCounts = {};
    mcRes.rows.forEach(r => { memberCounts[r.role_id] = parseInt(r.count, 10); });

    res.json(roles.map(r => ({
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
router.put('/user/:userId', auth, hasPermission('roles', 'manage'), async (req, res) => {
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
      .select('id, name')
      .eq('id', userId)
      .eq('organization_id', oId)
      .maybeSingle();
    if (!targetUser) return res.status(404).json({ error: 'User not found in this organization' });

    // Ensure all provided roles belong to this org
    if (safeRoleIds.length > 0) {
      const { count } = await db
        .from('roles')
        .select('id', { count: 'exact', head: true })
        .in('id', safeRoleIds)
        .eq('org_id', oId);

      if (count !== safeRoleIds.length) {
        return res.status(400).json({ error: 'One or more roles do not belong to this organization' });
      }
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
router.post('/', auth, hasPermission('roles', 'manage'), async (req, res) => {
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
router.put('/:id/permissions', auth, hasPermission('roles', 'manage'), async (req, res) => {
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

    // Root Admin role always has all permissions and cannot be restricted
    if (role.slug === 'root_admin') {
      return res.status(400).json({ error: 'The Root Admin role always has all permissions and cannot be restricted.' });
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

// ─── 11. POST /api/roles/:id/members — add a user to a role ──────────────────
router.post('/:id/members', auth, hasPermission('roles', 'manage'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const roleId = parseId(req.params.id);
    if (!roleId) return res.status(400).json({ error: 'Invalid role ID' });

    const userId = parseId(req.body.user_id);
    if (!userId) return res.status(400).json({ error: 'user_id must be a positive integer' });

    // Verify role belongs to this org
    const { data: role } = await db
      .from('roles')
      .select('id, name')
      .eq('id', roleId)
      .eq('org_id', oId)
      .maybeSingle();

    if (!role) return res.status(404).json({ error: 'Role not found' });

    // Verify target user belongs to this org
    const { data: user } = await db
      .from('users')
      .select('id, name, email')
      .eq('id', userId)
      .eq('organization_id', oId)
      .maybeSingle();

    if (!user) return res.status(404).json({ error: 'User not found in this organization' });

    const { data, error } = await db
      .from('user_roles')
      .insert({ user_id: userId, role_id: roleId, org_id: oId, assigned_by: req.user.id })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(400).json({ error: `${user.name} already has the "${role.name}" role` });
      }
      throw error;
    }

    clearUserCache(userId, oId);
    res.json(data);
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
    if (userId === req.user.id) {
      const { data: role } = await db
        .from('roles')
        .select('slug')
        .eq('id', roleId)
        .eq('org_id', oId)    // FIXED: must include org_id guard
        .maybeSingle();
      if (role?.slug === 'root_admin') {
        return res.status(400).json({ error: 'You cannot remove yourself from the Root Admin role.' });
      }
    }

    const { error } = await db
      .from('user_roles')
      .delete()
      .eq('role_id', roleId)
      .eq('user_id', userId)
      .eq('org_id', oId);    // multi-tenant guard on delete

    if (error) throw error;

    clearUserCache(userId, oId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
