-- ============================================================
-- add_has_multiple_branches_to_org_requests_2026_09_24.sql
--
-- Adds has_multiple_branches BOOLEAN to org_registration_requests.
-- When an applicant answers YES to "Does your organization have
-- multiple branches?", this field is set true. Platform Admin
-- approval then automatically enables the branches feature flag
-- for the new organization.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
-- ADDITIVE ONLY: no existing rows or constraints modified.
--
-- Run: psql -U lumos_admin -d lumos_hrms \
--        -f migrations/add_has_multiple_branches_to_org_requests_2026_09_24.sql
-- ============================================================

BEGIN;

ALTER TABLE org_registration_requests
  ADD COLUMN IF NOT EXISTS has_multiple_branches BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN org_registration_requests.has_multiple_branches IS
  'True when registrant selected YES to the multiple-branches question. '
  'Used by Platform Admin approval to auto-enable the branches feature flag.';

INSERT INTO schema_migrations (version, description)
VALUES (
  '20260924_has_multiple_branches',
  'Add has_multiple_branches to org_registration_requests for branch auto-enable on approval'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- Verification
SELECT column_name, data_type, column_default
FROM   information_schema.columns
WHERE  table_name = 'org_registration_requests'
  AND  column_name = 'has_multiple_branches';
