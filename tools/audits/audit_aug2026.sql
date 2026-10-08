-- ============================================================
-- Relitrade August 2026 — Attendance Audit (READ-ONLY)
-- Run: psql -U lumos_admin -d lumos_hrms -f audit_aug2026.sql
-- ============================================================
\pset pager off
\pset border 2
\pset null '—'
\timing on

-- ── 1. Payroll Settings ───────────────────────────────────────
\echo ''
\echo '=== 1. PAYROLL SETTINGS ==='
SELECT weekend_policy, count_holidays_as_paid,
       working_days_rule, fixed_working_days, per_day_salary_basis
FROM payroll_settings
WHERE organization_id = 1;

-- ── 2. August 2026 Holidays ──────────────────────────────────
\echo ''
\echo '=== 2. HOLIDAYS IN AUGUST 2026 ==='
SELECT date::text, name
FROM holidays
WHERE organization_id = 1
  AND date BETWEEN '2026-08-01' AND '2026-08-31'
ORDER BY date;

-- ── 3. Calendar breakdown for August 2026 ────────────────────
-- (sun_only: 5 Sundays = 5 weekoffs; sat_sun: 10 weekoffs)
\echo ''
\echo '=== 3. AUGUST 2026 CALENDAR (day-of-week breakdown) ==='
SELECT
  TO_CHAR(d, 'Dy') AS "Day",
  COUNT(*)          AS "Count"
FROM generate_series('2026-08-01'::date, '2026-08-31'::date, '1 day') d
GROUP BY TO_CHAR(d, 'Dy'), EXTRACT(dow FROM d)
ORDER BY EXTRACT(dow FROM d);

-- ── 4. Main audit: stored snapshot vs actual attendance ───────
\echo ''
\echo '=== 4. PAYSLIP SNAPSHOT vs ACTUAL ATTENDANCE ==='
\echo '    Cal31 should always = 31 (working_days + weekoff, NO +holiday)'
SELECT
  u.employee_id                                                           AS "EmpID",
  LEFT(u.name, 24)                                                        AS "Employee",
  -- Stored payslip columns
  ps.working_days                                                         AS "WkDays",
  ROUND(COALESCE((ps.attendance_snapshot->>'presentFull')::numeric,0)
      + COALESCE((ps.attendance_snapshot->>'presentHalf')::numeric,0)*0.5, 2) AS "P+OD",
  COALESCE((ps.attendance_snapshot->>'weekoff')::numeric, 0)::int        AS "WOff",
  COALESCE((ps.attendance_snapshot->>'holiday')::numeric, 0)::int        AS "HL",
  COALESCE((ps.attendance_snapshot->>'paidLeave')::numeric, 0)::int      AS "CL",
  COALESCE((ps.attendance_snapshot->>'paidHalfLeave')::numeric, 0)::int  AS "HalfCL",
  COALESCE((ps.attendance_snapshot->>'unpaidLeave')::numeric, 0)::int    AS "UnpaidL",
  COALESCE((ps.attendance_snapshot->>'absent')::numeric, 0)::int         AS "Abs",
  ROUND(ps.lop_days, 2)                                                   AS "LOP",
  -- Calendar check (FIXED formula — must equal 31)
  ps.working_days
    + COALESCE((ps.attendance_snapshot->>'weekoff')::numeric,0)          AS "Cal31?",
  -- Actual from attendance table (raw records only — no engine logic)
  COUNT(CASE WHEN a.status IN ('present','wfh','work_from_home','early_leave') THEN 1 END) AS "Att_P",
  COUNT(CASE WHEN a.status = 'half_day'  THEN 1 END)                     AS "Att_HD",
  COUNT(CASE WHEN a.status = 'absent'    THEN 1 END)                     AS "Att_Ab",
  COUNT(CASE WHEN a.status = 'on_leave'  THEN 1 END)                     AS "Att_OL",
  COUNT(a.date)                                                           AS "Att_Total",
  -- Reconciliation: snapshot sum (should equal 31 too)
  ROUND(
    COALESCE((ps.attendance_snapshot->>'presentFull')::numeric,0)
    + COALESCE((ps.attendance_snapshot->>'presentHalf')::numeric,0)*0.5
    + COALESCE((ps.attendance_snapshot->>'paidHalfLeave')::numeric,0)*0.5
    + COALESCE((ps.attendance_snapshot->>'weekoff')::numeric,0)
    + COALESCE((ps.attendance_snapshot->>'holiday')::numeric,0)
    + COALESCE((ps.attendance_snapshot->>'paidLeave')::numeric,0)
    + COALESCE((ps.attendance_snapshot->>'unpaidLeave')::numeric,0)
    + COALESCE((ps.attendance_snapshot->>'absent')::numeric,0)
  , 2)                                                                    AS "SnapSum"
FROM payslips ps
JOIN users u ON u.id = ps.user_id AND u.organization_id = 1
LEFT JOIN attendance a
       ON a.user_id         = ps.user_id
      AND a.organization_id = 1
      AND a.date BETWEEN '2026-08-01' AND '2026-08-31'
WHERE ps.organization_id = 1
  AND ps.month = '08'
  AND ps.year  = 2026
GROUP BY
  u.employee_id, u.name, ps.working_days,
  ps.attendance_snapshot, ps.lop_days
ORDER BY u.employee_id::integer NULLS LAST, u.name;

-- ── 5. Approved leaves overlapping August 2026 ───────────────
\echo ''
\echo '=== 5. APPROVED LEAVES IN AUGUST 2026 ==='
SELECT
  u.employee_id                                                AS "EmpID",
  LEFT(u.name, 22)                                             AS "Employee",
  l.leave_type                                                 AS "Type",
  COALESCE(l.leave_time, 'full')                               AS "Time",
  l.start_date::text                                           AS "Start",
  l.end_date::text                                             AS "End",
  -- Days that fall inside August 2026
  (LEAST(l.end_date, '2026-08-31') - GREATEST(l.start_date, '2026-08-01') + 1)
                                                               AS "AugDays",
  COALESCE(lp.paid, true)                                      AS "Paid"
FROM leaves l
JOIN  users u ON u.id = l.user_id AND u.organization_id = 1
LEFT JOIN leave_policies lp
       ON lp.leave_type      = l.leave_type
      AND lp.organization_id = 1
WHERE l.organization_id = 1
  AND l.status          = 'approved'
  AND l.start_date     <= '2026-08-31'
  AND l.end_date       >= '2026-08-01'
ORDER BY u.employee_id::integer NULLS LAST, l.start_date;

-- ── 6. Shift assignments in August 2026 ──────────────────────
\echo ''
\echo '=== 6. SHIFT ASSIGNMENTS (August 2026) ==='
SELECT
  u.employee_id        AS "EmpID",
  LEFT(u.name, 22)     AS "Employee",
  s.name               AS "Shift",
  s.days_of_week       AS "WorkDays",
  COUNT(sa.date)       AS "DaysAssigned",
  MIN(sa.date)::text   AS "First",
  MAX(sa.date)::text   AS "Last"
FROM shift_assignments sa
JOIN users  u ON u.id  = sa.user_id  AND u.organization_id = 1
JOIN shifts s ON s.id  = sa.shift_id
WHERE sa.organization_id = 1
  AND sa.date BETWEEN '2026-08-01' AND '2026-08-31'
GROUP BY u.employee_id, u.name, s.name, s.days_of_week
ORDER BY u.employee_id::integer NULLS LAST, s.name;

-- ── 7. Employees with NO attendance records in August 2026 ───
\echo ''
\echo '=== 7. EMPLOYEES WITH ZERO ATTENDANCE RECORDS IN AUGUST 2026 ==='
SELECT
  u.employee_id AS "EmpID",
  u.name        AS "Employee"
FROM payslips ps
JOIN users u ON u.id = ps.user_id AND u.organization_id = 1
WHERE ps.organization_id = 1
  AND ps.month = '08' AND ps.year = 2026
  AND NOT EXISTS (
    SELECT 1 FROM attendance a
    WHERE a.user_id = ps.user_id
      AND a.organization_id = 1
      AND a.date BETWEEN '2026-08-01' AND '2026-08-31'
  )
ORDER BY u.employee_id::integer NULLS LAST;

\echo ''
\echo '=== AUDIT COMPLETE ==='
\echo 'Key checks:'
\echo '  Cal31? column must = 31 for every employee'
\echo '  SnapSum column must = 31 for every employee'
\echo '  HL column must = 1 (Aug 15 Independence Day, if org has it configured)'
\echo '  WOff = 5 for sun_only policy, = 10 for sat_sun policy'
