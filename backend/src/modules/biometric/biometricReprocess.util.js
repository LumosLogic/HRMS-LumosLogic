const { pool } = require('../../config/db-pg-adapter');
const { getOrgPolicy } = require('../../utils/orgPolicy');
const { getEffectiveWorkSchedule } = require('../../utils/helpers');

/**
 * Compute and upsert one day's attendance using first-in / last-out logic.
 * dayLogs      – ALL punch records for this employee+date (processed or not).
 * existingAtt  – current attendance row from DB, or null.
 * halfDayHours – threshold below which work_hours is considered a half-day (default 4.5).
 * shiftEndTime – HH:MM or HH:MM:SS when the working day ends (default '17:30').
 *
 * Semantics:
 *   check_in            = first punch of day (regardless of punch_type)
 *   check_out           = last punch of day  (regardless of punch_type)
 *   total_break_minutes = sum of consecutive out(1)→in(0) gaps (non-working time)
 *   gross_hours         = check_out − check_in
 *   work_hours          = gross_hours − gap_hours
 *
 * Status finalisation rule:
 *   Past date             → always finalise (day is definitively over)
 *   Today before shiftEnd → keep 'present' (employee may still punch; don't show Half Day prematurely)
 *   Today after  shiftEnd → finalise: work_hours ≥ halfDayHours → 'present', else 'half_day'
 */
async function applyFILODay(userId, date, orgId, dayLogs, existingAtt, halfDayHours = 4.5, shiftEndTime = '17:30', fullDayHours = 8) {
  if (!dayLogs.length) return;

  // Look up shift-specific thresholds for this employee on this date.
  // Overrides the org-level values passed as arguments when a shift has its own config.
  const lookupDate = typeof date === 'string' ? date.slice(0, 10)
                   : new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  // Layer 1: branch-specific work schedule override (BUG-115).
  // Applied before shift overrides so the priority chain is:
  //   org default → branch override → shift override (highest)
  try {
    const userRes = await pool.query(
      `SELECT branch_id FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [userId, orgId]
    );
    const branchId = userRes.rows[0]?.branch_id ?? null;
    if (branchId) {
      const branchSched = await getEffectiveWorkSchedule(orgId, branchId);
      if (branchSched && branchSched !== null) {
        // Unconditionally override org defaults with branch values.
        // Shift-specific values (Layer 2 below) will then override these.
        if (branchSched.end_time)               shiftEndTime  = branchSched.end_time;
        if (branchSched.half_day_hours != null)  halfDayHours  = parseFloat(branchSched.half_day_hours);
        if (branchSched.full_day_hours != null)  fullDayHours  = parseFloat(branchSched.full_day_hours);
      }
    }
  } catch { /* branch lookup failed — use org defaults */ }

  // Layer 2: shift-specific overrides (existing logic — takes precedence over branch).
  try {
    const shiftRes = await pool.query(
      `SELECT s.end_time, s.half_day_hours, s.full_day_hours
         FROM shift_assignments sa
         JOIN shifts s ON s.id = sa.shift_id
        WHERE sa.user_id = $1 AND sa.organization_id = $2 AND sa.date = $3
        LIMIT 1`,
      [userId, orgId, lookupDate]
    );
    if (shiftRes.rows.length) {
      const sr = shiftRes.rows[0];
      if (sr.end_time)                shiftEndTime  = sr.end_time;
      if (sr.half_day_hours != null)  halfDayHours  = parseFloat(sr.half_day_hours);
      if (sr.full_day_hours != null)  fullDayHours  = parseFloat(sr.full_day_hours);
    }
  } catch { /* shifts table or columns absent — use branch/org defaults */ }

  const sorted = [...dayLogs].sort((a, b) =>
    new Date(a.punch_time) - new Date(b.punch_time)
  );

  const firstTime    = new Date(sorted[0].punch_time);
  const checkInStr   = firstTime.toTimeString().slice(0, 8);

  // Determine whether the working day is definitively over for this date.
  // TZ=Asia/Kolkata is set in the container.
  const todayIST     = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const dateStr      = typeof date === 'string' ? date.slice(0, 10)
                     : new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const nowTimeIST   = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
  const shiftEndHHMM = shiftEndTime.slice(0, 5);

  const dayFinished  = dateStr < todayIST
                    || (dateStr === todayIST && nowTimeIST >= shiftEndHHMM);

  // Is the employee currently IN the office?
  // True when: last punch is type=0 (IN) AND the day is not yet over.
  const lastPunchType = parseInt(sorted[sorted.length - 1].punch_type, 10);
  const currentlyIn   = !dayFinished && lastPunchType === 0;

  let checkOutStr, grossHours, workHours, gapMinutes;

  if (currentlyIn) {
    // Employee is still in office — do NOT set a check_out time.
    // Only count fully-completed IN→OUT segments for accumulated work hours.
    checkOutStr = null;
    gapMinutes  = 0;
    let completedMs = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (parseInt(sorted[i].punch_type,     10) === 0 &&
          parseInt(sorted[i + 1].punch_type, 10) === 1) {
        completedMs += new Date(sorted[i + 1].punch_time) - new Date(sorted[i].punch_time);
      }
    }
    // IN→OUT pairs already capture net work time (no separate break deduction needed)
    grossHours = parseFloat((completedMs / 3600000).toFixed(2));
    workHours  = grossHours;
  } else {
    // Day is over OR last punch is OUT — standard FILO: first in, last punch = check_out.
    const lastTime = new Date(sorted[sorted.length - 1].punch_time);
    checkOutStr    = sorted.length > 1 ? lastTime.toTimeString().slice(0, 8) : null;
    const grossMs  = checkOutStr ? lastTime - firstTime : 0;
    grossHours     = parseFloat((grossMs / 3600000).toFixed(2));

    // Non-working gaps: consecutive out(1) → in(0) pairs
    gapMinutes = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (parseInt(sorted[i].punch_type,     10) === 1 &&
          parseInt(sorted[i + 1].punch_type, 10) === 0) {
        gapMinutes += Math.round(
          (new Date(sorted[i + 1].punch_time) - new Date(sorted[i].punch_time)) / 60000
        );
      }
    }
    workHours = parseFloat(Math.max(0, grossHours - gapMinutes / 60).toFixed(2));
  }

  // Status is a finalised end-of-day verdict — never a mid-day label.
  // Before shift ends: always 'present' regardless of hours accumulated so far.
  const status = (checkOutStr && dayFinished)
    ? (workHours >= fullDayHours ? 'present'
      : workHours >= halfDayHours ? 'early_leave'
      : 'half_day')
    : 'present';

  if (existingAtt) {
    await pool.query(
      `UPDATE attendance
       SET check_in = $1, check_out = $2, gross_hours = $3, work_hours = $4,
           total_break_minutes = $5, status = $6, source = 'biometric'
       WHERE id = $7`,
      [checkInStr, checkOutStr, grossHours, workHours, gapMinutes, status, existingAtt.id]
    );
  } else {
    await pool.query(
      `INSERT INTO attendance
         (user_id, date, check_in, check_out, gross_hours, work_hours,
          total_break_minutes, status, source, organization_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'biometric', $9)
       ON CONFLICT (user_id, date, organization_id) DO UPDATE
         SET check_in            = EXCLUDED.check_in,
             check_out           = EXCLUDED.check_out,
             gross_hours         = EXCLUDED.gross_hours,
             work_hours          = EXCLUDED.work_hours,
             total_break_minutes = EXCLUDED.total_break_minutes,
             status              = EXCLUDED.status,
             source              = 'biometric'`,
      [userId, date, checkInStr, checkOutStr, grossHours, workHours, gapMinutes, status, orgId]
    );
  }
}

/**
 * Reprocess all unprocessed biometric_raw_logs for a given employee PIN.
 * Policy-aware: FILO logic for first_in_last_out orgs, original logic for standard.
 * Returns { processed, total, noMapping }
 */
async function reprocessPin(orgId, employeePin) {
  const [mapRes, policy] = await Promise.all([
    pool.query(
      `SELECT user_id FROM biometric_employee_map
       WHERE org_id = $1 AND employee_pin = $2 LIMIT 1`,
      [orgId, String(employeePin)]
    ),
    getOrgPolicy(orgId),
  ]);

  if (!mapRes.rows.length) return { processed: 0, total: 0, noMapping: true };
  const userId = mapRes.rows[0].user_id;

  // ── FILO mode ──────────────────────────────────────────────────────────────
  if (policy === 'first_in_last_out') {
    // Fetch thresholds from work_schedule for this org
    const wsRes = await pool.query(
      `SELECT half_day_hours, full_day_hours, end_time FROM work_schedule WHERE organization_id = $1 LIMIT 1`,
      [orgId]
    );
    const halfDayHours = parseFloat(wsRes.rows[0]?.half_day_hours ?? 4.5);
    const fullDayHours = parseFloat(wsRes.rows[0]?.full_day_hours ?? 8);
    const shiftEndTime = wsRes.rows[0]?.end_time || '17:30';

    // Find unique dates that have unprocessed logs
    const datesRes = await pool.query(
      `SELECT DISTINCT punch_time::date AS d
       FROM biometric_raw_logs
       WHERE org_id = $1 AND employee_pin = $2 AND processed = false
       ORDER BY d`,
      [orgId, String(employeePin)]
    );
    if (!datesRes.rows.length) return { processed: 0, total: 0, noMapping: false };

    let processed = 0;
    for (const { d: date } of datesRes.rows) {
      // Fetch ALL logs for this date (processed + unprocessed) so FILO sees the full picture
      const allLogsRes = await pool.query(
        `SELECT id, punch_time, punch_type, processed
         FROM biometric_raw_logs
         WHERE org_id = $1 AND employee_pin = $2
           AND punch_time >= $3::date
           AND punch_time <  $3::date + INTERVAL '1 day'
         ORDER BY punch_time`,
        [orgId, String(employeePin), date]
      );
      const dayLogs         = allLogsRes.rows;
      const unprocessedLogs = dayLogs.filter(l => !l.processed);
      if (!unprocessedLogs.length) continue;

      // Leave guard — only skip on full-day leave or WFH.
      // half_day / early_leave are NOT guarded: biometric data with multiple punches overrides an
      // incorrectly-short attendance record (e.g. early-checkout that set half_day/early_leave).
      const attRes = await pool.query(
        `SELECT id, status FROM attendance WHERE user_id = $1 AND date = $2 LIMIT 1`,
        [userId, date]
      );
      const att = attRes.rows[0] || null;

      if (att && ['on_leave', 'wfh'].includes(att.status)) {
        await pool.query(
          `UPDATE biometric_raw_logs SET processed = true
           WHERE org_id = $1 AND employee_pin = $2
             AND punch_time::date = $3 AND processed = false`,
          [orgId, String(employeePin), date]
        );
        processed += unprocessedLogs.length;
        continue;
      }

      await applyFILODay(userId, date, orgId, dayLogs, att, halfDayHours, shiftEndTime, fullDayHours);

      await pool.query(
        `UPDATE biometric_raw_logs SET processed = true
         WHERE org_id = $1 AND employee_pin = $2
           AND punch_time::date = $3 AND processed = false`,
        [orgId, String(employeePin), date]
      );
      processed += unprocessedLogs.length;
    }

    return { processed, total: processed, noMapping: false };
  }

  // ── Standard mode (original logic — with end-of-day status classification) ──
  // BUG-129/130: classify early_leave / half_day once the day is over, so a
  // 6.5h biometric day is not left as 'present'. Today's rows are left 'present'
  // until the day is definitively over (a mid-day OUT punch is just a break).
  const wsRes2 = await pool.query(
    `SELECT half_day_hours, full_day_hours FROM work_schedule WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  const halfDayHours2 = parseFloat(wsRes2.rows[0]?.half_day_hours ?? 4.5);
  const fullDayHours2 = parseFloat(wsRes2.rows[0]?.full_day_hours ?? 8);
  const todayStr2 = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const logsRes = await pool.query(
    `SELECT * FROM biometric_raw_logs
     WHERE org_id = $1 AND employee_pin = $2 AND processed = false
     ORDER BY punch_time`,
    [orgId, String(employeePin)]
  );

  let processed = 0;
  for (const log of logsRes.rows) {
    const punchDate    = new Date(log.punch_time).toISOString().slice(0, 10);
    const punchTimeStr = new Date(log.punch_time).toTimeString().slice(0, 8);

    const attRes = await pool.query(
      `SELECT id, status, check_in, total_break_minutes FROM attendance
       WHERE user_id = $1 AND date = $2 LIMIT 1`,
      [userId, punchDate]
    );
    const att = attRes.rows[0] || null;

    if (att && ['on_leave', 'half_day', 'wfh'].includes(att.status)) {
      await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [log.id]);
      processed++;
      continue;
    }

    if (log.punch_type === 0 || log.punch_type === '0') {
      if (!att) {
        await pool.query(
          `INSERT INTO attendance (user_id, date, check_in, status, source, organization_id)
           VALUES ($1, $2, $3, 'present', 'biometric', $4)
           ON CONFLICT (user_id, date, organization_id) DO NOTHING`,
          [userId, punchDate, punchTimeStr, orgId]
        );
      }
    } else if (log.punch_type === 1 || log.punch_type === '1') {
      if (att && att.check_in) {
        const checkInMs  = new Date(`${punchDate}T${att.check_in}`).getTime();
        const checkOutMs = new Date(log.punch_time).getTime();
        const grossHours = parseFloat(((checkOutMs - checkInMs) / 3600000).toFixed(2));
        const breakMins  = att.total_break_minutes || 0;
        const workHours  = parseFloat(Math.max(0, grossHours - breakMins / 60).toFixed(2));
        const dayOver    = punchDate < todayStr2;
        const status     = dayOver
          ? (workHours >= fullDayHours2 ? 'present'
            : workHours >= halfDayHours2 ? 'early_leave'
            : 'half_day')
          : 'present';
        await pool.query(
          `UPDATE attendance
           SET check_out = $1, gross_hours = $2, work_hours = $3, source = 'biometric', status = $5
           WHERE id = $4`,
          [punchTimeStr, grossHours, workHours, att.id, status]
        );
      } else if (!att) {
        await pool.query(
          `INSERT INTO attendance (user_id, date, check_out, status, source, organization_id)
           VALUES ($1, $2, $3, 'present', 'biometric', $4)
           ON CONFLICT (user_id, date, organization_id) DO UPDATE
             SET check_out = EXCLUDED.check_out, source = 'biometric'`,
          [userId, punchDate, punchTimeStr, orgId]
        );
      }
    }

    await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [log.id]);
    processed++;
  }

  return { processed, total: logsRes.rows.length, noMapping: false };
}

/**
 * Reprocess biometric_raw_logs for a specific employee PIN constrained to a date range
 * AND optionally a specific historical sync job.
 *
 * jobId (optional UUID): when supplied, ONLY records tagged with that job are used to
 * identify which dates need processing. This guarantees strict isolation — records
 * from previous syncs on the same device/date range are never touched.
 *
 * The attendance calculation itself still reads ALL logs for each affected date
 * (processed + unprocessed) so FILO sees the complete picture for that day — identical
 * to how reprocessPin() works. No second attendance calculation path exists.
 *
 * fromDate / toDate: 'YYYY-MM-DD' strings (inclusive, IST)
 * Returns { processed, total, noMapping, attendance_updated }
 */
async function reprocessPinForDates(orgId, employeePin, fromDate, toDate, jobId = null) {
  const [mapRes, policy] = await Promise.all([
    pool.query(
      `SELECT user_id FROM biometric_employee_map
       WHERE org_id = $1 AND employee_pin = $2 LIMIT 1`,
      [orgId, String(employeePin)]
    ),
    getOrgPolicy(orgId),
  ]);

  if (!mapRes.rows.length) return { processed: 0, total: 0, noMapping: true, attendance_updated: 0 };
  const userId = mapRes.rows[0].user_id;

  let attendanceUpdated = 0;

  // ── FILO mode ────────────────────────────────────────────────────────────────
  if (policy === 'first_in_last_out') {
    const wsRes = await pool.query(
      `SELECT half_day_hours, full_day_hours, end_time FROM work_schedule WHERE organization_id = $1 LIMIT 1`,
      [orgId]
    );
    const halfDayHours = parseFloat(wsRes.rows[0]?.half_day_hours ?? 4.5);
    const fullDayHours = parseFloat(wsRes.rows[0]?.full_day_hours ?? 8);
    const shiftEndTime = wsRes.rows[0]?.end_time || '17:30';

    // Discover dates that have unprocessed logs belonging to this job.
    // If jobId is supplied, filter strictly by historical_sync_job_id so records from
    // previous syncs on the same device/date range are never mixed in.
    // Falls back to date-range filter for legacy records that pre-date the job-tag column.
    const datesQuery = jobId
      ? `SELECT DISTINCT DATE(punch_time AT TIME ZONE 'Asia/Kolkata') AS d
         FROM biometric_raw_logs
         WHERE org_id = $1 AND employee_pin = $2 AND processed = false
           AND historical_sync_job_id = $3
         ORDER BY d`
      : `SELECT DISTINCT punch_time::date AS d
         FROM biometric_raw_logs
         WHERE org_id = $1 AND employee_pin = $2 AND processed = false
           AND DATE(punch_time AT TIME ZONE 'Asia/Kolkata') BETWEEN $3 AND $4
         ORDER BY d`;
    const datesParams = jobId
      ? [orgId, String(employeePin), jobId]
      : [orgId, String(employeePin), fromDate, toDate];

    const datesRes = await pool.query(datesQuery, datesParams);
    if (!datesRes.rows.length) return { processed: 0, total: 0, noMapping: false, attendance_updated: 0 };

    let processed = 0;
    for (const { d: date } of datesRes.rows) {
      const allLogsRes = await pool.query(
        `SELECT id, punch_time, punch_type, processed
         FROM biometric_raw_logs
         WHERE org_id = $1 AND employee_pin = $2
           AND punch_time >= $3::date
           AND punch_time <  $3::date + INTERVAL '1 day'
         ORDER BY punch_time`,
        [orgId, String(employeePin), date]
      );
      const dayLogs         = allLogsRes.rows;
      const unprocessedLogs = dayLogs.filter(l => !l.processed);
      if (!unprocessedLogs.length) continue;

      // Leave guard — identical to reprocessPin (on_leave + wfh skip; half_day is NOT guarded)
      const attRes = await pool.query(
        `SELECT id, status FROM attendance WHERE user_id = $1 AND date = $2 LIMIT 1`,
        [userId, date]
      );
      const att = attRes.rows[0] || null;

      if (att && ['on_leave', 'wfh'].includes(att.status)) {
        await pool.query(
          `UPDATE biometric_raw_logs SET processed = true
           WHERE org_id = $1 AND employee_pin = $2
             AND punch_time::date = $3 AND processed = false`,
          [orgId, String(employeePin), date]
        );
        processed += unprocessedLogs.length;
        continue;
      }

      await applyFILODay(userId, date, orgId, dayLogs, att, halfDayHours, shiftEndTime, fullDayHours);
      attendanceUpdated++;

      await pool.query(
        `UPDATE biometric_raw_logs SET processed = true
         WHERE org_id = $1 AND employee_pin = $2
           AND punch_time::date = $3 AND processed = false`,
        [orgId, String(employeePin), date]
      );
      processed += unprocessedLogs.length;
    }

    return { processed, total: processed, noMapping: false, attendance_updated: attendanceUpdated };
  }

  // ── Standard mode — date-filtered variant of reprocessPin ───────────────────
  // When jobId is supplied, filter strictly by historical_sync_job_id.
  const stdQuery = jobId
    ? `SELECT * FROM biometric_raw_logs
       WHERE org_id = $1 AND employee_pin = $2 AND processed = false
         AND historical_sync_job_id = $3
       ORDER BY punch_time`
    : `SELECT * FROM biometric_raw_logs
       WHERE org_id = $1 AND employee_pin = $2 AND processed = false
         AND DATE(punch_time AT TIME ZONE 'Asia/Kolkata') BETWEEN $3 AND $4
       ORDER BY punch_time`;
  const stdParams = jobId
    ? [orgId, String(employeePin), jobId]
    : [orgId, String(employeePin), fromDate, toDate];

  const logsRes = await pool.query(stdQuery, stdParams);

  // BUG-129/130: classify early_leave / half_day once the day is over.
  const wsRes2 = await pool.query(
    `SELECT half_day_hours, full_day_hours FROM work_schedule WHERE organization_id = $1 LIMIT 1`,
    [orgId]
  );
  const halfDayHours2 = parseFloat(wsRes2.rows[0]?.half_day_hours ?? 4.5);
  const fullDayHours2 = parseFloat(wsRes2.rows[0]?.full_day_hours ?? 8);
  const todayStr2 = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  let processed = 0;
  for (const log of logsRes.rows) {
    const punchDate    = new Date(log.punch_time).toISOString().slice(0, 10);
    const punchTimeStr = new Date(log.punch_time).toTimeString().slice(0, 8);

    const attRes = await pool.query(
      `SELECT id, status, check_in, total_break_minutes FROM attendance
       WHERE user_id = $1 AND date = $2 LIMIT 1`,
      [userId, punchDate]
    );
    const att = attRes.rows[0] || null;

    if (att && ['on_leave', 'half_day', 'wfh'].includes(att.status)) {
      await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [log.id]);
      processed++;
      continue;
    }

    if (log.punch_type === 0 || log.punch_type === '0') {
      if (!att) {
        await pool.query(
          `INSERT INTO attendance (user_id, date, check_in, status, source, organization_id)
           VALUES ($1, $2, $3, 'present', 'biometric', $4)
           ON CONFLICT (user_id, date, organization_id) DO NOTHING`,
          [userId, punchDate, punchTimeStr, orgId]
        );
        attendanceUpdated++;
      }
    } else if (log.punch_type === 1 || log.punch_type === '1') {
      if (att && att.check_in) {
        const checkInMs  = new Date(`${punchDate}T${att.check_in}`).getTime();
        const checkOutMs = new Date(log.punch_time).getTime();
        const grossHours = parseFloat(((checkOutMs - checkInMs) / 3600000).toFixed(2));
        const breakMins  = att.total_break_minutes || 0;
        const workHours  = parseFloat(Math.max(0, grossHours - breakMins / 60).toFixed(2));
        const dayOver    = punchDate < todayStr2;
        const status     = dayOver
          ? (workHours >= fullDayHours2 ? 'present'
            : workHours >= halfDayHours2 ? 'early_leave'
            : 'half_day')
          : 'present';
        await pool.query(
          `UPDATE attendance
           SET check_out = $1, gross_hours = $2, work_hours = $3, source = 'biometric', status = $5
           WHERE id = $4`,
          [punchTimeStr, grossHours, workHours, att.id, status]
        );
        attendanceUpdated++;
      } else if (!att) {
        await pool.query(
          `INSERT INTO attendance (user_id, date, check_out, status, source, organization_id)
           VALUES ($1, $2, $3, 'present', 'biometric', $4)
           ON CONFLICT (user_id, date, organization_id) DO UPDATE
             SET check_out = EXCLUDED.check_out, source = 'biometric'`,
          [userId, punchDate, punchTimeStr, orgId]
        );
        attendanceUpdated++;
      }
    }

    await pool.query(`UPDATE biometric_raw_logs SET processed = true WHERE id = $1`, [log.id]);
    processed++;
  }

  return { processed, total: logsRes.rows.length, noMapping: false, attendance_updated: attendanceUpdated };
}

module.exports = { reprocessPin, applyFILODay, reprocessPinForDates };
