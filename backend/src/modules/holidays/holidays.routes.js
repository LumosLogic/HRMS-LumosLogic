const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState, canModifyBranchRecord } = require('../../utils/branchFilter');
const { validateBranchIdList } = require('../../services/branchService');

// Holiday scope model
//   branch_id IS NULL   → organisation-wide holiday (applies to every branch)
//   branch_id = <id>    → holiday for that branch only
// Visibility follows the caller's branch state:
//   all      → everything          specific → org-wide + that branch
//   multi    → org-wide + the caller's accessible branches
//   none     → org-wide only (a caller with no branch access never sees branch data)

/** Applies the visibility rule above to a holidays query builder. */
function applyHolidayVisibility(q, branchState) {
  if (branchState.type === 'specific') return q.or(`branch_id.is.null,branch_id.eq.${Number(branchState.branchId)}`);
  if (branchState.type === 'multi')    return q.or(`branch_id.is.null,branch_id.in.(${branchState.branchIds.map(Number).join(',')})`);
  if (branchState.type === 'none')     return q.is('branch_id', null);
  return q;
}

/**
 * Resolves the target branch list for a holiday write.
 *   body.org_wide === true     → [null]  (only callers with all-branch access)
 *   body.branch_ids = [..]     → each validated against org + caller access
 *   otherwise                  → the selected branch; a restricted caller with no selection is rejected
 */
async function resolveTargets(req, body) {
  const oId = req.user.organization_id;
  if (body.org_wide === true) {
    if (!req.branchContext?.hasAllBranches)
      return { error: 'Only users with all-branch access can create organisation-wide holidays.', status: 403 };
    return { targets: [null] };
  }
  if (Array.isArray(body.branch_ids) && body.branch_ids.length > 0) {
    const v = await validateBranchIdList(req.user.id, oId, req.user.role, body.branch_ids);
    if (!v.ok) return { error: v.error, status: 403 };
    return { targets: v.ids };
  }
  const state = getFilterState(req.branchContext);
  if (state.type === 'specific') return { targets: [Number(state.branchId)] };
  if (state.type === 'all')      return { targets: [null] };
  return { error: 'Select a branch before adding a holiday.', status: 403 };
}

/** Marks attendance as 'holiday' for the employees the holiday applies to. Fire-and-forget. */
function markHolidayAttendance(oId, date, branchId) {
  db.from('users').select('id, branch_id').eq('organization_id', oId).eq('role', 'employee').not('employee_status', 'in', ['inactive', 'resigned', 'terminated'])
    .then(async ({ data: employees }) => {
      if (!employees?.length) return;
      let targets = employees;
      if (branchId) targets = employees.filter(e => Number(e.branch_id) === Number(branchId));
      if (!targets.length) return;
      const targetIds = targets.map(e => e.id);
      await db.from('attendance')
        .update({ status: 'holiday' })
        .eq('date', date).eq('organization_id', oId).eq('status', 'absent')
        .in('user_id', targetIds);
      const { data: marked } = await db.from('attendance').select('user_id').eq('date', date).eq('organization_id', oId).in('user_id', targetIds);
      const markedIds = new Set((marked || []).map(r => r.user_id));
      const toInsert = targets.filter(e => !markedIds.has(e.id)).map(e => ({ user_id: e.id, organization_id: oId, date, status: 'holiday' }));
      if (toInsert.length) await db.from('attendance').insert(toInsert);
    }).catch(() => {});
}

// GET /api/holidays
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { year } = req.query;
    let q = db.from('holidays').select('*').eq('organization_id', oId).order('date');
    if (year) q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
    q = applyHolidayVisibility(q, getFilterState(req.branchContext));
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/holidays  — body may carry org_wide:true or branch_ids:[..] ("apply to selected branches")
router.post('/', auth, hasPermission('holidays', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { name, date, type, description, specific_msg } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'Name and date are required' });

    const resolved = await resolveTargets(req, req.body);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });

    // Prevent a duplicate holiday on the same date within the same scope.
    for (const branchId of resolved.targets) {
      let dupQ = db.from('holidays').select('id, name').eq('date', date).eq('organization_id', oId);
      dupQ = branchId ? dupQ.eq('branch_id', branchId) : dupQ.is('branch_id', null);
      const { data: existing } = await dupQ.maybeSingle();
      if (existing) {
        return res.status(409).json({
          error: `A holiday already exists on ${date}: "${existing.name}". Delete or edit it first.`,
          existing_id: existing.id,
        });
      }
    }

    const rows = resolved.targets.map(branchId => ({
      name, date, type: type || 'public', description: description || '', specific_msg: specific_msg || '',
      organization_id: oId, branch_id: branchId,
    }));
    const { data, error } = await db.from('holidays').insert(rows).select();
    if (error) throw error;

    resolved.targets.forEach(branchId => markHolidayAttendance(oId, date, branchId));
    // Single-target creates keep the historical response shape (one object).
    res.json(rows.length === 1 ? data[0] : data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/holidays/:id — scope (branch_id) is immutable here; edit within the caller's scope only
router.put('/:id', auth, hasPermission('holidays', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { name, date, type, description, specific_msg } = req.body;
    const { data: existing } = await db.from('holidays').select('id, branch_id')
      .eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Holiday not found' });
    if (!canModifyBranchRecord(req.branchContext, existing.branch_id))
      return res.status(403).json({ error: 'You do not have access to modify this holiday.' });
    const { data, error } = await db.from('holidays')
      .update({ name, date, type, description: description || '', specific_msg: specific_msg || '' })
      .eq('id', req.params.id).eq('organization_id', oId)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/holidays/:id
router.delete('/:id', auth, hasPermission('holidays', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data: existing } = await db.from('holidays').select('id, branch_id')
      .eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Holiday not found' });
    if (!canModifyBranchRecord(req.branchContext, existing.branch_id))
      return res.status(403).json({ error: 'You do not have access to delete this holiday.' });
    const { error } = await db.from('holidays')
      .delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/holidays/copy-from-year — copies the holidays the caller may manage, preserving scope
router.post('/copy-from-year', auth, hasPermission('holidays', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { from_year, to_year } = req.body;
    if (!from_year || !to_year) return res.status(400).json({ error: 'from_year and to_year are required' });
    const state = getFilterState(req.branchContext);
    if (state.type === 'none') return res.status(403).json({ error: 'You do not have access to any branch.' });

    let srcQ = db.from('holidays').select('*').eq('organization_id', oId)
      .gte('date', `${from_year}-01-01`).lte('date', `${from_year}-12-31`);
    srcQ = applyHolidayVisibility(srcQ, state);
    const { data: sourceAll } = await srcQ;
    // Only holidays the caller is allowed to manage are copied (so a restricted HR never
    // creates organisation-wide copies of data they cannot modify).
    const source = (sourceAll || []).filter(h => canModifyBranchRecord(req.branchContext, h.branch_id));
    if (!source.length) return res.json({ copied: 0, skipped: 0, message: `No holidays found in ${from_year}` });

    const { data: existing } = await db.from('holidays')
      .select('date, branch_id').eq('organization_id', oId)
      .gte('date', `${to_year}-01-01`).lte('date', `${to_year}-12-31`);
    // Use first 10 chars to handle both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:...' formats
    const toDateStr = d => String(d).substring(0, 10);
    const keyOf = (md, b) => `${md}|${b == null ? 'org' : Number(b)}`;
    const existingKeys = new Set((existing || []).map(h => keyOf(toDateStr(h.date).substring(5), h.branch_id)));
    const toInsert = source
      .filter(h => !existingKeys.has(keyOf(toDateStr(h.date).substring(5), h.branch_id)))
      .map(h => ({
        name: h.name, type: h.type, description: h.description || '',
        specific_msg: h.specific_msg || '', organization_id: oId, branch_id: h.branch_id ?? null,
        date: `${to_year}-${toDateStr(h.date).substring(5)}`,
      }));
    let copied = 0;
    if (toInsert.length > 0) {
      const { data: inserted, error } = await db.from('holidays').insert(toInsert).select();
      if (error) throw error;
      copied = (inserted || []).length;
    }
    res.json({ copied, skipped: source.length - toInsert.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/holidays/bulk — import multiple holidays into the caller's scope (fields whitelisted;
// branch_id from the client is never trusted)
router.post('/bulk', auth, hasPermission('holidays', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { holidays } = req.body;
    if (!Array.isArray(holidays) || holidays.length === 0)
      return res.status(400).json({ error: 'holidays array is required' });
    const resolved = await resolveTargets(req, req.body);
    if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });

    const rows = [];
    for (const branchId of resolved.targets) {
      for (const h of holidays) {
        if (!h?.name || !h?.date) return res.status(400).json({ error: 'Each holiday needs a name and a date' });
        rows.push({
          name: h.name, date: h.date, type: h.type || 'public', description: h.description || '',
          specific_msg: h.specific_msg || '', organization_id: oId, branch_id: branchId,
        });
      }
    }
    const { data, error } = await db.from('holidays').insert(rows).select();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.applyHolidayVisibility = applyHolidayVisibility;
