const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { pool } = require('../../config/db-pg-adapter');
const { auth, isAdminRole } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { localDateStr, localTimeStr, flat, orgId, toMinutes, getSettings, isWorkingDay } = require('../../utils/helpers');

// ── One-time table bootstrap for attendance audit log ─────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS attendance_audit_log (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    organization_id INTEGER NOT NULL,
    action          TEXT    NOT NULL,
    issue_type      TEXT,
    date            DATE,
    source          TEXT,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_att_audit_user_date
    ON attendance_audit_log (user_id, date);
`).catch(err => console.warn('[AttendanceRoutes] audit log table bootstrap:', err.message));

// ─── Attendance: List ─────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { year, month, date, userId } = req.query;

    let query = db.from('attendance')
      .select('*, users!inner(name, email, avatar_color, department, position)')
      .eq('organization_id', orgId(req))
      .order('date', { ascending: true });

    if (!isAdminRole(req.user.role)) {
      query = query.eq('user_id', req.user.id);
    } else if (userId && userId !== 'all') {
      query = query.eq('user_id', parseInt(userId));
    }

    if (date) {
      query = query.eq('date', date);
    } else if (year && month) {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const end = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
      query = query.gte('date', start).lte('date', end);
    } else if (year) {
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      query = query.gte('date', start).lte('date', end);
    } else if (req.query.startDate && req.query.endDate) {
      query = query.gte('date', req.query.startDate).lte('date', req.query.endDate);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json(flat(data));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Today (current user) ─────────────────────────────────────────
router.get('/today', auth, async (req, res) => {
  try {
    const { data } = await db.from('attendance')
      .select('*').eq('user_id', req.user.id).eq('date', localDateStr()).maybeSingle();
    res.json(data || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: My record for a specific date (EHN_REGU_002) ────────────────
router.get('/my-record', auth, async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required' });
    const { data } = await db.from('attendance')
      .select('date, check_in, check_out, work_hours, status, gross_hours, total_break_minutes')
      .eq('user_id', req.user.id).eq('date', date).maybeSingle();
    res.json(data || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch the employee's active shift config for a given date (including attendance rule columns).
// Returns null when no shift assignment applies for that date.
async function getActiveShiftConfig(userId, today) {
  try {
    const { data } = await db
      .from('shift_assignments')
      .select('shift:shifts(start_time, end_time, days_of_week, late_threshold, early_exit_threshold, half_day_hours, full_day_hours, max_early_leave_count, late_entry_threshold_enabled, early_exit_threshold_enabled)')
      .eq('user_id', userId)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.shift || null;
  } catch { return null; }
}

// ─── Attendance: Check-in ─────────────────────────────────────────────────────
router.post('/checkin', auth, async (req, res) => {
  try {
    const today   = localDateStr();
    const timeStr = localTimeStr();
    const settings = await getSettings(orgId(req));

    const { data: existing } = await db.from('attendance')
      .select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();

    if (existing?.check_in && !existing?.check_out) return res.status(400).json({ error: 'Already checked in today' });
    if (existing?.check_in && existing?.check_out)  return res.status(400).json({ error: 'You have already checked out today' });

    // Use shift's late_threshold if configured; fall back to org-wide late_threshold
    const shift = await getActiveShiftConfig(req.user.id, today);
    const lateThreshold = shift?.late_threshold || settings.late_threshold;
    // Enabled flag: shift-specific override → org setting → default true (backward compat)
    const lateEnabled = (shift?.late_entry_threshold_enabled != null)
      ? shift.late_entry_threshold_enabled
      : (settings.late_entry_threshold_enabled ?? true);
    const is_late = lateEnabled && (toMinutes(timeStr) > toMinutes(lateThreshold));

    let record;
    if (existing) {
      const { data } = await db.from('attendance')
        .update({ check_in: timeStr, status: 'present', is_late, organization_id: orgId(req) })
        .eq('id', existing.id).select().single();
      record = data;
    } else {
      const { data } = await db.from('attendance')
        .insert({ user_id: req.user.id, date: today, check_in: timeStr, status: 'present', is_late, organization_id: orgId(req) })
        .select().single();
      record = data;
    }

    res.json({ record, message: is_late ? 'Checked in (Late)' : 'Checked in successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Check-out ────────────────────────────────────────────────────
router.post('/checkout', auth, async (req, res) => {
  try {
    const today   = localDateStr();
    const timeStr = localTimeStr();
    const settings = await getSettings(orgId(req));

    const { data: record } = await db.from('attendance')
      .select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();

    if (!record?.check_in) return res.status(400).json({ error: 'You have not checked in today' });
    if (record.check_out)  return res.status(400).json({ error: 'Already checked out today' });

    const grossMinutes = Math.max(0, toMinutes(timeStr) - toMinutes(record.check_in));
    if (grossMinutes < 1) {
      return res.status(400).json({ error: 'You cannot check out immediately after checking in. Please wait at least 1 minute.' });
    }
    const grossHours = grossMinutes / 60;
    // Auto-close any open break at checkout time
    let totalBreakMins = record.total_break_minutes || 0;
    const breakUpdateFields = {};
    if (record.break_start && !record.break_end) {
      const autoBreakMins = Math.max(0, toMinutes(timeStr) - toMinutes(record.break_start));
      totalBreakMins += autoBreakMins;
      breakUpdateFields.break_end = timeStr;
      breakUpdateFields.total_break_minutes = totalBreakMins;
    }
    const effectiveHours = Math.max(0, grossHours - totalBreakMins / 60);
    // Use shift-specific config where available; fall back to org-wide settings
    const shift = await getActiveShiftConfig(req.user.id, today);
    // Early exit: shift's own early_exit_threshold → shift end_time → org threshold
    const earlyExitThreshold = shift?.early_exit_threshold || shift?.end_time || settings.early_exit_threshold;
    // Enabled flag: shift-specific override → org setting → default true (backward compat)
    const earlyExitEnabled = (shift?.early_exit_threshold_enabled != null)
      ? shift.early_exit_threshold_enabled
      : (settings.early_exit_threshold_enabled ?? true);
    const is_early_exit = earlyExitEnabled && (toMinutes(timeStr) < toMinutes(earlyExitThreshold));
    // Half/full day thresholds: shift-specific → org default
    const halfDayHours = parseFloat(shift?.half_day_hours ?? settings.half_day_hours ?? 4.5);
    const fullDayHours = parseFloat(shift?.full_day_hours ?? settings.full_day_hours ?? 8);
    let status;
    if (effectiveHours < halfDayHours) {
      status = 'half_day';
    } else if (effectiveHours < fullDayHours) {
      status = 'early_leave';
    } else {
      status = 'present';
    }

    const { data: updated } = await db.from('attendance')
      .update({ check_out: timeStr, gross_hours: Math.round(grossHours * 100) / 100, work_hours: Math.round(effectiveHours * 100) / 100, status, is_early_exit, ...breakUpdateFields })
      .eq('id', record.id).select().single();

    const msgs = [];
    if (is_early_exit)           msgs.push('Early exit noted');
    if (status === 'half_day')   msgs.push('Half day recorded');
    if (status === 'early_leave') msgs.push('Early leave noted');
    res.json({ record: updated, message: msgs.length ? msgs.join(' · ') : 'Checked out successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Break In ─────────────────────────────────────────────────────
router.post('/break-in', auth, async (req, res) => {
  try {
    const today   = localDateStr();
    const timeStr = localTimeStr();
    const { data: record } = await db.from('attendance')
      .select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();
    if (!record?.check_in)                           return res.status(400).json({ error: 'You have not checked in today' });
    if (record.check_out)                            return res.status(400).json({ error: 'You have already checked out today' });
    if (record.break_start && !record.break_end)     return res.status(400).json({ error: 'You are already on a break' });
    const { data: updated } = await db.from('attendance')
      .update({ break_start: timeStr, break_end: null })
      .eq('id', record.id).select().single();
    res.json({ record: updated, message: 'Break started' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Break Out ────────────────────────────────────────────────────
// Break Out — employee ends a break
router.post('/break-out', auth, async (req, res) => {
  try {
    const today   = localDateStr();
    const timeStr = localTimeStr();
    const { data: record } = await db.from('attendance')
      .select('*').eq('user_id', req.user.id).eq('date', today).maybeSingle();
    if (!record?.check_in)                    return res.status(400).json({ error: 'You have not checked in today' });
    if (!record.break_start || record.break_end) return res.status(400).json({ error: 'No active break found' });
    const breakMins = Math.max(0, toMinutes(timeStr) - toMinutes(record.break_start));
    const newTotalBreakMins = (record.total_break_minutes || 0) + breakMins;
    const { data: updated } = await db.from('attendance')
      .update({ break_end: timeStr, total_break_minutes: newTotalBreakMins })
      .eq('id', record.id).select().single();
    const hrs = Math.floor(breakMins / 60), mins = breakMins % 60;
    const dur = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    res.json({ record: updated, message: `Break ended · ${dur} break taken` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Admin Edit (by ID) ──────────────────────────────────────────
router.put('/:id', auth, hasPermission('attendance', 'edit'), async (req, res) => {
  try {
    const { check_in, check_out, status, is_late, is_early_exit, notes } = req.body;
    // gross_hours = raw span between check_in and check_out (no break deduction)
    const gross_hours = check_in && check_out
      ? Math.max(0, (toMinutes(check_out) - toMinutes(check_in)) / 60) : 0;
    // When admin overrides times, reset break minutes to 0 — breaks are unknown for manual edits
    const work_hours = gross_hours;
    const { data } = await db.from('attendance')
      .update({
        check_in, check_out, status,
        is_late: !!is_late, is_early_exit: !!is_early_exit,
        gross_hours: Math.round(gross_hours * 100) / 100,
        work_hours:  Math.round(work_hours  * 100) / 100,
        total_break_minutes: 0,
        notes,
      })
      .eq('id', req.params.id).select().single();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Mark Absent ──────────────────────────────────────────────────
router.post('/mark-absent', auth, hasPermission('attendance', 'edit'), async (req, res) => {
  try {
    const { user_id, date } = req.body;
    if (!user_id || !date) return res.status(400).json({ error: 'user_id and date required' });
    const { error } = await db.from('attendance')
      .upsert(
        { user_id: parseInt(user_id), date, status: 'absent', organization_id: orgId(req) },
        { onConflict: 'user_id,date,organization_id' }
      );
    if (error) throw new Error(error.message);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Admin Create or Full Edit ────────────────────────────────────
// Admin create or fully edit any attendance record
router.post('/admin-edit', auth, hasPermission('attendance', 'edit'), async (req, res) => {
  try {
    const { user_id, date, check_in, check_out, status, is_late, is_early_exit, notes } = req.body;
    if (!user_id || !date) return res.status(400).json({ error: 'user_id and date required' });
    const gross_hours = check_in && check_out
      ? Math.max(0, (toMinutes(check_out) - toMinutes(check_in)) / 60) : 0;
    const { data, error } = await db.from('attendance')
      .upsert({
        user_id: parseInt(user_id), date,
        check_in:            check_in      || null,
        check_out:           check_out     || null,
        status:              status        || 'present',
        is_late:             !!is_late,
        is_early_exit:       !!is_early_exit,
        gross_hours:         Math.round(gross_hours * 100) / 100,
        work_hours:          Math.round(gross_hours * 100) / 100,
        total_break_minutes: 0,
        notes:               notes         || null,
        organization_id:     orgId(req),
      }, { onConflict: 'user_id,date,organization_id' })
      .select().single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Mark Late/Early (POST — create/update) ──────────────────────
// Mark late come / early exit for an employee on a given date
router.post('/late-early', auth, hasPermission('attendance', 'edit'), async (req, res) => {
  try {
    const { user_id, date, late_come, late_come_time, early_exit, early_exit_time } = req.body;
    if (!user_id || !date) return res.status(400).json({ error: 'user_id and date are required' });

    // Fetch existing record for the day
    const { data: existing } = await db.from('attendance')
      .select('*').eq('user_id', user_id).eq('date', date).maybeSingle();

    const updates = {};
    if (late_come === 'yes' && late_come_time)  { updates.is_late      = true;  updates.check_in  = late_come_time;  }
    if (late_come === 'none')                    { updates.is_late      = false; }
    if (early_exit === 'yes' && early_exit_time){ updates.is_early_exit = true;  updates.check_out = early_exit_time; }
    if (early_exit === 'none')                   { updates.is_early_exit = false; }

    // Recalculate work hours if both times known
    const ci = updates.check_in  || existing?.check_in;
    const co = updates.check_out || existing?.check_out;
    if (ci && co) {
      const work_hours = Math.max(0, (toMinutes(co) - toMinutes(ci)) / 60);
      updates.work_hours = Math.round(work_hours * 100) / 100;
    }

    if (existing) {
      await db.from('attendance').update(updates).eq('id', existing.id);
    } else {
      // No record yet — create one with status present
      await db.from('attendance').insert({
        user_id, date,
        status: 'present',
        is_late:       updates.is_late      ?? false,
        is_early_exit: updates.is_early_exit ?? false,
        check_in:      updates.check_in  || null,
        check_out:     updates.check_out || null,
        work_hours:    updates.work_hours || 0,
      });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Late/Early List (GET) ────────────────────────────────────────
// Return attendance records where is_late or is_early_exit, joined with user info
router.get('/late-early', auth, async (req, res) => {
  try {
    const oid = orgId(req);
    // Scope to employees only within this org
    const { data: empRows } = await db.from('users').select('id')
      .eq('role', 'employee').eq('organization_id', oid);
    const empIds = (empRows || []).map(e => e.id);

    let query = db.from('attendance')
      .select('*, users(name, email, avatar_color, department)')
      .eq('organization_id', oid)
      .or('is_late.eq.true,is_early_exit.eq.true')
      .in('user_id', empIds.length ? empIds : [-1])
      .order('date', { ascending: false });

    // Optional date filter
    if (req.query.date) query = query.eq('date', req.query.date);

    // Employees see only their own records
    if (!isAdminRole(req.user.role)) query = query.eq('user_id', req.user.id);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const result = (data || []).map(r => ({ ...r, ...r.users, users: undefined }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Update Late/Early Flags (PUT by ID) ─────────────────────────
// Update late/early flags on an existing attendance record
router.put('/late-early/:id', auth, hasPermission('attendance', 'edit'), async (req, res) => {
  try {
    const { late_come, late_come_time, early_exit, early_exit_time } = req.body;

    const { data: existing, error: fetchErr } = await db.from('attendance')
      .select('*').eq('id', req.params.id).single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Record not found' });

    const updates = {};
    if (late_come === 'yes' && late_come_time)   { updates.is_late       = true;  updates.check_in  = late_come_time;  }
    if (late_come === 'none')                     { updates.is_late       = false; updates.check_in  = null; }
    if (early_exit === 'yes' && early_exit_time) { updates.is_early_exit = true;  updates.check_out = early_exit_time; }
    if (early_exit === 'none')                   { updates.is_early_exit = false; updates.check_out = null; }

    const ci = updates.check_in  ?? existing.check_in;
    const co = updates.check_out ?? existing.check_out;
    if (ci && co) updates.work_hours = Math.round(Math.max(0, (toMinutes(co) - toMinutes(ci)) / 60) * 100) / 100;

    await db.from('attendance').update(updates).eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Clear Late/Early Flags (DELETE by ID) ───────────────────────
// Clear late/early flags from an attendance record
router.delete('/late-early/:id', auth, hasPermission('attendance', 'edit'), async (req, res) => {
  try {
    const { data: existing } = await db.from('attendance')
      .select('*').eq('id', req.params.id).single();
    if (!existing) return res.status(404).json({ error: 'Record not found' });

    await db.from('attendance')
      .update({ is_late: false, is_early_exit: false, check_in: null, check_out: null })
      .eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Cleanup Orphaned Leave Records ───────────────────────────────
// Clean up attendance records with leave-based status on weekends or with no approved leave backing them
router.post('/cleanup-orphaned', auth, async (req, res) => {
  try {
    const oid = orgId(req);

    const { data: leaveAttendance } = await db.from('attendance')
      .select('id, user_id, date, status')
      .eq('organization_id', oid)
      .in('status', ['on_leave', 'half_day', 'wfh']);

    if (!leaveAttendance?.length) return res.json({ removed: 0 });

    const { data: approvedLeaves } = await db.from('leaves')
      .select('user_id, start_date, end_date, leave_time')
      .eq('organization_id', oid)
      .eq('status', 'approved');

    const toDelete = [];
    for (const att of leaveAttendance) {
      const d = new Date(att.date + 'T12:00:00');
      const dow = d.getDay();
      // Delete if on weekend (Saturday = 6, Sunday = 0)
      if (dow === 0 || dow === 6) {
        toDelete.push(att.id);
        continue;
      }
      const hasLeave = (approvedLeaves || []).some(l => {
        if (l.user_id !== att.user_id) return false;
        if (att.date < l.start_date || att.date > l.end_date) return false;
        const expected = l.leave_time === 'half' ? 'half_day' : l.leave_time === 'wfh' ? 'wfh' : 'on_leave';
        return att.status === expected;
      });
      if (!hasLeave) toDelete.push(att.id);
    }

    if (toDelete.length) await db.from('attendance').delete().eq('organization_id', oid).in('id', toDelete);
    res.json({ removed: toDelete.length, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Issues (Smart Attendance Assistant — mobile/web) ─────────────
// Returns today's attendance issues (missing check-in/out, long break, anomalies)
// for the authenticated employee.
// Guards: approved leave, org-wide holiday, and exempt attendance statuses are all
// excluded so reminders are never raised on days off.
// Grace period for delayed biometric sync: CHECKIN_GRACE=30 min, CHECKOUT_GRACE=60 min.
router.get('/issues', auth, async (req, res) => {
  try {
    const today  = localDateStr();
    const uid    = req.user.id;
    const oId    = orgId(req);

    // IST "now" in minutes since midnight
    const istParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const istH  = parseInt(istParts.find(p => p.type === 'hour')?.value   || '0', 10);
    const istM  = parseInt(istParts.find(p => p.type === 'minute')?.value || '0', 10);
    const nowMin = istH * 60 + istM;

    // Fetch attendance, approved leave, holiday and shift in parallel
    const [attRes, leaveRes, holidayRes, shiftCfg] = await Promise.all([
      db.from('attendance').select('*').eq('user_id', uid).eq('date', today).maybeSingle(),
      db.from('leaves').select('id, leave_time').eq('user_id', uid).eq('organization_id', oId)
        .eq('status', 'approved').lte('start_date', today).gte('end_date', today).maybeSingle(),
      db.from('holidays').select('id').eq('organization_id', oId).eq('date', today).maybeSingle(),
      getActiveShiftConfig(uid, today),
    ]);

    const att     = attRes.data;
    const leave   = leaveRes.data;
    const holiday = holidayRes.data;

    // If the employee has an approved leave or there is an org holiday, return no issues
    if (leave || holiday) return res.json({ issues: [] });

    // Exempt attendance statuses
    const EXEMPT = new Set(['on_leave', 'weekly_off', 'holiday', 'wfh']);
    if (att?.status && EXEMPT.has(att.status)) return res.json({ issues: [] });

    const shiftStart = shiftCfg?.start_time ? toMinutes(shiftCfg.start_time) : 9 * 60;
    const shiftEnd   = shiftCfg?.end_time   ? toMinutes(shiftCfg.end_time)   : 18 * 60;

    const CHECKIN_GRACE  = 30;  // minutes after shift start before raising missing check-in
    const CHECKOUT_GRACE = 60;  // minutes after shift end before raising missing check-out
    const MAX_BREAK_MIN  = 60;  // break duration that triggers long-break issue

    const issues = [];

    // ── Missing check-in ─────────────────────────────────────────────────────
    if (!att?.check_in && nowMin > shiftStart + CHECKIN_GRACE && nowMin < shiftEnd + 120) {
      issues.push({
        type:    'missing_checkin',
        date:    today,
        message: `No check-in recorded — shift started at ${shiftCfg?.start_time || '09:00'}.`,
        severity: 'high',
      });
    }

    // ── Missing check-out (60 min grace accommodates delayed biometric sync) ─
    if (att?.check_in && !att?.check_out && nowMin > shiftEnd + CHECKOUT_GRACE) {
      issues.push({
        type:    'missing_checkout',
        date:    today,
        message: `No check-out recorded — shift ended at ${shiftCfg?.end_time || '18:00'}.`,
        severity: 'high',
      });
    }

    // ── Long break ───────────────────────────────────────────────────────────
    if (att?.check_in && !att?.check_out && att?.break_start && !att?.break_end) {
      const bsMin = toMinutes(att.break_start.slice(0, 5));
      const duration = nowMin - bsMin;
      if (duration > MAX_BREAK_MIN) {
        issues.push({
          type:    'long_break',
          date:    today,
          message: `Break has been running for ${duration} minutes.`,
          severity: 'medium',
        });
      }
    }

    // ── Anomaly: check-in time is after shift end ────────────────────────────
    if (att?.check_in && !att?.check_out && toMinutes(att.check_in.slice(0, 5)) > shiftEnd) {
      issues.push({
        type:    'anomaly',
        date:    today,
        message: 'Check-in was recorded after the configured shift end time.',
        severity: 'low',
      });
    }

    res.json({ issues });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Attendance: Audit Log (write) ───────────────────────────────────────────
// Records reminder events and actions taken by the mobile/web attendance assistant.
// Writes to attendance_audit_log (created on startup above — never breaks if absent).
router.post('/audit-log', auth, async (req, res) => {
  try {
    const { action, issue_type, date, source, description } = req.body;
    if (!action) return res.status(400).json({ error: 'action is required' });

    await pool.query(
      `INSERT INTO attendance_audit_log
         (user_id, organization_id, action, issue_type, date, source, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user.id, orgId(req),
        action,
        issue_type || null,
        date || localDateStr(),
        source || 'mobile_app',
        description || null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    // Non-fatal — table may not yet exist on first deploy; log and return ok
    console.warn('[AttAuditLog] write failed:', err.message);
    res.json({ ok: true, warning: 'audit log unavailable' });
  }
});

// ─── Attendance: Audit Log (read) ────────────────────────────────────────────
// Returns recent audit log entries for the authenticated employee.
router.get('/audit-log', auth, async (req, res) => {
  try {
    const uid   = req.user.id;
    const date  = req.query.date || localDateStr();
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);

    const result = await pool.query(
      `SELECT id, action, issue_type, date, source, description, created_at
         FROM attendance_audit_log
        WHERE user_id = $1 AND date = $2::date
        ORDER BY created_at DESC
        LIMIT $3`,
      [uid, date, limit]
    );
    res.json({ entries: result.rows });
  } catch (err) {
    // Non-fatal — table may not yet exist
    console.warn('[AttAuditLog] read failed:', err.message);
    res.json({ entries: [] });
  }
});

module.exports = router;
