'use strict';
// ONE definition of "what is pending for this caller", shared by the Pending Approvals page and both dashboards.
//
// Each part is the existing list endpoint executed in-process (utils/internalDispatch), so RBAC, branch isolation and
// the returned rows are identical to what the page shows. The dashboards used to run their own head-counts with
// different employee scopes and status sets (e.g. expenses 'pending' only, active employees only), so the card and the
// page disagreed (BUG_116 / BUG_191 / Tisha Bug_025). Counting from this one result removes that drift by construction.
const { dispatchGet } = require('../utils/internalDispatch');

const LEAVE_STATUSES = 'pending,pending_approval,pending_dept,pending_root';

async function loadPendingApprovals(req) {
  // Required lazily: the routers themselves pull in a lot of the app, and this module is imported by route files.
  const leavesRouter = require('../modules/leaves/leaves.routes');
  const regularizationRouter = require('../modules/regularization/regularization.routes');
  const expensesRouter = require('../modules/expenses/expenses.routes');

  const parts = {
    leaves:          dispatchGet(leavesRouter, '/', { status: LEAVE_STATUSES, view: 'list' }, req),
    my_approvals:    dispatchGet(leavesRouter, '/my-approvals', {}, req),
    regularizations: dispatchGet(regularizationRouter, '/', { status: 'pending', view: 'list' }, req),
    expenses:        dispatchGet(expensesRouter, '/', { status: 'pending,manager_approved', view: 'list' }, req),
  };
  const keys = Object.keys(parts);
  const results = await Promise.all(keys.map(k => parts[k]));
  const out = { failed: [] };
  keys.forEach((k, i) => {
    const r = results[i];
    if (r.status >= 200 && r.status < 300 && Array.isArray(r.body)) out[k] = r.body;
    else { out[k] = []; out.failed.push(k); }
  });
  // A leave the caller must act on appears in BOTH `leaves` and `my_approvals`; send/count each leave once.
  if (out.leaves.length && out.my_approvals.length) {
    const mine = new Set(out.my_approvals.map(l => String(l.id)));
    out.leaves = out.leaves.filter(l => !mine.has(String(l.id)));
  }
  return out;
}

// The page's "Total Pending" = my_approvals + remaining leaves + regularizations + expenses.
function countPending(out) {
  const leaves = (out.leaves?.length || 0) + (out.my_approvals?.length || 0);
  const regularizations = out.regularizations?.length || 0;
  const expenses = out.expenses?.length || 0;
  return { leaves, regularizations, expenses, total: leaves + regularizations + expenses };
}

module.exports = { loadPendingApprovals, countPending, LEAVE_STATUSES };
