import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LogOut, CheckSquare, Square, AlertTriangle, ChevronDown, ChevronUp,
  ClipboardList, Clock, CheckCircle2, XCircle, TrendingUp, Shield,
  CalendarDays, Timer, Trash2, FileText, UserCheck,
} from 'lucide-react';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { fmtDate } from '@/lib/utils';

const STATUS_CFG = {
  pending:   { cls: 'badge-pending',   label: 'Pending',    strip: '#F59E0B' },
  approved:  { cls: 'badge-approved',  label: 'Accepted',   strip: '#10B981' },
  rejected:  { cls: 'badge-rejected',  label: 'Rejected',   strip: '#EF4444' },
  completed: { cls: 'badge-approved',  label: 'Completed',  strip: '#10B981' },
};

const CLEARANCE_FIELDS = [
  { key: 'clearance_it',      label: 'IT Clearance',      icon: '💻' },
  { key: 'clearance_hr',      label: 'HR Clearance',      icon: '👥' },
  { key: 'clearance_finance', label: 'Finance Clearance', icon: '💰' },
  { key: 'clearance_admin',   label: 'Admin Clearance',   icon: '📋' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysBetween(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

// ── Resignation submit modal ──────────────────────────────────────────────────
function ResignModal({ open, onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [form, setForm] = useState({ resignation_date: new Date().toISOString().split('T')[0], reason: '', notice_period_days: 30 });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: () => apiPost('/exit', form),
    onSuccess: () => { toast('Resignation submitted', 'success'); qc.invalidateQueries({ queryKey: ['exit-requests'] }); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  const lwd = new Date(form.resignation_date);
  lwd.setDate(lwd.getDate() + Number(form.notice_period_days || 30));

  return (
    <Modal open={open} onClose={onClose} title="Submit Resignation" size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Submitting…</> : <><LogOut size={14} />Submit Resignation</>}
          </button>
        </div>
      }>
      <div className="rounded-xl bg-rose-50 border border-rose-200 p-3.5 mb-4 flex items-start gap-2.5">
        <AlertTriangle size={15} className="text-rose-600 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-rose-700 leading-relaxed">This will notify HR and initiate the offboarding process. Please ensure you've discussed this with your manager.</p>
      </div>
      <div className="space-y-4">
        <div><label className="form-label">Resignation Date *</label><input type="date" className="form-control" value={form.resignation_date} onChange={e => set('resignation_date', e.target.value)} /></div>
        <div>
          <label className="form-label">Notice Period (days)</label>
          <input type="number" className="form-control" min={0} value={form.notice_period_days} onChange={e => set('notice_period_days', e.target.value)} />
          <p className="form-hint">Estimated last working day: <strong>{lwd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</strong></p>
        </div>
        <div><label className="form-label">Reason <span className="font-normal text-[#777587] normal-case tracking-normal">(optional)</span></label><textarea className="form-control" rows={3} placeholder="Share your reasons…" value={form.reason} onChange={e => set('reason', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

// ── Offboarding checklist for approved exits ──────────────────────────────────
function OffboardingTasks({ userId, isAdmin }) {
  const toast = useToast();
  const qc    = useQueryClient();

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['offboarding-tasks', userId],
    queryFn:  () => apiGet('/offboarding', { userId }),
    staleTime: 30000,
    retry: false,
  });

  const completeMut = useMutation({
    mutationFn: ({ id, completed }) => apiPut(`/offboarding/${id}/complete`, { completed }),
    onSuccess: (_, { id }) => qc.invalidateQueries({ queryKey: ['offboarding-tasks', userId] }),
    onError: e => toast(e.message, 'error'),
  });

  if (isLoading) return <p className="text-xs text-[#9ca3af]">Loading offboarding tasks…</p>;

  if (!tasks.length) return (
    <div className="text-xs text-[#9ca3af] bg-[#f9f9ff] rounded-lg px-3 py-2 border border-[#f0f3ff]">
      No offboarding tasks configured for this employee yet.
    </div>
  );

  const doneCount = tasks.filter(t => t.completed).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] flex items-center gap-1.5">
          <ClipboardList size={11} /> Offboarding Checklist
        </p>
        <span className="text-xs font-bold text-[#3525cd]">{doneCount}/{tasks.length} done</span>
      </div>
      <div className="space-y-1.5 max-h-52 overflow-y-auto">
        {tasks.map(t => (
          <div key={t.id}
            onClick={() => isAdmin && completeMut.mutate({ id: t.id, completed: !t.completed })}
            className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-xs transition-all
              ${t.completed ? 'bg-emerald-50 border-emerald-200' : 'bg-[#f9f9ff] border-[#e7eefe]'}
              ${isAdmin ? 'cursor-pointer hover:shadow-sm' : ''}`}>
            {t.completed
              ? <CheckSquare size={13} className="text-emerald-500 flex-shrink-0" />
              : <Square size={13} className="text-[#c7c4d8] flex-shrink-0" />}
            <span className={`flex-1 ${t.completed ? 'text-emerald-700 line-through' : 'text-[#464555]'}`}>
              {t.title}
            </span>
            <span className="text-[0.58rem] font-semibold text-[#9ca3af] uppercase tracking-wide flex-shrink-0">
              {t.assigned_to}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 h-1.5 bg-[#f0f3ff] rounded-full overflow-hidden">
        <div className="h-full bg-[#3525cd] rounded-full transition-all"
          style={{ width: `${tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

// ── Employee journey view (shown when employee has an existing resignation) ───
function EmployeeResignationJourney({ req }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const cfg   = STATUS_CFG[req.status] || STATUS_CFG.pending;

  const withdrawMut = useMutation({
    mutationFn: () => apiDelete(`/exit/${req.id}`),
    onSuccess: () => { toast('Resignation withdrawn', 'success'); qc.invalidateQueries({ queryKey: ['exit-requests'] }); },
    onError: e => toast(e.message, 'error'),
  });

  // Notice period calculations
  const today          = new Date();
  const resignDate     = new Date(req.resignation_date);
  const noticeDays     = Number(req.notice_period_days) || 0;
  const elapsedDays    = Math.max(0, Math.min(noticeDays, daysBetween(resignDate, today)));
  const remainingDays  = Math.max(0, noticeDays - elapsedDays);
  const noticePct      = noticeDays > 0 ? Math.round((elapsedDays / noticeDays) * 100) : 0;

  // Approval timeline steps
  const steps = [
    { label: 'Submitted',   Icon: FileText,      active: true,                                          done: true  },
    { label: 'HR Review',   Icon: Clock,         active: ['approved','rejected','completed'].includes(req.status), done: ['approved','rejected','completed'].includes(req.status) },
    { label: req.status === 'rejected' ? 'Rejected' : 'Approved', Icon: req.status === 'rejected' ? XCircle : CheckCircle2,
      active: ['approved','rejected','completed'].includes(req.status),
      done:   ['approved','completed'].includes(req.status),
      rejected: req.status === 'rejected' },
  ];

  const clearanceCount = CLEARANCE_FIELDS.filter(f => req[f.key]).length;

  return (
    <div className="space-y-4">
      {/* ── Resignation Summary card ──────────────────── */}
      <div className="card overflow-hidden">
        <div className="h-1 w-full" style={{ background: cfg.strip }} />
        <div className="p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="font-black text-[#151c27] text-base mb-1">My Resignation</h2>
              <p className="text-xs text-[#777587]">Reference: <span className="font-mono font-bold text-[#3525cd]">EXT-{String(req.id).padStart(4, '0')}</span></p>
            </div>
            <span className={`badge ${cfg.cls} text-sm px-3 py-1`}>{cfg.label}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Submitted',       value: fmtDate(req.created_at || req.resignation_date), Icon: CalendarDays },
              { label: 'Resignation Date',value: fmtDate(req.resignation_date),                   Icon: FileText     },
              { label: 'Last Working Day',value: req.last_working_day ? fmtDate(req.last_working_day) : '—', Icon: CalendarDays },
              { label: 'Notice Period',   value: `${noticeDays} days`,                             Icon: Timer        },
            ].map(({ label, value, Icon }) => (
              <div key={label} className="bg-[#f9f9ff] rounded-xl p-3 border border-[#e7eefe]">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon size={11} className="text-[#3525cd]" />
                  <span className="text-[0.62rem] font-bold uppercase tracking-wider text-[#777587]">{label}</span>
                </div>
                <p className="font-black text-[#151c27] text-sm">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Approval Timeline ─────────────────────────── */}
      <div className="card p-5">
        <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-4">Approval Timeline</p>
        <div className="flex items-center gap-0">
          {steps.map((step, i) => {
            const Icon = step.Icon;
            const isLast = i === steps.length - 1;
            return (
              <React.Fragment key={step.label}>
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all
                    ${step.rejected  ? 'bg-rose-50 border-rose-400 text-rose-500'
                    : step.done      ? 'bg-emerald-50 border-emerald-400 text-emerald-600'
                    : step.active    ? 'bg-[#ede9ff] border-[#3525cd] text-[#3525cd]'
                    :                  'bg-[#f9f9ff] border-[#c7c4d8] text-[#c7c4d8]'}`}>
                    <Icon size={15} />
                  </div>
                  <span className={`text-[0.65rem] font-bold mt-1.5 text-center leading-tight
                    ${step.rejected ? 'text-rose-500'
                    : step.done     ? 'text-emerald-600'
                    : step.active   ? 'text-[#3525cd]'
                    :                 'text-[#c7c4d8]'}`}>{step.label}</span>
                </div>
                {!isLast && (
                  <div className={`flex-1 h-0.5 mb-4 mx-1 rounded-full transition-all
                    ${steps[i + 1]?.done ? 'bg-emerald-400' : steps[i + 1]?.active ? 'bg-[#3525cd]' : 'bg-[#e7eefe]'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* ── Notice Period Tracker ─────────────────────── */}
      {noticeDays > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] flex items-center gap-1.5">
              <Timer size={11} /> Notice Period Tracker
            </p>
            <span className="text-xs font-bold text-[#3525cd]">{noticePct}% elapsed</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: 'Total Days',     value: noticeDays,     color: 'text-[#151c27]'  },
              { label: 'Elapsed Days',   value: elapsedDays,    color: 'text-amber-600'  },
              { label: 'Remaining Days', value: remainingDays,  color: 'text-[#3525cd]'  },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center bg-[#f9f9ff] rounded-xl p-3 border border-[#e7eefe]">
                <div className={`text-2xl font-black ${color}`}>{value}</div>
                <div className="text-[0.6rem] font-bold uppercase tracking-wider text-[#777587] mt-0.5">{label}</div>
              </div>
            ))}
          </div>
          <div className="h-3 bg-[#f0f3ff] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${noticePct}%`,
                background: noticePct >= 100 ? '#10B981' : noticePct >= 75 ? '#3525cd' : '#F59E0B',
              }}
            />
          </div>
          {remainingDays === 0 && (
            <p className="text-xs text-emerald-600 font-semibold mt-2 text-center">Notice period complete</p>
          )}
        </div>
      )}

      {/* ── Exit Clearance Status ─────────────────────── */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] flex items-center gap-1.5">
            <CheckCircle2 size={11} /> Exit Clearance
          </p>
          <span className="text-xs font-bold text-[#3525cd]">{clearanceCount}/{CLEARANCE_FIELDS.length} cleared</span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {CLEARANCE_FIELDS.map(f => (
            <div key={f.key}
              className={`flex items-center gap-2.5 p-3 rounded-xl border
                ${req[f.key] ? 'bg-emerald-50 border-emerald-200' : 'bg-[#f9f9ff] border-[#e7eefe]'}`}>
              <span className="text-base">{f.icon}</span>
              <span className={`text-xs font-semibold flex-1 ${req[f.key] ? 'text-emerald-700' : 'text-[#464555]'}`}>{f.label}</span>
              {req[f.key]
                ? <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                : <Clock size={15} className="text-[#c7c4d8] flex-shrink-0" />}
            </div>
          ))}
        </div>
        <div className="h-2 bg-[#f0f3ff] rounded-full overflow-hidden">
          <div className="h-full bg-[#3525cd] rounded-full transition-all"
            style={{ width: `${(clearanceCount / CLEARANCE_FIELDS.length) * 100}%` }} />
        </div>
      </div>

      {/* ── Withdraw button ───────────────────────────── */}
      {req.status === 'pending' && (
        <div className="flex justify-end">
          <button
            className="btn btn-outline btn-sm text-rose-600 border-rose-200 hover:bg-rose-50 flex items-center gap-1.5"
            onClick={() => { if (window.confirm('Are you sure you want to withdraw your resignation?')) withdrawMut.mutate(); }}
            disabled={withdrawMut.isPending}>
            <Trash2 size={13} />
            {withdrawMut.isPending ? 'Withdrawing…' : 'Withdraw Resignation'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Admin ExitCard (enhanced) ─────────────────────────────────────────────────
function ExitCard({ req, isAdmin }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [open, setOpen] = useState(false);
  // EHN_EXIT_MNG_006: reject with reason
  const [rejectOpen,  setRejectOpen]  = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  // EHN_EXIT_MNG_005: rehire eligible edit
  const [rehireOpen,  setRehireOpen]  = useState(false);
  const [rehireVal,   setRehireVal]   = useState(req.rehire_eligible || '');

  const cfg = STATUS_CFG[req.status] || STATUS_CFG.pending;
  const clearanceCount = CLEARANCE_FIELDS.filter(f => req[f.key]).length;

  // Notice period remaining
  const today         = new Date();
  const resignDate    = new Date(req.resignation_date);
  const noticeDays    = Number(req.notice_period_days) || 0;
  const elapsedDays   = Math.max(0, Math.min(noticeDays, daysBetween(resignDate, today)));
  const remainingDays = Math.max(0, noticeDays - elapsedDays);

  const updateMut = useMutation({
    mutationFn: data => apiPut(`/exit/${req.id}`, data),
    onSuccess: () => { toast('Updated!', 'success'); qc.invalidateQueries({ queryKey: ['exit-requests'] }); },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <div className="card overflow-hidden hover:shadow-card-hover transition-all duration-200">
      <div className="h-1 w-full" style={{ background: cfg.strip }} />
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start gap-4 cursor-pointer" onClick={() => setOpen(o => !o)}>
          {isAdmin && <Avatar name={req.user_name} color={req.user_avatar_color} size={42} />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-black text-[#151c27]">{isAdmin ? req.user_name : 'My Resignation'}</span>
              <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-0.5 text-xs">
              <div><span className="text-[#777587]">Resigned on</span> · <span className="font-semibold text-[#151c27]">{fmtDate(req.resignation_date)}</span></div>
              {req.last_working_day && <div><span className="text-[#777587]">Last day</span> · <span className="font-semibold text-[#151c27]">{fmtDate(req.last_working_day)}</span></div>}
              <div><span className="text-[#777587]">Notice</span> · <span className="font-semibold text-[#151c27]">{noticeDays} days</span></div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Days remaining pill (admin view only, approved status) */}
            {isAdmin && req.status === 'approved' && (
              <div className="hidden sm:flex flex-col items-center bg-[#ede9ff] rounded-lg px-2.5 py-1.5">
                <span className="text-sm font-black text-[#3525cd] leading-none">{remainingDays}</span>
                <span className="text-[0.58rem] font-bold text-[#5b45e0] uppercase tracking-wide mt-0.5">days left</span>
              </div>
            )}
            {/* Clearance progress */}
            <div className="text-center hidden sm:block">
              <div className="text-sm font-black text-[#3525cd]">{clearanceCount}/{CLEARANCE_FIELDS.length}</div>
              <div className="text-[0.62rem] text-[#777587] uppercase tracking-wide">Clearance</div>
            </div>
            {open ? <ChevronUp size={15} className="text-[#777587]" /> : <ChevronDown size={15} className="text-[#777587]" />}
          </div>
        </div>

        {/* Expanded details */}
        {open && (
          <div className="mt-4 pt-4 border-t border-[#f0f3ff] space-y-4">
            {req.reason && (
              <div className="bg-[#f9f9ff] rounded-xl p-3 text-xs">
                <span className="text-[#777587]">Reason: </span>
                <span className="text-[#464555] italic">"{req.reason}"</span>
              </div>
            )}

            {/* Notice period progress (admin view) */}
            {isAdmin && req.status === 'approved' && noticeDays > 0 && (
              <div>
                <div className="flex justify-between items-center text-xs text-[#777587] mb-1.5">
                  <span className="font-bold text-[#777587] flex items-center gap-1"><Timer size={11} /> Notice Period Progress</span>
                  <span className="font-bold text-[#3525cd]">{remainingDays} days remaining</span>
                </div>
                <div className="h-2 bg-[#f0f3ff] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, Math.round((elapsedDays / noticeDays) * 100))}%`,
                      background: remainingDays === 0 ? '#10B981' : '#3525cd',
                    }} />
                </div>
                <div className="flex justify-between text-[0.62rem] text-[#9ca3af] mt-1">
                  <span>{elapsedDays} elapsed</span>
                  <span>{noticeDays} total</span>
                </div>
              </div>
            )}

            {/* Clearance checklist */}
            <div>
              <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-3">Clearance Checklist</p>
              <div className="grid grid-cols-2 gap-2">
                {CLEARANCE_FIELDS.map(f => {
                  const canToggle = isAdmin && req.status !== 'rejected';
                  return (
                    <div key={f.key}
                      className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all
                        ${req[f.key] ? 'bg-emerald-50 border-emerald-200' : 'bg-[#f9f9ff] border-[#e7eefe]'}
                        ${canToggle ? 'cursor-pointer hover:shadow-sm' : 'opacity-50 cursor-not-allowed'}`}
                      onClick={() => canToggle && updateMut.mutate({ [f.key]: !req[f.key] })}>
                      <span className="text-base">{f.icon}</span>
                      <span className={`text-xs font-semibold flex-1 ${req[f.key] ? 'text-emerald-700' : 'text-[#464555]'}`}>{f.label}</span>
                      {req[f.key]
                        ? <CheckSquare size={15} className="text-emerald-500 flex-shrink-0" />
                        : <Square size={15} className="text-[#c7c4d8] flex-shrink-0" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Clearance progress bar */}
            <div>
              <div className="flex justify-between text-xs text-[#777587] mb-1.5">
                <span>Clearance Progress</span>
                <span className="font-bold">{clearanceCount}/{CLEARANCE_FIELDS.length}</span>
              </div>
              <div className="h-2 bg-[#f0f3ff] rounded-full overflow-hidden">
                <div className="h-full bg-[#3525cd] rounded-full transition-all" style={{ width: `${(clearanceCount / CLEARANCE_FIELDS.length) * 100}%` }} />
              </div>
            </div>

            {/* Offboarding checklist — only for approved exits */}
            {req.status === 'approved' && (
              <OffboardingTasks userId={req.user_id} isAdmin={isAdmin} />
            )}

            {/* Admin actions */}
            {isAdmin && (
              <div className="flex flex-wrap gap-2 pt-2">
                {req.status === 'pending' && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => updateMut.mutate({ status: 'approved' })} disabled={updateMut.isPending}>Accept Resignation</button>
                    {/* EHN_EXIT_MNG_006: Reject with reason */}
                    <button className="btn btn-outline btn-sm text-rose-600 border-rose-200 hover:bg-rose-50"
                      onClick={() => setRejectOpen(true)} disabled={updateMut.isPending}>Decline</button>
                  </>
                )}
                {req.status === 'approved' && clearanceCount === CLEARANCE_FIELDS.length && (
                  <button className="btn btn-primary btn-sm" onClick={() => updateMut.mutate({ status: 'completed' })} disabled={updateMut.isPending}>
                    <CheckSquare size={13} />Mark Offboarding Complete
                  </button>
                )}
                {/* EHN_EXIT_MNG_005: Rehire Eligible (shown once completed) */}
                {req.status === 'completed' && (
                  <button className="btn btn-outline btn-sm flex items-center gap-1.5" onClick={() => { setRehireVal(req.rehire_eligible || ''); setRehireOpen(true); }}>
                    <UserCheck size={12} />
                    {req.rehire_eligible
                      ? <span>Rehire: <strong>{req.rehire_eligible === 'yes' ? 'Yes' : req.rehire_eligible === 'no' ? 'No' : 'With Conditions'}</strong></span>
                      : 'Set Rehire Eligibility'}
                  </button>
                )}
              </div>
            )}
            {/* EHN_EXIT_MNG_005: Show Rehire Eligible field (read-only in non-admin view) */}
            {req.rehire_eligible && !isAdmin && (
              <div className="flex items-center gap-2 pt-2 text-xs">
                <UserCheck size={12} className="text-[#777587]" />
                <span className="text-[#777587]">Rehire Eligible:</span>
                <span className={`font-semibold ${req.rehire_eligible === 'yes' ? 'text-emerald-700' : req.rehire_eligible === 'no' ? 'text-rose-700' : 'text-amber-700'}`}>
                  {req.rehire_eligible === 'yes' ? 'Yes' : req.rehire_eligible === 'no' ? 'No' : 'With Conditions'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* EHN_EXIT_MNG_006: Reject modal with reason */}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Decline Resignation" size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn btn-outline" onClick={() => setRejectOpen(false)}>Cancel</button>
            <button className="btn btn-danger" disabled={!rejectReason.trim() || updateMut.isPending}
              onClick={() => { updateMut.mutate({ status: 'rejected', rejection_reason: rejectReason, ...Object.fromEntries(CLEARANCE_FIELDS.map(f => [f.key, false])) }); setRejectOpen(false); }}>
              Decline Request
            </button>
          </div>
        }>
        <div className="space-y-3">
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 flex items-start gap-2">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            Declining will notify the employee. Please provide a reason.
          </div>
          <div>
            <label className="form-label">Reason for declining *</label>
            <textarea className="form-control" rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Request submitted in error, under discussion with manager…" />
          </div>
        </div>
      </Modal>

      {/* EHN_EXIT_MNG_005: Set Rehire Eligible modal */}
      <Modal open={rehireOpen} onClose={() => setRehireOpen(false)} title="Set Rehire Eligibility" size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn btn-outline" onClick={() => setRehireOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => { updateMut.mutate({ rehire_eligible: rehireVal }); setRehireOpen(false); }}>
              Save
            </button>
          </div>
        }>
        <div className="space-y-3">
          <p className="text-sm text-[#777587]">Would you rehire this employee in the future?</p>
          <div className="grid grid-cols-3 gap-2">
            {[{v:'yes',l:'Yes',c:'border-emerald-400 bg-emerald-50 text-emerald-700'},{v:'no',l:'No',c:'border-rose-400 bg-rose-50 text-rose-700'},{v:'with_conditions',l:'With Conditions',c:'border-amber-400 bg-amber-50 text-amber-700'}].map(opt => (
              <button key={opt.v} type="button" onClick={() => setRehireVal(opt.v)}
                className={`p-3 rounded-xl border-2 text-xs font-bold transition-all text-center ${rehireVal === opt.v ? opt.c + ' border-2' : 'border-[#e7eefe] text-[#777587] hover:border-[#c7c4d8]'}`}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ExitManagement() {
  const { isAdmin, isRootAdmin, user } = useAuth();
  const { selectedBranchId } = useBranch();
  const wrap = '';
  const [resignOpen, setResignOpen] = useState(false);

  const { data: _exitData, isLoading } = useQuery({ queryKey: ['exit-requests', selectedBranchId], queryFn: () => apiGet('/exit') });
  const requests = Array.isArray(_exitData) ? _exitData : [];

  const activeCount      = requests.filter(r => ['pending','approved'].includes(r.status)).length;
  const completedCount   = requests.filter(r => r.status === 'completed').length;
  const noticePeriodCount = requests.filter(r => r.status === 'approved').length;

  // For employee: the single resignation (if any)
  const myResignation = !isAdmin ? requests[0] : null;

  // KPI card config (admin/root admin)
  const kpiCards = [
    {
      label: 'Pending',
      value: requests.filter(r => r.status === 'pending').length,
      Icon:  Clock,
      color: 'from-amber-50 to-amber-100',
      top:   '#F59E0B',
      text:  'text-amber-700',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
    },
    {
      label: 'In Notice Period',
      value: noticePeriodCount,
      Icon:  Timer,
      color: 'from-blue-50 to-blue-100',
      top:   '#3b82f6',
      text:  'text-blue-700',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
    },
    {
      label: 'Approved',
      value: requests.filter(r => r.status === 'approved').length,
      Icon:  CheckCircle2,
      color: 'from-emerald-50 to-emerald-100',
      top:   '#10B981',
      text:  'text-emerald-700',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
    },
    {
      label: 'Completed',
      value: completedCount,
      Icon:  TrendingUp,
      color: 'from-[#f0f3ff] to-[#e7eefe]',
      top:   '#3525cd',
      text:  'text-[#3525cd]',
      iconBg: 'bg-[#ede9ff]',
      iconColor: 'text-[#3525cd]',
    },
  ];

  return (
    <div className={wrap}>
      <div className="page-header">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="page-title">Exit Management</h1>
              {isRootAdmin && (
                <span className="inline-flex items-center gap-1 text-[0.6rem] font-black uppercase tracking-widest bg-[#3525cd] text-white px-2 py-0.5 rounded-full">
                  <Shield size={9} /> Root Admin
                </span>
              )}
            </div>
            <p className="page-subtitle">
              {isAdmin
                ? `${activeCount} active resignation${activeCount !== 1 ? 's' : ''} · ${completedCount} completed`
                : 'Manage your resignation and offboarding'}
            </p>
          </div>
        </div>
        {!isAdmin && !requests.length && (
          <button className="btn btn-danger btn-sm" onClick={() => setResignOpen(true)}>
            <LogOut size={14} />Submit Resignation
          </button>
        )}
      </div>

      {/* ── Admin KPI cards ─────────────────────────────── */}
      {isAdmin && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          {kpiCards.map(s => {
            const Icon = s.Icon;
            return (
              <div key={s.label} className={`rounded-xl p-4 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-card relative overflow-hidden`}>
                <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
                <div className="flex items-start justify-between mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.iconBg}`}>
                    <Icon size={16} className={s.iconColor} />
                  </div>
                </div>
                <div className={`text-3xl font-black ${s.text}`}>{s.value}</div>
                <div className="text-[0.68rem] font-bold uppercase tracking-wider text-[#777587] mt-1">{s.label}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Content ──────────────────────────────────────── */}
      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading…</div>
      ) : requests.length === 0 ? (
        <div className="empty-state">
          <LogOut size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">{isAdmin ? 'No exit requests' : 'No resignation submitted'}</p>
          <p className="text-sm">{isAdmin ? 'Employee resignations will appear here' : 'Submit your resignation to start the offboarding process'}</p>
          {!isAdmin && <button className="btn btn-danger mt-4 btn-sm" onClick={() => setResignOpen(true)}><LogOut size={13} />Submit Resignation</button>}
        </div>
      ) : isAdmin ? (
        /* Admin: list of ExitCards */
        <div className="flex flex-col gap-4">
          {requests.map(r => <ExitCard key={r.id} req={r} isAdmin={isAdmin} />)}
        </div>
      ) : myResignation ? (
        /* Employee: rich journey view */
        <EmployeeResignationJourney req={myResignation} />
      ) : null}

      {resignOpen && <ResignModal open onClose={() => setResignOpen(false)} />}
    </div>
  );
}
