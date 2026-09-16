-- ============================================================
-- Phase 2B-6A: Payroll Runs Branch Architecture — Schema Only
-- Version:  2026_09_16_02
-- Date:     2026-09-16
-- Depends:  phase3_03_payroll_generation.sql
--           phase3_05_automation.sql
--           add_hr_branch_access_2026_09_16.sql  (branches table must exist)
--
-- PURPOSE
-- ───────
-- Adds branch_id to payroll_runs and payroll_scheduler_runs so that
-- the schema can represent both organisation-wide and branch-specific
-- payroll runs without breaking any existing behaviour.
--
-- SEMANTICS
-- ─────────
--   branch_id IS NULL  →  organisation-wide run  (all existing rows + legacy default)
--   branch_id IS NOT NULL  →  branch-specific run  (new capability, not yet used)
--
-- This migration is SCHEMA-ONLY.
--   - No payroll generation logic is changed.
--   - No routes are modified.
--   - No frontend changes are made.
--   - No existing payroll_runs rows are given a branch_id.
--   - No historical branch ownership is inferred or guessed.
--
-- BACKWARD COMPATIBILITY
-- ──────────────────────
-- All existing payroll_runs rows have branch_id = NULL after this migration.
-- The new partial unique indexes enforce exactly the same uniqueness rules
-- as the old constraints for rows where branch_id IS NULL, so no data
-- integrity violation is introduced.
--
-- The scheduler continues to create branch_id = NULL runs — its behaviour
-- is unchanged until Phase 2B-6B.
--
-- SAFE TO RUN ONCE
-- ────────────────
-- ADD COLUMN IF NOT EXISTS and CREATE INDEX IF NOT EXISTS are idempotent.
-- DROP CONSTRAINT IF EXISTS is safe when the constraint is already gone.
-- If this migration is run a second time it will succeed without side-effects.
-- ============================================================

BEGIN;

-- ── 0. Version tracking ───────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, description)
VALUES
    ('2026_09_16_02_a', 'Added branch_id to payroll_runs; replaced uq_payroll_run_period with partial unique indexes'),
    ('2026_09_16_02_b', 'Added branch_id to payroll_scheduler_runs; replaced uq_psr_org_period with partial unique indexes')
ON CONFLICT (version) DO NOTHING;


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 1 — payroll_runs
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1a. Add branch_id column ──────────────────────────────────────────────────
-- NULL by default — all existing rows remain branch_id = NULL (org-wide).
-- ON DELETE RESTRICT: a branch cannot be deleted while it owns a payroll run.
-- Application-level org scoping continues to ensure the branch belongs to the
-- correct organisation (that enforcement lives in the route layer, not here).
ALTER TABLE payroll_runs
    ADD COLUMN IF NOT EXISTS branch_id BIGINT
        REFERENCES branches(id) ON DELETE RESTRICT;

COMMENT ON COLUMN payroll_runs.branch_id IS
    'NULL = organisation-wide payroll run (legacy + intentional all-org). '
    'NOT NULL = run was generated for this specific branch only. '
    'Historical runs were never tagged to a branch and must not be updated.';

-- ── 1b. Remove the old organisation/month/year unique constraint ─────────────
-- The constraint is named uq_payroll_run_period (defined in phase3_03).
-- We replace it with two partial unique indexes below that enforce the same
-- rule for NULL rows and add an equivalent rule for non-NULL branch rows.
ALTER TABLE payroll_runs
    DROP CONSTRAINT IF EXISTS uq_payroll_run_period;

-- ── 1c. Partial unique index — organisation-wide runs (branch_id IS NULL) ────
-- Enforces: at most one org-wide run per organisation per pay period.
-- Covers ALL existing rows (they all have branch_id = NULL).
-- Equivalent to the old uq_payroll_run_period for existing data.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_run_org_wide
    ON payroll_runs (organization_id, month, year)
    WHERE branch_id IS NULL;

-- ── 1d. Partial unique index — branch-specific runs (branch_id IS NOT NULL) ──
-- Enforces: at most one branch run per organisation per branch per pay period.
-- Applies only to future branch-specific rows; does not touch existing data.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_run_branch
    ON payroll_runs (organization_id, branch_id, month, year)
    WHERE branch_id IS NOT NULL;

-- ── 1e. Branch lookup index ───────────────────────────────────────────────────
-- Supports future queries that filter or list runs by branch.
-- Also used once payroll history UI is made branch-aware.
CREATE INDEX IF NOT EXISTS idx_payroll_runs_branch
    ON payroll_runs (organization_id, branch_id, year DESC, month DESC);


-- ══════════════════════════════════════════════════════════════════════════════
-- PART 2 — payroll_scheduler_runs
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 2a. Add branch_id column ──────────────────────────────────────────────────
-- NULL by default — all existing scheduler run rows remain branch_id = NULL.
-- ON DELETE RESTRICT: same protection as payroll_runs.
ALTER TABLE payroll_scheduler_runs
    ADD COLUMN IF NOT EXISTS branch_id BIGINT
        REFERENCES branches(id) ON DELETE RESTRICT;

COMMENT ON COLUMN payroll_scheduler_runs.branch_id IS
    'NULL = scheduler run covered all org employees (current behaviour). '
    'NOT NULL = scheduler run was scoped to this branch (future capability). '
    'The scheduler continues to create NULL rows until Phase 2B-6B is deployed.';

-- ── 2b. Remove the old organisation/month/year unique constraint ─────────────
-- Named uq_psr_org_period (defined in phase3_05).
-- Replaced by the two partial indexes below.
ALTER TABLE payroll_scheduler_runs
    DROP CONSTRAINT IF EXISTS uq_psr_org_period;

-- ── 2c. Partial unique index — org-wide scheduler runs (branch_id IS NULL) ───
-- Preserves the distributed-mutex behaviour of the old unique constraint for
-- the scheduler: only one org-wide automated run per organisation per period.
-- All existing rows are covered by this index (all have branch_id = NULL).
CREATE UNIQUE INDEX IF NOT EXISTS uq_psr_org_wide
    ON payroll_scheduler_runs (organization_id, pay_month, pay_year)
    WHERE branch_id IS NULL;

-- ── 2d. Partial unique index — branch scheduler runs (branch_id IS NOT NULL) ─
-- Future: one automated run per branch per period.
-- Does not affect any existing rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_psr_branch
    ON payroll_scheduler_runs (organization_id, branch_id, pay_month, pay_year)
    WHERE branch_id IS NOT NULL;

-- ── 2e. Branch lookup index ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_psr_branch
    ON payroll_scheduler_runs (organization_id, branch_id, created_at DESC);


-- ══════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (read-only — safe to run at any time after migration)
-- ══════════════════════════════════════════════════════════════════════════════
--
-- Run these manually after applying the migration to confirm correctness.
-- None of these modify any data.
--
-- 1. Confirm branch_id column exists on payroll_runs:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'payroll_runs' AND column_name = 'branch_id';
--    Expected: column_name=branch_id, data_type=bigint, is_nullable=YES, column_default=NULL
--
-- 2. Confirm branch_id column exists on payroll_scheduler_runs:
--    SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--    WHERE table_name = 'payroll_scheduler_runs' AND column_name = 'branch_id';
--    Expected: column_name=branch_id, data_type=bigint, is_nullable=YES, column_default=NULL
--
-- 3. Confirm ALL existing payroll_runs have branch_id IS NULL:
--    SELECT COUNT(*) AS total_runs,
--           COUNT(*) FILTER (WHERE branch_id IS NULL)     AS org_wide_runs,
--           COUNT(*) FILTER (WHERE branch_id IS NOT NULL) AS branch_runs
--    FROM payroll_runs;
--    Expected: total_runs = org_wide_runs, branch_runs = 0
--
-- 4. Confirm ALL existing payroll_scheduler_runs have branch_id IS NULL:
--    SELECT COUNT(*) AS total,
--           COUNT(*) FILTER (WHERE branch_id IS NULL)     AS org_wide,
--           COUNT(*) FILTER (WHERE branch_id IS NOT NULL) AS branch_scoped
--    FROM payroll_scheduler_runs;
--    Expected: total = org_wide, branch_scoped = 0
--
-- 5. Confirm old unique constraints are gone:
--    SELECT constraint_name
--    FROM information_schema.table_constraints
--    WHERE table_name IN ('payroll_runs', 'payroll_scheduler_runs')
--      AND constraint_type = 'UNIQUE';
--    Expected: uq_payroll_run_period and uq_psr_org_period do NOT appear.
--              (Other unique constraints on these tables are unaffected.)
--
-- 6. Confirm new partial unique indexes exist:
--    SELECT indexname, indexdef
--    FROM pg_indexes
--    WHERE tablename IN ('payroll_runs', 'payroll_scheduler_runs')
--      AND indexname IN (
--          'uq_payroll_run_org_wide', 'uq_payroll_run_branch',
--          'idx_payroll_runs_branch',
--          'uq_psr_org_wide', 'uq_psr_branch', 'idx_psr_branch'
--      );
--    Expected: 6 rows, one per index name above.
--
-- 7. Spot-check that no payslip data was changed:
--    SELECT COUNT(*) FROM payslips;
--    (Compare to count before migration — must be identical.)
--
-- 8. Spot-check that no payroll_run_employees data was changed:
--    SELECT COUNT(*) FROM payroll_run_employees;
--    (Compare to count before migration — must be identical.)
--
-- 9. Confirm the FK from payroll_scheduler_runs to payroll_runs is intact:
--    SELECT COUNT(*) FROM payroll_scheduler_runs psr
--    JOIN payroll_runs pr ON pr.id = psr.payroll_run_id
--    WHERE psr.payroll_run_id IS NOT NULL;
--    Expected: same count as before (no FK violations introduced).

COMMIT;
