-- add_branch_soft_delete_2026_10_09.sql
-- Branch deletion becomes a SOFT delete with two modes (Root Admin only):
--   * move      - employees and branch-linked data are moved to another branch, the old branch is hidden
--   * soft_delete - the branch is hidden, its remaining employees are deactivated (login blocked)
-- The branch row is never physically deleted, so payroll runs, payslips, attendance, leave and audit history keep their branch.
-- (A physical delete would also have turned branch-only holidays / leave policies / shifts / assets into ORG-WIDE rows through
-- their ON DELETE SET NULL foreign keys.)
--
-- Additive + idempotent: no existing row changes. Until this is run the Delete action answers 409 "run the migration".
--
-- Run:
--   docker cp backend/migrations/add_branch_soft_delete_2026_10_09.sql lumos_postgres:/tmp/bsd.sql
--   docker exec -it lumos_postgres psql -U lumos_admin -d lumos_hrms -v ON_ERROR_STOP=1 -f /tmp/bsd.sql
BEGIN;

ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMPTZ;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS deleted_by         BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS delete_mode        TEXT;          -- 'move' | 'soft_delete'
ALTER TABLE branches ADD COLUMN IF NOT EXISTS moved_to_branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_branches_org_live ON branches (org_id) WHERE deleted_at IS NULL;

-- Who deleted which branch, how, and what it affected (counts) - kept for audit.
CREATE TABLE IF NOT EXISTS branch_deletion_log (
  id               BIGSERIAL PRIMARY KEY,
  org_id           BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id        BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  branch_name      TEXT   NOT NULL,
  mode             TEXT   NOT NULL CHECK (mode IN ('move', 'soft_delete')),
  target_branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL,
  actor_id         BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_name       TEXT,
  summary          JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_branch_deletion_log_org ON branch_deletion_log (org_id, created_at DESC);

COMMIT;
