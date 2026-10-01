/**
 * Platform-admin endpoints for managing an organization's mobile app access.
 * Mounted at /api/platform next to — not inside — the existing platform router.
 */
const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { platformAdminAuth } = require('../../middleware/auth');
const { MOBILE_FEATURES, getOrgMobileConfig, invalidateOrg } = require('../../services/mobileAppService');
const { sendConfigChangedToOrg } = require('../../services/mobilePushService');

router.get('/organizations/:id/mobile', platformAdminAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    if (isNaN(orgId)) return res.status(400).json({ error: 'Invalid ID' });
    const cfg = await getOrgMobileConfig(orgId);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS devices FROM push_device_tokens WHERE organization_id = $1', [orgId]);
    res.json({ enabled: cfg.enabled, features: cfg.features, catalog: MOBILE_FEATURES, devices: rows[0]?.devices || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/organizations/:id/mobile', platformAdminAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    if (isNaN(orgId)) return res.status(400).json({ error: 'Invalid ID' });
    const { enabled, features } = req.body || {};
    if (typeof enabled === 'boolean') {
      await pool.query(
        `INSERT INTO mobile_org_settings (organization_id, enabled, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (organization_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`, [orgId, enabled]);
    }
    const valid = new Set(MOBILE_FEATURES.map(f => f.key));
    for (const [key, val] of Object.entries(features || {}).filter(([k]) => valid.has(k))) {
      await pool.query(
        `INSERT INTO mobile_org_features (organization_id, feature_key, enabled, updated_at) VALUES ($1,$2,$3,NOW())
         ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
        [orgId, key, Boolean(val)]);
    }
    invalidateOrg(orgId);
    sendConfigChangedToOrg(orgId).catch(() => {});
    db.from('platform_activity').insert({
      event_type: 'mobile_config_changed',
      description: `Mobile app config updated for org #${orgId}` + (typeof enabled === 'boolean' ? ` (app ${enabled ? 'enabled' : 'disabled'})` : ''),
      metadata: { org_id: orgId, enabled, features: features || {} }, organization_id: orgId,
    }).then(() => {}).catch(() => {});
    const cfg = await getOrgMobileConfig(orgId);
    res.json({ success: true, enabled: cfg.enabled, features: cfg.features });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
