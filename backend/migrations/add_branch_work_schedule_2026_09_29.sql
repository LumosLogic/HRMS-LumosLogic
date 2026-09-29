-- ================================================================
-- BUG-115: Branch-specific Work Schedule Override Table
-- Version: 2026_09_29_02
-- Date: 2026-09-29
--
-- Architecture: override, not replacement.
--   work_schedule          = organization default (unchanged, always fallback)
--   branch_work_schedule   = branch-specific override (checked first for branch employees)
--
-- Rule:
--   Employee has branch_id → check branch_work_schedule first
--   No branch override → fall back to work_schedule (org default)
--   Employee has no branch_id → use work_schedule (org default)
--   Branches feature OFF → use work_schedule (org default), unchanged behavior
--
-- Fields mirror work_schedule exactly so the resolver can substitute seamlessly.
--
-- SAFE TO RE-RUN: CREATE TABLE IF NOT EXISTS
-- REVERSIBLE: DROP TABLE branch_work_schedule;
-- Does NOT touch: work_schedule, payroll, attendance, biometric data
-- ================================================================

BEGIN;

INSERT INTO schema_migrations (version, description)
VALUES ('2026_09_29_02', 'Branch-specific work schedule overrides (BUG-115)')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS branch_work_schedule (
  id                           BIGSERIAL    PRIMARY KEY,
  organization_id              BIGINT       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id                    BIGINT       NOT NULL REFERENCES branches(id)      ON DELETE CASCADE,

  -- Mirror of work_schedule fields
  start_time                   TEXT         NOT NULL DEFAULT '09:00',
  end_time                     TEXT         NOT NULL DEFAULT '18:00',
  late_threshold               TEXT                  DEFAULT '09:30',
  early_exit_threshold         TEXT                  DEFAULT '17:00',
  half_day_hours               NUMERIC               DEFAULT 4.5,
  full_day_hours               NUMERIC               DEFAULT 8,
  work_days                    TEXT                  DEFAULT '1,2,3,4,5',
  max_early_leave_count        INTEGER               DEFAULT 3,
  late_entry_threshold_enabled BOOLEAN               DEFAULT TRUE,
  early_exit_threshold_enabled BOOLEAN               DEFAULT TRUE,

  created_at                   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ  DEFAULT NOW(),

  -- One override per branch per org
  UNIQUE (organization_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_work_schedule_org_branch
  ON branch_work_schedule (organization_id, branch_id);

COMMENT ON TABLE branch_work_schedule IS
  'Per-branch work schedule overrides. '
  'Checked BEFORE work_schedule for employees belonging to the branch. '
  'Absence of a row means the branch inherits the org-wide work_schedule.';

COMMIT;
