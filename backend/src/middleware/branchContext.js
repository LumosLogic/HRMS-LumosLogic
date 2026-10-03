/**
 * branchContext.js
 *
 * Enriches req with branch context. Must run AFTER auth() (requires req.user).
 *
 * Reads the requested branch from the X-Branch-Id request header and validates it
 * belongs to the user's org and is within their access. An invalid / inaccessible
 * branch is REJECTED (403, code BRANCH_FORBIDDEN) — it is never silently downgraded
 * to "no selection", which for root admins would mean All Branches.
 *
 * After withBranchContext:
 *   req.branchContext = {
 *     orgId, selectedBranchId (number|null), isRootAdmin, hasAllBranches,
 *     accessibleBranchIds (number[]|null — null = all branches in org),
 *   }
 *
 * Idempotent: if a previous middleware already resolved the context for this request
 * it is reused (no repeated lookups).
 */

const { getUserBranchAccess, validateBranchAccess } = require('../services/branchService');

function parseBranchHeader(req) {
  const raw = req.headers['x-branch-id'];
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return { requested: null, invalid: false };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return { requested: null, invalid: true };
  return { requested: n, invalid: false };
}

const FORBIDDEN = { error: 'You do not have access to the requested branch.', code: 'BRANCH_FORBIDDEN' };

async function withBranchContext(req, res, next) {
  try {
    if (req.branchContext && req.branchContext._resolved) return next();

    const orgId  = req.user?.organization_id;
    const userId = req.user?.id;
    const role   = req.user?.role;

    if (!orgId || !userId) {
      req.branchContext = {
        orgId: null, selectedBranchId: null, isRootAdmin: false,
        hasAllBranches: false, accessibleBranchIds: [], _resolved: true,
      };
      return next();
    }

    const { requested, invalid } = parseBranchHeader(req);
    if (invalid) return res.status(403).json(FORBIDDEN);

    const access = await getUserBranchAccess(userId, orgId, role);

    let selectedBranchId = null;
    if (requested) {
      const ok = await validateBranchAccess(userId, orgId, role, requested);
      if (!ok) return res.status(403).json(FORBIDDEN);
      selectedBranchId = requested;
    }

    req.branchContext = {
      orgId,
      selectedBranchId,
      isRootAdmin: access.isRootAdmin,
      hasAllBranches: access.hasAllBranches,
      accessibleBranchIds: access.branchIds,
      _resolved: true,
    };
    next();
  } catch (err) {
    console.error('[branchContext] error:', err.message);
    res.status(500).json({ error: 'Failed to resolve branch context' });
  }
}

/** Strict variant kept for API compatibility: same behaviour as withBranchContext. */
const requireValidBranch = withBranchContext;

module.exports = { withBranchContext, requireValidBranch };
