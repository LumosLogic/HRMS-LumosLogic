const express = require('express');
const router  = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { orgId } = require('../../utils/helpers');
// Fix H3: require at module top, not inside handler bodies
const { resolvePermissions, resolveCustomPermissions } = require('../../services/permissionService');

// ─── GET /api/permissions ─────────────────────────────────────────────────────
// Returns all available permissions grouped by module.
// Admin-only: employees never need to browse the permission catalog.
router.get('/', auth, hasPermission('roles', 'view'), async (req, res) => {
  try {
    const { data, error } = await db
      .from('permissions')
      .select('id, module_key, action, label, description')
      .order('module_key')
      .order('action');

    if (error) throw error;

    // Group by module_key
    const grouped = {};
    for (const p of data || []) {
      if (!grouped[p.module_key]) {
        grouped[p.module_key] = { module_key: p.module_key, permissions: [] };
      }
      grouped[p.module_key].permissions.push({
        id: p.id, action: p.action, label: p.label, description: p.description,
      });
    }

    res.json(Object.values(grouped));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/permissions/me ──────────────────────────────────────────────────
// Returns the calling user's own effective permissions.
// Must come before /user/:userId to avoid shadowing.
router.get('/me', auth, async (req, res) => {
  try {
    const permissions = await resolvePermissions(req.user.id, req.user.organization_id);
    // custom_permissions = grants from CUSTOM roles only. The client uses them to decide which admin
    // modules a custom-role employee sees; the API enforces the same grants independently.
    const custom_permissions = req.user.role === 'employee'
      ? await resolveCustomPermissions(req.user.id, req.user.organization_id)
      : [];
    res.json({ permissions, custom_permissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/permissions/user/:userId ────────────────────────────────────────
// Returns effective permission strings for a given user (for debugging / admin review).
router.get('/user/:userId', auth, hasPermission('roles', 'view'), async (req, res) => {
  try {
    const oId    = orgId(req);
    const userId = parseInt(req.params.userId, 10);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const permissions = await resolvePermissions(userId, oId);
    res.json({ user_id: userId, org_id: oId, permissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
