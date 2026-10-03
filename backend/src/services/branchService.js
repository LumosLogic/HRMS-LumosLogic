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
// Short-lived per-user cache: every branch-aware request resolves access and the answer
// only changes when an admin edits grants/branches/employee branch. Mutation routes call
// clearBranchAccessCache(); the TTL bounds any path that misses it.
const _accessCache = new Map();
const ACCESS_TTL_MS = 30 * 1000;

function clearBranchAccessCache(userId = null, orgId = null) {
  if (userId == null && orgId == null) { _accessCache.clear(); return; }
  for (const k of [..._accessCache.keys()]) {
    const [u, o] = k.split(':');
    if ((userId == null || String(userId) === u) && (orgId == null || String(orgId) === o)) _accessCache.delete(k);
  }
}

async function getUserBranchAccess(userId, orgId, role) {
  const key = `${userId}:${orgId}:${role}`;
  const hit = _accessCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  const value = await _resolveUserBranchAccess(userId, orgId, role);
  if (_accessCache.size > 5000) _accessCache.clear();
  _accessCache.set(key, { value, exp: Date.now() + ACCESS_TTL_MS });
  return value;
}

/**
 * Is branch separation switched ON for this organisation?
 * organization_features(feature_key = 'branches'): an explicit enabled = FALSE means OFF; no row
 * (or an unreadable table) keeps the historical default of ON, exactly like featureFlag.js.
 */
async function isBranchFeatureEnabled(orgId) {
  try {
    const { rows } = await pool.query(
      `SELECT enabled FROM organization_features WHERE organization_id = $1 AND feature_key = 'branches' LIMIT 1`,
      [orgId]
    );
    return rows.length ? rows[0].enabled !== false : true;
  } catch { return true; }
}

async function _resolveUserBranchAccess(userId, orgId, role) {
  if (role === 'root_admin') {
    return { isRootAdmin: true, hasAllBranches: true, branchIds: null };
  }

  // Branches feature OFF → no branch isolation: existing org-wide behaviour is untouched for everyone.
  if (!(await isBranchFeatureEnabled(orgId))) {
    return { isRootAdmin: false, hasAllBranches: true, branchIds: null };
  }

  // Employees (incl. dept heads / custom-role employees) are bound to their own branch
  // (users.branch_id). Extra permissions never widen this to org-wide access.
  // Orgs with no active branch (feature off / not set up) keep org-wide behaviour.
  if (role !== 'admin') {
    try {
      const own = await pool.query(
        `SELECT branch_id FROM users WHERE id = $1 AND organization_id = $2`, [userId, orgId]);
      const nb = await pool.query(
        `SELECT COUNT(*)::int AS c FROM branches WHERE org_id = $1 AND is_active = TRUE`, [orgId]);
      if ((nb.rows[0]?.c || 0) === 0) return { isRootAdmin: false, hasAllBranches: true, branchIds: null };
      const bid = own.rows[0]?.branch_id;
      return { isRootAdmin: false, hasAllBranches: false, branchIds: bid != null ? [Number(bid)] : [] };
    } catch (err) {
      if (err.message && err.message.includes('does not exist')) {
        return { isRootAdmin: false, hasAllBranches: true, branchIds: null };
      }
      console.error('[branchService] employee branch access error:', err.message);
      return { isRootAdmin: false, hasAllBranches: false, branchIds: [] };
    }
  }

  try {
    const result = await pool.query(
      `SELECT branch_id, all_branches
       FROM hr_branch_access
       WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId]
    );

    if (!result.rows.length) {
      // No explicit branch grants — check how many branches this org has.
      // 0 branches → org has branches disabled (feature OFF); grant full org-wide access.
      // 1 branch   → single-branch org; implicitly grant that branch so HR can work.
      // 2+ branches → explicit grants required; deny access (return empty branchIds).
      try {
        const sb = await pool.query(
          `SELECT id FROM branches WHERE org_id = $1 AND is_active = TRUE`,
          [orgId]
        );
        if (sb.rows.length === 0) {
          // No branches at all — org is operating without the branches feature.
          // Treat as org-wide access so dashboards and all admin pages work normally.
          return { isRootAdmin: false, hasAllBranches: true, branchIds: null };
        }
        if (sb.rows.length === 1) {
          return { isRootAdmin: false, hasAllBranches: false, branchIds: [Number(sb.rows[0].id)] };
        }
      } catch (sbErr) {
        if (!sbErr.message?.includes('does not exist')) {
          console.error('[branchService] single-branch fallback error:', sbErr.message);
        }
      }
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

    // HR/Admin and employees: resolve through the single access model (cached).
    const access = await getUserBranchAccess(userId, orgId, role);
    if (access.hasAllBranches) return true;
    return (access.branchIds || []).map(Number).includes(numBranchId);
  } catch (err) {
    if (err.message && err.message.includes('does not exist')) {
      return role === 'root_admin' || role === 'admin';
    }
    console.error('[branchService] validateBranchAccess error:', err.message);
    return false;
  }
}

/**
 * Validates a list of branch IDs in one pass (org ownership + caller access).
 * Returns { ok: true, ids } or { ok: false, error }. null/[] is ok with ids = [].
 */
async function validateBranchIdList(userId, orgId, role, branchIds) {
  if (branchIds == null) return { ok: true, ids: [] };
  if (!Array.isArray(branchIds)) return { ok: false, error: 'branch ids must be an array' };
  const ids = [...new Set(branchIds.map(Number))];
  if (ids.some(n => !Number.isInteger(n) || n <= 0)) return { ok: false, error: 'Invalid branch ID(s)' };
  if (!ids.length) return { ok: true, ids: [] };
  const org = await pool.query(
    `SELECT id FROM branches WHERE org_id = $1 AND id = ANY($2::bigint[])`, [orgId, ids]);
  if (org.rows.length !== ids.length) return { ok: false, error: 'One or more branches do not belong to your organization.' };
  if (role === 'root_admin') return { ok: true, ids };
  const access = await getUserBranchAccess(userId, orgId, role);
  if (access.hasAllBranches) return { ok: true, ids };
  const allowed = new Set((access.branchIds || []).map(Number));
  if (ids.some(n => !allowed.has(n))) return { ok: false, error: 'You do not have access to one or more of the specified branches.' };
  return { ok: true, ids };
}

module.exports = { isBranchFeatureEnabled, getUserBranchAccess, getAccessibleBranches, validateBranchAccess, validateBranchIdList, clearBranchAccessCache };
