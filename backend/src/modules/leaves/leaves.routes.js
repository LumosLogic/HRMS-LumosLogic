const express = require('express');
const router  = express.Router();
const { sameId } = require('../../utils/ids');
const { parseListParams, setPagingHeaders, compactRows, ListParamError } = require('../../utils/listParams');
const { db, pool } = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { getUserBranchId, holidayAppliesToBranch, flat, flatOne, orgId, getSettings, getEffectiveWorkSchedule, getSettingsForUser, isWorkingDay, getRecipients, localDateStr, getOrgContext, toMinutes } = require('../../utils/helpers');
const { sendMail, leaveAppliedHtml, leaveStatusHtml, leaveDeptApprovalHtml, leaveForwardedToRootHtml } = require('../../services/emailService');
const engine = require('../../services/leaveWorkflowEngine');
const { withBranchContext } = require('../../middleware/branchContext');
const { applyBranchUserScope, getFilterState, assertUsersAccessible, resolveEmployeeIds, canAdminAccessUser, getAdminsForEmployee } = require('../../utils/branchFilter');

// ─── Helpers ─────────────────────────────────────────────────────────────────


// Leave policy rows that apply to an employee: their branch's override for each type when it
// exists, otherwise the org-wide row. A branch override and an org-wide row of the same type can
// now coexist (fix_leave_policy_unique_per_branch_2026_10_01.sql), so lookups by type must not
// assume a single row. Returns rows for the requested active/leaveType filters.
async function getEffectivePolicies(oId, userId, { leaveType = null, activeOnly = true } = {}) {
  try {
    const { rows } = await pool.query(
      // Pick the effective row per type FIRST (branch override beats org-wide, even if the
      // override is inactive), then apply the active filter to that row.
      `SELECT e.* FROM (
         SELECT DISTINCT ON (p.leave_type) p.id, p.leave_type, p.label, p.annual_quota, p.paid, p.active
           FROM leave_policies p
          WHERE p.organization_id = $1
            AND ($2::text IS NULL OR p.leave_type = $2)
            AND (p.branch_id IS NULL
                 OR p.branch_id = (SELECT u.branch_id FROM users u WHERE u.id = $4 AND u.organization_id = $1))
          ORDER BY p.leave_type, (p.branch_id IS NULL)
       ) e
       WHERE (NOT $3::boolean OR e.active = true)`,
      [oId, leaveType, activeOnly, userId]
    );
    return rows;
  } catch { return []; }
}

// Holidays that apply to ONE employee: organisation-wide ones plus their own branch's.
// (A holiday set for another branch must never reduce this employee's leave days.)
async function fetchHolidaySet(oId, startDate, endDate, userId = null) {
  try {
    let q = db.from('holidays').select('date, branch_id')
      .eq('organization_id', oId).gte('date', startDate).lte('date', endDate);
    const { data } = await q;
    const branchId = userId ? await getUserBranchId(oId, userId) : null;
    return new Set((data || []).filter(h => holidayAppliesToBranch(h, branchId)).map(h => h.date));
  } catch { return new Set(); }
}

function buildWorkingDates(startDate, endDate, settings, holidayDates = new Set()) {
  const dates = [];
  const start = new Date(startDate + 'T12:00:00');
  const end   = new Date(endDate   + 'T12:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().split('T')[0];
    if (isWorkingDay(ds, settings) && !holidayDates.has(ds)) dates.push(ds);
  }
  return dates;
}

// Legacy helper: find dept head for old-flow leaves.
async function findDeptHead(userId, oId) {
  const { data: user } = await db
    .from('users')
    .select('department_id, reporting_to')
    .eq('id', userId)
    .eq('organization_id', oId)
    .maybeSingle();
  if (!user) return null;

  if (user.department_id) {
    const { data: dept } = await db
      .from('departments')
      .select('head_user_id')
      .eq('id', user.department_id)
      .eq('organization_id', oId)
      .maybeSingle();
    const headId = dept?.head_user_id;
    if (headId && headId !== userId) return headId;
  }

  if (user.reporting_to && user.reporting_to !== userId) return user.reporting_to;
  return null;
}

function logApprovalAction({ leaveId, oId, actorId, actorName, action, fromStatus, toStatus, notes, level }) {
  // Use pool.query directly — the db adapter builder has no .catch() method,
  // so chaining .catch() on it throws "is not a function". pool.query returns a real Promise.
  const cols = ['leave_id','org_id','actor_id','actor_name','action','from_status','to_status','notes'];
  const vals = [leaveId, oId, actorId, actorName || null, action, fromStatus || null, toStatus || null, notes || null];
  if (level != null) { cols.push('level'); vals.push(level); }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  return pool.query(
    `INSERT INTO leave_approval_log (${cols.join(', ')}) VALUES (${placeholders})`,
    vals
  ).catch(e => console.error('[leave_approval_log] insert failed:', e.message));
}

function notify(userId, title, message, oId) {
  // pool.query returns a real Promise — .catch() works correctly here.
  // db adapter builder has no .catch(), so we avoid chaining on it.
  pool.query(
    `INSERT INTO notifications (user_id, title, message, type, organization_id) VALUES ($1, $2, $3, $4, $5)`,
    [userId, title, message, 'leave', oId]
  ).catch(() => {}); // fire-and-forget
}

// BUG_096: notify branch-scoped HR admins and root admins (fire-and-forget)
// employeeId scopes the fan-out to only admins who can see that employee's branch.
async function notifyAdmins(oId, title, message, excludeUserId, employeeId) {
  try {
    let adminIds;
    if (employeeId) {
      adminIds = await getAdminsForEmployee(employeeId, oId);
    } else {
      const { data: admins } = await db.from('users')
        .select('id').eq('organization_id', oId).in('role', ['admin', 'root_admin']);
      adminIds = (admins || []).map(a => a.id);
    }
    for (const id of adminIds) {
      if (excludeUserId && Number(id) === Number(excludeUserId)) continue;
      notify(id, title, message, oId);
    }
  } catch (_) {}
}

// BUG_096: get dept head user ID for a given employee (fire-and-forget safe)
async function getDeptHeadId(userId, oId) {
  try {
    const { data: user } = await db.from('users')
      .select('department_id')
      .eq('id', userId)
      .eq('organization_id', oId)
      .maybeSingle();
    if (!user?.department_id) return null;
    const { data: dept } = await db.from('departments')
      .select('head_user_id')
      .eq('id', user.department_id)
      .eq('organization_id', oId)
      .maybeSingle();
    const headId = dept?.head_user_id;
    return (headId && headId !== userId) ? headId : null;
  } catch (_) { return null; }
}

// ─── ROUTE: GET /workflow-config ──────────────────────────────────────────────
// Returns the org's active workflow with all levels.
// Accessible to all authenticated users (employees need it for timeline display).
router.get('/workflow-config', auth, async (req, res) => {
  try {
    const workflow = await engine.getOrgWorkflow(orgId(req));
    res.json(workflow);
  } catch (err) {
    // Migration not yet applied — return empty workflow so frontend doesn't crash
    if (err.message && (err.message.includes('does not exist') || err.message.includes('relation'))) {
      return res.json({ id: null, workflow_name: 'Default Approval Workflow', levels: [], _migration_pending: true });
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTE: PUT /workflow-config ──────────────────────────────────────────────
// Replace the org's workflow levels. Admin only.
router.put('/workflow-config', auth, hasPermission('settings', 'manage'), async (req, res) => {
  try {
    const { workflow_name, levels } = req.body;
    if (!Array.isArray(levels)) return res.status(400).json({ error: 'levels must be an array' });

    const VALID_TYPES = ['reporting_manager','department_head','hr_admin','root_admin','specific_user'];
    const UNIQUE_TYPES = ['reporting_manager','department_head','hr_admin','root_admin'];
    const seenTypes = new Set();
    for (const [i, l] of levels.entries()) {
      if (!VALID_TYPES.includes(l.role_type)) {
        return res.status(400).json({ error: `Level ${i + 1}: invalid role_type '${l.role_type}'` });
      }
      // BUG_167: enforce uniqueness for non-specific_user types
      if (UNIQUE_TYPES.includes(l.role_type) && seenTypes.has(l.role_type)) {
        return res.status(400).json({ error: `Approver type '${l.role_type}' can only appear once in the workflow` });
      }
      if (UNIQUE_TYPES.includes(l.role_type)) seenTypes.add(l.role_type);
      // BUG_105: display label is required and must contain at least one letter
      const label = (l.level_label || '').trim();
      if (!label) {
        return res.status(400).json({ error: `Level ${i + 1}: Display label is required` });
      }
      if (!/[a-zA-Z]/.test(label)) {
        return res.status(400).json({ error: `Level ${i + 1}: Display label must contain at least one letter` });
      }
      if (label.length > 30) {
        return res.status(400).json({ error: `Level ${i + 1}: Display label must be 30 characters or fewer` });
      }
    }

    // Re-number levels sequentially to prevent gaps; trim labels
    const normalised = levels.map((l, i) => ({ ...l, level_number: i + 1, level_label: (l.level_label || '').trim() }));

    const updated = await engine.updateWorkflow(orgId(req), workflow_name, normalised);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /my-approvals ─────────────────────────────────────────────────
// Returns all new-workflow leaves currently pending THIS user's action.
// MUST be before GET /:id.
router.get('/my-approvals', auth, withBranchContext, async (req, res) => {
  try {
    const oId = orgId(req);
    let leaves = await engine.getMyPendingLeaves(req.user.id, req.user.role, oId);
    // Branch isolation: filter to only leaves from accessible-branch employees
    const empIds = await resolveEmployeeIds(req.branchContext, oId);
    if (empIds !== null) {
      const empSet = new Set(empIds);
      leaves = leaves.filter(l => empSet.has(l.user_id));
    }
    res.json(leaves);
  } catch (err) {
    if (err.message && (err.message.includes('does not exist') || err.message.includes('relation'))) {
      return res.json([]);
    }
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTE: GET /my-history ─
router.get('/my-history', auth, async (req, res) => {
  try {
    const oId = orgId(req);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let rows = [];
    try {
      const { rows: logRows } = await pool.query("SELECT pal.leave_id, pal.action, pal.notes, pal.created_at, l.leave_type, l.start_date, l.end_date, l.status AS final_status, u.name AS employee_name, u.department, u.avatar_color FROM leave_approval_log pal JOIN leaves l ON l.id = pal.leave_id JOIN users u ON u.id = l.user_id WHERE pal.org_id = $1 AND pal.actor_id = $2 AND (pal.action ILIKE '%approved%' OR pal.action ILIKE '%rejected%') AND pal.created_at >= $3 ORDER BY pal.created_at DESC LIMIT 100", [Number(oId), req.user.id, since]);
      rows = logRows;
    } catch (e) { console.warn("[my-history] log query failed:", e.message); }
    try {
      const { rows: legacyRows } = await pool.query("SELECT l.id AS leave_id, CASE WHEN l.status = 'rejected' THEN 'root_rejected' ELSE 'root_approved' END AS action, l.remarks AS notes, l.approved_at AS created_at, l.leave_type, l.start_date, l.end_date, l.status AS final_status, u.name AS employee_name, u.department, u.avatar_color FROM leaves l JOIN users u ON u.id = l.user_id WHERE l.organization_id = $1 AND l.approved_by = $2 AND l.status IN ('approved', 'rejected') AND l.approved_at >= $3 ORDER BY l.approved_at DESC LIMIT 100", [Number(oId), req.user.id, since]);
      const seen = new Set(rows.map(r => String(r.leave_id) + '-' + r.action));
      for (const r of legacyRows) {
        const key = String(r.leave_id) + '-' + r.action;
        if (!seen.has(key)) { rows.push(r); seen.add(key); }
      }
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    } catch (e) { console.warn("[my-history] legacy query failed:", e.message); }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ENH_LEAVES_004: Leave Comments ──────────────────────────────────────────
router.get('/:id/comments', auth, withBranchContext, async (req, res) => {
  try {
    const oId = orgId(req);
    const { data: leave } = await db.from('leaves').select('user_id, organization_id').eq('id', req.params.id).maybeSingle();
    if (!leave || !sameId(leave.organization_id, oId)) return res.status(404).json({ error: 'Not found' });
    if (!isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
    if (isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id) && !await canAdminAccessUser(req.branchContext, leave.user_id, oId))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
    const { data, error } = await db.from('leave_comments').select('*').eq('leave_id', req.params.id).order('created_at', { ascending: true });
    if (error) {
      if (error.message.includes('does not exist')) return res.json([]); // table not yet created
      throw error;
    }
    const rows = data || [];
    if (!rows.length) return res.json([]);
    const uIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    // BUG_235: include role/position so the UI can show the author's capacity
    const { data: users } = await db.from('users').select('id, name, avatar_color, role, position').in('id', uIds);
    const uMap = {}; (users || []).forEach(u => { uMap[u.id] = u; });
    res.json(rows.map(r => ({
      ...r,
      commenter_name: uMap[r.user_id]?.name || 'Unknown',
      commenter_avatar_color: uMap[r.user_id]?.avatar_color || '',
      commenter_role: uMap[r.user_id]?.role || '',
      commenter_position: uMap[r.user_id]?.position || '',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/comments', auth, withBranchContext, async (req, res) => {
  try {
    const oId = orgId(req);
    const { comment } = req.body;
    if (!comment?.trim()) return res.status(400).json({ error: 'Comment required' });
    const { data: leave } = await db.from('leaves').select('user_id, organization_id').eq('id', req.params.id).maybeSingle();
    if (!leave || !sameId(leave.organization_id, oId)) return res.status(404).json({ error: 'Not found' });
    if (!isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id)) return res.status(403).json({ error: 'Access denied' });
    if (isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id) && !await canAdminAccessUser(req.branchContext, leave.user_id, oId))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
    const { data, error } = await db.from('leave_comments').insert({
      leave_id: req.params.id, user_id: req.user.id, comment: comment.trim(), organization_id: oId,
    }).select().single();
    if (error) throw error;
    res.json({ ...data, commenter_name: req.user.name || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /date-check ───────────────────────────────────────────────────
router.get('/date-check', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required' });

    const { data: rawConflicts } = await db.from('leaves')
      .select('id, leave_type, leave_time, status, start_date, end_date')
      .eq('user_id', req.user.id)
      .eq('organization_id', orgId(req))
      .in('status', ['pending','pending_dept','pending_root','pending_approval','approved'])
      .lte('start_date', endDate)
      .gte('end_date', startDate);

    const { leave_time: newLeaveTime, leave_type: newLeaveType } = req.query;
    const newIsWfh  = newLeaveType === 'wfh' || newLeaveTime === 'wfh';
    const newIsHalf = newLeaveTime === 'half';
    const conflicts = (rawConflicts || []).filter(c => {
      const cIsWfh = c.leave_type === 'wfh' || c.leave_time === 'wfh';
      if (cIsWfh && newIsHalf) return false;
      if (!cIsWfh && c.leave_time === 'half' && newIsWfh) return false;
      return true;
    });

    const { data: attendanceRecs } = await db.from('attendance')
      .select('date, work_hours')
      .eq('user_id', req.user.id)
      .eq('organization_id', orgId(req))
      .gte('date', startDate)
      .lte('date', endDate)
      .gt('work_hours', 0);

    const year = new Date().getFullYear();
    const { data: approved } = await db.from('leaves')
      .select('leave_type, start_date, end_date, leave_time')
      .eq('user_id', req.user.id)
      .eq('organization_id', orgId(req))
      .eq('status', 'approved')
      .gte('start_date', `${year}-01-01`)
      .lte('end_date', `${year}-12-31`);

    const { data: orgHolidays } = await db.from('holidays')
      .select('date, branch_id').eq('organization_id', orgId(req))
      .like('date', `${year}-%`);
    const _myBranch = await getUserBranchId(orgId(req), req.user.id);
    const holidaySet = new Set((orgHolidays || []).filter(h => holidayAppliesToBranch(h, _myBranch)).map(h => h.date));

    const usedByType = {};
    for (const l of approved || []) {
      if (!usedByType[l.leave_type]) usedByType[l.leave_type] = 0;
      if (l.leave_time === 'half') {
        usedByType[l.leave_type] += 0.5;
      } else if (l.leave_time !== 'wfh' && l.leave_type !== 'wfh') {
        const s = new Date(l.start_date + 'T12:00:00');
        const e = new Date(l.end_date   + 'T12:00:00');
        for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
          const ds  = d.toISOString().split('T')[0];
          const dow = d.getDay();
          if (dow !== 0 && dow !== 6 && !holidaySet.has(ds)) usedByType[l.leave_type] += 1;
        }
      }
    }

    const policies = await getEffectivePolicies(orgId(req), req.user.id);
    const { data: orgRow } = await db.from('organizations')
      .select('total_annual_leaves').eq('id', orgId(req)).maybeSingle();
    const policyQuotas = {};
    (policies || []).forEach(p => { policyQuotas[p.leave_type] = p.annual_quota; });
    const totalAnnual = orgRow?.total_annual_leaves || 18;

    res.json({
      conflicts: conflicts || [],
      hasAttendance: (attendanceRecs || []).length > 0,
      usedByType,
      totalAnnual,
      policyQuotas,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /team ─────────────────────────────────────────────────────────
router.get('/team', auth, withBranchContext, async (req, res) => {
  try {
    const { startDate, endDate, year, month } = req.query;
    let query = db.from('leaves')
      .select('id, user_id, start_date, end_date, leave_type, leave_time, users!leaves_user_id_fkey(name, avatar_color, department)')
      .eq('organization_id', orgId(req))
      .eq('status', 'approved')
      .order('start_date', { ascending: true });

    if (startDate && endDate) {
      query = query.lte('start_date', endDate).gte('end_date', startDate);
    } else if (year && month) {
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      query = query.lte('start_date', `${ym}-31`).gte('end_date', `${ym}-01`);
    } else if (year) {
      query = query.lte('start_date', `${year}-12-31`).gte('end_date', `${year}-01-01`);
    }

    // Branch isolation: admins only see their branch's employees' approved leaves.
    if (isAdminRole(req.user.role)) {
      const empIds = await resolveEmployeeIds(req.branchContext, orgId(req));
      if (empIds !== null && empIds.length === 0) return res.json([]);
      if (empIds !== null) query = query.in('user_id', empIds);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    res.json((data || []).map(l => ({
      id: l.id, user_id: l.user_id, start_date: l.start_date, end_date: l.end_date,
      leave_type: l.leave_type, leave_time: l.leave_time,
      name: l.users?.name, avatar_color: l.users?.avatar_color, department: l.users?.department,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /balance ──────────────────────────────────────────────────────
// ─── Leave balance core — shared by GET /balance (one employee) and GET /balance/batch (many) ─────────────────────────
// The calculation itself is unchanged; it only takes its data as arguments so the batch route can load that data ONCE
// for every employee instead of once per employee.
const BALANCE_PENDING_STATUSES = ['pending', 'pending_dept', 'pending_root', 'pending_approval'];

/** Leave-cycle window for `yearParam` (defaults to the current cycle). startMonth 1 = calendar year, 4 = Apr–Mar, … */
async function leaveYearWindow(oId, yearParam) {
  const { data: orgRow } = await db.from('organizations')
    .select('leave_year_start_month')
    .eq('id', oId)
    .maybeSingle();
  const startMonth = orgRow?.leave_year_start_month || 1;
  const now = new Date();
  const curMonth = now.getMonth() + 1; // 1-indexed
  const curYear  = now.getFullYear();
  const defaultYear = (startMonth > 1 && curMonth < startMonth) ? curYear - 1 : curYear;
  const year = parseInt(yearParam) || defaultYear;
  const mm       = String(startMonth).padStart(2, '0');
  const fyStart  = `${year}-${mm}-01`;
  const fyEndYear  = startMonth === 1 ? year : year + 1;
  const fyEndMonth = startMonth === 1 ? 12  : startMonth - 1;
  // Date.UTC month is 0-indexed; day 0 = last day of previous month. UTC avoids TZ shift.
  const fyEnd = new Date(Date.UTC(fyEndYear, fyEndMonth, 0)).toISOString().split('T')[0];
  return { year, fyStart, fyEnd };
}

/**
 * balances[] for one employee from already-loaded policies / leaves / schedule / adjustments.
 *   holidays — Set of 'YYYY-MM-DD' that apply to THIS employee (org-wide + own branch). Day counting honours it, exactly
 *              like the creation guard and attendance writing do (the view used to ignore holidays).
 *   carry    — { leave_type: days } already capped carry-forward INTO this cycle (see computeCarryIn).
 */
function calcLeaveBalances({ policies, leaves, settings, adjustments, year, holidays = new Set(), carry = {} }) {
  const adjByType = {};
  (adjustments || []).forEach(a => { adjByType[a.leave_type] = (adjByType[a.leave_type] || 0) + Number(a.delta); });
  const own = (leaves || []).filter(l => l.leave_time !== 'wfh');

  function workDays(leave) {
    if (leave.leave_time === 'half') return 0.5;
    return buildWorkingDates(leave.start_date, leave.end_date, settings, holidays).length;
  }

  return (policies || []).map(p => {
    const approved = own.filter(l => l.leave_type === p.leave_type && l.status === 'approved');
    const pending  = own.filter(l => l.leave_type === p.leave_type && BALANCE_PENDING_STATUSES.includes(l.status));
    const used     = approved.reduce((sum, l) => sum + workDays(l), 0);
    const inProg   = pending.reduce((sum, l) => sum + workDays(l), 0);
    const adj      = adjByType[p.leave_type] || 0;
    const carried  = Number(carry[p.leave_type]) || 0;
    return {
      leave_type:  p.leave_type,
      label:       p.label || p.leave_type,
      allocated:   p.annual_quota,
      carried_forward: Math.round(carried * 2) / 2,
      adjustment:  Math.round(adj   * 2) / 2,
      used:        Math.round(used  * 2) / 2,
      pending:     Math.round(inProg * 2) / 2,
      remaining:   Math.max(0, p.annual_quota + carried + adj - used),
    };
  });
}

/**
 * Carry-forward INTO the current cycle: for every policy with carry_forward=true and max_carry_forward>0, the unused
 * APPROVED balance of the previous cycle, capped at max_carry_forward. (Both fields were stored and shown in the
 * Leave Policies screen but never applied.) Pure: previous-cycle data is passed in.
 */
function computeCarryIn({ policies, prevLeaves, prevAdjustments, settings, prevHolidays, prevYear }) {
  const cf = (policies || []).filter(p => p.carry_forward && Number(p.max_carry_forward) > 0);
  if (!cf.length) return {};
  const prev = calcLeaveBalances({
    policies: cf, leaves: (prevLeaves || []).filter(l => l.status === 'approved'),
    settings, adjustments: prevAdjustments, year: prevYear, holidays: prevHolidays || new Set(),
  });
  const out = {};
  for (const b of prev) {
    const max = Number(cf.find(p => p.leave_type === b.leave_type).max_carry_forward) || 0;
    const c = Math.min(max, b.remaining);
    if (c > 0) out[b.leave_type] = Math.round(c * 2) / 2;
  }
  return out;
}

/** The leave cycle (year number as used by leaveYearWindow) a calendar date belongs to. */
async function cycleYearForDate(oId, dateStr) {
  const { data: orgRow } = await db.from('organizations').select('leave_year_start_month').eq('id', oId).maybeSingle();
  const startMonth = orgRow?.leave_year_start_month || 1;
  const [y, m] = String(dateStr).slice(0, 10).split('-').map(Number);
  return (startMonth > 1 && m < startMonth) ? y - 1 : y;
}

/** Holiday dates of a window, split per applicability: [{date, branch_id}] */
async function holidayRowsBetween(oId, from, to) {
  const { rows } = await pool.query(
    `SELECT date::text AS date, branch_id FROM holidays WHERE organization_id = $1 AND date::text >= $2 AND date::text <= $3`, [oId, from, to]);
  return rows;
}
const holidaySetFor = (rows, branchId) => new Set(rows.filter(h => holidayAppliesToBranch(h, branchId)).map(h => h.date));

const POLICY_COLS = 'leave_type, label, annual_quota, carry_forward, max_carry_forward';

/**
 * THE balance computation for one employee (policies by branch → leaves → adjustments → carry-forward → holidays).
 * Used by GET /balance AND by the POST /leaves guard, so the number an employee sees is the number that is enforced.
 */
async function loadUserBalances(oId, targetId, yearParam) {
  const { year, fyStart, fyEnd } = await leaveYearWindow(oId, yearParam);
  const prevWin = await leaveYearWindow(oId, year - 1);

  const empBranchRow = await db.from('users').select('branch_id').eq('id', targetId).eq('organization_id', oId).maybeSingle();
  const empBranchId = empBranchRow?.data?.branch_id ?? null;
  const policyQuery = (branchId) => db.from('leave_policies').select(POLICY_COLS).eq('organization_id', oId)
    .eq('active', true).gt('annual_quota', 0).order('leave_type');
  let policies = [];
  if (empBranchId) {
    const { data: branchPols } = await policyQuery().eq('branch_id', empBranchId);
    if (branchPols && branchPols.length > 0) policies = branchPols;
  }
  if (!policies.length) policies = (await policyQuery().is('branch_id', null)).data || [];

  const leaveCols = 'leave_type, leave_time, start_date, end_date, status';
  const leavesIn = (a, b, statuses) => db.from('leaves').select(leaveCols)
    .eq('user_id', targetId).eq('organization_id', oId).in('status', statuses).gte('start_date', a).lte('end_date', b).neq('leave_type', 'wfh');
  const needsCarry = policies.some(p => p.carry_forward && Number(p.max_carry_forward) > 0);

  const [leavesRes, settings, adjRes, holRows, prevLeavesRes, prevAdjRes, prevHolRows] = await Promise.all([
    leavesIn(fyStart, fyEnd, ['approved', ...BALANCE_PENDING_STATUSES]),
    getSettingsForUser(oId, targetId),
    db.from('leave_balance_adjustments').select('leave_type, delta').eq('user_id', targetId).eq('org_id', oId).eq('year', year),
    holidayRowsBetween(oId, fyStart, fyEnd),
    needsCarry ? leavesIn(prevWin.fyStart, prevWin.fyEnd, ['approved']) : Promise.resolve({ data: [] }),
    needsCarry ? db.from('leave_balance_adjustments').select('leave_type, delta').eq('user_id', targetId).eq('org_id', oId).eq('year', year - 1) : Promise.resolve({ data: [] }),
    needsCarry ? holidayRowsBetween(oId, prevWin.fyStart, prevWin.fyEnd) : Promise.resolve([]),
  ]);

  const carry = computeCarryIn({
    policies, prevLeaves: prevLeavesRes.data, prevAdjustments: prevAdjRes.data, settings,
    prevHolidays: holidaySetFor(prevHolRows, empBranchId), prevYear: year - 1,
  });
  const balances = calcLeaveBalances({
    policies, leaves: leavesRes.data, settings, adjustments: adjRes.data, year,
    holidays: holidaySetFor(holRows, empBranchId), carry,
  });
  return { year, fyStart, fyEnd, balances, policies };
}

// ─── ROUTE: GET /balance ──────────────────────────────────────────────────────
router.get('/balance', auth, withBranchContext, async (req, res) => {
  try {
    const oId   = orgId(req);
    const targetId = (isAdminRole(req.user.role) && req.query.userId)
      ? parseInt(req.query.userId)
      : req.user.id;

    // Branch isolation: validate admin has access to the requested employee.
    if (isAdminRole(req.user.role) && req.query.userId && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, targetId, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    const { year, balances } = await loadUserBalances(oId, targetId, req.query.year);
    res.json({ year, balances });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /balance/batch?userIds=1,2,3&year=2026 ───────────────────────────────────────────────────────────────
// The balances of many employees in ONE request (the Leaves page and the Employees list used to send one /balance request
// per employee — 100+ requests per page load). Same calculation (calcLeaveBalances / computeCarryIn), same policy / schedule /
// holiday / adjustment rules as GET /balance; admin callers only, and every requested employee must be inside the caller's
// organisation AND branch scope, otherwise the whole request is refused (no partial answers that would reveal which ids exist).
// Response: { year, balances: { "<userId>": [ …same objects as GET /balance… ] } }
const BALANCE_BATCH_MAX = 500;
router.get('/balance/batch', auth, withBranchContext, async (req, res) => {
  try {
    if (!isAdminRole(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
    const oId = orgId(req);
    const raw = String(req.query.userIds || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!raw.length) return res.json({ year: (await leaveYearWindow(oId, req.query.year)).year, balances: {} });
    if (raw.length > BALANCE_BATCH_MAX) return res.status(400).json({ error: `At most ${BALANCE_BATCH_MAX} employees per request.` });
    const access = await assertUsersAccessible(req.branchContext, raw.map(Number), oId);
    if (!access.ok) return res.status(403).json({ error: "You do not have access to one or more of these employees." });
    const ids = access.ids;

    const { year, fyStart, fyEnd } = await leaveYearWindow(oId, req.query.year);
    const prevWin = await leaveYearWindow(oId, year - 1);

    // everything is loaded once for ALL employees, then split per employee in memory
    const [usersRes, polRes, leavesRes, adjRes, holRows] = await Promise.all([
      pool.query(`SELECT id, branch_id FROM users WHERE organization_id = $1 AND id = ANY($2::bigint[])`, [oId, ids]),
      pool.query(`SELECT leave_type, label, annual_quota, carry_forward, max_carry_forward, branch_id FROM leave_policies WHERE organization_id = $1 AND active = true AND annual_quota > 0 ORDER BY leave_type`, [oId]),
      pool.query(`SELECT user_id, leave_type, leave_time, start_date, end_date, status FROM leaves
                    WHERE organization_id = $1 AND user_id = ANY($2::bigint[]) AND status = ANY($3::text[])
                      AND start_date >= $4 AND end_date <= $5 AND leave_type <> 'wfh'`,
        [oId, ids, ['approved', ...BALANCE_PENDING_STATUSES], fyStart, fyEnd]),
      pool.query(`SELECT user_id, leave_type, delta FROM leave_balance_adjustments WHERE org_id = $1 AND year = $2 AND user_id = ANY($3::bigint[])`, [oId, year, ids]),
      holidayRowsBetween(oId, fyStart, fyEnd),
    ]);
    const needsCarry = polRes.rows.some(p => p.carry_forward && Number(p.max_carry_forward) > 0);
    const [prevLeavesRes, prevAdjRes, prevHolRows] = needsCarry ? await Promise.all([
      pool.query(`SELECT user_id, leave_type, leave_time, start_date, end_date, status FROM leaves
                    WHERE organization_id = $1 AND user_id = ANY($2::bigint[]) AND status = 'approved'
                      AND start_date >= $3 AND end_date <= $4 AND leave_type <> 'wfh'`, [oId, ids, prevWin.fyStart, prevWin.fyEnd]),
      pool.query(`SELECT user_id, leave_type, delta FROM leave_balance_adjustments WHERE org_id = $1 AND year = $2 AND user_id = ANY($3::bigint[])`, [oId, year - 1, ids]),
      holidayRowsBetween(oId, prevWin.fyStart, prevWin.fyEnd),
    ]) : [{ rows: [] }, { rows: [] }, []];

    const branchOf = new Map(usersRes.rows.map(u => [Number(u.id), u.branch_id == null ? null : Number(u.branch_id)]));
    const orgPolicies = polRes.rows.filter(p => p.branch_id == null);
    const policiesFor = (branchId) => {                       // branch-specific set if the branch has any, else the org-wide set
      if (branchId != null) { const own = polRes.rows.filter(p => Number(p.branch_id) === branchId); if (own.length) return own; }
      return orgPolicies;
    };
    const scheduleCache = new Map();                          // effective work schedule per branch (users without a branch → org schedule)
    const scheduleFor = async (branchId) => {
      const k = branchId == null ? 'org' : String(branchId);
      if (!scheduleCache.has(k)) scheduleCache.set(k, branchId == null ? await getSettings(oId) : await getEffectiveWorkSchedule(oId, branchId));
      return scheduleCache.get(k);
    };
    const group = (rows) => { const m = new Map(); for (const r of rows) { const k = Number(r.user_id); (m.get(k) || m.set(k, []).get(k)).push(r); } return m; };
    const leavesBy = group(leavesRes.rows), adjBy = group(adjRes.rows), prevLeavesBy = group(prevLeavesRes.rows), prevAdjBy = group(prevAdjRes.rows);

    const balances = {};
    for (const id of ids) {
      if (!branchOf.has(id)) continue;                        // (assertUsersAccessible already guarantees membership)
      const b = branchOf.get(id);
      const policies = policiesFor(b), settings = await scheduleFor(b);
      const carry = computeCarryIn({
        policies, prevLeaves: prevLeavesBy.get(id) || [], prevAdjustments: prevAdjBy.get(id) || [], settings,
        prevHolidays: holidaySetFor(prevHolRows, b), prevYear: year - 1,
      });
      balances[id] = calcLeaveBalances({ policies, leaves: leavesBy.get(id) || [], settings, adjustments: adjBy.get(id) || [], year, holidays: holidaySetFor(holRows, b), carry });
    }
    res.json({ year, balances });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /balance/adjustments ─────────────────────────────────────────
router.get('/balance/adjustments', auth, withBranchContext, async (req, res) => {
  try {
    const oId      = orgId(req);
    const year     = parseInt(req.query.year) || new Date().getFullYear();
    const targetId = (isAdminRole(req.user.role) && req.query.userId)
      ? parseInt(req.query.userId)
      : req.user.id;

    // Branch isolation: validate admin has access to the requested employee.
    if (isAdminRole(req.user.role) && req.query.userId && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, targetId, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    const { data: rows, error } = await db
      .from('leave_balance_adjustments')
      .select('*')
      .eq('user_id', targetId)
      .eq('org_id', oId)
      .eq('year', year)
      .order('created_at', { ascending: false });
    if (error) throw error;

    if (!rows?.length) return res.json([]);

    const adjByIds = [...new Set(rows.map(r => r.adjusted_by).filter(Boolean))];
    const { data: adjUsers } = adjByIds.length
      ? await db.from('users').select('id, name, avatar_color').in('id', adjByIds)
      : { data: [] };
    const adjMap = {};
    (adjUsers || []).forEach(u => { adjMap[u.id] = u; });

    res.json(rows.map(r => ({
      ...r,
      adjusted_by_name:  adjMap[r.adjusted_by]?.name         || 'HR',
      adjusted_by_color: adjMap[r.adjusted_by]?.avatar_color || '#3525cd',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: POST /balance/adjust ──────────────────────────────────────────────
router.post('/balance/adjust', auth, hasPermission('leaves', 'manage'), withBranchContext, async (req, res) => {
  try {
    const oId   = orgId(req);
    const { userId, leave_type, delta, reason, year } = req.body;
    const targetYear  = parseInt(year)  || new Date().getFullYear();
    const parsedDelta = parseFloat(delta);

    if (!userId || !leave_type || !reason?.trim())
      return res.status(400).json({ error: 'userId, leave_type, delta, and reason are required' });
    if (isNaN(parsedDelta) || parsedDelta === 0)
      return res.status(400).json({ error: 'delta must be a non-zero number' });
    if (Math.abs(parsedDelta) > 365)
      return res.status(400).json({ error: 'delta cannot exceed 365 days' });

    const { data: emp } = await db.from('users')
      .select('id').eq('id', parseInt(userId)).eq('organization_id', oId).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Employee not found in this organisation' });

    // Branch isolation: admin must have access to this employee's branch.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, parseInt(userId), oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    const [policy] = await getEffectivePolicies(oId, parseInt(userId), { leaveType: leave_type });
    if (!policy) return res.status(400).json({ error: 'Leave type not found in active policies' });

    const { data, error } = await db.from('leave_balance_adjustments').insert({
      user_id:     parseInt(userId),
      org_id:      oId,
      leave_type,
      year:        targetYear,
      delta:       parsedDelta,
      reason:      reason.trim(),
      adjusted_by: req.user.id,
    }).select().single();

    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /team-dashboard ───────────────────────────────────────────────
router.get('/team-dashboard', auth, async (req, res) => {
  try {
    const oId = orgId(req);
    const today = localDateStr ? localDateStr() : new Date().toISOString().split('T')[0];

    const { data: dept } = await db
      .from('departments').select('id, name')
      .eq('head_user_id', req.user.id).eq('organization_id', oId).maybeSingle();
    if (!dept) return res.json({ is_dept_head: false });

    // BUG_153: fall back to matching by department name if department_id FK not set
    const memberRes = await pool.query(
      `SELECT id, name, avatar_color, employee_status
       FROM users
       WHERE organization_id = $1
         AND (department_id = $2 OR department = $3)
         AND id != $4
         AND employee_status IN ('active', 'probation')`,
      [oId, dept.id, dept.name, req.user.id]
    );
    const members   = memberRes.rows || [];
    const memberIds = members.map(m => m.id);

    let attMap = {};
    if (memberIds.length > 0) {
      const { data: attRows } = await db
        .from('attendance').select('user_id, status')
        .eq('date', today).in('user_id', memberIds);
      for (const a of attRows || []) attMap[a.user_id] = a.status;
    }

    const present = Object.values(attMap).filter(s => ['present', 'wfh', 'half_day'].includes(s)).length;
    const onLeave = Object.values(attMap).filter(s => s === 'on_leave').length;
    const notIn   = memberIds.length - Object.keys(attMap).length;

    // Count both old (pending_dept) and new (pending_approval at dept head level) leaves
    let pendingCount = 0;
    if (memberIds.length > 0) {
      const { count: oldCount } = await db.from('leaves')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_dept').in('user_id', memberIds).eq('organization_id', oId);

      let deptNewCount = 0;
      try {
        const newPending = await engine.getMyPendingLeaves(req.user.id, req.user.role, oId);
        deptNewCount = newPending.filter(l =>
          ['reporting_manager','department_head'].includes(l.current_level_role_type) &&
          memberIds.includes(l.user_id)
        ).length;
      } catch (_) { /* workflow tables not yet migrated — skip */ }

      pendingCount = (oldCount || 0) + deptNewCount;
    }

    const next7 = new Date(today); next7.setDate(next7.getDate() + 7);
    const next7Str = next7.toISOString().split('T')[0];
    let upcomingLeaves = [];
    if (memberIds.length > 0) {
      const memberMap = {};
      for (const m of members) memberMap[m.id] = m.name;
      const { data: upcoming } = await db.from('leaves')
        .select('user_id, start_date, end_date, leave_type, leave_time')
        .eq('status', 'approved').in('user_id', memberIds)
        .gte('start_date', today).lte('start_date', next7Str)
        .order('start_date').limit(5);
      upcomingLeaves = (upcoming || []).map(l => ({ ...l, name: memberMap[l.user_id] || '' }));
    }

    res.json({
      is_dept_head:     true,
      department:       dept,
      team_count:       memberIds.length,
      present_today:    present,
      on_leave_today:   onLeave,
      not_checked_in:   notIn,
      pending_approvals: pendingCount,
      upcoming_leaves:  upcomingLeaves,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /is-dept-head ─────────────────────────────────────────────────
router.get('/is-dept-head', auth, async (req, res) => {
  try {
    const oId = orgId(req);
    const { data: dept } = await db
      .from('departments')
      .select('id, name')
      .eq('head_user_id', req.user.id)
      .eq('organization_id', oId)
      .maybeSingle();

    if (!dept) return res.json({ is_dept_head: false });
    res.json({ is_dept_head: true, department_id: dept.id, department_name: dept.name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /pending-department (legacy + new flow) ───────────────────────
router.get('/pending-department', auth, withBranchContext, async (req, res) => {
  try {
    const oId = orgId(req);

    // Legacy: employees in dept or reporting to this user
    const { data: myDepts } = await db
      .from('departments')
      .select('id')
      .eq('head_user_id', req.user.id)
      .eq('organization_id', oId);

    const deptEmpIds = [];
    if (myDepts?.length) {
      const deptIds = myDepts.map(d => d.id);
      const empRes = await pool.query(
        `SELECT id FROM users WHERE department_id = ANY($1::bigint[]) AND organization_id = $2 AND id != $3`,
        [deptIds, oId, req.user.id]
      );
      deptEmpIds.push(...empRes.rows.map(r => r.id));
    }

    const reporteeRes = await pool.query(
      `SELECT id FROM users WHERE reporting_to = $1 AND organization_id = $2 AND id != $1`,
      [req.user.id, oId]
    );
    const reporteeIds = reporteeRes.rows.map(r => r.id);
    const allEmpIds = [...new Set([...deptEmpIds, ...reporteeIds])];

    let legacyLeaves = [];
    if (allEmpIds.length) {
      const { data } = await db
        .from('leaves')
        .select('*, users!leaves_user_id_fkey(id, name, email, department, avatar_color, position)')
        .eq('organization_id', oId)
        .eq('status', 'pending_dept')
        .in('user_id', allEmpIds)
        .order('created_at', { ascending: false });
      legacyLeaves = (data || []).map(l => ({ ...l, ...l.users, users: undefined, _flow: 'legacy' }));
    }

    // New workflow: leaves assigned to this user at dept-level roles
    let newDeptLeaves = [];
    try {
      const newLeaves = await engine.getMyPendingLeaves(req.user.id, req.user.role, oId);
      newDeptLeaves = newLeaves
        .filter(l => ['reporting_manager','department_head'].includes(l.current_level_role_type))
        .map(l => ({ ...l, _flow: 'new' }));
    } catch (_) { /* workflow tables not yet migrated — skip */ }

    // Branch isolation: when called by an HR admin, filter to accessible branch employees.
    if (isAdminRole(req.user.role) && req.user.role !== 'root_admin') {
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null) {
        const empSet = new Set(empIds);
        const combined = [...legacyLeaves, ...newDeptLeaves];
        return res.json(combined.filter(l => empSet.has(l.user_id)));
      }
    }
    res.json([...legacyLeaves, ...newDeptLeaves]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /pending-root (legacy + new flow) ─────────────────────────────
router.get('/pending-root', auth, hasPermission('leaves', 'approve'), withBranchContext, async (req, res) => {
  try {
    const oId = orgId(req);

    // Legacy pending_root
    const { data: legacy } = await db
      .from('leaves')
      .select('*, users!leaves_user_id_fkey(id, name, email, department, avatar_color, position)')
      .eq('organization_id', oId)
      .eq('status', 'pending_root')
      .order('created_at', { ascending: false });

    const legacyLeaves = (legacy || []).map(l => ({ ...l, ...l.users, users: undefined, _flow: 'legacy' }));

    // New workflow: leaves at admin/root level
    let newAdminLeaves = [];
    try {
      const newLeaves = await engine.getMyPendingLeaves(req.user.id, req.user.role, oId);
      newAdminLeaves = newLeaves
        .filter(l => ['hr_admin','root_admin'].includes(l.current_level_role_type))
        .map(l => ({ ...l, _flow: 'new' }));
    } catch (_) { /* workflow tables not yet migrated — skip */ }

    // Branch isolation: filter leaves to only those from accessible-branch employees.
    // Applies to all roles (root_admin included) when a specific branch is selected.
    const empIds = await resolveEmployeeIds(req.branchContext, oId);
    if (empIds !== null) {
      const empSet = new Set(empIds);
      const combined = [...legacyLeaves, ...newAdminLeaves];
      return res.json(combined.filter(l => empSet.has(l.user_id)));
    }
    res.json([...legacyLeaves, ...newAdminLeaves]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET / — list leaves ───────────────────────────────────────────────
/** WFH requests are stored either as leave_time = 'wfh' or leave_type = 'wfh' (NULL-safe, matches the page's old client-side test). */
function applyKindFilter(q, kind) {
  if (kind === 'wfh')   return q.or('leave_time.eq.wfh,leave_type.eq.wfh');
  if (kind === 'leave') return q.or('leave_time.is.null,leave_time.neq.wfh').or('leave_type.is.null,leave_type.neq.wfh');
  return q;
}

router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const { userId, year, month } = req.query;
    const lp = parseListParams(req.query);

    // Scope: who's leaves may this caller see. Resolved once, applied to BOTH the rows query and the total-count query.
    let scopeUserId = null;
    if (!isAdminRole(req.user.role)) {
      // Employees see only their own leaves — no branch filter needed
      scopeUserId = req.user.id;
    } else if (userId) {
      // Admin requested a specific employee — verify org membership and branch access.
      if (!await canAdminAccessUser(req.branchContext, parseInt(userId, 10), orgId(req)))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      scopeUserId = parseInt(userId);
    }
    const applyScope = (q) => scopeUserId != null
      ? { query: q.eq('user_id', scopeUserId), empty: false }
      // Admin viewing all leaves — branch scope as a SQL subquery (no employee-id list round trip)
      : applyBranchUserScope(q, 'user_id', req.branchContext, orgId(req));
    // Every filter that narrows the result set (date window, status, type, kind). Optional server-side narrowing is applied
    // AFTER the RBAC + branch scope above and never widens it.
    const applyFilters = (q) => {
      if (year && month) {
        const ym = `${year}-${String(month).padStart(2,'0')}`;
        q = q.lte('start_date', `${ym}-31`).gte('end_date', `${ym}-01`);
      } else if (year) {
        q = q.lte('start_date', `${year}-12-31`).gte('end_date', `${year}-01-01`);
      } else if (req.query.startDate && req.query.endDate) {
        q = q.lte('start_date', req.query.endDate).gte('end_date', req.query.startDate);
      }
      if (lp.statuses) q = q.in('status', lp.statuses);
      if (lp.types)    q = q.in('leave_type', lp.types);
      if (lp.from)     q = q.gte('end_date', lp.from);     // leave overlaps [from, to]
      if (lp.to)       q = q.lte('start_date', lp.to);
      return applyKindFilter(q, lp.kind);
    };

    let query = db.from('leaves')
      .select('*, users!leaves_user_id_fkey(name, email, avatar_color, department), approver:users!leaves_approved_by_fkey(name)')
      .eq('organization_id', orgId(req))
      // `id` is the tiebreaker: leaves created in one statement / import share a created_at, and without a total order the same
      // row could land on two pages (or on none) while paging.
      .order(lp.sort === 'start_asc' ? 'start_date' : 'created_at', { ascending: lp.sort === 'start_asc' })
      .order('id', { ascending: lp.sort === 'start_asc' });

    const scope = applyScope(query);
    if (scope.empty) {
      if (lp.paging) setPagingHeaders(res, lp.paging, false, 0);
      return res.json([]);
    }
    query = applyFilters(scope.query);
    if (lp.paging) query = query.range(lp.paging.offset, lp.paging.offset + lp.paging.limit);   // +1 row = "has more" probe

    // Total of the whole filtered set (not just this page) — same scope + filters, count only, runs alongside the rows query.
    const totalPromise = !lp.paging ? null : (async () => {
      const cq = applyScope(db.from('leaves').select('id', { count: 'exact', head: true }).eq('organization_id', orgId(req))).query;
      const { count, error: cErr } = await applyFilters(cq);
      if (cErr) throw new Error(cErr.message);
      return count || 0;
    })();

    const [{ data: rawLeaves, error }, total] = await Promise.all([query, totalPromise]);
    if (error) throw new Error(error.message);
    let data = rawLeaves;
    if (lp.paging) {
      setPagingHeaders(res, lp.paging, (rawLeaves || []).length > lp.paging.limit, total);
      data = (rawLeaves || []).slice(0, lp.paging.limit);
    }

    const result = (data || []).map(l => ({
      ...l, ...l.users,
      approver_name: l.approver?.name,
      users: undefined, approver: undefined,
    }));

    // Fetch workflow levels once — used for both current_level_role_type enrichment
    // and approval trail level_label. Hoist levelLabelMap so trail building can use it.
    let levelLabelMap = {}; // { levelNum -> level_label }
    if (isAdminRole(req.user.role)) {
      try {
        const wf = await engine.getOrgWorkflow(orgId(req));
        const levelMap = {};
        for (const lvl of wf.levels) {
          const n = Number(lvl.level_number);
          levelMap[n]      = lvl.role_type;
          levelLabelMap[n] = (lvl.level_label || '').trim() || lvl.role_type;
        }
        for (const l of result) {
          if (l.status === 'pending_approval' && l.current_level != null) {
            l.current_level_role_type = levelMap[Number(l.current_level)] || null;
          }
        }
      } catch (_) { /* workflow tables not yet migrated — skip */ }
    }

    // Attach approval trail (completed approvals) to each leave in one batch query.
    // Initialise to empty so the frontend always gets the array (never undefined).
    for (const l of result) l.approval_trail = [];

    try {
      const leaveIds = result.map(l => Number(l.id)).filter(Boolean);
      if (leaveIds.length > 0) {
        // Use raw pool.query so we are immune to column-list errors (e.g. if the
        // `level` column was added in a later migration, SELECT * still works).
        // Try with level column first; fall back to without it if the column
        // doesn't exist yet (workflow migration not applied to this database).
        let logRows = [];
        try {
          ({ rows: logRows } = await pool.query(
            `SELECT leave_id, actor_name, action, level, created_at
               FROM leave_approval_log
              WHERE org_id = $1
                AND leave_id = ANY($2::int[])
              ORDER BY leave_id, created_at ASC`,
            [Number(orgId(req)), leaveIds]
          ));
        } catch (_colErr) {
          // level column missing — retry without it
          ({ rows: logRows } = await pool.query(
            `SELECT leave_id, actor_name, action, NULL AS level, created_at
               FROM leave_approval_log
              WHERE org_id = $1
                AND leave_id = ANY($2::int[])
              ORDER BY leave_id, created_at ASC`,
            [Number(orgId(req)), leaveIds]
          ));
        }

        const trailMap = {};
        for (const row of logRows) {
          if (!row.action?.includes('approved')) continue;
          const lid = Number(row.leave_id);
          if (!trailMap[lid]) trailMap[lid] = [];
          const lvlNum = row.level != null ? Number(row.level) : null;
          trailMap[lid].push({
            actor_name:  row.actor_name,
            action:      row.action,
            level:       lvlNum,
            level_label: lvlNum != null ? (levelLabelMap[lvlNum] || null) : null,
            created_at:  row.created_at,
          });
        }
        for (const l of result) {
          if (trailMap[l.id]) l.approval_trail = trailMap[l.id];
        }
      }
    } catch (e) {
      console.warn('[leaves] approval trail fetch skipped:', e.message);
    }

    res.json(lp.view === 'list' ? compactRows(result, 'leaves') : result);
  } catch (err) {
    if (err instanceof ListParamError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTE: GET /counts?from=&to=&userId=&status=&type=&kind= ─────────────────────────────────────────────────────
// Counts for the Leaves page without downloading the rows behind them. Same scope as GET / (employees: own leaves; admins:
// their branch scope, or one employee via userId with the same access check) and the same date-overlap rule
// (`from` = leaves ending on/after, `to` = leaves starting on/before). One aggregate query returns:
//   pending, wfh_pending   tab badges: pending leaves / pending WFH in the date window (type / kind / status filters ignored)
//   summary                { total, pending, approved, rejected } of the WHOLE filtered set for the summary cards.
//                          `type` and `kind` narrow it; `status` does NOT (the cards are the status breakdown of the other
//                          filters, so they stay useful while one status is selected)
//   filtered_total         rows matching every filter INCLUDING `status` = the pagination total of GET / with the same params
// PENDING_STATUSES is the page's own definition of pending; "rejected" is the single status 'rejected'.
const COUNT_PENDING_STATUSES = ['pending', 'pending_dept', 'pending_root', 'pending_approval'];
router.get('/counts', auth, withBranchContext, async (req, res) => {
  const EMPTY = { pending: 0, wfh_pending: 0, summary: { total: 0, pending: 0, approved: 0, rejected: 0 }, filtered_total: 0 };
  try {
    const oId = orgId(req);
    const lp = parseListParams({ from: req.query.from, to: req.query.to, status: req.query.status, type: req.query.type, kind: req.query.kind });
    const params = [oId, COUNT_PENDING_STATUSES];
    const add = (v) => { params.push(v); return `$${params.length}`; };
    let scope = '';
    if (!isAdminRole(req.user.role)) { scope = `AND l.user_id = ${add(req.user.id)}`; }
    else if (req.query.userId) {
      const uid = parseInt(req.query.userId, 10);
      if (!Number.isInteger(uid) || !await canAdminAccessUser(req.branchContext, uid, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      scope = `AND l.user_id = ${add(uid)}`;
    } else {
      const st = getFilterState(req.branchContext);
      if (st.type === 'none') return res.json(EMPTY);
      if (st.type === 'specific') scope = `AND l.user_id IN (SELECT id FROM users WHERE organization_id = $1 AND branch_id = ${add(st.branchId)})`;
      if (st.type === 'multi')    scope = `AND l.user_id IN (SELECT id FROM users WHERE organization_id = $1 AND branch_id = ANY(${add(st.branchIds)}::bigint[]))`;
    }
    const window = [];
    if (lp.from) window.push(`l.end_date >= ${add(lp.from)}`);
    if (lp.to)   window.push(`l.start_date <= ${add(lp.to)}`);

    const IS_WFH = `(l.leave_time = 'wfh' OR l.leave_type = 'wfh')`;
    const NOT_WFH = `(COALESCE(l.leave_time,'') <> 'wfh' AND COALESCE(l.leave_type,'') <> 'wfh')`;
    const PENDING = `l.status = ANY($2::text[])`;
    const card = [
      lp.kind === 'wfh' ? IS_WFH : lp.kind === 'leave' ? NOT_WFH : 'TRUE',
      lp.types ? `l.leave_type = ANY(${add(lp.types)}::text[])` : 'TRUE',
    ].join(' AND ');
    const statusSql = lp.statuses ? `l.status = ANY(${add(lp.statuses)}::text[])` : 'TRUE';

    const { rows } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE ${NOT_WFH} AND ${PENDING})::int                       AS pending,
              COUNT(*) FILTER (WHERE ${IS_WFH} AND ${PENDING})::int                        AS wfh_pending,
              COUNT(*) FILTER (WHERE ${card})::int                                         AS s_total,
              COUNT(*) FILTER (WHERE ${card} AND ${PENDING})::int                          AS s_pending,
              COUNT(*) FILTER (WHERE ${card} AND l.status = 'approved')::int               AS s_approved,
              COUNT(*) FILTER (WHERE ${card} AND l.status = 'rejected')::int               AS s_rejected,
              COUNT(*) FILTER (WHERE ${card} AND ${statusSql})::int                        AS filtered_total
         FROM leaves l
        WHERE l.organization_id = $1 ${scope} ${window.map(w => `AND ${w}`).join(' ')}`, params);
    const r = rows[0];
    res.json({
      pending: r.pending, wfh_pending: r.wfh_pending,
      summary: { total: r.s_total, pending: r.s_pending, approved: r.s_approved, rejected: r.s_rejected },
      filtered_total: r.filtered_total,
    });
  } catch (err) {
    if (err instanceof ListParamError) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── ROUTE: POST / — create leave ─────────────────────────────────────────────
router.post('/', auth, withBranchContext, async (req, res) => {
  try {
    const { start_date, end_date, leave_type, reason, user_id, leave_time, half_type } = req.body;
    if (isAdminRole(req.user.role) && user_id && parseInt(user_id, 10) !== req.user.id &&
        !await canAdminAccessUser(req.branchContext, parseInt(user_id, 10), orgId(req)))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
    if (!start_date || !end_date) return res.status(400).json({ error: 'Start and end dates required' });
    if (start_date > end_date)    return res.status(400).json({ error: 'Start date must be before end date' });

    // Holiday validation only applies to employee-submitted leaves (not admin on-behalf).
    // Admins may legitimately create leaves on holidays (e.g., compensatory leave).
    const isSubmittedByAdmin = isAdminRole(req.user.role) && user_id && parseInt(user_id) !== req.user.id;
    if (leave_time !== 'wfh' && leave_type !== 'wfh' && !isSubmittedByAdmin) {
      const settings     = await getSettingsForUser(orgId(req), req.user.id);
      const holidayDates = await fetchHolidaySet(orgId(req), start_date, end_date, req.user.id);
      const checkDates   = buildWorkingDates(start_date, end_date, settings, holidayDates);
      if (checkDates.length === 0) {
        const isSingle = start_date === end_date;
        const isHoliday = isSingle && holidayDates.has(start_date);
        return res.status(400).json({
          error: isHoliday
            ? `${start_date} is a public holiday. Leave cannot be applied on a holiday.`
            : isSingle
              ? 'The selected date is a weekend. Please choose a working day.'
              : 'The selected date range contains no working days (all dates fall on weekends or public holidays).',
        });
      }
    }

    const targetUserId = (isAdminRole(req.user.role) && user_id) ? parseInt(user_id) : req.user.id;
    const isOnBehalf   = isAdminRole(req.user.role) && targetUserId !== req.user.id;

    // ── LEAVE-002: Balance + policy rules for employee self-submissions ─────────────────────────────
    // Skip for WFH and admin on-behalf. The balance is the SAME computation the employee sees (loadUserBalances):
    // leave cycle (not the calendar year), holiday-aware, carry-forward and adjustments included.
    if (!isOnBehalf && leave_time !== 'wfh' && leave_type !== 'wfh') {
      const oId      = orgId(req);
      const type     = leave_type || 'casual';
      let ctx = null;
      try {
        const settings   = await getSettingsForUser(oId, targetUserId);
        const holidaySet = await fetchHolidaySet(oId, start_date, end_date, targetUserId);
        const newDays    = leave_time === 'half' ? 0.5 : buildWorkingDates(start_date, end_date, settings, holidaySet).length;
        const year       = await cycleYearForDate(oId, start_date);
        ctx = { newDays, ...(await loadUserBalances(oId, targetUserId, year)) };
      } catch (balanceErr) {
        // Non-critical: if the check cannot be computed, allow submission (avoid blocking employees)
        console.warn('[leaves] balance check skipped:', balanceErr.message);
      }

      if (ctx) {
        // Policy rules configured in Leave Policies (previously only stored, never enforced).
        const [pol] = await getEffectivePolicies(oId, targetUserId, { leaveType: type });
        if (pol) {
          const { rows: ext } = await pool.query(
            `SELECT half_day_allowed, min_notice_days, max_consecutive_days FROM leave_policies WHERE id = $1`, [pol.id]).catch(() => ({ rows: [] }));
          const rule = ext[0] || {};
          if (leave_time === 'half' && rule.half_day_allowed === false)
            return res.status(400).json({ error: `Half-day is not allowed for "${pol.label || type}" leave.` });
          const notice = Number(rule.min_notice_days) || 0;
          if (notice > 0) {
            const daysAhead = Math.round((new Date(start_date + 'T12:00:00Z') - new Date(localDateStr() + 'T12:00:00Z')) / 86400000);
            if (daysAhead < notice)
              return res.status(400).json({ error: `"${pol.label || type}" leave must be applied at least ${notice} day(s) in advance.` });
          }
          const maxRun = Number(rule.max_consecutive_days) || 0;
          if (maxRun > 0 && leave_time !== 'half' && ctx.newDays > maxRun)
            return res.status(400).json({ error: `"${pol.label || type}" leave cannot exceed ${maxRun} consecutive working day(s) per request (requested ${ctx.newDays}).` });
        }

        const bal = (ctx.balances || []).find(b => b.leave_type === type);
        if (bal && ctx.newDays > 0 && Number(bal.allocated) > 0) {
          const available = Number(bal.allocated) + Number(bal.carried_forward || 0) + Number(bal.adjustment || 0) - Number(bal.used) - Number(bal.pending);
          if (ctx.newDays > available) {
            const remaining = Math.max(0, available);
            return res.status(400).json({
              error: `Insufficient leave balance. You have ${remaining} day(s) available for "${type}" leave but requested ${ctx.newDays} day(s). Please adjust your request or contact HR.`,
            });
          }
        }
      }
    }

    // ── Admin creates on behalf → auto-approve ────────────────────────────────
    if (isOnBehalf) {
      const settings     = await getSettingsForUser(orgId(req), targetUserId);
      const attStatus    = leave_time === 'half' ? 'half_day' : (leave_time === 'wfh' || leave_type === 'wfh') ? 'wfh' : 'on_leave';
      const holidayDates = await fetchHolidaySet(orgId(req), start_date, end_date, targetUserId);
      const workDates    = buildWorkingDates(start_date, end_date, settings, holidayDates);
      const approvedAt   = new Date().toISOString();

      const client = await pool.connect();
      let leaveId;
      try {
        await client.query('BEGIN');
        const leaveRes = await client.query(
          `INSERT INTO leaves
             (user_id, start_date, end_date, leave_type, reason, leave_time, half_type,
              status, approved_by, approved_at, organization_id,
              dept_head_status, root_admin_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'approved',$8,$9,$10,'approved','approved')
           RETURNING id`,
          [targetUserId, start_date, end_date, leave_type||'casual', reason||'',
           leave_time||'full', leave_time === 'half' ? (half_type||'first_half') : null,
           req.user.id, approvedAt, orgId(req)]
        );
        leaveId = leaveRes.rows[0].id;
        for (const ds of workDates) {
          await client.query(
            `INSERT INTO attendance (user_id, date, status, organization_id)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (user_id, date, organization_id) DO UPDATE SET status = EXCLUDED.status`,
            [targetUserId, ds, attStatus, orgId(req)]
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Leave creation failed. ' + err.message });
      } finally { client.release(); }

      const { data } = await db.from('leaves')
        .select('*, users!leaves_user_id_fkey(name, email, department)')
        .eq('id', leaveId).single();

      if (data.users?.email) {
        const { orgName: _on, orgEmail: _oe } = await getOrgContext(orgId(req));
        sendMail({ to: data.users.email, subject: `Leave Added — ${req.user.name || 'HR'}`, html: leaveStatusHtml(data.users, data, 'approved', req.user.name, _on, _oe) });
      }
      return res.json(flatOne(data));
    }

    // ── Employee self-submit: use workflow engine (fallback to legacy if not migrated) ──
    let wfInit;
    try {
      wfInit = await engine.initWorkflow(targetUserId, orgId(req));
    } catch (_) {
      // Workflow tables not yet migrated — use legacy 2-step flow
      const deptHeadId = await findDeptHead(targetUserId, orgId(req));
      wfInit = {
        status:              deptHeadId ? 'pending_dept' : 'pending',
        workflow_id:         null,
        current_level:       null,
        current_approver_id: deptHeadId || null,
      };
    }

    const insertPayload = {
      user_id:         targetUserId,
      start_date, end_date,
      leave_type:      leave_type || 'casual',
      reason:          reason || '',
      leave_time:      leave_time || 'full',
      half_type:       leave_time === 'half' ? (half_type || 'first_half') : null,
      organization_id: orgId(req),
      status:          wfInit.status,
      // Only set workflow columns when migration has run (workflow_id present)
      ...(wfInit.workflow_id != null && {
        workflow_id:         wfInit.workflow_id,
        current_level:       wfInit.current_level,
        current_approver_id: wfInit.current_approver_id,
      }),
    };

    const { data, error } = await db.from('leaves')
      .insert(insertPayload)
      .select('*, users!leaves_user_id_fkey(name, email, department)')
      .single();
    if (error) throw new Error(error.message);

    const leaveId  = data.id;
    const emp      = data.users || {};
    const empName  = emp.name  || req.user.name;
    const empEmail = emp.email || req.user.email;

    logApprovalAction({
      leaveId, oId: orgId(req), actorId: req.user.id, actorName: empName,
      action: 'submitted', fromStatus: null, toStatus: wfInit.status,
      level: wfInit.current_level,
    });

    // Notify the first approver
    const leaveNotifyTitle = `New ${leave_type === 'wfh' ? 'WFH' : 'Leave'} Request from ${empName}`;
    const leaveNotifyMsg   = `${empName} has applied for ${leave_type || 'casual'} leave from ${start_date} to ${end_date}. Your approval is required.`;

    if (wfInit.current_approver_id) {
      // Specific user approver (reporting manager / dept head / specific user)
      const { data: approverUser } = await db.from('users')
        .select('name, email').eq('id', wfInit.current_approver_id).maybeSingle();

      notify(wfInit.current_approver_id, leaveNotifyTitle, leaveNotifyMsg, orgId(req));

      // BUG_096: notify branch-scoped HR/root admins (excluding the specific approver)
      notifyAdmins(orgId(req), leaveNotifyTitle, leaveNotifyMsg, wfInit.current_approver_id, targetUserId);

      // BUG_096: notify dept head if not already the current approver
      getDeptHeadId(targetUserId, orgId(req)).then(headId => {
        if (headId && headId !== wfInit.current_approver_id) {
          notify(headId, leaveNotifyTitle, leaveNotifyMsg, orgId(req));
        }
      });

      if (approverUser?.email && typeof leaveDeptApprovalHtml === 'function') {
        const { orgName: _on, orgEmail: _oe } = await getOrgContext(orgId(req));
        sendMail({
          to: approverUser.email,
          subject: `Leave Request Pending Your Approval — ${empName}`,
          html: leaveDeptApprovalHtml({ name: empName, email: empEmail, department: emp.department }, data, approverUser.name, _on, _oe),
        });
      }
    } else {
      // Role-based approver (hr_admin / root_admin) OR legacy flow with no dept head
      // → notify all org recipients via email
      const recipients = await getRecipients(orgId(req));
      if (recipients.length > 0) {
        const { orgName: _on, orgEmail: _oe } = await getOrgContext(orgId(req));
        sendMail({
          to: recipients,
          subject: `${leave_type === 'wfh' ? 'WFH Request' : 'Leave Request'} — ${empName}`,
          html: leaveAppliedHtml({ name: empName, email: empEmail, department: emp.department }, data, _on, _oe),
        });
      }

      // BUG_096: notify branch-scoped HR/root admins
      notifyAdmins(orgId(req), leaveNotifyTitle, leaveNotifyMsg, targetUserId, targetUserId);

      // BUG_096: in-app notify dept head
      getDeptHeadId(targetUserId, orgId(req)).then(headId => {
        if (headId) notify(headId, leaveNotifyTitle, leaveNotifyMsg, orgId(req));
      });
    }

    return res.json(flatOne(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: PUT /:id — edit leave ─────────────────────────────────────────────
router.put('/:id', auth, withBranchContext, async (req, res) => {
  try {
    const { data: leave } = await db.from('leaves').select('*').eq('id', req.params.id).eq('organization_id', orgId(req)).maybeSingle();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    if (!isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id)) return res.status(403).json({ error: 'Not authorized' });
    if (isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id) && !await canAdminAccessUser(req.branchContext, leave.user_id, orgId(req)))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
    if (['approved','rejected'].includes(leave.status) && !isAdminRole(req.user.role)) {
      return res.status(400).json({ error: 'Cannot edit an approved or rejected leave' });
    }

    const { start_date, end_date, leave_type, reason, leave_time, half_type } = req.body;
    if (start_date && end_date && start_date > end_date) return res.status(400).json({ error: 'Start date must be before end date' });

    await db.from('leaves').update({
      ...(start_date && { start_date }),
      ...(end_date   && { end_date }),
      ...(leave_type && { leave_type }),
      reason:     reason     ?? leave.reason,
      leave_time: leave_time || leave.leave_time,
      half_type:  (leave_time || leave.leave_time) === 'half' ? (half_type || leave.half_type || 'first_half') : null,
    }).eq('id', req.params.id).eq('organization_id', orgId(req));

    const { data } = await db.from('leaves').select('*, users!leaves_user_id_fkey(name)').eq('id', req.params.id).eq('organization_id', orgId(req)).single();
    res.json(flatOne(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: PUT /:id/approve — workflow-aware unified approve ─────────────────
// Handles: new workflow (pending_approval), old pending_root, legacy pending.
// For new workflow: advances to next level OR final-approves.
router.put('/:id/approve', auth, withBranchContext, async (req, res) => {
  try {
    const oId     = orgId(req);
    const { orgName, orgEmail } = await getOrgContext(oId);
    const { data: leave } = await db.from('leaves')
      .select('*').eq('id', req.params.id).eq('organization_id', oId).single();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });

    // Branch isolation: admin must have access to the leave owner's branch.
    if (isAdminRole(req.user.role) && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, leave.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    if (leave.status === 'approved') {
      const { data } = await db.from('leaves').select('*, users!leaves_user_id_fkey(name, email)').eq('id', req.params.id).single();
      return res.json(flatOne(data));
    }

    // ── New workflow leave ────────────────────────────────────────────────────
    if (leave.workflow_id && leave.status === 'pending_approval') {
      const { can, level: currentLevel } = await engine.checkCanApprove(leave, req.user.id, req.user.role);
      if (!can) {
        return res.status(403).json({
          error: 'You are not authorized to approve this leave at its current stage.',
          current_status: leave.status,
          current_level: leave.current_level,
        });
      }

      const workflow = await engine.getOrgWorkflow(oId);
      const notes = req.body?.notes || req.body?.remarks || null;

      // Find next level (skipping optional ones with no approver)
      const nextInfo = await engine.findNextLevel(workflow, leave.current_level, leave.user_id, oId);

      // Log this level's approval
      logApprovalAction({
        leaveId: leave.id, oId, actorId: req.user.id, actorName: req.user.name,
        action: `level_${leave.current_level}_approved`,
        fromStatus: 'pending_approval', toStatus: nextInfo ? 'pending_approval' : 'approved',
        notes, level: leave.current_level,
      });

      // Log skipped levels (levels that findNextLevel skipped)
      if (nextInfo) {
        const skippedLevels = workflow.levels.filter(l =>
          l.level_number > leave.current_level && l.level_number < nextInfo.level.level_number
        );
        for (const sk of skippedLevels) {
          logApprovalAction({
            leaveId: leave.id, oId, actorId: req.user.id, actorName: req.user.name,
            action: `level_${sk.level_number}_skipped`,
            fromStatus: 'pending_approval', toStatus: 'pending_approval',
            notes: `No ${sk.level_label || sk.role_type} found; auto-skipped`,
            level: sk.level_number,
          });
        }
      }

      if (!nextInfo) {
        // ── Final level approved — create attendance + mark approved ────────
        const settings     = await getSettingsForUser(oId, leave.user_id);
        const holidayDates = await fetchHolidaySet(oId, leave.start_date, leave.end_date, leave.user_id);
        const workDates    = buildWorkingDates(leave.start_date, leave.end_date, settings, holidayDates);
        const attStatus    = leave.leave_time === 'half' ? 'half_day'
          : (leave.leave_time === 'wfh' || leave.leave_type === 'wfh') ? 'wfh'
          : 'on_leave';
        const approvedAt = new Date().toISOString();

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const ds of workDates) {
            await client.query(
              `INSERT INTO attendance (user_id, date, status, organization_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (user_id, date, organization_id) DO UPDATE SET status = EXCLUDED.status`,
              [leave.user_id, ds, attStatus, oId]
            );
          }
          await client.query(
            `UPDATE leaves SET
               status = 'approved', approved_by = $1, approved_at = $2,
               current_level = NULL, current_approver_id = NULL
             WHERE id = $3 AND organization_id = $4`,
            [req.user.id, approvedAt, leave.id, oId]
          );
          await client.query('COMMIT');
        } catch (txErr) {
          await client.query('ROLLBACK');
          return res.status(500).json({ error: 'Final approval failed: ' + txErr.message });
        } finally { client.release(); }

        notify(leave.user_id, 'Leave Approved',
          `Your leave request from ${leave.start_date} to ${leave.end_date} has been approved by ${req.user.name}.`,
          oId);

        const { data: updated } = await db.from('leaves')
          .select('*, users!leaves_user_id_fkey(name, email)').eq('id', leave.id).single();
        if (updated.users?.email) {
          sendMail({ to: updated.users.email, subject: 'Your Leave Request has been Approved', html: leaveStatusHtml(updated.users, leave, 'approved', req.user.name, orgName, orgEmail) });
        }
        return res.json(flatOne(updated));

      } else {
        // ── Intermediate level — advance to next ─────────────────────────────
        // Use pool.query so a failure throws and doesn't silently leave current_level stale.
        await pool.query(
          `UPDATE leaves SET current_level = $1, current_approver_id = $2
           WHERE id = $3 AND organization_id = $4`,
          [nextInfo.level.level_number, nextInfo.approverId ?? null, leave.id, oId]
        );

        const nextLabel = nextInfo.level.level_label || nextInfo.level.role_type.replace(/_/g, ' ');

        // Notifications are fire-and-forget — never let them bubble a 500
        try {
          notify(leave.user_id,
            'Leave Forwarded for Approval',
            `Your leave request has been approved by ${req.user.name} and forwarded to ${nextLabel}.`,
            oId);

          if (nextInfo.approverId) {
            const { data: _lu } = await db.from('users').select('name').eq('id', leave.user_id).maybeSingle();
            notify(nextInfo.approverId,
              `Leave Request Awaiting Your Approval`,
              `A leave request from ${_lu?.name || 'an employee'} (${leave.start_date} → ${leave.end_date}) requires your action.`,
              oId);
            const { data: nextApprover } = await db.from('users')
              .select('name, email').eq('id', nextInfo.approverId).maybeSingle();
            if (nextApprover?.email && typeof leaveForwardedToRootHtml === 'function') {
              const { data: empUser } = await db.from('users')
                .select('name, email, department').eq('id', leave.user_id).maybeSingle();
              sendMail({
                to: nextApprover.email,
                subject: `Leave Request Forwarded for Your Approval`,
                html: leaveForwardedToRootHtml(empUser || {}, leave, req.user.name, orgName, orgEmail),
              });
            }
          } else {
            // Role-based next approver (hr_admin / root_admin)
            // Only notify admins who have branch access to this employee
            const nextRoleType = nextInfo.level.role_type;
            const roleFilter   = nextRoleType === 'root_admin' ? ['root_admin'] : ['admin', 'root_admin'];
            const branchAdminIds = await getAdminsForEmployee(leave.user_id, oId);
            const { data: allRoleUsers } = await db.from('users')
              .select('id, email, name').eq('organization_id', oId).in('role', roleFilter);
            const roleUsers = (allRoleUsers || []).filter(u => branchAdminIds.includes(Number(u.id)));
            const { data: empUser } = await db.from('users')
              .select('name, email, department').eq('id', leave.user_id).maybeSingle();
            const empName = empUser?.name || 'An employee';
            if (roleUsers?.length) {
              // Use pool.query — db adapter builder has no .catch(); pool.query returns a real Promise.
              const notifRows = roleUsers.map(u => ({
                user_id: u.id, title: `Leave Request Awaiting Your Approval`,
                message: `${empName}'s leave request (${leave.start_date} → ${leave.end_date}) requires your approval at the ${nextLabel} stage.`,
                type: 'leave', organization_id: oId,
              }));
              const nCols = ['user_id','title','message','type','organization_id'];
              const nVals = []; const nSets = [];
              notifRows.forEach((r, ri) => {
                nCols.forEach((c, ci) => { nVals.push(r[c]); nSets.push(`$${ri * nCols.length + ci + 1}`); });
              });
              const nPlaceholders = notifRows.map((_, ri) =>
                `(${nCols.map((_, ci) => `$${ri * nCols.length + ci + 1}`).join(',')})`
              ).join(',');
              await pool.query(
                `INSERT INTO notifications (${nCols.join(',')}) VALUES ${nPlaceholders}`, nVals
              ).catch(() => {});
              const emailList = roleUsers.map(u => u.email).filter(Boolean);
              if (emailList.length > 0 && typeof leaveForwardedToRootHtml === 'function') {
                sendMail({
                  to: emailList,
                  subject: `Leave Forwarded for ${nextLabel} Approval`,
                  html: leaveForwardedToRootHtml(empUser || {}, leave, req.user.name, orgName, orgEmail),
                });
              }
            }
          }
        } catch (notifyErr) {
          console.error('[leave approve] notification error (non-fatal):', notifyErr.message);
        }

        const { data: updated } = await db.from('leaves').select('*').eq('id', leave.id).single();
        return res.json(updated);
      }
    }

    // ── Legacy flow: pending_dept blocks direct approve ───────────────────────
    if (leave.status === 'pending_dept') {
      return res.status(400).json({
        error: 'This leave is waiting for Department Head approval. The Department Head must forward it first.',
        current_status: 'pending_dept',
      });
    }

    if (leave.status === 'rejected' || leave.status === 'cancelled' || leave.status === 'withdrawn') {
      return res.status(409).json({ error: `Cannot approve a ${leave.status} leave.`, current_status: leave.status });
    }

    // Legacy pending_root requires root_admin; old pending requires any admin
    if (leave.status === 'pending_root' && req.user.role !== 'root_admin') {
      return res.status(403).json({ error: 'Only Root Admin can give final approval on pending_root leaves.' });
    }
    if (!isAdminRole(req.user.role)) {
      return res.status(403).json({ error: 'Not authorized to approve this leave.' });
    }

    const settings     = await getSettingsForUser(oId, leave.user_id);
    const holidayDates = await fetchHolidaySet(oId, leave.start_date, leave.end_date, leave.user_id);
    const workDates    = buildWorkingDates(leave.start_date, leave.end_date, settings, holidayDates);
    const attStatus    = leave.leave_time === 'half' ? 'half_day'
      : (leave.leave_time === 'wfh' || leave.leave_type === 'wfh') ? 'wfh'
      : 'on_leave';
    const approvedAt = new Date().toISOString();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const ds of workDates) {
        await client.query(
          `INSERT INTO attendance (user_id, date, status, organization_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, date, organization_id) DO UPDATE SET status = EXCLUDED.status`,
          [leave.user_id, ds, attStatus, oId]
        );
      }
      await client.query(
        `UPDATE leaves SET
           status = 'approved', approved_by = $1, approved_at = $2,
           root_admin_status = 'approved', root_admin_id = $1, root_admin_reviewed_at = $2
         WHERE id = $3 AND organization_id = $4`,
        [req.user.id, approvedAt, req.params.id, oId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Approval failed. ' + err.message });
    } finally { client.release(); }

    logApprovalAction({ leaveId: leave.id, oId, actorId: req.user.id, actorName: req.user.name, action: 'root_approved', fromStatus: leave.status, toStatus: 'approved' });

    const { data: updated } = await db.from('leaves')
      .select('*, users!leaves_user_id_fkey(name, email)').eq('id', req.params.id).single();
    notify(leave.user_id, 'Leave Approved', `Your leave from ${leave.start_date} to ${leave.end_date} has been approved.`, oId);
    if (updated.users?.email) {
      sendMail({ to: updated.users.email, subject: 'Your Leave Request has been Approved', html: leaveStatusHtml(updated.users, leave, 'approved', req.user.name, orgName, orgEmail) });
    }
    res.json(flatOne(updated));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: PUT /:id/reject — workflow-aware unified reject ───────────────────
router.put('/:id/reject', auth, withBranchContext, async (req, res) => {
  try {
    const oId     = orgId(req);
    const { orgName, orgEmail } = await getOrgContext(oId);
    const { data: leave } = await db.from('leaves')
      .select('*').eq('id', req.params.id).eq('organization_id', oId).single();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });

    // Branch isolation: admin must have access to the leave owner's branch.
    // Check before the idempotency shortcut so rejected leaves are not leaked cross-branch.
    if (isAdminRole(req.user.role) && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, leave.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    if (leave.status === 'rejected') return res.json(leave);

    const { remarks } = req.body || {};

    // ── New workflow leave ────────────────────────────────────────────────────
    if (leave.workflow_id && leave.status === 'pending_approval') {
      const { can } = await engine.checkCanApprove(leave, req.user.id, req.user.role);
      if (!can) {
        return res.status(403).json({ error: 'You are not authorized to reject this leave at its current stage.' });
      }

      const rejectedAt = new Date().toISOString();
      await db.from('leaves').update({
        status:              'rejected',
        approved_by:         req.user.id,
        approved_at:         rejectedAt,
        current_level:       null,
        current_approver_id: null,
        remarks:             remarks || null,
      }).eq('id', leave.id).eq('organization_id', oId);

      logApprovalAction({
        leaveId: leave.id, oId, actorId: req.user.id, actorName: req.user.name,
        action: `level_${leave.current_level}_rejected`,
        fromStatus: 'pending_approval', toStatus: 'rejected',
        notes: remarks, level: leave.current_level,
      });

      notify(leave.user_id, 'Leave Request Rejected',
        `Your leave request from ${leave.start_date} to ${leave.end_date} has been rejected by ${req.user.name}.${remarks ? ` Reason: ${remarks}` : ''}`,
        oId);

      const { data: updated } = await db.from('leaves')
        .select('*, users!leaves_user_id_fkey(name, email)').eq('id', leave.id).single();
      if (updated.users?.email) {
        sendMail({ to: updated.users.email, subject: 'Your Leave Request has been Rejected', html: leaveStatusHtml(updated.users, leave, 'rejected', req.user.name, orgName, orgEmail) });
      }
      return res.json(flatOne(updated));
    }

    // ── Legacy: pending_dept blocks reject ────────────────────────────────────
    if (leave.status === 'pending_dept') {
      return res.status(400).json({
        error: 'This leave has not been forwarded by the Department Head yet.',
        current_status: 'pending_dept',
      });
    }

    if (leave.status === 'pending_root' && req.user.role !== 'root_admin') {
      return res.status(403).json({ error: 'Only Root Admin can make the final decision.' });
    }

    const rejectedAt = new Date().toISOString();
    let workDates = [];
    if (leave.status === 'approved') {
      const settings     = await getSettingsForUser(oId, leave.user_id);
      const holidayDates = await fetchHolidaySet(oId, leave.start_date, leave.end_date, leave.user_id);
      workDates = buildWorkingDates(leave.start_date, leave.end_date, settings, holidayDates);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (workDates.length) {
        await client.query(
          `DELETE FROM attendance
           WHERE user_id = $1 AND organization_id = $2
             AND date = ANY($3::text[])
             AND status = ANY(ARRAY['on_leave','half_day','wfh'])`,
          [leave.user_id, oId, workDates]
        );
      }
      await client.query(
        `UPDATE leaves SET
           status = 'rejected', approved_by = $1, approved_at = $2,
           remarks = $3,
           root_admin_status = 'rejected', root_admin_id = $1, root_admin_reviewed_at = $2
         WHERE id = $4 AND organization_id = $5`,
        [req.user.id, rejectedAt, remarks || null, req.params.id, oId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Rejection failed. ' + err.message });
    } finally { client.release(); }

    logApprovalAction({ leaveId: leave.id, oId, actorId: req.user.id, actorName: req.user.name, action: 'root_rejected', fromStatus: leave.status, toStatus: 'rejected', notes: remarks });
    notify(leave.user_id, 'Leave Request Rejected', `Your leave from ${leave.start_date} to ${leave.end_date} has been rejected.`, oId);

    const { data: updated } = await db.from('leaves')
      .select('*, users!leaves_user_id_fkey(name, email)').eq('id', req.params.id).single();
    if (updated.users?.email) {
      sendMail({ to: updated.users.email, subject: 'Your Leave Request has been Rejected', html: leaveStatusHtml(updated.users, leave, 'rejected', req.user.name, orgName, orgEmail) });
    }
    res.json(flatOne(updated));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: POST /:id/withdraw — employee withdraws pending leave ──────────────
router.post('/:id/withdraw', auth, async (req, res) => {
  try {
    const { data: leave } = await db.from('leaves')
      .select('*').eq('id', req.params.id).eq('organization_id', orgId(req)).maybeSingle();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    if (!sameId(leave.user_id, req.user.id)) return res.status(403).json({ error: 'Not authorized' });
    if (!['pending_approval','pending','pending_dept','pending_root'].includes(leave.status)) {
      return res.status(400).json({ error: 'Can only withdraw leaves that are still pending' });
    }

    await db.from('leaves').update({
      status:              'withdrawn',
      current_level:       null,
      current_approver_id: null,
    }).eq('id', req.params.id).eq('organization_id', orgId(req));

    logApprovalAction({
      leaveId: leave.id, oId: orgId(req), actorId: req.user.id, actorName: req.user.name,
      action: 'withdrawn', fromStatus: leave.status, toStatus: 'withdrawn',
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: PUT /:id/revert ───────────────────────────────────────────────────
router.put('/:id/revert', auth, withBranchContext, async (req, res) => {
  const { data: leave } = await db.from('leaves').select('*').eq('id', req.params.id).eq('organization_id', orgId(req)).maybeSingle();
  if (!leave) return res.status(404).json({ error: 'Leave not found' });
  if (!isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id)) return res.status(403).json({ error: 'Not authorized' });
  if (leave.status !== 'approved') return res.status(400).json({ error: 'Only approved leaves can be reverted' });
  // Branch isolation: admin must have access to the leave owner's branch.
  if (isAdminRole(req.user.role) && req.user.role !== 'root_admin') {
    if (!await canAdminAccessUser(req.branchContext, leave.user_id, orgId(req)))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
  }

  const settings     = await getSettingsForUser(orgId(req), leave.user_id);
  const holidayDates = await fetchHolidaySet(orgId(req), leave.start_date, leave.end_date, leave.user_id);
  const workDates    = buildWorkingDates(leave.start_date, leave.end_date, settings, holidayDates);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (workDates.length) {
      await client.query(
        `DELETE FROM attendance
         WHERE user_id = $1 AND organization_id = $2
           AND date = ANY($3::text[])
           AND status = ANY(ARRAY['on_leave','half_day','wfh'])`,
        [leave.user_id, orgId(req), workDates]
      );
    }
    await client.query(
      `UPDATE leaves SET status = 'cancelled' WHERE id = $1 AND organization_id = $2`,
      [req.params.id, orgId(req)]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Revert failed. ' + err.message });
  } finally { client.release(); }

  logApprovalAction({ leaveId: leave.id, oId: orgId(req), actorId: req.user.id, actorName: req.user.name, action: 'cancelled', fromStatus: 'approved', toStatus: 'cancelled' });

  const { data } = await db.from('leaves')
    .select('*, users!leaves_user_id_fkey(name, email)').eq('id', req.params.id).single();
  res.json(flatOne(data));
});

// ─── ROUTE: GET /override-preview ────────────────────────────────────────────
// Read-only: returns the exact days that admin-override-attendance will restore,
// using the same buildWorkingDates + fetchHolidaySet logic as the actual override.
// Used by the frontend to show an accurate warning before the user confirms.
// Query params: userId=<id>&date=YYYY-MM-DD
router.get('/override-preview', auth, async (req, res) => {
  try {
    if (req.user.role !== 'root_admin')
      return res.status(403).json({ error: 'Only Root Admin can preview leave overrides.' });

    const oId = orgId(req);
    const { userId, date } = req.query;

    if (!userId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: 'userId and date (YYYY-MM-DD) required' });

    const uid = parseInt(userId, 10);
    if (!Number.isFinite(uid) || uid <= 0)
      return res.status(400).json({ error: 'Invalid userId' });

    // Verify employee belongs to this org
    const { data: emp } = await db.from('users')
      .select('id').eq('id', uid).eq('organization_id', oId).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Employee not found' });

    // Find approved non-WFH leaves covering this date
    const { data: approvedLeaves } = await db.from('leaves')
      .select('id, leave_type, leave_time, start_date, end_date')
      .eq('user_id', uid).eq('organization_id', oId).eq('status', 'approved')
      .lte('start_date', date).gte('end_date', date)
      .neq('leave_type', 'wfh');

    if (!approvedLeaves?.length)
      return res.status(404).json({ error: 'No approved leave found for this employee on this date.' });

    // Calculate days using the same logic as admin-override-attendance
    const settings = await getSettingsForUser(oId, uid);
    let totalDays = 0;
    for (const leave of approvedLeaves) {
      if (leave.leave_time === 'half') {
        totalDays += 0.5;
      } else {
        const holidays = await fetchHolidaySet(oId, leave.start_date, leave.end_date, leave.user_id);
        totalDays += buildWorkingDates(leave.start_date, leave.end_date, settings, holidays).length;
      }
    }

    // Use the first leave for the date-range display (covers the selected date)
    const primary = approvedLeaves[0];
    res.json({
      days_to_restore: Math.round(totalDays * 2) / 2,
      is_multi_day:    primary.start_date !== primary.end_date,
      start_date:      primary.start_date,
      end_date:        primary.end_date,
      leave_count:     approvedLeaves.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: POST /admin-override-attendance ──────────────────────────────────
// Root Admin only: cancel an approved leave for a specific date and atomically
// create/update the attendance record as corrected. Balance is auto-restored
// because leave balance is computed on-the-fly from status='approved' leaves only.
//
// Body: { userId, date, check_in?, check_out?, status?, is_late?, is_early_exit?, notes? }
// Transaction: both the leave cancellation and attendance upsert succeed or both roll back.
router.post('/admin-override-attendance', auth, withBranchContext, async (req, res) => {
  try {
    if (req.user.role !== 'root_admin')
      return res.status(403).json({ error: 'Only Root Admin can override approved leave attendance.' });

    const oId = orgId(req);
    const { userId, date, check_in, check_out, status, is_late, is_early_exit, notes } = req.body;

    if (!userId || !date)
      return res.status(400).json({ error: 'userId and date are required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });

    const uid = parseInt(userId, 10);
    if (!Number.isFinite(uid) || uid <= 0)
      return res.status(400).json({ error: 'Invalid userId' });

    // Verify employee belongs to this org
    const { data: emp } = await db.from('users')
      .select('id, name').eq('id', uid).eq('organization_id', oId).maybeSingle();
    if (!emp) return res.status(404).json({ error: 'Employee not found in this organisation' });

    // Find all approved non-WFH leaves covering this date
    const { data: approvedLeaves } = await db.from('leaves')
      .select('id, leave_type, leave_time, start_date, end_date')
      .eq('user_id', uid).eq('organization_id', oId).eq('status', 'approved')
      .lte('start_date', date).gte('end_date', date)
      .neq('leave_type', 'wfh');

    if (!approvedLeaves?.length)
      return res.status(400).json({ error: 'No approved leave found for this employee on this date.' });

    // Compute days to be restored per leave (for the response — balance restores automatically)
    const settings     = await getSettingsForUser(oId, uid);
    let totalDaysRestored = 0;
    for (const leave of approvedLeaves) {
      if (leave.leave_time === 'half') {
        totalDaysRestored += 0.5;
      } else {
        const holidays = await fetchHolidaySet(oId, leave.start_date, leave.end_date, leave.user_id);
        totalDaysRestored += buildWorkingDates(leave.start_date, leave.end_date, settings, holidays).length;
      }
    }

    const leaveIds = approvedLeaves.map(l => l.id);

    // Compute gross/work hours from check_in / check_out
    const gross_hours = check_in && check_out
      ? Math.max(0, (toMinutes(check_out) - toMinutes(check_in)) / 60) : 0;

    const correctionNote = [
      `Leave overridden by ${req.user.name || 'Root Admin'} — marked as ${status || 'present'}`,
      notes?.trim() || null,
    ].filter(Boolean).join('. ');

    // ── Atomic transaction ─────────────────────────────────────────────────────
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Cancel all approved leaves covering this date
      await client.query(
        `UPDATE leaves SET status = 'cancelled'
         WHERE id = ANY($1::bigint[]) AND organization_id = $2`,
        [leaveIds, oId]
      );

      // 2. Upsert attendance — create if missing, update if exists
      await client.query(
        `INSERT INTO attendance
           (user_id, date, status, check_in, check_out,
            gross_hours, work_hours, total_break_minutes,
            is_late, is_early_exit, notes, organization_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11)
         ON CONFLICT (user_id, date, organization_id) DO UPDATE SET
           status              = EXCLUDED.status,
           check_in            = EXCLUDED.check_in,
           check_out           = EXCLUDED.check_out,
           gross_hours         = EXCLUDED.gross_hours,
           work_hours          = EXCLUDED.work_hours,
           total_break_minutes = 0,
           is_late             = EXCLUDED.is_late,
           is_early_exit       = EXCLUDED.is_early_exit,
           notes               = EXCLUDED.notes`,
        [uid, date, status || 'present',
         check_in || null, check_out || null,
         Math.round(gross_hours * 100) / 100,
         Math.round(gross_hours * 100) / 100,
         !!is_late, !!is_early_exit,
         correctionNote, oId]
      );

      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Override failed — rolled back. ' + txErr.message });
    } finally { client.release(); }

    // Audit log each cancelled leave (outside transaction — fire-and-forget)
    for (const leave of approvedLeaves) {
      logApprovalAction({
        leaveId: leave.id, oId, actorId: req.user.id, actorName: req.user.name,
        action: 'leave_overridden_by_attendance',
        fromStatus: 'approved', toStatus: 'cancelled',
        notes: correctionNote,
      });
    }

    res.json({
      success:            true,
      leaves_cancelled:   leaveIds.length,
      days_restored:      Math.round(totalDaysRestored * 2) / 2,
      attendance_date:    date,
      attendance_status:  status || 'present',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: DELETE /:id ───────────────────────────────────────────────────────
router.delete('/:id', auth, withBranchContext, async (req, res) => {
  const { data: leave } = await db.from('leaves').select('*').eq('id', req.params.id).eq('organization_id', orgId(req)).maybeSingle();
  if (!leave) return res.status(404).json({ error: 'Leave not found' });
  if (!isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id)) return res.status(403).json({ error: 'Not authorized' });
  if (leave.status === 'approved' && !isAdminRole(req.user.role)) return res.status(400).json({ error: 'Cannot cancel approved leave' });
  // Branch isolation: admin must have access to the leave owner's branch.
  if (isAdminRole(req.user.role) && req.user.role !== 'root_admin') {
    if (!await canAdminAccessUser(req.branchContext, leave.user_id, orgId(req)))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
  }

  let workDates = [];
  if (leave.status === 'approved') {
    const settings     = await getSettingsForUser(orgId(req), leave.user_id);
    const holidayDates = await fetchHolidaySet(orgId(req), leave.start_date, leave.end_date, leave.user_id);
    workDates = buildWorkingDates(leave.start_date, leave.end_date, settings, holidayDates);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (workDates.length) {
      await client.query(
        `DELETE FROM attendance
         WHERE user_id = $1 AND organization_id = $2
           AND date = ANY($3::text[])
           AND status = ANY(ARRAY['on_leave','half_day','wfh'])`,
        [leave.user_id, orgId(req), workDates]
      );
    }
    await client.query(`DELETE FROM leaves WHERE id = $1 AND organization_id = $2`, [req.params.id, orgId(req)]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Delete failed. ' + err.message });
  } finally { client.release(); }

  res.json({ success: true });
});

// ─── ROUTE: POST /:id/department-approve (LEGACY — kept for backward compat) ──
router.post('/:id/department-approve', auth, async (req, res) => {
  try {
    const oId     = orgId(req);
    const { orgName, orgEmail } = await getOrgContext(oId);
    const leaveId = parseInt(req.params.id, 10);

    const { data: leave } = await db.from('leaves')
      .select('*, users!leaves_user_id_fkey(name, email, department, department_id)')
      .eq('id', leaveId).eq('organization_id', oId).maybeSingle();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });

    if (leave.status !== 'pending_dept') {
      return res.status(400).json({
        error: `This leave is not pending department approval. Current status: ${leave.status}`,
        current_status: leave.status,
      });
    }

    const empDeptId = leave.users?.department_id;
    let isAuthorized = false;
    let approverLabel = '';

    if (empDeptId) {
      const { data: dept } = await db.from('departments')
        .select('id, head_user_id, name').eq('id', empDeptId).eq('organization_id', oId).maybeSingle();
      if (sameId(dept?.head_user_id, req.user.id)) { isAuthorized = true; approverLabel = dept.name + ' Head'; }
    }
    if (!isAuthorized) {
      const { data: empUser } = await db.from('users')
        .select('reporting_to').eq('id', leave.user_id).eq('organization_id', oId).maybeSingle();
      if (sameId(empUser?.reporting_to, req.user.id)) { isAuthorized = true; approverLabel = 'Reporting Manager'; }
    }
    if (!isAuthorized) return res.status(403).json({ error: 'You are not authorized to forward this leave.' });

    const now = new Date().toISOString();
    const { notes } = req.body || {};

    await db.from('leaves').update({
      status:                'pending_root',
      dept_head_status:      'approved',
      dept_head_id:          req.user.id,
      dept_head_reviewed_at: now,
    }).eq('id', leaveId).eq('organization_id', oId);

    logApprovalAction({ leaveId, oId, actorId: req.user.id, actorName: req.user.name, action: 'dept_approved', fromStatus: 'pending_dept', toStatus: 'pending_root', notes });

    const empName = leave.users?.name || 'Employee';
    notify(leave.user_id, 'Leave Forwarded for Final Approval', `${req.user.name} (${approverLabel}) has forwarded your leave to the Root Admin.`, oId);

    const rootAdmins = await pool.query(
      `SELECT id, name FROM users WHERE role = 'root_admin' AND organization_id = $1`, [oId]
    );
    for (const ra of rootAdmins.rows) {
      notify(ra.id, `Leave Request Awaiting Final Approval — ${empName}`, `${empName}'s leave has been approved by the Department Head and requires your final decision.`, oId);
    }

    const recipients = await getRecipients(oId);
    if (recipients.length > 0 && typeof leaveForwardedToRootHtml === 'function') {
      sendMail({
        to: recipients,
        subject: `Leave Forwarded for Final Approval — ${empName}`,
        html: leaveForwardedToRootHtml({ name: empName, email: leave.users?.email, department: leave.users?.department }, leave, req.user.name, orgName, orgEmail),
      });
    }

    const { data: updated } = await db.from('leaves').select('*').eq('id', leaveId).single();
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: POST /:id/final-approve (LEGACY) ─────────────────────────────────
router.post('/:id/final-approve', auth, hasPermission('leaves', 'approve'), withBranchContext, async (req, res) => {
  try {
    const oId     = orgId(req);
    const { orgName, orgEmail } = await getOrgContext(oId);
    const leaveId = parseInt(req.params.id, 10);

    const { data: leave } = await db.from('leaves').select('*').eq('id', leaveId).eq('organization_id', oId).maybeSingle();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    // Branch isolation: admin must have access to the leave owner's branch.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, leave.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    if (leave.status === 'approved') return res.json(leave);
    if (leave.status !== 'pending_root') {
      return res.status(400).json({ error: `Cannot final-approve a leave with status '${leave.status}'.`, current_status: leave.status });
    }

    const settings     = await getSettingsForUser(oId, leave.user_id);
    const holidayDates = await fetchHolidaySet(oId, leave.start_date, leave.end_date, leave.user_id);
    const workDates    = buildWorkingDates(leave.start_date, leave.end_date, settings, holidayDates);
    const attStatus    = leave.leave_time === 'half' ? 'half_day'
      : (leave.leave_time === 'wfh' || leave.leave_type === 'wfh') ? 'wfh'
      : 'on_leave';
    const approvedAt = new Date().toISOString();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const ds of workDates) {
        await client.query(
          `INSERT INTO attendance (user_id, date, status, organization_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, date, organization_id) DO UPDATE SET status = EXCLUDED.status`,
          [leave.user_id, ds, attStatus, oId]
        );
      }
      await client.query(
        `UPDATE leaves SET
           status = 'approved', approved_by = $1, approved_at = $2,
           root_admin_status = 'approved', root_admin_id = $1, root_admin_reviewed_at = $2
         WHERE id = $3 AND organization_id = $4`,
        [req.user.id, approvedAt, leaveId, oId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Final approval failed. ' + err.message });
    } finally { client.release(); }

    logApprovalAction({ leaveId, oId, actorId: req.user.id, actorName: req.user.name, action: 'root_approved', fromStatus: 'pending_root', toStatus: 'approved' });

    const { data } = await db.from('leaves')
      .select('*, users!leaves_user_id_fkey(name, email)').eq('id', leaveId).single();
    notify(leave.user_id, 'Leave Approved', `Your leave from ${leave.start_date} to ${leave.end_date} has been approved by ${req.user.name}.`, oId);
    if (data.users?.email) {
      sendMail({ to: data.users.email, subject: 'Your Leave Request has been Approved', html: leaveStatusHtml(data.users, leave, 'approved', req.user.name, orgName, orgEmail) });
    }
    res.json(flatOne(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: POST /:id/final-reject (LEGACY) ──────────────────────────────────
router.post('/:id/final-reject', auth, hasPermission('leaves', 'reject'), withBranchContext, async (req, res) => {
  try {
    const oId     = orgId(req);
    const { orgName, orgEmail } = await getOrgContext(oId);
    const leaveId = parseInt(req.params.id, 10);

    const { data: leave } = await db.from('leaves').select('*').eq('id', leaveId).eq('organization_id', oId).maybeSingle();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    // Branch isolation: admin must have access to the leave owner's branch.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, leave.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    if (leave.status === 'rejected') return res.json(leave);
    if (!['pending_root', 'pending'].includes(leave.status)) {
      return res.status(400).json({ error: `Cannot reject a leave with status '${leave.status}'.`, current_status: leave.status });
    }

    const { remarks } = req.body || {};
    const rejectedAt = new Date().toISOString();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE leaves SET
           status = 'rejected', approved_by = $1, approved_at = $2,
           remarks = $3,
           root_admin_status = 'rejected', root_admin_id = $1, root_admin_reviewed_at = $2
         WHERE id = $4 AND organization_id = $5`,
        [req.user.id, rejectedAt, remarks || null, leaveId, oId]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Rejection failed. ' + err.message });
    } finally { client.release(); }

    logApprovalAction({ leaveId, oId, actorId: req.user.id, actorName: req.user.name, action: 'root_rejected', fromStatus: leave.status, toStatus: 'rejected', notes: remarks });
    notify(leave.user_id, 'Leave Request Rejected', `Your leave from ${leave.start_date} to ${leave.end_date} has been rejected.`, oId);

    const { data } = await db.from('leaves')
      .select('*, users!leaves_user_id_fkey(name, email)').eq('id', leaveId).single();
    if (data.users?.email) {
      sendMail({ to: data.users.email, subject: 'Your Leave Request has been Rejected', html: leaveStatusHtml(data.users, leave, 'rejected', req.user.name, orgName, orgEmail) });
    }
    res.json(flatOne(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: GET /:id/history ──────────────────────────────────────────────────
router.get('/:id/history', auth, withBranchContext, async (req, res) => {
  try {
    const oId     = orgId(req);
    const leaveId = parseInt(req.params.id, 10);
    if (!leaveId) return res.status(400).json({ error: 'Invalid leave ID' });

    const { data: leave } = await db.from('leaves')
      .select('id, user_id').eq('id', leaveId).eq('organization_id', oId).maybeSingle();
    if (!leave) return res.status(404).json({ error: 'Leave not found' });
    if (isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id) && !await canAdminAccessUser(req.branchContext, leave.user_id, oId))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });

    if (!isAdminRole(req.user.role) && !sameId(leave.user_id, req.user.id)) {
      const { data: employee } = await db.from('users')
        .select('department_id').eq('id', leave.user_id).eq('organization_id', oId).maybeSingle();
      let isDeptHead = false;
      if (employee?.department_id) {
        const { data: dept } = await db.from('departments')
          .select('head_user_id').eq('id', employee.department_id).eq('organization_id', oId).maybeSingle();
        isDeptHead = sameId(dept?.head_user_id, req.user.id);
      }
      if (!isDeptHead) return res.status(403).json({ error: 'Not authorized' });
    }

    const { data, error } = await db.from('leave_approval_log')
      .select('*').eq('leave_id', leaveId).eq('org_id', oId).order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
