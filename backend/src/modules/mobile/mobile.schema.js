/**
 * Mobile-app database objects. Everything lives in NEW tables that only mobile code reads or writes —
 * no existing HRMS table is altered and no trigger is placed on a web table.
 */
const { pool } = require('../../config/db');

async function ensureMobileSchema() {
  const stmts = [
    // Master switch per organization. Existing orgs are grandfathered ON exactly once (when the table is
    // first created); orgs added later have no row = OFF until the platform admin enables them.
    `DO $$ BEGIN
       IF to_regclass('public.mobile_org_settings') IS NULL THEN
         CREATE TABLE mobile_org_settings (
           organization_id BIGINT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
           enabled         BOOLEAN NOT NULL DEFAULT false,
           updated_at      TIMESTAMPTZ DEFAULT NOW()
         );
         INSERT INTO mobile_org_settings (organization_id, enabled) SELECT id, true FROM organizations;
       END IF;
     END $$`,
    `CREATE TABLE IF NOT EXISTS mobile_org_features (
       organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
       feature_key     TEXT   NOT NULL,
       enabled         BOOLEAN NOT NULL DEFAULT true,
       updated_at      TIMESTAMPTZ DEFAULT NOW(),
       PRIMARY KEY (organization_id, feature_key)
     )`,
  ];
  for (const sql of stmts) {
    await pool.query(sql).catch(e => console.warn('[mobile-schema] skipped:', e.message));
  }
}

module.exports = { ensureMobileSchema };
