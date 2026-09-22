import React, { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import {
  UserCircle, Lock, Save, Eye, EyeOff, Check, Building2, Briefcase, Mail,
  ShieldCheck, ShieldAlert, Trash2, AlertTriangle, Upload, User, Camera,
  Calendar, Shield, Hash, Clock,
  Smartphone, Monitor, Globe, Download, Key, RefreshCw, History, Copy, QrCode, X,
} from 'lucide-react';
import { apiPut, apiGet, apiPost, apiDelete } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Modal } from '@/components/ui/Modal';
import { initials } from '@/lib/utils';

const AVATAR_COLORS = [
  '#3525cd','#4f46e5','#712ae2','#8a4cfc','#10B981','#EC4899',
  '#F59E0B','#EF4444','#F97316','#2a313d','#065F46','#7F1D1D',
  '#0284c7','#0d9488','#7c3aed','#db2777','#b45309','#1d4ed8','#047857','#9f1239',
];

// ── Password strength scorer ──────────────────────────────────────────────────
function getPasswordStrength(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8)  score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors  = ['#ef4444',  '#f97316', '#eab308', '#22c55e', '#10b981'];
  return { score, label: labels[score] || 'Very Weak', color: colors[score] || '#ef4444', pct: Math.round((score / 5) * 100) };
}

function StrengthBar({ password }) {
  const s = getPasswordStrength(password);
  if (!s) return null;
  return (
    <div className="mt-1.5 space-y-1">
      <div className="h-1.5 bg-[#f0f3ff] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${s.pct}%`, background: s.color }} />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-[0.65rem] font-semibold" style={{ color: s.color }}>{s.label}</p>
        <p className="text-[0.6rem] text-[#9ca3af]">
          {[pw => pw.length >= 8, pw => /[A-Z]/.test(pw), pw => /[0-9]/.test(pw), pw => /[^A-Za-z0-9]/.test(pw)]
            .filter(f => !f(password)).length === 0 ? '✓ All requirements met' : 'Use 8+ chars, uppercase, number, symbol'}
        </p>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-[#f0f3ff] last:border-0">
      <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center shrink-0">
        <Icon size={13} className="text-[#3525cd]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[0.68rem] text-[#777587] font-medium">{label}</p>
        <p className="text-sm font-semibold text-[#151c27] truncate">{value || '—'}</p>
      </div>
    </div>
  );
}

// ── User-agent parsers ────────────────────────────────────────────────────────
function parseBrowser(ua) {
  if (!ua) return 'Unknown';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome/.test(ua)) return 'Chrome';
  if (/Firefox/.test(ua)) return 'Firefox';
  if (/Safari/.test(ua) && !/Chrome/.test(ua)) return 'Safari';
  if (/Mobile/.test(ua)) return 'Mobile';
  return 'Browser';
}
function parseDevice(ua) {
  if (!ua) return 'Unknown';
  if (/Mobile|Android|iPhone/.test(ua)) return 'Mobile';
  if (/Tablet|iPad/.test(ua)) return 'Tablet';
  return 'Desktop';
}

// ── Tab button ────────────────────────────────────────────────────────────────
function TabBtn({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-bold rounded-lg transition-colors ${
        active
          ? 'bg-[#3525cd] text-white shadow-sm'
          : 'text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd]'
      }`}
    >
      {label}
    </button>
  );
}

export default function MyProfile() {
  const { user, saveAuth, token } = useAuth();
  const toast      = useToast();
  const avatarRef  = useRef(null);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'security' | 'privacy'
  // EHN_PROF_006: Login history pagination
  const [historyPage, setHistoryPage] = useState(1);
  const HISTORY_PER_PAGE = 10;

  // ── Profile form state ────────────────────────────────────────────────────
  const [name,     setName]     = useState(user?.name  || '');
  const [email,    setEmail]    = useState(user?.email || '');
  const [color,    setColor]    = useState(user?.avatar_color || '#3525cd');
  const [photoUrl, setPhotoUrl] = useState(user?.avatar_url || '');
  const [uploading, setUploading] = useState(false);
  const [removingPhoto, setRemovingPhoto] = useState(false); // BUG_110

  // Unsaved changes tracking (ENH_PROFILE_006)
  const [savedName,     setSavedName]     = useState(user?.name || '');
  const [savedEmail,    setSavedEmail]    = useState(user?.email || '');
  const [savedColor,    setSavedColor]    = useState(user?.avatar_color || '#3525cd');
  const [savedPhotoUrl, setSavedPhotoUrl] = useState(user?.avatar_url || '');
  const profileIsDirty = name !== savedName || email !== savedEmail || color !== savedColor;

  // ── Password state ────────────────────────────────────────────────────────
  const [curPw,    setCurPw]   = useState('');
  const [newPw,    setNewPw]   = useState('');
  const [confPw,   setConfPw]  = useState('');
  const [showCur,  setShowCur] = useState(false);
  const [showNew,  setShowNew] = useState(false);
  const [showConf, setShowConf] = useState(false);

  // ── Email verification state ──────────────────────────────────────────────
  const [verifyModal, setVerifyModal] = useState(false);
  const [verifyCode,  setVerifyCode]  = useState('');

  // ── GDPR / account controls ───────────────────────────────────────────────
  const [delModal,  setDelModal]  = useState(false);
  const [delReason, setDelReason] = useState('');

  // ── 2FA state ─────────────────────────────────────────────────────────────
  const [totpSetup,       setTotpSetup]       = useState(null); // { secret, qrDataUrl }
  const [totpCode,        setTotpCode]        = useState('');
  const [disable2FAModal, setDisable2FAModal] = useState(false);
  const [disable2FAPw,    setDisable2FAPw]    = useState('');

  // ── Download state ────────────────────────────────────────────────────────
  const [downloadingData, setDownloadingData] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: myDepts = [] } = useQuery({
    queryKey: ['my-departments', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const all = await apiGet('/employees');
      const me  = all.find(e => e.id === user.id);
      return me?.departments || [];
    },
    enabled: !!user?.id,
  });

  const { data: meData, refetch: refetchMe } = useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet('/auth/me'),
    initialData: user,
  });

  const { data: loginHistory = [] } = useQuery({
    queryKey: ['login-history'],
    queryFn: () => apiGet('/auth/login-history'),
    staleTime: 60_000,
  });

  // ── Derived state ─────────────────────────────────────────────────────────
  const isDirty = name !== savedName || email !== savedEmail || color !== savedColor || photoUrl !== savedPhotoUrl;

  // ENH_PROFILE_006: Warn before leaving page with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
  // BUG_036: Name must contain at least one alphabetic character
  const nameValid = name.trim().length >= 2 && name.trim().length <= 60 && /[a-zA-Z]/.test(name);

  // ── Avatar photo upload ───────────────────────────────────────────────────
  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Max file size is 5 MB', 'error'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token_ = localStorage.getItem('lt_token');
      if (!token_) { toast('You are not logged in. Please log in again.', 'error'); setUploading(false); return; }
      const res  = await fetch('/api/auth/upload-avatar', { method: 'POST', headers: { Authorization: `Bearer ${token_}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setPhotoUrl(data.avatar_url);
      saveAuth(token, { ...user, avatar_url: data.avatar_url });
      toast('Profile photo updated!', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setUploading(false); if (avatarRef.current) avatarRef.current.value = ''; }
  }


  // ── BUG_110: Remove profile photo ─────────────────────────────────────────
  async function handleRemovePhoto() {
    setRemovingPhoto(true);
    try {
      await apiDelete('/auth/remove-avatar');
      setPhotoUrl('');
      saveAuth(token, { ...user, avatar_url: '' });
      toast('Profile photo removed.', 'success');
    } catch (err) { toast(err.message || 'Failed to remove photo', 'error'); }
    finally { setRemovingPhoto(false); }
  }

  // ── Password generator ────────────────────────────────────────────────────
  function generatePassword() {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const nums  = '0123456789';
    const syms  = '!@#$%^&*()_+-=[]{}';
    const all   = upper + lower + nums + syms;
    let pw = upper[Math.floor(Math.random()*upper.length)]
           + lower[Math.floor(Math.random()*lower.length)]
           + nums[Math.floor(Math.random()*nums.length)]
           + syms[Math.floor(Math.random()*syms.length)];
    for (let i = 4; i < 12; i++) pw += all[Math.floor(Math.random()*all.length)];
    setNewPw(pw.split('').sort(() => Math.random()-0.5).join(''));
    setShowNew(true);
  }

  // ── Download my data ──────────────────────────────────────────────────────
  async function handleDownloadData() {
    setDownloadingData(true);
    try {
      const tk = localStorage.getItem('lt_token');
      const res = await fetch('/api/auth/download-data', { headers: { Authorization: `Bearer ${tk}` } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(err.message || 'Download failed', 'error');
    } finally {
      setDownloadingData(false);
    }
  }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveProfile = useMutation({
    mutationFn: () => apiPut('/auth/profile', { name, avatar_color: color, email, avatar_url: photoUrl }),
    onSuccess: (data) => {
      saveAuth(token, { ...user, name: data.name, avatar_color: data.avatar_color, email: data.email, avatar_url: data.avatar_url });
      setSavedName(data.name);
      setSavedEmail(data.email);
      setSavedColor(data.avatar_color);
      setSavedPhotoUrl(data.avatar_url || '');
      toast('Profile updated.', 'success');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const changePw = useMutation({
    mutationFn: () => apiPut('/auth/change-password', { currentPassword: curPw, newPassword: newPw }),
    onSuccess: () => {
      toast('Password changed successfully.', 'success');
      setCurPw(''); setNewPw(''); setConfPw('');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const sendVerifyCode = useMutation({
    mutationFn: () => apiPost('/auth/send-verification', {}),
    onSuccess: (data) => { toast(data.message || 'Code sent.', 'info'); setVerifyModal(true); },
    onError:   (e)    => toast(e.message, 'error'),
  });

  const submitVerify = useMutation({
    mutationFn: () => apiPost('/auth/verify-email', { code: verifyCode }),
    onSuccess: (data) => {
      toast(data.message || 'Email verified!', 'success');
      saveAuth(token, { ...user, email_verified: true });
      setVerifyModal(false); setVerifyCode('');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const deactivateAcc = useMutation({
    mutationFn: () => apiPost('/auth/deactivate', {}),
    onSuccess: () => toast('Account deactivated.', 'warning'),
    onError:   (e) => toast(e.message, 'error'),
  });

  const requestDel = useMutation({
    mutationFn: () => apiPost('/auth/request-deletion', { reason: delReason }),
    onSuccess: (data) => { toast(data.message || 'Request submitted.', 'success'); setDelModal(false); setDelReason(''); },
    onError:   (e)    => toast(e.message, 'error'),
  });

  const setupTotp = useMutation({
    mutationFn: () => apiPost('/auth/totp/setup', {}),
    onSuccess: (data) => setTotpSetup(data),
    onError: (e) => toast(e.message, 'error'),
  });

  const enableTotp = useMutation({
    mutationFn: () => apiPost('/auth/totp/enable', { token: totpCode }),
    onSuccess: () => {
      toast('2FA enabled successfully!', 'success');
      refetchMe();
      setTotpSetup(null);
      setTotpCode('');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const disableTotp = useMutation({
    mutationFn: () => apiPost('/auth/totp/disable', { password: disable2FAPw }),
    onSuccess: () => {
      toast('2FA disabled.', 'warning');
      refetchMe();
      setDisable2FAModal(false);
      setDisable2FAPw('');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handlePwSubmit() {
    if (newPw !== confPw) { toast('Passwords do not match.', 'error'); return; }
    if (newPw.length < 8) { toast('Password must be at least 8 characters.', 'error'); return; }
    if (!/[A-Z]/.test(newPw)) { toast('Password must contain at least one uppercase letter.', 'error'); return; }
    if (!/[a-z]/.test(newPw)) { toast('Password must contain at least one lowercase letter.', 'error'); return; }
    if (!/[0-9]/.test(newPw)) { toast('Password must contain at least one number.', 'error'); return; }
    if (!/[^A-Za-z0-9]/.test(newPw)) { toast('Password must contain at least one special character.', 'error'); return; }
    changePw.mutate();
  }

  const roleLabel = { root_admin: 'Root Administrator', admin: 'HR Admin', employee: 'Employee' }[user?.role] || user?.role;
  const joined    = user?.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const lastLogin = meData?.last_login_at ? new Date(meData.last_login_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  const totpEnabled = meData?.totp_enabled;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="page-header mb-2">
        <div>
          <div className="page-title">Account Settings</div>
          <div className="page-subtitle">Manage your profile, security and privacy settings</div>
        </div>
      </div>

      {/* ─── Tab Navigation ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 bg-white border border-[#c7c4d8] rounded-xl p-1.5 shadow-sm">
        <TabBtn label="Profile"       active={activeTab === 'profile'}  onClick={() => setActiveTab('profile')} />
        <TabBtn label="Security"      active={activeTab === 'security'} onClick={() => setActiveTab('security')} />
        <TabBtn label="Privacy & GDPR" active={activeTab === 'privacy'}  onClick={() => setActiveTab('privacy')} />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1: PROFILE
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-6">
          <h2 className="text-xs font-black text-[#777587] uppercase tracking-wider flex items-center gap-2 mb-5">
            <User size={13} className="text-[#3525cd]" /> Profile Information
          </h2>

          {/* Avatar + photo upload */}
          <div className="flex items-start gap-5 mb-6">
            <div className="relative shrink-0 group">
              {photoUrl ? (
                <img src={photoUrl} alt={name} className="w-20 h-20 rounded-full object-cover border-4 border-white shadow-md" />
              ) : (
                <div className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black text-white shadow-md border-4 border-white"
                  style={{ background: color }}>
                  {initials(name || user?.name || '')}
                </div>
              )}
              <button
                onClick={() => avatarRef.current?.click()}
                disabled={uploading}
                className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-[#3525cd] text-white flex items-center justify-center shadow-md hover:bg-[#4f46e5] transition-colors border-2 border-white disabled:opacity-60">
                {uploading ? <span className="spinner w-3 h-3" /> : <Camera size={12} />}
              </button>
              <input ref={avatarRef} type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
              {/* BUG_110: Remove Photo button */}
              {photoUrl && (
                <button
                  onClick={handleRemovePhoto}
                  disabled={removingPhoto}
                  title="Remove photo"
                  className="absolute top-0 right-0 w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-md hover:bg-rose-600 transition-colors border-2 border-white disabled:opacity-60">
                  {removingPhoto ? <span className="spinner w-2.5 h-2.5" /> : <X size={10} />}
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-base font-black text-[#151c27]">{user?.name}</p>
              <p className="text-xs text-[#777587]">{user?.email}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">{roleLabel}</span>
                {user?.employee_id && <span className="text-[0.65rem] font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">ID: {user.employee_id}</span>}
                {user?.email_verified ? (
                  /* EHN_PROF_003: Tooltip on Verified badge */
                  <span title="Your email address has been verified. If you update your email, you may need to re-verify it to confirm ownership."
                    className="flex items-center gap-1 text-[0.65rem] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold cursor-help">
                    <ShieldCheck size={10} /> Verified ⓘ
                  </span>
                ) : (
                  <button onClick={() => sendVerifyCode.mutate()} disabled={sendVerifyCode.isPending}
                    className="flex items-center gap-1 text-[0.65rem] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 font-bold hover:bg-amber-100 transition-colors">
                    <ShieldAlert size={10} /> {sendVerifyCode.isPending ? 'Sending…' : 'Verify Email'}
                  </button>
                )}
              </div>
              <p className="text-[0.65rem] text-[#9ca3af] mt-1.5">Click the camera icon to update your profile photo</p>
            </div>
          </div>

          {/* Account details */}
          <div className="border border-[#f0f3ff] rounded-xl divide-y divide-[#f0f3ff] mb-5">
            {user?.employee_id && <InfoRow icon={Hash} label="Employee ID" value={user.employee_id} />}
            <InfoRow icon={Shield} label="Role" value={roleLabel} />
            <InfoRow icon={Building2} label="Department" value={
              myDepts.length > 0 ? myDepts.map(d => d.name).join(', ') : user?.department
            } />
            <InfoRow icon={Briefcase} label="Position" value={user?.position} />
            {joined && <InfoRow icon={Calendar} label="Member Since" value={joined} />}
            {lastLogin && <InfoRow icon={Clock} label="Last Login" value={lastLogin} />}
            <InfoRow icon={User} label="Reports To" value={meData?.reporting_to ? `—` : '—'} />
          </div>

          {/* Editable fields */}
          <div className="grid grid-cols-2 gap-4 mb-1">
            <div>
              <label className="form-label">Display Name</label>
              <input
                className={`form-control ${!nameValid && name.length > 0 ? 'border-rose-400 focus:border-rose-500' : ''}`}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your full name"
              />
              {!nameValid && name.length > 0 && (
                <p className="text-xs text-rose-600 mt-1">
                  {!/[a-zA-Z]/.test(name) ? 'Name must contain at least one letter.' : 'Name must be 2–60 characters.'}
                </p>
              )}
            </div>
            <div>
              <label className="form-label flex items-center gap-1.5"><Mail size={12} /> Email Address</label>
              <input className="form-control bg-[#f5f5f8] cursor-not-allowed text-[#777587]" type="email" value={email} readOnly />
              <p className="text-[0.68rem] text-[#777587] mt-1">Login email cannot be changed here. Contact your administrator to update it.</p>
            </div>
          </div>

          {/* Unsaved changes chip */}
          {isDirty && (
            <div className="flex items-center gap-1.5 mt-3 mb-1">
              <span className="text-[0.68rem] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300">
                Unsaved changes
              </span>
            </div>
          )}

          {/* Avatar color */}
          <div className="mb-5 mt-4">
            <label className="form-label mb-2">Avatar Colour <span className="text-xs font-normal text-[#777587]">(used when no photo)</span></label>
            <div className="flex gap-2 flex-wrap">
              {AVATAR_COLORS.map(c => (
                <button key={c} onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                  style={{ background: c, borderColor: color === c ? '#fff' : 'transparent', outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: '1px' }} />
              ))}
            </div>
          </div>

          <button
            onClick={() => saveProfile.mutate()}
            disabled={saveProfile.isPending || !nameValid || !isDirty}
            className="btn btn-primary flex items-center gap-2"
          >
            {saveProfile.isPending ? <><span className="spinner w-4 h-4" /> Saving…</> : <><Save size={14} /> Save Profile</>}
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2: SECURITY
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'security' && (
        <div className="space-y-5">

          {/* Section A: Change Password */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-6">
            <h2 className="text-xs font-black text-[#777587] uppercase tracking-wider flex items-center gap-2 mb-1">
              <Lock size={13} className="text-[#3525cd]" /> Change Password
            </h2>
            {meData?.password_changed_at && (
              <p className="text-[0.68rem] text-[#777587] mb-4">
                Last changed: {new Date(meData.password_changed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            )}
            {!meData?.password_changed_at && <div className="mb-4" />}

            <div className="space-y-4">
              {/* Current password */}
              <div>
                <label className="form-label">Current Password</label>
                <div className="relative">
                  <input className="form-control pr-10" type={showCur ? 'text' : 'password'} value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="••••••••" />
                  <button type="button" onClick={() => setShowCur(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-[#777587] hover:text-[#151c27] focus:outline-none">
                    {showCur ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {/* New password + strength */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="form-label mb-0">New Password</label>
                  <button
                    type="button"
                    onClick={generatePassword}
                    className="flex items-center gap-1.5 text-[0.7rem] font-bold text-[#3525cd] hover:text-[#4f46e5] hover:bg-[#f0f3ff] px-2 py-1 rounded-lg transition-colors"
                  >
                    <RefreshCw size={11} /> Generate strong password
                  </button>
                </div>
                <div className="relative">
                  <input className="form-control pr-10" type={showNew ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 characters" />
                  <button type="button" onClick={() => setShowNew(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-[#777587] hover:text-[#151c27] focus:outline-none">
                    {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <StrengthBar password={newPw} />
              </div>

              {/* Confirm password */}
              <div>
                <label className="form-label">Confirm New Password</label>
                <div className="relative">
                  <input className="form-control pr-10" type={showConf ? 'text' : 'password'} value={confPw} onChange={e => setConfPw(e.target.value)} placeholder="Repeat new password" />
                  <button type="button" onClick={() => setShowConf(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-[#777587] hover:text-[#151c27] focus:outline-none">
                    {showConf ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {newPw && confPw && newPw !== confPw && (
                  <p className="text-xs text-rose-600 mt-1 flex items-center gap-1">✗ Passwords do not match</p>
                )}
                {newPw && confPw && newPw === confPw && (
                  <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">✓ Passwords match</p>
                )}
              </div>

              {/* Password requirements */}
              {newPw && (
                <div className="grid grid-cols-2 gap-1.5 p-3 bg-[#f9f9ff] rounded-xl border border-[#f0f3ff]">
                  {[
                    { label: '8+ characters',     ok: newPw.length >= 8 },
                    { label: 'Uppercase letter',  ok: /[A-Z]/.test(newPw) },
                    { label: 'Number',            ok: /[0-9]/.test(newPw) },
                    { label: 'Special character', ok: /[^A-Za-z0-9]/.test(newPw) },
                  ].map(r => (
                    <div key={r.label} className={`flex items-center gap-1.5 text-[0.65rem] font-semibold ${r.ok ? 'text-emerald-700' : 'text-[#9ca3af]'}`}>
                      <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[0.5rem] ${r.ok ? 'bg-emerald-100' : 'bg-[#f0f3ff]'}`}>
                        {r.ok ? '✓' : '○'}
                      </span>
                      {r.label}
                    </div>
                  ))}
                </div>
              )}

              <button onClick={handlePwSubmit} disabled={changePw.isPending || !curPw || !newPw || !confPw || newPw !== confPw || newPw.length < 8 || !/[A-Z]/.test(newPw) || !/[a-z]/.test(newPw) || !/[0-9]/.test(newPw) || !/[^A-Za-z0-9]/.test(newPw)}
                className="btn btn-primary flex items-center gap-2">
                {changePw.isPending ? <><span className="spinner w-4 h-4" /> Updating…</> : <><Check size={14} /> Update Password</>}
              </button>
            </div>
          </div>

          {/* Section B: Two-Factor Authentication */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-6">
            <h2 className="text-xs font-black text-[#777587] uppercase tracking-wider flex items-center gap-2 mb-5">
              <ShieldCheck size={13} className="text-[#3525cd]" /> Two-Factor Authentication
            </h2>

            {!totpEnabled ? (
              <div>
                {!totpSetup ? (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center shrink-0">
                      <ShieldCheck size={20} className="text-[#3525cd]" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-[#151c27] mb-1">Two-Factor Authentication</p>
                      <p className="text-xs text-[#777587] mb-4">
                        Add an extra layer of security to your account using an authenticator app (Google Authenticator, Authy).
                      </p>
                      <button
                        onClick={() => setupTotp.mutate()}
                        disabled={setupTotp.isPending}
                        className="btn btn-primary flex items-center gap-2"
                      >
                        {setupTotp.isPending ? <><span className="spinner w-4 h-4" /> Setting up…</> : <><Key size={14} /> Set Up 2FA</>}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-center">
                      <img src={totpSetup.qrDataUrl} alt="QR Code" className="w-40 h-40 mx-auto rounded-xl border border-[#c7c4d8] p-1" />
                    </div>
                    <p className="text-xs text-[#464555] text-center">
                      Scan this QR code with your authenticator app, then enter the 6-digit code below to activate.
                    </p>
                    <div>
                      <p className="text-[0.68rem] text-[#777587] font-medium mb-1.5 flex items-center gap-1.5"><Key size={11} /> Secret key (manual entry)</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 font-mono text-xs bg-[#f9f9ff] p-2 rounded border border-[#c7c4d8] tracking-widest break-all">
                          {totpSetup.secret}
                        </code>
                        <button
                          onClick={() => { navigator.clipboard.writeText(totpSetup.secret); toast('Copied!', 'success'); }}
                          className="btn btn-outline btn-sm flex items-center gap-1"
                        >
                          <Copy size={12} /> Copy
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Enter 6-digit code from your app</label>
                      <input
                        className="form-control tracking-widest text-center text-lg font-black"
                        maxLength={6}
                        placeholder="123456"
                        value={totpCode}
                        onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                    </div>
                    <div className="flex gap-3">
                      <button
                        onClick={() => enableTotp.mutate()}
                        disabled={enableTotp.isPending || totpCode.length !== 6}
                        className="btn btn-primary flex items-center gap-2"
                      >
                        {enableTotp.isPending ? <><span className="spinner w-4 h-4" /> Verifying…</> : <><ShieldCheck size={14} /> Verify &amp; Enable</>}
                      </button>
                      <button onClick={() => { setTotpSetup(null); setTotpCode(''); }} className="btn btn-outline btn-sm">
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    <ShieldCheck size={20} className="text-emerald-600" />
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
                      <ShieldCheck size={13} /> 2FA Active ✓
                    </span>
                    <p className="text-xs text-[#777587] mt-1">Your account is protected with two-factor authentication.</p>
                  </div>
                </div>
                <button
                  onClick={() => setDisable2FAModal(true)}
                  className="btn btn-danger btn-sm flex items-center gap-1.5"
                >
                  Disable 2FA
                </button>
              </div>
            )}
          </div>

          {/* Section C: Login History */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xs font-black text-[#777587] uppercase tracking-wider flex items-center gap-2">
                <History size={13} className="text-[#3525cd]" /> Login History
              </h2>
              {/* EHN_PROF_005: Sign out of all other sessions */}
              <button onClick={async () => {
                try {
                  await apiPost('/auth/logout-all-devices', {});
                  toast('Signed out from all other devices', 'success');
                } catch { toast('Could not sign out other devices. Try again.', 'error'); }
              }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors">
                <Shield size={12} />Sign out all other devices
              </button>
            </div>

            <p className="text-[0.68rem] text-[#777587] mb-3">Showing all login activity — successful logins and failed attempts for your account.</p>
            {loginHistory.length === 0 ? (
              <p className="text-sm text-[#777587] text-center py-4">No login history yet.</p>
            ) : (
              <>
              <div className="space-y-2">
                {/* EHN_PROF_006: Paginated login history */}
                {loginHistory.slice((historyPage - 1) * HISTORY_PER_PAGE, historyPage * HISTORY_PER_PAGE).map((entry, idx) => {
                  const globalIdx = (historyPage - 1) * HISTORY_PER_PAGE + idx;
                  return (
                  <div key={entry.id || globalIdx} className={`flex items-center gap-3 py-2.5 px-3 rounded-xl border ${entry.status === 'failed' ? 'bg-rose-50 border-rose-100' : 'bg-[#f9f9ff] border-[#f0f3ff]'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${entry.status === 'failed' ? 'bg-rose-100' : 'bg-[#f0f3ff]'}`}>
                      {parseDevice(entry.user_agent) === 'Mobile'
                        ? <Smartphone size={14} className={entry.status === 'failed' ? 'text-rose-500' : 'text-[#3525cd]'} />
                        : <Monitor size={14} className={entry.status === 'failed' ? 'text-rose-500' : 'text-[#3525cd]'} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#151c27]">
                          {entry.logged_in_at ? new Date(entry.logged_in_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </span>
                        {globalIdx === 0 && entry.status !== 'failed' && (
                          <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-[#3525cd] text-white">Current Device</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[0.68rem] text-[#777587] flex items-center gap-1">
                          <Globe size={10} /> {entry.ip_address || '—'}
                        </span>
                        <span className="text-[0.68rem] text-[#777587]">
                          {parseBrowser(entry.user_agent)} · {parseDevice(entry.user_agent)}
                        </span>
                      </div>
                    </div>
                    <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full shrink-0 ${entry.status === 'failed' ? 'bg-rose-50 text-rose-600 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                      {entry.status === 'failed' ? 'Failed' : 'Success'}
                    </span>
                  </div>
                  );
                })}
              </div>
              {/* Pagination for login history */}
              {loginHistory.length > HISTORY_PER_PAGE && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#f0f3ff]">
                  <span className="text-xs text-[#777587]">Page {historyPage} of {Math.ceil(loginHistory.length / HISTORY_PER_PAGE)}</span>
                  <div className="flex gap-1.5">
                    <button disabled={historyPage === 1} onClick={() => setHistoryPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] disabled:opacity-40">Prev</button>
                    <button disabled={historyPage >= Math.ceil(loginHistory.length / HISTORY_PER_PAGE)} onClick={() => setHistoryPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] disabled:opacity-40">Next</button>
                  </div>
                </div>
              )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3: PRIVACY & GDPR
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'privacy' && (
        <div className="space-y-5">

          {/* Section A: Download My Data */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-6">
            <h2 className="text-xs font-black text-[#777587] uppercase tracking-wider flex items-center gap-2 mb-2">
              <Download size={13} className="text-[#3525cd]" /> Download Your Data
            </h2>
            <p className="text-xs text-[#777587] mb-4">
              Export all your personal data stored in the system as a JSON file. This includes your profile, leave requests, and attendance history.
            </p>
            <button
              onClick={handleDownloadData}
              disabled={downloadingData}
              className="btn btn-primary flex items-center gap-2"
            >
              {downloadingData
                ? <><span className="spinner w-4 h-4" /> Preparing…</>
                : <><Download size={14} /> Download My Data</>}
            </button>
          </div>

          {/* Section B: Account Deactivation */}
          <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-6">
            <h2 className="text-xs font-black text-amber-700 uppercase tracking-wider flex items-center gap-2 mb-2">
              <AlertTriangle size={13} className="text-amber-600" /> Account Deactivation
            </h2>
            <p className="text-xs text-[#777587] mb-4">
              Temporarily deactivate your account. HR will be notified and you will lose access until reactivation.
            </p>
            <button onClick={() => deactivateAcc.mutate()} disabled={deactivateAcc.isPending}
              className="btn btn-outline btn-sm border-amber-300 text-amber-800 hover:bg-amber-50">
              {deactivateAcc.isPending ? 'Deactivating…' : 'Deactivate Account'}
            </button>
          </div>

          {/* Section C: Right to be Forgotten */}
          <div className="bg-white rounded-xl border border-rose-200 shadow-sm p-6">
            <h2 className="text-xs font-black text-rose-700 uppercase tracking-wider flex items-center gap-2 mb-2">
              <Trash2 size={13} className="text-rose-600" /> Right to be Forgotten (GDPR)
            </h2>
            <p className="text-xs text-[#777587] mb-4">
              Under GDPR, you may request permanent deletion of your personal data. HR will review your request before any action is taken.
            </p>
            <button onClick={() => setDelModal(true)}
              className="btn btn-danger btn-sm flex items-center gap-1.5">
              <Trash2 size={13} /> Request Account Deletion
            </button>
          </div>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      <Modal open={verifyModal} onClose={() => setVerifyModal(false)} title="Enter Email Verification Code"
        footer={<div className="flex gap-2 justify-end">
          <button onClick={() => setVerifyModal(false)} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => submitVerify.mutate()} disabled={submitVerify.isPending || verifyCode.length < 6} className="btn btn-primary btn-sm">
            {submitVerify.isPending ? 'Verifying…' : 'Verify Now'}
          </button>
        </div>}>
        <p className="text-xs text-[#777587] mb-3">Enter the 6-digit code sent to <strong>{user?.email}</strong>.</p>
        <input className="form-control tracking-widest text-center text-lg font-black" maxLength={6} placeholder="123456"
          value={verifyCode} onChange={e => setVerifyCode(e.target.value)} />
      </Modal>

      <Modal open={delModal} onClose={() => setDelModal(false)} title="Request Account Deletion (GDPR)"
        footer={<div className="flex gap-2 justify-end">
          <button onClick={() => setDelModal(false)} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => requestDel.mutate()} disabled={requestDel.isPending} className="btn btn-danger btn-sm">
            {requestDel.isPending ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>}>
        <p className="text-xs text-[#777587] mb-3">Under GDPR Right to be Forgotten, you can request permanent deletion of your data. HR will review your request.</p>
        <label className="form-label">Reason (optional)</label>
        <textarea className="form-control text-xs" rows={3} placeholder="Provide a reason..." value={delReason} onChange={e => setDelReason(e.target.value)} />
      </Modal>

      <Modal open={disable2FAModal} onClose={() => { setDisable2FAModal(false); setDisable2FAPw(''); }} title="Disable Two-Factor Authentication"
        footer={<div className="flex gap-2 justify-end">
          <button onClick={() => { setDisable2FAModal(false); setDisable2FAPw(''); }} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => disableTotp.mutate()} disabled={disableTotp.isPending || !disable2FAPw} className="btn btn-danger btn-sm">
            {disableTotp.isPending ? 'Disabling…' : 'Disable 2FA'}
          </button>
        </div>}>
        <p className="text-xs text-[#777587] mb-3">Enter your current password to confirm disabling 2FA. This will make your account less secure.</p>
        <label className="form-label">Current Password</label>
        <input className="form-control" type="password" placeholder="••••••••" value={disable2FAPw} onChange={e => setDisable2FAPw(e.target.value)} />
      </Modal>
    </div>
  );
}
