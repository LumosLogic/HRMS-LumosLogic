'use strict';

/**
 * payrollScheduler.js — Phase 3.5 (Multi-Tenant Configurable Engine)
 *
 * Architecture
 * ────────────
 * Platform scheduler: runs on a fixed interval (default 1 hour).
 * Org payroll policy: every organization has its own schedule in payroll_settings.
 *
 * On each tick the scheduler:
 *   1. Fetches ALL active organizations and their payroll_settings.
 *   2. For each org: evaluates shouldGenerate(), shouldPublish(), shouldEmail()
 *      independently using that org's timezone and configured days/times.
 *   3. Executes only the actions whose conditions are met.
 *
 * Duplicate prevention
 * ────────────────────
 *   Generation: UNIQUE(organization_id, pay_month, pay_year) on payroll_scheduler_runs.
 *               A second attempt in the same hour gets a 23505 and exits quietly.
 *   Publish:    payslips with status != 'generated' are skipped — the query
 *               returns nothing if already published.
 *   Email:      payroll_email_log is checked before any send attempt.
 *               If any 'sent' record exists for the run, email batch is skipped.
 *
 * Crash recovery
 * ──────────────
 *   'running' records older than PAYROLL_STALE_RUN_MINUTES are reset to 'failed'
 *   on the next tick, freeing the UNIQUE slot for a retry.
 */

const { pool }                                = require('../config/db');
const { generatePayrollRun, GenerationError } = require('./payrollGenerationService');
const { sendPayslipsBatch }                   = require('./payrollEmailService');
const {
  notifyPayrollComplete,
  notifyPayrollFailed,
}                                             = require('./payrollNotificationService');

// ─── Configuration ────────────────────────────────────────────────────────────
// How often the scheduler evaluates all orgs (ms). Default: 1 hour.
const INTERVAL_MS   = parseInt(process.env.PAYROLL_SCHEDULE_INTERVAL_MS || String(60 * 60 * 1000), 10);
const STALE_MINUTES = parseInt(process.env.PAYROLL_STALE_RUN_MINUTES    || '60',  10);

// ═════════════════════════════════════════════════════════════════════════════
// DATE / TIME HELPERS
// ═════════════════════════════════════════════════════════════════════════════

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function padZ(n) { return String(n).padStart(2, '0'); }

/**
 * Returns the current date and hour in the given IANA timezone.
 * Falls back to UTC-ish server time if the timezone string is invalid.
 *
 * @returns {{ year, month, day, hour, minute }}
 */
function nowIn(tz) {
  try {
    const fmt   = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const parts = fmt.formatToParts(new Date());
    const get   = type => parseInt(parts.find(p => p.type === type)?.value || '0', 10);
    return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
  } catch {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1, day: n.getDate(), hour: n.getHours(), minute: n.getMinutes() };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DAY RESOLUTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Returns true if `dow` (0=Sun … 6=Sat) is a weekend according to policy.
 */
function isWeekendDay(dow, policy) {
  switch (policy) {
    case 'sat_sun':       return dow === 0 || dow === 6;
    case 'sun_only':      return dow === 0;
    case 'alternate_sat': return dow === 0; // simplified — alternating Sat not practical for last-working-day
    case 'none':          return false;
    default:              return dow === 0 || dow === 6;
  }
}

/**
 * Returns the last calendar day of the given month/year.
 */
function resolveLastCalendarDay(year, month) {
  return daysInMonth(year, month);
}

/**
 * Returns the last working (non-weekend, non-holiday) day of the month.
 * Walks backwards from the last calendar day until a working day is found.
 *
 * @param {Set<string>} holidays  Set of 'YYYY-MM-DD' strings
 */
function resolveLastWorkingDay(year, month, holidays, weekendPolicy) {
  const last = daysInMonth(year, month);
  for (let d = last; d >= 1; d--) {
    const dow = new Date(year, month - 1, d).getDay();
    const ds  = `${year}-${padZ(month)}-${padZ(d)}`;
    if (!isWeekendDay(dow, weekendPolicy) && !holidays.has(ds)) return d;
  }
  return last; // fallback: return last calendar day if entire month is holiday
}

/**
 * Resolves a day specification to an actual calendar day number.
 *
 * @param {string} daySpec  '1'–'28' | 'LAST_DAY' | 'LAST_WORKING_DAY'
 * @param {number} year
 * @param {number} month
 * @param {Set<string>} holidays
 * @param {string} weekendPolicy
 * @returns {number}
 */
function resolveDay(daySpec, year, month, holidays, weekendPolicy) {
  if (!daySpec) return 1;
  if (daySpec === 'LAST_DAY')         return resolveLastCalendarDay(year, month);
  if (daySpec === 'LAST_WORKING_DAY') return resolveLastWorkingDay(year, month, holidays, weekendPolicy);
  const n = parseInt(daySpec, 10);
  if (isNaN(n)) return 1;
  // Clamp to actual month length (e.g. day 31 in a 30-day month → 30)
  return Math.min(n, daysInMonth(year, month));
}

/**
 * Parses 'HH:MM' → hour integer (0–23). Returns 1 as fallback.
 */
function parseHour(timeStr) {
  const [h] = (timeStr || '01:00').split(':').map(Number);
  return isNaN(h) ? 1 : Math.max(0, Math.min(23, h));
}

// ═════════════════════════════════════════════════════════════════════════════
// DECISION HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Decides if payroll should be generated for this org right now.
 *
 * Logic:
 *   - auto_generate_payroll must be true.
 *   - Resolve which calendar day is the generation day this month.
 *   - now.day must match the resolved day.
 *   - now.hour must be >= the configured generation hour (allows any later
 *     hourly tick on the same day — the UNIQUE constraint prevents duplicates).
 *   - Returns the target pay period { payMonth, payYear }, or null.
 *
 * payroll_generation_day falls back to the legacy payroll_date INT column.
 * payroll_generate_for controls whether to generate for 'PREVIOUS' or 'CURRENT' month.
 */
function shouldGenerate(settings, now, holidays) {
  if (!settings.auto_generate_payroll) return null;

  const daySpec = settings.payroll_generation_day || String(settings.payroll_date || 1);
  const genDay  = resolveDay(daySpec, now.year, now.month, holidays, settings.weekend_policy || 'sat_sun');

  if (now.day !== genDay) return null;

  const genHour = parseHour(settings.payroll_generation_time || '01:00');
  if (now.hour < genHour) return null; // too early in the day

  // Which month's payroll to generate?
  const genFor = settings.payroll_generate_for || 'PREVIOUS';
  if (genFor === 'CURRENT') {
    return { payMonth: now.month, payYear: now.year };
  }
  // PREVIOUS: generate for the month that just ended
  return now.month === 1
    ? { payMonth: 12, payYear: now.year - 1 }
    : { payMonth: now.month - 1, payYear: now.year };
}

/**
 * Decides if completed payroll runs should be auto-published now.
 *
 * Logic:
 *   - auto_publish must be true.
 *   - Resolve which calendar day is the publish day this month.
 *   - now.day must match AND now.hour >= configured publish hour.
 *   - Returns true (actual check for unpublished runs happens in handlePublish).
 *
 * payroll_publish_day falls back to payroll_generation_day, then payroll_date.
 */
function shouldPublish(settings, now, holidays) {
  if (!settings.auto_publish) return false;

  const daySpec = settings.payroll_publish_day
    || settings.payroll_generation_day
    || String(settings.payroll_date || 1);
  const pubDay  = resolveDay(daySpec, now.year, now.month, holidays, settings.weekend_policy || 'sat_sun');

  if (now.day !== pubDay) return false;

  const pubHour = parseHour(settings.payroll_publish_time || '09:00');
  return now.hour >= pubHour;
}

/**
 * Decides if payslip emails should be sent after publishing.
 * Email always fires after publish if payslip_auto_email is on.
 * The actual send is guarded by the email log (no duplicates).
 */
function shouldEmail(settings) {
  return Boolean(settings.payslip_auto_email);
}

// ═════════════════════════════════════════════════════════════════════════════
// DB HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fetches org holidays for a given month as a Set<'YYYY-MM-DD'>.
 * Used for LAST_WORKING_DAY resolution.
 */
async function fetchOrgHolidays(orgId, year, month) {
  try {
    const start = `${year}-${padZ(month)}-01`;
    const end   = `${year}-${padZ(month)}-${padZ(daysInMonth(year, month))}`;
    const { rows } = await pool.query(
      `SELECT date::text AS dt FROM holidays
        WHERE organization_id = $1 AND date >= $2 AND date <= $3`,
      [orgId, start, end]
    );
    return new Set(rows.map(r => r.dt));
  } catch {
    return new Set();
  }
}

async function recoverStaleRuns() {
  await pool.query(
    `UPDATE payroll_scheduler_runs
        SET status        = 'failed',
            error_message = 'Process terminated before completion',
            completed_at  = NOW()
      WHERE status     = 'running'
        AND created_at < NOW() - ($1 || ' minutes')::INTERVAL`,
    [STALE_MINUTES]
  ).catch(() => {});
}

// ═════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Attempts to generate payroll for the target period.
 * Uses the payroll_scheduler_runs UNIQUE constraint as a distributed mutex.
 */
async function handleGeneration(orgId, settings, { payMonth, payYear }) {
  let schedulerRunId;
  try {
    const { rows } = await pool.query(
      `INSERT INTO payroll_scheduler_runs
         (organization_id, run_date, pay_month, pay_year, status, triggered_by)
       VALUES ($1, CURRENT_DATE, $2, $3, 'running', 'scheduler')
       RETURNING id`,
      [orgId, payMonth, payYear]
    );
    schedulerRunId = rows[0].id;
  } catch (err) {
    if (err.code === '23505') return; // Already generated or in progress for this period
    throw err;
  }

  console.log(`[Scheduler] Org ${orgId} — generating ${payMonth}/${payYear}`);

  try {
    const result = await generatePayrollRun({
      organizationId: orgId,
      month:          payMonth,
      year:           payYear,
      generatedBy:    null,
      notes:          'Auto-generated by payroll scheduler',
      force:          false,
      ip:             null,
    });

    await pool.query(
      `UPDATE payroll_scheduler_runs
          SET status = $1, payroll_run_id = $2, completed_at = NOW()
        WHERE id = $3`,
      [result.status === 'failed' ? 'failed' : 'completed', result.runId, schedulerRunId]
    );

    notifyPayrollComplete(orgId, result.runId, result, payMonth, payYear).catch(() => {});
    console.log(`[Scheduler] Org ${orgId} — ${payMonth}/${payYear} generated (${result.status})`);

  } catch (err) {
    const isSkip     = err instanceof GenerationError && err.code === 'PAYROLL_EXISTS';
    const finalState = isSkip ? 'skipped' : 'failed';

    await pool.query(
      `UPDATE payroll_scheduler_runs
          SET status = $1, error_message = $2, completed_at = NOW()
        WHERE id = $3`,
      [finalState, (err.message || '').substring(0, 500), schedulerRunId]
    ).catch(() => {});

    if (!isSkip) {
      console.error(`[Scheduler] Gen failed org ${orgId} ${payMonth}/${payYear}:`, err.message);
      notifyPayrollFailed(orgId, err.message, payMonth, payYear).catch(() => {});
    }
  }
}

/**
 * Finds completed payroll runs with unpublished payslips and publishes them.
 * If payslip_auto_email is enabled, sends email batch (guarded by email log).
 */
async function handlePublish(orgId, settings) {
  // Find runs that have at least one payslip still in 'generated' status
  const { rows: runs } = await pool.query(
    `SELECT DISTINCT pr.id, pr.month, pr.year
       FROM payroll_runs pr
      WHERE pr.organization_id = $1
        AND pr.status IN ('completed', 'completed_with_errors')
        AND EXISTS (
              SELECT 1 FROM payslips ps
               WHERE ps.payroll_run_id   = pr.id
                 AND ps.organization_id  = $1
                 AND ps.status           = 'generated'
                 AND ps.locked           = FALSE
            )
      ORDER BY pr.year DESC, pr.month DESC`,
    [orgId]
  );

  for (const run of runs) {
    await pool.query(
      `UPDATE payslips
          SET status = 'published'
        WHERE payroll_run_id  = $1
          AND organization_id = $2
          AND status          = 'generated'
          AND locked          = FALSE`,
      [run.id, orgId]
    );

    console.log(`[Scheduler] Org ${orgId} — published run ${run.id} (${run.month}/${run.year})`);

    // Email: only if not already sent for this run
    if (shouldEmail(settings)) {
      const emailCheck = await pool.query(
        `SELECT 1 FROM payroll_email_log
          WHERE payroll_run_id   = $1
            AND organization_id  = $2
            AND status           = 'sent'
          LIMIT 1`,
        [run.id, orgId]
      );
      if (!emailCheck.rows.length) {
        sendPayslipsBatch({ organizationId: orgId, runId: run.id, month: run.month, year: run.year })
          .catch(e => console.error(`[Scheduler] Email batch org ${orgId} run ${run.id}:`, e.message));
      }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PER-ORGANIZATION PROCESSING
// ═════════════════════════════════════════════════════════════════════════════

async function processOrganization(org) {
  const orgId    = org.organization_id;
  const tz       = org.timezone || 'Asia/Kolkata';
  const now      = nowIn(tz);

  // Holidays needed for LAST_WORKING_DAY resolution in both generation and publish
  const holidays = await fetchOrgHolidays(orgId, now.year, now.month);

  // ── Generation ────────────────────────────────────────────────────────────
  const genTarget = shouldGenerate(org, now, holidays);
  if (genTarget) {
    await handleGeneration(orgId, org, genTarget);
  }

  // ── Publish (independent of generation — can happen on a different day) ──
  if (shouldPublish(org, now, holidays)) {
    await handlePublish(orgId, org);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN SCHEDULER LOOP
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Entry point for each hourly tick.
 * Fetches all active organizations and their payroll settings, then processes
 * each one independently. Org failures are isolated — one failing org never
 * blocks the others.
 */
async function runPayrollScheduler() {
  await recoverStaleRuns();

  let orgs;
  try {
    const { rows } = await pool.query(
      `SELECT
           ps.organization_id,
           ps.payroll_date,
           ps.auto_generate_payroll,
           ps.auto_publish,
           ps.payslip_auto_email,
           ps.timezone,
           ps.weekend_policy,
           ps.payroll_generation_day,
           ps.payroll_generation_time,
           ps.payroll_generate_for,
           ps.payroll_publish_day,
           ps.payroll_publish_time
         FROM payroll_settings ps
         JOIN organizations o ON o.id = ps.organization_id
        WHERE (ps.auto_generate_payroll = TRUE OR ps.auto_publish = TRUE)
          AND (o.status IS NULL OR o.status = 'active')`
    );
    orgs = rows;
  } catch (err) {
    console.error('[Scheduler] Failed to load org settings:', err.message);
    return;
  }

  if (!orgs.length) return;

  for (const org of orgs) {
    await processOrganization(org).catch(err =>
      console.error(`[Scheduler] Unexpected error org ${org.organization_id}:`, err.message)
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MANUAL TRIGGER (API)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Allows HR/Root Admin to manually trigger payroll generation and
 * (optionally) the post-generation steps for any period.
 *
 * Does NOT consult shouldGenerate() — the actor's explicit intention overrides
 * the schedule. Still respects the generation service's own guards (locked,
 * future period, etc.) unless force=true.
 */
async function triggerManual({ organizationId, month, year, force = false, actorId, actorName }) {
  const orgId = Number(organizationId);
  const m     = Number(month);
  const y     = Number(year);
  const name  = actorName || String(actorId);

  let schedulerRunId;
  try {
    const { rows } = await pool.query(
      `INSERT INTO payroll_scheduler_runs
         (organization_id, run_date, pay_month, pay_year, status, triggered_by, triggered_actor)
       VALUES ($1, CURRENT_DATE, $2, $3, 'running', 'manual', $4)
       ON CONFLICT (organization_id, pay_month, pay_year) WHERE branch_id IS NULL DO UPDATE
          SET status          = 'running',
              triggered_by    = 'manual',
              triggered_actor = EXCLUDED.triggered_actor,
              run_date        = CURRENT_DATE,
              created_at      = NOW(),
              completed_at    = NULL,
              error_message   = NULL,
              payroll_run_id  = NULL
       RETURNING id`,
      [orgId, m, y, name]
    );
    schedulerRunId = rows[0].id;
  } catch {
    // payroll_scheduler_runs may not exist before migration — proceed without tracking
  }

  const { rows: settingsRows } = await pool.query(
    `SELECT auto_publish, payslip_auto_email FROM payroll_settings WHERE organization_id = $1`,
    [orgId]
  );
  const settings = settingsRows[0] || {};

  const result = await generatePayrollRun({
    organizationId: orgId,
    month:          m,
    year:           y,
    generatedBy:    actorId,
    notes:          `Manually triggered by ${name}`,
    force,
    ip:             null,
  });

  if (schedulerRunId) {
    await pool.query(
      `UPDATE payroll_scheduler_runs
          SET status = $1, payroll_run_id = $2, completed_at = NOW()
        WHERE id = $3`,
      [result.status === 'failed' ? 'failed' : 'completed', result.runId, schedulerRunId]
    ).catch(() => {});
  }

  // Post-generation: publish + email if org has them enabled
  if (settings.auto_publish && result.runId) {
    await handlePublish(orgId, settings).catch(() => {});
  }

  notifyPayrollComplete(orgId, result.runId, result, m, y).catch(() => {});

  if (settings.payslip_auto_email && result.runId) {
    const emailCheck = await pool.query(
      `SELECT 1 FROM payroll_email_log WHERE payroll_run_id = $1 AND organization_id = $2 AND status = 'sent' LIMIT 1`,
      [result.runId, orgId]
    ).catch(() => ({ rows: [] }));

    if (!emailCheck.rows.length) {
      sendPayslipsBatch({ organizationId: orgId, runId: result.runId, month: m, year: y })
        .catch(() => {});
    }
  }

  return { ...result, schedulerRunId: schedulerRunId || null };
}

// ═════════════════════════════════════════════════════════════════════════════
// STARTUP
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Starts the hourly scheduler. Aligns the first tick to the next whole hour
 * so that org time-of-day checks are always evaluated at clean hour boundaries.
 *
 * Called from server.js after the database is ready.
 */
function start() {
  if (process.env.PAYROLL_SCHEDULER_ENABLED === 'false') {
    console.log('[Scheduler] Payroll scheduler disabled (PAYROLL_SCHEDULER_ENABLED=false)');
    return;
  }

  function msUntilNextHour() {
    const now  = new Date();
    const next = new Date(now);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    return Math.max(next - now, 0);
  }

  // Self-scheduling tick — waits for each run to complete before scheduling the next
  function tick() {
    runPayrollScheduler()
      .catch(e => console.error('[Scheduler] Tick error:', e.message))
      .finally(() => setTimeout(tick, INTERVAL_MS));
  }

  // Align first run to next hour boundary
  setTimeout(tick, msUntilNextHour());

  const intervalMin = Math.round(INTERVAL_MS / 60000);
  console.log(`[Scheduler] Payroll scheduler active — runs every ${intervalMin}m, next tick at next hour boundary`);
}

module.exports = {
  start,
  runPayrollScheduler,
  triggerManual,
  // Exported for unit testing
  shouldGenerate,
  shouldPublish,
  shouldEmail,
  resolveDay,
  resolveLastWorkingDay,
  resolveLastCalendarDay,
  nowIn,
};
