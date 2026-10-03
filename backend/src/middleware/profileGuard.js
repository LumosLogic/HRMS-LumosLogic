/**
 * profileGuard.js
 *
 * Central target-employee authorization for every /api/profile/:id/* route.
 *
 *   self                → allowed
 *   root_admin          → allowed if the target is a user of the caller's organisation
 *   HR admin            → target must be in the caller's organisation AND inside their branch scope
 *   anyone else         → 403
 *
 * Mounted once in server.js (app.use('/api/profile/:id', …)) so a profile endpoint added
 * later cannot forget the check. Individual routes keep their own field-level rules.
 */
const { pool } = require('../config/db');
const { auth } = require('./auth');
const { withBranchContext } = require('./branchContext');
const { canAdminAccessUser } = require('../utils/branchFilter');

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

    return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error('[profileGuard]', err.message);
    res.status(500).json({ error: 'Authorization check failed' });
  }
}

module.exports = [auth, withBranchContext, targetGuard];
