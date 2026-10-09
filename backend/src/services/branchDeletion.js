/**
 * branchDeletion — Root-Admin branch removal with two modes. The branch row is NEVER physically deleted (payroll runs,
 * payslips, attendance, leave and audit history keep their branch; a physical delete would also have turned branch-only
 * holidays / leave policies / shifts / assets into org-wide rows through their ON DELETE SET NULL foreign keys).
 *
 *   mode 'move'        employees + the data they work with move to ANOTHER branch, then the old branch is hidden:
 *                        users (all statuses), assets, employee documents, shifts, biometric devices.
 *                        HR admins of the old branch are granted the target branch (the old grant is removed).
 *                        Kept with the hidden branch (moving them would change the OTHER branch's calendar, policies or
 *                        payroll): holidays, leave policies, work-schedule override, config-group membership,
 *                        announcements, roles, payroll runs / scheduler runs.
 *   mode 'soft_delete' branch hidden, its remaining employee accounts deactivated (login blocked, sessions revoked),
 *                        HR access to it removed. Everything else is left untouched for history / audit.
 *
 * Both modes: one transaction, blockers validated first (unfinished payroll run, bad target), an audit row in
 * branch_deletion_log with the counts, and the branch is hidden through branches.deleted_at (+ is_active = false, which
 * every "valid working branch" check already honours, so no new operation can target it).
 */
'use strict';
const { pool } = require('../config/db');
const { legacyStatusFor } = require('../utils/employeeStatus');

class BranchDeleteError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

const PENDING_LEAVE = ['pending', 'pending_dept', 'pending_root', 'pending_approval'];
const PAYROLL_SETTLED = ['paid', 'failed', 'draft'];   // any other status is a run that has not been paid out yet
const EXCLUDED_EMP = ['inactive', 'resigned', 'terminated'];

let _hasCol = false;
async function hasSoftDeleteColumn() {
  if (_hasCol) return true;
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'branches' AND column_name = 'deleted_at'`);
  _hasCol = rows.length > 0;
  return _hasCol;
}

// Query runner that survives a missing optional table: inside a transaction every probe is wrapped in a SAVEPOINT
// (a failed statement would otherwise abort the whole transaction); outside one it is a plain try/catch.
function runner(client) {
  let n = 0;
  return {
    async q(sql, params = []) { return (client || pool).query(sql, params); },
    async probe(sql, params = []) {
      if (!client) { try { return (await pool.query(sql, params)).rows; } catch { return null; } }
      const sp = `p${++n}`;
      await client.query(`SAVEPOINT ${sp}`);
      try { const r = (await client.query(sql, params)).rows; await client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
      catch { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); return null; }
    },
  };
}

async function summarize(r, oId, branchId) {
  const n = async (sql, p) => { const rows = await r.probe(sql, p); return rows ? Number(rows[0]?.c ?? 0) : 0; };
  const emp = (await r.probe(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE role = 'employee' AND (employee_status IS NULL OR employee_status <> ALL($3::text[])))::int AS active_employees,
            COUNT(*) FILTER (WHERE role = 'employee' AND employee_status = ANY($3::text[]))::int AS inactive_employees,
            COUNT(*) FILTER (WHERE role = 'admin')::int AS hr_admin_users
       FROM users WHERE branch_id = $1 AND organization_id = $2`, [branchId, oId, EXCLUDED_EMP]))?.[0] || {};
  const base = (t, org = 'organization_id') => `SELECT COUNT(*)::int AS c FROM ${t} WHERE branch_id = $1 AND ${org} = $2`;
  return {
    employees_total: emp.total || 0,
    employees_active: emp.active_employees || 0,
    employees_inactive: emp.inactive_employees || 0,
    hr_admin_accounts: emp.hr_admin_users || 0,
    hr_admins_with_access: await n(`SELECT COUNT(DISTINCT user_id)::int AS c FROM hr_branch_access WHERE branch_id = $1 AND org_id = $2`, [branchId, oId]),
    assets: await n(base('assets'), [branchId, oId]),
    employee_documents: await n(base('employee_documents'), [branchId, oId]),
    shifts: await n(base('shifts'), [branchId, oId]),
    biometric_devices: await n(base('biometric_devices', 'org_id'), [branchId, oId]),
    holidays: await n(base('holidays'), [branchId, oId]),
    leave_policies: await n(base('leave_policies'), [branchId, oId]),
    work_schedule_override: await n(base('branch_work_schedule'), [branchId, oId]),
    payroll_runs: await n(base('payroll_runs'), [branchId, oId]),
    payroll_runs_processing: await n(`SELECT COUNT(*)::int AS c FROM payroll_runs WHERE branch_id = $1 AND organization_id = $2 AND status = 'processing'`, [branchId, oId]),
    payroll_runs_unpaid: await n(`SELECT COUNT(*)::int AS c FROM payroll_runs WHERE branch_id = $1 AND organization_id = $2 AND status <> ALL($3::text[])`, [branchId, oId, PAYROLL_SETTLED]),
    pending_leaves: await n(`SELECT COUNT(*)::int AS c FROM leaves l JOIN users u ON u.id = l.user_id WHERE u.branch_id = $1 AND l.organization_id = $2 AND l.status = ANY($3::text[])`, [branchId, oId, PENDING_LEAVE]),
    pending_regularizations: await n(`SELECT COUNT(*)::int AS c FROM attendance_regularization g JOIN users u ON u.id = g.user_id WHERE u.branch_id = $1 AND g.organization_id = $2 AND g.status = 'pending'`, [branchId, oId]),
    pending_expenses: await n(`SELECT COUNT(*)::int AS c FROM expenses e JOIN users u ON u.id = e.user_id WHERE u.branch_id = $1 AND e.organization_id = $2 AND e.status = 'pending'`, [branchId, oId]),
  };
}

// Blockers stop the action; warnings are shown in the confirmation dialog (history is kept either way).
function blockersFor(summary) {
  const b = [];
  if (summary.payroll_runs_processing > 0)
    b.push(`A payroll run for this branch is being generated right now. Wait for it to finish, then try again.`);
  return b;
}
function warningsFor(summary, mode) {
  const w = [];
  if (summary.payroll_runs_unpaid > 0)
    w.push(`${summary.payroll_runs_unpaid} payroll run(s) of this branch are not marked paid yet. They stay under the hidden branch and remain available for reports.`);
  const pend = summary.pending_leaves + summary.pending_regularizations + summary.pending_expenses;
  if (pend > 0)
    w.push(`${pend} pending approval(s) belong to this branch's employees (${summary.pending_leaves} leave, ${summary.pending_regularizations} regularization, ${summary.pending_expenses} expense). Review them first${mode === 'soft_delete' ? ' — deactivated employees will not be able to act on them' : ''}.`);
  return w;
}

async function loadLive(r, oId, id) {
  const rows = (await r.q(`SELECT * FROM branches WHERE id = $1 AND org_id = $2`, [id, oId])).rows;
  if (!rows.length || rows[0].deleted_at) throw new BranchDeleteError(404, 'Branch not found');
  return rows[0];
}

async function checkTarget(r, oId, branch, targetId) {
  if (!targetId) throw new BranchDeleteError(400, 'Choose the branch to move the employees to.');
  if (String(targetId) === String(branch.id)) throw new BranchDeleteError(400, 'The destination must be a different branch.');
  const rows = (await r.q(`SELECT * FROM branches WHERE id = $1 AND org_id = $2`, [targetId, oId])).rows;
  if (!rows.length || rows[0].deleted_at) throw new BranchDeleteError(400, 'The destination branch does not exist.');
  if (rows[0].is_active === false) throw new BranchDeleteError(400, 'The destination branch is inactive. Choose an active branch.');
  return rows[0];
}

/** What the confirmation dialog shows. Read-only. */
async function previewBranchDeletion({ oId, branchId }) {
  if (!await hasSoftDeleteColumn()) throw new BranchDeleteError(409, 'Run backend/migrations/add_branch_soft_delete_2026_10_09.sql before deleting branches.');
  const r = runner(null);
  const branch = await loadLive(r, oId, branchId);
  const summary = await summarize(r, oId, branchId);
  const { rows: targets } = await pool.query(
    `SELECT id, name, code FROM branches WHERE org_id = $1 AND id <> $2 AND is_active = TRUE AND deleted_at IS NULL ORDER BY name`, [oId, branchId]);
  return { branch: { id: branch.id, name: branch.name, code: branch.code }, summary, blockers: blockersFor(summary), warnings: { move: warningsFor(summary, 'move'), soft_delete: warningsFor(summary, 'soft_delete') }, targets };
}

async function deleteBranch({ oId, branchId, mode, targetBranchId, actor }) {
  if (!['move', 'soft_delete'].includes(mode)) throw new BranchDeleteError(400, 'Choose how to delete the branch: move its data to another branch, or soft-delete it.');
  if (!await hasSoftDeleteColumn()) throw new BranchDeleteError(409, 'Run backend/migrations/add_branch_soft_delete_2026_10_09.sql before deleting branches.');

  const client = await pool.connect();
  const deactivated = [];
  let result;
  try {
    await client.query('BEGIN');
    const r = runner(client);
    const branch = (await client.query(`SELECT * FROM branches WHERE id = $1 AND org_id = $2 FOR UPDATE`, [branchId, oId])).rows[0];
    if (!branch || branch.deleted_at) throw new BranchDeleteError(404, 'Branch not found');
    const summary = await summarize(r, oId, branchId);
    const blockers = blockersFor(summary);
    if (blockers.length) throw new BranchDeleteError(409, blockers.join(' '), { blockers });

    const done = { mode, moved: {}, deactivated_employees: 0, hr_admins_regranted: 0 };
    let target = null;
    if (mode === 'move') {
      target = await checkTarget(r, oId, branch, targetBranchId);
      const mv = async (key, sql, p) => { done.moved[key] = (await client.query(sql, p)).rowCount; };
      await mv('employees', `UPDATE users SET branch_id = $1 WHERE branch_id = $2 AND organization_id = $3`, [target.id, branchId, oId]);
      await mv('assets', `UPDATE assets SET branch_id = $1 WHERE branch_id = $2 AND organization_id = $3`, [target.id, branchId, oId]);
      await mv('employee_documents', `UPDATE employee_documents SET branch_id = $1 WHERE branch_id = $2 AND organization_id = $3`, [target.id, branchId, oId]);
      await mv('shifts', `UPDATE shifts SET branch_id = $1 WHERE branch_id = $2 AND organization_id = $3`, [target.id, branchId, oId]);
      await mv('biometric_devices', `UPDATE biometric_devices SET branch_id = $1 WHERE branch_id = $2 AND org_id = $3`, [target.id, branchId, oId]);
      // HR admins who could manage the old branch can manage the destination (unless they already can / already see everything)
      const grant = await client.query(
        `INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches, granted_by)
         SELECT DISTINCT h.user_id, h.org_id, $1::bigint, FALSE, $4::bigint FROM hr_branch_access h
          WHERE h.branch_id = $2 AND h.org_id = $3 AND h.all_branches = FALSE
         ON CONFLICT (user_id, org_id, branch_id) WHERE branch_id IS NOT NULL DO NOTHING`,
        [target.id, branchId, oId, actor.id]);
      done.hr_admins_regranted = grant.rowCount;
    } else {
      const dz = await client.query(
        `UPDATE users SET employee_status = 'inactive', status = $3
          WHERE branch_id = $1 AND organization_id = $2 AND role = 'employee'
            AND (employee_status IS NULL OR employee_status NOT IN ('inactive', 'terminated'))
        RETURNING id`, [branchId, oId, legacyStatusFor('inactive')]);
      dz.rows.forEach(x => deactivated.push(x.id));
      done.deactivated_employees = dz.rowCount;
    }
    // either way nobody keeps access to the hidden branch
    await client.query(`DELETE FROM hr_branch_access WHERE branch_id = $1 AND org_id = $2`, [branchId, oId]);

    await client.query(
      `UPDATE branches SET deleted_at = NOW(), deleted_by = $3, delete_mode = $4, moved_to_branch_id = $5, is_active = FALSE
        WHERE id = $1 AND org_id = $2`,
      [branchId, oId, actor.id, mode, target ? target.id : null]);

    const detail = { ...done, summary, target_branch: target ? { id: target.id, name: target.name } : null };
    await r.probe(
      `INSERT INTO branch_deletion_log (org_id, branch_id, branch_name, mode, target_branch_id, actor_id, actor_name, summary)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [oId, branchId, branch.name, mode, target ? target.id : null, actor.id, actor.name || null, JSON.stringify(detail)]);
    await client.query('COMMIT');
    result = { ok: true, mode, branch: { id: branch.id, name: branch.name }, target: target ? { id: target.id, name: target.name } : null, ...done };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already gone */ }
    throw err;
  } finally { client.release(); }

  // after COMMIT: end the sessions of the accounts that were just deactivated
  if (deactivated.length) {
    const { revokeSessionsQuiet } = require('../middleware/auth');
    await Promise.all(deactivated.map(id => revokeSessionsQuiet(id)));
  }
  return result;
}

module.exports = { previewBranchDeletion, deleteBranch, BranchDeleteError, hasSoftDeleteColumn };
