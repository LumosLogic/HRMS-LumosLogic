const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');

// GET /api/departments
router.get('/', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data, error } = await db
      .from('departments')
      .select('*, users!departments_head_user_id_fkey(id, name)')
      .eq('organization_id', oId)
      .order('name');
    if (error) throw error;

    // Attach member counts — only active employees (exclude inactive/resigned/terminated)
    const deptIds = (data || []).map(d => d.id);
    let memberCounts = {};
    if (deptIds.length > 0) {
      const { data: activeUsers } = await db.from('users')
        .select('id')
        .eq('organization_id', oId)
        .in('role', ['employee', 'admin'])
        .not('employee_status', 'in', '("inactive","resigned","terminated")');
      const activeIds = (activeUsers || []).map(u => u.id);

      if (activeIds.length > 0) {
        const { data: ud } = await db.from('user_departments')
          .select('department_id, user_id')
          .in('department_id', deptIds)
          .in('user_id', activeIds)
          .eq('organization_id', oId);
        (ud || []).forEach(r => {
          memberCounts[r.department_id] = (memberCounts[r.department_id] || 0) + 1;
        });
      }
    }

    res.json((data || []).map(d => ({ ...d, member_count: memberCounts[d.id] || 0 })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/departments
router.post('/', auth, hasPermission('departments', 'create'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { name, description, head_user_id } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Department name is required' });
    if (name.trim().length < 2) return res.status(400).json({ error: 'Department name must be at least 2 characters.' });
    if (name.trim().length > 100) return res.status(400).json({ error: 'Department name cannot exceed 100 characters.' });
    const { data, error } = await db
      .from('departments')
      .insert({ name: name.trim(), description: description || '', head_user_id: head_user_id || null, organization_id: oId })
      .select()
      .single();
    // BUG_062: Return user-friendly message for duplicate department name
    if (error) {
      if (error.code === '23505' || (error.message && error.message.includes('unique'))) {
        return res.status(400).json({ error: 'Department name already exists. Please use a different name.' });
      }
      throw error;
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/departments/:id
router.put('/:id', auth, hasPermission('departments', 'edit'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { name, description, head_user_id } = req.body;

    // Fetch old name before update so we can sync the users.department string
    const { data: oldDept } = await db.from('departments')
      .select('name, head_user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!oldDept) return res.status(404).json({ error: 'Department not found' });

    // Only fields that were sent are changed: a rename (no head_user_id in the body) used to clear the head,
    // silently removing the dept-head approvals and RBAC grant.
    const patch = {};
    if (name !== undefined)        patch.name = name?.trim() || name;
    if (description !== undefined) patch.description = description || '';
    if (Object.prototype.hasOwnProperty.call(req.body, 'head_user_id')) patch.head_user_id = head_user_id || null;
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No fields to update' });

    const { data, error } = await db
      .from('departments')
      .update(patch)
      .eq('id', req.params.id).eq('organization_id', oId)
      .select().single();
    if (error) {
      if (error.code === '23505' || (error.message && error.message.includes('unique'))) {
        return res.status(400).json({ error: 'Department name already exists. Please use a different name.' });
      }
      throw error;
    }

    // Keep users.department string in sync when the department is renamed.
    // This is a denormalized field used in reports and filters.
    if (oldDept && name && oldDept.name !== name) {
      await db.from('users')
        .update({ department: name })
        .eq('department', oldDept.name)
        .eq('organization_id', oId);
    }

    // New department head ⇒ pending leave approvals of the department's members follow the head.
    if (Object.prototype.hasOwnProperty.call(patch, 'head_user_id') && String(patch.head_user_id ?? '') !== String(oldDept?.head_user_id ?? '')) {
      try {
        const { rows } = await pool.query('SELECT user_id FROM user_departments WHERE department_id = $1 AND organization_id = $2', [req.params.id, oId]);
        await require('../../services/leaveWorkflowEngine').reresolvePendingApprovers(oId, rows.map(r => r.user_id));
        require('../../services/teamScope').clearTeamScopeCache(oId);
        if (patch.head_user_id) require('../../services/permissionService').clearUserCache(String(patch.head_user_id), oId);
        if (oldDept?.head_user_id) require('../../services/permissionService').clearUserCache(String(oldDept.head_user_id), oId);
      } catch (e) { console.error('[departments] head change propagation:', e.message); }
    }

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/departments/:id
router.delete('/:id', auth, hasPermission('departments', 'delete'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    // users.department_id is a plain FK (no ON DELETE action) and users.department a text copy: clear both so a
    // department can be deleted and no employee keeps pointing at / displaying a department that no longer exists.
    const { data: dd } = await db.from('departments').select('name').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!dd) return res.status(404).json({ error: 'Department not found' });
    {
      await pool.query('UPDATE users SET department_id = NULL WHERE department_id = $1 AND organization_id = $2', [req.params.id, oId]);
      await pool.query(
        `UPDATE users u SET department = NULL
          WHERE u.organization_id = $1 AND u.department = $2
            AND NOT EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id AND ud.department_id <> $3)`,
        [oId, dd.name, req.params.id]);
    }
    const { error } = await db.from('departments')
      .delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
