const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds } = require('../../utils/branchFilter');

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// GET /api/assets
// Root Admin: all org assets.
// HR Admin: unassigned assets + assets assigned to employees in accessible branches.
// Employees access their own assets via ?userId=<own-id>.
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { userId, status } = req.query;
    let q = db.from('assets')
      .select('*, assigned_user:users!assets_assigned_to_fkey(id, name, avatar_color, department)')
      .eq('organization_id', oId)
      .order('created_at', { ascending: false });

    if (userId) {
      // Specific-employee view: admin must have branch access to that employee
      if (isAdmin(req.user.role)) {
        const empIds = await resolveEmployeeIds(req.branchContext, oId);
        if (empIds !== null && !empIds.includes(parseInt(userId, 10)))
          return res.status(403).json({ error: "You do not have access to this employee's branch" });
      }
      q = q.eq('assigned_to', userId);
    } else if (isAdmin(req.user.role)) {
      // Org-wide admin view: branch-filter assigned assets; unassigned always visible
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null && empIds.length === 0) {
        q = q.is('assigned_to', null);
      } else if (empIds !== null) {
        q = q.or(`assigned_to.is.null,assigned_to.in.(${empIds.join(',')})`);
      }
    }

    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const VALID_STATUSES = ['available', 'assigned', 'in_repair', 'retired', 'maintenance'];

// Sanitise an asset body coming from the client before INSERT/UPDATE.
// Strips joined fields (assigned_user), normalises types, and validates status.
function sanitiseAssetBody(body) {
  // BUG_189/190: GET embeds assigned_user as a nested object — remove it so the
  // UPDATE doesn't try to write to a non-existent column.
  delete body.assigned_user;

  // BUG_134: empty strings → null for FK/numeric/date columns
  if (!body.serial_number) body.serial_number = null;
  if (!body.purchase_value && body.purchase_value !== 0) body.purchase_value = null;
  if (!body.assigned_to) body.assigned_to = null;
  if (!body.purchase_date) body.purchase_date = null;

  // BUG_188: normalise status — handle both 'in-repair' (old data) and 'in_repair'
  if (body.status) body.status = body.status.replace(/-/g, '_');

  // When an asset is not assigned, always clear the assigned_to to keep data consistent
  if (body.status !== 'assigned') body.assigned_to = null;

  return body;
}

// POST /api/assets
router.post('/', auth, hasPermission('assets', 'create'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const body = sanitiseAssetBody({ ...req.body, organization_id: oId });
    delete body.id; delete body.created_at;

    // ── Status validation ─────────────────────────────────────────────────────
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `Invalid status '${body.status}'. Allowed: ${VALID_STATUSES.join(', ')}.` });
    }

    // ── BUG_187: assigned_to is mandatory when status = assigned ──────────────
    if (body.status === 'assigned' && !body.assigned_to) {
      return res.status(400).json({ error: 'An employee must be selected when asset status is Assigned.' });
    }

    // ── Uniqueness: asset_tag must be unique within the org ───────────────────
    const tag = (body.asset_tag || '').trim();
    if (!tag) return res.status(400).json({ error: 'Asset tag is required.' });
    const { data: dupTag } = await db.from('assets')
      .select('id').eq('organization_id', oId).eq('asset_tag', tag).maybeSingle();
    if (dupTag) return res.status(400).json({ error: `Asset tag '${tag}' is already in use. Asset tags must be unique within the organisation.` });

    // ── Uniqueness: serial_number must be unique when provided ────────────────
    if (body.serial_number) {
      const { data: dupSN } = await db.from('assets')
        .select('id').eq('organization_id', oId).eq('serial_number', body.serial_number).maybeSingle();
      if (dupSN) return res.status(400).json({ error: `Serial number '${body.serial_number}' is already registered to another asset.` });
    }

    body.asset_tag = tag;
    const { data, error } = await db.from('assets').insert(body).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/assets/:id
router.put('/:id', auth, hasPermission('assets', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const body = sanitiseAssetBody({ ...req.body });
    delete body.id; delete body.created_at; delete body.organization_id;

    // ── Status validation ─────────────────────────────────────────────────────
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `Invalid status '${body.status}'. Allowed: ${VALID_STATUSES.join(', ')}.` });
    }

    // ── BUG_187: assigned_to is mandatory when status = assigned ──────────────
    if (body.status === 'assigned' && !body.assigned_to) {
      return res.status(400).json({ error: 'An employee must be selected when asset status is Assigned.' });
    }

    // ── Uniqueness: asset_tag must be unique (excluding this asset) ───────────
    const tag = (body.asset_tag || '').trim();
    if (!tag) return res.status(400).json({ error: 'Asset tag is required.' });
    const { data: dupTag } = await db.from('assets')
      .select('id').eq('organization_id', oId).eq('asset_tag', tag).neq('id', req.params.id).maybeSingle();
    if (dupTag) return res.status(400).json({ error: `Asset tag '${tag}' is already in use by another asset.` });

    // ── Uniqueness: serial_number must be unique when provided (excluding this asset) ─
    if (body.serial_number) {
      const { data: dupSN } = await db.from('assets')
        .select('id').eq('organization_id', oId).eq('serial_number', body.serial_number).neq('id', req.params.id).maybeSingle();
      if (dupSN) return res.status(400).json({ error: `Serial number '${body.serial_number}' is already registered to another asset.` });
    }

    body.asset_tag = tag;
    const { data, error } = await db.from('assets')
      .update(body).eq('id', req.params.id).eq('organization_id', oId)
      .select().single();
    if (error) throw error;

    // Notify employee if assigned
    if (body.assigned_to && body.status === 'assigned') {
      await db.from('notifications').insert({
        user_id: body.assigned_to,
        title: 'Asset Assigned',
        message: `${body.name || 'An asset'} (${body.asset_tag || ''}) has been assigned to you.`,
        type: 'asset', organization_id: oId,
      });
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/assets/:id
router.delete('/:id', auth, hasPermission('assets', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { error } = await db.from('assets').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
