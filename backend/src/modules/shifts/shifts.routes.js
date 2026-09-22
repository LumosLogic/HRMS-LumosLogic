const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, canAdminAccessUser } = require('../../utils/branchFilter');

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// ─── Shift Definitions ────────────────────────────────────────────────────────

// GET /api/shifts
router.get('/', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data, error } = await db.from('shifts').select('*').eq('organization_id', oId).order('name');
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shifts
router.post('/', auth, hasPermission('shifts', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { name, start_time, end_time, color, description, days_of_week } = req.body;
    if (!name || !start_time || !end_time) return res.status(400).json({ error: 'name, start_time and end_time required' });
    // BUG_075: Duplicate shift check — same name (case-insensitive) in same org
    const { data: existing } = await db.from('shifts')
      .select('id').eq('organization_id', oId).ilike('name', name.trim()).maybeSingle();
    if (existing) return res.status(400).json({ error: 'A shift with this name already exists. Please use a different name.' });
    const { data, error } = await db.from('shifts')
      .insert({ name: name.trim(), start_time, end_time, color: color || '#3525cd', description: description || '', days_of_week: days_of_week || null, organization_id: oId })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/shifts/:id
router.put('/:id', auth, hasPermission('shifts', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { name, start_time, end_time, color, description, days_of_week } = req.body;
    const { data, error } = await db.from('shifts')
      .update({ name, start_time, end_time, color, description: description || '', days_of_week: days_of_week || null })
      .eq('id', req.params.id).eq('organization_id', oId).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/shifts/:id
router.delete('/:id', auth, hasPermission('shifts', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { error } = await db.from('shifts').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Shift Assignments ────────────────────────────────────────────────────────

// GET /api/shifts/assignments?month=YYYY-MM
router.get('/assignments', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { month, userId } = req.query;

    let q = db.from('shift_assignments')
      .select('*, shift:shifts(id, name, start_time, end_time, color), user:users!shift_assignments_user_id_fkey(id, name, avatar_color, department)')
      .eq('organization_id', oId)
      .order('date');
    if (month) q = q.gte('date', `${month}-01`).lte('date', `${month}-31`);

    if (userId) {
      q = q.eq('user_id', userId);
    } else if (!isAdmin(req.user.role)) {
      q = q.eq('user_id', req.user.id);
    } else {
      // Admin: restrict to accessible branches via employee branch membership
      const accessibleIds = await resolveEmployeeIds(req.branchContext, oId);
      if (accessibleIds !== null) {
        if (accessibleIds.length === 0) return res.json([]);
        q = q.in('user_id', accessibleIds);
      }
    }

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shifts/assignments/range — assign a shift to selected employees across a date range
// Generates one row per employee per matching day. Returns conflict info before saving.
router.post('/assignments/range', auth, withBranchContext, hasPermission('shifts', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { shift_id, employee_ids, from_date, to_date, days_of_week, force } = req.body;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!shift_id)
      return res.status(400).json({ error: 'shift_id is required' });
    if (!Array.isArray(employee_ids) || employee_ids.length === 0)
      return res.status(400).json({ error: 'At least one employee must be selected' });
    if (!from_date)
      return res.status(400).json({ error: 'from_date is required (YYYY-MM-DD)' });
    if (!to_date)
      return res.status(400).json({ error: 'to_date is required (YYYY-MM-DD)' });

    const from = new Date(from_date + 'T12:00:00');
    const to   = new Date(to_date   + 'T12:00:00');
    if (isNaN(from.getTime())) return res.status(400).json({ error: 'Invalid from_date — use YYYY-MM-DD' });
    if (isNaN(to.getTime()))   return res.status(400).json({ error: 'Invalid to_date — use YYYY-MM-DD' });
    if (from > to)             return res.status(400).json({ error: 'from_date must be on or before to_date' });

    const daysDiff = Math.round((to - from) / (1000 * 60 * 60 * 24));
    if (daysDiff > 366) return res.status(400).json({ error: 'Date range cannot exceed 1 year' });

    const safeShiftId = parseInt(shift_id, 10);
    const safeEmpIds  = employee_ids.map(id => parseInt(id, 10)).filter(n => n > 0);
    if (!safeEmpIds.length)
      return res.status(400).json({ error: 'employee_ids must be valid positive integers' });

    // Branch isolation: reject any employee the admin cannot access
    if (req.user.role !== 'root_admin') {
      for (const empId of safeEmpIds) {
        if (!await canAdminAccessUser(req.branchContext, empId, oId))
          return res.status(403).json({ error: `You do not have access to employee ID ${empId}.` });
      }
    }

    // ── Generate date list ────────────────────────────────────────────────────
    const allowedDays = Array.isArray(days_of_week) && days_of_week.length > 0
      ? days_of_week.map(Number)
      : null; // null = all days

    const validDates = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (!allowedDays || allowedDays.includes(d.getDay()))
        validDates.push(d.toISOString().slice(0, 10));
    }

    if (!validDates.length)
      return res.status(400).json({ error: 'No valid dates in selected range for the chosen days' });

    // ── Conflict check: employees already on a DIFFERENT shift on these dates ─
    const { data: existing } = await db
      .from('shift_assignments')
      .select('user_id, date, shift_id, shifts!inner(name)')
      .eq('organization_id', oId)
      .in('user_id', safeEmpIds)
      .in('date', validDates)
      .neq('shift_id', safeShiftId);

    const conflicts = (existing || []).map(c => ({
      user_id:    c.user_id,
      date:       c.date,
      shift_name: c.shifts?.name || 'Another Shift',
    }));

    // If conflicts exist and not forcing, return preview without saving
    if (conflicts.length > 0 && !force) {
      return res.json({ conflicts, created: 0, needs_confirmation: true });
    }

    // ── Upsert all rows ───────────────────────────────────────────────────────
    const rows = [];
    validDates.forEach(date =>
      safeEmpIds.forEach(userId =>
        rows.push({ user_id: userId, shift_id: safeShiftId, date, organization_id: oId })
      )
    );

    const { data, error } = await db
      .from('shift_assignments')
      .upsert(rows, { onConflict: 'user_id,date,organization_id' })
      .select();
    if (error) throw error;

    res.json({ created: data?.length || 0, conflicts_overwritten: conflicts.length, needs_confirmation: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shifts/assignments/bulk — assign shifts to multiple employees
router.post('/assignments/bulk', auth, hasPermission('shifts', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { assignments } = req.body;
    if (!Array.isArray(assignments)) return res.status(400).json({ error: 'assignments array required' });
    const rows = assignments.map(a => ({ ...a, organization_id: oId }));
    const { data, error } = await db.from('shift_assignments')
      .upsert(rows, { onConflict: 'user_id,date,organization_id' }).select();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/shifts/assignments/range — unassign employees from a shift over a date range
router.delete('/assignments/range', auth, withBranchContext, hasPermission('shifts', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { shift_id, employee_ids, from_date, to_date, days_of_week } = req.body;

    if (!shift_id || !Array.isArray(employee_ids) || !employee_ids.length || !from_date || !to_date)
      return res.status(400).json({ error: 'shift_id, employee_ids, from_date, to_date required' });

    const safeEmpIds   = employee_ids.map(id => parseInt(id, 10)).filter(n => n > 0);
    const safeShiftId  = parseInt(shift_id, 10);
    if (!safeEmpIds.length) return res.status(400).json({ error: 'No valid employee IDs' });

    // Branch isolation: reject any employee the admin cannot access
    if (req.user.role !== 'root_admin') {
      for (const empId of safeEmpIds) {
        if (!await canAdminAccessUser(req.branchContext, empId, oId))
          return res.status(403).json({ error: `You do not have access to employee ID ${empId}.` });
      }
    }

    // If days_of_week supplied, only delete assignments on those weekdays
    let q = db.from('shift_assignments')
      .delete()
      .eq('organization_id', oId)
      .eq('shift_id', safeShiftId)
      .in('user_id', safeEmpIds)
      .gte('date', from_date)
      .lte('date', to_date);

    if (Array.isArray(days_of_week) && days_of_week.length > 0) {
      // Build list of matching dates within range for the given weekdays
      const from = new Date(from_date + 'T12:00:00');
      const to   = new Date(to_date   + 'T12:00:00');
      const allowed = days_of_week.map(Number);
      const dates = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        if (allowed.includes(d.getDay())) dates.push(d.toISOString().slice(0, 10));
      }
      if (!dates.length) return res.json({ removed: 0 });
      q = db.from('shift_assignments')
        .delete()
        .eq('organization_id', oId)
        .eq('shift_id', safeShiftId)
        .in('user_id', safeEmpIds)
        .in('date', dates);
    }

    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/shifts/assignments/:id
router.delete('/assignments/:id', auth, hasPermission('shifts', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const { error } = await db.from('shift_assignments').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
