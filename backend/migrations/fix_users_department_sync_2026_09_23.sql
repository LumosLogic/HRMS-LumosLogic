-- fix_users_department_sync_2026_09_23.sql
--
-- Backfill users.department for all employees whose text column is out of sync
-- with their user_departments junction table (primary = lowest department_id).
--
-- Root cause: PUT /api/profile/:id/professional did not sync users.department
-- after updating user_departments. Fixed in professional.routes.js 2026-09-23.
--
-- Safe to re-run: UPDATE is a no-op when values already match.

UPDATE users u
SET department = (
  SELECT d.name
  FROM user_departments ud
  JOIN departments d ON d.id = ud.department_id
  WHERE ud.user_id  = u.id
    AND d.organization_id = u.organization_id
  ORDER BY ud.department_id ASC
  LIMIT 1
)
WHERE
  -- Only update rows where user_departments has data but users.department is stale/empty
  EXISTS (
    SELECT 1 FROM user_departments ud2
    WHERE ud2.user_id = u.id
  )
  AND (
    u.department IS NULL
    OR u.department = ''
    OR u.department = 'General'
    -- re-sync even non-General values so everything is consistent
    OR u.department != (
      SELECT d2.name
      FROM user_departments ud3
      JOIN departments d2 ON d2.id = ud3.department_id
      WHERE ud3.user_id = u.id
        AND d2.organization_id = u.organization_id
      ORDER BY ud3.department_id ASC
      LIMIT 1
    )
  );
