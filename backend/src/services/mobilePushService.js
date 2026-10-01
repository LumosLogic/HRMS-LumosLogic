/**
 * mobilePushService.js
 *
 * Delivers in-app `notifications` rows to the native mobile app as Expo push
 * notifications. Before this service existed, mobile device tokens were stored
 * (push_device_tokens) but nothing ever sent to them — the app only saw a
 * notification when it next polled GET /api/notifications.
 *
 * The dispatcher polls the notifications table for new rows (read-only) so every code path that creates a
 * notification is covered without touching any web table or adding database triggers. */
const axios = require('axios');
const { pool } = require('../config/db');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_WINDOW_MS = 200;
const POLL_MS         = 5000;

// notification.type → mobile route the tap should open
const TYPE_SCREEN = {
  leave: '/(tabs)/leaves', leaves: '/(tabs)/leaves', leave_approved: '/(tabs)/leaves', leave_rejected: '/(tabs)/leaves',
  attendance: '/(tabs)/attendance', regularization: '/(tabs)/regularization',
  payroll: '/(tabs)/payslips', payslip: '/(tabs)/payslips',
  expense: '/(tabs)/expenses', expenses: '/(tabs)/expenses',
  announcement: '/(tabs)/announcements', announcements: '/(tabs)/announcements',
  document: '/(tabs)/documents', documents: '/(tabs)/documents',
  performance: '/(tabs)/performance', onboarding: '/(tabs)/onboarding', exit: '/(tabs)/exit',
};

let lastSeenId = 0;
const sentIds = new Set();
let pending = new Set();
let flushTimer = null;

function remember(id) {
  sentIds.add(String(id));
  if (sentIds.size > 5000) {
    const it = sentIds.values();
    for (let i = 0; i < 1000; i++) sentIds.delete(it.next().value);
  }
}

async function postToExpo(messages) {
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const { data } = await axios.post(EXPO_PUSH_URL, chunk, {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        timeout: 15000,
      });
      const tickets = data?.data || [];
      const dead = [];
      tickets.forEach((t, idx) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') dead.push(chunk[idx].to);
        else if (t.status === 'error') console.warn('[MobilePush] ticket error:', t.message);
      });
      if (dead.length) {
        await pool.query(`UPDATE push_device_tokens SET expo_push_token = NULL WHERE expo_push_token = ANY($1)`, [dead]).catch(() => {});
      }
    } catch (err) {
      console.warn('[MobilePush] Expo send failed:', err.message);
    }
  }
}

/** Push an arbitrary payload to every registered mobile device of the given users. */
async function sendToUsers(userIds, { title, body, data = {} }) {
  if (!Array.isArray(userIds) || !userIds.length) return 0;
  const { rows } = await pool.query(
    `SELECT DISTINCT expo_push_token FROM push_device_tokens
      WHERE user_id = ANY($1) AND expo_push_token LIKE 'Expo%PushToken[%'`,
    [userIds]
  );
  if (!rows.length) return 0;
  await postToExpo(rows.map(r => ({
    to: r.expo_push_token, title, body, data, sound: 'default', priority: 'high', channelId: 'general',
  })));
  return rows.length;
}

/** Silent data-only push to every device in an org (used for live app-config changes). */
async function sendConfigChangedToOrg(organizationId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT expo_push_token FROM push_device_tokens
      WHERE organization_id = $1 AND expo_push_token LIKE 'Expo%PushToken[%'`,
    [organizationId]
  );
  if (!rows.length) return 0;
  await postToExpo(rows.map(r => ({
    to: r.expo_push_token, data: { type: 'mobile_config_changed' }, priority: 'high', _contentAvailable: true,
  })));
  return rows.length;
}

async function deliverNotificationIds(ids) {
  const fresh = ids.filter(id => !sentIds.has(String(id)));
  if (!fresh.length) return;
  fresh.forEach(remember);
  const { rows } = await pool.query(
    `SELECT n.id, n.user_id, n.title, n.message, n.type, t.expo_push_token
       FROM notifications n
       JOIN push_device_tokens t ON t.user_id = n.user_id
      WHERE n.id = ANY($1)
        AND EXISTS (SELECT 1 FROM mobile_org_settings ms WHERE ms.organization_id = t.organization_id AND ms.enabled = true)
        AND t.expo_push_token LIKE 'Expo%PushToken[%'`,
    [fresh]
  );
  if (!rows.length) return;
  await postToExpo(rows.map(n => ({
    to: n.expo_push_token,
    title: n.title,
    body: (n.message || '').slice(0, 240),
    sound: 'default',
    priority: 'high',
    channelId: 'general',
    data: { notification_id: n.id, type: n.type || 'general', screen: TYPE_SCREEN[String(n.type || '').toLowerCase()] || '/(tabs)/notifications' },
  })));
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    const ids = [...pending];
    pending = new Set();
    flushTimer = null;
    try { await deliverNotificationIds(ids); }
    catch (err) { console.warn('[MobilePush] deliver failed:', err.message); }
  }, BATCH_WINDOW_MS);
}

async function safetyPoll() {
  try {
    const { rows } = await pool.query(
      `SELECT id FROM notifications WHERE id > $1 ORDER BY id ASC LIMIT 2000`, [lastSeenId]
    );
    if (rows.length) {
      lastSeenId = Number(rows[rows.length - 1].id);
      rows.forEach(r => pending.add(Number(r.id)));
      scheduleFlush();
    }
  } catch (err) { console.warn('[MobilePush] poll failed:', err.message); }
}

async function start() {
  if (process.env.MOBILE_PUSH_ENABLED === 'false') { console.log('[MobilePush] disabled via MOBILE_PUSH_ENABLED=false'); return; }
  try {
    const { rows } = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM notifications');
    lastSeenId = Number(rows[0].m);
  } catch (err) {
    console.warn('[MobilePush] could not initialise:', err.message);
    return;
  }
  // Read-only poll of the existing notifications table (primary-key range scan). Nothing is added to the
  // web schema — no trigger, no LISTEN — so web notification inserts are completely untouched.
  setInterval(safetyPoll, POLL_MS).unref();
  console.log(`[MobilePush] mobile push dispatcher started (poll every ${POLL_MS / 1000}s)`);
}

module.exports = { start, sendToUsers, sendConfigChangedToOrg };
