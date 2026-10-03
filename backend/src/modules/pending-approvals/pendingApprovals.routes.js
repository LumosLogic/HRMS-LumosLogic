// GET /api/pending-approvals — everything the Pending Approvals page needs, in ONE request.
//
// Replaces the page's five overlapping 30-second polls (/leaves, /leaves/pending-root, /leaves/my-approvals,
// /regularization, /expenses) with a single call. It does not re-implement any query: each part is the
// existing endpoint executed in-process (utils/internalDispatch), so RBAC, branch isolation and the
// returned rows are identical to calling those endpoints directly — only the status filter is now applied
// server-side instead of downloading the whole history and discarding it in the browser.
//
//   leaves           pending leaves visible to the caller (statuses pending | pending_approval | pending_dept | pending_root)
//   my_approvals     workflow leaves where THIS user must act (enriched with current_level_*)
//   regularizations  pending regularization requests
//   expenses         pending + manager_approved expense claims
//   failed           names of parts that could not be loaded (the page treats those as empty, as before)
//
// /leaves/pending-root is intentionally not part of the summary: every row it returned that the page used is a
// pending_root leave, which `leaves` already contains (same org + branch filter).
const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware/auth');
const { withBranchContext } = require('../../middleware/branchContext');
const { dispatchGet } = require('../../utils/internalDispatch');
const leavesRouter = require('../leaves/leaves.routes');
const regularizationRouter = require('../regularization/regularization.routes');
const expensesRouter = require('../expenses/expenses.routes');

const LEAVE_STATUSES = 'pending,pending_approval,pending_dept,pending_root';

router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const parts = {
      leaves:          dispatchGet(leavesRouter, '/', { status: LEAVE_STATUSES }, req),
      my_approvals:    dispatchGet(leavesRouter, '/my-approvals', {}, req),
      regularizations: dispatchGet(regularizationRouter, '/', { status: 'pending' }, req),
      expenses:        dispatchGet(expensesRouter, '/', { status: 'pending,manager_approved' }, req),
    };
    const keys = Object.keys(parts);
    const results = await Promise.all(keys.map(k => parts[k]));
    const out = { failed: [] };
    keys.forEach((k, i) => {
      const r = results[i];
      if (r.status >= 200 && r.status < 300 && Array.isArray(r.body)) out[k] = r.body;
      else { out[k] = []; out.failed.push(k); }
    });
    // A branch the caller may not use is rejected by withBranchContext before we get here (403), so a part
    // failing with 403 can only be a missing per-endpoint permission — report it as empty, like the old page did.
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
