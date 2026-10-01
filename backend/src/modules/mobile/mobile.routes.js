/**
 * Mobile-app-only API (/api/mobile/*). The web client never calls any of these routes.
 */
const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth, adminOnly } = require('../../middleware/auth');
const { orgId } = require('../../utils/helpers');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');
const { MOBILE_FEATURES, DISABLED_APP_MESSAGE, getOrgMobileConfig } = require('../../services/mobileAppService');

// GET /api/mobile/config — what this organization's mobile app is allowed to do.
router.get('/config', auth, async (req, res) => {
  try {
    const cfg = await getOrgMobileConfig(orgId(req));
    res.json({
      enabled: cfg.enabled,
      message: cfg.enabled ? null : DISABLED_APP_MESSAGE,
      features: cfg.features,
      catalog: MOBILE_FEATURES.map(({ key, label, group }) => ({ key, label, group })),
      fetched_at: new Date().toISOString(),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/mobile/push-token — register this phone for push. One physical device = one owner.
router.post('/push-token', auth, async (req, res) => {
  try {
    const { expo_push_token, device_token, platform, device_name, device_model } = req.body || {};
    if (!expo_push_token && !device_token) return res.status(400).json({ error: 'expo_push_token or device_token required' });
    if (expo_push_token) {
      await pool.query('UPDATE push_device_tokens SET expo_push_token = NULL WHERE expo_push_token = $1 AND user_id <> $2',
        [expo_push_token, req.user.id]).catch(() => {});
    }
    await pool.query(
      `INSERT INTO push_device_tokens (user_id, organization_id, expo_push_token, device_token, platform, device_name, device_model, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
       ON CONFLICT (user_id, organization_id) DO UPDATE SET expo_push_token = EXCLUDED.expo_push_token,
         device_token = EXCLUDED.device_token, platform = EXCLUDED.platform, device_name = EXCLUDED.device_name,
         device_model = EXCLUDED.device_model, updated_at = NOW()`,
      [req.user.id, orgId(req), expo_push_token || null, device_token || null, platform || null, device_name || null, device_model || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.warn('[mobile/push-token] register failed:', err.message);
    res.json({ ok: true, warning: 'token registration unavailable' });
  }
});

// DELETE /api/mobile/push-token — on sign-out, detach this account from the phone.
router.delete('/push-token', auth, async (req, res) => {
  try {
    await pool.query('UPDATE push_device_tokens SET expo_push_token = NULL, device_token = NULL WHERE user_id = $1', [req.user.id]);
  } catch (err) { console.warn('[mobile/push-token] unregister failed:', err.message); }
  res.json({ ok: true });
});

// POST /api/mobile/broadcast — admin message to every active employee (branch-scoped), delivered as in-app
// notifications + mobile push. Separate from the web broadcast (/api/push/send), which is unchanged.
router.post('/broadcast', auth, adminOnly, withBranchContext, async (req, res) => {
  try {
    const { title, body } = req.body || {};
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Title and body required' });
    const oId = orgId(req);
    const cfg = await getOrgMobileConfig(oId);
    if (cfg.features.broadcast === false) {
      return res.status(403).json({ error: 'Broadcast is unavailable on mobile for your organization.', code: 'MOBILE_FEATURE_DISABLED' });
    }

    const branchState = getFilterState(req.branchContext);
    let userIds = [];
    if (branchState.type !== 'none') {
      const params = [oId];
      let branchClause = '';
      if (branchState.type === 'specific') { params.push(branchState.branchId); branchClause = `AND branch_id = $${params.length}`; }
      else if (branchState.type === 'multi') { params.push(branchState.branchIds); branchClause = `AND branch_id = ANY($${params.length}::bigint[])`; }
      const { rows } = await pool.query(
        `SELECT id FROM users WHERE organization_id = $1 AND role = 'employee'
         AND (employee_status IS NULL OR employee_status NOT IN ('inactive','resigned','terminated')) ${branchClause}`, params);
      userIds = rows.map(u => u.id);
    }
    if (userIds.length) {
      await db.from('notifications').insert(userIds.map(id => ({
        user_id: id, title: title.trim(), message: body.trim(), type: 'general', organization_id: oId,
      })));
    }
    res.json({ success: true, targeted: userIds.length, in_app: userIds.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
