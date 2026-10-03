import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, CheckCircle2, LogIn, LogOut,
  Timer, Clock, Coffee, Play,
  Download, Search, TrendingUp, BarChart2,
  Fingerprint, ClipboardEdit,
} from 'lucide-react';
import { useLeavesList } from '@/hooks/useListQueries';
import { invalidateMyAttendance } from '@/hooks/useAttendanceDay';
import { apiGet, apiPost } from '@/lib/api';
import { STALE } from '@/lib/queryTiers';
import { useHolidays, useWorkSchedule } from '@/hooks/useReferenceData';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

function fmtTime(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}
function fmtHours(h) {
  if (!h && h !== 0) return '—';
  if (h === 0) return '0m';
  const hrs = Math.floor(h); const min = Math.round((h - hrs) * 60);
  return hrs > 0 ? `${hrs}h ${min}m` : `${min}m`;
}
function fmtBreak(mins) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtPunchTime(ts) {
  if (!ts) return '--';
  try {
    return new Date(ts).toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
    });
  } catch { return '--'; }
}

// ─── AttendanceCheckinCard — DO NOT MODIFY ────────────────────────────────────
function AttendanceCheckinCard({ onRefreshed }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [record, setRecord] = useState(null);
  const [elapsed, setElapsed] = useState('');
  const [busy, setBusy] = useState(false);
  const [breakBusy, setBreakBusy] = useState(false);

  const load = useCallback(async () => {
    try { setRecord(await apiGet('/attendance/today')); } catch { /* silent */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Elapsed timer (pauses during break)
  useEffect(() => {
    const isOnBreak = record?.break_start && !record?.break_end;
    if (!record?.check_in || record?.check_out) { setElapsed(''); return; }
    const tick = () => {
      if (isOnBreak) {
        const [bh, bm] = record.break_start.split(':').map(Number);
        const breakStart = new Date(); breakStart.setHours(bh, bm, 0, 0);
        const total = Math.floor((Date.now() - breakStart.getTime()) / 60000);
        const hrs = Math.floor(total / 60); const min = total % 60;
        setElapsed(hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
      } else {
        const [h, m] = record.check_in.split(':').map(Number);
        const start = new Date(); start.setHours(h, m, 0, 0);
        const totalMins = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000) - (record.total_break_minutes || 0));
        const hrs = Math.floor(totalMins / 60); const min = totalMins % 60;
        setElapsed(hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [record]);

  async function checkIn() {
    setBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/checkin', {});
      setRecord(r);
      toast(message || 'Checked in!', 'success');
      invalidateMyAttendance(qc);
      onRefreshed?.();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }
  async function checkOut() {
    setBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/checkout', {});
      setRecord(r);
      toast(message || 'Checked out!', (r.status === 'half_day' || r.status === 'early_leave') ? 'warning' : 'success');
      invalidateMyAttendance(qc);
      onRefreshed?.();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBusy(false); }
  }
  async function breakIn() {
    setBreakBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/break-in', {});
      setRecord(r);
      toast(message || 'Break started', 'info');
      invalidateMyAttendance(qc);
      onRefreshed?.();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBreakBusy(false); }
  }
  async function breakOut() {
    setBreakBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/break-out', {});
      setRecord(r);
      toast(message || 'Break ended', 'success');
      invalidateMyAttendance(qc);
      onRefreshed?.();
    } catch (err) { toast(err.message, 'error'); }
    finally { setBreakBusy(false); }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const isOnBreak = !!(record?.break_start && !record?.break_end && !record?.check_out);

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden mb-6">
      {/* Header */}
      <div className="px-5 py-3 bg-[#f8f9ff] border-b border-[#e7eefe] flex items-center gap-2">
        <Clock size={14} className="text-[#777587]" />
        <span className="text-xs font-semibold text-[#777587]">Today's Attendance · {dateStr}</span>
      </div>

      {/* Body */}
      <div className="p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* Status icon + text */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
            !record?.check_in ? 'bg-slate-100' :
            isOnBreak        ? 'bg-amber-50'  :
            record?.check_out ? 'bg-[#f0f3ff]' : 'bg-emerald-50'
          }`}>
            {!record?.check_in  ? <LogIn size={18} className="text-slate-400" /> :
             isOnBreak          ? <Coffee size={18} className="text-amber-500" /> :
             record?.check_out  ? <CheckCircle2 size={18} className="text-[#3525cd]" /> :
                                  <CheckCircle2 size={18} className="text-emerald-500" />}
          </div>
          <div className="min-w-0">
            {!record?.check_in ? (
              <>
                <p className="text-sm font-bold text-[#151c27]">Not Checked In</p>
                <p className="text-xs text-[#777587]">Mark yourself present for today</p>
              </>
            ) : isOnBreak ? (
              <>
                <p className="text-sm font-bold text-amber-600">On Break</p>
                <p className="text-xs text-[#777587]">Break started at {fmtTime(record.break_start)}{elapsed ? ` · ${elapsed} elapsed` : ''}</p>
              </>
            ) : record?.check_out ? (
              <>
                <p className="text-sm font-bold text-[#151c27]">Work Complete</p>
                <p className="text-xs text-[#777587]">
                  {fmtTime(record.check_in)} – {fmtTime(record.check_out)}
                  {record.work_hours ? ` · ${fmtHours(record.work_hours)} effective` : ''}
                  {record.status === 'half_day' ? ' · Half Day' : record.status === 'early_leave' ? ' · Early Leave' : ''}
                </p>
                {record.total_break_minutes > 0 && (
                  <p className="text-xs text-amber-600">Break: {fmtBreak(record.total_break_minutes)}</p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-bold text-emerald-600">Checked In</p>
                <p className="text-xs text-[#777587]">
                  Since {fmtTime(record.check_in)}{elapsed ? ` · ${elapsed} working` : ''}
                  {record.total_break_minutes > 0 ? ` (${fmtBreak(record.total_break_minutes)} break)` : ''}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="shrink-0 flex gap-2 flex-wrap">
          {!record?.check_in ? (
            <button onClick={checkIn} disabled={busy}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-sm">
              <LogIn size={15} /> {busy ? 'Checking in…' : 'Check In'}
            </button>
          ) : isOnBreak ? (
            <button onClick={breakOut} disabled={breakBusy}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-sm">
              <Play size={15} /> {breakBusy ? 'Ending…' : 'End Break'}
            </button>
          ) : record?.check_out ? (
            <div className="flex items-center gap-1.5 text-xs text-[#777587] bg-[#f0f3ff] px-4 py-2.5 rounded-xl border border-[#c7c4d8]">
              <CheckCircle2 size={13} className="text-[#3525cd]" /> Day Complete
            </div>
          ) : (
            <>
              <button onClick={breakIn} disabled={breakBusy || busy}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-sm">
                <Coffee size={15} /> {breakBusy ? '…' : 'Break'}
              </button>
              <button onClick={checkOut} disabled={busy}
                className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white font-bold text-sm px-5 py-2.5 rounded-xl transition-all shadow-sm">
                <LogOut size={15} /> {busy ? 'Checking out…' : 'Check Out'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Today's summary strip (only when checked out) */}
      {record?.check_out && (
        <div className="px-5 py-3 bg-[#fafaff] border-t border-[#f0f3ff] grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Check-In',       value: fmtTime(record.check_in)     },
            { label: 'Check-Out',      value: fmtTime(record.check_out)    },
            { label: 'Gross Hours',    value: record.gross_hours ? fmtHours(record.gross_hours) : '—' },
            { label: 'Working Hours',  value: record.work_hours  ? fmtHours(record.work_hours)  : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <p className="text-xs font-black text-[#151c27]">{value}</p>
              <p className="text-[0.6rem] text-[#777587] mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ─── End AttendanceCheckinCard ────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const STATUS_CONFIG = {
  present:      { label: 'Present',      bg: 'bg-emerald-50',  text: 'text-emerald-700',  border: 'border-emerald-200', dot: 'bg-emerald-500', cellBg: 'bg-emerald-50',  showTag: false },
  early_leave:  { label: 'Early Leave',  bg: 'bg-orange-50',   text: 'text-orange-700',   border: 'border-orange-200',  dot: 'bg-orange-500',  cellBg: 'bg-orange-50',   showTag: true,  tag: 'Early' },
  half_day:     { label: 'Half Day',     bg: 'bg-amber-50',    text: 'text-amber-700',    border: 'border-amber-200',   dot: 'bg-amber-500',   cellBg: 'bg-amber-50',    showTag: true,  tag: 'Half' },
  on_leave:     { label: 'On Leave',     bg: 'bg-indigo-50',   text: 'text-indigo-700',   border: 'border-indigo-200',  dot: 'bg-indigo-500',  cellBg: 'bg-indigo-50',   showTag: true,  tag: 'Leave' },
  wfh:          { label: 'WFH',          bg: 'bg-cyan-50',     text: 'text-cyan-700',     border: 'border-cyan-200',    dot: 'bg-cyan-500',    cellBg: 'bg-cyan-50',     showTag: true,  tag: 'WFH' },
  absent:       { label: 'Absent',       bg: 'bg-rose-50',     text: 'text-rose-700',     border: 'border-rose-200',    dot: 'bg-rose-500',    cellBg: 'bg-rose-50',     showTag: false },
};

// KPI card accent config (ring color for active state)
const KPI_RING = {
  present:     'ring-2 ring-emerald-400',
  early_leave: 'ring-2 ring-orange-400',
  half_day:    'ring-2 ring-amber-400',
  on_leave:    'ring-2 ring-indigo-400',
  wfh:         'ring-2 ring-cyan-400',
  absent:      'ring-2 ring-rose-400',
};

function toDSString(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// CSV export helper
function exportCSV(rows, monthName, year) {
  const headers = ['Date', 'Status', 'Check-In', 'Check-Out', 'Break', 'Gross Hours', 'Working Hours'];
  const lines = [headers.join(',')];
  rows.forEach(r => {
    const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.present;
    const grossH = r.gross_hours > 0 ? r.gross_hours : r.work_hours || null;
    const effectiveH = r.work_hours > 0 ? r.work_hours : null;
    lines.push([
      r.date,
      cfg.label,
      r.check_in  ? fmtTime(r.check_in)  : '',
      r.check_out ? fmtTime(r.check_out) : '',
      r.total_break_minutes ? fmtBreak(r.total_break_minutes) : '',
      grossH    ? fmtHours(grossH)    : '',
      effectiveH ? fmtHours(effectiveH) : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `attendance-${monthName}-${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MyAttendance() {
  const now = new Date();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [year,  setYear]  = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  // Filter & pagination state
  const [statusFilter, setStatusFilter] = useState(null);
  const [dateSearch,   setDateSearch]   = useState('');
  const [page, setPage] = useState(1);

  // Biometric punch-log expansion state
  const [expandedDate,    setExpandedDate]    = useState(null);
  const [punchCache,      setPunchCache]      = useState({});
  const [loadingPunchDate, setLoadingPunchDate] = useState(null);

  // Reset pagination when filters / month change
  useEffect(() => { setPage(1); }, [statusFilter, dateSearch, month, year]);

  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ['my-attendance', year, month],
    staleTime: STALE.frequent,   // frequent
    queryFn:  () => apiGet(`/attendance?year=${year}&month=${month}`),
  });

  const { data: allLeaves = [] } = useLeavesList({ year, month });

  const { data: schedule } = useWorkSchedule({ staleTime: 300000 });
  const activeWorkDays = schedule?.work_days ? schedule.work_days.split(',').map(Number) : [1,2,3,4,5];

  const { data: holidays = [] } = useHolidays(null, { staleTime: 5 * 60 * 1000 });

  const { data: biometricData } = useQuery({
    queryKey: ['org-has-biometric'],
    queryFn: () => apiGet('/biometric/has-biometric').catch(() => ({ has_biometric: false })),
    staleTime: 10 * 60 * 1000,
  });
  const hasBiometric = biometricData?.has_biometric === true;

  async function handleRowClick(date) {
    if (!hasBiometric) return;
    if (expandedDate === date) { setExpandedDate(null); return; }
    setExpandedDate(date);
    if (punchCache[date] !== undefined) return;
    setLoadingPunchDate(date);
    try {
      const data = await apiGet('/biometric/my-punches', { date });
      setPunchCache(c => ({ ...c, [date]: data }));
    } catch {
      setPunchCache(c => ({ ...c, [date]: [] }));
    } finally {
      setLoadingPunchDate(null);
    }
  }

  function handleRegularize(e, date) {
    e.stopPropagation();
    navigate(`/portal/regularization?action=apply&date=${date}`);
  }

  function prevMonth() {
    setStatusFilter(null); setDateSearch('');
    if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1);
  }
  function nextMonth() {
    setStatusFilter(null); setDateSearch('');
    if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1);
  }

  // Build attendance + leave synthesis map (unchanged logic)
  const attMap = {};
  records.forEach(r => { attMap[r.date] = r; });

  const approvedLeaves = allLeaves.filter(l => l.status === 'approved');
  const recMap = { ...attMap };
  approvedLeaves.forEach(l => {
    const start = new Date(l.start_date + 'T12:00:00');
    const end   = new Date(l.end_date   + 'T12:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (!activeWorkDays.includes(dow)) continue;
      const ds = toDSString(d);
      const [dy, dm] = ds.split('-').map(Number);
      if (dy !== year || dm !== month) continue;
      const existing = recMap[ds];
      const leaveStatus = (l.leave_time === 'wfh' || l.leave_type === 'wfh') ? 'wfh'
                        : l.leave_time === 'half' ? 'half_day' : 'on_leave';
      // WFH overrides even when check_in exists (employee works from home and checks in)
      // on_leave / half_day only apply when there is no actual office check-in
      if (leaveStatus === 'wfh' || !existing || !existing.check_in) {
        recMap[ds] = { ...(existing || {}), date: ds, status: leaveStatus, _synthetic: !existing };
      }
    }
  });

  const todayStr = toDSString(new Date());

  // Full sorted table records (status merged + absent calculation for past working days)
  const tableRecords = useMemo(() => {
    const map = { ...recMap };
    const daysInMonth = new Date(year, month, 0).getDate();
    const holidaysSet = new Set((holidays || []).map(h => h.date));

    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (ds > todayStr) continue;

      const d = new Date(ds + 'T12:00:00');
      const dow = d.getDay();
      const isWorkingDay = activeWorkDays.includes(dow) && !holidaysSet.has(ds);

      if (isWorkingDay) {
        const existing = map[ds];
        if (!existing || (!existing.check_in && !['present', 'early_leave', 'half_day', 'on_leave', 'wfh'].includes(existing?.status))) {
          if (ds < todayStr) {
            map[ds] = {
              ...(existing || {}),
              date: ds,
              status: 'absent',
              check_in: null,
              check_out: null,
              work_hours: 0,
              gross_hours: 0,
              _synthetic: !existing,
            };
          }
        }
      }
    }

    return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
  }, [records, allLeaves, schedule, holidays, year, month, todayStr]);

  // Summary counts — derived from tableRecords so KPI card counts match the filtered list
  const summary = useMemo(() => {
    const s = { present: 0, early_leave: 0, half_day: 0, on_leave: 0, wfh: 0, absent: 0 };
    tableRecords.forEach(r => { if (s[r.status] !== undefined) s[r.status]++; });
    return s;
  }, [tableRecords]);

  // Analytics derived from full tableRecords
  const analytics = useMemo(() => {
    // BUG_197: workingDaysCount must be the count of ALL past calendar working days,
    // not just days that have an attendance record. Using recMap as the source skips
    // absent days (no DB row) → absent days vanish from the denominator → 100% shown
    // even when the employee missed several days.
    // This mirrors the exact same loop inside the tableRecords useMemo so the
    // denominator always matches what the table renders.
    const daysInMonth  = new Date(year, month, 0).getDate();
    const holidayDates = new Set((holidays || []).map(h => h.date));
    let workingDaysCount = 0;
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (ds > todayStr) break;                                        // stop at today
      const dow = new Date(ds + 'T12:00:00').getDay();
      if (activeWorkDays.includes(dow) && !holidayDates.has(ds)) workingDaysCount++;
    }

    const presentCount = summary.present + summary.early_leave;
    const halfDayCount = summary.half_day;
    const attPct = workingDaysCount > 0
      ? Math.min(100, Math.round(((presentCount + halfDayCount * 0.5) / workingDaysCount) * 100))
      : 0;

    // Average work hours for present/early_leave/half_day rows
    // parseFloat handles PostgreSQL NUMERIC columns returned as strings by the pg driver
    const workedRows = tableRecords.filter(r => (r.status === 'present' || r.status === 'early_leave' || r.status === 'half_day') && parseFloat(r.work_hours) > 0);
    const avgWorkHours = workedRows.length > 0
      ? workedRows.reduce((sum, r) => sum + parseFloat(r.work_hours || 0), 0) / workedRows.length
      : 0;

    // Total break minutes for the month
    const totalBreakMins = tableRecords.reduce((sum, r) => sum + (parseInt(r.total_break_minutes, 10) || 0), 0);

    // Format avg work hours as "Xh Ym"
    const avgH = Math.floor(avgWorkHours);
    const avgM = Math.round((avgWorkHours - avgH) * 60);
    const avgWorkStr = workedRows.length > 0
      ? (avgH > 0 ? `${avgH}h ${avgM}m` : `${avgM}m`)
      : '—';

    // Format total break as "Xh Ym"
    const tbH = Math.floor(totalBreakMins / 60);
    const tbM = totalBreakMins % 60;
    const totalBreakStr = totalBreakMins > 0
      ? (tbH > 0 ? `${tbH}h ${tbM}m` : `${tbM}m`)
      : '—';

    return {
      attPct: workingDaysCount > 0 ? `${attPct}%` : '—',
      avgWorkStr,
      totalBreakStr,
      totalRecords: tableRecords.length,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableRecords, summary, activeWorkDays, holidays, year, month, todayStr]);

  // Filtered records (status filter + date search)
  const filteredRecords = useMemo(() => {
    return tableRecords.filter(r => {
      const statusMatch = statusFilter ? r.status === statusFilter : true;
      const dateMatch   = dateSearch.trim()
        ? r.date.includes(dateSearch.trim())
        : true;
      return statusMatch && dateMatch;
    });
  }, [tableRecords, statusFilter, dateSearch]);

  // Pagination
  const PAGE_SIZE = 20;
  const visibleRecords = filteredRecords.slice(0, page * PAGE_SIZE);
  const hasMore = filteredRecords.length > visibleRecords.length;

  // Toggle KPI card filter
  function handleKpiClick(key) {
    setStatusFilter(prev => prev === key ? null : key);
    setPage(1);
  }

  // Dropdown status change
  function handleDropdownChange(e) {
    const val = e.target.value;
    setStatusFilter(val === 'all' ? null : val);
    setPage(1);
  }

  // Export CSV handler
  function handleExport() {
    // BUG_229: never export an empty CSV — nothing to download when filters match 0 records
    if (filteredRecords.length === 0) return;
    exportCSV(filteredRecords, MONTH_NAMES[month - 1], year);
  }

  return (
    <div>
      {/* Check-in / Check-out card */}
      <AttendanceCheckinCard onRefreshed={refetch} />

      {/* Month nav + Export */}
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-[#c7c4d8] rounded-xl p-1 shadow-sm">
          <button
            onClick={prevMonth}
            className="p-2 text-[#464555] hover:text-[#151c27] hover:bg-[#f0f3ff] rounded-lg transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-bold text-[#151c27] px-2 min-w-[130px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="p-2 text-[#464555] hover:text-[#151c27] hover:bg-[#f0f3ff] rounded-lg transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          onClick={handleExport}
          disabled={filteredRecords.length === 0}
          title={filteredRecords.length === 0 ? 'No data available to export' : 'Download attendance as CSV'}
          className="flex items-center gap-2 bg-white border border-[#c7c4d8] hover:border-[#3525cd] hover:bg-[#f0f3ff] text-[#464555] hover:text-[#3525cd] text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[#c7c4d8] disabled:hover:bg-white disabled:hover:text-[#464555]"
        >
          <Download size={14} />
          Export CSV
        </button>
      </div>

      {/* KPI Summary Cards — clickable */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        {Object.entries({ present: 'Present', early_leave: 'Early Leave', half_day: 'Half Day', on_leave: 'On Leave', wfh: 'WFH', absent: 'Absent' }).map(([key, label]) => {
          const cfg      = STATUS_CONFIG[key] || { bg: 'bg-[#f0f3ff]', text: 'text-[#464555]', border: 'border-[#c7c4d8]' };
          const isActive = statusFilter === key;
          const ringCls  = isActive ? KPI_RING[key] : '';
          return (
            <button
              key={key}
              onClick={() => handleKpiClick(key)}
              className={`${cfg.bg} ${cfg.border} ${ringCls} border rounded-xl p-3 text-center cursor-pointer transition-all hover:shadow-md focus:outline-none`}
            >
              <p className={`text-xl font-black ${cfg.text}`}>{summary[key]}</p>
              <p className="text-[0.65rem] text-[#464455] mt-0.5">{label}</p>
              {isActive && (
                <p className={`text-[0.6rem] mt-1 font-semibold ${cfg.text} opacity-70`}>Filtered ×</p>
              )}
            </button>
          );
        })}
      </div>

      {/* Analytics Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          {
            icon: <TrendingUp size={14} className="text-[#3525cd]" />,
            label: 'Attendance',
            value: analytics.attPct,
            sub: 'of working days',
          },
          {
            icon: <Clock size={14} className="text-emerald-600" />,
            label: 'Avg Work Hours',
            value: analytics.avgWorkStr,
            sub: 'per present day',
          },
          {
            icon: <Coffee size={14} className="text-amber-500" />,
            label: 'Total Break Time',
            value: analytics.totalBreakStr,
            sub: 'this month',
          },
          {
            icon: <BarChart2 size={14} className="text-cyan-600" />,
            label: 'Total Records',
            value: analytics.totalRecords,
            sub: 'attendance entries',
          },
        ].map(({ icon, label, value, sub }) => (
          <div key={label} className="bg-white border border-[#e7eefe] rounded-xl p-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center shrink-0">
              {icon}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-black text-[#151c27] leading-tight">{value}</p>
              <p className="text-[0.6rem] text-[#777587] truncate">{label}</p>
              <p className="text-[0.55rem] text-[#aaa9b8] truncate">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search + Status filter bar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        {/* Date search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#aaa9b8] pointer-events-none" />
          <input
            type="text"
            value={dateSearch}
            onChange={e => { setDateSearch(e.target.value); setPage(1); }}
            placeholder="Search by date (e.g. 15)"
            className="w-full pl-8 pr-3 py-2 text-xs border border-[#c7c4d8] rounded-xl bg-white text-[#151c27] placeholder-[#aaa9b8] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd] transition"
          />
        </div>

        {/* Status dropdown */}
        <select
          value={statusFilter ?? 'all'}
          onChange={handleDropdownChange}
          className="text-xs border border-[#c7c4d8] rounded-xl bg-white text-[#151c27] px-3 py-2 focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd] transition cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="present">Present</option>
          <option value="half_day">Half Day</option>
          <option value="on_leave">On Leave</option>
          <option value="wfh">WFH</option>
          <option value="absent">Absent</option>
        </select>

        {/* Clear filters (shown when any filter is active) */}
        {(statusFilter || dateSearch) && (
          <button
            onClick={() => { setStatusFilter(null); setDateSearch(''); setPage(1); }}
            className="text-xs text-[#3525cd] font-semibold px-3 py-2 rounded-xl border border-[#c7c4d8] bg-[#f0f3ff] hover:bg-[#e7eefe] transition"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Attendance Table */}
      {isLoading ? (
        <div className="flex justify-center py-10"><div className="spinner w-6 h-6" /></div>
      ) : filteredRecords.length === 0 && Object.keys(recMap).length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-[#c7c4d8] text-[#777587] text-sm">
          No records for {MONTH_NAMES[month - 1]} {year}
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-[#c7c4d8] text-[#777587] text-sm">
          No records match your current filters.
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[780px]">
                <thead className="bg-[#f0f3ff] border-b border-[#c7c4d8]">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide">Date</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide">Status</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide">Check-In</th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide">Check-Out</th>
                    <th
                      className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide cursor-help"
                      title="Total break duration taken during the day"
                    >
                      Break
                    </th>
                    <th
                      className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide cursor-help"
                      title="Total time from check-in to check-out including breaks"
                    >
                      Gross Hours
                    </th>
                    <th
                      className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide cursor-help"
                      title="Effective work time after deducting break time"
                    >
                      Working Hours
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-bold text-[#464555] uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f3ff]">
                  {visibleRecords.map(r => {
                    const cfg        = STATUS_CONFIG[r.status] || STATUS_CONFIG.present;
                    const grossH     = r.gross_hours > 0 ? r.gross_hours : r.work_hours || null;
                    const effectiveH = r.work_hours > 0 ? r.work_hours : null;
                    const isExpanded = hasBiometric && expandedDate === r.date;
                    const punches    = punchCache[r.date];
                    return (
                      <React.Fragment key={r.id ?? r.date}>
                        <tr
                          onClick={() => handleRowClick(r.date)}
                          className={`transition-colors hover:bg-[#f8f9ff] ${hasBiometric ? 'cursor-pointer' : ''} ${isExpanded ? 'bg-[#f0f3ff]' : ''}`}
                        >
                          <td className="px-3 py-3 font-medium text-[#151c27] text-xs">
                            <div className="flex items-center gap-1.5">
                              {r.date}
                              {hasBiometric && (
                                <Fingerprint size={10} className={`${isExpanded ? 'text-[#3525cd]' : 'text-[#c7c4d8]'}`} />
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-bold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                              {cfg.label}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs text-[#464555]">{r.check_in  ? fmtTime(r.check_in)  : '—'}</td>
                          <td className="px-3 py-3 text-xs text-[#464555]">{r.check_out ? fmtTime(r.check_out) : '—'}</td>
                          <td className="px-3 py-3 text-xs text-amber-600">{r.total_break_minutes ? fmtBreak(r.total_break_minutes) : '—'}</td>
                          <td className="px-3 py-3 text-xs text-[#151c27]">{grossH    ? fmtHours(grossH)     : '—'}</td>
                          <td className="px-3 py-3 text-xs font-semibold text-[#151c27]">{effectiveH ? fmtHours(effectiveH) : '—'}</td>
                          <td className="px-3 py-3">
                            <button
                              onClick={e => handleRegularize(e, r.date)}
                              className="inline-flex items-center gap-1 text-[0.65rem] font-semibold text-[#3525cd] border border-[#c7c4d8] rounded-lg px-2 py-1 hover:bg-[#f0f3ff] hover:border-[#3525cd] transition whitespace-nowrap"
                              title="Apply attendance regularization for this date"
                            >
                              <ClipboardEdit size={10} />
                              Regularize
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-[#f8f9ff]">
                            <td colSpan={8} className="px-4 pb-3 pt-0">
                              <div className="border border-[#e7eefe] rounded-xl p-3 bg-white">
                                <div className="flex items-center gap-2 mb-2.5">
                                  <Fingerprint size={12} className="text-[#3525cd]" />
                                  <span className="text-[0.65rem] font-bold uppercase tracking-wide text-[#3525cd]">
                                    Biometric Punches — {user?.name?.toUpperCase()} on {r.date}
                                  </span>
                                </div>
                                {loadingPunchDate === r.date ? (
                                  <div className="flex items-center gap-2 text-xs text-[#777587]">
                                    <span className="spinner w-3 h-3" /> Loading punches…
                                  </div>
                                ) : !punches || punches.length === 0 ? (
                                  <p className="text-xs text-[#777587] italic">No biometric punches found for this date.</p>
                                ) : (
                                  <div className="flex flex-wrap gap-2">
                                    {punches.map(punch => {
                                      const isIn = punch.punch_type === 0;
                                      return (
                                        <span
                                          key={punch.id}
                                          className={`inline-flex items-center gap-1.5 text-[0.65rem] font-semibold px-3 py-1 rounded-full border ${
                                            isIn
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                              : 'bg-rose-50 text-rose-700 border-rose-200'
                                          }`}
                                        >
                                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isIn ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                          {isIn ? 'In' : 'Out'} · {fmtPunchTime(punch.punch_time)} #{punch.employee_pin}
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Record count + Load More */}
          <div className="flex items-center justify-between mt-3 px-1">
            <p className="text-xs text-[#777587]">
              Showing {visibleRecords.length} of {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}
            </p>
            {hasMore && (
              <button
                onClick={() => setPage(p => p + 1)}
                className="text-xs font-semibold text-[#3525cd] border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] px-4 py-1.5 rounded-xl transition"
              >
                Load More
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
