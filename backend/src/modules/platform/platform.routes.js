const express = require('express');
const router  = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { db } = require('../../config/db');
const { pool }     = require('../../config/db-pg-adapter');
const { JWT_SECRET, platformAdminAuth } = require('../../middleware/auth');
const { sendMail, orgApprovedHtml, orgRejectedHtml } = require('../../services/emailService');
const { generateUniqueSlug } = require('../../utils/helpers');
const { seedSystemRolesForOrg } = require('../../services/permissionService');

// ─── All Feature Keys ─────────────────────────────────────────────────────────
const ALL_FEATURE_KEYS = [
  'announcements','regularization','leave_policies','shifts','onboarding',
  'exit_management','payroll','expenses','assets','reports',
  'performance','documents','google_calendar','push_notifications',
  'biometric','branches','statutory',
];

// Features that are off by default; only enabled when plan explicitly includes them
const BIOMETRIC_FEATURES = ['biometric', 'branches', 'statutory'];

// Plan → feature preset map (platinum now includes biometric suite)
const PLAN_FEATURES = {
  free:     { announcements: true, documents: true, regularization: false, leave_policies: false, shifts: false, onboarding: false, exit_management: false, payroll: false, expenses: false, assets: false, reports: false, performance: false, google_calendar: false, push_notifications: false, biometric: false, branches: false, statutory: false },
  gold:     { announcements: true, documents: true, regularization: true, leave_policies: true, shifts: true, reports: true, performance: true, payroll: true, onboarding: false, exit_management: false, expenses: false, assets: false, google_calendar: false, push_notifications: false, biometric: false, branches: false, statutory: false },
  platinum: Object.fromEntries(ALL_FEATURE_KEYS.map(k => [k, true])),
};

// Orgs that cannot be deleted (platform-owner orgs)
// 'sanghvi-association' is the current slug; 'relitrade' is the new slug after rename
const PROTECTED_ORG_SLUGS = ['lumoslogic', 'sanghvi-association', 'relitrade'];

// ─── Platform Admin: Login ────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: admin } = await db.from('platform_admins')
      .select('*').eq('email', email.toLowerCase().trim()).maybeSingle();
    if (!admin || !bcrypt.compareSync(password, admin.password))
      return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name, role: 'platform_admin' },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ token, admin: { id: admin.id, name: admin.name, email: admin.email } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Stats ────────────────────────────────────────────────────
router.get('/stats', platformAdminAuth, async (req, res) => {
  try {
    const [
      { count: totalOrgs },
      { count: pendingReqs },
      { count: totalUsers },
      { count: approvedOrgs },
    ] = await Promise.all([
      db.from('organizations').select('id', { count: 'exact', head: true }),
      db.from('org_registration_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      db.from('users').select('id', { count: 'exact', head: true }),
      db.from('org_registration_requests').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    ]);

    const { data: recentOrgs } = await db.from('organizations')
      .select('id, name, slug, status, plan, created_at').order('created_at', { ascending: false }).limit(5);

    const { data: recentRequests } = await db.from('org_registration_requests')
      .select('id, company_name, contact_name, email, status, created_at').order('created_at', { ascending: false }).limit(5);

    // Plan distribution
    const { data: allOrgs } = await db.from('organizations').select('plan, status, created_at');
    const planDist = {};
    const statusDist = {};
    (allOrgs || []).forEach(o => {
      const p = (o.plan || 'free').toLowerCase();
      planDist[p]   = (planDist[p] || 0) + 1;
      const s = o.status || 'active';
      statusDist[s] = (statusDist[s] || 0) + 1;
    });

    // Monthly org growth — last 6 months
    const monthlyGrowth = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const label = d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
      const count = (allOrgs || []).filter(o => {
        if (!o.created_at) return false;
        const d = new Date(o.created_at);
        return d.getFullYear() === y && d.getMonth() + 1 === parseInt(m, 10);
      }).length;
      monthlyGrowth.push({ label, count });
    }

    res.json({
      totalOrgs: totalOrgs || 0, pendingRequests: pendingReqs || 0,
      totalUsers: totalUsers || 0, approvedOrgs: approvedOrgs || 0,
      recentOrgs: recentOrgs || [], recentRequests: recentRequests || [],
      planDistribution: planDist, statusDistribution: statusDist, monthlyGrowth,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: All Organizations ───────────────────────────────────────
router.get('/organizations', platformAdminAuth, async (req, res) => {
  try {
    const { data: orgs } = await db.from('organizations')
      .select('id, name, slug, domain, status, plan, created_at').order('created_at', { ascending: false });

    const orgsWithCounts = await Promise.all((orgs || []).map(async org => {
      const { count: userCount } = await db.from('users').select('id', { count: 'exact', head: true }).eq('organization_id', org.id);
      return { ...org, userCount: userCount || 0 };
    }));

    res.json(orgsWithCounts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Organization Members & Details ───────────────────────────
router.get('/organizations/:id/members', platformAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: org } = await db.from('organizations')
      .select('id, name, slug, domain, status, plan, created_at, google_calendar_id, total_annual_leaves')
      .eq('id', id).single();
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { data: members } = await db.from('users')
      .select('id, name, email, role, department, position, avatar_color, created_at')
      .eq('organization_id', id)
      .order('role', { ascending: true })
      .order('name', { ascending: true });

    const { count: leaveCount } = await db.from('leaves')
      .select('id', { count: 'exact', head: true }).eq('organization_id', id);

    const { count: attendanceCount } = await db.from('attendance')
      .select('id', { count: 'exact', head: true }).eq('organization_id', id);

    res.json({ org, members: members || [], stats: { leaveCount: leaveCount || 0, attendanceCount: attendanceCount || 0 } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Get Feature Flags for an Org ────────────────────────────
router.get('/organizations/:id/features', platformAdminAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const [{ data: orgRow }, { data: featureRows }] = await Promise.all([
      db.from('organizations').select('plan').eq('id', orgId).maybeSingle(),
      db.from('organization_features').select('feature_key, enabled').eq('organization_id', orgId),
    ]);
    const plan = (orgRow?.plan || 'free').toLowerCase();
    const map = {};
    for (const row of featureRows || []) map[row.feature_key] = row.enabled;
    // Biometric features default off except for Platinum orgs that have no explicit flag
    const flags = {};
    for (const key of ALL_FEATURE_KEYS) {
      if (key in map) {
        flags[key] = map[key];
      } else if (BIOMETRIC_FEATURES.includes(key)) {
        flags[key] = plan === 'platinum';
      } else {
        flags[key] = true;
      }
    }
    res.json(flags);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Update Feature Flags for an Org ─────────────────────────
router.put('/organizations/:id/features', platformAdminAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const updates = req.body; // { payroll: true, expenses: false, ... }
    const upserts = Object.entries(updates)
      .filter(([key]) => ALL_FEATURE_KEYS.includes(key))
      .map(([feature_key, enabled]) => ({
        organization_id: orgId,
        feature_key,
        enabled: Boolean(enabled),
        updated_at: new Date().toISOString(),
      }));
    if (upserts.length) {
      await db.from('organization_features')
        .upsert(upserts, { onConflict: 'organization_id,feature_key' });
    }
    res.json({ success: true, updated: upserts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Update Org Plan (apply preset feature flags) ─────────────
router.patch('/organizations/:id/plan', platformAdminAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    const { plan } = req.body;
    const planKey = (plan || '').toLowerCase();
    if (!PLAN_FEATURES[planKey]) return res.status(400).json({ error: 'Invalid plan. Use free, gold, or platinum.' });
    await db.from('organizations').update({ plan }).eq('id', orgId);
    const featureMap = PLAN_FEATURES[planKey];
    const upserts = Object.entries(featureMap).map(([feature_key, enabled]) => ({
      organization_id: orgId, feature_key, enabled, updated_at: new Date().toISOString(),
    }));
    await db.from('organization_features').upsert(upserts, { onConflict: 'organization_id,feature_key' });
    res.json({ success: true, plan, featuresApplied: upserts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Registration Requests ───────────────────────────────────
router.get('/requests', platformAdminAuth, async (req, res) => {
  try {
    // Auto-delete rejected requests older than 7 days
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.from('org_registration_requests')
      .delete().eq('status', 'rejected').lt('reviewed_at', cutoff);

    const status = req.query.status || 'pending';
    let q = db.from('org_registration_requests').select('*').order('created_at', { ascending: false });
    if (status !== 'all') q = q.eq('status', status);
    const { data } = await q;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Delete a Registration Request ────────────────────────────
// Allowed for rejected or pending requests; approved requests are blocked.
router.delete('/requests/:id', platformAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: request } = await db.from('org_registration_requests')
      .select('id, status, company_name').eq('id', id).maybeSingle();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status === 'approved') {
      return res.status(400).json({ error: 'Approved requests cannot be deleted — they have an active organization linked to them.' });
    }
    await db.from('org_registration_requests').delete().eq('id', id);
    res.json({ ok: true, deleted: request.company_name });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Approve Request ─────────────────────────────────────────
router.post('/requests/:id/approve', platformAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const { data: request } = await db.from('org_registration_requests').select('*').eq('id', id).single();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: `Request is already ${request.status}` });

    // Collision-safe slug — never reuses an existing slug
    const slug = await generateUniqueSlug(request.company_name);

    // Create organization
    const { data: org, error: orgErr } = await db.from('organizations')
      .insert({ name: request.company_name, slug, status: 'active', plan: 'free' })
      .select().single();
    if (orgErr) throw new Error(orgErr.message);

    // Generate temp password + create root_admin user
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
    const tempPassword = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const hashed = bcrypt.hashSync(tempPassword, 10);

    const { data: user, error: userErr } = await db.from('users')
      .insert({
        name: request.contact_name, email: request.email, password: hashed,
        role: 'root_admin', organization_id: org.id,
        department: 'Management', position: 'Owner',
        avatar_color: '#3525cd', force_password_change: true,
      })
      .select('id, name, email, role').single();
    if (userErr) {
      await db.from('organizations').delete().eq('id', org.id);
      throw new Error(userErr.message);
    }

    // Create default work schedule
    await db.from('work_schedule').insert({
      organization_id: org.id,
      start_time: '09:00', end_time: '18:00',
      late_threshold: '09:30', early_exit_threshold: '17:00',
      half_day_hours: 4.5, work_days: '1,2,3,4,5',
    });

    // Seed RBAC system roles for the new org (fire-and-forget — non-critical)
    seedSystemRolesForOrg(org.id, user.id).catch(err =>
      console.error('[platform] seedSystemRolesForOrg failed for org', org.id, err.message)
    );

    // Seed default feature flags — biometric suite OFF by default on free plan
    const defaultFeatureFlags = ALL_FEATURE_KEYS.map(key => ({
      organization_id: org.id,
      feature_key: key,
      enabled: !BIOMETRIC_FEATURES.includes(key), // biometric/branches/statutory = false
      updated_at: new Date().toISOString(),
    }));
    await db.from('organization_features')
      .upsert(defaultFeatureFlags, { onConflict: 'organization_id,feature_key' });

    // Update request status
    await db.from('org_registration_requests').update({
      status: 'approved', reviewed_at: new Date().toISOString(),
      reviewer_notes: notes || null, organization_id: org.id,
    }).eq('id', id);

    // Log activity
    await db.from('platform_activity').insert({
      event_type: 'org_approved',
      description: `Organization "${request.company_name}" approved by platform admin`,
      metadata: { request_id: Number(id), org_id: org.id, email: request.email },
    });

    // Send approval email (LumosLogic SMTP)
    sendMail({
      to: request.email,
      subject: `Welcome to HRMS — Your organization "${request.company_name}" is approved!`,
      html: orgApprovedHtml(request, slug, tempPassword),
    });

    res.json({ success: true, organization: { id: org.id, name: org.name, slug }, user: { id: user.id, email: user.email } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Reject Request ──────────────────────────────────────────
router.post('/requests/:id/reject', platformAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;

    const { data: request } = await db.from('org_registration_requests').select('*').eq('id', id).single();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: `Request is already ${request.status}` });

    await db.from('org_registration_requests').update({
      status: 'rejected', reviewed_at: new Date().toISOString(), reviewer_notes: notes || null,
    }).eq('id', id);

    await db.from('platform_activity').insert({
      event_type: 'org_rejected',
      description: `Organization request from "${request.company_name}" rejected`,
      metadata: { request_id: Number(id), email: request.email, notes: notes || '' },
    });

    sendMail({
      to: request.email,
      subject: `HRMS — Update on your registration request`,
      html: orgRejectedHtml(request, notes),
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Update Org Name / Slug ──────────────────────────────────
router.patch('/organizations/:id', platformAdminAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    if (isNaN(orgId)) return res.status(400).json({ error: 'Invalid ID' });

    const { name, slug } = req.body;
    if (!name && !slug) return res.status(400).json({ error: 'name or slug is required' });

    const updates = {};
    if (name && name.trim()) updates.name = name.trim();
    if (slug && slug.trim()) {
      const cleanSlug = slug.trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(cleanSlug)) {
        return res.status(400).json({ error: 'Slug may only contain lowercase letters, numbers, and hyphens' });
      }
      // Uniqueness check
      const { data: existing } = await db.from('organizations')
        .select('id').eq('slug', cleanSlug).neq('id', orgId).maybeSingle();
      if (existing) return res.status(409).json({ error: `Slug "${cleanSlug}" is already in use` });
      updates.slug = cleanSlug;
    }

    const { data: updated, error } = await db.from('organizations')
      .update(updates).eq('id', orgId).select('id, name, slug, plan, status').single();
    if (error) throw new Error(error.message);

    res.json({ ok: true, org: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Delete Organization (cascade) ───────────────────────────
// Permanently deletes an org and ALL its data. Protected orgs are blocked.
router.delete('/organizations/:id', platformAdminAuth, async (req, res) => {
  const orgId = parseInt(req.params.id);
  if (isNaN(orgId)) return res.status(400).json({ error: 'Invalid organization ID' });

  const { data: org } = await db.from('organizations')
    .select('id, name, slug').eq('id', orgId).maybeSingle();
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (PROTECTED_ORG_SLUGS.includes(org.slug)) {
    return res.status(403).json({ error: `"${org.name}" is a protected organization and cannot be deleted.` });
  }

  const client = await pool.connect();
  // Each uncertain DELETE runs inside its own SAVEPOINT so a failure only
  // rolls back that one statement instead of aborting the whole transaction.
  // We suppress two classes of schema-mismatch errors:
  //   42P01 = undefined_table  (table doesn't exist)
  //   42703 = undefined_column (table exists but FK column has a different name)
  // Any other error (FK violation, permission, etc.) is re-thrown and the
  // outer catch will ROLLBACK the entire transaction.
  const SCHEMA_MISMATCH = new Set(['42P01', '42703']);
  let _spCounter = 0;
  const safe = async (sql, params = []) => {
    const sp = `sp_${++_spCounter}`;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      await client.query(sql, params);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (err) {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      if (!SCHEMA_MISMATCH.has(err.code)) throw err;
      console.warn(`[org-delete] skipped (${err.code}): ${sql.substring(0, 80)}`);
    }
  };

  try {
    await client.query('BEGIN');

    // Biometric
    await safe(`DELETE FROM biometric_import_batches        WHERE org_id = $1`, [orgId]);
    await safe(`DELETE FROM biometric_historical_sync_jobs  WHERE org_id = $1`, [orgId]);
    await safe(`DELETE FROM biometric_raw_logs              WHERE org_id = $1`, [orgId]);
    await safe(`DELETE FROM biometric_employee_map          WHERE org_id = $1`, [orgId]);
    await safe(`DELETE FROM biometric_devices               WHERE org_id = $1`, [orgId]);

    // Attendance
    await safe(`DELETE FROM attendance_breaks WHERE attendance_id IN (SELECT id FROM attendance WHERE organization_id = $1)`, [orgId]);
    await safe(`DELETE FROM attendance_regularization WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM attendance              WHERE organization_id = $1`, [orgId]);

    // Leaves
    await safe(`DELETE FROM leave_balances   WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM leaves           WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM leave_policies   WHERE organization_id = $1`, [orgId]);

    // Payroll
    await safe(`DELETE FROM payslips          WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM payroll_runs      WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM salary_structures WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM payroll_settings  WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM payroll_adjustments WHERE organization_id = $1`, [orgId]);

    // Finance
    await safe(`DELETE FROM expenses    WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM assets      WHERE organization_id = $1`, [orgId]);

    // Comms & docs
    await safe(`DELETE FROM announcements WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM notifications WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM documents    WHERE organization_id = $1`, [orgId]);

    // HR modules
    await safe(`DELETE FROM performance_goal_comments WHERE goal_id IN (SELECT id FROM performance_goals WHERE organization_id = $1)`, [orgId]);
    await safe(`DELETE FROM performance_goals    WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM goals                WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM performance_reviews  WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM onboarding_tasks     WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM exit_requests        WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM exit_clearance_items WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM shift_assignments    WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM shifts               WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM workflow_approvals   WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM workflow_levels      WHERE workflow_id IN (SELECT id FROM workflows WHERE organization_id = $1)`, [orgId]);
    await safe(`DELETE FROM workflows            WHERE organization_id = $1`, [orgId]);

    // Employee profile sub-tables — use organization_id (they also have employee_id,
    // not user_id, so deleting by org_id avoids any column-name guessing)
    const profileTables = [
      'employee_personal','employee_professional','employee_family',
      'employee_emergency_contacts','employee_education','employee_experience',
      'employee_skills','employee_banking','employee_nominees',
      'employee_government_docs','employee_immigration','employee_statutory',
      'employee_health','employee_training','employee_certifications',
      // v2 normalized tables
      'employee_qualifications','employee_experiences',
      'employee_family_members','employee_bank_accounts',
      'employee_government_documents','employee_certifications',
      'profile_audit_log',
    ];
    for (const t of profileTables) {
      await safe(`DELETE FROM ${t} WHERE organization_id = $1`, [orgId]);
    }

    // User junction tables
    await safe(`DELETE FROM user_departments WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)`, [orgId]);
    await safe(`DELETE FROM user_roles       WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)`, [orgId]);

    // RBAC
    await safe(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id = $1)`, [orgId]);
    await safe(`DELETE FROM roles            WHERE organization_id = $1`, [orgId]);

    // Org config
    await safe(`DELETE FROM departments         WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM designations        WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM holidays            WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM branches            WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM work_schedule       WHERE organization_id = $1`, [orgId]);
    await safe(`DELETE FROM organization_features WHERE organization_id = $1`, [orgId]);

    // Delink registration requests (preserve history, unlink from deleted org)
    await safe(`UPDATE org_registration_requests SET organization_id = NULL WHERE organization_id = $1`, [orgId]);

    // ── Step A: NOT NULL FK columns → DELETE the rows (cannot be nulled out) ──
    // e.g. document_shares.shared_with_user_id, any junction/share table
    const { rows: notNullFkRefs } = await client.query(`
      SELECT DISTINCT c.relname AS table_name, a.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class     c  ON c.oid  = con.conrelid
      JOIN pg_class     fc ON fc.oid = con.confrelid
      JOIN pg_attribute a  ON a.attrelid = c.oid  AND a.attnum = ANY(con.conkey)
      JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = ANY(con.confkey)
      JOIN pg_namespace n  ON n.oid = c.relnamespace
      WHERE con.contype = 'f'
        AND fc.relname   = 'users'
        AND fa.attname   = 'id'
        AND a.attnotnull = true
        AND n.nspname    = 'public'
        AND c.relname   <> 'users'
    `);
    for (const { table_name, column_name } of notNullFkRefs) {
      await safe(
        `DELETE FROM "${table_name}" ` +
        `WHERE "${column_name}" IN (SELECT id FROM users WHERE organization_id = $1)`,
        [orgId]
      );
    }

    // ── Step B: NULLABLE FK columns → SET NULL (preserve the row, clear the ref) ──
    // e.g. created_by, updated_by, reviewed_by, sent_by, etc.
    const { rows: nullableFkRefs } = await client.query(`
      SELECT DISTINCT c.relname AS table_name, a.attname AS column_name
      FROM pg_constraint con
      JOIN pg_class     c  ON c.oid  = con.conrelid
      JOIN pg_class     fc ON fc.oid = con.confrelid
      JOIN pg_attribute a  ON a.attrelid = c.oid  AND a.attnum = ANY(con.conkey)
      JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = ANY(con.confkey)
      JOIN pg_namespace n  ON n.oid = c.relnamespace
      WHERE con.contype = 'f'
        AND fc.relname   = 'users'
        AND fa.attname   = 'id'
        AND a.attnotnull = false
        AND n.nspname    = 'public'
    `);
    for (const { table_name, column_name } of nullableFkRefs) {
      await safe(
        `UPDATE "${table_name}" SET "${column_name}" = NULL ` +
        `WHERE "${column_name}" IN (SELECT id FROM users WHERE organization_id = $1)`,
        [orgId]
      );
    }

    // Users (after all child tables)
    await client.query(`DELETE FROM users WHERE organization_id = $1`, [orgId]);

    // Finally the org itself
    await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);

    await client.query('COMMIT');

    // Log (fire-and-forget — not part of transaction)
    db.from('platform_activity').insert({
      event_type:  'org_deleted',
      description: `Organization "${org.name}" (ID: ${orgId}) permanently deleted by platform admin`,
      metadata:    { org_id: orgId, org_name: org.name, org_slug: org.slug },
    }).then(() => {}).catch(() => {});

    res.json({ ok: true, deleted: org.name });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[platform] org-delete error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Platform Admin: Activity Feed (Platform-level) ─────────────────────────
router.get('/activity', platformAdminAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const orgId  = req.query.orgId ? parseInt(req.query.orgId) : null;
    let query = db.from('platform_activity').select('*').order('created_at', { ascending: false }).limit(limit);
    if (orgId) query = query.eq('organization_id', orgId);
    const { data } = await query;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform Admin: Org-Specific Logs (all system activity per org) ──────────
router.get('/activity/org-logs', platformAdminAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const orgId = req.query.orgId ? parseInt(req.query.orgId) : null;

    // Fetch from platform_activity filtered by org, plus synthesize logs from
    // key tables: users, leaves, attendance, payroll_runs, documents, expenses
    const logs = [];

    // 1. platform_activity rows scoped to org
    let paQuery = db.from('platform_activity').select('*').order('created_at', { ascending: false }).limit(limit);
    if (orgId) paQuery = paQuery.eq('organization_id', orgId);
    const { data: paRows } = await paQuery;
    for (const r of paRows || []) {
      logs.push({
        id: `pa-${r.id}`, event_type: r.event_type, description: r.description,
        module: 'platform', metadata: r.metadata, org_name: null,
        actor_name: null, created_at: r.created_at,
      });
    }

    // Helper: fetch org name map
    const orgIds = orgId ? [orgId] : null;
    let orgMap = {};
    if (!orgId) {
      const { data: orgs } = await db.from('organizations').select('id, name');
      for (const o of orgs || []) orgMap[o.id] = o.name;
    } else {
      const { data: org } = await db.from('organizations').select('id, name').eq('id', orgId).maybeSingle();
      if (org) orgMap[org.id] = org.name;
    }

    // 2. User creation logs
    let uQuery = db.from('users').select('id, name, email, role, organization_id, created_at').order('created_at', { ascending: false }).limit(100);
    if (orgId) uQuery = uQuery.eq('organization_id', orgId);
    const { data: users } = await uQuery;
    for (const u of users || []) {
      logs.push({
        id: `u-${u.id}`, event_type: 'user_created',
        description: `User "${u.name}" (${u.role}) account created`,
        module: 'users', metadata: { email: u.email },
        org_name: orgMap[u.organization_id] || null,
        actor_name: null, created_at: u.created_at,
      });
    }

    // 3. Leave logs
    let lQuery = db.from('leaves')
      .select('id, user_id, leave_type, status, start_date, end_date, organization_id, created_at, users!leaves_user_id_fkey(name)')
      .order('created_at', { ascending: false }).limit(100);
    if (orgId) lQuery = lQuery.eq('organization_id', orgId);
    const { data: leaves } = await lQuery;
    for (const l of leaves || []) {
      const userName = l.users?.name || `user #${l.user_id}`;
      const evType = l.status === 'approved' ? 'leave_approved' : l.status === 'rejected' ? 'leave_rejected' : 'leave_applied';
      logs.push({
        id: `l-${l.id}`, event_type: evType,
        description: `${userName} — ${l.leave_type} leave (${l.start_date} to ${l.end_date}) [${l.status}]`,
        module: 'leaves', metadata: {},
        org_name: orgMap[l.organization_id] || null,
        actor_name: userName, created_at: l.created_at,
      });
    }

    // 4. Payroll run logs
    let prQuery = db.from('payroll_runs')
      .select('id, month, year, status, organization_id, created_at')
      .order('created_at', { ascending: false }).limit(50);
    if (orgId) prQuery = prQuery.eq('organization_id', orgId);
    const { data: payrollRuns } = await prQuery;
    for (const p of payrollRuns || []) {
      logs.push({
        id: `pr-${p.id}`, event_type: 'payroll_generated',
        description: `Payroll run for ${p.month}/${p.year} — status: ${p.status}`,
        module: 'payroll', metadata: {},
        org_name: orgMap[p.organization_id] || null,
        actor_name: null, created_at: p.created_at,
      });
    }

    // 5. Attendance regularization logs
    let regQuery = db.from('attendance_regularization')
      .select('id, user_id, date, status, organization_id, created_at, users!attendance_regularization_user_id_fkey(name)')
      .order('created_at', { ascending: false }).limit(100);
    if (orgId) regQuery = regQuery.eq('organization_id', orgId);
    const { data: regs } = await regQuery;
    for (const r of regs || []) {
      const userName = r.users?.name || `user #${r.user_id}`;
      logs.push({
        id: `reg-${r.id}`, event_type: 'regularization',
        description: `${userName} — attendance regularization for ${r.date} [${r.status}]`,
        module: 'attendance', metadata: {},
        org_name: orgMap[r.organization_id] || null,
        actor_name: userName, created_at: r.created_at,
      });
    }

    // 6. Expense logs
    let expQuery = db.from('expenses')
      .select('id, user_id, title, amount, status, organization_id, created_at, users!expenses_user_id_fkey(name)')
      .order('created_at', { ascending: false }).limit(100);
    if (orgId) expQuery = expQuery.eq('organization_id', orgId);
    const { data: expenses } = await expQuery;
    for (const e of expenses || []) {
      const userName = e.users?.name || `user #${e.user_id}`;
      logs.push({
        id: `exp-${e.id}`, event_type: e.status === 'approved' ? 'approved' : e.status === 'rejected' ? 'rejected' : 'created',
        description: `${userName} — expense "${e.title}" ₹${e.amount} [${e.status}]`,
        module: 'expenses', metadata: {},
        org_name: orgMap[e.organization_id] || null,
        actor_name: userName, created_at: e.created_at,
      });
    }

    // Sort all logs by created_at desc and return
    logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(logs.slice(0, limit));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
