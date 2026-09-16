import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Plus, Target, Star, TrendingUp, Pencil, Trash2, ChevronDown, ChevronUp, CheckCircle2, Search, X, Filter, Paperclip, MessageSquare, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';

const GOAL_STATUS_CFG = {
  active:    { cls: 'badge-pending',   strip: '#F59E0B', label: 'Active'    },
  completed: { cls: 'badge-approved',  strip: '#10B981', label: 'Completed' },
  cancelled: { cls: 'badge-cancelled', strip: '#c7c4d8', label: 'Cancelled' },
};

// BUG_080: Distinct colors per category
const CATEGORY_CFG = {
  individual: { cls: 'bg-blue-100 text-blue-700',     label: 'Individual' },
  department: { cls: 'bg-purple-100 text-purple-700', label: 'Department' },
  team:       { cls: 'bg-amber-100 text-amber-700',   label: 'Team'       },
};

const TITLE_MAX = 150;

const REVIEW_STATUS_CFG = {
  pending:     { cls: 'badge-pending',   label: 'Pending',    strip: '#F59E0B' },
  in_progress: { cls: 'badge-pending',   label: 'In Progress',strip: '#3525cd' },
  completed:   { cls: 'badge-approved',  label: 'Completed',  strip: '#10B981' },
  cancelled:   { cls: 'badge-cancelled', label: 'Cancelled',  strip: '#c7c4d8' },
};

function StarRating({ value, max = 5, onChange }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map(n => (
        <button key={n} type="button"
          onClick={() => onChange?.(n)}
          onMouseEnter={() => setHovered(n)}
          onMouseLeave={() => setHovered(0)}
          className="focus:outline-none transition-transform hover:scale-110">
          <Star size={20}
            className={`transition-colors ${(hovered || value) >= n ? 'text-amber-400 fill-amber-400' : 'text-[#e7eefe]'}`} />
        </button>
      ))}
      {value > 0 && <span className="ml-2 text-sm font-black text-[#151c27]">{value}/5</span>}
    </div>
  );
}

function GoalModal({ open, onClose, goal, employees, isAdmin, currentCycle }) {
  const toast  = useToast();
  const qc     = useQueryClient();
  const isEdit = !!goal;
  const [form, setForm] = useState(() => isEdit
    ? { title: goal.title, description: goal.description || '', category: goal.category, target_date: goal.target_date || '', review_cycle: goal.review_cycle, progress: Math.min(100, Math.max(0, Number(goal.progress) || 0)), status: goal.status, user_id: goal.user_id }
    : { title: '', description: '', category: 'individual', target_date: '', review_cycle: currentCycle || String(new Date().getFullYear()), progress: 0, status: 'active', user_id: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const hasValidTitle = /[a-zA-Z0-9]/.test(form.title.trim());
  const titleTooLong  = form.title.length > TITLE_MAX;
  const DESC_MAX = 1000;

  const mut = useMutation({
    mutationFn: () => isEdit ? apiPut(`/performance/goals/${goal.id}`, form) : apiPost('/performance/goals', form),
    onSuccess: () => { toast(isEdit ? 'Goal updated!' : 'Goal added!', 'success'); qc.invalidateQueries({ queryKey: ['perf-goals'] }); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  function handleSave() {
    if (!form.title.trim()) { toast('Goal Title is required.', 'error'); return; }
    if (!hasValidTitle) { toast('Goal Title must contain at least one letter or number.', 'error'); return; }
    if (titleTooLong) { toast(`Goal Title must be ${TITLE_MAX} characters or less.`, 'error'); return; }
    if (form.description && form.description.length > DESC_MAX) { toast(`Description must be ${DESC_MAX} characters or less.`, 'error'); return; }
    if (form.target_date) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (new Date(form.target_date) < today) { toast('Target date cannot be in the past.', 'error'); return; }
    }
    mut.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Goal' : 'Add Goal'} size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={mut.isPending || !form.title || !hasValidTitle || titleTooLong}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Save Goal'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        {isAdmin && !isEdit && (
          <div>
            <label className="form-label">Employee <span className="font-normal text-[#777587] normal-case tracking-normal">(leave blank for yourself)</span></label>
            <select className="form-control" value={form.user_id} onChange={e => set('user_id', e.target.value)}>
              <option value="">— My goal —</option>
              {(employees || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="form-label">Goal Title *</label>
          <input
            className={`form-control ${(form.title && !hasValidTitle) || titleTooLong ? 'border-rose-400' : ''}`}
            placeholder="e.g. Complete React certification"
            maxLength={TITLE_MAX + 10}
            value={form.title}
            onChange={e => set('title', e.target.value)}
          />
          <p className={`text-xs mt-1 ${titleTooLong ? 'text-rose-600' : 'text-[#777587]'}`}>{form.title.length}/{TITLE_MAX}</p>
          {form.title && !hasValidTitle && <p className="text-xs text-rose-600 mt-0.5">Goal Title must contain at least one letter or number.</p>}
          {form.title && !hasValidTitle && (
            <p className="text-xs text-rose-600 mt-1">Goal Title must contain at least one letter or number.</p>
          )}
        </div>
        <div>
          <label className="form-label">Description</label>
          <textarea className={`form-control ${form.description.length > DESC_MAX ? 'border-rose-400' : ''}`} rows={2} placeholder="What does success look like?" maxLength={DESC_MAX + 10} value={form.description} onChange={e => set('description', e.target.value)} />
          <p className={`text-xs mt-1 ${form.description.length > DESC_MAX ? 'text-rose-600' : 'text-[#777587]'}`}>{form.description.length}/{DESC_MAX}</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Category</label>
            <select className="form-control" value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="individual">Individual</option>
              <option value="team">Team</option>
              <option value="department">Department</option>
            </select>
          </div>
          <div>
            <label className="form-label">Target Date</label>
            <input type="date" className="form-control" min={new Date().toISOString().slice(0, 10)} value={form.target_date} onChange={e => {
              const val = e.target.value;
              set('target_date', val);
              if (val) set('review_cycle', val.substring(0, 4));
            }} />
          </div>
        </div>
        <div>
          <label className="form-label">
            Progress — {form.progress}%
            {form.status === 'cancelled' && (
              <span className="ml-2 text-[0.65rem] font-semibold text-[#777587] normal-case tracking-normal">(locked — goal is cancelled)</span>
            )}
          </label>
          <div className="flex items-center gap-3">
            {/* BUG_165: disable slider for cancelled goals — prevents accidental auto-complete on backend */}
            <input type="range" className={`flex-1 accent-[#3525cd] ${form.status === 'cancelled' ? 'opacity-40 cursor-not-allowed' : ''}`}
              min={0} max={100} step={5} value={form.progress}
              disabled={form.status === 'cancelled'}
              onChange={e => set('progress', Number(e.target.value))} />
            {/* EHN_PR_001: Numeric input that syncs bidirectionally with slider */}
            <input type="number" min={0} max={100}
              className={`form-control w-20 text-center font-black text-[#3525cd] text-sm ${form.status === 'cancelled' ? 'opacity-40 cursor-not-allowed' : ''}`}
              disabled={form.status === 'cancelled'}
              value={form.progress}
              onChange={e => {
                const v = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                set('progress', v);
              }} />
          </div>
        </div>
        {isEdit && (
          <div>
            <label className="form-label">Status</label>
            <select className="form-control" value={form.status} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        )}
      </div>
    </Modal>
  );
}

function ReviewCard({ rv }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const qc    = useQueryClient();
  const [open,           setOpen]           = useState(false);
  const [selfRating,     setSelfRating]     = useState(rv.self_rating || 0);
  const [selfComments,   setSelfComments]   = useState(rv.self_comments || '');
  const [managerRating,  setManagerRating]  = useState(rv.manager_rating || 0);
  const [managerComments,setManagerComments]= useState(rv.manager_comments || '');
  const cfg = REVIEW_STATUS_CFG[rv.status] || REVIEW_STATUS_CFG.pending;

  const mut = useMutation({
    mutationFn: data => apiPut(`/performance/reviews/${rv.id}`, data),
    onSuccess: () => { toast('Saved!', 'success'); qc.invalidateQueries({ queryKey: ['perf-reviews'] }); setOpen(false); },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <div className="card overflow-hidden hover:shadow-card-hover transition-all duration-200">
      <div className="h-1 w-full" style={{ background: cfg.strip }} />
      <div className="p-5">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
          <Avatar name={rv.user_name} color={rv.user_avatar_color} size={40} />
          <div className="flex-1 min-w-0">
            <div className="font-black text-[#151c27]">{rv.user_name}</div>
            <div className="text-xs text-[#777587]">{rv.review_cycle} · {rv.review_type} review</div>
          </div>
          <div className="flex items-center gap-3">
            {rv.final_rating > 0 && (
              <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                <Star size={12} className="text-amber-400 fill-amber-400" />
                <span className="text-xs font-black text-amber-700">{rv.final_rating}/5</span>
              </div>
            )}
            <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
            {open ? <ChevronUp size={15} className="text-[#777587]" /> : <ChevronDown size={15} className="text-[#777587]" />}
          </div>
        </div>

        {open && (
          <div className="mt-4 pt-4 border-t border-[#f0f3ff] space-y-5">
            {/* Self Assessment */}
            <div>
              <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-3">Self Assessment</p>
              <div className="space-y-3">
                <div>
                  <label className="form-label">Self Rating</label>
                  <StarRating value={selfRating} onChange={setSelfRating} />
                </div>
                <div>
                  <label className="form-label">Comments</label>
                  <textarea className="form-control" rows={2} placeholder="Describe your achievements…" value={selfComments} onChange={e => setSelfComments(e.target.value)} />
                </div>
                {!isAdmin && (
                  <button className="btn btn-outline btn-sm" onClick={() => mut.mutate({ self_rating: selfRating, self_comments: selfComments })} disabled={mut.isPending}>
                    {mut.isPending ? <><span className="spinner w-3 h-3" />Saving…</> : 'Save Self Assessment'}
                  </button>
                )}
              </div>
            </div>

            {/* Manager Assessment (admin only) */}
            {isAdmin && (
              <div>
                <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-3">Manager Assessment</p>
                <div className="space-y-3">
                  <div>
                    <label className="form-label">Manager Rating</label>
                    <StarRating value={managerRating} onChange={setManagerRating} />
                  </div>
                  <div>
                    <label className="form-label">Manager Comments</label>
                    <textarea className="form-control" rows={2} value={managerComments} onChange={e => setManagerComments(e.target.value)} />
                  </div>
                  <button className="btn btn-primary btn-sm"
                    onClick={() => mut.mutate({ self_rating: selfRating, self_comments: selfComments, manager_rating: managerRating, manager_comments: managerComments, final_rating: managerRating || selfRating, status: 'completed' })}
                    disabled={mut.isPending}>
                    {mut.isPending ? <><span className="spinner w-3 h-3" />Submitting…</> : 'Submit Final Review'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ENH_PERF_001/002: Goal comments + attachments panel
function GoalDetailsPanel({ goalId, isAdmin, newComment, setNewComment, onCommentPost }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const { data: comments = [] } = useQuery({ queryKey: ['goal-comments', goalId], queryFn: () => apiGet(`/performance/goals/${goalId}/comments`).catch(() => []) });
  const { data: attachments = [] } = useQuery({ queryKey: ['goal-attachments', goalId], queryFn: () => apiGet(`/performance/goals/${goalId}/attachments`).catch(() => []) });
  const commentMut = useMutation({
    mutationFn: () => apiPost(`/performance/goals/${goalId}/comments`, { comment: newComment }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['goal-comments', goalId] }); onCommentPost(); toast('Comment added', 'success'); },
    onError: e => toast(e.message, 'error'),
  });
  return (
    <div className="mt-2 pt-3 border-t border-[#f0f3ff] space-y-3">
      {/* Comments */}
      <div>
        <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wide mb-2 flex items-center gap-1"><MessageSquare size={10} /> Manager Comments</p>
        {comments.length === 0 ? (
          <p className="text-xs text-[#9ca3af] italic">No manager comments yet.</p>
        ) : (
          <div className="space-y-2">
            {comments.map(c => (
              <div key={c.id} className="bg-[#f9f9ff] border border-[#f0f3ff] rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-[#151c27]">{c.reviewer_name || 'Manager'}</span>
                  <span className="text-[0.6rem] text-[#9ca3af]">{new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </div>
                <p className="text-xs text-[#464555]">{c.comment}</p>
              </div>
            ))}
          </div>
        )}
        {isAdmin && (
          <div className="flex gap-2 mt-2">
            <input className="form-control flex-1 py-1.5 text-xs" placeholder="Add a comment…" value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newComment.trim()) commentMut.mutate(); }} />
            <button className="btn btn-primary btn-sm" onClick={() => commentMut.mutate()} disabled={!newComment.trim() || commentMut.isPending}>
              <Send size={12} />
            </button>
          </div>
        )}
      </div>
      {/* Attachments */}
      {attachments.length > 0 && (
        <div>
          <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wide mb-2 flex items-center gap-1"><Paperclip size={10} /> Attachments</p>
          <div className="flex flex-wrap gap-2">
            {attachments.map(a => (
              <a key={a.id} href={a.file_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-semibold text-[#3525cd] bg-[#f0f3ff] border border-[#c7c4d8] rounded-lg px-2.5 py-1 hover:bg-[#e0e7ff] transition-colors">
                <Paperclip size={10} />{a.file_name || 'Attachment'}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Performance() {
  const { isAdmin, isEmployee } = useAuth();
  const { selectedBranchId } = useBranch();
  const wrap = '';
  const toast = useToast();
  const qc    = useQueryClient();
  const [searchParams] = useSearchParams();
  const [tab,           setTab]          = useState('goals');
  const [expandedGoalId, setExpandedGoalId] = useState(null); // for comments/attachments
  const [newComment,    setNewComment]   = useState('');
  const [addGoal,       setAddGoal]      = useState(false);
  const [editGoal,      setEditGoal]     = useState(null);
  const [confirmDel,    setConfirmDel]   = useState(null);
  const [cycle,         setCycle]        = useState(String(new Date().getFullYear()));
  // EHN_PR_003: goal filter state
  const [gFilterTitle,  setGFilterTitle]  = useState('');
  const [gFilterCat,    setGFilterCat]    = useState('');
  const [gFilterStatus, setGFilterStatus] = useState('');
  const [gFilterEmp,    setGFilterEmp]    = useState('');
  const [gSortBy,       setGSortBy]       = useState('');
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);

  // BUG_094: highlight goal navigated from a notification
  const highlightGoalId = searchParams.get('highlight') ? parseInt(searchParams.get('highlight'), 10) : null;
  const [highlightActive, setHighlightActive] = useState(true);

  const { data: _goalsData,   isLoading: gLoad } = useQuery({ queryKey: ['perf-goals',   cycle, selectedBranchId], queryFn: () => apiGet('/performance/goals',   { cycle }) });
  const { data: _reviewsData, isLoading: rLoad } = useQuery({ queryKey: ['perf-reviews', cycle, selectedBranchId], queryFn: () => apiGet('/performance/reviews', { cycle }) });
  const { data: _empData }                       = useQuery({ queryKey: ['employees', 'all', selectedBranchId],    queryFn: () => apiGet('/employees'), enabled: isAdmin });
  const goals     = Array.isArray(_goalsData)   ? _goalsData   : [];
  const reviews   = Array.isArray(_reviewsData) ? _reviewsData : [];
  const employees = Array.isArray(_empData)     ? _empData     : [];

  // BUG_094: switch to goals tab and scroll to highlighted goal after data loads
  useEffect(() => {
    if (!highlightGoalId) return;
    setTab('goals');
  }, [highlightGoalId]);
  useEffect(() => {
    if (!highlightGoalId || gLoad || goals.length === 0) return;
    const el = document.getElementById(`goal-${highlightGoalId}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
  }, [highlightGoalId, goals.length, gLoad]);
  useEffect(() => {
    if (!highlightGoalId) return;
    const t = setTimeout(() => setHighlightActive(false), 3000);
    return () => clearTimeout(t);
  }, [highlightGoalId]);

  const delGoal = useMutation({
    mutationFn: id => apiDelete(`/performance/goals/${id}`),
    onSuccess: () => { toast('Goal deleted', 'warning'); qc.invalidateQueries({ queryKey: ['perf-goals'] }); },
    onError: e => toast(e.message, 'error'),
  });

  const initReview = useMutation({
    mutationFn: userId => apiPost('/performance/reviews', { user_id: userId, review_cycle: cycle }),
    onSuccess: () => { toast('Review started!', 'success'); qc.invalidateQueries({ queryKey: ['perf-reviews'] }); },
    onError: e => toast(e.message, 'error'),
  });

  // EHN_PR_003: filtered + sorted goals
  const filteredGoals = goals.filter(g => {
    if (gFilterTitle  && !g.title.toLowerCase().includes(gFilterTitle.toLowerCase())) return false;
    if (gFilterCat    && g.category !== gFilterCat)    return false;
    if (gFilterEmp    && String(g.user_id) !== String(gFilterEmp)) return false;
    if (gFilterStatus === 'overdue') {
      if (!(g.status === 'active' && g.target_date && new Date(g.target_date) < todayDate)) return false;
    } else if (gFilterStatus && g.status !== gFilterStatus) return false;
    return true;
  }).sort((a, b) => {
    if (gSortBy === 'target_asc')  return (a.target_date || '').localeCompare(b.target_date || '');
    if (gSortBy === 'target_desc') return (b.target_date || '').localeCompare(a.target_date || '');
    if (gSortBy === 'prog_asc')    return (Number(a.progress)||0) - (Number(b.progress)||0);
    if (gSortBy === 'prog_desc')   return (Number(b.progress)||0) - (Number(a.progress)||0);
    return 0;
  });
  const isGoalFilterActive = !!(gFilterTitle || gFilterCat || gFilterStatus || gFilterEmp || gSortBy);

  // BUG_165: exclude cancelled goals/reviews from all KPI calculations
  const activeGoals    = goals.filter(g => g.status !== 'cancelled');
  const completedGoals = activeGoals.filter(g => g.status === 'completed').length;
  const avgProgress    = activeGoals.length > 0 ? Math.min(100, Math.round(activeGoals.reduce((s, g) => s + Math.min(100, Math.max(0, Number(g.progress) || 0)), 0) / activeGoals.length)) : 0;
  const activeReviews  = reviews.filter(r => r.status !== 'cancelled');

  return (
    <div className={wrap}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Performance</h1>
          <p className="page-subtitle">Goals and reviews for cycle <span className="font-bold text-[#3525cd]">{cycle}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-[#c7c4d8] rounded-lg px-2 py-1.5 shadow-sm">
            <button onClick={() => setCycle(c => String(Number(c) - 1))} className="w-7 h-7 flex items-center justify-center rounded text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff]">‹</button>
            <span className="font-black text-[#151c27] min-w-[3rem] text-center text-sm">{cycle}</span>
            <button onClick={() => setCycle(c => String(Number(c) + 1))} className="w-7 h-7 flex items-center justify-center rounded text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff]">›</button>
          </div>
          {tab === 'goals' && <button className="btn btn-primary" onClick={() => setAddGoal(true)}><Plus size={15} />Add Goal</button>}
          {tab === 'reviews' && isAdmin && (
            <select className="form-control w-auto" defaultValue="" onChange={e => { if (e.target.value) { initReview.mutate(e.target.value); e.target.value = ''; } }}>
              <option value="">Start Review for…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Goals',    value: activeGoals.length,    color: 'from-[#f0f3ff] to-[#e7eefe]',    top: '#3525cd', text: 'text-[#3525cd]' },
          { label: 'Completed',      value: completedGoals,        color: 'from-emerald-50 to-emerald-100',  top: '#10B981', text: 'text-emerald-700' },
          { label: 'Avg. Progress',  value: `${avgProgress}%`,     color: 'from-amber-50 to-amber-100',      top: '#F59E0B', text: 'text-amber-700' },
          { label: 'Reviews',        value: activeReviews.length,  color: 'from-[#f0f3ff] to-[#e7eefe]',    top: '#712ae2', text: 'text-[#712ae2]' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-5 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-card relative overflow-hidden`}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
            <div className={`text-3xl font-black leading-none ${s.text}`}>{s.value}</div>
            <div className="text-[0.7rem] font-bold uppercase tracking-wider text-[#777587] mt-1.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-1 rounded-xl mb-6">
        {[{ key: 'goals', label: 'Goals', icon: <Target size={13} /> }, { key: 'reviews', label: 'Reviews', icon: <Star size={13} /> }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg text-xs font-bold transition-all ${tab === t.key ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Goals */}
      {tab === 'goals' && (
        gLoad ? <div className="loading"><div className="spinner" />Loading…</div>
          : goals.length === 0
            ? <div className="empty-state"><Target size={48} className="mx-auto mb-3 text-[#c7c4d8]" /><p className="font-semibold text-[#464555] mb-1">No goals for {cycle}</p><p className="text-sm">Set goals to track your progress and achievements</p><button className="btn btn-primary mt-4" onClick={() => setAddGoal(true)}><Plus size={14} />Add First Goal</button></div>
            : <>
                {/* EHN_PR_003: Filter bar */}
                <div className="bg-white border border-[#c7c4d8] rounded-xl p-3 mb-3 flex flex-wrap gap-2 items-center">
                  <Filter size={13} className="text-[#777587]" />
                  <div className="relative flex-1 min-w-[150px]">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#777587]" />
                    <input className="form-control pl-7 py-1.5 text-xs" placeholder="Search title…"
                      value={gFilterTitle} onChange={e => setGFilterTitle(e.target.value)} />
                  </div>
                  <select className="form-control py-1.5 text-xs w-auto" value={gFilterCat} onChange={e => setGFilterCat(e.target.value)}>
                    <option value="">All Categories</option>
                    <option value="individual">Individual</option>
                    <option value="team">Team</option>
                    <option value="department">Department</option>
                  </select>
                  <select className="form-control py-1.5 text-xs w-auto" value={gFilterStatus} onChange={e => setGFilterStatus(e.target.value)}>
                    <option value="">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="overdue">Overdue</option>
                  </select>
                  {isAdmin && employees.length > 0 && (
                    <select className="form-control py-1.5 text-xs w-auto" value={gFilterEmp} onChange={e => setGFilterEmp(e.target.value)}>
                      <option value="">All Employees</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  )}
                  <select className="form-control py-1.5 text-xs w-auto" value={gSortBy} onChange={e => setGSortBy(e.target.value)}>
                    <option value="">Default Sort</option>
                    <option value="target_asc">Target Date ↑</option>
                    <option value="target_desc">Target Date ↓</option>
                    <option value="prog_asc">Progress ↑</option>
                    <option value="prog_desc">Progress ↓</option>
                  </select>
                  {isGoalFilterActive && (
                    <button className="flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700 px-2 py-1.5 rounded-lg border border-rose-200 bg-rose-50"
                      onClick={() => { setGFilterTitle(''); setGFilterCat(''); setGFilterStatus(''); setGFilterEmp(''); setGSortBy(''); }}>
                      <X size={11} />Clear
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                {filteredGoals.map(g => {
                  const cfg = GOAL_STATUS_CFG[g.status] || GOAL_STATUS_CFG.active;
                  // EHN_PR_002: overdue detection
                  const isOverdue = g.status === 'active' && g.target_date && new Date(g.target_date) < todayDate;
                  return (
                    <div key={g.id} id={`goal-${g.id}`} className={`card p-5 hover:shadow-card-hover transition-all duration-200 ${highlightActive && highlightGoalId != null && String(g.id) === String(highlightGoalId) ? 'bg-[#f0f3ff] ring-4 ring-[#3525cd] ring-offset-2 border-[#3525cd]/40' : ''}`}>
                      <div className="flex items-start gap-4">
                        {isAdmin && <Avatar name={g.user_name} color={g.user_avatar_color} size={36} />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {isAdmin && <span className="text-xs text-[#777587] flex-shrink-0">{g.user_name}</span>}
                                <span className="font-black text-[#151c27] break-all line-clamp-2 min-w-0">{g.title}</span>
                                <span className={`badge ${cfg.cls} flex-shrink-0`}>{cfg.label}</span>
                                {/* EHN_PR_002: Overdue badge */}
                                {isOverdue && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-700 border border-orange-200 flex-shrink-0">Overdue</span>}
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${(CATEGORY_CFG[g.category] || CATEGORY_CFG.individual).cls}`}>{(CATEGORY_CFG[g.category] || CATEGORY_CFG.individual).label}</span>
                              </div>
                              {g.description && <p className="text-xs text-[#777587] mt-1 break-all line-clamp-3">{g.description}</p>}
                              {g.target_date && <p className={`text-xs mt-0.5 ${isOverdue ? 'text-orange-600 font-semibold' : 'text-[#777587]'}`}>Target: <span className="font-semibold">{g.target_date}</span></p>}
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              {/* Completed goals are locked for employees — admins can still edit */}
                              {(isAdmin || g.status !== 'completed') && (
                                <button className="btn btn-ghost btn-icon text-[#777587] hover:text-[#3525cd]" title="Edit goal" onClick={() => setEditGoal(g)}><Pencil size={13} /></button>
                              )}
                              <button className="btn btn-ghost btn-icon text-[#777587] hover:text-rose-500" title="Delete goal" onClick={() => setConfirmDel({ id: g.id, name: g.title })}><Trash2 size={13} /></button>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-[#f0f3ff] rounded-full h-2">
                              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, Number(g.progress) || 0))}%`, background: g.status === 'completed' ? '#10B981' : '#3525cd' }} />
                            </div>
                            <span className="text-xs font-black min-w-[2.5rem] text-right" style={{ color: g.status === 'completed' ? '#059669' : '#3525cd' }}>{Math.min(100, Math.max(0, Number(g.progress) || 0))}%</span>
                            {g.status === 'completed' && <CheckCircle2 size={14} className="text-emerald-500" />}
                          </div>
                          {/* ENH_PERF_001/002: Expand for comments & attachments */}
                          <button onClick={() => setExpandedGoalId(expandedGoalId === g.id ? null : g.id)}
                            className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-[#777587] hover:text-[#3525cd] transition-colors">
                            {expandedGoalId === g.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            Comments & Attachments
                          </button>
                          {expandedGoalId === g.id && (
                            <GoalDetailsPanel goalId={g.id} isAdmin={isAdmin} newComment={newComment} setNewComment={setNewComment} onCommentPost={() => setNewComment('')} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
      )}

      {/* Reviews */}
      {tab === 'reviews' && (
        rLoad ? <div className="loading"><div className="spinner" />Loading…</div>
          : reviews.length === 0
            ? <div className="empty-state"><Star size={48} className="mx-auto mb-3 text-[#c7c4d8]" /><p className="font-semibold text-[#464555] mb-1">No reviews for {cycle}</p><p className="text-sm">{isAdmin ? 'Start a performance review for your team members' : 'Your manager has not initiated a review yet'}</p></div>
            : <div className="flex flex-col gap-3">{reviews.map(r => <ReviewCard key={r.id} rv={r} />)}</div>
      )}

      {addGoal  && <GoalModal open onClose={() => setAddGoal(false)} employees={employees} isAdmin={isAdmin} currentCycle={cycle} />}
      {editGoal && <GoalModal open onClose={() => setEditGoal(null)} goal={editGoal} employees={employees} isAdmin={isAdmin} currentCycle={cycle} />}
      <ConfirmModal open={!!confirmDel} title="Delete Goal" message={`Delete goal "${confirmDel?.name}"?`}
        confirmLabel="Delete" onConfirm={() => { delGoal.mutate(confirmDel.id); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />
    </div>
  );
}
