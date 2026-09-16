const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth, isAdminRole } = require('../../middleware/auth');
const { localDateStr, flat, orgId, getSettings } = require('../../utils/helpers');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/', auth, withBranchContext, async (req, res) => {
  let _step = 'init';
  try {
    const realToday = localDateStr();
    const today     = req.query.date || realToday;
    const isToday   = today === realToday;

    // ── 1. Get employees scoped to current branch context ───────────────────
    _step = 'employees';
    // BUG_117: exclude inactive/resigned/terminated from dashboard KPI counts
    // adapter's not_in wraps with (IS NULL OR NOT IN) so NULL-status = active employees included
    const branchState = getFilterState(req.branchContext);

    let empQuery = db.from('users')
      .select('id, name, avatar_color, department, created_at')
      .eq('role', 'employee').eq('organization_id', orgId(req))
      .not('employee_status', 'in', ['inactive', 'resigned', 'terminated']);

    // Apply branch filter for admin views (employee self-view not applicable for dashboard)
    if (isAdminRole(req.user.role)) {
      if (branchState.type === 'none') {
        // No accessible branches — return zero-KPI dashboard
        return res.json({
          totalEmployees: 0, presentToday: 0, onLeaveToday: 0, lateToday: 0,
          earlyExitToday: 0, halfDayToday: 0, wfhToday: 0, checkedInToday: 0,
          newThisMonth: 0, pendingLeaves: 0, recentActivity: [], pendingLeaveList: [],
          myToday: null, today, isToday, newJoiners: [],
        });
      }
      if (branchState.type === 'specific') empQuery = empQuery.eq('branch_id', branchState.branchId);
      else if (branchState.type === 'multi') empQuery = empQuery.in('branch_id', branchState.branchIds);
      // 'all': no additional filter
    }

    const { data: allEmployees } = await empQuery;
    const totalEmployees = (allEmployees || []).length;
    const empIds         = (allEmployees || []).map(e => e.id);

    // ── 2. Selected date attendance — employees only ─────────────────────────
    _step = 'attendance';
    let todayRecords = [];
    if (empIds.length > 0) {
      const { data: todayRaw } = await db.from('attendance')
        .select('*, users(name, avatar_color, department)')
        .eq('date', today).eq('organization_id', orgId(req))
        .in('user_id', empIds);
      todayRecords = flat(todayRaw);
    }

    // ── 3. Calculate stats ────────────────────────────────────────────────────
    const onLeaveIds = new Set(todayRecords.filter(r => r.status === 'on_leave').map(r => r.user_id));

    // Fetch today's approved leaves to fill in missing attendance records
    let todayApprovedLeaves = [];
    if (empIds.length > 0) {
      const { data: tal } = await db.from('leaves')
        .select('user_id, leave_type, leave_time')
        .eq('organization_id', orgId(req))
        .eq('status', 'approved')
        .lte('start_date', today)
        .gte('end_date', today)
        .in('user_id', empIds);
      todayApprovedLeaves = tal || [];
    }

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
    _step = 'leaves';
    // BUG_054/056/070: Count ALL pending statuses including pending_approval
    const ALL_PENDING = ['pending', 'pending_root', 'pending_dept', 'pending_approval'];

    let pendingLeavesQuery = db.from('leaves')
      .select('*', { count: 'exact', head: true })
      .in('status', ALL_PENDING)
      .eq('organization_id', orgId(req));
    if (empIds.length > 0) pendingLeavesQuery = pendingLeavesQuery.in('user_id', empIds);

    const { count: pendingLeaves } = await pendingLeavesQuery;

    let pendingLeaveList;
    if (isAdminRole(req.user.role)) {
      // BUG_070: Include all pending statuses so widget shows actual pending requests
      let plQuery = db.from('leaves')
        .select('*, users!leaves_user_id_fkey(name, email, department, avatar_color)')
        .in('status', ALL_PENDING).eq('organization_id', orgId(req))
        .order('created_at', { ascending: false }).limit(5);
      if (empIds.length > 0) plQuery = plQuery.in('user_id', empIds);
      const { data: plRaw } = await plQuery;
      pendingLeaveList = flat(plRaw);
    } else {
      const { data: plRaw } = await db.from('leaves')
        .select('*, users!leaves_user_id_fkey(name)').eq('user_id', req.user.id).eq('organization_id', orgId(req))
        .order('created_at', { ascending: false }).limit(5);
      pendingLeaveList = flat(plRaw);
    }

    _step = 'myToday';
    const { data: myToday } = await db.from('attendance')
      .select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();

    res.json({ totalEmployees, presentToday, onLeaveToday, lateToday, earlyExitToday, halfDayToday, wfhToday, checkedInToday, newThisMonth, pendingLeaves, recentActivity, pendingLeaveList, myToday, today, isToday, newJoiners });
  } catch (err) {
    console.error(`[Dashboard] step="${_step}" error:`, err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
