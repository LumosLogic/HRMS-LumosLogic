const express    = require('express');
const router     = express.Router();
const { db } = require('../../config/db');
const { auth } = require('../../middleware/auth');
const { hasPermission } = require('../../middleware/permissions');
const cloudinary = require('cloudinary').v2;
const multer     = require('multer');
const { withBranchContext } = require('../../middleware/branchContext');
const { resolveEmployeeIds, canAdminAccessUser } = require('../../utils/branchFilter');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// Enrich documents with owner (user_id) and uploader (uploaded_by) user info.
async function attachUserInfo(docs, oId) {
  if (!docs || !docs.length) return docs;
  const userIds = [...new Set([
    ...docs.map(d => d.user_id),
    ...docs.map(d => d.uploaded_by),
  ].filter(Boolean))];
  if (!userIds.length) return docs;
  const { data: users } = await db
    .from('users')
    .select('id, name, avatar_color')
    .in('id', userIds)
    .eq('organization_id', oId);
  const userMap = {};
  (users || []).forEach(u => { userMap[u.id] = u; });
  return docs.map(d => ({
    ...d,
    owner:    userMap[d.user_id]    || null,
    uploader: userMap[d.uploaded_by] || null,
  }));
}

// Fetch shares for a list of document IDs and attach them as document_shares array.
// Replaces the broken `document_shares(shared_with_user_id)` inline join — the
// pg-adapter inferred the wrong FK column (document_share_id vs document_id).
async function attachShares(docs, oId) {
  if (!docs || !docs.length) return docs;
  const ids = docs.map(d => d.id);
  const { data: shares } = await db
    .from('document_shares')
    .select('document_id, shared_with_user_id')
    .in('document_id', ids)
    .eq('organization_id', oId);
  const shareMap = {};
  (shares || []).forEach(s => {
    if (!shareMap[s.document_id]) shareMap[s.document_id] = [];
    shareMap[s.document_id].push({ shared_with_user_id: s.shared_with_user_id });
  });
  return docs.map(d => ({ ...d, document_shares: shareMap[d.id] || [] }));
}

// GET /api/documents/colleagues — lightweight employee list for sharing picker
// Admins see only employees in their accessible branches.
// Employees retain existing behavior (org-wide, for sharing with any colleague).
router.get('/colleagues', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const role = req.user.role;

    let query = db
      .from('users')
      .select('id, name, avatar_color, department')
      .eq('organization_id', oId)
      .eq('role', 'employee')
      .neq('id', req.user.id)
      .order('name');

    // Admins: filter colleagues to branch-accessible employees only.
    // Employees: see all org colleagues — they may share with anyone.
    if (role === 'admin' || role === 'root_admin') {
      const empIds = await resolveEmployeeIds(req.branchContext, oId);
      if (empIds !== null && empIds.length === 0) return res.json([]);
      if (empIds !== null) query = query.in('id', empIds);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/documents
router.get('/', auth, withBranchContext, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { userId } = req.query;

    if (isAdmin(req.user.role)) {
      let query = db
        .from('employee_documents')
        .select('*')
        .eq('organization_id', oId)
        .order('created_at', { ascending: false });

      if (userId) {
        // Admin requested a specific employee's documents.
        // Enforce branch access: the requested employee must belong to an
        // accessible branch. resolveEmployeeIds tells us which users are
        // in-scope; if the requested userId is not among them, return empty.
        const empIds = await resolveEmployeeIds(req.branchContext, oId);
        if (empIds !== null) {
          const numId = Number(userId);
          if (!empIds.includes(numId)) return res.json([]);
        }
        query = query.eq('user_id', Number(userId));
      } else {
        // Admin browsing all documents — apply branch filter
        const empIds = await resolveEmployeeIds(req.branchContext, oId);
        if (empIds !== null && empIds.length === 0) return res.json([]);
        if (empIds !== null) query = query.in('user_id', empIds);
      }

      const { data, error } = await query;
      if (error) throw error;
      const docs = await attachShares(data || [], oId);
      return res.json(await attachUserInfo(docs, oId));
    }

    // Employee: own docs + visibility='all' + specifically shared docs
    const myId = req.user.id;

    const { data: myShares } = await db
      .from('document_shares')
      .select('document_id')
      .eq('shared_with_user_id', myId)
      .eq('organization_id', oId);

    const sharedIds = (myShares || []).map(s => s.document_id);
    const orFilters = [`user_id.eq.${myId}`, 'visibility.eq.all'];
    if (sharedIds.length > 0) orFilters.push(`id.in.(${sharedIds.join(',')})`);

    const { data, error } = await db
      .from('employee_documents')
      .select('*')
      .eq('organization_id', oId)
      .neq('visibility', 'admin_only')
      .or(orFilters.join(','))
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(await attachShares(data || [], oId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/documents/upload
router.post('/upload', auth, hasPermission('documents', 'upload'), withBranchContext, upload.single('file'), async (req, res) => {
  try {
    const oId = req.user.organization_id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const allowedMIMEs = [
      'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (!allowedMIMEs.includes(req.file.mimetype))
      return res.status(400).json({ error: 'Invalid file type. Only PDF, Images, and Word documents are permitted.' });

    const { name, category, userId, expiry_date, visibility, shared_with } = req.body;
    const targetId = isAdmin(req.user.role) && userId ? Number(userId) : req.user.id;

    // Branch isolation: when admin uploads for another employee, validate branch access.
    if (isAdmin(req.user.role) && userId && req.user.role !== 'root_admin') {
      if (!await canAdminAccessUser(req.branchContext, targetId, oId))
        return res.status(403).json({ error: "You do not have access to this employee's branch." });
    }

    // Check for duplicate document (same name + category for same user)
    const { data: dupDoc } = await db.from('employee_documents')
      .select('id').eq('organization_id', oId).eq('user_id', targetId)
      .eq('name', name || req.file.originalname).eq('category', category || 'other').maybeSingle();
    if (dupDoc) {
      return res.status(409).json({ error: `A document named "${name || req.file.originalname}" in this category already exists for this employee. Please rename it or delete the existing document first.` });
    }

    // Resolve visibility
    let docVisibility = 'self';
    if (isAdmin(req.user.role)) {
      if (['self', 'all', 'specific', 'admin_only'].includes(visibility)) docVisibility = visibility;
    } else {
      docVisibility = visibility === 'specific' ? 'specific' : 'self';
    }

    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `hrms/${oId}/documents`, resource_type: 'auto' },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });

    // Admin uploads are pre-verified — no review needed.
    // Employee uploads default to 'pending_review' (DB default) and trigger an HR notification.
    const docStatus = isAdmin(req.user.role) ? 'verified' : 'pending_review';

    const { data: doc, error } = await db.from('employee_documents').insert({
      user_id:         targetId,
      name:            name || req.file.originalname,
      category:        category || 'other',
      file_url:        result.secure_url,
      file_type:       req.file.mimetype,
      file_size:       req.file.size,
      expiry_date:     expiry_date || null,
      uploaded_by:     req.user.id,
      organization_id: oId,
      visibility:      docVisibility,
      status:          docStatus,
    }).select().single();
    if (error) throw error;

    // Notify HR admins only when an employee (non-admin) uploads — admin uploads need no review.
    if (!isAdmin(req.user.role)) {
      db.from('users').select('id').eq('organization_id', oId).in('role', ['admin', 'root_admin'])
        .then(({ data: admins }) => {
          if (!admins?.length) return;
          return db.from('notifications').insert(admins.map(a => ({
            user_id: a.id,
            title:   'Employee Document Uploaded',
            message: `${req.user.name} uploaded "${doc.name}" (${doc.category}). Please review in the Documents section.`,
            type:    'document', organization_id: oId,
          })));
        }).catch(() => {});
    }

    // Insert shares for 'specific' visibility
    if (docVisibility === 'specific' && shared_with) {
      let userIds = [];
      try { userIds = JSON.parse(shared_with); } catch { userIds = []; }
      if (userIds.length > 0) {
        await db.from('document_shares').insert(
          userIds.map(uid => ({
            document_id:         doc.id,
            shared_with_user_id: Number(uid),
            organization_id:     oId,
          }))
        );
      }
    }

    res.json(doc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/documents/:id/shares — update visibility and shared recipients (admin only)
router.patch('/:id/shares', auth, hasPermission('documents', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;
    const { visibility, shared_with } = req.body;

    if (!['self', 'all', 'specific', 'admin_only'].includes(visibility))
      return res.status(400).json({ error: 'Invalid visibility value' });

    const { error: upErr } = await db.from('employee_documents')
      .update({ visibility })
      .eq('id', req.params.id)
      .eq('organization_id', oId);
    if (upErr) throw upErr;

    // Replace all existing shares
    await db.from('document_shares').delete().eq('document_id', Number(req.params.id));

    if (visibility === 'specific' && Array.isArray(shared_with) && shared_with.length > 0) {
      await db.from('document_shares').insert(
        shared_with.map(uid => ({
          document_id:         Number(req.params.id),
          shared_with_user_id: Number(uid),
          organization_id:     oId,
        }))
      );
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/documents/:id/status — admin only
router.patch('/:id/status', auth, hasPermission('documents', 'manage'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const { status } = req.body;
    if (!['pending_review', 'verified', 'rejected'].includes(status))
      return res.status(400).json({ error: 'Invalid status' });
    const { data, error } = await db.from('employee_documents')
      .update({ status })
      .eq('id', req.params.id)
      .eq('organization_id', req.user.organization_id)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/documents/:id — edit metadata, visibility/shares, and optionally replace the file
router.patch('/:id', auth, upload.single('file'), async (req, res) => {
  try {
    const oId = req.user.organization_id;

    const { data: doc } = await db.from('employee_documents')
      .select('*').eq('id', req.params.id).eq('organization_id', oId).single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (!isAdmin(req.user.role) && doc.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    const { name, category, expiry_date, visibility, shared_with, targetUserId } = req.body;

    // Resolve visibility (employees can only use self/specific)
    let newVisibility = doc.visibility || 'self';
    if (isAdmin(req.user.role)) {
      if (['self', 'all', 'specific', 'admin_only'].includes(visibility)) newVisibility = visibility;
    } else {
      if (['self', 'specific'].includes(visibility)) newVisibility = visibility;
    }

    const updates = {
      name:        name        || doc.name,
      category:    category    || doc.category,
      expiry_date: expiry_date !== undefined ? (expiry_date || null) : doc.expiry_date,
      visibility:  newVisibility,
    };

    // Admin edits/replaces a document → mark as verified immediately (no review queue needed).
    // Employee edits their own document → preserve the existing status (pending_review stays pending_review).
    if (isAdmin(req.user.role)) {
      updates.status = 'verified';
    }

    // Admin can re-assign the target employee for 'self' visibility
    if (isAdmin(req.user.role) && newVisibility === 'self' && targetUserId) {
      updates.user_id = Number(targetUserId);
    }

    // ── File replacement ────────────────────────────────────────────────────────
    if (req.file) {
      const allowedMIMEs = [
        'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ];
      if (!allowedMIMEs.includes(req.file.mimetype))
        return res.status(400).json({ error: 'Invalid file type.' });

      // Delete old file from Cloudinary
      const oldPublicId = doc.file_url.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
      try { await cloudinary.uploader.destroy(oldPublicId); } catch { /* already gone */ }

      // Upload new file
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: `hrms/${oId}/documents`, resource_type: 'auto' },
          (err, r) => err ? reject(err) : resolve(r)
        ).end(req.file.buffer);
      });

      updates.file_url  = result.secure_url;
      updates.file_type = req.file.mimetype;
      updates.file_size = req.file.size;
    }

    // ── Update document row ─────────────────────────────────────────────────────
    const { data: updated, error } = await db.from('employee_documents')
      .update(updates)
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .select().single();
    if (error) throw error;

    // ── Update shares when visibility changed ───────────────────────────────────
    if (newVisibility === 'specific' || doc.visibility === 'specific') {
      await db.from('document_shares').delete().eq('document_id', Number(req.params.id));

      if (newVisibility === 'specific' && shared_with) {
        let userIds = [];
        try { userIds = JSON.parse(shared_with); } catch { userIds = []; }
        if (userIds.length > 0) {
          await db.from('document_shares').insert(
            userIds.map(uid => ({
              document_id:         Number(req.params.id),
              shared_with_user_id: Number(uid),
              organization_id:     oId,
            }))
          );
        }
      }
    }

    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/documents/:id/request-delete — HR admin requests Root Admin to delete a document
router.post('/:id/request-delete', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;

    // Only HR admin (admin role, NOT root_admin) can use this endpoint
    if (!isAdmin(req.user.role))
      return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'root_admin')
      return res.status(400).json({ error: 'Root Admin can delete directly. Use the delete action instead.' });

    const { data: doc } = await db.from('employee_documents')
      .select('id, name, category')
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const { reason } = req.body;
    if (!reason?.trim())
      return res.status(400).json({ error: 'Reason is required for a deletion request.' });

    // Prevent duplicate pending requests for the same document
    const { data: existingReq } = await db.from('document_delete_requests')
      .select('id')
      .eq('document_id', Number(req.params.id))
      .eq('organization_id', oId)
      .eq('status', 'pending')
      .maybeSingle();
    if (existingReq)
      return res.status(409).json({ error: 'A deletion request for this document is already pending approval.' });

    // Notify all root_admins in the org
    const { data: rootAdmins } = await db.from('users')
      .select('id')
      .eq('organization_id', oId)
      .eq('role', 'root_admin');

    if (rootAdmins?.length) {
      await db.from('notifications').insert(
        rootAdmins.map(a => ({
          user_id:         a.id,
          title:           'Document Deletion Request',
          message:         `HR ${req.user.name} requested deletion of document "${doc.name}". Reason: ${reason.trim()}`,
          type:            'document',
          organization_id: oId,
        }))
      );
    }

    // Persist the delete request so Root Admin has an actionable inbox
    await db.from('document_delete_requests').insert({
      document_id:     Number(req.params.id),
      requested_by:    req.user.id,
      organization_id: oId,
      reason:          reason.trim(),
      status:          'pending',
    });

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/documents/delete-requests — Root Admin inbox of pending HR delete requests
router.get('/delete-requests', auth, async (req, res) => {
  try {
    if (req.user.role !== 'root_admin')
      return res.status(403).json({ error: 'Forbidden' });
    const oId = req.user.organization_id;
    const { status } = req.query; // optional: pending | approved | rejected

    let query = db
      .from('document_delete_requests')
      .select('*, requester:users!document_delete_requests_requested_by_fkey(id, name, avatar_color)')
      .eq('organization_id', oId)
      .order('created_at', { ascending: false });

    if (status && ['pending','approved','rejected'].includes(status))
      query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;

    // Attach document info (document may have been deleted by the time request is viewed)
    const docIds = [...new Set((data || []).map(r => r.document_id).filter(Boolean))];
    let docMap = {};
    if (docIds.length) {
      const { data: docs } = await db
        .from('employee_documents')
        .select('id, name, category, file_url, file_type, file_size')
        .in('id', docIds);
      (docs || []).forEach(d => { docMap[d.id] = d; });
    }

    res.json((data || []).map(r => ({ ...r, document: docMap[r.document_id] || null })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PATCH /api/documents/delete-requests/:id/action — Root Admin approves or rejects a delete request
router.patch('/delete-requests/:id/action', auth, async (req, res) => {
  try {
    if (req.user.role !== 'root_admin')
      return res.status(403).json({ error: 'Only Root Admin can action delete requests.' });

    const oId = req.user.organization_id;
    const { action, reason } = req.body;

    if (!['approved', 'rejected'].includes(action))
      return res.status(400).json({ error: 'Action must be "approved" or "rejected".' });

    const { data: delReq } = await db
      .from('document_delete_requests')
      .select('*')
      .eq('id', req.params.id)
      .eq('organization_id', oId)
      .eq('status', 'pending')
      .single();

    if (!delReq) return res.status(404).json({ error: 'Delete request not found or already actioned.' });

    // Fetch the document before potentially deleting it
    const { data: doc } = await db
      .from('employee_documents')
      .select('*')
      .eq('id', delReq.document_id)
      .eq('organization_id', oId)
      .single();

    // Update request status
    await db.from('document_delete_requests').update({
      status:          action,
      actioned_by:     req.user.id,
      actioned_at:     new Date().toISOString(),
      actioned_reason: reason?.trim() || null,
      updated_at:      new Date().toISOString(),
    }).eq('id', req.params.id);

    if (action === 'approved' && doc) {
      // Delete file from Cloudinary
      const publicId = doc.file_url.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
      try { await cloudinary.uploader.destroy(publicId); } catch {}
      // Delete shares and document row
      await db.from('document_shares').delete().eq('document_id', doc.id);
      await db.from('employee_documents').delete().eq('id', doc.id);
    }

    // Notify the requester
    const docName = doc?.name || 'the document';
    const notifMsg = action === 'approved'
      ? `Your request to delete "${docName}" was approved. The document has been permanently deleted.`
      : `Your request to delete "${docName}" was rejected${reason?.trim() ? `. Reason: ${reason.trim()}` : ''}.`;

    await db.from('notifications').insert({
      user_id:         delReq.requested_by,
      title:           action === 'approved' ? 'Delete Request Approved' : 'Delete Request Rejected',
      message:         notifMsg,
      type:            'document',
      organization_id: oId,
    });

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/documents/:id — only root_admin can delete shared docs (with mandatory reason)
router.delete('/:id', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    const { data: doc } = await db.from('employee_documents')
      .select('*').eq('id', req.params.id).eq('organization_id', oId).single();
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    // HR Admin cannot delete — only Root Admin allowed
    if (isAdmin(req.user.role) && req.user.role !== 'root_admin')
      return res.status(403).json({ error: 'Only Root Admin can delete documents. HR Admin can view, download, approve, reject, or request re-upload.' });

    // Non-admins can only delete their own (no UI, kept for API compatibility)
    if (!isAdmin(req.user.role) && doc.user_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    const { reason } = req.body;
    if (isAdmin(req.user.role) && !reason?.trim())
      return res.status(400).json({ error: 'Deletion reason is required.' });

    const publicId = doc.file_url.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
    try { await cloudinary.uploader.destroy(publicId); } catch { /* already gone */ }

    // Delete dependent rows first to avoid FK constraint violations
    await db.from('document_shares').delete().eq('document_id', req.params.id);

    const { error } = await db.from('employee_documents').delete().eq('id', req.params.id);
    if (error) throw error;

    // Audit log — notify all admins of deletion with reason
    if (reason?.trim()) {
      db.from('users').select('id').eq('organization_id', oId).in('role', ['admin', 'root_admin'])
        .then(({ data: admins }) => {
          if (!admins?.length) return;
          return db.from('notifications').insert(admins.map(a => ({
            user_id:         a.id,
            title:           'Document Deleted',
            message:         `Document "${doc.name}" was deleted by ${req.user.name}. Reason: ${reason.trim()}`,
            type:            'document',
            organization_id: oId,
          })));
        }).catch(() => {});
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
