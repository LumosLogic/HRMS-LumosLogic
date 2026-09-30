-- QA Bugfix Batch — 2026-09-30
-- BUG_206: Ensure statutory columns exist on users table.
-- These were added in sanghavi_biometric_migration.sql but may be absent on fresh DBs.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pf_applicable         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pf_no                 TEXT,
  ADD COLUMN IF NOT EXISTS vpf_applicable        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vpf_percentage        NUMERIC(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_pf_amount         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pran                  TEXT,
  ADD COLUMN IF NOT EXISTS is_pf_on_gross        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS esi_applicable        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS esi_no                TEXT,
  ADD COLUMN IF NOT EXISTS esi_dispensary        TEXT,
  ADD COLUMN IF NOT EXISTS esi_office            TEXT,
  ADD COLUMN IF NOT EXISTS pt_applicable         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pt_rule               TEXT,
  ADD COLUMN IF NOT EXISTS lwf_applicable        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gratuity_applicable   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS gratuity_id           TEXT,
  ADD COLUMN IF NOT EXISTS gl_code               TEXT,
  ADD COLUMN IF NOT EXISTS bonus_applicable      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ot_applicable         BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ot_rate               NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ot_paid_with_salary   BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS salary_structure      TEXT DEFAULT 'GROSS',
  ADD COLUMN IF NOT EXISTS salary_on             TEXT DEFAULT 'Month',
  ADD COLUMN IF NOT EXISTS per_hour_rate         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_day_wages         NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_slip_format    TEXT DEFAULT 'Format1',
  ADD COLUMN IF NOT EXISTS max_weekoff_in_month  INTEGER DEFAULT 8,
  ADD COLUMN IF NOT EXISTS special_allowance     NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pan_name              TEXT,
  ADD COLUMN IF NOT EXISTS voter_id              TEXT,
  ADD COLUMN IF NOT EXISTS uan_no                TEXT,
  ADD COLUMN IF NOT EXISTS aadhar_no             TEXT,
  ADD COLUMN IF NOT EXISTS pan_number            TEXT;

-- BUG_206: update employee_status constraint to include 'probation' if not already present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chk_users_employee_status'
      AND table_name = 'users'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_employee_status;
  END IF;
  ALTER TABLE users ADD CONSTRAINT chk_users_employee_status
    CHECK (employee_status IN ('active','inactive','resigned','terminated','on_leave','probation'));
END $$;

-- BUG_239: Ensure goal_comments and goal_attachments tables exist (may have been missed in earlier migration)
CREATE TABLE IF NOT EXISTS goal_attachments (
  id               BIGSERIAL PRIMARY KEY,
  goal_id          BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  organization_id  BIGINT NOT NULL,
  file_url         TEXT NOT NULL,
  file_name        TEXT,
  file_type        TEXT,
  file_size        BIGINT,
  uploaded_by      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE goal_attachments DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_goal_attachments_goal_id ON goal_attachments(goal_id);

CREATE TABLE IF NOT EXISTS goal_comments (
  id               BIGSERIAL PRIMARY KEY,
  goal_id          BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  organization_id  BIGINT NOT NULL,
  reviewer_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
  comment          TEXT NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE goal_comments DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_goal_comments_goal_id ON goal_comments(goal_id);

-- Record migration
INSERT INTO schema_migrations (version, description)
VALUES ('20260930_001', 'BUG_206: ensure statutory columns exist; add probation to employee_status constraint; BUG_239: goal_comments + goal_attachments tables')
ON CONFLICT (version) DO NOTHING;
