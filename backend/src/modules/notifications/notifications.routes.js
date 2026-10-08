const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { pool } = require('../../config/db-pg-adapter');
const { auth } = require('../../middleware/auth');
const { orgId } = require('../../utils/helpers');
const { pool: sqlPool } = require('../../config/db');
const { withBranchContext } = require('../../middleware/branchContext');

// ── One-time table bootstrap for mobile push tokens ───────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS push_device_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    organization_id INTEGER NOT NULL,
    expo_push_token TEXT,
    device_token    TEXT,
    platform        TEXT,
    device_name     TEXT,
    device_model    TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, organization_id)
  );
`).catch(err => console.warn('[NotifRoutes] push_device_tokens bootstrap:', err.message));

// ─── Notifications: Register Mobile Push Token ────────────────────────────────
// Called by the mobile app on startup to register its FCM / Expo push token.
// Upserts so re-login / token refresh always stays current.
// The token is stored alongside the existing VAPID web-push subscriptions.
router.post('/register-token', auth, async (req, res) => {
  try {
    const { expo_push_token, device_token, platform, device_name, device_model } = req.body;
    if (!expo_push_token && !device_token) {
      return res.status(400).json({ error: 'expo_push_token or device_token required' });
    }
    await pool.query(
      `INSERT INTO push_device_tokens
         (user_id, organization_id, expo_push_token, device_token, platform, device_name, device_model, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, organization_id) DO UPDATE
         SET expo_push_token = EXCLUDED.expo_push_token,
             device_token    = EXCLUDED.device_token,
             platform        = EXCLUDED.platform,
             device_name     = EXCLUDED.device_name,
             device_model    = EXCLUDED.device_model,
             updated_at      = NOW()`,
      [
        req.user.id, orgId(req),
        expo_push_token || null,
        device_token    || null,
        platform        || null,
        device_name     || null,
        device_model    || null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    // Non-fatal: token registration failure must never block the app
    console.warn('[PushToken] register failed:', err.message);
    res.json({ ok: true, warning: 'token registration unavailable' });
  }
});

// Notifications about a specific employee carry subject_user_id. When a branch is selected, only those whose
// employee belongs to that branch (plus employee-independent ones, subject NULL) are shown.
// Column missing (migration not applied yet) → unfiltered, exactly the previous behaviour.
const BRANCH_SUBJECT_SQL = `AND (n.subject_user_id IS NULL OR EXISTS (
  SELECT 1 FROM users su WHERE su.id = n.subject_user_id AND su.organization_id = n.organization_id AND su.branch_id = $3))`;

// GET /api/notifications — user's own notifications (EHN_NOT_005: archived param)
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const archived = req.query.archived === 'true';
    const archClause = archived ? 'n.is_archived = TRUE' : '(n.is_archived IS NULL OR n.is_archived = FALSE)';
    const sql = `SELECT n.* FROM notifications n WHERE n.user_id = $1 AND ${archClause} /*BRANCH*/ ORDER BY n.created_at DESC LIMIT 100`;
    const branchId = req.branchContext?.selectedBranchId || null;
    let result;
    if (branchId) {
      try { result = await sqlPool.query(sql.replace('/*BRANCH*/', BRANCH_SUBJECT_SQL.replace('$3', '$2')), [req.user.id, branchId]); }
      catch (e) { if (!/subject_user_id/.test(e.message)) throw e; }
    }
    if (!result) result = await sqlPool.query(sql.replace('/*BRANCH*/', ''), [req.user.id]);
    res.json(result.rows || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/notifications/unread-count
router.get('/unread-count', auth, withBranchContext, async (req, res) => {
  try {
    const sql = `SELECT COUNT(*)::int AS count FROM notifications n WHERE n.user_id = $1 AND n.is_read = FALSE /*BRANCH*/`;
    const branchId = req.branchContext?.selectedBranchId || null;
    let result;
    if (branchId) {
      try { result = await sqlPool.query(sql.replace('/*BRANCH*/', BRANCH_SUBJECT_SQL.replace('$3', '$2')), [req.user.id, branchId]); }
      catch (e) { if (!/subject_user_id/.test(e.message)) throw e; }
    }
    if (!result) result = await sqlPool.query(sql.replace('/*BRANCH*/', ''), [req.user.id]);
    res.json({ count: result.rows[0]?.count || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const { error } = await db.from('notifications')
      .update({ is_read: true }).eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/mark-all-read
router.put('/mark-all-read', auth, async (req, res) => {
  try {
    const { error } = await db.from('notifications')
      .update({ is_read: true }).eq('user_id', req.user.id).eq('is_read', false);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/notifications/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const { error } = await db.from('notifications')
      .delete().eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/archive-read — EHN_NOT_005: archive all read notifications
router.put('/archive-read', auth, async (req, res) => {
  try {
    const { error } = await db.from('notifications').update({ is_archived: true }).eq('user_id', req.user.id).eq('is_read', true);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/notifications/:id/archive — EHN_NOT_005: archive single notification
router.put('/:id/archive', auth, async (req, res) => {
  try {
    const { error } = await db.from('notifications').update({ is_archived: true }).eq('id', req.params.id).eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
