require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const SERVER_VERSION = '3.0.0-restructured';
const express  = require('express');
const path     = require('path');

const { seed }         = require('./config/db');
const { ALLOWED_ORIGINS } = require('./middleware/auth');
const { featureGate }  = require('./middleware/featureFlag');
const { rateLimiter, LIMITS } = require('./middleware/rateLimiter');
const { maintenanceMiddleware } = require('./middleware/maintenanceMode');
const { biometricSnGuard, biometricAuditLog } = require('./middleware/biometricSecurity');
const { scheduleDailyAt, scheduleEveryMinutes, runDailyNotifications, runAutoMarkAbsent, runProbationExpiryCheck, runResignationExpiry, runScheduledAnnouncementPublisher, runEarlyLeaveAutoCheckout } = require('./utils/cronJobs');
const payrollScheduler          = require('./services/payrollScheduler');
const attendanceEmailScheduler  = require('./services/attendanceEmailScheduler');

// ── Module routers (extracted from old server.js) ────────────────────────────
const authRouter       = require('./modules/auth/auth.routes');
const orgRouter        = require('./modules/org/org.routes');
const platformRouter   = require('./modules/platform/platform.routes');
const dashboardRouter  = require('./modules/dashboard/dashboard.routes');
const employeesRouter  = require('./modules/employees/employees.routes');
const attendanceRouter = require('./modules/attendance/attendance.routes');
const leavesRouter     = require('./modules/leaves/leaves.routes');
const pushRouter       = require('./modules/push/push.routes');
const calendarRouter   = require('./modules/calendar/calendar.routes');
const archivesRouter   = require('./modules/archives/archives.routes');
const settingsRouter   = require('./modules/settings/settings.routes');
const analyticsRouter  = require('./modules/analytics/analytics.routes');
const rootRouter       = require('./modules/root/root.routes');

// ── Route-file routers (migrated from routes/) ───────────────────────────────
const departmentsRouter    = require('./modules/departments/departments.routes');
const designationsRouter   = require('./modules/designations/designations.routes');
const holidaysRouter       = require('./modules/holidays/holidays.routes');
const leavePoliciesRouter  = require('./modules/leave-policies/leavePolicies.routes');
const regularizationRouter = require('./modules/regularization/regularization.routes');
const notificationsRouter  = require('./modules/notifications/notifications.routes');
const reportsRouter        = require('./modules/reports/reports.routes');
const documentsRouter      = require('./modules/documents/documents.routes');
const docRequirementsRouter = require('./modules/documents/doc_requirements.routes');
const payrollRouter        = require('./modules/payroll/payroll.routes');
const assetsRouter         = require('./modules/assets/assets.routes');
const expensesRouter       = require('./modules/expenses/expenses.routes');
const announcementsRouter  = require('./modules/announcements/announcements.routes');
const shiftsRouter         = require('./modules/shifts/shifts.routes');
const performanceRouter    = require('./modules/performance/performance.routes');
const onboardingRouter     = require('./modules/onboarding/onboarding.routes');
const offboardingRouter    = require('./modules/offboarding/offboarding.routes');
const exitRouter           = require('./modules/exit/exit.routes');
const branchesRouter       = require('./modules/branches/branches.routes');
const biometricRouter        = require('./modules/biometric/biometric.routes');
const biometricPush          = require('./modules/biometric/biometricPush.handler');
const biometricHeartbeat     = require('./modules/biometric/biometricHeartbeat.handler');
const biometricDeviceCmd     = require('./modules/biometric/biometricDeviceCmd.handler');
const biometricAutoScheduler = require('./modules/biometric/biometricAutoSyncScheduler');

// ── Phase 1: RBAC ─────────────────────────────────────────────────────────────
const rolesRouter          = require('./modules/roles/roles.routes');
const permissionsRouter    = require('./modules/permissions/permissions.routes');

// ── Employee Profile V2 ───────────────────────────────────────────────────────
const profileOverview      = require('./modules/employee-profile/overview.routes');
const profilePersonal      = require('./modules/employee-profile/personal.routes');
const profileProfessional  = require('./modules/employee-profile/professional.routes');
const profileFamily        = require('./modules/employee-profile/family.routes');
const profileEmergency     = require('./modules/employee-profile/emergency-contacts.routes');
const profileEducation     = require('./modules/employee-profile/education.routes');
const profileExperience    = require('./modules/employee-profile/experience.routes');
const profileSkills        = require('./modules/employee-profile/skills.routes');
const profileBanking       = require('./modules/employee-profile/banking.routes');
const profileNominees      = require('./modules/employee-profile/nominees.routes');
const profileGovDocs       = require('./modules/employee-profile/government-docs.routes');
const profileImmigration   = require('./modules/employee-profile/immigration.routes');
const profileStatutory     = require('./modules/employee-profile/statutory.routes');
const profileHealth        = require('./modules/employee-profile/health.routes');
const profileTraining      = require('./modules/employee-profile/training.routes');
const profileCerts         = require('./modules/employee-profile/certifications.routes');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Core middleware ───────────────────────────────────────────────────────────
// Capture raw ATTLOG body at stream level BEFORE any body parser touches it.
// ZKTeco firmware sends mixed content (URL-encoded params + raw tab-separated
// ATTLOG lines) that confuses express.text/express.urlencoded Content-Type
// detection, causing req.body = {}. This raw capture bypasses that entirely.
app.use('/iclock/cdata', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    req._rawAttlog = Buffer.concat(chunks).toString('utf-8');
    next();
  });
  req.on('error', next);
});
app.use('/iclock/', express.text({ type: '*/*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '../../public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    }
  },
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Branch-Id');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Health / status (always available — before maintenance gate) ──────────────
app.get('/health', (req, res) => {
  const maintenance = process.env.MAINTENANCE_MODE === 'true';
  if (!maintenance) return res.status(200).json({ status: 'ok' });
  return res.status(200).json({
    status: 'maintenance',
    bypassAvailable: process.env.MAINTENANCE_ADMIN_BYPASS === 'true',
    message: process.env.MAINTENANCE_MESSAGE || null,
  });
});
app.get('/status', (req, res) => res.redirect('/health'));

// ── Maintenance Mode (blocks all /api/* requests when MAINTENANCE_MODE=true) ──
app.use(maintenanceMiddleware);

// ── General API rate limit (300 req/min per IP — catches scripted abuse) ──────
app.use('/api', rateLimiter(LIMITS.GENERAL_API));

// ── Feature gate (runs before every /api route) ───────────────────────────────
app.use('/api', featureGate);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',           authRouter);
app.use('/api',                orgRouter);         // register-org + org/settings live at /api/register-org and /api/org/settings
app.use('/api/platform',       platformRouter);
app.use('/api/dashboard',      dashboardRouter);
app.use('/api/employees',      employeesRouter);
app.use('/api/attendance',     attendanceRouter);
app.use('/api/leaves',         leavesRouter);

// ── Route aliases (frontend uses short paths, routers are mounted with prefixes) ──
app.use('/api/team-leaves', (req, res, next) => {
  req.url = '/team' + (Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '');
  leavesRouter(req, res, next);
});
app.use('/api/culture', (req, res, next) => {
  req.url = '/culture' + (Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '');
  calendarRouter(req, res, next);
});
app.use('/api/my-stats', (req, res, next) => {
  req.url = '/my-stats' + (Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '');
  analyticsRouter(req, res, next);
});
app.use('/api/new-joiners', (req, res, next) => {
  req.url = '/new-joiners' + (Object.keys(req.query).length ? '?' + new URLSearchParams(req.query).toString() : '');
  analyticsRouter(req, res, next);
});
app.use('/api/push',           pushRouter);
app.use('/api/calendar',       calendarRouter);
app.use('/api/admin',          archivesRouter);
app.use('/api/settings',       settingsRouter);
app.use('/api/analytics',      analyticsRouter);
app.use('/api/root',           rootRouter);

app.use('/api/departments',    departmentsRouter);
app.use('/api/designations',   designationsRouter);
app.use('/api/holidays',       holidaysRouter);
app.use('/api/leave-policies', leavePoliciesRouter);
app.use('/api/regularization', regularizationRouter);
app.use('/api/notifications',  notificationsRouter);
app.use('/api/reports',        reportsRouter);
app.use('/api/documents',      documentsRouter);
app.use('/api/doc-requirements', docRequirementsRouter);
app.use('/api/payroll',        payrollRouter);
app.use('/api/assets',         assetsRouter);
app.use('/api/expenses',       expensesRouter);
app.use('/api/announcements',  announcementsRouter);
app.use('/api/shifts',         shiftsRouter);
app.use('/api/performance',    performanceRouter);
app.use('/api/onboarding',     onboardingRouter);
app.use('/api/offboarding',    offboardingRouter);
app.use('/api/exit',           exitRouter);
app.use('/api/branches',       branchesRouter);
app.use('/api/biometric',      biometricRouter);

// ── Phase 1: RBAC routes ──────────────────────────────────────────────────────
app.use('/api/roles',          rolesRouter);
app.use('/api/permissions',    permissionsRouter);

// ── Phase 3.7: Statutory Compliance ──────────────────────────────────────────
const statutoryRouter = require('./modules/statutory/statutory.routes');
app.use('/api/statutory', statutoryRouter);

// ── Employee Profile V2 routes ────────────────────────────────────────────────
app.use('/api/profile',        profileOverview);
app.use('/api/profile',        profilePersonal);
app.use('/api/profile',        profileProfessional);
app.use('/api/profile',        profileFamily);
app.use('/api/profile',        profileEmergency);
app.use('/api/profile',        profileEducation);
app.use('/api/profile',        profileExperience);
app.use('/api/profile',        profileSkills);
app.use('/api/profile',        profileBanking);
app.use('/api/profile',        profileNominees);
app.use('/api/profile',        profileGovDocs);
app.use('/api/profile',        profileImmigration);
app.use('/api/profile',        profileStatutory);
app.use('/api/profile',        profileHealth);
app.use('/api/profile',        profileTraining);
app.use('/api/profile',        profileCerts);

// ── ADMS endpoints — no JWT auth (ZKTeco devices cannot send JWT) ─────────────
// Security layers: rate limit → SN allowlist → audit log → handler
app.use('/iclock/', rateLimiter(LIMITS.BIOMETRIC), biometricAuditLog, biometricSnGuard);
app.post('/iclock/cdata',       biometricPush);
app.get('/iclock/cdata',        (req, res) => res.send('OK'));
app.get('/iclock/getrequest',   biometricHeartbeat);
app.post('/iclock/devicecmd',   biometricDeviceCmd);  // device posts command results here

// ── Platform admin SPA (served at /admin/*) ───────────────────────────────────
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../../public/admin', 'index.html')));
app.get('/admin/*', (req, res) => res.sendFile(path.join(__dirname, '../../public/admin', 'index.html')));

// ── Frontend fallback (SPA — must be last) ────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function runStartupMigrations() {
  const { pool } = require('./config/db');
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_credentials_sent_at TIMESTAMPTZ`,
    `ALTER TABLE employee_salary_structures ADD COLUMN IF NOT EXISTS retention NUMERIC DEFAULT 0`,
    `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in TEXT`,
    `ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_out TEXT`,
    // Bug-117: branch scope for custom roles (system roles stay org-wide)
    `ALTER TABLE roles ADD COLUMN IF NOT EXISTS branch_id BIGINT`,
    // Auto-sync config table (2026-08-27) — org_id BIGINT to match organizations.id
    `CREATE TABLE IF NOT EXISTS biometric_auto_sync_config (
      id BIGSERIAL PRIMARY KEY,
      org_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      enabled BOOLEAN NOT NULL DEFAULT false,
      frequency TEXT NOT NULL DEFAULT 'day' CHECK (frequency IN ('day','week','month')),
      sync_time_1 TEXT NOT NULL DEFAULT '10:00',
      sync_time_2 TEXT DEFAULT '17:00',
      last_sync_at TIMESTAMPTZ,
      last_sync_date DATE,
      last_sync_status TEXT DEFAULT 'never',
      last_sync_error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_auto_sync_config_org ON biometric_auto_sync_config(org_id)`,
    // Mark auto-triggered jobs in the existing historical sync table
    `ALTER TABLE biometric_historical_sync_jobs ADD COLUMN IF NOT EXISTS auto_triggered BOOLEAN DEFAULT false`,
    // BUG_242: scheduled announcements — publish-time gating + one-shot notify flag
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL`,
    `ALTER TABLE announcements ADD COLUMN IF NOT EXISTS published_notified BOOLEAN NOT NULL DEFAULT false`,
    // Expense duplicate filename tracking
    `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_filename TEXT DEFAULT NULL`,
    // BUG_155: exit_requests clearance + notes columns (missing from full_schema.sql baseline)
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`,
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS exit_interview_notes TEXT DEFAULT ''`,
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS clearance_it BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS clearance_hr BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS clearance_finance BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS clearance_admin BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS rehire_eligible TEXT DEFAULT NULL`,
    `ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT NULL`,
    // BUG_155: offboarding_checklists table (phase_d migration — idempotent)
    `CREATE TABLE IF NOT EXISTS offboarding_checklists (
      id               BIGSERIAL PRIMARY KEY,
      user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      organization_id  BIGINT NOT NULL,
      title            TEXT NOT NULL,
      description      TEXT DEFAULT '',
      due_date         DATE,
      assigned_to      TEXT NOT NULL DEFAULT 'hr'
                       CHECK (assigned_to IN ('employee','hr','it','manager','finance')),
      order_index      INTEGER NOT NULL DEFAULT 99,
      completed        BOOLEAN NOT NULL DEFAULT FALSE,
      completed_at     TIMESTAMPTZ,
      completed_by     BIGINT REFERENCES users(id),
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS offboarding_checklists_user_idx ON offboarding_checklists(user_id)`,
    `CREATE INDEX IF NOT EXISTS offboarding_checklists_org_idx  ON offboarding_checklists(organization_id)`,
    // Bug-004/048: backfill regularization actual check-in/out from attendance (idempotent)
    `ALTER TABLE attendance_regularization ADD COLUMN IF NOT EXISTS actual_check_in  VARCHAR(8)`,
    `ALTER TABLE attendance_regularization ADD COLUMN IF NOT EXISTS actual_check_out VARCHAR(8)`,
    `UPDATE attendance_regularization ar
       SET actual_check_in  = COALESCE(ar.actual_check_in,  a.check_in),
           actual_check_out = COALESCE(ar.actual_check_out, a.check_out)
      FROM attendance a
     WHERE ar.user_id = a.user_id
       AND ar.date = a.date
       AND ar.organization_id = a.organization_id
       AND (ar.actual_check_in IS NULL OR ar.actual_check_out IS NULL)
       AND (a.check_in IS NOT NULL OR a.check_out IS NOT NULL)`,
  ];
  for (const sql of migrations) {
    await pool.query(sql).catch(e => console.warn('[startup-migration] skipped:', e.message));
  }
}

async function start() {
  try {
    await seed();
    await runStartupMigrations();
    app.listen(PORT, () => {
      console.log(`\n🚀 Lumos HRMS v${SERVER_VERSION} running at http://localhost:${PORT}\n`);
    });
    scheduleDailyAt(8, 0, runDailyNotifications);
    // BUG_072: Auto-mark absent at 23:30 nightly — marks employees with no check-in and no leave as absent
    scheduleDailyAt(23, 30, runAutoMarkAbsent);
    // Probation expiry: promote probation→active at 00:05 daily
    scheduleDailyAt(0, 5, runProbationExpiryCheck);
    // Resignation expiry: transition resigned→inactive after last_working_day at 00:10 daily
    scheduleDailyAt(0, 10, runResignationExpiry);
    // BUG_242: publish scheduled announcements whose time has arrived (every 5 min)
    scheduleEveryMinutes(5, runScheduledAnnouncementPublisher);
    // BUG_092: auto-checkout employees at their approved early-leave exit time (every 1 min)
    scheduleEveryMinutes(1, runEarlyLeaveAutoCheckout);
    payrollScheduler.start();
    // Automatic EasyWDMS → HRMS biometric sync (per-org configurable schedule)
    biometricAutoScheduler.start().catch(err =>
      console.error('[auto-sync] Scheduler init error:', err.message)
    );
    // Attendance email automation (late check-in, daily summary, appreciation)
    attendanceEmailScheduler.start();
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();
