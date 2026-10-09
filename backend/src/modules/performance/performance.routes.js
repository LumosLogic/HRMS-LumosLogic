const express = require('express');
const router  = express.Router();
const { sameId } = require('../../utils/ids');
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, canAdminAccessUser } = require('../../utils/branchFilter');
const cloudinary = require('cloudinary').v2;
const multer     = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const perfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// goal_attachments was created by three different migrations: two name the MIME column `mime_type`, one `file_type`
// (CREATE TABLE IF NOT EXISTS means whichever ran first wins). The upload used to insert `file_type` unconditionally and
// failed with `column "file_type" of relation "goal_attachments" does not exist` on databases built the other way.
// Use whichever column this database has (add_goal_attachments_file_type_2026_10_09.sql makes `file_type` exist everywhere).
let _attTypeCol;
async function attachmentTypeColumn() {
  if (_attTypeCol !== undefined) return _attTypeCol;
  const { pool } = require('../../config/db');
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'goal_attachments' AND column_name IN ('file_type', 'mime_type')`);
  const names = rows.map(r => r.column_name);
  _attTypeCol = names.includes('file_type') ? 'file_type' : names.includes('mime_type') ? 'mime_type' : null;
  return _attTypeCol;
}

// Goal-derived records (attachments, comments) follow the goal owner's branch.
// Returns true when the caller may act on a goal owned by `goalUserId`.
async function canAccessGoalOwner(req, goalUserId) {
  if (sameId(goalUserId, req.user.id)) return true;
  if (!isAdmin(req.user.role)) return false;
  return canAdminAccessUser(req.branchContext, goalUserId, req.user.organization_id);
}

// ─── Goals ────────────────────────────────────────────────────────────────────
router.get('/goals', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { userId, cycle } = req.query;
    let q = db.from('performance_goals').select('*').eq('organization_id', oId).order('created_at', { ascending: false });

    if (!isAdmin(req.user.role)) {
      // Employees see only their own goals — branch filter does not apply
      q = q.eq('user_id', req.user.id);
    } else if (userId) {
      // Admin requested a specific employee — keep as-is; org scope already enforced above
      q = q.eq('user_id', userId);
    } else {
      // Admin viewing all — apply branch filter
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null && empIds.length === 0) return res.json([]);
      if (empIds !== null) q = q.in('user_id', empIds);
    }

    if (cycle) q = q.eq('review_cycle', cycle);
    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) return res.json([]);

    const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
    const { data: users } = await db.from('users').select('id, name, avatar_color, department').in('id', userIds);
    const uMap = {};
    (users || []).forEach(u => { uMap[u.id] = u; });

    res.json(rows.map(r => ({ ...r, user_name: uMap[r.user_id]?.name || '', user_avatar_color: uMap[r.user_id]?.avatar_color || '' })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/goals', auth, hasPermission('performance', 'create'), withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { title, description, category, target_date, review_cycle, user_id, progress } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    // BUG_082: enforce title max length
    if (title.length > 150) return res.status(400).json({ error: 'Goal Title must be 150 characters or less.' });
    if (description && description.length > 1000) return res.status(400).json({ error: 'Description must be 1000 characters or less.' });
    if (target_date) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (new Date(target_date) < today) return res.status(400).json({ error: 'Target date cannot be in the past.' });
    }
    const targetUserId = isAdmin(req.user.role) && user_id ? parseInt(user_id, 10) : req.user.id;
    if (targetUserId !== req.user.id && !await canAdminAccessUser(req.branchContext, targetUserId, oId))
      return res.status(403).json({ error: "You do not have access to this employee's branch." });
    const cycle = review_cycle || String(new Date().getFullYear());
    // Duplicate check: same title + category for same user in same cycle
    const { data: existing } = await db.from('performance_goals')
      .select('id').eq('organization_id', oId).eq('user_id', targetUserId)
      .ilike('title', title.trim()).eq('category', category || 'individual').eq('review_cycle', cycle).maybeSingle();
    if (existing) return res.status(400).json({ error: 'A goal with the same title and category already exists for this cycle.' });
    const cappedProgress = Math.min(100, Math.max(0, Number(progress) || 0));
    const autoStatus = cappedProgress >= 100 ? 'completed' : 'active';
    const { data, error } = await db.from('performance_goals')
      .insert({ user_id: targetUserId, title: title.trim(), description: description || '', category: category || 'individual', target_date: target_date || null, review_cycle: cycle, created_by: req.user.id, organization_id: oId, progress: cappedProgress, status: autoStatus })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admins can update all fields; employees can update all fields on their own goals.
router.put('/goals/:id', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { title, description, category, target_date, review_cycle, progress, status } = req.body;

    // BUG_082: enforce title max length on update
    if (title && title.length > 150) return res.status(400).json({ error: 'Goal Title must be 150 characters or less.' });
    if (description && description.length > 1000) return res.status(400).json({ error: 'Description must be 1000 characters or less.' });

    // Fetch goal first to enforce ownership for employees, and to read current status
    const { data: goal } = await db.from('performance_goals')
      .select('user_id, status').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    if (!isAdmin(req.user.role) && !sameId(goal.user_id, req.user.id)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Branch isolation: admin must have access to the goal owner's branch.
    if (isAdmin(req.user.role) && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, goal.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    const cappedProgress = Math.min(100, Math.max(0, Number(progress) || 0));
    // BUG_165: Never auto-promote a cancelled goal to 'completed' when progress hits 100.
    // A cancelled goal must remain cancelled unless the caller explicitly re-activates it.
    const incomingStatus      = status;                           // may be undefined
    const currentlyCancelled  = goal.status === 'cancelled';
    const beingCancelled      = incomingStatus === 'cancelled';
    const beingReactivated    = incomingStatus === 'active' || incomingStatus === 'completed';
    let autoStatus;
    if (beingCancelled) {
      autoStatus = 'cancelled';
    } else if (currentlyCancelled && !beingReactivated) {
      // Preserve cancelled — ignore auto-complete even if progress reaches 100
      autoStatus = 'cancelled';
    } else {
      // Normal path: auto-complete when 100%, otherwise use explicit or default status
      autoStatus = cappedProgress >= 100 ? 'completed' : (incomingStatus || 'active');
    }

    let updatePayload;
    // BUG_084: include review_cycle so editing target_date also updates the cycle
    const cycle = review_cycle || (target_date ? target_date.substring(0, 4) : undefined);
    updatePayload = { title, description, category, target_date, progress: cappedProgress, status: autoStatus };
    if (cycle) updatePayload.review_cycle = cycle;

    const { data, error } = await db.from('performance_goals')
      .update(updatePayload)
      .eq('id', req.params.id).eq('organization_id', oId).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/goals/:id', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    // Employees can delete their own goals; admins can delete any goal (BUG_034 fix)
    const { data: goal } = await db.from('performance_goals')
      .select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    if (!isAdmin(req.user.role) && !sameId(goal.user_id, req.user.id)) {
      return res.status(403).json({ error: 'You can only delete your own goals.' });
    }
    // Branch isolation: admin must have access to the goal owner's branch.
    if (isAdmin(req.user.role) && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, goal.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    const { error } = await db.from('performance_goals').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
router.get('/reviews', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { userId, cycle } = req.query;
    let q = db.from('performance_reviews').select('*').eq('organization_id', oId).order('created_at', { ascending: false });

    if (!isAdmin(req.user.role)) {
      // Employees see only their own reviews — branch filter does not apply
      q = q.eq('user_id', req.user.id);
    } else if (userId) {
      // Admin requested a specific employee
      q = q.eq('user_id', userId);
    } else {
      // Admin viewing all — apply branch filter
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null && empIds.length === 0) return res.json([]);
      if (empIds !== null) q = q.in('user_id', empIds);
    }

    if (cycle) q = q.eq('review_cycle', cycle);
    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) return res.json([]);

    const allIds = [...new Set([...rows.map(r => r.user_id), ...rows.map(r => r.reviewer_id)].filter(Boolean))];
    const { data: users } = await db.from('users').select('id, name, avatar_color, department, position').in('id', allIds);
    const uMap = {};
    (users || []).forEach(u => { uMap[u.id] = u; });

    res.json(rows.map(r => ({
      ...r,
      user_name:         uMap[r.user_id]?.name || '',
      user_avatar_color: uMap[r.user_id]?.avatar_color || '',
      user_department:   uMap[r.user_id]?.department || '',
      reviewer_name:     uMap[r.reviewer_id]?.name || '',
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reviews', auth, hasPermission('performance', 'create'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { user_id, review_cycle, review_type } = req.body;
    if (!user_id || !review_cycle) return res.status(400).json({ error: 'user_id and review_cycle required' });
    // Branch isolation: admin must have access to the target employee's branch.
    if (req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    const { data, error } = await db.from('performance_reviews')
      .insert({ user_id, review_cycle, review_type: review_type || 'annual', reviewer_id: req.user.id, status: 'pending', organization_id: oId })
      .select().single();
    if (error) throw error;
    await db.from('notifications').insert({ user_id, title: 'Performance Review Started', message: `Your ${review_cycle} performance review has been initiated.`, type: 'performance', organization_id: oId });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/reviews/:id', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    // Admin-level changes (manager rating, final rating, status…) need performance.manage; the employee who OWNS the
    // review may submit their own self-rating/comments without it (the seeded employee role never had `manage`, so
    // self-reviews were rejected with 403 even though the handler was written to accept them).
    {
      const { data: owner } = await db.from('performance_reviews').select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
      if (!owner) return res.status(404).json({ error: 'Review not found' });
      const isOwner = sameId(owner.user_id, req.user.id);
      if (!(isAdmin(req.user.role) || isOwner)) return res.status(403).json({ error: 'Access denied' });
      if (isAdmin(req.user.role) && req.user.role !== 'root_admin' && !isOwner) {
        const { resolvePermissions, hasPermissionCheck } = require('../../services/permissionService');
        if (!hasPermissionCheck(await resolvePermissions(req.user.id, oId), 'performance', 'manage'))
          return res.status(403).json({ error: "You don't have permission to perform this action", required_permission: 'performance.manage' });
      }
    }
    // Branch isolation: validate admin has access to the review owner's branch.
    if (req.user.role !== 'root_admin') {
      const { data: rev } = await db.from('performance_reviews')
        .select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
      if (rev && !await canAdminAccessUser(req.branchContext, rev.user_id, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }
    const { self_rating, self_comments, manager_rating, manager_comments, strengths, improvements, final_rating, status } = req.body;
    const update = {};
    if (self_rating !== undefined)     { update.self_rating = self_rating; update.self_comments = self_comments || ''; }
    if (isAdmin(req.user.role)) {
      if (manager_rating !== undefined) update.manager_rating = manager_rating;
      if (manager_comments)             update.manager_comments = manager_comments;
      if (strengths)                    update.strengths = strengths;
      if (improvements)                 update.improvements = improvements;
      if (final_rating !== undefined)   update.final_rating = final_rating;
      if (status)                       update.status = status;
    }
    const { data, error } = await db.from('performance_reviews')
      .update(update).eq('id', req.params.id).eq('organization_id', oId).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EHN_PR_005: Bulk Goal Creation ──────────────────────────────────────────
router.post('/goals/bulk', auth, hasPermission('performance', 'create'), withBranchContext, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = req.user.organization_id;
    const { title, description, category, target_date, review_cycle, user_ids, progress } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!Array.isArray(user_ids) || user_ids.length === 0) return res.status(400).json({ error: 'user_ids array is required' });
    const cycle = review_cycle || String(new Date().getFullYear());
    const cappedProgress = Math.min(100, Math.max(0, Number(progress) || 0));
    // Branch isolation: filter user_ids to only accessible-branch employees.
    let filteredUserIds = user_ids;
    if (req.user.role !== 'root_admin') {
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null) {
        const empSet = new Set(empIds.map(Number));
        filteredUserIds = user_ids.filter(id => empSet.has(Number(id)));
        if (filteredUserIds.length === 0)
          return res.status(403).json({ error: 'None of the specified employees are in your accessible branches.' });
      }
    }
    const rows = filteredUserIds.map(uid => ({
      user_id: uid, title: title.trim(), description: description || '',
      category: category || 'individual', target_date: target_date || null,
      review_cycle: cycle, created_by: req.user.id, organization_id: oId,
      progress: cappedProgress, status: cappedProgress >= 100 ? 'completed' : 'active',
    }));
    const { data, error } = await db.from('performance_goals').insert(rows).select();
    if (error) throw error;
    res.json({ created: (data || []).length, goals: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ENH_PERF_001: Goal Attachments ──────────────────────────────────────────
router.get('/goals/:id/attachments', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data: goal } = await db.from('performance_goals').select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    if (!await canAccessGoalOwner(req, goal.user_id)) return res.status(403).json({ error: 'Access denied' });
    const { data, error } = await db.from('goal_attachments').select('*').eq('goal_id', req.params.id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BUG_239: Upload a goal attachment (admin/manager only) ──────────────────
router.post('/goals/:id/attachments', auth, withBranchContext, perfUpload.single('file'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { data: goal } = await db.from('performance_goals')
      .select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    if (!await canAccessGoalOwner(req, goal.user_id))
      return res.status(403).json({ error: 'Access denied' });

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `hrms/${oId}/performance`, resource_type: 'auto' },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });

    const typeCol = await attachmentTypeColumn();
    const { data, error } = await db.from('goal_attachments').insert({
      ...(typeCol ? { [typeCol]: req.file.mimetype } : {}),
      goal_id:         req.params.id,
      organization_id: oId,
      file_url:        result.secure_url,
      file_name:       req.file.originalname,
      file_size:       req.file.size,
      uploaded_by:     req.user.id,
    }).select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ENH_PERF_002: Goal Comments / Manager Feedback ──────────────────────────
router.get('/goals/:id/comments', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data: goal } = await db.from('performance_goals').select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    if (!await canAccessGoalOwner(req, goal.user_id)) return res.status(403).json({ error: 'Access denied' });
    const { data, error } = await db.from('goal_comments').select('*').eq('goal_id', req.params.id).order('created_at', { ascending: true });
    if (error) throw error;
    const rows = data || [];
    if (rows.length === 0) return res.json([]);
    const userIds = [...new Set(rows.map(r => r.reviewer_id).filter(Boolean))];
    const { data: users } = await db.from('users').select('id, name, avatar_color').in('id', userIds);
    const uMap = {};
    (users || []).forEach(u => { uMap[u.id] = u; });
    res.json(rows.map(r => ({ ...r, reviewer_name: uMap[r.reviewer_id]?.name || '', reviewer_avatar_color: uMap[r.reviewer_id]?.avatar_color || '' })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/goals/:id/comments', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Only managers can add comments' });
    const { comment } = req.body;
    if (!comment?.trim()) return res.status(400).json({ error: 'Comment is required' });
    const { data: goal } = await db.from('performance_goals').select('user_id').eq('id', req.params.id).eq('organization_id', oId).maybeSingle();
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    if (!await canAccessGoalOwner(req, goal.user_id)) return res.status(403).json({ error: 'Access denied' });
    const { data, error } = await db.from('goal_comments').insert({
      goal_id: req.params.id, organization_id: oId, reviewer_id: req.user.id, comment: comment.trim(),
    }).select().single();
    if (error) throw error;
    res.json({ ...data, reviewer_name: req.user.name || '' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
