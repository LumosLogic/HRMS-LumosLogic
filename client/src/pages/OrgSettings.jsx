import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Mail, Calendar, Bell, Shield, Save, Eye, EyeOff, ChevronDown, ChevronUp, CheckCircle2, ImageIcon, Upload, X } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
import { useOrgSettings } from '@/hooks/useReferenceData';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

function Section({ icon, title, subtitle, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-[#f9f9ff] transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center text-[#3525cd]">
            {icon}
          </div>
          <div>
            <div className="font-black text-[#151c27] text-sm">{title}</div>
            {subtitle && <div className="text-xs text-[#777587] mt-0.5">{subtitle}</div>}
          </div>
        </div>
        {open ? <ChevronUp size={16} className="text-[#777587]" /> : <ChevronDown size={16} className="text-[#777587]" />}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-[#f0f3ff]">
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, inlineHint, children }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <label className="form-label !mb-0">{label}</label>
        {inlineHint && <span className="text-[0.7rem] text-[#777587] font-normal normal-case tracking-normal">{inlineHint}</span>}
      </div>
      {hint && <p className="text-xs text-[#777587] mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

function PasswordField({ label, hint, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <Field label={label} hint={hint}>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          className="form-control pr-10"
          value={value}
          onChange={onChange}
          placeholder={placeholder || ''}
          autoComplete="new-password"
        />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </Field>
  );
}

// BUG_148 – domain format regex
const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;

export default function OrgSettings() {
  const toast   = useToast();
  const qc      = useQueryClient();
  const { user } = useAuth();
  const fileRef  = useRef(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const { data: org, isLoading } = useOrgSettings({ staleTime: 0 });

  const [form, setForm] = useState({});
  const [savedForm, setSavedForm] = useState({}); // BUG_150: baseline to compare against
  const [saved, setSaved] = useState(false);
  const [orgErrors, setOrgErrors] = useState({});

  // BUG_150: computed dirty flag — form differs from last saved baseline
  // Password fields (secrets) are always blank on load, so only mark dirty if user typed something
  const isDirty = React.useMemo(() => {
    if (Object.keys(savedForm).length === 0) return false;
    return Object.keys(form).some(k => {
      if (k === 'name') return false; // company name is read-only
      const secretFields = ['google_client_secret', 'google_refresh_token', 'vapid_private_key'];
      if (secretFields.includes(k)) return (form[k] || '') !== '';
      return String(form[k] ?? '') !== String(savedForm[k] ?? '');
    });
  }, [form, savedForm]);

  // BUG_150: warn on browser-level navigation (refresh, tab close, external link)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Sync loaded data into form once
  React.useEffect(() => {
    if (org && Object.keys(form).length === 0) {
      const initial = {
        name:                org.name || '',
        domain:              org.domain || '',
        google_client_id:    org.google_client_id || '',
        google_client_secret:'',
        google_refresh_token:'',
        google_calendar_id:  org.google_calendar_id || '',
        vapid_public_key:    org.vapid_public_key || '',
        vapid_private_key:   '',
        total_annual_leaves: org.total_annual_leaves || 18,
      };
      setForm(initial);
      setSavedForm(initial); // BUG_150: set baseline
    }
  }, [org]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // BUG_150: discard changes — reset form back to last saved baseline
  function handleDiscard() {
    setForm({ ...savedForm });
    setOrgErrors({});
  }

  function validateOrgForm() {
    const errs = {};

    // BUG_146 – annual leave days must be >= 0 and an integer
    const leaves = form.total_annual_leaves;
    const leavesNum = Number(leaves);
    if (leaves === '' || leaves === undefined || leaves === null) {
      errs.total_annual_leaves = 'Total Annual Leave Days is required.';
    } else if (!Number.isInteger(leavesNum) || leavesNum < 0) {
      errs.total_annual_leaves = 'Total Annual Leave Days cannot be negative and must be a whole number.';
    }

    // BUG_148 – domain format validation (only if a domain is entered)
    const domain = (form.domain || '').trim();
    if (domain && !DOMAIN_REGEX.test(domain)) {
      errs.domain = 'Please enter a valid domain (e.g. company.com)';
    }

    setOrgErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const saveMut = useMutation({
    mutationFn: () => apiPut('/org/settings', form),
    onSuccess: () => {
      toast('Organization settings saved!', 'success');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      // BUG_150: update the baseline so isDirty resets to false after save
      setSavedForm(prev => ({
        ...prev,
        ...form,
        // secret fields reset back to blank after a save (server doesn't return them)
        google_client_secret: '',
        google_refresh_token: '',
        vapid_private_key: '',
      }));
      setForm(f => ({
        ...f,
        google_client_secret: '',
        google_refresh_token: '',
        vapid_private_key: '',
      }));
      qc.invalidateQueries({ queryKey: ['org-settings'] });
    },
    onError: err => toast(err.message, 'error'),
  });

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please select an image file.', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('Logo must be under 2 MB.', 'error'); return; }

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = ev => setLogoPreview(ev.target.result);
    reader.readAsDataURL(file);

    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('lt_token');
      const res = await fetch('/api/org/logo', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      const { logo_url } = await res.json();
      set('logo_url', logo_url);
      setLogoPreview(null); // use the real URL now
      toast('Logo uploaded!', 'success');
      qc.invalidateQueries({ queryKey: ['org-settings'] });
    } catch (err) {
      toast(err.message, 'error');
      setLogoPreview(null);
    } finally {
      setLogoUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleSaveOrg() {
    if (validateOrgForm()) saveMut.mutate();
  }

  if (isLoading) return <div className="flex items-center justify-center py-20"><div className="spinner w-6 h-6" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {/* Header */}
      <div className="page-header mb-2">
        <div>
          <div className="page-title">Organization Settings</div>
          <div className="page-subtitle">Configure integrations and policies for <strong>{org?.name}</strong></div>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1.5 text-emerald-700 text-sm font-semibold">
              <CheckCircle2 size={14} /> Saved
            </span>
          )}
          <button
            className="btn btn-primary"
            onClick={handleSaveOrg}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? <><span className="spinner w-4 h-4" /> Saving…</> : <><Save size={15} /> Save Changes</>}
          </button>
        </div>
      </div>



      {/* BUG_150: Unsaved changes banner */}
      {isDirty && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 text-amber-800 text-sm font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
            You have unsaved changes
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-amber-800 border border-amber-300 bg-white hover:bg-amber-100 transition-colors"
            >
              Discard Changes
            </button>
            <button
              type="button"
              onClick={handleSaveOrg}
              disabled={saveMut.isPending}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-60"
            >
              {saveMut.isPending ? 'Saving…' : 'Save Now'}
            </button>
          </div>
        </div>
      )}

      {/* Org Profile */}
      <Section icon={<Building2 size={18} />} title="Organization Profile" subtitle="Basic company information" defaultOpen>
        {/* Logo upload */}
        <div className="mb-5 pb-5 border-b border-[#f0f3ff]">
          <label className="form-label mb-3 flex items-center gap-1.5">
            <ImageIcon size={13} className="text-[#3525cd]" /> Company Logo
            <span className="text-[0.7rem] font-normal text-[#777587] normal-case tracking-normal">— used in payslips and official documents</span>
          </label>
          <div className="flex items-center gap-4">
            {/* Preview / placeholder */}
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-[#c7c4d8] bg-[#f9f9ff] flex items-center justify-center overflow-hidden flex-shrink-0">
              {logoUploading ? (
                <span className="w-5 h-5 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
              ) : (logoPreview || form.logo_url || org?.logo_url) ? (
                <img src={logoPreview || form.logo_url || org?.logo_url} alt="Logo" className="w-full h-full object-contain p-1" />
              ) : (
                <ImageIcon size={28} className="text-[#c7c4d8]" />
              )}
            </div>

            <div className="space-y-2 flex-1">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={logoUploading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:border-[#3525cd] transition-colors disabled:opacity-50">
                <Upload size={13} /> {logoUploading ? 'Uploading…' : (form.logo_url || org?.logo_url) ? 'Replace Logo' : 'Upload Logo'}
              </button>
              {(form.logo_url || org?.logo_url) && (
                <button type="button"
                  onClick={() => { set('logo_url', ''); setLogoPreview(null); saveMut.mutate(); }}
                  className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-600 px-1">
                  <X size={12} /> Remove logo
                </button>
              )}
              <p className="text-[0.68rem] text-[#9ca3af]">PNG, JPG or SVG · Max 2 MB · Will be resized to 400px wide</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Company Name">
            <input className="form-control bg-[#f5f5f8] cursor-not-allowed text-[#777587]" value={form.name || ''} readOnly placeholder="Acme Corp" />
            <p className="text-[0.68rem] text-[#777587] mt-1">Company name is a registered attribute. Contact your Platform Admin to request a name change.</p>
          </Field>
          <Field label="Company Domain" inlineHint="Used for email auto-detection">
            <input className={`form-control ${orgErrors.domain ? 'border-rose-400' : ''}`} value={form.domain || ''} onChange={e => { set('domain', e.target.value); setOrgErrors(p => ({ ...p, domain: undefined })); }} placeholder="acmecorp.com" />
            {orgErrors.domain && <p className="text-xs text-rose-500 mt-1">{orgErrors.domain}</p>}
          </Field>
        </div>
        <div className="mt-4 p-3 bg-[#f0f3ff] rounded-xl">
          <p className="text-xs text-[#464555]">
            <span className="font-bold">Organization Slug:</span>{' '}
            <span className="font-mono text-[#3525cd]">{org?.slug}</span>
            {' — '}Share this with employees so they can select the right organization on login.
          </p>
          <p className="text-xs text-[#464555] mt-1">
            <span className="font-bold">Plan:</span>{' '}
            <span className="capitalize font-semibold text-[#3525cd]">{org?.plan}</span>
          </p>
        </div>
      </Section>

      {/* BUG_147: Leave Policy managed from Leave Policies page — show info link only */}
      <Section icon={<Shield size={18} />} title="Leave Policy" subtitle="Configure individual leave types and quotas in Leave Policies">
        <div className="p-3 bg-[#f0f3ff] rounded-xl flex items-start gap-3">
          <Shield size={16} className="text-[#3525cd] mt-0.5 shrink-0" />
          <p className="text-xs text-[#464555] leading-relaxed">
            Leave types, quotas, and policies are managed in the <strong>Leave Policies</strong> section.
            Go to <a href="/leave-policies" className="text-[#3525cd] underline font-semibold">Leave Policies</a> to configure Casual Leave, Sick Leave, Annual Leave, and more.
          </p>
        </div>
      </Section>

      {/* Email — centralized, no per-org config needed */}
      <Section icon={<Mail size={18} />} title="Email Notifications" subtitle="All transactional emails are sent from the platform's centralized mail service. No configuration required.">
        <div className="p-3 bg-[#f0f3ff] rounded-xl flex items-start gap-3">
          <Mail size={16} className="text-[#3525cd] mt-0.5 shrink-0" />
          <p className="text-xs text-[#464555] leading-relaxed">
            Emails (leave notifications, welcome messages, payslips, onboarding) are delivered via the
            platform's shared SMTP infrastructure — <strong>hello@lumoslogic.com</strong>.
            Your organization name appears in the email subject and body.
            Contact your platform administrator to update the sender configuration.
          </p>
        </div>
      </Section>

      {/* Google Calendar */}
      <Section icon={<Calendar size={18} />} title="Google Calendar Integration" subtitle="Auto-sync approved leaves and holidays to your Google Calendar">
        <div className="space-y-4">
          <Field label="Google OAuth2 Client ID">
            <input className="form-control" value={form.google_client_id || ''} onChange={e => set('google_client_id', e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
          </Field>
          <PasswordField label="Google OAuth2 Client Secret" hint="Leave blank to keep current" value={form.google_client_secret || ''} onChange={e => set('google_client_secret', e.target.value)} placeholder="Leave blank to keep" />
          <PasswordField label="Google Refresh Token" hint="Leave blank to keep current" value={form.google_refresh_token || ''} onChange={e => set('google_refresh_token', e.target.value)} placeholder="Leave blank to keep" />
          <Field label="Google Calendar ID" hint="The calendar to sync to (e.g. primary or your calendar email)">
            <input className="form-control" value={form.google_calendar_id || ''} onChange={e => set('google_calendar_id', e.target.value)} placeholder="primary" />
          </Field>
        </div>
      </Section>

      {/* Web Push / VAPID */}
      <Section icon={<Bell size={18} />} title="Web Push Notifications (VAPID Keys)" subtitle="Enable browser push notifications for leave updates and announcements">
        <div className="space-y-4">
          <Field label="VAPID Public Key">
            <input className="form-control font-mono text-xs" value={form.vapid_public_key || ''} onChange={e => set('vapid_public_key', e.target.value)} placeholder="BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxA=" />
          </Field>
          <PasswordField label="VAPID Private Key" hint="Leave blank to keep current" value={form.vapid_private_key || ''} onChange={e => set('vapid_private_key', e.target.value)} placeholder="Leave blank to keep" />
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
            Generate VAPID keys at <strong>web-push-codelab.glitch.me</strong> or run <code className="bg-amber-100 px-1 rounded">npx web-push generate-vapid-keys</code>
          </div>
        </div>
      </Section>

      {/* Save button (sticky at bottom too) */}
      <div className="flex justify-end pb-6">
        <button
          className="btn btn-primary px-8"
          onClick={handleSaveOrg}
          disabled={saveMut.isPending}
        >
          {saveMut.isPending ? <><span className="spinner w-4 h-4" /> Saving…</> : <><Save size={15} /> Save All Changes</>}
        </button>
      </div>
    </div>
  );
}
