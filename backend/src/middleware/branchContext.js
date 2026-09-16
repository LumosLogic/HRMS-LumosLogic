/**
 * branchContext.js
 *
 * Optional middleware that enriches req with branch context.
 * Must run AFTER auth() middleware (requires req.user).
 *
 * Reads the requested branch from the X-Branch-Id request header.
 * Validates it belongs to the user's org and is within their access.
 *
 * After withBranchContext:
 *   req.branchContext = {
 *     orgId:               number,
 *     selectedBranchId:    number | null,   // null = "All Branches"
 *     isRootAdmin:         boolean,
 *     hasAllBranches:      boolean,
 *     accessibleBranchIds: number[] | null, // null = all branches in org
 *   }
 *
 * Usage in routes (informational — does not enforce):
 *   router.get('/employees', auth, withBranchContext, handler);
 *   // handler uses req.branchContext.selectedBranchId to filter (null = org-wide)
 *
 * Use requireValidBranch when the branch selection must be valid (not null):
 *   router.get('/endpoint', auth, requireValidBranch, handler);
 */

const { getUserBranchAccess, validateBranchAccess } = require('../services/branchService');

async function withBranchContext(req, res, next) {
  const orgId  = req.user?.organization_id;
  const userId = req.user?.id;
  const role   = req.user?.role;

  if (!orgId || !userId) {
    req.branchContext = {
      orgId: null,
      selectedBranchId: null,
      isRootAdmin: false,
      hasAllBranches: false,
      accessibleBranchIds: [],
    };
    return next();
  }

  const rawHeader = req.headers['x-branch-id'];
  const requestedBranchId = rawHeader ? (parseInt(rawHeader, 10) || null) : null;

  const access = await getUserBranchAccess(userId, orgId, role);

  let selectedBranchId = null;

  if (requestedBranchId) {
    const isValid = await validateBranchAccess(userId, orgId, role, requestedBranchId);
    selectedBranchId = isValid ? requestedBranchId : null;
  }

  req.branchContext = {
    orgId,
    selectedBranchId,
    isRootAdmin: access.isRootAdmin,
    hasAllBranches: access.hasAllBranches,
    accessibleBranchIds: access.branchIds,
  };

  next();
}

/**
 * Strict variant: rejects with 403 if an invalid/inaccessible branch ID was provided.
 * Only use on routes where branch context must be trustworthy.
 */
async function requireValidBranch(req, res, next) {
  const rawHeader = req.headers['x-branch-id'];
  const requestedBranchId = rawHeader ? (parseInt(rawHeader, 10) || null) : null;

  if (!requestedBranchId) {
    // No branch requested — acceptable (org-wide)
    return withBranchContext(req, res, next);
  }

  const orgId  = req.user?.organization_id;
  const userId = req.user?.id;
  const role   = req.user?.role;

  const isValid = await validateBranchAccess(userId, orgId, role, requestedBranchId);
  if (!isValid) {
    return res.status(403).json({ error: 'You do not have access to the requested branch.' });
  }

  return withBranchContext(req, res, next);
}

module.exports = { withBranchContext, requireValidBranch };
