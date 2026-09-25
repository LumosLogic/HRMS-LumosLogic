import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User, UserCircle, Users, BookOpen, Briefcase, Zap, CreditCard, Heart, Shield,
  Clock, Umbrella, BarChart3, FileText, Star, Settings, Lock, ExternalLink,
  Plus, Pencil, Trash2, X, Check, Eye, EyeOff, Save, AlertTriangle,
  ShieldCheck, ShieldAlert, Mail, ChevronRight, Building2, MapPin, Phone,
  CheckCircle2, Download, MoreHorizontal, Calendar, TrendingUp, Activity,
  Layers, BadgeCheck, ClipboardList, Key, Printer, QrCode, Camera,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useFeature } from '@/context/FeatureFlagContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { fmtDate, fmtTime, initials } from '@/lib/utils';

// ─── Constants ───────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#3525cd','#4f46e5','#712ae2','#8a4cfc','#10B981','#EC4899','#F59E0B','#EF4444','#F97316',
];

const TABS = [
  { key: 'overview',     label: 'Overview' },
  { key: 'personal',     label: 'Personal' },
  { key: 'professional', label: 'Professional' },
  { key: 'documents',    label: 'Documents' },
  { key: 'work',         label: 'Work' },
  { key: 'payroll',      label: 'Payroll' },
  { key: 'performance',  label: 'Performance' },
  { key: 'account',      label: 'Account' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskAccount(num) {
  if (!num) return '—';
  const s = String(num);
  return '****' + s.slice(-4);
}

function proficiencyColor(level) {
  const map = {
    beginner:     'bg-slate-100 text-slate-700',
    intermediate: 'bg-blue-100 text-blue-700',
    advanced:     'bg-emerald-100 text-emerald-700',
    expert:       'bg-purple-100 text-purple-700',
  };
  return map[level] || 'bg-slate-100 text-slate-700';
}

// ENH_PROFILE_005: Relationship icons
function relationshipIcon(rel) {
  if (!rel) return '👤';
  const r = rel.toLowerCase();
  if (r === 'spouse') return '❤️';
  if (r === 'father' || r === 'mother' || r === 'parent') return '👨‍👩‍👧';
  if (r === 'child' || r === 'son' || r === 'daughter') return '👶';
  if (r === 'sibling' || r === 'brother' || r === 'sister') return '👫';
  if (r === 'friend') return '🤝';
  return '👤';
}

function relationshipColor(rel) {
  if (!rel) return 'bg-[#f0f3ff] text-[#3525cd]';
  const r = rel.toLowerCase();
  if (r === 'spouse') return 'bg-emerald-50 text-emerald-700';
  if (r === 'child') return 'bg-amber-50 text-amber-700';
  if (r === 'father' || r === 'mother' || r === 'parent') return 'bg-blue-50 text-blue-700';
  return 'bg-[#f0f3ff] text-[#3525cd]';
}

function calcExperience(joiningDate) {
  if (!joiningDate) return '—';
  const diff = Date.now() - new Date(joiningDate).getTime();
  const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30.44));
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} Month${rem !== 1 ? 's' : ''}`;
  if (rem === 0) return `${years} Year${years !== 1 ? 's' : ''}`;
  return `${years} Year${years !== 1 ? 's' : ''} ${rem} Month${rem !== 1 ? 's' : ''}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Shared UI Atoms ──────────────────────────────────────────────────────────

function SectionHeader({ children }) {
  return (
    <h2 className="text-sm font-black text-[#151c27] uppercase tracking-wider">{children}</h2>
  );
}

function PhotoUploadWidget({ currentUrl, initials, color, onUploaded }) {
  const toast    = useToast();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(currentUrl);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      const tk = localStorage.getItem("lt_token") || localStorage.getItem("token") || sessionStorage.getItem("token");
      const res = await fetch("/api/auth/remove-avatar", { method: "DELETE", headers: { Authorization: "Bearer " + tk } });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Remove failed"); }
      setPreview("");
      onUploaded?.("");
    } catch (err) { console.error(err); }
    finally { setRemoving(false); }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB', 'error'); return; }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('lt_token');
      if (!token) { toast('Session expired. Please log in again.', 'error'); setUploading(false); return; }
      const res   = await fetch('/api/auth/upload-avatar', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data  = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setPreview(data.avatar_url);
      onUploaded?.(data.avatar_url);
      toast('Profile photo updated!', 'success');
    } catch (err) {
      toast(err.message, 'error');
      setPreview(currentUrl);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-4 mb-4">
      <div className="relative group flex-shrink-0">
        {preview ? (
          <img src={preview} alt="Profile" className="w-16 h-16 rounded-full object-cover border-2 border-[#c7c4d8] shadow-md" />
        ) : (
          <div className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-black text-white shadow-md" style={{ background: color }}>
            {initials}
          </div>
        )}
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {uploading ? <div className="spinner w-4 h-4 border-white" /> : <Camera size={16} className="text-white" />}
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      <div>
        <p className="text-xs font-semibold text-[#151c27]">Profile Photo</p>
        <div className="flex items-center gap-2 flex-wrap mt-0.5">
          <button onClick={() => inputRef.current?.click()} disabled={uploading || removing} className="text-[0.65rem] text-[#3525cd] hover:underline">
            {uploading ? 'Uploading…' : preview ? 'Change photo' : 'Upload photo'}
          </button>
          {preview && (
            <button onClick={handleRemove} disabled={removing || uploading} className="text-[0.65rem] text-rose-500 hover:underline">
              {removing ? 'Removing…' : 'Remove photo'}
            </button>
          )}
        </div>
        <p className="text-[0.6rem] text-[#c7c4d8] mt-0.5">JPG, PNG — max 5 MB</p>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, label, onAdd, addLabel }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-[#f0f3ff] flex items-center justify-center mb-3">
        <Icon size={24} className="text-[#3525cd]" />
      </div>
      <p className="text-sm font-semibold text-[#464555] mb-1">No {label} added yet</p>
      <p className="text-xs text-[#777587] mb-4">Add your {label} to complete your profile</p>
      {onAdd && (
        <button onClick={onAdd} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={14} /> {addLabel || `Add ${label}`}
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <span className="spinner w-6 h-6" />
    </div>
  );
}

function InfoPill({ icon: Icon, text }) {
  if (!text) return null;
  return (
    <span className="flex items-center gap-1 text-xs text-[#464555]">
      {Icon && <Icon size={13} className="text-[#777587]" />}
      {text}
    </span>
  );
}

// ─── PROFILE PRINT MODAL ─────────────────────────────────────────────────────

function ProfilePrintModal({ empId, open, onClose }) {
  const toast = useToast();
  const branchesEnabled = useFeature('branches');
  const { data: ov }  = useQuery({ queryKey: ['profile-overview', empId], queryFn: () => apiGet(`/profile/${empId}/overview`), enabled: !!empId && open });
  const { data: per } = useQuery({ queryKey: ['profile-personal',  empId], queryFn: () => apiGet(`/profile/${empId}/personal`),  enabled: !!empId && open });

  useEffect(() => {
    if (!open) return;
    const style = document.createElement('style');
    style.id = 'print-profile-style';
    style.textContent = `
      @media print {
        body > * { visibility: hidden !important; }
        #profile-print-root, #profile-print-root * { visibility: visible !important; }
        #profile-print-root {
          position: fixed; top: 0; left: 0; width: 100%; height: auto;
          z-index: 99999; background: white; padding: 2rem;
        }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById('print-profile-style')?.remove(); };
  }, [open]);

  if (!open) return null;

  const name      = [ov?.salutation, ov?.name, ov?.middle_name, ov?.surname].filter(Boolean).join(' ') || ov?.name || '—';
  const address   = [per?.current_address_line1, per?.current_address_line2, per?.current_city, per?.current_state, per?.current_country].filter(Boolean).join(', ');
  const permAddr  = [per?.permanent_address, per?.permanent_city, per?.permanent_state, per?.permanent_country].filter(Boolean).join(', ');
  const empType   = (ov?.employment_type || 'full_time').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  function Row({ label, value }) {
    if (!value) return null;
    return (
      <div className="flex gap-2 py-1.5 border-b border-gray-100 last:border-0">
        <span className="text-[0.7rem] font-semibold text-gray-500 w-36 flex-shrink-0">{label}</span>
        <span className="text-[0.75rem] font-semibold text-gray-800 flex-1">{value}</span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      {/* Dismiss backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

      <div id="profile-print-root" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto mx-4">
        {/* Header bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 print:hidden">
          <span className="text-sm font-black text-[#151c27]">Employee Profile</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { window.print(); toast('Profile downloaded successfully.', 'success'); }}
              className="btn btn-primary btn-sm flex items-center gap-1.5"
            >
              <Printer size={13} /> Save as PDF
            </button>
            <button onClick={onClose} className="btn btn-ghost btn-sm text-[#777587]">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── PRINT CONTENT ── */}
        <div className="p-6 space-y-5">

          {/* Profile header */}
          <div className="flex items-start gap-5">
            {ov?.profile_photo_url
              ? <img src={ov.profile_photo_url} alt={name} className="w-20 h-20 rounded-xl object-cover border border-gray-200 flex-shrink-0" />
              : (
                <div className="w-20 h-20 rounded-xl flex items-center justify-center text-white text-2xl font-black flex-shrink-0"
                  style={{ background: ov?.avatar_color || '#3525cd' }}>
                  {initials(ov?.name || '')}
                </div>
              )
            }
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black text-[#151c27]">{name}</h1>
              <p className="text-sm font-bold text-[#464555] mt-0.5">{ov?.position || '—'}</p>
              <p className="text-xs text-[#777587] mt-0.5">{ov?.department || '—'}</p>
              <div className="flex flex-wrap gap-3 mt-3 text-xs text-[#464555]">
                {ov?.email    && <span><strong>Email:</strong> {ov.email}</span>}
                {ov?.phone    && <span><strong>Phone:</strong> {ov.phone}</span>}
                {ov && <span><strong>ID:</strong> {ov.employee_id || ov.device_enrollment_id || `EMP${String(ov.id || '').padStart(3, '0')}`}</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="text-xs font-black px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 capitalize">
                {ov?.employee_status || 'Active'}
              </span>
              <p className="text-[0.65rem] text-gray-400 mt-2">Lumos Logic HRMS</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Professional Info */}
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[0.65rem] font-black text-[#3525cd] uppercase tracking-widest mb-3">Professional Information</p>
              <Row label="Employee ID"      value={ov ? (ov.employee_id || ov.device_enrollment_id || `EMP${String(ov.id || '').padStart(3, '0')}`) : undefined} />
              <Row label="Department"       value={ov?.department} />
              <Row label="Position / Title" value={ov?.position} />
              <Row label="Grade"            value={ov?.grade} />
              <Row label="Employment Type"  value={empType} />
              <Row label="Employee Status"  value={ov?.employee_status} />
              <Row label="Joining Date"     value={ov?.joining_date ? fmtDate(ov.joining_date) : null} />
              <Row label="Work Location"    value={ov?.location} />
              <Row label="Work Hours/Day"   value={ov?.work_hours_per_day != null ? `${ov.work_hours_per_day} hrs` : null} />
              <Row label="Weekly Off"       value={ov?.weekly_off_day} />
              {branchesEnabled && <Row label="Branch" value={ov?.branch?.name} />}
              <Row label="Reporting To"     value={ov?.manager?.name} />
              <Row label="HOD"              value={ov?.hod?.name} />
              <Row label="Cost Centre"      value={ov?.cost_centre} />
            </div>

            {/* Personal Info */}
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[0.65rem] font-black text-[#3525cd] uppercase tracking-widest mb-3">Personal Information</p>
              <Row label="Date of Birth"   value={per?.date_of_birth   ? fmtDate(per.date_of_birth) : null} />
              <Row label="Gender"          value={per?.gender} />
              <Row label="Blood Group"     value={per?.blood_group} />
              <Row label="Marital Status"  value={per?.marital_status} />
              <Row label="Nationality"     value={per?.nationality} />
              <Row label="Personal Email"  value={per?.personal_email} />
            </div>
          </div>

          {/* Address */}
          {(address || permAddr) && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[0.65rem] font-black text-[#3525cd] uppercase tracking-widest mb-3">Address</p>
              {address   && <Row label="Current Address"   value={address} />}
              {permAddr  && <Row label="Permanent Address" value={permAddr} />}
            </div>
          )}

          {/* Section counts */}
          {ov?.sectionCounts && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-[0.65rem] font-black text-[#3525cd] uppercase tracking-widest mb-3">Profile Sections</p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['Education',   ov.sectionCounts.education],
                  ['Experience',  ov.sectionCounts.experience],
                  ['Skills',      ov.sectionCounts.skills],
                  ['Family',      ov.sectionCounts.family],
                  ['Documents',   ov.sectionCounts.documents],
                  ['Banking',     ov.sectionCounts.banking],
                ].map(([label, count]) => (
                  <div key={label} className="text-center bg-white rounded-lg py-2 border border-gray-200">
                    <p className="text-lg font-black text-[#3525cd]">{count}</p>
                    <p className="text-[0.65rem] font-semibold text-gray-500">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-center text-[0.65rem] text-gray-400 pt-2 border-t border-gray-100">
            Generated by Lumos Logic HRMS · {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── PROFILE ACTIONS ─────────────────────────────────────────────────────────

function ProfileActions({ empId, onTabChange }) {
  const [dropOpen,  setDropOpen]  = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setDropOpen(false); }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function goToTab(tab) {
    onTabChange(tab);
    setDropOpen(false);
    setTimeout(() => {
      document.getElementById('profile-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  return (
    <>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[#f0f3ff]">
        <button
          onClick={() => goToTab('account')}
          className="btn btn-primary btn-sm flex items-center gap-1.5"
        >
          <Pencil size={13} /> Edit Profile
        </button>
        <button
          onClick={() => setPrintOpen(true)}
          className="btn btn-outline btn-sm flex items-center gap-1.5"
        >
          <Download size={13} /> Download Profile
        </button>
        <div className="relative ml-auto" ref={ref}>
          <button
            onClick={() => setDropOpen(o => !o)}
            className="btn btn-ghost btn-icon btn-sm text-[#777587]"
          >
            <MoreHorizontal size={16} />
          </button>
          {dropOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-[#c7c4d8] rounded-xl shadow-lg z-50 min-w-[180px] py-1">
              <button onClick={() => goToTab('account')} className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#464555] hover:bg-[#f0f3ff] flex items-center gap-2">
                <Settings size={13} className="text-[#777587]" /> Account Settings
              </button>
              <button onClick={() => { setDropOpen(false); goToTab('account'); }} className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#464555] hover:bg-[#f0f3ff] flex items-center gap-2">
                <ShieldCheck size={13} className="text-[#777587]" /> Security &amp; 2FA
              </button>
              <button onClick={() => { setDropOpen(false); setPrintOpen(true); }} className="w-full text-left px-4 py-2.5 text-xs font-semibold text-[#464555] hover:bg-[#f0f3ff] flex items-center gap-2">
                <Printer size={13} className="text-[#777587]" /> Download Profile
              </button>
            </div>
          )}
        </div>
      </div>
      <ProfilePrintModal empId={empId} open={printOpen} onClose={() => setPrintOpen(false)} />
    </>
  );
}

// ─── PROFILE HEADER CARD ─────────────────────────────────────────────────────

function ProfileHeaderCard({ empId, onTabChange }) {
  const branchesEnabled = useFeature('branches');
  const { data, isLoading } = useQuery({
    queryKey: ['profile-overview', empId],
    queryFn: () => apiGet(`/profile/${empId}/overview`),
    enabled: !!empId,
  });

  if (isLoading) return <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-6 animate-pulse h-36" />;
  if (!data) return null;

  const name = data.name || '—';
  const position = data.position || '—';
  const empNo = data.employee_id || data.device_enrollment_id || `EMP${String(data.id || '').padStart(3, '0')}`;
  const department = data.department || '—';
  const branchName = data.branch?.name || null;
  const employmentType = (data.employment_type || 'full_time').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const managerName = data.manager?.name || null;
  const managerPos = data.manager?.position || null;
  const hodName = data.hod?.name || null;
  const joiningDate = data.joining_date;
  const experience = calcExperience(joiningDate);
  const phone = data.phone || '—';
  const email = data.email || '—';
  const status = data.employee_status || 'active';
  const avatarColor = data.avatar_color || '#3525cd';
  const profilePhoto = data.avatar_url || data.profile_photo_url || null;

  const workLocation = [data.current_city, data.current_state].filter(Boolean).join(', ')
    || branchName
    || '—';

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
      <div className="flex flex-col sm:flex-row items-start gap-5">
        {/* Left: status + avatar + info */}
        <div className="flex items-start gap-4 flex-1 min-w-0">
          {/* Active badge stacked above avatar */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-2 py-0.5 rounded-full capitalize">
              {status}
            </span>
            {profilePhoto ? (
              <img
                src={profilePhoto}
                alt={name}
                className="w-20 h-20 rounded-full object-cover border-2 border-[#c7c4d8] shadow"
              />
            ) : (
              <div
                className="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-black border-2 border-white shadow-md"
                style={{ background: avatarColor }}
              >
                {initials(name)}
              </div>
            )}
          </div>

          {/* Name / position / pills */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h1 className="text-xl font-black text-[#151c27]">{name}</h1>
              <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
            </div>
            <p className="text-sm text-[#464555] mt-0.5">{position}</p>

            <div className="flex flex-wrap items-center gap-3 mt-2">
              <InfoPill icon={Building2} text={empNo} />
              <InfoPill icon={Layers} text={department} />
              {branchesEnabled && branchName && <InfoPill icon={MapPin} text={branchName} />}
              <InfoPill icon={Clock} text={employmentType} />
            </div>

            {managerName && (
              <p className="text-xs text-[#777587] mt-2">
                Reporting To: <span className="font-semibold text-[#464555]">{managerName}{managerPos ? ` (${managerPos})` : ''}</span>
              </p>
            )}
            {hodName && (
              <p className="text-xs text-[#777587] mt-1">
                HOD: <span className="font-semibold text-[#464555]">{hodName}</span>
              </p>
            )}

            {joiningDate && (
              <p className="text-xs text-[#777587] mt-1">
                Joined on {fmtDate(joiningDate)}
                {experience && experience !== '—' ? <span className="ml-1">• {experience}</span> : null}
              </p>
            )}
          </div>
        </div>

        {/* Right: 2x2 contact grid */}
        <div className="sm:w-64 flex-shrink-0 grid grid-cols-1 gap-1.5 w-full sm:self-start">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[#f8f9ff] border border-[#f0f3ff]">
            <Mail size={13} className="text-[#3525cd] flex-shrink-0" />
            <span className="text-xs text-[#464555] truncate">{email}</span>
            <Check size={11} className="text-emerald-500 ml-auto flex-shrink-0" />
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[#f8f9ff] border border-[#f0f3ff]">
            <Phone size={13} className="text-[#3525cd] flex-shrink-0" />
            <span className="text-xs text-[#464555] truncate">{phone}</span>
            <Check size={11} className="text-emerald-500 ml-auto flex-shrink-0" />
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[#f8f9ff] border border-[#f0f3ff]">
            <MapPin size={13} className="text-[#3525cd] flex-shrink-0" />
            <span className="text-xs text-[#464555] truncate">{workLocation}</span>
            <Check size={11} className="text-emerald-500 ml-auto flex-shrink-0" />
          </div>
          <div className="flex items-center gap-2 p-2 rounded-lg bg-[#f8f9ff] border border-[#f0f3ff]">
            <BadgeCheck size={13} className="text-[#3525cd] flex-shrink-0" />
            <span className="text-xs text-[#464555] truncate">
              {employmentType === 'Full Time' ? 'Permanent' : employmentType}
            </span>
            <Check size={11} className="text-emerald-500 ml-auto flex-shrink-0" />
          </div>
        </div>
      </div>

      {/* Actions row */}
      <ProfileActions empId={empId} onTabChange={onTabChange} />
    </div>
  );
}

// ─── OVERVIEW TAB ────────────────────────────────────────────────────────────

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12  = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function OverviewTab({ empId }) {
  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ['profile-overview', empId],
    queryFn: () => apiGet(`/profile/${empId}/overview`),
    enabled: !!empId,
  });

  const { data: leaves = [] } = useQuery({
    queryKey: ['leaves'],
    queryFn: () => apiGet('/leaves'),
  });

  // BUG_182: use the proper /leaves/balance endpoint (same as MyLeaves page)
  // instead of computing from /leave-policies which returns 0 when policies aren't configured
  const { data: leaveBalanceData } = useQuery({
    queryKey: ['my-leave-balance-profile', new Date().getFullYear()],
    queryFn: () => apiGet('/leaves/balance'),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch today's shift assignment for this employee
  const todayDate  = new Date().toISOString().split('T')[0];
  const monthStr   = todayDate.slice(0, 7);
  const { data: shiftAssignments = [] } = useQuery({
    queryKey: ['my-shift-profile', monthStr],
    queryFn:  () => apiGet('/shifts/assignments', { month: monthStr }),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // BUG_182: find today's specific assignment first; fall back to any assignment
  // this month (same shift definition applies for all working days)
  const todayShift = shiftAssignments.find(a => a.date === todayDate)?.shift
    || (shiftAssignments.length > 0 ? shiftAssignments[shiftAssignments.length - 1]?.shift : null);

  if (ovLoading) return <Spinner />;
  if (!overview) return null;

  const joiningDate = overview.joining_date;
  const experience = calcExperience(joiningDate);
  const managerName = overview.manager?.name || overview.manager_name || '—';

  // BUG_182: compute leave balance from the /leaves/balance API (accurate, respects adjustments)
  const balances = leaveBalanceData?.balances || [];
  const leaveBalance = balances.reduce((sum, b) => sum + (b.remaining ?? 0), 0);
  const totalAlloc   = balances.reduce((sum, b) => sum + (b.allocated || 0), 0);

  // Today's attendance from overview
  const todayAtt = overview.todayAttendance || null;
  const attStatus = todayAtt?.status || null;
  const checkInTime = todayAtt?.check_in ? fmtTime(todayAtt.check_in.slice(0, 5)) : null;

  // Recent activity synthesis
  const recentLeaves = [...leaves]
    .sort((a, b) => new Date(b.created_at || b.start_date) - new Date(a.created_at || a.start_date))
    .slice(0, 3);

  const activities = [
    todayAtt && {
      icon: Clock,
      color: 'bg-emerald-50 text-emerald-600',
      title: attStatus === 'present' ? 'Checked In' : attStatus === 'absent' ? 'Marked Absent' : 'Attendance Recorded',
      desc: checkInTime ? `Check-in at ${checkInTime}` : 'Today',
      time: 'Today',
    },
    ...recentLeaves.map(l => ({
      icon: Umbrella,
      color: 'bg-[#f0f3ff] text-[#3525cd]',
      title: `Leave ${l.status === 'approved' ? 'Approved' : l.status === 'rejected' ? 'Rejected' : 'Applied'}`,
      desc: `${fmtDate(l.start_date)} – ${fmtDate(l.end_date)}`,
      time: timeAgo(l.created_at || l.start_date),
    })),
  ].filter(Boolean).slice(0, 4);

  const summaryCards = [
    { label: 'Employee ID',       value: overview.employee_id || overview.device_enrollment_id || `EMP${String(overview.id || '').padStart(3, '0')}`, icon: BadgeCheck },
    { label: 'Department',        value: overview.department || '—',                          icon: Layers },
    { label: 'Position / Title',  value: overview.position || '—',                           icon: Briefcase },
    { label: 'Joining Date',      value: joiningDate ? fmtDate(joiningDate) : '—',            icon: Calendar },
    { label: 'Experience',        value: experience,                                           icon: TrendingUp },
    { label: 'Reporting Manager', value: managerName,                                          icon: User },
  ];

  return (
    <div className="space-y-5">
      {/* Employee Summary Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {summaryCards.map(card => (
          <div key={card.label} className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 mb-1">
              <card.icon size={13} className="text-[#3525cd]" />
              <span className="text-[10px] font-bold text-[#777587] uppercase tracking-wide">{card.label}</span>
            </div>
            <span className="text-sm font-black text-[#151c27] leading-tight">{card.value}</span>
          </div>
        ))}
      </div>

      {/* Two-column: Snapshot + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Today's Snapshot */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
          <div className="p-5 border-b border-[#f0f3ff]">
            <SectionHeader>Today's Snapshot</SectionHeader>
          </div>
          <div className="p-4 grid grid-cols-2 gap-3">
            {/* Attendance */}
            <div className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock size={13} className="text-[#3525cd]" />
                <span className="text-xs font-bold text-[#777587] uppercase tracking-wide">Attendance</span>
              </div>
              {attStatus ? (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${
                  attStatus === 'present' ? 'bg-emerald-50 text-emerald-700' :
                  attStatus === 'absent'  ? 'bg-rose-50 text-rose-700' :
                  'bg-amber-50 text-amber-700'
                }`}>{attStatus.replace('_', ' ')}</span>
              ) : (
                <span className="text-xs font-bold text-[#777587]">Not recorded</span>
              )}
              {checkInTime && <p className="text-xs text-[#464555] mt-1">In: {checkInTime}</p>}
              <Link to="/portal/attendance" className="text-xs text-[#3525cd] font-semibold mt-2 flex items-center gap-0.5 hover:underline">
                View Attendance <ChevronRight size={11} />
              </Link>
            </div>

            {/* Leave Balance */}
            <div className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-center gap-1.5 mb-2">
                <Umbrella size={13} className="text-[#3525cd]" />
                <span className="text-xs font-bold text-[#777587] uppercase tracking-wide">Leave Balance</span>
              </div>
              <p className="text-2xl font-black text-[#151c27]">{leaveBalance} <span className="text-sm font-semibold text-[#777587]">Days</span></p>
              <p className="text-xs text-[#777587]">Total Alloc: {totalAlloc}</p>
              <Link to="/portal/leaves" className="text-xs text-[#3525cd] font-semibold mt-2 flex items-center gap-0.5 hover:underline">
                View Leave <ChevronRight size={11} />
              </Link>
            </div>

            {/* Current Shift */}
            <div className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-center gap-1.5 mb-2">
                <Activity size={13} className="text-[#3525cd]" />
                <span className="text-xs font-bold text-[#777587] uppercase tracking-wide">Current Shift</span>
              </div>
              <p className="text-sm font-bold text-[#151c27]">
                {todayShift ? todayShift.name : 'No shift today'}
              </p>
              {todayShift && (
                <p className="text-xs text-[#777587]">
                  {fmt12(todayShift.start_time)} – {fmt12(todayShift.end_time)}
                </p>
              )}
              <Link to="/portal/attendance" className="text-xs text-[#3525cd] font-semibold mt-2 flex items-center gap-0.5 hover:underline">
                View Schedule <ChevronRight size={11} />
              </Link>
            </div>

            {/* Performance */}
            <div className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-center gap-1.5 mb-2">
                <Star size={13} className="text-[#3525cd]" />
                <span className="text-xs font-bold text-[#777587] uppercase tracking-wide">Performance</span>
              </div>
              <p className="text-lg font-black text-[#151c27]">4.6 <span className="text-sm font-semibold text-[#777587]">/ 5</span></p>
              <div className="flex gap-0.5 mt-0.5">
                {[1,2,3,4,5].map(i => (
                  <Star key={i} size={10} className={i <= 4 ? 'text-amber-400 fill-amber-400' : 'text-[#c7c4d8]'} />
                ))}
              </div>
              <Link to="/portal/performance" className="text-xs text-[#3525cd] font-semibold mt-2 flex items-center gap-0.5 hover:underline">
                View Performance <ChevronRight size={11} />
              </Link>
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
          <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
            <SectionHeader>Recent Activity</SectionHeader>
            <Link to="/portal/attendance" className="text-xs text-[#3525cd] font-semibold hover:underline">View All</Link>
          </div>
          <div className="p-4 space-y-3">
            {activities.length === 0 ? (
              <p className="text-sm text-[#777587] text-center py-4">No recent activity</p>
            ) : (
              activities.map((act, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${act.color}`}>
                    <act.icon size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#151c27]">{act.title}</p>
                    <p className="text-xs text-[#777587] truncate">{act.desc}</p>
                  </div>
                  <span className="text-xs text-[#c7c4d8] flex-shrink-0">{act.time}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Two-column: Personal Info + Contact & Address */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <PersonalInfoReadCard empId={empId} />
        <ContactAddressReadCard empId={empId} />
      </div>
    </div>
  );
}

// Overview read-only cards

function PersonalInfoReadCard({ empId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['profile-personal', empId],
    queryFn: () => apiGet(`/profile/${empId}/personal`),
    enabled: !!empId,
  });

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Personal Information</SectionHeader>
      </div>
      {isLoading ? <Spinner /> : (
        <div className="p-5 grid grid-cols-2 gap-4">
          {[
            { label: 'Full Name',     value: data?.full_name || data?.name },
            { label: 'Date of Birth', value: data?.date_of_birth ? fmtDate(data.date_of_birth) : null },
            { label: 'Gender',        value: data?.gender },
            { label: 'Blood Group',   value: data?.blood_group },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-[#777587] mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-[#151c27]">{value || '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactAddressReadCard({ empId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['profile-personal', empId],
    queryFn: () => apiGet(`/profile/${empId}/personal`),
    enabled: !!empId,
  });

  const currentAddr = [
    data?.current_address_line1,
    data?.current_address_line2,
    data?.current_city,
    data?.current_state,
    data?.current_country,
    data?.current_postal_code,
  ].filter(Boolean).join(', ');

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Contact &amp; Address</SectionHeader>
      </div>
      {isLoading ? <Spinner /> : (
        <div className="p-5 space-y-3">
          {[
            { label: 'Phone',             value: data?.phone },
            { label: 'Personal Email',    value: data?.personal_email },
            { label: 'Current Address',   value: currentAddr },
            { label: 'Permanent Address', value: data?.permanent_address },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-[#777587] mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-[#151c27]">{value || '—'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── PERSONAL TAB ────────────────────────────────────────────────────────────

function PersonalSection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [contactErrors, setContactErrors] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ['profile-personal', empId],
    queryFn: () => apiGet(`/profile/${empId}/personal`),
    enabled: !!empId,
  });

  const [form, setForm] = useState(null);
  React.useEffect(() => {
    if (data && !form) {
      setForm({
        phone: data.phone || '',
        personal_email: data.personal_email || '',
        current_address_line1: data.current_address_line1 || '',
        current_address_line2: data.current_address_line2 || '',
        current_city: data.current_city || '',
        current_state: data.current_state || '',
        current_country: data.current_country || '',
        current_postal_code: data.current_postal_code || '',
        permanent_address: data.permanent_address || '',
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => apiPut(`/profile/${empId}/personal`, form),
    onSuccess: () => {
      toast('Personal info updated.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-personal', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  if (isLoading) return <Spinner />;

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5">
      {/* Editable: Contact & Address */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
        <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
          <SectionHeader>Contact &amp; Address</SectionHeader>
        </div>
        {form && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Phone</label>
                <input className={`form-control ${contactErrors.phone ? 'border-rose-400' : ''}`} value={form.phone} onChange={e => { setF('phone', e.target.value); setContactErrors(er => ({ ...er, phone: undefined })); }} placeholder="+91 98765 43210" />
                {contactErrors.phone && <p className="text-xs text-rose-600 mt-1">{contactErrors.phone}</p>}
              </div>
              <div>
                <label className="form-label">Personal Email</label>
                <input className={`form-control ${contactErrors.personal_email ? 'border-rose-400' : ''}`} type="email" value={form.personal_email} onChange={e => { setF('personal_email', e.target.value); setContactErrors(er => ({ ...er, personal_email: undefined })); }} placeholder="personal@email.com" />
                {contactErrors.personal_email && <p className="text-xs text-rose-600 mt-1">{contactErrors.personal_email}</p>}
              </div>
            </div>
            <div>
              <label className="form-label">Address Line 1</label>
              <input className={`form-control ${contactErrors.current_address_line1 ? 'border-rose-400' : ''}`} value={form.current_address_line1} onChange={e => { setF('current_address_line1', e.target.value); setContactErrors(er => ({ ...er, current_address_line1: undefined })); }} placeholder="House/Flat no, Street" />
              {contactErrors.current_address_line1 && <p className="text-xs text-rose-600 mt-1">{contactErrors.current_address_line1}</p>}
            </div>
            <div>
              <label className="form-label">Address Line 2</label>
              <input className="form-control" value={form.current_address_line2} onChange={e => setF('current_address_line2', e.target.value)} placeholder="Area, Landmark" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="form-label">City</label>
                <input className={`form-control ${contactErrors.current_city ? 'border-rose-400' : ''}`} value={form.current_city} onChange={e => { setF('current_city', e.target.value); setContactErrors(er => ({ ...er, current_city: undefined })); }} placeholder="City" />
                {contactErrors.current_city && <p className="text-xs text-rose-600 mt-1">{contactErrors.current_city}</p>}
              </div>
              <div>
                <label className="form-label">State</label>
                <input className={`form-control ${contactErrors.current_state ? 'border-rose-400' : ''}`} value={form.current_state} onChange={e => { setF('current_state', e.target.value); setContactErrors(er => ({ ...er, current_state: undefined })); }} placeholder="State" />
                {contactErrors.current_state && <p className="text-xs text-rose-600 mt-1">{contactErrors.current_state}</p>}
              </div>
              <div>
                <label className="form-label">Country</label>
                <input className={`form-control ${contactErrors.current_country ? 'border-rose-400' : ''}`} value={form.current_country} onChange={e => { setF('current_country', e.target.value); setContactErrors(er => ({ ...er, current_country: undefined })); }} placeholder="Country" />
                {contactErrors.current_country && <p className="text-xs text-rose-600 mt-1">{contactErrors.current_country}</p>}
              </div>
              <div>
                <label className="form-label">PIN Code</label>
                <input className={`form-control ${contactErrors.current_postal_code ? 'border-rose-400' : ''}`} value={form.current_postal_code} onChange={e => { setF('current_postal_code', e.target.value); setContactErrors(er => ({ ...er, current_postal_code: undefined })); }} placeholder="400001" />
                {contactErrors.current_postal_code && <p className="text-xs text-rose-600 mt-1">{contactErrors.current_postal_code}</p>}
              </div>
            </div>
            <div>
              {/* ENH_PROFILE_003: Same as Current Address checkbox */}
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Permanent Address</label>
                <label className="flex items-center gap-1.5 text-xs text-[#777587] cursor-pointer hover:text-[#3525cd] transition-colors">
                  <input type="checkbox" className="w-3.5 h-3.5 accent-[#3525cd]"
                    onChange={e => {
                      if (e.target.checked) {
                        const currentAddr = [form.current_address_line1, form.current_address_line2, form.current_city, form.current_state, form.current_country, form.current_postal_code].filter(Boolean).join(', ');
                        setF('permanent_address', currentAddr);
                      }
                    }} />
                  Same as Current Address
                </label>
              </div>
              <textarea className="form-control" rows={3} value={form.permanent_address} onChange={e => setF('permanent_address', e.target.value)} placeholder="Permanent / native address" />
            </div>
            <button onClick={() => {
              const errs = {};
              if (form.phone && !/^\+?[\d\s\-]{7,15}$/.test(form.phone.trim())) errs.phone = 'Enter a valid phone number (7-15 digits).';
              if (form.personal_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personal_email.trim())) errs.personal_email = 'Enter a valid email address.';
              if (form.current_address_line1 && form.current_address_line1.trim().length > 200) errs.current_address_line1 = 'Address must be under 200 characters.';
              if (form.current_city && /\d/.test(form.current_city)) errs.current_city = 'City should contain letters only.';
              if (form.current_state && /\d/.test(form.current_state)) errs.current_state = 'State should contain letters only.';
              if (form.current_country && !/[a-zA-Z]/.test(form.current_country)) errs.current_country = 'Country must contain letters.';
              if (form.current_postal_code && !/^\d{4,10}$/.test(form.current_postal_code.trim())) errs.current_postal_code = 'PIN Code must be 4-10 digits.';
              setContactErrors(errs);
              if (Object.keys(errs).length > 0) return;
              saveMutation.mutate();
            }} disabled={saveMutation.isPending}
              className="btn btn-primary btn-sm flex items-center gap-2">
              {saveMutation.isPending ? <><span className="spinner w-3.5 h-3.5" /> Saving…</> : <><Save size={14} /> Save Changes</>}
            </button>
          </div>
        )}
      </div>

      {/* Read-only: Identity */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
        <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
          <SectionHeader>Identity (HR Managed)</SectionHeader>
          <span className="text-xs text-[#777587] bg-amber-50 border border-amber-200 text-amber-700 rounded-md px-2 py-0.5">Contact HR to update</span>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: 'Full Name',      val: data?.full_name || data?.name },
              { label: 'Gender',         val: data?.gender },
              { label: 'Date of Birth',  val: data?.date_of_birth ? fmtDate(data.date_of_birth) : null },
              { label: 'Blood Group',    val: data?.blood_group },
              { label: 'Marital Status', val: data?.marital_status },
              { label: 'Nationality',    val: data?.nationality },
              { label: 'Religion',       val: data?.religion },
            ].map(({ label, val }) => (
              <div key={label}>
                <label className="form-label">{label}</label>
                <input className="form-control bg-[#f8f9ff] text-[#464555]" readOnly value={val || '—'} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FAMILY SECTION ──────────────────────────────────────────────────────────

const FAMILY_BLANK = { relationship: '', name: '', date_of_birth: '', gender: '', occupation: '', contact_number: '', dependent: false };

function FamilySection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(FAMILY_BLANK);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['profile-family', empId],
    queryFn: () => apiGet(`/profile/${empId}/family`),
    enabled: !!empId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? apiPut(`/profile/${empId}/family/${editing.id}`, form)
      : apiPost(`/profile/${empId}/family`, form),
    onSuccess: () => {
      toast(editing ? 'Family member updated.' : 'Family member added.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-family', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
      setModalOpen(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: id => apiDelete(`/profile/${empId}/family/${id}`),
    onSuccess: () => {
      toast('Family member removed.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-family', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  function openAdd() { setEditing(null); setForm(FAMILY_BLANK); setModalOpen(true); }
  function openEdit(m) {
    setEditing(m);
    setForm({ relationship: m.relationship || '', name: m.name || '', date_of_birth: m.date_of_birth || '', gender: m.gender || '', occupation: m.occupation || '', contact_number: m.contact_number || '', dependent: m.dependent || false });
    setModalOpen(true);
  }
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (isLoading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Family Members</SectionHeader>
        <button onClick={openAdd} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={13} /> Add Member
        </button>
      </div>

      {members.length === 0 ? (
        <EmptyState icon={Users} label="family members" onAdd={openAdd} addLabel="Add Family Member" />
      ) : (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {members.map(m => (
            <div key={m.id} className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${relationshipColor(m.relationship)} flex items-center gap-1`}>
                      <span>{relationshipIcon(m.relationship)}</span>{m.relationship || '—'}
                    </span>
                    {/* ENH_PROFILE_005: Emergency Contact indicator */}
                    {m.is_emergency && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">🚨 Emergency Contact</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-[#151c27] mt-2 truncate">{m.name}</p>
                  {m.date_of_birth && <p className="text-xs text-[#777587]">DOB: {fmtDate(m.date_of_birth)}</p>}
                  {m.occupation && <p className="text-xs text-[#777587]">{m.occupation}</p>}
                  {m.dependent && <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 mt-1 inline-block">Dependent</span>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(m)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-[#3525cd]"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteTarget(m)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Family Member' : 'Add Family Member'} size="md"
        footer={<><button className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          if (!form.relationship) { toast('Relationship is required.', 'error'); return; }
          if (!form.name.trim()) { toast('Full name is required.', 'error'); return; }
          if (form.contact_number && !/^\+?[\d\s\-]{7,15}$/.test(form.contact_number.trim())) { toast('Enter a valid contact number (7-15 digits).', 'error'); return; }
          if (form.occupation && !/[a-zA-Z]/.test(form.occupation)) { toast('Occupation must contain letters.', 'error'); return; }
          saveMut.mutate();
        }} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Relationship *</label>
              <select className="form-control" value={form.relationship} onChange={e => setF('relationship', e.target.value)}>
                <option value="">Select…</option>
                {['father','mother','spouse','child','sibling','other'].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Gender</label>
              <select className="form-control" value={form.gender} onChange={e => setF('gender', e.target.value)}>
                <option value="">Select…</option>
                {['male','female','other'].map(g => <option key={g} value={g}>{g.charAt(0).toUpperCase()+g.slice(1)}</option>)}
              </select>
              {form.gender === 'other' && (
                <input className="form-control mt-2" value={form.gender_specify || ''} onChange={e => setF('gender_specify', e.target.value)} placeholder="Please specify gender" />
              )}
            </div>
          </div>
          <div>
            <label className="form-label">Full Name *</label>
            <input className="form-control" value={form.name} onChange={e => setF('name', e.target.value)} placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Date of Birth</label>
              <input type="date" className="form-control" value={form.date_of_birth} onChange={e => setF('date_of_birth', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Contact Number</label>
              <input className="form-control" value={form.contact_number} onChange={e => setF('contact_number', e.target.value)} placeholder="+91 98765 43210" />
              {form.contact_number && !/^\+?[\d\s\-]{7,15}$/.test(form.contact_number.trim()) && (
                <p className="text-xs text-rose-600 mt-1">Enter a valid contact number.</p>
              )}
            </div>
          </div>
          <div>
            <label className="form-label">Occupation</label>
            <input className="form-control" value={form.occupation} onChange={e => setF('occupation', e.target.value)} placeholder="e.g. Teacher, Engineer" />
            {form.occupation && !/[a-zA-Z]/.test(form.occupation) && (
              <p className="text-xs text-rose-600 mt-1">Occupation must contain letters.</p>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded" checked={form.dependent} onChange={e => setF('dependent', e.target.checked)} />
            <span className="text-sm text-[#464555]">Financial Dependent</span>
          </label>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Family Member"
        message={`Remove ${deleteTarget?.name} from your family list?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── EDUCATION SECTION ───────────────────────────────────────────────────────

const EDU_BLANK = { degree_level: '', institution: '', board_university: '', specialization: '', from_year: '', to_year: '', year_of_passing: '', result_type: 'percentage', percentage: '', cgpa: '', degree_class: '', education_mode: '', education_country: 'India', enrollment_number: '', remarks: '' };
const DEGREE_LEVELS = ['SSC / 10th','HSC / 12th','Diploma','Graduation','Post Graduation','PhD','Other'];
const EDU_COUNTRIES = ['India','United States','United Kingdom','Canada','Australia','UAE','Singapore','Germany','France','Japan','Other'];

function EducationSection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EDU_BLANK);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['profile-education', empId],
    queryFn: () => apiGet(`/profile/${empId}/education`),
    enabled: !!empId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? apiPut(`/profile/${empId}/education/${editing.id}`, form)
      : apiPost(`/profile/${empId}/education`, form),
    onSuccess: () => {
      toast(editing ? 'Education updated.' : 'Education added.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-education', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
      setModalOpen(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: id => apiDelete(`/profile/${empId}/education/${id}`),
    onSuccess: () => {
      toast('Education record removed.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-education', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  function openAdd() { setEditing(null); setForm(EDU_BLANK); setModalOpen(true); }
  function openEdit(r) {
    setEditing(r);
    setForm({ degree_level: r.degree_level||'', institution: r.institution||'', board_university: r.board_university||'', specialization: r.specialization||'', from_year: r.from_year?String(r.from_year):'', to_year: r.to_year?String(r.to_year):'', year_of_passing: r.year_of_passing?String(r.year_of_passing):'', result_type: r.result_type||'percentage', percentage: r.percentage||'', cgpa: r.cgpa||'', degree_class: r.degree_class||'', education_mode: r.education_mode||'', education_country: r.education_country||'India', enrollment_number: r.enrollment_number||'', remarks: r.remarks||'' });
    setModalOpen(true);
  }
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleSaveEdu() {
    const errs = [];
    if (!form.institution?.trim()) { errs.push('Institution name is required.'); }
    else if (!/[a-zA-Z]/.test(form.institution)) { errs.push('Institution name must contain at least one letter.'); }
    if (form.board_university && !/[a-zA-Z]/.test(form.board_university)) { errs.push('Board / University must contain at least one letter.'); }
    if (form.specialization && !/[a-zA-Z]/.test(form.specialization)) { errs.push('Specialization must contain at least one letter.'); }
    if (form.from_year && form.to_year && Number(form.to_year) < Number(form.from_year)) { errs.push('To Year cannot be before From Year.'); }
    if (form.year_of_passing) {
      if (form.from_year && Number(form.year_of_passing) < Number(form.from_year)) { errs.push('Year of Passing cannot be before From Year.'); }
      if (form.to_year && Number(form.year_of_passing) > Number(form.to_year)) { errs.push('Year of Passing cannot be after To Year.'); }
    }
    if (form.result_type === 'percentage' && form.percentage !== '' && (Number(form.percentage) < 0 || Number(form.percentage) > 100)) { errs.push('Percentage must be between 0 and 100.'); }
    if (form.result_type === 'cgpa' && form.cgpa !== '' && (Number(form.cgpa) < 0 || Number(form.cgpa) > 10)) { errs.push('CGPA must be between 0 and 10.'); }
    if (errs.length > 0) { toast(errs[0], 'error'); return; }
    saveMut.mutate();
  }

  if (isLoading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Education &amp; Qualifications</SectionHeader>
        <button onClick={openAdd} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={13} /> Add
        </button>
      </div>

      {records.length === 0 ? (
        <EmptyState icon={BookOpen} label="education records" onAdd={openAdd} />
      ) : (
        <div className="p-5 space-y-3">
          {records.map((r, idx) => (
            <div key={r.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-[#3525cd] flex-shrink-0 mt-1" />
                {idx < records.length - 1 && <div className="w-px flex-1 bg-[#e8e6f4] mt-1" />}
              </div>
              <div className="flex-1 border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff] mb-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd] uppercase">{r.degree_level || 'Degree'}</span>
                    <p className="text-sm font-bold text-[#151c27] mt-1.5">{r.institution}</p>
                    {r.board_university && <p className="text-xs text-[#777587]">{r.board_university}</p>}
                    {r.specialization && <p className="text-xs text-[#464555]">{r.specialization}</p>}
                    <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-[#777587]">
                      {r.year_of_passing && <span>Year: <strong className="text-[#464555]">{r.year_of_passing}</strong></span>}
                      {r.percentage && <span>%: <strong className="text-[#464555]">{r.percentage}%</strong></span>}
                      {r.cgpa && <span>CGPA: <strong className="text-[#464555]">{r.cgpa}</strong></span>}
                      {r.degree_class && <span>Class: <strong className="text-[#464555]">{r.degree_class}</strong></span>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(r)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-[#3525cd]"><Pencil size={14} /></button>
                    <button onClick={() => setDeleteTarget(r)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-rose-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Qualification' : 'Add Qualification'} size="lg"
        footer={<><button className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={handleSaveEdu} disabled={saveMut.isPending || !form.institution}>{saveMut.isPending ? 'Saving…' : 'Save Qualification'}</button></>}>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="form-label">Degree Level</label>
            <select className="form-control" value={form.degree_level} onChange={e=>setF('degree_level',e.target.value)}>
              <option value="">— Select —</option>
              {DEGREE_LEVELS.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div><label className="form-label">Education Mode</label>
            <select className="form-control" value={form.education_mode} onChange={e=>setF('education_mode',e.target.value)}>
              <option value="">— Select —</option>
              {['Regular','Distance Learning','Online','Part-Time','Full-Time'].map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div><label className="form-label">Institution / School <span className="text-rose-500">*</span></label>
            <input className="form-control" value={form.institution} onChange={e=>setF('institution',e.target.value)} placeholder="e.g. IIT Bombay"/>
          </div>
          <div><label className="form-label">Board / University</label>
            <input className="form-control" value={form.board_university} onChange={e=>setF('board_university',e.target.value)} placeholder="e.g. Mumbai University"/>
          </div>
          <div><label className="form-label">Specialization / Stream</label>
            <input className="form-control" value={form.specialization} onChange={e=>setF('specialization',e.target.value)} placeholder="e.g. Computer Science"/>
          </div>
          <div><label className="form-label">Country</label>
            <select className="form-control" value={form.education_country} onChange={e=>setF('education_country',e.target.value)}>
              {EDU_COUNTRIES.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div><label className="form-label">From Year</label>
            <select className="form-control" value={form.from_year} onChange={e=>setF('from_year',e.target.value)}>
              <option value="">— Select —</option>
              {Array.from({length:new Date().getFullYear()+5-1950+1},(_,i)=>new Date().getFullYear()+5-i).map(y=><option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div><label className="form-label">To Year</label>
            <select className="form-control" value={form.to_year} onChange={e=>setF('to_year',e.target.value)}>
              <option value="">— Select —</option>
              {Array.from({length:new Date().getFullYear()+5-1950+1},(_,i)=>new Date().getFullYear()+5-i).map(y=><option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div><label className="form-label">Year of Passing</label>
            <select className="form-control" value={form.year_of_passing} onChange={e=>setF('year_of_passing',e.target.value)}>
              <option value="">— Select —</option>
              {Array.from({length:new Date().getFullYear()-1950+1},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div><label className="form-label">Enrollment / Roll Number</label>
            <input className="form-control" placeholder="Optional" value={form.enrollment_number} onChange={e=>setF('enrollment_number',e.target.value)}/>
          </div>
          <div className="col-span-2"><label className="form-label">Result Type</label>
            <div className="flex gap-4">
              {['percentage','cgpa'].map(t=>(
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="portal-result-type" value={t} checked={form.result_type===t} onChange={()=>setF('result_type',t)} className="accent-[#3525cd]"/>
                  <span className="text-sm font-semibold text-[#464555]">{t==='percentage'?'Percentage':'CGPA'}</span>
                </label>
              ))}
            </div>
          </div>
          {form.result_type==='percentage' ? (
            <div><label className="form-label">Percentage (%)</label>
              <input className="form-control" type="number" min="0" max="100" step="0.01" value={form.percentage} onChange={e=>setF('percentage',e.target.value)}/>
            </div>
          ) : (
            <div><label className="form-label">CGPA</label>
              <input className="form-control" type="number" min="0" max="10" step="0.01" value={form.cgpa} onChange={e=>setF('cgpa',e.target.value)}/>
            </div>
          )}
          <div><label className="form-label">Class / Division</label>
            <select className="form-control" value={form.degree_class} onChange={e=>setF('degree_class',e.target.value)}>
              <option value="">— Select —</option>
              {['Distinction','First Class','Second Class','Pass','Fail'].map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-2"><label className="form-label">Remarks <span className="text-xs font-normal text-[#777587]">(optional)</span></label>
            <textarea className="form-control" rows={2} placeholder="e.g. Gold Medalist, University Rank Holder…" value={form.remarks} onChange={e=>setF('remarks',e.target.value)}/>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Education Record"
        message={`Remove ${deleteTarget?.institution} from your education history?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── EXPERIENCE SECTION ──────────────────────────────────────────────────────

const EXP_BLANK = { company_name: '', designation: '', industry: '', department: '', employment_type: '', start_date: '', end_date: '', ctc: '', reason_leaving: '', currently_working: false };

function ExperienceSection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EXP_BLANK);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['profile-experience', empId],
    queryFn: () => apiGet(`/profile/${empId}/experience`),
    enabled: !!empId,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { ...form, end_date: form.currently_working ? null : (form.end_date || null) };
      delete payload.currently_working;
      return editing
        ? apiPut(`/profile/${empId}/experience/${editing.id}`, payload)
        : apiPost(`/profile/${empId}/experience`, payload);
    },
    onSuccess: () => {
      toast(editing ? 'Experience updated.' : 'Experience added.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-experience', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
      setModalOpen(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: id => apiDelete(`/profile/${empId}/experience/${id}`),
    onSuccess: () => {
      toast('Experience removed.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-experience', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  function openAdd() { setEditing(null); setForm(EXP_BLANK); setModalOpen(true); }
  function openEdit(r) {
    setEditing(r);
    setForm({ company_name: r.company_name || '', designation: r.designation || '', industry: r.industry || '', department: r.department || '', employment_type: r.employment_type || '', start_date: r.start_date || '', end_date: r.end_date || '', ctc: r.ctc || '', reason_leaving: r.reason_leaving || '', currently_working: !r.end_date });
    setModalOpen(true);
  }
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (isLoading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Work Experience</SectionHeader>
        <button onClick={openAdd} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={13} /> Add
        </button>
      </div>

      {records.length === 0 ? (
        <EmptyState icon={Briefcase} label="work experience" onAdd={openAdd} />
      ) : (
        <div className="p-5 space-y-3">
          {records.map(r => (
            <div key={r.id} className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-[#151c27]">{r.designation || '—'}</p>
                  <p className="text-sm font-bold text-[#3525cd]">{r.company_name}</p>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-[#777587]">
                    {r.employment_type && <span className="bg-[#f0f3ff] text-[#3525cd] px-2 py-0.5 rounded-full font-semibold capitalize">{r.employment_type.replace('_',' ')}</span>}
                    <span>{r.start_date ? fmtDate(r.start_date) : '?'} — {r.end_date ? fmtDate(r.end_date) : <strong className="text-emerald-700">Present</strong>}</span>
                    {r.industry && <span>{r.industry}</span>}
                  </div>
                  {r.ctc && <p className="text-xs text-[#777587] mt-1">CTC: <strong className="text-[#464555]">₹{Number(r.ctc).toLocaleString()}</strong></p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(r)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-[#3525cd]"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteTarget(r)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Experience' : 'Add Experience'} size="lg"
        footer={<><button className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          if (!form.company_name.trim()) { toast('Company name is required.', 'error'); return; }
          if (!form.currently_working && form.start_date && form.end_date && form.end_date <= form.start_date) { toast('End date must be after start date.', 'error'); return; }
          saveMut.mutate();
        }} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</button></>}>
        <div className="space-y-4">
          <div>
            <label className="form-label">Company Name *</label>
            <input className="form-control" value={form.company_name} onChange={e => setF('company_name', e.target.value)} placeholder="Company Pvt. Ltd." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Designation</label>
              <input className="form-control" value={form.designation} onChange={e => setF('designation', e.target.value)} placeholder="Software Engineer" />
            </div>
            <div>
              <label className="form-label">Employment Type</label>
              <select className="form-control" value={form.employment_type} onChange={e => setF('employment_type', e.target.value)}>
                <option value="">Select…</option>
                {[['full_time','Full Time'],['part_time','Part Time'],['contract','Contract'],['internship','Internship']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Industry</label>
              <input className="form-control" value={form.industry} onChange={e => setF('industry', e.target.value)} placeholder="IT, Finance, Healthcare…" />
            </div>
            <div>
              <label className="form-label">Department</label>
              <input className="form-control" value={form.department} onChange={e => setF('department', e.target.value)} placeholder="Engineering, HR…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Start Date</label>
              <input type="date" className="form-control" value={form.start_date} onChange={e => setF('start_date', e.target.value)} />
            </div>
            <div>
              <label className="form-label">End Date</label>
              {/* BUG_049: End date must be after start date */}
              <input type="date" className={`form-control ${form.end_date && form.start_date && form.end_date <= form.start_date ? 'border-rose-400' : ''}`}
                min={form.start_date || undefined}
                value={form.end_date} onChange={e => setF('end_date', e.target.value)} disabled={form.currently_working} />
              {form.end_date && form.start_date && form.end_date <= form.start_date && (
                <p className="text-xs text-rose-600 mt-1">End date must be after start date.</p>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded" checked={form.currently_working} onChange={e => setF('currently_working', e.target.checked)} />
            <span className="text-sm text-[#464555]">I currently work here</span>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">CTC / Annual Package</label>
              <input type="number" className="form-control" value={form.ctc} onChange={e => setF('ctc', e.target.value)} placeholder="600000" />
            </div>
            <div>
              <label className="form-label">Reason for Leaving</label>
              <input className="form-control" value={form.reason_leaving} onChange={e => setF('reason_leaving', e.target.value)} placeholder="Better opportunity…" />
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Experience"
        message={`Remove ${deleteTarget?.company_name} from your experience?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── SKILLS SECTION ──────────────────────────────────────────────────────────

const SKILL_BLANK = { skill_name: '', skill_category: 'technical', proficiency_level: 'intermediate', years_of_experience: '' };
const SKILL_CATS = ['technical','soft','language','domain','tool','other'];
const PROFICIENCY_LEVELS = ['beginner','intermediate','advanced','expert'];

function SkillsSection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(SKILL_BLANK);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: skills = [], isLoading } = useQuery({
    queryKey: ['profile-skills', empId],
    queryFn: () => apiGet(`/profile/${empId}/skills`),
    enabled: !!empId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? apiPut(`/profile/${empId}/skills/${editing.id}`, form)
      : apiPost(`/profile/${empId}/skills`, form),
    onSuccess: () => {
      toast(editing ? 'Skill updated.' : 'Skill added.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-skills', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
      setModalOpen(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: id => apiDelete(`/profile/${empId}/skills/${id}`),
    onSuccess: () => {
      toast('Skill removed.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-skills', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  function openAdd() { setEditing(null); setForm(SKILL_BLANK); setModalOpen(true); }
  function openEdit(s) { setEditing(s); setForm({ skill_name: s.skill_name || '', skill_category: s.skill_category || 'technical', proficiency_level: s.proficiency_level || 'intermediate', years_of_experience: s.years_of_experience || '' }); setModalOpen(true); }
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (isLoading) return <Spinner />;

  const grouped = SKILL_CATS.reduce((acc, cat) => {
    const items = skills.filter(s => s.skill_category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Skills</SectionHeader>
        <button onClick={openAdd} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={13} /> Add Skill
        </button>
      </div>

      {skills.length === 0 ? (
        <EmptyState icon={Zap} label="skills" onAdd={openAdd} />
      ) : (
        <div className="p-5 space-y-5">
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <p className="text-xs font-bold text-[#777587] uppercase tracking-wider mb-2 capitalize">{cat}</p>
              <div className="flex flex-wrap gap-2">
                {items.map(s => (
                  <div key={s.id} className="flex items-center gap-2 bg-white border border-[#e8e6f4] rounded-full px-3 py-1.5 shadow-sm group">
                    <span className="text-sm font-semibold text-[#151c27]">{s.skill_name}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full capitalize ${proficiencyColor(s.proficiency_level)}`}>{s.proficiency_level}</span>
                    {s.years_of_experience && <span className="text-xs text-[#777587]">{s.years_of_experience}y</span>}
                    <button onClick={() => openEdit(s)} className="text-[#777587] hover:text-[#3525cd] opacity-0 group-hover:opacity-100 transition-opacity"><Pencil size={12} /></button>
                    <button onClick={() => setDeleteTarget(s)} className="text-[#777587] hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"><X size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Skill' : 'Add Skill'} size="sm"
        footer={<><button className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</button></>}>
        <div className="space-y-4">
          <div>
            <label className="form-label">Skill Name *</label>
            <input className="form-control" value={form.skill_name} onChange={e => setF('skill_name', e.target.value)} placeholder="e.g. React, Python, Leadership" />
          </div>
          <div>
            <label className="form-label">Category</label>
            <select className="form-control" value={form.skill_category} onChange={e => setF('skill_category', e.target.value)}>
              {SKILL_CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Proficiency Level</label>
            <select className="form-control" value={form.proficiency_level} onChange={e => setF('proficiency_level', e.target.value)}>
              {PROFICIENCY_LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase()+l.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Years of Experience</label>
            {/* BUG_043: Validate years of experience 0-60 range */}
            <input type="number" className={`form-control ${form.years_of_experience && (Number(form.years_of_experience) < 0 || Number(form.years_of_experience) > 60) ? 'border-rose-400' : ''}`}
              value={form.years_of_experience} onChange={e => setF('years_of_experience', e.target.value)} placeholder="2" min="0" max="60" step="0.5" />
            {form.years_of_experience && (Number(form.years_of_experience) < 0 || Number(form.years_of_experience) > 60) && (
              <p className="text-xs text-rose-600 mt-1">Years of experience must be between 0 and 60.</p>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Skill"
        message={`Remove "${deleteTarget?.skill_name}" from your skills?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── BANKING SECTION ─────────────────────────────────────────────────────────

const BANK_BLANK = { bank_name: '', branch_name: '', account_number: '', account_holder_name: '', account_type: 'savings', ifsc_code: '', is_primary: false };

function BankingSection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BANK_BLANK);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['profile-banking', empId],
    queryFn: () => apiGet(`/profile/${empId}/banking`),
    enabled: !!empId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? apiPut(`/profile/${empId}/banking/${editing.id}`, form)
      : apiPost(`/profile/${empId}/banking`, form),
    onSuccess: () => {
      toast(editing ? 'Bank account updated.' : 'Bank account added. Pending HR verification.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-banking', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
      setModalOpen(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  function openAdd() { setEditing(null); setForm(BANK_BLANK); setModalOpen(true); }
  function openEdit(a) {
    setEditing(a);
    setForm({ bank_name: a.bank_name || '', branch_name: a.branch_name || '', account_number: a.account_number || '', account_holder_name: a.account_holder_name || '', account_type: a.account_type || 'savings', ifsc_code: a.ifsc_code || '', is_primary: a.is_primary || false });
    setModalOpen(true);
  }
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  if (isLoading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Bank Accounts</SectionHeader>
        <button onClick={openAdd} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={13} /> Add Account
        </button>
      </div>

      <div className="mx-5 mt-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800">Banking changes require HR verification. New accounts will be reviewed before use for payroll.</p>
      </div>

      {accounts.length === 0 ? (
        <EmptyState icon={CreditCard} label="bank accounts" onAdd={openAdd} />
      ) : (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {accounts.map(a => (
            <div key={a.id} className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    {a.is_primary && <span className="text-xs bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8] rounded-full px-2 py-0.5 font-bold">Primary</span>}
                    {a.hr_verified
                      ? <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5 font-bold flex items-center gap-1"><ShieldCheck size={11} /> Verified</span>
                      : <span className="text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5 font-bold flex items-center gap-1"><ShieldAlert size={11} /> Pending HR Review</span>}
                    <span className="text-xs bg-slate-100 text-slate-700 rounded-full px-2 py-0.5 capitalize">{a.account_type}</span>
                  </div>
                  <p className="text-base font-black text-[#151c27] font-mono tracking-wider">{maskAccount(a.account_number)}</p>
                  <p className="text-sm font-semibold text-[#3525cd] truncate">{a.bank_name}</p>
                  {a.branch_name && <p className="text-xs text-[#777587] truncate">{a.branch_name}</p>}
                  {a.ifsc_code && <p className="text-xs text-[#464555] font-mono">{a.ifsc_code}</p>}
                  {a.account_holder_name && <p className="text-xs text-[#777587] mt-1">{a.account_holder_name}</p>}
                </div>
                {/* BUG_046: lock edit while pending HR review */}
                {a.hr_verified
                  ? (
                    <button onClick={() => openEdit(a)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-[#3525cd] flex-shrink-0" title="Edit bank account">
                      <Pencil size={14} />
                    </button>
                  ) : (
                    <span title="Editing locked — account is awaiting HR review" className="btn btn-ghost btn-icon btn-sm text-[#c7c4d8] cursor-not-allowed flex-shrink-0">
                      <Lock size={14} />
                    </span>
                  )
                }
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Bank Account' : 'Add Bank Account'} size="md"
        footer={<><button className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          // BUG_044: Bank form validation
          if (!form.bank_name.trim()) { toast('Bank name is required.', 'error'); return; }
          if (!/[a-zA-Z]/.test(form.bank_name)) { toast('Bank name must contain letters only.', 'error'); return; }
          if (form.branch_name && !/[a-zA-Z]/.test(form.branch_name)) { toast('Branch name must contain letters (e.g. Andheri West Branch).', 'error'); return; }
          if (!form.account_number.trim()) { toast('Account number is required.', 'error'); return; }
          if (!/^\d{9,18}$/.test(form.account_number.trim())) { toast('Account number must be 9-18 digits only.', 'error'); return; }
          if (form.account_holder_name && !/[a-zA-Z]/.test(form.account_holder_name)) { toast('Account holder name must contain letters.', 'error'); return; }
          if (form.ifsc_code && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc_code.toUpperCase())) { toast('Invalid IFSC code format (e.g. SBIN0001234).', 'error'); return; }
          saveMut.mutate();
        }} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</button></>}>
        <div className="space-y-4">
          <div>
            <label className="form-label">Bank Name *</label>
            <input className="form-control" value={form.bank_name} onChange={e => setF('bank_name', e.target.value)} placeholder="State Bank of India" />
          </div>
          <div>
            <label className="form-label">Branch Name</label>
            <input className="form-control" value={form.branch_name} onChange={e => setF('branch_name', e.target.value)} placeholder="Andheri West Branch" />
          </div>
          <div>
            <label className="form-label">Account Number *</label>
            <input className="form-control font-mono" value={form.account_number} onChange={e => setF('account_number', e.target.value.replace(/\D/g, ''))} placeholder="1234567890" maxLength={18} />
            <p className="text-[0.65rem] text-[#777587] mt-1">Numeric digits only, 9-18 digits</p>
          </div>
          <div>
            <label className="form-label">Account Holder Name</label>
            <input className="form-control" value={form.account_holder_name} onChange={e => setF('account_holder_name', e.target.value)} placeholder="As per bank records" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Account Type</label>
              <select className="form-control" value={form.account_type} onChange={e => setF('account_type', e.target.value)}>
                {[['savings','Savings'],['current','Current'],['salary','Salary']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">IFSC Code</label>
              <input className="form-control font-mono uppercase" value={form.ifsc_code} onChange={e => setF('ifsc_code', e.target.value.toUpperCase())} placeholder="SBIN0001234" maxLength={11} />
              <p className="text-[0.65rem] text-[#777587] mt-1">Format: XXXX0XXXXXX</p>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded" checked={form.is_primary} onChange={e => setF('is_primary', e.target.checked)} />
            <span className="text-sm text-[#464555]">Set as primary account for salary</span>
          </label>
        </div>
      </Modal>
    </div>
  );
}

// ─── HEALTH SECTION ──────────────────────────────────────────────────────────

function HealthSection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['profile-health', empId],
    queryFn: () => apiGet(`/profile/${empId}/health`),
    enabled: !!empId,
  });

  const [form, setForm] = useState(null);
  React.useEffect(() => {
    if (data !== undefined && !form) {
      setForm({
        blood_group: data?.blood_group || '',
        height: data?.height || '',
        weight: data?.weight || '',
        allergies: data?.allergies || '',
        medical_conditions: data?.medical_conditions || '',
        disabilities: data?.disabilities || '',
        emergency_medical_notes: data?.emergency_medical_notes || '',
      });
    }
  }, [data]);

  const saveMut = useMutation({
    mutationFn: () => apiPut(`/profile/${empId}/health`, form),
    onSuccess: () => {
      toast('Health info saved.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-health', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  if (isLoading) return <Spinner />;
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Health Information</SectionHeader>
        <p className="text-xs text-[#777587] mt-1">This information is kept confidential and used only for emergency purposes.</p>
      </div>
      {form && (
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="form-label">Blood Group</label>
              <select className="form-control" value={form.blood_group} onChange={e => setF('blood_group', e.target.value)}>
                <option value="">Select…</option>
                {['A+','A-','B+','B-','AB+','AB-','O+','O-','unknown'].map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Height (cm)</label>
              <input type="number" className="form-control" value={form.height} onChange={e => setF('height', e.target.value)} placeholder="170" min="50" max="300" />
            </div>
            <div>
              <label className="form-label">Weight (kg)</label>
              <input type="number" className="form-control" value={form.weight} onChange={e => setF('weight', e.target.value)} placeholder="65" min="20" max="500" />
            </div>
          </div>
          <div>
            <label className="form-label">Allergies</label>
            <textarea className="form-control" rows={2} value={form.allergies} onChange={e => setF('allergies', e.target.value)} placeholder="List any known allergies (food, medicine, environment)…" />
          </div>
          <div>
            <label className="form-label">Medical Conditions</label>
            <textarea className="form-control" rows={2} value={form.medical_conditions} onChange={e => setF('medical_conditions', e.target.value)} placeholder="Any chronic conditions, medications…" />
          </div>
          <div>
            <label className="form-label">Disabilities</label>
            <textarea className="form-control" rows={2} value={form.disabilities} onChange={e => setF('disabilities', e.target.value)} placeholder="Any disabilities that may require accommodation…" />
          </div>
          <div>
            <label className="form-label">Emergency Medical Notes</label>
            <textarea className="form-control" rows={2} value={form.emergency_medical_notes} onChange={e => setF('emergency_medical_notes', e.target.value)} placeholder="Important notes for emergency responders…" />
          </div>
          <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            className="btn btn-primary btn-sm flex items-center gap-2">
            {saveMut.isPending ? <><span className="spinner w-3.5 h-3.5" /> Saving…</> : <><Save size={14} /> Save Health Info</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── NOMINEES SECTION ────────────────────────────────────────────────────────

const NOM_BLANK = { nominee_name: '', relationship: '', date_of_birth: '', percentage_share: '', address: '', contact_number: '', is_primary: false };

function NomineesSection({ empId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(NOM_BLANK);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: nominees = [], isLoading } = useQuery({
    queryKey: ['profile-nominees', empId],
    queryFn: () => apiGet(`/profile/${empId}/nominees`),
    enabled: !!empId,
  });

  const saveMut = useMutation({
    mutationFn: () => editing
      ? apiPut(`/profile/${empId}/nominees/${editing.id}`, form)
      : apiPost(`/profile/${empId}/nominees`, form),
    onSuccess: () => {
      toast(editing ? 'Nominee updated.' : 'Nominee added.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-nominees', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
      setModalOpen(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: id => apiDelete(`/profile/${empId}/nominees/${id}`),
    onSuccess: () => {
      toast('Nominee removed.', 'success');
      queryClient.invalidateQueries({ queryKey: ['profile-nominees', empId] });
      queryClient.invalidateQueries({ queryKey: ['profile-overview', empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  function openAdd() { setEditing(null); setForm(NOM_BLANK); setModalOpen(true); }
  function openEdit(n) { setEditing(n); setForm({ nominee_name: n.nominee_name || '', relationship: n.relationship || '', date_of_birth: n.date_of_birth || '', percentage_share: n.percentage_share || '', address: n.address || '', contact_number: n.contact_number || '', is_primary: n.is_primary || false }); setModalOpen(true); }
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const totalShare = nominees.reduce((s, n) => s + (n.percentage_share || 0), 0);

  if (isLoading) return <Spinner />;

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
      <div className="flex items-center justify-between p-5 border-b border-[#f0f3ff]">
        <SectionHeader>Nominees</SectionHeader>
        <button onClick={openAdd} className="btn btn-primary btn-sm flex items-center gap-1.5">
          <Plus size={13} /> Add Nominee
        </button>
      </div>

      {nominees.length > 0 && (
        <div className="mx-5 mt-4 p-3 bg-[#f0f3ff] rounded-lg border border-[#c7c4d8]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-[#151c27]">Total Share Allocated</span>
            <span className={`text-xs font-black ${totalShare > 100 ? 'text-rose-600' : totalShare === 100 ? 'text-emerald-600' : 'text-[#3525cd]'}`}>{totalShare}%</span>
          </div>
          <div className="h-2 bg-white/60 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${totalShare > 100 ? 'bg-rose-500' : 'bg-[#3525cd]'}`}
              style={{ width: `${Math.min(totalShare, 100)}%` }} />
          </div>
          {totalShare < 100 && <p className="text-xs text-[#777587] mt-1">{100 - totalShare}% remaining to allocate</p>}
          {totalShare === 100 && <p className="text-xs text-emerald-600 mt-1">100% fully allocated</p>}
        </div>
      )}

      {nominees.length === 0 ? (
        <EmptyState icon={Shield} label="nominees" onAdd={openAdd} />
      ) : (
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {nominees.map(n => (
            <div key={n.id} className="border border-[#e8e6f4] rounded-xl p-4 bg-[#fafbff]">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    {n.is_primary && <span className="text-xs bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8] rounded-full px-2 py-0.5 font-bold">Primary</span>}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${relationshipColor(n.relationship)}`}>{n.relationship || '—'}</span>
                  </div>
                  <p className="text-sm font-black text-[#151c27] truncate">{n.nominee_name}</p>
                  {n.date_of_birth && <p className="text-xs text-[#777587]">DOB: {fmtDate(n.date_of_birth)}</p>}
                  {n.contact_number && <p className="text-xs text-[#777587]">{n.contact_number}</p>}
                  {n.percentage_share != null && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[#777587]">Share</span>
                        <span className="text-xs font-black text-[#3525cd]">{n.percentage_share}%</span>
                      </div>
                      <div className="h-1.5 bg-[#f0f3ff] rounded-full overflow-hidden">
                        <div className="h-full bg-[#3525cd] rounded-full" style={{ width: `${n.percentage_share}%` }} />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(n)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-[#3525cd]"><Pencil size={14} /></button>
                  <button onClick={() => setDeleteTarget(n)} className="btn btn-ghost btn-icon btn-sm text-[#777587] hover:text-rose-600"><Trash2 size={14} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Nominee' : 'Add Nominee'} size="md"
        footer={<><button className="btn btn-outline" onClick={() => setModalOpen(false)}>Cancel</button><button className="btn btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? 'Saving…' : 'Save'}</button></>}>
        <div className="space-y-4">
          <div>
            <label className="form-label">Nominee Name *</label>
            <input className="form-control" value={form.nominee_name} onChange={e => setF('nominee_name', e.target.value)} placeholder="Full name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Relationship *</label>
              <select className="form-control" value={form.relationship} onChange={e => setF('relationship', e.target.value)}>
                <option value="">Select…</option>
                {['spouse','child','parent','sibling','other'].map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Date of Birth</label>
              <input type="date" className="form-control" value={form.date_of_birth} onChange={e => setF('date_of_birth', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Share % (1-100)</label>
              <input type="number" className="form-control" value={form.percentage_share} onChange={e => setF('percentage_share', e.target.value)} placeholder="50" min="1" max="100" />
            </div>
            <div>
              <label className="form-label">Contact Number</label>
              <input className="form-control" value={form.contact_number} onChange={e => setF('contact_number', e.target.value)} placeholder="+91 98765 43210" />
            </div>
          </div>
          <div>
            <label className="form-label">Address</label>
            <textarea className="form-control" rows={2} value={form.address} onChange={e => setF('address', e.target.value)} placeholder="Nominee's address" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="rounded" checked={form.is_primary} onChange={e => setF('is_primary', e.target.checked)} />
            <span className="text-sm text-[#464555]">Primary nominee</span>
          </label>
          <p className="text-xs text-[#777587] bg-amber-50 border border-amber-200 rounded-lg p-2">Total share across all nominees cannot exceed 100%.</p>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Nominee"
        message={`Remove ${deleteTarget?.nominee_name} as your nominee?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── ACCOUNT SETTINGS SECTION ────────────────────────────────────────────────

function AccountSection() {
  const { user, saveAuth, token } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [name,  setName]  = useState(user?.name  || '');
  const [email, setEmail] = useState(user?.email || '');
  const [color, setColor] = useState(user?.avatar_color || '#3525cd');

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

  const saveMut = useMutation({
    mutationFn: () => apiPut('/auth/profile', { name, avatar_color: color, email }),
    onSuccess: data => {
      saveAuth(token, { ...user, name: data.name, avatar_color: data.avatar_color, email: data.email });
      toast('Profile updated.', 'success');
    },
    onError: e => toast(e.message, 'error'),
  });

  const [sendVerify] = [useMutation({
    mutationFn: () => apiPost('/auth/send-verification', {}),
    onSuccess: data => { toast(data.message || 'Verification code sent.', 'info'); setVerifyModal(true); },
    onError: e => toast(e.message, 'error'),
  })];
  const [verifyModal, setVerifyModal] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const submitVerify = useMutation({
    mutationFn: () => apiPost('/auth/verify-email', { code: verifyCode }),
    onSuccess: data => {
      toast(data.message || 'Email verified!', 'success');
      saveAuth(token, { ...user, email_verified: true });
      setVerifyModal(false); setVerifyCode('');
    },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <div className="space-y-5">
      {/* Account Info */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <SectionHeader>Account Info</SectionHeader>
          {user?.email_verified ? (
            <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
              <ShieldCheck size={13} /> Verified
            </span>
          ) : (
            <button onClick={() => sendVerify.mutate()} disabled={sendVerify.isPending}
              className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-300 font-bold hover:bg-amber-100">
              <ShieldAlert size={13} className="inline mr-1" />{sendVerify.isPending ? 'Sending…' : 'Verify Email'}
            </button>
          )}
        </div>
        <div>
          <label className="form-label flex items-center gap-1.5"><Mail size={13} className="text-[#3525cd]" /> Company Email</label>
          {/* BUG_041: Company Email is read-only for employees — only HR/Admin can change it */}
          {user?.role === 'employee' ? (
            <>
              <input className="form-control bg-[#f8f9ff] text-[#777587] cursor-not-allowed" type="email" value={email} readOnly disabled />
              <p className="text-[0.7rem] text-[#777587] mt-1">Contact HR to update your company email.</p>
            </>
          ) : (
            <>
              <input className="form-control" type="email" value={email} onChange={e => setEmail(e.target.value)} />
              <p className="text-[0.7rem] text-[#777587] mt-1">Changing email updates your login credentials.</p>
            </>
          )}
        </div>
        {myDepts.length > 0 && (
          <div className="mt-3 pt-3 border-t border-[#f0f3ff]">
            <p className="text-xs text-[#777587] mb-1">Departments</p>
            <div className="flex flex-wrap gap-1">
              {myDepts.map(d => (
                <span key={d.id} className="text-xs font-semibold px-2 py-0.5 rounded-md bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">
                  {d.name}{d.role && d.role !== 'Member' ? ` · ${d.role}` : ''}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Display Settings */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
        <SectionHeader>Display Settings</SectionHeader>
        <PhotoUploadWidget
          currentUrl={user?.avatar_url || null}
          initials={initials(name || user?.name || '')}
          color={color}
          onUploaded={url => {
            saveAuth(token, { ...user, avatar_url: url });
            queryClient.invalidateQueries({ queryKey: ['profile-overview', user?.id] });
          }}
        />
        <div className="mb-4">
          <label className="form-label mb-2">Avatar Color</label>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_COLORS.map(c => (
              <button key={c} onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 flex-shrink-0"
                style={{ background: c, borderColor: color === c ? '#fff' : 'transparent', outline: color === c ? `2px solid ${c}` : 'none', outlineOffset: '1px' }} />
            ))}
          </div>
        </div>
        <div className="mb-4">
          <label className="form-label">Display Name</label>
          {/* BUG_036: Display Name must contain at least one alphabetic character */}
          <input className={`form-control ${name && !/[a-zA-Z]/.test(name) ? 'border-rose-400' : ''}`}
            value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" />
          {name && !/[a-zA-Z]/.test(name) && (
            <p className="text-xs text-rose-600 mt-1">Display Name must contain at least one letter.</p>
          )}
        </div>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name.trim() || !/[a-zA-Z]/.test(name)}
          className="btn btn-primary btn-sm flex items-center gap-2">
          {saveMut.isPending ? <><span className="spinner w-3.5 h-3.5" /> Saving…</> : <><Save size={14} /> Save Changes</>}
        </button>
      </div>

      <Modal open={verifyModal} onClose={() => setVerifyModal(false)} title="Enter Verification Code"
        footer={<><button className="btn btn-outline" onClick={() => setVerifyModal(false)}>Cancel</button><button className="btn btn-primary" onClick={() => submitVerify.mutate()} disabled={submitVerify.isPending || verifyCode.length < 6}>{submitVerify.isPending ? 'Verifying…' : 'Verify'}</button></>}>
        <p className="text-xs text-[#777587] mb-3">Enter the 6-digit code sent to <strong>{user?.email}</strong>.</p>
        <input className="form-control tracking-widest text-center text-lg font-black" maxLength={6} placeholder="123456" value={verifyCode} onChange={e => setVerifyCode(e.target.value)} />
      </Modal>
    </div>
  );
}

// ─── TWO-FACTOR AUTHENTICATION SECTION ───────────────────────────────────────

function SecuritySection() {
  const { user, saveAuth, token } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: meData, refetch: refetchMe } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => apiGet('/auth/me'),
  });
  const totpEnabled = meData?.totp_enabled ?? user?.totp_enabled ?? false;

  const [totpSetup,        setTotpSetup]        = useState(null);
  const [totpCode,         setTotpCode]         = useState('');
  const [disable2FAModal,  setDisable2FAModal]  = useState(false);
  const [disable2FAPw,     setDisable2FAPw]     = useState('');
  const [copied,           setCopied]           = useState(false);

  const setupTotp = useMutation({
    mutationFn: () => apiPost('/auth/totp/setup', {}),
    onSuccess: data => setTotpSetup(data),
    onError:   e    => toast(e.message, 'error'),
  });

  const enableTotp = useMutation({
    mutationFn: () => apiPost('/auth/totp/enable', { token: totpCode }),
    onSuccess: () => {
      toast('2FA enabled successfully!', 'success');
      saveAuth(token, { ...user, totp_enabled: true });
      refetchMe();
      setTotpSetup(null);
      setTotpCode('');
    },
    onError: e => toast(e.message, 'error'),
  });

  const disableTotp = useMutation({
    mutationFn: () => apiPost('/auth/totp/disable', { password: disable2FAPw }),
    onSuccess: () => {
      toast('2FA disabled.', 'warning');
      saveAuth(token, { ...user, totp_enabled: false });
      refetchMe();
      setDisable2FAModal(false);
      setDisable2FAPw('');
    },
    onError: e => toast(e.message, 'error'),
  });

  function copySecret() {
    navigator.clipboard.writeText(totpSetup.secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={14} className="text-[#3525cd]" />
        <span className="text-sm font-black text-[#151c27]">Two-Factor Authentication</span>
        {totpEnabled && (
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
        )}
      </div>

      {!totpEnabled ? (
        !totpSetup ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[#777587]">
              Add an extra layer of security. After setup, you'll need an authenticator app (Google Authenticator, Authy, etc.) each time you log in.
            </p>
            <button
              onClick={() => setupTotp.mutate()}
              disabled={setupTotp.isPending}
              className="btn btn-primary btn-sm self-start flex items-center gap-2"
            >
              {setupTotp.isPending ? <><span className="spinner w-4 h-4" /> Setting up…</> : <><Key size={14} /> Set Up 2FA</>}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-[#777587]">Scan this QR code with your authenticator app, then enter the 6-digit code to activate.</p>
            <img src={totpSetup.qrDataUrl} alt="2FA QR Code" className="w-40 h-40 mx-auto rounded-xl border border-[#c7c4d8] p-1" />
            <div className="bg-[#f8f9ff] rounded-lg p-3 border border-[#e7eefe]">
              <p className="text-[0.65rem] text-[#777587] mb-1 font-semibold uppercase tracking-wider">Manual Entry Key</p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-black text-[#3525cd] tracking-widest flex-1 break-all">{totpSetup.secret}</code>
                <button onClick={copySecret} className="text-[#777587] hover:text-[#3525cd] flex-shrink-0">
                  {copied ? <Check size={14} className="text-emerald-500" /> : <QrCode size={14} />}
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
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => enableTotp.mutate()}
                disabled={enableTotp.isPending || totpCode.length !== 6}
                className="btn btn-primary btn-sm flex items-center gap-2"
              >
                {enableTotp.isPending ? <><span className="spinner w-4 h-4" /> Enabling…</> : <><ShieldCheck size={14} /> Enable 2FA</>}
              </button>
              <button onClick={() => { setTotpSetup(null); setTotpCode(''); }} className="btn btn-outline btn-sm">
                Cancel
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <ShieldCheck size={16} />
            <span className="text-sm font-bold">2FA Active</span>
          </div>
          <p className="text-xs text-[#777587]">Your account is protected with two-factor authentication. Each login requires your authenticator app code.</p>
          <button
            onClick={() => setDisable2FAModal(true)}
            className="btn btn-outline btn-sm self-start border-rose-300 text-rose-700 hover:bg-rose-50"
          >
            Disable 2FA
          </button>
        </div>
      )}

      <Modal
        open={disable2FAModal}
        onClose={() => { setDisable2FAModal(false); setDisable2FAPw(''); }}
        title="Disable Two-Factor Authentication"
        footer={
          <>
            <button className="btn btn-outline" onClick={() => { setDisable2FAModal(false); setDisable2FAPw(''); }}>Cancel</button>
            <button className="btn btn-danger" onClick={() => disableTotp.mutate()} disabled={disableTotp.isPending || !disable2FAPw}>
              {disableTotp.isPending ? 'Disabling…' : 'Confirm Disable'}
            </button>
          </>
        }
      >
        <p className="text-xs text-[#777587] mb-3">Enter your current password to confirm disabling 2FA.</p>
        <input
          className="form-control"
          type="password"
          placeholder="Current password"
          value={disable2FAPw}
          onChange={e => setDisable2FAPw(e.target.value)}
        />
      </Modal>
    </div>
  );
}

// ─── PRIVACY & SECURITY SECTION ──────────────────────────────────────────────

function PrivacySection() {
  const { user, saveAuth, token } = useAuth();
  const toast = useToast();

  const [curPw,  setCurPw]  = useState('');
  const [newPw,  setNewPw]  = useState('');
  const [confPw, setConfPw] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [delModal, setDelModal] = useState(false);
  const [delReason, setDelReason] = useState('');

  const changePw = useMutation({
    mutationFn: () => apiPut('/auth/change-password', { currentPassword: curPw, newPassword: newPw }),
    onSuccess: () => { toast('Password changed.', 'success'); setCurPw(''); setNewPw(''); setConfPw(''); },
    onError: e => toast(e.message, 'error'),
  });

  const deactivate = useMutation({
    mutationFn: () => apiPost('/auth/deactivate', {}),
    onSuccess: () => toast('Account deactivated.', 'warning'),
    onError: e => toast(e.message, 'error'),
  });

  const requestDel = useMutation({
    mutationFn: () => apiPost('/auth/request-deletion', { reason: delReason }),
    onSuccess: data => { toast(data.message || 'Deletion request submitted.', 'success'); setDelModal(false); setDelReason(''); },
    onError: e => toast(e.message, 'error'),
  });

  // BUG_039: Password policy rules
  const pwRules = [
    { label: 'At least 8 characters', ok: newPw.length >= 8 },
    { label: 'One uppercase letter (A-Z)', ok: /[A-Z]/.test(newPw) },
    { label: 'One lowercase letter (a-z)', ok: /[a-z]/.test(newPw) },
    { label: 'One number (0-9)', ok: /\d/.test(newPw) },
    { label: 'One special character (!@#$…)', ok: /[^A-Za-z0-9]/.test(newPw) },
  ];

  function handlePwSubmit() {
    if (newPw !== confPw) { toast('Passwords do not match.', 'error'); return; }
    if (newPw.length < 8) { toast('Password must be at least 8 characters.', 'error'); return; }
    changePw.mutate();
  }

  return (
    <div className="space-y-5">
      {/* Change Password */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
        <SectionHeader>Change Password</SectionHeader>
        {/* BUG_039: Password policy display */}
        <div className="mt-4 mb-4 p-3 rounded-xl bg-[#f8f9ff] border border-[#e7eefe]">
          <p className="text-[0.7rem] font-black text-[#777587] uppercase tracking-widest mb-2">Password Requirements</p>
          <ul className="space-y-1">
            {pwRules.map(r => (
              <li key={r.label} className={`flex items-center gap-2 text-xs ${newPw ? (r.ok ? 'text-emerald-700' : 'text-rose-600') : 'text-[#777587]'}`}>
                <span className={`w-3.5 h-3.5 rounded-full flex-shrink-0 border ${newPw ? (r.ok ? 'bg-emerald-500 border-emerald-500' : 'bg-rose-100 border-rose-300') : 'bg-[#e7eefe] border-[#c7c4d8]'}`} />
                {r.label}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <div>
            <label className="form-label">Current Password</label>
            <div className="relative">
              <input className="form-control pr-10" type={showCur ? 'text' : 'password'} value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="••••••••" />
              <button type="button" onClick={() => setShowCur(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
                {showCur ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">New Password</label>
            <div className="relative">
              <input className="form-control pr-10" type={showNew ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 characters" />
              <button type="button" onClick={() => setShowNew(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">Confirm New Password</label>
            <input className="form-control" type="password" value={confPw} onChange={e => setConfPw(e.target.value)} placeholder="Repeat new password" />
          </div>
          {newPw && confPw && newPw !== confPw && (
            <p className="text-xs text-rose-600">Passwords do not match.</p>
          )}
          <button onClick={handlePwSubmit} disabled={changePw.isPending || !curPw || !newPw || !confPw}
            className="btn btn-primary btn-sm flex items-center gap-2">
            {changePw.isPending ? <><span className="spinner w-3.5 h-3.5" /> Updating…</> : <><Check size={14} /> Update Password</>}
          </button>
        </div>
      </div>

      {/* BUG_180: Account changes (deactivation/deletion) must go through HR — removed self-service buttons */}
      <div className="bg-white rounded-xl border border-[#e7eefe] shadow-sm p-5">
        <h2 className="text-sm font-black text-[#777587] uppercase tracking-wider flex items-center gap-2 mb-2">
          <AlertTriangle size={15} className="text-[#777587]" /> Account Changes
        </h2>
        <p className="text-xs text-[#777587] leading-relaxed">
          To request account deactivation or data deletion, please contact your HR Administrator directly.
          Account changes require HR approval and cannot be self-initiated.
        </p>
      </div>
    </div>
  );
}

// ─── DOCUMENTS / PAYROLL / PERFORMANCE REDIRECT CARDS ────────────────────────

function ExternalLinkCard({ to, icon: Icon, title, description, buttonLabel }) {
  const navigate = useNavigate();
  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center text-[#3525cd]">
          <Icon size={20} />
        </div>
        <SectionHeader>{title}</SectionHeader>
      </div>
      <p className="text-sm text-[#464555] mb-4">{description}</p>
      <button onClick={() => navigate(to)} className="btn btn-primary btn-sm flex items-center gap-2">
        {buttonLabel} <ExternalLink size={13} />
      </button>
    </div>
  );
}

// ─── TAB CONTENT RENDERER ────────────────────────────────────────────────────

function TabContent({ tab, empId }) {
  switch (tab) {
    case 'overview':
      return <OverviewTab empId={empId} />;

    case 'personal':
      return <PersonalSection empId={empId} />;

    case 'professional':
      return (
        <div className="space-y-5">
          <FamilySection empId={empId} />
          <ExperienceSection empId={empId} />
          <EducationSection empId={empId} />
        </div>
      );

    case 'documents':
      return (
        <ExternalLinkCard
          to="/portal/documents"
          icon={FileText}
          title="Documents"
          description="Access your offer letter, contracts, and other HR documents."
          buttonLabel="Go to Documents"
        />
      );

    case 'work':
      return (
        <div className="space-y-5">
          <SkillsSection empId={empId} />
          <BankingSection empId={empId} />
        </div>
      );

    case 'payroll':
      return (
        <ExternalLinkCard
          to="/portal/payslips"
          icon={BarChart3}
          title="Payroll"
          description="Download payslips, view salary structure and payment history."
          buttonLabel="Go to Payroll"
        />
      );

    case 'performance':
      return (
        <ExternalLinkCard
          to="/portal/performance"
          icon={Star}
          title="Performance"
          description="View your performance reviews, goals, and feedback."
          buttonLabel="Go to Performance"
        />
      );

    case 'account':
      return (
        <div className="space-y-5">
          <AccountSection />
          <SecuritySection />
          <PrivacySection />
        </div>
      );

    default:
      return null;
  }
}

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

// ENH_PROFILE_001: Profile Completion Progress Bar
function ProfileCompletionBar({ empId }) {
  const { data } = useQuery({ queryKey: ['profile-overview', empId], queryFn: () => apiGet(`/profile/${empId}/overview`), enabled: !!empId });
  const { data: per } = useQuery({ queryKey: ['profile-personal', empId], queryFn: () => apiGet(`/profile/${empId}/personal`), enabled: !!empId });
  const { data: docs = [] } = useQuery({ queryKey: ['employee-documents', empId], queryFn: () => apiGet(`/profile/${empId}/documents`), enabled: !!empId });
  const { data: contacts = [] } = useQuery({ queryKey: ['emergency-contacts', empId], queryFn: () => apiGet(`/profile/${empId}/emergency-contacts`), enabled: !!empId });
  if (!data) return null;
  const sections = [
    { label: 'Basic Info',       pct: data.name && data.phone ? 100 : 50,                    color: 'bg-[#3525cd]' },
    { label: 'Personal',         pct: per?.date_of_birth && per?.gender ? 100 : (per?.date_of_birth || per?.gender ? 50 : 0), color: 'bg-emerald-500' },
    { label: 'Address',          pct: per?.current_address_line1 ? 100 : 0,                   color: 'bg-amber-500' },
    { label: 'Professional',     pct: data.department && data.position ? 100 : 50,             color: 'bg-purple-500' },
    { label: 'Documents',        pct: (Array.isArray(docs) ? docs.length : 0) > 0 ? 100 : 0, color: 'bg-sky-500' },
    { label: 'Emergency Contact',pct: (Array.isArray(contacts) ? contacts.length : 0) > 0 ? 100 : 0, color: 'bg-rose-500' },
  ];
  const overall = Math.round(sections.reduce((s, sec) => s + sec.pct, 0) / sections.length);
  return (
    <div className="bg-white border border-[#c7c4d8] rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-black text-[#151c27]">Profile Completeness</p>
          <p className="text-xs text-[#777587]">{overall}% complete · Fill in missing sections to reach 100%</p>
        </div>
        <span className={`text-2xl font-black ${overall >= 80 ? 'text-emerald-600' : overall >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{overall}%</span>
      </div>
      <div className="h-2 bg-[#f0f3ff] rounded-full overflow-hidden mb-3">
        <div className="h-full bg-[#3525cd] rounded-full transition-all" style={{ width: `${overall}%` }} />
      </div>
      <div className="flex flex-wrap gap-2">
        {sections.map(s => (
          <div key={s.label} className="flex items-center gap-1.5 text-xs">
            <div className={`w-2 h-2 rounded-full ${s.pct === 100 ? s.color : 'bg-[#e7eefe]'}`} />
            <span className={s.pct === 100 ? 'text-[#464555] font-semibold' : 'text-[#9ca3af]'}>{s.label}</span>
            {s.pct < 100 && <span className="text-[0.6rem] text-rose-500 font-bold">Incomplete</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ENH_PROFILE_008: Profile section search
function ProfileSectionSearch({ onTabChange }) {
  const [query, setQuery] = useState('');
  const SECTION_MAP = [
    { keywords: ['overview','summary','basic'], tab: 'overview', label: 'Overview' },
    { keywords: ['personal','address','contact','phone','email','date of birth','gender'], tab: 'personal', label: 'Personal & Contact' },
    { keywords: ['skills','education','work history','experience','qualification'], tab: 'skills', label: 'Skills & Experience' },
    { keywords: ['documents','id','aadhaar','pan','passport'], tab: 'documents', label: 'Documents' },
    { keywords: ['emergency','family','nominee','dependent'], tab: 'family', label: 'Family & Emergency' },
    { keywords: ['bank','salary','account','ifsc'], tab: 'banking', label: 'Banking' },
    { keywords: ['statutory','pf','esi','tax','tds'], tab: 'statutory', label: 'Statutory' },
  ];
  const matched = query.trim()
    ? SECTION_MAP.filter(s => s.keywords.some(k => k.includes(query.toLowerCase()) || s.label.toLowerCase().includes(query.toLowerCase())))
    : [];
  return (
    <div className="relative mb-3">
      <div className="relative">
        <input type="text" className="w-full pl-8 pr-4 py-2 text-sm border border-[#c7c4d8] rounded-xl focus:border-[#3525cd] focus:outline-none bg-white"
          placeholder="Search profile sections… (e.g. Skills, Documents, Bank)"
          value={query} onChange={e => setQuery(e.target.value)} />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]">🔍</span>
      </div>
      {matched.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-[#c7c4d8] rounded-xl shadow-lg overflow-hidden">
          {matched.map(s => (
            <button key={s.tab} onClick={() => { onTabChange(s.tab); setQuery(''); }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-[#f0f3ff] text-[#151c27] transition-colors border-b border-[#f0f3ff] last:border-0">
              <span className="font-semibold">{s.label}</span>
              <span className="text-xs text-[#777587] ml-2">{s.keywords.slice(0,3).join(', ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EmployeePortalProfile() {
  const { user } = useAuth();
  const empId = user?.id;
  const [activeTab, setActiveTab] = useState('overview');

  return (
    <div className="w-full space-y-5 pb-10">
      {/* ENH_PROFILE_001: Profile Completion Bar */}
      <ProfileCompletionBar empId={empId} />
      {/* ENH_PROFILE_008: Profile Section Search */}
      <ProfileSectionSearch onTabChange={setActiveTab} />
      {/* Profile Header Card — always visible */}
      <ProfileHeaderCard empId={empId} onTabChange={setActiveTab} />

      {/* Horizontal Tab Navigation */}
      <div id="profile-tabs" className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-x-auto">
        <div className="flex min-w-max">
          {TABS.map((tab, idx) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-5 py-3.5 text-sm font-semibold whitespace-nowrap transition-all border-b-2 ${
                activeTab === tab.key
                  ? 'text-[#3525cd] border-[#3525cd] font-black bg-[#f8f9ff]'
                  : 'text-[#777587] border-transparent hover:text-[#464555] hover:bg-[#f8f9ff]'
              } ${idx === 0 ? 'rounded-tl-xl' : ''} ${idx === TABS.length - 1 ? 'rounded-tr-xl' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      <TabContent tab={activeTab} empId={empId} />
    </div>
  );
}
