/**
 * mobileAppService.js
 *
 * Platform-admin controlled access for the native mobile app.
 *   1. Master switch  — mobile_org_settings.enabled (login + every request)
 *   2. Feature flags  — mobile_org_features (per-org, per-module; default = enabled)
 *
 * Mobile requests identify themselves with `X-Client-Platform: mobile`.
 * The web client never sends it, so none of this affects the web app.
 */
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');

// key, label, group, API route prefixes it guards (relative to /api)
const MOBILE_FEATURES = [
  // Employee
  { key: 'attendance',     label: 'Attendance & Check-in/out', group: 'Employee',   routes: ['/attendance'] },
  { key: 'regularization', label: 'Attendance Regularization', group: 'Employee',   routes: ['/regularization'] },
  { key: 'leaves',         label: 'Leave Management',          group: 'Employee',   routes: ['/leaves', '/team-leaves', '/leave-policies'] },
  { key: 'holidays',       label: 'Holidays',                  group: 'Employee',   routes: ['/holidays'] },
  { key: 'payslips',       label: 'Payslips & Payroll',        group: 'Employee',   routes: ['/payroll'] },
  { key: 'documents',      label: 'Documents',                 group: 'Employee',   routes: ['/documents', '/doc-requirements'] },
  { key: 'announcements',  label: 'Announcements',             group: 'Employee',   routes: ['/announcements'] },
  { key: 'performance',    label: 'Performance',               group: 'Employee',   routes: ['/performance'] },
  { key: 'expenses',       label: 'Expenses',                  group: 'Employee',   routes: ['/expenses'] },
  { key: 'profile',        label: 'Profile',                   group: 'Employee',   routes: ['/profile'] },
  { key: 'help_support',   label: 'Help & Support',            group: 'Employee',   routes: [] },
  // HR / Admin
  { key: 'employees',      label: 'Employee Management',       group: 'HR Admin',   routes: ['/employees'] },
  { key: 'onboarding',     label: 'Onboarding',                group: 'HR Admin',   routes: ['/onboarding'] },
  { key: 'exit',           label: 'Exit Management',           group: 'HR Admin',   routes: ['/exit', '/offboarding'] },
  { key: 'assets',         label: 'Assets',                    group: 'HR Admin',   routes: ['/assets'] },
  { key: 'reports',        label: 'Reports & Analytics',       group: 'HR Admin',   routes: ['/reports', '/analytics'] },
  { key: 'calendar',       label: 'Calendar',                  group: 'HR Admin',   routes: ['/calendar'] },
  { key: 'shifts',         label: 'Shifts & Roster',           group: 'HR Admin',   routes: ['/shifts'] },
  { key: 'departments',    label: 'Departments',               group: 'HR Admin',   routes: ['/departments', '/designations'] },
  // Root Admin
  { key: 'branches',       label: 'Branches',                  group: 'Root Admin', routes: ['/branches'] },
  { key: 'compliance',     label: 'Compliance & Statutory',    group: 'Root Admin', routes: ['/statutory'] },
  { key: 'roles',          label: 'Roles & Permissions',       group: 'Root Admin', routes: ['/roles', '/permissions'] },
  { key: 'broadcast',      label: 'Broadcast / Push',          group: 'Root Admin', routes: ['/push'] },
];

// Never gated: login/auth, config discovery (the app needs it to learn it is disabled), platform admin API.
const EXEMPT_PREFIXES = ['/auth', '/mobile', '/platform'];

const CACHE_TTL_MS = 10_000;
const cache = new Map(); // orgId → { at, enabled, features }

function invalidateOrg(orgId) { cache.delete(Number(orgId)); }
function invalidateAll() { cache.clear(); globalCache = null; }

// Platform-wide switches — apply to every organization on top of its own settings.
let globalCache = null; // { at, app, features }
async function getGlobalMobileConfig() {
  if (globalCache && Date.now() - globalCache.at < CACHE_TTL_MS) return globalCache;
  const { rows } = await pool.query('SELECT feature_key, enabled FROM mobile_global_features').catch(() => ({ rows: [] }));
  const features = {}; let app = true;
  rows.forEach(r => { if (r.feature_key === '__app') app = r.enabled; else features[r.feature_key] = r.enabled; });
  globalCache = { at: Date.now(), app, features };
  return globalCache;
}

async function getOrgMobileConfig(orgId) {
  orgId = Number(orgId);
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit;

  const [{ rows: orgRows }, { rows: featRows }, glob] = await Promise.all([
    pool.query('SELECT enabled FROM mobile_org_settings WHERE organization_id = $1', [orgId]),
    pool.query('SELECT feature_key, enabled FROM mobile_org_features WHERE organization_id = $1', [orgId]),
    getGlobalMobileConfig(),
  ]);
  const overrides = {};
  featRows.forEach(r => { overrides[r.feature_key] = r.enabled; });
  const features = {};
  MOBILE_FEATURES.forEach(f => {
    const orgOn = f.key in overrides ? overrides[f.key] : true;
    features[f.key] = orgOn && glob.features[f.key] !== false; // platform-wide switch wins
  });

  const entry = { at: Date.now(), enabled: !!orgRows[0]?.enabled && glob.app, features };
  cache.set(orgId, entry);
  return entry;
}

function isMobileRequest(req) {
  return String(req.headers['x-client-platform'] || '').toLowerCase() === 'mobile';
}

const DISABLED_APP_MESSAGE =
  'The mobile app is not enabled for your organization yet. Please contact your platform administrator to make the app available for your organization.';

/** Express middleware — enforces the master switch + feature flags on mobile requests only. */
async function mobileGate(req, res, next) {
  if (req.method === 'OPTIONS' || !isMobileRequest(req)) return next();
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();
  if (EXEMPT_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) return next();

  let decoded;
  try { decoded = jwt.verify(authHeader.slice(7), JWT_SECRET); } catch { return next(); }
  if (!decoded.organization_id || decoded.role === 'platform_admin') return next();

  try {
    const cfg = await getOrgMobileConfig(decoded.organization_id);
    if (!cfg.enabled) {
      return res.status(403).json({ error: DISABLED_APP_MESSAGE, code: 'MOBILE_APP_DISABLED' });
    }
    const feature = MOBILE_FEATURES.find(f => f.routes.some(p => req.path === p || req.path.startsWith(p + '/')));
    if (feature && cfg.features[feature.key] === false) {
      return res.status(403).json({
        error: `${feature.label} is currently unavailable on mobile for your organization.`,
        code: 'MOBILE_FEATURE_DISABLED', feature: feature.key,
      });
    }
  } catch { /* fail open — never lock users out because of a config lookup error */ }
  next();
}

module.exports = { MOBILE_FEATURES, DISABLED_APP_MESSAGE, getOrgMobileConfig, getGlobalMobileConfig, invalidateOrg, invalidateAll, isMobileRequest, mobileGate };
