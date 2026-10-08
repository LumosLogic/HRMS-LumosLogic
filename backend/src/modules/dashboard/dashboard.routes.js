const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { sectionGuard } = require('../../middleware/effectiveAccess');
const { localDateStr, flat, orgId, getSettings } = require('../../utils/helpers');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');
const { loadPendingApprovals, countPending } = require('../../services/pendingApprovalsSummary');

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/', auth, withBranchContext, async (req, res) => {
  let _step = 'init';
  try {
    const realToday = localDateStr();
    // API-03 / API-04: `date` must be a real calendar date in YYYY-MM-DD (rejects 15/09/2026 and 2026-99-99).
    if (req.query.date !== undefined) {
      const d = String(req.query.date);
      const dt = new Date(d + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(dt) || dt.toISOString().slice(0, 10) !== d)
        return res.status(400).json({ error: 'date must be a valid date in YYYY-MM-DD format.' });
    }
    const today     = req.query.date || realToday;
    const isToday   = today === realToday;

    // ── 1. Get employees scoped to current branch context ───────────────────
    _step = 'employees';
    // BUG_117: exclude inactive/resigned/terminated from dashboard KPI counts
    // adapter's not_in wraps with (IS NULL OR NOT IN) so NULL-status = active employees included
    const branchState = getFilterState(req.branchContext);

    // Bug-001: allEmpCount includes ALL statuses for the Total Employees KPI.
    // empQuery (below) keeps the active-only filter for attendance/activity use.
    let allEmpCountQuery = db.from('users')
      .select('id', { count: 'exact', head: true }).eq('role', 'employee').eq('organization_id', orgId(req));

    let empQuery = db.from('users')
      .select('id, name, avatar_color, department, created_at')
      .eq('role', 'employee').eq('organization_id', orgId(req))
      .not('employee_status', 'in', ['inactive', 'resigned', 'terminated']);

    // Apply branch filter for admin views (employee self-view not applicable for dashboard)
    {
      if (branchState.type === 'none') {
        // No accessible branches — return zero-KPI dashboard
        return res.json({
          totalEmployees: 0, presentToday: 0, onLeaveToday: 0, lateToday: 0,
          earlyExitToday: 0, halfDayToday: 0, wfhToday: 0, checkedInToday: 0,
          newThisMonth: 0, pendingLeaves: 0, recentActivity: [], pendingLeaveList: [],
          myToday: null, today, isToday, newJoiners: [],
        });
      }
      if (branchState.type === 'specific') {
        empQuery = empQuery.eq('branch_id', branchState.branchId);
        allEmpCountQuery = allEmpCountQuery.eq('branch_id', branchState.branchId);
      } else if (branchState.type === 'multi') {
        empQuery = empQuery.in('branch_id', branchState.branchIds);
        allEmpCountQuery = allEmpCountQuery.in('branch_id', branchState.branchIds);
      }
      // 'all': no additional filter
    }

    const [{ data: allEmployees }, { count: allEmpCount }] = await Promise.all([empQuery, allEmpCountQuery]);
    const totalEmployees = allEmpCount || 0;   // Bug-001: counts ALL statuses
    const empIds         = (allEmployees || []).map(e => e.id);

    // ── 2. Everything below depends only on empIds / the caller, not on each other → one parallel round ────────────
    // Branch isolation: inside a branch-restricted context an EMPTY employee list means "nobody", never "everybody"
    // (previously the user filter was simply skipped, which returned org-wide pending counts / names for a branch
    // without active employees).
    _step = 'parallel-queries';
    const orgIdVal = orgId(req);
    const isAdminCaller = isAdminRole(req.user.role);
    const noScope = empIds.length === 0 && branchState.type !== 'all';
    const byUsers = (q) => (empIds.length > 0 ? q.in('user_id', empIds) : q);
    // BUG_054/056/070: Count ALL pending statuses including pending_approval
    const ALL_PENDING = ['pending', 'pending_root', 'pending_dept', 'pending_approval'];

    const [attRes, talRes, pendLeaveRes, regRes, expRes, plRes, myTodayRes, pendingSummary] = await Promise.all([
      // selected-date attendance — employees only
      empIds.length > 0
        ? db.from('attendance').select('*, users(name, avatar_color, department)')
            .eq('date', today).eq('organization_id', orgIdVal).in('user_id', empIds)
        : null,
      // approved leaves covering the date (fills in employees without an attendance record yet)
      empIds.length > 0
        ? db.from('leaves').select('user_id, leave_type, leave_time')
            .eq('organization_id', orgIdVal).eq('status', 'approved')
            .lte('start_date', today).gte('end_date', today).in('user_id', empIds)
        : null,
      // Admin callers: the Pending Approvals card is counted from the SAME source as the Pending Approvals page (below).
      (noScope || isAdminCaller) ? null : byUsers(db.from('leaves').select('*', { count: 'exact', head: true })
        .in('status', ALL_PENDING).eq('organization_id', orgIdVal)),
      // Bug_023: dashboard "Pending Approvals" must match what the PendingApprovals page shows
      // (it also lists regularizations and expenses with status='pending').
      null,
      null,
      isAdminCaller
        // BUG_070: include all pending statuses so the widget shows actual pending requests
        ? (noScope ? null : byUsers(db.from('leaves')
            .select('*, users!leaves_user_id_fkey(name, email, department, avatar_color)')
            .in('status', ALL_PENDING).eq('organization_id', orgIdVal)
            .order('created_at', { ascending: false }).limit(5)))
        : db.from('leaves').select('*, users!leaves_user_id_fkey(name)')
            .eq('user_id', req.user.id).eq('organization_id', orgIdVal)
            .order('created_at', { ascending: false }).limit(5),
      db.from('attendance').select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle(),
      (isAdminCaller && !noScope) ? loadPendingApprovals(req).catch(e => { console.error('[Dashboard] pending summary:', e.message); return null; }) : null,
    ]);
    const todayRecords = attRes ? flat(attRes.data) : [];

    // ── 3. Calculate stats ────────────────────────────────────────────────────
    const onLeaveIds = new Set(todayRecords.filter(r => r.status === 'on_leave').map(r => r.user_id));

    // Today's approved leaves (fetched in the parallel round above) fill in missing attendance records
    const todayApprovedLeaves = talRes?.data || [];

    // Build wfhIds from attendance records + approved WFH leaves
    const wfhIds = new Set(todayRecords.filter(r => r.status === 'wfh').map(r => r.user_id));
    for (const l of todayApprovedLeaves) {
      if (l.leave_time === 'wfh' || l.leave_type === 'wfh') wfhIds.add(l.user_id);
    }
    // Add approved on_leave employees who may not have an attendance record yet
    for (const l of todayApprovedLeaves) {
      if (l.leave_time !== 'wfh' && l.leave_type !== 'wfh' && l.leave_time !== 'half') {
        onLeaveIds.add(l.user_id);
      }
    }

    const onLeaveToday   = onLeaveIds.size;
    const wfhOnlyCount   = [...wfhIds].filter(id => !onLeaveIds.has(id)).length;
    const checkedInToday = todayRecords.filter(r => r.check_in).length;
    const presentToday   = checkedInToday;
    const lateToday      = todayRecords.filter(r => r.is_late).length;
    const earlyExitToday = todayRecords.filter(r => r.is_early_exit).length;
    const halfDayToday   = todayRecords.filter(r => r.status === 'half_day').length;
    const wfhToday       = wfhIds.size;
    const _now = new Date();
    const _ms  = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-01`;
    const newThisMonth   = (allEmployees || []).filter(e => e.created_at >= _ms).length;
    const _7dAgo = new Date(); _7dAgo.setDate(_7dAgo.getDate() - 7);
    const newJoiners = (allEmployees || [])
      .filter(e => new Date(e.created_at) >= _7dAgo)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5)
      .map(({ id, name, department, avatar_color, created_at, position }) => ({ id, name, department, avatar_color, created_at, position }));

    // ── 4. Activity for selected date ─────────────────────────────────────────
    const activityMap = new Map();
    for (const r of todayRecords) {
      activityMap.set(r.user_id, { ...r });
    }
    const recentActivity = [...activityMap.values()].slice(0, 15);

    // ── 5. Pending leaves (branch-scoped when in a specific branch context) ───
    const sum = pendingSummary ? countPending(pendingSummary) : null;
    const pendingLeaveCount = sum ? sum.leaves          : (pendLeaveRes?.count || 0);
    const pendingRegCount   = sum ? sum.regularizations : (regRes?.count || 0);
    const pendingExpCount   = sum ? sum.expenses        : (expRes?.count || 0);
    const pendingLeaves = pendingLeaveCount + pendingRegCount + pendingExpCount;
    const pendingLeaveList = plRes ? flat(plRes.data) : [];
    const myToday = myTodayRes?.data ?? null;

    const payload = { totalEmployees, presentToday, onLeaveToday, lateToday, earlyExitToday, halfDayToday, wfhToday, checkedInToday, newThisMonth, pendingLeaves, pendingRegCount, pendingExpCount, recentActivity, pendingLeaveList, myToday, today, isToday, newJoiners };
    // Custom-role caller: only the sections their custom role covers (Root / HR / system roles are never trimmed).
    const can = await sectionGuard(req);
    if (!can('attendance')) Object.assign(payload, { presentToday: 0, onLeaveToday: 0, lateToday: 0, earlyExitToday: 0, halfDayToday: 0, wfhToday: 0, checkedInToday: 0, recentActivity: [] });
    if (!can('employees')) Object.assign(payload, { totalEmployees: 0, newThisMonth: 0, newJoiners: [] });
    if (!can('leaves')) Object.assign(payload, { pendingLeaveList: [] });
    if (!can('attendance', 'approve_regularization')) payload.pendingRegCount = 0;
    if (!can('expenses', 'approve')) payload.pendingExpCount = 0;
    payload.pendingLeaves = (can('leaves') ? pendingLeaveCount : 0)
      + (can('attendance', 'approve_regularization') ? pendingRegCount : 0)
      + (can('expenses', 'approve') ? pendingExpCount : 0);
    res.json(payload);
  } catch (err) {
    console.error(`[Dashboard] step="${_step}" error:`, err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
