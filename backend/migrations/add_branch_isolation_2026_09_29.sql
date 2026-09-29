-- ================================================================
-- Branch Isolation for Assets, Shifts, Holidays, Leave Policies, Documents
-- Version: 2026_09_29_01
-- Fixes: Bug-120 (assets), Bug-124 (shifts), Bug-126 (holidays),
--        Bug-125 (leave policies), Bug-122/123 (employee documents)
-- SAFE TO RE-RUN: ADD COLUMN IF NOT EXISTS
-- ================================================================

BEGIN;

INSERT INTO schema_migrations (version, description)
VALUES ('2026_09_29_01', 'Add branch_id isolation to assets, shifts, holidays, leave_policies, employee_documents')
ON CONFLICT (version) DO NOTHING;

-- Assets: branch_id so unassigned assets are scoped to creating branch
ALTER TABLE assets
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_assets_branch
  ON assets(organization_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Shifts: branch_id so shift definitions are per-branch
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shifts_branch
  ON shifts(organization_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Holidays: branch_id so holidays can be branch-specific (NULL = org-wide)
ALTER TABLE holidays
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_holidays_branch
  ON holidays(organization_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Leave policies: branch_id so policies can be branch-specific (NULL = org-wide)
ALTER TABLE leave_policies
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leave_policies_branch
  ON leave_policies(organization_id, branch_id)
  WHERE branch_id IS NOT NULL;

-- Employee documents: branch_id stored when admin uploads an org-visible doc from a branch
ALTER TABLE employee_documents
  ADD COLUMN IF NOT EXISTS branch_id BIGINT REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employee_docs_branch
  ON employee_documents(organization_id, branch_id)
  WHERE branch_id IS NOT NULL;

COMMIT;
