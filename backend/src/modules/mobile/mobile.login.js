/**
 * Blocks mobile logins for organizations the platform admin hasn't enabled.
 * Mounted in front of POST /api/auth/login WITHOUT changing the web auth router: requests without the
 * `X-Client-Platform: mobile` header (all web traffic) pass straight through.
 */
const { pool } = require('../../config/db');
const { isMobileRequest, getOrgMobileConfig, DISABLED_APP_MESSAGE } = require('../../services/mobileAppService');

async function mobileLoginGuard(req, res, next) {
  if (req.method !== 'POST' || !isMobileRequest(req)) return next();
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return next();
    const { rows } = await pool.query('SELECT organization_id FROM users WHERE email = $1 LIMIT 1', [email]);
    const orgId = rows[0]?.organization_id;
    if (orgId) {
      const cfg = await getOrgMobileConfig(orgId);
      if (!cfg.enabled) return res.status(403).json({ error: DISABLED_APP_MESSAGE, code: 'MOBILE_APP_DISABLED' });
    }
  } catch { /* fail open — the normal login flow decides */ }
  next();
}

module.exports = { mobileLoginGuard };
