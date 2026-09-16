-- ================================================================
-- Phase 2B-5: Branch Targeting for Document Requirements
-- Version: 2026_09_16_02
-- Date: 2026-09-16
--
-- Adds assigned_branch_ids BIGINT[] to document_requirements so
-- admins can target requirements at specific branches.
--
-- Design:
--   NULL / empty array → no branch restriction (org-wide, existing behavior)
--   [2]               → applies to employees whose users.branch_id = 2
--   [2, 3]            → applies to employees in branch 2 or branch 3
--
-- Combines with existing assigned_employee_ids[]:
--   Both filters must pass for a requirement to apply to an employee.
--   NULL/empty on either dimension means "no restriction on that dimension".
--
-- DOES NOT touch:
--   employee_documents, employee_doc_submissions, document_shares,
--   doc_submission_activity, biometric, payroll, attendance, leave.
--
-- SAFE TO RE-RUN: ADD COLUMN IF NOT EXISTS / ON CONFLICT DO NOTHING
-- REVERSIBLE: ALTER TABLE document_requirements DROP COLUMN assigned_branch_ids;
-- ================================================================

BEGIN;

INSERT INTO schema_migrations (version, description)
VALUES ('2026_09_16_02', 'Add assigned_branch_ids[] to document_requirements for branch-level targeting')
ON CONFLICT (version) DO NOTHING;

ALTER TABLE document_requirements
  ADD COLUMN IF NOT EXISTS assigned_branch_ids BIGINT[] DEFAULT NULL;

-- GIN index for efficient array membership queries
-- WHERE assigned_branch_ids IS NOT NULL limits index size (most requirements are org-wide)
CREATE INDEX IF NOT EXISTS idx_doc_req_branch_ids
  ON document_requirements USING GIN (assigned_branch_ids)
  WHERE assigned_branch_ids IS NOT NULL;

COMMIT;
