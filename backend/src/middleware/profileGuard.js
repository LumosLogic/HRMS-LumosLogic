/**
 * profileGuard.js
 *
 * Central target-employee authorization for every /api/profile/:id/* route.
 *
 *   self                → allowed
 *   root_admin          → allowed if the target is a user of the caller's organisation
 *   HR admin            → target must be in the caller's organisation AND inside their branch scope
 *   Manager / HOD       → READ-ONLY (GET) on the work-related sections of a member of their team scope, when they
 *                         hold team.view (see TEAM_READ_SECTIONS). Sets req.teamViewer; every route still decides.
 *   anyone else         → 403
 *
 * Mounted once in server.js (app.use('/api/profile/:id', …)) so a profile endpoint added
 * later cannot forget the check. Individual routes keep their own field-level rules.
 */
const { pool } = require('../config/db');
const { auth } = require('./auth');
const { withBranchContext } = require('./branchContext');
const { canAdminAccessUser } = require('../utils/branchFilter');
const { isInTeamScope } = require('../services/teamScope');
const { resolvePermissions, hasPermissionCheck } = require('../services/permissionService');

// Sections a manager / HOD may READ for a team member. Personal, banking, statutory, documents… stay admin/self only.
const TEAM_READ_SECTIONS = new Set(['overview', 'professional', 'skills', 'experience']);

async function targetGuard(req, res, next) {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) return res.status(400).json({ error: 'Invalid employee id' });

    const { id: callerId, role, organization_id: oId } = req.user;
    if (Number(callerId) === targetId) return next();

    if (role === 'root_admin') {
      const { rows } = await pool.query(
        'SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1', [targetId, oId]);
      if (!rows.length) return res.status(404).json({ error: 'Employee not found' });
      return next();
    }

    if (role === 'admin') {
      if (!await canAdminAccessUser(req.branchContext, targetId, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
      return next();
    }

    // Manager / HOD: read-only, work-related sections, team members only, permission-gated.
    // A team-scope / permission lookup failure fails CLOSED (falls through to 403) — it must
    // never open the profile and never surface as a 500 for a plain denial.
    try {
      const section = String(req.path || '').split('/').filter(Boolean)[0];
      if (req.method === 'GET' && TEAM_READ_SECTIONS.has(section) && await isInTeamScope(callerId, targetId, oId)) {
        const perms = await resolvePermissions(callerId, oId);
        if (hasPermissionCheck(perms, 'team', 'view')) { req.teamViewer = true; return next(); }
      }
    } catch (e) { console.error('[profileGuard] team-scope check skipped:', e.message); }

    return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error('[profileGuard]', err.message);
    res.status(500).json({ error: 'Authorization check failed' });
  }
}

module.exports = [auth, withBranchContext, targetGuard];
