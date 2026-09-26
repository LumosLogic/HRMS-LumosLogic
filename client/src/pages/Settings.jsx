import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Clock, Info, Palette, Check, RefreshCw, Mail, Plus, Trash2,
  ToggleLeft, ToggleRight, ShieldCheck, Building2, Briefcase,
  CalendarDays, Bell, BellOff, Wrench, Settings2, ChevronRight,
  ChevronDown, MailCheck, Star, BarChart3, AlarmClock, SlidersHorizontal,
  Lock, MessageSquare, Calendar, GitBranch, Sparkles, Search,
  Eye, EyeOff, Save, CheckCircle2,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { RoleBadge } from '@/components/ui/Badge';
import { usePushNotification } from '@/hooks/usePushNotification';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Parse shift days_of_week (JSON array, comma-string, or plain array) → number[]
function parseShiftWorkDays(daysOfWeek) {
  if (!daysOfWeek && daysOfWeek !== 0) return [1, 2, 3, 4, 5];
  if (Array.isArray(daysOfWeek)) return daysOfWeek.map(Number);
  try {
    const parsed = JSON.parse(daysOfWeek);
    if (Array.isArray(parsed)) return parsed.map(Number);
  } catch { /* not JSON */ }
  return String(daysOfWeek).split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
}

// Shift selector used in both Work Schedule and Attendance Rules panels
function ShiftSelector({ shifts, selectedId, onChange, isAdmin }) {
  return (
    <div className="mb-5 p-3.5 bg-[#f0f3ff] border border-[#dde1f0] rounded-xl">
      <label className="form-label !mb-1 text-xs font-bold text-[#464555] uppercase tracking-wide">
        Configure for Shift
      </label>
      <select
        className="form-control text-sm"
        value={selectedId ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        disabled={!isAdmin}
      >
        <option value="">Organization Default (no shift)</option>
        {shifts.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <p className="text-[0.68rem] text-[#777587] mt-1.5">
        {selectedId == null
          ? 'Applies to employees with no shift assignment.'
          : 'Applies to employees assigned to this shift.'}
      </p>
    </div>
  );
}

function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = (t || '').split(':').map(Number);
  return h * 60 + m;
}

// ─── Org settings helpers ─────────────────────────────────────────────────────
const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;

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
        <input type={show ? 'text' : 'password'} className="form-control pr-10"
          value={value} onChange={onChange} placeholder={placeholder || ''} autoComplete="new-password" />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
    </Field>
  );
}

// ─── Shared toggle ────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none flex-shrink-0 ${checked ? 'bg-[#3525cd]' : 'bg-[#d1d5db]'}`}>
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ─── Panel wrapper with breadcrumb ────────────────────────────────────────────
function PanelWrap({ group, label, icon: Icon, accentColor = '#3525cd', children }) {
  return (
    <div className="h-full flex flex-col">
      {/* Panel header */}
      <div className="px-4 md:px-8 pt-4 md:pt-7 pb-4 md:pb-5 border-b border-[#f0f3ff]">
        <p className="text-[0.65rem] font-bold uppercase tracking-widest text-[#a09fb5] mb-1">{group}</p>
        <h2 className="text-xl font-black text-[#151c27] flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl" style={{ background: accentColor + '15' }}>
            <Icon size={17} style={{ color: accentColor }} />
          </span>
          {label}
        </h2>
      </div>
      {/* Panel body */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 md:py-6">{children}</div>
    </div>
  );
}

// ─── Coming Soon placeholder ──────────────────────────────────────────────────
function ComingSoonPanel({ group, label, icon: Icon, description }) {
  return (
    <PanelWrap group={group} label={label} icon={Icon} accentColor="#6366f1">
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#f0f3ff] flex items-center justify-center mb-4">
          <Sparkles size={28} className="text-[#3525cd] opacity-40" />
        </div>
        <p className="font-bold text-[#151c27] text-base mb-2">Coming Soon</p>
        <p className="text-sm text-[#777587] max-w-xs leading-relaxed">{description || 'This feature is under development and will be available in a future update.'}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">
          <Sparkles size={10} /> In Development
        </span>
      </div>
    </PanelWrap>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PANELS
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Work Schedule (shift-aware) ────────────────────────────────────────────
function WorkSchedulePanel({ schedule, isAdmin, onSaved }) {
  const { isRootAdmin } = useAuth();
  const toast = useToast();
  const qc    = useQueryClient();

  const [selectedShiftId, setSelectedShiftId] = useState(null); // null = org default
  const [shiftConfig,     setShiftConfig]      = useState(null);
  const [shiftLoading,    setShiftLoading]      = useState(false);
  const [errs,            setErrs]             = useState({});

  // Fetch all shifts for the selector
  const { data: shiftsData } = useQuery({
    queryKey: ['shifts-list'],
    queryFn:  () => apiGet('/shifts'),
    staleTime: 60 * 1000,
  });
  const shifts = shiftsData?.shifts || (Array.isArray(shiftsData) ? shiftsData : []);

  // When shift selector changes, load that shift's config
  useEffect(() => {
    if (selectedShiftId == null) { setShiftConfig(null); return; }
    setShiftLoading(true);
    apiGet(`/settings/shift/${selectedShiftId}`)
      .then(d => setShiftConfig(d.config || null))
      .catch(() => setShiftConfig(null))
      .finally(() => setShiftLoading(false));
  }, [selectedShiftId]);

  // Effective source: shift config when a shift is selected, else org-level schedule
  const effective = shiftConfig || schedule;

  const [form, setForm] = useState({
    start_time: '09:00',
    end_time:   '18:00',
    work_days:  [1, 2, 3, 4, 5],
  });

  // Re-populate form whenever the effective source changes
  useEffect(() => {
    if (!effective) return;
    setForm({
      start_time: effective.start_time || '09:00',
      end_time:   effective.end_time   || '18:00',
      work_days:  parseShiftWorkDays(effective.work_days || effective.days_of_week || '1,2,3,4,5'),
    });
    setErrs({});
  }, [effective?.shift_id, effective?.start_time, effective?.end_time, effective?.work_days]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function validate() {
    const e = {};
    const s = timeToMinutes(form.start_time), en = timeToMinutes(form.end_time);
    if (!form.start_time) e.start_time = 'Required.';
    if (!form.end_time)   e.end_time   = 'Required.';
    if (s !== null && en !== null && en <= s) e.end_time = 'End must be after start.';
    if (form.work_days.length === 0) e.work_days = 'Select at least one working day.';
    setErrs(e); return Object.keys(e).length === 0;
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        start_time: form.start_time,
        end_time:   form.end_time,
        work_days:  form.work_days.join(','),
      };
      if (selectedShiftId == null) {
        // Org-level: pass-through attendance rules so they aren't wiped
        return apiPut('/settings', {
          ...payload,
          late_threshold:        schedule?.late_threshold,
          early_exit_threshold:  schedule?.early_exit_threshold,
          half_day_hours:        schedule?.half_day_hours,
          full_day_hours:        schedule?.full_day_hours,
          max_early_leave_count: schedule?.max_early_leave_count,
        });
      }
      // Shift-specific: only update work schedule fields on the shift
      return apiPut(`/settings/shift/${selectedShiftId}`, payload);
    },
    onSuccess: () => {
      toast(selectedShiftId == null ? 'Work schedule saved!' : `Work schedule saved for ${shiftConfig?.shift_name || 'shift'}!`, 'success');
      if (selectedShiftId == null) onSaved?.();
      else qc.invalidateQueries({ queryKey: ['shifts-list'] });
    },
    onError: err => toast(err.message, 'error'),
  });

  const toggleDay = i => setForm(f => ({
    ...f,
    work_days: f.work_days.includes(i)
      ? f.work_days.filter(d => d !== i)
      : [...f.work_days, i].sort((a, b) => a - b),
  }));

  return (
    <PanelWrap group="Attendance & Work Rules" label="Work Schedule" icon={Calendar} accentColor="#3525cd">
      <div className="max-w-2xl space-y-6">

        <ShiftSelector shifts={shifts} selectedId={selectedShiftId} onChange={id => setSelectedShiftId(id)} isAdmin={isAdmin} />

        {shiftLoading ? (
          <div className="flex justify-center py-8"><span className="spinner w-5 h-5" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-5">
              <div>
                <label className="form-label">Work Start Time</label>
                <input type="time" className={`form-control ${errs.start_time ? 'border-rose-400' : ''}`}
                  value={form.start_time} disabled={!isAdmin} onChange={e => set('start_time', e.target.value)} />
                {errs.start_time ? <p className="text-xs text-rose-500 mt-1">{errs.start_time}</p> : <p className="form-hint">Official start of the working day</p>}
              </div>
              <div>
                <label className="form-label">Work End Time</label>
                <input type="time" className={`form-control ${errs.end_time ? 'border-rose-400' : ''}`}
                  value={form.end_time} disabled={!isAdmin} onChange={e => set('end_time', e.target.value)} />
                {errs.end_time ? <p className="text-xs text-rose-500 mt-1">{errs.end_time}</p> : <p className="form-hint">Official end of the working day</p>}
              </div>
            </div>

            {/* EHN_SETTING_005: Live preview of total scheduled work hours */}
            {form.start_time && form.end_time && (() => {
              const [sh, sm] = form.start_time.split(':').map(Number);
              const [eh, em] = form.end_time.split(':').map(Number);
              const startMin = sh * 60 + sm, endMin = eh * 60 + em;
              const totalMin = endMin > startMin ? endMin - startMin : (endMin + 1440) - startMin;
              const hrs = Math.floor(totalMin / 60), mins = totalMin % 60;
              const halfDayMin = Math.floor(totalMin / 2);
              return (
                <div className="p-3 bg-[#f0f3ff] border border-[#dde1f0] rounded-xl flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5"><Clock size={13} className="text-[#3525cd]" /><span className="font-bold text-[#151c27]">Total: {hrs}h{mins > 0 ? ` ${mins}m` : ''} / day</span></div>
                  <div className="text-[#777587]">Half Day threshold: <strong>{Math.floor(halfDayMin / 60)}h{halfDayMin % 60 > 0 ? ` ${halfDayMin % 60}m` : ''}</strong></div>
                  <div className="text-[#777587]">Weekly: <strong>{(hrs + mins/60) * form.work_days.length}h</strong> ({form.work_days.length} days)</div>
                </div>
              );
            })()}

            <div>
              <label className="form-label">Working Days</label>
              <div className="flex gap-2 flex-wrap mt-2">
                {DAY_LABELS.map((d, i) => (
                  <label key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-semibold select-none transition-all ${form.work_days.includes(i) ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/50'} ${isAdmin ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
                    <input type="checkbox" className="sr-only" checked={form.work_days.includes(i)} disabled={!isAdmin} onChange={() => toggleDay(i)} />
                    {d}
                  </label>
                ))}
              </div>
              {errs.work_days && <p className="text-xs text-rose-500 mt-2">{errs.work_days}</p>}
            </div>

            {isAdmin && (
              <div className="pt-2 flex items-center gap-3 flex-wrap">
                <button className="btn btn-primary" onClick={() => { if (validate()) mutation.mutate(); }} disabled={mutation.isPending}>
                  {mutation.isPending ? <><span className="spinner w-4 h-4" /> Saving…</> : 'Save Work Schedule'}
                </button>
                {/* EHN_SETTING_004: Link to Holiday Calendar */}
                <a href={isRootAdmin ? '/root/holidays' : '/holidays'} className="btn btn-outline flex items-center gap-1.5 text-xs">
                  <CalendarDays size={13} />View Holiday Calendar
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </PanelWrap>
  );
}

// ── 2. Attendance Rules (shift-aware) ────────────────────────────────────────
function AttendanceRulesPanel({ schedule, isAdmin, onSaved }) {
  const toast = useToast();
  const qc    = useQueryClient();

  const [selectedShiftId, setSelectedShiftId] = useState(null);
  const [shiftConfig,     setShiftConfig]      = useState(null);
  const [shiftLoading,    setShiftLoading]      = useState(false);
  const [errs,            setErrs]             = useState({});

  const { data: shiftsData } = useQuery({
    queryKey: ['shifts-list'],
    queryFn:  () => apiGet('/shifts'),
    staleTime: 60 * 1000,
  });
  const shifts = shiftsData?.shifts || (Array.isArray(shiftsData) ? shiftsData : []);

  useEffect(() => {
    if (selectedShiftId == null) { setShiftConfig(null); return; }
    setShiftLoading(true);
    apiGet(`/settings/shift/${selectedShiftId}`)
      .then(d => setShiftConfig(d.config || null))
      .catch(() => setShiftConfig(null))
      .finally(() => setShiftLoading(false));
  }, [selectedShiftId]);

  // Effective source of truth
  const effective = shiftConfig || schedule;

  const [form, setForm] = useState({
    late_threshold:               '',
    early_exit_threshold:         '',
    half_day_hours:               4,
    full_day_hours:               8,
    max_early_leave_count:        3,
    late_entry_threshold_enabled: true,
    early_exit_threshold_enabled: true,
  });

  useEffect(() => {
    if (!effective) return;
    setForm({
      late_threshold:               effective.late_threshold        || '',
      early_exit_threshold:         effective.early_exit_threshold  || '',
      half_day_hours:               effective.half_day_hours        ?? 4,
      full_day_hours:               effective.full_day_hours        ?? 8,
      max_early_leave_count:        effective.max_early_leave_count ?? 3,
      late_entry_threshold_enabled: effective.late_entry_threshold_enabled  ?? true,
      early_exit_threshold_enabled: effective.early_exit_threshold_enabled  ?? true,
    });
    setErrs({});
  }, [effective?.shift_id, effective?.late_threshold, effective?.half_day_hours, effective?.late_entry_threshold_enabled, effective?.early_exit_threshold_enabled]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function validate() {
    const e = {};
    // Use the effective shift's start/end for threshold validation
    const startMins = timeToMinutes(effective?.start_time);
    const endMins   = timeToMinutes(effective?.end_time);
    const lateMins  = timeToMinutes(form.late_threshold);
    const earlyMins = timeToMinutes(form.early_exit_threshold);
    const half      = parseFloat(form.half_day_hours);
    const full      = parseFloat(form.full_day_hours);
    const maxELC    = parseInt(form.max_early_leave_count, 10);

    if (form.late_entry_threshold_enabled && lateMins !== null && startMins !== null && endMins !== null && (lateMins <= startMins || lateMins >= endMins))
      e.late_threshold = 'Must be between Work Start and End time.';
    if (form.early_exit_threshold_enabled && earlyMins !== null && lateMins !== null && endMins !== null && (earlyMins <= lateMins || earlyMins >= endMins))
      e.early_exit_threshold = 'Must be between Late Threshold and End time.';
    if (isNaN(half) || half <= 0) e.half_day_hours = 'Must be a positive number.';
    else if (startMins !== null && endMins !== null) {
      const total = (endMins - startMins) / 60;
      if (half >= total) e.half_day_hours = `Must be less than total work hours (${total.toFixed(1)} hrs).`;
    }
    if (isNaN(full) || full <= 0) e.full_day_hours = 'Must be a positive number.';
    else if (!isNaN(half) && full <= half) e.full_day_hours = `Must be greater than Half Day (${half} hrs).`;
    else if (startMins !== null && endMins !== null) {
      const total = (endMins - startMins) / 60;
      if (full > total) e.full_day_hours = `Cannot exceed total work hours (${total.toFixed(1)} hrs).`;
    }
    if (isNaN(maxELC) || maxELC < 1) e.max_early_leave_count = 'Must be at least 1.';
    setErrs(e); return Object.keys(e).length === 0;
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        late_threshold:               form.late_threshold || null,
        early_exit_threshold:         form.early_exit_threshold || null,
        half_day_hours:               parseFloat(form.half_day_hours),
        full_day_hours:               parseFloat(form.full_day_hours),
        max_early_leave_count:        parseInt(form.max_early_leave_count, 10),
        late_entry_threshold_enabled: form.late_entry_threshold_enabled,
        early_exit_threshold_enabled: form.early_exit_threshold_enabled,
      };
      if (selectedShiftId == null) {
        // Org-level: pass-through work schedule fields so they aren't wiped
        return apiPut('/settings', {
          ...payload,
          start_time: schedule?.start_time,
          end_time:   schedule?.end_time,
          work_days:  schedule?.work_days,
        });
      }
      return apiPut(`/settings/shift/${selectedShiftId}`, payload);
    },
    onSuccess: () => {
      toast(selectedShiftId == null ? 'Attendance rules saved!' : `Attendance rules saved for ${shiftConfig?.shift_name || 'shift'}!`, 'success');
      if (selectedShiftId == null) onSaved?.();
      else qc.invalidateQueries({ queryKey: ['shifts-list'] });
    },
    onError: err => toast(err.message, 'error'),
  });

  return (
    <PanelWrap group="Attendance & Work Rules" label="Attendance Rules" icon={SlidersHorizontal} accentColor="#6366f1">
      <div className="max-w-2xl space-y-6">

        <ShiftSelector shifts={shifts} selectedId={selectedShiftId} onChange={id => setSelectedShiftId(id)} isAdmin={isAdmin} />

        {shiftLoading ? (
          <div className="flex justify-center py-8"><span className="spinner w-5 h-5" /></div>
        ) : (
          <>
            <div>
              <p className="text-xs font-bold text-[#464555] uppercase tracking-wide mb-3">Entry &amp; Exit Thresholds</p>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <label className="form-label flex items-center justify-between">
                    <span>Late Entry Threshold</span>
                    {isAdmin && (
                      <button type="button"
                        title={form.late_entry_threshold_enabled ? 'Disable Late Entry threshold' : 'Enable Late Entry threshold'}
                        onClick={() => set('late_entry_threshold_enabled', !form.late_entry_threshold_enabled)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${form.late_entry_threshold_enabled ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.late_entry_threshold_enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                      </button>
                    )}
                  </label>
                  <input type="time"
                    className={`form-control ${errs.late_threshold ? 'border-rose-400' : ''} ${!form.late_entry_threshold_enabled ? 'opacity-40' : ''}`}
                    value={form.late_threshold}
                    disabled={!isAdmin || !form.late_entry_threshold_enabled}
                    onChange={e => set('late_threshold', e.target.value)} />
                  {errs.late_threshold
                    ? <p className="text-xs text-rose-500 mt-1">{errs.late_threshold}</p>
                    : <p className="form-hint">{form.late_entry_threshold_enabled ? 'Check-in after this = Late' : 'Disabled — late detection off'}</p>}
                </div>
                <div>
                  <label className="form-label flex items-center justify-between">
                    <span>Early Exit Threshold</span>
                    {isAdmin && (
                      <button type="button"
                        title={form.early_exit_threshold_enabled ? 'Disable Early Exit threshold' : 'Enable Early Exit threshold'}
                        onClick={() => set('early_exit_threshold_enabled', !form.early_exit_threshold_enabled)}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${form.early_exit_threshold_enabled ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}>
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${form.early_exit_threshold_enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                      </button>
                    )}
                  </label>
                  <input type="time"
                    className={`form-control ${errs.early_exit_threshold ? 'border-rose-400' : ''} ${!form.early_exit_threshold_enabled ? 'opacity-40' : ''}`}
                    value={form.early_exit_threshold}
                    disabled={!isAdmin || !form.early_exit_threshold_enabled}
                    onChange={e => set('early_exit_threshold', e.target.value)} />
                  {errs.early_exit_threshold
                    ? <p className="text-xs text-rose-500 mt-1">{errs.early_exit_threshold}</p>
                    : <p className="form-hint">{form.early_exit_threshold_enabled ? 'Check-out before this = Early Exit' : 'Disabled — early exit detection off'}</p>}
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-[#464555] uppercase tracking-wide mb-3">Hours Classification</p>
              <div className="grid grid-cols-3 gap-5">
                <div>
                  <label className="form-label">Half Day (hrs)</label>
                  <input type="number" step="0.5" min="0.5" className={`form-control ${errs.half_day_hours ? 'border-rose-400' : ''}`}
                    value={form.half_day_hours} disabled={!isAdmin}
                    onChange={e => set('half_day_hours', e.target.value)} onWheel={e => e.target.blur()} />
                  {errs.half_day_hours
                    ? <p className="text-xs text-rose-500 mt-1">{errs.half_day_hours}</p>
                    : <p className="form-hint">Below this = Half Day</p>}
                </div>
                <div>
                  <label className="form-label">Full Day (hrs)</label>
                  <input type="number" step="0.5" min="0.5" className={`form-control ${errs.full_day_hours ? 'border-rose-400' : ''}`}
                    value={form.full_day_hours} disabled={!isAdmin}
                    onChange={e => set('full_day_hours', e.target.value)} onWheel={e => e.target.blur()} />
                  {errs.full_day_hours
                    ? <p className="text-xs text-rose-500 mt-1">{errs.full_day_hours}</p>
                    : <p className="form-hint">At or above this = Full Day</p>}
                </div>
                <div>
                  <label className="form-label">Max Early Leave</label>
                  <input type="number" step="1" min="1" className={`form-control ${errs.max_early_leave_count ? 'border-rose-400' : ''}`}
                    value={form.max_early_leave_count} disabled={!isAdmin}
                    onChange={e => set('max_early_leave_count', e.target.value)} onWheel={e => e.target.blur()} />
                  {errs.max_early_leave_count
                    ? <p className="text-xs text-rose-500 mt-1">{errs.max_early_leave_count}</p>
                    : <p className="form-hint">Excess per period → LOP</p>}
                </div>
              </div>
            </div>

            {selectedShiftId != null && effective?.start_time && (
              <div className="flex items-center gap-2 text-xs text-[#777587] bg-[#f5f4ff] border border-[#dde1f0] rounded-lg px-3 py-2">
                <Info size={13} className="text-[#3525cd] flex-shrink-0" />
                Validating thresholds against <strong className="text-[#464555]">{effective.shift_name}</strong>: {effective.start_time} – {effective.end_time}
              </div>
            )}

            {isAdmin && (
              <div className="pt-2">
                <button className="btn btn-primary" onClick={() => { if (validate()) mutation.mutate(); }} disabled={mutation.isPending}>
                  {mutation.isPending ? <><span className="spinner w-4 h-4" /> Saving…</> : 'Save Attendance Rules'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </PanelWrap>
  );
}

// ── 3. Status Legend ──────────────────────────────────────────────────────────
const STATUS_ITEMS = [
  { label: 'Present',     color: '#10B981', bg: '#ecfdf5', desc: 'Work hours ≥ Full Day Hours' },
  { label: 'Early Leave', color: '#F97316', bg: '#fff7ed', desc: 'Between Half Day & Full Day Hours' },
  { label: 'Half Day',    color: '#3B82F6', bg: '#eff6ff', desc: 'Below Half Day Threshold' },
  { label: 'On Leave',    color: '#F59E0B', bg: '#fffbeb', desc: 'Approved leave applied' },
  { label: 'WFH',         color: '#06B6D4', bg: '#ecfeff', desc: 'Work from home approved' },
  { label: 'Late Entry',  color: '#6366F1', bg: '#eef2ff', desc: 'Check-in after Late Entry Threshold' },
  { label: 'Early Exit',  color: '#8B5CF6', bg: '#f5f3ff', desc: 'Check-out before Early Exit Threshold' },
  { label: 'Absent',      color: '#EF4444', bg: '#fef2f2', desc: 'Not present and no leave applied' },
];

function StatusLegendPanel() {
  return (
    <PanelWrap group="Attendance & Work Rules" label="Status Legend" icon={Palette} accentColor="#8b5cf6">
      <div className="max-w-2xl">
        <p className="text-sm text-[#777587] mb-6">Visual status indicators used across the attendance calendar, reports, and dashboards.</p>
        <div className="grid grid-cols-1 gap-3">
          {STATUS_ITEMS.map(item => (
            <div key={item.label} className="flex items-center gap-4 p-3.5 rounded-xl border border-[#e7eefe] bg-white hover:shadow-sm transition-shadow">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: item.bg }}>
                <div className="w-3.5 h-3.5 rounded-full" style={{ background: item.color }} />
              </div>
              <div>
                <p className="font-bold text-sm text-[#151c27]">{item.label}</p>
                <p className="text-xs text-[#777587]">{item.desc}</p>
              </div>
              <span className="ml-auto text-[0.65rem] font-bold px-2 py-0.5 rounded-full border" style={{ color: item.color, background: item.bg, borderColor: item.color + '40' }}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </PanelWrap>
  );
}

// ── 4. Email Automation ───────────────────────────────────────────────────────
function EmailAutomationPanel({ schedule }) {
  const toast = useToast();
  const qc    = useQueryClient();

  const { data: emailSettings, isLoading } = useQuery({
    queryKey: ['email-automation-settings'],
    queryFn:  () => apiGet('/settings/email-automation'),
    retry: false,
  });

  const [form, setForm] = useState({
    late_email_enabled:         false,
    daily_summary_enabled:      false,
    daily_summary_time:         '18:30',
    appreciation_email_enabled: false,
  });

  useEffect(() => {
    if (emailSettings) setForm({
      late_email_enabled:         !!emailSettings.late_email_enabled,
      daily_summary_enabled:      !!emailSettings.daily_summary_enabled,
      daily_summary_time:         emailSettings.daily_summary_time?.slice(0, 5) || '18:30',
      appreciation_email_enabled: !!emailSettings.appreciation_email_enabled,
    });
  }, [emailSettings]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => apiPut('/settings/email-automation', {
      late_email_enabled:         form.late_email_enabled,
      daily_summary_enabled:      form.daily_summary_enabled,
      daily_summary_time:         form.daily_summary_time,
      appreciation_email_enabled: form.appreciation_email_enabled,
    }),
    onSuccess: () => { toast('Email automation saved!', 'success'); qc.invalidateQueries({ queryKey: ['email-automation-settings'] }); },
    onError:   err => toast(err.message, 'error'),
  });

  if (isLoading) return <div className="flex justify-center py-20"><span className="spinner w-6 h-6" /></div>;

  const automations = [
    {
      key:    'late_email_enabled',
      icon:   AlarmClock,
      color:  '#f97316',
      bg:     '#fff7ed',
      title:  'Late Check-in Email',
      desc:   'Notify employees when they check in after the late threshold',
      badge:  `Uses Late Entry Threshold: ${schedule?.late_threshold || '—'}`,
      badgeBg: '#fff7ed', badgeBorder: '#fed7aa', badgeText: '#9a3412',
      extra:  null,
    },
    {
      key:    'daily_summary_enabled',
      icon:   BarChart3,
      color:  '#10b981',
      bg:     '#ecfdf5',
      title:  'Daily Attendance Summary',
      desc:   'Send a complete attendance report to each employee at end of day',
      badge:  null,
      extra: (
        form.daily_summary_enabled ? (
          <div className="mt-3">
            <label className="form-label text-xs">Send Time</label>
            <input type="time" className="form-control text-sm" value={form.daily_summary_time} onChange={e => set('daily_summary_time', e.target.value)} />
          </div>
        ) : null
      ),
      content: ['Check-in & check-out times', 'Working hours & break time', 'Late duration & early exit', 'Attendance status'],
    },
    {
      key:    'appreciation_email_enabled',
      icon:   Star,
      color:  '#f59e0b',
      bg:     '#fffbeb',
      title:  'Work Appreciation Email',
      desc:   'Recognise employees who complete a full day of productive work',
      badge:  `Triggers when work hours ≥ Full Day Hours (${schedule?.full_day_hours ?? 8} hrs)`,
      badgeBg: '#fffbeb', badgeBorder: '#fde68a', badgeText: '#92400e',
      extra:  null,
    },
  ];

  return (
    <PanelWrap group="Attendance & Work Rules" label="Email Automation" icon={MailCheck} accentColor="#3525cd">
      <div className="max-w-3xl space-y-4">
        {automations.map(a => {
          const Icon    = a.icon;
          const enabled = form[a.key];
          return (
            <div key={a.key} className={`border rounded-xl p-5 transition-all ${enabled ? 'border-[#c7c4d8] bg-white shadow-sm' : 'border-[#e7eefe] bg-[#fafbff]'}`}>
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: a.bg }}>
                  <Icon size={18} style={{ color: a.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3 mb-1">
                    <p className="font-bold text-sm text-[#151c27]">{a.title}</p>
                    <Toggle checked={enabled} onChange={v => set(a.key, v)} />
                  </div>
                  <p className="text-xs text-[#777587] mb-3">{a.desc}</p>
                  {a.badge && (
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border mb-3"
                      style={{ background: a.badgeBg, borderColor: a.badgeBorder, color: a.badgeText }}>
                      <Info size={11} /> {a.badge}
                    </div>
                  )}
                  {a.extra}
                  {a.content && enabled && (
                    <div className="mt-3 grid grid-cols-2 gap-1.5">
                      {a.content.map(c => (
                        <p key={c} className="flex items-center gap-1.5 text-xs text-[#464555]">
                          <span className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
                            <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l2.5 2.5L10 3.5"/></svg>
                          </span>
                          {c}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        <div className="flex items-start gap-2.5 bg-[#f0f3ff] border border-[#dde1f0] rounded-xl px-4 py-3">
          <Info size={14} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#464555] leading-relaxed">
            All automations use the organization's SMTP configuration. Manage HR notification emails in <strong>Email Recipients</strong>.
          </p>
        </div>

        <div className="pt-2">
          <button className="btn btn-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? <><span className="spinner w-4 h-4" /> Saving…</> : 'Save Automation Settings'}
          </button>
        </div>
      </div>
    </PanelWrap>
  );
}

// ── 5. Leave Workflow ─────────────────────────────────────────────────────────
function LeaveWorkflowPanel() {
  const navigate  = useNavigate();
  const { pathname } = useLocation();
  const { data: workflow } = useQuery({
    queryKey: ['leave-workflow-config-summary'],
    queryFn:  () => apiGet('/leaves/workflow-config'),
    staleTime: 5 * 60 * 1000,
  });
  const targetPath  = pathname.startsWith('/root') ? '/root/leave-workflow' : '/leave-workflow';
  const levelCount  = workflow?.levels?.length || 0;

  return (
    <PanelWrap group="Leave & Attendance" label="Leave Approval Workflow" icon={GitBranch} accentColor="#10b981">
      <div className="max-w-xl">
        <p className="text-sm text-[#777587] mb-5">Configure the multi-level approval chain for leave requests.</p>

        <div className="bg-[#f0f3ff] border border-[#dde1f0] rounded-xl p-5 mb-5">
          <p className="text-sm font-bold text-[#151c27] mb-1">Current Configuration</p>
          <p className="text-sm text-[#777587]">
            <strong className="text-[#151c27]">{levelCount}</strong> approval level{levelCount !== 1 ? 's' : ''} configured
            {/* EHN_SETTING_010: Cap/guidance on approval levels */}
            {levelCount >= 4 && <span className="ml-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Recommended: max 5 levels</span>}
            {levelCount >= 5 && <span className="ml-1 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">Warning: long chains reduce completion rate</span>}
          </p>
          {workflow?.levels?.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#3525cd]/10 text-[#3525cd] border border-[#3525cd]/20">Employee</span>
              {workflow.levels.map((l, i) => (
                <React.Fragment key={i}>
                  <ChevronRight size={12} className="text-[#c7c4d8]" />
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                    {l.level_label || l.role_type.replace(/_/g, ' ')}
                  </span>
                </React.Fragment>
              ))}
              <ChevronRight size={12} className="text-[#c7c4d8]" />
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">✓ Approved</span>
            </div>
          )}
        </div>

        <button onClick={() => navigate(targetPath)} className="flex items-center gap-2 px-5 py-2.5 bg-[#3525cd] text-white rounded-xl text-sm font-bold hover:bg-[#2a1fb0] transition-colors">
          <Settings2 size={15} /> Configure Workflow
        </button>
      </div>
    </PanelWrap>
  );
}

// ── 6. Attendance Maintenance (hidden — endpoint restricted to Root Admin; re-enable by uncommenting below + nav item + case) ──
// function AttendanceMaintenancePanel() {
//   const toast = useToast();
//   const [running, setRunning] = useState(false);
//   const [result,  setResult]  = useState(null);
//   const [confirm, setConfirm] = useState(false);
//
//   async function runCleanup() {
//     setRunning(true); setResult(null);
//     try {
//       const data = await apiPost('/attendance/cleanup-orphaned', {});
//       setResult(data.removed);
//       toast(data.removed > 0 ? `Cleaned up ${data.removed} orphaned record${data.removed !== 1 ? 's' : ''}.` : 'No orphaned records found.', data.removed > 0 ? 'success' : 'info');
//     } catch (err) { toast(err.message, 'error'); }
//     finally { setRunning(false); }
//   }
//
//   return (
//     <PanelWrap group="Leave & Attendance" label="Attendance Maintenance" icon={Wrench} accentColor="#f59e0b">
//       <div className="max-w-xl space-y-5">
//         <div className="border border-[#e7eefe] rounded-xl p-5 bg-white">
//           <div className="flex items-start gap-3 mb-4">
//             <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center flex-shrink-0">
//               <RefreshCw size={16} className="text-rose-500" />
//             </div>
//             <div>
//               <p className="font-bold text-sm text-[#151c27]">Orphaned Record Cleanup</p>
//               <p className="text-xs text-[#777587] mt-0.5">Remove attendance records marked On Leave / WFH / Half Day that no longer have a matching approved leave.</p>
//             </div>
//           </div>
//           {result !== null && (
//             <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg mb-4 ${result > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]'}`}>
//               <Check size={13} /> {result > 0 ? `${result} orphaned record${result !== 1 ? 's' : ''} removed.` : 'Attendance data is clean.'}
//             </div>
//           )}
//           <button onClick={() => setConfirm(true)} disabled={running}
//             className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60"
//             style={{ background: 'linear-gradient(135deg,#3525cd,#4f46e5)' }}>
//             {running ? <><span className="spinner w-3.5 h-3.5" /> Running…</> : <><RefreshCw size={14} /> Run Cleanup</>}
//           </button>
//           <ConfirmModal open={confirm} title="Run Attendance Cleanup"
//             message="This permanently deletes orphaned attendance records. Continue?"
//             confirmLabel="Yes, Run Cleanup" onConfirm={() => { setConfirm(false); runCleanup(); }} onCancel={() => setConfirm(false)} />
//         </div>
//         <div className="border border-dashed border-[#c7c4d8] rounded-xl p-5 opacity-50">
//           <div className="flex items-center gap-3">
//             <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
//               <Sparkles size={16} className="text-[#3525cd]" />
//             </div>
//             <div>
//               <p className="font-bold text-sm text-[#151c27]">Attendance Reprocessing</p>
//               <p className="text-xs text-[#777587] mt-0.5">Reprocess historical attendance records. Coming soon.</p>
//             </div>
//             <span className="ml-auto text-[0.6rem] font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">Soon</span>
//           </div>
//         </div>
//       </div>
//     </PanelWrap>
//   );
// }

// ── 7. Push Notifications ─────────────────────────────────────────────────────
function PushNotificationsPanel({ userId }) {
  const { permission, subscribed, requestAndSubscribe, unsubscribe, isSupported } = usePushNotification(userId);
  const toast = useToast();
  const [showConfirm, setShowConfirm] = useState(false);
  const { data: vapidStatus } = useQuery({
    queryKey: ['vapid-status'],
    queryFn: () => apiGet('/push/vapid-status').catch(() => ({ configured: false })),
    staleTime: 5 * 60 * 1000,
  });
  const serverOk = vapidStatus?.configured !== false;
  const isEnabled = permission === 'granted' && subscribed;

  return (
    <PanelWrap group="Notifications & Communication" label="Push Notifications" icon={Bell} accentColor="#6366f1">
      <div className="max-w-lg">
        {!isSupported ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">Push notifications are not supported in this browser.</div>
        ) : (
          <>
            <div className="flex items-center gap-3 p-4 border border-[#e7eefe] rounded-xl bg-white mb-5">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isEnabled ? 'bg-emerald-500' : 'bg-amber-400'}`} />
              <p className="text-sm text-[#464555]">Browser push notifications are currently <strong>{isEnabled ? 'enabled' : 'disabled'}</strong>.</p>
            </div>
            <p className="text-sm text-[#777587] mb-5 leading-relaxed">Receive real-time browser alerts for leave approvals, payroll, and important HR events — even when you're not on the dashboard.</p>
            <button onClick={isEnabled ? unsubscribe : () => setShowConfirm(true)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold border transition-all ${isEnabled ? 'bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100' : 'bg-[#3525cd] text-white border-transparent hover:bg-[#4f46e5]'}`}>
              {isEnabled ? <BellOff size={15} /> : <Bell size={15} />}
              {isEnabled ? 'Disable Push Notifications' : 'Enable Push Notifications'}
            </button>
            {!serverOk && <p className="text-xs text-amber-600 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Push notifications are not configured on the server. Contact your platform administrator.</p>}
            {permission === 'denied' && <p className="text-xs text-rose-500 mt-3">Notifications are blocked by your browser. Update site permissions to allow them.</p>}
          </>
        )}
      </div>
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 border border-[#c7c4d8]">
            <div className="flex items-center gap-2 mb-3"><Bell size={20} className="text-[#3525cd]" /><h3 className="font-bold text-[#151c27]">Enable Push Notifications</h3></div>
            <p className="text-sm text-[#464555] mb-5 leading-relaxed">You'll receive real-time updates for leave approvals, rejections, and important HR alerts.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowConfirm(false)} className="px-4 py-2 rounded-lg text-sm font-semibold text-[#464555] border border-[#c7c4d8] hover:bg-[#f0f3ff]">Cancel</button>
              <button onClick={async () => { setShowConfirm(false); await requestAndSubscribe(); toast('Push notifications enabled!', 'success'); }}
                className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-[#3525cd] hover:bg-[#4f46e5]">Yes, Enable</button>
            </div>
          </div>
        </div>
      )}
    </PanelWrap>
  );
}

// ── 8. Email Recipients ───────────────────────────────────────────────────────
function EmailRecipientsPanel() {
  const toast = useToast();
  const qc    = useQueryClient();
  const [newEmail, setNewEmail] = useState('');
  const [newName,  setNewName]  = useState('');
  const [adding,   setAdding]   = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(null);

  const { data: recipients = [], isLoading } = useQuery({
    queryKey: ['notify-recipients'],
    queryFn:  () => apiGet('/root/notify-recipients'),
  });

  async function add() {
    if (!newEmail.trim()) { toast('Email is required', 'warning'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) { toast('Enter a valid email address.', 'error'); return; }
    if (newName.trim() && !/[a-zA-Z]/.test(newName.trim())) { toast('Label must contain at least one letter.', 'error'); return; }
    if (newName.trim().length > 60) { toast('Label must be 60 characters or fewer.', 'error'); return; }
    setAdding(true);
    try {
      await apiPost('/root/notify-recipients', { email: newEmail.trim(), name: newName.trim() });
      toast('Recipient added', 'success'); qc.invalidateQueries({ queryKey: ['notify-recipients'] });
      setNewEmail(''); setNewName('');
    } catch (err) { toast(err.message, 'error'); }
    finally { setAdding(false); }
  }

  async function toggle(r) {
    try { await apiPut(`/root/notify-recipients/${r.id}`, { active: !r.active }); qc.invalidateQueries({ queryKey: ['notify-recipients'] }); toast(r.active ? 'Paused' : 'Activated', 'success'); }
    catch (err) { toast(err.message, 'error'); }
  }

  async function remove(id) {
    try { await apiDelete(`/root/notify-recipients/${id}`); qc.invalidateQueries({ queryKey: ['notify-recipients'] }); toast('Removed', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    setConfirmRemove(null);
  }

  return (
    <PanelWrap group="Notifications & Communication" label="Email Recipients" icon={Mail} accentColor="#3525cd">
      <div className="max-w-xl">
        <p className="text-sm text-[#777587] mb-5 leading-relaxed">
          These addresses receive notifications for leave applications and approvals.
          If empty, the system falls back to environment variables.
        </p>
        <div className="flex gap-2 mb-5 flex-wrap">
          <input className="form-control flex-1 min-w-[200px]" type="email" placeholder="recipient@company.com"
            value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <input className="form-control w-36" placeholder="Label (optional)" value={newName} onChange={e => setNewName(e.target.value)} />
          <button className="btn btn-primary btn-sm flex items-center gap-1.5" onClick={add} disabled={adding}>
            {adding ? <span className="spinner w-3.5 h-3.5" /> : <Plus size={14} />} Add
          </button>
        </div>
        {isLoading ? <div className="flex justify-center py-6"><span className="spinner w-5 h-5" /></div>
          : recipients.length === 0 ? (
            <div className="text-center py-8 text-sm text-[#777587] bg-[#f0f3ff] rounded-xl border border-dashed border-[#c7c4d8]">No recipients configured.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {recipients.map(r => (
                <div key={r.id} className={`flex items-center gap-3 p-3 rounded-xl border ${r.active ? 'border-[#c7c4d8] bg-white' : 'border-dashed border-[#c7c4d8] bg-[#fafbff] opacity-60'}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.active ? 'bg-emerald-500' : 'bg-[#c7c4d8]'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#151c27] truncate">{r.email}</p>
                    {r.name && <p className="text-xs text-[#777587] truncate">{r.name}</p>}
                  </div>
                  <button onClick={() => toggle(r)} className="p-1.5 rounded-lg hover:bg-[#f0f3ff] text-[#464555]">
                    {r.active ? <ToggleRight size={16} className="text-emerald-600" /> : <ToggleLeft size={16} />}
                  </button>
                  <button onClick={() => setConfirmRemove(r)} className="p-1.5 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        <ConfirmModal open={!!confirmRemove} title="Remove Recipient"
          message={`Remove ${confirmRemove?.name || confirmRemove?.email}?`}
          confirmLabel="Remove" variant="danger"
          onConfirm={() => remove(confirmRemove.id)} onCancel={() => setConfirmRemove(null)} />
      </div>
    </PanelWrap>
  );
}

// ── 9. Root Administrators ────────────────────────────────────────────────────
function RootAdminsPanel() {
  const { data: admins = [], isLoading } = useQuery({
    queryKey: ['root-admins'],
    queryFn:  () => apiGet('/root/root-admins'),
  });
  return (
    <PanelWrap group="Organization & Administration" label="Root Administrators" icon={ShieldCheck} accentColor="#7c3aed">
      <div className="max-w-xl">
        <p className="text-sm text-[#777587] mb-5">Full access accounts for this organization. To add or remove root admins, use the <strong>Employees</strong> page and set the role to Root Admin.</p>
        {isLoading ? <div className="flex justify-center py-6"><span className="spinner w-5 h-5" /></div>
          : admins.length === 0 ? (
            <div className="text-center py-8 text-sm text-[#777587] bg-[#f0f3ff] rounded-xl border border-dashed border-[#c7c4d8]">No root admins found.</div>
          ) : (
            <div className="flex flex-col gap-3">
              {admins.map(admin => (
                <div key={admin.id} className="flex items-center gap-3 p-4 rounded-xl border border-[#c7c4d8] bg-white hover:bg-[#f9f9ff] transition-colors">
                  <Avatar name={admin.name} color={admin.avatar_color} size={40} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-[#151c27] truncate">{admin.name}</span>
                      <span className="text-[0.6rem] font-black px-1.5 py-0.5 rounded-full bg-[#3525cd]/10 text-[#3525cd] border border-[#3525cd]/20 uppercase tracking-wide">Root Admin</span>
                    </div>
                    <p className="text-xs text-[#777587] truncate">{admin.email}</p>
                    <div className="flex gap-3 mt-1 flex-wrap">
                      {admin.department && <span className="flex items-center gap-1 text-[0.68rem] text-[#464555]"><Briefcase size={10} className="text-[#3525cd]" />{admin.department}</span>}
                      {admin.created_at && <span className="flex items-center gap-1 text-[0.68rem] text-[#777587]"><CalendarDays size={10} />Joined {new Date(admin.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </PanelWrap>
  );
}

// ── 10. Org Profile & Integrations ───────────────────────────────────────────
function OrgSettingsPanel() {
  const toast   = useToast();
  const qc      = useQueryClient();
  const fileRef = React.useRef(null);
  const [logoUploading, setLogoUploading] = React.useState(false);
  const [logoPreview,   setLogoPreview]   = React.useState(null);

  const { data: org, isLoading } = useQuery({
    queryKey: ['org-settings'],
    queryFn:  () => apiGet('/org/settings'),
  });

  const [form,      setForm]      = useState({});
  const [savedForm, setSavedForm] = useState({});
  const [orgErrors, setOrgErrors] = useState({});
  const [saved,     setSaved]     = useState(false);

  const isDirty = useMemo(() => {
    if (Object.keys(savedForm).length === 0) return false;
    return Object.keys(form).some(k => {
      if (k === 'name') return false;
      const secretFields = ['google_client_secret', 'google_refresh_token', 'vapid_private_key'];
      if (secretFields.includes(k)) return (form[k] || '') !== '';
      return String(form[k] ?? '') !== String(savedForm[k] ?? '');
    });
  }, [form, savedForm]);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  useEffect(() => {
    if (org && Object.keys(form).length === 0) {
      const initial = {
        name:                 org.name || '',
        domain:               org.domain || '',
        google_client_id:     org.google_client_id || '',
        google_client_secret: '',
        google_refresh_token: '',
        google_calendar_id:   org.google_calendar_id || '',
        vapid_public_key:     org.vapid_public_key || '',
        vapid_private_key:    '',
        total_annual_leaves:  org.total_annual_leaves || 18,
      };
      setForm(initial);
      setSavedForm(initial);
    }
  }, [org]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function validateOrgForm() {
    const errs = {};
    const domain = (form.domain || '').trim();
    if (domain && !DOMAIN_REGEX.test(domain)) errs.domain = 'Please enter a valid domain (e.g. company.com)';
    setOrgErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const saveMut = useMutation({
    mutationFn: () => apiPut('/org/settings', form),
    onSuccess: () => {
      toast('Organization settings saved!', 'success');
      setSaved(true); setTimeout(() => setSaved(false), 3000);
      setSavedForm(prev => ({ ...prev, ...form, google_client_secret: '', google_refresh_token: '', vapid_private_key: '' }));
      setForm(f => ({ ...f, google_client_secret: '', google_refresh_token: '', vapid_private_key: '' }));
      qc.invalidateQueries({ queryKey: ['org-settings'] });
    },
    onError: err => toast(err.message, 'error'),
  });

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast('Please select an image file.', 'error'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('Logo must be under 2 MB.', 'error'); return; }
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
      setLogoPreview(null);
      toast('Logo uploaded successfully!', 'success');
      setSaved(true); setTimeout(() => setSaved(false), 3000);
      qc.invalidateQueries({ queryKey: ['org-settings'] });
    } catch (err) {
      toast(err.message, 'error');
      setLogoPreview(null);
    } finally {
      setLogoUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleLogoRemove() {
    try {
      const token = localStorage.getItem('lt_token');
      await fetch('/api/org/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ logo_url: '' }),
      });
      toast('Logo removed.', 'success');
      qc.invalidateQueries({ queryKey: ['org-settings'] });
    } catch { toast('Failed to remove logo.', 'error'); }
  }

  if (isLoading) return <div className="flex justify-center py-20"><span className="spinner w-6 h-6" /></div>;

  const currentLogo = logoPreview || org?.logo_url;

  return (
    <PanelWrap group="Organization & Administration" label="Org Profile & Integrations" icon={Building2} accentColor="#7c3aed">
      <div className="max-w-2xl space-y-8">

        {/* Unsaved changes banner */}
        {isDirty && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl">
            <div className="flex items-center gap-2 text-amber-800 text-sm font-semibold">
              <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" /> Unsaved changes
            </div>
            <button onClick={() => { setForm({ ...savedForm }); setOrgErrors({}); }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-amber-800 border border-amber-300 bg-white hover:bg-amber-100 transition-colors">
              Discard
            </button>
          </div>
        )}

        {/* ── Organization Profile ── */}
        <div>
          <p className="text-xs font-black text-[#464555] uppercase tracking-wide mb-4 pb-2 border-b border-[#f0f3ff]">Organization Profile</p>

          {/* Company Logo */}
          <div className="mb-5 p-4 bg-[#f9f9ff] border border-[#e7eefe] rounded-xl">
            <p className="text-xs font-bold text-[#464555] mb-3">Company Logo
              <span className="ml-2 font-normal text-[#9ca3af]">— shown on payslips and official documents</span>
            </p>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-[#c7c4d8] bg-white flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoUploading
                  ? <span className="w-5 h-5 border-2 border-[#7c3aed]/30 border-t-[#7c3aed] rounded-full animate-spin" />
                  : currentLogo
                    ? <img src={currentLogo} alt="Logo" className="w-full h-full object-contain p-1" />
                    : <Building2 size={26} className="text-[#c7c4d8]" />
                }
              </div>
              <div className="space-y-2">
                <input ref={fileRef} type="file" accept="image/*" className="opacity-0 absolute w-0 h-0" onChange={handleLogoUpload} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={logoUploading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:border-[#7c3aed] transition-colors disabled:opacity-50">
                  {logoUploading ? '⏳ Uploading…' : currentLogo ? '🔄 Replace Logo' : '⬆ Upload Logo'}
                </button>
                {org?.logo_url && !logoUploading && (
                  <button type="button" onClick={handleLogoRemove}
                    className="flex items-center gap-1 text-xs font-semibold text-rose-500 hover:text-rose-600 px-1">
                    ✕ Remove logo
                  </button>
                )}
                <p className="text-[0.65rem] text-[#9ca3af]">PNG, JPG or SVG · Max 2 MB</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Company Name">
              <input className="form-control bg-[#f5f5f8] cursor-not-allowed text-[#777587]" value={form.name || ''} readOnly />
              <p className="text-[0.68rem] text-[#777587] mt-1">Contact your Platform Admin to request a name change.</p>
            </Field>
            <Field label="Company Domain" inlineHint="Used for email auto-detection">
              <input className={`form-control ${orgErrors.domain ? 'border-rose-400' : ''}`}
                value={form.domain || ''} placeholder="acmecorp.com"
                onChange={e => { set('domain', e.target.value); setOrgErrors(p => ({ ...p, domain: undefined })); }} />
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
        </div>

        {/* ── Google Calendar Integration ── */}
        <div>
          <p className="text-xs font-black text-[#464555] uppercase tracking-wide mb-4 pb-2 border-b border-[#f0f3ff]">Google Calendar Integration</p>
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
        </div>

        {/* ── Web Push / VAPID ── */}
        <div>
          <p className="text-xs font-black text-[#464555] uppercase tracking-wide mb-4 pb-2 border-b border-[#f0f3ff]">Web Push Notifications (VAPID Keys)</p>
          <div className="space-y-4">
            <Field label="VAPID Public Key">
              <input className="form-control font-mono text-xs" value={form.vapid_public_key || ''} onChange={e => set('vapid_public_key', e.target.value)} placeholder="BxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxA=" />
            </Field>
            <PasswordField label="VAPID Private Key" hint="Leave blank to keep current" value={form.vapid_private_key || ''} onChange={e => set('vapid_private_key', e.target.value)} placeholder="Leave blank to keep" />
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              Generate VAPID keys at <strong>web-push-codelab.glitch.me</strong> or run <code className="bg-amber-100 px-1 rounded">npx web-push generate-vapid-keys</code>
            </div>
          </div>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2">
          <button className="btn btn-primary" onClick={() => { if (validateOrgForm()) saveMut.mutate(); }} disabled={saveMut.isPending || !isDirty}>
            {saveMut.isPending ? <><span className="spinner w-4 h-4" /> Saving…</> : <><Save size={14} /> Save Changes</>}
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-emerald-700 text-sm font-semibold">
              <CheckCircle2 size={14} /> Saved
            </span>
          )}
        </div>

      </div>
    </PanelWrap>
  );
}

// ─── Navigation config ────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    id: 'attendance', label: 'Attendance & Work Rules', icon: Clock, color: '#3525cd',
    items: [
      { id: 'work_schedule',    label: 'Work Schedule',    icon: Calendar,          roles: ['admin','root_admin'] },
      { id: 'attendance_rules', label: 'Attendance Rules', icon: SlidersHorizontal, roles: ['admin','root_admin'] },
      { id: 'status_legend',    label: 'Status Legend',    icon: Palette,           roles: ['admin','root_admin'] },
      { id: 'email_automation', label: 'Email Automation', icon: MailCheck,         roles: ['root_admin'] },
    ],
  },
  {
    id: 'leave', label: 'Leave & Attendance', icon: GitBranch, color: '#10b981',
    items: [
      { id: 'leave_workflow',  label: 'Leave Workflow',          icon: Settings2, roles: ['admin','root_admin'] },
      // { id: 'att_maintenance', label: 'Attendance Maintenance',  icon: Wrench,    roles: ['root_admin'] },  // hidden — backend: POST /attendance/cleanup-orphaned (rootAdminOnly)
    ],
  },
  {
    id: 'notifications', label: 'Notifications & Communication', icon: Bell, color: '#6366f1',
    items: [
      { id: 'push',           label: 'Push Notifications',     icon: Bell, roles: ['employee','admin','root_admin'] },
      { id: 'email_recipients', label: 'Email Recipients',     icon: Mail, roles: ['root_admin'] },
      { id: 'communication',  label: 'Communication Settings', icon: MessageSquare, roles: ['root_admin'], soon: true },
    ],
  },
  {
    id: 'organization', label: 'Organization & Administration', icon: Building2, color: '#7c3aed',
    items: [
      { id: 'root_admins',  label: 'Root Administrators',      icon: ShieldCheck, roles: ['root_admin'] },
      { id: 'org_settings', label: 'Org Profile & Integrations', icon: Building2,   roles: ['root_admin'] },
      { id: 'security',     label: 'Security',                   icon: Lock,        roles: ['root_admin'], soon: true },
    ],
  },
];

function firstVisible(role) {
  for (const g of NAV_GROUPS) {
    for (const item of g.items) {
      if (!item.soon && item.roles.includes(role)) return item.id;
    }
  }
  return 'push';
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function Settings() {
  const { user, isAdmin, isRootAdmin } = useAuth();
  const role = user?.role || 'employee';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn:  () => apiGet('/settings'),
  });
  const schedule = data?.schedule;

  const [active,         setActive]       = useState(() => firstVisible(role));
  const [openGroups,     setOpenGroups]   = useState(() => new Set(NAV_GROUPS.map(g => g.id)));
  const [mobileNavOpen,  setMobileNavOpen] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState(''); // EHN_SETTING_013

  if (isLoading) return <div className="loading"><div className="spinner" /> Loading…</div>;

  // Non-admin simplified view
  if (!isAdmin) {
    return (
      <div>
        <div className="page-header mb-6">
          <div><div className="page-title">Settings</div><div className="page-subtitle">Your notification preferences</div></div>
        </div>
        <div className="max-w-lg"><div className="card p-6"><PushNotificationsPanel userId={user?.id} /></div></div>
      </div>
    );
  }

  function toggleGroup(id) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function renderPanel() {
    switch (active) {
      case 'work_schedule':    return <WorkSchedulePanel    schedule={schedule} isAdmin={isAdmin} onSaved={refetch} />;
      case 'attendance_rules': return <AttendanceRulesPanel schedule={schedule} isAdmin={isAdmin} onSaved={refetch} />;
      case 'status_legend':    return <StatusLegendPanel />;
      case 'email_automation': return <EmailAutomationPanel schedule={schedule} />;
      case 'leave_workflow':   return <LeaveWorkflowPanel />;
      // case 'att_maintenance':  return <AttendanceMaintenancePanel />;  // hidden — see commented component above
      case 'push':             return <PushNotificationsPanel userId={user?.id} />;
      case 'email_recipients': return <EmailRecipientsPanel />;
      case 'root_admins':      return <RootAdminsPanel />;
      case 'org_settings':     return <OrgSettingsPanel />;
      case 'security':
        return <ComingSoonPanel group="Organization & Administration" label="Security" icon={Lock} description="Session timeout, password rules, and MFA configuration." />;
      case 'communication':
        return <ComingSoonPanel group="Notifications & Communication" label="Communication Settings" icon={MessageSquare} description="Email sender name, company signature, and default footer templates." />;
      default: return null;
    }
  }

  // Build a flat list of all visible items for the mobile dropdown
  const allVisibleItems = NAV_GROUPS.flatMap(g =>
    g.items.filter(i => i.roles.includes(role)).map(i => ({ ...i, groupLabel: g.label, groupColor: g.color }))
  );
  const activeItem = allVisibleItems.find(i => i.id === active);

  return (
    <div>
      <div className="page-header mb-5">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-subtitle">Configure organization-wide preferences and automation</div>
        </div>
      </div>

      {/* ── Mobile nav: compact dropdown selector (hidden on lg+) ─────────────── */}
      <div className="lg:hidden mb-4">
        <div className="bg-white border border-[#e7eefe] rounded-2xl shadow-sm overflow-hidden">
          {/* Current section indicator — tap to open/close the nav list */}
          <button
            onClick={() => setMobileNavOpen(o => !o)}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f9f9ff] transition-colors"
          >
            {activeItem && (
              <>
                <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: (activeItem.groupColor || '#3525cd') + '18' }}>
                  {activeItem.icon && <activeItem.icon size={14} style={{ color: activeItem.groupColor || '#3525cd' }} />}
                </span>
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-[0.6rem] font-bold text-[#9ca3af] uppercase tracking-widest truncate">{activeItem.groupLabel}</p>
                  <p className="text-sm font-bold text-[#151c27] truncate">{activeItem.label}</p>
                </div>
              </>
            )}
            <ChevronDown size={16} className={`text-[#c7c4d8] flex-shrink-0 transition-transform duration-200 ${mobileNavOpen ? 'rotate-180' : ''}`} />
          </button>
          {/* Grouped item list — expandable/collapsible */}
          {mobileNavOpen && (
            <div className="border-t border-[#f0f3ff] overflow-y-auto max-h-72">
              {NAV_GROUPS.map((group, gi) => {
                const visibleItems = group.items.filter(i => i.roles.includes(role));
                if (!visibleItems.length) return null;
                const GroupIcon = group.icon;
                return (
                  <div key={group.id} className={gi > 0 ? 'border-t border-[#f0f3ff]' : ''}>
                    {/* Group label */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-[#f9f9ff]">
                      <span className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                        style={{ background: group.color + '18' }}>
                        <GroupIcon size={11} style={{ color: group.color }} />
                      </span>
                      <span className="text-[0.62rem] font-black uppercase tracking-widest text-[#9ca3af]">{group.label}</span>
                    </div>
                    {/* Items */}
                    {visibleItems.map(item => {
                      const ItemIcon = item.icon;
                      const isActive = active === item.id;
                      return (
                        <button key={item.id}
                          onClick={() => { if (!item.soon) { setActive(item.id); setMobileNavOpen(false); } }}
                          className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm text-left transition-all relative
                            ${isActive ? 'text-[#3525cd] font-bold bg-[#3525cd]/6' : item.soon ? 'text-[#a09fb5] cursor-default' : 'text-[#464555] font-medium hover:bg-[#f5f4ff]'}`}>
                          {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-[#3525cd] rounded-r-full" />}
                          <ItemIcon size={13} className={isActive ? 'text-[#3525cd]' : item.soon ? 'text-[#c7c4d8]' : 'text-[#9ca3af]'} />
                          <span className="flex-1">{item.label}</span>
                          {isActive && <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd]" />}
                          {item.soon && <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded-full bg-[#f0f3ff] text-[#a09fb5] border border-[#e7eefe]">SOON</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Desktop layout: sidebar + content (hidden on mobile) ─────────────── */}
      <div className="hidden lg:flex gap-5 items-start min-h-[calc(100vh-200px)]">

        {/* Desktop sidebar — EHN_SETTNG_001: wider width so group names don't truncate */}
        <div className="w-72 flex-shrink-0 sticky top-4">
          <div className="bg-white border border-[#e7eefe] rounded-2xl overflow-hidden shadow-sm">
            {/* EHN_SETTING_013: Settings search bar */}
            <div className="p-3 border-b border-[#f0f3ff]">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
                <input type="text" className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-[#e7eefe] focus:border-[#3525cd] focus:outline-none bg-[#f9f9ff]"
                  placeholder="Search settings…" value={settingsSearch} onChange={e => setSettingsSearch(e.target.value)} />
              </div>
            </div>
            {NAV_GROUPS.map((group, gi) => {
              const GroupIcon  = group.icon;
              const isOpen     = openGroups.has(group.id);
              const visibleItems = group.items.filter(i => i.roles.includes(role)).filter(i =>
                !settingsSearch || i.label.toLowerCase().includes(settingsSearch.toLowerCase()) || group.label.toLowerCase().includes(settingsSearch.toLowerCase())
              );
              if (!visibleItems.length) return null;

              return (
                <div key={group.id} className={gi > 0 ? 'border-t border-[#f0f3ff]' : ''}>
                  <button onClick={() => toggleGroup(group.id)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-[#fafbff] transition-colors text-left">
                    <span className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: group.color + '18' }}>
                      <GroupIcon size={13} style={{ color: group.color }} />
                    </span>
                    <span className="flex-1 text-[0.7rem] font-black uppercase tracking-wider text-[#8b87a2] leading-tight">{group.label}</span>
                    <ChevronDown size={13} className={`text-[#c7c4d8] flex-shrink-0 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} />
                  </button>

                  {isOpen && (
                    <div className="pb-1">
                      {visibleItems.map(item => {
                        const ItemIcon = item.icon;
                        const isActive = active === item.id;
                        return (
                          <button key={item.id}
                            onClick={() => { if (!item.soon) setActive(item.id); }}
                            className={`w-full flex items-center gap-2.5 pl-6 pr-3 py-2 text-sm text-left transition-all relative
                              ${isActive ? 'text-[#3525cd] font-bold bg-[#3525cd]/6' : item.soon ? 'text-[#a09fb5] cursor-default' : 'text-[#464555] font-medium hover:bg-[#f5f4ff] hover:text-[#3525cd]'}`}>
                            {isActive && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-[#3525cd] rounded-r-full" />}
                            <ItemIcon size={13} className={isActive ? 'text-[#3525cd]' : item.soon ? 'text-[#c7c4d8]' : 'text-[#9ca3af]'} />
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.soon && (
                              <span className="text-[0.55rem] font-bold px-1.5 py-0.5 rounded-full bg-[#f0f3ff] text-[#a09fb5] border border-[#e7eefe] flex-shrink-0">SOON</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Desktop content */}
        <div className="flex-1 min-w-0">
          <div className="bg-white border border-[#e7eefe] rounded-2xl shadow-sm overflow-hidden min-h-[560px]">
            {renderPanel()}
          </div>
        </div>
      </div>

      {/* ── Mobile content panel (shown below the mobile nav) ─────────────────── */}
      <div className="lg:hidden">
        <div className="bg-white border border-[#e7eefe] rounded-2xl shadow-sm overflow-hidden min-h-[400px]">
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}
