-- ============================================================
-- add_team_scope_manager_role_2026_10_07.sql
--
-- Manager / Head-of-Department team scope (additive, safe to re-run).
--   1. Adds the `team` permission module to the global catalog.
--   2. Creates the fixed "Manager" system role in every organization.
--   3. Grants the team permissions to Root Admin, Manager and Department Head by default.
--
-- Manager / HOD membership is DERIVED (users.reporting_to / departments.head_user_id) — nothing is
-- assigned per user and no existing row is modified. Root Admin can edit the Manager and
-- Department Head permission sets in Role Management afterwards.
--
-- Run: psql -U lumos_admin -d lumos_hrms -f migrations/add_team_scope_manager_role_2026_10_07.sql
-- ============================================================

BEGIN;

INSERT INTO permissions (module_key, action, label, description) VALUES
  ('team', 'view',           'View Team Members',        'See the list and basic profile of the employees in my team / department.'),
  ('team', 'attendance',     'View Team Attendance',     'See attendance records of the employees in my team / department.'),
  ('team', 'leaves',         'View Team Leaves',         'See leave requests and balances of the employees in my team / department.'),
  ('team', 'regularization', 'View Team Regularization', 'See attendance regularization requests of the employees in my team / department.'),
  ('team', 'performance',    'View Team Performance',    'See goals and reviews of the employees in my team / department.')
ON CONFLICT (module_key, action) DO NOTHING;

-- Manager system role for every existing organization
INSERT INTO roles (org_id, name, slug, description, is_system_role)
SELECT o.id, 'Manager', 'manager', 'Reporting-manager team access.', true
FROM organizations o
ON CONFLICT (org_id, slug) DO NOTHING;

-- Default team permissions: Root Admin (all), Manager, Department Head
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system_role = true
  AND r.slug IN ('root_admin', 'manager', 'dept_head')
  AND p.module_key = 'team'
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
