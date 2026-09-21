const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth, adminOnly } = require('../../middleware/auth');
const { orgId, getSettings, isWorkingDay } = require('../../utils/helpers');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds } = require('../../utils/branchFilter');

// ─── Analytics ───────────────────────────────────────────────────────────────
// Root Admin: org-wide data. HR Admin: scoped to accessible branches.
router.get('/', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const ym    = `${year}-${String(month).padStart(2, '0')}`;
    const today7 = now.toISOString().split('T')[0];
    const d7ago  = new Date(now); d7ago.setDate(d7ago.getDate() - 6);
    const from7  = d7ago.toISOString().split('T')[0];

    const d30ago = new Date(now); d30ago.setDate(d30ago.getDate() - 29);
    const from30 = d30ago.toISOString().split('T')[0];

    // Resolve accessible employee IDs; null = org-wide (Root Admin)
    const empIds = await resolveEmployeeIds(req.branchContext, orgId(req));
    if (empIds !== null && empIds.length === 0) {
      return res.json({
        leaveByStatus: { approved: 0, pending: 0, rejected: 0, cancelled: 0 },
        leaveByType: {}, attByStatus: { present: 0, on_leave: 0, absent: 0, wfh: 0, half_day: 0 },
        month, year, weeklyTrend: [], monthlyTrend: [], avgPct7: 0, attendanceChange: 0,
        deptDistribution: [], roleDistribution: [], leaveBalanceByType: [], totalDepts: 0, totalEmpCount: 0,
      });
    }

    // Build filtered queries — apply employee ID filter when not org-wide
    let leavesQ   = db.from('leaves').select('status, leave_type, leave_time').eq('organization_id', orgId(req));
    let monthAttQ = db.from('attendance').select('status').eq('organization_id', orgId(req)).like('date', `${ym}-%`);
    let last7AttQ = db.from('attendance').select('date, status').eq('organization_id', orgId(req)).gte('date', from7).lte('date', today7);
    let empsCountQ = db.from('users').select('*', { count: 'exact', head: true }).eq('role', 'employee').eq('organization_id', orgId(req));
    let allEmpsQ  = db.from('users').select('department, role, employment_type, position').eq('organization_id', orgId(req)).eq('role', 'employee').not('employee_status', 'in', '("inactive","resigned","terminated")');
    let last30AttQ = db.from('attendance').select('date, status').eq('organization_id', orgId(req)).gte('date', from30).lte('date', today7);
    const leavePoliciesQ = db.from('leave_policies').select('leave_type, annual_quota, label').eq('organization_id', orgId(req)).eq('active', true);

    if (empIds !== null) {
      leavesQ    = leavesQ.in('user_id', empIds);
      monthAttQ  = monthAttQ.in('user_id', empIds);
      last7AttQ  = last7AttQ.in('user_id', empIds);
      empsCountQ = empsCountQ.in('id', empIds);
      allEmpsQ   = allEmpsQ.in('id', empIds);
      last30AttQ = last30AttQ.in('user_id', empIds);
    }

    const [{ data: allLeaves }, { data: monthAtt }, { data: last7Att }, { count: totalEmps }, { data: allEmps }, { data: last30Att }, { data: leavePolicies }] = await Promise.all([
      leavesQ, monthAttQ, last7AttQ, empsCountQ, allEmpsQ, last30AttQ, leavePoliciesQ,
    ]);

    const leaveByStatus = { approved: 0, pending: 0, rejected: 0, cancelled: 0 };
    (allLeaves || []).filter(l => l.leave_time !== 'wfh').forEach(l => { if (leaveByStatus[l.status] !== undefined) leaveByStatus[l.status]++; });

    // Only count approved, non-WFH leaves by type (rejected/WFH don't consume leave quota)
    const leaveByType = {};
    (allLeaves || []).filter(l => l.status === 'approved' && l.leave_time !== 'wfh')
      .forEach(l => { leaveByType[l.leave_type] = (leaveByType[l.leave_type] || 0) + 1; });

    const attByStatus = { present: 0, on_leave: 0, absent: 0, wfh: 0, half_day: 0 };
    (monthAtt || []).forEach(r => { if (attByStatus[r.status] !== undefined) attByStatus[r.status]++; });

    // Weekly trend (last 7 days)
    const trendMap = {};
    for (const r of last7Att || []) {
      if (!trendMap[r.date]) trendMap[r.date] = { present: 0, total: 0 };
      trendMap[r.date].total++;
      if (['present', 'wfh', 'half_day'].includes(r.status)) trendMap[r.date].present++;
    }
    const weeklyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d  = new Date(now); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const e  = trendMap[ds] || { present: 0, total: totalEmps || 0 };
      weeklyTrend.push({
        date: ds,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pct: e.total > 0 ? Math.round((e.present / e.total) * 100) : 0,
      });
    }

    // 30-day attendance trend
    const trendMap30 = {};
    for (const r of last30Att || []) {
      if (!trendMap30[r.date]) trendMap30[r.date] = { present: 0, total: 0 };
      trendMap30[r.date].total++;
      if (['present', 'wfh', 'half_day'].includes(r.status)) trendMap30[r.date].present++;
    }
    const monthlyTrend = [];
    for (let i = 29; i >= 0; i--) {
      const d  = new Date(now); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const e  = trendMap30[ds] || { present: 0, total: totalEmps || 0 };
      monthlyTrend.push({
        date: ds,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pct: e.total > 0 ? Math.round((e.present / e.total) * 100) : 0,
      });
    }

    // Average attendance (last 7 days)
    const avgPct7 = weeklyTrend.length > 0 ? Math.round(weeklyTrend.reduce((s, t) => s + t.pct, 0) / weeklyTrend.length) : 0;
    const prev7Start = new Date(now); prev7Start.setDate(prev7Start.getDate() - 13);
    const prev7Trend = monthlyTrend.slice(0, 7);
    const avgPctPrev = prev7Trend.length > 0 ? Math.round(prev7Trend.reduce((s, t) => s + t.pct, 0) / prev7Trend.length) : 0;
    const attendanceChange = avgPct7 - avgPctPrev;

    // Department distribution
    const deptCount = {};
    for (const e of allEmps || []) {
      const dn = e.department || 'General';
      deptCount[dn] = (deptCount[dn] || 0) + 1;
    }
    const totalEmpCount = (allEmps || []).length;
    const deptDistribution = Object.entries(deptCount)
      .map(([name, count]) => ({ name, count, pct: totalEmpCount > 0 ? Math.round((count / totalEmpCount) * 100) : 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 8);

    // BUG_066: Role distribution now groups by position/designation (actual role), not system role
    // Falls back to employment_type if position is blank
    const EMP_TYPE_LABELS = { full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract', intern: 'Intern', freelance: 'Freelance' };
    const roleCount = {};
    for (const e of allEmps || []) {
      // Use position (job title) if available, else fall back to employment_type label
      const label = (e.position && e.position.trim())
        ? e.position.trim()
        : (EMP_TYPE_LABELS[e.employment_type] || 'Employee');
      roleCount[label] = (roleCount[label] || 0) + 1;
    }
    const total = Object.values(roleCount).reduce((s, c) => s + c, 0);
    const roleDistribution = Object.entries(roleCount)
      .map(([name, count]) => ({ name, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 8);

    // Leave balance overview (org-wide approved leaves this year vs policy quota)
    const LEAVE_COLORS = { casual: '#10b981', sick: '#ef4444', annual: '#3525cd', emergency: '#f59e0b', wfh: '#6366f1', maternity: '#ec4899', paternity: '#8b5cf6', comp_off: '#94a3b8' };
    const LEAVE_DEFAULTS = { casual: { label: 'Casual Leave', quota: 20 }, sick: { label: 'Sick Leave', quota: 15 }, annual: { label: 'Annual Leave', quota: 18 }, emergency: { label: 'Emergency Leave', quota: 5 } };
    const approvedByType = {};
    (allLeaves || []).filter(l => l.status === 'approved' && l.leave_time !== 'wfh' && l.leave_type !== 'wfh').forEach(l => { approvedByType[l.leave_type] = (approvedByType[l.leave_type] || 0) + 1; });
    const policyMap = {};
    (leavePolicies || []).filter(p => p.leave_type !== 'wfh').forEach(p => { policyMap[p.leave_type] = { label: p.label, quota: p.annual_quota }; });
    const leaveBalanceByType = Object.entries({ ...LEAVE_DEFAULTS, ...policyMap }).slice(0, 5).map(([type, info]) => ({
      type, label: info.label, used: approvedByType[type] || 0, total: info.quota || 20, color: LEAVE_COLORS[type] || '#94a3b8',
    }));

    res.json({ leaveByStatus, leaveByType, attByStatus, month, year, weeklyTrend, monthlyTrend, avgPct7, attendanceChange, deptDistribution, roleDistribution, leaveBalanceByType, totalDepts: deptDistribution.length, totalEmpCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Leave Balance ────────────────────────────────────────────────────────────
router.get('/leave-balance', auth, async (req, res) => {
  try {
    const { isAdminRole } = require('../../middleware/auth');
    const year   = parseInt(req.query.year) || new Date().getFullYear();
    const userId = (isAdminRole(req.user.role) && req.query.userId)
      ? parseInt(req.query.userId)
      : req.user.id;

    const { data: approvedLeaves } = await db.from('leaves')
      .select('start_date, end_date, leave_time, leave_type')
      .eq('user_id', userId).eq('organization_id', orgId(req))
      .eq('status', 'approved')
      .gte('start_date', `${year}-01-01`)
      .lte('end_date',   `${year}-12-31`);

    // Fetch actual holidays for this org and year
    const { data: orgHolidays, count: totalHolidays } = await db.from('holidays')
      .select('date', { count: 'exact' })
      .eq('organization_id', orgId(req))
      .like('date', `${year}-%`);
    const holidaySet = new Set((orgHolidays || []).map(h => h.date));

    // Fetch total annual leave quota from org settings (HIGH-01: remove hardcoded 18)
    const { data: orgData } = await db.from('organizations')
      .select('total_annual_leaves').eq('id', orgId(req)).maybeSingle();
    const totalAnnualLeaves = orgData?.total_annual_leaves || 18;

    const settings = await getSettings(orgId(req));
    let usedLeaveDays = 0;
    for (const l of approvedLeaves || []) {
      if (l.leave_time === 'wfh') continue;
      if (l.leave_time === 'half') {
        usedLeaveDays += 0.5;
      } else {
        const start = new Date(l.start_date + 'T12:00:00');
        const end   = new Date(l.end_date   + 'T12:00:00');
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const ds = d.toISOString().split('T')[0];
          // HIGH-03: also skip public holidays when counting used leave days
          if (isWorkingDay(ds, settings) && !holidaySet.has(ds)) usedLeaveDays++;
        }
      }
    }

    res.json({
      userId, year,
      totalLeaves:     totalAnnualLeaves,
      usedLeaves:      usedLeaveDays,
      remainingLeaves: Math.max(0, totalAnnualLeaves - usedLeaveDays),
      totalHolidays:   totalHolidays || 0,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── My Stats (employee self-service) ────────────────────────────────────────
router.get('/my-stats', auth, async (req, res) => {
  try {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const ym    = `${year}-${String(month).padStart(2, '0')}`;
    const [{ data: att }, { data: lvs }] = await Promise.all([
      db.from('attendance').select('status, is_late').eq('user_id', req.user.id).eq('organization_id', orgId(req)).like('date', `${ym}-%`),
      db.from('leaves').select('id, leave_time').eq('user_id', req.user.id).eq('organization_id', orgId(req)).eq('status', 'approved')
        .lte('start_date', `${ym}-31`).gte('end_date', `${ym}-01`),
    ]);
    const presentCount = (att || []).filter(r => ['present','half_day','wfh'].includes(r.status)).length;
    // WFH is not a leave — exclude it from leave count
    const leavesCount  = (lvs || []).filter(l => l.leave_time !== 'wfh').length;
    const lateCount    = (att || []).filter(r => r.is_late).length;
    res.json({ presentCount, leavesCount, lateCount, month, year });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── New Joiners (visible to all authenticated users) ────────────────────────
// Returns employees who joined in the last 7 days
router.get('/new-joiners', auth, async (req, res) => {
  try {
    const _7dAgo = new Date(); _7dAgo.setDate(_7dAgo.getDate() - 7);
    const { data } = await db.from('users')
      .select('id, name, department, avatar_color, created_at, position')
      .eq('organization_id', orgId(req))
      .in('role', ['employee', 'admin'])
      .gte('created_at', _7dAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
