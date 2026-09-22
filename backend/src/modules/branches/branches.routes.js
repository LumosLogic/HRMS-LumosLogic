const express = require('express');
const router  = express.Router();
const { pool } = require('../../config/db-pg-adapter');
const { auth, rootAdminOnly } = require('../../middleware/auth');
const { getAccessibleBranches } = require('../../services/branchService');

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// ─── Branch Context: Current User's Accessible Branches ──────────────────────
// NOTE: Specific named routes must come BEFORE generic /:id routes to avoid shadowing.

/**
 * GET /api/branches/my-access
 * Returns branches accessible to the current user.
 * Used by the frontend BranchContext to populate the global branch selector.
 * Response: { branches: [...], hasAllBranches: bool, isRootAdmin: bool }
 */
router.get('/my-access', auth, async (req, res) => {
  try {
    const { id: userId, organization_id: orgId, role } = req.user;
    const result = await getAccessibleBranches(userId, orgId, role);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/branches/user-access-by-branch/:branchId
 * Returns all HR/Admin users who have access to a specific branch.
 * Used by the Branch HR Access modal in the admin UI.
 * Response: { users: [{ user_id, user_name, all_branches }] }
 */
router.get('/user-access-by-branch/:branchId', auth, rootAdminOnly, async (req, res) => {
  const { branchId } = req.params;
  const orgId = req.user.organization_id;
  try {
    const branchCheck = await pool.query(
      `SELECT id FROM branches WHERE id = $1 AND org_id = $2`,
      [branchId, orgId]
    );
    if (!branchCheck.rows.length) return res.status(404).json({ error: 'Branch not found' });

    const result = await pool.query(
      `SELECT DISTINCT hba.user_id, u.name AS user_name, hba.all_branches, hba.granted_at
       FROM hr_branch_access hba
       JOIN users u ON u.id = hba.user_id AND u.organization_id = $1
       WHERE hba.org_id = $1
         AND (hba.all_branches = TRUE OR hba.branch_id = $2)
       ORDER BY u.name`,
      [orgId, branchId]
    );
    res.json({ users: result.rows });
  } catch (err) {
    if (err.message && err.message.includes('does not exist')) return res.json({ users: [] });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/branches/user-access/:userId
 * Get an HR user's full branch access configuration.
 * Response: { userId, userName, userRole, hasAllBranches, allBranchesGrantId, branches: [...] }
 */
router.get('/user-access/:userId', auth, rootAdminOnly, async (req, res) => {
  const { userId } = req.params;
  const orgId = req.user.organization_id;
  try {
    const userCheck = await pool.query(
      `SELECT id, name, role FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [userId, orgId]
    );
    if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });
    const targetUser = userCheck.rows[0];

    const accessRows = await pool.query(
      `SELECT hba.id, hba.branch_id, hba.all_branches, hba.granted_at,
              b.name AS branch_name, b.code AS branch_code
       FROM hr_branch_access hba
       LEFT JOIN branches b ON b.id = hba.branch_id
       WHERE hba.user_id = $1 AND hba.org_id = $2
       ORDER BY hba.all_branches DESC, b.name`,
      [userId, orgId]
    );

    const allBranchesRow     = accessRows.rows.find(r => r.all_branches === true);
    const specificBranches   = accessRows.rows
      .filter(r => r.all_branches === false && r.branch_id)
      .map(r => ({
        id:         r.branch_id,
        name:       r.branch_name,
        code:       r.branch_code,
        grantId:    r.id,
        granted_at: r.granted_at,
      }));

    res.json({
      userId:             targetUser.id,
      userName:           targetUser.name,
      userRole:           targetUser.role,
      hasAllBranches:     !!allBranchesRow,
      allBranchesGrantId: allBranchesRow?.id || null,
      branches:           specificBranches,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HR/Admin Branch Access Management (Root Admin only) ─────────────────────

/**
 * POST /api/branches/user-access
 * Grant an HR user access to a specific branch or all branches.
 * Body: { userId, branchId? }  — omit branchId to grant all-branches access.
 */
router.post('/user-access', auth, rootAdminOnly, async (req, res) => {
  const { userId, branchId } = req.body;
  const orgId     = req.user.organization_id;
  const grantedBy = req.user.id;

  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const userCheck = await pool.query(
      `SELECT id, role FROM users WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [userId, orgId]
    );
    if (!userCheck.rows.length) return res.status(404).json({ error: 'User not found' });
    if (userCheck.rows[0].role === 'root_admin') {
      return res.status(400).json({ error: 'Root admins always have org-wide access. No grant needed.' });
    }

    if (branchId) {
      const branchCheck = await pool.query(
        `SELECT id FROM branches WHERE id = $1 AND org_id = $2`,
        [branchId, orgId]
      );
      if (!branchCheck.rows.length) return res.status(404).json({ error: 'Branch not found' });

      await pool.query(
        `INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches, granted_by)
         VALUES ($1, $2, $3, FALSE, $4)
         ON CONFLICT DO NOTHING`,
        [userId, orgId, branchId, grantedBy]
      );
      res.json({ ok: true, type: 'specific', branchId });
    } else {
      // Grant all-branches: remove specific grants (superseded) then add all_branches=TRUE
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM hr_branch_access WHERE user_id = $1 AND org_id = $2 AND all_branches = FALSE`,
          [userId, orgId]
        );
        await client.query(
          `INSERT INTO hr_branch_access (user_id, org_id, branch_id, all_branches, granted_by)
           VALUES ($1, $2, NULL, TRUE, $3)
           ON CONFLICT DO NOTHING`,
          [userId, orgId, grantedBy]
        );
        await client.query('COMMIT');
        res.json({ ok: true, type: 'all_branches' });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Access already granted.' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/branches/user-access/:userId/branch/:branchId
 * Revoke access to a specific branch.
 */
router.delete('/user-access/:userId/branch/:branchId', auth, rootAdminOnly, async (req, res) => {
  const { userId, branchId } = req.params;
  const orgId = req.user.organization_id;
  try {
    const result = await pool.query(
      `DELETE FROM hr_branch_access
       WHERE user_id = $1 AND org_id = $2 AND branch_id = $3 AND all_branches = FALSE
       RETURNING id`,
      [userId, orgId, branchId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Grant not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/branches/user-access/:userId/all-branches
 * Revoke the all-branches grant.
 */
router.delete('/user-access/:userId/all-branches', auth, rootAdminOnly, async (req, res) => {
  const { userId } = req.params;
  const orgId = req.user.organization_id;
  try {
    const result = await pool.query(
      `DELETE FROM hr_branch_access
       WHERE user_id = $1 AND org_id = $2 AND all_branches = TRUE
       RETURNING id`,
      [userId, orgId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'All-branches grant not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/branches/user-access/:userId
 * Revoke ALL branch access for an HR user.
 */
router.delete('/user-access/:userId', auth, rootAdminOnly, async (req, res) => {
  const { userId } = req.params;
  const orgId = req.user.organization_id;
  try {
    await pool.query(
      `DELETE FROM hr_branch_access WHERE user_id = $1 AND org_id = $2`,
      [userId, orgId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Existing Branch CRUD (/:id must come after all specific named routes) ────

// GET /api/branches — list all branches in org with HR admin assignment counts
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.*,
              COALESCE(COUNT(DISTINCT hba.user_id), 0)::int AS hr_admin_count,
              COALESCE(
                ARRAY_AGG(DISTINCT u.name ORDER BY u.name) FILTER (WHERE u.id IS NOT NULL),
                '{}'
              ) AS hr_admin_names
       FROM branches b
       LEFT JOIN hr_branch_access hba
              ON (hba.branch_id = b.id OR hba.all_branches = TRUE)
             AND hba.org_id = b.org_id
       LEFT JOIN users u ON u.id = hba.user_id AND u.organization_id = b.org_id
       WHERE b.org_id = $1
       GROUP BY b.id
       ORDER BY b.name`,
      [req.user.organization_id]
    );
    res.json(result.rows);
  } catch (err) {
    // Pre-migration fallback: hr_branch_access table may not exist yet
    if (err.message && err.message.includes('does not exist')) {
      const fallback = await pool.query(
        `SELECT * FROM branches WHERE org_id = $1 ORDER BY name`,
        [req.user.organization_id]
      );
      return res.json(fallback.rows);
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/branches — BUG_064: allow admins by role as fallback if RBAC not yet seeded
router.post('/', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin access required to create branches.' });
  try {
    const { name, code, location, address, is_active } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Branch name is required' });
    if (name.trim().length < 2) return res.status(400).json({ error: 'Branch name must be at least 2 characters.' });
    const result = await pool.query(
      `INSERT INTO branches (org_id, name, code, location, address, is_active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.user.organization_id, name.trim(), code || null, location || null,
       address || null, is_active !== false]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'A branch with this name already exists.' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/branches/:id
router.put('/:id', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const { name, code, location, address, is_active } = req.body;
    const result = await pool.query(
      `UPDATE branches SET name=$1, code=$2, location=$3, address=$4, is_active=$5
       WHERE id=$6 AND org_id=$7 RETURNING *`,
      [name, code || null, location || null, address || null,
       is_active !== false, req.params.id, req.user.organization_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Branch not found' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/branches/:id
router.delete('/:id', auth, async (req, res) => {
  if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin access required.' });
  try {
    const empCheck = await pool.query(
      `SELECT id FROM users WHERE branch_id=$1 AND organization_id=$2 LIMIT 1`,
      [req.params.id, req.user.organization_id]
    );
    if (empCheck.rows.length) {
      return res.status(400).json({ error: 'Cannot delete: employees are assigned to this branch' });
    }
    const result = await pool.query(
      `DELETE FROM branches WHERE id=$1 AND org_id=$2 RETURNING id`,
      [req.params.id, req.user.organization_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Branch not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
