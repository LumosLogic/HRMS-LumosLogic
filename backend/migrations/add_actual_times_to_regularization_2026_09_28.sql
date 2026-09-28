-- ============================================================
-- add_actual_times_to_regularization_2026_09_28.sql
--
-- Adds actual_check_in and actual_check_out to attendance_regularization.
-- These store the attendance times at the moment of the request submission
-- so they appear correctly in CSV exports and admin review views.
--
-- Safe to re-run (idempotent DO blocks).
-- ============================================================

DO $$ BEGIN
  ALTER TABLE attendance_regularization
    ADD COLUMN actual_check_in  VARCHAR(8);
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'Column actual_check_in already exists, skipping.';
END $$;

DO $$ BEGIN
  ALTER TABLE attendance_regularization
    ADD COLUMN actual_check_out VARCHAR(8);
EXCEPTION WHEN duplicate_column THEN
  RAISE NOTICE 'Column actual_check_out already exists, skipping.';
END $$;
