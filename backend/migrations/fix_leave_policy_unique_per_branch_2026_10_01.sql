-- ============================================================
-- fix_leave_policy_unique_per_branch_2026_10_01.sql
--
-- BUG-131: "Two leave policies have the same type..." when saving (e.g. just
--          toggling Active/Inactive) from a branch view.
--
-- Root cause:
--   production_db_hardening_2026_07_29.sql created
--     UNIQUE (organization_id, leave_type)  on leave_policies.
--   Branch-specific policies (leave_policies.branch_id, added 2026-09-29) were
--   introduced later, but the index was never scoped by branch. Saving a branch
--   copy of a policy therefore collided with the org-wide row of the same type,
--   and POST /api/leave-policies reported it as a duplicate.
--
-- Fix:
--   One policy per type PER SCOPE:
--     • org-wide scope (branch_id IS NULL)   -> unique (organization_id, leave_type)
--     • branch scope   (branch_id IS NOT NULL) -> unique (organization_id, branch_id, leave_type)
--
-- Safe: only loosens the constraint; no row is changed or deleted.
-- Idempotent: can be re-run.
--
-- Run:
--   docker cp backend/migrations/fix_leave_policy_unique_per_branch_2026_10_01.sql lumos_postgres:/tmp/lp_unique.sql
--   docker exec -i lumos_postgres psql -U lumos_admin -d lumos_hrms -v ON_ERROR_STOP=1 -f /tmp/lp_unique.sql
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_leave_policies_org_type_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_policies_org_type_orgwide
  ON leave_policies (organization_id, leave_type)
  WHERE branch_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_policies_org_branch_type
  ON leave_policies (organization_id, branch_id, leave_type)
  WHERE branch_id IS NOT NULL;

COMMIT;

-- Verify
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'leave_policies' AND indexname LIKE 'idx_leave_policies_%unique%'
   OR tablename = 'leave_policies' AND indexname IN ('idx_leave_policies_org_type_orgwide','idx_leave_policies_org_branch_type');
