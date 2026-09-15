-- ============================================================
-- add_early_leave_request_2026_09_15.sql
--
-- Adds Early Leave Request support to attendance_regularization.
--
-- Changes:
--   1. Add `type` column ('check_time' = existing, 'early_leave' = new)
--   2. Add `requested_early_exit_time` column (HH:MM, early leave only)
--   3. Replace old unique(user_id, date) constraint with
--      unique(user_id, date, organization_id, type) so an employee
--      can have one check_time AND one early_leave request per date.
--
-- Safe to re-run (idempotent DO blocks).
-- ============================================================

-- 1. Add type column (existing rows default to 'check_time')
DO $$ BEGIN
  ALTER TABLE attendance_regularization
    ADD COLUMN type TEXT NOT NULL DEFAULT 'check_time';
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'Column type already exists, skipping.';
END $$;

-- 2. Add CHECK constraint on type
DO $$ BEGIN
  ALTER TABLE attendance_regularization
    ADD CONSTRAINT chk_regularization_type
    CHECK (type IN ('check_time', 'early_leave'));
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'CHECK constraint chk_regularization_type already exists, skipping.';
END $$;

-- 3. Add requested_early_exit_time column
DO $$ BEGIN
  ALTER TABLE attendance_regularization
    ADD COLUMN requested_early_exit_time TEXT;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'Column requested_early_exit_time already exists, skipping.';
END $$;

-- 4. Add new per-type unique constraint
DO $$ BEGIN
  ALTER TABLE attendance_regularization
    ADD CONSTRAINT attendance_regularization_user_date_org_type_unique
    UNIQUE (user_id, date, organization_id, type);
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'New unique constraint already exists, skipping.';
END $$;

-- 5. Drop the old unique constraint that covered only (user_id, date)
--    or (user_id, date, organization_id) — whichever exists.
DO $$
DECLARE
  v_cname TEXT;
BEGIN
  SELECT c.conname INTO v_cname
  FROM   pg_constraint c
  JOIN   pg_class t ON t.oid = c.conrelid
  WHERE  t.relname = 'attendance_regularization'
    AND  c.contype = 'u'
    AND  c.conname <> 'attendance_regularization_user_date_org_type_unique'
  ORDER  BY c.oid ASC
  LIMIT  1;

  IF v_cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE attendance_regularization DROP CONSTRAINT %I', v_cname);
    RAISE NOTICE 'Dropped old unique constraint: %', v_cname;
  ELSE
    RAISE NOTICE 'No old unique constraint found — nothing to drop.';
  END IF;
END $$;

-- Verify final state
SELECT conname, contype
FROM   pg_constraint c
JOIN   pg_class t ON t.oid = c.conrelid
WHERE  t.relname = 'attendance_regularization'
  AND  c.contype IN ('u', 'c')
ORDER  BY conname;
