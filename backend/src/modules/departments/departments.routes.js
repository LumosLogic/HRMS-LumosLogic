const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
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
      .select('name').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();

    const { data, error } = await db
      .from('departments')
      .update({ name: name?.trim() || name, description: description || '', head_user_id: head_user_id || null })
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

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/departments/:id
router.delete('/:id', auth, hasPermission('departments', 'delete'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { error } = await db.from('departments')
      .delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
