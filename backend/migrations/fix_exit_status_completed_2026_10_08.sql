-- Offboarding "Mark Complete" sets exit_requests.status = 'completed', but the hardening
-- migration's chk_exit_status only allowed pending/approved/rejected -> PUT /api/exit/:id failed.
ALTER TABLE exit_requests DROP CONSTRAINT IF EXISTS chk_exit_status;
ALTER TABLE exit_requests
  ADD CONSTRAINT chk_exit_status
  CHECK (status IN ('pending','approved','rejected','completed'));
