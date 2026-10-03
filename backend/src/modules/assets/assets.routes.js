const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, getFilterState, canAdminAccessUser, canModifyBranchRecord, resolveWriteBranch } = require('../../utils/branchFilter');
const { validateBranchIdList } = require('../../services/branchService');

// Asset ownership: branch_id NULL = organisation inventory; branch_id = <id> = that branch's asset.
// An assigned asset is additionally governed by the assignee's branch (users.branch_id).

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// GET /api/assets
// Root Admin: all org assets.
// HR Admin: unassigned assets + assets assigned to employees in accessible branches.
// Employees access their own assets via ?userId=<own-id>.
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { userId, status } = req.query;
    const branchState = getFilterState(req.branchContext);
    let q = db.from('assets')
      .select('*, assigned_user:users!assets_assigned_to_fkey(id, name, avatar_color, department)')
      .eq('organization_id', oId)
      .order('created_at', { ascending: false });

    if (!isAdmin(req.user.role)) {
      // Non-admins only ever see assets assigned to themselves — ?userId= is ignored.
      q = q.eq('assigned_to', req.user.id);
    } else if (userId) {
      if (!await canAdminAccessUser(req.branchContext, parseInt(userId, 10), oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch" });
      q = q.eq('assigned_to', parseInt(userId, 10));
    } else if (isAdmin(req.user.role)) {
      // Branch-filter assigned assets via employee IDs AND filter unassigned assets by branch_id.
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (branchState.type === 'specific') {
        const bid = branchState.branchId;
        if (empIds !== null && empIds.length === 0) {
          // No employees in branch — show only branch-owned unassigned assets
          q = q.or(`branch_id.eq.${bid},branch_id.is.null`).is('assigned_to', null);
        } else if (empIds !== null) {
          // BUG_257: pg-adapter OR parser splits by comma, so nested and() sub-expressions
          // break parsing. Use a broad OR and let in-JS post-filter handle the refinement.
          // Fetch: (1) assets assigned to this branch's employees, (2) branch-owned assets,
          // (3) unassigned org-wide assets — then return all of them.
          const empOr = `assigned_to.in.(${empIds.join(',')})`;
          q = q.or(`${empOr},branch_id.eq.${bid},branch_id.is.null`);
        }
      } else if (empIds !== null && empIds.length === 0) {
        q = q.is('assigned_to', null);
      } else if (empIds !== null) {
        q = q.or(`assigned_to.is.null,assigned_to.in.(${empIds.join(',')})`);
      }
    }

    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    let rows = data || [];
    // Unassigned assets are visible only when org-wide (branch NULL) or in the caller's branch scope.
    if (isAdmin(req.user.role) && !userId && branchState.type !== 'all') {
      const allowed = new Set(
        branchState.type === 'specific' ? [Number(branchState.branchId)]
        : branchState.type === 'multi'  ? branchState.branchIds.map(Number) : []);
      rows = rows.filter(a => a.assigned_to != null || a.branch_id == null || allowed.has(Number(a.branch_id)));
    }
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const VALID_STATUSES = ['available', 'assigned', 'in_repair', 'retired', 'maintenance'];

// Generate a sequential, branch-scoped asset tag like `{branchCode}_asset_001`.
// Falls back to `asset_001` when the asset has no branch. Sequence is derived
// from the highest existing numeric suffix for the same prefix (+1), so tags are
// stable and human-friendly without relying on DB sequences.
async function generateAssetTag(oId, branchId) {
  let prefix = 'asset_';
  if (branchId) {
    try {
      const { data: branch } = await db.from('branches')
        .select('code, name').eq('id', branchId).eq('org_id', oId).maybeSingle();
      const raw = (branch?.code || branch?.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
      if (raw) prefix = `${raw}_asset_`;
    } catch { /* branch lookup failed — fall back to generic prefix */ }
  }

  const { data: existing } = await db.from('assets')
    .select('asset_tag')
    .eq('organization_id', oId)
    .like('asset_tag', `${prefix}%`);

  let maxSeq = 0;
  (existing || []).forEach(a => {
    const m = String(a.asset_tag || '').match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`));
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  });

  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

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

// BUG_189: never expose raw database errors (column/constraint/relation names) to the user.
function safeAssetError(err, action) {
  console.error(`[assets] ${action} error:`, err?.message);
  return /column|relation|does not exist|violates|constraint|syntax error/i.test(err?.message || '')
    ? 'We could not save the asset due to a system configuration issue. Please try again, or contact support if the problem persists.'
    : (err?.message || 'Server error');
}

// POST /api/assets
router.post('/', auth, hasPermission('assets', 'create'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const body = sanitiseAssetBody({ ...req.body, organization_id: oId });
    delete body.id; delete body.created_at;
    // Scope: a client-supplied branch_id is validated (org + access); otherwise the selected
    // branch is used. A restricted HR with no selection is rejected (no NULL-branch bypass).
    if (body.branch_id) {
      const v = await validateBranchIdList(req.user.id, oId, req.user.role, [body.branch_id]);
      if (!v.ok) return res.status(403).json({ error: v.error });
      body.branch_id = v.ids[0];
    } else {
      const w = resolveWriteBranch(req.branchContext);
      if (!w.ok) return res.status(w.status).json({ error: w.error });
      body.branch_id = w.branchId;
    }
    if (body.assigned_to && !await canAdminAccessUser(req.branchContext, parseInt(body.assigned_to, 10), oId))
      return res.status(403).json({ error: "You do not have access to the selected employee's branch." });

    // ── Status validation ─────────────────────────────────────────────────────
    if (body.status && !VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `Invalid status '${body.status}'. Allowed: ${VALID_STATUSES.join(', ')}.` });
    }

    // ── BUG_187: assigned_to is mandatory when status = assigned ──────────────
    if (body.status === 'assigned' && !body.assigned_to) {
      return res.status(400).json({ error: 'An employee must be selected when asset status is Assigned.' });
    }

    // ── Uniqueness: asset_tag must be unique within the org ───────────────────
    // BUG-114/120: auto-generate a branch-scoped tag when none is supplied so
    // admins can add assets quickly without tripping duplicate-validation errors.
    let tag = (body.asset_tag || '').trim();
    if (!tag) {
      tag = await generateAssetTag(oId, req.branchContext?.selectedBranchId || null);
    }
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
  } catch (err) { res.status(500).json({ error: safeAssetError(err, 'create') }); }
});

// PUT /api/assets/:id
router.put('/:id', auth, hasPermission('assets', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const body = sanitiseAssetBody({ ...req.body });
    delete body.id; delete body.created_at; delete body.organization_id;

    const { data: cur } = await db.from('assets').select('id, branch_id, assigned_to')
      .eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'Asset not found' });
    // Branch assets: branch must be in scope. Org inventory (NULL branch): all-branch callers, or a
    // restricted HR only when the asset is/ends up assigned to an employee in their scope.
    let allowedToEdit = canModifyBranchRecord(req.branchContext, cur.branch_id);
    if (!allowedToEdit && cur.branch_id == null) {
      const assignee = body.assigned_to || cur.assigned_to;
      allowedToEdit = !!assignee && await canAdminAccessUser(req.branchContext, parseInt(assignee, 10), oId);
    }
    if (!allowedToEdit) return res.status(403).json({ error: 'You do not have access to modify this asset.' });
    if (body.assigned_to && !await canAdminAccessUser(req.branchContext, parseInt(body.assigned_to, 10), oId))
      return res.status(403).json({ error: "You do not have access to the selected employee's branch." });
    // Moving an asset between branches requires access to the destination branch too.
    if (body.branch_id !== undefined && String(body.branch_id ?? '') !== String(cur.branch_id ?? '')) {
      if (body.branch_id) {
        const v = await validateBranchIdList(req.user.id, oId, req.user.role, [body.branch_id]);
        if (!v.ok) return res.status(403).json({ error: v.error });
        body.branch_id = v.ids[0];
      } else if (!req.branchContext?.hasAllBranches) {
        return res.status(403).json({ error: 'Only users with all-branch access can make an asset organisation-wide.' });
      } else { body.branch_id = null; }
    } else { delete body.branch_id; }

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
  } catch (err) { res.status(500).json({ error: safeAssetError(err, 'update') }); }
});

// DELETE /api/assets/:id
router.delete('/:id', auth, hasPermission('assets', 'manage'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { data: cur } = await db.from('assets').select('id, branch_id, assigned_to')
      .eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'Asset not found' });
    let allowedToDelete = canModifyBranchRecord(req.branchContext, cur.branch_id);
    if (!allowedToDelete && cur.branch_id == null && cur.assigned_to)
      allowedToDelete = await canAdminAccessUser(req.branchContext, parseInt(cur.assigned_to, 10), oId);
    if (!allowedToDelete) return res.status(403).json({ error: 'You do not have access to delete this asset.' });
    const { error } = await db.from('assets').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
