-- ============================================================
-- branch_separation_2026_10_03.sql
--
-- Full branch-wise separation — the ONLY schema/data changes the work needs.
-- Everything else inherits branch through users.branch_id (no branch_id is added to
-- attendance, leaves, regularization, payslips, expenses, goals or biometric logs).
--
-- 0. prerequisite check            — fails LOUDLY (and changes nothing) if an earlier migration is missing
-- 1. announcements.branch_ids      — announcement branch targeting (NULL = organisation-wide)
-- 2. holidays unique index         — one holiday per day PER SCOPE (org-wide / per branch)
-- 3. biometric.manage / .logs      — grant to the hr_admin system role (matches today's access)
-- 4. configuration groups          — shared work-schedule / leave-policy configuration for several branches
--
-- Safe + idempotent:
--   * only ADDS tables / nullable columns and LOOSENS one unique constraint — no row is changed or deleted
--   * grants use ON CONFLICT DO NOTHING; everything else is IF NOT EXISTS
--   * can be re-run
--
-- Prerequisites (earlier migrations that must already be applied):
--   add_branch_isolation_2026_09_29.sql        (holidays/shifts/leave_policies/assets .branch_id)
--   add_branch_work_schedule_2026_09_29.sql    (branch_work_schedule)
--   add_hr_branch_access_2026_09_16.sql        (hr_branch_access)
--   phase1_01_rbac_tables.sql                  (roles / permissions)
--
-- Apply order: any time BEFORE (or right after) deploying the code. The code degrades safely:
--   - without (1): organisation-wide announcements work; branch-targeted ones return an error
--   - without (2): holidays work except the same date for two scopes
--   - without (3): HR admins keep biometric access through the legacy-compat gate
--   - without (4): everything works except creating configuration groups (the endpoints report the missing table)
--
-- Run:
--   docker cp backend/migrations/branch_separation_2026_10_03.sql lumos_postgres:/tmp/branch_sep.sql
--   docker exec -i lumos_postgres psql -U lumos_admin -d lumos_hrms -v ON_ERROR_STOP=1 -f /tmp/branch_sep.sql
-- ============================================================

BEGIN;

-- 0. Prerequisite check ------------------------------------------------------------------
DO $$
DECLARE missing TEXT := '';
BEGIN
  IF to_regclass('holidays')              IS NULL THEN missing := missing || ' holidays'; END IF;
  IF to_regclass('branch_work_schedule')  IS NULL THEN missing := missing || ' branch_work_schedule(add_branch_work_schedule_2026_09_29)'; END IF;
  IF to_regclass('hr_branch_access')      IS NULL THEN missing := missing || ' hr_branch_access(add_hr_branch_access_2026_09_16)'; END IF;
  IF to_regclass('roles')                 IS NULL THEN missing := missing || ' roles(phase1_01_rbac_tables)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'holidays' AND column_name = 'branch_id')
     THEN missing := missing || ' holidays.branch_id(add_branch_isolation_2026_09_29)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = current_schema() AND table_name = 'leave_policies' AND column_name = 'branch_id')
     THEN missing := missing || ' leave_policies.branch_id(add_branch_isolation_2026_09_29)'; END IF;
  IF missing <> '' THEN
    RAISE EXCEPTION 'branch_separation: prerequisite migration(s) missing:%', missing;
  END IF;
END $$;

-- 1. Announcement branch targeting -------------------------------------------------------
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS branch_ids BIGINT[];

COMMENT ON COLUMN announcements.branch_ids IS
  'NULL / empty = organisation-wide. Otherwise the announcement targets only these branches.';

-- 2. Holidays: unique per scope ------------------------------------------------------------
-- production_db_hardening_2026_07_29.sql created UNIQUE (organization_id, date). Branch-specific
-- holidays (holidays.branch_id) were added later, so the same date could not exist for two
-- branches (or for the org AND a branch). Scope the uniqueness exactly like leave_policies.
DROP INDEX IF EXISTS idx_holidays_org_date_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_org_date_orgwide
  ON holidays (organization_id, date)
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_org_branch_date
  ON holidays (organization_id, branch_id, date)
  WHERE branch_id IS NOT NULL;

-- 3. Biometric RBAC: HR Admin keeps what adminOnly used to give it ---------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (p.module_key, p.action) IN (
  ('biometric', 'view'),
  ('biometric', 'manage'),
  ('biometric', 'logs')
)
WHERE r.slug = 'hr_admin'
  AND r.is_system_role = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Configuration groups ------------------------------------------------------------------
-- Effective configuration, most specific first:
--     branch custom override  >  configuration group  >  organisation default
--
-- A group's configuration is the source of truth (config_group_work_schedule /
-- config_group_leave_policies). It is WRITTEN THROUGH into the existing per-branch rows
-- (branch_work_schedule, leave_policies.branch_id) tagged with group_id, so every existing reader
-- (attendance, payroll, biometric, regularization, leaves) keeps working unchanged.
--   row.group_id IS NULL      → the branch's own custom override (wins; never touched by a group)
--   row.group_id = <group>    → inherited from that group (managed by the group)
--
-- A branch belongs to AT MOST ONE group per domain — enforced by UNIQUE (org_id, domain, branch_id).
CREATE TABLE IF NOT EXISTS config_groups (
  id          BIGSERIAL    PRIMARY KEY,
  org_id      BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain      TEXT         NOT NULL CHECK (domain IN ('work_schedule', 'leave_policies')),
  name        TEXT         NOT NULL,
  created_by  BIGINT,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE (id, domain),
  UNIQUE (org_id, domain, name)
);

CREATE TABLE IF NOT EXISTS config_group_branches (
  group_id    BIGINT  NOT NULL,
  domain      TEXT    NOT NULL,
  org_id      BIGINT  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id   BIGINT  NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, branch_id),
  FOREIGN KEY (group_id, domain) REFERENCES config_groups (id, domain) ON DELETE CASCADE,
  UNIQUE (org_id, domain, branch_id)
);
CREATE INDEX IF NOT EXISTS idx_config_group_branches_branch ON config_group_branches (org_id, branch_id);

CREATE TABLE IF NOT EXISTS config_group_work_schedule (
  group_id                     BIGINT   PRIMARY KEY REFERENCES config_groups(id) ON DELETE CASCADE,
  start_time                   TEXT     NOT NULL DEFAULT '09:00',
  end_time                     TEXT     NOT NULL DEFAULT '18:00',
  late_threshold               TEXT              DEFAULT '09:30',
  early_exit_threshold         TEXT              DEFAULT '17:00',
  half_day_hours               NUMERIC           DEFAULT 4.5,
  full_day_hours               NUMERIC           DEFAULT 8,
  work_days                    TEXT              DEFAULT '1,2,3,4,5',
  max_early_leave_count        INTEGER           DEFAULT 3,
  late_entry_threshold_enabled BOOLEAN           DEFAULT TRUE,
  early_exit_threshold_enabled BOOLEAN           DEFAULT TRUE,
  updated_at                   TIMESTAMPTZ       DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS config_group_leave_policies (
  id                    BIGSERIAL PRIMARY KEY,
  group_id              BIGINT    NOT NULL REFERENCES config_groups(id) ON DELETE CASCADE,
  leave_type            TEXT      NOT NULL,
  label                 TEXT,
  annual_quota          INTEGER   DEFAULT 0,
  carry_forward         BOOLEAN   DEFAULT FALSE,
  max_carry_forward     INTEGER   DEFAULT 0,
  paid                  BOOLEAN   DEFAULT TRUE,
  active                BOOLEAN   DEFAULT TRUE,
  half_day_allowed      BOOLEAN   DEFAULT TRUE,
  requires_approval     BOOLEAN   DEFAULT TRUE,
  require_document      BOOLEAN   DEFAULT FALSE,
  min_notice_days       INTEGER   DEFAULT 0,
  max_consecutive_days  INTEGER   DEFAULT 0,
  description           TEXT      DEFAULT '',
  UNIQUE (group_id, leave_type)
);

-- provenance marker on the existing per-branch rows (NULL = custom override or org default)
ALTER TABLE branch_work_schedule
  ADD COLUMN IF NOT EXISTS group_id BIGINT REFERENCES config_groups(id) ON DELETE CASCADE;
ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS group_id BIGINT REFERENCES config_groups(id) ON DELETE CASCADE;

COMMIT;

-- Verify
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'announcements' AND column_name = 'branch_ids';

SELECT indexname FROM pg_indexes
 WHERE tablename = 'holidays' AND indexname LIKE 'idx_holidays_%';

SELECT r.org_id, p.module_key || '.' || p.action AS permission
  FROM roles r
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p ON p.id = rp.permission_id
 WHERE r.slug = 'hr_admin' AND p.module_key = 'biometric'
 ORDER BY r.org_id, permission;

SELECT table_name FROM information_schema.tables
 WHERE table_schema = current_schema() AND table_name LIKE 'config_group%' ORDER BY 1;
