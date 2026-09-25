import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download, BarChart3, Users, FileText, CalendarDays, TrendingUp,
  Search, Filter, X, ChevronUp, ChevronDown, Printer,
  CheckCircle2, Clock, AlertCircle, UserCheck, Umbrella,
  Building2, ArrowUpDown, ChevronRight, Fingerprint, Pencil, Calendar,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { MONTHS } from '@/lib/utils';
import { useBranch } from '@/context/BranchContext';
import { useAuth } from '@/context/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { AttCorrectionModal } from '@/components/AttendanceDayModal';
import { OrgCalendarPanel } from '@/components/OrgCalendarPanel';

// ── Helpers ────────────────────────────────────────────────────────────────────
function cn(...classes) { return classes.filter(Boolean).join(' '); }

const ATT_STATUS_STYLE = {
  present:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  early_leave:      'bg-orange-50 text-orange-700 border-orange-200',
  wfh:              'bg-indigo-50 text-indigo-700 border-indigo-200',
  work_from_home:   'bg-indigo-50 text-indigo-700 border-indigo-200',
  half_day:         'bg-amber-50 text-amber-700 border-amber-200',
  on_leave:         'bg-rose-50 text-rose-600 border-rose-200',
  absent:           'bg-slate-50 text-slate-500 border-slate-200',
  holiday:          'bg-violet-50 text-violet-700 border-violet-200',
  off_day:          'bg-slate-100 text-slate-500 border-slate-200',
};
const LEAVE_STATUS_STYLE = {
  approved:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  rejected:  'bg-rose-50 text-rose-600 border-rose-200',
  cancelled: 'bg-slate-50 text-slate-500 border-slate-200',
};
const LEAVE_TYPE_STYLE = {
  casual:    'bg-teal-50 text-teal-700',
  sick:      'bg-red-50 text-red-700',
  annual:    'bg-[#f0f3ff] text-[#3525cd]',
  emergency: 'bg-orange-50 text-orange-700',
  wfh:       'bg-indigo-50 text-indigo-700',
  other:     'bg-slate-50 text-slate-600',
};
const EMP_STATUS_STYLE = {
  active:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive: 'bg-slate-50 text-slate-500 border-slate-200',
  resigned: 'bg-rose-50 text-rose-600 border-rose-200',
};

function Badge({ text, styleMap, fallback = 'bg-slate-50 text-slate-500 border-slate-200' }) {
  return (
    <span className={cn('text-[0.68rem] font-bold px-2 py-0.5 rounded-full border capitalize', styleMap?.[text] || fallback)}>
      {text || '—'}
    </span>
  );
}

// ── Sort helpers ───────────────────────────────────────────────────────────────
function SortIcon({ col, sort }) {
  if (sort.col !== col) return <ArrowUpDown size={11} className="text-[#c7c4d8] flex-shrink-0" />;
  return sort.dir === 'asc'
    ? <ChevronUp size={11} className="text-[#3525cd] flex-shrink-0" />
    : <ChevronDown size={11} className="text-[#3525cd] flex-shrink-0" />;
}

function SortTh({ col, sort, onSort, children, className = '' }) {
  return (
    <th className={cn('px-4 py-3 text-left whitespace-nowrap', className)}>
      <button onClick={() => onSort(col)}
        className="flex items-center gap-1 text-xs font-black text-[#464555] uppercase tracking-wider hover:text-[#3525cd] transition-colors">
        {children} <SortIcon col={col} sort={sort} />
      </button>
    </th>
  );
}

function sortRows(rows, sort) {
  if (!sort.col) return rows;
  return [...rows].sort((a, b) => {
    const av = (a[sort.col] ?? '').toString().toLowerCase();
    const bv = (b[sort.col] ?? '').toString().toLowerCase();
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sort.dir === 'asc' ? cmp : -cmp;
  });
}

// ── KPI card ───────────────────────────────────────────────────────────────────
// BUG_124: isActive prop shows visual ring when this card's filter is active
function KpiCard({ label, value, icon, accent, sub, onClick, isActive }) {
  return (
    <div onClick={onClick}
      className={cn('bg-white rounded-xl border shadow-sm p-4 border-t-4 transition-all duration-200',
        accent,
        isActive ? 'border-[#3525cd] ring-2 ring-[#3525cd]/20 shadow-md' : 'border-[#c7c4d8]',
        onClick && 'cursor-pointer hover:shadow-md hover:-translate-y-0.5')}>
      <div className="flex items-start justify-between mb-2">
        <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', accent.replace('border-t-', 'bg-').replace('-500', '-50').replace('-400', '-50').replace('[#3525cd]', '[#f0f3ff]').replace('[#712ae2]', '[#f5f0ff]'))}>
          {icon}
        </div>
        {isActive && <span className="text-[0.6rem] font-bold text-[#3525cd] bg-[#f0f3ff] px-1.5 py-0.5 rounded-full">Active</span>}
      </div>
      <p className="text-2xl font-black text-[#151c27] leading-tight">{value ?? '—'}</p>
      <p className="text-xs text-[#777587] mt-0.5 font-medium">{label}</p>
      {sub && <p className="text-[0.65rem] text-emerald-600 font-semibold mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Download modal ─────────────────────────────────────────────────────────────
function DownloadModal({ open, onClose, active, onDownload }) {
  const now = new Date();
  const [type,  setType]  = useState('monthly');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  function handleDownload() {
    onDownload(type === 'monthly' ? { year, month } : { year });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Export Report" size="sm"
      footer={
        <div className="flex justify-end gap-2 flex-wrap">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-secondary" onClick={() => { window.print(); onClose(); }}>
            <Printer size={14} /> Print / PDF
          </button>
          <button className="btn btn-primary" onClick={handleDownload}>
            <Download size={14} /> Download CSV
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <label className="form-label">Period Type</label>
          <div className="flex gap-2">
            {['monthly', 'yearly'].map(t => (
              <button key={t} onClick={() => setType(t)}
                className={cn('flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition-all capitalize',
                  type === t ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/50')}>
                {t}
              </button>
            ))}
          </div>
        </div>
        {type === 'monthly' && (
          <div>
            <label className="form-label">Month</label>
            <select className="form-control" value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="form-label">Year</label>
          <select className="form-control" value={year} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <p className="text-xs text-[#777587] bg-[#f9f9ff] rounded-lg p-3 border border-[#f0f3ff]">
          {type === 'monthly'
            ? `Will export ${active} data for ${MONTHS[month - 1]} ${year}`
            : `Will export ${active} data for the full year ${year}`}
        </p>
      </div>
    </Modal>
  );
}

// ── Punch Log expansion row (biometric orgs only) ─────────────────────────────
function PunchLogRow({ employee_pin, user_id, date, name, colSpan }) {
  // Prefer direct employee_pin (device_enrollment_id) — bypasses biometric_employee_map entirely
  const pinParam = employee_pin || null;
  const { data, isLoading } = useQuery({
    queryKey: ['punch-logs-row', pinParam || user_id, date],
    queryFn:  () => apiGet('/biometric/logs', {
      ...(pinParam ? { employee_pin: pinParam } : { user_id }),
      date_from: date,
      date_to:   date,
      limit:     100,
    }),
    enabled: !!(pinParam || user_id) && !!date,
  });

  const logs = Array.isArray(data?.data) ? data.data : Array.isArray(data?.logs) ? data.logs : Array.isArray(data) ? data : [];

  function fmtPunchTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    const hh = h % 12 || 12;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return `${hh}:${mm}:${ss} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  return (
    <tr className="bg-[#f8f9ff]">
      <td colSpan={colSpan} className="px-6 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Fingerprint size={13} className="text-[#3525cd]" />
          <span className="text-[0.7rem] font-black text-[#3525cd] uppercase tracking-wider">
            Biometric Punches — {name} on {date}
          </span>
        </div>
        {isLoading ? (
          <p className="text-xs text-[#777587]">Loading punch records…</p>
        ) : logs.length === 0 ? (
          <p className="text-xs text-[#777587]">No punch records found for this day.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {logs.map((log, i) => {
              const isIn = String(log.punch_type ?? log.punch_state ?? '').toLowerCase().includes('in') ||
                           [0, '0', 'checkin', 'check-in'].includes(log.punch_type ?? log.punch_state);
              return (
                <span key={i} className={cn(
                  'inline-flex items-center gap-1.5 text-[0.68rem] font-bold px-2.5 py-1 rounded-full border',
                  isIn ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'
                )}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', isIn ? 'bg-emerald-500' : 'bg-rose-400')} />
                  {isIn ? 'In' : 'Out'} · {fmtPunchTime(log.punch_time || log.timestamp)}
                  {log.employee_pin && <span className="text-[0.6rem] opacity-60 ml-0.5">#{log.employee_pin}</span>}
                </span>
              );
            })}
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Pagination bar ─────────────────────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function Pagination({ page, totalPages, totalCount, pageSize, onPageChange, onPageSize, label = 'records' }) {
  const delta = 2;
  const start = Math.max(1, page - delta);
  const end   = Math.min(totalPages, page + delta);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const btn   = 'w-7 h-7 rounded-lg text-xs font-bold border transition-colors';
  const idle  = 'border-[#c7c4d8] text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd]';
  const from  = Math.min((page - 1) * pageSize + 1, totalCount);
  const to    = Math.min(page * pageSize, totalCount);
  return (
    <div className="px-4 py-3 border-t border-[#f0f3ff] bg-[#f9f9ff] flex items-center justify-between gap-3 flex-wrap">
      {/* Left: showing X–Y of Z + page size selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-[#777587]">
          Showing <span className="font-bold text-[#464555]">{from}–{to}</span> of <span className="font-bold text-[#464555]">{totalCount}</span> {label}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#777587]">Show</span>
          {PAGE_SIZE_OPTIONS.map(n => (
            <button key={n} onClick={() => onPageSize(n)}
              className={cn('px-2 py-0.5 rounded-md text-xs font-bold border transition-all',
                pageSize === n
                  ? 'bg-[#3525cd] text-white border-[#3525cd]'
                  : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd] hover:text-[#3525cd]'
              )}>
              {n}
            </button>
          ))}
        </div>
      </div>
      {/* Right: page buttons — only shown when more than 1 page */}
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => onPageChange(page - 1)} disabled={page === 1}
            className={cn(btn, idle, 'flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed')}>
            ‹
          </button>
          {start > 1 && (
            <>
              <button onClick={() => onPageChange(1)} className={cn(btn, idle)}>1</button>
              {start > 2 && <span className="text-xs text-[#777587] px-0.5">…</span>}
            </>
          )}
          {pages.map(p => (
            <button key={p} onClick={() => onPageChange(p)}
              className={cn(btn, p === page ? 'bg-[#3525cd] text-white border-[#3525cd]' : idle)}>
              {p}
            </button>
          ))}
          {end < totalPages && (
            <>
              {end < totalPages - 1 && <span className="text-xs text-[#777587] px-0.5">…</span>}
              <button onClick={() => onPageChange(totalPages)} className={cn(btn, idle)}>{totalPages}</button>
            </>
          )}
          <button onClick={() => onPageChange(page + 1)} disabled={page === totalPages}
            className={cn(btn, idle, 'flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed')}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Reports page ──────────────────────────────────────────────────────────
export default function Reports() {
  const now = new Date();
  const { selectedBranchId, isBranchContextReady } = useBranch();
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const preselectedUserId = searchParams.get('userId') || '';
  // When navigating from Calendar → View Attendance, month and year are passed as URL params
  const preselectedMonth = parseInt(searchParams.get('month')) || null;
  const preselectedYear  = parseInt(searchParams.get('year'))  || null;
  const preselectedSection = searchParams.get('section') || null;

  // ── Filters & UI state ────────────────────────────────────────────────────────
  const [active,          setActive]          = useState(preselectedSection || 'attendance');
  const [viewMode,        setViewMode]        = useState('monthly');
  const [year,            setYear]            = useState(preselectedYear  || now.getFullYear());
  const [month,           setMonth]           = useState(preselectedMonth || now.getMonth() + 1);
  const [selectedEmpId,   setSelectedEmpId]   = useState(preselectedUserId);
  const [calModalOpen,    setCalModalOpen]    = useState(false);
  const [deptFilter,      setDeptFilter]      = useState('');
  const [statusFilter,    setStatusFilter]    = useState('');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('');
  const [attStatusFilter, setAttStatusFilter] = useState('');
  const [empTypeFilter,   setEmpTypeFilter]   = useState('');
  const [sort,            setSort]            = useState({ col: 'date', dir: 'desc' });
  const [page,            setPage]            = useState(1);
  const [pageSize,        setPageSize]        = useState(25);
  const [dlOpen,          setDlOpen]          = useState(false);
  // Biometric punch log expansion (Relitrade / first_in_last_out orgs only)
  // Use attendance record id as key — user_id can be null causing all rows to expand
  const [expandedRowId,   setExpandedRowId]   = useState(null);
  // Attendance correction modal — { emp: { id, name }, record: { id, check_in, … }, dateStr }
  const [editTarget,      setEditTarget]      = useState(null);
  // EHN_RA_002: Saved filter views (localStorage)
  const SAVED_VIEWS_KEY = 'reports_saved_views';
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]'); } catch { return []; }
  });
  function saveCurrentView(name) {
    const view = { name, active, deptFilter, statusFilter, leaveTypeFilter, attStatusFilter, empTypeFilter, selectedEmpId };
    const updated = [...savedViews.filter(v => v.name !== name), view];
    setSavedViews(updated);
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(updated));
  }
  function loadView(view) {
    setActive(view.active);
    setDeptFilter(view.deptFilter || '');
    setStatusFilter(view.statusFilter || '');
    setLeaveTypeFilter(view.leaveTypeFilter || '');
    setAttStatusFilter(view.attStatusFilter || '');
    setEmpTypeFilter(view.empTypeFilter || '');
    setSelectedEmpId(view.selectedEmpId || '');
  }
  function deleteView(name) { const updated = savedViews.filter(v => v.name !== name); setSavedViews(updated); localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(updated)); }

  function handleTabChange(tab) {
    setActive(tab);
    setSelectedEmpId('');
    setDeptFilter('');
    setStatusFilter('');
    setLeaveTypeFilter('');
    setAttStatusFilter('');
    setEmpTypeFilter('');
    setPage(1);
    setSort(tab === 'employees' ? { col: 'name', dir: 'asc' } : { col: 'date', dir: 'desc' });
  }

  function toggleSort(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
    setPage(1);
  }

  // Reset page whenever filters or period changes
  useEffect(() => { setPage(1); }, [selectedEmpId, deptFilter, statusFilter, leaveTypeFilter, attStatusFilter, empTypeFilter, active, viewMode, year, month, pageSize]);

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === now.getMonth() + 1 && year === now.getFullYear()) return;
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }
  const atCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();

  // ── Data queries ──────────────────────────────────────────────────────────────
  const queryParams = viewMode === 'monthly' ? { year, month } : { year };

  const { data: headcount } = useQuery({
    queryKey: ['headcount', selectedBranchId],
    queryFn:  () => apiGet('/reports/headcount'),
    enabled:  isBranchContextReady,
  });

  const { data: _attResponse = {}, isLoading: attLoading } = useQuery({
    queryKey: viewMode === 'yearly' ? ['report-attendance', 'yearly', year, selectedBranchId] : ['report-attendance', 'monthly', year, month, selectedBranchId],
    queryFn:  () => apiGet('/reports/attendance', queryParams),
    enabled:  isBranchContextReady,
  });

  const { data: _lvData = [], isLoading: lvLoading } = useQuery({
    queryKey: viewMode === 'yearly' ? ['report-leaves', 'yearly', year, selectedBranchId] : ['report-leaves', 'monthly', year, month, selectedBranchId],
    queryFn:  () => apiGet('/reports/leaves', queryParams),
    enabled:  isBranchContextReady,
  });

  const { data: _empData = [], isLoading: empLoading } = useQuery({
    queryKey: ['report-employees', selectedBranchId],
    queryFn:  () => apiGet('/reports/employees'),
    enabled:  isBranchContextReady,
  });

  // Support both legacy array response and new { data, meta } shape
  const attRows = Array.isArray(_attResponse)
    ? _attResponse
    : (_attResponse?.data || []);
  const attMeta   = _attResponse?.meta || {};
  const isFiloOrg = attMeta.attendance_policy === 'first_in_last_out';
  // shift weekoff dates per user_id: { [userId]: [dateStr, ...] }
  const shiftWeekoffByUser  = attMeta.shift_weekoff_by_user  || {};
  // DOWs that are payroll weekoffs (e.g. [0,6] for sat_sun) — used to skip synthetic absent
  const payrollWeekendDowsArr = attMeta.payroll_weekend_dows || [];
  const payrollWeekendDows  = useMemo(() => new Set(payrollWeekendDowsArr), [JSON.stringify(payrollWeekendDowsArr)]);
  const leaveRows = Array.isArray(_lvData) ? _lvData : [];
  const empRows   = Array.isArray(_empData) ? _empData : [];

  // ── Work schedule (for full calendar) ─────────────────────────────────────────
  const { data: _wsData } = useQuery({
    queryKey: ['work-schedule'],
    queryFn:  () => apiGet('/settings'),
    staleTime: 300000,
  });

  // ── Holidays for the selected year (for full calendar holiday detection) ───────
  const { data: _holData = [] } = useQuery({
    queryKey: ['holidays-report', year],
    queryFn:  () => apiGet('/holidays', { year }),
    staleTime: 300000,
  });
  const holidayDateSet = useMemo(() => {
    const s = new Set();
    for (const h of Array.isArray(_holData) ? _holData : []) s.add(h.date);
    return s;
  }, [_holData]);
  const workDays = useMemo(() => {
    const wd = _wsData?.schedule?.work_days;
    if (!wd) return [1, 2, 3, 4, 5]; // Mon–Fri default
    return wd.split(',').map(Number);
  }, [_wsData]);

  // Selected employee's name — used to match leave rows (which carry name, not id)
  const selectedEmpName = useMemo(
    () => empRows.find(e => String(e.id) === selectedEmpId)?.name || '',
    [empRows, selectedEmpId]
  );

  // Full calendar: all working days for the selected employee/month, with statuses filled in.
  // Approved leaves override absent; shift weekoffs show as off_day; past days with no record → absent.
  const fullCalendarRows = useMemo(() => {
    if (!selectedEmpId || active !== 'attendance' || viewMode !== 'monthly') return null;
    const emp = empRows.find(e => String(e.id) === selectedEmpId);
    if (!emp) return null;

    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Shift weekoff dates for this employee (from backend meta)
    const empShiftWeekoffs = new Set(shiftWeekoffByUser[selectedEmpId] || []);

    // Map date → attendance record
    const attMap = new Map();
    for (const r of attRows) {
      if (String(r.user_id) === selectedEmpId) attMap.set(r.date, r);
    }

    // Map date → leave status (approved leaves only, expand date ranges)
    const leaveMap = new Map();
    for (const lv of leaveRows) {
      if (lv.name !== selectedEmpName || lv.status !== 'approved') continue;
      const s = new Date(lv.start_date + 'T12:00:00Z');
      const e = new Date(lv.end_date   + 'T12:00:00Z');
      const cur = new Date(s);
      while (cur <= e) {
        const ds = cur.toISOString().split('T')[0];
        if (!leaveMap.has(ds)) {
          leaveMap.set(ds, lv.leave_type === 'wfh' ? 'wfh' : 'on_leave');
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }

    const daysInMonth = new Date(year, month, 0).getDate();
    const result = [];

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dow  = date.getDay(); // 0=Sun … 6=Sat
      const ds   = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      // Shift weekoff OR payroll-weekend DOW (e.g. Saturday for sat_sun policy):
      // Show 'off_day' — consistent with payroll engine (0 LOP).
      const isWeekoff = empShiftWeekoffs.has(ds) || payrollWeekendDows.has(dow);
      if (isWeekoff) {
        const att = attMap.get(ds);
        // If actual record exists use it (backend already overrides status to off_day);
        // otherwise synthesise an off_day row — never synthesise absent.
        result.push(att || {
          id: `synth-offday-${ds}`, name: emp.name, department: emp.department,
          date: ds, status: 'off_day', user_id: Number(selectedEmpId),
          check_in: null, check_out: null, work_hours: 0, gross_hours: 0,
        });
        continue;
      }

      if (!workDays.includes(dow)) continue; // skip org-level non-working days

      const att = attMap.get(ds);
      if (att) { result.push(att); continue; }

      const leaveStatus = leaveMap.get(ds);
      if (leaveStatus) {
        result.push({
          id: `synth-leave-${ds}`, name: emp.name, department: emp.department,
          date: ds, status: leaveStatus, user_id: Number(selectedEmpId),
          check_in: null, check_out: null, work_hours: 0, gross_hours: 0,
        });
        continue;
      }

      // Past day with no record — show as holiday if configured, else absent
      if (date < today) {
        const isHoliday = holidayDateSet.has(ds);
        result.push({
          id:         isHoliday ? `synth-holiday-${ds}` : `synth-absent-${ds}`,
          name:       emp.name,
          department: emp.department,
          date:       ds,
          status:     isHoliday ? 'holiday' : 'absent',
          user_id:    Number(selectedEmpId),
          check_in: null, check_out: null, work_hours: 0, gross_hours: 0,
        });
      }
    }
    return result;
  }, [selectedEmpId, selectedEmpName, active, viewMode, year, month, attRows, leaveRows, empRows, workDays, holidayDateSet, shiftWeekoffByUser, payrollWeekendDows]);

  // Effective rows — full calendar when employee selected, otherwise full dataset (filtered by employee if set)
  const effectiveAttRows = useMemo(() => {
    if (fullCalendarRows) return fullCalendarRows;
    if (selectedEmpId) return attRows.filter(r => String(r.user_id) === selectedEmpId);
    return attRows;
  }, [fullCalendarRows, attRows, selectedEmpId]);

  const effectiveLeaveRows = useMemo(() =>
    selectedEmpName ? leaveRows.filter(r => r.name === selectedEmpName) : leaveRows,
  [leaveRows, selectedEmpName]);

  const effectiveEmpRows = useMemo(() =>
    selectedEmpId ? empRows.filter(r => String(r.id) === selectedEmpId) : empRows,
  [empRows, selectedEmpId]);

  // ── Derived filter options ────────────────────────────────────────────────────
  const deptOptions = useMemo(() => {
    const src = active === 'attendance' ? attRows : active === 'leaves' ? leaveRows : empRows;
    return [...new Set(src.map(r => r.department).filter(Boolean))].sort();
  }, [active, attRows, leaveRows, empRows]);

  // ── Filtered + sorted rows ────────────────────────────────────────────────────
  const filteredAtt = useMemo(() => {
    let rows = effectiveAttRows;
    if (deptFilter)     rows = rows.filter(r => r.department === deptFilter);
    if (attStatusFilter === 'productive') {
      rows = rows.filter(r => ['present', 'early_leave', 'wfh', 'half_day'].includes(r.status));
    } else if (attStatusFilter) {
      rows = rows.filter(r => r.status === attStatusFilter);
    }
    return sortRows(rows, sort);
  }, [effectiveAttRows, deptFilter, attStatusFilter, sort]);

  const filteredLeave = useMemo(() => {
    let rows = effectiveLeaveRows;
    if (deptFilter)      rows = rows.filter(r => r.department === deptFilter);
    if (statusFilter === 'all_pending') {
      rows = rows.filter(r => ['pending', 'pending_dept', 'pending_root', 'pending_approval'].includes(r.status));
    } else if (statusFilter) {
      rows = rows.filter(r => r.status === statusFilter);
    }
    if (leaveTypeFilter) {
      const types = leaveTypeFilter.split(',').filter(Boolean);
      if (types.length > 0) rows = rows.filter(r => types.includes(r.leave_type));
    }
    return sortRows(rows, sort);
  }, [effectiveLeaveRows, deptFilter, statusFilter, leaveTypeFilter, sort]);

  const filteredEmp = useMemo(() => {
    let rows = effectiveEmpRows;
    if (deptFilter)   rows = rows.filter(r => r.department === deptFilter);
    if (statusFilter) rows = rows.filter(r => (r.employment_status || 'active') === statusFilter);
    if (empTypeFilter) rows = rows.filter(r => r.employment_type === empTypeFilter);
    return sortRows(rows, sort);
  }, [effectiveEmpRows, deptFilter, statusFilter, empTypeFilter, sort]);

  const activeRows  = active === 'attendance' ? filteredAtt : active === 'leaves' ? filteredLeave : filteredEmp;
  const isLoading   = active === 'attendance' ? attLoading : active === 'leaves' ? lvLoading : empLoading;
  const totalPages  = Math.max(1, Math.ceil(activeRows.length / pageSize));
  const safePage    = Math.min(page, totalPages);
  const displayRows = activeRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ── KPI cards per tab ─────────────────────────────────────────────────────────
  // BUG_124: helper to clear all other filters before setting a status filter
  function clearAndSetAttFilter(value) {
    setDeptFilter('');
    setAttStatusFilter(prev => prev === value ? '' : value);
  }
  function clearAndSetLeaveFilter(value) {
    setDeptFilter('');
    setLeaveTypeFilter('');
    setStatusFilter(prev => prev === value ? '' : value);
  }

  const kpiCards = useMemo(() => {
    if (active === 'attendance') {
      // BUG_123: count both 'present' AND 'wfh' (and half_day) for the Present/WFH card
      const present       = effectiveAttRows.filter(r => ['present', 'early_leave', 'wfh', 'half_day'].includes(r.status)).length;
      const absent        = effectiveAttRows.filter(r => r.status === 'absent').length;
      const onLeave       = effectiveAttRows.filter(r => r.status === 'on_leave').length;
      const noCheckout    = effectiveAttRows.filter(r => r.check_in && !r.check_out && !r.is_live).length;
      const completedRows = effectiveAttRows.filter(r => (r.work_hours > 0) || (r.estimated_hours > 0));
      const totalEffHrs   = completedRows.reduce((s, r) => s + (r.work_hours > 0 ? Number(r.work_hours) : Number(r.estimated_hours) || 0), 0);
      const avgHrs        = completedRows.length > 0 ? (totalEffHrs / completedRows.length).toFixed(1) : 0;
      return [
        { label: 'Total Records',   value: effectiveAttRows.length, icon: <CalendarDays size={18} className="text-[#3525cd]" />,  accent: 'border-t-[#3525cd]', onClick: () => { setSelectedEmpId(''); setDeptFilter(''); setAttStatusFilter(''); } },
        // BUG_123: onClick uses 'productive' sentinel to filter present+wfh+half_day; BUG_124: clears other filters; isActive shows ring
        { label: 'Present / WFH',  value: present,         icon: <UserCheck size={18} className="text-emerald-600" />,   accent: 'border-t-emerald-500', onClick: () => clearAndSetAttFilter('productive'), isActive: attStatusFilter === 'productive' },
        // BUG_124: clears other filters before setting absent filter
        { label: 'Absent',         value: absent,           icon: <X size={18} className="text-rose-500" />,             accent: 'border-t-rose-500',    onClick: () => clearAndSetAttFilter('absent'),     isActive: attStatusFilter === 'absent' },
        { label: 'Avg Working Hrs', value: `${avgHrs}h`,   icon: <TrendingUp size={18} className="text-amber-500" />,    accent: 'border-t-amber-400',   sub: noCheckout > 0 ? `${noCheckout} missing checkout` : undefined },
      ];
    }
    if (active === 'leaves') {
      const approved   = effectiveLeaveRows.filter(r => r.status === 'approved').length;
      // BUG_126: count ALL pending variants (multi-level workflow)
      const pending    = effectiveLeaveRows.filter(r => ['pending', 'pending_dept', 'pending_root', 'pending_approval'].includes(r.status)).length;
      const rejected   = effectiveLeaveRows.filter(r => r.status === 'rejected').length;
      // BUG_127: count cancelled leaves
      const cancelled  = effectiveLeaveRows.filter(r => r.status === 'cancelled').length;
      return [
        { label: 'Total Leaves', value: effectiveLeaveRows.length, icon: <FileText size={18} className="text-[#3525cd]" />,       accent: 'border-t-[#3525cd]', onClick: () => { setSelectedEmpId(''); setDeptFilter(''); setStatusFilter(''); setLeaveTypeFilter(''); } },
        // BUG_124: clears other filters before setting leave status filter; isActive shows ring
        { label: 'Approved',     value: approved,          icon: <CheckCircle2 size={18} className="text-emerald-600" />, accent: 'border-t-emerald-500', onClick: () => clearAndSetLeaveFilter('approved'),   isActive: statusFilter === 'approved' },
        { label: 'Pending',      value: pending,           icon: <Clock size={18} className="text-amber-500" />,          accent: 'border-t-amber-400',   onClick: () => clearAndSetLeaveFilter('all_pending'), isActive: statusFilter === 'all_pending', sub: pending > 0 ? 'Needs attention' : undefined },
        { label: 'Rejected',     value: rejected,          icon: <AlertCircle size={18} className="text-rose-500" />,     accent: 'border-t-rose-500',    onClick: () => clearAndSetLeaveFilter('rejected'),   isActive: statusFilter === 'rejected' },
        // BUG_127: new Cancelled KPI card
        { label: 'Cancelled',    value: cancelled,         icon: <X size={18} className="text-slate-500" />,              accent: 'border-t-slate-400',   onClick: () => clearAndSetLeaveFilter('cancelled'),  isActive: statusFilter === 'cancelled' },
      ];
    }
    // employees
    const active_count = effectiveEmpRows.filter(r => !r.employment_status || r.employment_status === 'active').length;
    const resigned     = effectiveEmpRows.filter(r => r.employment_status === 'resigned').length;
    const depts        = new Set(effectiveEmpRows.map(r => r.department).filter(Boolean)).size;
    return [
      { label: 'Total Employees', value: effectiveEmpRows.length, icon: <Users size={18} className="text-[#3525cd]" />, accent: 'border-t-[#3525cd]', onClick: () => { setSelectedEmpId(''); setDeptFilter(''); setStatusFilter(''); setEmpTypeFilter(''); } },
      { label: 'Active',          value: active_count,                        icon: <TrendingUp size={18} className="text-emerald-600" />, accent: 'border-t-emerald-500' },
      { label: 'Resigned',        value: resigned,                            icon: <AlertCircle size={18} className="text-rose-500" />,   accent: 'border-t-rose-500' },
      { label: 'Departments',     value: depts,                               icon: <Building2 size={18} className="text-[#712ae2]" />,    accent: 'border-t-[#712ae2]' },
    ];
  }, [active, effectiveAttRows, effectiveLeaveRows, effectiveEmpRows, headcount, statusFilter, attStatusFilter]);

  // ── CSV download ──────────────────────────────────────────────────────────────
  function getToken() { return localStorage.getItem('lt_token'); }

  async function handleDownload({ year: dlYear, month: dlMonth }) {
    const token = getToken();
    let endpoint, params, filename;
    if (active === 'attendance') {
      endpoint = '/reports/attendance';
      params   = dlMonth ? { year: dlYear, month: dlMonth } : { year: dlYear };
      filename = dlMonth ? `attendance_${MONTHS[dlMonth - 1]}_${dlYear}.csv` : `attendance_${dlYear}.csv`;
    } else if (active === 'leaves') {
      endpoint = '/reports/leaves';
      params   = dlMonth ? { year: dlYear, month: dlMonth } : { year: dlYear };
      filename = dlMonth ? `leaves_${MONTHS[dlMonth - 1]}_${dlYear}.csv` : `leaves_${dlYear}.csv`;
    } else {
      endpoint = '/reports/employees';
      params   = {};
      filename = 'employee_list.csv';
    }
    const q   = new URLSearchParams({ ...params, format: 'csv' }).toString();
    const res = await fetch(`/api${endpoint}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  const periodLabel = viewMode === 'monthly' ? `${MONTHS[month - 1]} ${year}` : `${year}`;
  const anyFilter   = selectedEmpId || deptFilter || statusFilter || leaveTypeFilter || attStatusFilter || empTypeFilter;

  const LEAVE_TYPES = ['casual', 'sick', 'annual', 'emergency', 'wfh', 'other'];
  const ATT_STATUSES = ['present', 'absent', 'holiday', 'wfh', 'on_leave', 'half_day'];
  const LEAVE_STATUSES = ['approved', 'pending', 'rejected', 'cancelled'];
  const EMP_STATUSES = ['active', 'inactive', 'resigned'];
  const EMP_TYPES = ['full_time', 'part_time', 'contract', 'intern'];

  return (
    <div className="space-y-5">

      {/* ── PAGE HEADER ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Attendance Management</h1>
          <p className="page-subtitle">Attendance correction, leaves, and employee data for {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Calendar — opens org-wide calendar overlay inside Reports. */}
          {/* Always visible in monthly attendance view; never inherits the Reports employee filter. */}
          {active === 'attendance' && viewMode === 'monthly' && (
            <button className="btn btn-outline btn-sm" onClick={() => setCalModalOpen(true)}>
              <Calendar size={14} /> View Calendar
            </button>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => window.print()}>
            <Printer size={14} /> Print
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => active === 'employees' ? handleDownload({ year }) : setDlOpen(true)}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ─────────────────────────────────────────────────────────── */}
      {/* BUG_127: leaves tab has 5 cards so use sm:grid-cols-5; others use sm:grid-cols-4 */}
      <div className={cn('grid grid-cols-2 gap-4', active === 'leaves' ? 'sm:grid-cols-5' : 'sm:grid-cols-4')}>
        {kpiCards.map((card, i) => (
          <KpiCard key={i} {...card} />
        ))}
      </div>

      {/* ── CONTROLS ROW ─────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 space-y-4">

        {/* Period picker + tabs */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode */}
          <div className="flex gap-1 bg-[#f0f3ff] p-1 rounded-xl border border-[#c7c4d8]">
            {['monthly', 'yearly'].map(m => (
              <button key={m} onClick={() => setViewMode(m)}
                className={cn('px-3 py-1.5 text-xs font-bold rounded-lg capitalize transition-colors',
                  viewMode === m ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]')}>
                {m}
              </button>
            ))}
          </div>

          {viewMode === 'monthly' && (
            <div className="flex items-center gap-1 bg-white border border-[#c7c4d8] rounded-lg px-3 py-2">
              <button onClick={prevMonth} className="text-[#3525cd] font-black text-base leading-none px-0.5">‹</button>
              <span className="font-bold text-[#151c27] min-w-[4.5rem] text-center text-sm">{MONTHS[month - 1]}</span>
              <button onClick={nextMonth} disabled={atCurrentMonth}
                className={`font-black text-base leading-none px-0.5 ${atCurrentMonth ? 'text-[#c7c4d8] cursor-not-allowed' : 'text-[#3525cd]'}`}>›</button>
            </div>
          )}

          <div className="flex items-center gap-1 bg-white border border-[#c7c4d8] rounded-lg px-3 py-2">
            <button onClick={() => setYear(y => y - 1)} className="text-[#3525cd] font-black text-base leading-none px-0.5">‹</button>
            <span className="font-bold text-[#151c27] min-w-[3rem] text-center text-sm">{year}</span>
            <button
              onClick={() => setYear(y => Math.min(y + 1, now.getFullYear()))}
              disabled={year >= now.getFullYear()}
              className={`font-black text-base leading-none px-0.5 ${year >= now.getFullYear() ? 'text-[#c7c4d8] cursor-not-allowed' : 'text-[#3525cd]'}`}>›</button>
          </div>

          {/* Report tabs */}
          <div className="flex gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-1 rounded-xl ml-auto">
            {[
              { key: 'attendance', label: 'Attendance', icon: <CalendarDays size={13} /> },
              { key: 'leaves',     label: 'Leaves',     icon: <FileText size={13} /> },
              { key: 'employees',  label: 'Employees',  icon: <Users size={13} /> },
            ].map(t => (
              <button key={t.key} onClick={() => handleTabChange(t.key)}
                className={cn('flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-bold transition-all',
                  active === t.key ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]')}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={13} className="text-[#777587] flex-shrink-0" />

          {/* Employee dropdown */}
          <select
            value={selectedEmpId}
            onChange={e => { setSelectedEmpId(e.target.value); setPage(1); }}
            className="form-control text-xs py-1.5 min-w-[180px] max-w-xs">
            <option value="">All Employees</option>
            {empRows.map(e => (
              <option key={e.id} value={String(e.id)}>{e.name}</option>
            ))}
          </select>

          {/* Department */}
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="form-control w-auto text-xs py-1.5">
            <option value="">All Departments</option>
            {deptOptions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          {/* Status filters — contextual per tab */}
          {active === 'attendance' && (
            <select value={attStatusFilter} onChange={e => setAttStatusFilter(e.target.value)}
              className="form-control w-auto text-xs py-1.5">
              <option value="">All Statuses</option>
              {ATT_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          )}

          {active === 'leaves' && (
            <>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="form-control w-auto text-xs py-1.5">
                <option value="">All Statuses</option>
                <option value="approved">Approved</option>
                <option value="all_pending">Pending</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select
                multiple
                size={Math.min(LEAVE_TYPES.length + 1, 5)}
                value={leaveTypeFilter ? leaveTypeFilter.split(',') : []}
                onChange={e => {
                  const vals = Array.from(e.target.selectedOptions, o => o.value);
                  setLeaveTypeFilter(vals.join(','));
                }}
                title="Hold Ctrl/Cmd to select multiple types"
                className="form-control w-auto text-xs"
              >
                {LEAVE_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
              </select>
            </>
          )}

          {active === 'employees' && (
            <>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="form-control w-auto text-xs py-1.5">
                <option value="">All Statuses</option>
                {EMP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={empTypeFilter} onChange={e => setEmpTypeFilter(e.target.value)}
                className="form-control w-auto text-xs py-1.5">
                <option value="">All Types</option>
                {EMP_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
              </select>
            </>
          )}

          {/* EHN_RA_002: Save current filter combination */}
          {anyFilter && (
            <button onClick={() => {
              const name = window.prompt('Name this filter view (e.g. "QA Pending Leaves"):');
              if (name?.trim()) { saveCurrentView(name.trim()); }
            }} className="flex items-center gap-1 text-xs font-bold text-[#3525cd] px-2 py-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-all">
              Save View
            </button>
          )}
          {savedViews.length > 0 && !anyFilter && savedViews.map(v => (
            <div key={v.name} className="flex items-center gap-0.5">
              <button onClick={() => loadView(v)}
                className="flex items-center gap-1 text-xs font-bold text-[#3525cd] px-2 py-1.5 rounded-l-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-all">
                {v.name}
              </button>
              <button onClick={() => deleteView(v.name)} className="px-1.5 py-1.5 rounded-r-lg border border-l-0 border-[#c7c4d8] text-[#c7c4d8] hover:text-rose-500 hover:border-rose-200 text-xs transition-all">×</button>
            </div>
          ))}

          {anyFilter && (
            <button onClick={() => { setSelectedEmpId(''); setDeptFilter(''); setStatusFilter(''); setLeaveTypeFilter(''); setAttStatusFilter(''); setEmpTypeFilter(''); }}
              className="flex items-center gap-1 text-xs font-bold text-rose-500 hover:text-rose-600 px-2 py-1.5 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all">
              <X size={12} /> Clear all
            </button>
          )}

          <span className="ml-auto text-xs text-[#777587] font-semibold">
            {activeRows.length} record{activeRows.length !== 1 ? 's' : ''}
            {anyFilter && <span className="text-[#3525cd] ml-1">(filtered)</span>}
          </span>
        </div>
      </div>

      {/* ── ATTENDANCE TABLE ──────────────────────────────────────────────────── */}
      {active === 'attendance' && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
                <tr>
                  <SortTh col="name"       sort={sort} onSort={toggleSort}>Employee</SortTh>
                  <SortTh col="department" sort={sort} onSort={toggleSort}>Department</SortTh>
                  <SortTh col="date"       sort={sort} onSort={toggleSort}>Date</SortTh>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Day</th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Status</th>
                  <SortTh col="check_in"  sort={sort} onSort={toggleSort}>{isFiloOrg ? 'First In' : 'Check In'}</SortTh>
                  <SortTh col="check_out" sort={sort} onSort={toggleSort}>{isFiloOrg ? 'Last Out' : 'Check Out'}</SortTh>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Late Coming</th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Early Going</th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">
                    {isFiloOrg ? 'Non-Working' : 'Break'}
                  </th>
                  <SortTh col="gross_hours" sort={sort} onSort={toggleSort}>{isFiloOrg ? 'Total Hrs' : 'Gross Hrs'}</SortTh>
                  <SortTh col="work_hours"  sort={sort} onSort={toggleSort}>Working Hrs</SortTh>
                  {isAdmin && <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {attLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: isAdmin ? 13 : 12 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-[#f0f3ff] rounded w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 13 : 12} className="py-14 text-center">
                      <CalendarDays size={32} className="text-[#c7c4d8] mx-auto mb-2" />
                      <p className="text-sm font-semibold text-[#464555]">No attendance records found</p>
                      <p className="text-xs text-[#9ca3af] mt-1">{anyFilter ? 'Try adjusting your filters.' : `No data for ${periodLabel}.`}</p>
                    </td>
                  </tr>
                ) : displayRows.map((r, i) => {
                  // Use attendance record id as unique key — not user_id (can be null)
                  const rowUniqueId = r.id ?? `${i}-${r.date}`;
                  const rowKey = String(rowUniqueId);
                  const isExpanded = expandedRowId === rowKey;
                  const fmtHrs = (h) => {
                    if (!h || h <= 0) return null;
                    const hrs = Math.floor(h); const min = Math.round((h - hrs) * 60);
                    return hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
                  };
                  const fmtBreak = (mins) => {
                    if (!mins) return null;
                    const h = Math.floor(mins / 60), m = mins % 60;
                    return h > 0 ? `${h}h ${m}m` : `${m}m`;
                  };
                  const fmtTime = (t) => {
                    if (!t) return null;
                    const [h, m] = t.split(':').map(Number);
                    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
                  };
                  return (
                    <React.Fragment key={rowKey}>
                    <tr
                      className={cn(
                        'transition-colors',
                        isFiloOrg ? 'cursor-pointer hover:bg-[#f0f3ff]' : 'hover:bg-[#f9f9ff]',
                        r.is_live && 'bg-emerald-50/30',
                        isExpanded && 'bg-[#f0f3ff]'
                      )}
                      onClick={isFiloOrg ? () => setExpandedRowId(isExpanded ? null : rowKey) : undefined}
                    >
                      <td className="px-4 py-3 font-semibold text-[#151c27] whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          {isFiloOrg && <ChevronRight size={13} className={cn('text-[#3525cd] transition-transform', isExpanded && 'rotate-90')} />}
                          {r.name}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#464555] text-xs">{r.department || '—'}</td>
                      <td className="px-4 py-3 text-[#464555] text-xs whitespace-nowrap">{r.date}</td>
                      {/* Day of week — derived client-side from date */}
                      <td className="px-4 py-3 text-[#777587] text-xs whitespace-nowrap">
                        {r.date ? new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn('text-[0.68rem] font-bold px-2 py-0.5 rounded-full border capitalize whitespace-nowrap', ATT_STATUS_STYLE[r.status] || 'bg-slate-50 text-slate-500 border-slate-200')}>
                            {r.status === 'holiday'
                              ? (r.holiday_name ? `${r.holiday_type === 'public' ? 'Public ' : ''}Holiday` : 'Holiday')
                              : r.status === 'off_day' ? 'Off Day'
                              : r.status?.replace(/_/g, ' ') || '—'}
                          </span>
                          {r.status === 'holiday' && r.holiday_name && (
                            <span className="text-[0.6rem] font-semibold text-violet-600 truncate max-w-[120px]" title={r.holiday_name}>
                              {r.holiday_name}
                            </span>
                          )}
                          {r.is_on_break && (
                            <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                              On Break
                            </span>
                          )}
                        </div>
                      </td>
                      {/* Check In */}
                      <td className="px-4 py-3 text-xs font-mono">
                        {r.check_in ? (
                          <span className="text-[#151c27] font-semibold">{fmtTime(r.check_in)}</span>
                        ) : '—'}
                      </td>
                      {/* Check Out */}
                      <td className="px-4 py-3 text-xs font-mono">
                        {r.check_out ? (
                          <span className="text-[#151c27] font-semibold">{fmtTime(r.check_out)}</span>
                        ) : r.is_live ? (
                          <span className="flex items-center gap-1 text-emerald-700 font-bold text-[0.68rem]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                            In Progress
                          </span>
                        ) : r.check_in ? (
                          <span className="text-amber-600 text-[0.68rem] font-semibold" title="Employee did not check out">
                            Not checked out
                          </span>
                        ) : '—'}
                      </td>
                      {/* Late Coming */}
                      <td className="px-4 py-3 text-xs">
                        {r.is_late
                          ? <span className="font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">Late</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      {/* Early Going */}
                      <td className="px-4 py-3 text-xs">
                        {r.is_early_exit
                          ? <span className="font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">Early</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      {/* Break / Non-Working */}
                      <td className="px-4 py-3 text-xs font-semibold">
                        {isFiloOrg ? (
                          r.non_working_minutes > 0
                            ? <span className="text-slate-500">{fmtBreak(r.non_working_minutes)}</span>
                            : <span className="text-slate-300">—</span>
                        ) : (
                          <span className="text-amber-600">{fmtBreak(r.total_break_minutes) || '—'}</span>
                        )}
                      </td>
                      {/* Gross Hours */}
                      <td className="px-4 py-3 text-xs text-[#464555]">
                        {r.gross_hours > 0 ? fmtHrs(r.gross_hours) : r.is_live && r.estimated_hours > 0 ? (
                          <span className="text-emerald-700 font-semibold">{fmtHrs(r.estimated_hours)} <span className="text-[0.6rem] text-emerald-500">live</span></span>
                        ) : '—'}
                      </td>
                      {/* Working (Effective) Hours */}
                      <td className="px-4 py-3 text-xs font-semibold">
                        {r.work_hours > 0 ? (
                          <span className="text-[#151c27]">{fmtHrs(r.work_hours)}</span>
                        ) : r.is_live && r.estimated_hours > 0 ? (
                          <span className="text-emerald-700 font-semibold">{fmtHrs(r.estimated_hours)} <span className="text-[0.6rem] font-normal text-emerald-500">est.</span></span>
                        ) : '—'}
                      </td>
                      {/* Action — Edit attendance (admin only, real DB records only) */}
                      {isAdmin && (
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {r.id && !['holiday', 'off_day'].includes(r.status) && (
                            <button
                              className="flex items-center gap-1 text-[0.68rem] font-bold text-[#3525cd] px-2 py-1 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] hover:border-[#3525cd] transition-all whitespace-nowrap"
                              onClick={() => setEditTarget({
                                emp:    { id: r.user_id, name: r.name },
                                record: { id: r.id, check_in: r.check_in, check_out: r.check_out, status: r.status, is_late: r.is_late, is_early_exit: r.is_early_exit, notes: r.notes },
                                dateStr: r.date,
                              })}>
                              <Pencil size={10} /> Edit
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                    {/* Punch log expansion row — only for biometric (isFiloOrg) orgs */}
                    {isFiloOrg && isExpanded && (
                      <PunchLogRow
                        employee_pin={r.device_enrollment_id || r.users?.device_enrollment_id || null}
                        user_id={r.user_id || r.users?.id || null}
                        date={r.date}
                        name={r.name}
                        colSpan={isAdmin ? 13 : 12}
                      />
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Legend */}
          <div className="px-4 py-2.5 border-t border-[#f0f3ff] bg-[#fafaff] flex items-center gap-4 flex-wrap">
            {!isFiloOrg && (
              <>
                <div className="flex items-center gap-1.5 text-[0.65rem] text-[#777587]">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  In Progress = checked in today, not yet checked out
                </div>
                <div className="flex items-center gap-1.5 text-[0.65rem] text-amber-600">
                  <span className="font-bold">Not checked out</span> = employee forgot to check out
                </div>
                <div className="text-[0.65rem] text-[#777587]">
                  Working Hrs = Total − Break time
                </div>
              </>
            )}
            {isFiloOrg && (
              <>
                <div className="text-[0.65rem] text-[#777587]">
                  <span className="font-bold">First In</span> = first door punch of the day
                </div>
                <div className="text-[0.65rem] text-[#777587]">
                  <span className="font-bold">Last Out</span> = last door punch of the day
                </div>
                <div className="text-[0.65rem] text-[#777587]">
                  <span className="font-bold">Non-Working</span> = sum of out→in gaps (lunch, breaks, exits)
                </div>
                <div className="text-[0.65rem] text-[#777587]">
                  Working Hrs = Total − Non-Working
                </div>
              </>
            )}
          </div>
          <Pagination page={safePage} totalPages={totalPages} totalCount={activeRows.length} pageSize={pageSize} onPageChange={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />
        </div>
      )}

      {/* ── LEAVES TABLE ──────────────────────────────────────────────────────── */}
      {active === 'leaves' && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
                <tr>
                  <SortTh col="name"        sort={sort} onSort={toggleSort}>Employee</SortTh>
                  <SortTh col="department"  sort={sort} onSort={toggleSort}>Department</SortTh>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Type</th>
                  <SortTh col="start_date"  sort={sort} onSort={toggleSort}>From</SortTh>
                  <SortTh col="end_date"    sort={sort} onSort={toggleSort}>To</SortTh>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Status</th>
                  <SortTh col="approved_by" sort={sort} onSort={toggleSort}>Approved By</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {lvLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-[#f0f3ff] rounded w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-14 text-center">
                      <FileText size={32} className="text-[#c7c4d8] mx-auto mb-2" />
                      <p className="text-sm font-semibold text-[#464555]">No leave records found</p>
                      <p className="text-xs text-[#9ca3af] mt-1">{anyFilter ? 'Try adjusting your filters.' : `No leave data for ${periodLabel}.`}</p>
                    </td>
                  </tr>
                ) : displayRows.map((r, i) => (
                  <tr key={i} className="hover:bg-[#f9f9ff] transition-colors">
                    <td className="px-4 py-3 font-semibold text-[#151c27] whitespace-nowrap">{r.name}</td>
                    <td className="px-4 py-3 text-[#464555] text-xs">{r.department || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[0.68rem] font-bold px-2 py-0.5 rounded-full capitalize', LEAVE_TYPE_STYLE[r.leave_type] || 'bg-slate-50 text-slate-600')}>
                        {r.leave_type || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#464555] text-xs whitespace-nowrap">{r.start_date}</td>
                    <td className="px-4 py-3 text-[#464555] text-xs whitespace-nowrap">{r.end_date}</td>
                    <td className="px-4 py-3 text-[#464555] text-xs capitalize">{r.leave_time?.replace('_', ' ') || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[0.68rem] font-bold px-2 py-0.5 rounded-full border capitalize', LEAVE_STATUS_STYLE[r.status] || 'bg-slate-50 text-slate-500 border-slate-200')}>
                        {r.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#464555] text-xs">{r.approved_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} totalPages={totalPages} totalCount={activeRows.length} pageSize={pageSize} onPageChange={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />
        </div>
      )}

      {/* ── EMPLOYEES TABLE ───────────────────────────────────────────────────── */}
      {active === 'employees' && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f9f9ff] border-b border-[#c7c4d8]">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-black text-[#464555] whitespace-nowrap uppercase tracking-wider">Employee</th>
                  <SortTh col="email"             sort={sort} onSort={toggleSort}>Email</SortTh>
                  <SortTh col="department"        sort={sort} onSort={toggleSort}>Department</SortTh>
                  <SortTh col="position"          sort={sort} onSort={toggleSort}>Position</SortTh>
                  <SortTh col="employment_type"   sort={sort} onSort={toggleSort}>Type</SortTh>
                  <SortTh col="employment_status" sort={sort} onSort={toggleSort}>Status</SortTh>
                  <SortTh col="date_of_joining"   sort={sort} onSort={toggleSort}>Joined</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {empLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-[#f0f3ff] rounded w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-14 text-center">
                      <Users size={32} className="text-[#c7c4d8] mx-auto mb-2" />
                      <p className="text-sm font-semibold text-[#464555]">No employees found</p>
                      <p className="text-xs text-[#9ca3af] mt-1">{anyFilter ? 'Try adjusting your filters.' : 'No employee records available.'}</p>
                    </td>
                  </tr>
                ) : displayRows.map((r, i) => (
                  <tr key={i} className="hover:bg-[#f9f9ff] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.name} size={28} />
                        <div>
                          <p className="font-semibold text-[#151c27] text-sm leading-tight whitespace-nowrap">{r.name}</p>
                          {r.employee_id && <p className="text-[0.65rem] text-[#9ca3af]">#{r.employee_id}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[#464555] text-xs">{r.email || '—'}</td>
                    <td className="px-4 py-3 text-[#464555] text-xs">{r.department || '—'}</td>
                    <td className="px-4 py-3 text-[#464555] text-xs">{r.position || '—'}</td>
                    <td className="px-4 py-3 text-xs capitalize">
                      <span className="bg-[#f0f3ff] text-[#3525cd] text-[0.68rem] font-bold px-2 py-0.5 rounded-full">
                        {r.employment_type?.replace('_', ' ') || 'Full Time'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('text-[0.68rem] font-bold px-2 py-0.5 rounded-full border capitalize', EMP_STATUS_STYLE[r.employment_status] || EMP_STATUS_STYLE.active)}>
                        {r.employment_status || 'active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#464555] text-xs whitespace-nowrap">{r.date_of_joining || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={safePage} totalPages={totalPages} totalCount={activeRows.length} pageSize={pageSize} onPageChange={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} label="employees" />
        </div>
      )}

      {/* ── EXPORT MODAL ─────────────────────────────────────────────────────── */}
      {dlOpen && (
        <DownloadModal open={dlOpen} onClose={() => setDlOpen(false)} active={active} onDownload={handleDownload} />
      )}

      {/* ── ATTENDANCE CORRECTION MODAL ──────────────────────────────────────── */}
      {editTarget && (
        <AttCorrectionModal
          emp={editTarget.emp}
          dateStr={editTarget.dateStr}
          existingRecord={editTarget.record}
          isSynthetic={false}
          onClose={() => setEditTarget(null)}
          onRefresh={() => {
            qc.invalidateQueries({ queryKey: ['report-attendance'] });
            qc.invalidateQueries({ queryKey: ['root-dashboard'] });
            qc.invalidateQueries({ queryKey: ['dashboard'] });
            qc.invalidateQueries({ queryKey: ['calendar'] });
            qc.invalidateQueries({ queryKey: ['att-day-modal'] });
            qc.invalidateQueries({ queryKey: ['leaves-month'] });
          }}
        />
      )}

      {/* ── ORG-WIDE CALENDAR OVERLAY ────────────────────────────────────────── */}
      {/* Renders the same shared OrgCalendarPanel used by /root/calendar.       */}
      {/* Branch context is respected automatically; Reports filters are ignored. */}
      {calModalOpen && (
        <>
          {/* Backdrop — clicking it closes the drawer */}
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setCalModalOpen(false)} />
          {/* Right-side drawer — sits on top of Reports, does not cover the sidebar */}
          <div className="fixed top-0 right-0 bottom-0 z-50 w-[65%] bg-white flex flex-col shadow-2xl border-l border-[#e7eefe]">
          {/* Header bar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#e7eefe] bg-white shadow-sm flex-shrink-0">
            <div>
              <h2 className="text-sm font-black text-[#151c27]">Organisation Calendar</h2>
              <p className="text-xs text-[#777587]">All employees · respects current branch</p>
            </div>
            <button
              className="btn btn-outline btn-sm"
              onClick={() => setCalModalOpen(false)}>
              Close
            </button>
          </div>
          {/* Calendar panel — fills the remaining space */}
          <div className="flex-1 overflow-auto p-4">
            <OrgCalendarPanel
              onViewAttendance={(empId, calMonth, calYear) => {
                // Close the calendar overlay and show that employee's attendance in Reports
                setCalModalOpen(false);
                setSelectedEmpId(String(empId));
                setMonth(calMonth);
                setYear(calYear);
                setViewMode('monthly');
              }}
            />
          </div>
          </div>{/* end drawer */}
        </>
      )}

    </div>
  );
}

// ── View Calendar Modal ────────────────────────────────────────────────────────
// Renders a mini month-calendar for the selected employee using the data already
// loaded in Reports (no extra API calls). Clicking a date shows attendance details.
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtTimeCal(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function ReportsCalendarModal({ open, onClose, empName, year, month, calendarRows, attStatusStyle }) {
  const [selectedDate, setSelectedDate] = useState(null);

  const rowMap = useMemo(() => {
    const map = {};
    for (const r of calendarRows || []) map[r.date] = r;
    return map;
  }, [calendarRows]);

  if (!open) return null;

  const firstDay  = new Date(year, month - 1, 1);
  const lastDay   = new Date(year, month,     0);
  const startCell = new Date(firstDay);
  startCell.setDate(startCell.getDate() - startCell.getDay());
  const endCell = new Date(lastDay);
  endCell.setDate(endCell.getDate() + (6 - endCell.getDay()));

  const cells = [];
  const cur = new Date(startCell);
  while (cur <= endCell) { cells.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  const todayStr = new Date().toLocaleDateString('en-CA');

  const STATUS_CELL = {
    present:     { cls: 'bg-emerald-100 text-emerald-700', lbl: 'P' },
    early_leave: { cls: 'bg-orange-100 text-orange-700',   lbl: 'EL' },
    wfh:         { cls: 'bg-indigo-100 text-indigo-700',   lbl: 'WFH' },
    half_day:    { cls: 'bg-amber-100 text-amber-700',     lbl: 'HD' },
    on_leave:    { cls: 'bg-rose-100 text-rose-600',       lbl: 'L' },
    absent:      { cls: 'bg-slate-100 text-slate-500',     lbl: 'A' },
    holiday:     { cls: 'bg-violet-100 text-violet-700',   lbl: 'H' },
    off_day:     { cls: 'bg-slate-50 text-slate-400',      lbl: 'Off' },
  };

  const selRow = selectedDate ? rowMap[selectedDate] : null;

  return (
    <Modal open onClose={onClose} title={`${empName} — ${MONTHS[month - 1]} ${year}`} size="lg">
      {{
        body: (
          <div className="space-y-4">

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-px bg-[#c7c4d8] border border-[#c7c4d8] rounded-xl overflow-hidden">
              {DAY_ABBR.map(d => (
                <div key={d} className="bg-[#f9f9ff] py-2 text-center text-[0.6rem] font-black uppercase tracking-wider text-[#777587]">
                  {d}
                </div>
              ))}
              {cells.map((c, i) => {
                const isOther = c.getMonth() !== month - 1;
                const ds = c.toLocaleDateString('en-CA');
                const isToday = ds === todayStr;
                const row = rowMap[ds];
                const sCell = row ? STATUS_CELL[row.status] : null;
                const isSelected = ds === selectedDate;

                return (
                  <div key={i}
                    onClick={() => !isOther && setSelectedDate(prev => prev === ds ? null : ds)}
                    className={cn(
                      'bg-white min-h-[52px] p-1.5 transition-colors',
                      isOther ? 'opacity-30 cursor-default' : 'cursor-pointer hover:bg-[#f0f3ff]',
                      isSelected && 'bg-[#eef0ff] ring-1 ring-inset ring-[#3525cd]',
                      isToday && !isSelected && 'bg-[#f0f3ff]',
                    )}>
                    <div className={cn(
                      'text-xs font-bold w-5 h-5 flex items-center justify-center rounded-full mb-0.5',
                      isToday ? 'bg-[#3525cd] text-white text-[0.6rem]' : 'text-[#464555]',
                    )}>
                      {c.getDate()}
                    </div>
                    {!isOther && sCell && (
                      <span className={cn('text-[0.55rem] font-bold px-1 py-0.5 rounded block text-center leading-tight', sCell.cls)}>
                        {sCell.lbl}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(STATUS_CELL).map(([k, v]) => (
                <span key={k} className={cn('text-[0.6rem] font-bold px-1.5 py-0.5 rounded capitalize', v.cls)}>
                  {k.replace(/_/g, ' ')}
                </span>
              ))}
            </div>

            {/* Detail panel for selected date */}
            {selectedDate && (
              <div className="rounded-xl border border-[#c7c4d8] p-4 bg-[#f9f9ff]">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <span className="text-sm font-black text-[#151c27]">
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </span>
                  {selRow && (
                    <span className={cn('text-[0.68rem] font-bold px-2 py-0.5 rounded-full border capitalize', attStatusStyle[selRow.status] || 'bg-slate-50 text-slate-500 border-slate-200')}>
                      {selRow.status?.replace(/_/g, ' ') || '—'}
                    </span>
                  )}
                </div>
                {selRow?.check_in ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <p className="text-[#777587] mb-0.5">Check In</p>
                      <p className="font-bold text-[#151c27] font-mono">{fmtTimeCal(selRow.check_in)}</p>
                    </div>
                    <div>
                      <p className="text-[#777587] mb-0.5">Check Out</p>
                      <p className="font-bold text-[#151c27] font-mono">{fmtTimeCal(selRow.check_out)}</p>
                    </div>
                    {selRow.work_hours > 0 && (
                      <div>
                        <p className="text-[#777587] mb-0.5">Working Hrs</p>
                        <p className="font-bold text-[#151c27]">
                          {Math.floor(selRow.work_hours)}h {Math.round((selRow.work_hours % 1) * 60)}m
                        </p>
                      </div>
                    )}
                    {selRow.total_break_minutes > 0 && (
                      <div>
                        <p className="text-[#777587] mb-0.5">Break</p>
                        <p className="font-bold text-[#151c27]">
                          {Math.floor(selRow.total_break_minutes / 60)}h {selRow.total_break_minutes % 60}m
                        </p>
                      </div>
                    )}
                    {selRow.is_late && (
                      <div>
                        <p className="text-[#777587] mb-0.5">Late Coming</p>
                        <span className="font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200 text-[0.65rem]">Late</span>
                      </div>
                    )}
                    {selRow.is_early_exit && (
                      <div>
                        <p className="text-[#777587] mb-0.5">Early Going</p>
                        <span className="font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[0.65rem]">Early Exit</span>
                      </div>
                    )}
                    {selRow.notes && (
                      <div className="col-span-2 sm:col-span-4">
                        <p className="text-[#777587] mb-0.5">Notes</p>
                        <p className="text-[#464555] italic text-[0.7rem]">{selRow.notes}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#777587]">
                    {selRow
                      ? (selRow.status === 'off_day' ? 'Weekly off — no attendance expected.' : selRow.status === 'holiday' ? `Public holiday${selRow.holiday_name ? `: ${selRow.holiday_name}` : ''}.` : 'No punch record for this day.')
                      : 'No data for this date.'}
                  </p>
                )}
              </div>
            )}

          </div>
        ),
      }}
    </Modal>
  );
}
