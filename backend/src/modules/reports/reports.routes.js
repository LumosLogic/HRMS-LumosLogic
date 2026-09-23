const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth, adminOnly } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { getOrgPolicy } = require('../../utils/orgPolicy');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, getFilterState, getBranchUserSQLFilter } = require('../../utils/branchFilter');

function toCSV(rows, cols) {
  const header = cols.map(c => c.label).join(',');
  const lines  = rows.map(r => cols.map(c => {
    const v = r[c.key] ?? '';
    return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
  }).join(','));
  return [header, ...lines].join('\n');
}

// ── Deployment-aware joining date SQL expression ──────────────────────────────
// LumosLogic platform DB: only has `date_of_joining` (hrms_full_migration.sql)
// Relitrade DB: has `joining_date` (DATE, sanghavi_migration.sql) — this is where
// actual data lives. Detect once at startup and cache; avoids per-request schema probing.
let _joiningDateExpr = null;
async function getJoiningDateExpr() {
  if (_joiningDateExpr) return _joiningDateExpr;
  const { rows } = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'joining_date' LIMIT 1
  `);
  // If joining_date exists (Relitrade), prefer it — that's where data is stored.
  // Fall back to date_of_joining, then created_at.
  _joiningDateExpr = rows.length > 0
    ? `COALESCE(u.joining_date::TEXT, u.date_of_joining, TO_CHAR(u.created_at, 'YYYY-MM-DD'))`
    : `COALESCE(u.date_of_joining, TO_CHAR(u.created_at, 'YYYY-MM-DD'))`;
  return _joiningDateExpr;
}

// Helper: convert "HH:MM" to minutes
function toMins(t) { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
// Current IST time as "HH:MM"
function nowIST() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'hour').value.padStart(2,'0')}:${parts.find(p => p.type === 'minute').value.padStart(2,'0')}`;
}
// Current IST date as "YYYY-MM-DD"
function todayIST() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); }

// GET /api/reports/attendance?year=&month=&userId=&format=csv
router.get('/attendance', auth, withBranchContext, async (req, res) => {
  try {
    const oId    = req.user.organization_id;
    const policy = await getOrgPolicy(oId);
    const { year, month, userId, format } = req.query;
    const today = todayIST();
    let q = db.from('attendance')
      .select('*, users(name, department, position, device_enrollment_id)')
      .eq('organization_id', oId)
      .lte('date', today)          // never surface future attendance records
      .order('date', { ascending: false });
    if (year && month) {
      q = q.gte('date', `${year}-${String(month).padStart(2,'0')}-01`)
           .lte('date', `${year}-${String(month).padStart(2,'0')}-31`);
    } else if (year) {
      q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
    }
    if (userId) {
      q = q.eq('user_id', userId);
    } else {
      // Apply branch filter when no specific employee is requested
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null && empIds.length === 0) {
        return format === 'csv'
          ? res.setHeader('Content-Type','text/csv').send('date,name,status\n')
          : res.json([]);
      }
      if (empIds !== null) q = q.in('user_id', empIds);
    }
    const { data, error } = await q;
    if (error) throw error;

    // Build a holiday map for the queried range so we can override absent→holiday
    // for dates that were incorrectly marked absent before the holiday was configured.
    const holidayMap = new Map();
    try {
      let hq = db.from('holidays').select('date, name, type').eq('organization_id', oId);
      if (year && month) {
        hq = hq.gte('date', `${year}-${String(month).padStart(2,'0')}-01`)
               .lte('date', `${year}-${String(month).padStart(2,'0')}-31`);
      } else if (year) {
        hq = hq.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`);
      }
      const { data: hols } = await hq;
      for (const h of hols || []) holidayMap.set(h.date, h);
    } catch { /* non-critical — degrade gracefully */ }

    // Build a shift weekoff map using DOW-COVERAGE approach.
    //
    // Rule: "Whoever is assigned to a shift → those DOWs are their working days.
    // Any DOW not covered by ANY of their assigned shifts = week off."
    //
    // Fetch ±31 days so future-month rosters (Sep assigned, Aug being reported) are
    // included. Aggregate ALL DOWs from all shifts per employee. Any DOW not in
    // the union is a shift weekoff for every matching day in the report range.
    const shiftWeekoffSet = new Set(); // key = `${user_id}_${date}`
    const shiftWeekoffByUser = {}; // userId → [dateStr, ...]
    try {
      const rangeStart = year && month
        ? `${year}-${String(month).padStart(2,'0')}-01`
        : year ? `${year}-01-01` : null;
      const rangeEnd = year && month
        ? `${year}-${String(month).padStart(2,'0')}-31`
        : year ? `${year}-12-31` : null;

      if (rangeStart && rangeEnd) {
        // ±31 days so future rosters (e.g. Sep assigned for Aug dates) are reachable
        const padStart = new Date(rangeStart + 'T12:00:00Z');
        padStart.setUTCDate(padStart.getUTCDate() - 31);
        const padEnd = new Date(rangeEnd + 'T12:00:00Z');
        padEnd.setUTCDate(padEnd.getUTCDate() + 31);

        // DISTINCT: we only need unique (user_id, days_of_week) combinations
        const { rows: saRows } = await pool.query(
          `SELECT DISTINCT sa.user_id, s.days_of_week
             FROM shift_assignments sa
             JOIN shifts s ON s.id = sa.shift_id
            WHERE sa.organization_id = $1
              AND sa.date >= $2 AND sa.date <= $3
              ${userId ? 'AND sa.user_id = $4' : ''}`,
          userId
            ? [oId, padStart.toISOString().split('T')[0], padEnd.toISOString().split('T')[0], userId]
            : [oId, padStart.toISOString().split('T')[0], padEnd.toISOString().split('T')[0]]
        );

        // Per employee: union of ALL DOWs covered by any of their assigned shifts.
        // Weekday Shift (1-5) only → DOWs {1,2,3,4,5}; Saturday not covered → week off.
        // Weekday + Saturday Shift → DOWs {1,2,3,4,5,6}; all covered → no shift weekoff.
        const userWorkingDows = {}; // user_id → Set<0..6>
        for (const row of saRows) {
          if (!row.days_of_week) continue;
          if (!userWorkingDows[row.user_id]) userWorkingDows[row.user_id] = new Set();
          let wDays;
          try { wDays = JSON.parse(row.days_of_week); }
          catch { wDays = String(row.days_of_week).split(',').map(Number); }
          if (!Array.isArray(wDays)) wDays = [wDays]; // single number e.g. JSON.parse("6") → 6
          for (const d of wDays) userWorkingDows[row.user_id].add(Number(d));
        }

        // For every date in the report range: DOW not in union → shift weekoff
        const rStart = new Date(rangeStart + 'T12:00:00Z');
        const rEnd   = new Date(rangeEnd   + 'T12:00:00Z');

        for (const uid of Object.keys(userWorkingDows)) {
          const workingDows = userWorkingDows[uid];
          const cur = new Date(rStart);
          while (cur <= rEnd) {
            const ds  = cur.toISOString().split('T')[0];
            const dow = cur.getUTCDay();
            if (!workingDows.has(dow)) {
              shiftWeekoffSet.add(`${uid}_${ds}`);
              if (!shiftWeekoffByUser[uid]) shiftWeekoffByUser[uid] = [];
              shiftWeekoffByUser[uid].push(ds);
            }
            cur.setUTCDate(cur.getUTCDate() + 1);
          }
        }
      }
    } catch { /* shifts table may not exist — degrade gracefully */ }

    // Payroll weekend policy: DOWs that are always weekoffs per payroll_settings.
    // Used as a second source of truth when no shift assignments exist for a date range.
    // Matches what calculatePayroll() does so the report is consistent with 0-LOP behaviour.
    // sat_sun → DOW 0 (Sun) and 6 (Sat) are weekoffs for all employees.
    // sun_only / alternate_sat → DOW 0 (Sun) only.
    const payrollWeekendDows = new Set();
    try {
      const { rows: psRows } = await pool.query(
        `SELECT weekend_policy FROM payroll_settings WHERE organization_id = $1 LIMIT 1`,
        [oId]
      );
      const policy = psRows[0]?.weekend_policy || 'sat_sun';
      if (policy === 'sat_sun') { payrollWeekendDows.add(0); payrollWeekendDows.add(6); }
      else if (policy === 'sun_only' || policy === 'alternate_sat') { payrollWeekendDows.add(0); }
      // 'none' → no payroll weekends, no override
    } catch { /* payroll_settings may not exist — skip */ }

    const timeNow = nowIST();

    const rows = (data || []).map(r => {
      const check_in            = r.check_in  || '';
      const check_out           = r.check_out || '';
      const total_break_minutes = r.total_break_minutes || 0;
      const is_today            = r.date === today;
      const is_live             = is_today && !!check_in && !check_out; // checked in, not yet checked out

      // Gross hours: check_out - check_in (full span)
      let gross_hours = r.gross_hours > 0 ? r.gross_hours : 0;
      if (gross_hours === 0 && check_in && check_out) {
        const mins = toMins(check_out) - toMins(check_in);
        if (mins > 0) gross_hours = Math.round((mins / 60) * 100) / 100;
      }

      // Effective (working) hours: gross - break
      let work_hours = r.work_hours || 0;
      if (work_hours === 0 && check_in && check_out) {
        const grossMins = toMins(check_out) - toMins(check_in);
        const effMins   = Math.max(0, grossMins - total_break_minutes);
        if (effMins > 0) work_hours = Math.round((effMins / 60) * 100) / 100;
      }

      // For live employees (checked in today, no checkout): compute estimated hours so far
      let estimated_hours = 0;
      if (is_live && check_in) {
        const elapsedMins = toMins(timeNow) - toMins(check_in);
        // Subtract active break time if employee is currently on break
        const breakMins = (r.break_start && !r.break_end)
          ? Math.max(0, toMins(timeNow) - toMins(r.break_start))
          : total_break_minutes;
        const effMins = Math.max(0, elapsedMins - breakMins);
        if (effMins > 0) estimated_hours = Math.round((effMins / 60) * 100) / 100;
      }

      // Override 'absent' with 'holiday' if this date is a configured company holiday
      const holidayInfo = holidayMap.get(r.date);
      // Override 'absent' → 'off_day' for shift-assigned weekoffs OR payroll weekends.
      // Payroll weekends (e.g. sat_sun policy) serve as a fallback when no shift rows
      // exist for the period — ensuring the report matches the 0-LOP payroll outcome.
      const isShiftWeekoff   = shiftWeekoffSet.has(`${r.user_id}_${r.date}`);
      const rdow             = new Date(r.date + 'T12:00:00Z').getUTCDay();
      const isPayrollWeekend = payrollWeekendDows.has(rdow);
      const effectiveStatus  = (isShiftWeekoff || isPayrollWeekend) && r.status === 'absent'
        ? 'off_day'
        : (r.status === 'absent' && holidayInfo) ? 'holiday' : r.status;

      return {
        id:                   r.id,
        user_id:              r.user_id,
        device_enrollment_id: r.users?.device_enrollment_id || null,
        name:                 r.users?.name || '',
        department:           r.users?.department || '',
        position:             r.users?.position || '',
        date:                 r.date,
        status:               effectiveStatus,
        holiday_name:         holidayInfo?.name || null,
        holiday_type:         holidayInfo?.type || null,
        check_in,
        check_out,
        break_start:          r.break_start  || '',
        break_end:            r.break_end    || '',
        total_break_minutes,
        gross_hours:          gross_hours    || 0,
        work_hours:           work_hours     || 0,
        estimated_hours,
        is_live,
        is_on_break:          !!(r.break_start && !r.break_end && !check_out),
        non_working_minutes:  policy === 'first_in_last_out' ? total_break_minutes : null,
      };
    });

    if (format === 'csv') {
      const isFilo = policy === 'first_in_last_out';
      const csv = toCSV(rows, [
        { key: 'name', label: 'Employee' },
        { key: 'department', label: 'Department' },
        { key: 'date', label: 'Date' },
        { key: 'status', label: 'Status' },
        { key: 'check_in', label: 'First In' },
        { key: 'check_out', label: 'Last Out' },
        ...(isFilo
          ? [{ key: 'non_working_minutes', label: 'Non-Working (min)' }]
          : [{ key: 'total_break_minutes', label: 'Break (min)' }]),
        { key: 'gross_hours', label: 'Total Hours' },
        { key: 'work_hours', label: 'Working Hours' },
      ]);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="attendance_report_${year||'all'}_${month||'all'}.csv"`);
      return res.send(csv);
    }
    res.json({
      data: rows,
      meta: {
        attendance_policy:    policy,
        shift_weekoff_by_user: shiftWeekoffByUser,
        payroll_weekend_dows:  [...payrollWeekendDows],
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/leaves?year=&month=&format=csv
router.get('/leaves', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { year, month, format, status } = req.query;

    // Branch scope: leaves don't have branch_id directly — filter via employee IDs
    const empIds = await resolveEmployeeIds(req.branchContext, oId);
    if (empIds !== null && empIds.length === 0) {
      return format === 'csv'
        ? res.setHeader('Content-Type', 'text/csv').send('name,department,leave_type,start_date,end_date,status\n')
        : res.json([]);
    }

    let q = db.from('leaves')
      .select('*, users!leaves_user_id_fkey(name, department), approver:users!leaves_approved_by_fkey(name)')
      .eq('organization_id', oId)
      .order('start_date', { ascending: false });
    if (year && month) {
      q = q.gte('start_date', `${year}-${String(month).padStart(2,'0')}-01`)
           .lte('start_date', `${year}-${String(month).padStart(2,'0')}-31`);
    } else if (year) {
      q = q.gte('start_date', `${year}-01-01`).lte('start_date', `${year}-12-31`);
    }
    if (status) q = q.eq('status', status);
    if (empIds !== null) q = q.in('user_id', empIds);
    const { data, error } = await q;
    if (error) throw error;

    const rows = (data || []).map(r => ({
      name:        r.users?.name || '',
      department:  r.users?.department || '',
      leave_type:  r.leave_type,
      start_date:  r.start_date,
      end_date:    r.end_date,
      leave_time:  r.leave_time,
      status:      r.status,
      reason:      r.reason || '',
      approved_by: r.approver?.name || '',
    }));

    if (format === 'csv') {
      const csv = toCSV(rows, [
        { key: 'name', label: 'Employee' },
        { key: 'department', label: 'Department' },
        { key: 'leave_type', label: 'Leave Type' },
        { key: 'start_date', label: 'From' },
        { key: 'end_date', label: 'To' },
        { key: 'leave_time', label: 'Duration' },
        { key: 'status', label: 'Status' },
        { key: 'reason', label: 'Reason' },
        { key: 'approved_by', label: 'Approved By' },
      ]);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="leave_report_${year||'all'}.csv"`);
      return res.send(csv);
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/headcount — summary stats (role-scoped, branch-scoped)
router.get('/headcount', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    // root_admin sees HR admins + employees; HR admin sees employees only
    const roleFilter = req.user.role === 'root_admin' ? ['admin', 'employee'] : ['employee'];

    // Branch scope: resolve accessible employee IDs for the selected branch
    const empIds = await resolveEmployeeIds(req.branchContext, oId);
    if (empIds !== null && empIds.length === 0) {
      return res.json({ total: 0, active: 0, byDepartment: {} });
    }

    // BUG_117/BUG_068: exclude inactive/resigned/terminated from headcount stats
    let q = db.from('users')
      .select('id, role, employee_status, department, date_of_joining, created_at')
      .eq('organization_id', oId)
      .in('role', roleFilter)
      .not('employee_status', 'in', ['inactive', 'resigned', 'terminated']);
    if (empIds !== null) q = q.in('id', empIds);
    const { data: users } = await q;
    const total   = users?.length || 0;
    const active  = users?.filter(u => u.employee_status === 'active' || !u.employee_status).length || 0;
    const byDept  = {};
    (users || []).forEach(u => {
      const d = u.department || 'General';
      byDept[d] = (byDept[d] || 0) + 1;
    });
    res.json({ total, active, byDepartment: byDept });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/reports/employees?format=csv
// Always scoped to the caller's organization_id — root_admin is per-org, not platform-wide.
// Uses adminOnly (not hasPermission) to avoid RBAC table dependency causing 500s.
router.get('/employees', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const oId    = req.user.organization_id;
    const { format } = req.query;

    // Branch scope — filter employees by their users.branch_id
    const state = getFilterState(req.branchContext);
    if (state.type === 'none') {
      return format === 'csv'
        ? res.setHeader('Content-Type', 'text/csv').send('name,email,department,position,type,status,joining_date\n')
        : res.json([]);
    }
    const bf = getBranchUserSQLFilter(state, 1, 'u'); // $1 = oId already bound

    const dateExpr = await getJoiningDateExpr();

    const result = await pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.department,
        u.position,
        u.role,
        COALESCE(u.employment_type, 'full_time') AS employment_type,
        COALESCE(u.employee_status, 'active')    AS employee_status,
        ${dateExpr}                               AS date_of_joining,
        u.created_at
      FROM users u
      WHERE u.role = 'employee'
        AND u.organization_id = $1
        ${bf.clause}
      ORDER BY u.name ASC
    `, [oId, ...bf.params]);

    const rows = (result.rows || []).map(r => ({
      ...r,
      employment_type:   r.employment_type ? r.employment_type.replace(/-/g, '_').toLowerCase() : null,
      employment_status: r.employee_status || null,
    }));

    if (format === 'csv') {
      const csv = toCSV(rows, [
        { key: 'name',              label: 'Name' },
        { key: 'email',             label: 'Email' },
        { key: 'department',        label: 'Department' },
        { key: 'position',          label: 'Position' },
        { key: 'employment_type',   label: 'Type' },
        { key: 'employment_status', label: 'Status' },
        { key: 'date_of_joining',   label: 'Joining Date' },
      ]);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="employee_list.csv"');
      return res.send(csv);
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
