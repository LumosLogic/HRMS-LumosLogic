-- ================================================================
-- PHASE 1: HR/Admin Branch Access Control Foundation
-- Version: 2026_09_16_01
-- Date: 2026-09-16
--
-- Creates hr_branch_access table for mapping HR/Admin users to the
-- specific branches they are allowed to manage.
--
-- Design:
--   all_branches = TRUE  → user manages ALL branches in the org
--                          (branch_id must be NULL in this case)
--   all_branches = FALSE → user manages a SPECIFIC branch
--                          (branch_id must be set in this case)
--
-- Root Admins NEVER need rows here — their access is determined
-- by users.role = 'root_admin' in the JWT.
--
-- Employee branch assignment remains in users.branch_id (unchanged).
--
-- DOES NOT touch:
--   - users.branch_id            (employee branch assignment — unchanged)
--   - attendance / leave / payroll tables
--   - biometric flow tables
--   - RBAC tables (roles, permissions, user_roles)
--   - Existing branch data
--
-- SAFE TO RE-RUN: Uses IF NOT EXISTS / ON CONFLICT DO NOTHING
-- REVERSIBLE: DROP TABLE hr_branch_access;
-- ================================================================

BEGIN;

INSERT INTO schema_migrations (version, description)
VALUES ('2026_09_16_01', 'Add hr_branch_access table for HR admin multi-branch access control')
ON CONFLICT (version) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────
-- hr_branch_access
--
-- Each row grants an HR/Admin user access to either:
--   A) all branches in the org  (all_branches=TRUE,  branch_id=NULL)
--   B) one specific branch      (all_branches=FALSE, branch_id=<id>)
-- ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hr_branch_access (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  branch_id    BIGINT          REFERENCES branches(id)      ON DELETE CASCADE,
  all_branches BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by   BIGINT          REFERENCES users(id)         ON DELETE SET NULL,
  granted_at   TIMESTAMPTZ     DEFAULT NOW(),

  -- Mutual exclusivity: all_branches and branch_id cannot both be set
  CONSTRAINT chk_hr_branch_access_consistency
    CHECK (
      (all_branches = TRUE  AND branch_id IS NULL)
      OR
      (all_branches = FALSE AND branch_id IS NOT NULL)
    )
);

-- Enforce: at most one "all branches" grant per user per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_branch_access_all_unique
  ON hr_branch_access(user_id, org_id)
  WHERE all_branches = TRUE;

-- Enforce: at most one specific-branch grant per user per branch per org
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_branch_access_specific_unique
  ON hr_branch_access(user_id, org_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Lookup: all grants for a user in an org
CREATE INDEX IF NOT EXISTS idx_hr_branch_access_user_org
  ON hr_branch_access(user_id, org_id);

-- Lookup: which users have access to a given branch
CREATE INDEX IF NOT EXISTS idx_hr_branch_access_branch
  ON hr_branch_access(org_id, branch_id);

COMMENT ON TABLE hr_branch_access IS
  'Maps HR/Admin users to accessible branches within their org. '
  'Root admins have implicit org-wide access (by role) and do not need rows here. '
  'all_branches=TRUE grants access to all org branches; specific branch_id grants single-branch access.';

COMMIT;
