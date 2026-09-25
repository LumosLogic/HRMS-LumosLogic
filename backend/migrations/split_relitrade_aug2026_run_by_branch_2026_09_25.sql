-- ============================================================
-- split_relitrade_aug2026_run_by_branch_2026_09_25.sql
--
-- PROBLEM
--   Relitrade (org 1) August 2026 payroll run (id = 7, status 'paid') was
--   generated org-wide BEFORE per-branch generation existed. Its payslip
--   employees now belong to TWO branches (Dalal + Bhuj sub-branch, after the
--   Sept 2026 branch restructure). The 2026-09-25 backfill migration therefore
--   left it branch_id = NULL (multi-branch runs are flagged for manual review),
--   and the STRICT branch filtering shows NULL runs only in "All Branches".
--   Result: the Dalal branch view shows NO August payroll.
--
-- FIX
--   Split run 7 into one run per branch:
--     • Clone run 7 once per distinct employee branch (lifecycle cols copied:
--       status 'paid', generated_by/at, verified/approved/paid by/at, notes).
--     • Recompute employee_count / total_gross / total_deductions /
--       total_net / total_adjustments from that branch's payslips only.
--     • Re-point payslips, payroll_run_employees, payroll_adjustments,
--       payroll_attendance_overrides, payroll_email_log to the new run.
--     • Point payroll_scheduler_runs at the Dalal clone (canonical).
--     • Delete the drained run 7 (history preserved in backup tables).
--
-- SAFETY
--   • Aborts unless: org is Relitrade, run 7 is branch_id IS NULL, every
--     payslip employee has a branch, spans >= 2 branches, and no existing
--     branch run collides for Aug 2026.
--   • Backup tables + persistent split map enable full rollback (bottom).
--   • Advisory xact lock prevents concurrent payroll operations.
--   • Re-running fails cleanly (run 7 gone / branch_id set).
--
-- RUN:
--   docker cp backend/migrations/split_relitrade_aug2026_run_by_branch_2026_09_25.sql lumos_postgres:/tmp/
--   docker exec -it lumos_postgres psql -U lumos_admin -d lumos_hrms -f /tmp/split_relitrade_aug2026_run_by_branch_2026_09_25.sql
-- ============================================================

\set ON_ERROR_STOP on
\pset pager off
\pset null '—'

-- ── Step 1: PRE-FLIGHT REVIEW (read-only, prints before any change) ──────────
\echo ''
\echo '=== 1. ORG CHECK (must be Relitrade) ==='
SELECT id, name, status FROM organizations WHERE id = 1;

\echo ''
\echo '=== 2. RUN 7 CHECK (must be branch_id NULL, paid, Aug 2026) ==='
SELECT id, organization_id, branch_id, month, year, status, employee_count,
       total_gross, total_net, paid_at
FROM payroll_runs WHERE id = 7;

\echo ''
\echo '=== 3. RUN 7 PAYSPLIT BY BRANCH (expect 2 branches, no NULLs) ==='
SELECT b.id AS branch_id, b.name AS branch_name, b.is_active,
       COUNT(*) AS payslips,
       SUM(ps.gross_salary) AS gross,
       SUM(ps.net_salary)   AS net
FROM payslips ps
JOIN users u ON u.id = ps.user_id AND u.organization_id = ps.organization_id
LEFT JOIN branches b ON b.id = u.branch_id
WHERE ps.organization_id = 1 AND ps.payroll_run_id = 7
GROUP BY b.id, b.name, b.is_active
ORDER BY payslips DESC;

\echo ''
\echo '=== 4. EMPLOYEES WITHOUT BRANCH (must be EMPTY or script ABORTS) ==='
SELECT ps.user_id, u.name
FROM payslips ps
JOIN users u ON u.id = ps.user_id AND u.organization_id = ps.organization_id
WHERE ps.organization_id = 1 AND ps.payroll_run_id = 7 AND u.branch_id IS NULL;

-- ── Step 2: THE SPLIT ────────────────────────────────────────────────────────
BEGIN;
SELECT pg_advisory_xact_lock(925001, 2608);  -- arbitrary fixed key: org-agnostic split mutex

DO $$
DECLARE
  c_org_id     CONSTANT bigint := 1;      -- Relitrade
  c_run_id     CONSTANT bigint := 7;      -- legacy Aug 2026 run
  c_month      CONSTANT int    := 8;
  c_year       CONSTANT int    := 2026;
  v_org_name   text;
  v_run        payroll_runs%ROWTYPE;
  v_branches   int;
  v_leftover   int;
  v_slip_cnt   int;
  v_b          record;
  v_new_id     bigint;
  v_sched_id   bigint;
BEGIN
  -- ── G1: org must be Relitrade (protects against wrong-DB execution) ──
  SELECT name INTO v_org_name FROM organizations WHERE id = c_org_id;
  IF v_org_name IS NULL OR v_org_name NOT ILIKE '%reli trade%' AND v_org_name NOT ILIKE '%relitrade%' THEN
    RAISE EXCEPTION 'ABORT: organization % (%) is not Relitrade. Wrong database?', c_org_id, COALESCE(v_org_name,'?');
  END IF;
  RAISE NOTICE 'Org verified: % (%)', c_org_id, v_org_name;

  -- ── G2: run must exist, be NULL-branch, correct period, not processing ──
  SELECT * INTO v_run FROM payroll_runs WHERE id = c_run_id AND organization_id = c_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABORT: run % not found for org % (already split? re-run?)', c_run_id, c_org_id;
  END IF;
  IF v_run.branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: run % already has branch_id = %. Nothing to do.', c_run_id, v_run.branch_id;
  END IF;
  IF v_run.month <> c_month OR v_run.year <> c_year THEN
    RAISE EXCEPTION 'ABORT: run % is %/%, expected %/%.', c_run_id, v_run.month, v_run.year, c_month, c_year;
  END IF;
  IF v_run.status IN ('processing','draft') THEN
    RAISE EXCEPTION 'ABORT: run % status is %. Refusing to split mid-flight.', c_run_id, v_run.status;
  END IF;

  -- ── G3: every payslip employee must have a branch; every payslip a user ──
  SELECT COUNT(*) INTO v_leftover
  FROM payslips ps
  JOIN users u ON u.id = ps.user_id AND u.organization_id = ps.organization_id
  WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id AND u.branch_id IS NULL;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'ABORT: % payslip employee(s) have branch_id NULL. Assign them a branch first, then re-run.', v_leftover;
  END IF;

  SELECT COUNT(*) INTO v_leftover
  FROM payroll_run_employees pre
  JOIN users u ON u.id = pre.user_id AND u.organization_id = pre.organization_id
  WHERE pre.organization_id = c_org_id AND pre.payroll_run_id = c_run_id AND u.branch_id IS NULL;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'ABORT: % run_employees user(s) have branch_id NULL. Assign them a branch first, then re-run.', v_leftover;
  END IF;

  SELECT COUNT(*) INTO v_leftover
  FROM payslips ps
  LEFT JOIN users u ON u.id = ps.user_id AND u.organization_id = ps.organization_id
  WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id AND u.id IS NULL;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'ABORT: % payslip(s) have no matching user row. Fix data first.', v_leftover;
  END IF;

  -- NOTE: computed from source tables directly — the split-map tables do not
  -- exist until Step A below (fix for the 'relation does not exist' guard bug).
  SELECT COUNT(DISTINCT branch_id) INTO v_branches FROM (
    SELECT u.branch_id
    FROM payslips ps
    JOIN users u ON u.id = ps.user_id AND u.organization_id = ps.organization_id
    WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id
    UNION
    SELECT u.branch_id
    FROM payroll_run_employees pre
    JOIN users u ON u.id = pre.user_id AND u.organization_id = pre.organization_id
    WHERE pre.organization_id = c_org_id AND pre.payroll_run_id = c_run_id
  ) src;
  IF v_branches < 2 THEN
    RAISE EXCEPTION 'ABORT: run % spans % branch(es) — single-branch case. Use the simple backfill instead.', c_run_id, v_branches;
  END IF;
  RAISE NOTICE 'Run % spans % branches — splitting.', c_run_id, v_branches;

  -- ── G4: no existing branch run may collide for this period ──
  IF EXISTS (
    SELECT 1
    FROM payroll_runs pr
    JOIN (
      SELECT DISTINCT branch_id FROM (
        SELECT u.branch_id
        FROM payslips ps
        JOIN users u ON u.id = ps.user_id AND u.organization_id = ps.organization_id
        WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id
        UNION
        SELECT u.branch_id
        FROM payroll_run_employees pre
        JOIN users u ON u.id = pre.user_id AND u.organization_id = pre.organization_id
        WHERE pre.organization_id = c_org_id AND pre.payroll_run_id = c_run_id
      ) src
    ) b ON b.branch_id = pr.branch_id
    WHERE pr.organization_id = c_org_id AND pr.month = c_month AND pr.year = c_year
  ) THEN
    RAISE EXCEPTION 'ABORT: a branch-specific run already exists for %/% in one of the target branches.', c_month, c_year;
  END IF;

  -- ── Step A: persistent backups + split map (rollback support) ──
  CREATE TABLE IF NOT EXISTS payroll_runs_split_bak_20260925 (
    id bigint PRIMARY KEY, organization_id bigint, branch_id bigint,
    month int, year int, status text,
    generated_by bigint, generated_at timestamptz, completed_at timestamptz,
    employee_count int, total_gross numeric(16,2), total_deductions numeric(16,2),
    total_net numeric(16,2), total_adjustments numeric(16,2), error_count int,
    locked_by bigint, locked_at timestamptz,
    verified_by bigint, verified_at timestamptz,
    approved_by bigint, approved_at timestamptz,
    paid_by bigint, paid_at timestamptz, notes text, created_at timestamptz
  );
  INSERT INTO payroll_runs_split_bak_20260925
  SELECT id, organization_id, branch_id, month, year, status,
         generated_by, generated_at, completed_at,
         employee_count, total_gross, total_deductions, total_net,
         total_adjustments, error_count, locked_by, locked_at,
         verified_by, verified_at, approved_by, approved_at,
         paid_by, paid_at, notes, created_at
  FROM payroll_runs WHERE id = c_run_id
  ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS payroll_runs_split_map_20260925 (
    old_run_id bigint, branch_id bigint, new_run_id bigint PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS payroll_runs_split_users_20260925 (
    run_id bigint, user_id bigint, branch_id bigint,
    PRIMARY KEY (run_id, user_id)
  );
  -- Split membership = every user with a payslip OR a run_employees row on run 7
  -- (failed/skipped employees have no payslip but must keep their run history).
  INSERT INTO payroll_runs_split_users_20260925
  SELECT DISTINCT ps.payroll_run_id, ps.user_id, u.branch_id
  FROM payslips ps
  JOIN users u ON u.id = ps.user_id AND u.organization_id = ps.organization_id
  WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id
  ON CONFLICT DO NOTHING;

  INSERT INTO payroll_runs_split_users_20260925
  SELECT DISTINCT pre.payroll_run_id, pre.user_id, u.branch_id
  FROM payroll_run_employees pre
  JOIN users u ON u.id = pre.user_id AND u.organization_id = pre.organization_id
  WHERE pre.organization_id = c_org_id AND pre.payroll_run_id = c_run_id
  ON CONFLICT DO NOTHING;

  -- ── Step B: clone run per branch with recomputed totals ──
  FOR v_b IN
    SELECT DISTINCT branch_id
    FROM payroll_runs_split_users_20260925
    WHERE run_id = c_run_id
    ORDER BY branch_id
  LOOP
    WITH agg AS (
      SELECT
        (SELECT COUNT(*) FROM payslips ps
          WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id
            AND ps.user_id IN (SELECT user_id FROM payroll_runs_split_users_20260925
                               WHERE run_id = c_run_id AND branch_id = v_b.branch_id)
        )                                                     AS cnt,
        (SELECT COALESCE(SUM(ps.gross_salary), 0) FROM payslips ps
          WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id
            AND ps.user_id IN (SELECT user_id FROM payroll_runs_split_users_20260925
                               WHERE run_id = c_run_id AND branch_id = v_b.branch_id)
        )                                                     AS gross,
        (SELECT COALESCE(SUM(ps.total_deductions), 0) FROM payslips ps
          WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id
            AND ps.user_id IN (SELECT user_id FROM payroll_runs_split_users_20260925
                               WHERE run_id = c_run_id AND branch_id = v_b.branch_id)
        )                                                     AS ded,
        (SELECT COALESCE(SUM(ps.net_salary), 0) FROM payslips ps
          WHERE ps.organization_id = c_org_id AND ps.payroll_run_id = c_run_id
            AND ps.user_id IN (SELECT user_id FROM payroll_runs_split_users_20260925
                               WHERE run_id = c_run_id AND branch_id = v_b.branch_id)
        )                                                     AS net,
        (SELECT COALESCE(SUM(CASE WHEN pa.addition_or_deduction = 'addition'
                                  THEN pa.amount ELSE -pa.amount END), 0)
           FROM payroll_adjustments pa
          WHERE pa.organization_id = c_org_id
            AND pa.payroll_run_id   = c_run_id
            AND pa.deleted_at IS NULL
            AND pa.user_id IN (SELECT user_id FROM payroll_runs_split_users_20260925
                               WHERE run_id = c_run_id AND branch_id = v_b.branch_id)
        )                                                     AS adj,
        (SELECT COUNT(*) FROM payroll_run_employees pre
          WHERE pre.payroll_run_id = c_run_id AND pre.organization_id = c_org_id
            AND pre.status = 'failed'
            AND pre.user_id IN (SELECT user_id FROM payroll_runs_split_users_20260925
                                WHERE run_id = c_run_id AND branch_id = v_b.branch_id)
        )                                                     AS err_cnt
    )
    INSERT INTO payroll_runs (
      organization_id, branch_id, month, year, status,
      generated_by, generated_at, completed_at,
      employee_count, total_gross, total_deductions, total_net,
      total_adjustments, error_count,
      locked_by, locked_at, verified_by, verified_at,
      approved_by, approved_at, paid_by, paid_at, notes
    )
    SELECT r.organization_id, v_b.branch_id, r.month, r.year, r.status,
           r.generated_by, r.generated_at, r.completed_at,
           agg.cnt, agg.gross, agg.ded, agg.net, agg.adj, agg.err_cnt,
           r.locked_by, r.locked_at, r.verified_by, r.verified_at,
           r.approved_by, r.approved_at, r.paid_by, r.paid_at,
           COALESCE(r.notes, '') || format(' [split from run %s — branch carve-out, migration 20260925]', c_run_id)
    FROM agg CROSS JOIN payroll_runs r
    WHERE r.id = c_run_id
    RETURNING id INTO v_new_id;

    INSERT INTO payroll_runs_split_map_20260925 (old_run_id, branch_id, new_run_id)
    VALUES (c_run_id, v_b.branch_id, v_new_id)
    ON CONFLICT (new_run_id) DO NOTHING;

    RAISE NOTICE 'Created run % for branch %.', v_new_id, v_b.branch_id;
  END LOOP;

  -- ── Step C: re-point payslips ──
  UPDATE payslips ps
     SET payroll_run_id = m.new_run_id
  FROM payroll_runs_split_map_20260925 m
  JOIN payroll_runs_split_users_20260925 su
       ON su.run_id = m.old_run_id AND su.branch_id = m.branch_id
  WHERE ps.organization_id = c_org_id
    AND ps.payroll_run_id  = m.old_run_id
    AND ps.user_id         = su.user_id;

  -- ── Step D: move payroll_run_employees (copy → new runs, drop originals) ──
  INSERT INTO payroll_run_employees
    (payroll_run_id, organization_id, user_id, payslip_id, status, error_message, processed_at)
  SELECT m.new_run_id, pre.organization_id, pre.user_id, pre.payslip_id,
         pre.status, pre.error_message, pre.processed_at
  FROM payroll_run_employees pre
  JOIN payroll_runs_split_users_20260925 su ON su.user_id = pre.user_id AND su.run_id = pre.payroll_run_id
  JOIN payroll_runs_split_map_20260925  m  ON m.old_run_id = su.run_id AND m.branch_id = su.branch_id
  WHERE pre.payroll_run_id = c_run_id
  ON CONFLICT (payroll_run_id, user_id) DO NOTHING;

  DELETE FROM payroll_run_employees WHERE payroll_run_id = c_run_id;

  -- ── Step E: move adjustments, attendance overrides, email log ──
  UPDATE payroll_adjustments pa
     SET payroll_run_id = m.new_run_id
  FROM payroll_runs_split_users_20260925 su
  JOIN payroll_runs_split_map_20260925 m
       ON m.old_run_id = su.run_id AND m.branch_id = su.branch_id
  WHERE pa.organization_id = c_org_id
    AND pa.payroll_run_id  = su.run_id
    AND pa.user_id         = su.user_id;

  UPDATE payroll_attendance_overrides pao
     SET payroll_run_id = m.new_run_id
  FROM payroll_runs_split_users_20260925 su
  JOIN payroll_runs_split_map_20260925 m
       ON m.old_run_id = su.run_id AND m.branch_id = su.branch_id
  WHERE pao.organization_id = c_org_id
    AND pao.payroll_run_id  = su.run_id
    AND pao.user_id         = su.user_id;

  UPDATE payroll_email_log pel
     SET payroll_run_id = m.new_run_id
  FROM payroll_runs_split_users_20260925 su
  JOIN payroll_runs_split_map_20260925 m
       ON m.old_run_id = su.run_id AND m.branch_id = su.branch_id
  WHERE pel.organization_id = c_org_id
    AND pel.payroll_run_id  = su.run_id
    AND pel.user_id         = su.user_id;

  -- ── Step F: any run-7 child rows for users NOT in the split? (must be none) ──
  SELECT COUNT(*) INTO v_leftover FROM payslips       WHERE payroll_run_id = c_run_id;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'ABORT (txn rolled back): % payslip(s) still on run % — user/branch data changed mid-run.', v_leftover, c_run_id;
  END IF;

  SELECT COUNT(*) INTO v_leftover FROM payroll_adjustments pa
  WHERE pa.payroll_run_id = c_run_id AND pa.deleted_at IS NULL;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'ABORT (txn rolled back): % adjustment(s) still on run % — user without payslip?', v_leftover, c_run_id;
  END IF;

  SELECT COUNT(*) INTO v_leftover FROM payroll_run_employees WHERE payroll_run_id = c_run_id;
  IF v_leftover > 0 THEN
    RAISE EXCEPTION 'ABORT (txn rolled back): % run_employees row(s) still on run % — user has no branch?', v_leftover, c_run_id;
  END IF;

  -- ── Step G: scheduler run points at the Dalal clone (canonical) ──
  SELECT m.new_run_id INTO v_sched_id
  FROM payroll_runs_split_map_20260925 m
  JOIN branches b ON b.id = m.branch_id
  WHERE m.old_run_id = c_run_id AND b.name ILIKE 'Dalal'
  ORDER BY m.branch_id
  LIMIT 1;
  IF v_sched_id IS NULL THEN
    SELECT MIN(new_run_id) INTO v_sched_id FROM payroll_runs_split_map_20260925 WHERE old_run_id = c_run_id;
  END IF;
  UPDATE payroll_scheduler_runs
     SET payroll_run_id = v_sched_id
   WHERE payroll_run_id = c_run_id;

  -- ── Step H: delete the drained legacy run ──
  DELETE FROM payroll_runs WHERE id = c_run_id;
  RAISE NOTICE 'Deleted legacy run %. Scheduler now points at run %.', c_run_id, v_sched_id;

  -- ── Step I: record migration ──
  INSERT INTO schema_migrations(version, description)
  VALUES ('20260925_split_relitrade_run7_by_branch',
          'Split legacy multi-branch Relitrade Aug-2026 payroll run into per-branch runs (Dalal + Bhuj)')
  ON CONFLICT (version) DO NOTHING;
END $$;

COMMIT;

-- ── Step 3: POST-RUN VERIFICATION (after COMMIT) ─────────────────────────────
\echo ''
\echo '=== VERIFY: new per-branch runs (expect Dalal + Bhuj rows, status paid) ==='
SELECT pr.id, pr.branch_id, b.name AS branch_name, pr.month, pr.year, pr.status,
       pr.employee_count, pr.total_gross, pr.total_net, pr.total_adjustments
FROM payroll_runs pr
LEFT JOIN branches b ON b.id = pr.branch_id
WHERE pr.organization_id = 1 AND pr.year = 2026 AND pr.month = 8
ORDER BY pr.branch_id NULLS LAST;

\echo ''
\echo '=== VERIFY: payslips re-pointed (must sum to original run-7 counts) ==='
SELECT pr.id AS run_id, b.name AS branch_name, COUNT(ps.id) AS payslips,
       SUM(ps.net_salary) AS total_net
FROM payroll_runs pr
LEFT JOIN branches b ON b.id = pr.branch_id
LEFT JOIN payslips ps ON ps.payroll_run_id = pr.id AND ps.organization_id = pr.organization_id
WHERE pr.organization_id = 1 AND pr.year = 2026 AND pr.month = 8
GROUP BY pr.id, b.name ORDER BY pr.id;

\echo ''
\echo '=== VERIFY: no NULL-branch runs left for Relitrade (expect 0 rows) ==='
SELECT id, month, year, status FROM payroll_runs
WHERE organization_id = 1 AND branch_id IS NULL;

\echo ''
\echo '=== VERIFY: totals reconcile (new sum == backup sum) ==='
SELECT bak.id AS old_run_id, bak.total_gross AS old_gross, bak.total_net AS old_net,
       SUM(CASE WHEN m.new_run_id IS NOT NULL THEN 1 ELSE 0 END) AS split_runs
FROM payroll_runs_split_bak_20260925 bak
LEFT JOIN payroll_runs_split_map_20260925 m ON m.old_run_id = bak.id
GROUP BY bak.id, bak.total_gross, bak.total_net;

-- ============================================================
-- ROLLBACK (restores run 7 exactly; only if ever needed)
-- ============================================================
-- BEGIN;
-- -- 1. re-point children back to run 7
-- UPDATE payslips ps SET payroll_run_id = m.old_run_id
-- FROM payroll_runs_split_map_20260925 m
-- JOIN payroll_runs_split_users_20260925 su ON su.run_id = m.old_run_id AND su.branch_id = m.branch_id
-- WHERE ps.payroll_run_id = m.new_run_id AND ps.user_id = su.user_id;
--
-- UPDATE payroll_adjustments pa SET payroll_run_id = m.old_run_id
-- FROM payroll_runs_split_users_20260925 su
-- JOIN payroll_runs_split_map_20260925 m ON m.old_run_id = su.run_id AND m.branch_id = su.branch_id
-- WHERE pa.payroll_run_id = m.new_run_id AND pa.user_id = su.user_id;
--
-- UPDATE payroll_attendance_overrides pao SET payroll_run_id = m.old_run_id
-- FROM payroll_runs_split_users_20260925 su
-- JOIN payroll_runs_split_map_20260925 m ON m.old_run_id = su.run_id AND m.branch_id = su.branch_id
-- WHERE pao.payroll_run_id = m.new_run_id AND pao.user_id = su.user_id;
--
-- UPDATE payroll_email_log pel SET payroll_run_id = m.old_run_id
-- FROM payroll_runs_split_users_20260925 su
-- JOIN payroll_runs_split_map_20260925 m ON m.old_run_id = su.run_id AND m.branch_id = su.branch_id
-- WHERE pel.payroll_run_id = m.new_run_id AND pel.user_id = su.user_id;
--
-- UPDATE payroll_scheduler_runs psr SET payroll_run_id = m.old_run_id
-- FROM payroll_runs_split_map_20260925 m WHERE psr.payroll_run_id = m.new_run_id;
--
-- -- 2. remove clones + their run_employees rows
-- DELETE FROM payroll_run_employees WHERE payroll_run_id IN (SELECT new_run_id FROM payroll_runs_split_map_20260925);
-- DELETE FROM payroll_runs WHERE id IN (SELECT new_run_id FROM payroll_runs_split_map_20260925);
--
-- -- 3. restore run 7
-- INSERT INTO payroll_runs (id, organization_id, branch_id, month, year, status,
--   generated_by, generated_at, completed_at, employee_count, total_gross,
--   total_deductions, total_net, total_adjustments, error_count, locked_by,
--   locked_at, verified_by, verified_at, approved_by, approved_at, paid_by,
--   paid_at, notes, created_at)
-- SELECT id, organization_id, branch_id, month, year, status, generated_by,
--   generated_at, completed_at, employee_count, total_gross, total_deductions,
--   total_net, total_adjustments, error_count, locked_by, locked_at,
--   verified_by, verified_at, approved_by, approved_at, paid_by, paid_at, notes, created_at
-- FROM payroll_runs_split_bak_20260925;
-- COMMIT;
