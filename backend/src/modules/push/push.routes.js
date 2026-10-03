const express = require('express');
const router  = express.Router();
const { db, pool } = require('../../config/db');
const { auth, adminOnly } = require('../../middleware/auth');
const { orgId } = require('../../utils/helpers');
const { sendPushToUsers } = require('../../services/pushService');
const { withBranchContext } = require('../../middleware/branchContext');
const { getFilterState } = require('../../utils/branchFilter');
const { hasPermissionOrLegacyAdmin } = require('../../middleware/permissions');
const { resolveBroadcastRecipients } = require('../../utils/broadcastTargeting');

// ─── Push: VAPID status — let frontend know if push is server-configured ─────
router.get('/vapid-status', auth, (req, res) => {
  res.json({
    configured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    public_key: process.env.VAPID_PUBLIC_KEY || null,
  });
});

// ─── Push: Subscribe ──────────────────────────────────────────────────────────
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { subscription, endpoint, userAgent } = req.body;
    if (!subscription || !endpoint) return res.status(400).json({ error: 'Subscription and endpoint required' });
    // push_subscriptions has UNIQUE(endpoint), not UNIQUE(user_id).
    // Conflict on endpoint so each browser/device subscription is preserved independently.
    const { error } = await db.from('push_subscriptions').upsert(
      { user_id: req.user.id, endpoint, subscription, user_agent: userAgent || null, organization_id: orgId(req) },
      { onConflict: 'endpoint' }
    );
    if (error) return res.status(500).json({ error: 'Failed to save push subscription.' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Push: Unsubscribe ────────────────────────────────────────────────────────
router.delete('/unsubscribe', auth, async (req, res) => {
  try {
    await db.from('push_subscriptions').delete().eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Push: Send Notification (admin) ─────────────────────────────────────────
router.post('/send', auth, hasPermissionOrLegacyAdmin('notifications', 'broadcast'), withBranchContext, async (req, res) => {
  try {
    const { title, body, url, target_user_id } = req.body;
    if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'Title and body required' });
    const oId = orgId(req);
    // Same recipient rule as the email broadcast: validated targets / branch_ids / caller scope.
    const resolved = await resolveBroadcastRecipients(req, req.body);
    if (!resolved.ok) return res.status(resolved.status).json({ error: resolved.error });
    const userIds = resolved.users.map(u => u.id);
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      return res.status(503).json({ error: 'Push notifications are not configured. Please set VAPID keys in server settings.' });
    }
    const sent = await sendPushToUsers(userIds, { title: title.trim(), body: body.trim(), url: url || '/' });
    try {
      await db.from('notifications_log').insert({
        title: title.trim(), body: body.trim(), url: url || null,
        target_user_id: target_user_id ? parseInt(target_user_id) : null,
        sent_by: req.user.id, sent_count: sent || 0,
      });
    } catch { /* log insert failure is non-fatal */ }
    const targetCount = userIds.length;
    res.json({ success: true, sent: sent || 0, targeted: targetCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
