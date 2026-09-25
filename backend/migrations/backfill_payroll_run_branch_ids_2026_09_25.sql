-- ============================================================
-- Fix: Backfill branch_id on legacy payroll runs (branch_id IS NULL)
-- Bug: Branch X's payroll was visible in Branch Y. Root cause: runs generated
--      with "All Branches" (or before the branch feature existed) are stored
--      with branch_id = NULL, and listing queries included NULL runs in every
--      branch view. Code now filters strictly; this migration tags each legacy
--      run with its real branch (derived from the payslip employees' branch),
--      so it appears in the correct branch view going forward.
--
-- Behaviour:
--   • Runs whose payslip employees all belong to ONE branch  → tagged that branch
--   • Runs whose payslip employees span MULTIPLE branches    → reported below,
--     left NULL (visible only in the "All Branches" view) for manual review
--   • Runs whose employees have no branch at all (pre-branch-feature org) stay NULL
--
-- Safe to re-run: idempotent, only touches rows where branch_id IS NULL.
-- ============================================================

BEGIN;

-- ── Step 0: Safety net — snapshot the rows we are about to change ────────────
-- Enables a one-line rollback (see bottom of this file). Idempotent: re-runs
-- never overwrite existing snapshots, and rows that already have a branch are
-- never touched at all.
CREATE TABLE IF NOT EXISTS payroll_runs_branch_backfill_bak_20260925 (
  id              bigint PRIMARY KEY,
  organization_id bigint,
  month           int,
  year            int,
  branch_id       bigint
);

INSERT INTO payroll_runs_branch_backfill_bak_20260925
SELECT id, organization_id, month, year, branch_id
FROM payroll_runs
WHERE branch_id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ── Step 1: Review ambiguous runs BEFORE backfill (output only, no changes) ──
SELECT pr.id            AS run_id,
       pr.organization_id,
       pr.month,
       pr.year,
       pr.status,
       COUNT(DISTINCT u.branch_id) AS distinct_branches
FROM payroll_runs pr
JOIN payslips ps ON ps.payroll_run_id = pr.id
                AND ps.organization_id = pr.organization_id
JOIN users u     ON u.id = ps.user_id
                AND u.organization_id = ps.organization_id
WHERE pr.branch_id IS NULL
GROUP BY pr.id, pr.organization_id, pr.month, pr.year, pr.status
HAVING COUNT(DISTINCT u.branch_id) > 1
ORDER BY pr.organization_id, pr.year DESC, pr.month DESC;

-- ── Step 2: Backfill unambiguous runs ────────────────────────────────────────
-- A run is unambiguous when ALL of its payslip employees resolve to the same
-- single branch. Employees with branch_id IS NULL are ignored by COUNT/ MIN
-- (NULLs are not counted), so a run mixing one branch + legacy no-branch
-- employees is still tagged that branch — best-guess, matches reality.
--
-- CONFLICT GUARD: skip runs that would collide with an existing branch-specific
-- run for the same (organization, branch, month, year) — the unique constraint
-- uq_payroll_run_branch would reject the whole batch otherwise. Skipped runs
-- stay NULL (visible only in "All Branches") and are reported in Step 2b for
-- manual resolution.
UPDATE payroll_runs pr
SET    branch_id = agg.branch_id
FROM (
  SELECT ps.organization_id,
         ps.payroll_run_id,
         MIN(u.branch_id)::bigint AS branch_id
  FROM payslips ps
  JOIN users u ON u.id = ps.user_id
              AND u.organization_id = ps.organization_id
  WHERE u.branch_id IS NOT NULL
  GROUP BY ps.organization_id, ps.payroll_run_id
  HAVING COUNT(DISTINCT u.branch_id) = 1
) agg
WHERE pr.branch_id IS NULL
  AND pr.organization_id = agg.organization_id
  AND pr.id = agg.payroll_run_id
  AND NOT EXISTS (
        SELECT 1
        FROM payroll_runs dup
        WHERE dup.organization_id = agg.organization_id
          AND dup.branch_id       = agg.branch_id
          AND dup.month           = pr.month
          AND dup.year            = pr.year
          AND dup.id             != pr.id
      );

-- ── Step 2b: Report conflicting runs that were SKIPPED (output only) ─────────
-- These legacy NULL runs cover a branch+month that ALREADY has a dedicated
-- branch-specific run. They were NOT tagged (would duplicate). Review this
-- list: the legacy run is stale data and typically should be voided/deleted
-- after confirming the branch-specific run holds the correct payslips.
SELECT pr.id            AS skipped_run_id,
       pr.organization_id,
       agg.branch_id    AS derived_branch_id,
       pr.month,
       pr.year,
       pr.status,
       pr.employee_count,
       dup.id           AS existing_branch_run_id,
       dup.status       AS existing_branch_run_status
FROM payroll_runs pr
JOIN (
  SELECT ps.organization_id,
         ps.payroll_run_id,
         MIN(u.branch_id)::bigint AS branch_id
  FROM payslips ps
  JOIN users u ON u.id = ps.user_id
              AND u.organization_id = ps.organization_id
  WHERE u.branch_id IS NOT NULL
  GROUP BY ps.organization_id, ps.payroll_run_id
  HAVING COUNT(DISTINCT u.branch_id) = 1
) agg ON agg.organization_id = pr.organization_id
     AND agg.payroll_run_id   = pr.id
JOIN payroll_runs dup
  ON  dup.organization_id = agg.organization_id
  AND dup.branch_id       = agg.branch_id
  AND dup.month           = pr.month
  AND dup.year            = pr.year
  AND dup.id             != pr.id
WHERE pr.branch_id IS NULL
ORDER BY pr.organization_id, pr.year DESC, pr.month DESC;

-- ── Step 3: Record migration ─────────────────────────────────────────────────
INSERT INTO schema_migrations(version, description)
VALUES ('20260925_backfill_payroll_run_branch_ids',
        'Backfill branch_id on legacy NULL-branch payroll runs from payslip employee branches (branch data leak fix)')
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ── Step 4: Post-run verification (run separately after COMMIT) ──────────────
-- a) How many NULL runs remain? (Ambiguous / pre-branch runs — only visible in
--    the "All Branches" view, they no longer leak into branch views.)
--
--   SELECT organization_id, COUNT(*) AS null_branch_runs
--   FROM payroll_runs
--   WHERE branch_id IS NULL
--   GROUP BY organization_id;
--
-- b) Duplicate check: if a branch-specific run was ALREADY generated for a
--    month that also had a legacy NULL run covering the same branch, the
--    backfill will surface them as two runs for the same (branch, month).
--    Reports would sum both until resolved. Review any output:
--
--   SELECT organization_id, branch_id, month, year, COUNT(*) AS run_count
--   FROM payroll_runs
--   WHERE branch_id IS NOT NULL
--   GROUP BY organization_id, branch_id, month, year
--   HAVING COUNT(*) > 1;
--
-- ── ROLLBACK SCRIPT (only if ever needed — restores original NULLs) ─────────
--
--   UPDATE payroll_runs pr
--   SET    branch_id = bak.branch_id
--   FROM   payroll_runs_branch_backfill_bak_20260925 bak
--   WHERE  pr.id = bak.id;
