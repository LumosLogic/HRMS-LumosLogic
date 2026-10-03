const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, canAdminAccessUser, getFilterState, assertUsersAccessible, resolveWriteBranch, canModifyBranchRecord } = require('../../utils/branchFilter');
const { pool } = require('../../config/db');

// Shift scope: branch_id NULL = organisation-wide shift; branch_id = <id> = that branch only.
/** Loads a shift of THIS org and checks the caller may use it (org-wide, or a branch in their scope). */
async function loadUsableShift(shiftId, oId, branchContext) {
  const id = parseInt(shiftId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { data } = await db.from('shifts').select('id, branch_id').eq('id', id).eq('organization_id', oId).maybeSingle();
  if (!data) return null;
  if (data.branch_id != null) {
    const st = getFilterState(branchContext);
    const allowed = branchContext?.hasAllBranches
      || (st.type === 'specific' && Number(st.branchId) === Number(data.branch_id))
      || (st.type === 'multi' && st.branchIds.map(Number).includes(Number(data.branch_id)));
    if (!allowed) return null;
  }
  return data;
}
/** A branch-specific shift can only be assigned to employees of that branch. */
async function employeesMatchShiftBranch(shift, empIds, oId) {
  if (shift.branch_id == null) return true;
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM users WHERE organization_id = $1 AND id = ANY($2::bigint[]) AND branch_id = $3',
    [oId, empIds, shift.branch_id]);
  return rows[0].c === empIds.length;
}

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// ─── Shift Definitions ────────────────────────────────────────────────────────

// GET /api/shifts
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const branchState = getFilterState(req.branchContext);
    let q = db.from('shifts').select('*').eq('organization_id', oId).order('name');
    // When a specific branch is selected, show shifts belonging to that branch + org-wide shifts (branch_id IS NULL)
    if (branchState.type === 'specific') {
      q = q.or(`branch_id.eq.${branchState.branchId},branch_id.is.null`);
    } else if (branchState.type === 'multi') {
      q = q.or(`branch_id.in.(${branchState.branchIds.join(',')}),branch_id.is.null`);
    }
    else if (branchState.type === 'none') {
      q = q.is('branch_id', null); // no branch access -> org-wide shifts only
    }
    // type=all: show everything
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shifts
router.post('/', auth, hasPermission('shifts', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { name, start_time, end_time, color, description, days_of_week } = req.body;
    if (!name || !start_time || !end_time) return res.status(400).json({ error: 'name, start_time and end_time required' });
    // Scope: selected branch; org-wide (NULL) only for all-branch callers. A restricted HR with
    // no branch selected is rejected instead of silently creating an org-wide shift.
    let branchId;
    if (req.body.org_wide === true) {
      if (!req.branchContext?.hasAllBranches) return res.status(403).json({ error: 'Only users with all-branch access can create organisation-wide shifts.' });
      branchId = null;
    } else {
      const w = resolveWriteBranch(req.branchContext);
      if (!w.ok) return res.status(w.status).json({ error: w.error });
      branchId = w.branchId;
    }
    // BUG_075: Duplicate shift check scoped to branch (same name within same branch or org-wide scope)
    let dupQ = db.from('shifts').select('id').eq('organization_id', oId).ilike('name', name.trim());
    if (branchId) dupQ = dupQ.eq('branch_id', branchId);
    else dupQ = dupQ.is('branch_id', null);
    const { data: existing } = await dupQ.maybeSingle();
    if (existing) return res.status(400).json({ error: 'A shift with this name already exists in this branch. Please use a different name.' });
    const { data, error } = await db.from('shifts')
      .insert({ name: name.trim(), start_time, end_time, color: color || '#3525cd', description: description || '', days_of_week: days_of_week || null, organization_id: oId, branch_id: branchId })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/shifts/:id
router.put('/:id', auth, hasPermission('shifts', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { name, start_time, end_time, color, description, days_of_week } = req.body;
    // Verify shift belongs to the accessible branch before editing
    const { data: existing } = await db.from('shifts').select('branch_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Shift not found' });
    if (!canModifyBranchRecord(req.branchContext, existing.branch_id)) {
      return res.status(403).json({ error: 'You do not have access to modify this shift.' });
    }
    const { data, error } = await db.from('shifts')
      .update({ name, start_time, end_time, color, description: description || '', days_of_week: days_of_week || null })
      .eq('id', req.params.id).eq('organization_id', oId).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/shifts/:id
router.delete('/:id', auth, hasPermission('shifts', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    // Verify shift belongs to the accessible branch before deleting
    const { data: existing } = await db.from('shifts').select('branch_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Shift not found' });
    if (!canModifyBranchRecord(req.branchContext, existing.branch_id)) {
      return res.status(403).json({ error: 'You do not have access to delete this shift.' });
    }
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
      const uid = parseInt(userId, 10);
      if (!Number.isInteger(uid) || uid <= 0) return res.status(400).json({ error: 'Invalid userId' });
      // Non-admins can only read their own roster; admins only for employees in their scope.
      if (!isAdmin(req.user.role)) {
        if (uid !== req.user.id) return res.status(403).json({ error: 'Access denied' });
      } else if (!await canAdminAccessUser(req.branchContext, uid, oId)) {
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      }
      q = q.eq('user_id', uid);
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

    // Every employee must exist in this org and inside the caller's branch scope (one query),
    // and the shift must be usable by the caller and match the employees' branch.
    const acc = await assertUsersAccessible(req.branchContext, safeEmpIds, oId);
    if (!acc.ok) return res.status(403).json({ error: `You do not have access to employee ID ${acc.badIds[0]}.` });
    const shiftRow = await loadUsableShift(safeShiftId, oId, req.branchContext);
    if (!shiftRow) return res.status(404).json({ error: 'Shift not found' });
    if (!await employeesMatchShiftBranch(shiftRow, safeEmpIds, oId))
      return res.status(400).json({ error: 'This shift belongs to a different branch than the selected employees.' });

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

    // ── Delete any existing assignments for these employees on these dates ────
    // This ensures a clean shift transition: employee is removed from their old
    // shift before being placed in the new one, regardless of DB constraint type.
    if (safeEmpIds.length > 0 && validDates.length > 0) {
      const { error: delErr } = await db
        .from('shift_assignments')
        .delete()
        .eq('organization_id', oId)
        .in('user_id', safeEmpIds)
        .in('date', validDates);
      if (delErr) throw delErr;
    }

    // ── Insert new shift rows ─────────────────────────────────────────────────
    const rows = [];
    validDates.forEach(date =>
      safeEmpIds.forEach(userId =>
        rows.push({ user_id: userId, shift_id: safeShiftId, date, organization_id: oId })
      )
    );

    const { data, error } = await db
      .from('shift_assignments')
      .insert(rows)
      .select();
    if (error) throw error;

    res.json({ created: data?.length || 0, conflicts_overwritten: conflicts.length, needs_confirmation: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/shifts/assignments/bulk — assign shifts to multiple employees
router.post('/assignments/bulk', auth, hasPermission('shifts', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { assignments } = req.body;
    if (!Array.isArray(assignments)) return res.status(400).json({ error: 'assignments array required' });
    // Whitelist fields and validate every referenced user + shift against org and branch scope.
    const clean = assignments.map(a => ({
      user_id: parseInt(a?.user_id, 10), shift_id: parseInt(a?.shift_id, 10), date: a?.date,
    }));
    if (clean.some(a => !a.user_id || !a.shift_id || !a.date))
      return res.status(400).json({ error: 'Each assignment needs user_id, shift_id and date' });
    const accB = await assertUsersAccessible(req.branchContext, clean.map(a => a.user_id), oId);
    if (!accB.ok) return res.status(403).json({ error: `You do not have access to employee ID ${accB.badIds[0]}.` });
    for (const sid of [...new Set(clean.map(a => a.shift_id))]) {
      const sh = await loadUsableShift(sid, oId, req.branchContext);
      if (!sh) return res.status(404).json({ error: `Shift ${sid} not found` });
      const uids = [...new Set(clean.filter(a => a.shift_id === sid).map(a => a.user_id))];
      if (!await employeesMatchShiftBranch(sh, uids, oId))
        return res.status(400).json({ error: 'A branch-specific shift can only be assigned to employees of that branch.' });
    }
    const rows = clean.map(a => ({ ...a, organization_id: oId }));
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

    const accD = await assertUsersAccessible(req.branchContext, safeEmpIds, oId);
    if (!accD.ok) return res.status(403).json({ error: `You do not have access to employee ID ${accD.badIds[0]}.` });
    if (!await loadUsableShift(safeShiftId, oId, req.branchContext))
      return res.status(404).json({ error: 'Shift not found' });

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
router.delete('/assignments/:id', auth, hasPermission('shifts', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { data: row } = await db.from('shift_assignments').select('id, user_id')
      .eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!row) return res.status(404).json({ error: 'Assignment not found' });
    if (!await canAdminAccessUser(req.branchContext, row.user_id, oId))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
    const { error } = await db.from('shift_assignments').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
