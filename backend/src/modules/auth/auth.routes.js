const express   = require('express');
const router    = express.Router();
const { sameId } = require('../../utils/ids');
const bcrypt    = require('bcryptjs');
const { passwordPolicyError } = require('../../utils/passwordPolicy');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const multer    = require('multer');
const cloudinary = require('cloudinary').v2;
const { authenticator } = require('otplib');
const qrcode = require('qrcode');
const { db } = require('../../config/db');
const { JWT_SECRET, auth, clearRoleChanged, revokeSessions, revokeSessionsQuiet } = require('../../middleware/auth');
const { orgId, getRecipients } = require('../../utils/helpers');
const { sendMail, passwordResetHtml } = require('../../services/emailService');
const { rateLimiter, LIMITS } = require('../../middleware/rateLimiter');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Auth: Login ──────────────────────────────────────────────────────────────
// Email is globally unique across the platform — no org slug needed.
router.post('/login', rateLimiter(LIMITS.LOGIN), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: user } = await db.from('users')
      .select('*, organizations(id, name, slug, logo_url)')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown';
    const userAgent = req.headers['user-agent'] || '';

    // Separate checks so we can record failed attempts for known accounts
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!bcrypt.compareSync(password, user.password)) {
      // BUG_115: Record failed login attempt (fire and forget, same response either way)
      db.from('login_history').insert({ user_id: user.id, organization_id: user.organization_id, ip_address: clientIp, user_agent: userAgent, status: 'failed' }).then(() => {});
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Block deactivated accounts — status check must happen AFTER password verify
    // to avoid leaking whether the email exists (timing attack surface).
    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact HR to restore access.' });
    }
    // Block terminated/inactive employees.
    const blockedEmployeeStatuses = ['inactive', 'terminated'];
    if (blockedEmployeeStatuses.includes(user.employee_status)) {
      const msg = user.employee_status === 'terminated'
        ? 'Your access has been revoked. Please contact HR for assistance.'
        : 'Your account is inactive. Please contact HR to restore access.';
      return res.status(403).json({ error: msg });
    }
    // BUG_219: block resigned employees whose last working day has passed
    if (user.employee_status === 'resigned') {
      const today = new Date().toISOString().split('T')[0];
      const { data: exitReq } = await db.from('exit_requests')
        .select('last_working_day').eq('user_id', user.id).in('status', ['approved', 'completed'])
        .order('created_at', { ascending: false }).limit(1);
      const lwd = exitReq?.[0]?.last_working_day;
      if (lwd && lwd < today) {
        db.from('users').update({ employee_status: 'inactive', status: 'inactive' }).eq('id', user.id).then(() => {});
        return res.status(403).json({ error: 'Your notice period has ended. System access has been revoked. Please contact HR for assistance.' });
      }
    }

    // Record successful login (fire and forget)
    db.from('users').update({ last_login_at: new Date().toISOString(), last_login_ip: clientIp, last_login_ua: userAgent }).eq('id', user.id).then(() => {});
    db.from('login_history').insert({ user_id: user.id, organization_id: user.organization_id, ip_address: clientIp, user_agent: userAgent, status: 'success' }).then(() => {});

    // If TOTP is enabled, return a short-lived totp-pending session
    if (user.totp_enabled) {
      const totpSession = jwt.sign({ user_id: user.id, purpose: 'totp-pending' }, JWT_SECRET, { expiresIn: '5m' });
      return res.json({ requires2FA: true, totp_session: totpSession });
    }

    // Tenant isolation: the token's organisation is the user's OWN organisation. There is no default tenant —
    // a user not linked to an organisation cannot sign in (it used to be silently placed in organisation 1).
    if (user.organization_id === null || user.organization_id === undefined) {
      return res.status(403).json({
        error: 'Your account is not linked to an organisation. Please contact your administrator.',
        code: 'NO_ORGANIZATION',
      });
    }

    // BUG_217: clear role-change flag before issuing token so stale session is gone
    clearRoleChanged(user.id);
    const org = user.organizations || {};
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, organization_id: user.organization_id, organization_slug: org.slug || '' },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        department: user.department, position: user.position, avatar_color: user.avatar_color,
        avatar_url: user.avatar_url || '', email_verified: user.email_verified || false,
        employee_id: user.employee_id || null, totp_enabled: user.totp_enabled || false,
        last_login_at: user.last_login_at || null,
        force_password_change: user.force_password_change || false,
        organization_id: user.organization_id,
        organization_name: org.name || '',
        organization_slug: org.slug || '',
        organization_logo: org.logo_url || '',
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Get Current User ───────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  try {
    const { data, error } = await db.from('users')
      .select('id, name, email, role, department, position, avatar_color, avatar_url, email_verified, employee_id, totp_enabled, last_login_at, password_changed_at, created_at, employee_status')
      .eq('id', req.user.id).single();
    if (error) {
      const { data: fallback } = await db.from('users')
        .select('id, name, email, role, department, position, avatar_color, email_verified, employee_id, totp_enabled, last_login_at, password_changed_at, created_at, employee_status')
        .eq('id', req.user.id).single();
      if (!fallback) return res.status(401).json({ error: 'Account not found' });
      // BUG_181: block inactive/resigned/terminated employees
      if (fallback.role === 'employee' && ['inactive', 'terminated'].includes(fallback.employee_status)) {
        return res.status(401).json({ error: 'Your account has been deactivated. Please contact HR.' });
      }
      return res.json(fallback);
    }
    // BUG_181: block inactive/resigned/terminated employees
    if (data.role === 'employee' && ['inactive', 'terminated'].includes(data.employee_status)) {
      return res.status(401).json({ error: 'Your account has been deactivated. Please contact HR.' });
    }
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Update Profile ─────────────────────────────────────────────────────
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, avatar_color, email, avatar_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const update = { name, avatar_color };
    // Only include avatar_url in the update when it's a real Cloudinary URL.
    // An empty string from the frontend (user has no photo) must not be written —
    // it would fail if the column doesn't exist yet on older deployments.
    if (avatar_url && typeof avatar_url === 'string' && avatar_url.startsWith('http')) {
      update.avatar_url = avatar_url;
    }
    if (email) {
      const norm = email.toLowerCase().trim();
      const { data: dup } = await db.from('users').select('id').eq('email', norm).maybeSingle();
      if (dup && !sameId(dup.id, req.user.id)) return res.status(400).json({ error: 'Email already in use by another account' });
      update.email = norm;
    }
    // SELECT without avatar_url so it works even before the migration column is added.
    // The upload-avatar endpoint handles avatar_url separately once the column exists.
    const { data, error } = await db.from('users')
      .update(update)
      .eq('id', req.user.id)
      .select('id, name, email, role, department, position, avatar_color').single();
    if (error) throw new Error(error.message);
    // Merge avatar_url from the request back into the response so the frontend
    // AuthContext stays in sync without requiring the DB column to be present yet.
    res.json({ ...data, avatar_url: avatar_url || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Upload Avatar Photo ────────────────────────────────────────────────
router.post('/upload-avatar', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: `hrms/${req.user.organization_id}/avatars`, resource_type: 'image', transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }] },
        (err, r) => err ? reject(err) : resolve(r)
      ).end(req.file.buffer);
    });
    await db.from('users').update({ avatar_url: result.secure_url, profile_photo_url: result.secure_url }).eq('id', req.user.id);
    res.json({ avatar_url: result.secure_url, profile_photo_url: result.secure_url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Remove Avatar Photo (BUG_110) ─────────────────────
router.delete("/remove-avatar", auth, async (req, res) => {
  try {
    await db.from("users").update({ avatar_url: null, profile_photo_url: null }).eq("id", req.user.id);
    res.json({ success: true, avatar_url: null, profile_photo_url: null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Change Password ────────────────────────────────────────────────────
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
    const policyError = passwordPolicyError(newPassword);
    if (policyError) return res.status(400).json({ error: policyError });

    const { data: user } = await db.from('users')
      .select('password, password_history').eq('id', req.user.id).single();

    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.status(400).json({ error: 'Current password is incorrect' });

    // BUG_040: Prevent using the same current password as the new password
    if (bcrypt.compareSync(newPassword, user.password))
      return res.status(400).json({ error: 'New password must be different from your current password.' });

    // Check last 5 passwords for reuse
    const history = Array.isArray(user.password_history) ? user.password_history : [];
    const isReused = history.some(h => bcrypt.compareSync(newPassword, h));
    if (isReused) return res.status(400).json({ error: 'Cannot reuse one of your last 5 passwords' });

    const newHash = bcrypt.hashSync(newPassword, 10);
    const newHistory = [user.password, ...history].slice(0, 5);

    const { error: pwErr } = await db.from('users').update({
      password: newHash,
      force_password_change: false,
      password_changed_at: new Date().toISOString(),
      password_history: JSON.stringify(newHistory),
    }).eq('id', req.user.id);
    if (pwErr) throw new Error(pwErr.message);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Forgot Password ────────────────────────────────────────────────────
// Email is globally unique — no org slug required.
router.post('/forgot-password', rateLimiter(LIMITS.FORGOT_PASSWORD), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const { data: user } = await db.from('users')
      .select('id, name, email, organization_id, organizations(name)')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    // Always respond with success to prevent email enumeration
    if (!user) return res.json({ success: true });

    const token   = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await db.from('users').update({
      password_reset_token:   token,
      password_reset_expires: expires,
    }).eq('id', user.id);

    const baseUrl   = process.env.FRONTEND_URL || 'https://hrms.lumoslogic.com';
    const resetLink = `${baseUrl}/reset-password?token=${token}`;
    const orgName  = user.organizations?.name || '';
    const orgEmail = user.email; // reset email context; HR contact fetched async below
    // Fetch HR email for footer (fire-and-forget style — use orgEmail as fallback)
    const { orgEmail: hrEmail } = user.organization_id != null
      ? await require('../../utils/helpers').getOrgContext(user.organization_id).catch(() => ({ orgEmail: '' }))
      : { orgEmail: '' };

    sendMail({
      to:      user.email,
      subject: `${orgName || 'HR'} — Reset Your Password`,
      html:    passwordResetHtml(user, resetLink, orgName, hrEmail),
    });

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Reset Password ─────────────────────────────────────────────────────
router.post('/reset-password', rateLimiter(LIMITS.RESET_PASSWORD), async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const { data: user } = await db.from('users')
      .select('id, password_reset_token, password_reset_expires')
      .eq('password_reset_token', token)
      .maybeSingle();

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    if (new Date(user.password_reset_expires) < new Date())
      return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });

    await db.from('users').update({
      password:               bcrypt.hashSync(password, 10),
      password_reset_token:   null,
      password_reset_expires: null,
      force_password_change:  false,
    }).eq('id', user.id);
    await revokeSessionsQuiet(user.id);

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Send Email Verification Code ──────────────────────────────────────
router.post('/send-verification', auth, rateLimiter(LIMITS.SEND_VERIFICATION), async (req, res) => {
  try {
    const code    = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30-minute expiry
    await db.from('users').update({
      email_verify_code:         code,
      email_verify_code_expires: expires,
    }).eq('id', req.user.id);
    sendMail({
      to:      req.user.email,
      subject: 'Email Verification Code — Lumens HR Tracker',
      html:    `<p>Your email verification code is: <strong>${code}</strong></p><p>This code expires in 30 minutes.</p>`,
    });
    res.json({ success: true, message: 'Verification code sent to email' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Verify Email ───────────────────────────────────────────────────────
router.post('/verify-email', auth, async (req, res) => {
  try {
    const { code } = req.body;
    const { data: user } = await db.from('users')
      .select('email_verify_code, email_verify_code_expires')
      .eq('id', req.user.id).single();
    if (!code || user?.email_verify_code !== code) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }
    // HIGH-13: Reject expired codes
    if (user.email_verify_code_expires && new Date(user.email_verify_code_expires) < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }
    await db.from('users').update({
      email_verified:            true,
      email_verify_code:         null,
      email_verify_code_expires: null,
    }).eq('id', req.user.id);
    res.json({ success: true, message: 'Email verified successfully!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Deactivate Account ─────────────────────────────────────────────────
router.post('/deactivate', auth, async (req, res) => {
  try {
    // root_admin cannot self-deactivate
    if (req.user.role === 'root_admin') {
      return res.status(400).json({ error: 'Root admins cannot self-deactivate. Contact the platform administrator.' });
    }

    // HR admin: block if they are the only active admin in the org
    if (req.user.role === 'admin') {
      const { data: otherAdmins } = await db.from('users')
        .select('id')
        .eq('organization_id', req.user.organization_id)
        .in('role', ['admin', 'root_admin'])
        .neq('id', req.user.id);

      const activeOthers = (otherAdmins || []).filter(u => u.status !== 'inactive');
      if (activeOthers.length === 0) {
        return res.status(400).json({
          error: 'Cannot deactivate: you are the only active HR admin in your organization. Add another HR admin first, then deactivate your account.',
        });
      }
    }

    await db.from('users').update({ status: 'inactive' }).eq('id', req.user.id);
    res.json({ success: true, message: 'Account deactivated successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Auth: Request Account Deletion (GDPR) ───────────────────────────────────
router.post('/request-deletion', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const recipients = await getRecipients(orgId(req));
    sendMail({
      to: recipients,
      subject: `GDPR Account Deletion Request — ${req.user.name}`,
      html: `<p>Employee <strong>${req.user.name}</strong> (${req.user.email}) has requested account deletion.</p><p>Reason: ${reason || 'None provided'}</p>`
    });
    res.json({ success: true, message: 'Account deletion request submitted to HR' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 2FA: Setup (generate QR + secret) ──────────────────────────────────────
router.post('/totp/setup', auth, async (req, res) => {
  try {
    const { data: user } = await db.from('users').select('email, totp_enabled').eq('id', req.user.id).single();
    if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(user.email, 'Lumos Logic HRMS', secret);
    const qrDataUrl = await qrcode.toDataURL(otpauthUrl);
    // Store secret temporarily (not yet enabled)
    await db.from('users').update({ totp_secret: secret }).eq('id', req.user.id);
    res.json({ secret, qrDataUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 2FA: Enable (verify code + activate) ────────────────────────────────────
router.post('/totp/enable', auth, async (req, res) => {
  try {
    const { token: totpToken } = req.body;
    if (!totpToken) return res.status(400).json({ error: 'TOTP code required' });
    const { data: user } = await db.from('users').select('totp_secret').eq('id', req.user.id).single();
    if (!user.totp_secret) return res.status(400).json({ error: 'Run /totp/setup first' });
    if (!authenticator.check(totpToken, user.totp_secret))
      return res.status(400).json({ error: 'Invalid code. Please try again.' });
    await db.from('users').update({ totp_enabled: true }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 2FA: Disable ────────────────────────────────────────────────────────────
router.post('/totp/disable', auth, async (req, res) => {
  try {
    const { password: currentPassword } = req.body;
    if (!currentPassword) return res.status(400).json({ error: 'Password required to disable 2FA' });
    const { data: user } = await db.from('users').select('password').eq('id', req.user.id).single();
    if (!bcrypt.compareSync(currentPassword, user.password))
      return res.status(400).json({ error: 'Incorrect password' });
    await db.from('users').update({ totp_enabled: false, totp_secret: null }).eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── 2FA: Verify login step ───────────────────────────────────────────────────
router.post('/totp/verify-login', rateLimiter(LIMITS.TOTP_VERIFY), async (req, res) => {
  try {
    const { totp_session, token: totpToken } = req.body;
    if (!totp_session || !totpToken) return res.status(400).json({ error: 'Missing parameters' });
    let decoded;
    try { decoded = jwt.verify(totp_session, JWT_SECRET); }
    catch { return res.status(401).json({ error: 'TOTP session expired. Please login again.' }); }
    if (decoded.purpose !== 'totp-pending') return res.status(401).json({ error: 'Invalid session' });

    const { data: user } = await db.from('users')
      .select('*, organizations(id, name, slug, logo_url)')
      .eq('id', decoded.user_id).maybeSingle();
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (!authenticator.check(totpToken, user.totp_secret))
      return res.status(400).json({ error: 'Invalid authenticator code' });

    if (user.organization_id === null || user.organization_id === undefined) {
      return res.status(403).json({
        error: 'Your account is not linked to an organisation. Please contact your administrator.',
        code: 'NO_ORGANIZATION',
      });
    }

    // BUG_217: clear role-change flag before issuing token (TOTP path)
    clearRoleChanged(user.id);
    const org = user.organizations || {};
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, organization_id: user.organization_id, organization_slug: org.slug || '' },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        department: user.department, position: user.position, avatar_color: user.avatar_color,
        avatar_url: user.avatar_url || '', email_verified: user.email_verified || false,
        employee_id: user.employee_id || null, totp_enabled: true,
        force_password_change: user.force_password_change || false,
        organization_id: user.organization_id,
        organization_name: org.name || '',
        organization_slug: org.slug || '',
        organization_logo: org.logo_url || '',
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Login History (EHN_PROF_006: increased limit for pagination) ─────────────
router.get('/login-history', auth, async (req, res) => {
  try {
    const { data } = await db.from('login_history')
      .select('id, ip_address, user_agent, status, logged_in_at')
      .eq('user_id', req.user.id)
      .order('logged_in_at', { ascending: false })
      .limit(100);
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Sign out of all other devices/sessions (EHN_PROF_005) ───────────────────
router.post('/logout-all-devices', auth, async (req, res) => {
  try {
    // Record this action in login history as a logout event
    try {
      await db.from('login_history').insert({
        user_id: req.user.id, organization_id: req.user.organization_id,
        ip_address: req.ip, user_agent: req.headers['user-agent'] || '',
        status: 'logout_all',
      });
    } catch { /* history is best-effort; the db wrapper's builder has no .catch (API-01 root cause) */ }
    // Kill every token issued before now, then hand this device a fresh one so it stays signed in.
    await revokeSessions(req.user.id);
    const token = jwt.sign(
      { id: req.user.id, email: req.user.email, role: req.user.role, name: req.user.name, organization_id: req.user.organization_id, organization_slug: req.user.organization_slug || '' },
      JWT_SECRET, { expiresIn: '7d' }
    );
    res.json({ ok: true, token, message: 'All other sessions have been invalidated.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Download My Data (GDPR) ──────────────────────────────────────────────────
router.get('/download-data', auth, async (req, res) => {
  try {
    const { data: user } = await db.from('users')
      .select('id, name, email, role, department, position, avatar_color, employee_id, created_at, last_login_at, email_verified')
      .eq('id', req.user.id).single();
    const { data: leaves } = await db.from('leaves').select('*').eq('user_id', req.user.id);
    const { data: attendance } = await db.from('attendance').select('date, check_in, check_out, status, work_hours').eq('user_id', req.user.id).limit(365);
    const { data: history } = await db.from('login_history').select('ip_address, user_agent, logged_in_at, status').eq('user_id', req.user.id).limit(50);

    const exportData = {
      exported_at: new Date().toISOString(),
      profile: user,
      leaves: leaves || [],
      attendance: attendance || [],
      login_history: history || [],
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="my-data-${user.name?.replace(/\s/g, '_')}-${Date.now()}.json"`);
    res.json(exportData);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
