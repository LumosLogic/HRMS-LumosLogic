-- fix_missing_system_roles_2026_10_09.sql
--
-- Some organizations have NO "HR Admin" / "Employee" / "Department Head" system role (the original seed only covered
-- organizations whose status was active/pending at that moment, and the platform approval seed is fire-and-forget).
-- Symptom: an HR admin with a branch assigned sees every page EXCEPT Employees — GET /employees is guarded by the strict
-- employees.view permission, and with no hr_admin role in the org the HR account has no baseline permissions at all
-- (most other pages use the legacy-friendly check, so they kept working). The Employees page then showed an empty list.
--
-- This creates ONLY the system roles an organization is missing, with the same default permissions as the original seed
-- (phase1_01_rbac_tables.sql / services/permissionService.seedSystemRolesForOrg). A role that already exists is never
-- touched: permissions an admin removed from an existing role are NOT re-granted. No user, user_roles row or existing
-- role_permissions row changes. Idempotent — safe to run twice.
--
-- Check which orgs are affected BEFORE running:
--   SELECT o.id, o.name, o.status, string_agg(r.slug, ', ' ORDER BY r.slug) AS system_roles
--     FROM organizations o LEFT JOIN roles r ON r.org_id = o.id AND r.is_system_role GROUP BY o.id ORDER BY o.id;
--
-- Run:
--   docker cp backend/migrations/fix_missing_system_roles_2026_10_09.sql lumos_postgres:/tmp/fix_roles.sql
--   docker exec -it lumos_postgres psql -U lumos_admin -d lumos_hrms -v ON_ERROR_STOP=1 -f /tmp/fix_roles.sql
-- then restart the backend (permissions are cached for 5 minutes per process).
BEGIN;

DO $$
DECLARE
  o   RECORD;
  rid BIGINT;
BEGIN
  FOR o IN SELECT id FROM organizations LOOP

    -- Root Admin: every permission (only when the role itself was missing)
    rid := NULL;
    INSERT INTO roles (org_id, name, slug, description, is_system_role)
    VALUES (o.id, 'Root Admin', 'root_admin', 'Full system access. Can manage all modules, roles and settings.', true)
    ON CONFLICT (org_id, slug) DO NOTHING RETURNING id INTO rid;
    IF rid IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, permission_id) SELECT rid, p.id FROM permissions p ON CONFLICT DO NOTHING;
      RAISE NOTICE 'org %: created root_admin', o.id;
    END IF;

    -- HR Admin
    rid := NULL;
    INSERT INTO roles (org_id, name, slug, description, is_system_role)
    VALUES (o.id, 'HR Admin', 'hr_admin', 'HR management access. Can manage employees, attendance, leaves and payroll.', true)
    ON CONFLICT (org_id, slug) DO NOTHING RETURNING id INTO rid;
    IF rid IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rid, p.id FROM permissions p
      WHERE (p.module_key, p.action) IN (
        ('dashboard','view'),('employees','view'),('employees','create'),('employees','edit'),('employees','delete'),('employees','export'),
        ('departments','view'),('departments','create'),('departments','edit'),('departments','delete'),
        ('designations','view'),('designations','manage'),
        ('attendance','view'),('attendance','edit'),('attendance','export'),('attendance','approve_regularization'),
        ('leaves','view'),('leaves','approve'),('leaves','reject'),('leaves','export'),
        ('payroll','view'),('payroll','generate'),('payroll','export'),('payroll','lock'),('payroll','manage_structures'),('payroll','manage_adjustments'),
        ('reports','view'),('reports','export'),('settings','view'),('settings','manage'),
        ('documents','view'),('documents','upload'),('documents','manage'),('documents','delete'),
        ('onboarding','view'),('onboarding','manage'),('onboarding','complete_task'),
        ('announcements','view'),('announcements','create'),('announcements','manage'),
        ('holidays','view'),('holidays','create'),('holidays','manage'),
        ('shifts','view'),('shifts','create'),('shifts','manage'),
        ('biometric','view'),('branches','view'),
        ('assets','view'),('assets','create'),('assets','manage'),('assets','assign'),
        ('expenses','view'),('expenses','approve'),('expenses','manage'),
        ('performance','view'),('performance','create'),('performance','manage'),
        ('exit','view'),('exit','approve'),('exit','manage'),
        ('roles','view'),('notifications','view'),('notifications','broadcast')
      )
      ON CONFLICT DO NOTHING;
      RAISE NOTICE 'org %: created hr_admin', o.id;
    END IF;

    -- Department Head (+ the team-scope permissions every Dept Head role gets)
    rid := NULL;
    INSERT INTO roles (org_id, name, slug, description, is_system_role)
    VALUES (o.id, 'Department Head', 'dept_head', 'Department-level access. Can forward leaves and view team data.', true)
    ON CONFLICT (org_id, slug) DO NOTHING RETURNING id INTO rid;
    IF rid IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rid, p.id FROM permissions p
      WHERE (p.module_key, p.action) IN (
        ('dashboard','view'),('employees','view'),('departments','view'),('attendance','view'),('leaves','view'),('leaves','forward'),
        ('documents','view'),('announcements','view'),('holidays','view'),('onboarding','view'),('performance','view'),
        ('expenses','view'),('reports','view'),('notifications','view')
      ) OR p.module_key = 'team'
      ON CONFLICT DO NOTHING;
      RAISE NOTICE 'org %: created dept_head', o.id;
    END IF;

    -- Employee
    rid := NULL;
    INSERT INTO roles (org_id, name, slug, description, is_system_role)
    VALUES (o.id, 'Employee', 'employee', 'Standard employee access. Self-service only.', true)
    ON CONFLICT (org_id, slug) DO NOTHING RETURNING id INTO rid;
    IF rid IS NOT NULL THEN
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rid, p.id FROM permissions p
      WHERE (p.module_key, p.action) IN (
        ('dashboard','view'),('attendance','view'),('leaves','view'),('leaves','create'),('documents','view'),('documents','upload'),
        ('announcements','view'),('holidays','view'),('expenses','view'),('expenses','create'),
        ('performance','view'),('performance','create'),('onboarding','view'),('onboarding','complete_task'),('notifications','view')
      )
      ON CONFLICT DO NOTHING;
      RAISE NOTICE 'org %: created employee', o.id;
    END IF;

  END LOOP;
END $$;

COMMIT;

-- Verify: every organization should now list root_admin, hr_admin, dept_head, manager, employee.
SELECT o.id, o.name, string_agg(r.slug, ', ' ORDER BY r.slug) AS system_roles
  FROM organizations o LEFT JOIN roles r ON r.org_id = o.id AND r.is_system_role
 GROUP BY o.id, o.name ORDER BY o.id;
