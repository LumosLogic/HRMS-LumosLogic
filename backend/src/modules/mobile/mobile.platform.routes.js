/**
 * Platform-admin endpoints for managing an organization's mobile app access.
 * Mounted at /api/platform next to — not inside — the existing platform router.
 */
const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { platformAdminAuth } = require('../../middleware/auth');
const { MOBILE_FEATURES, getOrgMobileConfig, getGlobalMobileConfig, invalidateOrg, invalidateAll } = require('../../services/mobileAppService');
const { sendConfigChangedToOrg } = require('../../services/mobilePushService');

router.get('/organizations/:id/mobile', platformAdminAuth, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    if (isNaN(orgId)) return res.status(400).json({ error: 'Invalid ID' });
    const cfg = await getOrgMobileConfig(orgId);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS devices FROM push_device_tokens WHERE organization_id = $1', [orgId]);
    const g = await getGlobalMobileConfig();
    const { rows: o } = await pool.query('SELECT enabled FROM mobile_org_settings WHERE organization_id = $1', [orgId]);
    const { rows: f } = await pool.query('SELECT feature_key, enabled FROM mobile_org_features WHERE organization_id = $1', [orgId]);
    const own = {}; f.forEach(r => { own[r.feature_key] = r.enabled; });
    // `enabled`/`features` are this org's OWN switches (what the toggles edit); `globalApp`/`globalFeatures`
    // show platform-wide locks, and `effective` is what the app actually enforces.
    const ownFeatures = {}; MOBILE_FEATURES.forEach(x => { ownFeatures[x.key] = x.key in own ? own[x.key] : true; });
    res.json({ enabled: !!o[0]?.enabled, features: ownFeatures, effective: { enabled: cfg.enabled, features: cfg.features },
      globalApp: g.app, globalFeatures: g.features, catalog: MOBILE_FEATURES.map(({ key, label, group }) => ({ key, label, group })),
      devices: rows[0]?.devices || 0 });
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

// ── Platform-wide mobile management ──────────────────────────────────────────
// GET /api/platform/mobile/overview — global switches + every org's mobile status.
router.get('/mobile/overview', platformAdminAuth, async (req, res) => {
  try {
    invalidateAll();
    const g = await getGlobalMobileConfig();
    const [{ rows: orgs }, { rows: devs }, { rows: feats }] = await Promise.all([
      pool.query(`SELECT o.id, o.name, o.status, o.plan, COALESCE(s.enabled,false) AS enabled
                    FROM organizations o LEFT JOIN mobile_org_settings s ON s.organization_id = o.id ORDER BY o.name`),
      pool.query('SELECT organization_id, COUNT(*)::int AS devices FROM push_device_tokens GROUP BY organization_id'),
      pool.query('SELECT organization_id, COUNT(*)::int AS off FROM mobile_org_features WHERE enabled = false GROUP BY organization_id'),
    ]);
    const dm = {}; devs.forEach(r => { dm[r.organization_id] = r.devices; });
    const fm = {}; feats.forEach(r => { fm[r.organization_id] = r.off; });
    const globalFeatures = {}; MOBILE_FEATURES.forEach(x => { globalFeatures[x.key] = g.features[x.key] !== false; });
    res.json({
      globalApp: g.app, globalFeatures,
      catalog: MOBILE_FEATURES.map(({ key, label, group }) => ({ key, label, group })),
      orgs: orgs.map(o => ({ ...o, devices: dm[o.id] || 0, featuresOff: fm[o.id] || 0 })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/platform/mobile/global { enabled?: boolean, features?: { key: boolean } }
router.put('/mobile/global', platformAdminAuth, async (req, res) => {
  try {
    const { enabled, features } = req.body || {};
    const valid = new Set(MOBILE_FEATURES.map(f => f.key));
    const rows = [];
    if (typeof enabled === 'boolean') rows.push(['__app', enabled]);
    for (const [k, v] of Object.entries(features || {})) if (valid.has(k) && typeof v === 'boolean') rows.push([k, v]);
    for (const [key, val] of rows) {
      await pool.query(
        `INSERT INTO mobile_global_features (feature_key, enabled, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (feature_key) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`, [key, val]);
    }
    invalidateAll();
    pool.query('SELECT DISTINCT organization_id FROM push_device_tokens').then(async ({ rows: orgs }) => {
      for (const o of orgs) await sendConfigChangedToOrg(o.organization_id).catch(() => {});
    }).catch(() => {});
    db.from('platform_activity').insert({
      event_type: 'mobile_config_changed',
      description: 'Platform-wide mobile app config updated' + (typeof enabled === 'boolean' ? ` (app ${enabled ? 'enabled' : 'disabled'})` : ''),
      metadata: { scope: 'global', enabled, features: features || {} },
    }).then(() => {}).catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
