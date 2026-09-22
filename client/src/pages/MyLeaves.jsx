import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, CheckCircle2, XCircle, Clock, Inbox, AlertTriangle,
  Trash2, X, Info, Loader2, RotateCcw, BookOpen, Home, MapPin, Phone,
  Filter, ChevronDown, Download, SortDesc, CalendarRange, ArrowRight,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { countWorkingDaysInRange } from '@/lib/utils';
import { LeaveTimeline } from '@/components/LeaveTimeline';

const ALL_LEAVE_TYPES = [
  { value: 'annual',      label: 'Annual Leave'    },
  { value: 'casual',      label: 'Casual Leave'    },
  { value: 'sick',        label: 'Sick Leave'      },
  { value: 'emergency',   label: 'Emergency Leave' },
  { value: 'maternity',   label: 'Maternity Leave' },
  { value: 'paternity',   label: 'Paternity Leave' },
  { value: 'bereavement', label: 'Bereavement Leave'},
  { value: 'comp_off',    label: 'Comp Off'        },
  { value: 'earned',      label: 'Earned Leave'    },
  { value: 'unpaid',      label: 'Unpaid Leave'    },
  { value: 'other',       label: 'Other / Unpaid'  },
];

const STATUS_STYLES = {
  pending:      { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   icon: <Clock size={13} /> },
  pending_dept: { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    icon: <Clock size={13} /> },
  pending_root: { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  icon: <Clock size={13} /> },
  approved:     { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', icon: <CheckCircle2 size={13} /> },
  rejected:     { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    icon: <XCircle size={13} /> },
  cancelled:    { bg: 'bg-slate-50',   text: 'text-slate-700',   border: 'border-slate-200',   icon: <XCircle size={13} /> },
};

const STATUS_LABELS = {
  pending:      'Pending',
  pending_dept: 'Pending Dept. Approval',
  pending_root: 'Pending Final Approval',
  approved:     'Approved',
  rejected:     'Rejected',
  cancelled:    'Cancelled',
};

const LEAVE_TYPE_COLORS = {
  annual:      'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]',
  sick:        'bg-rose-50 text-rose-700 border-rose-200',
  casual:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  emergency:   'bg-amber-50 text-amber-700 border-amber-200',
  maternity:   'bg-pink-50 text-pink-700 border-pink-200',
  paternity:   'bg-blue-50 text-blue-700 border-blue-200',
  bereavement: 'bg-slate-50 text-slate-700 border-slate-200',
  comp_off:    'bg-purple-50 text-purple-700 border-purple-200',
  earned:      'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]',
  unpaid:      'bg-slate-50 text-slate-600 border-slate-200',
  other:       'bg-[#f0f3ff] text-[#464555] border-[#c7c4d8]',
};

const LEAVE_LABELS = {
  annual: 'Annual Leave', casual: 'Casual Leave', sick: 'Sick Leave', emergency: 'Emergency Leave',
  maternity: 'Maternity Leave', paternity: 'Paternity Leave', bereavement: 'Bereavement Leave',
  comp_off: 'Comp Off', earned: 'Earned Leave', unpaid: 'Unpaid Leave', other: 'Other Leave',
};
function leaveLabel(type) {
  return LEAVE_LABELS[type] || (type ? type.replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase()) : 'Leave');
}

const INIT_FORM = {
  request_type: 'leave', leave_type: 'casual', start_date: '', end_date: '',
  wfh_date: '', reason: '', leave_time: 'full', half_type: 'first_half',
  work_location: '', contact_number: '',
};

function SegBtn({ value, current, onChange, children }) {
  const active = value === current;
  return (
    <button type="button" onClick={() => onChange(value)}
      className={`flex-1 py-2 px-3 text-sm font-semibold rounded-lg transition-all duration-150 ${
        active ? 'bg-[#3525cd] text-white shadow-sm' : 'bg-white text-[#464555] border border-[#c7c4d8] hover:border-[#3525cd] hover:text-[#3525cd]'
      }`}>
      {children}
    </button>
  );
}

function LeaveApplyPanel({ open, onClose, onSubmit, loading: submitting, policies, leaves }) {
  const [form, setForm]         = useState(INIT_FORM);
  const [checking, setChecking] = useState(false);
  const [check, setCheck]       = useState(null);
  const [wfhChecking, setWfhChecking] = useState(false);
  const [wfhCheck, setWfhCheck] = useState(null);
  const checkTimer    = useRef(null);
  const wfhCheckTimer = useRef(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Use IST locale so "today" matches the user's calendar date, not UTC
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  function handleStartDate(val) {
    set('start_date', val);
    if (!form.end_date || form.end_date < val) set('end_date', val);
  }

  useEffect(() => {
    if (form.request_type !== 'leave' || !form.start_date || !form.end_date) { setCheck(null); return; }
    clearTimeout(checkTimer.current);
    setChecking(true);
    checkTimer.current = setTimeout(async () => {
      try { setCheck(await apiGet('/leaves/date-check', { startDate: form.start_date, endDate: form.end_date, leave_type: form.leave_type, leave_time: form.leave_time })); }
      catch { setCheck(null); }
      finally { setChecking(false); }
    }, 400);
    return () => clearTimeout(checkTimer.current);
  }, [form.start_date, form.end_date, form.request_type, form.leave_time]);

  useEffect(() => {
    if (form.request_type !== 'wfh' || !form.wfh_date) { setWfhCheck(null); return; }
    clearTimeout(wfhCheckTimer.current);
    setWfhChecking(true);
    wfhCheckTimer.current = setTimeout(async () => {
      try { setWfhCheck(await apiGet('/leaves/date-check', { startDate: form.wfh_date, endDate: form.wfh_date, leave_type: 'wfh', leave_time: 'wfh' })); }
      catch { setWfhCheck(null); }
      finally { setWfhChecking(false); }
    }, 400);
    return () => clearTimeout(wfhCheckTimer.current);
  }, [form.wfh_date, form.request_type]);

  useEffect(() => {
    if (!open) { setForm(INIT_FORM); setCheck(null); setWfhCheck(null); }
  }, [open]);

  function fmtConflictDate(d) {
    if (!d) return d;
    const [y, m, day] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${day} ${months[parseInt(m, 10) - 1]} ${y}`;
  }

  function conflictLabel(c) {
    if (c.leave_time === 'wfh' || c.leave_type === 'wfh') return 'Work From Home';
    return leaveLabel(c.leave_type);
  }

  const isWFHRecord = (l) => l.leave_time === 'wfh' || l.leave_type === 'wfh';
  // Treat active===null/undefined as active (DB may return null for default policies).
  const activePolicies = (policies || []).filter(p => p.active !== false && p.leave_type !== 'wfh');
  const leaveTypeOptions = activePolicies.length > 0
    ? activePolicies.map(p => ({ value: p.leave_type, label: p.label, quota: p.annual_quota }))
    : ALL_LEAVE_TYPES.map(t => ({ ...t, quota: 12 }));

  function getStaticBalance(typeVal) {
    const policy = activePolicies.find(p => p.leave_type === typeVal);
    if (!policy || !policy.annual_quota) return null;
    const total   = policy.annual_quota;
    const used    = (leaves || []).filter(l => l.leave_type === typeVal && l.status === 'approved' && !isWFHRecord(l))
      .reduce((sum, l) => sum + (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date)), 0);
    const pending = (leaves || []).filter(l => l.leave_type === typeVal && ['pending','pending_dept','pending_root','pending_approval'].includes(l.status) && !isWFHRecord(l))
      .reduce((sum, l) => sum + (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date)), 0);
    return { used, pending, total, remaining: Math.max(0, total - used - pending) };
  }

  const isWFH          = form.request_type === 'wfh';
  const hasConflict    = (check?.conflicts?.length ?? 0) > 0;
  const hasAttendance  = check?.hasAttendance;
  const wfhHasConflict = (wfhCheck?.conflicts?.length ?? 0) > 0;

  const selectedBalance = !isWFH ? getStaticBalance(form.leave_type) : null;
  const noBalance       = selectedBalance !== null && selectedBalance.remaining <= 0;

  const leaveDayCount = (!isWFH && form.start_date && form.end_date)
    ? (form.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(form.start_date, form.end_date))
    : 0;

  const isPastDate    = !isWFH && !!form.start_date && form.start_date < today;
  const wfhIsPastDate = isWFH  && !!form.wfh_date   && form.wfh_date  < today;

  const canSubmit = isWFH
    ? !!form.wfh_date && !submitting && !wfhHasConflict && !wfhIsPastDate && !!form.reason.trim()
    : !!form.start_date && !!form.end_date && !submitting && !isPastDate && !!form.reason.trim();

  function handleSubmit() {
    if (isWFH) {
      const reasonParts = [form.reason, form.work_location ? `Work Location: ${form.work_location}` : '', form.contact_number ? `Contact: ${form.contact_number}` : ''].filter(Boolean);
      onSubmit({
        leave_type: 'wfh',
        leave_time: form.leave_time === 'half' ? 'half' : 'wfh',
        half_type:  form.leave_time === 'half' ? form.half_type : undefined,
        start_date: form.wfh_date, end_date: form.wfh_date,
        reason: reasonParts.join(' | '),
      });
    } else {
      onSubmit({ leave_type: form.leave_type, leave_time: form.leave_time, start_date: form.start_date, end_date: form.end_date, reason: form.reason, half_type: form.leave_time === 'half' ? form.half_type : undefined });
    }
  }

  return (
    <>
      <div className={`fixed inset-0 z-[900] transition-opacity duration-300 ${open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        style={{ background: 'rgba(4,6,14,.5)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div className="fixed top-0 right-0 h-full z-[901] w-full max-w-[420px] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)' }}>
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #3525cd, #4f46e5, #712ae2)' }} />
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3ff]">
          <div>
            <h2 className="font-black text-[#151c27] text-lg">Apply Request</h2>
            <p className="text-xs text-[#777587] mt-0.5">HR will be notified by email on submission</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl text-[#777587] hover:text-[#151c27] hover:bg-[#f0f3ff] transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Request Type */}
          <div>
            <label className="form-label">Request Type</label>
            <div className="flex gap-2 p-1 bg-[#f0f3ff] rounded-xl border border-[#c7c4d8]">
              <SegBtn value="leave" current={form.request_type} onChange={v => set('request_type', v)}>Leave</SegBtn>
              <SegBtn value="wfh" current={form.request_type} onChange={v => set('request_type', v)}>Work From Home</SegBtn>
            </div>
          </div>

          {!isWFH && (
            <>
              {/* Leave Type with balance */}
              <div>
                <label className="form-label">Leave Type</label>
                <div className="space-y-2">
                  {leaveTypeOptions.map(t => {
                    const bal        = getStaticBalance(t.value);
                    const isSelected = form.leave_type === t.value;
                    const nobal      = bal !== null && bal.remaining <= 0;
                    return (
                      <button key={t.value} type="button" onClick={() => set('leave_type', t.value)}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all duration-150 ${
                          isSelected ? 'border-[#3525cd] bg-[#f0f3ff]' : 'border-[#e7eefe] bg-white hover:border-[#c7c4d8] hover:bg-[#f9f9ff]'
                        }`}>
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-bold ${isSelected ? 'text-[#3525cd]' : 'text-[#151c27]'}`}>{t.label}</div>
                          <div className="text-[0.67rem] mt-0.5">
                            {bal !== null ? (
                              nobal
                                ? <span className="text-rose-500">No balance — {bal.remaining} day(s) remaining</span>
                                : <span className={bal.remaining <= 2 ? 'text-amber-600' : 'text-emerald-600'}>
                                    {bal.remaining} of {bal.total} day(s) remaining
                                    {bal.pending > 0 && <span className="text-amber-500 ml-1">· {bal.pending} pending</span>}
                                  </span>
                            ) : <span className="text-[#777587]">Unlimited / no quota</span>}
                          </div>
                        </div>
                        {isSelected && (
                          <div className="w-4 h-4 rounded-full bg-[#3525cd] flex items-center justify-center flex-shrink-0 ml-2">
                            <CheckCircle2 size={10} className="text-white" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Duration */}
              <div>
                <label className="form-label">Duration</label>
                <div className="flex gap-2 p-1 bg-[#f0f3ff] rounded-xl border border-[#c7c4d8]">
                  <SegBtn value="full" current={form.leave_time} onChange={v => set('leave_time', v)}>Full Day</SegBtn>
                  <SegBtn value="half" current={form.leave_time} onChange={v => set('leave_time', v)}>Half Day</SegBtn>
                </div>
              </div>
              {form.leave_time === 'half' && (
                <div>
                  <label className="form-label">Which Half</label>
                  <div className="flex gap-2 p-1 bg-[#f0f3ff] rounded-xl border border-[#c7c4d8]">
                    <SegBtn value="first_half"  current={form.half_type} onChange={v => set('half_type', v)}>First Half (Morning)</SegBtn>
                    <SegBtn value="second_half" current={form.half_type} onChange={v => set('half_type', v)}>Second Half (Afternoon)</SegBtn>
                  </div>
                </div>
              )}

              <div>
                <label className="form-label">From Date</label>
                <input type="date" className="form-control" min={today} value={form.start_date} onChange={e => handleStartDate(e.target.value)} />
              </div>
              <div>
                <label className="form-label">To Date</label>
                <input type="date" className="form-control" value={form.end_date} min={form.start_date || today} onChange={e => set('end_date', e.target.value)} />
              </div>

              {/* Days count + balance info */}
              {leaveDayCount > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#f0f3ff] border border-[#c7c4d8]">
                    <CheckCircle2 size={13} className="text-[#3525cd] flex-shrink-0" />
                    <span className="text-xs font-bold text-[#3525cd]">
                      {leaveDayCount} working day{leaveDayCount !== 1 ? 's' : ''} selected
                    </span>
                  </div>
                  {selectedBalance && (
                    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border ${
                      selectedBalance.remaining < leaveDayCount ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    }`}>
                      <Info size={13} className="flex-shrink-0" />
                      <span className="text-xs font-semibold">
                        Balance after: {Math.max(0, selectedBalance.remaining - leaveDayCount)} day(s) remaining
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Conflict checks */}
              {form.start_date && form.end_date && (
                <>
                  {isPastDate ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
                      <AlertTriangle size={13} className="text-rose-600 flex-shrink-0 mt-0.5" />
                      <p className="text-[0.72rem] text-rose-700 font-semibold">You cannot apply leave for a past date. Please select today or a future date.</p>
                    </div>
                  ) : (
                  <>
                  {checking && (
                    <div className="flex items-center gap-2 text-xs text-[#777587] bg-[#f0f3ff] rounded-xl px-4 py-3">
                      <Loader2 size={13} className="animate-spin" /> Checking selected dates…
                    </div>
                  )}
                  {!checking && hasConflict && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                      <div className="flex items-start gap-2.5 mb-3">
                        <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle size={13} className="text-rose-600" />
                        </div>
                        <div>
                          <p className="text-sm font-black text-rose-700">Date conflict detected</p>
                          <p className="text-[0.72rem] text-rose-500 mt-0.5">You already have a request on {check.conflicts.length === 1 ? 'this date' : 'these dates'}.</p>
                        </div>
                      </div>
                      <div className="space-y-2 pl-1">
                        {check.conflicts.map(c => {
                          const single = c.start_date === c.end_date;
                          const dateStr = single ? fmtConflictDate(c.start_date) : `${fmtConflictDate(c.start_date)} → ${fmtConflictDate(c.end_date)}`;
                          const statusColor = c.status === 'approved' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-amber-600 bg-amber-50 border-amber-200';
                          return (
                            <div key={c.id} className="flex items-center gap-2.5 bg-white rounded-lg border border-rose-100 px-3 py-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-rose-700">{conflictLabel(c)}</span>
                                <span className="text-[0.68rem] text-rose-400 ml-1.5">{dateStr}</span>
                              </div>
                              <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full border capitalize ${statusColor}`}>{c.status}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!checking && hasAttendance && !hasConflict && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
                      <Info size={13} className="text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-[0.72rem] text-amber-700">You have attendance recorded on the selected dates. HR will still review your request.</p>
                    </div>
                  )}
                  </>
                  )}
                </>
              )}

              <div>
                <label className="form-label">Reason <span className="text-rose-500">*</span></label>
                <textarea className="form-control resize-none" rows={3} value={form.reason}
                  onChange={e => set('reason', e.target.value)} placeholder="Briefly describe the reason for your leave…" />
              </div>
            </>
          )}

          {/* WFH form */}
          {isWFH && (
            <>
              <div>
                <label className="form-label">WFH Date</label>
                <input type="date" className="form-control" min={today} value={form.wfh_date} onChange={e => set('wfh_date', e.target.value)} />
              </div>
              {form.wfh_date && (
                <>
                  {wfhIsPastDate ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2">
                      <AlertTriangle size={13} className="text-rose-600 flex-shrink-0 mt-0.5" />
                      <p className="text-[0.72rem] text-rose-700 font-semibold">You cannot apply WFH for a past date. Please select today or a future date.</p>
                    </div>
                  ) : (
                  <>
                  {wfhChecking && (
                    <div className="flex items-center gap-2 text-xs text-[#777587] bg-[#f0f3ff] rounded-xl px-4 py-3">
                      <Loader2 size={13} className="animate-spin" /> Checking selected date…
                    </div>
                  )}
                  {!wfhChecking && wfhHasConflict && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                      <div className="flex items-start gap-2.5 mb-3">
                        <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertTriangle size={13} className="text-rose-600" />
                        </div>
                        <div>
                          <p className="text-sm font-black text-rose-700">Date conflict detected</p>
                          <p className="text-[0.72rem] text-rose-500 mt-0.5">You already have a request on this date.</p>
                        </div>
                      </div>
                      <div className="space-y-2 pl-1">
                        {wfhCheck.conflicts.map(c => {
                          const single = c.start_date === c.end_date;
                          const dateStr = single ? fmtConflictDate(c.start_date) : `${fmtConflictDate(c.start_date)} → ${fmtConflictDate(c.end_date)}`;
                          const statusColor = c.status === 'approved' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' : 'text-amber-600 bg-amber-50 border-amber-200';
                          return (
                            <div key={c.id} className="flex items-center gap-2.5 bg-white rounded-lg border border-rose-100 px-3 py-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-rose-400 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-rose-700">{conflictLabel(c)}</span>
                                <span className="text-[0.68rem] text-rose-400 ml-1.5">{dateStr}</span>
                              </div>
                              <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full border capitalize ${statusColor}`}>{c.status}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!wfhChecking && !wfhHasConflict && wfhCheck && (
                    <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                      <CheckCircle2 size={13} className="flex-shrink-0" /> Date is available — no existing requests on this day
                    </div>
                  )}
                  </>
                  )}
                </>
              )}
              <div>
                <label className="form-label">Duration</label>
                <div className="flex gap-2 p-1 bg-[#f0f3ff] rounded-xl border border-[#c7c4d8]">
                  <SegBtn value="full" current={form.leave_time} onChange={v => set('leave_time', v)}>Full Day</SegBtn>
                  <SegBtn value="half" current={form.leave_time} onChange={v => set('leave_time', v)}>Half Day</SegBtn>
                </div>
              </div>
              {form.leave_time === 'half' && (
                <div>
                  <label className="form-label">Which Half</label>
                  <div className="flex gap-2 p-1 bg-[#f0f3ff] rounded-xl border border-[#c7c4d8]">
                    <SegBtn value="first_half"  current={form.half_type} onChange={v => set('half_type', v)}>First Half (Morning)</SegBtn>
                    <SegBtn value="second_half" current={form.half_type} onChange={v => set('half_type', v)}>Second Half (Afternoon)</SegBtn>
                  </div>
                </div>
              )}
              <div>
                <label className="form-label">Reason <span className="text-rose-500">*</span></label>
                <textarea className="form-control resize-none" rows={3} value={form.reason}
                  onChange={e => set('reason', e.target.value)} placeholder="Briefly describe why you need to work from home…" />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#f0f3ff] space-y-2">
          {!isWFH && noBalance && (
            <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="inline mr-1" />
              Insufficient leave balance. HR may still review at their discretion.
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-outline flex-1">Cancel</button>
            <button onClick={handleSubmit} disabled={!canSubmit} className="btn btn-primary flex-1">
              {submitting
                ? <span className="flex items-center gap-1.5 justify-center"><span className="spinner w-3.5 h-3.5" /> Submitting…</span>
                : isWFH ? 'Submit WFH Request' : 'Submit Leave Request'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Approval Timeline ─────────────────────────────────────────────────────────
function ApprovalTimeline({ status }) {
  const steps = ['Applied', 'Pending', status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : 'Cancelled'];
  const activeIdx = status === 'pending' ? 1 : 2;
  const stepColors = {
    Applied:   { dot: 'bg-[#3525cd]', text: 'text-[#3525cd]' },
    Pending:   { dot: 'bg-amber-400',  text: 'text-amber-600' },
    Approved:  { dot: 'bg-emerald-500', text: 'text-emerald-600' },
    Rejected:  { dot: 'bg-rose-500',   text: 'text-rose-600' },
    Cancelled: { dot: 'bg-slate-400',  text: 'text-slate-500' },
  };
  return (
    <div className="flex items-center gap-0 mt-1.5">
      {steps.map((step, i) => {
        const isActive = i <= activeIdx;
        const isCurrent = i === activeIdx;
        const colors = stepColors[step] || stepColors.Applied;
        return (
          <React.Fragment key={step}>
            <div className="flex flex-col items-center">
              <div className={`w-3 h-3 rounded-full border-2 transition-all ${
                isCurrent
                  ? `${colors.dot} border-transparent ring-2 ring-offset-1 ring-current`
                  : isActive
                    ? `${colors.dot} border-transparent`
                    : 'bg-white border-[#c7c4d8]'
              }`}
                style={isCurrent ? { ringColor: colors.dot.replace('bg-', '') } : {}}
              />
              <span className={`text-[0.55rem] font-bold mt-0.5 whitespace-nowrap ${
                isCurrent ? colors.text : isActive ? 'text-[#777587]' : 'text-[#c7c4d8]'
              }`}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`h-0.5 flex-1 mx-0.5 mb-2.5 transition-all ${
                i < activeIdx ? colors.dot.replace('bg-', 'bg-') : 'bg-[#e7eefe]'
              }`}
                style={{ minWidth: '20px' }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Main MyLeaves Page ────────────────────────────────────────────────────────
export default function MyLeaves() {
  const qc    = useQueryClient();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [applyOpen, setApplyOpen]       = useState(false);
  const [delTarget, setDelTarget]       = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter]     = useState('all');
  const [dateFrom, setDateFrom]         = useState('');
  const [dateTo, setDateTo]             = useState('');
  const [sortBy, setSortBy]             = useState('newest');
  // BUG_094: highlight leave navigated from a notification
  const highlightId = searchParams.get('highlight') ? parseInt(searchParams.get('highlight'), 10) : null;
  const [highlightActive, setHighlightActive] = useState(true);

  // Auto-open apply panel from quick actions; auto-apply status filter from dashboard
  useEffect(() => {
    if (searchParams.get('action') === 'apply') setApplyOpen(true);
    const s = searchParams.get('status');
    if (s && ['pending', 'approved', 'rejected'].includes(s)) setStatusFilter(s);
  }, []);

  const { data: leaves = [], isLoading } = useQuery({
    queryKey: ['my-leaves'],
    queryFn:  () => apiGet('/leaves'),
  });
  const { data: policies = [] } = useQuery({
    queryKey: ['leave-policies'],
    queryFn:  () => apiGet('/leave-policies'),
  });
  // BUG_14: staleTime:0 ensures balance always refreshes after leave submission
  const { data: leaveBalance } = useQuery({
    queryKey: ['my-leave-balance'],
    queryFn:  () => apiGet('/leaves/balance'),
    staleTime: 0,
  });

  const apply = useMutation({
    mutationFn: (payload) => apiPost('/leaves', payload),
    onSuccess: (newLeave, vars) => {
      // BUG_13: Remove refetchType:'active' so invalidation always triggers a refetch
      qc.invalidateQueries({ queryKey: ['my-leaves'] });
      qc.invalidateQueries({ queryKey: ['my-leaves-recent'] });
      qc.invalidateQueries({ queryKey: ['my-leave-balance'] });
      qc.invalidateQueries({ queryKey: ['leave-policies'] });
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      toast(vars.leave_type === 'wfh' ? 'WFH request submitted. HR will be notified.' : 'Leave request submitted. HR will be notified.', 'success');
      setApplyOpen(false);
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const del = useMutation({
    mutationFn: (id) => apiDelete(`/leaves/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-leaves'] });
      qc.invalidateQueries({ queryKey: ['my-leaves-recent'] });
      toast('Request cancelled.', 'success');
      setDelTarget(null);
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const isWFHRecord = (l) => l.leave_time === 'wfh' || l.leave_type === 'wfh';

  const counts = { pending: 0, approved: 0, rejected: 0 };
  leaves.filter(l => !isWFHRecord(l)).forEach(l => {
    if (['pending', 'pending_dept', 'pending_root', 'pending_approval'].includes(l.status)) counts.pending++;
    else if (l.status === 'approved') counts.approved++;
    else if (l.status === 'rejected') counts.rejected++;
  });

  // BUG_14: use !== false so that null active (default) is treated as active
  const activePolicies = policies.filter(p => p.active !== false && p.annual_quota > 0);

  // Today string for upcoming leaves comparison
  const todayStr = new Date().toISOString().split('T')[0];

  // Upcoming approved leaves (start_date > today, non-WFH)
  const upcomingLeaves = leaves
    .filter(l => !isWFHRecord(l) && l.status === 'approved' && l.start_date > todayStr)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  // Sort comparator
  function sortComparator(a, b) {
    switch (sortBy) {
      case 'oldest':     return new Date(a.start_date) - new Date(b.start_date) || new Date(a.created_at || 0) - new Date(b.created_at || 0);
      case 'leave_date': return new Date(b.start_date) - new Date(a.start_date);
      case 'newest':
      default:           return new Date(b.start_date) - new Date(a.start_date) || new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }
  }

  const PENDING_STATUSES = ['pending', 'pending_dept', 'pending_root', 'pending_approval'];

  // Filter + sort logic
  const sortedLeaves = [...leaves]
    .filter(l => {
      if (statusFilter === 'pending' && !PENDING_STATUSES.includes(l.status)) return false;
      if (statusFilter !== 'all' && statusFilter !== 'pending' && l.status !== statusFilter) return false;
      if (typeFilter === 'wfh' && !isWFHRecord(l)) return false;
      if (typeFilter !== 'all' && typeFilter !== 'wfh' && (isWFHRecord(l) || l.leave_type !== typeFilter)) return false;
      if (dateFrom && l.start_date < dateFrom) return false;
      if (dateTo && l.start_date > dateTo) return false;
      return true;
    })
    .sort(sortComparator);

  // BUG_094: scroll to highlighted leave and fade ring after 3 seconds
  useEffect(() => {
    if (!highlightId || !leaves.length) return;
    const el = document.getElementById(`myleave-${highlightId}`);
    if (el) {
      setHighlightActive(true);
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
    }
  }, [highlightId, leaves.length]);
  useEffect(() => {
    if (!highlightId) return;
    const t = setTimeout(() => setHighlightActive(false), 3000);
    return () => clearTimeout(t);
  }, [highlightId]);

  // Types that appear in the leave list (for filter dropdown)
  const usedTypes = [...new Set(leaves.map(l => isWFHRecord(l) ? 'wfh' : l.leave_type))];

  // Check if any filter is active
  const hasActiveFilters = statusFilter !== 'all' || typeFilter !== 'all' || dateFrom !== '' || dateTo !== '' || sortBy !== 'newest';

  function clearAllFilters() {
    setStatusFilter('all');
    setTypeFilter('all');
    setDateFrom('');
    setDateTo('');
    setSortBy('newest');
  }

  // Export CSV
  function exportCSV() {
    const headers = ['Type', 'Status', 'From', 'To', 'Days', 'Applied Date', 'Reason'];
    const rows = sortedLeaves.map(l => {
      const wfh   = isWFHRecord(l);
      const wdays = wfh ? 1 : (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date));
      const type  = wfh ? 'WFH' : leaveLabel(l.leave_type);
      const appliedDate = l.created_at ? new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      // Escape commas/quotes in reason
      const reason = l.reason ? `"${l.reason.replace(/"/g, '""')}"` : '';
      return [type, l.status, l.start_date, l.end_date, wdays, appliedDate, reason].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `my-leaves-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Format date range for display
  function fmtDateShort(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${day} ${months[parseInt(m, 10) - 1]}`;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">My Leaves</h1>
          <p className="page-subtitle">Apply and track your leave requests</p>
        </div>
        <div className="flex items-center gap-2">
          {sortedLeaves.length > 0 && (
            <button onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold text-[#3525cd] bg-[#f0f3ff] border border-[#c7c4d8] hover:bg-[#e7eefe] transition-all">
              <Download size={14} /> Export
            </button>
          )}
          <button onClick={() => setApplyOpen(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white shadow-sm transition-all"
            style={{ background: 'linear-gradient(135deg, #3525cd, #4f46e5)' }}>
            <Plus size={15} /> Apply Request
          </button>
        </div>
      </div>

      {/* Summary KPI cards — clickable to toggle status filter */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Pending',  key: 'pending',  count: counts.pending,  style: STATUS_STYLES.pending,
            ring: 'ring-amber-400',   activeBg: 'bg-amber-100' },
          { label: 'Approved', key: 'approved', count: counts.approved, style: STATUS_STYLES.approved,
            ring: 'ring-emerald-400', activeBg: 'bg-emerald-100' },
          { label: 'Rejected', key: 'rejected', count: counts.rejected, style: STATUS_STYLES.rejected,
            ring: 'ring-rose-400',    activeBg: 'bg-rose-100' },
        ].map(({ label, key, count, style, ring, activeBg }) => {
          const isActive = statusFilter === key;
          return (
            <div key={label}
              onClick={() => setStatusFilter(prev => prev === key ? 'all' : key)}
              className={`border rounded-2xl p-4 text-center cursor-pointer transition-all duration-150 select-none
                ${isActive
                  ? `${activeBg} ${style.border} ring-2 ${ring} shadow-sm`
                  : `${style.bg} ${style.border} hover:shadow-sm hover:scale-[1.02]`
                }`}>
              <p className={`text-2xl font-black ${style.text}`}>{count}</p>
              <p className="text-xs text-[#464455] mt-0.5 font-medium">{label}</p>
              {isActive && (
                <p className="text-[0.6rem] font-bold text-[#3525cd] mt-1 uppercase tracking-wide">Active filter</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-5 items-start">
        <div>
          {/* ── Filter bar ── */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 mb-4">
            {/* Row 1: Status tabs + type filter + sort */}
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <div className="flex items-center gap-1.5 text-[0.65rem] font-black text-[#777587] uppercase tracking-widest">
                <Filter size={11} /> Filter
              </div>
              {/* Status tabs */}
              <div className="flex gap-1.5 flex-wrap">
                {[
                  { value: 'all',       label: 'All' },
                  { value: 'pending',   label: 'Pending' },
                  { value: 'approved',  label: 'Approved' },
                  { value: 'rejected',  label: 'Rejected' },
                  { value: 'cancelled', label: 'Cancelled' },
                ].map(({ value, label }) => (
                  <button key={value} onClick={() => setStatusFilter(value)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                      statusFilter === value
                        ? 'bg-[#3525cd] text-white'
                        : 'bg-[#f0f3ff] text-[#464555] hover:bg-[#e7eefe]'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Right-aligned: type filter + sort */}
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                {/* Leave type filter */}
                {usedTypes.length > 1 && (
                  <div className="relative">
                    <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                      className="text-xs font-semibold bg-[#f0f3ff] text-[#464555] border border-[#c7c4d8] rounded-lg px-3 py-1.5 pr-7 appearance-none cursor-pointer focus:outline-none">
                      <option value="all">All Types</option>
                      <option value="wfh">WFH</option>
                      {ALL_LEAVE_TYPES.filter(t => usedTypes.includes(t.value)).map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  </div>
                )}

                {/* Sort dropdown */}
                <div className="relative">
                  <SortDesc size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                    className="text-xs font-semibold bg-[#f0f3ff] text-[#464555] border border-[#c7c4d8] rounded-lg pl-7 pr-7 py-1.5 appearance-none cursor-pointer focus:outline-none">
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="leave_date">By Leave Date</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                </div>
              </div>
            </div>

            {/* Row 2: Date range filters */}
            <div className="flex flex-wrap items-center gap-2">
              <CalendarRange size={11} className="text-[#777587]" />
              <span className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest">Date Range</span>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="text-xs bg-[#f0f3ff] text-[#464555] border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#3525cd] cursor-pointer"
                placeholder="From"
              />
              <span className="text-[#c7c4d8] text-xs">→</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={e => setDateTo(e.target.value)}
                className="text-xs bg-[#f0f3ff] text-[#464555] border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-[#3525cd] cursor-pointer"
                placeholder="To"
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  className="text-[0.65rem] font-bold text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-2 py-1 rounded-lg transition-colors flex items-center gap-1">
                  <X size={9} /> Clear dates
                </button>
              )}
            </div>
          </div>

          {/* Request list */}
          {isLoading ? (
            <div className="flex justify-center py-16"><div className="spinner w-7 h-7" /></div>
          ) : sortedLeaves.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-[#c7c4d8]">
              <div className="w-16 h-16 rounded-2xl bg-[#f0f3ff] flex items-center justify-center text-3xl mx-auto mb-3">🗓️</div>
              {!hasActiveFilters ? (
                <>
                  <p className="text-[#464555] font-semibold">No leave requests yet</p>
                  <p className="text-[#777587] text-sm mt-1 max-w-xs mx-auto">
                    You haven't applied for any leave yet. Click <strong>Apply Request</strong> to submit your first leave application.
                  </p>
                  <button onClick={() => setApplyOpen(true)} className="mt-4 text-sm font-bold text-white px-5 py-2.5 rounded-xl shadow-sm"
                    style={{ background: 'linear-gradient(135deg, #3525cd, #4f46e5)' }}>
                    + Apply Request
                  </button>
                </>
              ) : (
                <>
                  <p className="text-[#464555] font-semibold">No matching requests</p>
                  <p className="text-[#777587] text-sm mt-1 max-w-xs mx-auto">
                    No leave requests match the current filters. Try adjusting the status, type, or date range.
                  </p>
                  <button onClick={clearAllFilters}
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-white px-5 py-2.5 rounded-xl shadow-sm transition-all"
                    style={{ background: 'linear-gradient(135deg, #3525cd, #4f46e5)' }}>
                    <RotateCcw size={13} /> Clear All Filters
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {sortedLeaves.map(l => {
                const s   = STATUS_STYLES[l.status] || STATUS_STYLES.pending;
                const wfh = isWFHRecord(l);
                const wdays = wfh ? 1 : (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date));
                const showTimeline = l.status !== 'pending';
                return (
                  <div key={l.id} id={`myleave-${l.id}`}
                    className={`bg-white rounded-xl border border-[#c7c4d8] p-4 shadow-card hover:shadow-card-hover transition-all
                      ${l.status === 'pending'      ? 'border-l-4 border-l-amber-400'   : ''}
                      ${l.status === 'pending_dept' ? 'border-l-4 border-l-blue-400'    : ''}
                      ${l.status === 'pending_root' ? 'border-l-4 border-l-violet-400'  : ''}
                      ${l.status === 'approved'     ? 'border-l-4 border-l-emerald-400' : ''}
                      ${l.status === 'rejected'     ? 'border-l-4 border-l-rose-400'    : ''}
                      ${l.status === 'cancelled'    ? 'border-l-4 border-l-slate-300'   : ''}
                      ${highlightActive && highlightId != null && String(l.id) === String(highlightId) ? 'bg-[#f0f3ff] ring-4 ring-[#3525cd] ring-offset-2 border-[#3525cd]/40' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        {/* Top row: badges */}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {wfh ? (
                            <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                              <Home size={10} /> WFH
                            </span>
                          ) : (
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-bold capitalize ${LEAVE_TYPE_COLORS[l.leave_type] || LEAVE_TYPE_COLORS.other}`}>
                              {leaveLabel(l.leave_type)}
                            </span>
                          )}
                          {!wfh && l.leave_time === 'half' && (
                            <span className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-2.5 py-0.5 rounded-full font-medium">
                              Half Day
                            </span>
                          )}
                          <span className={`flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border font-bold ${s.bg} ${s.text} ${s.border}`}>
                            {s.icon} {STATUS_LABELS[l.status] || l.status}
                          </span>
                        </div>
                        {/* Dates + days */}
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-sm font-semibold text-[#151c27]">
                            {l.start_date === l.end_date ? l.start_date : `${l.start_date} → ${l.end_date}`}
                          </p>
                          <span className="text-[0.68rem] font-bold px-2 py-0.5 rounded bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">
                            {wfh ? 'WFH Day' : `${wdays} day${wdays !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                        {/* Applied date */}
                        <p className="text-[0.65rem] text-[#9ca3af]">Applied {l.created_at ? new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}</p>

                        {/* Approval timeline — shown for 2-step workflow leaves */}
                        <LeaveTimeline leave={l} />

                        {l.reason && <p className="text-xs text-[#777587] mt-1.5 italic">"{l.reason}"</p>}
                        {/* Approved by */}
                        {(l.status === 'approved' || l.status === 'rejected') && l.approver_name && (
                          <p className="text-[0.65rem] text-[#777587] mt-1">
                            {l.status === 'approved' ? '✓ Approved' : '✗ Rejected'} by <span className="font-semibold text-[#464555]">{l.approver_name}</span>
                            {l.approved_at && <span className="ml-1">{new Date(l.approved_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>}
                          </p>
                        )}
                        {/* Remarks */}
                        {l.remarks && (
                          <div className="mt-2 px-3 py-2 rounded-lg bg-[#f9f9ff] border border-[#e7eefe]">
                            <p className="text-[0.65rem] font-bold text-[#777587] uppercase tracking-wide mb-0.5">Remarks</p>
                            <p className="text-xs text-[#464555] italic">"{l.remarks}"</p>
                          </div>
                        )}
                      </div>
                      {/* ENH_LEAVE_004: Cancel button for any pending status */}
                      {['pending', 'pending_dept', 'pending_root', 'pending_approval'].includes(l.status) && (
                        <button onClick={() => setDelTarget(l)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-[#c7c4d8] hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all shrink-0">
                          <Trash2 size={11} />Withdraw
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-4 self-start">

          {/* Upcoming Leaves */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
            <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center gap-2">
              <CalendarRange size={14} className="text-[#3525cd]" />
              <span className="font-black text-[#151c27] text-sm">Upcoming Leaves</span>
            </div>
            <div className="p-4">
              {upcomingLeaves.length === 0 ? (
                <p className="text-xs text-[#9ca3af] text-center py-3">No upcoming leaves</p>
              ) : (
                <div className="space-y-2">
                  {upcomingLeaves.map(l => {
                    const wdays = l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date);
                    const isSingle = l.start_date === l.end_date;
                    return (
                      <div key={l.id} className="flex items-center gap-2.5 py-2 border-b border-[#f0f3ff] last:border-0">
                        <span className={`text-[0.65rem] px-2 py-0.5 rounded-full border font-bold capitalize flex-shrink-0 ${LEAVE_TYPE_COLORS[l.leave_type] || LEAVE_TYPE_COLORS.other}`}>
                          {leaveLabel(l.leave_type)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[#151c27] truncate">
                            {isSingle ? fmtDateShort(l.start_date) : `${fmtDateShort(l.start_date)} → ${fmtDateShort(l.end_date)}`}
                          </p>
                          <p className="text-[0.6rem] text-[#9ca3af]">{wdays} day{wdays !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Leave Balance */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
            <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center gap-2">
              <BookOpen size={14} className="text-[#3525cd]" />
              <span className="font-black text-[#151c27] text-sm">Leave Balance</span>
            </div>
            <div className="p-4 space-y-0">
              {(() => {
                // BUG_14: Support both { balances: [...] } and direct array API shapes
                const rawBalances = leaveBalance?.balances ?? (Array.isArray(leaveBalance) ? leaveBalance : []);
                const balanceItems = rawBalances.length > 0
                  ? rawBalances.map(b => ({
                      leave_type: b.leave_type,
                      label: b.label || b.leave_type,
                      total: b.allocated ?? b.total ?? 0,
                      used: b.used ?? 0,
                      pending: b.pending ?? leaves
                        .filter(l => l.leave_type === b.leave_type && ['pending','pending_dept','pending_root','pending_approval'].includes(l.status) && !isWFHRecord(l))
                        .reduce((sum, l) => sum + (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date)), 0),
                      carry_forward: b.carry_forward,
                    }))
                  : activePolicies.map(p => {
                      const used = leaves
                        .filter(l => l.leave_type === p.leave_type && l.status === 'approved' && !isWFHRecord(l))
                        .reduce((sum, l) => sum + (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date)), 0);
                      const pending = leaves
                        .filter(l => l.leave_type === p.leave_type && ['pending','pending_dept','pending_root','pending_approval'].includes(l.status) && !isWFHRecord(l))
                        .reduce((sum, l) => sum + (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date)), 0);
                      return { leave_type: p.leave_type, label: p.label, total: p.annual_quota, used, pending, carry_forward: p.carry_forward };
                    });

                if (balanceItems.length === 0) {
                  return <p className="text-xs text-[#777587] text-center py-4">No leave policies configured for your account</p>;
                }

                return balanceItems.map(item => {
                  const remaining = Math.max(0, item.total - item.used - (item.pending || 0));
                  const pct = item.total > 0 ? Math.min(100, Math.round((item.used / item.total) * 100)) : 0;
                  return (
                    <div key={item.leave_type} className="py-3 border-b border-[#f0f3ff] last:border-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-[#151c27]">{item.label}</span>
                        <span className="text-xs font-black text-[#3525cd]">{item.used} <span className="font-normal text-[#777587]">/ {item.total}</span></span>
                      </div>
                      <div className="h-1.5 bg-[#f0f3ff] rounded-full overflow-hidden mb-1">
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: pct >= 80 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#10b981' }} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[0.65rem] text-[#9ca3af]">{remaining} day{remaining !== 1 ? 's' : ''} available</span>
                        {item.pending > 0 && <span className="text-[0.65rem] font-bold text-amber-600">{item.pending}d pending</span>}
                      </div>
                      {item.carry_forward && (
                        <span className="text-[0.6rem] text-emerald-600 font-semibold">↗ Carry forward enabled</span>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* WFH Summary */}
          {(() => {
            const countDays = (list) => list.reduce((sum, l) => {
              const s = new Date(l.start_date + 'T12:00:00');
              const e = new Date(l.end_date   + 'T12:00:00');
              return sum + Math.round((e - s) / 86400000) + 1;
            }, 0);
            const wfhLeaves   = leaves.filter(isWFHRecord);
            const wfhApproved = wfhLeaves.filter(l => l.status === 'approved');
            const wfhPending  = wfhLeaves.filter(l => l.status === 'pending');
            const currentMonth = new Date().toISOString().slice(0, 7);
            const wfhThisMonth = wfhApproved.filter(l => l.start_date.startsWith(currentMonth));
            return (
              <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm">
                <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center gap-2">
                  <Home size={14} className="text-blue-600" />
                  <span className="font-black text-[#151c27] text-sm">WFH Summary</span>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { label: 'Total Approved', value: `${countDays(wfhApproved)} days`, color: 'text-blue-600' },
                    { label: 'This Month',     value: `${countDays(wfhThisMonth)} days`, color: 'text-blue-600' },
                    { label: 'Pending',        value: wfhPending.length > 0 ? `${wfhPending.length} request${wfhPending.length > 1 ? 's' : ''}` : 'None', color: wfhPending.length > 0 ? 'text-amber-600' : 'text-[#9ca3af]' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center justify-between py-2 border-b border-[#f0f3ff] last:border-0">
                      <span className="text-xs text-[#464555] font-medium">{label}</span>
                      <span className={`text-sm font-black ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Apply panel */}
      <LeaveApplyPanel
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        onSubmit={(payload) => apply.mutate(payload)}
        loading={apply.isPending}
        policies={policies}
        leaves={leaves}
      />

      {/* Cancel modal */}
      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Cancel Request"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setDelTarget(null)} className="btn btn-outline btn-sm">No, Keep</button>
            <button onClick={() => del.mutate(delTarget.id)} disabled={del.isPending} className="btn btn-danger btn-sm">
              {del.isPending ? 'Cancelling…' : 'Yes, Cancel Request'}
            </button>
          </div>
        }>
        {delTarget && (
          isWFHRecord(delTarget)
            ? <p className="text-[#464555] text-sm">Cancel your WFH request for <strong>{delTarget.start_date}</strong>?</p>
            : <p className="text-[#464555] text-sm">Cancel your <strong className="capitalize">{leaveLabel(delTarget.leave_type)}</strong> leave request from {delTarget.start_date} to {delTarget.end_date}?</p>
        )}
      </Modal>
    </div>
  );
}
