import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Plus, Pencil, Trash2, Megaphone, MessageSquare, Pin, AlertTriangle, Info, PartyPopper, Bell, Paperclip, Upload, X, FileText, Download, ExternalLink, Copy, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

// BUG_088: max length constants — title capped at 100 to prevent UI crash
const TITLE_MAX   = 100;
const CONTENT_MAX = 2000;

const TYPE_CFG = {
  general:     { icon: <MessageSquare size={15} />, bg: 'bg-[#f0f3ff]',  text: 'text-[#3525cd]',  border: 'border-[#c7c4d8]',  strip: '#3525cd', label: 'General' },
  urgent:      { icon: <AlertTriangle size={15} />, bg: 'bg-rose-50',    text: 'text-rose-700',   border: 'border-rose-200',   strip: '#EF4444', label: 'Urgent' },
  policy:      { icon: <Info size={15} />,          bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200',  strip: '#F59E0B', label: 'Policy' },
  celebration: { icon: <PartyPopper size={15} />,   bg: 'bg-emerald-50', text: 'text-emerald-700',border: 'border-emerald-200',strip: '#10B981', label: 'Celebration' },
};

function AnnouncementModal({ open, onClose, ann, duplicate, orgId, pinnedCount = 0, maxPinned = 3 }) {
  const toast  = useToast();
  const qc     = useQueryClient();
  const fileRef = useRef(null);
  const isEdit = !!ann;
  const source  = ann || duplicate; // for pre-filling (edit or duplicate)
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(() => source
    ? { title: isEdit ? source.title : `${source.title} (Copy)`, content: source.content, type: source.type || 'general', priority: source.priority || 'normal', target_audience: source.target_audience || 'all', pinned: isEdit ? !!source.pinned : false, expires_at: source.expires_at || '', file_url: source.file_url || null, file_name: source.file_name || null, file_type: source.file_type || null, scheduled_at: source.scheduled_at || '' }
    : { title: '', content: '', type: 'general', priority: 'normal', target_audience: 'all', pinned: false, expires_at: '', file_url: null, file_name: null, file_type: null, scheduled_at: '' });

  const mut = useMutation({
    mutationFn: () => isEdit
      ? apiPut(`/announcements/${ann.id}`, form)
      : apiPost('/announcements', { ...form, ...(orgId ? { org_id: orgId } : {}) }),
    onSuccess: () => { toast(isEdit ? 'Updated!' : 'Announcement posted!', 'success'); qc.invalidateQueries({ queryKey: ['announcements'] }); qc.invalidateQueries({ queryKey: ['announcements', orgId ?? null] }); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [errors, setErrors] = useState({});

  const titleLen   = form.title.length;
  const contentLen = form.content.length;
  const isOverLimit = titleLen > TITLE_MAX || contentLen > CONTENT_MAX;

  // BUG_087/088: validate before save
  function validate() {
    const errs = {};
    const trimTitle = form.title.trim();
    if (!trimTitle) { errs.title = 'Title is required.'; }
    else if (!/[a-zA-Z]/.test(trimTitle)) { errs.title = 'Title must contain at least one letter.'; }
    else if (trimTitle.length > TITLE_MAX) { errs.title = `Title must not exceed ${TITLE_MAX} characters.`; }
    if (!form.content.trim()) { errs.content = 'Content is required.'; }
    else if (!/[a-zA-Z]/.test(form.content)) { errs.content = 'Content must contain at least one letter.'; }
    else if (form.content.length > CONTENT_MAX) { errs.content = `Content must not exceed ${CONTENT_MAX} characters.`; }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // BUG_089: clean filename for display
  const displayFileName = form.file_name || (form.file_url ? form.file_url.split('/').pop() : 'Attached file');

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('lt_token');
      const res = await fetch('/api/announcements/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setForm(f => ({ ...f, file_url: data.file_url, file_name: data.file_name, file_type: data.file_type }));
      toast('Poster / Document uploaded!', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Announcement' : 'New Announcement'} size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (validate()) mut.mutate(); }} disabled={mut.isPending || uploading || isOverLimit}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : isEdit ? 'Save Changes' : 'Post Announcement'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div>
          {/* BUG_087/088: Title with validation and char counter */}
          <div className="flex justify-between items-center mb-1">
            <label className="form-label mb-0">Title *</label>
            <span className={`text-[0.65rem] font-semibold ${titleLen > TITLE_MAX ? 'text-rose-600' : 'text-[#777587]'}`}>{titleLen}/{TITLE_MAX}</span>
          </div>
          <input className={`form-control ${errors.title ? 'border-rose-400' : ''}`} placeholder="Announcement title…" maxLength={TITLE_MAX} value={form.title} onChange={e => { set('title', e.target.value); if (errors.title) setErrors(p => ({ ...p, title: '' })); }} />
          {errors.title && <p className="text-xs text-rose-500 mt-1">{errors.title}</p>}
        </div>
        <div>
          {/* BUG_087/088: Content with validation and char counter */}
          <div className="flex justify-between items-center mb-1">
            <label className="form-label mb-0">Content *</label>
            <span className={`text-[0.65rem] font-semibold ${contentLen > CONTENT_MAX ? 'text-rose-600' : 'text-[#777587]'}`}>{contentLen}/{CONTENT_MAX}</span>
          </div>
          <textarea className={`form-control ${errors.content ? 'border-rose-400' : ''}`} rows={4} placeholder="Write your announcement…" maxLength={CONTENT_MAX + 20} value={form.content} onChange={e => { set('content', e.target.value); if (errors.content) setErrors(p => ({ ...p, content: '' })); }} />
          {errors.content && <p className="text-xs text-rose-500 mt-1">{errors.content}</p>}
        </div>
        <div>
          <label className="form-label">Type</label>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(TYPE_CFG).map(([val, cfg]) => (
              <button key={val} type="button" onClick={() => set('type', val)}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 text-[0.65rem] font-bold transition-all ${form.type === val ? `${cfg.bg} ${cfg.text} ${cfg.border}` : 'border-[#e7eefe] text-[#777587] hover:border-[#c7c4d8]'}`}>
                {cfg.icon}{cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Poster / Document Upload Section */}
        <div>
          {/* BUG_089: no vendor name in label */}
          <label className="form-label">Attachment <span className="font-normal text-[#777587] normal-case tracking-normal">(optional — image / PDF / doc)</span></label>
          <input type="file" ref={fileRef} onChange={handleFileUpload} className="hidden" accept="image/*,application/pdf,.doc,.docx" />
          {form.file_url ? (
            <div className="flex items-center justify-between p-3 bg-[#f0f3ff] border border-[#3525cd]/30 rounded-xl">
              <div className="flex items-center gap-2 min-w-0">
                <Paperclip size={16} className="text-[#3525cd] flex-shrink-0" />
                <span className="text-xs font-bold text-[#151c27] truncate">{displayFileName}</span>
              </div>
              <button type="button" onClick={() => setForm(f => ({ ...f, file_url: null, file_name: null, file_type: null }))}
                className="p-1 text-[#777587] hover:text-rose-600 rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-[#c7c4d8] hover:border-[#3525cd] bg-[#f9f9ff] hover:bg-[#f0f3ff] rounded-xl text-xs font-bold text-[#3525cd] transition-all">
              {uploading ? <><span className="spinner w-4 h-4" /> Uploading…</> : <><Upload size={16} /> Upload Image / PDF / Doc</>}
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Audience</label>
            <select className="form-control" value={form.target_audience} onChange={e => set('target_audience', e.target.value)}>
              <option value="all">Everyone</option>
              <option value="employees">Employees Only</option>
              {/* BUG_085: use 'hr' — valid DB enum value */}
              <option value="hr">Admins / HR Only</option>
            </select>
          </div>
          <div>
            <label className="form-label">Expires On <span className="font-normal text-[#777587] normal-case tracking-normal">(optional)</span></label>
            <input type="date" className="form-control" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
          </div>
        </div>
        {/* EHN_ANN_002: Schedule for later */}
        <div className="rounded-xl border border-[#e7eefe] p-3">
          <div className="flex items-center gap-2.5">
            <input type="checkbox" className="w-4 h-4 accent-[#3525cd]" id="schedule-toggle"
              checked={!!form.scheduled_at}
              onChange={e => set('scheduled_at', e.target.checked ? new Date(Date.now() + 86400000).toISOString().slice(0, 16) : '')} />
            <label htmlFor="schedule-toggle" className="text-sm font-bold text-[#151c27] cursor-pointer">Schedule for later</label>
          </div>
          {form.scheduled_at && (
            <div className="mt-2">
              <label className="form-label text-xs">Publish at</label>
              <input type="datetime-local" className="form-control" value={form.scheduled_at}
                onChange={e => set('scheduled_at', e.target.value)} />
              <p className="text-xs text-[#777587] mt-1">The announcement will only appear after this date/time.</p>
            </div>
          )}
        </div>

        {/* EHN_ANN_008: Max pinned limit */}
        <label className="flex items-center gap-2.5 cursor-pointer rounded-xl border border-[#e7eefe] p-3 hover:bg-[#f9f9ff] transition-colors">
          <div className={`w-10 h-5 rounded-full transition-colors relative ${form.pinned ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}
            onClick={() => {
              if (!form.pinned && pinnedCount >= maxPinned && !isEdit) {
                toast(`Maximum ${maxPinned} announcements can be pinned. Please unpin one first.`, 'error');
                return;
              }
              set('pinned', !form.pinned);
            }}>
            <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.pinned ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </div>
          <div>
            <div className="text-sm font-bold text-[#151c27]">Pin this announcement</div>
            <div className="text-xs text-[#777587]">Pinned posts appear at the top · Max {maxPinned} pinned · Auto-unpins after 30 days</div>
          </div>
        </label>
      </div>
    </Modal>
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 7) return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (d > 0)  return `${d}d ago`;
  if (h > 0)  return `${h}h ago`;
  if (m > 0)  return `${m}m ago`;
  return 'Just now';
}

export default function AnnouncementsPage() {
  const { isAdmin, isEmployee, hasPermission } = useAuth();
  // BUG_162: gate create/manage actions on announcements.create permission
  const canCreateAnnouncement = isAdmin && hasPermission('announcements', 'create');
  const wrap = '';
  const toast = useToast();
  const qc    = useQueryClient();
  const location = useLocation();
  const [addOpen,       setAddOpen]       = useState(false);
  const [editAnn,       setEditAnn]       = useState(null);
  const [duplicateAnn,  setDuplicateAnn]  = useState(null); // EHN_ANN_007
  const [confirmDel,    setConfirmDel]    = useState(null);
  const [filter,        setFilter]        = useState('all');
  const [previewMedia,  setPreviewMedia]  = useState(null);
  const MAX_PINNED = 3; // EHN_ANN_008

  // BUG_094: read ?highlight=X from URL — scroll to that announcement when data loads
  const highlightId = useMemo(() => {
    const p = new URLSearchParams(location.search);
    const h = p.get('highlight');
    return h ? parseInt(h, 10) : null;
  }, [location.search]);

  const activeOrgId = null;

  const { data: _annData, isLoading } = useQuery({
    queryKey: ['announcements', activeOrgId],
    queryFn:  () => apiGet('/announcements', activeOrgId ? { org_id: activeOrgId } : {}),
  });
  const announcements = Array.isArray(_annData) ? _annData : [];

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/announcements/${id}`),
    onSuccess: () => { toast('Announcement deleted', 'warning'); qc.invalidateQueries({ queryKey: ['announcements'] }); qc.invalidateQueries({ queryKey: ['announcements', activeOrgId] }); },
    onError: e => toast(e.message, 'error'),
  });

  const today    = new Date().toISOString().split('T')[0];
  // BUG_179: expired = expires_at <= today (expires ON the date, not after it)
  const isExpired = (a) => a.expires_at && a.expires_at <= today;
  const filtered = filter === 'all' ? announcements : announcements.filter(a => a.type === filter);
  const pinned   = filtered.filter(a => a.pinned && !isExpired(a));
  const regular  = filtered.filter(a => !a.pinned || isExpired(a));

  // BUG_094: scroll to highlighted announcement after data loads
  useEffect(() => {
    if (!highlightId || announcements.length === 0) return;
    // If the target is filtered out, show all announcements
    const target = announcements.find(a => a.id === highlightId);
    if (target && target.type !== filter && filter !== 'all') setFilter('all');
    const el = document.getElementById(`ann-${highlightId}`);
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    }
  }, [highlightId, announcements.length]);

  return (
    <div className={wrap}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="page-subtitle">{announcements.length} announcement{announcements.length !== 1 ? 's' : ''} · company-wide communications</p>
        </div>
        {/* BUG_162: only show create button when announcements.create permission is granted */}
        {canCreateAnnouncement && <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={16} />New Announcement</button>}
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {['all', ...Object.keys(TYPE_CFG)].map(f => {
          const cfg = TYPE_CFG[f];
          return (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold capitalize border transition-all flex items-center gap-1.5 ${filter === f ? 'bg-[#3525cd] text-white border-[#3525cd] shadow-sm' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'}`}>
              {cfg && <span className={filter === f ? 'text-white' : ''}>{cfg.icon}</span>}
              {/* BUG_086: show per-type count */}
              {f === 'all' ? `All (${announcements.length})` : `${cfg?.label} (${announcements.filter(a => a.type === f).length})`}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading announcements…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Megaphone size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">No announcements</p>
          <p className="text-sm">{isAdmin ? 'Post your first announcement to keep the team informed' : 'No announcements from management yet'}</p>
          {canCreateAnnouncement && <button className="btn btn-primary mt-4" onClick={() => setAddOpen(true)}><Plus size={14} />Post Announcement</button>}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pinned section */}
          {pinned.length > 0 && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Pin size={12} className="text-[#3525cd]" />
                <span className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">Pinned</span>
              </div>
              {pinned.map(a => <AnnouncementCard key={a.id} a={a} isAdmin={isAdmin} today={today} onEdit={setEditAnn} onDelete={setConfirmDel} onPreview={setPreviewMedia} onDuplicate={canCreateAnnouncement ? setDuplicateAnn : null} isHighlighted={highlightId != null && String(a.id) === String(highlightId)} />)}
              {regular.length > 0 && (
                <div className="flex items-center gap-2 mt-4 mb-2">
                  <span className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">Latest</span>
                  <div className="flex-1 h-px bg-[#f0f3ff]" />
                </div>
              )}
            </>
          )}
          {regular.map(a => <AnnouncementCard key={a.id} a={a} isAdmin={isAdmin} today={today} onEdit={setEditAnn} onDelete={setConfirmDel} onPreview={setPreviewMedia} onDuplicate={canCreateAnnouncement ? setDuplicateAnn : null} isHighlighted={highlightId != null && String(a.id) === String(highlightId)} />)}
        </div>
      )}

      {addOpen        && <AnnouncementModal open onClose={() => setAddOpen(false)} orgId={activeOrgId} pinnedCount={pinned.length} maxPinned={MAX_PINNED} />}
      {editAnn        && <AnnouncementModal open onClose={() => setEditAnn(null)} ann={editAnn} orgId={activeOrgId} pinnedCount={pinned.length} maxPinned={MAX_PINNED} />}
      {/* EHN_ANN_007: Duplicate — open modal pre-filled with source data but not as "edit" */}
      {duplicateAnn   && <AnnouncementModal open onClose={() => setDuplicateAnn(null)} orgId={activeOrgId} duplicate={duplicateAnn} pinnedCount={pinned.length} maxPinned={MAX_PINNED} />}
      <ConfirmModal open={!!confirmDel} title="Delete Announcement" message={`Delete "${confirmDel?.name}"?`}
        confirmLabel="Delete" onConfirm={() => { delMut.mutate(confirmDel.id); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />

      {/* Poster In-Page Lightbox Modal */}
      {previewMedia && (
        <Modal open onClose={() => setPreviewMedia(null)} title={previewMedia.title || 'Announcement Poster'} size="lg"
          footer={
            <div className="flex justify-between items-center w-full">
              <a href={previewMedia.url} download={previewMedia.title || 'poster'} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm">
                <Download size={14} /> Download File
              </a>
              <button className="btn btn-primary btn-sm" onClick={() => setPreviewMedia(null)}>Close Preview</button>
            </div>
          }>
          <div className="flex items-center justify-center bg-[#151c27] rounded-xl p-2 max-h-[70vh] overflow-auto">
            <img src={previewMedia.url} alt={previewMedia.title} className="max-h-[65vh] w-auto object-contain rounded-lg shadow-2xl" />
          </div>
        </Modal>
      )}
    </div>
  );
}

function AnnouncementCard({ a, isAdmin, today, onEdit, onDelete, onPreview, onDuplicate, isHighlighted }) {
  const cfg     = TYPE_CFG[a.type] || TYPE_CFG.general;
  const expired = a.expires_at && a.expires_at <= today;
  const isImage = a.file_url && (a.file_type?.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif)$/i.test(a.file_url));
  const toast   = useToast();
  const qc      = useQueryClient();
  const { user, isRootAdmin } = useAuth();

  // Root Admin can manage any org announcement.
  // Other admins can only manage announcements they created (non-null created_by matching own id).
  // Legacy announcements with created_by = null are root-admin-only.
  const canManageThis = isAdmin && (isRootAdmin || (a.created_by != null && Number(a.created_by) === Number(user?.id)));
  // BUG_094: fade highlight out after 3 seconds
  const [lit, setLit] = useState(!!isHighlighted);
  const [markedRead, setMarkedRead] = useState(false);
  useEffect(() => {
    if (!isHighlighted) return;
    setLit(true);
    const t = setTimeout(() => setLit(false), 3000);
    return () => clearTimeout(t);
  }, [isHighlighted]);

  // EHN_ANN_003: Mark as Read mutation
  const markReadMut = useMutation({
    mutationFn: () => apiPost(`/announcements/${a.id}/read`, {}),
    onSuccess: () => { setMarkedRead(true); toast('Marked as read', 'success'); },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <div id={`ann-${a.id}`} className={`card overflow-hidden hover:shadow-card-hover transition-all duration-200 ${expired ? 'opacity-60' : ''} ${lit ? 'ring-4 ring-[#3525cd] ring-offset-2 bg-[#f0f3ff] border-[#3525cd]/40' : ''}`}>
      <div className="h-1 w-full" style={{ background: cfg.strip }} />
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
            <span className={cfg.text}>{cfg.icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2 flex-wrap">
                {a.pinned && <Pin size={12} className="text-[#3525cd]" />}
                <h3 className="font-black text-[#151c27] break-words overflow-hidden line-clamp-2">{a.title}</h3>
                <span className={`badge ${cfg.bg} ${cfg.text} ${cfg.border} border flex items-center gap-1`}>{cfg.icon}{cfg.label}</span>
                {expired && <span className="badge badge-cancelled">Expired</span>}
              </div>
              {isAdmin && (
                <div className="flex gap-1 flex-shrink-0">
                  {/* Duplicate: any admin with create permission can duplicate */}
                  {onDuplicate && <button className="btn btn-ghost btn-icon text-[#777587] hover:text-emerald-600" title="Duplicate announcement" onClick={() => onDuplicate(a)}><Copy size={13} /></button>}
                  {/* Edit/Delete: root admin can manage all; others only their own */}
                  {canManageThis && <button className="btn btn-ghost btn-icon text-[#777587] hover:text-[#3525cd]" onClick={() => onEdit(a)}><Pencil size={13} /></button>}
                  {canManageThis && <button className="btn btn-ghost btn-icon text-[#777587] hover:text-rose-500" onClick={() => onDelete({ id: a.id, name: a.title })}><Trash2 size={13} /></button>}
                </div>
              )}
            </div>
            <p className="text-sm text-[#464555] leading-relaxed mb-3 break-words overflow-hidden line-clamp-6">{a.content}</p>

            {/* Attached Poster or Document Display */}
            {a.file_url && (
              <div className="mb-3">
                {isImage ? (
                  <div className="rounded-xl overflow-hidden border border-[#c7c4d8] max-w-lg">
                    <button type="button" onClick={() => onPreview({ url: a.file_url, title: a.title })} className="block w-full text-left relative group cursor-pointer">
                      <img src={a.file_url} alt={a.file_name || 'Poster'} className="w-full max-h-96 object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-xs font-bold">
                        <ExternalLink size={16} /> Click to View Poster
                      </div>
                    </button>
                  </div>
                ) : (
                  <a href={a.file_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2.5 px-4 py-2 bg-[#f0f3ff] hover:bg-[#e0e7ff] border border-[#3525cd]/30 rounded-xl text-xs font-bold text-[#3525cd] transition-all">
                    <FileText size={16} />
                    <span>{a.file_name || 'View Attachment Document'}</span>
                    <Download size={14} className="ml-1" />
                  </a>
                )}
              </div>
            )}

            <div className="flex items-center gap-3 text-xs text-[#777587]">
              <span className="font-semibold">{a.creator_name || 'Admin'}</span>
              <span>·</span>
              <span>{timeAgo(a.created_at)}</span>
              {a.expires_at && <><span>·</span><span>Expires {a.expires_at}</span></>}
              {a.scheduled_at && <><span>·</span><span className="text-amber-600 font-semibold">Scheduled: {new Date(a.scheduled_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span></>}
              {/* EHN_ANN_003: Mark as Read for employees */}
              {!isAdmin && !markedRead && (
                <button onClick={() => markReadMut.mutate()}
                  className="ml-auto flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700 transition-colors">
                  <CheckCircle2 size={12} />Mark as Read
                </button>
              )}
              {!isAdmin && markedRead && (
                <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 size={12} />Read</span>
              )}
              {isAdmin && <span className="ml-auto badge badge-cancelled capitalize">{a.target_audience}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


