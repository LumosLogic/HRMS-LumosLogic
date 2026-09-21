const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth, adminOnly } = require('../../middleware/auth');
const { orgId } = require('../../utils/helpers');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');

// Returns the set of branch IDs the caller can access, or null for org-wide (Root Admin).
function accessibleBranchIdSet(branchContext) {
  const state = getFilterState(branchContext);
  if (state.type === 'all')      return null;           // Root Admin — no restriction
  if (state.type === 'specific') return new Set([state.branchId]);
  if (state.type === 'multi')    return new Set(state.branchIds);
  return new Set();                                     // 'none' — no access
}

// Checks whether an archive item is visible to the caller.
// Non-user records are always visible to any admin.
// User records (archived employees) are filtered by branch.
function isArchiveVisible(item, branchSet) {
  if (branchSet === null) return true;         // Root Admin sees all
  if (item.table_name !== 'users') return true; // non-employee archives: org-wide
  const bid = item.record?.branch_id;
  if (bid == null) return false;               // unbranded employee — Root Admin only
  return branchSet.has(Number(bid));
}

// ─── Archives: List ───────────────────────────────────────────────────────────
// Root Admin: all archived records. HR Admin: user records for their branches only.
router.get('/', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const { data, error } = await db.from('archives')
      .select('*')
      .eq('organization_id', orgId(req))
      .order('archived_at', { ascending: false });
    if (error) throw new Error(error.message);

    const branchSet = accessibleBranchIdSet(req.branchContext);
    if (branchSet !== null && branchSet.size === 0) return res.json([]);
    res.json((data || []).filter(item => isArchiveVisible(item, branchSet)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Archives: Restore ────────────────────────────────────────────────────────
// HR Admin can only restore employees in their accessible branches.
router.post('/:id/restore', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const { data: item, error: fe } = await db.from('archives')
      .select('*').eq('id', req.params.id).eq('organization_id', orgId(req)).single();
    if (fe || !item) return res.status(404).json({ error: 'Archive record not found' });

    const branchSet = accessibleBranchIdSet(req.branchContext);
    if (!isArchiveVisible(item, branchSet))
      return res.status(403).json({ error: "You do not have access to this employee's branch" });

    const { id: _, ...recordToInsert } = item.record;
    const { error: ie } = await db.from(item.table_name).insert(recordToInsert);
    if (ie) throw new Error(ie.message);
    await db.from('archives').delete().eq('id', req.params.id);
    res.json({ success: true, message: 'Record restored successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
