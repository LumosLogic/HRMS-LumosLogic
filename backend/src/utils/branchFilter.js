/**
 * branchFilter.js
 *
 * Shared branch filter utilities for all HRMS route handlers.
 *
 * Implements the 4-state security model (Phase 1 verification finding):
 *
 *   A. specific   — selectedBranchId is set → filter to that branch only
 *   B. all        — hasAllBranches = true, no selectedBranchId → org-wide access
 *   C. multi      — limited HR with accessible branches, no selectedBranchId
 *                   → all their accessible branches
 *   D. none       — no accessible branches at all → return no data
 *
 * SECURITY RULE:
 *   selectedBranchId === null does NOT mean "All Branches".
 *   All-branch access is ONLY granted when hasAllBranches === true.
 *   Never collapse states B and D into the same code path.
 *
 * req.branchContext contract (set by withBranchContext middleware):
 *   {
 *     orgId:               number,
 *     selectedBranchId:    number | null,
 *     isRootAdmin:         boolean,
 *     hasAllBranches:      boolean,
 *     accessibleBranchIds: number[] | null,  // null = all org branches
 *   }
 */

const { pool } = require('../config/db');

// ─── Filter state derivation ─────────────────────────────────────────────────

/**
 * Derives the canonical filter state from a branchContext object.
 * Synchronous — no DB queries.
 *
 * Returns one of:
 *   { type: 'all' }                         — org-wide access
 *   { type: 'specific', branchId: number }  — single authorized branch
 *   { type: 'multi', branchIds: number[] }  — multiple authorized branches
 *   { type: 'none' }                        — no access (return empty)
 */
function getFilterState(branchContext) {
  const { selectedBranchId, hasAllBranches, accessibleBranchIds } = branchContext || {};

  // A: Specific authorized branch selected
  if (selectedBranchId) {
    return { type: 'specific', branchId: selectedBranchId };
  }

  // B: User has all-branches access → org-wide, no filter
  if (hasAllBranches) {
    return { type: 'all' };
  }

  // C: Limited HR with specific branch assignments, no branch selected
  if (Array.isArray(accessibleBranchIds) && accessibleBranchIds.length > 0) {
    return { type: 'multi', branchIds: accessibleBranchIds };
  }

  // D: No branch access configured — must return empty response
  return { type: 'none' };
}

// ─── Employee ID resolution ───────────────────────────────────────────────────

/**
 * Resolves the set of accessible employee (user) IDs for the current branch context.
 *
 * Use this for modules that don't have branch_id directly (attendance, leaves,
 * regularization, payslips) and derive branch through users.branch_id.
 *
 * Returns:
 *   null       → no filter needed (org-wide access) — do NOT add a WHERE clause
 *   []         → no accessible employees — caller must return empty response immediately
 *   [1,2,3,…] → restrict query to these user IDs
 *
 * Errors fail open (returns null) so a transient DB issue never breaks the UI.
 */
async function resolveEmployeeIds(branchContext, orgId) {
  const state = getFilterState(branchContext);

  if (state.type === 'all')  return null;  // org-wide, no filter
  if (state.type === 'none') return [];    // no access at all

  try {
    let result;
    if (state.type === 'specific') {
      result = await pool.query(
        `SELECT id FROM users WHERE organization_id = $1 AND branch_id = $2`,
        [orgId, state.branchId]
      );
    } else {
      // multi: accessible branch IDs (already validated against org in branchService)
      result = await pool.query(
        `SELECT id FROM users WHERE organization_id = $1 AND branch_id = ANY($2::bigint[])`,
        [orgId, state.branchIds]
      );
    }
    return result.rows.map(r => Number(r.id));
  } catch (err) {
    console.error('[branchFilter] resolveEmployeeIds error:', err.message);
    return null; // fail open — better to over-show than break the page
  }
}

// ─── SQL fragment helper (for pool.query raw SQL) ────────────────────────────

/**
 * Returns a SQL WHERE fragment for filtering directly on a users/employees table.
 * For use in pool.query() calls where you control the SQL.
 *
 * @param state         Result of getFilterState(branchContext)
 * @param paramOffset   The index of the last bound parameter already in the query.
 *                      The returned params will be numbered from paramOffset+1.
 * @param alias         Table alias for the users table (default 'u')
 *
 * Returns: { clause: string, params: any[] }
 *   clause = '' when no filter is needed (state 'all')
 *   caller must guard state 'none' separately and return early before calling this
 *
 * Usage:
 *   const bf = getBranchUserSQLFilter(state, 1, 'u');  // 1 param already ($1 = orgId)
 *   await pool.query(
 *     `SELECT * FROM users u WHERE u.organization_id = $1 ${bf.clause}`,
 *     [orgId, ...bf.params]
 *   );
 */
function getBranchUserSQLFilter(state, paramOffset = 0, alias = 'u') {
  const n = paramOffset + 1;
  if (state.type === 'all')      return { clause: '', params: [] };
  if (state.type === 'specific') return { clause: `AND ${alias}.branch_id = $${n}`,                    params: [state.branchId]  };
  if (state.type === 'multi')    return { clause: `AND ${alias}.branch_id = ANY($${n}::bigint[])`,     params: [state.branchIds] };
  // 'none' — caller should return early; this is a defensive fallback
  return { clause: 'AND 1=0', params: [] };
}

/**
 * Returns a SQL WHERE fragment for filtering through a joined users table.
 * Use this when the main table (attendance, leaves, payslips…) has user_id
 * and you need to filter by the users.branch_id via a JOIN.
 *
 * @param state         Result of getFilterState(branchContext)
 * @param paramOffset   Last bound param index already used in the query
 * @param userAlias     Alias for the users table in the JOIN (default 'u')
 *
 * Returns: { joinClause: string, whereClause: string, params: any[] }
 *
 * Usage (attendance example):
 *   const bf = getBranchJoinSQLFilter(state, 1);   // $1 = orgId already bound
 *   await pool.query(`
 *     SELECT a.* FROM attendance a
 *     JOIN users u ON u.id = a.user_id AND u.organization_id = a.organization_id
 *     WHERE a.organization_id = $1
 *       ${bf.whereClause}
 *   `, [orgId, ...bf.params]);
 */
function getBranchJoinSQLFilter(state, paramOffset = 0, userAlias = 'u') {
  const n = paramOffset + 1;
  if (state.type === 'all')      return { whereClause: '', params: [] };
  if (state.type === 'specific') return { whereClause: `AND ${userAlias}.branch_id = $${n}`,                  params: [state.branchId]  };
  if (state.type === 'multi')    return { whereClause: `AND ${userAlias}.branch_id = ANY($${n}::bigint[])`,   params: [state.branchIds] };
  return { whereClause: 'AND 1=0', params: [] };
}

module.exports = {
  getFilterState,
  resolveEmployeeIds,
  getBranchUserSQLFilter,
  getBranchJoinSQLFilter,
};
