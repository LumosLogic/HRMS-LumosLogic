-- ============================================================
-- add_payroll_manage_settings_2026_09_24.sql
--
-- Adds the missing payroll.manage_settings permission to the
-- global catalog and grants it to root_admin and hr_admin.
--
-- Background: PUT /api/payroll/settings and
-- POST /api/payroll/apply-probation-bulk both guard with
-- hasPermission('payroll', 'manage_settings'), but this
-- permission was never seeded — causing permanent 403 for
-- all users including Root Admin.
--
-- Safe to re-run: INSERT ... ON CONFLICT DO NOTHING.
-- ADDITIVE ONLY: no existing rows modified.
--
-- Run: psql -U lumos_admin -d lumos_hrms \
--        -f migrations/add_payroll_manage_settings_2026_09_24.sql
-- ============================================================

BEGIN;

-- ─── Step 1: Add missing permission to global catalog ─────────────────────────

INSERT INTO permissions (module_key, action, label, description)
VALUES (
  'payroll',
  'manage_settings',
  'Manage Payroll Settings',
  'Configure payroll cycle, deductions, probation rules and automation settings.'
)
ON CONFLICT (module_key, action) DO NOTHING;

-- ─── Step 2: Grant to root_admin in every org ─────────────────────────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
CROSS  JOIN permissions p
WHERE  r.slug          = 'root_admin'
  AND  r.is_system_role = true
  AND  p.module_key    = 'payroll'
  AND  p.action        = 'manage_settings'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─── Step 3: Grant to hr_admin in every org ───────────────────────────────────

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM   roles r
CROSS  JOIN permissions p
WHERE  r.slug          = 'hr_admin'
  AND  r.is_system_role = true
  AND  p.module_key    = 'payroll'
  AND  p.action        = 'manage_settings'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─── Record migration ──────────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, description)
VALUES (
  '20260924_payroll_manage_settings',
  'Add missing payroll.manage_settings permission; grant to root_admin and hr_admin'
)
ON CONFLICT (version) DO NOTHING;

COMMIT;

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Run after COMMIT to confirm the permission is accessible:

SELECT r.slug AS role, p.module_key, p.action
FROM   role_permissions rp
JOIN   roles       r ON r.id = rp.role_id
JOIN   permissions p ON p.id = rp.permission_id
WHERE  p.module_key = 'payroll'
  AND  p.action     = 'manage_settings'
ORDER  BY r.slug;
