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
const { loadPendingApprovals } = require('../../services/pendingApprovalsSummary');

// The loading/dedupe logic lives in services/pendingApprovalsSummary so the dashboards count exactly what this page lists.
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    // A branch the caller may not use is rejected by withBranchContext before we get here (403), so a part
    // failing with 403 can only be a missing per-endpoint permission — reported as empty, like the old page did.
    res.json(await loadPendingApprovals(req));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
