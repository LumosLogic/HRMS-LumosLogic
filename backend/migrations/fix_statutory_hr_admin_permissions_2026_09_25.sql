-- ============================================================
-- Fix: Add statutory permissions to hr_admin system role
-- Bug-066: HR Admin Compliance Dashboard not loading
-- Bug-067: HR Admin Statutory Config page not loading
-- Safe to re-run: uses ON CONFLICT DO NOTHING
-- ============================================================

BEGIN;

-- Ensure statutory permissions exist in the permissions table
-- (Skipped silently if they already exist from phase3_07_statutory_compliance.sql)
INSERT INTO permissions (module_key, action, label, description)
VALUES
  ('statutory', 'view',      'View Statutory',      'View compliance dashboard and statutory reports'),
  ('statutory', 'configure', 'Configure Statutory', 'Configure statutory settings and generate reports')
ON CONFLICT (module_key, action) DO NOTHING;

-- Grant statutory.view + statutory.configure to hr_admin system role in ALL orgs
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.is_system_role = true
  AND r.slug = 'hr_admin'
  AND p.module_key = 'statutory'
  AND p.action IN ('view', 'configure')
ON CONFLICT DO NOTHING;

-- Record migration
INSERT INTO schema_migrations(version, description)
VALUES ('20260925_statutory_hr_admin_permissions', 'Add statutory.view permission to hr_admin system role (Bug-066, Bug-067)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
