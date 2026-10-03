const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('\n❌  FATAL: JWT_SECRET environment variable is not set.');
  console.error('    Add  JWT_SECRET=<random-64-char-string>  to your .env file.\n');
  process.exit(1);
}

// BUG_181: In-memory set of user IDs whose sessions must be invalidated immediately.
// Populated when an employee's status is changed to inactive/terminated.
// 'resigned' is intentionally excluded — employees serve a notice period and must retain access.
// Cleared on server restart (acceptable — tokens are short-lived; worst case is a single restart).
const _blockedUsers = new Set();
const INACTIVE_STATUSES = ['inactive', 'terminated'];

function blockUser(userId) { _blockedUsers.add(String(userId)); }
function unblockUser(userId) { _blockedUsers.delete(String(userId)); }

// BUG_217: Separate set for users whose role was changed by an admin.
// Their JWT still carries the old role — they must re-authenticate to get a fresh token.
// Cleared when the user successfully logs in again (new token issued with new role).
const _roleChangedUsers = new Set();
function markRoleChanged(userId) { _roleChangedUsers.add(String(userId)); }
function clearRoleChanged(userId) { _roleChangedUsers.delete(String(userId)); }

const ALLOWED_ORIGINS = [
  'https://hrms.lumoslogic.com',
  'http://hrms.recruitx-ai.com',
  'https://hrms.recruitx-ai.com',
  'https://leavetrackerbylumos.web.app',
  'https://leavetrackerbylumos.firebaseapp.com',
  'https://leavetracker-platform-admin.web.app',
  'https://leavetracker-platform-admin.firebaseapp.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
];

async function auth(req, res, next) {
  // Idempotent: a router-level guard (e.g. /api/profile/:id) may already have authenticated.
  if (req._authed && req.user) return next();
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.purpose === 'totp-pending') return res.status(401).json({ error: 'TOTP verification required' });

    // BUG_181: Check in-memory blocklist first (instant, no DB cost)
    if (_blockedUsers.has(String(decoded.id))) {
      return res.status(401).json({ error: 'Account access has been revoked. Please contact HR.', code: 'ACCOUNT_INACTIVE' });
    }

    // BUG_217: Role-change invalidation — the JWT still carries the old role.
    // Force re-authentication so the client gets a fresh token with the new role.
    if (_roleChangedUsers.has(String(decoded.id))) {
      return res.status(401).json({
        error: 'Your role has been updated by an administrator. Please log in again to apply the new permissions.',
        code: 'ROLE_CHANGED',
      });
    }

    // BUG_181/219: For employee-role tokens, do a lightweight DB check on status.
    // Only employees need this check — admins/root_admins are managed differently.
    if (decoded.role === 'employee') {
      try {
        const { rows } = await pool.query(
          `SELECT u.employee_status,
                  (SELECT last_working_day FROM exit_requests
                    WHERE user_id = u.id AND status = 'approved'
                    ORDER BY created_at DESC LIMIT 1) AS last_working_day
           FROM users u WHERE u.id = $1 LIMIT 1`,
          [decoded.id]
        );
        const status = rows[0]?.employee_status;
        const lwd    = rows[0]?.last_working_day;
        const today  = new Date().toISOString().split('T')[0];
        // BUG_219: block resigned employees whose notice period has ended
        const isExpiredResignation = status === 'resigned' && lwd && lwd < today;
        if (status && (INACTIVE_STATUSES.includes(status) || isExpiredResignation)) {
          _blockedUsers.add(String(decoded.id)); // cache for subsequent requests
          // Lazily transition to inactive if cron hasn't run yet
          if (isExpiredResignation) {
            pool.query(`UPDATE users SET employee_status='inactive', status='inactive' WHERE id=$1`, [decoded.id]).catch(() => {});
          }
          return res.status(401).json({
            error: 'Your account is currently inactive. Please contact HR/Admin for assistance.',
            code: 'ACCOUNT_INACTIVE',
          });
        }
      } catch { /* DB error — don't block auth, fail open */ }
    }

    req.user = decoded;
    req._authed = true;
    next();
  }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'root_admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

function rootAdminOnly(req, res, next) {
  if (req.user.role !== 'root_admin')
    return res.status(403).json({ error: 'Root admin access required' });
  next();
}

function isAdminRole(role) { return role === 'admin' || role === 'root_admin'; }

// Allows: admins (full access) OR the employee editing their own profile (restricted fields only)
function selfOrAdmin(allowedSelfFields = []) {
  return (req, res, next) => {
    const isAdmin = isAdminRole(req.user.role);
    const isSelf  = parseInt(req.user.id) === parseInt(req.params.id);

    if (!isAdmin && !isSelf)
      return res.status(403).json({ error: 'Access denied' });

    // Employee editing their own profile — restrict to allowed fields
    if (!isAdmin && isSelf && req.method !== 'GET') {
      const forbidden = Object.keys(req.body || {}).filter(f => !allowedSelfFields.includes(f));
      if (forbidden.length)
        return res.status(403).json({ error: 'Cannot edit these fields', forbidden_fields: forbidden });
    }
    next();
  };
}

function platformAdminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'platform_admin') return res.status(403).json({ error: 'Platform admin access required' });
    req.platformAdmin = decoded;
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

module.exports = { JWT_SECRET, ALLOWED_ORIGINS, auth, adminOnly, rootAdminOnly, isAdminRole, platformAdminAuth, selfOrAdmin, blockUser, unblockUser, markRoleChanged, clearRoleChanged };
