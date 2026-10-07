/**
 * teamScope.js — who a Manager / Head of Department may see.
 *
 * No new relationship is stored; the scope is DERIVED from the existing data:
 *   Manager → users.reporting_to = me                       (direct reports)
 *   HOD     → departments.head_user_id = me  →  members of those departments
 *             (users.department_id or a user_departments row)
 *
 * Isolation rules (every query is org-bound):
 *   • Organisation: only users of the caller's organisation.
 *   • Branch: when the branches feature is ON and the caller has a branch, only people of the caller's branch are
 *     in scope. When branching is OFF the scope is organisation-wide (branch_id is ignored).
 *   • Never the caller; never inactive / terminated accounts.
 * A manager does NOT get organisation-wide access; scope is exactly this id list.
 */
const { pool } = require('../config/db');
const { isBranchFeatureEnabled } = require('./branchService');

const TTL_MS = 30 * 1000;
const _cache = new Map(); // `${orgId}:${userId}` -> { at, value }

function clearTeamScopeCache(orgId = null) {
  if (orgId == null) { _cache.clear(); return; }
  for (const k of _cache.keys()) if (k.startsWith(`${orgId}:`)) _cache.delete(k);
}

/** @returns {Promise<{managerIds:number[], hodIds:number[], memberIds:number[], departmentIds:number[], isManager:boolean, isHod:boolean}>} */
async function getTeamScope(userId, orgId) {
  const key = `${orgId}:${userId}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const empty = { managerIds: [], hodIds: [], memberIds: [], departmentIds: [], isManager: false, isHod: false };
  if (!userId || !orgId) return empty;

  const me = await pool.query('SELECT branch_id FROM users WHERE id = $1 AND organization_id = $2', [userId, orgId]);
  if (!me.rows.length) return empty;
  const branchOn = me.rows[0].branch_id != null && await isBranchFeatureEnabled(orgId);
  const branchSql = branchOn ? 'AND u.branch_id = $3' : '';
  const base = [userId, orgId];
  const params = branchOn ? [...base, me.rows[0].branch_id] : base;
  const live = `AND COALESCE(u.employee_status, 'active') NOT IN ('inactive', 'terminated')`;

  const mgr = await pool.query(
    `SELECT u.id FROM users u
      WHERE u.reporting_to = $1 AND u.organization_id = $2 AND u.id <> $1 ${live} ${branchSql}`, params);

  const depts = await pool.query(
    'SELECT id FROM departments WHERE head_user_id = $1 AND organization_id = $2', base);
  const departmentIds = depts.rows.map(r => Number(r.id));

  let hodRows = [];
  if (departmentIds.length) {
    const p = branchOn ? [userId, orgId, me.rows[0].branch_id, departmentIds] : [userId, orgId, departmentIds];
    const di = branchOn ? '$4' : '$3';
    hodRows = (await pool.query(
      `SELECT DISTINCT u.id FROM users u
        WHERE u.organization_id = $2 AND u.id <> $1 ${live} ${branchSql}
          AND ( u.department_id = ANY(${di}::bigint[])
                OR EXISTS (SELECT 1 FROM user_departments ud
                            WHERE ud.user_id = u.id AND ud.organization_id = $2
                              AND ud.department_id = ANY(${di}::bigint[])) )`, p)).rows;
  }

  const managerIds = mgr.rows.map(r => Number(r.id));
  const hodIds     = hodRows.map(r => Number(r.id));
  const value = {
    managerIds, hodIds,
    memberIds: [...new Set([...managerIds, ...hodIds])],
    departmentIds,
    isManager: managerIds.length > 0,
    isHod: departmentIds.length > 0,
  };
  if (_cache.size > 2000) _cache.clear();
  _cache.set(key, { at: Date.now(), value });
  return value;
}

/** Is `targetId` inside the caller's team scope? (self is NOT in scope — self-access has its own paths) */
async function isInTeamScope(callerId, targetId, orgId) {
  const t = Number(targetId);
  if (!Number.isInteger(t) || t <= 0) return false;
  const s = await getTeamScope(callerId, orgId);
  return s.memberIds.includes(t);
}

module.exports = { getTeamScope, isInTeamScope, clearTeamScopeCache };
