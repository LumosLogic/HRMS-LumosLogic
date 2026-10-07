-- Payroll simplification (2026-10-07)
-- Adds payslip template / watermark / custom-field settings to the EXISTING payroll_settings row.
-- No new tables. Safe to re-run (ADD COLUMN IF NOT EXISTS). Existing orgs keep today's look
-- (template 'classic', logo watermark, no custom fields).

ALTER TABLE payroll_settings
  ADD COLUMN IF NOT EXISTS payslip_template       TEXT  NOT NULL DEFAULT 'classic',
  ADD COLUMN IF NOT EXISTS payslip_watermark_mode TEXT  NOT NULL DEFAULT 'logo',
  ADD COLUMN IF NOT EXISTS payslip_watermark_text TEXT,
  ADD COLUMN IF NOT EXISTS payslip_custom_fields  JSONB NOT NULL DEFAULT '[]'::jsonb;
