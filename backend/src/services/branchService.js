/**
 * branchService.js
 *
 * Centralized service for resolving branch access.
 *
 * Access model:
 *   root_admin  → all branches in org (determined by role, no DB lookup)
 *   hr_admin    → branches listed in hr_branch_access (specific or all_branches flag)
 *   employee    → their own branch only (users.branch_id)
 *
 * This service does NOT enforce — it resolves context.
 * Enforcement is the responsibility of each route/middleware.
 */

const { pool } = require('../config/db');

/**
 * Resolves the branch access configuration for a user.
 *
 * @param {number|string} userId
 * @param {number|string} orgId
 * @param {string}        role   — users.role: 'root_admin' | 'admin' | 'employee'
 * @returns {{ isRootAdmin: boolean, hasAllBranches: boolean, branchIds: number[]|null }}
 *   branchIds = null  → all branches in org (root_admin or all_branches grant)
 *   branchIds = []    → no branch access configured
 *   branchIds = [...]  → specific branch IDs only
 */
async function getUserBranchAccess(userId, orgId, role) {
  if (role === 'root_admin') {
    return { isRootAdmin: true, hasAllBranches: true, branchIds: null };
  }

  try {
    const result = await pool.query(
      `SELECT branch_id, all_branches
       FROM hr_branch_access
       WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId]
    );

    if (!result.rows.length) {
      return { isRootAdmin: false, hasAllBranches: false, branchIds: [] };
    }

    const allBranchesRow = result.rows.find(r => r.all_branches === true);
    if (allBranchesRow) {
      return { isRootAdmin: false, hasAllBranches: true, branchIds: null };
    }

    const branchIds = result.rows
      .filter(r => r.branch_id != null)
      .map(r => Number(r.branch_id));

    return { isRootAdmin: false, hasAllBranches: false, branchIds };
  } catch (err) {
    // Table doesn't exist yet (pre-migration) — fail open
    if (err.message && err.message.includes('does not exist')) {
      return { isRootAdmin: false, hasAllBranches: role === 'admin', branchIds: null };
    }
    console.error('[branchService] getUserBranchAccess error:', err.message);
    return { isRootAdmin: false, hasAllBranches: false, branchIds: [] };
  }
}

/**
 * Returns full branch objects accessible to a user.
 *
 * @returns {{ branches: object[], hasAllBranches: boolean, isRootAdmin: boolean }}
 */
async function getAccessibleBranches(userId, orgId, role) {
  const access = await getUserBranchAccess(userId, orgId, role);

  try {
    let branchResult;
    if (access.isRootAdmin || access.hasAllBranches) {
      branchResult = await pool.query(
        `SELECT id, org_id, name, code, location, address, is_active, created_at
         FROM branches
         WHERE org_id = $1
         ORDER BY name`,
        [orgId]
      );
    } else if (access.branchIds && access.branchIds.length > 0) {
      branchResult = await pool.query(
        `SELECT id, org_id, name, code, location, address, is_active, created_at
         FROM branches
         WHERE org_id = $1 AND id = ANY($2::bigint[])
         ORDER BY name`,
        [orgId, access.branchIds]
      );
    } else {
      branchResult = { rows: [] };
    }

    return {
      branches: branchResult.rows,
      hasAllBranches: access.hasAllBranches,
      isRootAdmin: access.isRootAdmin,
    };
  } catch (err) {
    console.error('[branchService] getAccessibleBranches error:', err.message);
    return { branches: [], hasAllBranches: false, isRootAdmin: false };
  }
}

/**
 * Validates that a user can access a specific branch.
 *
 * Security guarantee: branch is always verified to belong to the user's org
 * before any role/access check. This prevents cross-org branch access by
 * simply changing the branch ID in a request.
 *
 * @param {number|string} userId
 * @param {number|string} orgId   — from JWT (authoritative)
 * @param {string}        role
 * @param {number|string} branchId
 * @returns {boolean}
 */
async function validateBranchAccess(userId, orgId, role, branchId) {
  if (!branchId) return false;
  const numBranchId = Number(branchId);
  if (!Number.isInteger(numBranchId) || numBranchId <= 0) return false;

  try {
    // Always verify the branch belongs to this org first (cross-org attack prevention)
    const orgCheck = await pool.query(
      `SELECT id FROM branches WHERE id = $1 AND org_id = $2`,
      [numBranchId, orgId]
    );
    if (!orgCheck.rows.length) return false;

    if (role === 'root_admin') return true;

    // Check HR/Admin specific access
    const accessResult = await pool.query(
      `SELECT id FROM hr_branch_access
       WHERE user_id = $1 AND org_id = $2
         AND (all_branches = TRUE OR branch_id = $3)
       LIMIT 1`,
      [userId, orgId, numBranchId]
    );
    return accessResult.rows.length > 0;
  } catch (err) {
    if (err.message && err.message.includes('does not exist')) {
      return role === 'root_admin' || role === 'admin';
    }
    console.error('[branchService] validateBranchAccess error:', err.message);
    return false;
  }
}

module.exports = { getUserBranchAccess, getAccessibleBranches, validateBranchAccess };
