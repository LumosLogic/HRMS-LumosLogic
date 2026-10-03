/**
 * announcementTargeting.js
 *
 * Branch targeting for announcements (shared by the route and the scheduled publisher so the
 * in-app / email / scheduled recipient rules are identical).
 *
 *   announcements.branch_ids  NULL / empty → organisation-wide (every branch)
 *                             [ids]        → only those branches
 *
 * Employee audience is decided by users.branch_id. Admin audience: root admins always; HR admins
 * when they hold an all-branches grant, a grant on one of the target branches, or created it.
 */
const { pool } = require('../config/db');

function parseBranchIds(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map(Number).filter(Number.isFinite);
  // pg array text form "{1,2}"
  return String(v).replace(/[{}]/g, '').split(',').map(s => Number(s.trim())).filter(Number.isFinite);
}

/** Filters a user list to those an announcement targeted at `branchIds` should reach. */
async function filterUsersByBranchTargets(oId, users, branchIds, creatorId = null) {
  const ids = parseBranchIds(branchIds);
  if (!ids.length) return users; // organisation-wide
  const target = new Set(ids);
  let grants = [];
  try {
    const { rows } = await pool.query(
      'SELECT user_id, branch_id, all_branches FROM hr_branch_access WHERE org_id = $1', [oId]);
    grants = rows;
  } catch { /* table absent: treat HR as unrestricted */ grants = null; }
  return users.filter(u => {
    if (u.role === 'root_admin') return true;
    if (u.role === 'admin') {
      if (creatorId != null && Number(u.id) === Number(creatorId)) return true;
      if (grants === null) return true;
      return grants.some(g => Number(g.user_id) === Number(u.id) && (g.all_branches === true || target.has(Number(g.branch_id))));
    }
    return u.branch_id != null && target.has(Number(u.branch_id));
  });
}

/**
 * May the viewer see this announcement? Org-wide: yes. Targeted: all-branch viewers, the
 * creator, or viewers whose branch scope intersects the targets.
 */
function announcementVisibleToViewer(ann, branchContext, viewerId) {
  const ids = parseBranchIds(ann.branch_ids);
  if (!ids.length) return true;
  if (ann.created_by != null && Number(ann.created_by) === Number(viewerId)) return true;
  if (branchContext?.hasAllBranches) return true;
  const mine = branchContext?.selectedBranchId
    ? [Number(branchContext.selectedBranchId)]
    : (branchContext?.accessibleBranchIds || []).map(Number);
  return ids.some(b => mine.includes(b));
}

module.exports = { parseBranchIds, filterUsersByBranchTargets, announcementVisibleToViewer };
