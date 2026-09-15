-- ============================================================
-- add_threshold_enabled_flags_2026_09_15.sql
--
-- Adds independent enable/disable flags for Late Entry and Early Exit
-- thresholds, at both the org level (work_schedule) and shift level (shifts).
--
-- Backward compatibility:
--   - work_schedule columns default to TRUE  → existing behaviour unchanged.
--   - shifts columns default to NULL         → NULL means "inherit from org".
--
-- Safe to re-run (idempotent DO blocks).
-- ============================================================

-- 1. Org-level flags (work_schedule)
DO $$ BEGIN
  ALTER TABLE work_schedule
    ADD COLUMN late_entry_threshold_enabled BOOLEAN NOT NULL DEFAULT TRUE;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'work_schedule.late_entry_threshold_enabled already exists, skipping.';
END $$;

DO $$ BEGIN
  ALTER TABLE work_schedule
    ADD COLUMN early_exit_threshold_enabled BOOLEAN NOT NULL DEFAULT TRUE;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'work_schedule.early_exit_threshold_enabled already exists, skipping.';
END $$;

-- 2. Shift-level overrides (nullable — NULL means inherit from org)
DO $$ BEGIN
  ALTER TABLE shifts
    ADD COLUMN late_entry_threshold_enabled BOOLEAN;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'shifts.late_entry_threshold_enabled already exists, skipping.';
END $$;

DO $$ BEGIN
  ALTER TABLE shifts
    ADD COLUMN early_exit_threshold_enabled BOOLEAN;
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'shifts.early_exit_threshold_enabled already exists, skipping.';
END $$;

-- Verify
SELECT
  column_name,
  data_type,
  column_default,
  is_nullable
FROM information_schema.columns
WHERE table_name IN ('work_schedule', 'shifts')
  AND column_name IN ('late_entry_threshold_enabled', 'early_exit_threshold_enabled')
ORDER BY table_name, column_name;
