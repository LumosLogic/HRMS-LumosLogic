'use strict';
/**
 * payrollEngine.js — Phase 3.2
 * Pure calculation: NO database writes. NO payslip creation.
 * Every query is scoped to organization_id. No cross-tenant access possible.
 */

const { pool } = require('../config/db');

// ─── Custom error ─────────────────────────────────────────────────────────────
class PayrollError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PayrollError';
    this.code  = code;
  }
}

// ─── Date utilities ───────────────────────────────────────────────────────────

function daysInMonth(year, month) {
  // month is 1-based. new Date(year, month, 0) = last day of the month.
  // Handles February, leap years automatically.
  return new Date(year, month, 0).getDate();
}

function padZ(n) { return String(n).padStart(2, '0'); }

function toDateStr(year, month, day) {
  return `${year}-${padZ(month)}-${padZ(day)}`;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

// Extract minutes-since-midnight from 'HH:MM', 'HH:MM:SS', or ISO timestamp.
function toMins(timeValue) {
  if (!timeValue) return null;
  const m = String(timeValue).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const n = parseInt(m[2], 10);
  return (isNaN(h) || isNaN(n)) ? null : h * 60 + n;
}

// ─── Weekend detection ────────────────────────────────────────────────────────
// satSeq = running count of Saturdays seen so far in the month (inclusive).
function isWeekendDay(dow, weekendPolicy, satSeq) {
  switch (weekendPolicy) {
    case 'sat_sun':      return dow === 0 || dow === 6;
    case 'sun_only':     return dow === 0;
    case 'none':         return false;
    case 'alternate_sat':
      if (dow === 0) return true;
      if (dow !== 6) return false;
      return satSeq % 2 === 0;   // 2nd, 4th Saturday = weekend
    default:
      return dow === 0 || dow === 6;
  }
}

// ─── Build per-day classification map ────────────────────────────────────────
// Returns Array<{ dateStr, dow, isWeekend, isHoliday, isWorkingDay }>
function buildDateMap(year, month, weekendPolicy, holidaySet) {
  const total  = daysInMonth(year, month);
  const result = [];
  let satSeq   = 0;

  for (let d = 1; d <= total; d++) {
    const ds    = toDateStr(year, month, d);
    const dow   = new Date(year, month - 1, d).getDay(); // 0=Sun,6=Sat
    if (dow === 6) satSeq++;

    const isWe  = isWeekendDay(dow, weekendPolicy, satSeq);
    const isHol = !isWe && holidaySet.has(ds);

    result.push({
      dateStr:     ds,
      dow,
      isWeekend:   isWe,
      isHoliday:   isHol,
      isWorkingDay: !isWe && !isHol,
    });
  }
  return result;
}

// ─── Expand leave rows to per-date map ───────────────────────────────────────
// Returns Map<dateStr, { paid, leave_time, leave_type }>
function buildLeaveDateMap(leaveRows, year, month) {
  const map    = new Map();
  const mStart = toDateStr(year, month, 1);
  const mEnd   = toDateStr(year, month, daysInMonth(year, month));

  for (const lv of leaveRows) {
    const s = lv.start_date < mStart ? mStart : lv.start_date;
    const e = lv.end_date   > mEnd   ? mEnd   : lv.end_date;

    const cur = new Date(s + 'T12:00:00Z');
    const end = new Date(e + 'T12:00:00Z');

    while (cur <= end) {
      const ds = cur.toISOString().split('T')[0];
      // Earlier entries win (same date, multiple leaves shouldn't happen but be safe)
      if (!map.has(ds)) {
        map.set(ds, {
          paid:       lv.paid !== false, // NULL/undefined = true (paid)
          leave_time: lv.leave_time || 'full',
          leave_type: lv.leave_type,
        });
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return map;
}

// ─── Parse shift days_of_week into a Set<dow> ─────────────────────────────────
// Handles: null, Array ([1,2,3,4,5]), JSON string ("[1,2,3,4,5]"), comma string "1,2,3,4,5"
function parseShiftWorkDays(days_of_week) {
  if (!days_of_week) return null;
  if (Array.isArray(days_of_week)) return new Set(days_of_week.map(Number));
  try {
    const parsed = JSON.parse(days_of_week);
    if (Array.isArray(parsed)) return new Set(parsed.map(Number));
  } catch { /* not JSON */ }
  return new Set(String(days_of_week).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)));
}

// ─── calculateAttendance ─────────────────────────────────────────────────────
// Returns counters and daily breakdown. Pure function — no DB access.
function calculateAttendance({
  dateMap,
  attendanceMap,      // Map<dateStr, { status, check_in, check_out, work_hours }>
  regularizedSet,     // Set<dateStr> — approved regularizations
  leaveDateMap,
  countHolidaysAsPaid,
  scheduleCheckIn,    // 'HH:MM' or null
  graceMins,
  maxEarlyLeaveCount, // number — early leaves within this limit are full-day; excess → LOP
  shiftDateMap,       // Map<dateStr, { workDays: Set<dow>|null, durationH: number }>
  orgHalfDayHours,    // org-level half_day_hours (from work_schedule) — used for short-shift reclassification
}) {
  const orgSchedMins   = toMins(scheduleCheckIn);  // org-level fallback for late threshold
  const g              = Number(graceMins) || 0;
  const orgMaxEarlyLeave = Number(maxEarlyLeaveCount) || 3;
  const orgHalfDayH    = Number(orgHalfDayHours)    || 4.5;

  let presentFull   = 0;  // full present day (including WFH + early_leave within allowance)
  let presentHalf   = 0;  // half-day attendance record
  let paidLeave     = 0;  // approved paid leave (full day)
  let paidHalfLeave = 0;  // approved paid leave (half day)
  let unpaidLeave   = 0;  // approved unpaid leave
  let absent        = 0;  // absent / no record on working day (includes excess early_leave → LOP)
  let weekoff       = 0;
  let holiday       = 0;  // paid holidays only
  let lateCount     = 0;
  let regularized   = 0;
  let earlyLeave    = 0;  // early_leave days within allowance
  let earlyLeaveLop = 0;  // early_leave days beyond allowance that became LOP
  const daily       = [];

  for (const { dateStr: ds, isWeekend: isWe, isHoliday: isHol, dow } of dateMap) {
    // Per-employee shift override: if the employee has a shift assigned for this date
    // and the date's day-of-week is NOT in that shift's configured working days,
    // treat it as a week-off — NOT absent, NOT LOP.
    let effectiveIsWeekend = isWe;
    let shiftDurationH     = 0;    // shift's total hours (0 = not known / use org defaults)
    let shiftLateThreshMins = null; // null = use org-level fallback
    let shiftHalfDayH      = null;  // null = use org-level fallback
    let shiftMaxEarlyLeave = null;  // null = use org-level fallback
    if (shiftDateMap && shiftDateMap.has(ds)) {
      const shiftInfo = shiftDateMap.get(ds);
      if (shiftInfo.workDays !== null) {
        effectiveIsWeekend = !shiftInfo.workDays.has(dow);
      }
      shiftDurationH      = shiftInfo.durationH      || 0;
      shiftLateThreshMins = shiftInfo.lateThresholdMins ?? null;
      shiftHalfDayH       = shiftInfo.halfDayH          ?? null;
      shiftMaxEarlyLeave  = shiftInfo.maxEarlyLeave      ?? null;
    }

    // Resolve per-day effective thresholds: shift-specific → org fallback
    const dayLateThreshMins = shiftLateThreshMins ?? orgSchedMins;
    const dayHalfDayH       = shiftHalfDayH       ?? orgHalfDayH;
    const dayMaxEarlyLeave  = shiftMaxEarlyLeave   ?? orgMaxEarlyLeave;

    if (effectiveIsWeekend) {
      weekoff++;
      daily.push({ date: ds, type: 'weekoff' });
      continue;
    }

    if (isHol) {
      if (countHolidaysAsPaid) {
        holiday++;
        daily.push({ date: ds, type: 'paid_holiday' });
      } else {
        daily.push({ date: ds, type: 'unpaid_holiday' });
      }
      continue;
    }

    // Working day
    const att   = attendanceMap.get(ds);
    const leave = leaveDateMap.get(ds);
    let status  = att?.status ?? null;

    // Approved regularization upgrades absent / missing to present
    if (regularizedSet.has(ds) && (!status || status === 'absent')) {
      status = 'present';
      regularized++;
    }

    // ── Leave-driven classification ───────────────────────────────────────
    // Approved leave takes priority over 'absent' attendance records
    // (handles case where employee was auto-marked absent and later applied leave)
    if (status === 'on_leave' || ((!status || status === 'absent') && leave)) {
      const lv = leave ?? { paid: true, leave_time: 'full' };
      const ltime = lv.leave_time || 'full';

      if (ltime === 'wfh') {
        presentFull++;
        daily.push({ date: ds, type: 'wfh_leave' });
      } else if (ltime === 'half') {
        if (lv.paid !== false) {
          paidHalfLeave++;
          daily.push({ date: ds, type: 'paid_half_leave' });
        } else {
          // Unpaid half-day leave → treat as half-day present (0.5 payable)
          presentHalf++;
          daily.push({ date: ds, type: 'unpaid_half_leave' });
        }
      } else {
        // Full-day leave
        if (lv.paid !== false) {
          paidLeave++;
          daily.push({ date: ds, type: 'paid_leave' });
        } else {
          unpaidLeave++;
          daily.push({ date: ds, type: 'unpaid_leave' });
        }
      }
      continue;
    }

    // ── Attendance-driven classification ──────────────────────────────────
    if (status === 'present') {
      presentFull++;
      daily.push({ date: ds, type: 'present' });

      // Late detection uses shift's late_threshold when configured; falls back to org schedule time
      if (dayLateThreshMins !== null && att?.check_in) {
        const cin = toMins(att.check_in);
        if (cin !== null && cin > dayLateThreshMins + g) lateCount++;
      }
      continue;
    }

    if (status === 'wfh' || status === 'work_from_home') {
      presentFull++;
      daily.push({ date: ds, type: 'wfh' });
      continue;
    }

    if (status === 'half_day') {
      // Short-shift reclassification:
      // If the shift has its own half_day_hours configured, use it as the minimum
      // threshold — employee worked ≥ shift's half_day_hours → full present.
      // Example: Saturday Shift 10:30–13:30 = 3h; shift half_day_hours = 1h.
      //          Employee worked 2.61h ≥ 1h → reclassify as full present.
      // Fallback (no shift-specific half_day_hours): use 50% of shift duration.
      const workedH = Number(att?.work_hours ?? 0);
      const reclassThreshold = shiftHalfDayH !== null
        ? shiftHalfDayH                          // shift's own threshold
        : (shiftDurationH > 0 ? shiftDurationH * 0.5 : dayHalfDayH); // 50% of shift or org default
      if (shiftDurationH > 0 && workedH >= reclassThreshold) {
        presentFull++;
        daily.push({ date: ds, type: 'present' });
      } else {
        presentHalf++;
        daily.push({ date: ds, type: 'half_day' });
      }
      continue;
    }

    if (status === 'early_leave') {
      // Within the per-day shift allowance (or org-level): counts as full present day.
      // Beyond the allowance: treated as absent so LOP calculation picks it up.
      if (earlyLeave < dayMaxEarlyLeave) {
        presentFull++;
        earlyLeave++;
        daily.push({ date: ds, type: 'early_leave' });
      } else {
        presentHalf++;
        earlyLeaveLop++;
        daily.push({ date: ds, type: 'early_leave_lop' });
      }
      continue;
    }

    // Absent or no record
    absent++;
    daily.push({ date: ds, type: status === 'absent' ? 'absent' : 'no_record' });
  }

  return {
    presentFull,
    presentHalf,
    paidLeave,
    paidHalfLeave,
    unpaidLeave,
    absent,
    weekoff,
    holiday,
    lateCount,
    regularized,
    earlyLeave,
    earlyLeaveLop,
    daily,
  };
}

// ─── calculatePayableDays ─────────────────────────────────────────────────────
// Returns the number of "credit units" the employee earns (float).
// Does NOT include weekoffs — those are implicitly in gross already.
function calculatePayableDays(att, countHolidaysAsPaid) {
  return round2(
    att.presentFull +
    (att.presentHalf  * 0.5) +
    att.paidLeave +
    (att.paidHalfLeave * 0.5) +
    (countHolidaysAsPaid ? att.holiday : 0)
  );
}

// ─── calculateLOP ─────────────────────────────────────────────────────────────
// workingDays = non-weekend days in month (the denominator).
// LOP = how many of those the employee did NOT earn.
function calculateLOP(att, settings, workingDays) {
  const {
    late_allowance_per_month: lateAllowance,
    half_day_after_lates:     latesPerHalf,
    count_holidays_as_paid:   countHolidaysAsPaid,
  } = settings;

  const payableDays = calculatePayableDays(att, countHolidaysAsPaid);
  const baseLOP     = round2(Math.max(0, workingDays - payableDays));

  // Excess late arrivals → additional half-day penalties
  const excessLates    = Math.max(0, att.lateCount - Number(lateAllowance));
  const lateHalfDays   = Math.floor(excessLates / Math.max(1, Number(latesPerHalf)));
  const lateHalfDayLOP = round2(lateHalfDays * 0.5);

  const totalLOP = round2(baseLOP + lateHalfDayLOP);

  return {
    payableDays,
    baseLOP,
    excessLates,
    lateHalfDays,
    lateHalfDayLOP,
    totalLOP,
  };
}

// ─── calculateGross ───────────────────────────────────────────────────────────
function calculateGross(sal) {
  const components = [
    'basic', 'hra', 'da',
    'transport_allowance', 'medical_allowance',
    'special_allowance', 'other_allowance',
  ];
  return round2(components.reduce((sum, f) => sum + (Number(sal[f]) || 0), 0));
}

// ─── calculateDeductions ──────────────────────────────────────────────────────
// pfConfig / esiConfig: rows from statutory_pf_config / statutory_esi_config (may be null).
// calendarDays: total days in the pay month (e.g. 31 for August).
// grossSalary: pre-LOP gross (used as payable_gross base for dynamic ESI).
function calculateDeductions(sal, settings, lopDays, perDaySalary, grossSalary, calendarDays, pfConfig, esiConfig) {
  const lopDeduction = round2(lopDays * perDaySalary);

  // ── PF (employee) ─────────────────────────────────────────────────────────
  // Priority: disabled → 0 | fixed → stored value | dynamic → calendar-day proration
  let pf = 0;
  if (settings.pf_enabled) {
    const pfMode = sal.pf_calc_mode || 'fixed';
    if (pfMode === 'disabled') {
      pf = 0;
    } else if (pfMode === 'dynamic' && pfConfig?.enabled) {
      // payable_basic = basic × (payable_calendar_days / calendar_days)
      const payableCalDays = Math.max(0, calendarDays - lopDays);
      const payableBasic   = round2(Number(sal.basic || 0) * (payableCalDays / calendarDays));
      const pfRate         = Number(pfConfig.employee_pf_pct || 12) / 100;
      pf = round2(payableBasic * pfRate);
    } else {
      // 'fixed' (default) — use stored value as-is
      pf = round2(Number(sal.employee_pf) || 0);
    }
  }

  // ── ESI (employee) ────────────────────────────────────────────────────────
  let esi = 0;
  if (settings.esi_enabled) {
    const esiMode = sal.esi_calc_mode || 'fixed';
    if (esiMode === 'disabled') {
      esi = 0;
    } else if (esiMode === 'dynamic' && esiConfig?.enabled) {
      // ESI eligibility: gross must be ≤ wage_limit (default ₹21,000)
      const wageLimit = Number(esiConfig.wage_limit || 21000);
      if (wageLimit <= 0 || grossSalary <= wageLimit) {
        // payable_gross = gross - lop_deduction
        const payableGross = round2(grossSalary - lopDeduction);
        const esiRate      = Number(esiConfig.employee_esi_pct || 0.75) / 100;
        esi = round2(payableGross * esiRate);
      }
    } else {
      esi = round2(Number(sal.employee_esi) || 0);
    }
  }

  const pt        = settings.professional_tax_enabled  ? round2(Number(sal.professional_tax)  || 0) : 0;
  const tds       = settings.tds_enabled               ? round2(Number(sal.tds)               || 0) : 0;
  const retention = round2(Number(sal.retention)       || 0);
  const other     = round2(Number(sal.other_deductions) || 0);

  const total = round2(pf + esi + pt + tds + retention + other + lopDeduction);

  return { pf, esi, professionalTax: pt, tds, retention, otherDeductions: other, lopDeduction, total };
}

// ─── calculateEmployerContribution ────────────────────────────────────────────
function calculateEmployerContribution(sal, settings) {
  const pf  = settings.pf_enabled  ? round2(Number(sal.employer_pf)  || 0) : 0;
  const esi = settings.esi_enabled ? round2(Number(sal.employer_esi) || 0) : 0;
  return { pf, esi, total: round2(pf + esi) };
}

// ─── DB: fetch all required data in parallel ──────────────────────────────────
const SETTING_DEFAULTS = {
  working_days_rule:            'calendar',
  fixed_working_days:           26,
  weekend_policy:               'sat_sun',
  count_holidays_as_paid:       true,
  grace_minutes:                15,
  late_allowance_per_month:     3,
  early_exit_allowance_minutes: 30,
  half_day_after_lates:         3,
  lop_after_half_days:          2,
  pf_enabled:                   true,
  esi_enabled:                  true,
  professional_tax_enabled:     true,
  tds_enabled:                  false,
  // 'working_days': per-day = gross ÷ non-weekend working days (default)
  // 'calendar_days': per-day = gross ÷ total calendar days in month (e.g. Aug=31)
  // LOP day COUNT always uses actual working days regardless of this setting.
  per_day_salary_basis:         'working_days',
};

async function fetchAllData(oId, uId, month, year) {
  const start = toDateStr(year, month, 1);
  const end   = toDateStr(year, month, daysInMonth(year, month));

  const [
    empRes,
    settingsRes,
    salaryRes,
    attRes,
    leaveRes,
    holidayRes,
    scheduleRes,
    regRes,
    shiftRes,
    pfConfigRes,
    esiConfigRes,
  ] = await Promise.all([

    // Employee — org-scoped (with probation dates for leave override)
    (async () => {
      try {
        return await pool.query(
          `SELECT id, name, email, department, position, employee_id,
                  employee_status AS status,
                  probation_start_date::text, probation_end_date::text
             FROM users
            WHERE id = $1 AND organization_id = $2`,
          [uId, oId]
        );
      } catch {
        return await pool.query(
          `SELECT id, name, email, department, position, employee_id,
                  employee_status AS status
             FROM users
            WHERE id = $1 AND organization_id = $2`,
          [uId, oId]
        );
      }
    })(),

    // Payroll settings
    pool.query(
      `SELECT * FROM payroll_settings WHERE organization_id = $1`,
      [oId]
    ),

    // Active salary structure for the pay period.
    // effective_from ≤ last day of period AND (effective_to IS NULL OR ≥ first day).
    pool.query(
      `SELECT *
         FROM employee_salary_structures
        WHERE organization_id = $1
          AND user_id = $2
          AND effective_from <= $3
          AND (effective_to IS NULL OR effective_to >= $4)
        ORDER BY effective_from DESC
        LIMIT 1`,
      [oId, uId, end, start]
    ),

    // Attendance records — resilient: falls back if check_in/check_out columns absent in older DBs
    (async () => {
      try {
        return await pool.query(
          `SELECT date::text, status, check_in, check_out, COALESCE(work_hours, 0) as work_hours
             FROM attendance
            WHERE user_id = $1
              AND organization_id = $2
              AND date >= $3 AND date <= $4`,
          [uId, oId, start, end]
        );
      } catch {
        return await pool.query(
          `SELECT date::text, status,
                  NULL as check_in, NULL as check_out,
                  COALESCE(work_hours, 0) as work_hours
             FROM attendance
            WHERE user_id = $1
              AND organization_id = $2
              AND date >= $3 AND date <= $4`,
          [uId, oId, start, end]
        );
      }
    })(),

    // Approved leaves overlapping this period, with paid flag from leave_policies
    pool.query(
      `SELECT l.start_date::text, l.end_date::text,
              l.leave_type, l.leave_time,
              COALESCE(lp.paid, true) AS paid
         FROM leaves l
         LEFT JOIN leave_policies lp
                ON lp.leave_type        = l.leave_type
               AND lp.organization_id   = l.organization_id
        WHERE l.user_id         = $1
          AND l.organization_id = $2
          AND l.status          = 'approved'
          AND l.start_date      <= $3
          AND l.end_date        >= $4`,
      [uId, oId, end, start]
    ),

    // Org holidays in this month
    pool.query(
      `SELECT date::text, name
         FROM holidays
        WHERE organization_id = $1
          AND date >= $2 AND date <= $3`,
      [oId, start, end]
    ),

    // Work schedule — try both column naming conventions across DB versions.
    // Relitrade uses start_time/end_time; older DBs may use check_in/check_out.
    (async () => {
      // Try new convention (start_time / end_time) first
      try {
        return await pool.query(
          `SELECT start_time AS check_in, end_time AS check_out,
                  work_days, full_day_hours, half_day_hours, max_early_leave_count
             FROM work_schedule
            WHERE organization_id = $1
            LIMIT 1`,
          [oId]
        );
      } catch { /* column names differ */ }
      // Fallback: old convention (check_in / check_out)
      try {
        return await pool.query(
          `SELECT check_in, check_out,
                  work_days, full_day_hours, half_day_hours, max_early_leave_count
             FROM work_schedule
            WHERE organization_id = $1
            LIMIT 1`,
          [oId]
        );
      } catch { /* pre-migration: no half_day_hours column */ }
      // Last resort: bare minimum
      try {
        return await pool.query(
          `SELECT COALESCE(start_time, check_in) AS check_in,
                  COALESCE(end_time,   check_out) AS check_out,
                  work_days
             FROM work_schedule
            WHERE organization_id = $1
            LIMIT 1`,
          [oId]
        );
      } catch {
        return { rows: [] };
      }
    })(),

    // Approved attendance corrections only (type='check_time').
    // Early leave requests (type='early_leave') must NOT trigger the absent→present upgrade
    // because they do not modify checkout time or working hours.
    pool.query(
      `SELECT date::text
         FROM attendance_regularization
        WHERE user_id         = $1
          AND organization_id = $2
          AND date >= $3 AND date <= $4
          AND status          = 'approved'
          AND (type IS NULL OR type = 'check_time')`,
      [uId, oId, start, end]
    ).catch(() => ({ rows: [] })),

    // Per-employee shift assignments — working days, duration, and shift-specific attendance rules.
    // late_threshold, half_day_hours, full_day_hours, max_early_leave_count may be NULL on older
    // shifts (pre-migration) — engine falls back to org-level work_schedule values in that case.
    pool.query(
      `SELECT sa.date::text, s.days_of_week, s.start_time, s.end_time,
              s.late_threshold, s.early_exit_threshold,
              s.half_day_hours, s.full_day_hours, s.max_early_leave_count
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE sa.user_id         = $1
          AND sa.organization_id = $2
          AND sa.date >= $3 AND sa.date <= $4`,
      [uId, oId, start, end]
    ).catch(() => ({ rows: [] })),

    // Statutory PF config — used by dynamic PF mode in calculateDeductions.
    // Returns null row if unconfigured; engine falls back to fixed mode.
    pool.query(
      `SELECT enabled, pf_wage_basis, wage_ceiling, employee_pf_pct
         FROM statutory_pf_config
        WHERE organization_id = $1
        LIMIT 1`,
      [oId]
    ).catch(() => ({ rows: [] })),

    // Statutory ESI config — used by dynamic ESI mode in calculateDeductions.
    pool.query(
      `SELECT enabled, wage_limit, employee_esi_pct
         FROM statutory_esi_config
        WHERE organization_id = $1
        LIMIT 1`,
      [oId]
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    employee:         empRes.rows[0]      ?? null,
    settings:         settingsRes.rows[0] ?? null,
    salary:           salaryRes.rows[0]   ?? null,
    attendance:       attRes.rows         ?? [],
    leaves:           leaveRes.rows       ?? [],
    holidays:         holidayRes.rows     ?? [],
    schedule:         scheduleRes.rows[0] ?? null,
    regularized:      regRes.rows         ?? [],
    shiftAssignments: shiftRes.rows       ?? [],
    pfConfig:         pfConfigRes.rows[0] ?? null,
    esiConfig:        esiConfigRes.rows[0] ?? null,
    start,
    end,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * calculatePayroll — pure calculation for one employee / one pay period.
 *
 * @param {object} p
 * @param {number} p.organizationId
 * @param {number} p.userId
 * @param {number} p.month   1–12
 * @param {number} p.year
 * @returns {Promise<PayrollResult>}  No writes. No side effects.
 * @throws  {PayrollError}            Descriptive error with machine-readable .code
 */
async function calculatePayroll({ organizationId, userId, month, year }) {
  // ── Input validation ──────────────────────────────────────────────────────
  const oId = Number(organizationId);
  const uId = Number(userId);
  const m   = Number(month);
  const y   = Number(year);

  if (!oId || !uId) throw new PayrollError('organizationId and userId are required', 'INVALID_PARAMS');
  if (m < 1 || m > 12) throw new PayrollError(`Invalid month: ${m}`, 'INVALID_MONTH');
  if (y < 2000 || y > 2100) throw new PayrollError(`Invalid year: ${y}`, 'INVALID_YEAR');

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const data = await fetchAllData(oId, uId, m, y);

  // ── Domain validation ─────────────────────────────────────────────────────
  if (!data.employee) {
    throw new PayrollError(
      `Employee ${uId} not found in organization ${oId}`,
      'EMPLOYEE_NOT_FOUND'
    );
  }
  if (data.employee.status === 'inactive') {
    throw new PayrollError(
      `Employee "${data.employee.name}" is inactive and cannot be included in payroll`,
      'EMPLOYEE_INACTIVE'
    );
  }
  if (!data.salary) {
    throw new PayrollError(
      `No salary structure found for "${data.employee.name}" effective on or before ${toDateStr(y, m, daysInMonth(y, m))}. ` +
      'Configure a salary structure first.',
      'SALARY_NOT_FOUND'
    );
  }

  // ── Merge settings with defaults ──────────────────────────────────────────
  const settings = { ...SETTING_DEFAULTS, ...(data.settings ?? {}) };

  // ── Build lookup structures ───────────────────────────────────────────────
  const holidaySet = new Set(data.holidays.map(h => h.date));

  const attendanceMap = new Map(data.attendance.map(a => [a.date, a]));

  const regularizedSet = new Set(data.regularized.map(r => r.date));

  const leaveDateMap = buildLeaveDateMap(data.leaves, y, m);

  // ── Probation leave override (per-date) ───────────────────────────────────
  // If the org disallows paid leave during probation, mark only the leave dates
  // that fall ON OR BEFORE probation_end_date as unpaid. Leaves taken after
  // probation ends keep their original paid status — fixing the mid-month case:
  // e.g. probation ends Aug 10, leave on Aug 15 → still paid (no LOP).
  const emp = data.employee;
  if (
    settings.probation_enabled &&
    settings.paid_leave_during_probation === false &&
    emp.probation_end_date &&
    emp.probation_end_date >= data.start   // probation overlaps this pay period
  ) {
    for (const [ds, lv] of leaveDateMap) {
      if (ds <= emp.probation_end_date) {          // only dates within probation window
        leaveDateMap.set(ds, { ...lv, paid: false });
      }
    }
  }

  const dateMap = buildDateMap(y, m, settings.weekend_policy, holidaySet);

  // ── Per-employee shift map (built BEFORE workingDays so denominator can use it) ──
  // Value: { workDays: Set<dow>|null, durationH: number }
  // workDays null = no restriction. durationH used for short-shift half_day reclassification.
  const shiftDateMap = new Map();
  for (const row of (data.shiftAssignments ?? [])) {
    const workDays  = parseShiftWorkDays(row.days_of_week);
    let   durationH = 0;
    const sm = toMins(row.start_time);
    const em = toMins(row.end_time);
    if (sm !== null && em !== null && em > sm) {
      durationH = round2((em - sm) / 60);
    }
    shiftDateMap.set(row.date, {
      workDays,
      durationH,
      // Shift-specific attendance rules (null = use org-level fallback in calculateAttendance)
      lateThresholdMins:  row.late_threshold        ? toMins(row.late_threshold)              : null,
      halfDayH:           row.half_day_hours        != null ? Number(row.half_day_hours)        : null,
      fullDayH:           row.full_day_hours        != null ? Number(row.full_day_hours)        : null,
      maxEarlyLeave:      row.max_early_leave_count != null ? Number(row.max_early_leave_count) : null,
    });
  }

  // ── Working days (LOP day count denominator) ──────────────────────────────
  // For employees with shift-based weekoffs (e.g. a Saturday date assigned the
  // Weekday Shift which only covers DOW 1–5), that Saturday is excluded from the
  // working days count so LOP days are consistent with their actual schedule.
  // Fixed-rule orgs are unaffected.
  const workingDays = settings.working_days_rule === 'fixed'
    ? Math.max(1, Number(settings.fixed_working_days))
    : Math.max(1, dateMap.reduce((n, d) => {
        if (d.isWeekend) return n;
        if (shiftDateMap.has(d.dateStr)) {
          const si = shiftDateMap.get(d.dateStr);
          if (si.workDays !== null && !si.workDays.has(d.dow)) return n;
        }
        return n + 1;
      }, 0));

  // ── Per-day salary rate ───────────────────────────────────────────────────
  // 'calendar_days': gross ÷ total calendar days in the month (e.g. Aug = ÷31).
  //   LOP day COUNT still uses workingDays above; only the per-day RATE differs.
  //   Used by orgs that follow the Indian calendar-month LOP method.
  // 'working_days' (default): gross ÷ actual non-weekend working days.
  const perDayDivisor = settings.per_day_salary_basis === 'calendar_days'
    ? daysInMonth(y, m)
    : workingDays;

  const perDaySalary = round2(calculateGross(data.salary) / perDayDivisor);

  // Org-level half_day_hours — used as fallback when shift has no shift-specific config
  const orgHalfDayHours = Number(data.schedule?.half_day_hours ?? 4.5);

  // ── Attendance ────────────────────────────────────────────────────────────
  const att = calculateAttendance({
    dateMap,
    attendanceMap,
    regularizedSet,
    leaveDateMap,
    countHolidaysAsPaid:  settings.count_holidays_as_paid,
    scheduleCheckIn:      data.schedule?.check_in ?? null,  // org-level late threshold fallback
    graceMins:            settings.grace_minutes,
    maxEarlyLeaveCount:   Number(data.schedule?.max_early_leave_count ?? 3),  // org-level fallback
    shiftDateMap,         // carries per-day shift-specific rules when configured
    orgHalfDayHours,      // org-level fallback for half-day reclassification
  });

  // ── LOP ───────────────────────────────────────────────────────────────────
  const lop = calculateLOP(att, settings, workingDays);

  // ── Gross ─────────────────────────────────────────────────────────────────
  const grossSalary = calculateGross(data.salary);

  // ── Deductions ────────────────────────────────────────────────────────────
  const calendarDays = daysInMonth(y, m);
  const deductions = calculateDeductions(
    data.salary, settings, lop.totalLOP, perDaySalary,
    grossSalary, calendarDays, data.pfConfig, data.esiConfig
  );

  // ── Employer ──────────────────────────────────────────────────────────────
  const employerContribution = calculateEmployerContribution(data.salary, settings);

  // ── Net ───────────────────────────────────────────────────────────────────
  const netSalary = round2(Math.max(0, grossSalary - deductions.total));

  // ── Earnings breakdown ────────────────────────────────────────────────────
  const sal = data.salary;
  const earningsBreakdown = [
    { label: 'Basic',                amount: round2(sal.basic) },
    { label: 'HRA',                  amount: round2(sal.hra) },
    { label: 'Dearness Allowance',   amount: round2(sal.da) },
    { label: 'Transport Allowance',  amount: round2(sal.transport_allowance) },
    { label: 'Medical Allowance',    amount: round2(sal.medical_allowance) },
    { label: 'Special Allowance',    amount: round2(sal.special_allowance) },
    { label: 'Other Allowance',      amount: round2(sal.other_allowance) },
  ].filter(e => e.amount > 0);

  const deductionBreakdown = [
    { label: 'PF (Employee)',              amount: deductions.pf },
    { label: 'ESI (Employee)',             amount: deductions.esi },
    { label: 'Professional Tax',           amount: deductions.professionalTax },
    { label: 'TDS',                        amount: deductions.tds },
    { label: 'Retention',                  amount: deductions.retention },
    { label: 'Other Deductions',           amount: deductions.otherDeductions },
    { label: `LOP (${lop.totalLOP} days)`, amount: deductions.lopDeduction },
  ].filter(e => e.amount > 0);

  const employerBreakdown = [
    { label: 'PF (Employer)',  amount: employerContribution.pf },
    { label: 'ESI (Employer)', amount: employerContribution.esi },
  ].filter(e => e.amount > 0);

  // ── Return structured result ──────────────────────────────────────────────
  return {
    organizationId: oId,
    userId:         uId,
    month:          m,
    year:           y,
    payPeriod:      `${padZ(m)}/${y}`,

    employee: {
      id:         data.employee.id,
      name:       data.employee.name,
      email:      data.employee.email,
      department: data.employee.department,
      position:   data.employee.position,
      employeeId: data.employee.employee_id,
    },

    salaryStructure: {
      id:                 sal.id,
      effectiveFrom:      sal.effective_from,
      basic:              round2(sal.basic),
      hra:                round2(sal.hra),
      da:                 round2(sal.da),
      transportAllowance: round2(sal.transport_allowance),
      medicalAllowance:   round2(sal.medical_allowance),
      specialAllowance:   round2(sal.special_allowance),
      otherAllowance:     round2(sal.other_allowance),
      employeePf:         round2(sal.employee_pf),
      employeeEsi:        round2(sal.employee_esi),
      professionalTax:    round2(sal.professional_tax),
      tds:                round2(sal.tds),
      retention:          round2(sal.retention),
      otherDeductions:    round2(sal.other_deductions),
      employerPf:         round2(sal.employer_pf),
      employerEsi:        round2(sal.employer_esi),
      ctc:                round2(sal.ctc),
      pfCalcMode:         sal.pf_calc_mode  || 'fixed',
      esiCalcMode:        sal.esi_calc_mode || 'fixed',
    },

    payrollSettings: {
      workingDaysRule:        settings.working_days_rule,
      fixedWorkingDays:       settings.fixed_working_days,
      weekendPolicy:          settings.weekend_policy,
      countHolidaysAsPaid:    settings.count_holidays_as_paid,
      graceMins:              settings.grace_minutes,
      lateAllowancePerMonth:  settings.late_allowance_per_month,
      halfDayAfterLates:      settings.half_day_after_lates,
      lopAfterHalfDays:       settings.lop_after_half_days,
      pfEnabled:              settings.pf_enabled,
      esiEnabled:             settings.esi_enabled,
      professionalTaxEnabled: settings.professional_tax_enabled,
      tdsEnabled:             settings.tds_enabled,
    },

    workingDays,
    perDayDivisor,
    perDaySalaryBasis: settings.per_day_salary_basis || 'working_days',
    perDaySalary,
    payableDays: lop.payableDays,

    attendance: {
      totalDays:     daysInMonth(y, m),
      presentFull:   att.presentFull,
      presentHalf:   att.presentHalf,
      paidLeave:     att.paidLeave,
      paidHalfLeave: att.paidHalfLeave,
      unpaidLeave:   att.unpaidLeave,
      absent:        att.absent,
      weekoff:       att.weekoff,
      holiday:       att.holiday,
      lateArrivals:  att.lateCount,
      regularized:   att.regularized,
      earlyLeave:    att.earlyLeave,
      earlyLeaveLop: att.earlyLeaveLop,
      daily:         att.daily,
    },

    lop: {
      payableDays:     lop.payableDays,
      baseLOP:         lop.baseLOP,
      excessLates:     lop.excessLates,
      lateHalfDays:    lop.lateHalfDays,
      lateHalfDayLOP:  lop.lateHalfDayLOP,
      total:           lop.totalLOP,
    },

    grossSalary,

    deductions: {
      pf:              deductions.pf,
      esi:             deductions.esi,
      professionalTax: deductions.professionalTax,
      tds:             deductions.tds,
      retention:       deductions.retention,
      otherDeductions: deductions.otherDeductions,
      lopDeduction:    deductions.lopDeduction,
      total:           deductions.total,
    },

    employerContribution: {
      pf:    employerContribution.pf,
      esi:   employerContribution.esi,
      total: employerContribution.total,
    },

    netSalary,

    breakdown: {
      earnings:   earningsBreakdown,
      deductions: deductionBreakdown,
      employer:   employerBreakdown,
    },
  };
}

module.exports = { calculatePayroll, PayrollError };
