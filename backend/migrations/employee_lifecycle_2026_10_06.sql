-- 2026-10-06  Employee lifecycle consistency (idempotent; safe to re-run)
--
-- 1. exit_requests.exit_type  — termination becomes a type of the EXISTING exit flow (no second exit table).
-- 2. users.department_id      — legacy FK is now kept in step with the PRIMARY entry of user_departments
--                               (user_departments stays the source of truth). Backfill existing rows.
-- 3. user_departments         — users that only have a department NAME (text) and no junction row get the row,
--                               so every reader of the junction table (leave workflow, dept health) sees them.

ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS exit_type TEXT NOT NULL DEFAULT 'resignation';
ALTER TABLE exit_requests ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';

-- (3) text-only → junction (only when the name matches exactly ONE department of the user's own org)
INSERT INTO user_departments (user_id, department_id, role_in_dept, organization_id)
SELECT u.id, d.id, 'Member', u.organization_id
  FROM users u
  JOIN departments d ON d.organization_id = u.organization_id AND d.name = u.department
 WHERE NOT EXISTS (SELECT 1 FROM user_departments ud WHERE ud.user_id = u.id)
   AND (SELECT COUNT(*) FROM departments d2 WHERE d2.organization_id = u.organization_id AND d2.name = u.department) = 1
ON CONFLICT (user_id, department_id) DO NOTHING;

-- (2) junction primary → users.department_id (earliest assignment is the primary, as the leave workflow resolves it)
UPDATE users u
   SET department_id = x.department_id
  FROM (SELECT DISTINCT ON (user_id) user_id, department_id
          FROM user_departments ORDER BY user_id, created_at ASC, department_id ASC) x
 WHERE x.user_id = u.id
   AND u.department_id IS DISTINCT FROM x.department_id;
