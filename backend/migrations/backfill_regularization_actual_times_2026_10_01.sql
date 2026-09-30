-- ============================================================
-- backfill_regularization_actual_times_2026_10_01.sql
--
-- Bug-004 / Bug-048: Regularization export was missing Actual Check-in,
-- Actual Check-out for records created before the actual-time capture
-- was introduced. Backfill those values from the attendance table.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE attendance_regularization ADD COLUMN IF NOT EXISTS actual_check_in  VARCHAR(8);
ALTER TABLE attendance_regularization ADD COLUMN IF NOT EXISTS actual_check_out VARCHAR(8);

UPDATE attendance_regularization ar
SET actual_check_in  = COALESCE(ar.actual_check_in,  a.check_in),
    actual_check_out = COALESCE(ar.actual_check_out, a.check_out)
FROM attendance a
WHERE ar.user_id = a.user_id
  AND ar.date = a.date
  AND ar.organization_id = a.organization_id
  AND (ar.actual_check_in IS NULL OR ar.actual_check_out IS NULL)
  AND (a.check_in IS NOT NULL OR a.check_out IS NOT NULL);
