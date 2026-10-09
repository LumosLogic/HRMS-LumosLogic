-- add_goal_attachments_file_type_2026_10_09.sql
-- goal_attachments was created by three migrations with different column sets (mime_type vs file_type). Databases built from
-- add_enhancements_2026_09_10.sql / qa_bugfix_2026_09_28.sql have no file_type column, so uploading a goal attachment failed with
--   column "file_type" of relation "goal_attachments" does not exist
-- The app now copes with either shape; this migration makes both columns exist. Additive + idempotent: no rows change.
--
-- Run:
--   docker cp backend/migrations/add_goal_attachments_file_type_2026_10_09.sql lumos_postgres:/tmp/ga.sql
--   docker exec -it lumos_postgres psql -U lumos_admin -d lumos_hrms -v ON_ERROR_STOP=1 -f /tmp/ga.sql
BEGIN;
ALTER TABLE goal_attachments ADD COLUMN IF NOT EXISTS file_type TEXT;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = current_schema() AND table_name = 'goal_attachments' AND column_name = 'mime_type') THEN
    EXECUTE 'UPDATE goal_attachments SET file_type = mime_type WHERE file_type IS NULL';
  END IF;
END $$;
COMMIT;
