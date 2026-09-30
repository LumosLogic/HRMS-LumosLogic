const { db, pool } = require('../config/db');
const { localDateStr, getRecipients, getOrgContext } = require('./helpers');
const { sendMail, birthdayWishHtml, birthdayReminderHtml, holidayReminderHtml } = require('../services/emailService');
const { sendPushToUsers } = require('../services/pushService');

function scheduleDailyAt(hour, minute, fn) {
  function msUntilNext() {
    const now  = new Date();
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }
  setTimeout(function tick() {
    fn().catch(console.error);
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, msUntilNext());
}

async function runDailyNotifications() {
  const today    = localDateStr();
  const todayMD  = today.slice(5);
  const tmr      = new Date(); tmr.setDate(tmr.getDate() + 1);
  const tmrStr   = localDateStr(tmr);
  const tomorrowMD = tmrStr.slice(5);

  const { data: orgs } = await db.from('organizations').select('id, name').eq('status', 'active');

  for (const org of orgs || []) {
    const oId = org.id;
    const { orgName, orgEmail } = await getOrgContext(oId);
    const { data: employees } = await db.from('users')
      .select('id, name, email, department, date_of_birth, joining_date')
      .eq('role', 'employee').eq('organization_id', oId);

    for (const emp of employees || []) {
      if (emp.date_of_birth && emp.date_of_birth.slice(5) === todayMD) {
        if (emp.email) sendMail({ to: emp.email, subject: `Happy Birthday, ${emp.name}! 🎂`, html: birthdayWishHtml(emp, orgName, orgEmail) });
        await sendPushToUsers([emp.id], { title: `🎂 Happy Birthday, ${emp.name}!`, body: `Wishing you a wonderful birthday!`, url: '/portal/home' }).catch(() => {});
      }
    }

    // ── Work anniversaries (joining_date MM-DD === today, year must differ) ──────
    const anniversariesToday = (employees || []).filter(e =>
      e.joining_date && e.joining_date.slice(5) === todayMD && e.joining_date.slice(0, 4) !== today.slice(0, 4)
    );
    if (anniversariesToday.length > 0) {
      const { data: hrAdmins } = await db.from('users')
        .select('id').eq('organization_id', oId).in('role', ['admin', 'root_admin']);
      const hrIds = (hrAdmins || []).map(a => a.id);

      for (const emp of anniversariesToday) {
        const years      = parseInt(today.slice(0, 4)) - parseInt(emp.joining_date.slice(0, 4));
        const yearsLabel = `${years} year${years !== 1 ? 's' : ''}`;

        // Notify the employee
        db.from('notifications').insert({
          user_id: emp.id, title: '🎉 Happy Work Anniversary!',
          message: `Congratulations on ${yearsLabel} with us! Your contributions make a real difference.`,
          type: 'general', organization_id: oId,
        }).then(() => {});
        sendPushToUsers([emp.id], {
          title: `🎉 ${years} Year${years !== 1 ? 's' : ''} Work Anniversary!`,
          body:  `Congratulations on ${yearsLabel} with the company, ${emp.name}!`,
          url:   '/portal/home',
        }).catch(() => {});

        // Notify HR admins
        if (hrIds.length) {
          await db.from('notifications').insert(hrIds.map(id => ({
            user_id: id, title: `Work Anniversary — ${emp.name}`,
            message: `${emp.name} completes ${yearsLabel} today. Consider recognising their contribution.`,
            type: 'general', organization_id: oId,
          })));
        }
      }
    }

    const birthdaysTmr = (employees || []).filter(e => e.date_of_birth && e.date_of_birth.slice(5) === tomorrowMD);
    if (birthdaysTmr.length > 0) {
      const hrList = await getRecipients(oId);
      if (hrList.length) sendMail({ to: hrList, subject: `Birthday Reminder — ${birthdaysTmr.map(e => e.name).join(', ')}`, html: birthdayReminderHtml(birthdaysTmr, orgName, orgEmail) });
    }

    const { data: tmrHolidays } = await db.from('holidays').select('*').eq('date', tmrStr).eq('organization_id', oId);
    if (tmrHolidays?.length) {
      const allEmails  = (employees || []).map(e => e.email).filter(Boolean);
      const hrEmails   = await getRecipients(oId);
      const recipients = [...new Set([...allEmails, ...hrEmails])];
      // HIGH-24: Never pass null — scope push to this org's employee IDs only
      const empIds = (employees || []).map(e => e.id);
      for (const holiday of tmrHolidays) {
        if (recipients.length) sendMail({ to: recipients, subject: `Tomorrow is a Holiday — ${holiday.name}`, html: holidayReminderHtml(holiday, orgName, orgEmail) });
        if (empIds.length) {
          await sendPushToUsers(empIds, { title: `🏖️ Tomorrow is a Holiday — ${holiday.name}`, body: holiday.specific_msg || holiday.description || `Enjoy the ${holiday.name} holiday!`, url: '/portal/home' }).catch(() => {});
        }
      }
    }
  }
  console.log(`[Cron] Daily notifications sent for ${today}`);
}

// BUG_072: Auto-mark absent — runs nightly after work hours end
// For each active employee with no attendance record and no approved leave for that day,
// inserts an 'absent' attendance record so the calendar/reports show the correct status.
async function runAutoMarkAbsent() {
  const today = localDateStr();
  // Determine if today was a working day for each org (skip weekends by default)
  const dayOfWeek = new Date().getDay(); // 0=Sun, 6=Sat
  const { data: orgs } = await db.from('organizations').select('id').eq('status', 'active');

  for (const org of (orgs || [])) {
    const oId = org.id;
    try {
      // Fetch org work schedule to know working days
      const { data: sched } = await db.from('organization_settings')
        .select('work_days').eq('organization_id', oId).maybeSingle();
      const workDays = sched?.work_days
        ? sched.work_days.split(',').map(Number)
        : [1, 2, 3, 4, 5]; // Mon–Fri default
      if (!workDays.includes(dayOfWeek)) continue; // not a working day, skip

      // Fetch all active employees
      const { data: employees } = await db.from('users')
        .select('id').eq('organization_id', oId)
        .in('role', ['employee', 'admin'])
        .not('employee_status', 'in', ['inactive', 'resigned', 'terminated']);

      if (!employees?.length) continue;
      const empIds = employees.map(e => e.id);

      // Find employees who checked in today
      const { data: checkedIn } = await db.from('attendance')
        .select('user_id').eq('organization_id', oId).eq('date', today)
        .in('user_id', empIds);
      const checkedInIds = new Set((checkedIn || []).map(r => r.user_id));

      // Find employees with approved leave or WFH today
      const { data: onLeave } = await db.from('leaves')
        .select('user_id').eq('organization_id', oId)
        .lte('start_date', today).gte('end_date', today)
        .in('status', ['approved']).in('user_id', empIds);
      const onLeaveIds = new Set((onLeave || []).map(r => r.user_id));

      // Find employees with a holiday today
      const { data: holidays } = await db.from('holidays')
        .select('id').eq('organization_id', oId).eq('date', today).limit(1);
      if (holidays?.length) continue; // org-wide holiday, skip absent marking

      // Find employees whose shift says today is a day-off (must NOT be marked absent).
      // DOW-coverage: aggregate all DOWs from all shift assignments (±31 days).
      // Any employee whose union of shift DOWs does NOT include today's DOW → shift weekoff.
      const todayDow = new Date().getDay(); // 0=Sun ... 6=Sat
      let shiftOffIds = new Set();
      try {
        const { rows: shiftRows } = await pool.query(
          `SELECT DISTINCT sa.user_id, s.days_of_week
             FROM shift_assignments sa
             JOIN shifts s ON s.id = sa.shift_id
            WHERE sa.organization_id = $1
              AND sa.user_id = ANY($2::int[])
              AND sa.date BETWEEN ($3::date - INTERVAL '31 days') AND ($3::date + INTERVAL '31 days')`,
          [oId, empIds, today]
        );
        // Per employee: union of all DOWs from all assigned shifts
        const userWorkingDows = {};
        for (const row of shiftRows) {
          if (!row.days_of_week) continue;
          if (!userWorkingDows[row.user_id]) userWorkingDows[row.user_id] = new Set();
          let wDays;
          try { wDays = JSON.parse(row.days_of_week); } catch { wDays = String(row.days_of_week).split(',').map(Number); }
          if (!Array.isArray(wDays)) wDays = [wDays]; // JSON.parse("6") → 6 (number, not array)
          for (const d of wDays) userWorkingDows[row.user_id].add(Number(d));
        }
        for (const uid of Object.keys(userWorkingDows)) {
          if (!userWorkingDows[uid].has(todayDow)) shiftOffIds.add(Number(uid));
        }
      } catch { /* shifts table may not exist — skip check */ }

      // Mark absent: employees not checked in, not on leave, and not on a shift day-off
      const absentIds = empIds.filter(id =>
        !checkedInIds.has(id) && !onLeaveIds.has(id) && !shiftOffIds.has(id)
      );
      if (!absentIds.length) continue;

      // Insert absent records (skip if already exists)
      const absentRecords = absentIds.map(uid => ({
        user_id: uid, organization_id: oId, date: today, status: 'absent',
        check_in: null, check_out: null,
      }));
      await db.from('attendance').upsert(absentRecords, { onConflict: 'user_id,date', ignoreDuplicates: true });
      console.log(`[AutoAbsent] Marked ${absentIds.length} absent for org ${oId} on ${today}`);
    } catch (err) {
      console.error(`[AutoAbsent] Error for org ${oId}:`, err.message);
    }
  }
}

// Probation expiry check — runs daily.
// Part 1: promotes employees whose probation has ended → active + full_time
// Part 2: for orgs with scope='all', auto-applies probation to newly joined employees
async function runProbationExpiryCheck() {
  const today = localDateStr();
  const { data: orgs } = await db.from('organizations').select('id').eq('status', 'active');

  for (const org of (orgs || [])) {
    const oId = org.id;
    try {
      // ── Part 1: promote expired probations → active ───────────────────────
      const { data: expired } = await db.from('users')
        .select('id, name')
        .eq('organization_id', oId)
        .eq('probation_applicable', true)
        .eq('employee_status', 'probation')
        .not('probation_end_date', 'is', null)
        .lte('probation_end_date', today);

      if (expired?.length) {
        for (const emp of expired) {
          await db.from('users')
            .update({ employee_status: 'active', employment_type: 'full_time' })
            .eq('id', emp.id)
            .eq('organization_id', oId);

          const { data: admins } = await db.from('users')
            .select('id').eq('organization_id', oId).in('role', ['admin', 'root_admin']);
          if (admins?.length) {
            await db.from('notifications').insert(
              admins.map(a => ({
                user_id:         a.id,
                title:           `Probation Completed — ${emp.name}`,
                message:         `${emp.name}'s probation period has ended. Status updated to Full Time (Active).`,
                type:            'general',
                organization_id: oId,
              }))
            );
          }
        }
        console.log(`[Probation] Promoted ${expired.length} employee(s) in org ${oId}`);
      }

      // ── Part 2: scope='all' — auto-apply to newly joined employees ─────────
      const { data: ps } = await db.from('payroll_settings')
        .select('probation_enabled, default_probation_months, probation_scope')
        .eq('organization_id', oId).maybeSingle();

      if (!ps?.probation_enabled || ps?.probation_scope !== 'all') continue;

      const months = Number(ps.default_probation_months) || 3;

      // Use COALESCE so employees whose date is in date_of_joining are included
      const { rows: newEmps } = await pool.query(`
        SELECT id,
          COALESCE(
            joining_date::text,
            date_of_joining,
            TO_CHAR(created_at, 'YYYY-MM-DD')
          ) AS resolved_joining_date
        FROM users
        WHERE organization_id = $1
          AND role = 'employee'
          AND COALESCE(probation_applicable, false) = false
          AND COALESCE(employee_status, 'active') NOT IN ('inactive', 'resigned', 'terminated', 'probation')
          AND COALESCE(joining_date::text, date_of_joining) IS NOT NULL
      `, [oId]);

      for (const emp of newEmps) {
        const startDate = emp.resolved_joining_date.slice(0, 10);

        const endD = new Date(startDate + 'T12:00:00Z');
        endD.setMonth(endD.getMonth() + months);
        const endDate = endD.toISOString().split('T')[0];

        if (endDate > today) {
          // Still within probation window
          await db.from('users').update({
            probation_applicable: true,
            probation_months:     months,
            probation_start_date: startDate,
            probation_end_date:   endDate,
            employee_status:      'probation',
          }).eq('id', emp.id).eq('organization_id', oId);
        } else {
          // Probation already completed — mark confirmed
          await db.from('users').update({
            probation_applicable: true,
            probation_months:     months,
            probation_start_date: startDate,
            probation_end_date:   endDate,
            employee_status:      'active',
            employment_type:      'full_time',
          }).eq('id', emp.id).eq('organization_id', oId);
        }
      }
    } catch (err) {
      console.error(`[Probation] Error for org ${oId}:`, err.message);
    }
  }
}

// ── Resignation expiry — runs daily at 00:10 ─────────────────────────────────
// Finds employees whose last_working_day has passed and transitions them from
// 'resigned' → 'inactive', blocking login and revoking active sessions.
async function runResignationExpiry() {
  const { blockUser } = require('../middleware/auth');
  const today = localDateStr();

  // Find approved exit requests whose last_working_day is today or earlier
  const { data: expiredExits } = await db.from('exit_requests')
    .select('user_id, organization_id, last_working_day')
    .eq('status', 'approved')
    .lte('last_working_day', today);

  if (!expiredExits?.length) return;

  const userIds = [...new Set(expiredExits.map(e => e.user_id))];

  // Only affect employees still in 'resigned' state (not already deactivated)
  const { data: resignedUsers } = await db.from('users')
    .select('id, organization_id, name')
    .in('id', userIds)
    .eq('employee_status', 'resigned');

  if (!resignedUsers?.length) return;

  for (const u of resignedUsers) {
    try {
      await db.from('users')
        .update({ employee_status: 'inactive', status: 'inactive' })
        .eq('id', u.id)
        .eq('organization_id', u.organization_id);
      blockUser(u.id);
      // Notify HR admins
      await db.from('notifications').insert({
        user_id:         u.id,
        title:           'Access Revoked — Notice Period Ended',
        message:         'Your last working day has passed. System access has been revoked.',
        type:            'exit',
        organization_id: u.organization_id,
      });
      console.log(`[ResignationExpiry] Deactivated ${u.name} (id=${u.id}) — LWD passed`);
    } catch (err) {
      console.error(`[ResignationExpiry] Error for user ${u.id}:`, err.message);
    }
  }
}

// ── Scheduled announcements publisher — runs every 5 minutes ─────────────────
// BUG_242: announcements with a future scheduled_at stay hidden until their
// publish time. This job fans out the deferred in-app notifications once the
// time is reached. Visibility itself is enforced in announcements.routes.js.
async function runScheduledAnnouncementPublisher() {
  try {
    const nowIso = new Date().toISOString();
    const { data: due } = await db.from('announcements')
      .select('id, organization_id, title, content, target_audience, published_notified')
      .not('scheduled_at', 'is', null)
      .lte('scheduled_at', nowIso);
    if (!due?.length) return;

    for (const ann of due) {
      if (ann.published_notified) continue; // already fanned out
      const oId = ann.organization_id;
      const audience = ann.target_audience || 'all';
      const { data: users } = await db.from('users').select('id, role').eq('organization_id', oId);
      const notifRecipients = (users || []).filter(u => {
        if (audience === 'employees') return u.role === 'employee';
        if (audience === 'hr')        return u.role === 'admin' || u.role === 'root_admin';
        return true; // 'all'
      });
      if (notifRecipients.length) {
        await db.from('notifications').insert(notifRecipients.map(u => ({
          user_id:         u.id,
          title:           `📢 ${ann.title}`,
          message:         ann.content && ann.content.length > 100 ? ann.content.substring(0, 100) + '…' : (ann.content || ''),
          type:            'announcement',
          reference_id:    ann.id,
          reference_type:  'announcement',
          organization_id: oId,
        })));
      }
      await db.from('announcements')
        .update({ published_notified: true })
        .eq('id', ann.id)
        .eq('organization_id', oId);
      console.log(`[ScheduledAnnouncement] Published "${ann.title}" (id=${ann.id})`);
    }
  } catch (err) {
    console.error('[ScheduledAnnouncement] Error:', err.message);
  }
}

function scheduleEveryMinutes(min, fn) {
  async function tick() {
    try { await fn(); } catch (e) { console.error(e.message); }
  }
  setInterval(tick, min * 60 * 1000);
}

module.exports = {
  scheduleDailyAt,
  scheduleEveryMinutes,
  runDailyNotifications,
  runAutoMarkAbsent,
  runProbationExpiryCheck,
  runResignationExpiry,
  runScheduledAnnouncementPublisher,
};
