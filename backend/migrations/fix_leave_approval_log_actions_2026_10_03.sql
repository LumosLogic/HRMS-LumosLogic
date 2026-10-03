-- ============================================================
-- fix_leave_approval_log_actions_2026_10_03.sql
--
-- chk_lal_action rejected two actions the code logs ('withdrawn' on leave withdrawal,
-- 'leave_overridden_by_attendance' when attendance overrides a leave). The insert failure was
-- swallowed (logged only), so those audit rows were silently lost. Widen the constraint.
-- Only loosens a CHECK — no rows change. Idempotent.
--
-- Run:
--   docker cp backend/migrations/fix_leave_approval_log_actions_2026_10_03.sql lumos_postgres:/tmp/lal_fix.sql
--   docker exec -it lumos_postgres psql -U lumos_admin -d lumos_hrms -v ON_ERROR_STOP=1 -f /tmp/lal_fix.sql
-- ============================================================
BEGIN;
ALTER TABLE leave_approval_log DROP CONSTRAINT IF EXISTS chk_lal_action;
ALTER TABLE leave_approval_log ADD CONSTRAINT chk_lal_action CHECK (action ~
  '^(submitted|dept_approved|root_approved|root_rejected|cancelled|withdrawn|leave_overridden_by_attendance|level_[0-9]+_approved|level_[0-9]+_rejected|level_[0-9]+_skipped)$');
COMMIT;
