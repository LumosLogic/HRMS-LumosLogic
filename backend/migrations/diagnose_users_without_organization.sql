-- ============================================================
-- diagnose_users_without_organization.sql   (READ-ONLY — changes nothing)
--
-- The login flow used to silently place a user with organization_id = NULL into organisation 1
-- ("organization_id || 1"). That was a tenant-isolation hole, so login now REFUSES such users
-- (HTTP 403, code NO_ORGANIZATION) instead.
--
-- Run this BEFORE deploying to find any legacy users that would be affected. Fix each one
-- deliberately (decide which organisation they really belong to) — never bulk-assign to org 1.
--
--   docker exec -i lumos_postgres psql -U lumos_admin -d lumos_hrms -f diagnose_users_without_organization.sql
-- ============================================================

-- Users that will be refused at login until they are linked to an organisation
SELECT id, name, email, role, employee_status, created_at
  FROM users
 WHERE organization_id IS NULL
 ORDER BY id;

-- Same, as a count (expect 0)
SELECT COUNT(*) AS users_without_organization FROM users WHERE organization_id IS NULL;

-- Users pointing at an organisation that no longer exists (also unusable)
SELECT u.id, u.name, u.email, u.organization_id
  FROM users u LEFT JOIN organizations o ON o.id = u.organization_id
 WHERE u.organization_id IS NOT NULL AND o.id IS NULL;

-- To link ONE user after you have decided the correct organisation (example — edit before running):
--   UPDATE users SET organization_id = <ORG_ID> WHERE id = <USER_ID> AND organization_id IS NULL;
