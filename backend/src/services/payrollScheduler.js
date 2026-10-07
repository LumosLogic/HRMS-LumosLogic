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
const { isBranchFeatureEnabled }              = require('./branchService');
const { generatePayrollRun, GenerationError, isPeriodComplete } = require('./payrollGenerationService');
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
    // The current month is, by definition, not complete yet — payroll is never generated for an incomplete period.
    return null;
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

// ═════════════════════════════════════════════════
// BRANCH-AWARE GENERATION
// ═════════════════════════════════════════════════
//
// Branch feature OFF (or no active branch)  → one ORGANISATION-WIDE run, exactly as before.
// Branch feature ON  (≥1 active branch)     → one run PER ACTIVE BRANCH, scoped to that branch's employees.
//                                             An organisation-wide run is never created here: it would
//                                             overlap (duplicate payslips for) the branch runs.

let _branchSchedCols = { value: null, exp: 0 };
/** payroll_scheduler_runs.branch_id (and the per-branch unique index) exist → branch runs are supported. */
async function branchSchedulerRunsSupported() {
  if (_branchSchedCols.value !== null && _branchSchedCols.exp > Date.now()) return _branchSchedCols.value;
  let value = false;
  try {
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema()
            AND table_name IN ('payroll_scheduler_runs', 'payroll_runs') AND column_name = 'branch_id')::int AS cols`);
    value = rows[0].cols === 2;
  } catch { value = false; }
  _branchSchedCols = { value, exp: Date.now() + 60 * 1000 };
  return value;
}

/** Active branch ids when this org runs payroll per branch; null when it runs one org-wide run. */
async function getBranchRunTargets(orgId) {
  try {
    if (!(await isBranchFeatureEnabled(orgId))) return null;
    const { rows } = await pool.query('SELECT id FROM branches WHERE org_id = $1 AND is_active = TRUE ORDER BY id', [orgId]);
    if (!rows.length) return null;
    if (!(await branchSchedulerRunsSupported())) return null;
    return rows.map(r => Number(r.id));
  } catch { return null; }
}

/** Employees that exist in the org but belong to NO branch — a branch-scoped payroll would skip them. */
async function countUnassignedEmployees(orgId) {
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS c FROM users
        WHERE organization_id = $1 AND role = 'employee' AND branch_id IS NULL
          AND (employee_status IS NULL OR employee_status NOT IN ('inactive','resigned','terminated'))`, [orgId]);
    return rows[0].c;
  } catch { return 0; }
}

/**
 * Generates ONE branch's payroll run. Safe to call repeatedly:
 *   - payroll_scheduler_runs (UNIQUE per org+branch+period) is the distributed mutex
 *   - an existing org-wide run for the period blocks branch generation (no overlap)
 *   - generatePayrollRun itself refuses a second run for the same branch+period (PAYROLL_EXISTS)
 * Returns { branchId, status: 'generated'|'skipped'|'failed', runId?, reason? }.
 */
async function generateBranchRun({ orgId, branchId, month, year, triggeredBy = 'scheduler', actorId = null, actorName = null, force = false }) {
  // Overlap guard: an org-wide (branch_id NULL) run for this period already covers this branch's employees.
  const { rows: orgWide } = await pool.query(
    `SELECT id FROM payroll_runs
      WHERE organization_id = $1 AND branch_id IS NULL AND month = $2 AND year = $3
        AND status NOT IN ('failed', 'cancelled') LIMIT 1`, [orgId, month, year]);
  if (orgWide.length) return { branchId, status: 'skipped', reason: 'An organisation-wide payroll run already exists for this period.' };

  let schedulerRunId = null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO payroll_scheduler_runs
         (organization_id, branch_id, run_date, pay_month, pay_year, status, triggered_by, triggered_actor)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, 'running', $5, $6)
       ON CONFLICT (organization_id, branch_id, pay_month, pay_year) WHERE branch_id IS NOT NULL DO UPDATE
          SET status = 'running', triggered_by = EXCLUDED.triggered_by, triggered_actor = EXCLUDED.triggered_actor,
              run_date = CURRENT_DATE, created_at = NOW(), completed_at = NULL, error_message = NULL, payroll_run_id = NULL
        WHERE $7::boolean AND payroll_scheduler_runs.status <> 'running'
       RETURNING id`,
      [orgId, branchId, month, year, triggeredBy, actorName || (actorId != null ? String(actorId) : null), triggeredBy === 'manual']);
    if (!rows.length) return { branchId, status: 'skipped', reason: 'Already generated or in progress for this period.' };
    schedulerRunId = rows[0].id;
  } catch (err) {
    if (err.code === '23505') return { branchId, status: 'skipped', reason: 'Already generated or in progress for this period.' };
    throw err;
  }

  try {
    const { rows: emps } = await pool.query(
      `SELECT id FROM users WHERE organization_id = $1 AND branch_id = $2 AND role = 'employee'`, [orgId, branchId]);
    if (!emps.length) {
      await pool.query(`UPDATE payroll_scheduler_runs SET status = 'skipped', error_message = 'No employees in branch', completed_at = NOW() WHERE id = $1`, [schedulerRunId]);
      return { branchId, status: 'skipped', reason: 'No employees in this branch.' };
    }
    const result = await generatePayrollRun({
      organizationId: orgId, month, year,
      generatedBy: actorId,                       // null for the scheduler
      notes: triggeredBy === 'manual' ? `Manually triggered by ${actorName || actorId}` : 'Auto-generated by payroll scheduler',
      force, ip: null,
      employeeIds: emps.map(e => Number(e.id)),
      branchId,
    });
    await pool.query(
      `UPDATE payroll_scheduler_runs SET status = $1, payroll_run_id = $2, completed_at = NOW() WHERE id = $3`,
      [result.status === 'failed' ? 'failed' : 'completed', result.runId, schedulerRunId]);
    notifyPayrollComplete(orgId, result.runId, result, month, year).catch(() => {});
    return { branchId, status: 'generated', runId: result.runId, result };
  } catch (err) {
    const isSkip = err instanceof GenerationError && ['PAYROLL_EXISTS', 'PERIOD_INCOMPLETE'].includes(err.code);
    await pool.query(
      `UPDATE payroll_scheduler_runs SET status = $1, error_message = $2, completed_at = NOW() WHERE id = $3`,
      [isSkip ? 'skipped' : 'failed', (err.message || '').substring(0, 500), schedulerRunId]).catch(() => {});
    if (!isSkip) {
      console.error(`[Scheduler] Branch ${branchId} gen failed org ${orgId} ${month}/${year}:`, err.message);
      notifyPayrollFailed(orgId, `Branch ${branchId}: ${err.message}`, month, year).catch(() => {});
    }
    return { branchId, status: isSkip ? 'skipped' : 'failed', reason: err.message };
  }
}

/** Branch-enabled organisations: one run per active branch. */
async function handleBranchGeneration(orgId, branchIds, { payMonth, payYear }) {
  console.log(`[Scheduler] Org ${orgId} — generating ${payMonth}/${payYear} per branch (${branchIds.length} branch(es))`);
  const unassigned = await countUnassignedEmployees(orgId);
  if (unassigned > 0) {
    const msg = `${unassigned} active employee(s) have no branch and are NOT included in any branch payroll run. Assign them to a branch.`;
    console.warn(`[Scheduler] Org ${orgId}: ${msg}`);
    notifyPayrollFailed(orgId, msg, payMonth, payYear).catch(() => {});
  }
  const results = [];
  for (const branchId of branchIds) {
    results.push(await generateBranchRun({ orgId, branchId, month: payMonth, year: payYear }).catch(err => ({ branchId, status: 'failed', reason: err.message })));
  }
  return results;
}

/**
 * Entry point for scheduled generation: routes to the org-wide path (branch feature OFF — behaviour
 * unchanged) or to one run per branch (branch feature ON).
 */
async function handleGeneration(orgId, settings, target) {
  const branchIds = await getBranchRunTargets(orgId);
  if (branchIds) return handleBranchGeneration(orgId, branchIds, target);
  return handleOrgWideGeneration(orgId, settings, target);
}

/**
 * Attempts to generate payroll for the target period.
 * Uses the payroll_scheduler_runs UNIQUE constraint as a distributed mutex.
 */
async function handleOrgWideGeneration(orgId, settings, { payMonth, payYear }) {
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
    const isSkip     = err instanceof GenerationError && ['PAYROLL_EXISTS', 'PERIOD_INCOMPLETE'].includes(err.code);
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
async function triggerManual({ organizationId, month, year, force = false, actorId, actorName, branchId = null }) {
  const orgId = Number(organizationId);
  const m     = Number(month);
  const y     = Number(year);
  const name  = actorName || String(actorId);

  // A manual trigger must not create a partial run for a month that has not finished yet.
  if (!isPeriodComplete(m, y)) {
    throw new GenerationError(
      `Payroll for ${String(m).padStart(2, '0')}/${y} cannot be generated until the payroll period is complete.`,
      'PERIOD_INCOMPLETE'
    );
  }

  // Branch-enabled organisation: payroll is per branch. `branchId` runs ONE branch (the caller's access to
  // it is verified by the route); without it, every active branch is run (all-branch callers only —
  // also enforced by the route). An organisation-wide run is never created here.
  const branchTargets = await getBranchRunTargets(orgId);
  if (branchTargets) {
    const ids = branchId != null ? [Number(branchId)] : branchTargets;
    if (branchId != null && !branchTargets.includes(Number(branchId))) {
      throw new GenerationError('Branch not found or inactive', 'INVALID_BRANCH');
    }
    const results = [];
    for (const id of ids) {
      results.push(await generateBranchRun({ orgId, branchId: id, month: m, year: y, triggeredBy: 'manual', actorId, actorName: name, force }));
    }
    const { rows: st } = await pool.query(`SELECT auto_publish, payslip_auto_email FROM payroll_settings WHERE organization_id = $1`, [orgId]).catch(() => ({ rows: [] }));
    const s = st[0] || {};
    if (s.auto_publish && results.some(r => r.runId)) await handlePublish(orgId, s).catch(() => {});
    if (s.payslip_auto_email) {
      for (const r of results.filter(x => x.runId)) {
        const emailCheck = await pool.query(
          `SELECT 1 FROM payroll_email_log WHERE payroll_run_id = $1 AND organization_id = $2 AND status = 'sent' LIMIT 1`, [r.runId, orgId]).catch(() => ({ rows: [] }));
        if (!emailCheck.rows.length) sendPayslipsBatch({ organizationId: orgId, runId: r.runId, month: m, year: y }).catch(() => {});
      }
    }
    return { branches: results.map(({ result, ...rest }) => rest), status: results.every(r => r.status === 'generated') ? 'completed' : 'partial' };
  }

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
  generateBranchRun,
  getBranchRunTargets,
  handleGeneration,
  // Exported for unit testing
  shouldGenerate,
  shouldPublish,
  shouldEmail,
  resolveDay,
  resolveLastWorkingDay,
  resolveLastCalendarDay,
  nowIn,
};
