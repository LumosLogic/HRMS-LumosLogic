'use strict';
/**
 * audit_relitrade_aug2026.js  —  READ-ONLY attendance audit
 *
 * Replicates payrollEngine.js calculateAttendance logic, queries the live DB,
 * and compares stored payslip attendance snapshots against recalculated values
 * for every Relitrade employee for August 2026.
 *
 * Run from project root:
 *   node audit_relitrade_aug2026.js
 *
 * No extra npm install needed — resolves pg from backend/node_modules and
 * loads .env with a built-in parser (no dotenv dependency).
 *
 * Makes ZERO writes to the database.
 */

const fs   = require('fs');
const path = require('path');

// ── Load .env without dotenv ──────────────────────────────────────────────────
// Reads .env from the project root using only built-in fs — no external deps.
(function loadEnv() {
  const envFile = path.join(__dirname, '../../.env');
  if (!fs.existsSync(envFile)) return;
  fs.readFileSync(envFile, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  });
})();

// ── Reuse the backend's pool ──────────────────────────────────────────────────
// require('../../backend/src/config/db') resolves 'pg' relative to backend/src/,
// so it finds backend/node_modules/pg automatically — no install needed.
const { pool } = require('../../backend/src/config/db');

// Preserve DATE columns as 'YYYY-MM-DD' strings (same as db-pg-adapter)
types.setTypeParser(1082, v => v);

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'lumos_hrms',
  user:     process.env.DB_USER     || 'lumos_admin',
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 8000,
});

const YEAR  = 2026;
const MONTH = 8;        // August
const ORG_ID = 1;       // Relitrade

// ─── Date helpers ─────────────────────────────────────────────────────────────
function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
function padZ(n)            { return String(n).padStart(2, '0'); }
function toDateStr(y, m, d) { return `${y}-${padZ(m)}-${padZ(d)}`; }

// ─── Weekend detection (mirrors payrollEngine.js) ────────────────────────────
function isWeekendDay(dow, policy, satSeq) {
  switch (policy) {
    case 'sat_sun':      return dow === 0 || dow === 6;
    case 'sun_only':     return dow === 0;
    case 'none':         return false;
    case 'alternate_sat':
      if (dow === 0) return true;
      if (dow !== 6) return false;
      return satSeq % 2 === 0;   // 2nd, 4th Saturday
    default:             return dow === 0 || dow === 6;
  }
}

// ─── Build date-classification map (mirrors payrollEngine.js) ─────────────────
function buildDateMap(y, m, policy, holidaySet) {
  const total  = daysInMonth(y, m);
  const result = [];
  let satSeq   = 0;
  for (let d = 1; d <= total; d++) {
    const ds  = toDateStr(y, m, d);
    const dow = new Date(y, m - 1, d).getDay();
    if (dow === 6) satSeq++;
    const isWe  = isWeekendDay(dow, policy, satSeq);
    const isHol = !isWe && holidaySet.has(ds);
    result.push({ dateStr: ds, dow, isWeekend: isWe, isHoliday: isHol, isWorkingDay: !isWe && !isHol });
  }
  return result;
}

// ─── Build leave date map (mirrors payrollEngine.js) ─────────────────────────
function buildLeaveDateMap(leaveRows, y, m) {
  const map    = new Map();
  const mStart = toDateStr(y, m, 1);
  const mEnd   = toDateStr(y, m, daysInMonth(y, m));
  for (const lv of leaveRows) {
    const s   = lv.start_date < mStart ? mStart : lv.start_date;
    const e   = lv.end_date   > mEnd   ? mEnd   : lv.end_date;
    const cur = new Date(s + 'T12:00:00Z');
    const end = new Date(e + 'T12:00:00Z');
    while (cur <= end) {
      const ds = cur.toISOString().split('T')[0];
      if (!map.has(ds)) {
        map.set(ds, {
          paid:       lv.paid !== false,
          leave_time: lv.leave_time || 'full',
          leave_type: lv.leave_type,
        });
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return map;
}

// ─── Parse shift work days ────────────────────────────────────────────────────
function parseShiftWorkDays(days_of_week) {
  if (!days_of_week) return null;
  if (Array.isArray(days_of_week)) return new Set(days_of_week.map(Number));
  try {
    const p = JSON.parse(days_of_week);
    if (Array.isArray(p)) return new Set(p.map(Number));
  } catch {}
  return new Set(String(days_of_week).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n)));
}

// ─── calculateAttendance (mirrors payrollEngine.js) ──────────────────────────
function calculateAttendance({
  dateMap, attendanceMap, regularizedSet, leaveDateMap,
  countHolidaysAsPaid, shiftDateMap, orgHalfDayHours = 4.5,
}) {
  let presentFull = 0, presentHalf = 0, paidLeave = 0, paidHalfLeave = 0;
  let unpaidLeave = 0, absent = 0, weekoff = 0, holiday = 0;
  let lateCount = 0, regularized = 0, earlyLeave = 0, earlyLeaveLop = 0;
  let earlyLeaveCount = 0;   // running count for allowance
  const daily = [];

  for (const { dateStr: ds, isWeekend: isWe, isHoliday: isHol, dow } of dateMap) {
    let effectiveIsWeekend = isWe;
    let shiftDurationH = 0, shiftHalfDayH = null, shiftMaxEarlyLeave = null;

    if (shiftDateMap && shiftDateMap.has(ds)) {
      const si = shiftDateMap.get(ds);
      if (si.workDays !== null) effectiveIsWeekend = !si.workDays.has(dow);
      shiftDurationH    = si.durationH      || 0;
      shiftHalfDayH     = si.halfDayH       ?? null;
      shiftMaxEarlyLeave = si.maxEarlyLeave ?? null;
    }

    const dayHalfDayH     = shiftHalfDayH     ?? orgHalfDayHours;
    const dayMaxEarlyLeave = shiftMaxEarlyLeave ?? 3;

    if (effectiveIsWeekend) {
      weekoff++;
      daily.push({ date: ds, type: 'weekoff' });
      continue;
    }

    if (isHol) {
      if (countHolidaysAsPaid) { holiday++; daily.push({ date: ds, type: 'paid_holiday' }); }
      else                       daily.push({ date: ds, type: 'unpaid_holiday' });
      continue;
    }

    const att   = attendanceMap.get(ds);
    const leave = leaveDateMap.get(ds);
    let status  = att?.status ?? null;

    if (regularizedSet.has(ds) && (!status || status === 'absent')) {
      status = 'present'; regularized++;
    }

    if (status === 'on_leave' || ((!status || status === 'absent') && leave)) {
      const lv    = leave ?? { paid: true, leave_time: 'full' };
      const ltime = lv.leave_time || 'full';
      if (ltime === 'wfh') {
        presentFull++; daily.push({ date: ds, type: 'wfh_leave' });
      } else if (ltime === 'half') {
        if (lv.paid !== false) { paidHalfLeave++; daily.push({ date: ds, type: 'paid_half_leave' }); }
        else                    { presentHalf++;    daily.push({ date: ds, type: 'unpaid_half_leave' }); }
      } else {
        if (lv.paid !== false) { paidLeave++;   daily.push({ date: ds, type: 'paid_leave' }); }
        else                    { unpaidLeave++; daily.push({ date: ds, type: 'unpaid_leave' }); }
      }
      continue;
    }

    if (status === 'present') {
      presentFull++; daily.push({ date: ds, type: 'present' }); continue;
    }
    if (status === 'wfh' || status === 'work_from_home') {
      presentFull++; daily.push({ date: ds, type: 'wfh' }); continue;
    }
    if (status === 'half_day') {
      const workedH = Number(att?.work_hours ?? 0);
      const thresh  = shiftHalfDayH !== null ? shiftHalfDayH
        : (shiftDurationH > 0 ? shiftDurationH * 0.5 : dayHalfDayH);
      if (shiftDurationH > 0 && workedH >= thresh) {
        presentFull++; daily.push({ date: ds, type: 'present' });
      } else {
        presentHalf++; daily.push({ date: ds, type: 'half_day' });
      }
      continue;
    }
    if (status === 'early_leave') {
      if (earlyLeaveCount < dayMaxEarlyLeave) {
        presentFull++; earlyLeave++; earlyLeaveCount++;
        daily.push({ date: ds, type: 'early_leave' });
      } else {
        absent++; earlyLeaveLop++;
        daily.push({ date: ds, type: 'early_leave_lop' });
      }
      continue;
    }

    absent++;
    daily.push({ date: ds, type: status === 'absent' ? 'absent' : 'no_record' });
  }

  return { presentFull, presentHalf, paidLeave, paidHalfLeave, unpaidLeave,
           absent, weekoff, holiday, lateCount, regularized, earlyLeave, earlyLeaveLop, daily };
}

// ─── Numeric formatting ───────────────────────────────────────────────────────
function n2(v) { return Number(v || 0).toFixed(2); }
function diff(a, b) { return Math.abs(a - b) < 0.01 ? '' : `❌ DIFF(${a-b > 0 ? '+' : ''}${(a-b).toFixed(2)})`; }

// ─── Pad string to fixed width ────────────────────────────────────────────────
function pad(s, w) { const str = String(s ?? ''); return str.length >= w ? str.slice(0, w) : str + ' '.repeat(w - str.length); }

// ─── Main audit ───────────────────────────────────────────────────────────────
async function main() {
  const start = toDateStr(YEAR, MONTH, 1);
  const end   = toDateStr(YEAR, MONTH, daysInMonth(YEAR, MONTH));

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`  RELITRADE AUGUST 2026 — Payslip Attendance Audit (READ-ONLY)`);
  console.log(`  Period: ${start} → ${end}   |   Calendar days: ${daysInMonth(YEAR, MONTH)}`);
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 1. Payroll settings
  const { rows: [settings] } = await pool.query(
    `SELECT working_days_rule, fixed_working_days, weekend_policy,
            count_holidays_as_paid, grace_minutes, per_day_salary_basis
       FROM payroll_settings WHERE organization_id = $1`, [ORG_ID]
  );
  if (!settings) { console.error('No payroll settings found for org', ORG_ID); process.exit(1); }
  const policy            = settings.weekend_policy          || 'sat_sun';
  const countHolAsPaid    = settings.count_holidays_as_paid  !== false;
  const workingDaysRule   = settings.working_days_rule       || 'calendar';
  const fixedWorkingDays  = Number(settings.fixed_working_days) || 26;

  console.log(`\nPayroll Settings: weekend_policy=${policy}  count_holidays_as_paid=${countHolAsPaid}  working_days_rule=${workingDaysRule}`);

  // 2. Org holidays in August 2026
  const { rows: holidays } = await pool.query(
    `SELECT date::text, name FROM holidays
      WHERE organization_id = $1 AND date >= $2 AND date <= $3
      ORDER BY date`, [ORG_ID, start, end]
  );
  const holidaySet = new Set(holidays.map(h => h.date));
  console.log(`\nHolidays in August 2026: ${holidays.length > 0 ? holidays.map(h => `${h.date} (${h.name})`).join(', ') : 'None'}`);

  // 3. Build date classification map (org-level, before per-employee shift overrides)
  const baseDateMap = buildDateMap(YEAR, MONTH, policy, holidaySet);
  const baseWorkingDays = workingDaysRule === 'fixed' ? fixedWorkingDays
    : baseDateMap.filter(d => !d.isWeekend).length;
  const baseWeekoffs    = baseDateMap.filter(d => d.isWeekend).length;
  console.log(`Base working days (non-weekend): ${baseWorkingDays}   Weekends: ${baseWeekoffs}   Total: ${baseWorkingDays + baseWeekoffs}`);

  // 4. Fetch all Relitrade employees (active, with payslip for Aug 2026)
  const { rows: employees } = await pool.query(
    `SELECT u.id, u.name, u.employee_id, u.department, u.position
       FROM users u
       JOIN payslips ps ON ps.user_id = u.id AND ps.month = $2 AND ps.year = $3
                       AND ps.organization_id = $1
      WHERE u.organization_id = $1
        AND u.role = 'employee'
      ORDER BY u.employee_id::integer NULLS LAST, u.name`,
    [ORG_ID, padZ(MONTH), YEAR]
  );
  console.log(`\nEmployees with Aug-2026 payslip: ${employees.length}`);

  // 5. Fetch work schedule (org-level half_day_hours)
  let orgHalfDayHours = 4.5;
  try {
    const { rows: [ws] } = await pool.query(
      `SELECT COALESCE(half_day_hours, 4.5) AS half_day_hours
         FROM work_schedule WHERE organization_id = $1 LIMIT 1`, [ORG_ID]
    );
    if (ws) orgHalfDayHours = Number(ws.half_day_hours) || 4.5;
  } catch {}

  const issues = [];
  const rows   = [];

  // ─── Per-employee audit ────────────────────────────────────────────────────
  for (const emp of employees) {

    // a. Payslip stored values
    const { rows: [ps] } = await pool.query(
      `SELECT id, working_days, present_days, absent_days, leave_days, lop_days, lop_amount,
              professional_tax, retention, attendance_snapshot, status
         FROM payslips
        WHERE user_id = $1 AND month = $2 AND year = $3 AND organization_id = $4`,
      [emp.id, padZ(MONTH), YEAR, ORG_ID]
    );
    if (!ps) { rows.push({ emp, error: 'NO_PAYSLIP' }); continue; }

    let snap = {};
    try { snap = typeof ps.attendance_snapshot === 'string'
        ? JSON.parse(ps.attendance_snapshot)
        : (ps.attendance_snapshot || {}); } catch {}

    // b. Raw attendance records
    const { rows: attRows } = await pool.query(
      `SELECT date::text, status, COALESCE(work_hours, 0) AS work_hours,
              check_in, check_out
         FROM attendance
        WHERE user_id = $1 AND organization_id = $2 AND date >= $3 AND date <= $4
        ORDER BY date`,
      [emp.id, ORG_ID, start, end]
    );
    const attendanceMap = new Map(attRows.map(a => [a.date, a]));

    // c. Approved leaves
    const { rows: leaveRows } = await pool.query(
      `SELECT l.start_date::text, l.end_date::text, l.leave_type, l.leave_time,
              COALESCE(lp.paid, true) AS paid
         FROM leaves l
         LEFT JOIN leave_policies lp ON lp.leave_type = l.leave_type
                                    AND lp.organization_id = l.organization_id
        WHERE l.user_id = $1 AND l.organization_id = $2
          AND l.status = 'approved'
          AND l.start_date <= $3 AND l.end_date >= $4
        ORDER BY l.start_date`,
      [emp.id, ORG_ID, end, start]
    );
    const leaveDateMap = buildLeaveDateMap(leaveRows, YEAR, MONTH);

    // d. Approved regularisations
    let regularizedSet = new Set();
    try {
      const { rows: regRows } = await pool.query(
        `SELECT date::text FROM attendance_regularization
          WHERE user_id = $1 AND organization_id = $2
            AND date >= $3 AND date <= $4 AND status = 'approved'`,
        [emp.id, ORG_ID, start, end]
      );
      regularizedSet = new Set(regRows.map(r => r.date));
    } catch {}

    // e. Shift assignments
    const shiftDateMap = new Map();
    try {
      const { rows: shiftRows } = await pool.query(
        `SELECT sa.date::text, s.days_of_week, s.start_time, s.end_time,
                s.late_threshold, s.half_day_hours, s.full_day_hours, s.max_early_leave_count
           FROM shift_assignments sa
           JOIN shifts s ON s.id = sa.shift_id
          WHERE sa.user_id = $1 AND sa.organization_id = $2
            AND sa.date >= $3 AND sa.date <= $4`,
        [emp.id, ORG_ID, start, end]
      );
      for (const row of shiftRows) {
        const workDays = parseShiftWorkDays(row.days_of_week);
        let durationH = 0;
        const sm = row.start_time ? parseInt(row.start_time.split(':')[0]) * 60 + parseInt(row.start_time.split(':')[1]) : null;
        const em = row.end_time   ? parseInt(row.end_time.split(':')[0])   * 60 + parseInt(row.end_time.split(':')[1])   : null;
        if (sm !== null && em !== null && em > sm) durationH = (em - sm) / 60;
        shiftDateMap.set(row.date, {
          workDays,
          durationH,
          halfDayH:       row.half_day_hours        != null ? Number(row.half_day_hours)        : null,
          maxEarlyLeave:  row.max_early_leave_count  != null ? Number(row.max_early_leave_count) : null,
        });
      }
    } catch {}

    // f. Recalculate working days with shift overrides
    const empDateMap = buildDateMap(YEAR, MONTH, policy, holidaySet);
    const empWorkingDays = workingDaysRule === 'fixed' ? fixedWorkingDays
      : empDateMap.reduce((n, d) => {
          if (d.isWeekend) return n;
          if (shiftDateMap.has(d.dateStr)) {
            const si = shiftDateMap.get(d.dateStr);
            if (si.workDays !== null && !si.workDays.has(d.dow)) return n;
          }
          return n + 1;
        }, 0);

    // g. Run calculateAttendance
    const calc = calculateAttendance({
      dateMap: empDateMap, attendanceMap, regularizedSet, leaveDateMap,
      countHolidaysAsPaid: countHolAsPaid, shiftDateMap, orgHalfDayHours,
    });

    // h. Calculate expected values
    const expPOD        = calc.presentFull + calc.presentHalf * 0.5;
    const expWoff       = calc.weekoff;
    const expHL         = calc.holiday;
    const expCL         = calc.paidLeave;          // all paid full leaves stored as CL in snapshot
    const expLWP        = Math.max(0, empWorkingDays - expPOD - expHL - expCL);
    const expTotalCal   = empWorkingDays + expWoff; // FIXED formula (no + paidHoliday)

    // h2. Also compute old (buggy) totalCalDays to show the before/after
    const oldTotalCal   = Number(ps.working_days) + (snap.weekoff || 0) + (snap.holiday || 0);

    // Stored snapshot values
    const storedPOD     = (snap.presentFull || 0) + (snap.presentHalf || 0) * 0.5;
    const storedWoff    = snap.weekoff    || 0;
    const storedHL      = snap.holiday    || 0;
    const storedCL      = snap.paidLeave  || 0;
    const storedLWP     = Number(ps.lop_days) || 0;
    const storedTotalCal= Number(ps.working_days) + storedWoff;  // FIXED formula

    // i. Compare
    const podDiff  = Math.abs(storedPOD  - expPOD)  > 0.01;
    const woffDiff = Math.abs(storedWoff - expWoff)  > 0.01;
    const hlDiff   = Math.abs(storedHL   - expHL)    > 0.01;
    const clDiff   = Math.abs(storedCL   - expCL)    > 0.01;
    const lwpDiff  = Math.abs(storedLWP  - expLWP)   > 0.01;
    const hasIssue = podDiff || woffDiff || hlDiff || clDiff || lwpDiff;

    // Attend count from raw
    const attByStatus = {};
    for (const a of attRows) { attByStatus[a.status] = (attByStatus[a.status] || 0) + 1; }

    // Leave summary from approved leaves
    const leaveByType = {};
    for (const [, lv] of leaveDateMap) {
      const k = lv.leave_type || 'unknown';
      leaveByType[k] = (leaveByType[k] || 0) + (lv.leave_time === 'half' ? 0.5 : 1);
    }

    rows.push({
      emp, ps, snap, calc,
      expPOD, expWoff, expHL, expCL, expLWP, expTotalCal, oldTotalCal,
      storedPOD, storedWoff, storedHL, storedCL, storedLWP, storedTotalCal,
      empWorkingDays,
      hasIssue, podDiff, woffDiff, hlDiff, clDiff, lwpDiff,
      attRows, attByStatus, leaveByType, leaveRows, regularizedSet,
    });

    if (hasIssue) issues.push(emp.name);
  }

  // ─── Print summary table ────────────────────────────────────────────────────
  console.log('\n');
  console.log('┌' + '─'.repeat(143) + '┐');
  console.log(
    '│ ' +
    pad('Employee', 22) +
    pad('EmpID', 7) +
    pad('CalDays', 8) +
    pad('P+OD sto', 9) +
    pad('P+OD exp', 9) +
    pad('WOff sto', 9) +
    pad('WOff exp', 9) +
    pad('HL sto', 7) +
    pad('HL exp', 7) +
    pad('CL sto', 7) +
    pad('CL exp', 7) +
    pad('LWP sto', 8) +
    pad('LWP exp', 8) +
    pad('WkDays', 7) +
    pad('Status', 10) +
    ' │'
  );
  console.log('├' + '─'.repeat(143) + '┤');

  for (const r of rows) {
    if (r.error) {
      console.log('│ ' + pad(r.emp.name, 22) + pad(r.emp.employee_id || '-', 7) + pad('NO PAYSLIP', 110) + ' │');
      continue;
    }
    const status = r.hasIssue ? '❌ MISMATCH' : '✅ OK';
    console.log(
      '│ ' +
      pad(r.emp.name, 22) +
      pad(r.emp.employee_id || '-', 7) +
      pad(r.storedTotalCal, 8) +
      pad(n2(r.storedPOD), 9) +
      pad(n2(r.expPOD), 9) +
      pad(n2(r.storedWoff), 9) +
      pad(n2(r.expWoff), 9) +
      pad(n2(r.storedHL), 7) +
      pad(n2(r.expHL), 7) +
      pad(n2(r.storedCL), 7) +
      pad(n2(r.expCL), 7) +
      pad(n2(r.storedLWP), 8) +
      pad(n2(r.expLWP), 8) +
      pad(r.empWorkingDays, 7) +
      pad(status, 12) +
      ' │'
    );
  }
  console.log('└' + '─'.repeat(143) + '┘');

  // ─── Per-employee detail for mismatches ────────────────────────────────────
  const mismatchRows = rows.filter(r => r.hasIssue && !r.error);
  if (mismatchRows.length === 0) {
    console.log('\n✅  All payslip attendance snapshots match the recalculated values.\n');
  } else {
    console.log(`\n⚠️  ${mismatchRows.length} employee(s) with mismatches: ${issues.join(', ')}\n`);

    for (const r of mismatchRows) {
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  DETAIL: ${r.emp.name} (ID: ${r.emp.employee_id || r.emp.id})`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      console.log(`\n  Payslip status  : ${r.ps.status}`);
      console.log(`  working_days col: ${r.ps.working_days}   weekoff stored: ${r.storedWoff}`);
      console.log(`  Calendar days   : stored=${r.storedTotalCal}  expected=${r.expTotalCal}  (old buggy formula=${r.oldTotalCal})`);

      console.log('\n  ┌──────────────┬───────────┬───────────┬──────────┐');
      console.log(  '  │ Field        │ Stored    │ Expected  │ Delta    │');
      console.log(  '  ├──────────────┼───────────┼───────────┼──────────┤');
      [
        ['P+OD',     r.storedPOD,  r.expPOD],
        ['W/Off',    r.storedWoff, r.expWoff],
        ['HL',       r.storedHL,   r.expHL],
        ['CL',       r.storedCL,   r.expCL],
        ['LWP/LOP',  r.storedLWP,  r.expLWP],
      ].forEach(([label, stored, exp]) => {
        const delta = (Number(stored) - Number(exp)).toFixed(2);
        const flag  = Math.abs(Number(delta)) > 0.01 ? ' ❌' : '   ';
        console.log(`  │ ${pad(label, 12)} │ ${pad(n2(stored), 9)} │ ${pad(n2(exp), 9)} │ ${pad(delta, 8)}${flag}│`);
      });
      console.log('  └──────────────┴───────────┴───────────┴──────────┘');

      // Attendance records summary
      console.log('\n  Raw attendance records (from attendance table):');
      if (Object.keys(r.attByStatus).length === 0) {
        console.log('    (no records found — all dates are no_record)');
      } else {
        for (const [status, count] of Object.entries(r.attByStatus)) {
          console.log(`    ${pad(status, 20)}: ${count} days`);
        }
      }
      console.log(`    Total att records: ${r.attRows.length} / 31 days`);

      // Approved leaves
      console.log('\n  Approved leaves overlapping August 2026:');
      if (r.leaveRows.length === 0) {
        console.log('    (none)');
      } else {
        for (const lv of r.leaveRows) {
          console.log(`    ${lv.start_date} → ${lv.end_date}  type=${lv.leave_type}  time=${lv.leave_time || 'full'}  paid=${lv.paid}`);
        }
      }

      // Regularisations
      if (r.regularizedSet.size > 0) {
        console.log(`\n  Approved regularisations: ${[...r.regularizedSet].join(', ')}`);
      }

      // Daily breakdown (only days with non-standard classification)
      console.log('\n  Daily breakdown (recalculated):');
      const notable = r.calc.daily.filter(d =>
        !['present','weekoff','paid_holiday'].includes(d.type)
      );
      if (notable.length === 0) {
        console.log('    (all days: present / weekoff / paid_holiday — nothing notable)');
      } else {
        for (const d of notable) {
          const att = r.attRows.find(a => a.date === d.date);
          const lv  = r.leaveRows.find(l => l.start_date <= d.date && l.end_date >= d.date);
          const attStr  = att ? `att=${att.status}` : 'no_att_record';
          const leaveStr = lv  ? ` leave=${lv.leave_type}/${lv.leave_time||'full'}` : '';
          console.log(`    ${d.date}  → ${pad(d.type, 18)}  ${attStr}${leaveStr}`);
        }
      }
    }
  }

  // ─── Overall statistics ────────────────────────────────────────────────────
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('  RECONCILIATION CHECK (totals across all employees)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  const validRows = rows.filter(r => !r.error);

  // Print per-employee reconciliation (all 31 days must be accounted for)
  console.log('\n  Each employee\'s 31 days should equal: P+OD + W/Off + HL + CL + LWP + other\n');
  console.log('  ' + pad('Employee', 24) + pad('P+OD', 7) + pad('WOff', 7) + pad('HL', 5) + pad('CL', 5) +
              pad('LWP', 5) + pad('Absent', 7) + pad('UnpaidL', 8) + pad('Sum', 5) + pad('≠31?', 6));
  console.log('  ' + '─'.repeat(81));

  for (const r of validRows) {
    const c = r.calc;
    const sum = c.presentFull + c.presentHalf * 0.5 + c.weekoff + c.holiday +
                c.paidLeave + c.paidHalfLeave * 0.5 + c.unpaidLeave + c.absent;
    const flag = Math.abs(sum - 31) > 0.01 ? ' ❌' : '';
    console.log(
      '  ' +
      pad(r.emp.name, 24) +
      pad(n2(c.presentFull + c.presentHalf * 0.5), 7) +
      pad(n2(c.weekoff), 7) +
      pad(n2(c.holiday), 5) +
      pad(n2(c.paidLeave + c.paidHalfLeave * 0.5), 5) +
      pad(n2(c.unpaidLeave), 8) +
      pad(c.absent, 7) +
      pad('—', 8) +
      pad(n2(sum), 5) +
      flag
    );
  }

  console.log('\n');
  console.log(`  Total employees audited : ${validRows.length}`);
  console.log(`  Employees with mismatches: ${mismatchRows.length}`);
  console.log(`  All days reconcile to 31: ${validRows.every(r => {
    const c = r.calc;
    const s = c.presentFull + c.presentHalf * 0.5 + c.weekoff + c.holiday +
              c.paidLeave + c.paidHalfLeave * 0.5 + c.unpaidLeave + c.absent;
    return Math.abs(s - 31) < 0.01;
  }) ? 'YES ✅' : 'NO ❌ — see rows above'}`);
  console.log('');

  await pool.end();
}

main().catch(err => {
  console.error('Audit failed:', err.message);
  pool.end();
  process.exit(1);
});
