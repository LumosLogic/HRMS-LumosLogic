/**
 * broadcastTargeting.js
 *
 * ONE recipient rule for broadcast email and push so the two channels can never disagree.
 *
 *   target_user_id / target_user_ids  → exactly those users; every id must be in the caller's
 *                                       organisation AND branch scope
 *   branch_ids                        → active employees of those branches (validated)
 *   (nothing)                         → active employees in the caller's scope:
 *                                       all-branch callers → whole organisation
 *                                       restricted HR      → the selected branch, else their branches
 *
 * Returns { ok: true, users: [{ id, email, name }] } or { ok: false, status, error }.
 */
const { pool } = require('../config/db');
const { getFilterState, assertUsersAccessible } = require('./branchFilter');
const { validateBranchIdList } = require('../services/branchService');

const ACTIVE = `(employee_status IS NULL OR employee_status NOT IN ('inactive','resigned','terminated'))`;

async function resolveBroadcastRecipients(req, body = {}) {
  const oId = req.user.organization_id;
  const ctx = req.branchContext;

  const explicit = Array.isArray(body.target_user_ids) && body.target_user_ids.length
    ? body.target_user_ids
    : (body.target_user_id ? [body.target_user_id] : null);

  if (explicit) {
    const acc = await assertUsersAccessible(ctx, explicit.map(n => parseInt(n, 10)), oId);
    if (!acc.ok) return { ok: false, status: 403, error: "One or more recipients are outside your organisation or branch access." };
    const { rows } = await pool.query(
      'SELECT id, email, name FROM users WHERE organization_id = $1 AND id = ANY($2::bigint[])', [oId, acc.ids]);
    return { ok: true, users: rows };
  }

  if (Array.isArray(body.branch_ids) && body.branch_ids.length) {
    const v = await validateBranchIdList(req.user.id, oId, req.user.role, body.branch_ids);
    if (!v.ok) return { ok: false, status: 403, error: v.error };
    const { rows } = await pool.query(
      `SELECT id, email, name FROM users WHERE organization_id = $1 AND role = 'employee' AND ${ACTIVE} AND branch_id = ANY($2::bigint[])`,
      [oId, v.ids]);
    return { ok: true, users: rows };
  }

  const state = getFilterState(ctx);
  if (state.type === 'none') return { ok: true, users: [] };
  const params = [oId];
  let clause = '';
  if (state.type === 'specific') { params.push(state.branchId);  clause = 'AND branch_id = $2'; }
  if (state.type === 'multi')    { params.push(state.branchIds); clause = 'AND branch_id = ANY($2::bigint[])'; }
  const { rows } = await pool.query(
    `SELECT id, email, name FROM users WHERE organization_id = $1 AND role = 'employee' AND ${ACTIVE} ${clause}`, params);
  return { ok: true, users: rows };
}

module.exports = { resolveBroadcastRecipients };
