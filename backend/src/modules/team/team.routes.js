/**
 * /api/team — read-only team scope for Managers and Heads of Department.
 *
 * A manager / HOD stays an ordinary employee. These endpoints only expose the people returned by
 * services/teamScope.getTeamScope (direct reports + department members, same organisation, same branch
 * when branching is ON). Every route is gated by a `team.*` permission that Root Admin edits in Role Management,
 * and every `userId` filter is re-validated against the scope — hiding UI is never the only protection.
 */
const express = require('express');
const router  = express.Router();
const { pool } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { resolvePermissions, hasPermissionCheck } = require('../../services/permissionService');
const { getTeamScope } = require('../../services/teamScope');

const TEAM_ACTIONS = ['view', 'attendance', 'leaves', 'regularization', 'performance'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 93;

async function loadAccess(req) {
  const orgId = req.user.organization_id;
  const perms = req.user.role === 'root_admin' ? null : await resolvePermissions(req.user.id, orgId);
  const can = {};
  for (const a of TEAM_ACTIONS) can[a] = perms === null ? true : hasPermissionCheck(perms, 'team', a);
  const scope = await getTeamScope(req.user.id, orgId);
  return { orgId, can, scope };
}

/** Gate: caller holds team.<action> AND has a non-empty team. Attaches req.team. */
function requireTeam(action) {
  return async (req, res, next) => {
    try {
      const access = await loadAccess(req);
      if (!access.can[action]) {
        return res.status(403).json({ error: "You don't have permission to perform this action", required_permission: `team.${action}` });
      }
      if (!access.scope.memberIds.length) return res.status(403).json({ error: 'You have no team members assigned.' });
      req.team = access;
      next();
    } catch (err) {
      console.error('[team] gate:', err.message);
      res.status(500).json({ error: 'Permission check failed' });
    }
  };
}

/** Optional ?userId= must be a team member; returns the id list to query. */
function scopedIds(req, res) {
  const raw = req.query.userId;
  if (raw === undefined || raw === '') return req.team.scope.memberIds;
  const id = Number(raw);
  if (!Number.isInteger(id) || !req.team.scope.memberIds.includes(id)) {
    res.status(403).json({ error: 'This employee is not in your team.' });
    return null;
  }
  return [id];
}

function dateRange(req, res, fallbackToday) {
  const today = new Date().toLocaleDateString('en-CA');
  let { from, to, date } = req.query;
  if (date) { from = date; to = date; }
  if (!from && !to && fallbackToday) { from = today; to = today; }
  if ((from && !DATE_RE.test(from)) || (to && !DATE_RE.test(to))) { res.status(400).json({ error: 'Dates must be YYYY-MM-DD' }); return null; }
  if (from && to) {
    const days = (new Date(to) - new Date(from)) / 86400000;
    if (days < 0 || days > MAX_RANGE_DAYS) { res.status(400).json({ error: `Date range must be between 0 and ${MAX_RANGE_DAYS} days` }); return null; }
  }
  return { from, to };
}

async function nameMap(ids) {
  if (!ids.length) return {};
  const { rows } = await pool.query(
    'SELECT id, name, avatar_color, department, position FROM users WHERE id = ANY($1::bigint[])', [ids]);
  return Object.fromEntries(rows.map(r => [Number(r.id), r]));
}
const decorate = (rows, map) => rows.map(r => ({
  ...r,
  user_name: map[Number(r.user_id)]?.name || '',
  user_avatar_color: map[Number(r.user_id)]?.avatar_color || '',
  user_department: map[Number(r.user_id)]?.department || '',
  user_position: map[Number(r.user_id)]?.position || '',
}));

// GET /api/team/me — what the logged-in employee may do as a manager / HOD (drives sidebar + page tabs)
router.get('/me', auth, async (req, res) => {
  try {
    const { can, scope } = await loadAccess(req);
    const hasTeam = scope.memberIds.length > 0;
    res.json({
      is_manager: scope.isManager,
      is_hod: scope.isHod,
      member_count: scope.memberIds.length,
      department_ids: scope.departmentIds,
      can: Object.fromEntries(TEAM_ACTIONS.map(a => [a, hasTeam && can[a]])),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/team/members
router.get('/members', auth, requireTeam('view'), async (req, res) => {
  try {
    const { memberIds, managerIds, hodIds } = req.team.scope;
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, employee_id, department, position, employee_status, joining_date,
              avatar_color, profile_photo_url, branch_id, reporting_to
         FROM users WHERE id = ANY($1::bigint[]) AND organization_id = $2 ORDER BY name`,
      [memberIds, req.team.orgId]);
    res.json(rows.map(r => ({
      ...r,
      relation: [managerIds.includes(Number(r.id)) && 'direct_report', hodIds.includes(Number(r.id)) && 'department']
        .filter(Boolean),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/team/attendance?date= | from=&to= [&userId=]
router.get('/attendance', auth, requireTeam('attendance'), async (req, res) => {
  try {
    const ids = scopedIds(req, res); if (!ids) return;
    const r = dateRange(req, res, true); if (!r) return;
    const params = [ids, req.team.orgId];
    let sql = 'SELECT * FROM attendance WHERE user_id = ANY($1::bigint[]) AND organization_id = $2';
    if (r.from) { params.push(r.from); sql += ` AND date >= $${params.length}`; }
    if (r.to)   { params.push(r.to);   sql += ` AND date <= $${params.length}`; }
    const { rows } = await pool.query(sql + ' ORDER BY date DESC, user_id', params);
    res.json(decorate(rows, await nameMap(ids)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/team/leaves?status=&from=&to= [&userId=]
router.get('/leaves', auth, requireTeam('leaves'), async (req, res) => {
  try {
    const ids = scopedIds(req, res); if (!ids) return;
    const r = dateRange(req, res, false); if (!r) return;
    const params = [ids, req.team.orgId];
    let sql = 'SELECT * FROM leaves WHERE user_id = ANY($1::bigint[]) AND organization_id = $2';
    if (req.query.status) { params.push(String(req.query.status)); sql += ` AND status = $${params.length}`; }
    if (r.from) { params.push(r.from); sql += ` AND end_date >= $${params.length}`; }
    if (r.to)   { params.push(r.to);   sql += ` AND start_date <= $${params.length}`; }
    const { rows } = await pool.query(sql + ' ORDER BY start_date DESC LIMIT 500', params);
    res.json(decorate(rows, await nameMap(ids)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/team/regularization?status=&from=&to= [&userId=]
router.get('/regularization', auth, requireTeam('regularization'), async (req, res) => {
  try {
    const ids = scopedIds(req, res); if (!ids) return;
    const r = dateRange(req, res, false); if (!r) return;
    const params = [ids, req.team.orgId];
    let sql = 'SELECT * FROM attendance_regularization WHERE user_id = ANY($1::bigint[]) AND organization_id = $2';
    if (req.query.status) { params.push(String(req.query.status)); sql += ` AND status = $${params.length}`; }
    if (r.from) { params.push(r.from); sql += ` AND date >= $${params.length}`; }
    if (r.to)   { params.push(r.to);   sql += ` AND date <= $${params.length}`; }
    const { rows } = await pool.query(sql + ' ORDER BY created_at DESC LIMIT 500', params);
    res.json(decorate(rows, await nameMap(ids)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/team/performance [&userId=]  → { goals, reviews }
router.get('/performance', auth, requireTeam('performance'), async (req, res) => {
  try {
    const ids = scopedIds(req, res); if (!ids) return;
    const params = [ids, req.team.orgId];
    const [g, v] = await Promise.all([
      pool.query('SELECT * FROM performance_goals WHERE user_id = ANY($1::bigint[]) AND organization_id = $2 ORDER BY created_at DESC LIMIT 500', params),
      pool.query('SELECT * FROM performance_reviews WHERE user_id = ANY($1::bigint[]) AND organization_id = $2 ORDER BY created_at DESC LIMIT 500', params),
    ]);
    const map = await nameMap(ids);
    res.json({ goals: decorate(g.rows, map), reviews: decorate(v.rows, map) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
