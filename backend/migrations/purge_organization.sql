-- ============================================================
-- PURGE ORGANIZATION DATA
-- Wipes ALL operational data for one organization while keeping
-- the "org shell" reusable:
--
--   KEPT:
--     * organizations row (name, slug, plan, domain, annual leaves, SMTP, etc.)
--     * organization_features (feature flags 15/18 remain)
--     * the org's root_admin user(s) + their RBAC role + role mapping
--
--   DELETED (everything else for that org):
--     * users (except root_admin), departments, designations, user_departments
--     * branches, branch_work_schedule, config_groups*
--     * attendance, attendance_regularization, biometric*
--     * leaves, leave_policies, leave_balance_adjustments, leave_comments
--     * shifts, shift_assignments, holidays, events
--     * payroll (structures, payslips, runs, adjustments, statutory*)
--     * employee profile/documents, documents compliance
--     * performance, onboarding, exit, expenses, assets
--     * announcements, notifications, push subscriptions
--     * RBAC roles/user_roles/role_permissions (except root_admin)
--
-- Mechanism: disables FK enforcement for this session
-- (session_replication_role = replica) so delete order is irrelevant
-- and RESTRICT/NO-ACTION foreign keys do not block. Requires superuser
-- (lumos_admin is the POSTGRES_USER, so this works).
--
-- Target org: change the org_slug below.
--
-- RUN:
--   docker cp backend/migrations/purge_organization.sql lumos_postgres:/tmp/purge_organization.sql
--   docker exec lumos_postgres psql -U lumos_admin -d lumos_hrms -f /tmp/purge_organization.sql
-- ============================================================

SET session_replication_role = replica;

BEGIN;

DO $$
DECLARE
  org_slug      TEXT    := 'test-lumos-logic';   -- <-- CHANGE TO TARGET ORG SLUG
  v_org_id      BIGINT;
  root_user_ids BIGINT[];
  root_role_id  BIGINT;
  r             RECORD;
BEGIN
  SELECT id INTO v_org_id
  FROM organizations
  WHERE slug = org_slug;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organization with slug ''%'' not found', org_slug;
  END IF;

  -- Capture the identities we must preserve BEFORE any deletes.
  SELECT COALESCE(array_agg(id), ARRAY[]::BIGINT[]) INTO root_user_ids
  FROM users
  WHERE organization_id = v_org_id
    AND role = 'root_admin';

  SELECT id INTO root_role_id
  FROM roles
  WHERE org_id = v_org_id AND slug = 'root_admin'
  LIMIT 1;

  RAISE NOTICE 'Wiping org id=%, slug=%. Preserving root_admin users=% and role=%',
    v_org_id, org_slug, root_user_ids, root_role_id;

  -- Temp table of the users we will delete (everyone except root_admin).
  CREATE TEMP TABLE _del_users ON COMMIT DROP AS
    SELECT id FROM users
    WHERE organization_id = v_org_id
      AND NOT (id = ANY(root_user_ids));

  -- ───────────────────────────────────────────────────────────
  -- 1) All org-scoped tables that use organization_id
  --    (skip the org row itself, its feature flags, and users)
  -- ───────────────────────────────────────────────────────────
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name
     AND t.table_schema = c.table_schema
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.table_name NOT IN ('organizations', 'organization_features', 'users')
  LOOP
    EXECUTE format('DELETE FROM %I WHERE organization_id = %L', r.table_name, v_org_id);
  END LOOP;

  -- ───────────────────────────────────────────────────────────
  -- 2) RBAC tables that use org_id (roles/user_roles handled below)
  -- ───────────────────────────────────────────────────────────
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name
     AND t.table_schema = c.table_schema
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'org_id'
      AND c.table_name NOT IN ('roles', 'user_roles')
  LOOP
    EXECUTE format('DELETE FROM %I WHERE org_id = %L', r.table_name, v_org_id);
  END LOOP;

  -- ───────────────────────────────────────────────────────────
  -- 3) RBAC cleanup — keep root_admin role + its mapping only
  -- ───────────────────────────────────────────────────────────
  IF root_role_id IS NOT NULL THEN
    -- Remove all user->role mappings for the org except root_admin's.
    DELETE FROM user_roles
    WHERE org_id = v_org_id
      AND NOT (role_id = root_role_id AND user_id = ANY(root_user_ids));

    -- Remove permissions of every non-root role.
    DELETE FROM role_permissions
    WHERE role_id IN (
      SELECT id FROM roles WHERE org_id = v_org_id AND id <> root_role_id
    );

    -- Remove every role except root_admin.
    DELETE FROM roles
    WHERE org_id = v_org_id AND id <> root_role_id;
  ELSE
    -- No root_admin role exists; drop any mappings/roles outright.
    DELETE FROM user_roles WHERE org_id = v_org_id;
    DELETE FROM roles     WHERE org_id = v_org_id;
  END IF;

  -- ───────────────────────────────────────────────────────────
  -- 4) Clear org-scoped columns dangling on the kept root_admin
  --    (departments/branches/designations are being deleted)
  -- ───────────────────────────────────────────────────────────
  IF array_length(root_user_ids, 1) IS NOT NULL THEN
    UPDATE users
    SET department_id  = NULL,
        designation_id = NULL,
        branch_id      = NULL
    WHERE id = ANY(root_user_ids);
  END IF;

  -- ───────────────────────────────────────────────────────────
  -- 5) Delete the users themselves (except root_admin)
  --    (FK enforcement is off, so this is a plain delete)
  -- ───────────────────────────────────────────────────────────
  DELETE FROM users
  WHERE organization_id = v_org_id
    AND NOT (id = ANY(root_user_ids));

  -- Kept tables: null out dangling refs instead of deleting rows.
  UPDATE roles SET created_by = NULL WHERE created_by IN (SELECT id FROM _del_users);

  -- ───────────────────────────────────────────────────────────
  -- 6) Clean up rows in tables WITHOUT org scope that still
  --    reference the deleted users (e.g. notifications_log)
  --    a) via declared foreign keys pointing at users.id
  -- ───────────────────────────────────────────────────────────
  FOR r IN
    SELECT DISTINCT
           tc.table_name  AS table_name,
           kcu.column_name AS column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema    = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema    = 'public'
      AND ccu.table_name     = 'users'
      AND ccu.column_name    = 'id'
      AND tc.table_name NOT IN ('users', 'roles', 'user_roles')
  LOOP
    EXECUTE format(
      'DELETE FROM %I WHERE %I IN (SELECT id FROM _del_users)',
      r.table_name, r.column_name
    );
  END LOOP;

  --    b) via conventional user-id column names that carry no FK
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name
     AND t.table_schema = c.table_schema
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.table_name NOT IN ('users', 'roles', 'user_roles', 'role_permissions', 'organizations', 'organization_features')
      AND c.column_name IN (
        'user_id', 'target_user_id', 'sent_by', 'created_by',
        'approved_by', 'reviewed_by', 'reviewer_id', 'uploaded_by',
        'generated_by', 'head_user_id', 'shared_with_user_id',
        'assigned_by', 'manager_id', 'assigned_to_user_id'
      )
  LOOP
    EXECUTE format(
      'DELETE FROM %I WHERE %I IN (SELECT id FROM _del_users)',
      r.table_name, r.column_name
    );
  END LOOP;

  RAISE NOTICE 'Purge complete for org id=% (slug=%)', v_org_id, org_slug;
END $$;

COMMIT;

SET session_replication_role = DEFAULT;


-- ============================================================
-- VERIFICATION (run after the purge)
-- ============================================================

DO $$
DECLARE
  v_org_id BIGINT;
  r RECORD;
  cnt   BIGINT;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = 'test-lumos-logic';

  RAISE NOTICE 'Remaining data for org id=%:', v_org_id;

  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name
     AND t.table_schema = c.table_schema
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name IN ('organization_id', 'org_id')
      AND c.table_name NOT IN ('organizations')
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I WHERE %I = %L',
      r.table_name, r.column_name, v_org_id
    ) INTO cnt;
    RAISE NOTICE '  % -> % row(s)', r.table_name, cnt;
  END LOOP;
END $$;
