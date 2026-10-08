-- Notifications about an employee (sent to admins) carry that employee, so the notification list
-- can follow the selected branch (subject's users.branch_id). NULL = not employee-specific -> always shown.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS subject_user_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_notifications_subject ON notifications(subject_user_id) WHERE subject_user_id IS NOT NULL;
