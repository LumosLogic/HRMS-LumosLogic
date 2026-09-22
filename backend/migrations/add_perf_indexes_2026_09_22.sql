-- ============================================================
-- add_perf_indexes_2026_09_22.sql
--
-- Purpose:
--   Add missing indexes to speed up employee list queries,
--   especially branch-filtered loads on the /root/employees
--   and HR admin employees pages.
--
-- IMPORTANT: CONCURRENTLY cannot run inside a transaction block.
--   Run this file standalone — do NOT wrap in BEGIN/COMMIT.
--   Safe to re-run (all are IF NOT EXISTS).
--
-- Generated: 2026-09-22
-- ============================================================

-- 1. Branch-filtered employee list (most impactful — used on every page load)
--    Covers: WHERE organization_id = $1 AND branch_id = $2
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_branch
  ON users(organization_id, branch_id);

-- 2. Employee list with status filter (active-only pages like Calendar, Dashboard)
--    Covers: WHERE organization_id = $1 AND employee_status NOT IN (...)  ORDER BY name
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_status_name
  ON users(organization_id, employee_status, name);

-- 3. user_departments join — speeds up the LEFT JOIN in the merged employee query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_departments_user_id
  ON user_departments(user_id);

-- Verify
SELECT indexname, tablename
FROM   pg_indexes
WHERE  indexname IN (
  'idx_users_org_branch',
  'idx_users_org_status_name',
  'idx_user_departments_user_id'
)
ORDER  BY indexname;
