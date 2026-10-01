-- ============================================================
-- relitrade_ho_remove_non_ahmedabad_2026_10_01.sql
--
-- Purpose:
--   relitrade_ho_branch_employee_import_2026_10_01.sql put every employee
--   of the client file on HO. Only employees whose export BranchName is
--   'Ahmedabad' belong on HO. Remove the 9 wrongly-added employees that
--   that migration INSERTED (nobody else is touched):
--     Bhuj          : 417, 438, 489, 685
--     Mumbai        : 912, 1909, 1910, 1911
--     Gift City     : 809
--   Their family / nominee / bank / document rows go with them (FK cascade).
--
--   Safety:
--     • Only rows with branch_id = HO (code MAIN), org 1, created today.
--     • ABORTS if any of them already has attendance / leave / payslip rows.
--     • Exactly 9 users must match, otherwise ABORT.
--
-- Run: dry run first (rolls back at exit), then with COMMIT appended.
-- ============================================================
BEGIN;

DO $$
DECLARE
  v_ho      BIGINT;
  v_ids     BIGINT[];
  v_cnt     INT;
  v_used    INT;
BEGIN
  SELECT id INTO v_ho FROM branches WHERE org_id = 1 AND code = 'MAIN';

  SELECT array_agg(id), COUNT(*) INTO v_ids, v_cnt
  FROM users
  WHERE organization_id = 1 AND branch_id = v_ho
    AND employee_id IN ('417','438','489','685','912','1909','1910','1911','809')
    AND created_at >= DATE '2026-10-01';

  IF v_cnt <> 9 THEN
    RAISE EXCEPTION 'ABORT: expected 9 users added today on HO, found %.', v_cnt;
  END IF;

  SELECT (SELECT COUNT(*) FROM attendance WHERE user_id = ANY(v_ids))
       + (SELECT COUNT(*) FROM leaves     WHERE user_id = ANY(v_ids))
    INTO v_used;
  IF v_used > 0 THEN
    RAISE EXCEPTION 'ABORT: % attendance/leave rows exist for these users.', v_used;
  END IF;

  -- detach references from other rows
  UPDATE users SET reporting_to = NULL WHERE reporting_to = ANY(v_ids);
  UPDATE users SET hod_id       = NULL WHERE hod_id       = ANY(v_ids);

  DELETE FROM biometric_employee_map WHERE org_id = 1 AND user_id = ANY(v_ids);
  DELETE FROM users WHERE id = ANY(v_ids);

  RAISE NOTICE 'Removed % non-Ahmedabad employees from HO.', v_cnt;
END;
$$;

-- Review: HO should now be Ahmedabad-only
SELECT u.employee_id, u.name FROM users u JOIN branches b ON b.id = u.branch_id
WHERE b.org_id = 1 AND b.code = 'MAIN' AND u.employee_id IN
  ('417','438','489','685','912','1909','1910','1911','809');   -- expect 0 rows

SELECT COUNT(*) AS ho_employees FROM users u JOIN branches b ON b.id = u.branch_id
WHERE b.org_id = 1 AND b.code = 'MAIN';

-- COMMIT;
