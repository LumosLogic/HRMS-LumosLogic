/**
 * leaveCorrection — what happens to an APPROVED leave when attendance is corrected for one of its days
 * (an employee was marked on leave but actually worked; approved regularization).
 *
 * Leave balance is computed from the approved leave rows (see leaves.routes calcLeaveBalances), so adjusting those rows
 * IS the balance adjustment: only the corrected working day is given back, and repeating the call changes nothing
 * (after the first run no approved leave covers that date any more).
 *
 *   • single-day / half-day leave           → cancelled (the day, or half day, is restored)
 *   • multi-day leave, corrected day inside → trimmed / split: the days before and after stay approved leave, only the
 *                                              corrected day leaves the leave
 *   • corrected day is a weekly off / holiday (not a leave-consuming day) → leave left untouched
 *
 * Runs on the caller's transaction client. Writes one leave_approval_log row per affected leave (action
 * 'leave_overridden_by_attendance', already allowed by chk_lal_action) holding the original range, the new ranges, the
 * days restored and the reason — the audit trail of "who changed what and why".
 */
'use strict';
const { getSettingsForUser, isWorkingDay, getUserBranchId, holidayAppliesToBranch } = require('../utils/helpers');

const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().split('T')[0]; };
const day = (v) => String(v).slice(0, 10);

function workingDates(from, to, settings, holidays) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkingDay(d, settings) && !holidays.has(d)) out.push(d);
  return out;
}

async function holidaySet(client, oId, userId, from, to) {
  const { rows } = await client.query(
    `SELECT date::text AS date, branch_id FROM holidays WHERE organization_id = $1 AND date::text >= $2 AND date::text <= $3`,
    [oId, from, to]);
  const branchId = await getUserBranchId(oId, userId);
  return new Set(rows.filter(h => holidayAppliesToBranch(h, branchId)).map(h => h.date));
}

/**
 * @returns {Promise<{ restoredDays:number, changes:Array }>} changes[i] = { leaveId, action:'cancelled'|'trimmed'|'split', from, to?, newLeaveId? }
 */
async function adjustLeavesForCorrectedDay(client, { oId, userId, date, actorId, actorName, note }) {
  const settings = await getSettingsForUser(oId, userId);
  const { rows: leaves } = await client.query(
    `SELECT * FROM leaves
      WHERE user_id = $1 AND organization_id = $2 AND status = 'approved' AND leave_type <> 'wfh'
        AND start_date <= $3 AND end_date >= $3
      FOR UPDATE`,
    [userId, oId, date]);
  const result = { restoredDays: 0, changes: [] };
  if (!leaves.length) return result;

  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'leaves' AND column_name NOT IN ('id', 'created_at')`);
  const cloneCols = cols.map(c => c.column_name);

  const log = (leaveId, fromStatus, toStatus, notes) => client.query(
    `INSERT INTO leave_approval_log (leave_id, org_id, actor_id, actor_name, action, from_status, to_status, notes)
     VALUES ($1,$2,$3,$4,'leave_overridden_by_attendance',$5,$6,$7)`,
    [leaveId, oId, actorId, actorName || null, fromStatus, toStatus, notes]);

  for (const L of leaves) {
    const start = day(L.start_date), end = day(L.end_date);
    const holidays = await holidaySet(client, oId, userId, start, end);
    const isHalf = L.leave_time === 'half';
    const dayCounts = isHalf || (isWorkingDay(date, settings) && !holidays.has(date));
    if (!dayCounts) continue;                       // weekly off / holiday: this leave never consumed that day

    const before = start < date ? workingDates(start, addDays(date, -1), settings, holidays) : [];
    const after  = end   > date ? workingDates(addDays(date, 1), end,   settings, holidays) : [];

    if (isHalf || (!before.length && !after.length)) {
      await client.query(`UPDATE leaves SET status = 'cancelled' WHERE id = $1`, [L.id]);
      await log(L.id, 'approved', 'cancelled', `${note} Leave ${start}..${end} cancelled; ${isHalf ? 0.5 : 1} day restored.`);
      result.restoredDays += isHalf ? 0.5 : 1;
      result.changes.push({ leaveId: L.id, action: 'cancelled', from: `${start}..${end}` });
      continue;
    }

    let newLeaveId = null;
    if (before.length) {
      // Clone the later part FIRST (it copies the original row's end_date), then shorten the original.
      if (after.length) {
        const clone = cloneCols.map(c => `"${c}"`).join(', ');
        const sel   = cloneCols.map(c => (c === 'start_date' ? '$2' : `"${c}"`)).join(', ');
        const ins = await client.query(`INSERT INTO leaves (${clone}) SELECT ${sel} FROM leaves WHERE id = $1 RETURNING id`, [L.id, after[0]]);
        newLeaveId = ins.rows[0].id;
      }
      await client.query(`UPDATE leaves SET end_date = $1 WHERE id = $2`, [before[before.length - 1], L.id]);
    } else {
      await client.query(`UPDATE leaves SET start_date = $1 WHERE id = $2`, [after[0], L.id]);
    }
    const kept = [before.length ? `${start}..${before[before.length - 1]}` : null, after.length ? `${after[0]}..${end}` : null].filter(Boolean).join(' and ');
    const action = newLeaveId ? 'split' : 'trimmed';
    await log(L.id, 'approved', 'approved', `${note} Leave ${start}..${end} ${action}: ${kept} remain approved; 1 day restored.${newLeaveId ? ` Later part is leave #${newLeaveId}.` : ''}`);
    if (newLeaveId) await log(newLeaveId, null, 'approved', `${note} Created by splitting leave #${L.id} (${start}..${end}).`);
    result.restoredDays += 1;
    result.changes.push({ leaveId: L.id, action, from: `${start}..${end}`, to: kept, newLeaveId });
  }
  return result;
}

const OPEN_LEAVE_STATUSES = ['approved', 'pending', 'pending_dept', 'pending_root', 'pending_approval'];

/**
 * Employee terminated: remove the FUTURE part of their leave, keep everything up to the cut-off.
 *
 * cut-off = the later of the termination's effective date and today. Days on/before the cut-off are history (or the
 * termination day itself) and are never touched. Same row-level model as adjustLeavesForCorrectedDay — there is no
 * per-day leave table, balance is derived from the approved/pending rows, so shrinking the rows IS the restore:
 *
 *   • leave starts after the cut-off          → cancelled (whole request is future)
 *   • leave spans the cut-off                 → trimmed: end_date moves back to the cut-off, past days stay approved
 *   • leave ends on/before the cut-off        → untouched
 *
 * Covers approved leave, WFH and requests still waiting for approval (they would otherwise sit in approvers' queues for
 * a person who has gone). Future attendance rows that were only a leave placeholder (on_leave/half_day/wfh, no check-in)
 * are removed for the cancelled days; real attendance is never deleted. Idempotent: after one run nothing open extends
 * past the cut-off, so repeating it (or re-processing the termination) changes nothing and restores nothing twice.
 *
 * Runs on the caller's transaction client. One leave_approval_log row per leave: actor, timestamp (column default),
 * original range, what remains, days restored, and "Reason: employee termination".
 *
 * @returns {Promise<{ cutoff:string, restoredDays:number, changes:Array }>} changes[i] = { leaveId, action:'cancelled'|'trimmed', from, to? }
 */
async function cancelFutureLeavesForTermination(client, { oId, userId, effectiveDate, today, actorId = null, actorName = null }) {
  const eff = effectiveDate ? day(effectiveDate) : today;
  const cutoff = eff > today ? eff : today;
  const result = { cutoff, restoredDays: 0, changes: [] };

  const { rows: leaves } = await client.query(
    `SELECT * FROM leaves
      WHERE user_id = $1 AND organization_id = $2 AND status = ANY($3::text[]) AND end_date > $4
      ORDER BY id
      FOR UPDATE`,
    [userId, oId, OPEN_LEAVE_STATUSES, cutoff]);
  if (!leaves.length) return result;

  const settings = await getSettingsForUser(oId, userId);
  const who = actorName || 'System';
  const reason = `Reason: employee termination (effective ${eff}), processed by ${who}.`;
  const log = (leaveId, fromStatus, toStatus, notes) => client.query(
    `INSERT INTO leave_approval_log (leave_id, org_id, actor_id, actor_name, action, from_status, to_status, notes)
     VALUES ($1,$2,$3,$4,'cancelled',$5,$6,$7)`,
    [leaveId, oId, actorId, who, fromStatus, toStatus, notes]);

  for (const L of leaves) {
    const start = day(L.start_date), end = day(L.end_date);
    const removedFrom = start > cutoff ? start : addDays(cutoff, 1);
    const holidays = await holidaySet(client, oId, userId, removedFrom, end);
    const isHalf = L.leave_time === 'half';
    const isWfh = L.leave_type === 'wfh' || L.leave_time === 'wfh';
    // Days that stop consuming balance (WFH never consumed any).
    const restored = isWfh ? 0 : (isHalf ? 0.5 : workingDates(removedFrom, end, settings, holidays).length);

    if (start > cutoff) {
      await client.query(`UPDATE leaves SET status = 'cancelled' WHERE id = $1`, [L.id]);
      await log(L.id, L.status, 'cancelled', `${reason} Leave ${start}..${end} cancelled; ${restored} day(s) restored.`);
      result.changes.push({ leaveId: L.id, action: 'cancelled', from: `${start}..${end}` });
    } else {
      await client.query(`UPDATE leaves SET end_date = $1 WHERE id = $2`, [cutoff, L.id]);
      await log(L.id, L.status, L.status, `${reason} Leave ${start}..${end} trimmed to ${start}..${cutoff} (days up to the termination date stay); ${restored} day(s) restored.`);
      result.changes.push({ leaveId: L.id, action: 'trimmed', from: `${start}..${end}`, to: `${start}..${cutoff}` });
    }
    result.restoredDays += restored;

    // Placeholder attendance for the removed future days only — never a row with a real check-in, never on/before the cut-off.
    await client.query(
      `DELETE FROM attendance
        WHERE user_id = $1 AND organization_id = $2
          AND date::text >= $3 AND date::text <= $4
          AND status = ANY(ARRAY['on_leave','half_day','wfh']) AND check_in IS NULL`,
      [userId, oId, removedFrom, end]);
  }
  return result;
}

module.exports = { adjustLeavesForCorrectedDay, cancelFutureLeavesForTermination };
