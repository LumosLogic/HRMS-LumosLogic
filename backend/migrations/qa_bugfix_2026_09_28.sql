-- QA Bugfix Migration — 2026-09-28
-- Applies all pending table/column changes needed to resolve open QA bugs.
-- Safe to run multiple times (all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING).

-- ── BUG_221: merchant_name / receipt_number columns on expenses ───────────────
-- These columns were added in add_expense_receipt_fields_2026_09_08.sql.
-- If that migration was skipped, add them here.
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS merchant_name   TEXT DEFAULT '';
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_number  TEXT DEFAULT '';

-- ── BUG_155: offboarding_checklists table ──────────────────────────────────────
-- Created in phase_d_offboarding_checklists.sql. Re-apply safely.
CREATE TABLE IF NOT EXISTS offboarding_checklists (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id  BIGINT NOT NULL,
  title            TEXT NOT NULL,
  description      TEXT DEFAULT '',
  due_date         DATE,
  assigned_to      TEXT NOT NULL DEFAULT 'hr'
                   CHECK (assigned_to IN ('employee', 'hr', 'it', 'manager', 'finance')),
  order_index      INTEGER NOT NULL DEFAULT 99,
  completed        BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at     TIMESTAMPTZ,
  completed_by     BIGINT REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS offboarding_checklists_user_idx ON offboarding_checklists(user_id);
CREATE INDEX IF NOT EXISTS offboarding_checklists_org_idx  ON offboarding_checklists(organization_id);

-- ── BUG_238: leave_policy_audit_log table ─────────────────────────────────────
-- Created in add_enhancements_2026_09_10.sql. Re-apply safely.
CREATE TABLE IF NOT EXISTS leave_policy_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  leave_type      TEXT NOT NULL,
  field_changed   TEXT,
  old_value       TEXT,
  new_value       TEXT,
  changed_by      BIGINT REFERENCES users(id),
  changed_by_name TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lp_audit_org ON leave_policy_audit_log(organization_id);

-- ── BUG_064: grant branches.create + branches.manage to HR Admin role ─────────
-- Also created in fix_branches_hr_permissions.sql. Re-apply safely.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (p.module_key, p.action) IN (
  ('branches', 'create'),
  ('branches', 'manage')
)
WHERE r.slug = 'hr_admin'
  AND r.is_system_role = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ── BUG_239: goal_attachments + goal_comments tables ─────────────────────────
-- Created in add_enhancements_2026_09_10.sql. Re-apply safely.
CREATE TABLE IF NOT EXISTS goal_attachments (
  id                   BIGSERIAL PRIMARY KEY,
  goal_id              BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  organization_id      BIGINT NOT NULL,
  uploaded_by          BIGINT REFERENCES users(id),
  file_name            TEXT NOT NULL,
  file_url             TEXT NOT NULL,
  cloudinary_public_id TEXT,
  file_size            BIGINT,
  mime_type            TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS goal_comments (
  id              BIGSERIAL PRIMARY KEY,
  goal_id         BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL,
  reviewer_id     BIGINT REFERENCES users(id),
  comment         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS goal_assessments (
  id              BIGSERIAL PRIMARY KEY,
  goal_id         BIGINT NOT NULL REFERENCES performance_goals(id) ON DELETE CASCADE,
  organization_id BIGINT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('self', 'manager')),
  text            TEXT DEFAULT '',
  rating          NUMERIC DEFAULT 0,
  assessed_by     BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(goal_id, type)
);
ALTER TABLE goal_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE goal_comments    DISABLE ROW LEVEL SECURITY;
ALTER TABLE goal_assessments DISABLE ROW LEVEL SECURITY;

-- ── Announcement enhancements (BUG_232, BUG_240, BUG_242) ────────────────────
ALTER TABLE announcements        ADD COLUMN IF NOT EXISTS scheduled_at        TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE announcements        ADD COLUMN IF NOT EXISTS published_notified   BOOLEAN     DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS announcement_reads (
  id              BIGSERIAL PRIMARY KEY,
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ DEFAULT NOW(),
  organization_id BIGINT,
  UNIQUE(announcement_id, user_id)
);
ALTER TABLE announcement_reads DISABLE ROW LEVEL SECURITY;

-- ── Leave comments (BUG_234/235) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_comments (
  id              BIGSERIAL PRIMARY KEY,
  leave_id        BIGINT NOT NULL REFERENCES leaves(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  comment         TEXT NOT NULL,
  organization_id BIGINT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leave_comments DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_leave_comments_leave_id ON leave_comments(leave_id);

-- ── Notification archiving (ENH_NOT_005) ─────────────────────────────────────
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
