const express = require('express');
const router  = express.Router();
const bcrypt   = require('bcryptjs');
const { db } = require('../../config/db');
const { auth, adminOnly, rootAdminOnly, unblockUser } = require('../../middleware/auth');
const { flat, orgId, getOrgContext } = require('../../utils/helpers');
const { sendMail, welcomeEmployeeHtml } = require('../../services/emailService');
const { sendPushToUsers } = require('../../services/pushService');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');

// ─── Root Admin: Send Email to All / One User ─────────────────────────────────
router.post('/send-email', auth, adminOnly, async (req, res) => {
  try {
    const { subject, message, target_user_id } = req.body;
    if (!subject?.trim() || !message?.trim()) return res.status(400).json({ error: 'Subject and message required' });
    const oId = orgId(req);
    const { orgName, orgEmail } = await getOrgContext(oId);

    let recipients;
    if (target_user_id) {
      const { data: u } = await db.from('users').select('email').eq('id', parseInt(target_user_id)).eq('organization_id', oId).maybeSingle();
      if (!u) return res.status(404).json({ error: 'User not found in your organization' });
      recipients = [u.email];
    } else {
      // BUG_136: "all employees" must exclude root admins, HR admins, and inactive/resigned/terminated
      const { data: users } = await db.from('users').select('email')
        .eq('organization_id', oId)
        .eq('role', 'employee')
        .not('employee_status', 'in', ['inactive', 'resigned', 'terminated']);
      recipients = (users || []).map(u => u.email).filter(Boolean);
    }

    const year = new Date().getFullYear();
    const safeEmail  = (orgEmail  || '').replace(/</g, '&lt;');
    const safeOrg    = (orgName   || 'HR System').replace(/</g, '&lt;');
    const safeSubj   = subject.trim().replace(/</g, '&lt;');
    const safeMsg    = message.trim().replace(/</g, '&lt;').replace(/\n/g, '<br/>');
    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px 16px;background:#eef0f8;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:600px;margin:0 auto;">
  <!-- HEADER -->
  <div style="background:linear-gradient(135deg,#3525cd 0%,#5a3ce8 50%,#712ae2 100%);padding:40px 32px 36px;border-radius:12px 12px 0 0;text-align:center;">
    <p style="margin:0 0 4px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:4px;color:rgba(255,255,255,0.55);font-family:Arial,sans-serif;">HRMS BY LUMOSLOGIC</p>
    <h1 style="margin:0 0 4px;font-size:32px;font-weight:900;color:#ffffff;font-family:Arial,sans-serif;letter-spacing:-0.5px;">${safeOrg}</h1>
    <p style="margin:0;font-size:10px;text-transform:uppercase;letter-spacing:3px;color:rgba(255,255,255,0.45);font-family:Arial,sans-serif;">HUMAN RESOURCE MANAGEMENT SYSTEM</p>
    <div style="border-top:1px solid rgba(255,255,255,0.2);margin:24px auto;max-width:360px;"></div>
    <div style="display:inline-block;width:64px;height:64px;line-height:64px;border-radius:50%;background:rgba(255,255,255,0.15);font-size:28px;margin-bottom:16px;">📣</div>
    <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#ffffff;font-family:Arial,sans-serif;">${safeSubj}</h2>
    <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.7);font-family:Arial,sans-serif;">Broadcast Message</p>
  </div>
  <!-- BODY -->
  <div style="background:#ffffff;padding:32px;font-family:Arial,sans-serif;color:#1e293b;border-left:1px solid #dde1f0;border-right:1px solid #dde1f0;">
    <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1e1456;font-family:Arial,sans-serif;">Hello,</p>
    <p style="margin:0;font-size:14px;color:#334155;line-height:1.8;">${safeMsg}</p>
  </div>
  <!-- FOOTER -->
  <div style="background:#f0f3ff;border:1px solid #dde1f0;border-top:none;padding:24px 32px 28px;border-radius:0 0 12px 12px;font-family:Arial,sans-serif;">
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="width:64px;vertical-align:top;padding-right:16px;">
          <div style="width:52px;height:52px;line-height:52px;border-radius:50%;background:#ede9fe;text-align:center;font-size:22px;">🎧</div>
        </td>
        <td style="vertical-align:top;">
          <p style="margin:0 0 8px;font-size:15px;font-weight:800;color:#1e1456;font-family:Arial,sans-serif;">Need Help?</p>
          <p style="margin:0 0 4px;font-size:13px;color:#475569;">✉&nbsp;&nbsp;Email:&nbsp;&nbsp;<a href="mailto:${safeEmail}" style="color:#3525cd;text-decoration:none;font-weight:600;">${safeEmail}</a></p>
          <p style="margin:0;font-size:13px;color:#475569;">🌐&nbsp;&nbsp;Website:&nbsp;&nbsp;<a href="https://hrms.lumoslogic.com/" style="color:#3525cd;text-decoration:none;font-weight:600;">https://hrms.lumoslogic.com/</a></p>
        </td>
      </tr>
    </table>
    <div style="border-top:1px solid #c7c4d8;margin:20px 0 16px;"></div>
    <p style="margin:0 0 4px;font-size:12px;color:#64748b;text-align:center;">This is an automated email from <strong>HRMS by LumosLogic</strong>.</p>
    <p style="margin:0 0 12px;font-size:12px;color:#64748b;text-align:center;">Please do not reply to this email.</p>
    <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">© ${year} HRMS By Lumos Logic</p>
  </div>
</div>
</body></html>`;

    for (const email of recipients) {
      sendMail({ to: email, subject: subject.trim(), html });
    }
    res.json({ success: true, sent: recipients.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: System-wide Stats ───────────────────────────────────────────
router.get('/stats', auth, rootAdminOnly, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const year  = new Date().getFullYear();

    const [
      { count: totalEmployees },
      { count: totalHR },
      { count: pendingLeaves },
      { count: presentToday },
    ] = await Promise.all([
      db.from('users').select('*', { count: 'exact', head: true }).eq('role', 'employee').eq('organization_id', orgId(req)),
      db.from('users').select('*', { count: 'exact', head: true }).eq('role', 'admin').eq('organization_id', orgId(req)),
      db.from('leaves').select('*', { count: 'exact', head: true }).eq('status', 'pending').eq('organization_id', orgId(req)),
      db.from('attendance').select('*', { count: 'exact', head: true }).eq('date', today).eq('organization_id', orgId(req)).in('status', ['present', 'half_day', 'wfh']),
    ]);

    const [
      { data: recentLeavesRaw },
      { data: pendingLeavesRaw },
      { data: todayAttendance },
      { data: yearLeaves },
    ] = await Promise.all([
      db.from('leaves')
        .select('*, users!leaves_user_id_fkey(name, email, department, avatar_color)')
        .eq('organization_id', orgId(req))
        .order('created_at', { ascending: false }).limit(8),
      db.from('leaves')
        .select('*, users!leaves_user_id_fkey(name, email, department, avatar_color)')
        .eq('organization_id', orgId(req)).eq('status', 'pending')
        .order('created_at', { ascending: false }).limit(15),
      db.from('attendance')
        .select('status')
        .eq('date', today).eq('organization_id', orgId(req)),
      db.from('leaves')
        .select('leave_type, leave_time')
        .eq('organization_id', orgId(req)).eq('status', 'approved')
        .gte('start_date', `${year}-01-01`).lte('end_date', `${year}-12-31`),
    ]);

    // Attendance breakdown by status
    const attendanceBreakdown = {};
    for (const r of todayAttendance || []) {
      attendanceBreakdown[r.status] = (attendanceBreakdown[r.status] || 0) + 1;
    }

    // Leave count by type (approved this year, excluding WFH)
    const leavesByType = {};
    for (const r of yearLeaves || []) {
      if (r.leave_time === 'wfh') continue;
      leavesByType[r.leave_type] = (leavesByType[r.leave_type] || 0) + 1;
    }

    res.json({
      totalEmployees, totalHR, pendingLeaves, presentToday,
      recentLeaves:      flat(recentLeavesRaw),
      pendingLeavesData: flat(pendingLeavesRaw),
      attendanceBreakdown,
      leavesByType,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: List Organizations ──────────────────────────────────────────
router.get('/organizations', auth, rootAdminOnly, async (req, res) => {
  try {
    const { data } = await db.from('organizations').select('id, name, slug').order('name', { ascending: true });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Comprehensive Dashboard ─────────────────────────────────────
router.get('/dashboard', auth, rootAdminOnly, withBranchContext, async (req, res) => {
  try {
    const now   = new Date();
    const today = now.toISOString().split('T')[0];
    const year  = now.getFullYear();
    const oid   = orgId(req);

    const d30 = new Date(now); d30.setDate(d30.getDate() - 29);
    const fromDate = d30.toISOString().split('T')[0];
    const d30ahead = new Date(now); d30ahead.setDate(d30ahead.getDate() + 30);
    const toDate = d30ahead.toISOString().split('T')[0];

    // ── Branch context — scope all employee-derived data to selected branch ──
    const branchState = getFilterState(req.branchContext);
    if (branchState.type === 'none') {
      return res.json({
        totalEmployees: 0, totalHR: 0, pendingLeaves: 0, presentToday: 0,
        pendingRegCount: 0, pendingExpCount: 0, totalDepartments: 0,
        recentLeaves: [], pendingLeavesData: [], attendanceBreakdown: {},
        leavesByType: {}, attendanceTrend: [], departmentHealth: [],
        headcountGrowth: [], liveActivity: [], actionCenter: [{ type: 'all_clear', label: 'No branch access configured', priority: 'Low' }],
        upcomingEvents: [], recentJoiners: [], birthdays: [], anniversaries: [],
      });
    }

    // Phase 1: fetch branch-scoped employees first so empIds can scope Phase 2
    // BUG_117: fetch employee_status so resigned/terminated can be excluded from active count
    let empQuery = db.from('users')
      .select('id, name, department, position, avatar_color, created_at, role, date_of_birth, joining_date, employee_status')
      .eq('organization_id', oid).in('role', ['employee', 'admin']).order('name');
    if (branchState.type === 'specific') empQuery = empQuery.eq('branch_id', branchState.branchId);
    else if (branchState.type === 'multi') empQuery = empQuery.in('branch_id', branchState.branchIds);
    const { data: allEmployeesRaw } = await empQuery;
    const empIds = (allEmployeesRaw || []).map(e => e.id);

    // Phase 2: remaining queries, scoped to empIds for employee-linked tables
    const [
      { count: totalHR },
      { count: pendingLeavesCount },
      { data: recentLeavesRaw },
      { data: pendingLeavesRaw },
      { data: todayAttendance },
      { data: yearLeaves },
      { data: last30Att },
      { data: upcomingHolidays },
      { data: upcomingEventsRaw },
      { count: pendingReg },
      { count: pendingExp },
      { count: totalDepartments },
    ] = await Promise.all([
      db.from('users').select('*', { count: 'exact', head: true }).eq('role', 'admin').eq('organization_id', oid),
      // BUG_116: count ALL pending leaves — legacy (pending, pending_root) + new workflow (pending_approval)
      empIds.length === 0
        ? Promise.resolve({ count: 0 })
        : db.from('leaves').select('*', { count: 'exact', head: true })
            .in('status', ['pending', 'pending_root', 'pending_approval'])
            .eq('organization_id', oid).in('user_id', empIds),
      empIds.length === 0
        ? Promise.resolve({ data: [] })
        : db.from('leaves')
            .select('id, user_id, leave_type, leave_time, status, start_date, end_date, reason, created_at, users!leaves_user_id_fkey(name, email, department, avatar_color)')
            .eq('organization_id', oid).in('user_id', empIds)
            .order('created_at', { ascending: false }).limit(10),
      empIds.length === 0
        ? Promise.resolve({ data: [] })
        : db.from('leaves')
            .select('id, leave_type, leave_time, status, start_date, end_date, reason, created_at, users!leaves_user_id_fkey(name, email, department, avatar_color)')
            .eq('organization_id', oid).in('user_id', empIds)
            .in('status', ['pending', 'pending_root', 'pending_approval'])
            .order('created_at', { ascending: false }).limit(15),
      empIds.length === 0
        ? Promise.resolve({ data: [] })
        : db.from('attendance').select('user_id, status, check_in')
            .eq('date', today).eq('organization_id', oid).in('user_id', empIds),
      empIds.length === 0
        ? Promise.resolve({ data: [] })
        : db.from('leaves').select('leave_type, leave_time')
            .eq('organization_id', oid).eq('status', 'approved')
            .gte('start_date', `${year}-01-01`).lte('end_date', `${year}-12-31`)
            .in('user_id', empIds),
      empIds.length === 0
        ? Promise.resolve({ data: [] })
        : db.from('attendance').select('date, user_id, status')
            .eq('organization_id', oid).gte('date', fromDate).lte('date', today)
            .in('user_id', empIds),
      db.from('holidays').select('id, name, date, type').eq('organization_id', oid)
        .gte('date', today).order('date', { ascending: true }).limit(5),
      db.from('events').select('id, title, date').eq('organization_id', oid)
        .gte('date', today).order('date', { ascending: true }).limit(5),
      empIds.length === 0
        ? Promise.resolve({ count: 0 })
        : db.from('attendance_regularization').select('*', { count: 'exact', head: true })
            .eq('status', 'pending').eq('organization_id', oid).in('user_id', empIds),
      db.from('expenses').select('*', { count: 'exact', head: true })
        .eq('status', 'pending').eq('organization_id', oid),
      db.from('departments').select('*', { count: 'exact', head: true })
        .eq('organization_id', oid),
    ]);

    // BUG_117: separate active vs all employees; exclude resigned/terminated from active count
    const allEmployees = allEmployeesRaw || [];
    const activeEmployees = allEmployees.filter(e =>
      e.role !== 'admin' && !['resigned', 'terminated'].includes(e.employee_status)
    );
    const totalEmployees = activeEmployees.length;

    // BUG_116: pendingLeaves counts leaves+WFH (they share the leaves table).
    // pendingReg is separate. The frontend KPI adds them together; we also expose
    // pendingRegCount so the frontend can use it without a second API call.
    const pendingLeaves = pendingLeavesCount || 0;

    // Attendance breakdown today
    const attendanceBreakdown = {};
    for (const r of todayAttendance || []) {
      attendanceBreakdown[r.status] = (attendanceBreakdown[r.status] || 0) + 1;
    }
    const presentToday = (attendanceBreakdown.present || 0) + (attendanceBreakdown.wfh || 0) + (attendanceBreakdown.half_day || 0);

    // BUG_118: compute absent count = active employees who have no attendance record today
    // (and are not on approved leave)
    const attendedUserIds = new Set((todayAttendance || []).map(r => r.user_id));
    const absentCount = activeEmployees.filter(e => !attendedUserIds.has(e.id)).length;
    if (absentCount > 0) attendanceBreakdown.absent = absentCount;

    // Leave count by type (approved this year, excluding WFH)
    const leavesByType = {};
    for (const r of yearLeaves || []) {
      if (r.leave_time === 'wfh') continue;
      leavesByType[r.leave_type] = (leavesByType[r.leave_type] || 0) + 1;
    }

    // Attendance trend (last 30 days)
    const trendByDate = {};
    for (const r of last30Att || []) {
      if (!trendByDate[r.date]) trendByDate[r.date] = { present: 0, total: 0 };
      trendByDate[r.date].total++;
      if (['present', 'wfh', 'half_day'].includes(r.status)) trendByDate[r.date].present++;
    }
    const attendanceTrend = [];
    for (let i = 29; i >= 0; i--) {
      const d  = new Date(now); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const e  = trendByDate[ds] || { present: 0, total: 0 };
      attendanceTrend.push({ date: ds, pct: e.total > 0 ? Math.round((e.present / e.total) * 100) : 0, present: e.present, total: e.total });
    }

    // Department health — use org's departments table as source of truth to prevent cross-org contamination
    // BUG_117: use activeEmployees (excludes resigned/terminated) for dept health headcount
    const empIdList = activeEmployees.map(e => e.id);

    // Fetch only this org's departments
    const { data: orgDepts } = await db.from('departments')
      .select('id, name')
      .eq('organization_id', oid);

    // Initialize deptMap keyed by department ID so only org departments appear
    const deptMap = {};
    for (const dept of orgDepts || []) {
      deptMap[dept.id] = { name: dept.name, empIdSet: new Set() };
    }

    // Build name→id lookup for fallback matching
    const orgDeptNameToId = {};
    for (const dept of orgDepts || []) {
      orgDeptNameToId[dept.name] = dept.id;
    }

    // Primary: junction table assignments filtered by org
    let userDeptRows = [];
    if (empIdList.length > 0) {
      const { data: ud } = await db.from('user_departments')
        .select('user_id, department_id')
        .in('user_id', empIdList)
        .eq('organization_id', oid);
      userDeptRows = ud || [];
    }
    for (const ud of userDeptRows) {
      if (deptMap[ud.department_id]) {
        deptMap[ud.department_id].empIdSet.add(ud.user_id);
      }
    }

    // Fallback: employees with no junction entry — match by users.department text field to org departments only
    const junctionUserIds = new Set(userDeptRows.map(ud => ud.user_id));
    for (const emp of activeEmployees) {
      if (!junctionUserIds.has(emp.id)) {
        const deptId = orgDeptNameToId[emp.department];
        if (deptId !== undefined && deptMap[deptId]) {
          deptMap[deptId].empIdSet.add(emp.id);
        }
      }
    }

    const presentSet = new Set((todayAttendance || []).filter(a => ['present','wfh','half_day'].includes(a.status)).map(a => a.user_id));
    const onLeaveSet = new Set((todayAttendance || []).filter(a => a.status === 'on_leave').map(a => a.user_id));
    const departmentHealth = Object.values(deptMap).map(d => {
      const empIds = [...d.empIdSet];
      const tot = empIds.length;
      const pre = empIds.filter(id => presentSet.has(id)).length;
      const lv  = empIds.filter(id => onLeaveSet.has(id)).length;
      const pct = tot > 0 ? Math.round((pre / tot) * 100) : 0;
      return { name: d.name, total: tot, present: pre, onLeave: lv, attendancePct: pct,
        productivity: pct >= 90 ? 'High' : pct >= 70 ? 'Medium' : 'Low' };
    }).sort((a, b) => b.total - a.total);

    // Headcount growth (cumulative by month this year — employees only, all statuses for historical accuracy)
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const empOnly = allEmployees.filter(e => e.role === 'employee');
    let base = empOnly.filter(e => new Date(e.created_at).getFullYear() < year).length;
    const headcountGrowth = months.map((month, i) => {
      const joined = empOnly.filter(e => {
        const d = new Date(e.created_at);
        return d.getFullYear() === year && d.getMonth() === i;
      }).length;
      base += joined;
      return { month, joined, total: base };
    });

    // Live activity feed (check-ins + recent leaves)
    const empById = {};
    for (const e of allEmployees || []) empById[e.id] = e;
    const liveActivity = [];
    for (const a of (todayAttendance || []).filter(x => x.check_in).slice(0, 5)) {
      const emp = empById[a.user_id];
      if (emp) liveActivity.push({ type: 'checkin', user_id: emp.id, name: emp.name, department: emp.department, avatar_color: emp.avatar_color,
        time: `${today}T${a.check_in}`,
        detail: a.status === 'wfh' ? 'started working from home' : a.status === 'half_day' ? 'marked half day' : 'checked in' });
    }
    for (const l of flat(recentLeavesRaw || []).slice(0, 6)) {
      liveActivity.push({ type: 'leave', user_id: l.user_id, name: l.name, department: l.department, avatar_color: l.avatar_color,
        time: l.created_at, detail: `applied for ${l.leave_type} leave`, status: l.status });
    }
    const recentJoiners = (allEmployees || []).filter(e => e.role === 'employee')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 3);
    for (const emp of recentJoiners) {
      liveActivity.push({ type: 'joined', user_id: emp.id, name: emp.name, department: emp.department, avatar_color: emp.avatar_color,
        time: emp.created_at, detail: 'joined the organization' });
    }
    liveActivity.sort((a, b) => new Date(b.time) - new Date(a.time));

    // Action center items (use raw individual counts for granular labels)
    const actionCenter = [];
    if (pendingLeavesCount > 0) actionCenter.push({ type: 'leaves', label: `${pendingLeavesCount} leave/WFH approval${pendingLeavesCount !== 1 ? 's' : ''} pending`, priority: pendingLeavesCount > 5 ? 'High' : 'Medium', link: '/root/leaves' });
    if (pendingReg > 0)         actionCenter.push({ type: 'attendance', label: `${pendingReg} attendance correction${pendingReg !== 1 ? 's' : ''}`, priority: 'Medium', link: '/root/regularization?status=pending' });
    if (pendingExp > 0)         actionCenter.push({ type: 'expenses', label: `${pendingExp} expense${pendingExp !== 1 ? 's' : ''} awaiting approval`, priority: 'Medium', link: '/root/expenses' });
    if (actionCenter.length === 0) actionCenter.push({ type: 'all_clear', label: 'All tasks up to date', priority: 'Low' });

    // Upcoming events (merge holidays + events)
    const upcomingEvents = [
      ...(upcomingHolidays || []).map(h => ({ id: `h-${h.id}`, title: h.name, date: h.date, type: 'holiday' })),
      ...(upcomingEventsRaw || []).map(e => ({ id: `e-${e.id}`, title: e.title, date: e.date, type: 'event' })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(0, 5);

    // Birthdays today
    const todayMD  = today.slice(5);
    const birthdays = (allEmployees || []).filter(e => e.date_of_birth && e.date_of_birth.slice(5) === todayMD)
      .map(e => ({ id: e.id, name: e.name, avatar_color: e.avatar_color, department: e.department }));

    // Work anniversaries today (joining_date matches today MM-DD, at least 1 year ago)
    const anniversaries = (allEmployees || []).filter(e =>
      e.joining_date && e.joining_date.slice(5) === todayMD && new Date(e.joining_date).getFullYear() < year
    ).map(e => ({
      id: e.id, name: e.name, avatar_color: e.avatar_color, department: e.department,
      years: year - new Date(e.joining_date).getFullYear(),
    }));

    // Recent joiners (top 5 for section)
    const recentJoiners5 = (allEmployees || []).filter(e => e.role === 'employee')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
      .map(({ id, name, department, position, avatar_color, created_at }) => ({ id, name, department, position, avatar_color, created_at }));

    res.json({
      totalEmployees, totalHR, pendingLeaves, presentToday,
      // BUG_116: expose pendingRegCount and pendingExpCount so frontend KPI adds all pending types
      pendingRegCount: pendingReg || 0,
      pendingExpCount: pendingExp || 0,
      totalDepartments: totalDepartments || 0,
      recentLeaves:      flat(recentLeavesRaw),
      pendingLeavesData: flat(pendingLeavesRaw),
      attendanceBreakdown, leavesByType,
      attendanceTrend, departmentHealth, headcountGrowth,
      liveActivity, actionCenter, upcomingEvents,
      recentJoiners: recentJoiners5, birthdays, anniversaries,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Yearly Leave Summary ────────────────────────────────────────
router.get('/yearly-leaves', auth, rootAdminOnly, withBranchContext, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const oid  = orgId(req);
    const branchState = getFilterState(req.branchContext);

    if (branchState.type === 'none') {
      return res.json({ employees: [], year, totalLeaves: 18 });
    }

    // Get total leaves from org settings (default 18)
    const { data: orgRow } = await db.from('organizations').select('total_annual_leaves').eq('id', oid).single();
    const TOTAL_LEAVES = orgRow?.total_annual_leaves || 18;

    // Scope employees to selected branch
    let empQuery = db.from('users')
      .select('id, name, department, position, avatar_color')
      .eq('role', 'employee').eq('organization_id', oid).order('name');
    if (branchState.type === 'specific') empQuery = empQuery.eq('branch_id', branchState.branchId);
    else if (branchState.type === 'multi') empQuery = empQuery.in('branch_id', branchState.branchIds);

    const [{ data: employees }, { data: leaves }] = await Promise.all([
      empQuery,
      db.from('leaves')
        .select('user_id, start_date, end_date, leave_type, leave_time, status')
        .eq('status', 'approved').eq('organization_id', oid)
        .lte('start_date', `${year}-12-31`)
        .gte('end_date',   `${year}-01-01`),
    ]);

    const yearStart = new Date(`${year}-01-01T12:00:00`);
    const yearEnd   = new Date(`${year}-12-31T12:00:00`);

    const fmtIST = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

    const result = (employees || []).map(emp => {
      const empLeaves = (leaves || []).filter(l => l.user_id === emp.id);
      let usedDays = 0;
      const countedDays = new Set(); // prevent double-counting overlapping leaves
      const byType = {};

      for (const l of empLeaves) {
        if (l.leave_time === 'wfh') continue;
        const start = new Date(Math.max(new Date(l.start_date + 'T12:00:00'), yearStart));
        const end   = new Date(Math.min(new Date(l.end_date   + 'T12:00:00'), yearEnd));
        if (start > end) continue;

        if (l.leave_time === 'half') {
          const ds = fmtIST(start);
          if (!countedDays.has(ds)) {
            usedDays += 0.5;
            countedDays.add(ds);
          }
        } else {
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dow = d.getDay();
            if (dow !== 0 && dow !== 6) {
              const ds = fmtIST(d);
              if (!countedDays.has(ds)) {
                usedDays++;
                countedDays.add(ds);
              }
            }
          }
        }
        byType[l.leave_type] = (byType[l.leave_type] || 0) + 1;
      }

      return {
        ...emp,
        usedDays,
        remainingDays: Math.max(0, TOTAL_LEAVES - usedDays),
        totalDays: TOTAL_LEAVES,
        byType,
      };
    });

    res.json({ employees: result, year, totalLeaves: TOTAL_LEAVES });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: List HR Admins ───────────────────────────────────────────────
router.get('/hr', auth, rootAdminOnly, async (req, res) => {
  try {
    const { data } = await db.from('users')
      .select('id, name, email, department, position, avatar_color, status, created_at')
      .eq('role', 'admin').eq('organization_id', orgId(req)).order('name');
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Create HR Admin ──────────────────────────────────────────────
router.post('/hr', auth, rootAdminOnly, async (req, res) => {
  try {
    const { name, email, password, department, position, avatar_color } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email, and password are required' });
    const hashed = bcrypt.hashSync(password, 10);
    const { data, error } = await db.from('users')
      .insert({ name, email: email.toLowerCase(), password: hashed, role: 'admin', department: department||'Human Resources', position: position||'HR Manager', avatar_color: avatar_color||'#3525cd', force_password_change: true, organization_id: orgId(req) })
      .select('id, name, email, role, department, position, avatar_color').single();
    if (error?.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    if (error) throw new Error(error.message);
    sendMail({ to: email, subject: 'Welcome to Lumens HR — Your HR Admin Account', html: welcomeEmployeeHtml({ name, email, department: department||'Human Resources', position: position||'HR Manager' }, password) });
    // Assign hr_admin RBAC role (fire-and-forget; harmless if RBAC tables not yet migrated)
    db.from('roles').select('id').eq('org_id', orgId(req)).eq('slug', 'hr_admin').maybeSingle()
      .then(({ data: sysRole }) => {
        if (sysRole?.id) {
          return db.from('user_roles').insert({ user_id: data.id, role_id: sysRole.id, org_id: orgId(req), assigned_by: req.user.id });
        }
      }).catch(() => {});
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Update HR Admin ──────────────────────────────────────────────
router.put('/hr/:id', auth, rootAdminOnly, async (req, res) => {
  try {
    const { name, email, department, position, avatar_color, password } = req.body;
    const update = { name, department, position, avatar_color };
    if (email) update.email = email.toLowerCase();
    if (password) update.password = bcrypt.hashSync(password, 10);
    const { data, error } = await db.from('users').update(update)
      .eq('id', req.params.id).eq('organization_id', orgId(req))
      .select('id, name, email, role, department, position, avatar_color').single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Reactivate Deactivated HR Admin ──────────────────────────────
router.put('/hr/:id/reactivate', auth, rootAdminOnly, async (req, res) => {
  try {
    const { data: user } = await db.from('users')
      .select('id, name, status')
      .eq('id', parseInt(req.params.id))
      .eq('role', 'admin')
      .eq('organization_id', orgId(req))
      .maybeSingle();
    if (!user) return res.status(404).json({ error: 'HR admin not found' });
    if (user.status !== 'inactive') return res.status(400).json({ error: 'Account is already active' });
    await db.from('users').update({ status: 'active', employee_status: 'active' }).eq('id', user.id);
    unblockUser(user.id);
    res.json({ success: true, message: `${user.name}'s account has been reactivated` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Delete HR Admin ──────────────────────────────────────────────
router.delete('/hr/:id', auth, rootAdminOnly, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    await db.from('users').delete().eq('id', req.params.id).eq('role', 'admin').eq('organization_id', orgId(req));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: List Root Admins ─────────────────────────────────────────────
router.get('/root-admins', auth, rootAdminOnly, async (req, res) => {
  try {
    const { data } = await db.from('users')
      .select('id, name, email, department, position, avatar_color, created_at')
      .eq('role', 'root_admin').eq('organization_id', orgId(req)).order('name');
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Soft-delete a Root Admin ─────────────────────────────────────
// Soft-delete a root admin (demote to employee + mark inactive)
// Requires ≥2 root admins in org; self-deletion blocked.
router.delete('/root-admins/:id', auth, rootAdminOnly, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const oid      = orgId(req);

    if (targetId === req.user.id) {
      return res.status(400).json({ error: 'You cannot remove your own root admin access.' });
    }

    // Verify target is a root_admin in this org (direct lookup avoids BigInt === Number mismatch)
    const { data: targetAdmin } = await db.from('users').select('id')
      .eq('id', targetId).eq('role', 'root_admin').eq('organization_id', oid).maybeSingle();
    if (!targetAdmin) {
      return res.status(404).json({ error: 'Root admin not found in this organisation.' });
    }

    // Count root admins in this org to enforce minimum-one rule
    const { data: rootAdmins, error: cntErr } = await db
      .from('users').select('id')
      .eq('role', 'root_admin').eq('organization_id', oid);
    if (cntErr) throw cntErr;

    if (!rootAdmins || rootAdmins.length <= 1) {
      return res.status(400).json({
        error: 'Cannot remove the last root admin. Assign at least one other root admin first.',
      });
    }

    // Soft delete: demote role + deactivate
    const { error: updErr } = await db.from('users')
      .update({ role: 'employee', employee_status: 'inactive' })
      .eq('id', targetId).eq('organization_id', oid);
    if (updErr) throw updErr;

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Root Admin: Change Password for Another Root Admin ──────────────────────
router.put('/root-admins/:id/password', auth, rootAdminOnly, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const oid      = orgId(req);
    if (targetId === req.user.id) return res.status(400).json({ error: 'Use your profile page to change your own password.' });
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const { data: target } = await db.from('users').select('id').eq('id', targetId).eq('role', 'root_admin').eq('organization_id', oid).maybeSingle();
    if (!target) return res.status(404).json({ error: 'Root admin not found in this organisation.' });
    const hashed = bcrypt.hashSync(password, 10);
    await db.from('users').update({ password: hashed }).eq('id', targetId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Notification Recipients (Root Admin) ─────────────────────────────────────
router.get('/notify-recipients', auth, rootAdminOnly, async (req, res) => {
  try {
    const { data } = await db.from('notification_recipients')
      .select('*').eq('organization_id', orgId(req)).order('created_at', { ascending: true });
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/notify-recipients', auth, rootAdminOnly, async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const { data, error } = await db.from('notification_recipients')
      .insert({ email: email.toLowerCase().trim(), name: name || '', organization_id: orgId(req) })
      .select().single();
    if (error?.code === '23505') return res.status(400).json({ error: 'Email already in the list' });
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/notify-recipients/:id', auth, rootAdminOnly, async (req, res) => {
  try {
    const { active, name } = req.body;
    const { data, error } = await db.from('notification_recipients')
      .update({ ...(active !== undefined && { active }), ...(name !== undefined && { name }) })
      .eq('id', req.params.id).eq('organization_id', orgId(req)).select().single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/notify-recipients/:id', auth, rootAdminOnly, async (req, res) => {
  try {
    await db.from('notification_recipients').delete().eq('id', req.params.id).eq('organization_id', orgId(req));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
