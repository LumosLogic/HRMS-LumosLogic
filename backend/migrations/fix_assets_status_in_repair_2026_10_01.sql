-- ============================================================
-- fix_assets_status_in_repair_2026_10_01.sql
--
-- BUG_189: an asset with status "In Repair" cannot be saved.
--
-- Root cause:
--   The app (UI dropdown + POST/PUT /api/assets VALID_STATUSES) uses the status value
--   'in_repair', but production_db_hardening_2026_07_29.sql / _part1.sql created
--     CHECK (status IN ('available','assigned','maintenance','retired'))
--   so the database rejected 'in_repair' with a raw check-constraint error.
--
-- Fix: allow every status the application can send. Existing rows are unaffected
--      (the new set is a superset of the old one).
-- Idempotent: safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE assets DROP CONSTRAINT IF EXISTS chk_assets_status;
ALTER TABLE assets
  ADD CONSTRAINT chk_assets_status
  CHECK (status IN ('available','assigned','in_repair','maintenance','retired'));

COMMIT;

-- Verify
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conname = 'chk_assets_status';
