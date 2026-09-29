const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');

// GET /api/holidays
// Returns org-wide holidays (branch_id IS NULL) + branch-specific holidays for the selected branch.
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { year } = req.query;
    const branchState = getFilterState(req.branchContext);
    let q = db.from('holidays').select('*').eq('organization_id', oId).order('date');
    if (year) q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
    // Branch filtering: show org-wide + selected branch holidays
    if (branchState.type === 'specific') {
      q = q.or(`branch_id.is.null,branch_id.eq.${branchState.branchId}`);
    } else if (branchState.type === 'multi') {
      q = q.or(`branch_id.is.null,branch_id.in.(${branchState.branchIds.join(',')})`);
    }
    // type=all: show everything; no filter needed
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/holidays
router.post('/', auth, hasPermission('holidays', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { name, date, type, description, specific_msg } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'Name and date are required' });
    const branchId = req.branchContext?.selectedBranchId || null;

    // Prevent duplicate holiday on same date within the same scope (branch or org-wide)
    let dupQ = db.from('holidays').select('id, name').eq('date', date).eq('organization_id', oId);
    if (branchId) dupQ = dupQ.eq('branch_id', branchId);
    else dupQ = dupQ.is('branch_id', null);
    const { data: existing } = await dupQ.maybeSingle();
    if (existing) {
      return res.status(409).json({
        error: `A holiday already exists on ${date}: "${existing.name}". Delete or edit it first.`,
        existing_id: existing.id,
      });
    }

    const { data, error } = await db.from('holidays')
      .insert({ name, date, type: type || 'public', description: description || '', specific_msg: specific_msg || '', organization_id: oId, branch_id: branchId })
      .select().single();
    if (error) throw error;

    // Auto-mark attendance as 'holiday' — only for employees in this branch (or all if org-wide)
    let empQ = db.from('users').select('id, branch_id').eq('organization_id', oId).eq('role', 'employee').eq('employee_status', 'active');
    empQ.then(async ({ data: employees }) => {
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

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/holidays/:id
router.put('/:id', auth, hasPermission('holidays', 'manage'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { name, date, type, description, specific_msg } = req.body;
    const { data, error } = await db.from('holidays')
      .update({ name, date, type, description: description || '', specific_msg: specific_msg || '' })
      .eq('id', req.params.id).eq('organization_id', oId)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/holidays/:id
router.delete('/:id', auth, hasPermission('holidays', 'manage'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { error } = await db.from('holidays')
      .delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/holidays/copy-from-year — EHN_Holidays_002
router.post('/copy-from-year', auth, hasPermission('holidays', 'manage'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { from_year, to_year } = req.body;
    if (!from_year || !to_year) return res.status(400).json({ error: 'from_year and to_year are required' });
    const { data: source } = await db.from('holidays')
      .select('*').eq('organization_id', oId)
      .gte('date', `${from_year}-01-01`).lte('date', `${from_year}-12-31`);
    if (!source?.length) return res.json({ copied: 0, skipped: 0, message: `No holidays found in ${from_year}` });
    const { data: existing } = await db.from('holidays')
      .select('date').eq('organization_id', oId)
      .gte('date', `${to_year}-01-01`).lte('date', `${to_year}-12-31`);
    // Use first 10 chars to handle both 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:...' formats
    const toDateStr = d => String(d).substring(0, 10);
    const existingDates = new Set((existing || []).map(h => toDateStr(h.date).substring(5)));
    const toInsert = source
      .filter(h => !existingDates.has(toDateStr(h.date).substring(5)))
      .map(h => ({
        name: h.name, type: h.type, description: h.description || '',
        specific_msg: h.specific_msg || '', organization_id: oId,
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

// POST /api/holidays/bulk — import multiple holidays
router.post('/bulk', auth, hasPermission('holidays', 'manage'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { holidays } = req.body;
    if (!Array.isArray(holidays) || holidays.length === 0)
      return res.status(400).json({ error: 'holidays array is required' });
    const rows = holidays.map(h => ({ ...h, organization_id: oId }));
    const { data, error } = await db.from('holidays').insert(rows).select();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
