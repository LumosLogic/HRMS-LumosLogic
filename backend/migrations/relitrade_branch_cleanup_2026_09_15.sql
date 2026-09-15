-- ============================================================
-- relitrade_branch_cleanup_2026_09_15.sql
--
-- Purpose:
--   Correct the Relitrade (org_id = 1) branch master to match
--   the confirmed business structure (7 branches only).
--
--   1. Move all employees on branch 120 and 121
--      ("Gift City Gandhinagar" — incorrect records) to branch 2 (Dalal).
--      "Gift City" is Dalal branch's location, not a separate branch.
--
--   2. Delete branches 120 and 121.
--
--   3. Rename branches 1, 3, 5, 7 to match confirmed branch master.
--
-- Expected pre-state:
--   Branch 120 → 11 users (7 active, 2 probation, 2 resigned)
--   Branch 121 →  1 user  (1 active — Priyanshi Riteshbhai Sheth)
--   Total employees to reassign: 12 → branch 2 (Dalal)
--
-- Records NOT touched:
--   attendance, leaves, payslips      → inherit via users.branch_id (no direct change)
--   biometric_raw_logs                → no branch_id column
--   biometric_employee_map            → inherits via users.branch_id (no direct change)
--   biometric_devices                 → confirmed 0 devices on branch 120/121
--
-- HOW TO EXECUTE:
--   1. Run this entire file in psql.
--   2. Read all NOTICE messages and the two SELECT result sets at the end.
--   3. If everything looks correct → run:  COMMIT;
--   4. If anything looks wrong    → run:  ROLLBACK;
--   The transaction will NOT auto-commit. You must issue COMMIT manually.
--
-- Generated: 2026-09-15
-- Author:    Lumos Logic — Branch Architecture Audit
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_branch_120_name    TEXT;
  v_branch_121_name    TEXT;
  v_branch_2_name      TEXT;
  v_users_on_120_pre   INTEGER;
  v_users_on_121_pre   INTEGER;
  v_devices_on_120     INTEGER;
  v_devices_on_121     INTEGER;
  v_moved_from_120     INTEGER;
  v_moved_from_121     INTEGER;
  v_remaining_on_120   INTEGER;
  v_remaining_on_121   INTEGER;
BEGIN

  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'relitrade_branch_cleanup_2026_09_15.sql — START';
  RAISE NOTICE '=======================================================';

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 1: PRE-FLIGHT VALIDATION
  -- ─────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 1: PRE-FLIGHT VALIDATION ---';

  -- 1a. Branch 120 must exist and be "Gift City Gandhinagar" for org 1
  SELECT name INTO v_branch_120_name
  FROM branches WHERE id = 120 AND org_id = 1;

  IF v_branch_120_name IS NULL THEN
    RAISE EXCEPTION 'ABORT: Branch 120 not found for org_id=1. Cannot proceed.';
  END IF;
  IF v_branch_120_name <> 'Gift City Gandhinagar' THEN
    RAISE EXCEPTION 'ABORT: Branch 120 name is "%" — expected "Gift City Gandhinagar". Manual review required before running this migration.', v_branch_120_name;
  END IF;
  RAISE NOTICE 'OK: Branch 120 confirmed as "Gift City Gandhinagar" (org_id=1).';

  -- 1b. Branch 121 must exist and be "Gift City Gandhinagar" for org 1
  SELECT name INTO v_branch_121_name
  FROM branches WHERE id = 121 AND org_id = 1;

  IF v_branch_121_name IS NULL THEN
    RAISE EXCEPTION 'ABORT: Branch 121 not found for org_id=1. Cannot proceed.';
  END IF;
  IF v_branch_121_name <> 'Gift City Gandhinagar' THEN
    RAISE EXCEPTION 'ABORT: Branch 121 name is "%" — expected "Gift City Gandhinagar". Manual review required.', v_branch_121_name;
  END IF;
  RAISE NOTICE 'OK: Branch 121 confirmed as "Gift City Gandhinagar" (org_id=1).';

  -- 1c. Branch 2 (Dalal) must exist — this is the target branch
  SELECT name INTO v_branch_2_name
  FROM branches WHERE id = 2 AND org_id = 1;

  IF v_branch_2_name IS NULL THEN
    RAISE EXCEPTION 'ABORT: Target branch 2 (Dalal) not found for org_id=1. Cannot reassign employees.';
  END IF;
  RAISE NOTICE 'OK: Target branch 2 confirmed as "%" (org_id=1).', v_branch_2_name;

  -- 1d. No biometric devices on branch 120 or 121
  SELECT COUNT(*) INTO v_devices_on_120 FROM biometric_devices WHERE branch_id = 120;
  SELECT COUNT(*) INTO v_devices_on_121 FROM biometric_devices WHERE branch_id = 121;

  IF v_devices_on_120 > 0 THEN
    RAISE EXCEPTION 'ABORT: % biometric device(s) still assigned to branch 120. Reassign devices before running this migration.', v_devices_on_120;
  END IF;
  IF v_devices_on_121 > 0 THEN
    RAISE EXCEPTION 'ABORT: % biometric device(s) still assigned to branch 121. Reassign devices before running this migration.', v_devices_on_121;
  END IF;
  RAISE NOTICE 'OK: No biometric devices on branch 120 or 121.';

  -- 1e. Count users currently on 120 and 121
  SELECT COUNT(*) INTO v_users_on_120_pre FROM users WHERE branch_id = 120 AND organization_id = 1;
  SELECT COUNT(*) INTO v_users_on_121_pre FROM users WHERE branch_id = 121 AND organization_id = 1;

  RAISE NOTICE 'PRE-STATE: Branch 120 has % user(s). Branch 121 has % user(s).', v_users_on_120_pre, v_users_on_121_pre;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 2: REASSIGN EMPLOYEES FROM BRANCH 120 → BRANCH 2 (DALAL)
  -- ─────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 2: REASSIGN EMPLOYEES ---';

  UPDATE users
  SET    branch_id = 2
  WHERE  branch_id = 120
    AND  organization_id = 1;
  GET DIAGNOSTICS v_moved_from_120 = ROW_COUNT;
  RAISE NOTICE 'Moved % user(s) from branch 120 → branch 2 (Dalal).', v_moved_from_120;

  UPDATE users
  SET    branch_id = 2
  WHERE  branch_id = 121
    AND  organization_id = 1;
  GET DIAGNOSTICS v_moved_from_121 = ROW_COUNT;
  RAISE NOTICE 'Moved % user(s) from branch 121 → branch 2 (Dalal).', v_moved_from_121;

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 3: POST-REASSIGNMENT VALIDATION
  -- ─────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 3: POST-REASSIGNMENT VALIDATION ---';

  SELECT COUNT(*) INTO v_remaining_on_120 FROM users WHERE branch_id = 120;
  SELECT COUNT(*) INTO v_remaining_on_121 FROM users WHERE branch_id = 121;

  IF v_remaining_on_120 > 0 THEN
    RAISE EXCEPTION 'ABORT: % user(s) still reference branch 120 after reassignment. Rolling back all changes.', v_remaining_on_120;
  END IF;
  IF v_remaining_on_121 > 0 THEN
    RAISE EXCEPTION 'ABORT: % user(s) still reference branch 121 after reassignment. Rolling back all changes.', v_remaining_on_121;
  END IF;

  -- Re-verify devices (belt and suspenders)
  SELECT COUNT(*) INTO v_devices_on_120 FROM biometric_devices WHERE branch_id = 120;
  SELECT COUNT(*) INTO v_devices_on_121 FROM biometric_devices WHERE branch_id = 121;

  IF v_devices_on_120 > 0 OR v_devices_on_121 > 0 THEN
    RAISE EXCEPTION 'ABORT: Biometric device(s) still reference branch 120 or 121. Rolling back.';
  END IF;

  RAISE NOTICE 'OK: Zero users remain on branch 120.';
  RAISE NOTICE 'OK: Zero users remain on branch 121.';
  RAISE NOTICE 'OK: Zero biometric devices on branch 120 or 121.';

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 4: DELETE INCORRECT BRANCHES 120 AND 121
  -- ─────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 4: DELETE BRANCHES 120 AND 121 ---';

  DELETE FROM branches WHERE id = 120 AND org_id = 1;
  RAISE NOTICE 'Deleted branch 120 (Gift City Gandhinagar).';

  DELETE FROM branches WHERE id = 121 AND org_id = 1;
  RAISE NOTICE 'Deleted branch 121 (Gift City Gandhinagar).';

  -- Confirm deletion
  IF EXISTS (SELECT 1 FROM branches WHERE id IN (120, 121)) THEN
    RAISE EXCEPTION 'ABORT: Branch 120 or 121 still exists after DELETE. Rolling back.';
  END IF;
  RAISE NOTICE 'OK: Branches 120 and 121 no longer exist.';

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 5: RENAME EXISTING BRANCHES
  -- ─────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 5: RENAME BRANCHES ---';

  UPDATE branches SET name = 'Main Area'     WHERE id = 1 AND org_id = 1;
  RAISE NOTICE 'Branch 1: "Main Area (Ahmedabad)" → "Main Area"';

  UPDATE branches SET name = 'Third-Floor'   WHERE id = 3 AND org_id = 1;
  RAISE NOTICE 'Branch 3: "Third Floor" → "Third-Floor"';

  UPDATE branches SET name = 'Bapunagaar'    WHERE id = 5 AND org_id = 1;
  RAISE NOTICE 'Branch 5: "Bapunagar" → "Bapunagaar"';

  UPDATE branches SET name = 'InsuranceBhuj' WHERE id = 7 AND org_id = 1;
  RAISE NOTICE 'Branch 7: "Insurance Bhuj" → "InsuranceBhuj"';

  -- ─────────────────────────────────────────────────────────────────────────
  -- STEP 6: FINAL VALIDATION — BRANCH MASTER MUST MATCH EXPECTED STATE
  -- ─────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '--- STEP 6: FINAL BRANCH MASTER VALIDATION ---';

  -- No "Gift City" branch should remain
  IF EXISTS (SELECT 1 FROM branches WHERE name ILIKE '%Gift City%' AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: A "Gift City" branch still exists after cleanup. Rolling back.';
  END IF;

  -- All 7 expected branches must exist with exact names
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = 1 AND name = 'Main Area'     AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: Branch 1 final state mismatch — expected name "Main Area".';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = 2 AND name = 'Dalal'         AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: Branch 2 not found or name changed — expected "Dalal".';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = 3 AND name = 'Third-Floor'   AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: Branch 3 final state mismatch — expected name "Third-Floor".';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = 4 AND name = 'CG Road'       AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: Branch 4 not found or name changed — expected "CG Road".';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = 5 AND name = 'Bapunagaar'    AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: Branch 5 final state mismatch — expected name "Bapunagaar".';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = 6 AND name = 'Bhuj'          AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: Branch 6 not found or name changed — expected "Bhuj".';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM branches WHERE id = 7 AND name = 'InsuranceBhuj' AND org_id = 1) THEN
    RAISE EXCEPTION 'ABORT: Branch 7 final state mismatch — expected name "InsuranceBhuj".';
  END IF;

  -- Exactly 7 branches for org 1
  IF (SELECT COUNT(*) FROM branches WHERE org_id = 1) <> 7 THEN
    RAISE EXCEPTION 'ABORT: Expected exactly 7 branches for org_id=1 after cleanup. Found %. Rolling back.',
      (SELECT COUNT(*) FROM branches WHERE org_id = 1);
  END IF;

  RAISE NOTICE 'OK: All 7 branch names validated.';
  RAISE NOTICE 'OK: No "Gift City" branch remains.';

  -- ─────────────────────────────────────────────────────────────────────────
  -- SUMMARY
  -- ─────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '';
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'MIGRATION SUMMARY';
  RAISE NOTICE '=======================================================';
  RAISE NOTICE 'Employees moved  branch 120 → 2 (Dalal) : %', v_moved_from_120;
  RAISE NOTICE 'Employees moved  branch 121 → 2 (Dalal) : %', v_moved_from_121;
  RAISE NOTICE 'Total employees reassigned               : %', v_moved_from_120 + v_moved_from_121;
  RAISE NOTICE 'Branch 120 deleted                       : YES';
  RAISE NOTICE 'Branch 121 deleted                       : YES';
  RAISE NOTICE 'Branch 1  renamed → Main Area            : YES';
  RAISE NOTICE 'Branch 3  renamed → Third-Floor          : YES';
  RAISE NOTICE 'Branch 5  renamed → Bapunagaar           : YES';
  RAISE NOTICE 'Branch 7  renamed → InsuranceBhuj        : YES';
  RAISE NOTICE '-------------------------------------------------------';
  RAISE NOTICE 'attendance records directly modified     : NONE';
  RAISE NOTICE 'leave records directly modified          : NONE';
  RAISE NOTICE 'payslip records directly modified        : NONE';
  RAISE NOTICE 'biometric_raw_logs directly modified     : NONE';
  RAISE NOTICE 'biometric_employee_map directly modified : NONE';
  RAISE NOTICE 'biometric_devices directly modified      : NONE';
  RAISE NOTICE '-------------------------------------------------------';
  RAISE NOTICE 'ALL VALIDATIONS PASSED.';
  RAISE NOTICE 'Review the SELECT results below, then run: COMMIT;';
  RAISE NOTICE 'To cancel all changes, run              : ROLLBACK;';
  RAISE NOTICE '=======================================================';

END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- POST-EXECUTION REVIEW QUERIES
-- These run inside the open transaction so you can inspect the final state
-- before deciding to COMMIT or ROLLBACK.
-- ─────────────────────────────────────────────────────────────────────────────

-- Final branch master for Relitrade
SELECT id, name, code, location, is_active
FROM   branches
WHERE  org_id = 1
ORDER  BY id;

-- Employee count per branch (all statuses) for Relitrade
SELECT
  b.id          AS branch_id,
  b.name        AS branch_name,
  COUNT(u.id)   AS total_employees,
  COUNT(u.id) FILTER (WHERE u.employee_status = 'active')     AS active,
  COUNT(u.id) FILTER (WHERE u.employee_status = 'probation')  AS probation,
  COUNT(u.id) FILTER (WHERE u.employee_status = 'resigned')   AS resigned,
  COUNT(u.id) FILTER (WHERE u.employee_status = 'inactive')   AS inactive
FROM   branches b
LEFT   JOIN users u ON u.branch_id = b.id AND u.organization_id = 1
WHERE  b.org_id = 1
GROUP  BY b.id, b.name
ORDER  BY b.id;

-- Confirm zero users on branch 120 or 121
SELECT COUNT(*) AS users_still_on_gift_city
FROM   users
WHERE  branch_id IN (120, 121);

-- ─────────────────────────────────────────────────────────────────────────────
-- COMMIT when satisfied. ROLLBACK to cancel everything.
-- ─────────────────────────────────────────────────────────────────────────────

-- COMMIT;
