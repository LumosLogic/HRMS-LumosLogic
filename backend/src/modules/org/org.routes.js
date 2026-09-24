const express    = require('express');
const router     = express.Router();
const { db }     = require('../../config/db');
const { auth }   = require('../../middleware/auth');
const { orgId }  = require('../../utils/helpers');
const { sendMail, orgRequestReceivedHtml } = require('../../services/emailService');
const { rateLimiter, LIMITS } = require('../../middleware/rateLimiter');
const upload     = require('../../middleware/upload');
const cloudinary = require('../../config/cloudinary');

// GST format: 2-digit state code + 10-char PAN + entity digit + 'Z' + check char (15 chars total)
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const PERSONAL_DOMAINS = new Set([
  'gmail.com','yahoo.com','yahoo.co.in','hotmail.com','outlook.com',
  'live.com','msn.com','aol.com','icloud.com','me.com','mac.com',
  'protonmail.com','proton.me','ymail.com','rediffmail.com',
  'zoho.com','tutanota.com','gmx.com','gmx.net',
]);
const HTML_RE  = /<|>/;
const PHONE_RE = /^[+]?[\d\s()\-.]{6,20}$/;

// ─── Organization Registration (creates pending request, not live org) ────────
router.post('/register-org', rateLimiter(LIMITS.ORG_REGISTER), async (req, res) => {
  try {
    const { company_name, name, email, phone, website, message, gst_number, company_size, industry, has_multiple_branches } = req.body;
    if (!company_name || !name || !email)
      return res.status(400).json({ error: 'Company name, your name, and email are required' });

    const norm        = email.toLowerCase().trim();
    const companyTrim = company_name.trim();
    const nameTrim    = name.trim();
    const phoneTrim   = phone ? phone.trim() : null;

    // ── 0. Input validation ──────────────────────────────────────────────────
    if (companyTrim.length < 2 || companyTrim.length > 255)
      return res.status(400).json({ error: 'Company name must be between 2 and 255 characters.' });
    if (!/[a-zA-Z]/.test(companyTrim))
      return res.status(400).json({ error: 'Company name must contain at least one letter.' });
    if (/[<>;`\\\-]|<script>|drop\s+table/i.test(companyTrim))
      return res.status(400).json({ error: 'Company name contains invalid or unsafe characters.' });

    if (nameTrim.length < 2 || nameTrim.length > 100)
      return res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
    if (/[^a-zA-Z\s'-]/.test(nameTrim))
      return res.status(400).json({ error: 'Full name can only contain alphabetic characters, spaces, hyphens, and apostrophes.' });

    if (norm.length > 254)
      return res.status(400).json({ error: 'Email cannot exceed 254 characters.' });
    const emailDomain = norm.split('@')[1] || '';
    if (PERSONAL_DOMAINS.has(emailDomain))
      return res.status(400).json({ error: 'Please use a company/work email. Personal addresses (Gmail, Yahoo, Outlook, etc.) are not accepted.' });

    if (phoneTrim) {
      if (!/^\d{10}$/.test(phoneTrim))
        return res.status(400).json({ error: 'Phone Number must contain exactly 10 digits.' });
      if (!/^[6-9]/.test(phoneTrim))
        return res.status(400).json({ error: 'Enter a valid Indian mobile number.' });
    }

    // ── 1. Validate GST format if provided ───────────────────────────────────
    const gstNorm = gst_number ? gst_number.trim().toUpperCase() : null;
    if (gstNorm && !GST_REGEX.test(gstNorm))
      return res.status(400).json({ error: 'Invalid GST number format. Expected format: 22AAAAA0000A1Z5' });

    // ── 2. Block duplicate contact email ─────────────────────────────────────
    const { data: dupEmail } = await db.from('org_registration_requests')
      .select('id').eq('email', norm).in('status', ['pending', 'approved']).maybeSingle();
    if (dupEmail) return res.status(400).json({ error: 'A registration request with this email is already pending or approved.' });

    // ── 3. Block duplicate company name (case-insensitive) across requests ───
    const { data: dupName } = await db.from('org_registration_requests')
      .select('id').ilike('company_name', companyTrim).in('status', ['pending', 'approved']).maybeSingle();
    if (dupName) return res.status(400).json({ error: 'This organization is already registered or has a pending request. Please contact support if you believe this is incorrect.' });

    // ── 4. Block duplicate company name against live organizations ───────────
    const { data: existingOrg } = await db.from('organizations')
      .select('id').ilike('name', companyTrim).maybeSingle();
    if (existingOrg) return res.status(400).json({ error: 'This organization is already registered. Please contact support if you believe this is incorrect.' });

    // ── 5. Block if admin email already has a user account ───────────────────
    const { data: existingUser } = await db.from('users').select('id').eq('email', norm).maybeSingle();
    if (existingUser) return res.status(400).json({ error: 'An account with this email already exists on the platform.' });

    // ── 6. Unique GST check across pending/approved requests ─────────────────
    if (gstNorm) {
      const { data: dupGst } = await db.from('org_registration_requests')
        .select('id').eq('gst_number', gstNorm).in('status', ['pending', 'approved']).maybeSingle();
      if (dupGst) return res.status(400).json({ error: 'A registration request with this GST number already exists.' });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;

    const { data: request, error: reqErr } = await db.from('org_registration_requests')
      .insert({
        company_name:          companyTrim, contact_name: nameTrim, email: norm,
        phone:                 phoneTrim    || null,
        website:               website      || null,
        message:               message      || null,
        gst_number:            gstNorm      || null,
        company_size:          company_size || null,
        industry:              industry     || null,
        ip_address:            ip,
        has_multiple_branches: has_multiple_branches === true || has_multiple_branches === 'true',
      })
      .select().single();
    if (reqErr) throw new Error(reqErr.message);

    // Log activity
    await db.from('platform_activity').insert({
      event_type: 'org_request_submitted',
      description: `New registration request from ${nameTrim} (${companyTrim})`,
      metadata: { request_id: request.id, email: norm, company: company_name.trim() },
    });

    // Notify platform admin via email (using LumosLogic SMTP)
    const platformAdminEmail = process.env.PLATFORM_ADMIN_EMAIL || process.env.SMTP_USER;
    if (platformAdminEmail) {
      sendMail({ to: platformAdminEmail, subject: `[HRMS] New Org Request: ${companyTrim}`, html: orgRequestReceivedHtml(request) });
    }

    res.json({ success: true, message: 'Your registration request has been submitted. Our team will review and email you within 24 hours.', request_id: request.id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Organization Settings: GET ───────────────────────────────────────────────
router.get('/org/settings', auth, async (req, res) => {
  try {
    let targetOrgId = orgId(req);
    if (req.user.role === 'root_admin' && req.query.org_id) {
      targetOrgId = Number(req.query.org_id);
    }
    const { data, error } = await db.from('organizations')
      .select('id, name, slug, domain, logo_url, google_client_id, google_calendar_id, vapid_public_key, total_annual_leaves, plan, status, created_at')
      .eq('id', targetOrgId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Organization not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Organization Settings: PUT ───────────────────────────────────────────────
router.put('/org/settings', auth, async (req, res) => {
  try {
    if (req.user.role !== 'root_admin') return res.status(403).json({ error: 'Root admin access required' });
    const {
      org_id,
      name, domain, logo_url,
      google_client_id, google_client_secret, google_refresh_token, google_calendar_id,
      vapid_public_key, vapid_private_key,
      total_annual_leaves,
    } = req.body;

    const targetOrgId = org_id ? Number(org_id) : orgId(req);

    const update = {};
    if (name)               update.name = name.trim();
    if (domain !== undefined) update.domain = domain;
    if (logo_url !== undefined) update.logo_url = logo_url;
    if (google_client_id !== undefined) update.google_client_id = google_client_id;
    if (google_client_secret && google_client_secret.trim() !== '') update.google_client_secret = google_client_secret.trim();
    if (google_refresh_token && google_refresh_token.trim() !== '') update.google_refresh_token = google_refresh_token.trim();
    if (google_calendar_id !== undefined) update.google_calendar_id = google_calendar_id;
    if (vapid_public_key !== undefined) update.vapid_public_key = vapid_public_key;
    if (vapid_private_key && vapid_private_key.trim() !== '') update.vapid_private_key = vapid_private_key.trim();
    if (total_annual_leaves) update.total_annual_leaves = parseInt(total_annual_leaves) || 18;

    if (Object.keys(update).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const { data, error } = await db.from('organizations')
      .update(update).eq('id', targetOrgId)
      .select('id, name, slug, domain, logo_url, google_client_id, google_calendar_id, vapid_public_key, total_annual_leaves, plan, status').single();
    if (error) throw new Error(error.message);

    // BUG_147: sync annual leave policy quota when total_annual_leaves changes
    if (update.total_annual_leaves) {
      await db.from('leave_policies')
        .update({ annual_quota: update.total_annual_leaves })
        .eq('organization_id', targetOrgId)
        .eq('leave_type', 'annual')
        .eq('active', true);
    }

    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /org/logo — upload org logo to Cloudinary, save URL ─────────────────
router.post('/org/logo', auth, upload.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'root_admin') return res.status(403).json({ error: 'Root admin access required' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const targetOrgId = orgId(req);
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `hrms/${targetOrgId}/org`, resource_type: 'image', transformation: [{ width: 400, crop: 'limit' }] },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });
    const { data, error } = await db.from('organizations')
      .update({ logo_url: result.secure_url }).eq('id', targetOrgId)
      .select('id, logo_url').single();
    if (error) throw new Error(error.message);
    res.json({ logo_url: data.logo_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Organization HR Contact ──────────────────────────────────────────────────
router.get('/org/hr-contact', auth, async (req, res) => {
  try {
    const { data } = await db.from('users')
      .select('email, name')
      .eq('organization_id', orgId(req))
      .eq('role', 'admin')
      .order('created_at')
      .limit(1)
      .maybeSingle();
    res.json(data ? { email: data.email, name: data.name } : { email: null, name: null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Org Feature Flags (for client app) ──────────────────────────────────────
// Returns a key→boolean map. Missing biometric features default off (on by plan).
const BIOMETRIC_FEATURE_KEYS = ['biometric', 'branches', 'statutory'];
router.get('/features', auth, async (req, res) => {
  try {
    const oId = orgId(req);
    const [{ data: orgRow }, { data: featureRows }] = await Promise.all([
      db.from('organizations').select('plan').eq('id', oId).maybeSingle(),
      db.from('organization_features').select('feature_key, enabled').eq('organization_id', oId),
    ]);
    const plan = (orgRow?.plan || 'free').toLowerCase();
    const flags = {};
    for (const row of featureRows || []) flags[row.feature_key] = row.enabled;
    // For keys with no explicit DB row, biometric features = off unless Platinum
    for (const key of BIOMETRIC_FEATURE_KEYS) {
      if (!(key in flags)) flags[key] = plan === 'platinum';
    }
    res.json(flags);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
