/**
 * /api/config-groups — shared configuration for several branches (work schedule, leave policies).
 * See services/configGroupService.js for the model.
 *
 * Authorization: group management changes configuration for SEVERAL branches at once, so it needs
 * settings.manage AND all-branch access (root, or an HR admin with the all-branches grant).
 * The read-only /effective lookup only needs access to the branch asked about.
 */
const express = require('express');
const router  = express.Router();
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { validateBranchAccess } = require('../../services/branchService');
const svc = require('../../services/configGroupService');

const { pool, GroupError } = svc;

function requireAllBranches(req, res, next) {
  if (req.branchContext?.hasAllBranches) return next();
  return res.status(403).json({ error: 'Managing configuration groups affects several branches and needs all-branch access.' });
}
const manage = [auth, hasPermission('settings', 'manage'), withBranchContext, requireAllBranches];

function fail(res, err) {
  if (err instanceof GroupError) return res.status(err.status).json({ error: err.message, ...(err.clash ? { clash: err.clash } : {}) });
  if (err && /config_group|group_id/.test(err.message || '') && /does not exist/.test(err.message || '')) {
    return res.status(503).json({ error: 'Configuration groups are not available yet: apply migration branch_separation_2026_10_03.sql.' });
  }
  console.error('[config-groups]', err.message);
  return res.status(500).json({ error: err.message });
}

/** Runs fn(client) in a transaction. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

// GET /api/config-groups?domain=work_schedule|leave_policies
router.get('/', ...manage, async (req, res) => {
  try {
    const domain = req.query.domain || null;
    if (domain && !svc.DOMAINS.includes(domain)) return res.status(400).json({ error: `domain must be one of: ${svc.DOMAINS.join(', ')}` });
    res.json(await svc.listGroups(pool, req.user.organization_id, domain));
  } catch (e) { fail(res, e); }
});

// GET /api/config-groups/effective?domain=&branch_id=  → { source: 'branch'|'group'|'org', group }
router.get('/effective', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { domain } = req.query;
    const branchId = parseInt(req.query.branch_id, 10);
    if (!svc.DOMAINS.includes(domain)) return res.status(400).json({ error: `domain must be one of: ${svc.DOMAINS.join(', ')}` });
    if (!Number.isInteger(branchId) || branchId <= 0) return res.status(400).json({ error: 'branch_id is required' });
    if (!await validateBranchAccess(req.user.id, oId, req.user.role, branchId))
      return res.status(403).json({ error: 'You do not have access to this branch.' });
    res.json(await svc.getEffectiveSource(pool, oId, domain, branchId));
  } catch (e) { fail(res, e); }
});

// POST /api/config-groups  { domain, name, branch_ids, from_branch_id? }
router.post('/', ...manage, async (req, res) => {
  try {
    const { domain, name, branch_ids, from_branch_id } = req.body || {};
    const out = await tx(client => svc.createGroup(client, {
      orgId: req.user.organization_id, domain, name, branchIds: branch_ids || [],
      fromBranchId: from_branch_id == null ? null : Number(from_branch_id), createdBy: req.user.id,
    }));
    res.status(201).json(out);
  } catch (e) { fail(res, e); }
});

// PUT /api/config-groups/:id  { name?, branch_ids? }
router.put('/:id', ...manage, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const out = await tx(async client => {
      const group = await svc.getGroup(client, oId, req.params.id);
      if (!group) throw new GroupError(404, 'Group not found');
      if (req.body.name !== undefined) {
        const nm = String(req.body.name || '').trim();
        if (!nm) throw new GroupError(400, 'Group name is required');
        try { await client.query('UPDATE config_groups SET name = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3', [nm, group.id, oId]); }
        catch (e) { if (e.code === '23505') throw new GroupError(409, `A group named "${nm}" already exists.`); throw e; }
      }
      const members = Array.isArray(req.body.branch_ids) ? await svc.setMembers(client, oId, group, req.body.branch_ids) : null;
      return { ok: true, members };
    });
    res.json(out);
  } catch (e) { fail(res, e); }
});

// GET /api/config-groups/:id/config
router.get('/:id/config', ...manage, async (req, res) => {
  try {
    const group = await svc.getGroup(pool, req.user.organization_id, req.params.id);
    if (!group) return res.status(404).json({ error: 'Group not found' });
    res.json({ group, config: await svc.getGroupConfig(pool, req.user.organization_id, group) });
  } catch (e) { fail(res, e); }
});

// PUT /api/config-groups/:id/config   work_schedule: { …fields }   leave_policies: { policies: [...] }
// Saves the group's configuration and propagates it to every member branch without a custom override.
router.put('/:id/config', ...manage, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const out = await tx(async client => {
      const group = await svc.getGroup(client, oId, req.params.id);
      if (!group) throw new GroupError(404, 'Group not found');
      const config = group.domain === 'work_schedule' ? svc.cleanWorkSchedule(req.body || {}) : svc.cleanPolicies(req.body?.policies);
      if (group.domain === 'work_schedule' && !Object.keys(config).length) throw new GroupError(400, 'No valid fields provided');
      if (group.domain === 'work_schedule') {
        // merge with the stored config so a partial update never resets the other fields
        const cur = await svc.getGroupConfig(client, oId, group);
        await svc.writeGroupConfig(client, group, { ...(cur || {}), ...config });
      } else {
        await svc.writeGroupConfig(client, group, config);
      }
      await client.query('UPDATE config_groups SET updated_at = NOW() WHERE id = $1', [group.id]);
      return { ok: true, ...(await svc.propagateGroup(client, oId, group)) };
    });
    res.json(out);
  } catch (e) { fail(res, e); }
});

// DELETE /api/config-groups/:id — dissolves the group; member branches fall back to the organisation default
// (a branch's own custom override, if any, is untouched).
router.delete('/:id', ...manage, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const out = await tx(async client => {
      const group = await svc.getGroup(client, oId, req.params.id);
      if (!group) throw new GroupError(404, 'Group not found');
      return { ok: true, ...(await svc.deleteGroup(client, oId, group)) };
    });
    res.json(out);
  } catch (e) { fail(res, e); }
});

module.exports = router;
