import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Upload, FolderOpen, Trash2, Download, AlertCircle, FileText,
  Image, Archive, X, ExternalLink, Eye, Users, Info, CheckCircle2,
  ChevronLeft, ChevronRight, Mail, BookOpen, Globe, Lock, UserCheck,
  Share2, Edit2, RefreshCw, CreditCard, Landmark, Camera, GraduationCap,
  Briefcase, ScanLine, User, Home, Plus, ShieldCheck, ClipboardList,
  Clock, CheckCircle, XCircle, AlertTriangle, BarChart2, Search,
  ChevronDown, RotateCcw, FileCheck, UploadCloud, Settings, UserPlus, Calendar,
  Building2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';
import { fmtDate } from '@/lib/utils';

// ── Constants ────────────────────────────────────────────────────────────────
const EMPLOYEE_CATEGORIES = [
  { value: 'aadhaar',    label: 'Aadhaar Card',              icon: <CreditCard size={13} />,    desc: 'Aadhaar Card (front & back)' },
  { value: 'pan',        label: 'PAN Card',                  icon: <ScanLine size={13} />,      desc: 'PAN Card' },
  { value: 'bank_proof', label: 'Bank Account Proof',        icon: <Landmark size={13} />,      desc: 'Cancelled Cheque or Bank Statement' },
  { value: 'photo',      label: 'Passport Photo',            icon: <Camera size={13} />,        desc: 'Recent passport-size photograph' },
  { value: 'edu_cert',   label: 'Educational Certificates',  icon: <GraduationCap size={13} />, desc: 'Degree, Marksheets, Diplomas' },
  { value: 'exp_letter', label: 'Experience / Offer Letter', icon: <Briefcase size={13} />,     desc: 'Offer Letter, Experience Letter' },
  { value: 'hr_policy',  label: 'HR Policy',                 icon: <FileText size={13} />,      desc: 'HR Policy Documents' },
  { value: 'policy',     label: 'Policy',                    icon: <FileText size={13} />,      desc: 'Policy Documents' },
  { value: 'notice',     label: 'Notice',                    icon: <AlertCircle size={13} />,   desc: 'Notices' },
  { value: 'legal',      label: 'Legal',                     icon: <ShieldCheck size={13} />,   desc: 'Legal Documents' },
  { value: 'security',   label: 'Security',                  icon: <Lock size={13} />,          desc: 'Security Documents' },
  { value: 'other',      label: 'Other',                     icon: <FolderOpen size={13} />,    desc: 'Other Documents' },
];

const LEGACY_CATEGORIES = [
  { value: 'id_proof',      label: 'ID Proof',      icon: <CreditCard size={13} />,    desc: '' },
  { value: 'address_proof', label: 'Address Proof', icon: <Home size={13} />,          desc: '' },
  { value: 'bank_details',  label: 'Bank Details',  icon: <Landmark size={13} />,      desc: '' },
  { value: 'education',     label: 'Education',     icon: <GraduationCap size={13} />, desc: '' },
  { value: 'employment',    label: 'Employment',    icon: <Briefcase size={13} />,     desc: '' },
  { value: 'offer_letter',  label: 'Employment',    icon: <Briefcase size={13} />,     desc: '' },
  { value: 'contract',      label: 'Employment',    icon: <FileText size={13} />,      desc: '' },
  { value: 'certificate',   label: 'Education',     icon: <GraduationCap size={13} />, desc: '' },
];

const CAT_MAP = {};
for (const c of [...LEGACY_CATEGORIES, ...EMPLOYEE_CATEGORIES]) CAT_MAP[c.value] = c;

const VIS_CFG = {
  self:       { label: 'Particular Employee', icon: <UserCheck size={10} />, cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  all:        { label: 'All Employees',       icon: <Globe size={10} />,     cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  // BUG_023: Consistent visibility labels — "Shared with HR" used everywhere for admin_only
  specific:   { label: 'Shared with Employees', icon: <Users size={10} />,  cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  admin_only: { label: 'Shared with HR',        icon: <Lock size={10} />,   cls: 'bg-slate-50 text-slate-600 border-slate-200' },
};

const STATUS_CFG = {
  under_review:        { label: 'Under Review',        cls: 'bg-amber-50 text-amber-700 border-amber-200',     dot: 'bg-amber-500' },
  hr_approved:         { label: 'HR Approved',          cls: 'bg-yellow-50 text-yellow-700 border-yellow-300',  dot: 'bg-yellow-500' },
  approved:            { label: 'Approved',             cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  rejected:            { label: 'Rejected',             cls: 'bg-rose-50 text-rose-700 border-rose-200',       dot: 'bg-rose-500' },
  re_upload_requested: { label: 'Re-upload Requested',  cls: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500' },
};

// BUG_210: default to 'all' so freshly uploaded shared docs are visible to employees.
const INIT_FORM = { name: '', category: '', expiry_date: '', visibility: 'all', targetUserId: '', shareWith: [] };
const PAGE_SIZES = [5, 10, 20, 50];

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}
function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
function daysLeft(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 864e5);
  return diff;
}
function fileIcon(type = '', size = 16) {
  if (type.includes('image')) return <Image size={size} className="text-emerald-500" />;
  if (type.includes('pdf'))   return <FileText size={size} className="text-rose-500" />;
  return <Archive size={size} className="text-[#3525cd]" />;
}
function canPreview(type = '') { return type?.includes('image') || type?.includes('pdf'); }

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[0.65rem] font-bold border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function ExpiryBadge({ expiryDate }) {
  if (!expiryDate) return <span className="text-[#9ca3af] text-[0.65rem]">—</span>;
  const dl = daysLeft(expiryDate);
  if (dl === null) return null;
  if (dl < 0) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold bg-rose-50 text-rose-700 border border-rose-200">
      <AlertTriangle size={10} /> Expired
    </span>
  );
  if (dl <= 30) return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold bg-amber-50 text-amber-700 border border-amber-200">
      <Clock size={10} /> {dl}d left
    </span>
  );
  return (
    <span className="text-[0.65rem] text-[#777587]">{fmtDate(expiryDate)}</span>
  );
}

// ── Searchable Employee Picker ────────────────────────────────────────────────
function SearchableEmployeePicker({ employees = [], value, onChange, placeholder = '— Search employee —' }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef();

  const selected = employees.find(e => String(e.id) === String(value));

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(e =>
      e.name?.toLowerCase().includes(q) ||
      e.email?.toLowerCase().includes(q)
    );
  }, [employees, search]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div
        className="form-control text-xs cursor-pointer flex items-center justify-between min-h-[38px]"
        onClick={() => setOpen(o => !o)}
      >
        {selected ? (
          <div className="flex items-center gap-2">
            <Avatar name={selected.name} color={selected.avatar_color} size={18} />
            <span className="text-[#151c27] font-semibold">{selected.name}</span>
          </div>
        ) : (
          <span className="text-[#9ca3af]">{placeholder}</span>
        )}
        <ChevronDown size={12} className="text-[#9ca3af] flex-shrink-0 ml-2" />
      </div>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-[#c7c4d8] rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[#f0f3ff]">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <input
                type="text"
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-[#e7eefe] rounded-lg focus:outline-none focus:border-[#3525cd]"
                placeholder="Search by name or email…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onClick={e => e.stopPropagation()}
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-xs text-center text-[#9ca3af]">No employees found</div>
            ) : filtered.map(e => (
              <div
                key={e.id}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors ${String(e.id) === String(value) ? 'bg-[#f0f3ff]' : 'hover:bg-[#fafaff]'}`}
                onClick={() => { onChange(String(e.id)); setOpen(false); setSearch(''); }}
              >
                <Avatar name={e.name} color={e.avatar_color} size={22} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#151c27] truncate">{e.name}</p>
                  {e.email && <p className="text-[0.6rem] text-[#9ca3af] truncate">{e.email}</p>}
                </div>
                {String(e.id) === String(value) && <CheckCircle2 size={12} className="text-[#3525cd] flex-shrink-0" />}
              </div>
            ))}
          </div>
          {value && (
            <div className="border-t border-[#f0f3ff] p-2">
              <button
                className="w-full text-xs text-rose-500 hover:text-rose-700 py-1 transition-colors"
                onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Delete With Reason Modal (Root Admin only) ────────────────────────────────
function DeleteWithReasonModal({ open, docName, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');

  useEffect(() => { if (!open) setReason(''); }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-sm p-6">
        <button onClick={onCancel} className="absolute top-4 right-4 text-[#777587] hover:text-[#151c27] p-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
          <X size={18} />
        </button>

        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-rose-100 text-rose-600">
          <Trash2 size={22} />
        </div>

        <h3 className="text-base font-black text-[#151c27] text-center mb-1">Delete Document</h3>
        <p className="text-xs text-[#777587] text-center mb-4">
          Permanently delete <strong>"{docName}"</strong>?<br />This action cannot be undone.
        </p>

        <div className="mb-4">
          <label className="form-label">Reason for Deletion <span className="text-rose-500">*</span></label>
          <textarea
            className="form-control"
            rows={3}
            placeholder="Enter reason for deleting this document…"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          {!reason.trim() && <p className="text-[0.65rem] text-rose-500 mt-1">Reason is required before deleting.</p>}
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 btn btn-outline">Cancel</button>
          <button
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
            disabled={!reason.trim()}
            className="flex-1 btn btn-danger disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Request Delete Modal (HR Admin only) ─────────────────────────────────────
function RequestDeleteModal({ open, docName, onConfirm, onCancel, requesting }) {
  const [reason, setReason] = useState('');

  useEffect(() => { if (!open) setReason(''); }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-sm p-6">
        <button onClick={onCancel} className="absolute top-4 right-4 text-[#777587] hover:text-[#151c27] p-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
          <X size={18} />
        </button>

        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-amber-100 text-amber-600">
          <Trash2 size={22} />
        </div>

        <h3 className="text-base font-black text-[#151c27] text-center mb-1">Request Deletion</h3>
        <p className="text-xs text-[#777587] text-center mb-4">
          Request Root Admin to delete <strong>"{docName}"</strong>.<br />A notification will be sent for approval.
        </p>

        <div className="mb-4">
          <label className="form-label">Reason for Deletion Request <span className="text-rose-500">*</span></label>
          <textarea
            className="form-control"
            rows={3}
            placeholder="Enter reason for requesting deletion of this document…"
            value={reason}
            onChange={e => setReason(e.target.value)}
          />
          {!reason.trim() && <p className="text-[0.65rem] text-rose-500 mt-1">Reason is required before requesting deletion.</p>}
        </div>

        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 btn btn-outline">Cancel</button>
          <button
            onClick={() => { if (reason.trim()) onConfirm(reason.trim()); }}
            disabled={!reason.trim() || requesting}
            className="flex-1 btn btn-warning disabled:opacity-50 disabled:cursor-not-allowed bg-amber-500 text-white hover:bg-amber-600 border-amber-500 rounded-xl px-4 py-2 text-xs font-bold transition-colors"
          >
            {requesting ? <><span className="spinner w-4 h-4" /> Sending…</> : 'Request Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Preview Modal ────────────────────────────────────────────────────────────
function PreviewModal({ doc, onClose }) {
  if (!doc) return null;
  const url  = doc.file_url;
  const type = doc.file_type || '';
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.85)', backdropFilter: 'blur(12px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff] flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center">{fileIcon(type)}</div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-[#151c27] text-sm truncate">{doc.name || doc.file_name}</p>
            <p className="text-xs text-[#777587]">{fmtBytes(doc.file_size)} · {type}</p>
          </div>
          <a href={url} download target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] bg-[#f0f3ff] hover:bg-[#e7eefe] transition-colors">
            <Download size={12} /> Download
          </a>
          <button onClick={onClose} className="p-2 rounded-lg text-[#777587] hover:bg-[#f0f3ff] transition-colors"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto bg-[#f9f9ff] flex items-center justify-center p-4">
          {type.includes('image') && <img src={url} alt={doc.name} className="max-w-full max-h-full object-contain rounded-xl shadow-lg" />}
          {type.includes('pdf') && <iframe src={url} title={doc.name} className="w-full rounded-xl border border-[#c7c4d8]" style={{ height: 'calc(90vh - 140px)', minHeight: 400 }} />}
        </div>
      </div>
    </div>
  );
}

// ── Upload Shared Document Panel ─────────────────────────────────────────────
function UploadSharedDocPanel({ allEmployees, colleagues, isEmployee, onCancel, onUploaded }) {
  const toast       = useToast();
  const { user }    = useAuth();
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [form, setForm] = useState(INIT_FORM);
  const [shareSearch, setShareSearch] = useState('');
  const fileRef = useRef();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const today = new Date().toISOString().split('T')[0];

  const adminVisOpts = [
    { value: 'all',        Icon: Globe,  label: 'All Employees',       desc: '🌍 Everyone in the organization can access this document' },
    { value: 'self',       Icon: User,   label: 'Particular Employee', desc: '👤 Visible only to the selected employee' },
    { value: 'specific',   Icon: Users,  label: 'Group of Employees',  desc: '👥 Visible only to the selected group of employees' },
    { value: 'admin_only', Icon: Lock,   label: 'Shared with HR',       desc: '🔒 Shared directly with HR for review and internal use' },
  ];

  const sharingPool = allEmployees.filter(e => String(e.id) !== form.targetUserId);
  const filteredPool = shareSearch ? sharingPool.filter(e => e.name?.toLowerCase().includes(shareSearch.toLowerCase())) : sharingPool;

  function toggleShare(id) {
    const sid = String(id);
    set('shareWith', form.shareWith.includes(sid) ? form.shareWith.filter(x => x !== sid) : [...form.shareWith, sid]);
  }

  async function handleUpload() {
    if (!pendingFile) { toast('Select a file first', 'error'); return; }
    if (!form.name.trim()) { toast('Enter a document name', 'error'); return; }
    if (!form.category) { toast('Select a category', 'error'); return; }
    if (form.visibility === 'self' && !form.targetUserId) { toast('Select the target employee', 'error'); return; }
    if (form.visibility === 'specific' && form.shareWith.length === 0) { toast('Select at least one employee', 'error'); return; }
    if (form.expiry_date && form.expiry_date < today) { toast('Expiry date cannot be in the past', 'error'); return; }
    setUploading(true);
    try {
      const token = localStorage.getItem('lt_token');
      const fd = new FormData();
      fd.append('file', pendingFile);
      fd.append('name', form.name.trim());
      fd.append('category', form.category);
      fd.append('visibility', form.visibility);
      if (form.expiry_date) fd.append('expiry_date', form.expiry_date);
      if (form.targetUserId) fd.append('userId', form.targetUserId);
      if (form.visibility === 'specific' && form.shareWith.length > 0)
        fd.append('shared_with', JSON.stringify(form.shareWith));
      const res = await fetch('/api/documents/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json().catch(() => ({ error: 'Unexpected server error. Please try again.' }));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast('Document uploaded!', 'success');
      onUploaded();
    } catch (err) { toast(err.message, 'error'); }
    finally { setUploading(false); }
  }

  return (
    <div className="card p-5 mb-5 border-[#3525cd]/20 bg-[#f0f3ff]/30">
      <input type="file" ref={fileRef} className="hidden" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) {
            if (f.size > 10 * 1024 * 1024) { toast('File size must not exceed 10 MB.', 'error'); e.target.value = ''; return; }
            setPendingFile(f); set('name', f.name.replace(/\.[^.]+$/, ''));
          }
          e.target.value = '';
        }} />
      {!pendingFile ? (
        <div
          className={`flex flex-col items-center justify-center py-8 border-2 border-dashed rounded-xl cursor-pointer transition-all ${dragActive ? 'border-[#3525cd] bg-[#f0f3ff] scale-[1.01]' : 'border-[#3525cd]/30 hover:bg-[#f0f3ff] hover:border-[#3525cd]/60'}`}
          onClick={() => fileRef.current?.click()}
          onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
          onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
          onDrop={e => {
            e.preventDefault(); e.stopPropagation(); setDragActive(false);
            const f = e.dataTransfer.files?.[0];
            if (!f) return;
            if (f.size === 0) { toast('Empty files are not allowed.', 'error'); return; }
            if (f.size > 10 * 1024 * 1024) { toast('File size must not exceed 10 MB.', 'error'); return; }
            setPendingFile(f); set('name', f.name.replace(/\.[^.]+$/, ''));
          }}>
          <UploadCloud size={32} className={`mb-2 transition-colors ${dragActive ? 'text-[#3525cd]' : 'text-[#3525cd]/70'}`} />
          <p className="text-sm font-bold text-[#151c27]">{dragActive ? 'Release to upload' : 'Click or drag a file here'}</p>
          <p className="text-xs text-[#777587] mt-1">PDF, JPG, PNG, WEBP, DOC, DOCX · Max 10 MB</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-[#e7eefe]">
            <div className="w-9 h-9 rounded-xl bg-white border border-[#c7c4d8] flex items-center justify-center">{fileIcon(pendingFile.type)}</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-[#151c27] text-sm truncate">{pendingFile.name}</p>
              <p className="text-xs text-[#777587]">{fmtBytes(pendingFile.size)}</p>
            </div>
            {canPreview(pendingFile.type) && (
              <button
                type="button"
                onClick={() => setPreviewFile({ file_url: URL.createObjectURL(pendingFile), file_type: pendingFile.type, name: pendingFile.name, file_size: pendingFile.size })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] bg-[#f0f3ff] hover:bg-[#e7eefe] transition-colors"
                title="Preview selected file"
              >
                <Eye size={12} /> Preview
              </button>
            )}
            <button className="p-1.5 rounded-lg text-[#777587] hover:text-rose-500 hover:bg-rose-50 transition-colors" onClick={() => setPendingFile(null)}><X size={16} /></button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="form-label">Document Name <span className="text-rose-500">*</span></label>
              <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Leave Policy 2026" />
            </div>
            <div>
              <label className="form-label">Expiry Date <span className="font-normal text-[#777587]">(optional)</span></label>
              <input type="date" className="form-control" value={form.expiry_date} min={today} onChange={e => set('expiry_date', e.target.value)} />
              {form.expiry_date && form.expiry_date < today && <p className="text-[0.65rem] text-rose-500 mt-1">Expiry date cannot be in the past.</p>}
            </div>
          </div>

          <div className="mb-4">
            <label className="form-label">Category <span className="text-rose-500">*</span></label>
            <div className="flex flex-wrap gap-2 mt-1">
              {EMPLOYEE_CATEGORIES.map(c => (
                <button key={c.value} type="button" onClick={() => set('category', c.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${form.category === c.value ? 'bg-[#3525cd] text-white border-[#3525cd] shadow-sm' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/50'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 p-4 rounded-xl bg-white border border-[#e7eefe]">
            <p className="form-label mb-3">Who can see this document?</p>
            <div className="space-y-2">
              {adminVisOpts.map(opt => (
                <div key={opt.value}>
                  <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${form.visibility === opt.value ? 'border-[#3525cd] bg-[#f0f3ff]' : 'border-[#e7eefe] hover:border-[#c7c4d8]'}`}>
                    <input type="radio" name="vis" value={opt.value} checked={form.visibility === opt.value}
                      onChange={e => { set('visibility', e.target.value); set('targetUserId', ''); set('shareWith', []); }}
                      className="text-[#3525cd]" />
                    <opt.Icon size={16} className="text-[#3525cd] flex-shrink-0" />
                    <div><p className="text-xs font-bold text-[#151c27]">{opt.label}</p><p className="text-[0.65rem] text-[#9ca3af]">{opt.desc}</p></div>
                  </label>
                  {opt.value === 'self' && form.visibility === 'self' && (
                    <div className="ml-10 mt-2">
                      <SearchableEmployeePicker
                        employees={allEmployees}
                        value={form.targetUserId}
                        onChange={id => set('targetUserId', id)}
                        placeholder="— Search and select employee —"
                      />
                    </div>
                  )}
                  {opt.value === 'specific' && form.visibility === 'specific' && (
                    <div className="ml-10 mt-2">
                      <input type="text" placeholder="Search employees…" className="form-control text-xs mb-2" value={shareSearch} onChange={e => setShareSearch(e.target.value)} />
                      <div className="max-h-40 overflow-y-auto border border-[#e7eefe] rounded-xl bg-[#fafaff] p-1.5 space-y-0.5">
                        {filteredPool.map(e => (
                          <label key={e.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white cursor-pointer transition-colors">
                            <input type="checkbox" checked={form.shareWith.includes(String(e.id))} onChange={() => toggleShare(e.id)} className="text-[#3525cd] rounded" />
                            <Avatar name={e.name} color={e.avatar_color} size={22} />
                            <p className="text-xs font-semibold text-[#151c27]">{e.name}</p>
                          </label>
                        ))}
                      </div>
                      {form.shareWith.length > 0 && <p className="text-xs text-[#3525cd] font-semibold mt-1.5">{form.shareWith.length} selected</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={handleUpload} disabled={uploading}>
              {uploading ? <><span className="spinner w-4 h-4" /> Uploading…</> : <><Upload size={14} /> Upload Document</>}
            </button>
          </div>
        </>
      )}
      {previewFile && (
        <PreviewModal doc={previewFile} onClose={() => {
          URL.revokeObjectURL(previewFile.file_url);
          setPreviewFile(null);
        }} />
      )}
    </div>
  );
}

// ── Admin: Shared Documents Tab ───────────────────────────────────────────────
function SharedDocumentsTab({ onUploadClick }) {
  const { user, isRootAdmin, isAdmin, can } = useAuth();
  const { selectedBranchId } = useBranch();
  const canUpload = can('documents', 'upload');
  const toast = useToast();
  const qc = useQueryClient();

  const [search, setSearch]             = useState('');
  const [catFilter, setCatFilter]       = useState('');
  const [visFilter, setVisFilter]       = useState('');
  const [empFilter, setEmpFilter]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]                 = useState(1);
  const [pageSize, setPageSize]         = useState(10);
  const [preview, setPreview]           = useState(null);
  const [editDoc, setEditDoc]           = useState(null);
  const [confirmDel, setConfirmDel]     = useState(null);
  const [requestDelDoc, setRequestDelDoc] = useState(null); // { id, name }
  const [accessDrawerDoc, setAccessDrawerDoc] = useState(null);

  const { data: _docs = [], isLoading } = useQuery({
    queryKey: ['documents', 'admin-all', selectedBranchId],
    queryFn:  () => apiGet('/documents'),
  });

  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-list-docs', selectedBranchId],
    queryFn:  async () => { const all = await apiGet('/employees'); return all.filter(e => e.role === 'employee'); },
  });

  const { data: colleagues = [] } = useQuery({
    queryKey: ['doc-colleagues', selectedBranchId],
    queryFn:  () => apiGet('/documents/colleagues'),
  });

  const delMut = useMutation({
    mutationFn: ({ id, reason }) => apiDelete(`/documents/${id}`, { reason }),
    onSuccess:  () => { toast('Document deleted.', 'success'); qc.invalidateQueries({ queryKey: ['documents'] }); setConfirmDel(null); },
    onError:    e  => toast(e.message, 'error'),
  });

  const requestDelMut = useMutation({
    mutationFn: ({ id, reason }) => apiPost(`/documents/${id}/request-delete`, { reason }),
    onSuccess:  () => { toast('Deletion request sent to Root Admin.', 'success'); setRequestDelDoc(null); },
    onError:    e  => toast(e.message, 'error'),
  });

  const today = new Date().toISOString().split('T')[0];
  const soon  = new Date(Date.now() + 30 * 864e5).toISOString().split('T')[0];

  // Stats
  const totalDocs     = _docs.length;
  const visibleToEmps = _docs.filter(d => d.visibility === 'all' || d.visibility === 'specific').length;
  const hrOnly        = _docs.filter(d => d.visibility === 'admin_only').length;
  const expiringSoon  = _docs.filter(d => d.expiry_date && d.expiry_date >= today && d.expiry_date <= soon).length;

  // Filtering
  const filtered = useMemo(() => {
    let docs = _docs;
    if (search)      docs = docs.filter(d => d.name?.toLowerCase().includes(search.toLowerCase()));
    if (catFilter)   docs = docs.filter(d => d.category === catFilter);
    if (visFilter)   docs = docs.filter(d => d.visibility === visFilter);
    if (empFilter)   docs = docs.filter(d => String(d.user_id) === empFilter || (d.document_shares || []).some(s => String(s.shared_with_user_id) === empFilter));
    if (statusFilter === 'expired')  docs = docs.filter(d => d.expiry_date && d.expiry_date < today);
    if (statusFilter === 'expiring') docs = docs.filter(d => d.expiry_date && d.expiry_date >= today && d.expiry_date <= soon);
    if (statusFilter === 'active')   docs = docs.filter(d => !d.expiry_date || d.expiry_date > soon);
    return docs;
  }, [_docs, search, catFilter, visFilter, empFilter, statusFilter, today, soon]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated  = filtered.slice((page - 1) * pageSize, page * pageSize);

  const uniqueEmployees = [...new Map(_docs.map(d => [d.user_id, { id: d.user_id, name: d.owner?.name }])).values()].filter(e => e.name);

  function resetFilters() { setSearch(''); setCatFilter(''); setVisFilter(''); setEmpFilter(''); setStatusFilter(''); setPage(1); }
  function getSharedWith(doc) {
    if (doc.visibility === 'all') return <span className="text-[#464555]">Everyone</span>;
    if (doc.visibility === 'admin_only') return <span className="text-[#464555]">Shared with HR</span>;
    if (doc.visibility === 'self') return <span className="text-[#464555]">{doc.owner?.name || '—'}</span>;
    if (doc.visibility === 'specific') {
      const count = (doc.document_shares || []).length;
      if (count === 0) return <span className="text-[#464555]">None</span>;
      return (
        <button
          onClick={e => { e.stopPropagation(); setAccessDrawerDoc(doc); }}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-[#f0f3ff] text-[#3525cd] border border-[#e7eefe] hover:bg-[#e7eefe] transition-colors">
          <Users size={11} /> {count} Employee{count !== 1 ? 's' : ''}
        </button>
      );
    }
    return <span className="text-[#464555]">—</span>;
  }

  function getUploadedBy(doc) {
    if (doc.uploader?.name) return doc.uploader;
    if (doc.owner?.name && doc.uploaded_by === doc.user_id) return doc.owner;
    return null;
  }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { icon: <FolderOpen size={20} className="text-[#3525cd]" />, num: totalDocs,     label: 'Total Shared Documents', sub: 'All organization documents',  bg: 'bg-[#f0f3ff]' },
          { icon: <Users size={20} className="text-emerald-600" />,    num: visibleToEmps, label: 'Visible to Employees',   sub: 'Shared with employees',        bg: 'bg-emerald-50' },
          { icon: <ShieldCheck size={20} className="text-slate-600" />,num: hrOnly,        label: 'HR / Admin Only',        sub: 'Restricted to HR & Admins',    bg: 'bg-slate-50' },
          { icon: <Clock size={20} className="text-amber-600" />,      num: expiringSoon,  label: 'Expiring Soon',          sub: 'Within next 30 days',          bg: 'bg-amber-50' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-[#c7c4d8] p-4 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>{s.icon}</div>
            <div>
              <p className="text-2xl font-black text-[#151c27]">{s.num}</p>
              <p className="text-xs font-bold text-[#464555] leading-tight">{s.label}</p>
              <p className="text-[0.65rem] text-[#9ca3af] leading-tight">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] p-4 mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
            <input className="form-control pl-9 text-xs" placeholder="Search documents..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <FilterSelect label="Category" value={catFilter} onChange={v => { setCatFilter(v); setPage(1); }}
            options={[{ value: '', label: 'All Categories' }, ...EMPLOYEE_CATEGORIES.map(c => ({ value: c.value, label: c.label }))]} />
          <FilterSelect label="Visibility" value={visFilter} onChange={v => { setVisFilter(v); setPage(1); }}
            options={[{ value: '', label: 'All Visibility' }, { value: 'all', label: 'All Employees' }, { value: 'specific', label: 'Shared with Employees' }, { value: 'admin_only', label: 'Shared with HR' }, { value: 'self', label: 'Particular Employee' }]} />
          <FilterSelect label="Employee" value={empFilter} onChange={v => { setEmpFilter(v); setPage(1); }}
            options={[{ value: '', label: 'All' }, ...uniqueEmployees.map(e => ({ value: String(e.id), label: e.name }))]} />
          <FilterSelect label="Status" value={statusFilter} onChange={v => { setStatusFilter(v); setPage(1); }}
            options={[{ value: '', label: 'All Status' }, { value: 'active', label: 'Active' }, { value: 'expiring', label: 'Expiring Soon' }, { value: 'expired', label: 'Expired' }]} />
          <button onClick={resetFilters} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-[#777587] border border-[#c7c4d8] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors">
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading documents…</div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c7c4d8] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#f0f3ff] flex items-center justify-between">
            <p className="text-sm font-black text-[#151c27]">Shared Documents ({filtered.length})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
                <tr>
                  {['DOCUMENT','CATEGORY','VISIBILITY','SHARED WITH','UPLOADED BY','UPLOADED ON','EXPIRY','ACTIONS'].map(h => (
                    <th key={h} className="px-4 py-3 font-black text-[#464555] text-[0.65rem] tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {paginated.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-[#9ca3af]">No documents found</td></tr>
                ) : paginated.map(doc => {
                  const cat   = CAT_MAP[doc.category] || { label: doc.category || 'Other', icon: '📄' };
                  const vis   = VIS_CFG[doc.visibility || 'self'];
                  const dl    = daysLeft(doc.expiry_date);
                  const isExp = dl !== null && dl < 0;
                  const isExpng = dl !== null && dl >= 0 && dl <= 30;
                  return (
                    <tr key={doc.id} className="hover:bg-[#fafaff] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">{fileIcon(doc.file_type, 14)}</div>
                          <div>
                            <p className="font-bold text-[#151c27] truncate max-w-[150px]">{doc.name}</p>
                            <p className="text-[0.6rem] text-[#9ca3af]">{fmtBytes(doc.file_size)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="px-2.5 py-1 rounded-full text-[0.65rem] font-bold bg-[#f0f3ff] text-[#464555] border border-[#c7c4d8]">{cat.label}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        {vis && <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.65rem] font-bold border ${vis.cls}`}>{vis.icon}{vis.label}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-[#464555] font-medium">{getSharedWith(doc)}</td>
                      <td className="px-4 py-3.5">
                        {(() => { const uploader = getUploadedBy(doc); return uploader ? (
                          <div className="flex items-center gap-2">
                            <Avatar name={uploader.name} color={uploader.avatar_color} size={24} />
                            <p className="font-semibold text-[#151c27] truncate max-w-[100px]">{uploader.name}</p>
                          </div>
                        ) : <span className="text-[#9ca3af]">—</span>; })()}
                      </td>
                      <td className="px-4 py-3.5 text-[#777587] whitespace-nowrap">{fmtDateTime(doc.created_at)}</td>
                      <td className="px-4 py-3.5">
                        {doc.expiry_date ? (
                          <div>
                            <p className={`text-[0.65rem] font-semibold ${isExp ? 'text-rose-600' : isExpng ? 'text-amber-600' : 'text-[#777587]'}`}>{fmtDate(doc.expiry_date)}</p>
                            {dl !== null && !isExp && <p className="text-[0.6rem] text-[#9ca3af]">({dl} days left)</p>}
                            {isExp && <p className="text-[0.6rem] text-rose-500">Expired</p>}
                          </div>
                        ) : <span className="text-[#9ca3af]">—</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1">
                          {canPreview(doc.file_type) ? (
                            <button title="View" onClick={() => setPreview(doc)} className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"><Eye size={13} /></button>
                          ) : (
                            <a href={doc.file_url} target="_blank" rel="noopener noreferrer" title="Open" className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"><ExternalLink size={13} /></a>
                          )}
                          <button title="Edit" onClick={() => setEditDoc(doc)} className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"><Edit2 size={13} /></button>
                          {isRootAdmin && (
                            <button title="Delete (Root Admin only)" onClick={() => setConfirmDel({ id: doc.id, name: doc.name })} className="p-1.5 rounded-lg text-[#c7c4d8] hover:text-rose-500 hover:bg-rose-50 transition-colors"><Trash2 size={13} /></button>
                          )}
                          {isAdmin && !isRootAdmin && (
                            <button title="Request deletion (sends to Root Admin)" onClick={() => setRequestDelDoc({ id: doc.id, name: doc.name })} className="p-1.5 rounded-lg text-[#c7c4d8] hover:text-amber-500 hover:bg-amber-50 transition-colors"><Trash2 size={13} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-5 py-3 border-t border-[#f0f3ff] flex items-center justify-between gap-4">
            <p className="text-xs text-[#777587]">
              Showing {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1} to {Math.min(page * pageSize, filtered.length)} of {filtered.length} documents
            </p>
            <div className="flex items-center gap-2">
              <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft size={14} /></button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                return (
                  <button key={p} onClick={() => setPage(p)} className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${p === page ? 'bg-[#3525cd] text-white' : 'text-[#777587] hover:bg-[#f0f3ff]'}`}>{p}</button>
                );
              })}
              <button disabled={page === totalPages || totalPages === 0} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight size={14} /></button>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} className="ml-2 border border-[#c7c4d8] rounded-lg px-2 py-1.5 text-xs text-[#464555] bg-white">
                {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
      {editDoc && (
        <EditDocModal doc={editDoc} isAdmin allEmployees={allEmployees} colleagues={colleagues}
          onClose={() => setEditDoc(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['documents'] }); setEditDoc(null); }} />
      )}
      <DeleteWithReasonModal
        open={!!confirmDel}
        docName={confirmDel?.name}
        onConfirm={reason => delMut.mutate({ id: confirmDel.id, reason })}
        onCancel={() => setConfirmDel(null)}
      />
      <RequestDeleteModal
        open={!!requestDelDoc}
        docName={requestDelDoc?.name}
        requesting={requestDelMut.isPending}
        onConfirm={reason => requestDelMut.mutate({ id: requestDelDoc.id, reason })}
        onCancel={() => setRequestDelDoc(null)}
      />

      {/* ── Employees with Access Drawer ──────────────────────────────── */}
      {accessDrawerDoc && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setAccessDrawerDoc(null)} />
          <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col overflow-hidden">
            {/* Drawer header */}
            <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-[#151c27]">Employees with Access</p>
                <p className="text-xs text-[#777587] mt-0.5 truncate max-w-[200px]">{accessDrawerDoc.name}</p>
              </div>
              <button onClick={() => setAccessDrawerDoc(null)} className="p-1.5 rounded-lg text-[#777587] hover:text-rose-500 hover:bg-rose-50 transition-colors">
                <X size={16} />
              </button>
            </div>
            {/* Doc info strip */}
            <div className="px-5 py-3 bg-[#f9f9ff] border-b border-[#f0f3ff] flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">{fileIcon(accessDrawerDoc.file_type, 14)}</div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#151c27] truncate">{accessDrawerDoc.name}</p>
                <p className="text-[0.65rem] text-[#9ca3af]">{fmtBytes(accessDrawerDoc.file_size)} · {accessDrawerDoc.category} · Visibility: Specific Employees</p>
              </div>
            </div>
            {/* Employee list */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-5 py-3 border-b border-[#f0f3ff]">
                <p className="text-xs font-bold text-[#777587]">{(accessDrawerDoc.document_shares || []).length} Employee{(accessDrawerDoc.document_shares || []).length !== 1 ? 's' : ''} have access</p>
              </div>
              {(accessDrawerDoc.document_shares || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-5">
                  <Users size={32} className="text-[#c7c4d8] mb-2" />
                  <p className="text-sm text-[#777587]">No employees have been given access.</p>
                </div>
              ) : (
                <div className="divide-y divide-[#f0f3ff]">
                  {(accessDrawerDoc.document_shares || []).map((share, i) => (
                    <div key={share.id || i} className="flex items-center gap-3 px-5 py-3.5">
                      <Avatar name={share.employee?.name || share.shared_with_user_id} color={share.employee?.avatar_color} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#151c27] truncate">{share.employee?.name || `Employee #${share.shared_with_user_id}`}</p>
                        <p className="text-xs text-[#777587] truncate">{share.employee?.department || '—'}</p>
                        {share.created_at && <p className="text-[0.65rem] text-[#9ca3af] mt-0.5">Shared {fmtDate(share.created_at?.slice(0, 10))}</p>}
                      </div>
                      {accessDrawerDoc.file_url && (
                        <button onClick={() => setPreview(accessDrawerDoc)} title="View document" className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors">
                          <Eye size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Footer */}
            <div className="px-5 py-4 border-t border-[#f0f3ff] bg-[#f9f9ff]">
              <p className="text-[0.65rem] text-[#9ca3af] flex items-center gap-1.5">
                <Lock size={10} /> These employees can view and download this document based on the assigned permissions.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Filter Select Helper ─────────────────────────────────────────────────────
function FilterSelect({ value, onChange, options }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none border border-[#c7c4d8] rounded-lg px-3 py-2 pr-7 text-xs text-[#464555] bg-white hover:border-[#3525cd]/40 focus:border-[#3525cd] focus:outline-none transition-colors min-w-[120px]">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9ca3af] pointer-events-none" />
    </div>
  );
}

// ── Standard document type options for BUG_081 ──────────────────────────────
const STANDARD_DOC_TYPES = [
  'Aadhaar Card', 'PAN Card', 'Passport', 'Driving License', 'Voter ID',
  'Birth Certificate', 'Education Certificate', 'Experience Letter',
  'Offer Letter', 'Relieving Letter', 'Bank Statement',
  'Medical Certificate', 'Police Verification', 'NOC Letter',
  'Salary Slip', 'Tax Return (ITR)', 'Nomination Form',
];

// ── Admin: Requirement Modal (create/edit) ───────────────────────────────────
function RequirementModal({ req, onClose, onSaved, existingRequirements = [] }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  // BUG_081: track whether user picked a standard type or is entering custom
  const isEditingExistingCustom = req?.name && !STANDARD_DOC_TYPES.includes(req.name);
  const [selectedDocType, setSelectedDocType] = useState(
    req?.name ? (STANDARD_DOC_TYPES.includes(req.name) ? req.name : 'Custom...') : ''
  );
  const [customDocName, setCustomDocName] = useState(isEditingExistingCustom ? req.name : '');

  const [form, setForm] = useState({
    name:                  req?.name || '',
    description:           req?.description || '',
    category:              req?.category || 'other',
    is_required:           req?.is_required !== false,
    accepted_formats:      req?.accepted_formats || ['pdf', 'jpg', 'png'],
    max_file_size_mb:      req?.max_file_size_mb || 10,
    expiry_required:       req?.expiry_required || false,
    verification_required: req?.verification_required !== false,
    allow_reupload:        req?.allow_reupload !== false,
    display_order:         req?.display_order || 0,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // BUG_081: sync the resolved document name into form.name
  function handleDocTypeChange(value) {
    setSelectedDocType(value);
    if (value !== 'Custom...') {
      set('name', value);
      setCustomDocName('');
    } else {
      set('name', '');
    }
  }

  function handleCustomNameChange(e) {
    const val = e.target.value.replace(/[^a-zA-Z\s\-\/().]/g, '');
    setCustomDocName(val);
    set('name', val);
  }

  const formatOptions = ['pdf', 'jpg', 'png', 'doc', 'docx'];
  function toggleFormat(fmt) {
    set('accepted_formats', form.accepted_formats.includes(fmt)
      ? form.accepted_formats.filter(f => f !== fmt)
      : [...form.accepted_formats, fmt]);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast('Document name is required', 'error'); return; }
    if (form.accepted_formats.length === 0) { toast('Select at least one accepted format', 'error'); return; }

    // BUG_081: duplicate check — skip when editing same requirement
    const normalizedName = form.name.trim().toLowerCase();
    const isDuplicate = existingRequirements.some(r => {
      if (req?.id && r.id === req.id) return false; // skip self when editing
      return r.name?.trim().toLowerCase() === normalizedName;
    });
    if (isDuplicate) {
      toast(`A requirement named "${form.name.trim()}" already exists.`, 'error');
      return;
    }

    setSaving(true);
    try {
      if (req?.id) {
        await apiPatch(`/doc-requirements/${req.id}`, form);
        toast('Requirement updated!', 'success');
      } else {
        await apiPost('/doc-requirements', form);
        toast('Requirement created!', 'success');
      }
      qc.invalidateQueries({ queryKey: ['doc-requirements'] });
      onSaved();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff] flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center"><ClipboardList size={16} className="text-[#3525cd]" /></div>
          <div className="flex-1">
            <p className="font-black text-[#151c27] text-sm">{req ? 'Edit Requirement' : 'Create Document Requirement'}</p>
            <p className="text-xs text-[#777587]">Define what documents employees must upload</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-[#777587] hover:bg-[#f0f3ff] transition-colors"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* BUG_081: Document type dropdown + custom input */}
          <div>
            <label className="form-label">Document Type <span className="text-rose-500">*</span></label>
            <div className="relative">
              <select
                className="form-control appearance-none pr-8"
                value={selectedDocType}
                onChange={e => handleDocTypeChange(e.target.value)}
              >
                <option value="">— Select document type —</option>
                {STANDARD_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                <option value="Custom...">Custom...</option>
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] pointer-events-none" />
            </div>
            {selectedDocType === 'Custom...' && (
              <div className="mt-2">
                <input
                  className="form-control"
                  value={customDocName}
                  placeholder="Enter custom document name…"
                  onChange={handleCustomNameChange}
                  autoFocus
                />
                <p className="text-[0.65rem] text-[#9ca3af] mt-1">Only letters, spaces, and basic punctuation allowed</p>
              </div>
            )}
          </div>

          <div>
            <label className="form-label">Description</label>
            <textarea className="form-control" rows={2} value={form.description} placeholder="Brief description of what to upload…" onChange={e => set('description', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Category</label>
              <select className="form-control" value={form.category} onChange={e => set('category', e.target.value)}>
                {EMPLOYEE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Max File Size (MB)</label>
              <input type="number" min={1} max={50} className="form-control" value={form.max_file_size_mb}
                onChange={e => {
                  const v = parseInt(e.target.value);
                  if (!isNaN(v) && v >= 1 && v <= 50) set('max_file_size_mb', v);
                }} />
            </div>
          </div>

          <div>
            <label className="form-label">Accepted Formats <span className="text-rose-500">*</span></label>
            <div className="flex flex-wrap gap-2 mt-1">
              {formatOptions.map(fmt => (
                <button key={fmt} type="button" onClick={() => toggleFormat(fmt)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border uppercase transition-all ${form.accepted_formats.includes(fmt) ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/50'}`}>
                  {fmt}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Required?</label>
              <div className="flex gap-3 mt-1">
                {[{ v: true, l: 'Required' }, { v: false, l: 'Optional' }].map(o => (
                  <label key={String(o.v)} className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${form.is_required === o.v ? 'border-[#3525cd] bg-[#f0f3ff] text-[#3525cd]' : 'border-[#e7eefe] text-[#777587]'}`}>
                    <input type="radio" name="is_req" checked={form.is_required === o.v} onChange={() => set('is_required', o.v)} className="hidden" />{o.l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Expiry Date Required?</label>
              <div className="flex gap-3 mt-1">
                {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map(o => (
                  <label key={String(o.v)} className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${form.expiry_required === o.v ? 'border-[#3525cd] bg-[#f0f3ff] text-[#3525cd]' : 'border-[#e7eefe] text-[#777587]'}`}>
                    <input type="radio" name="expiry_req" checked={form.expiry_required === o.v} onChange={() => set('expiry_required', o.v)} className="hidden" />{o.l}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Verification Required?</label>
              <div className="flex gap-3 mt-1">
                {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map(o => (
                  <label key={String(o.v)} className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${form.verification_required === o.v ? 'border-[#3525cd] bg-[#f0f3ff] text-[#3525cd]' : 'border-[#e7eefe] text-[#777587]'}`}>
                    <input type="radio" name="verif" checked={form.verification_required === o.v} onChange={() => set('verification_required', o.v)} className="hidden" />{o.l}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Allow Re-upload?</label>
              <div className="flex gap-3 mt-1">
                {[{ v: true, l: 'Yes' }, { v: false, l: 'No' }].map(o => (
                  <label key={String(o.v)} className={`flex-1 flex items-center justify-center gap-2 p-2.5 rounded-xl border cursor-pointer text-xs font-bold transition-all ${form.allow_reupload === o.v ? 'border-[#3525cd] bg-[#f0f3ff] text-[#3525cd]' : 'border-[#e7eefe] text-[#777587]'}`}>
                    <input type="radio" name="reupload" checked={form.allow_reupload === o.v} onChange={() => set('allow_reupload', o.v)} className="hidden" />{o.l}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="form-label">Display Order</label>
            <input type="number" min={0} className="form-control" value={form.display_order}
              onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 0) set('display_order', v); }} />
            <p className="text-[0.65rem] text-[#9ca3af] mt-1">Lower number appears first (0 = first)</p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#f0f3ff] flex gap-3 flex-shrink-0">
          <button className="btn btn-outline flex-1" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner w-4 h-4" /> Saving…</> : <><CheckCircle2 size={14} /> {req ? 'Save Changes' : 'Create Requirement'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Requirement Assignment Modal ─────────────────────────────────────────────
function RequirementAssignModal({ requirement, employees, onClose, onSaved }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { selectedBranchId } = useBranch();

  // Derive initial mode from existing requirement data
  const hasBranches = requirement.assigned_branch_ids?.length > 0;
  const hasEmployees = requirement.assigned_employee_ids?.length > 0;
  const initMode = hasBranches ? 'branch' : hasEmployees ? 'specific' : 'all';

  const [mode, setMode]             = useState(initMode);
  const [selected, setSelected]     = useState((requirement.assigned_employee_ids || []).map(String));
  const [selBranches, setSelBranches] = useState((requirement.assigned_branch_ids || []).map(String));
  const [search, setSearch]         = useState('');
  const [saving, setSaving]         = useState(false);

  // Fetch org branches for branch picker
  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => apiGet('/branches'),
  });
  const activeBranches = branches.filter(b => b.is_active !== false);

  const filtered = useMemo(() => {
    if (!search.trim()) return employees;
    const q = search.toLowerCase();
    return employees.filter(e => e.name?.toLowerCase().includes(q) || e.department?.toLowerCase().includes(q));
  }, [employees, search]);

  function toggleEmp(id) {
    const sid = String(id);
    setSelected(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  }

  function toggleBranch(id) {
    const sid = String(id);
    setSelBranches(prev => prev.includes(sid) ? prev.filter(x => x !== sid) : [...prev, sid]);
  }

  async function handleSave() {
    if (mode === 'specific' && selected.length === 0) { toast('Select at least one employee', 'error'); return; }
    if (mode === 'branch'   && selBranches.length === 0) { toast('Select at least one branch', 'error'); return; }
    setSaving(true);
    try {
      const payload = {};
      if (mode === 'all') {
        payload.employee_ids = null;
        payload.branch_ids   = null;
      } else if (mode === 'specific') {
        payload.employee_ids = selected.map(Number);
        payload.branch_ids   = null;
      } else {
        // mode === 'branch'
        payload.branch_ids   = selBranches.map(Number);
        payload.employee_ids = null;
      }
      await apiPost(`/doc-requirements/${requirement.id}/assign`, payload);
      toast('Assignment saved!', 'success');
      qc.invalidateQueries({ queryKey: ['doc-requirements', selectedBranchId] });
      onSaved();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff] flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center"><UserPlus size={16} className="text-[#3525cd]" /></div>
          <div className="flex-1">
            <p className="font-black text-[#151c27] text-sm">Assign Requirement</p>
            <p className="text-xs text-[#777587] truncate">{requirement.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-[#777587] hover:bg-[#f0f3ff]"><X size={18} /></button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          <div>
            <label className="form-label mb-2">Assign To</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'all',      label: 'All Employees',      desc: 'Visible to everyone in the organization', Icon: Globe },
                { v: 'specific', label: 'Specific Employees', desc: 'Only visible to selected employees',      Icon: Users },
                { v: 'branch',   label: 'By Branch',          desc: 'Only visible to employees in selected branches', Icon: Building2 },
              ].map(opt => (
                <label key={opt.v} className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${mode === opt.v ? 'border-[#3525cd] bg-[#f0f3ff]' : 'border-[#e7eefe] hover:border-[#c7c4d8]'}`}>
                  <input type="radio" name="assign-mode" value={opt.v} checked={mode === opt.v} onChange={() => setMode(opt.v)} className="mt-0.5 text-[#3525cd]" />
                  <div>
                    <p className="text-xs font-bold text-[#151c27]">{opt.label}</p>
                    <p className="text-[0.6rem] text-[#9ca3af] leading-tight">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {mode === 'all' && (
            <div className="p-3 rounded-xl bg-[#f0f3ff] border border-[#3525cd]/20">
              <p className="text-xs text-[#3525cd] font-semibold flex items-center gap-2">
                <Globe size={13} /> Visible to all {employees.length} active employees.
              </p>
            </div>
          )}

          {mode === 'branch' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="form-label mb-0">Select Branches</label>
                {selBranches.length > 0 && <span className="text-xs font-bold text-[#3525cd]">{selBranches.length} selected</span>}
              </div>
              {selBranches.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selBranches.map(sid => {
                    const br = activeBranches.find(b => String(b.id) === sid);
                    return br ? (
                      <span key={sid} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold bg-[#3525cd]/10 text-[#3525cd] border border-[#3525cd]/20">
                        {br.name}
                        <button onClick={() => toggleBranch(sid)} className="ml-0.5 hover:text-rose-500 transition-colors"><X size={10} /></button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}
              <div className="border border-[#e7eefe] rounded-xl max-h-44 overflow-y-auto">
                {activeBranches.length === 0 ? (
                  <p className="text-xs text-center text-[#9ca3af] py-6">No active branches found</p>
                ) : activeBranches.map(br => (
                  <label key={br.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#fafaff] cursor-pointer transition-colors border-b border-[#f0f3ff] last:border-0">
                    <input type="checkbox" checked={selBranches.includes(String(br.id))} onChange={() => toggleBranch(br.id)} className="text-[#3525cd] rounded flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#151c27] truncate">{br.name}</p>
                      {br.location && <p className="text-[0.6rem] text-[#9ca3af]">{br.location}</p>}
                    </div>
                    {selBranches.includes(String(br.id)) && <CheckCircle2 size={13} className="text-[#3525cd] flex-shrink-0" />}
                  </label>
                ))}
              </div>
            </div>
          )}

          {mode === 'specific' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="form-label mb-0">Select Employees</label>
                {selected.length > 0 && <span className="text-xs font-bold text-[#3525cd]">{selected.length} selected</span>}
              </div>
              {selected.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {selected.map(sid => {
                    const emp = employees.find(e => String(e.id) === sid);
                    return emp ? (
                      <span key={sid} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-bold bg-[#3525cd]/10 text-[#3525cd] border border-[#3525cd]/20">
                        {emp.name}
                        <button onClick={() => toggleEmp(sid)} className="ml-0.5 hover:text-rose-500 transition-colors"><X size={10} /></button>
                      </span>
                    ) : null;
                  })}
                </div>
              )}
              <div className="relative mb-2">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
                <input className="form-control pl-8 text-xs" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="border border-[#e7eefe] rounded-xl max-h-52 overflow-y-auto">
                {filtered.length === 0 ? (
                  <p className="text-xs text-center text-[#9ca3af] py-6">No employees found</p>
                ) : filtered.map(emp => (
                  <label key={emp.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#fafaff] cursor-pointer transition-colors border-b border-[#f0f3ff] last:border-0">
                    <input type="checkbox" checked={selected.includes(String(emp.id))} onChange={() => toggleEmp(emp.id)} className="text-[#3525cd] rounded flex-shrink-0" />
                    <Avatar name={emp.name} color={emp.avatar_color} size={24} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#151c27] truncate">{emp.name}</p>
                      {emp.department && <p className="text-[0.6rem] text-[#9ca3af]">{emp.department}</p>}
                    </div>
                    {selected.includes(String(emp.id)) && <CheckCircle2 size={13} className="text-[#3525cd] flex-shrink-0" />}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#f0f3ff] flex gap-3 flex-shrink-0">
          <button className="btn btn-outline flex-1" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner w-4 h-4" /> Saving…</> : <><CheckCircle2 size={14} /> Save Assignment</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Admin: Employee Requirements Tab ─────────────────────────────────────────
function EmployeeRequirementsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [modal, setModal]           = useState(null);
  const [assignModal, setAssignModal] = useState(null); // requirement object
  const [confirmDel, setConfirmDel] = useState(null);

  const { data: requirements = [], isLoading } = useQuery({
    queryKey: ['doc-requirements', selectedBranchId],
    queryFn:  () => apiGet('/doc-requirements'),
  });

  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-list-docs', selectedBranchId],
    queryFn:  async () => { const all = await apiGet('/employees'); return all.filter(e => e.role === 'employee' && e.status === 'active'); },
  });

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/doc-requirements/${id}`),
    onSuccess:  () => { toast('Requirement deleted.', 'success'); qc.invalidateQueries({ queryKey: ['doc-requirements'] }); setConfirmDel(null); },
    onError:    e  => toast(e.message, 'error'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => apiPatch(`/doc-requirements/${id}`, { is_active }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['doc-requirements'] }),
    onError:    e  => toast(e.message, 'error'),
  });

  function getAssignedLabel(req) {
    if (req.assigned_branch_ids?.length) {
      return (
        <span className="flex items-center gap-1 text-[#3525cd] font-bold">
          <Building2 size={10} /> {req.assigned_branch_ids.length} branch{req.assigned_branch_ids.length !== 1 ? 'es' : ''}
        </span>
      );
    }
    if (!req.assigned_employee_ids?.length) return <span className="text-[#9ca3af]">All</span>;
    return (
      <span className="flex items-center gap-1 text-[#3525cd] font-bold">
        <Users size={10} /> {req.assigned_employee_ids.length}
      </span>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-black text-[#151c27]">Document Requirements</p>
          <p className="text-xs text-[#777587]">Define documents employees must upload for compliance.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('create')}>
          <Plus size={14} /> Create Requirement
        </button>
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading requirements…</div>
      ) : requirements.length === 0 ? (
        <div className="empty-state">
          <ClipboardList size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p>No document requirements yet</p>
          <p className="text-sm text-[#9ca3af] mt-1">Create requirements to build your employee compliance checklist.</p>
          <button className="btn btn-primary mt-4" onClick={() => setModal('create')}><Plus size={14} /> Create First Requirement</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c7c4d8] overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
              <tr>
                {['DOCUMENT', 'CATEGORY', 'TYPE', 'FORMATS', 'ASSIGNED TO', 'SUBMISSIONS', 'STATUS', 'ACTIONS'].map(h => (
                  <th key={h} className="px-4 py-3 font-black text-[#464555] text-[0.65rem] tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f3ff]">
              {requirements.map(req => {
                const stats = req._stats || {};
                return (
                  <tr key={req.id} className="hover:bg-[#fafaff] transition-colors">
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-[#151c27]">{req.name}</p>
                      {req.description && <p className="text-[0.65rem] text-[#9ca3af] mt-0.5 truncate max-w-[180px]">{req.description}</p>}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="px-2.5 py-1 rounded-full text-[0.65rem] font-bold bg-[#f0f3ff] text-[#464555] border border-[#c7c4d8]">
                        {CAT_MAP[req.category]?.label || req.category}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2.5 py-1 rounded-full text-[0.65rem] font-bold border ${req.is_required ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-[#f0f3ff] text-[#464555] border-[#c7c4d8]'}`}>
                        {req.is_required ? 'Required' : 'Optional'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {(req.accepted_formats || []).map(f => (
                          <span key={f} className="px-2 py-0.5 rounded text-[0.6rem] font-bold bg-[#f0f3ff] text-[#3525cd] border border-[#3525cd]/20 uppercase">{f}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">{getAssignedLabel(req)}</td>
                    <td className="px-4 py-3.5">
                      <div className="space-y-0.5">
                        <p className="text-[0.65rem] text-[#151c27] font-bold">{stats.total || 0} total</p>
                        <p className="text-[0.6rem] text-emerald-600">{stats.approved || 0} approved</p>
                        <p className="text-[0.6rem] text-amber-600">{(stats.under_review || 0) + (stats.hr_approved || 0)} reviewing</p>
                        {(stats.rejected || 0) > 0 && <p className="text-[0.6rem] text-rose-600">{stats.rejected} rejected</p>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`px-2.5 py-1 rounded-full text-[0.65rem] font-bold border ${req.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                        {req.is_active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1">
                        <button title="Edit" onClick={() => setModal(req)} className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"><Edit2 size={13} /></button>
                        <button title="Assign to Employees" onClick={() => setAssignModal(req)} className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"><UserPlus size={13} /></button>
                        <button title={req.is_active ? 'Disable' : 'Enable'}
                          onClick={() => toggleMut.mutate({ id: req.id, is_active: !req.is_active })}
                          className="p-1.5 rounded-lg text-[#777587] hover:text-amber-600 hover:bg-amber-50 transition-colors">
                          {req.is_active ? <XCircle size={13} /> : <CheckCircle size={13} />}
                        </button>
                        <button title="Delete" onClick={() => setConfirmDel({ id: req.id, name: req.name })} className="p-1.5 rounded-lg text-[#c7c4d8] hover:text-rose-500 hover:bg-rose-50 transition-colors"><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && <RequirementModal req={modal === 'create' ? null : modal} existingRequirements={requirements} onClose={() => setModal(null)} onSaved={() => setModal(null)} />}
      {assignModal && <RequirementAssignModal requirement={assignModal} employees={allEmployees} onClose={() => setAssignModal(null)} onSaved={() => setAssignModal(null)} />}
      <ConfirmModal open={!!confirmDel} title="Delete Requirement"
        message={<>Delete requirement <strong>"{confirmDel?.name}"</strong>? All employee submissions for this requirement will also be deleted.</>}
        confirmLabel="Delete" onConfirm={() => delMut.mutate(confirmDel.id)} onCancel={() => setConfirmDel(null)} />
    </div>
  );
}

// ── Admin: Review Modal ──────────────────────────────────────────────────────
function ReviewModal({ submission, onClose, onReviewed }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { isRootAdmin } = useAuth();
  const [action, setAction]   = useState('');
  const [reason, setReason]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [preview, setPreview] = useState(false);

  // re_upload_requested = waiting for the employee to re-upload; no admin action available yet.
  // Review is only possible once the employee has re-uploaded (status → under_review).
  const isHrReviewable   = submission.status === 'under_review';
  const isRootReviewable = isRootAdmin && (isHrReviewable || submission.status === 'hr_approved');
  const isReviewable     = isRootAdmin ? isRootReviewable : isHrReviewable;

  // Build action options based on role
  const actionOptions = isRootAdmin
    ? [
        { v: 'approved',            label: 'Final Approve',    cls: 'border-emerald-200 text-emerald-700', active: 'bg-emerald-500 text-white border-emerald-500' },
        { v: 'rejected',            label: 'Reject',           cls: 'border-rose-200 text-rose-700',       active: 'bg-rose-500 text-white border-rose-500' },
        { v: 're_upload_requested', label: 'Request Re-upload',cls: 'border-amber-200 text-amber-700',     active: 'bg-amber-500 text-white border-amber-500' },
      ]
    : [
        { v: 'hr_approved',         label: 'Approve for Review', cls: 'border-yellow-300 text-yellow-700', active: 'bg-yellow-500 text-white border-yellow-500' },
        { v: 'rejected',            label: 'Reject',             cls: 'border-rose-200 text-rose-700',     active: 'bg-rose-500 text-white border-rose-500' },
        { v: 're_upload_requested', label: 'Request Re-upload',  cls: 'border-amber-200 text-amber-700',   active: 'bg-amber-500 text-white border-amber-500' },
      ];

  function getToastMsg(act) {
    if (act === 'approved')            return 'Document approved!';
    if (act === 'hr_approved')         return 'Document marked as HR Approved — awaiting Root Admin final approval.';
    if (act === 'rejected')            return 'Document rejected.';
    if (act === 're_upload_requested') return 'Re-upload requested.';
    return 'Review submitted.';
  }

  async function handleReview() {
    if (!action) { toast('Select an action', 'error'); return; }
    if ((action === 'rejected' || action === 're_upload_requested') && !reason.trim()) {
      toast('Please provide a reason', 'error'); return;
    }
    setSaving(true);
    try {
      await apiPatch(`/doc-requirements/submissions/${submission.id}/review`, { action, reason: reason.trim() });
      toast(getToastMsg(action), 'success');
      qc.invalidateQueries({ queryKey: ['verification-queue'] });
      onReviewed();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  const emp = submission.employee;
  const req = submission.requirement;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff] flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center"><FileCheck size={16} className="text-[#3525cd]" /></div>
          <div className="flex-1">
            <p className="font-black text-[#151c27] text-sm">{isReviewable ? 'Review Document' : 'View Submission'}</p>
            <p className="text-xs text-[#777587]">{req?.name}</p>
          </div>
          <StatusBadge status={submission.status} />
          <button onClick={onClose} className="p-2 rounded-lg text-[#777587] hover:bg-[#f0f3ff] transition-colors"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Employee info */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <Avatar name={emp?.name} color={emp?.avatar_color} size={40} />
            <div>
              <p className="font-bold text-[#151c27] text-sm">{emp?.name}</p>
              <p className="text-xs text-[#777587]">{emp?.position || emp?.department || emp?.email}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-[#777587]">Uploaded</p>
              <p className="text-xs font-bold text-[#151c27]">{fmtDate(submission.uploaded_at?.slice(0, 10))}</p>
              {submission.version > 1 && <p className="text-[0.65rem] text-[#3525cd]">Version {submission.version}</p>}
            </div>
          </div>

          {/* Document preview */}
          <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-white border border-[#e7eefe] flex items-center justify-center">{fileIcon(submission.file_type, 14)}</div>
              <div className="flex-1">
                <p className="text-xs font-bold text-[#151c27]">{submission.file_name || req?.name}</p>
                <p className="text-[0.65rem] text-[#9ca3af]">{fmtBytes(submission.file_size)}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {canPreview(submission.file_type) && (
                  <button onClick={() => setPreview(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] bg-[#f0f3ff] hover:bg-[#e7eefe] transition-colors whitespace-nowrap"><Eye size={12} /> Preview</button>
                )}
                <a href={submission.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#777587] border border-[#c7c4d8] hover:bg-[#f9f9ff] transition-colors whitespace-nowrap"><Download size={12} /> Download</a>
              </div>
            </div>
            {submission.expiry_date && (
              <p className="text-xs text-[#777587]">Expiry: <span className="font-semibold text-[#151c27]">{fmtDate(submission.expiry_date)}</span></p>
            )}
          </div>

          {/* HR-approved banner — shown to Root Admin so they know HR already vetted this */}
          {submission.status === 'hr_approved' && isRootAdmin && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-yellow-50 border border-yellow-200">
              <ShieldCheck size={14} className="text-yellow-600 flex-shrink-0" />
              <p className="text-xs text-yellow-700 font-semibold">HR has pre-approved this document. Final approval is required from Root Admin.</p>
            </div>
          )}

          {/* Already reviewed — show review details */}
          {!isReviewable && submission.reviewer?.name && (
            <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
              <p className="text-xs font-black text-[#151c27] mb-2">Review Details</p>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-xs text-[#777587]">Reviewed by:</p>
                <p className="text-xs font-semibold text-[#151c27]">{submission.reviewer.name}</p>
              </div>
              {submission.reviewed_at && (
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs text-[#777587]">Reviewed on:</p>
                  <p className="text-xs font-semibold text-[#151c27]">{fmtDate(submission.reviewed_at?.slice(0, 10))}</p>
                </div>
              )}
              {submission.rejection_reason && (
                <div className="mt-2 p-3 rounded-lg bg-rose-50 border border-rose-200">
                  <p className="text-xs font-bold text-rose-700 mb-1">Reason given to employee:</p>
                  <p className="text-xs text-rose-600">{submission.rejection_reason}</p>
                </div>
              )}
            </div>
          )}

          {/* Review actions — only shown for reviewable submissions */}
          {isReviewable && (
            <>
              <div>
                <label className="form-label mb-2">
                  {isRootAdmin ? 'Final Decision' : 'Review Decision'} <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {actionOptions.map(opt => (
                    <button key={opt.v} onClick={() => setAction(opt.v)}
                      className={`p-3 rounded-xl border text-xs font-bold transition-all ${action === opt.v ? opt.active : `bg-white ${opt.cls} hover:bg-gray-50`}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {(action === 'rejected' || action === 're_upload_requested') && (
                <div>
                  <label className="form-label">Reason <span className="text-rose-500">*</span></label>
                  <textarea className="form-control" rows={3} placeholder="Explain why this document is rejected or needs re-upload…" value={reason} onChange={e => setReason(e.target.value)} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#f0f3ff] flex gap-3 flex-shrink-0">
          <button className="btn btn-outline flex-1" onClick={onClose} disabled={saving}>
            {isReviewable ? 'Cancel' : 'Close'}
          </button>
          {isReviewable && (
            <button className="btn btn-primary flex-1" onClick={handleReview} disabled={saving || !action}>
              {saving ? <><span className="spinner w-4 h-4" /> Saving…</> : 'Submit Review'}
            </button>
          )}
        </div>
      </div>

      {preview && <PreviewModal doc={{ file_url: submission.file_url, file_type: submission.file_type, name: submission.file_name || req?.name, file_size: submission.file_size }} onClose={() => setPreview(false)} />}
    </div>
  );
}

// ── Admin: Verification Queue Tab ────────────────────────────────────────────
function VerificationQueueTab() {
  const { isRootAdmin } = useAuth();
  const [reviewSub,    setReviewSub]    = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search,       setSearch]       = useState('');

  const { data: allSubs = [], isLoading } = useQuery({
    queryKey: ['verification-queue'],
    queryFn:  () => apiGet('/doc-requirements/verification-queue'),
  });

  const STATUS_TABS = [
    { key: 'all',                 label: 'All',               count: allSubs.length },
    { key: 'under_review',        label: 'Pending Review',    count: allSubs.filter(s => s.status === 'under_review').length },
    { key: 'hr_approved',         label: 'HR Approved',       count: allSubs.filter(s => s.status === 'hr_approved').length },
    { key: 're_upload_requested', label: 'Re-upload Requested', count: allSubs.filter(s => s.status === 're_upload_requested').length },
    { key: 'approved',            label: 'Approved',          count: allSubs.filter(s => s.status === 'approved').length },
    { key: 'rejected',            label: 'Rejected',          count: allSubs.filter(s => s.status === 'rejected').length },
  ];

  const filtered = useMemo(() => {
    let list = statusFilter === 'all' ? allSubs : allSubs.filter(s => s.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.employee?.name?.toLowerCase().includes(q) ||
        s.requirement?.name?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [allSubs, statusFilter, search]);

  // Reviewable = employee has submitted and it needs an admin decision.
  // re_upload_requested means we are WAITING for the employee to re-upload — not yet reviewable.
  // Once employee re-uploads the status returns to under_review, which is reviewable.
  const canReview = (sub) => {
    if (sub.status === 'under_review') return true;
    if (isRootAdmin && sub.status === 'hr_approved') return true;
    return false;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-black text-[#151c27]">Verification Queue</p>
          <p className="text-xs text-[#777587]">View and review all employee document submissions.</p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input className="form-control pl-8 text-xs w-56" placeholder="Search employee or document…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-[#c7c4d8]">
        {STATUS_TABS.map(tab => (
          <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold border-b-2 transition-all -mb-px whitespace-nowrap ${statusFilter === tab.key ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-[#777587] hover:text-[#464555]'}`}>
            {tab.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[0.6rem] font-black ${statusFilter === tab.key ? 'bg-[#3525cd] text-white' : 'bg-[#f0f3ff] text-[#464555]'}`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading submissions…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <ShieldCheck size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p>{statusFilter === 'all' ? 'No submissions yet' : `No ${STATUS_TABS.find(t => t.key === statusFilter)?.label.toLowerCase()} submissions`}</p>
          <p className="text-sm text-[#9ca3af] mt-1">Employee document uploads will appear here.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c7c4d8] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#f0f3ff]">
            <p className="text-sm font-black text-[#151c27]">
              {STATUS_TABS.find(t => t.key === statusFilter)?.label} ({filtered.length})
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
                <tr>
                  {['EMPLOYEE', 'DOCUMENT', 'UPLOADED ON', 'STATUS', 'REVIEWED BY', 'ACTIONS'].map(h => (
                    <th key={h} className="px-4 py-3 font-black text-[#464555] text-[0.65rem] tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {filtered.map(sub => (
                  <tr key={sub.id} className="hover:bg-[#fafaff] transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={sub.employee?.name} color={sub.employee?.avatar_color} size={32} />
                        <div>
                          <p className="font-bold text-[#151c27]">{sub.employee?.name}</p>
                          <p className="text-[0.65rem] text-[#9ca3af]">{sub.employee?.department || sub.employee?.position || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-bold text-[#151c27]">{sub.requirement?.name}</p>
                      {sub.rejection_reason && (
                        <p className="text-[0.65rem] text-rose-500 mt-0.5 max-w-[180px] truncate">Reason: {sub.rejection_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-[#777587] whitespace-nowrap">{fmtDateTime(sub.uploaded_at)}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={sub.status} /></td>
                    <td className="px-4 py-3.5 text-[#777587]">
                      {sub.reviewer?.name
                        ? <div>
                            <p className="font-semibold text-[#151c27]">{sub.reviewer.name}</p>
                            {sub.reviewed_at && <p className="text-[0.6rem] text-[#9ca3af]">{fmtDate(sub.reviewed_at?.slice(0, 10))}</p>}
                          </div>
                        : <span>—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      {sub.status === 're_upload_requested' ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 cursor-default">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
                          Pending Re-upload
                        </span>
                      ) : (
                        <button onClick={() => setReviewSub(sub)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${canReview(sub) ? 'text-white bg-[#3525cd] hover:bg-[#2a1fb0]' : 'text-[#3525cd] bg-[#f0f3ff] hover:bg-[#e7eefe]'}`}>
                          <Eye size={12} /> {canReview(sub) ? 'Review' : 'View'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reviewSub && <ReviewModal submission={reviewSub} onClose={() => setReviewSub(null)} onReviewed={() => setReviewSub(null)} />}
    </div>
  );
}

// ── Admin: Analytics Tab ─────────────────────────────────────────────────────
function AnalyticsTab() {
  const { data: a, isLoading } = useQuery({
    queryKey: ['doc-analytics'],
    queryFn:  () => apiGet('/doc-requirements/analytics'),
    staleTime: 60000,
  });

  if (isLoading) return <div className="loading"><div className="spinner" /> Loading analytics…</div>;
  if (!a) return null;

  const statCards = [
    { label: 'Total Requirements', num: a.totalRequirements, bg: 'bg-[#f0f3ff]',  text: 'text-[#3525cd]' },
    { label: 'Approved',           num: a.approved,          bg: 'bg-emerald-50',  text: 'text-emerald-700' },
    { label: 'Pending Review',     num: a.under_review,      bg: 'bg-amber-50',    text: 'text-amber-700' },
    { label: 'HR Approved',        num: a.hr_approved,       bg: 'bg-yellow-50',   text: 'text-yellow-700' },
    { label: 'Rejected',           num: a.rejected,          bg: 'bg-rose-50',     text: 'text-rose-700' },
    { label: 'Re-upload Req.',     num: a.re_upload_requested, bg: 'bg-orange-50', text: 'text-orange-700' },
    { label: 'Expiring Soon',      num: a.expiringCount,     bg: 'bg-slate-50',    text: 'text-slate-700' },
    { label: 'Compliance %',       num: `${a.compliancePercent}%`, bg: a.compliancePercent >= 70 ? 'bg-emerald-50' : 'bg-rose-50', text: a.compliancePercent >= 70 ? 'text-emerald-700' : 'text-rose-700' },
  ];

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map(s => (
          <div key={s.label} className={`rounded-xl border border-[#c7c4d8] p-4 ${s.bg}`}>
            <p className={`text-2xl font-black ${s.text}`}>{s.num}</p>
            <p className="text-xs font-bold text-[#464555] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Weekly upload trend */}
      {(a.weeklyTrend || []).length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] p-5">
          <p className="text-sm font-black text-[#151c27] mb-4">Weekly Submissions (last 8 weeks)</p>
          <div className="flex items-end gap-2 h-28">
            {a.weeklyTrend.map((w, i) => {
              const max = Math.max(...a.weeklyTrend.map(x => x.count), 1);
              const pct = Math.round((w.count / max) * 100);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[0.6rem] text-[#777587] font-bold">{w.count}</span>
                  <div className="w-full rounded-t-md bg-[#3525cd]/15 flex items-end" style={{ height: 80 }}>
                    <div className="w-full rounded-t-md bg-[#3525cd] transition-all duration-500" style={{ height: `${Math.max(pct, w.count > 0 ? 4 : 0)}%` }} />
                  </div>
                  <span className="text-[0.55rem] text-[#9ca3af] text-center leading-tight">{w.week}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-requirement compliance */}
      {(a.requirementStats || []).filter(r => r.is_active).length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#f0f3ff]">
            <p className="text-sm font-black text-[#151c27]">Requirement Compliance</p>
          </div>
          <div className="divide-y divide-[#f0f3ff]">
            {a.requirementStats.filter(r => r.is_active).map(r => {
              const pct = a.totalEmployees > 0 ? Math.round((r.approved / a.totalEmployees) * 100) : 0;
              return (
                <div key={r.id} className="px-5 py-3.5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <p className="text-xs font-bold text-[#151c27] truncate">{r.name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold border flex-shrink-0 ${r.is_required ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-[#f0f3ff] text-[#464555] border-[#c7c4d8]'}`}>
                        {r.is_required ? 'Required' : 'Optional'}
                      </span>
                    </div>
                    <div className="w-full bg-[#f0f3ff] rounded-full h-1.5">
                      <div className="bg-[#3525cd] h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 w-24">
                    <p className="text-xs font-black text-[#151c27]">{pct}%</p>
                    <p className="text-[0.6rem] text-[#9ca3af]">{r.approved}/{a.totalEmployees} approved</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin: Delete Requests Tab (Root Admin only) ──────────────────────────────
function DeleteRequestsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const [filter, setFilter]       = useState('pending');
  const [actionModal, setActionModal] = useState(null); // { req, action }
  const [actionReason, setActionReason] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['doc-delete-requests', filter],
    queryFn:  () => apiGet(`/documents/delete-requests${filter !== 'all' ? `?status=${filter}` : ''}`),
  });

  async function handleAction() {
    if (!actionModal) return;
    setSaving(true);
    try {
      await apiPatch(`/documents/delete-requests/${actionModal.req.id}/action`, {
        action: actionModal.action,
        reason: actionReason.trim() || undefined,
      });
      toast(actionModal.action === 'approved' ? 'Document deleted successfully.' : 'Delete request rejected.', 'success');
      qc.invalidateQueries({ queryKey: ['doc-delete-requests'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
      setActionModal(null);
      setActionReason('');
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  const FILTER_TABS = [
    { key: 'pending',  label: 'Pending',  cls: 'text-amber-700' },
    { key: 'approved', label: 'Approved', cls: 'text-emerald-700' },
    { key: 'rejected', label: 'Rejected', cls: 'text-rose-700' },
    { key: 'all',      label: 'All',      cls: 'text-[#464555]' },
  ];

  return (
    <div>
      <div className="mb-5">
        <p className="text-sm font-black text-[#151c27]">Delete Requests</p>
        <p className="text-xs text-[#777587]">Review and action HR Admin document deletion requests.</p>
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-[#c7c4d8]">
        {FILTER_TABS.map(t => (
          <button key={t.key} onClick={() => setFilter(t.key)}
            className={`px-3.5 py-2 text-xs font-bold border-b-2 transition-all -mb-px ${filter === t.key ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-[#777587] hover:text-[#464555]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" /> Loading requests…</div>
      ) : requests.length === 0 ? (
        <div className="empty-state">
          <Trash2 size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p>No {filter !== 'all' ? filter : ''} delete requests</p>
          <p className="text-sm text-[#9ca3af] mt-1">HR Admin deletion requests will appear here for your review.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#c7c4d8] overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
              <tr>
                {['DOCUMENT', 'REQUESTED BY', 'REASON', 'REQUESTED ON', 'STATUS', 'ACTIONS'].map(h => (
                  <th key={h} className="px-4 py-3 font-black text-[#464555] text-[0.65rem] tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f3ff]">
              {requests.map(r => (
                <tr key={r.id} className="hover:bg-[#fafaff] transition-colors">
                  <td className="px-4 py-3.5">
                    {r.document ? (
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">{fileIcon(r.document.file_type, 13)}</div>
                        <div>
                          <p className="font-bold text-[#151c27] truncate max-w-[140px]">{r.document.name}</p>
                          <p className="text-[0.6rem] text-[#9ca3af]">{r.document.category}</p>
                        </div>
                      </div>
                    ) : <span className="text-[#9ca3af] italic">Document deleted</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <Avatar name={r.requester?.name} color={r.requester?.avatar_color} size={24} />
                      <p className="font-semibold text-[#151c27] truncate max-w-[100px]">{r.requester?.name || '—'}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="text-[#464555] max-w-[180px] truncate" title={r.reason}>{r.reason}</p>
                  </td>
                  <td className="px-4 py-3.5 text-[#777587] whitespace-nowrap">{fmtDateTime(r.created_at)}</td>
                  <td className="px-4 py-3.5">
                    <span className={`px-2.5 py-1 rounded-full text-[0.65rem] font-bold border ${
                      r.status === 'pending'  ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      r.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                'bg-rose-50 text-rose-700 border-rose-200'
                    }`}>{r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    {r.status === 'pending' ? (
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => { setActionModal({ req: r, action: 'approved' }); setActionReason(''); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 transition-colors">
                          Delete
                        </button>
                        <button onClick={() => { setActionModal({ req: r, action: 'rejected' }); setActionReason(''); }}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold text-[#464555] border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-colors">
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-[0.65rem] text-[#9ca3af]">
                        {r.actioned_at ? fmtDate(r.actioned_at.slice(0, 10)) : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action confirmation modal */}
      {actionModal && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setActionModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-sm p-6">
            <button onClick={() => setActionModal(null)} className="absolute top-4 right-4 text-[#777587] hover:text-[#151c27] p-1 rounded-lg hover:bg-[#f0f3ff]"><X size={18} /></button>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 ${actionModal.action === 'approved' ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
              <Trash2 size={22} />
            </div>
            <h3 className="text-base font-black text-[#151c27] text-center mb-1">
              {actionModal.action === 'approved' ? 'Approve & Delete Document' : 'Reject Delete Request'}
            </h3>
            <p className="text-xs text-[#777587] text-center mb-4">
              {actionModal.action === 'approved'
                ? `"${actionModal.req.document?.name || 'This document'}" will be permanently deleted. This cannot be undone.`
                : 'The HR Admin will be notified that their request was rejected.'}
            </p>
            {actionModal.action === 'rejected' && (
              <div className="mb-4">
                <label className="form-label">Reason <span className="text-[#9ca3af] font-normal">(optional)</span></label>
                <textarea className="form-control" rows={2} placeholder="Reason for rejection…" value={actionReason} onChange={e => setActionReason(e.target.value)} />
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setActionModal(null)} className="flex-1 btn btn-outline" disabled={saving}>Cancel</button>
              <button onClick={handleAction} disabled={saving}
                className={`flex-1 px-4 py-2 rounded-xl text-xs font-bold text-white transition-colors disabled:opacity-50 ${actionModal.action === 'approved' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-amber-500 hover:bg-amber-600'}`}>
                {saving ? <><span className="spinner w-4 h-4" /> Processing…</> : actionModal.action === 'approved' ? 'Confirm Delete' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Admin: Settings Tab (Root Admin only) ────────────────────────────────────
function SettingsTab() {
  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-[#c7c4d8] p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center"><Settings size={16} className="text-[#3525cd]" /></div>
          <div>
            <p className="text-sm font-black text-[#151c27]">Document Settings</p>
            <p className="text-xs text-[#777587]">Organization-level document configuration</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-xs font-black text-[#151c27] mb-1">Accepted File Types</p>
            <p className="text-[0.65rem] text-[#777587] mb-2">Default formats for new requirements</p>
            <div className="flex flex-wrap gap-1.5">
              {['PDF', 'JPG', 'PNG', 'DOC', 'DOCX'].map(f => (
                <span key={f} className="px-2.5 py-1 rounded-full text-[0.65rem] font-bold bg-[#3525cd]/10 text-[#3525cd] border border-[#3525cd]/20">{f}</span>
              ))}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-xs font-black text-[#151c27] mb-1">Default File Size Limit</p>
            <p className="text-[0.65rem] text-[#777587] mb-2">Applied to new requirements unless overridden</p>
            <p className="text-lg font-black text-[#3525cd]">10 MB</p>
          </div>
          <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-xs font-black text-[#151c27] mb-1">Verification Workflow</p>
            <p className="text-[0.65rem] text-[#777587] mb-2">Two-stage: HR Approve → Root Admin Final Approve</p>
            <span className="px-2.5 py-1 rounded-full text-[0.65rem] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>
          </div>
          <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-xs font-black text-[#151c27] mb-1">Expiry Reminder</p>
            <p className="text-[0.65rem] text-[#777587] mb-2">Default reminder before document expiry</p>
            <p className="text-lg font-black text-[#3525cd]">30 days</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-[#c7c4d8] p-5">
        <p className="text-sm font-black text-[#151c27] mb-1">Multi-Organization Isolation</p>
        <p className="text-xs text-[#777587] mb-4">All documents, requirements, submissions, and settings are fully isolated per organization.</p>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
          <CheckCircle size={14} className="text-emerald-600 flex-shrink-0" />
          <p className="text-xs text-emerald-700 font-semibold">Organization isolation is enforced at the database level on every query.</p>
        </div>
      </div>
    </div>
  );
}

// ── Admin: Main Documents Page ────────────────────────────────────────────────
function AdminDocumentsPage() {
  const qc = useQueryClient();
  const { isRootAdmin, can } = useAuth();
  const { selectedBranchId } = useBranch();
  const canUpload = can('documents', 'upload');
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'shared';
  const [activeTab, setActiveTab]         = useState(initialTab);
  const [showUpload, setShowUpload]       = useState(false);
  const [showCreateReq, setShowCreateReq] = useState(false);

  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-list-docs', selectedBranchId],
    queryFn:  async () => { const all = await apiGet('/employees'); return all.filter(e => e.role === 'employee'); },
  });

  // Pending delete request count badge for Root Admin
  const { data: pendingDelReqs = [] } = useQuery({
    queryKey: ['doc-delete-requests', 'pending'],
    queryFn:  () => apiGet('/documents/delete-requests?status=pending'),
    enabled:  isRootAdmin,
    staleTime: 30000,
  });

  const tabs = [
    { id: 'shared',          label: 'Shared Documents',     Icon: FolderOpen,    show: true },
    { id: 'requirements',    label: 'Requirements',          Icon: ClipboardList, show: true },
    { id: 'verification',    label: 'Verification Queue',   Icon: ShieldCheck,   show: true },
    { id: 'delete_requests', label: 'Delete Requests',      Icon: Trash2,        show: isRootAdmin, badge: pendingDelReqs.length },
    { id: 'analytics',       label: 'Analytics',            Icon: BarChart2,     show: true },
    { id: 'settings',        label: 'Settings',             Icon: Settings,      show: isRootAdmin },
  ].filter(t => t.show);

  // Tab-aware header action — only show relevant button per tab
  const headerAction = {
    shared:          canUpload ? <button className="btn btn-outline" onClick={() => { setShowUpload(true); setShowCreateReq(false); }}><Upload size={14} /> Upload Document</button> : null,
    requirements:    <button className="btn btn-primary" onClick={() => { setShowCreateReq(true); setShowUpload(false); }}><Plus size={14} /> Create Requirement</button>,
    verification:    null,
    delete_requests: null,
    analytics:       null,
    settings:        null,
  }[activeTab];

  function switchTab(id) {
    setActiveTab(id);
    if (id !== 'shared')       setShowUpload(false);
    if (id !== 'requirements') setShowCreateReq(false);
    // searchParams tab override (for deep links)
    window.history.replaceState(null, '', `?tab=${id}`);
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center">
            <FolderOpen size={20} className="text-[#3525cd]" />
          </div>
          <div>
            <h1 className="page-title">Documents</h1>
            <p className="page-subtitle">Manage organization documents and employee compliance.</p>
          </div>
        </div>
        {headerAction && <div className="flex items-center gap-3">{headerAction}</div>}
      </div>

      {/* Upload Panel — only when on shared tab */}
      {showUpload && activeTab === 'shared' && (
        <UploadSharedDocPanel allEmployees={allEmployees} colleagues={[]} onCancel={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); qc.invalidateQueries({ queryKey: ['documents'] }); }} />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-[#c7c4d8]">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => switchTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition-all -mb-px whitespace-nowrap ${activeTab === tab.id ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-[#777587] hover:text-[#464555]'}`}>
            <tab.Icon size={14} /> {tab.label}
            {tab.badge > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[0.6rem] font-black bg-rose-500 text-white">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'shared'          && <SharedDocumentsTab onUploadClick={() => setShowUpload(true)} />}
      {activeTab === 'requirements'    && (
        <>
          {showCreateReq && <RequirementModal onClose={() => setShowCreateReq(false)} onSaved={() => setShowCreateReq(false)} />}
          <EmployeeRequirementsTab />
        </>
      )}
      {activeTab === 'verification'    && <VerificationQueueTab />}
      {activeTab === 'delete_requests' && <DeleteRequestsTab />}
      {activeTab === 'analytics'       && <AnalyticsTab />}
      {activeTab === 'settings'        && <SettingsTab />}
    </div>
  );
}

// ── Employee: Upload Document Modal ───────────────────────────────────────────
function EmployeeUploadModal({ requirement, onClose, onUploaded }) {
  const toast = useToast();
  const [file, setFile]           = useState(null);
  const [expiryDate, setExpiry]   = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef();

  const maxMB = requirement.max_file_size_mb || 10;

  function validateAndSet(f) {
    if (!f) return;
    if (f.size === 0) { toast('Empty files are not allowed.', 'error'); return; }
    if (f.size > maxMB * 1024 * 1024) { toast(`File size must not exceed ${maxMB} MB.`, 'error'); return; }
    setFile(f);
  }

  async function handleSubmit() {
    if (!file) { toast('Please select a file', 'error'); return; }
    if (requirement.expiry_required && !expiryDate) { toast('Expiry date is required for this document', 'error'); return; }
    setUploading(true);
    try {
      const token = localStorage.getItem('lt_token');
      const fd = new FormData();
      fd.append('file', file);
      if (expiryDate) fd.append('expiry_date', expiryDate);
      const res = await fetch(`/api/doc-requirements/${requirement.id}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({ error: 'Unexpected server error. Please try again.' }));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast('Document uploaded successfully!', 'success');
      onUploaded();
    } catch (err) { toast(err.message, 'error'); }
    finally { setUploading(false); }
  }

  const acceptStr = (requirement.accepted_formats || ['pdf','jpg','png'])
    .map(f => f === 'jpg' ? '.jpg,.jpeg' : `.${f}`).join(',');

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-md overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff]">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center"><UploadCloud size={16} className="text-[#3525cd]" /></div>
          <div className="flex-1">
            <p className="font-black text-[#151c27] text-sm">{requirement.name}</p>
            {requirement.description && <p className="text-xs text-[#777587] truncate">{requirement.description}</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-[#777587] hover:bg-[#f0f3ff] transition-colors"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-[#f0f3ff] border border-[#3525cd]/20 text-xs text-[#464555]">
            <Info size={12} className="text-[#3525cd] flex-shrink-0" />
            <span>Accepted: <strong>{(requirement.accepted_formats || ['pdf','jpg','png']).map(f => f.toUpperCase()).join(', ')}</strong> · Max: <strong>{requirement.max_file_size_mb || 10} MB</strong></span>
          </div>

          <div>
            <label className="form-label">Select File <span className="text-rose-500">*</span></label>
            <input type="file" ref={fileRef} className="hidden" accept={acceptStr}
              onChange={e => { if (e.target.files?.[0]) validateAndSet(e.target.files[0]); e.target.value = ''; }} />
            {file ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                {fileIcon(file.type, 16)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-emerald-800 truncate">{file.name}</p>
                  <p className="text-[0.65rem] text-emerald-600">{fmtBytes(file.size)}</p>
                </div>
                <button onClick={() => setFile(null)} className="p-1 rounded text-emerald-600 hover:bg-emerald-100 transition-colors"><X size={14} /></button>
              </div>
            ) : (
              <div
                onClick={() => fileRef.current?.click()}
                onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation(); setDragActive(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) validateAndSet(f);
                }}
                className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl cursor-pointer transition-all ${dragActive ? 'border-[#3525cd] bg-[#f0f3ff] scale-[1.01]' : 'border-[#c7c4d8] hover:border-[#3525cd]/50 hover:bg-[#f0f3ff]'}`}>
                <UploadCloud size={24} className={`mb-1.5 ${dragActive ? 'text-[#3525cd]' : 'text-[#3525cd]/70'}`} />
                <p className="text-xs font-bold text-[#151c27]">{dragActive ? 'Release to upload' : 'Click or drag file here'}</p>
                <p className="text-[0.65rem] text-[#9ca3af] mt-0.5">Max {maxMB} MB</p>
              </div>
            )}
          </div>

          {requirement.expiry_required && (
            <div>
              <label className="form-label">Expiry Date <span className="text-rose-500">*</span></label>
              <input type="date" className="form-control" value={expiryDate} onChange={e => setExpiry(e.target.value)} />
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#f0f3ff] flex gap-3">
          <button className="btn btn-outline flex-1" onClick={onClose} disabled={uploading}>Cancel</button>
          <button className="btn btn-primary flex-1" onClick={handleSubmit} disabled={uploading || !file}>
            {uploading ? <><span className="spinner w-4 h-4" /> Uploading…</> : <><Upload size={14} /> Upload</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Employee: Profile Completion Ring ─────────────────────────────────────────
function ProfileCompletionRing({ percent, uploaded, total }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = (percent / 100) * circ;
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative w-28 h-28">
        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f0f3ff" strokeWidth="10" />
          <circle cx="50" cy="50" r={r} fill="none" stroke="#3525cd" strokeWidth="10"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className="transition-all duration-700" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-[#151c27]">{percent}%</span>
        </div>
      </div>
      <p className="text-xs font-bold text-[#151c27] mt-1.5">{uploaded} of {total} completed</p>
      <p className={`text-[0.65rem] font-bold mt-0.5 ${percent >= 80 ? 'text-emerald-600' : percent >= 50 ? 'text-amber-600' : 'text-rose-500'}`}>
        {percent >= 80 ? 'Good Progress' : percent >= 50 ? 'In Progress' : 'Needs Attention'}
      </p>
    </div>
  );
}

// ── Employee: My Documents Dashboard ─────────────────────────────────────────
function EmployeeDocumentsDashboard() {
  const qc = useQueryClient();
  const { data: hrContact } = useQuery({ queryKey: ['hr-contact'], queryFn: () => apiGet('/org/hr-contact'), staleTime: 300000 });
  const [uploadFor, setUploadFor] = useState(null);
  const [viewSub, setViewSub]     = useState(null);
  const [preview, setPreview]     = useState(null);

  const { data: requirements = [], isLoading } = useQuery({
    queryKey: ['doc-requirements-my'],
    queryFn:  () => apiGet('/doc-requirements'),
  });

  const { data: activity = [] } = useQuery({
    queryKey: ['doc-activity'],
    queryFn:  () => apiGet('/doc-requirements/my-activity'),
  });

  // Shared documents from HR/Root Admin (visibility='all', 'self', or 'specific' with me included)
  const { data: sharedDocs = [] } = useQuery({
    queryKey: ['my-shared-docs'],
    queryFn:  () => apiGet('/documents'),
  });

  // Compute stats
  const requiredReqs   = requirements.filter(r => r.is_required);
  const totalRequired  = requiredReqs.length;
  const approved       = requirements.filter(r => r._submission?.status === 'approved').length;
  const underReview    = requirements.filter(r => r._submission?.status === 'under_review').length;
  const reuploadReq    = requirements.filter(r => r._submission?.status === 're_upload_requested').length;
  const notUploaded    = requiredReqs.filter(r => !r._submission).length;
  const approvedReq    = requiredReqs.filter(r => r._submission?.status === 'approved').length;
  const progressPct    = totalRequired > 0 ? Math.round((approvedReq / totalRequired) * 100) : 0;

  // Action required: required docs not yet uploaded + any doc rejected/re-upload requested
  const actionRequired = requirements.filter(r =>
    (r.is_required && !r._submission) ||
    r._submission?.status === 'rejected' ||
    r._submission?.status === 're_upload_requested'
  );

  // Optional requirements that haven't been uploaded yet (Bug #10)
  const optionalPending = requirements.filter(r => !r.is_required && !r._submission);

  // Uploaded documents (all submissions)
  const uploadedDocs = requirements.filter(r => r._submission);

  function getActionLabel(req) {
    const sub = req._submission;
    if (!sub) return 'Not Uploaded';
    if (sub.status === 'rejected') return 'Rejected';
    if (sub.status === 're_upload_requested') return 'Re-upload Requested';
    return '';
  }

  const activityIcon = (action) => {
    if (action === 'uploaded' || action === 're_uploaded') return <UploadCloud size={14} className="text-[#3525cd]" />;
    if (action === 'approved') return <CheckCircle size={14} className="text-emerald-600" />;
    if (action === 'rejected') return <XCircle size={14} className="text-rose-500" />;
    if (action === 're_upload_requested') return <AlertTriangle size={14} className="text-amber-500" />;
    return <Clock size={14} className="text-[#777587]" />;
  };

  const activityLabel = (act) => {
    if (act.action === 'uploaded')             return `${act.requirement?.name || 'Document'} uploaded`;
    if (act.action === 're_uploaded')          return `${act.requirement?.name || 'Document'} re-uploaded`;
    if (act.action === 'approved')             return `${act.requirement?.name || 'Document'} approved`;
    if (act.action === 'rejected')             return `${act.requirement?.name || 'Document'} rejected`;
    if (act.action === 're_upload_requested')  return `Re-upload requested for ${act.requirement?.name || 'Document'}`;
    return act.details || act.action;
  };

  function handleUploaded() {
    setUploadFor(null);
    qc.invalidateQueries({ queryKey: ['doc-requirements-my'] });
    qc.invalidateQueries({ queryKey: ['doc-activity'] });
  }

  if (isLoading) return <div className="loading"><div className="spinner" /> Loading your documents…</div>;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="page-title">My Documents</h1>
          <p className="page-subtitle">Upload and manage your required documents.</p>
        </div>
        {actionRequired.length > 0 && (
          <button className="btn btn-primary" onClick={() => setUploadFor(actionRequired[0])}>
            <Upload size={14} /> Upload Document
          </button>
        )}
      </div>

      {/* Stats + Completion Ring */}
      {totalRequired > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] p-5 mb-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {[
                { num: totalRequired, label: 'Total Required', cls: 'text-[#151c27]', bg: 'bg-[#f0f3ff]', icon: <ClipboardList size={16} className="text-[#3525cd]" /> },
                { num: approved,      label: 'Approved',       cls: 'text-emerald-700', bg: 'bg-emerald-50', icon: <CheckCircle size={16} className="text-emerald-600" /> },
                { num: underReview,   label: 'Under Review',   cls: 'text-amber-700', bg: 'bg-amber-50', icon: <Clock size={16} className="text-amber-600" /> },
                { num: reuploadReq,   label: 'Re-upload Requested', cls: 'text-orange-700', bg: 'bg-orange-50', icon: <AlertTriangle size={16} className="text-orange-500" /> },
                { num: notUploaded,   label: 'Not Uploaded',   cls: 'text-slate-700', bg: 'bg-slate-50', icon: <UploadCloud size={16} className="text-slate-500" /> },
              ].map(s => (
                <div key={s.label} className={`flex items-center gap-3 p-3 rounded-xl ${s.bg}`}>
                  {s.icon}
                  <div>
                    <p className={`text-xl font-black ${s.cls}`}>{s.num}</p>
                    <p className="text-[0.65rem] text-[#777587] leading-tight">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden sm:block border-l border-[#f0f3ff] pl-5">
              <p className="text-xs font-black text-[#151c27] mb-2 text-center">Profile Completion</p>
              <ProfileCompletionRing percent={progressPct} uploaded={approvedReq} total={totalRequired} />
            </div>
          </div>
        </div>
      )}

      {/* Action Required */}
      {actionRequired.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] mb-5">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-[#f0f3ff]">
            <AlertCircle size={16} className="text-rose-500" />
            <p className="text-sm font-black text-[#151c27]">Action Required ({actionRequired.length})</p>
          </div>
          <div className="divide-y divide-[#f0f3ff]">
            {actionRequired.map(req => {
              const sub = req._submission;
              const label = getActionLabel(req);
              return (
                <div key={req.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                    {fileIcon('', 18)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-[#151c27] text-sm">{req.name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[0.65rem] font-bold border ${req.is_required ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-[#f0f3ff] text-[#464555] border-[#c7c4d8]'}`}>
                        {req.is_required ? 'Required' : 'Optional'}
                      </span>
                    </div>
                    {req.description && <p className="text-xs text-[#777587] mt-0.5">{req.description}</p>}
                    {sub?.status === 'rejected' && (
                      <p className="text-xs text-rose-600 mt-1">
                        <span className="font-bold">Reason:</span> {sub.rejection_reason}
                      </p>
                    )}
                    {sub?.status === 're_upload_requested' && (
                      <p className="text-xs text-amber-600 mt-1">
                        <span className="font-bold">Reason:</span> {sub.rejection_reason}
                      </p>
                    )}
                    <p className={`text-xs mt-1 font-semibold ${!sub ? 'text-[#9ca3af]' : sub.status === 'rejected' ? 'text-rose-600' : 'text-amber-600'}`}>
                      {label}
                    </p>
                  </div>
                  <button onClick={() => setUploadFor(req)}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-all flex-shrink-0 ${sub ? 'bg-[#3525cd] text-white border-[#3525cd] hover:bg-[#2a1fb0]' : 'bg-white text-[#3525cd] border-[#3525cd] hover:bg-[#f0f3ff]'}`}>
                    <Upload size={12} /> {sub ? 'Upload Again' : 'Upload'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* My Submitted Documents */}
      {uploadedDocs.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] mb-5">
          <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between">
            <p className="text-sm font-black text-[#151c27]">My Submitted Documents ({uploadedDocs.length})</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
                <tr>
                  {['DOCUMENT', 'UPLOADED ON', 'EXPIRY', 'VERSION', 'STATUS', 'REVIEWED BY', 'ACTIONS'].map(h => (
                    <th key={h} className="px-4 py-3 font-black text-[#464555] text-[0.65rem] tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {uploadedDocs.map(req => {
                  const sub = req._submission;
                  return (
                    <tr key={req.id} className="hover:bg-[#fafaff] transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">{fileIcon(sub.file_type, 14)}</div>
                          <div>
                            <p className="font-bold text-[#151c27]">{req.name}</p>
                            <p className="text-[0.6rem] text-[#9ca3af]">{fmtBytes(sub.file_size)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-[#777587] whitespace-nowrap">{fmtDate(sub.uploaded_at?.slice(0, 10))}</td>
                      <td className="px-4 py-3.5"><ExpiryBadge expiryDate={sub.expiry_date} /></td>
                      <td className="px-4 py-3.5">
                        {sub.version > 1
                          ? <span className="px-2 py-0.5 rounded-full text-[0.6rem] font-bold bg-[#f0f3ff] text-[#3525cd] border border-[#3525cd]/20">v{sub.version}</span>
                          : <span className="text-[#9ca3af]">v1</span>}
                      </td>
                      <td className="px-4 py-3.5">
                        {sub.status ? <StatusBadge status={sub.status} /> : <span className="text-[#9ca3af]">—</span>}
                        {sub.rejection_reason && (
                          <p className="text-[0.6rem] text-rose-500 mt-0.5 max-w-[140px] truncate" title={sub.rejection_reason}>{sub.rejection_reason}</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-[#777587]">{sub.reviewer?.name || '—'}</td>
                      <td className="px-4 py-3.5">
                        <button onClick={() => setPreview({ file_url: sub.file_url, file_type: sub.file_type, name: req.name, file_size: sub.file_size })}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] border border-[#3525cd]/30 hover:bg-[#f0f3ff] transition-colors">
                          <Eye size={12} /> View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {requirements.length === 0 && (
        <div className="empty-state">
          <FileCheck size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p>No document requirements yet</p>
          <p className="text-sm text-[#9ca3af] mt-1">Your HR team will add required documents. Check back soon.</p>
        </div>
      )}

      {/* Optional Documents — always visible, never hidden */}
      {requirements.filter(r => !r.is_required).length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] mb-5">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-[#f0f3ff]">
            <Info size={16} className="text-[#3525cd]" />
            <p className="text-sm font-black text-[#151c27]">
              Optional Documents ({requirements.filter(r => !r.is_required).length})
            </p>
            <span className="text-xs text-[#777587] ml-1">— Upload if available</span>
          </div>
          <div className="divide-y divide-[#f0f3ff]">
            {requirements.filter(r => !r.is_required).map(req => {
              const sub = req._submission;
              return (
                <div key={req.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                    {fileIcon(sub?.file_type || '', 18)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-[#151c27] text-sm">{req.name}</p>
                      <span className="px-2 py-0.5 rounded-full text-[0.65rem] font-bold border bg-[#f0f3ff] text-[#464555] border-[#c7c4d8]">Optional</span>
                      {sub && <StatusBadge status={sub.status} />}
                    </div>
                    {req.description && <p className="text-xs text-[#777587] mt-0.5">{req.description}</p>}
                    {!sub && <p className="text-xs text-[#9ca3af] mt-0.5">Not uploaded yet</p>}
                    {sub?.status === 'rejected' && sub.rejection_reason && (
                      <p className="text-xs text-rose-600 mt-1"><span className="font-bold">Reason:</span> {sub.rejection_reason}</p>
                    )}
                  </div>
                  <button
                    onClick={() => setUploadFor(req)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border bg-white text-[#3525cd] border-[#3525cd]/40 hover:bg-[#f0f3ff] transition-all flex-shrink-0">
                    <Upload size={12} /> {sub ? 'Re-upload' : 'Upload'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {activity.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8]">
          <div className="px-5 py-4 border-b border-[#f0f3ff]">
            <p className="text-sm font-black text-[#151c27]">Recent Activity</p>
          </div>
          <div className="divide-y divide-[#f0f3ff]">
            {activity.map(act => (
              <div key={act.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="w-8 h-8 rounded-full bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">{activityIcon(act.action)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#151c27]">{activityLabel(act)}</p>
                  {act.details && act.action !== 'uploaded' && act.action !== 're_uploaded' && (
                    <p className="text-[0.65rem] text-[#9ca3af] truncate">{act.details}</p>
                  )}
                </div>
                <p className="text-[0.65rem] text-[#9ca3af] flex-shrink-0">{fmtDate(act.created_at?.slice(0, 10))}</p>
              </div>
            ))}
          </div>

          {/* Need Help */}
          {hrContact?.email && (
            <div className="px-5 py-4 border-t border-[#f0f3ff] flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#151c27]">Need Help?</p>
                <p className="text-xs text-[#777587]">Having trouble uploading? Contact HR.</p>
              </div>
              <a href={`mailto:${hrContact.email}?subject=Document Query`}
                className="btn btn-outline text-xs flex items-center gap-1.5">
                <Mail size={12} /> Contact HR
              </a>
            </div>
          )}
        </div>
      )}

      {/* Shared Documents from HR/Admin */}
      {sharedDocs.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] mb-5">
          <div className="flex items-center gap-2 px-5 py-4 border-b border-[#f0f3ff]">
            <Share2 size={16} className="text-[#3525cd]" />
            <p className="text-sm font-black text-[#151c27]">Documents Shared with Me ({sharedDocs.length})</p>
          </div>
          <div className="divide-y divide-[#f0f3ff]">
            {sharedDocs.map(doc => (
              <div key={doc.id} className="flex items-center gap-4 px-5 py-4">
                <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                  {fileIcon(doc.file_type, 18)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#151c27] text-sm">{doc.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#464555] border border-[#c7c4d8]">{doc.category}</span>
                    {doc.expiry_date && <span className="text-[0.65rem] text-[#9ca3af]">Expires {fmtDate(doc.expiry_date)}</span>}
                  </div>
                  {doc.uploader?.name && <p className="text-[0.65rem] text-[#9ca3af] mt-0.5">Shared by {doc.uploader.name} · {fmtDate(doc.created_at?.slice(0, 10))}</p>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {canPreview(doc.file_type) ? (
                    <button onClick={() => setPreview(doc)} title="View" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] border border-[#3525cd]/30 hover:bg-[#f0f3ff] transition-colors">
                      <Eye size={12} /> View
                    </button>
                  ) : (
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] border border-[#3525cd]/30 hover:bg-[#f0f3ff] transition-colors">
                      <Download size={12} /> Download
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadFor && <EmployeeUploadModal requirement={uploadFor} onClose={() => setUploadFor(null)} onUploaded={handleUploaded} />}
      {preview && <PreviewModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ── Edit Doc Modal (existing, for shared docs) ───────────────────────────────
function EditDocModal({ doc, isAdmin, colleagues, allEmployees, onClose, onSaved }) {
  const toast = useToast();
  const existingShareIds = (doc.document_shares || []).map(s => String(s.shared_with_user_id));
  const isEmployeeDoc = doc.uploaded_by === doc.user_id;
  const showVisibility = isAdmin && !isEmployeeDoc;

  const [form, setForm] = useState({
    name:         doc.name        || '',
    category:     doc.category    || '',
    expiry_date:  doc.expiry_date || '',
    visibility:   doc.visibility  || 'admin_only',
    shareWith:    existingShareIds,
    targetUserId: String(doc.user_id || ''),
  });
  const [newFile,     setNewFile]     = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [shareSearch, setShareSearch] = useState('');
  const editFileRef = useRef();
  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function toggleShare(id) {
    const sid = String(id);
    setF('shareWith', form.shareWith.includes(sid) ? form.shareWith.filter(x => x !== sid) : [...form.shareWith, sid]);
  }

  const sharingPool = allEmployees.filter(e => String(e.id) !== form.targetUserId);
  const filteredPool = shareSearch ? sharingPool.filter(e => e.name?.toLowerCase().includes(shareSearch.toLowerCase())) : sharingPool;

  const today = new Date().toISOString().split('T')[0];

  const editVisOpts = [
    { value: 'all',        Icon: Globe,  label: 'All Employees',       desc: '🌍 Everyone in the organization can access this document' },
    { value: 'self',       Icon: User,   label: 'Particular Employee', desc: '👤 Visible only to the selected employee' },
    { value: 'specific',   Icon: Users,  label: 'Group of Employees',  desc: '👥 Visible only to the selected group of employees' },
    { value: 'admin_only', Icon: Lock,   label: 'Shared with HR',       desc: '🔒 Shared directly with HR for review and internal use' },
  ];

  async function handleSave() {
    if (!form.name.trim()) { toast('Document name is required', 'error'); return; }
    if (!form.category)    { toast('Select a document type', 'error'); return; }
    if (showVisibility && form.visibility === 'self' && !form.targetUserId) { toast('Select the target employee', 'error'); return; }
    if (showVisibility && form.visibility === 'specific' && form.shareWith.length === 0) { toast('Select at least one employee', 'error'); return; }
    if (form.expiry_date && form.expiry_date < today) { toast('Expiry date cannot be in the past', 'error'); return; }
    setSaving(true);
    try {
      const token = localStorage.getItem('lt_token');
      const fd = new FormData();
      fd.append('name', form.name.trim());
      fd.append('category', form.category);
      fd.append('expiry_date', form.expiry_date || '');
      if (showVisibility) {
        fd.append('visibility', form.visibility);
        if (form.visibility === 'self' && form.targetUserId) fd.append('targetUserId', form.targetUserId);
        if (form.visibility === 'specific') fd.append('shared_with', JSON.stringify(form.shareWith));
      }
      if (newFile) fd.append('file', newFile);
      const res = await fetch(`/api/documents/${doc.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json().catch(() => ({ error: 'Unexpected server error. Please try again.' }));
      if (!res.ok) throw new Error(data.error || 'Update failed');
      toast('Document updated!', 'success');
      onSaved();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl border border-[#c7c4d8] w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff] flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center"><Edit2 size={16} className="text-[#3525cd]" /></div>
          <div className="flex-1">
            <p className="font-black text-[#151c27] text-sm">Edit Document</p>
            <p className="text-xs text-[#777587] truncate">{doc.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-[#777587] hover:bg-[#f0f3ff] transition-colors"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label">Document Name <span className="text-rose-500">*</span></label>
              <input className="form-control" value={form.name} onChange={e => setF('name', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Expiry Date <span className="font-normal text-[#777587]">(optional)</span></label>
              <input type="date" className="form-control" value={form.expiry_date} min={today} onChange={e => setF('expiry_date', e.target.value)} />
              {form.expiry_date && form.expiry_date < today && <p className="text-[0.65rem] text-rose-500 mt-1">Expiry date cannot be in the past.</p>}
            </div>
          </div>

          <div>
            <label className="form-label">Category <span className="text-rose-500">*</span></label>
            <div className="flex flex-wrap gap-2 mt-1">
              {EMPLOYEE_CATEGORIES.map(c => (
                <button key={c.value} type="button" onClick={() => setF('category', c.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${form.category === c.value ? 'bg-[#3525cd] text-white border-[#3525cd] shadow-sm' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/50'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {showVisibility && (
            <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
              <p className="form-label mb-3">Who can see this document?</p>
              <div className="space-y-2">
                {editVisOpts.map(opt => (
                  <div key={opt.value}>
                    <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${form.visibility === opt.value ? 'border-[#3525cd] bg-[#f0f3ff]' : 'border-[#e7eefe] hover:border-[#c7c4d8]'}`}>
                      <input type="radio" name="edit-vis" value={opt.value} checked={form.visibility === opt.value}
                        onChange={e => { setF('visibility', e.target.value); if (e.target.value !== 'specific') setF('shareWith', []); }}
                        className="text-[#3525cd]" />
                      <opt.Icon size={16} className="text-[#3525cd] flex-shrink-0" />
                      <div><p className="text-xs font-bold text-[#151c27]">{opt.label}</p><p className="text-[0.65rem] text-[#9ca3af]">{opt.desc}</p></div>
                    </label>
                    {opt.value === 'self' && form.visibility === 'self' && (
                      <div className="ml-10 mt-2">
                        <SearchableEmployeePicker
                          employees={allEmployees}
                          value={form.targetUserId}
                          onChange={id => setF('targetUserId', id)}
                          placeholder="— Search and select employee —"
                        />
                      </div>
                    )}
                    {opt.value === 'specific' && form.visibility === 'specific' && (
                      <div className="ml-10 mt-2">
                        <input type="text" placeholder="Search employees…" className="form-control text-xs mb-2" value={shareSearch} onChange={e => setShareSearch(e.target.value)} />
                        <div className="max-h-36 overflow-y-auto border border-[#e7eefe] rounded-xl bg-white p-1.5 space-y-0.5">
                          {filteredPool.map(e => (
                            <label key={e.id} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-[#f9f9ff] cursor-pointer transition-colors">
                              <input type="checkbox" checked={form.shareWith.includes(String(e.id))} onChange={() => toggleShare(e.id)} />
                              <Avatar name={e.name} color={e.avatar_color} size={22} />
                              <p className="text-xs font-semibold text-[#151c27]">{e.name}</p>
                            </label>
                          ))}
                        </div>
                        {form.shareWith.length > 0 && <p className="text-xs text-[#3525cd] font-semibold mt-1.5">{form.shareWith.length} selected</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isEmployeeDoc && (
            <div className="p-4 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
              <p className="form-label mb-2 flex items-center gap-1.5"><RefreshCw size={13} className="text-[#3525cd]" /> Replace File</p>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-white border border-[#e7eefe] mb-3">
                {fileIcon(doc.file_type, 14)}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[#151c27] truncate">{doc.name}</p>
                  <p className="text-[0.65rem] text-[#9ca3af]">{fmtBytes(doc.file_size)} · current file</p>
                </div>
              </div>
              {newFile && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-200 mb-2">
                  {fileIcon(newFile.type, 14)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-emerald-800 truncate">{newFile.name}</p>
                    <p className="text-[0.65rem] text-emerald-600">{fmtBytes(newFile.size)}</p>
                  </div>
                  <button onClick={() => setNewFile(null)} className="p-1 rounded text-emerald-600 hover:bg-emerald-100 transition-colors"><X size={14} /></button>
                </div>
              )}
              <input type="file" ref={editFileRef} className="hidden" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                onChange={e => { if (e.target.files?.[0]) setNewFile(e.target.files[0]); e.target.value = ''; }} />
              <button type="button" onClick={() => editFileRef.current?.click()} className="btn btn-outline text-xs w-full">
                <RefreshCw size={12} /> {newFile ? 'Choose Different File' : 'Choose Replacement File'}
              </button>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#f0f3ff] flex gap-3 flex-shrink-0">
          <button className="btn btn-outline flex-1" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary flex-1" onClick={handleSave} disabled={saving}>
            {saving ? <><span className="spinner w-4 h-4" /> Saving…</> : <><CheckCircle2 size={14} /> Save Changes</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Export ──────────────────────────────────────────────────────────────
export default function Documents() {
  const { isAdmin } = useAuth();
  if (isAdmin) return <AdminDocumentsPage />;
  return <EmployeeDocumentsDashboard />;
}
