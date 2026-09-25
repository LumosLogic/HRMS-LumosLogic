-- ============================================================
-- Fix: Sync users.department text field with user_departments junction
-- Bug-069/070/071: Department shows "General" in reports for newly assigned depts
-- This updates users.department to match the primary (first) department from
-- the user_departments junction table for any employee with a mismatch.
-- Safe to re-run: only updates rows where the department name differs.
-- ============================================================

BEGIN;

-- Update users.department to match their primary department name from the junction table
-- Only updates employees where the current users.department doesn't match any of their dept names
UPDATE users u
SET department = d.name
FROM (
  SELECT DISTINCT ON (ud.user_id)
    ud.user_id,
    d.name
  FROM user_departments ud
  JOIN departments d ON d.id = ud.department_id
  WHERE d.organization_id = ud.organization_id
  ORDER BY ud.user_id, ud.id  -- take first assigned department as primary
) sub
JOIN departments d ON d.name = sub.name
WHERE u.id = sub.user_id
  AND u.department != sub.name
  AND u.role = 'employee';

-- Record migration
INSERT INTO schema_migrations(version, description)
VALUES ('20260925_fix_department_name_sync', 'Sync users.department text field with primary department from user_departments junction (Bug-069, Bug-070, Bug-071)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
