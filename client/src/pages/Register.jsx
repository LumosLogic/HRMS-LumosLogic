import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, User, Mail, Phone, Globe, MessageSquare, CheckCircle2, ArrowRight, Clock, FileText, Users, Briefcase, ChevronDown, GitBranch } from 'lucide-react';
import { apiPost } from '@/lib/api';

const COMPANY_SIZES = [
  { value: '1-10',    label: '1–10 employees' },
  { value: '11-50',   label: '11–50 employees' },
  { value: '51-200',  label: '51–200 employees' },
  { value: '201-500', label: '201–500 employees' },
  { value: '500+',    label: '500+ employees' },
];

const INDUSTRIES = [
  'Technology & Software', 'Manufacturing', 'Healthcare & Pharma',
  'Retail & E-Commerce', 'Education & Training', 'Finance & Banking',
  'Real Estate & Construction', 'Logistics & Transportation',
  'Hospitality & Tourism', 'Media & Entertainment',
  'Legal & Professional Services', 'Agriculture', 'Other',
];

const PERSONAL_DOMAINS = new Set([
  'gmail.com','yahoo.com','yahoo.co.in','hotmail.com','outlook.com',
  'live.com','msn.com','aol.com','icloud.com','me.com','mac.com',
  'protonmail.com','proton.me','ymail.com','rediffmail.com',
  'zoho.com','tutanota.com','gmx.com','gmx.net',
]);
const HTML_RE  = /[<>;`\\\-]|<script>|drop\s+table/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateNameVal(val) {
  if (!val || !val.trim()) return 'Full Name is required.';
  if (val.startsWith(' ')) return 'Full Name cannot start with a space.';
  if (/\s{2,}/.test(val)) return 'Full Name cannot contain consecutive spaces.';
  if (val.length < 2) return 'Full Name must be at least 2 characters.';
  if (val.length > 100) return 'Full Name cannot exceed 100 characters.';
  if (/\d/.test(val)) return 'Full Name can only contain alphabetic characters.';
  if (/[^a-zA-Z\s'-]/.test(val)) return 'Full Name can only contain alphabetic characters.';
  return '';
}

function validateEmailVal(val) {
  if (!val || !val.trim()) return 'Email is required.';
  if (val.length > 254) return 'Email cannot exceed 254 characters.';
  if (!EMAIL_RE.test(val.trim())) return 'Enter a valid email address.';
  const domain = val.trim().toLowerCase().split('@')[1] || '';
  if (PERSONAL_DOMAINS.has(domain)) {
    return 'Please use your company/work email — personal addresses (Gmail, Yahoo, etc.) are not accepted.';
  }
  return '';
}

function validatePhoneVal(val) {
  if (!val) return '';
  if (!/^\d+$/.test(val)) return 'Only numeric values are allowed.';
  if (val.length !== 10) return 'Phone Number must contain exactly 10 digits.';
  if (!/^[6-9]/.test(val)) return 'Enter a valid Indian mobile number.';
  return '';
}

function validateCompanyVal(val) {
  if (!val || !val.trim()) return 'Company Name is required.';
  if (val.length < 2) return 'Company Name must be at least 2 characters.';
  if (val.length > 255) return 'Company Name cannot exceed 255 characters.';
  if (HTML_RE.test(val)) return 'Company Name contains invalid or unsafe characters.';
  if (!/[a-zA-Z]/.test(val)) return 'Company Name must contain at least one letter.';
  if (/^[^a-zA-Z0-9]+$/.test(val.trim())) return 'Company Name cannot contain only special characters.';
  return '';
}

function validateAll(form) {
  const errs = {};
  const nErr = validateNameVal(form.name);
  if (nErr) errs.name = nErr;

  const cErr = validateCompanyVal(form.company_name);
  if (cErr) errs.company_name = cErr;

  const eErr = validateEmailVal(form.email);
  if (eErr) errs.email = eErr;

  const pErr = validatePhoneVal(form.phone);
  if (pErr) errs.phone = pErr;

  if (form.has_multiple_branches === null) {
    errs.has_multiple_branches = 'Please answer this required question.';
  }

  return errs;
}

export default function Register() {
  const [step, setStep] = useState(1); // 1 = form, 2 = success

  const [form, setForm] = useState({
    company_name:          '',
    name:                  '',
    email:                 '',
    phone:                 '',
    website:               '',
    message:               '',
    gst_number:            '',
    company_size:          '',
    industry:              '',
    has_multiple_branches: null, // null = unanswered; true = yes; false = no
  });
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const handleNameChange = (e) => {
    let val = e.target.value;
    // Allow A-Z, a-z, space, -, '
    val = val.replace(/[^a-zA-Z\s'-]/g, '');
    val = val.replace(/^\s+/, '');
    val = val.replace(/\s{2,}/g, ' ');
    if (val.length > 100) val = val.slice(0, 100);

    setForm(f => ({ ...f, name: val }));
    const err = validateNameVal(val);
    setFieldErrors(fe => ({ ...fe, name: err }));
  };

  const handleCompanyChange = (e) => {
    let val = e.target.value;
    // Remove HTML script/SQL tags
    val = val.replace(/[<>;`\\\-]/g, '');
    // Allow letters, numbers, space, &, ., ,, (, )
    val = val.replace(/[^a-zA-Z0-9\s&.,()]/g, '');
    val = val.replace(/^\s+/, '');
    val = val.replace(/\s{2,}/g, ' ');
    if (val.length > 255) val = val.slice(0, 255);

    setForm(f => ({ ...f, company_name: val }));
    const err = validateCompanyVal(val);
    setFieldErrors(fe => ({ ...fe, company_name: err }));
  };

  const handleEmailChange = (e) => {
    let val = e.target.value.replace(/\s+/g, '');
    if (val.length > 254) val = val.slice(0, 254);

    setForm(f => ({ ...f, email: val }));
    const err = validateEmailVal(val);
    setFieldErrors(fe => ({ ...fe, email: err }));
  };

  const handlePhoneChange = (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 10) val = val.slice(0, 10);

    setForm(f => ({ ...f, phone: val }));
    const err = validatePhoneVal(val);
    setFieldErrors(fe => ({ ...fe, phone: err }));
  };

  const setOther = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setFieldErrors(fe => { const n = { ...fe }; delete n[k]; return n; });
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const errs = validateAll(form);
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setLoading(true);
    try {
      await apiPost('/register-org', {
        company_name:          form.company_name.trim(),
        name:                  form.name.trim(),
        email:                 form.email.trim(),
        phone:                 form.phone.trim()        || undefined,
        website:               form.website.trim()      || undefined,
        message:               form.message.trim()      || undefined,
        gst_number:            form.gst_number.trim()   || undefined,
        company_size:          form.company_size        || undefined,
        industry:              form.industry            || undefined,
        has_multiple_branches: form.has_multiple_branches === true,
      });
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (step === 2) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#f9f9ff] p-6">
        <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-5">
            <Clock size={32} className="text-amber-600" />
          </div>
          <h2 className="text-2xl font-black text-[#151c27] mb-2">Request Submitted!</h2>
          <p className="text-[#464555] text-sm mb-4">
            Thank you, <strong>{form.name}</strong>! Your registration request for <strong>{form.company_name}</strong> is now pending review.
          </p>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-6 text-left">
            <p className="text-sm text-amber-800 font-semibold mb-1">What happens next?</p>
            <ul className="text-xs text-amber-700 space-y-1">
              <li className="flex items-start gap-1.5"><CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" /> Our team reviews your organization details</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" /> You receive an approval email within 24 hours</li>
              <li className="flex items-start gap-1.5"><CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" /> Email includes your login credentials — just email &amp; password to sign in</li>
            </ul>
          </div>
          <p className="text-xs text-[#777587] mb-4">Approval sent to <strong>{form.email}</strong></p>
          <Link to="/login"
            className="w-full py-3 bg-[#3525cd] text-white font-bold rounded-xl hover:bg-[#4f46e5] transition-all flex items-center justify-center gap-2">
            Back to Login <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen grid md:grid-cols-2 bg-[#f9f9ff] overflow-hidden">

      {/* Left brand panel */}
      <div className="hidden md:flex flex-col justify-center px-12 py-8 relative overflow-hidden bg-[#3525cd]">
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px)', backgroundSize: '48px 48px' }} />
        <div className="absolute inset-0 bg-gradient-to-br from-[#3525cd]/80 via-[#712ae2]/40 to-[#3525cd]/90 pointer-events-none" />
        <div className="relative z-10 text-white">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
              <img src="/LogoWithoutName.svg" alt="HRMS" className="w-7 h-7" />
            </div>
            <span className="text-white font-black text-lg tracking-tight">HRMS</span>
          </div>
          <h1 className="text-4xl font-black leading-tight tracking-[-0.04em] text-white mb-4">
            Start Your<br />
            <span className="opacity-80">Free Organization</span><br />
            <em className="not-italic text-white/90">Today.</em>
          </h1>
          <p className="text-white/75 text-sm leading-relaxed max-w-sm mb-7">
            Set up your own private HR workspace. Full attendance tracking, leave management, and team analytics — all under your organization's name.
          </p>
          <div className="space-y-3">
            {[
              { title: 'Isolated Data',     desc: 'Your company data is fully private and separate from others' },
              { title: 'Custom Settings',   desc: 'Bring your own SMTP, Google Calendar, and integrations' },
              { title: 'Multi-role System', desc: 'Root Admin → HR Admin → Employee role hierarchy' },
              { title: 'Scale Freely',      desc: 'Add unlimited employees, holidays, and events' },
            ].map(f => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full bg-white/20 border border-white/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <CheckCircle2 size={12} className="text-white" />
                </div>
                <div>
                  <strong className="block text-white text-sm font-bold">{f.title}</strong>
                  <span className="text-white/70 text-xs">{f.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center px-8 md:px-16 py-10 bg-white relative overflow-y-auto border-l border-[#c7c4d8]">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8 md:hidden">
            <div className="w-8 h-8 rounded-lg bg-[#3525cd] flex items-center justify-center flex-shrink-0">
              <img src="/LogoWithoutName.svg" alt="HRMS" className="w-5 h-5" />
            </div>
            <span className="text-base font-black text-[#3525cd]">HRMS</span>
          </div>

          <div className="mb-6">
            <h2 className="text-[1.75rem] font-black text-[#151c27] tracking-[-0.04em] leading-tight mb-2">
              Register your organization
            </h2>
            <p className="text-sm text-[#464555]">Submit your details — we'll review and email your credentials within 24 hours.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">

            {/* Company Name */}
            <div>
              <label className="form-label">Company Name <span className="text-rose-500">*</span></label>
              <div className="relative">
                <Building2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
                <input type="text" className={`form-control pl-9 ${fieldErrors.company_name ? 'border-rose-500 focus:border-rose-500' : ''}`} required
                  placeholder="Acme Corp" value={form.company_name}
                  maxLength={255}
                  onChange={handleCompanyChange} />
              </div>
              {fieldErrors.company_name && <p className="text-[0.72rem] text-rose-600 mt-1">{fieldErrors.company_name}</p>}
            </div>

            {/* Contact Name */}
            <div>
              <label className="form-label">Your Full Name <span className="text-rose-500">*</span></label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
                <input type="text" className={`form-control pl-9 ${fieldErrors.name ? 'border-rose-500 focus:border-rose-500' : ''}`} required
                  placeholder="Jane Smith" value={form.name}
                  maxLength={100}
                  onChange={handleNameChange} />
              </div>
              {fieldErrors.name && <p className="text-[0.72rem] text-rose-600 mt-1">{fieldErrors.name}</p>}
            </div>

            {/* Work Email */}
            <div>
              <label className="form-label">Work Email <span className="text-rose-500">*</span></label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
                <input type="email" className={`form-control pl-9 ${fieldErrors.email ? 'border-rose-500 focus:border-rose-500' : ''}`} required
                  placeholder="jane@acmecorp.com" value={form.email}
                  maxLength={254}
                  onChange={handleEmailChange} />
              </div>
              {fieldErrors.email && <p className="text-[0.72rem] text-rose-600 mt-1">{fieldErrors.email}</p>}
            </div>

            {/* Phone + Website */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Phone <span className="text-[#777587] font-normal normal-case tracking-normal">(Optional)</span></label>
                <div className="relative">
                  <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
                  <input type="tel" className={`form-control pl-9 ${fieldErrors.phone ? 'border-rose-500 focus:border-rose-500' : ''}`}
                    placeholder="9876543210" value={form.phone}
                    maxLength={10}
                    onChange={handlePhoneChange} />
                </div>
                {fieldErrors.phone && <p className="text-[0.72rem] text-rose-600 mt-1">{fieldErrors.phone}</p>}
              </div>
              <div>
                <label className="form-label">Website <span className="text-[#777587] font-normal normal-case tracking-normal">(Optional)</span></label>
                <div className="relative">
                  <Globe size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
                  <input type="url" className="form-control pl-9"
                    placeholder="https://…" value={form.website}
                    onChange={e => setOther('website', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Company Size + Industry */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Company Size <span className="text-[#777587] font-normal normal-case tracking-normal">(Optional)</span></label>
                <div className="relative">
                  <Users size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  {/* ENH_REG_001: ChevronDown icon for dropdown visibility */}
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  <select className="form-control pl-9 pr-8 appearance-none"
                    value={form.company_size}
                    onChange={e => setOther('company_size', e.target.value)}>
                    <option value="">Select…</option>
                    {COMPANY_SIZES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="form-label">Industry <span className="text-[#777587] font-normal normal-case tracking-normal">(Optional)</span></label>
                <div className="relative">
                  <Briefcase size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  <select className="form-control pl-9 pr-8 appearance-none"
                    value={form.industry}
                    onChange={e => setOther('industry', e.target.value)}>
                    <option value="">Select…</option>
                    {INDUSTRIES.map(i => (
                      <option key={i} value={i}>{i}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* GST Number */}
            <div>
              <label className="form-label">
                GST Number <span className="text-[#777587] font-normal normal-case tracking-normal">(Optional)</span>
              </label>
              <div className="relative">
                <FileText size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
                <input type="text" className="form-control pl-9 uppercase tracking-wider"
                  placeholder="22AAAAA0000A1Z5"
                  maxLength={15}
                  value={form.gst_number}
                  onChange={e => setOther('gst_number', e.target.value.toUpperCase())} />
              </div>
              <p className="text-[0.7rem] text-[#777587] mt-1">15-character GST Identification Number</p>
            </div>

            {/* Message */}
            <div>
              <label className="form-label">Message <span className="text-[#777587] font-normal">(optional)</span></label>
              <div className="relative">
                <MessageSquare size={15} className="absolute left-3 top-3 text-[#777587]" />
                <textarea className="form-control pl-9 resize-none" rows={2}
                  placeholder="Tell us about your company…" value={form.message}
                  onChange={e => setOther('message', e.target.value)} />
              </div>
            </div>

            {/* Multiple Branches Question */}
            <div>
              <label className="form-label flex items-center gap-1.5">
                <GitBranch size={13} className="text-[#777587]" />
                Does your organization have multiple branches? <span className="text-rose-500">*</span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: true,  label: 'Yes',   desc: 'Multiple offices / locations' },
                  { value: false, label: 'No',    desc: 'Single workspace' },
                ].map(opt => (
                  <button key={String(opt.value)} type="button"
                    onClick={() => setOther('has_multiple_branches', opt.value)}
                    className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 text-sm font-bold transition-all
                      ${form.has_multiple_branches === opt.value
                        ? 'bg-[#f0f3ff] text-[#3525cd] border-[#3525cd]'
                        : 'border-[#e7eefe] text-[#464555] hover:border-[#3525cd]/40'}`}>
                    {opt.label}
                    <span className="text-[0.68rem] font-normal text-[#777587]">{opt.desc}</span>
                  </button>
                ))}
              </div>
              {fieldErrors.has_multiple_branches && (
                <p className="text-[0.72rem] text-rose-600 mt-1">{fieldErrors.has_multiple_branches}</p>
              )}
            </div>

            {error && (
              <div className="text-[0.83rem] text-rose-700 bg-rose-50 border border-rose-200 border-l-4 border-l-rose-500 rounded-xl px-4 py-3">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-3.5 bg-[#3525cd] text-white font-bold text-base rounded-xl hover:bg-[#4f46e5] transition-all shadow-lg shadow-[#3525cd]/20 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {loading ? (
                <><span className="spinner w-4 h-4" /> Submitting request…</>
              ) : (
                <>Submit Registration Request <ArrowRight size={16} /></>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-[#464555] mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-[#3525cd] font-bold hover:underline">Sign in</Link>
          </p>

          <p className="text-center text-[0.72rem] text-[#777587] mt-3">
            HRMS — Multi-Tenant HR Platform
          </p>
        </div>
      </div>
    </div>
  );
}
