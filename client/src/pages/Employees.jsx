import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate, useLocation, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Building2, Mail, UserCheck, Umbrella, XCircle, Clock, Home, AlarmClock, CheckCircle2, Users, Eye, EyeOff, Timer, Play, Square, ChevronDown, ChevronUp, Coffee, CalendarDays, Loader2, Phone, FileText, Download, MoreHorizontal, MapPin, Briefcase, Calendar, User, Shield, Key, Upload, BarChart3, ArrowLeft, Search, LayoutGrid, LayoutList, Check, ArrowUpDown, X, Filter, Fingerprint, Camera, Send, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useFeature } from '@/context/FeatureFlagContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import EmployeeProfileV2 from '@/components/EmployeeProfileV2';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';
import { RoleBadge, StatusBadge, LeaveTypeBadge } from '@/components/ui/Badge';
import {
  fmtDate, fmtDateRange,
  countWorkingDaysInRange, countLeaveDaysInRange,
  MONTHS,
} from '@/lib/utils';

const AVATAR_COLORS = ['#3525cd','#10B981','#F59E0B','#EF4444','#712ae2','#F97316','#4f46e5','#EC4899'];

// Build the full display name from separate name fields.
// Handles employees where `name` = first name only (middle_name/surname stored separately).
const empFullName = (emp) =>
  [emp?.name, emp?.middle_name, emp?.surname].filter(Boolean).join(' ');

// ── Clockify integration removed 2026-07-22 ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _removedClockifyTimeline() {
  async function toggle() {
    if (open) { setOpen(false); return; }
    if (!loaded.current) {
      setLoading(true);
      try {
        const { entries: e } = await apiGet('/clockify/user-entries', { userId: empId, date });
        setEntries(e || []);
        loaded.current = true;
      } catch { setEntries([]); }
      finally { setLoading(false); }
    }
    setOpen(true);
  }

  // Build timeline: alternate work sessions and breaks
  const timeline = [];
  entries.forEach((e, i) => {
    timeline.push({ type: 'work', start: e.start, end: e.end, durationMin: e.durationMin, desc: e.description });
    if (i < entries.length - 1 && e.end && entries[i + 1].start) {
      const [eh, em] = e.end.split(':').map(Number);
      const [nh, nm] = entries[i + 1].start.split(':').map(Number);
      const breakMin = (nh * 60 + nm) - (eh * 60 + em);
      if (breakMin > 0) timeline.push({ type: 'break', durationMin: breakMin, start: e.end, end: entries[i + 1].start });
    }
  });

  const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 > 0 ? `${m % 60}m` : ''}`.trim() : `${m}m`;

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-[0.72rem] font-bold text-[#3525cd] hover:text-[#4f46e5] transition-colors"
      >
        {loading
          ? <><Loader2 size={12} className="animate-spin" /> Loading timeline…</>
          : open
            ? <><ChevronUp size={12} /> Hide Timeline</>
            : <><ChevronDown size={12} /> <Timer size={12} /> View Clockify Timeline</>
        }
      </button>

      {open && (
        <div className="mt-3 rounded-xl border border-[#c7c4d8] overflow-hidden bg-white">
          {entries.length === 0 ? (
            <div className="px-4 py-4 text-xs text-[#777587] text-center italic">
              No Clockify entries found — employee may have used manual check-in/out.
            </div>
          ) : (
            <>
              {/* Timeline rows */}
              <div className="p-4 space-y-0">
                {timeline.map((item, i) => (
                  item.type === 'work' ? (
                    <div key={i} className="flex gap-3">
                      {/* Timeline spine */}
                      <div className="flex flex-col items-center w-6 flex-shrink-0">
                        <div className="w-6 h-6 rounded-full bg-emerald-100 border-2 border-emerald-400 flex items-center justify-center flex-shrink-0">
                          <Play size={9} className="text-emerald-600 ml-0.5" />
                        </div>
                        {i < timeline.length - 1 && (
                          <div className="w-0.5 flex-1 bg-[#e7eefe] my-0.5 min-h-[28px]" />
                        )}
                      </div>
                      {/* Content */}
                      <div className="pb-3 flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-sm font-black text-[#151c27]">{item.start}</span>
                          {item.end && (
                            <span className="text-xs text-[#777587]">→ {item.end}</span>
                          )}
                          {!item.end && (
                            <span className="text-[0.65rem] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200 animate-pulse">
                              Live
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.durationMin > 0 && (
                            <span className="text-[0.7rem] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              {fmtMin(item.durationMin)} worked
                            </span>
                          )}
                          {item.desc && (
                            <span className="text-[0.68rem] text-[#777587] truncate">{item.desc}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="flex gap-3">
                      {/* Spine for break */}
                      <div className="flex flex-col items-center w-6 flex-shrink-0">
                        <div className="w-0.5 flex-1 bg-[#e7eefe] my-0" style={{ minHeight: 8 }} />
                        <div className="w-6 h-6 rounded-full bg-amber-50 border-2 border-amber-300 flex items-center justify-center flex-shrink-0">
                          <Coffee size={9} className="text-amber-600" />
                        </div>
                        <div className="w-0.5 flex-1 bg-[#e7eefe] my-0" style={{ minHeight: 8 }} />
                      </div>
                      {/* Break content */}
                      <div className="py-1 flex items-center flex-1 min-w-0">
                        <span className="text-[0.7rem] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 flex items-center gap-1">
                          <Coffee size={9} /> Break: {fmtMin(item.durationMin)}
                          {item.start && item.end && (
                            <span className="font-normal text-amber-500 ml-0.5">({item.start} – {item.end})</span>
                          )}
                        </span>
                      </div>
                    </div>
                  )
                ))}

                {/* Final stop dot */}
                {entries.length > 0 && entries[entries.length - 1].end && (
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center w-6 flex-shrink-0">
                      <div className="w-6 h-6 rounded-full bg-rose-100 border-2 border-rose-400 flex items-center justify-center flex-shrink-0">
                        <Square size={8} className="text-rose-600" />
                      </div>
                    </div>
                    <div className="flex items-center pb-1">
                      <span className="text-sm font-black text-[#151c27]">{entries[entries.length - 1].end}</span>
                      <span className="text-xs text-[#777587] ml-2">End of day</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Summary footer */}
              <div className="border-t border-[#f0f3ff] px-4 py-3 flex items-center justify-between bg-[#f9f9ff]">
                <div className="flex items-center gap-3 text-[0.72rem] text-[#777587]">
                  <span className="flex items-center gap-1"><Play size={10} className="text-emerald-500" /> {entries.length} session{entries.length !== 1 ? 's' : ''}</span>
                  {timeline.filter(t => t.type === 'break').length > 0 && (
                    <span className="flex items-center gap-1">
                      <Coffee size={10} className="text-amber-500" />
                      {fmtMin(timeline.filter(t => t.type === 'break').reduce((s, b) => s + b.durationMin, 0))} break
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Timer size={13} className="text-[#3525cd]" />
                  <span className="text-sm font-black text-[#3525cd]">
                    {totalHours ? `${totalHours}h total` : fmtMin(entries.reduce((s, e) => s + (e.durationMin || 0), 0))}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Employee Profile ──────────────────────────────────────────────────────────
function EmployeeProfile({ emp, onBack, onEdit }) {
  const now = new Date();
  const [activeTab,   setActiveTab]   = useState('overview');
  const [viewMode,    setViewMode]    = useState('monthly');
  const [year,        setYear]        = useState(now.getFullYear());
  const [month,       setMonth]       = useState(now.getMonth() + 1);
  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');
  const [recordsTab,  setRecordsTab]  = useState('attendance');
  const [adjModal,       setAdjModal]       = useState(false);
  const [adjForm,        setAdjForm]        = useState({ leave_type: '', direction: 'add', amount: '', reason: '' });
  const [adjHistoryModal, setAdjHistoryModal] = useState(false);

  const { isAdmin }  = useAuth();
  const toast        = useToast();
  const qc           = useQueryClient();

  const today      = now.toISOString().split('T')[0];
  const monthValue = `${year}-${String(month).padStart(2, '0')}`;

  const isCustomReady = viewMode !== 'custom' || (!!customStart && !!customEnd && customStart <= customEnd);

  // Always fetch current month stats for the header
  const curMonth = now.getMonth() + 1;
  const curYear  = now.getFullYear();
  const { data: curAttendance = [] } = useQuery({
    queryKey: ['emp-att-cur', emp.id, curYear, curMonth],
    queryFn:  () => apiGet('/attendance', { year: curYear, month: curMonth, userId: emp.id }),
  });
  const { data: curLeaves = [] } = useQuery({
    queryKey: ['emp-leaves-cur', emp.id, curYear, curMonth],
    queryFn:  () => apiGet('/leaves', { userId: emp.id, year: curYear, month: curMonth }),
  });

  // Tab-specific queries (Leave & Attendance tab)
  const attParams = viewMode === 'monthly' ? { year, month, userId: emp.id }
                  : viewMode === 'yearly'  ? { year, userId: emp.id }
                  : { startDate: customStart, endDate: customEnd, userId: emp.id };
  const lvParams  = viewMode === 'monthly' ? { userId: emp.id, year, month }
                  : viewMode === 'yearly'  ? { userId: emp.id, year }
                  : { userId: emp.id, startDate: customStart, endDate: customEnd };

  const { data: attendance = [] } = useQuery({
    queryKey: ['emp-att', emp.id, viewMode, year, month, customStart, customEnd],
    queryFn:  () => apiGet('/attendance', attParams),
    enabled:  activeTab === 'leave-attendance' && isCustomReady,
  });
  const { data: leaves = [] } = useQuery({
    queryKey: ['emp-leaves', emp.id, viewMode, year, month, customStart, customEnd],
    queryFn:  () => apiGet('/leaves', lvParams),
    enabled:  activeTab === 'leave-attendance' && isCustomReady,
  });

  // Documents
  const { data: empDocs = [] } = useQuery({
    queryKey: ['emp-docs', emp.id],
    queryFn:  () => apiGet('/documents', { userId: emp.id }),
  });

  // Leave policies for balance
  const { data: leavePolicies = [] } = useQuery({
    queryKey: ['leave-policies'],
    queryFn:  () => apiGet('/leave-policies'),
    staleTime: 300000,
  });

  // API balance (includes HR adjustments); updates automatically after an adjustment is saved
  const { data: apiBalance } = useQuery({
    queryKey: ['emp-balance', emp.id, curYear],
    queryFn:  () => apiGet('/leaves/balance', { userId: emp.id, year: curYear }),
    staleTime: 60000,
  });

  const adjMut = useMutation({
    mutationFn: ({ leave_type, delta, reason }) =>
      apiPost('/leaves/balance/adjust', { userId: emp.id, leave_type, delta, reason, year: curYear }),
    onSuccess: () => {
      toast('Leave balance adjusted', 'success');
      qc.invalidateQueries({ queryKey: ['emp-balance', emp.id, curYear] });
      setAdjModal(false);
      setAdjForm({ leave_type: '', direction: 'add', amount: '', reason: '' });
    },
    onError: err => toast(err?.message || 'Failed to adjust balance', 'error'),
  });

  const { data: adjHistory = [], isFetching: adjHistFetching } = useQuery({
    queryKey: ['emp-balance-adjustments', emp.id, curYear],
    queryFn:  () => apiGet('/leaves/balance/adjustments', { userId: emp.id, year: curYear }),
    enabled:  adjHistoryModal,
    staleTime: 30000,
  });

  const { data: schedule } = useQuery({
    queryKey: ['work-schedule'],
    queryFn:  () => apiGet('/settings/schedule'),
    staleTime: 300000,
  });
  const activeWorkDays = schedule?.work_days ? schedule.work_days.split(',').map(Number) : [1,2,3,4,5];

  // Current month range for header stats
  const empJoinDate   = emp.joining_date;
  const curRangeStart = `${curYear}-${String(curMonth).padStart(2,'0')}-01`;
  const curRangeEnd   = `${curYear}-${String(curMonth).padStart(2,'0')}-${new Date(curYear, curMonth, 0).getDate()}`;
  const curEffEnd     = today < curRangeEnd ? today : curRangeEnd;
  const curEffStart   = empJoinDate && empJoinDate > curRangeStart ? empJoinDate : curRangeStart;
  const curWorkingDays  = countWorkingDaysInRange(curEffStart, curEffEnd, activeWorkDays);
  const curApproved     = curLeaves.filter(l => l.status === 'approved');
  const curLeaveCount   = curApproved.filter(l => l.leave_time === 'full').reduce((s, l) => s + countLeaveDaysInRange(l, curRangeStart, curRangeEnd, activeWorkDays), 0);
  const curHalfCount    = curApproved.filter(l => l.leave_time === 'half').reduce((s, l) => s + countLeaveDaysInRange(l, curRangeStart, curRangeEnd, activeWorkDays), 0);
  const curWfhCount     = curApproved.filter(l => l.leave_time === 'wfh' || l.leave_type === 'wfh').reduce((s, l) => s + countLeaveDaysInRange(l, curRangeStart, curRangeEnd, activeWorkDays), 0);
  const curLateCount    = curAttendance.filter(r => r.is_late).length;
  const curAbsentCount  = curAttendance.filter(r => r.status === 'absent').length;
  const curPresentCount = Math.max(0, curWorkingDays - curLeaveCount - curAbsentCount);

  // Tab-specific range
  let rangeStart, rangeEnd;
  if (viewMode === 'monthly') {
    rangeStart = `${year}-${String(month).padStart(2,'0')}-01`;
    rangeEnd   = `${year}-${String(month).padStart(2,'0')}-${new Date(year, month, 0).getDate()}`;
  } else if (viewMode === 'yearly') {
    rangeStart = `${year}-01-01`;
    rangeEnd   = `${year}-12-31`;
  } else {
    rangeStart = customStart || today;
    rangeEnd   = customEnd   || today;
  }
  const effectiveEnd   = today < rangeEnd ? today : rangeEnd;
  const effectiveStart = empJoinDate && empJoinDate > rangeStart ? empJoinDate : rangeStart;

  const workingDays  = isCustomReady ? countWorkingDaysInRange(effectiveStart, effectiveEnd, activeWorkDays) : 0;
  const approved     = leaves.filter(l => l.status === 'approved');
  const onLeaveCount = approved.filter(l => l.leave_time === 'full').reduce((s, l) => s + countLeaveDaysInRange(l, rangeStart, rangeEnd, activeWorkDays), 0);
  const halfDayCount = approved.filter(l => l.leave_time === 'half').reduce((s, l) => s + countLeaveDaysInRange(l, rangeStart, rangeEnd, activeWorkDays), 0);
  const wfhCount     = approved.filter(l => l.leave_time === 'wfh' || l.leave_type === 'wfh').reduce((s, l) => s + countLeaveDaysInRange(l, rangeStart, rangeEnd, activeWorkDays), 0);
  const lateCount    = attendance.filter(r => r.is_late).length;
  const absentCount  = attendance.filter(r => r.status === 'absent').length;
  const presentCount = Math.max(0, workingDays - onLeaveCount - absentCount);
  const periodLabel  = viewMode === 'monthly' ? `${MONTHS[month - 1]} ${year}`
                     : viewMode === 'yearly'  ? `${year}`
                     : (customStart && customEnd) ? `${fmtDate(customStart)} – ${fmtDate(customEnd)}` : '—';

  const absentRecords = attendance.filter(r => r.status === 'absent').sort((a, b) => b.date.localeCompare(a.date));

  // Leave balance computation
  const LEAVE_DEFAULTS = { casual: { label: 'Casual Leave', quota: 12 }, sick: { label: 'Sick Leave', quota: 10 }, annual: { label: 'Annual Leave', quota: 18 }, comp_off: { label: 'Comp Off', quota: 5 } };
  const LEAVE_COLORS   = { casual: '#10B981', sick: '#3525cd', annual: '#F59E0B', earned: '#F59E0B', comp_off: '#712ae2', emergency: '#EF4444', maternity: '#EC4899', paternity: '#4f46e5', bereavement: '#94a3b8', unpaid: '#64748b' };
  const policyMap = {};
  (leavePolicies || []).filter(p => p.leave_type !== 'wfh').forEach(p => { policyMap[p.leave_type] = { label: p.label || p.leave_type, quota: p.annual_quota }; });
  const allYearLeaves = useQuery({
    queryKey: ['emp-leaves-year', emp.id, curYear],
    queryFn:  () => apiGet('/leaves', { userId: emp.id, year: curYear }),
    staleTime: 60000,
  });
  const yearLeaves = allYearLeaves.data || [];
  const usedByType = {};
  yearLeaves.filter(l => l.status === 'approved' && l.leave_time !== 'wfh' && l.leave_type !== 'wfh').forEach(l => {
    if (l.leave_time === 'half') {
      usedByType[l.leave_type] = (usedByType[l.leave_type] || 0) + 0.5;
    } else {
      usedByType[l.leave_type] = (usedByType[l.leave_type] || 0) + countLeaveDaysInRange(l, `${curYear}-01-01`, `${curYear}-12-31`, activeWorkDays);
    }
  });
  // API balance takes precedence (includes HR adjustments); fall back to local computation while loading
  const balanceSource = Object.keys(policyMap).length > 0 ? policyMap : LEAVE_DEFAULTS;
  const apiBalanceItems = (apiBalance?.balances || [])
    .filter(b => b.leave_type !== 'wfh')
    .map(b => ({
      type: b.leave_type, label: b.label, used: b.used, total: b.allocated,
      remaining: b.remaining, adjustment: b.adjustment || 0,
      color: LEAVE_COLORS[b.leave_type] || '#94a3b8',
    }));
  const leaveBalance = apiBalanceItems.length > 0 ? apiBalanceItems
    : Object.entries(balanceSource).map(([type, info]) => ({
        type, label: info.label, used: usedByType[type] || 0, total: info.quota || 20,
        remaining: Math.max(0, (info.quota || 20) - (usedByType[type] || 0)),
        adjustment: 0, color: LEAVE_COLORS[type] || '#94a3b8',
      }));

  // Helpers
  const empId     = `EMP-${String(emp.id).padStart(4, '0')}`;
  const _empStatusCfg = EMP_STATUS_CFG[emp.employee_status] || EMP_STATUS_CFG.active;
  const statusColor   = _empStatusCfg.cls;
  const statusLabel   = _empStatusCfg.label;
  const fmtEmploymentType = (t) => ({ full_time: 'Full Time', part_time: 'Part Time', contract: 'Contract', intern: 'Intern', consultant: 'Consultant', probation: 'Probation' }[t] || t || '—');
  const fmtWorkMode       = (m) => ({ office: 'Office', remote: 'Remote', hybrid: 'Hybrid' }[m] || m || '—');
  const deptLabel = emp.departments?.length > 0
    ? emp.departments.map(d => d.name).join(', ')
    : emp.department || '—';

  // Today's attendance for this employee
  const todayRecord  = curAttendance.find(r => r.date === today);
  const todayStatus  = todayRecord?.status || null;
  const todayStatusCfg = {
    present:  { label: 'Present Today',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    wfh:      { label: 'WFH Today',      cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    half_day: { label: 'Half Day Today', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    on_leave: { label: 'On Leave Today', cls: 'bg-rose-50 text-rose-600 border-rose-200' },
    absent:   { label: 'Absent Today',   cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  };

  // Jump helper: switch to Leave & Attendance tab with a specific sub-tab
  function jumpTo(recordsTabValue) {
    setActiveTab('leave-attendance');
    if (recordsTabValue) setRecordsTab(recordsTabValue);
  }

  const TABS = [
    { id: 'overview',         label: 'Overview'          },
    { id: 'leave-attendance', label: 'Leave & Attendance' },
  ];

  return (
    <div>
      {/* ── Top Action Hub ── */}
      <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm px-4 py-3 mb-5 flex items-center gap-2 flex-wrap">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-[#464555] hover:text-[#3525cd] transition-colors mr-2">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="w-px h-6 bg-[#e7eefe] mx-1 flex-shrink-0" />
        <button onClick={() => onEdit(emp)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/40 transition-all">
          <Pencil size={13} /> Edit Profile
        </button>
        <button onClick={() => jumpTo('attendance')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-all">
          <UserCheck size={13} /> Attendance
        </button>
        <button onClick={() => jumpTo('leaves')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all">
          <Umbrella size={13} /> Leaves
        </button>
        <button onClick={() => jumpTo('wfh')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all">
          <Home size={13} /> WFH
        </button>
        <button onClick={() => onEdit(emp, 'account')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/40 transition-all">
          <Key size={13} /> Reset Password
        </button>
        <button onClick={() => onEdit(emp, 'documents')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/40 transition-all">
          <FileText size={13} /> Documents
        </button>
        {emp.ctc && (
          <button onClick={() => onEdit(emp, 'salary')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 transition-all">
            <BarChart3 size={13} /> Payroll
          </button>
        )}
      </div>

      {/* ── Profile Hero Card ── */}
      <div className="bg-white rounded-2xl border border-[#e7eefe] shadow-sm mb-5 overflow-hidden">
        <div className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-start gap-6">
            {/* Left: Avatar + Name + Contact */}
            <div className="flex items-start gap-5 flex-1 min-w-0">
              <div className="relative flex-shrink-0">
                <Avatar name={empFullName(emp)} color={emp.avatar_color} size={80} />
                <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-400 border-2 border-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h1 className="text-xl font-black text-[#151c27] tracking-tight uppercase">{empFullName(emp)}</h1>
                  <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${statusColor}`}>
                    {statusLabel}
                  </span>
                  {todayStatus && todayStatusCfg[todayStatus] && (
                    <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full border ${todayStatusCfg[todayStatus].cls}`}>
                      {todayStatusCfg[todayStatus].label}
                    </span>
                  )}
                </div>
                <p className="text-sm text-[#777587] mb-3">
                  {emp.position || 'Team Member'}
                  {deptLabel !== '—' ? ` · ${deptLabel}` : ''}
                </p>
                <div className="space-y-1.5">
                  {emp.email && (
                    <div className="flex items-center gap-2 text-sm text-[#464555]">
                      <Mail size={13} className="text-[#3525cd] flex-shrink-0" />
                      <span>{emp.email}</span>
                    </div>
                  )}
                  {emp.phone && (
                    <div className="flex items-center gap-2 text-sm text-[#464555]">
                      <Phone size={13} className="text-[#3525cd] flex-shrink-0" />
                      <span>{emp.phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-[#464555]">
                    <User size={13} className="text-[#3525cd] flex-shrink-0" />
                    <span>ID: {empId}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Metadata grid */}
            <div className="grid grid-cols-2 gap-x-10 gap-y-3 flex-shrink-0">
              <div>
                <p className="text-[0.68rem] font-semibold text-[#a09ead] uppercase tracking-wider mb-0.5">Department</p>
                <p className="text-sm font-semibold text-[#151c27]">{deptLabel}</p>
              </div>
              <div>
                <p className="text-[0.68rem] font-semibold text-[#a09ead] uppercase tracking-wider mb-0.5">Work Mode</p>
                <div className="flex items-center gap-1.5">
                  <Briefcase size={12} className="text-[#777587]" />
                  <p className="text-sm font-semibold text-[#151c27]">{fmtWorkMode(emp.work_mode)}</p>
                </div>
              </div>
              <div>
                <p className="text-[0.68rem] font-semibold text-[#a09ead] uppercase tracking-wider mb-0.5">Joined On</p>
                <div className="flex items-center gap-1.5">
                  <Calendar size={12} className="text-[#777587]" />
                  <p className="text-sm font-semibold text-[#151c27]">
                    {emp.joining_date ? fmtDate(emp.joining_date) : (emp.created_at ? fmtDate(emp.created_at.slice(0, 10)) : '—')}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-[0.68rem] font-semibold text-[#a09ead] uppercase tracking-wider mb-0.5">Employee Type</p>
                <p className="text-sm font-semibold text-[#151c27]">{fmtEmploymentType(emp.employment_type)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Stats row — clickable, jump to Leave & Attendance tab */}
        <div className="border-t border-[#f0f3ff] grid grid-cols-3 sm:grid-cols-6 divide-x divide-[#f0f3ff]">
          {[
            { icon: <UserCheck size={16} />, label: 'Present Days',  value: curPresentCount, color: 'text-emerald-600', bg: 'bg-emerald-50', onClick: () => jumpTo('attendance') },
            { icon: <Umbrella size={16} />,  label: 'Leave Days',    value: curLeaveCount,   color: 'text-rose-600',   bg: 'bg-rose-50',    onClick: () => jumpTo('leaves')     },
            { icon: <XCircle size={16} />,   label: 'Absent Days',   value: curAbsentCount,  color: 'text-rose-500',   bg: 'bg-rose-50',    onClick: () => jumpTo('leaves')     },
            { icon: <Clock size={16} />,     label: 'Half Days',     value: curHalfCount,    color: 'text-blue-600',   bg: 'bg-blue-50',    onClick: () => jumpTo('attendance') },
            { icon: <Home size={16} />,      label: 'WFH Days',      value: curWfhCount,     color: 'text-cyan-600',   bg: 'bg-cyan-50',    onClick: () => jumpTo('wfh')        },
            { icon: <AlarmClock size={16} />,label: 'Late Entries',  value: curLateCount,    color: 'text-orange-600', bg: 'bg-orange-50',  onClick: () => jumpTo('attendance') },
          ].map(s => (
            <button key={s.label} onClick={s.onClick}
              className="flex flex-col items-center justify-center py-4 px-3 gap-1.5 hover:bg-[#f9f9ff] transition-colors group w-full">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg} ${s.color} group-hover:scale-110 transition-transform`}>
                {s.icon}
              </div>
              <div className="text-xl font-black text-[#151c27]">{s.value}</div>
              <div className="text-[0.65rem] text-[#777587] text-center leading-tight group-hover:text-[#3525cd] transition-colors">{s.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-1 rounded-xl mb-5">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all ${
              activeTab === t.id ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left column (2/3) */}
          <div className="lg:col-span-2 space-y-5">
            {/* Personal Information */}
            <div className="bg-white rounded-2xl border border-[#e7eefe] shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-[#151c27] text-sm">Personal Information</h3>
                <button onClick={() => onEdit(emp, 'personal')}
                  className="text-xs font-semibold text-[#3525cd] hover:text-[#4f46e5] flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-all">
                  <Pencil size={11} /> Edit
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {[
                  { label: 'Full Name',       value: empFullName(emp) },
                  { label: 'Date of Birth',   value: emp.date_of_birth ? fmtDate(emp.date_of_birth) : '—' },
                  { label: 'Personal Email',  value: emp.personal_email || '—' },
                  { label: 'Phone',           value: emp.phone || '—' },
                  { label: 'Company Email',   value: emp.email },
                ].map(row => (
                  <div key={row.label} className="border-b border-[#f5f5f9] pb-3">
                    <p className="text-[0.68rem] text-[#a09ead] font-semibold mb-0.5">{row.label}</p>
                    <p className="text-sm font-semibold text-[#151c27]">{row.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Employment Details */}
            <div className="bg-white rounded-2xl border border-[#e7eefe] shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-[#151c27] text-sm">Employment Details</h3>
                <button onClick={() => onEdit(emp, 'employment')}
                  className="text-xs font-semibold text-[#3525cd] hover:text-[#4f46e5] flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-all">
                  <Pencil size={11} /> Edit
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {[
                  { label: 'Department',       value: deptLabel },
                  { label: 'Designation',      value: emp.position || '—' },
                  { label: 'Joining Date',     value: emp.joining_date ? fmtDate(emp.joining_date) : '—' },
                  { label: 'Employment Type',  value: fmtEmploymentType(emp.employment_type) },
                  { label: 'Work Mode',        value: fmtWorkMode(emp.work_mode) },
                  { label: 'Status',           value: (
                    <span className={`inline-flex text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>
                      {statusLabel}
                    </span>
                  )},
                ].map(row => (
                  <div key={row.label} className="border-b border-[#f5f5f9] pb-3">
                    <p className="text-[0.68rem] text-[#a09ead] font-semibold mb-0.5">{row.label}</p>
                    <p className="text-sm font-semibold text-[#151c27]">{row.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Salary Overview */}
            <div className="bg-white rounded-2xl border border-[#e7eefe] shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-[#151c27] text-sm">Salary Overview</h3>
                <button onClick={() => onEdit(emp, 'salary')}
                  className="text-xs font-semibold text-[#3525cd] hover:text-[#4f46e5] flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-all">
                  <Pencil size={11} /> Edit
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                <div className="border-b border-[#f5f5f9] pb-3">
                  <p className="text-[0.68rem] text-[#a09ead] font-semibold mb-0.5">CTC (Annual)</p>
                  <p className="text-sm font-semibold text-[#151c27]">
                    {emp.ctc ? `₹${Number(emp.ctc).toLocaleString('en-IN')}` : '—'}
                  </p>
                </div>
                <div className="border-b border-[#f5f5f9] pb-3">
                  <p className="text-[0.68rem] text-[#a09ead] font-semibold mb-0.5">Salary Effective Date</p>
                  <p className="text-sm font-semibold text-[#151c27]">
                    {emp.salary_effective_date ? fmtDate(emp.salary_effective_date) : '—'}
                  </p>
                </div>
              </div>
              <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-700 font-semibold">Note: Detailed salary structure (HRA, PF, etc.) is managed in the Payroll section.</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-2xl border border-[#e7eefe] shadow-sm p-5">
              <h3 className="font-black text-[#151c27] text-sm mb-4">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'View Attendance',  icon: <UserCheck size={13} />,  cls: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',  onClick: () => jumpTo('attendance')        },
                  { label: 'View Leaves',      icon: <Umbrella size={13} />,   cls: 'border-[#3525cd]/30 text-[#3525cd] hover:bg-[#f0f3ff]',    onClick: () => jumpTo('leaves')           },
                  { label: 'View WFH',         icon: <Home size={13} />,       cls: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50',      onClick: () => jumpTo('wfh')              },
                  { label: 'Edit Profile',     icon: <Pencil size={13} />,     cls: 'border-[#c7c4d8] text-[#464555] hover:bg-[#f0f3ff]',       onClick: () => onEdit(emp, 'personal')    },
                  { label: 'Reset Password',   icon: <Key size={13} />,        cls: 'border-orange-200 text-orange-700 hover:bg-orange-50',      onClick: () => onEdit(emp, 'account')     },
                  { label: 'Documents',        icon: <FileText size={13} />,   cls: 'border-[#c7c4d8] text-[#464555] hover:bg-[#f0f3ff]',       onClick: () => onEdit(emp, 'documents')   },
                ].map(a => (
                  <button key={a.label} onClick={a.onClick}
                    className={`flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all ${a.cls}`}>
                    {a.icon} {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right column (1/3) */}
          <div className="space-y-5">
            {/* Documents */}
            <div className="bg-white rounded-2xl border border-[#e7eefe] shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-[#151c27] text-sm">Documents</h3>
              </div>
              {empDocs.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed border-[#e7eefe] rounded-xl">
                  <FileText size={28} className="mx-auto mb-2 text-[#c7c4d8]" />
                  <p className="text-xs font-semibold text-[#464555]">No documents uploaded</p>
                  <p className="text-[0.65rem] text-[#9ca3af] mt-0.5">Documents will appear here once uploaded.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {empDocs.slice(0, 5).map(doc => (
                    <div key={doc.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-[#f0f3ff] hover:bg-[#f9f9ff] hover:border-[#c7c4d8] transition-all group">
                      <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                        <FileText size={13} className="text-[#3525cd]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[#151c27] truncate">{doc.name}</p>
                        <p className="text-[0.65rem] text-[#9ca3af] capitalize">{doc.category?.replace(/_/g, ' ') || 'Document'}</p>
                      </div>
                      {doc.verified && (
                        <span className="text-[0.6rem] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex-shrink-0">Verified</span>
                      )}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                          className="p-1 rounded text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors" title="Preview">
                          <Eye size={13} />
                        </a>
                        <a href={doc.file_url} download={doc.name}
                          className="p-1 rounded text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors" title="Download">
                          <Download size={13} />
                        </a>
                      </div>
                    </div>
                  ))}
                  {empDocs.length > 5 && (
                    <p className="text-xs text-center text-[#3525cd] font-semibold hover:underline cursor-pointer mt-1">
                      +{empDocs.length - 5} more document{empDocs.length - 5 !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Leave Balance */}
            <div className="bg-white rounded-2xl border border-[#e7eefe] shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-black text-[#151c27] text-sm">Leave Balance</h3>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <>
                      <button onClick={() => setAdjModal(true)}
                        className="text-[0.65rem] font-bold text-[#3525cd] bg-[#f0f3ff] hover:bg-[#e0e7ff] px-2 py-0.5 rounded-md transition-colors">
                        Adjust
                      </button>
                      <button onClick={() => setAdjHistoryModal(true)}
                        className="text-[0.65rem] font-bold text-[#777587] hover:text-[#3525cd] transition-colors">
                        History
                      </button>
                    </>
                  )}
                  <span className="text-[0.65rem] text-[#777587] font-semibold">{curYear}</span>
                </div>
              </div>
              <div className="space-y-3.5">
                {leaveBalance.map(lb => {
                  const pct       = Math.min(100, Math.round((lb.used / lb.total) * 100));
                  const remaining = lb.remaining ?? Math.max(0, lb.total - lb.used);
                  const isLow     = remaining <= 2 && lb.total > 0;
                  const isWarning = remaining <= Math.ceil(lb.total * 0.25) && !isLow;
                  const barColor  = isLow ? '#ef4444' : isWarning ? '#f59e0b' : lb.color;
                  return (
                    <div key={lb.type}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[#464555]">{lb.label}</span>
                          {isLow && (
                            <span className="text-[0.6rem] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">Low</span>
                          )}
                          {isWarning && (
                            <span className="text-[0.6rem] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">Running low</span>
                          )}
                          {lb.adjustment !== 0 && (
                            <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full border ${lb.adjustment > 0 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
                              {lb.adjustment > 0 ? `+${lb.adjustment}d` : `${lb.adjustment}d`} adj
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-black text-[#151c27]">{lb.used}</span>
                          <span className="text-[0.68rem] text-[#9ca3af]"> / {lb.total}d</span>
                          <span className={`text-[0.65rem] font-bold ml-1.5 ${isLow ? 'text-rose-600' : isWarning ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {remaining}d left
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-[#f0f3ff] overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-300"
                          style={{ width: `${pct}%`, background: barColor }} />
                      </div>
                      <div className="flex justify-end mt-0.5">
                        <span className="text-[0.6rem] text-[#9ca3af]">{pct}% utilised</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Leave & Attendance Tab ── */}
      {activeTab === 'leave-attendance' && (
        <div>
          {/* View mode controls */}
          <div className="flex items-center gap-3 flex-wrap mb-5">
            <div className="flex gap-1 bg-[#f0f3ff] p-1 rounded-xl">
              {['monthly', 'yearly', 'custom'].map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg capitalize transition-colors ${
                    viewMode === m ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
            {viewMode === 'monthly' && (
              <input type="month" className="form-control w-auto" value={monthValue}
                onChange={e => { const [y, mo] = e.target.value.split('-').map(Number); setYear(y); setMonth(mo); }} />
            )}
            {viewMode === 'yearly' && (
              <div className="flex items-center gap-2 bg-white border border-[#c7c4d8] rounded-lg px-3 py-2">
                <button onClick={() => setYear(y => y - 1)} className="text-[#3525cd] hover:text-[#4f46e5]"><ChevronLeft size={15} /></button>
                <span className="font-bold text-[#151c27] min-w-[3.5rem] text-center">{year}</span>
                <button onClick={() => setYear(y => Math.min(y + 1, now.getFullYear()))} className="text-[#3525cd] hover:text-[#4f46e5] disabled:opacity-40" disabled={year >= now.getFullYear()}><ChevronRight size={15} /></button>
              </div>
            )}
            {viewMode === 'custom' && (
              <div className="flex items-center gap-2 flex-wrap">
                <input type="date" className="form-control w-auto" value={customStart} max={customEnd || today} onChange={e => setCustomStart(e.target.value)} />
                <span className="text-[#777587] text-sm font-medium">to</span>
                <input type="date" className="form-control w-auto" value={customEnd} min={customStart} max={today} onChange={e => setCustomEnd(e.target.value)} />
              </div>
            )}
          </div>

          {viewMode === 'custom' && !isCustomReady ? (
            <div className="empty-state py-12">
              <CheckCircle2 size={36} className="mx-auto mb-2 opacity-30" />
              <p>Select a start and end date to view records</p>
            </div>
          ) : (
            <>
              {/* Period stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
                {[
                  { icon: <UserCheck size={16} />, label: 'Present',  value: presentCount, cls: 'border-t-emerald-500', iconCls: 'bg-emerald-50 text-emerald-600' },
                  { icon: <Umbrella size={16} />,  label: 'Leave',    value: onLeaveCount, cls: 'border-t-rose-500',    iconCls: 'bg-rose-50 text-rose-600'       },
                  { icon: <XCircle size={16} />,   label: 'Absent',   value: absentCount,  cls: 'border-t-rose-400',    iconCls: 'bg-rose-50 text-rose-500'       },
                  { icon: <Clock size={16} />,     label: 'Half Days',value: halfDayCount, cls: 'border-t-blue-500',    iconCls: 'bg-blue-50 text-blue-600'       },
                  { icon: <Home size={16} />,      label: 'WFH',      value: wfhCount,     cls: 'border-t-cyan-400',    iconCls: 'bg-cyan-50 text-cyan-700'       },
                  { icon: <AlarmClock size={16} />,label: 'Late',     value: lateCount,    cls: 'border-t-orange-400',  iconCls: 'bg-orange-50 text-orange-600'   },
                ].map(s => (
                  <div key={s.label} className={`bg-white rounded-xl border border-[#e7eefe] border-t-4 ${s.cls} p-4 shadow-sm`}>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${s.iconCls}`}>{s.icon}</div>
                    <div className="text-xl font-black text-[#151c27]">{s.value}</div>
                    <div className="text-xs text-[#464555] mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-1 rounded-xl mb-4">
                {[
                  { key: 'attendance', label: 'Attendance & Hours', icon: <Timer size={13} /> },
                  { key: 'leaves',     label: 'Leaves & Absences',  icon: <Umbrella size={13} /> },
                  { key: 'wfh',        label: 'WFH',                icon: <Home size={13} /> },
                ].map(t => (
                  <button key={t.key} onClick={() => setRecordsTab(t.key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                      recordsTab === t.key ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'
                    }`}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>

              {/* Attendance records */}
              {recordsTab === 'attendance' && (() => {
                const presentRecords = attendance
                  .filter(r => ['present', 'wfh', 'half_day'].includes(r.status))
                  .sort((a, b) => b.date.localeCompare(a.date));
                return presentRecords.length === 0 ? (
                  <div className="empty-state">
                    <CalendarDays size={36} className="mx-auto mb-2 opacity-30" />
                    <p>No attendance records for {periodLabel}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {presentRecords.map(r => {
                      const totalHours = r.work_hours;
                      const dow    = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
                      const dayNum = new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      return (
                        <div key={r.id} className="bg-white rounded-xl border border-[#e7eefe] shadow-sm p-4">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-3">
                              <div className="text-center bg-[#f0f3ff] rounded-lg px-2.5 py-1.5 flex-shrink-0">
                                <div className="text-[0.6rem] font-bold text-[#777587] uppercase tracking-widest">{dow}</div>
                                <div className="text-sm font-black text-[#3525cd] leading-tight">{dayNum}</div>
                              </div>
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <StatusBadge status={r.status} />
                                  {totalHours > 0 && (
                                    <span className="flex items-center gap-1 text-xs font-black text-[#3525cd]">
                                      <Timer size={12} /> {totalHours}h
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Leaves & Absences */}
              {recordsTab === 'leaves' && (
                <div className="flex flex-col gap-3">
                  {leaves.filter(l => l.leave_time !== 'wfh' && l.leave_type !== 'wfh').length === 0 && absentCount === 0 ? (
                    <div className="empty-state">
                      <CheckCircle2 size={36} className="mx-auto mb-2 opacity-30" />
                      <p>No leave records for {periodLabel}</p>
                    </div>
                  ) : (
                    <>
                      {leaves.filter(l => l.leave_time !== 'wfh' && l.leave_type !== 'wfh').map(l => (
                        <div key={l.id} className="bg-white rounded-xl border border-[#e7eefe] shadow-sm p-4 flex items-start gap-3">
                          <Avatar name={empFullName(emp)} color={emp.avatar_color} size={32} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-semibold text-sm text-[#151c27]">{empFullName(emp)}</span>
                              {(l.leave_time === 'wfh' || l.leave_type === 'wfh') ? <StatusBadge status="wfh" /> : <LeaveTypeBadge type={l.leave_type} />}
                              {l.leave_time === 'half' && l.leave_type !== 'wfh' ? (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd]">
                                  {l.half_type === 'second_half' ? 'Second Half' : 'First Half'}
                                </span>
                              ) : l.leave_time !== 'wfh' && l.leave_type !== 'wfh' ? (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#464555]">Full Day</span>
                              ) : null}
                              <StatusBadge status={l.status} />
                            </div>
                            <div className="text-xs text-[#464555]">{fmtDateRange(l.start_date, l.end_date)}</div>
                            {l.reason && <div className="text-xs text-[#777587] italic mt-1">"{l.reason}"</div>}
                            {l.approver_name && <div className="text-xs text-[#777587] mt-1">By: {l.approver_name}</div>}
                          </div>
                        </div>
                      ))}
                      {absentRecords.map(r => (
                        <div key={r.id} className="bg-white rounded-xl border border-[#e7eefe] shadow-sm p-4 flex items-start gap-3">
                          <Avatar name={empFullName(emp)} color={emp.avatar_color} size={32} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-semibold text-sm text-[#151c27]">{empFullName(emp)}</span>
                              <StatusBadge status="absent" />
                            </div>
                            <div className="text-xs text-[#464555]">{fmtDate(r.date)}</div>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* WFH records */}
              {recordsTab === 'wfh' && (() => {
                const wfhRecords = leaves.filter(l => l.leave_time === 'wfh' || l.leave_type === 'wfh').sort((a, b) => b.start_date.localeCompare(a.start_date));
                return wfhRecords.length === 0 ? (
                  <div className="empty-state">
                    <Home size={36} className="mx-auto mb-2 opacity-30" />
                    <p>No WFH records for {periodLabel}</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {wfhRecords.map(l => (
                      <div key={l.id} className="bg-white rounded-xl border border-[#e7eefe] shadow-sm p-4 flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                          <Home size={16} className="text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">WFH</span>
                            <StatusBadge status={l.status} />
                          </div>
                          <div className="text-xs font-semibold text-[#151c27]">{fmtDateRange(l.start_date, l.end_date)}</div>
                          {l.reason && <div className="text-xs text-[#777587] italic mt-1">"{l.reason}"</div>}
                          {l.approver_name && <div className="text-xs text-[#777587] mt-1">Approved by: {l.approver_name}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      {/* ── Adjustment History Modal ── */}
      {adjHistoryModal && (
        <Modal open={adjHistoryModal} onClose={() => setAdjHistoryModal(false)} title={`Leave Balance Adjustments — ${curYear}`}>
          <div className="p-1">
            {adjHistFetching ? (
              <div className="py-8 flex justify-center"><span className="w-5 h-5 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin" /></div>
            ) : adjHistory.length === 0 ? (
              <p className="text-xs text-[#9ca3af] text-center py-6">No manual adjustments recorded for {curYear}.</p>
            ) : (
              <div className="divide-y divide-[#f0f3ff]">
                {adjHistory.map(a => (
                  <div key={a.id} className="flex items-start gap-3 py-3">
                    <span className={`text-sm font-black w-14 flex-shrink-0 ${a.delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {a.delta > 0 ? `+${a.delta}d` : `${a.delta}d`}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#151c27]">
                        {policyMap[a.leave_type]?.label || a.leave_type}
                      </p>
                      <p className="text-[0.68rem] text-[#464555] mt-0.5 leading-relaxed">{a.reason}</p>
                      <p className="text-[0.62rem] text-[#9ca3af] mt-1">
                        {a.adjusted_by_name} · {fmtDate(a.created_at?.slice(0, 10))}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Leave Balance Adjustment Modal ── */}
      {adjModal && (
        <Modal open={adjModal} onClose={() => setAdjModal(false)} title="Adjust Leave Balance">
          <div className="space-y-4 p-1">
            <p className="text-xs text-[#777587]">
              Grant extra days or deduct days from <span className="font-bold text-[#151c27]">{empFullName(emp)}</span>'s {curYear} leave balance.
              This is recorded as an HR adjustment and shown separately from approved leaves.
            </p>

            <div>
              <label className="form-label">Leave Type</label>
              <select className="form-control" value={adjForm.leave_type}
                onChange={e => setAdjForm(f => ({ ...f, leave_type: e.target.value }))}>
                <option value="">— Select leave type —</option>
                {(leavePolicies || []).filter(p => p.leave_type !== 'wfh' && p.active).map(p => (
                  <option key={p.leave_type} value={p.leave_type}>{p.label || p.leave_type}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="form-label">Adjustment</label>
              <div className="flex gap-2 items-center">
                <div className="flex rounded-lg border border-[#c7c4d8] overflow-hidden text-xs font-bold">
                  <button onClick={() => setAdjForm(f => ({ ...f, direction: 'add' }))}
                    className={`px-3 py-2 transition-colors ${adjForm.direction === 'add' ? 'bg-emerald-500 text-white' : 'bg-white text-[#464555] hover:bg-[#f0f3ff]'}`}>
                    + Add days
                  </button>
                  <button onClick={() => setAdjForm(f => ({ ...f, direction: 'deduct' }))}
                    className={`px-3 py-2 transition-colors ${adjForm.direction === 'deduct' ? 'bg-rose-500 text-white' : 'bg-white text-[#464555] hover:bg-[#f0f3ff]'}`}>
                    − Deduct days
                  </button>
                </div>
                <input type="number" min="0.5" step="0.5" placeholder="0.5"
                  className="form-control w-24"
                  value={adjForm.amount}
                  onChange={e => setAdjForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
            </div>

            <div>
              <label className="form-label">Reason <span className="text-rose-500">*</span></label>
              <input type="text" className="form-control" placeholder="e.g. Carry-forward from previous year"
                value={adjForm.reason}
                onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setAdjModal(false)}
                className="px-4 py-2 text-xs font-bold text-[#777587] border border-[#c7c4d8] rounded-lg hover:bg-[#f9f9ff] transition-colors">
                Cancel
              </button>
              <button
                disabled={!adjForm.leave_type || !adjForm.amount || !adjForm.reason.trim() || adjMut.isPending}
                onClick={() => {
                  const amount = parseFloat(adjForm.amount);
                  if (!amount || amount <= 0) return;
                  const delta = adjForm.direction === 'add' ? amount : -amount;
                  adjMut.mutate({ leave_type: adjForm.leave_type, delta, reason: adjForm.reason });
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-[#3525cd] rounded-lg hover:bg-[#4f46e5] disabled:opacity-50 transition-colors">
                {adjMut.isPending ? 'Saving…' : 'Save Adjustment'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Designation mapping by department keywords ────────────────────────────────
const DEPT_DESIGNATIONS = {
  'web development':              ['Frontend Developer','Backend Developer','Full Stack Developer','Software Engineer','Senior Software Engineer','Lead Engineer','Tech Lead','Engineering Manager'],
  'mobile application development': ['Mobile Developer','iOS Developer','Android Developer','React Native Developer','Flutter Developer','Mobile Tech Lead'],
  'ui/ux':                        ['UI Designer','UX Designer','UI/UX Designer','Graphic Designer','Visual Designer','Motion Designer','Design Lead'],
  'seo':                          ['SEO Executive','Digital Marketing Executive','Content Writer','Social Media Manager','SEO Analyst','Performance Marketer'],
  'meta ads':                     ['Digital Marketing Executive','Performance Marketer','Paid Media Specialist','Social Media Manager'],
  'human resources':              ['HR Executive','HR Manager','Senior HR Manager','Recruiter','Talent Acquisition Specialist','HR Business Partner','HR Coordinator'],
  'hr':                           ['HR Executive','HR Manager','Senior HR Manager','Recruiter','Talent Acquisition Specialist','HR Business Partner'],
  'qa':                           ['QA Engineer','Senior QA Engineer','QA Analyst','Test Lead','QA Manager','Automation Engineer'],
  'project':                      ['Project Coordinator','Project Manager','Senior Project Manager','Scrum Master','Delivery Manager'],
  'finance':                      ['Finance Executive','Accountant','Senior Accountant','Finance Manager','CFO'],
  'sales':                        ['Sales Executive','Senior Sales Executive','Business Development Manager','Sales Manager'],
  'operations':                   ['Operations Executive','Operations Manager','Business Analyst','Process Analyst'],
  'management':                   ['Manager','Senior Manager','Director','Vice President','Chief Executive Officer','Chief Technology Officer','Chief Operating Officer'],
};

const ALL_DESIGNATIONS = ['Software Engineer','Senior Software Engineer','Lead Engineer','Engineering Manager','Frontend Developer','Backend Developer','Full Stack Developer','Mobile Developer','iOS Developer','Android Developer','React Native Developer','UI Designer','UX Designer','UI/UX Designer','Graphic Designer','SEO Executive','Digital Marketing Executive','Content Writer','QA Engineer','QA Analyst','Test Lead','HR Executive','HR Manager','Recruiter','Project Coordinator','Project Manager','Finance Executive','Accountant','Sales Executive','Business Development Manager','Operations Manager','Business Analyst','Team Lead','Assistant Manager','Manager','Senior Manager','Director','Vice President','CEO','CTO','COO'];

function getDesignationsForDepts(selectedDeptNames = []) {
  if (!selectedDeptNames.length) return ALL_DESIGNATIONS;
  const matched = new Set();
  selectedDeptNames.forEach(name => {
    const lc = name.toLowerCase();
    Object.entries(DEPT_DESIGNATIONS).forEach(([key, desigs]) => {
      if (lc.includes(key)) desigs.forEach(d => matched.add(d));
    });
  });
  return matched.size > 0 ? [...matched] : ALL_DESIGNATIONS;
}

// ── BUG_166: ComboInput — searchable dropdown that works after re-selection ────
function ComboInput({ value, onChange, options, placeholder, className }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value || '');
  const ref = useRef(null);

  useEffect(() => { setQuery(value || ''); }, [value]);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o => !query || o.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={ref} className="relative">
      <input
        className={className || 'form-control'}
        value={query}
        placeholder={placeholder}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 bg-white border border-[#c7c4d8] rounded-lg shadow-lg max-h-40 overflow-y-auto mt-0.5">
          {filtered.map(o => (
            <div key={o}
              className="px-3 py-1.5 text-sm cursor-pointer hover:bg-[#f0f3ff] text-[#151c27]"
              onMouseDown={e => { e.preventDefault(); setQuery(o); onChange(o); setOpen(false); }}>
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add / Edit Employee Modal ─────────────────────────────────────────────────
function EmployeeFormModal({ open, onClose, employee, onSaved, departments = [], defaultRole = 'employee', initialTab = 'personal' }) {
  const isEdit            = !!employee;
  const toast             = useToast();
  const { isRootAdmin }   = useAuth();
  const qc                = useQueryClient();
  const hasBiometric      = useFeature('biometric');
  const navigate        = useNavigate();
  const location        = useLocation();
  const employeesBase   = location.pathname.startsWith('/root/') ? '/root/employees' : '/employees';
  const [showPw,          setShowPw]          = useState(false);
  const [tab,             setTab]             = useState(isEdit ? (initialTab || 'personal') : 'personal');
  const [credCooldown,    setCredCooldown]    = useState(false);
  const [lastCredSentAt,  setLastCredSentAt]  = useState(employee?.last_credentials_sent_at || null);

  const initDeptIds = isEdit && employee.departments?.length
    ? employee.departments.map(d => d.id)
    : [];

  // Parse the stored name into first / middle / last for the edit form.
  // users.name always stores the FULL display name; middle_name and surname are optional
  // separate columns. We derive first name by stripping the suffix parts from the full name.
  const _parsedName = (() => {
    if (!isEdit) return { firstName: '', middleName: '', surname: '' };
    const storedMiddle  = (employee.middle_name || '').trim();
    const storedSurname = (employee.surname     || '').trim();
    const fullName      = (employee.name        || '').trim();

    if (storedMiddle || storedSurname) {
      // Separate columns are already populated — strip them from the end of the full name
      // to recover just the first name portion.
      let firstName = fullName;
      const suffix = [storedMiddle, storedSurname].filter(Boolean).join(' ');
      if (suffix && firstName.endsWith(suffix)) {
        firstName = firstName.slice(0, firstName.length - suffix.length).trim();
      }
      return { firstName: firstName || fullName, middleName: storedMiddle, surname: storedSurname };
    }

    // No separate columns — split the full name by whitespace
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 3) {
      return { firstName: parts[0], middleName: parts.slice(1, -1).join(' '), surname: parts[parts.length - 1] };
    }
    if (parts.length === 2) return { firstName: parts[0], middleName: '', surname: parts[1] };
    return { firstName: fullName, middleName: '', surname: '' };
  })();

  const [form, setForm] = useState(() => isEdit ? {
    name:                 _parsedName.firstName,
    email:                employee.email           || '',
    phone:                employee.phone           || '',
    personal_email:       employee.personal_email  || '',
    date_of_birth:        employee.date_of_birth        ? employee.date_of_birth.slice(0, 10)        : '',
    department:           employee.department      || '',
    department_ids:       initDeptIds,
    position:             employee.position        || '',
    designation_id:       employee.designation_id  || '',
    joining_date:         employee.joining_date         ? employee.joining_date.slice(0, 10)         : '',
    employment_type:      employee.employment_type || 'full_time',
    work_mode:            employee.work_mode       || 'office',
    employee_status:      employee.employee_status || 'active',
    ctc:                  employee.ctc             || '',
    salary_effective_date:employee.salary_effective_date ? employee.salary_effective_date.slice(0, 10) : '',
    role:                 employee.role,
    avatar_color:         employee.avatar_color    || '#3525cd',
    avatar_url:           employee.avatar_url      || '',
    clockify_user_id:     employee.clockify_user_id || '',
    password:             '',
    // Extended profile
    salutation:           employee.salutation           || '',
    middle_name:          _parsedName.middleName,
    surname:              _parsedName.surname,
    branch_id:            employee.branch_id            || '',
    location:             employee.location             || '',
    grade:                employee.grade                || '',
    division:             employee.division             || '',
    sub_division:         employee.sub_division         || '',
    device_enrollment_id: employee.device_enrollment_id || '',
    weekly_off_day:       employee.weekly_off_day       || '',
    work_hours_per_day:   employee.work_hours_per_day   || 8,
    // Personal profile fields
    gender:               employee.gender               || '',
    blood_group:          employee.blood_group          || '',
    marital_status:       employee.marital_status       || '',
    nationality:          employee.nationality          || '',
    religion:             employee.religion             || '',
    citizenship:          employee.citizenship          || '',
    height:               employee.height               || '',
    weight:               employee.weight               || '',
    // Address (loaded async from profile API — field names match DB columns)
    current_address_line1: '', current_address_line2: '',
    current_city: '', current_state: '', current_country: '', current_postal_code: '',
    permanent_address: '', permanent_city: '', permanent_state: '',
    permanent_country: '', permanent_postal_code: '',
    // Health (loaded async from profile API)
    allergies: '', medical_conditions: '', disabilities: '', emergency_medical_notes: '',
    // Probation
    probation_applicable: employee.probation_applicable || false,
    probation_months:     employee.probation_months     || 3,
  } : {
    name: '', email: '', password: '', department: '', position: '', designation_id: '',
    role: defaultRole, avatar_color: '#3525cd', date_of_birth: '', department_ids: [],
    phone: '', personal_email: '', joining_date: '', employment_type: 'full_time',
    work_mode: 'office', employee_status: 'active', ctc: '', salary_effective_date: '',
    // Extended profile defaults
    salutation: '', middle_name: '', surname: '', branch_id: '', location: '', grade: '',
    division: '', sub_division: '', device_enrollment_id: '', weekly_off_day: '',
    work_hours_per_day: 8,
    // Personal profile fields defaults
    gender: '', blood_group: '', marital_status: '', nationality: '',
    religion: '', citizenship: '', height: '', weight: '',
    // Address defaults
    current_address_line1: '', current_address_line2: '',
    current_city: '', current_state: '', current_country: '', current_postal_code: '',
    permanent_address: '', permanent_city: '', permanent_state: '',
    permanent_country: '', permanent_postal_code: '',
    // Health defaults
    allergies: '', medical_conditions: '', disabilities: '', emergency_medical_notes: '',
    // Probation defaults
    probation_applicable: false,
    probation_months: 3,
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function toggleDept(deptId) {
    setForm(f => {
      const ids = f.department_ids.includes(deptId)
        ? f.department_ids.filter(id => id !== deptId)
        : [...f.department_ids, deptId];
      const firstName = departments.find(d => d.id === ids[0])?.name || '';
      return { ...f, department_ids: ids, department: firstName };
    });
  }

  // Fetch employee docs for Documents tab
  const { data: empDocs = [] } = useQuery({
    queryKey: ['emp-docs-modal', employee?.id],
    queryFn:  () => apiGet('/documents', { userId: employee?.id }),
    enabled:  isEdit && tab === 'documents' && !!employee?.id,
  });

  // Fetch profile/personal (address) and profile/health for edit mode
  const { data: profilePersonal = {} } = useQuery({
    queryKey: ['emp-profile-personal-modal', employee?.id],
    queryFn:  () => apiGet(`/profile/${employee.id}/personal`),
    enabled:  isEdit && !!employee?.id,
  });
  const { data: profileHealth = {} } = useQuery({
    queryKey: ['emp-profile-health-modal', employee?.id],
    queryFn:  () => apiGet(`/profile/${employee.id}/health`),
    enabled:  isEdit && !!employee?.id,
  });

  // One-time population of address fields from profile data
  const addrInited = useRef(false);
  useEffect(() => {
    if (!isEdit || addrInited.current || Object.keys(profilePersonal).length === 0) return;
    addrInited.current = true;
    setForm(f => ({
      ...f,
      current_address_line1: profilePersonal.current_address_line1 || '',
      current_address_line2: profilePersonal.current_address_line2 || '',
      current_city:          profilePersonal.current_city          || '',
      current_state:         profilePersonal.current_state         || '',
      current_country:       profilePersonal.current_country       || '',
      current_postal_code:   profilePersonal.current_postal_code   || '',
      permanent_address:     profilePersonal.permanent_address     || '',
      permanent_city:        profilePersonal.permanent_city        || '',
      permanent_state:       profilePersonal.permanent_state       || '',
      permanent_country:     profilePersonal.permanent_country     || '',
      permanent_postal_code: profilePersonal.permanent_postal_code || '',
    }));
  }, [profilePersonal]);

  const healthInited = useRef(false);
  useEffect(() => {
    if (!isEdit || healthInited.current || Object.keys(profileHealth).length === 0) return;
    healthInited.current = true;
    setForm(f => ({
      ...f,
      allergies:               profileHealth.allergies               || '',
      medical_conditions:      profileHealth.medical_conditions      || '',
      disabilities:            profileHealth.disabilities            || '',
      emergency_medical_notes: profileHealth.emergency_medical_notes || '',
    }));
  }, [profileHealth]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!isEdit) {
        // BUG_057: Validate Add Employee required fields
        if (!form.name.trim()) throw new Error('Full Name is required.');
        if (form.name.trim().length < 2) throw new Error('Full Name must be at least 2 characters.');
        if (!/[a-zA-Z]/.test(form.name.trim())) throw new Error('Full Name must contain at least one letter.');
        if (!form.email.trim()) throw new Error('Company Email is required.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) throw new Error('Company Email must be a valid email address.');
        if (!form.position.trim()) throw new Error('Job Title / Position is required.');
      } else {
        // First Name — required even in edit (display breaks without a name)
        if (!form.name?.trim()) throw new Error('First Name is required.');
        if (form.name.trim().length < 2) throw new Error('First Name must be at least 2 characters.');
        if (!/[a-zA-Z]/.test(form.name.trim())) throw new Error('First Name must contain at least one letter.');
        // Company Email — required and must be valid
        if (!form.email?.trim()) throw new Error('Company Email is required.');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) throw new Error('Company Email must be a valid email address.');
        // Mobile — strip formatting chars then check 10 digits
        if (form.phone?.trim()) {
          const mobileDigits = form.phone.replace(/\D/g, '');
          if (mobileDigits.length !== 10) throw new Error('Mobile number must be exactly 10 digits.');
        }
        // Personal Email
        if (form.personal_email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personal_email.trim())) {
          throw new Error('Personal Email must be a valid email address.');
        }
        // Password reset — enforce minimum length if a new password is entered
        if (form.password && form.password.length < 6) throw new Error('New password must be at least 6 characters.');
        // Date of Birth — no future dates
        if (form.date_of_birth && form.date_of_birth > new Date().toISOString().split('T')[0]) {
          throw new Error('Date of Birth cannot be in the future.');
        }
        // CTC — non-negative
        if (form.ctc !== '' && form.ctc != null && Number(form.ctc) < 0) throw new Error('CTC cannot be negative.');
        // Work hours — 1 to 24
        if (form.work_hours_per_day != null && form.work_hours_per_day !== '') {
          const wh = Number(form.work_hours_per_day);
          if (isNaN(wh) || wh < 1 || wh > 24) throw new Error('Work hours per day must be between 1 and 24.');
        }
        // Height / Weight — non-negative
        if (form.height !== '' && form.height != null && Number(form.height) < 0) throw new Error('Height cannot be negative.');
        if (form.weight !== '' && form.weight != null && Number(form.weight) < 0) throw new Error('Weight cannot be negative.');
      }
      if (isEdit) {
        const body = { ...form };
        if (!body.password) delete body.password;
        // Consolidate name: merge First + Middle + Last into a single name field
        // so all pages that display users.name show the full name.
        body.name        = [form.name, form.middle_name, form.surname].filter(s => s?.trim()).join(' ').trim();
        body.middle_name = form.middle_name?.trim() || null;
        body.surname     = form.surname?.trim()     || null;
        const [result] = await Promise.all([
          apiPut(`/employees/${employee.id}`, body),
          apiPut(`/profile/${employee.id}/personal`, {
            current_address_line1: form.current_address_line1,
            current_address_line2: form.current_address_line2,
            current_city:          form.current_city,
            current_state:         form.current_state,
            current_country:       form.current_country,
            current_postal_code:   form.current_postal_code,
            permanent_address:     form.permanent_address,
            permanent_city:        form.permanent_city,
            permanent_state:       form.permanent_state,
            permanent_country:     form.permanent_country,
            permanent_postal_code: form.permanent_postal_code,
          }).catch(() => {}),
          // Health upsert always writes all columns — include blood_group/height/weight
          // from the main form so they are not wiped to null.
          apiPut(`/profile/${employee.id}/health`, {
            blood_group:             form.blood_group,
            height:                  form.height,
            weight:                  form.weight,
            allergies:               form.allergies,
            medical_conditions:      form.medical_conditions,
            disabilities:            form.disabilities,
            emergency_medical_notes: form.emergency_medical_notes,
          }).catch(() => {}),
        ]);
        return result;
      }
      // Never send a client-supplied password for new employees.
      // The backend generates a secure temporary password and emails it to the employee.
      const { password: _ignored, ...addPayload } = form;
      return apiPost('/employees', addPayload);
    },
    onSuccess: (data) => {
      toast(isEdit ? 'Employee updated!' : 'Employee added! Redirecting to profile…', 'success');
      qc.invalidateQueries({ queryKey: ['employees'] });
      // Invalidate profile queries so EmployeeProfileV2 reflects changes immediately
      const empId = data?.id || employee?.id;
      if (empId) {
        qc.invalidateQueries({ queryKey: ['epv2-professional',       empId] });
        qc.invalidateQueries({ queryKey: ['epv2-overview',           empId] });
        qc.invalidateQueries({ queryKey: ['epv2-personal',           empId] });
        qc.invalidateQueries({ queryKey: ['epv2-health',             empId] });
        qc.invalidateQueries({ queryKey: ['emp-profile-personal-modal', empId] });
        qc.invalidateQueries({ queryKey: ['emp-profile-health-modal',   empId] });
      }
      onSaved?.();
      onClose();
      if (!isEdit && data?.id) {
        navigate(`${employeesBase}?view=${data.id}`);
      }
    },
    onError: err => toast(err.message, 'error'),
  });

  const sendCredsMut = useMutation({
    mutationFn: () => apiPost(`/employees/${employee.id}/send-credentials`, {}),
    onSuccess: (res) => {
      toast(`Login credentials sent to ${employee.email}`, 'success');
      setLastCredSentAt(res.last_credentials_sent_at || new Date().toISOString());
      setCredCooldown(true);
      setTimeout(() => setCredCooldown(false), 60000); // 60s cooldown
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e) => toast(e.message, 'error'),
  });

  // Fetch branches for extended profile
  const { data: _branchData = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => apiGet('/branches'),
  });
  const branches = Array.isArray(_branchData) ? _branchData : [];

  // Fetch designations filtered by selected department(s)
  const primaryDeptId = form.department_ids?.[0] || null;
  const { data: _desigData = [] } = useQuery({
    queryKey: ['designations', primaryDeptId],
    queryFn:  () => apiGet('/designations', primaryDeptId ? { department_id: primaryDeptId } : {}),
    staleTime: 2 * 60 * 1000,
  });
  const designations = Array.isArray(_desigData) ? _desigData : [];

  // Tab definitions (only for edit mode)
  const TABS = [
    { id: 'personal',   label: 'Personal'   },
    { id: 'employment', label: 'Employment' },
    { id: 'extended',   label: 'Extended'   },
    { id: 'salary',     label: 'Salary'     },
    { id: 'documents',  label: 'Documents'  },
    { id: 'account',    label: 'Account'    },
  ];

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit Employee — ${empFullName(employee)}` : 'Add Employee'} size="lg" disableOutsideClick
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending
              ? <span className="flex gap-2 items-center"><span className="spinner w-4 h-4" /> Saving…</span>
              : <><CheckCircle2 size={14} /> {isEdit ? 'Save Changes' : 'Add Employee'}</>}
          </button>
        </div>
      }
    >
      {/* ── Edit mode: tabbed layout ── */}
      {isEdit ? (
        <div>
          {/* Employee identity header with photo upload */}
          <AdminPhotoUpload
            employeeId={employee?.id}
            currentUrl={form.avatar_url || employee?.avatar_url || null}
            name={form.name}
            color={form.avatar_color}
            email={form.email}
            onUploaded={url => set('avatar_url', url)}
          />

          {/* Tab bar */}
          <div className="flex gap-1 bg-[#f0f3ff] p-1 rounded-xl border border-[#c7c4d8] mb-5">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 py-2 px-2 rounded-lg text-xs font-bold transition-all ${
                  tab === t.id ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Personal ── */}
          {tab === 'personal' && (
            <div className="space-y-5">

              {/* Name Details */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Name Details</p>
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="form-label">Salutation</label>
                    <select className="form-control" value={form.salutation} onChange={e => set('salutation', e.target.value)}>
                      <option value="">—</option>
                      <option value="Mr">Mr.</option>
                      <option value="Mrs">Mrs.</option>
                      <option value="Ms">Ms.</option>
                      <option value="Miss">Miss</option>
                      <option value="Dr">Dr.</option>
                      <option value="Prof">Prof.</option>
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="form-label">First Name <span className="text-rose-500">*</span></label>
                    <input className="form-control" placeholder="First name" value={form.name} onChange={e => set('name', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Middle Name</label>
                    <input className="form-control" placeholder="Middle name" value={form.middle_name} onChange={e => set('middle_name', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Last Name / Surname</label>
                    <input className="form-control" placeholder="Surname" value={form.surname} onChange={e => set('surname', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Contact */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Contact</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="form-label">Mobile</label>
                    <input className="form-control" type="tel" placeholder="10-digit mobile number" value={form.phone} onChange={e => set('phone', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Personal Email</label>
                    <input className="form-control" type="email" placeholder="personal@gmail.com" value={form.personal_email} onChange={e => set('personal_email', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="form-label">Company Email <span className="text-rose-500">*</span></label>
                  <input className="form-control" type="email" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>

              {/* Personal Information */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Personal Information</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="form-label">Date of Birth</label>
                    <input className="form-control" type="date" max={new Date().toISOString().split('T')[0]} value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Gender</label>
                    <select className="form-control" value={form.gender} onChange={e => set('gender', e.target.value)}>
                      <option value="">— Select —</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                    {form.gender === 'Other' && (
                      <input className="form-control mt-2" placeholder="Please specify gender" value={form.gender_specify || ''} onChange={e => set('gender_specify', e.target.value)} />
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Blood Group</label>
                    <select className="form-control" value={form.blood_group} onChange={e => set('blood_group', e.target.value)}>
                      <option value="">— Select —</option>
                      {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(bg => <option key={bg} value={bg}>{bg}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Marital Status</label>
                    <select className="form-control" value={form.marital_status} onChange={e => set('marital_status', e.target.value)}>
                      <option value="">— Select —</option>
                      <option value="Single">Single</option>
                      <option value="Married">Married</option>
                      <option value="Divorced">Divorced</option>
                      <option value="Widowed">Widowed</option>
                      <option value="Separated">Separated</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Background */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Background</p>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="form-label">Nationality</label>
                    <ComboInput
                      value={form.nationality}
                      onChange={v => set('nationality', v)}
                      placeholder="e.g. Indian"
                      options={['Indian','American','British','Canadian','Australian','Chinese','Japanese','South Korean','German','French','Italian','Spanish','Russian','Brazilian','Pakistani','Bangladeshi','Sri Lankan','Nepali','Maldivian','Bhutanese','South African','Other']}
                    />
                  </div>
                  <div>
                    <label className="form-label">Religion</label>
                    <select className="form-control" value={form.religion} onChange={e => set('religion', e.target.value)}>
                      <option value="">— Select —</option>
                      <option value="Hindu">Hindu</option>
                      <option value="Muslim">Muslim</option>
                      <option value="Christian">Christian</option>
                      <option value="Sikh">Sikh</option>
                      <option value="Buddhist">Buddhist</option>
                      <option value="Jain">Jain</option>
                      <option value="Parsi">Parsi (Zoroastrian)</option>
                      <option value="Jewish">Jewish</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="form-label">Citizenship</label>
                  <ComboInput
                    value={form.citizenship}
                    onChange={v => set('citizenship', v)}
                    placeholder="e.g. Indian"
                    options={['Indian','American','British','Canadian','Australian','Chinese','Japanese','South Korean','German','French','Other']}
                  />
                </div>
              </div>

              {/* Physical */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Physical Measurements</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Height</label>
                    <div className="relative">
                      <input className="form-control pr-10" type="number" step="0.01" min="0" placeholder="e.g. 170" value={form.height} onChange={e => set('height', e.target.value)} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.7rem] font-semibold text-[#777587]">cm</span>
                    </div>
                  </div>
                  <div>
                    <label className="form-label">Weight</label>
                    <div className="relative">
                      <input className="form-control pr-10" type="number" step="0.1" min="0" placeholder="e.g. 65" value={form.weight} onChange={e => set('weight', e.target.value)} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.7rem] font-semibold text-[#777587]">kg</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Current Address */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Current Address</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="form-label">Address Line 1</label>
                    <input className="form-control" placeholder="Street, area…" value={form.current_address_line1} onChange={e => set('current_address_line1', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <label className="form-label">Address Line 2</label>
                    <input className="form-control" placeholder="Building, landmark…" value={form.current_address_line2} onChange={e => set('current_address_line2', e.target.value)} />
                  </div>
                  <div><label className="form-label">City</label><input className="form-control" value={form.current_city} onChange={e => set('current_city', e.target.value)} /></div>
                  <div><label className="form-label">State</label><input className="form-control" value={form.current_state} onChange={e => set('current_state', e.target.value)} /></div>
                  <div><label className="form-label">Country</label><input className="form-control" value={form.current_country} onChange={e => set('current_country', e.target.value)} /></div>
                  <div><label className="form-label">Postal Code</label><input className="form-control" value={form.current_postal_code} onChange={e => set('current_postal_code', e.target.value)} /></div>
                </div>
              </div>

              {/* Permanent Address */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Permanent Address</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="form-label">Address</label>
                    <textarea className="form-control" rows={2} placeholder="Full address…" value={form.permanent_address} onChange={e => set('permanent_address', e.target.value)} />
                  </div>
                  <div><label className="form-label">City</label><input className="form-control" value={form.permanent_city} onChange={e => set('permanent_city', e.target.value)} /></div>
                  <div><label className="form-label">State</label><input className="form-control" value={form.permanent_state} onChange={e => set('permanent_state', e.target.value)} /></div>
                  <div><label className="form-label">Country</label><input className="form-control" value={form.permanent_country} onChange={e => set('permanent_country', e.target.value)} /></div>
                  <div><label className="form-label">Postal Code</label><input className="form-control" value={form.permanent_postal_code} onChange={e => set('permanent_postal_code', e.target.value)} /></div>
                </div>
              </div>

              {/* Health Information */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Health Information</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">Allergies</label>
                    <input className="form-control" placeholder="e.g. Penicillin, pollen" value={form.allergies} onChange={e => set('allergies', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Medical Conditions</label>
                    <input className="form-control" placeholder="e.g. Diabetes" value={form.medical_conditions} onChange={e => set('medical_conditions', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Disabilities</label>
                    <input className="form-control" value={form.disabilities} onChange={e => set('disabilities', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Emergency Medical Notes</label>
                    <input className="form-control" value={form.emergency_medical_notes} onChange={e => set('emergency_medical_notes', e.target.value)} />
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* ── Employment ── */}
          {tab === 'employment' && (
            <div className="space-y-4">
              <div>
                <label className="form-label">Departments <span className="text-xs font-normal text-[#777587]">(select one or more)</span></label>
                {departments.length === 0 ? (
                  <p className="text-xs text-[#777587] p-2">No departments — create from Departments page.</p>
                ) : (
                  <div className="border border-[#c7c4d8] rounded-lg p-2 max-h-32 overflow-y-auto bg-white space-y-1">
                    {departments.map(d => (
                      <label key={d.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-[#f0f3ff] cursor-pointer">
                        <input type="checkbox" className="accent-[#3525cd] w-3.5 h-3.5"
                          checked={form.department_ids.includes(d.id)} onChange={() => toggleDept(d.id)} />
                        <span className="text-sm text-[#151c27] font-medium">{d.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="form-label">Job Title / Position</label>
                <input className="form-control" placeholder="e.g. Senior Developer"
                  value={form.position} onChange={e => set('position', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Joining Date</label>
                <input className="form-control" type="date" value={form.joining_date} onChange={e => set('joining_date', e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="form-label">Employment Type</label>
                  <select className="form-control" value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                    <option value="consultant">Consultant</option>
                    <option value="probation">Probation</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Work Mode</label>
                  <select className="form-control" value={form.work_mode} onChange={e => set('work_mode', e.target.value)}>
                    <option value="office">Office</option>
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <select className="form-control" value={form.employee_status} onChange={e => set('employee_status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="probation">Probation</option>
                    <option value="inactive">Inactive</option>
                    <option value="resigned">Resigned</option>
                    <option value="terminated">Terminated</option>
                  </select>
                </div>
              </div>

              {/* ── Probation ── */}
              <div className="border border-[#e7eefe] rounded-xl p-4 space-y-4 bg-[#fafaff]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-[#151c27]">Probation Period</p>
                    <p className="text-[0.68rem] text-[#777587]">Automatically promotes to Full Time when probation ends</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newVal = !form.probation_applicable;
                      if (newVal) {
                        // Turning ON: force status to probation
                        set('probation_applicable', true);
                        set('employee_status', 'probation');
                      } else {
                        // Turning OFF: restore to the employee's original non-probation status
                        // (or 'active' for new employees / if original was already probation)
                        const fallback = (isEdit && employee?.employee_status && employee.employee_status !== 'probation')
                          ? employee.employee_status
                          : 'active';
                        set('probation_applicable', false);
                        set('employee_status', fallback);
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${form.probation_applicable ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${form.probation_applicable ? 'translate-x-4' : 'translate-x-1'}`} />
                  </button>
                </div>
                {form.probation_applicable && (
                  <div className="grid grid-cols-3 gap-4 pt-1">
                    <div>
                      <label className="form-label">Probation Period</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min={1} max={24}
                          className="form-control w-20 text-center"
                          value={form.probation_months || 3}
                          onChange={e => set('probation_months', Math.max(1, parseInt(e.target.value) || 3))}
                        />
                        <span className="text-xs text-[#777587]">months</span>
                      </div>
                    </div>
                    <div>
                      <label className="form-label">Start Date</label>
                      <input
                        className="form-control bg-[#f5f5f8] cursor-not-allowed text-[#777587]"
                        value={form.joining_date || '—'}
                        readOnly
                      />
                      <p className="text-[0.65rem] text-[#777587] mt-0.5">Auto-set from Joining Date</p>
                    </div>
                    <div>
                      <label className="form-label">End Date</label>
                      <input
                        className="form-control bg-[#f5f5f8] cursor-not-allowed text-[#777587]"
                        value={(() => {
                          if (!form.joining_date || !form.probation_months) return '—';
                          const d = new Date(form.joining_date + 'T12:00:00Z');
                          d.setMonth(d.getMonth() + (parseInt(form.probation_months) || 3));
                          return d.toISOString().split('T')[0];
                        })()}
                        readOnly
                      />
                      <p className="text-[0.65rem] text-[#777587] mt-0.5">Auto-calculated</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Extended Profile ── */}
          {tab === 'extended' && (
            <div className="space-y-5">
              <p className="text-xs text-[#777587] bg-[#f0f3ff] border border-[#e7eefe] rounded-lg px-3 py-2">
                Extended profile fields used for statutory compliance and biometric device integration.
              </p>

              {/* Branch + Grade */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Organisation</p>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="form-label">Branch</label>
                    <select className="form-control" value={form.branch_id} onChange={e => {
                      const bId = e.target.value;
                      set('branch_id', bId);
                      // Auto-populate Work Location from branch if location not manually overridden
                      const branch = branches.find(b => String(b.id) === String(bId));
                      if (branch?.location) set('location', branch.location);
                      else if (!bId) set('location', '');
                    }}>
                      <option value="">— No branch —</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}{b.location ? ` · ${b.location}` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Grade</label>
                    <input className="form-control" placeholder="e.g. A" value={form.grade} onChange={e => set('grade', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="form-label">Work Location</label>
                    <input className="form-control" placeholder="e.g. Ahmedabad, Gujarat"
                      value={form.location} onChange={e => set('location', e.target.value)} />
                  </div>
                  <div>
                    <label className="form-label">Division</label>
                    <input className="form-control" placeholder="e.g. Operations" value={form.division} onChange={e => set('division', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="form-label">Sub Division</label>
                    <input className="form-control" placeholder="e.g. Dispatch" value={form.sub_division} onChange={e => set('sub_division', e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Biometric — only shown if org has biometric feature enabled */}
              {hasBiometric && (
                <div>
                  <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Biometric Device</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="form-label">Device Enrollment ID / PIN</label>
                      <div className="relative">
                        <Fingerprint size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
                        <input className="form-control pl-8 font-mono" placeholder="e.g. 1001"
                          value={form.device_enrollment_id} onChange={e => set('device_enrollment_id', e.target.value)} />
                      </div>
                      {form.device_enrollment_id && (
                        <p className="text-[0.68rem] text-emerald-600 mt-1 font-semibold flex items-center gap-1">
                          <Fingerprint size={11} /> Biometric enrollment configured
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Work schedule */}
              <div>
                <p className="text-[0.7rem] font-black text-[#464555] uppercase tracking-wider mb-2">Work Schedule</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="form-label">Weekly Off Day</label>
                    <select className="form-control" value={form.weekly_off_day} onChange={e => set('weekly_off_day', e.target.value)}>
                      <option value="">— Default —</option>
                      {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">Work Hours / Day</label>
                    <input className="form-control" type="number" min={1} max={24} placeholder="8"
                      value={form.work_hours_per_day} onChange={e => set('work_hours_per_day', e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Salary ── */}
          {tab === 'salary' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="form-label">CTC (Annual)</label>
                  <input className="form-control" type="number" placeholder="e.g. 600000" value={form.ctc} onChange={e => set('ctc', e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Salary Effective Date</label>
                  <input className="form-control" type="date" value={form.salary_effective_date} onChange={e => set('salary_effective_date', e.target.value)} />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <p className="text-xs text-amber-700 font-semibold">Note: Detailed salary structure (HRA, PF, etc.) is managed in the Payroll section.</p>
              </div>
            </div>
          )}

          {/* ── Documents ── */}
          {tab === 'documents' && (
            <div>
              {empDocs.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-[#777587]">No documents uploaded by this employee yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {empDocs.map(doc => (
                    <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl border border-[#c7c4d8] bg-white hover:bg-[#f9f9ff] transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0 text-[#3525cd]">
                        <CalendarDays size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[#151c27] truncate">{doc.name}</p>
                        <p className="text-[0.65rem] text-[#9ca3af] capitalize">{doc.category?.replace(/_/g, ' ')}</p>
                      </div>
                      <a href={doc.file_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-[#3525cd] font-semibold hover:underline flex-shrink-0">View</a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Account ── */}
          {tab === 'account' && (
            <div className="space-y-4">
              <div>
                <label className="form-label">Role</label>
                <select className="form-control" value={form.role} onChange={e => set('role', e.target.value)}>
                  <option value="employee">Employee</option>
                  <option value="admin">HR Admin</option>
                  {isRootAdmin && <option value="root_admin">Root Admin</option>}
                </select>
              </div>
              <div>
                <label className="form-label">Avatar Color</label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {AVATAR_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => set('avatar_color', c)}
                      className="w-7 h-7 rounded-full border-2 flex-shrink-0"
                      style={{ background: c, borderColor: form.avatar_color === c ? '#3525cd' : 'transparent', outline: form.avatar_color === c ? '2px solid #BAE6FD' : 'none' }} />
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">Reset Password <span className="font-normal text-[#777587] normal-case text-xs">(leave blank to keep current)</span></label>
                <div className="relative">
                  {/* autoComplete="new-password" prevents browser autofill from targeting the search bar as the "username" field */}
                  <input className="form-control pr-10" type={showPw ? 'text' : 'password'}
                    placeholder="New password…"
                    autoComplete="new-password"
                    value={form.password} onChange={e => set('password', e.target.value)} />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27] p-1">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {/* ── Send Login Credentials ── */}
              <div className="border border-[#e7eefe] rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-[#f0f3ff] border-b border-[#e7eefe] flex items-center gap-2">
                  <ShieldCheck size={14} className="text-[#3525cd]" />
                  <span className="text-xs font-black text-[#3525cd] uppercase tracking-widest">Login Credentials</span>
                </div>
                <div className="px-4 py-4 space-y-3">
                  <p className="text-xs text-[#464555] leading-relaxed">
                    Generate a secure temporary password and email login details directly to the employee.
                    They will be required to set a new password on first login.
                  </p>
                  {lastCredSentAt && (
                    <p className="text-[0.68rem] text-[#777587]">
                      Last sent: <strong className="text-[#464555]">
                        {new Date(lastCredSentAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </strong>
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => sendCredsMut.mutate()}
                    disabled={sendCredsMut.isPending || credCooldown || !employee?.email}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'linear-gradient(135deg,#3525cd,#712ae2)', color: '#fff' }}
                  >
                    <Send size={14} />
                    {sendCredsMut.isPending ? 'Sending…' : credCooldown ? 'Sent — wait 60s' : 'Send Login Credentials'}
                  </button>
                  {!employee?.email && (
                    <p className="text-[0.68rem] text-rose-500">Employee must have an email address to send credentials.</p>
                  )}
                </div>
              </div>
              {/* Clockify User ID field removed — Clockify integration was removed 2026-07-22 */}
            </div>
          )}
        </div>

      ) : (
        /* ── Add Employee: streamlined form — no manual password entry ── */
        <div className="space-y-4">
          <p className="text-xs text-[#777587] bg-[#f0f3ff] border border-[#e7eefe] rounded-lg px-3 py-2">
            Fill in the essentials below. A secure temporary password will be generated automatically and emailed to the employee. After adding, you'll be taken to the employee profile to complete remaining details.
          </p>

          {/* Row 1: Full Name + Company Email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Full Name <span className="text-rose-500">*</span></label>
              <input className="form-control" placeholder="John Doe" value={form.name} onChange={e => set('name', e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Company Email <span className="text-rose-500">*</span></label>
              <input className="form-control" type="email" placeholder="john@company.com" autoComplete="off" value={form.email} onChange={e => set('email', e.target.value)} required />
            </div>
          </div>

          {/* Row 2: Department(s) multi-select */}
          <div>
            <label className="form-label">Department(s)</label>
            {departments.length === 0 ? (
              <div className="form-control text-[#777587] text-xs py-2">No departments — create from Departments page.</div>
            ) : (
              <div className="border border-[#c7c4d8] rounded-xl p-3 max-h-32 overflow-y-auto bg-white grid grid-cols-2 gap-0.5">
                {departments.map(d => (
                  <label key={d.id} className="flex items-center gap-2 cursor-pointer hover:bg-[#f0f3ff] rounded px-2 py-1 transition-colors">
                    <input type="checkbox" className="w-4 h-4 accent-[#3525cd] shrink-0"
                      checked={form.department_ids.includes(d.id)}
                      onChange={() => toggleDept(d.id)} />
                    <span className="text-sm truncate">{d.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Row 3: Job Title + Employment Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Job Title / Position <span className="text-rose-500">*</span></label>
              <input className="form-control" placeholder="e.g. Software Developer"
                value={form.position} onChange={e => set('position', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Employment Type</label>
              <select className="form-control" value={form.employment_type} onChange={e => set('employment_type', e.target.value)}>
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
                <option value="contract">Contract</option>
                <option value="intern">Intern</option>
                <option value="consultant">Consultant</option>
                <option value="probation">Probation</option>
              </select>
            </div>
          </div>

          {/* Row 4: Role */}
          <div>
            <label className="form-label">Role <span className="text-rose-500">*</span></label>
            <select className="form-control" value={form.role} onChange={e => set('role', e.target.value)}>
              <option value="employee">Employee</option>
              <option value="admin">HR Admin</option>
              {isRootAdmin && <option value="root_admin">Root Admin</option>}
            </select>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Employee status config ────────────────────────────────────────────────────
const EMP_STATUS_CFG = {
  active:        { label: 'Active',        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  on_leave:      { label: 'On Leave',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  probation:     { label: 'Probation',     cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  notice_period: { label: 'Notice Period', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  notice:        { label: 'Notice',        cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  inactive:      { label: 'Inactive',      cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  resigned:      { label: 'Resigned',      cls: 'bg-rose-50 text-rose-600 border-rose-200' },
  terminated:    { label: 'Terminated',    cls: 'bg-red-100 text-red-700 border-red-200' },
};

function AdminPhotoUpload({ employeeId, currentUrl, name, color, email, onUploaded }) {
  const toast    = useToast();
  const inputRef = useRef(null);
  const [preview,   setPreview]   = useState(currentUrl);
  const [uploading, setUploading] = useState(false);

  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB', 'error'); return; }
    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const fd    = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('lt_token') || sessionStorage.getItem('lt_token');
      const url   = employeeId ? `/api/employees/${employeeId}/avatar` : '/api/auth/upload-avatar';
      const res   = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data  = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setPreview(data.avatar_url);
      onUploaded?.(data.avatar_url);
      toast('Photo updated!', 'success');
    } catch (err) {
      toast(err.message, 'error');
      setPreview(currentUrl);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl bg-[#f0f3ff] border border-[#c7c4d8] mb-4">
      <div className="relative group flex-shrink-0">
        {preview ? (
          <img src={preview} alt={name} className="w-12 h-12 rounded-full object-cover border-2 border-white shadow" />
        ) : (
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-white font-black text-lg" style={{ background: color }}>
            {initials}
          </div>
        )}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          title="Upload photo"
        >
          {uploading ? <div className="spinner w-3.5 h-3.5 border-white" /> : <Camera size={13} className="text-white" />}
        </button>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-black text-[#151c27] truncate">{name || '—'}</p>
        <p className="text-xs text-[#777587] truncate">{email}</p>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="text-[0.65rem] text-[#3525cd] hover:underline mt-0.5">
          {uploading ? 'Uploading…' : preview ? 'Change photo' : 'Upload photo'}
        </button>
      </div>
    </div>
  );
}

function EmpStatusBadge({ status }) {
  const cfg = EMP_STATUS_CFG[status] || EMP_STATUS_CFG.active;
  return (
    <span className={`text-[0.62rem] font-bold px-1.5 py-0.5 rounded-full border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

// Compact leave balance chips — fetches per-employee, cached by React Query
function LeaveBalanceChips({ empId }) {
  const curYear = new Date().getFullYear();
  const { data } = useQuery({
    queryKey: ['emp-balance', empId, curYear],
    queryFn:  () => apiGet('/leaves/balance', { userId: empId, year: curYear }),
    staleTime: 5 * 60 * 1000,
  });
  const balances = (data?.balances || []).filter(b => b.leave_type !== 'wfh' && b.allocated > 0);
  if (!balances.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {balances.map(b => (
        <span key={b.leave_type}
          title={`${b.label}: ${b.remaining} / ${b.allocated} remaining`}
          className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full border ${
            b.remaining <= 0 ? 'bg-rose-50 text-rose-600 border-rose-200'
            : b.remaining <= 2 ? 'bg-amber-50 text-amber-700 border-amber-200'
            : 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]'
          }`}>
          {b.label.replace(' Leave','').replace('Leave','').trim()}: {b.remaining}
        </span>
      ))}
    </div>
  );
}

// Drawer leave balance — detailed Allocated / Used / Available using API
function DrawerLeaveBalance({ empId }) {
  const curYear = new Date().getFullYear();
  const { data, isLoading } = useQuery({
    queryKey: ['emp-balance', empId, curYear],
    queryFn:  () => apiGet('/leaves/balance', { userId: empId, year: curYear }),
    staleTime: 5 * 60 * 1000,
  });
  const balances = (data?.balances || []).filter(b => b.leave_type !== 'wfh' && b.allocated > 0);
  if (!isLoading && !balances.length) return null;
  return (
    <div className="px-5 py-4 border-b border-[#f0f3ff]">
      <p className="text-[0.65rem] font-black text-[#9ca3af] uppercase tracking-widest mb-3">Leave Balance {curYear}</p>
      {isLoading ? (
        <div className="flex justify-center py-3"><span className="w-4 h-4 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-3">
          {balances.map(b => (
            <div key={b.leave_type}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-[#464555]">{b.label}</span>
                <div className="flex items-center gap-2 text-[0.65rem]">
                  <span className="text-[#9ca3af]">Used: <strong className="text-[#464555]">{b.used}</strong></span>
                  <span className={`font-black ${b.remaining <= 0 ? 'text-rose-600' : b.remaining <= 2 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {b.remaining}/{b.allocated}
                  </span>
                </div>
              </div>
              <div className="w-full bg-[#f0f3ff] rounded-full h-1.5">
                <div className={`h-1.5 rounded-full transition-all ${
                  b.remaining <= 0 ? 'bg-rose-400' : b.remaining <= b.allocated * 0.25 ? 'bg-amber-400' : 'bg-[#3525cd]'
                }`} style={{ width: `${b.allocated > 0 ? Math.min(100, (b.remaining / b.allocated) * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtDateForCSV(dateStr) {
  if (!dateStr) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(String(dateStr).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return String(dateStr);
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function exportEmployeesCSV(rows, filename = 'employees.csv') {
  const headers = 'Name,Email,Department,Position,Employment Type,Status,Work Mode,Joining Date';
  const lines = rows.map(e =>
    [
      e.name,
      e.email,
      e.department,
      e.position,
      e.employment_type,
      e.employee_status || 'active',
      e.work_mode,
      fmtDateForCSV(e.joining_date),
    ]
      .map(v => `"${(v || '').toString().replace(/"/g, '""')}"`)
      .join(',')
  );
  const csv = [headers, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Main Employees Page ───────────────────────────────────────────────────────
export default function Employees() {
  const { user } = useAuth();
  const toast    = useToast();
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const { id: routeId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const employeesBase = location.pathname.startsWith('/root/') ? '/root/employees' : '/employees';

  // URL params
  const roleFilter    = searchParams.get('role');
  const actionParam   = searchParams.get('action');
  const viewParam     = searchParams.get('view');
  const joinedYmParam = searchParams.get('joined_ym'); // 'YYYY-MM' — filters to new joiners of that month
  // BUG_065: 'birthday' filter shows employees with birthdays today or in the next 30 days
  const filterParam   = searchParams.get('filter');

  // Modal / profile state
  const [profileEmp,     setProfileEmp]     = useState(null);
  const [cameFromUrl,    setCameFromUrl]    = useState(false);
  const [addOpen,          setAddOpen]          = useState(false);
  const [addDefaultRole,   setAddDefaultRole]   = useState('employee');
  const [editEmp,          setEditEmp]          = useState(null);
  const [editInitialTab,   setEditInitialTab]   = useState('personal');
  const [confirmDel,       setConfirmDel]       = useState(null);
  const [profileDrawerEmp, setProfileDrawerEmp] = useState(null);
  const [drawerTab,        setDrawerTab]        = useState('overview');

  function openProfile(emp) {
    navigate(`${employeesBase}/${emp.id}`);
    setProfileEmp(emp);
  }

  function handleEdit(emp, tab = 'personal') {
    // BUG_060: Map 'statutory' to 'extended' tab since statutory fields live in the Extended tab
    const TAB_MAP = { statutory: 'extended', compliance: 'extended' };
    setEditInitialTab(TAB_MAP[tab] || tab);
    setEditEmp(emp);
  }

  // BUG_059: detect if this is the root admin employees page
  const isRootPage = location.pathname.startsWith('/root/');

  // BUG_059: default status filter — show active + probation, hide inactive/resigned/terminated
  const DEFAULT_STATUS_FILTER = new Set(['active', 'probation']);

  // Search / filter / sort / view / selection state
  const [search,        setSearch]       = useState('');
  const [deptFilter,    setDeptFilter]   = useState('');
  // BUG_059: statusFilter is now a Set of selected statuses (default: active + probation)
  const [statusFilter,  setStatusFilter] = useState(DEFAULT_STATUS_FILTER);
  const [typeFilter,    setTypeFilter]   = useState('');
  const [sortBy,        setSortBy]       = useState('name');
  const [sortDir,      setSortDir]      = useState('asc');
  const [viewMode,     setViewMode]     = useState('card');
  const [selected,     setSelected]     = useState(new Set());
  const [page,         setPage]         = useState(1);
  const [pageSize,     setPageSize]     = useState(24);
  const [bulkDelConf,  setBulkDelConf]  = useState(false);
  const [isBulkDel,    setIsBulkDel]    = useState(false);

  // BUG_059: derive stable string keys from statusFilter (Set) for use in
  // useEffect / useMemo dependency arrays (Sets are compared by reference, not value).
  const statusFilterKey  = [...statusFilter].sort().join(',');
  const defaultStatusKey = [...DEFAULT_STATUS_FILTER].sort().join(',');

  // ── URL param effects (unchanged) ──────────────────────────────────────────
  useEffect(() => {
    if (actionParam === 'addHR') {
      setAddDefaultRole('admin');
      setAddOpen(true);
      setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('action'); return n; }, { replace: true });
    } else if (actionParam === 'add') {
      setAddDefaultRole('employee');
      setAddOpen(true);
      setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('action'); return n; }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionParam]);

  // BUG_059: pass include_inactive=true so the employee management page can see
  // all statuses and the HR team can explicitly filter for inactive/resigned/terminated.
  // Other pages (Calendar, TeamCalendar, etc.) do NOT pass this flag so they
  // automatically get only active+probation employees from the backend.
  const { data: allEmployees = [], isLoading } = useQuery({
    queryKey: ['employees', 'all', selectedBranchId],
    queryFn:  () => apiGet('/employees', { include_inactive: 'true' }),
    // Do not fire until branch context is fully initialized.
    // Prevents the window between page load and branch restoration where
    // selectedBranchId may not yet reflect the correct branch, causing
    // wrong data to be fetched and cached.
    enabled:  isBranchContextReady,
  });

  useEffect(() => {
    if (viewParam && allEmployees.length > 0) {
      const emp = allEmployees.find(e => String(e.id) === String(viewParam));
      if (emp) {
        navigate(`${employeesBase}/${emp.id}`, { replace: true });
        setProfileEmp(emp);
        setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('view'); return n; }, { replace: true });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam, allEmployees]);

  // Auto-open profile from URL :id param (handles refresh / direct links)
  useEffect(() => {
    if (!routeId || allEmployees.length === 0) return;
    const emp = allEmployees.find(e => String(e.id) === String(routeId));
    if (emp && (!profileEmp || String(profileEmp.id) !== String(routeId))) setProfileEmp(emp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId, allEmployees]);

  // Close profile when URL no longer has :id (browser back button)
  useEffect(() => {
    if (!routeId && profileEmp) setProfileEmp(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  useEffect(() => {
    if (profileEmp && allEmployees.length > 0) {
      const updated = allEmployees.find(e => e.id === profileEmp.id);
      if (updated) setProfileEmp(updated);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEmployees]);

  // Reset to page 1 when any filter / sort changes
  // BUG_059: use statusFilterKey (string) not statusFilter (Set) for stable comparison
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); setSelected(new Set()); },
    [search, deptFilter, statusFilterKey, typeFilter, sortBy, sortDir, pageSize, roleFilter, joinedYmParam, filterParam]);

  const { data: _dData = [] } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => apiGet('/departments'),
  });
  const departments = Array.isArray(_dData) ? _dData : [];

  const { data: _brData = [] } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => apiGet('/branches'),
  });
  const branchList = Array.isArray(_brData) ? _brData : [];

  // Drawer — attendance + leave data for the selected employee
  const _drawerNow = new Date();
  const _drawerYear  = _drawerNow.getFullYear();
  const _drawerMonth = _drawerNow.getMonth() + 1;
  const { data: drawerAtt = [] } = useQuery({
    queryKey: ['drawer-att', profileDrawerEmp?.id, _drawerYear, _drawerMonth],
    queryFn:  () => apiGet('/attendance', { year: _drawerYear, month: _drawerMonth, userId: profileDrawerEmp.id }),
    enabled:  !!profileDrawerEmp,
  });
  const { data: drawerLeaves = [] } = useQuery({
    queryKey: ['drawer-leaves', profileDrawerEmp?.id],
    queryFn:  () => apiGet('/leaves', { userId: profileDrawerEmp.id }),
    enabled:  !!profileDrawerEmp,
  });
  const { data: drawerPolicies = [] } = useQuery({
    queryKey: ['leave-policies'],
    queryFn:  () => apiGet('/leave-policies'),
    enabled:  !!profileDrawerEmp,
  });

  const deleteMut = useMutation({
    mutationFn: id => apiDelete(`/employees/${id}`),
    onSuccess: (_, id) => {
      const name = employees.find(e => e.id === id)?.name || 'Employee';
      toast(`${name} deleted`, 'warning');
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: err => toast(err.message, 'error'),
  });

  // ── Role-scoped base list ─────────────────────────────────────────────────
  const employees = roleFilter === 'admin'
    ? allEmployees.filter(e => e.role === 'admin')
    : allEmployees.filter(e => e.role === 'employee');

  // ── Filter options ────────────────────────────────────────────────────────
  const deptOptions = useMemo(() => {
    const s = new Set();
    employees.forEach(e => {
      if (e.department) s.add(e.department);
      e.departments?.forEach(d => s.add(d.name));
    });
    return [...s].sort();
  }, [employees]);

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = employees;
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(e =>
        e.name?.toLowerCase().includes(q) ||
        e.email?.toLowerCase().includes(q) ||
        e.department?.toLowerCase().includes(q) ||
        e.position?.toLowerCase().includes(q)
      );
    }
    if (deptFilter)   rows = rows.filter(e =>
      e.department === deptFilter || e.departments?.some(d => d.name === deptFilter));
    // BUG_059: statusFilter is a Set; filter rows whose status is in the selected set.
    // If the set matches the default (active+probation) we still apply it so inactive
    // employees are hidden unless explicitly selected.
    if (statusFilter && statusFilter.size > 0) {
      rows = rows.filter(e => statusFilter.has(e.employee_status || 'active'));
    }
    if (typeFilter)   rows = rows.filter(e => (e.employment_type || '').toLowerCase().replace(/[\s\-]/g, '_') === typeFilter);
    if (joinedYmParam) {
      const [yr, mo] = joinedYmParam.split('-').map(Number);
      rows = rows.filter(e => {
        const d = new Date(e.created_at);
        return d.getFullYear() === yr && d.getMonth() === mo - 1;
      });
    }
    // BUG_065: filter to employees whose birthday is today or within the next 30 days
    if (filterParam === 'birthday') {
      const today = new Date();
      rows = rows.filter(e => {
        if (!e.date_of_birth) return false;
        const parts = e.date_of_birth.split('-');
        if (parts.length < 3) return false;
        const bMonth = parts[1];
        const bDay   = parts[2].slice(0, 2);
        const nextBday = new Date(today.getFullYear(), parseInt(bMonth, 10) - 1, parseInt(bDay, 10));
        if (nextBday < today) nextBday.setFullYear(today.getFullYear() + 1);
        const daysUntil = Math.round((nextBday - today) / 86400000);
        return daysUntil <= 30;
      });
    }
    return [...rows].sort((a, b) => {
      const av = (a[sortBy] || '').toString().toLowerCase();
      const bv = (b[sortBy] || '').toString().toLowerCase();
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  // BUG_059: stable string key for statusFilter (Set → sorted CSV) so useMemo and
  // useEffect dependency arrays compare by value, not by object reference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, search, deptFilter, statusFilterKey, typeFilter, sortBy, sortDir, joinedYmParam, filterParam]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(filtered.length / pageSize);
  const pageRows   = filtered.slice((page - 1) * pageSize, page * pageSize);
  // BUG_059: anyFilter — status is "filtered" only when selection differs from the default (active+probation)
  const anyFilter  = search || deptFilter || statusFilterKey !== defaultStatusKey || typeFilter || joinedYmParam || filterParam;

  // ── Bulk selection helpers ────────────────────────────────────────────────
  const allPageSelected = pageRows.length > 0 && pageRows.every(e => selected.has(e.id));

  function toggleAll() {
    setSelected(s => {
      const n = new Set(s);
      if (allPageSelected) pageRows.forEach(e => n.delete(e.id));
      else pageRows.forEach(e => n.add(e.id));
      return n;
    });
  }
  function toggleOne(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleBulkDelete() {
    setIsBulkDel(true);
    let count = 0;
    try {
      for (const id of selected) {
        await apiDelete(`/employees/${id}`);
        count++;
      }
      toast(`${count} employee${count !== 1 ? 's' : ''} deleted`, 'warning');
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['employees'] });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setIsBulkDel(false);
      setBulkDelConf(false);
    }
  }

  function handleDelete(emp) { setConfirmDel({ id: emp.id, name: empFullName(emp) }); }

  function toggleSortBy(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  }

  // ── Profile view ──────────────────────────────────────────────────────────
  if (profileEmp) {
    return (
      <>
        <EmployeeProfileV2 emp={profileEmp} onBack={() => { setProfileEmp(null); navigate(employeesBase); }} onEdit={handleEdit} />
        {editEmp && (
          <EmployeeFormModal open={!!editEmp} onClose={() => { setEditEmp(null); setEditInitialTab('personal'); }}
            employee={editEmp} departments={departments} initialTab={editInitialTab} />
        )}
      </>
    );
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-14 bg-white rounded-xl border border-[#c7c4d8] animate-pulse" />
        <div className="h-12 bg-white rounded-xl border border-[#c7c4d8] animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm animate-pulse overflow-hidden">
              <div className="bg-[#f0f3ff] px-5 pt-5 pb-4 flex items-center gap-3.5">
                <div className="w-14 h-14 rounded-full bg-[#e7eefe] flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-[#e7eefe] rounded w-3/4" />
                  <div className="h-3 bg-[#e7eefe] rounded w-1/2" />
                  <div className="h-3 bg-[#e7eefe] rounded w-1/4" />
                </div>
              </div>
              <div className="px-5 py-3.5 space-y-2">
                <div className="h-3 bg-[#f0f3ff] rounded w-full" />
                <div className="h-3 bg-[#f0f3ff] rounded w-3/4" />
              </div>
              <div className="px-4 py-3 border-t border-[#e7eefe] flex gap-2">
                <div className="flex-1 h-8 bg-[#e7eefe] rounded-lg" />
                <div className="w-10 h-8 bg-[#e7eefe] rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── PAGE HEADER ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="page-title flex items-center gap-2">
            Team Members
            {roleFilter === 'admin' && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full border bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8] normal-case tracking-normal">
                HR Admins only
              </span>
            )}
          </div>
          <div className="page-subtitle flex items-center gap-2 flex-wrap">
            {filtered.length} of {employees.length} member{employees.length !== 1 ? 's' : ''}
            {anyFilter && <span className="text-[#3525cd] font-semibold">(filtered)</span>}
            {joinedYmParam && (
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                New joiners: {new Date(joinedYmParam + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                <button onClick={() => setSearchParams(p => { const n = new URLSearchParams(p); n.delete('joined_ym'); return n; }, { replace: true })}
                  className="hover:text-emerald-900">×</button>
              </span>
            )}
            {roleFilter === 'admin' && (
              <button onClick={() => setSearchParams({}, { replace: true })}
                className="text-xs text-[#3525cd] hover:underline font-semibold">
                Clear role filter
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => exportEmployeesCSV(filtered)}>
            <Download size={14} /> Export CSV
          </button>
          <button className="btn btn-primary" onClick={() => { setAddDefaultRole('employee'); setAddOpen(true); }}>
            <Plus size={16} /> Add Employee
          </button>
        </div>
      </div>

      {/* ── TOOLBAR: search + filters + sort + view ────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm px-4 py-3 flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            type="text"
            placeholder="Search by name, email, dept…"
            autoComplete="off"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="form-control pl-8 py-1.5 text-xs w-full" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#464555]">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Department — hidden for root admin page (BUG_059) */}
        {!isRootPage && (
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="form-control w-auto text-xs py-1.5">
            <option value="">All Departments</option>
            {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        )}


        {/* Employee Status — multi-select dropdown (BUG_059)
            Active + Probation are selected by default; Inactive/Resigned/Terminated
            are hidden by default and only shown when explicitly checked. */}
        {(() => {
          const ALL_EMP_STATUSES = [
            { value: 'active',     label: 'Active'     },
            { value: 'probation',  label: 'Probation'  },
            { value: 'inactive',   label: 'Inactive'   },
            { value: 'resigned',   label: 'Resigned'   },
            { value: 'terminated', label: 'Terminated' },
          ];
          const activeCount = statusFilter.size;
          const label = activeCount === ALL_EMP_STATUSES.length
            ? 'All Statuses'
            : activeCount === 0
              ? 'No Status'
              : activeCount <= 2
                ? [...statusFilter].map(s => ALL_EMP_STATUSES.find(o => o.value === s)?.label || s).join(', ')
                : `${activeCount} Statuses`;

          function toggleStatus(val) {
            setStatusFilter(prev => {
              const next = new Set(prev);
              next.has(val) ? next.delete(val) : next.add(val);
              return next;
            });
          }
          return (
            <div className="relative group">
              <button
                className="form-control w-auto text-xs py-1.5 flex items-center gap-1.5 cursor-pointer select-none"
                type="button"
                tabIndex={0}
              >
                <Filter size={11} className="text-[#777587] flex-shrink-0" />
                <span className="truncate max-w-[130px]">{label}</span>
                <ChevronDown size={11} className="text-[#777587] flex-shrink-0 ml-0.5" />
              </button>
              {/* Dropdown panel — visible on group hover/focus */}
              <div className="absolute top-full left-0 mt-1 z-50 hidden group-hover:block group-focus-within:block bg-white border border-[#c7c4d8] rounded-xl shadow-lg py-1.5 min-w-[160px]">
                {ALL_EMP_STATUSES.map(({ value, label: lbl }) => (
                  <label key={value}
                    className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#f0f3ff] text-xs text-[#464555] select-none">
                    <input
                      type="checkbox"
                      checked={statusFilter.has(value)}
                      onChange={() => toggleStatus(value)}
                      className="accent-[#3525cd] w-3.5 h-3.5"
                    />
                    {lbl}
                  </label>
                ))}
                <div className="border-t border-[#f0f3ff] mt-1 pt-1 px-3 pb-0.5 flex gap-2">
                  <button
                    className="text-[0.65rem] font-bold text-[#3525cd] hover:underline"
                    onClick={() => setStatusFilter(new Set(ALL_EMP_STATUSES.map(o => o.value)))}
                    type="button">All</button>
                  <button
                    className="text-[0.65rem] font-bold text-[#3525cd] hover:underline"
                    onClick={() => setStatusFilter(DEFAULT_STATUS_FILTER)}
                    type="button">Default</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Employment type */}
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          className="form-control w-auto text-xs py-1.5">
          <option value="">All Types</option>
          {['full_time', 'part_time', 'contract', 'intern'].map(t => (
            <option key={t} value={t}>{t.replace('_', ' ')}</option>
          ))}
        </select>

        {/* Sort */}
        <select value={`${sortBy}:${sortDir}`}
          onChange={e => { const [col, dir] = e.target.value.split(':'); setSortBy(col); setSortDir(dir); }}
          className="form-control w-auto text-xs py-1.5">
          <option value="name:asc">Name A–Z</option>
          <option value="name:desc">Name Z–A</option>
          <option value="joining_date:desc">Newest Joined</option>
          <option value="joining_date:asc">Oldest Joined</option>
        </select>

        {anyFilter && (
          <button onClick={() => {
            setSearch(''); setDeptFilter(''); setBranchFilter('');
            setStatusFilter(DEFAULT_STATUS_FILTER); // BUG_059: reset to default, not empty
            setTypeFilter('');
            if (joinedYmParam) setSearchParams(p => { const n = new URLSearchParams(p); n.delete('joined_ym'); return n; }, { replace: true });
          }}
            className="flex items-center gap-1 text-xs font-bold text-rose-500 hover:text-rose-600 px-2 py-1.5 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all">
            <X size={12} /> Clear
          </button>
        )}

        {/* View toggle */}
        <div className="ml-auto flex bg-[#f0f3ff] border border-[#c7c4d8] p-0.5 rounded-lg gap-0.5">
          <button onClick={() => setViewMode('card')}
            className={`p-1.5 rounded transition-all ${viewMode === 'card' ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'}`}>
            <LayoutGrid size={15} />
          </button>
          <button onClick={() => setViewMode('table')}
            className={`p-1.5 rounded transition-all ${viewMode === 'table' ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'}`}>
            <LayoutList size={15} />
          </button>
        </div>

        {/* Page size */}
        <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
          className="form-control w-auto text-xs py-1.5">
          {[12, 24, 48].map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
      </div>

      {/* ── BULK ACTION TOOLBAR ───────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="bg-[#3525cd] rounded-xl px-5 py-3 flex items-center gap-3 flex-wrap shadow-md">
          <span className="text-sm font-black text-white">
            {selected.size} selected
          </span>
          <button onClick={() => setSelected(new Set())}
            className="text-xs font-bold text-white/70 hover:text-white transition-colors">
            Deselect all
          </button>
          {/* ENH_EMP_002: Bulk change Department/Status/Type */}
          <div className="flex items-center gap-2 flex-wrap">
            <select className="text-xs font-bold rounded-lg px-2 py-1.5 border border-white/30 bg-white/15 text-white"
              defaultValue=""
              onChange={async e => {
                const dept = e.target.value; if (!dept) return; e.target.value = '';
                const ids = [...selected];
                await Promise.all(ids.map(id => apiPut(`/employees/${id}`, { department: dept })));
                toast(`Department updated for ${ids.length} employees`, 'success');
                qc.invalidateQueries({ queryKey: ['employees'] });
              }}>
              <option value="" disabled>Change Dept…</option>
              {[...new Set(employees.map(e => e.department).filter(Boolean))].sort().map(d => <option key={d} value={d} className="text-[#151c27]">{d}</option>)}
            </select>
            <select className="text-xs font-bold rounded-lg px-2 py-1.5 border border-white/30 bg-white/15 text-white"
              defaultValue=""
              onChange={async e => {
                const status = e.target.value; if (!status) return; e.target.value = '';
                const ids = [...selected];
                await Promise.all(ids.map(id => apiPut(`/employees/${id}`, { employee_status: status })));
                toast(`Status updated for ${ids.length} employees`, 'success');
                qc.invalidateQueries({ queryKey: ['employees'] });
              }}>
              <option value="" disabled>Change Status…</option>
              {['active','probation','inactive','terminated','resigned'].map(s => <option key={s} value={s} className="text-[#151c27] capitalize">{s}</option>)}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => exportEmployeesCSV(employees.filter(e => selected.has(e.id)), 'selected_employees.csv')}
              className="flex items-center gap-1.5 text-xs font-bold bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg border border-white/30 transition-all">
              <Download size={13} /> Export Selected
            </button>
            <button
              onClick={() => setBulkDelConf(true)}
              disabled={isBulkDel}
              className="flex items-center gap-1.5 text-xs font-bold bg-rose-500 hover:bg-rose-600 text-white px-3 py-1.5 rounded-lg transition-all disabled:opacity-50">
              <Trash2 size={13} /> Delete Selected
            </button>
          </div>
        </div>
      )}

      {/* ── EMPTY STATE ───────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm py-16 text-center">
          <Users size={40} className="text-[#c7c4d8] mx-auto mb-3" />
          <p className="text-sm font-semibold text-[#464555]">
            {anyFilter ? 'No employees match your filters' : 'No employees yet'}
          </p>
          <p className="text-xs text-[#9ca3af] mt-1">
            {anyFilter
              ? 'Try clearing some filters to see more results.'
              : 'Add your first employee to get started.'}
          </p>
          {anyFilter && (
            <button onClick={() => {
              setSearch(''); setDeptFilter(''); setBranchFilter('');
              setStatusFilter(DEFAULT_STATUS_FILTER); // BUG_059: reset to default
              setTypeFilter('');
            }}
              className="mt-3 text-xs font-bold text-[#3525cd] hover:underline">
              Clear all filters
            </button>
          )}
        </div>
      ) : viewMode === 'card' ? (

        /* ── CARD VIEW ───────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {pageRows.map(emp => (
            <div key={emp.id}
              className="relative group bg-white rounded-xl border border-[#c7c4d8] shadow-sm flex flex-col overflow-hidden transition-all duration-200 hover:shadow-md hover:border-[#3525cd]/40 hover:-translate-y-0.5">

              {/* Checkbox */}
              <div
                className={`absolute top-3 left-3 z-10 transition-opacity duration-150 ${selected.has(emp.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={e => { e.stopPropagation(); toggleOne(emp.id); }}>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-all ${selected.has(emp.id) ? 'bg-[#3525cd] border-[#3525cd]' : 'bg-white border-[#c7c4d8] hover:border-[#3525cd]'}`}>
                  {selected.has(emp.id) && <Check size={11} className="text-white" />}
                </div>
              </div>

              {/* Header */}
              <div className="bg-gradient-to-br from-[#f0f3ff] to-[#e7eefe] px-5 pt-5 pb-4 flex items-center gap-3.5 cursor-pointer"
                onClick={() => openProfile(emp)}>
                <Avatar name={empFullName(emp)} color={emp.avatar_color} size={50} className="ring-2 ring-white shadow-sm flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-black text-[#151c27] text-sm leading-tight truncate">{empFullName(emp)}</div>
                  <div className="text-xs font-medium text-[#464555] truncate mt-0.5">{emp.position || '—'}</div>
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <EmpStatusBadge status={emp.employee_status} />
                    {emp.employment_type && (
                      <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-white/70 text-[#464555] border border-[#c7c4d8] capitalize">
                        {emp.employment_type.replace('_', ' ')}
                      </span>
                    )}
                    {emp.device_enrollment_id && (
                      <span title={`Biometric PIN: ${emp.device_enrollment_id}`}
                        className="w-4 h-4 rounded-full bg-[#3525cd]/10 flex items-center justify-center">
                        <Fingerprint size={10} className="text-[#3525cd]" />
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="px-5 py-3 space-y-1.5 flex-1 cursor-pointer" onClick={() => openProfile(emp)}>
                {(emp.departments?.length > 0 || emp.department) && (
                  <div className="flex items-start gap-2">
                    <Building2 size={13} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {emp.departments?.length > 0
                        ? emp.departments.map(d => (
                            <span key={d.id} className="text-[0.65rem] font-bold px-1.5 py-0.5 rounded-md bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">
                              {d.name}
                            </span>
                          ))
                        : <span className="text-xs font-semibold text-[#151c27] truncate">{emp.department}</span>
                      }
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Mail size={13} className="text-[#3525cd] flex-shrink-0" />
                  <span className="text-xs text-[#464555] truncate">{emp.email}</span>
                </div>
                {emp.joining_date && (
                  <div className="flex items-center gap-2">
                    <CalendarDays size={13} className="text-[#3525cd] flex-shrink-0" />
                    <span className="text-xs text-[#464555]">Joined {fmtDate(emp.joining_date)}</span>
                  </div>
                )}
                <LeaveBalanceChips empId={emp.id} />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 px-4 py-3 border-t border-[#e7eefe] bg-[#f9f9ff]" onClick={e => e.stopPropagation()}>
                <button
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg text-xs font-bold text-[#464555] bg-white border border-[#c7c4d8] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/50 transition-all"
                  onClick={() => openProfile(emp)}>
                  <User size={12} /> View
                </button>
                <button
                  className="py-2 px-3 rounded-lg text-xs font-bold text-[#3525cd] bg-white border border-[#c7c4d8] hover:bg-[#f0f3ff] hover:border-[#3525cd]/50 transition-all"
                  onClick={() => openProfile(emp)}>
                  <Pencil size={12} />
                </button>
                {emp.id !== user?.id && (
                  <button
                    className="py-2 px-3 rounded-lg text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-all disabled:opacity-40"
                    onClick={() => handleDelete(emp)}
                    disabled={deleteMut.isPending}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

      ) : (

        /* ── TABLE VIEW ──────────────────────────────────────────────────── */
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <div onClick={toggleAll}
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all mx-auto ${allPageSelected ? 'bg-[#3525cd] border-[#3525cd]' : 'border-[#c7c4d8] hover:border-[#3525cd]'}`}>
                      {allPageSelected && <Check size={10} className="text-white" />}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <button onClick={() => toggleSortBy('name')} className="flex items-center gap-1 text-xs font-black text-[#464555] uppercase tracking-wider hover:text-[#3525cd] transition-colors">
                      Employee <ArrowUpDown size={11} className={sortBy === 'name' ? 'text-[#3525cd]' : 'text-[#c7c4d8]'} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] uppercase tracking-wider whitespace-nowrap">Employee ID</th>
                  <th className="px-4 py-3 text-left">
                    <button onClick={() => toggleSortBy('department')} className="flex items-center gap-1 text-xs font-black text-[#464555] uppercase tracking-wider hover:text-[#3525cd] transition-colors">
                      Department <ArrowUpDown size={11} className={sortBy === 'department' ? 'text-[#3525cd]' : 'text-[#c7c4d8]'} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <button onClick={() => toggleSortBy('position')} className="flex items-center gap-1 text-xs font-black text-[#464555] uppercase tracking-wider hover:text-[#3525cd] transition-colors whitespace-nowrap">
                      Role / Designation <ArrowUpDown size={11} className={sortBy === 'position' ? 'text-[#3525cd]' : 'text-[#c7c4d8]'} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Branch</th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] uppercase tracking-wider whitespace-nowrap">Leave Balance</th>
                  <th className="px-4 py-3 text-left">
                    <button onClick={() => toggleSortBy('joining_date')} className="flex items-center gap-1 text-xs font-black text-[#464555] uppercase tracking-wider hover:text-[#3525cd] transition-colors whitespace-nowrap">
                      Joining Date <ArrowUpDown size={11} className={sortBy === 'joining_date' ? 'text-[#3525cd]' : 'text-[#c7c4d8]'} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {pageRows.map(emp => (
                  <tr key={emp.id} className="hover:bg-[#f9f9ff] transition-colors group">
                    <td className="px-4 py-3 w-10">
                      <div onClick={() => toggleOne(emp.id)}
                        className={`w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-all mx-auto ${selected.has(emp.id) ? 'bg-[#3525cd] border-[#3525cd]' : 'border-[#c7c4d8] hover:border-[#3525cd]'}`}>
                        {selected.has(emp.id) && <Check size={10} className="text-white" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 cursor-pointer" onClick={() => { setProfileDrawerEmp(emp); setDrawerTab('overview'); }}>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={empFullName(emp)} color={emp.avatar_color} size={34} />
                        <div>
                          <p className="font-bold text-[#151c27] text-sm leading-tight group-hover:text-[#3525cd] transition-colors">{empFullName(emp)}</p>
                          <p className="text-xs text-[#9ca3af] truncate max-w-[160px]">{emp.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-[#777587] whitespace-nowrap">
                      {emp.device_enrollment_id || `EMP${String(emp.id).padStart(3, '0')}`}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#464555]">
                      {emp.departments?.length > 0
                        ? emp.departments.map(d => d.name).join(', ')
                        : emp.department || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#464555]">{emp.position || '—'}</td>
                    <td className="px-4 py-3 text-xs text-[#464555]">
                      {emp.branch_id ? (branchList.find(b => b.id === emp.branch_id)?.name || '—') : '—'}
                    </td>
                    <td className="px-4 py-3"><EmpStatusBadge status={emp.employee_status} /></td>
                    <td className="px-4 py-3"><LeaveBalanceChips empId={emp.id} /></td>
                    <td className="px-4 py-3 text-xs text-[#464555] whitespace-nowrap">
                      {emp.joining_date ? fmtDate(emp.joining_date) : '—'}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="relative group/menu flex justify-center">
                        <button className="p-1.5 rounded-lg text-[#777587] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors">
                          <MoreHorizontal size={15} />
                        </button>
                        <div className="absolute right-0 top-8 w-40 bg-white rounded-xl border border-[#c7c4d8] shadow-lg z-10 hidden group-hover/menu:block py-1">
                          <button onClick={() => { setProfileDrawerEmp(emp); setDrawerTab('overview'); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors">
                            <User size={12} /> View Profile
                          </button>
                          <button onClick={() => openProfile(emp)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors">
                            <Pencil size={12} /> Edit Employee
                          </button>
                          {emp.id !== user?.id && (
                            <button onClick={() => handleDelete(emp)} disabled={deleteMut.isPending}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40">
                              <Trash2 size={12} /> Delete
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PAGINATION ────────────────────────────────────────────────────── */}
      {filtered.length > pageSize && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-[#c7c4d8] shadow-sm px-5 py-3">
          <span className="text-xs text-[#777587] font-semibold">
            Page {page} of {totalPages} · {filtered.length} total
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page === 1}
              className="p-1.5 rounded-lg hover:bg-[#f0f3ff] text-[#3525cd] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${p === page ? 'bg-[#3525cd] text-white' : 'hover:bg-[#f0f3ff] text-[#464555]'}`}>
                  {p}
                </button>
              );
            })}
            <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
              className="p-1.5 rounded-lg hover:bg-[#f0f3ff] text-[#3525cd] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── MODALS ────────────────────────────────────────────────────────── */}
      {addOpen && (
        <EmployeeFormModal open={addOpen} onClose={() => { setAddOpen(false); setAddDefaultRole('employee'); }} departments={departments} defaultRole={addDefaultRole} />
      )}
      {editEmp && (
        <EmployeeFormModal open={!!editEmp} onClose={() => setEditEmp(null)} employee={editEmp} departments={departments} />
      )}

      {/* Single delete confirmation */}
      <ConfirmModal
        open={!!confirmDel}
        title="Delete Employee"
        message={`Are you sure you want to delete ${confirmDel?.name}? This will permanently remove all their attendance records, leave history, and associated data. This action cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => { deleteMut.mutate(confirmDel.id); setConfirmDel(null); }}
        onCancel={() => setConfirmDel(null)}
      />

      {/* Bulk delete confirmation */}
      <ConfirmModal
        open={bulkDelConf}
        title={`Delete ${selected.size} Employee${selected.size !== 1 ? 's' : ''}`}
        message={`You are about to permanently delete ${selected.size} employee${selected.size !== 1 ? 's' : ''} along with all their attendance records, leave history, and associated data. This action cannot be undone.`}
        confirmLabel={isBulkDel ? 'Deleting…' : `Delete ${selected.size}`}
        onConfirm={handleBulkDelete}
        onCancel={() => setBulkDelConf(false)}
      />

      {/* ── Employee Profile Drawer (table view) ──────────────────────────── */}
      {profileDrawerEmp && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setProfileDrawerEmp(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm bg-white shadow-2xl flex flex-col h-full overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer header */}
            {/* ── Drawer header ── */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f0f3ff]">
              <p className="text-sm font-black text-[#151c27]">Employee Profile</p>
              <button onClick={() => setProfileDrawerEmp(null)}
                className="p-1.5 rounded-lg text-[#777587] hover:text-rose-500 hover:bg-rose-50 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto">
              {/* Avatar + Name block */}
              <div className="px-5 py-5 flex flex-col items-center text-center gap-3 border-b border-[#f0f3ff]">
                <Avatar name={profileDrawerEmp.name} color={profileDrawerEmp.avatar_color} size={64} />
                <div>
                  <p className="text-base font-black text-[#151c27]">{profileDrawerEmp.name}</p>
                  {profileDrawerEmp.position && (
                    <p className="text-xs text-[#777587] mt-0.5">{profileDrawerEmp.position}</p>
                  )}
                  <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                    <EmpStatusBadge status={profileDrawerEmp.employee_status} />
                    {profileDrawerEmp.employment_type && (
                      <span className="text-[0.65rem] font-bold px-2.5 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#e7eefe] capitalize">
                        {profileDrawerEmp.employment_type.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                  {/* Department badges */}
                  {profileDrawerEmp.departments?.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-center mt-1.5">
                      {profileDrawerEmp.departments.map(d => (
                        <span key={d.id} className="text-[0.65rem] font-bold px-2 py-0.5 rounded-md bg-[#f0f3ff] text-[#3525cd] border border-[#e7eefe]">{d.name}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Tabs ── */}
              <div className="flex border-b border-[#f0f3ff] px-4">
                {[
                  { key: 'overview',   label: 'Overview'   },
                  { key: 'attendance', label: 'Attendance'  },
                  { key: 'documents',  label: 'Documents'   },
                ].map(t => (
                  <button key={t.key} onClick={() => setDrawerTab(t.key)}
                    className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors whitespace-nowrap ${drawerTab === t.key ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-[#777587] hover:text-[#464555]'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* ── Overview tab ── */}
              {drawerTab === 'overview' && (() => {
                const branchName = profileDrawerEmp.branch_id
                  ? (branchList.find(b => b.id === profileDrawerEmp.branch_id)?.name || '—')
                  : '—';
                const empIdFormatted = `EMP${String(profileDrawerEmp.id).padStart(3, '0')}`;
                const deptName = profileDrawerEmp.departments?.map(d => d.name).join(', ') || profileDrawerEmp.department || '—';

                // Leave balance calculation
                const approvedLeaves = drawerLeaves.filter(l => l.status === 'approved' && l.leave_type !== 'wfh' && l.leave_time !== 'wfh');
                const activePolicies = drawerPolicies.filter(p => p.active && p.annual_quota > 0 && ['casual','sick','annual','emergency'].includes(p.leave_type));
                const leaveBalance = activePolicies.map(p => {
                  const used = approvedLeaves.filter(l => l.leave_type === p.leave_type)
                    .reduce((s, l) => s + (l.leave_time === 'half' ? 0.5 : countWorkingDaysInRange(l.start_date, l.end_date)), 0);
                  return { type: p.leave_type, quota: p.annual_quota, used, remaining: Math.max(0, p.annual_quota - used) };
                });

                return (
                  <div>
                    {/* Contact Information */}
                    <div className="px-5 py-4 border-b border-[#f0f3ff]">
                      <p className="text-[0.65rem] font-black text-[#9ca3af] uppercase tracking-widest mb-3">Contact Information</p>
                      <div className="space-y-2.5">
                        {profileDrawerEmp.email && (
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                              <Mail size={13} className="text-[#3525cd]" />
                            </div>
                            <p className="text-xs text-[#151c27] break-all">{profileDrawerEmp.email}</p>
                          </div>
                        )}
                        {profileDrawerEmp.phone && (
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                              <Phone size={13} className="text-[#3525cd]" />
                            </div>
                            <p className="text-xs text-[#151c27]">{profileDrawerEmp.phone}</p>
                          </div>
                        )}
                        {profileDrawerEmp.joining_date && (
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                              <CalendarDays size={13} className="text-[#3525cd]" />
                            </div>
                            <p className="text-xs text-[#151c27]">Joined on {fmtDate(profileDrawerEmp.joining_date)}</p>
                          </div>
                        )}
                        {branchName !== '—' && (
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                              <MapPin size={13} className="text-[#3525cd]" />
                            </div>
                            <p className="text-xs text-[#151c27]">{branchName}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Work Information */}
                    <div className="px-5 py-4 border-b border-[#f0f3ff]">
                      <p className="text-[0.65rem] font-black text-[#9ca3af] uppercase tracking-widest mb-3">Work Information</p>
                      <div className="space-y-2">
                        {[
                          { label: 'Employee ID',       value: empIdFormatted },
                          { label: 'Department',        value: deptName },
                          { label: 'Role / Designation', value: profileDrawerEmp.position || '—' },
                          { label: 'Employee Type',     value: profileDrawerEmp.employment_type?.replace(/_/g, ' ') || '—' },
                          { label: 'Work Mode',         value: profileDrawerEmp.work_mode?.replace(/_/g, ' ') || '—' },
                          { label: 'Grade',             value: profileDrawerEmp.grade || '—' },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex items-start justify-between gap-2">
                            <span className="text-xs text-[#9ca3af] flex-shrink-0">{label}</span>
                            <span className="text-xs font-semibold text-[#151c27] text-right capitalize">{value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Leave Balance — uses API balance (includes HR adjustments) */}
                    <DrawerLeaveBalance empId={profileDrawerEmp.id} />
                  </div>
                );
              })()}

              {/* ── Attendance tab ── */}
              {drawerTab === 'attendance' && (() => {
                const present  = drawerAtt.filter(a => a.status === 'present' || a.status === 'wfh').length;
                const onLeave  = drawerAtt.filter(a => a.status === 'on_leave').length;
                const absent   = drawerAtt.filter(a => a.status === 'absent').length;
                const halfDay  = drawerAtt.filter(a => a.status === 'half_day').length;
                const totalDays = drawerAtt.length;
                return (
                  <div className="px-5 py-4">
                    <p className="text-[0.65rem] font-black text-[#9ca3af] uppercase tracking-widest mb-4">
                      Attendance Summary (This Month)
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'Present',   value: present,  color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
                        { label: 'Leaves',    value: onLeave,  color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-100'   },
                        { label: 'Absent',    value: absent,   color: 'text-rose-600',    bg: 'bg-rose-50',    border: 'border-rose-100'    },
                        { label: 'Half Days', value: halfDay,  color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-100'    },
                      ].map(({ label, value, color, bg, border }) => (
                        <div key={label} className={`${bg} border ${border} rounded-xl p-3 text-center`}>
                          <p className={`text-xl font-black ${color}`}>{value}</p>
                          <p className="text-[0.65rem] font-bold text-[#777587] mt-0.5">{label}</p>
                        </div>
                      ))}
                    </div>
                    {totalDays === 0 && (
                      <p className="text-xs text-[#9ca3af] text-center mt-4">No attendance data for this month.</p>
                    )}
                  </div>
                );
              })()}

              {/* ── Documents tab ── */}
              {drawerTab === 'documents' && (
                <div className="px-5 py-8 flex flex-col items-center justify-center text-center gap-2">
                  <FileText size={32} className="text-[#c7c4d8]" />
                  <p className="text-sm font-semibold text-[#464555]">View full profile for documents</p>
                  <p className="text-xs text-[#9ca3af]">Click "View Full Profile" below to see all uploaded documents.</p>
                </div>
              )}
            </div>

            {/* ── Footer actions ── */}
            <div className="px-5 py-4 border-t border-[#f0f3ff] bg-[#f9f9ff] flex gap-2.5">
              <button
                onClick={() => { openProfile(profileDrawerEmp); setProfileDrawerEmp(null); }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-[#c7c4d8] text-[#464555] hover:bg-[#f0f3ff] transition-colors"
              >
                <Eye size={13} /> View Full Profile
              </button>
              <button
                onClick={() => { setEditEmp(profileDrawerEmp); setEditInitialTab('personal'); setProfileDrawerEmp(null); }}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#3525cd] text-white hover:bg-[#2a1eb0] transition-colors shadow-sm"
              >
                <Pencil size={13} /> Edit Employee
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
