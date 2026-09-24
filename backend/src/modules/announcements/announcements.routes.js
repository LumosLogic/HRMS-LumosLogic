const express    = require('express');
const router     = express.Router();
const { db } = require('../../config/db');
const { auth }   = require('../../middleware/auth');
const { sendMail, announcementHtml } = require('../../services/emailService');
const { getOrgContext } = require('../../utils/helpers');
const cloudinary = require('cloudinary').v2;
const multer     = require('multer');

// Configure Cloudinary (reads from env)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function isAdmin(role) { return role === 'admin' || role === 'root_admin'; }

// For root_admin, allow overriding the org via ?org_id= (GET) or body.org_id (POST)
function resolveOrgId(req, { fromQuery = false } = {}) {
  if (req.user.role === 'root_admin') {
    const override = fromQuery ? req.query.org_id : req.body?.org_id;
    if (override) return parseInt(override, 10);
  }
  return req.user.organization_id;
}

// GET /api/announcements
router.get('/', auth, async (req, res) => {
  try {
    const oId = resolveOrgId(req, { fromQuery: true });
    const today = new Date().toISOString().split('T')[0];
    let q = db.from('announcements').select('*').eq('organization_id', oId)
      .order('pinned', { ascending: false }).order('created_at', { ascending: false });
    if (!isAdmin(req.user.role)) {
      q = q.in('target_audience', ['all', 'employees']);
    } else {
      // BUG_085: admins can also see 'hr' audience announcements
      q = q.in('target_audience', ['all', 'employees', 'hr']);
    }
    const { data, error } = await q;
    if (error) throw error;

    const rows = data || [];
    if (rows.length === 0) return res.json([]);

    const creatorIds = [...new Set(rows.map(r => r.created_by).filter(Boolean))];
    let creatorMap = {};
    if (creatorIds.length) {
      const { data: creators } = await db.from('users').select('id, name').in('id', creatorIds);
      (creators || []).forEach(u => { creatorMap[u.id] = u.name; });
    }

    // An announcement is expired when today >= expires_at (i.e. expires_at < today OR expires_at === today)
    const isExpired = (r) => r.expires_at && r.expires_at <= today;

    // Filter expired for non-admins
    const filtered = isAdmin(req.user.role) ? rows : rows.filter(r => !isExpired(r));

    // BUG_179: auto-unpin expired announcements so they never appear in the Pinned section.
    // Also persist the unpin to the DB so the fix survives page reloads and ordering is correct.
    const expiredPinnedIds = rows.filter(r => r.pinned && isExpired(r)).map(r => r.id);
    if (expiredPinnedIds.length) {
      db.from('announcements').update({ pinned: false })
        .in('id', expiredPinnedIds)
        .eq('organization_id', oId)
        .then(() => {}).catch(() => {});
    }

    res.json(filtered.map(r => ({
      ...r,
      creator_name: creatorMap[r.created_by] || 'Admin',
      pinned: r.pinned && !isExpired(r),
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/announcements/upload — Cloudinary attachment upload
router.post('/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const oId = req.user.organization_id;
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `hrms/${oId}/announcements`, resource_type: 'auto' },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });

    res.json({
      file_url:  result.secure_url,
      file_name: req.file.originalname,
      file_type: req.file.mimetype,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/announcements
router.post('/', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const oId = resolveOrgId(req);
    const { title, content, type, priority, target_audience, pinned, expires_at, file_url, file_name, file_type } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'title and content required' });
    // BUG_088: enforce field length limits at API level
    if (title.trim().length > 100) return res.status(400).json({ error: 'Title must be 100 characters or fewer.' });
    if (!/[a-zA-Z]/.test(title.trim())) return res.status(400).json({ error: 'Title must contain at least one letter.' });
    if (content.trim().length > 2000) return res.status(400).json({ error: 'Content must be 2000 characters or fewer.' });

    // BUG_090: Duplicate check — same title by same creator within last 24 hours
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await db.from('announcements')
      .select('id').eq('organization_id', oId).eq('created_by', req.user.id)
      .eq('title', title.trim()).gte('created_at', since24h).limit(1);
    if (existing && existing.length > 0)
      return res.status(409).json({ error: 'An announcement with this title was already posted recently.' });

    // BUG_085: map 'admins' (old frontend value) to 'hr' to satisfy DB CHECK constraint
    const safeAudience = (target_audience === 'admins') ? 'hr' : (target_audience || 'all');

    const payload = {
      title: title.trim(), content,
      type: type || 'general',
      priority: priority || 'normal',
      target_audience: safeAudience,
      pinned: !!pinned,
      expires_at: expires_at || null,
      created_by: req.user.id,
      organization_id: oId,
    };
    if (file_url !== undefined) payload.file_url = file_url;
    if (file_name !== undefined) payload.file_name = file_name;
    if (file_type !== undefined) payload.file_type = file_type;

    const { data, error } = await db.from('announcements')
      .insert(payload)
      .select().single();
    if (error) throw error;

    const { data: users } = await db.from('users').select('id, email, name, role').eq('organization_id', oId);
    if (users?.length) {
      // In-app notifications — all org users regardless of target_audience
      await db.from('notifications').insert(users.map(u => ({
        user_id:         u.id,
        title:           `📢 ${title}`,
        message:         content.length > 100 ? content.substring(0, 100) + '…' : content,
        type:            'announcement',
        reference_id:    data.id,
        reference_type:  'announcement',
        organization_id: oId,
      })));

      // Email — respect target_audience; fire-and-forget (don't block response)
      const audience = target_audience || 'all';
      const emailRecipients = users.filter(u => {
        if (!u.email) return false;
        if (audience === 'employees') return u.role === 'employee';
        if (audience === 'admins')    return u.role === 'admin' || u.role === 'root_admin';
        return true; // 'all'
      });

      const { orgName, orgEmail } = await getOrgContext(oId);
      const annWithCreator = { ...data, creator_name: req.user.name || 'HR' };

      emailRecipients.forEach(u => {
        sendMail({
          to:      u.email,
          subject: `📢 ${title} — ${orgName}`,
          html:    announcementHtml(annWithCreator, orgName, orgEmail),
        }).catch(() => {});
      });
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/announcements/:id
router.put('/:id', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });

    // Ownership check: non-root-admins can only edit announcements they created.
    // Root Admin can edit any announcement in their own org.
    // Legacy announcements (created_by = NULL) are root-admin-only.
    if (req.user.role !== 'root_admin') {
      const { data: existing } = await db.from('announcements')
        .select('id, created_by')
        .eq('id', req.params.id)
        .eq('organization_id', req.user.organization_id)
        .maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Announcement not found' });
      if (existing.created_by === null || existing.created_by !== req.user.id) {
        return res.status(403).json({ error: 'You can only edit announcements you created' });
      }
    }

    const { title, content, type, priority, target_audience, pinned, expires_at, file_url, file_name, file_type } = req.body;

    const payload = { title, content, type, priority, target_audience, pinned: !!pinned, expires_at: expires_at || null };
    if (file_url !== undefined) payload.file_url = file_url;
    if (file_name !== undefined) payload.file_name = file_name;
    if (file_type !== undefined) payload.file_type = file_type;

    // Always scope by the caller's org — root_admin of Org A must not mutate Org B announcements.
    const { data, error } = await db.from('announcements')
      .update(payload)
      .eq('id', req.params.id)
      .eq('organization_id', req.user.organization_id)
      .select().single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Announcement not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/announcements/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });

    // Fetch the announcement first to get title, org, file info and creator.
    // Always scope by the caller's org — root_admin of Org A must not delete Org B announcements.
    const { data: ann } = await db.from('announcements')
      .select('id, title, file_url, organization_id, created_by')
      .eq('id', req.params.id)
      .eq('organization_id', req.user.organization_id)
      .maybeSingle();
    if (!ann) return res.status(404).json({ error: 'Announcement not found' });

    // Ownership check: non-root-admins can only delete their own announcements.
    // Legacy NULL creator announcements are root-admin-only.
    if (req.user.role !== 'root_admin') {
      if (ann.created_by === null || ann.created_by !== req.user.id) {
        return res.status(403).json({ error: 'You can only delete announcements you created' });
      }
    }

    const oId = ann.organization_id;

    // Delete related notifications using reference_id (accurate) with title fallback
    // for legacy notifications created before reference_id was added.
    const notifDelete = db.from('notifications')
      .delete()
      .eq('organization_id', oId)
      .eq('type', 'announcement');
    // If reference_id exists in schema, use it; otherwise fall back to title match
    await notifDelete.eq('reference_id', ann.id)
      .then(() => {})
      .catch(() =>
        db.from('notifications')
          .delete()
          .eq('organization_id', oId)
          .eq('type', 'announcement')
          .eq('title', `📢 ${ann.title}`)
      );

    // Delete Cloudinary file if present
    if (ann.file_url) {
      try {
        // Extract public_id from Cloudinary URL
        const match = ann.file_url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^.]+)?$/);
        if (match) {
          const publicId = match[1];
          await cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
        }
      } catch { /* ignore Cloudinary errors — proceed with DB delete */ }
    }

    const { error } = await db.from('announcements').delete().eq('id', req.params.id).eq('organization_id', oId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EHN_ANN_003: Mark announcement as read ───────────────────────────────────
router.post('/:id/read', auth, async (req, res) => {
  try {
    const oId = req.user.organization_id;
    await db.from('announcement_reads').upsert({
      announcement_id: req.params.id, user_id: req.user.id, organization_id: oId, read_at: new Date().toISOString(),
    }, { onConflict: 'announcement_id,user_id' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── EHN_ANN_003: Get read stats for an announcement ──────────────────────────
router.get('/:id/reads', auth, async (req, res) => {
  try {
    if (!isAdmin(req.user.role)) return res.status(403).json({ error: 'Admin only' });
    const { data, error } = await db.from('announcement_reads').select('user_id, read_at').eq('announcement_id', req.params.id);
    if (error) throw error;
    res.json({ count: (data || []).length, readers: data || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
