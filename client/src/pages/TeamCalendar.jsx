import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Home, Umbrella, Activity, AlertTriangle,
  Globe, Users, CalendarDays, Clock, Search, Filter, X, ChevronDown,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import { MONTHS } from '@/lib/utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const LEAVE_TYPE_COLORS = {
  casual:    { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  sick:      { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  annual:    { bg: '#ede9fe', text: '#4c1d95', border: '#c4b5fd' },
  emergency: { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' },
  wfh:       { bg: '#eff6ff', text: '#1e40af', border: '#93c5fd' },
  other:     { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
};

function pad(n) { return String(n).padStart(2, '0'); }

function LeaveIcon({ leaveType, size = 10, className = '' }) {
  if (leaveType === 'sick')      return <Activity      size={size} className={className} />;
  if (leaveType === 'emergency') return <AlertTriangle size={size} className={className} />;
  return <Umbrella size={size} className={className} />;
}

function getCalendarDays(year, month) {
  const first = new Date(year, month - 1, 1).getDay();
  const total = new Date(year, month, 0).getDate();
  const days  = [];
  for (let i = 0; i < first; i++) days.push(null);
  for (let i = 1; i <= total; i++) days.push(i);
  return days;
}

function avatarInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function formatDate(ds) {
  if (!ds) return '';
  const d = new Date(ds + 'T12:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Month-Year Picker Popover ────────────────────────────────────────────────
function MonthYearPicker({ year, month, onSelect, onClose, anchorRef }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const years = [currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2];
  const [pickerYear, setPickerYear] = useState(year);
  const popRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (
        popRef.current && !popRef.current.contains(e.target) &&
        anchorRef.current && !anchorRef.current.contains(e.target)
      ) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose, anchorRef]);

  return (
    <div
      ref={popRef}
      className="absolute z-50 top-full mt-2 left-1/2 -translate-x-1/2 bg-white border border-[#c7c4d8] rounded-xl shadow-xl p-3 w-64"
    >
      {/* Year selector */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setPickerYear(y => y - 1)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#f0f3ff] text-[#777587]"
        >
          <ChevronLeft size={13} />
        </button>
        <span className="text-xs font-black text-[#151c27]">{pickerYear}</span>
        <button
          onClick={() => setPickerYear(y => y + 1)}
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-[#f0f3ff] text-[#777587]"
        >
          <ChevronRight size={13} />
        </button>
      </div>
      {/* Quick year buttons */}
      <div className="flex gap-1 flex-wrap justify-center mb-3">
        {years.map(y => (
          <button
            key={y}
            onClick={() => setPickerYear(y)}
            className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full border transition-colors ${
              y === pickerYear
                ? 'bg-[#3525cd] text-white border-[#3525cd]'
                : 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8] hover:border-[#3525cd]'
            }`}
          >
            {y}
          </button>
        ))}
      </div>
      {/* Month grid */}
      <div className="grid grid-cols-4 gap-1">
        {MONTHS.map((m, i) => {
          const isActive = pickerYear === year && (i + 1) === month;
          return (
            <button
              key={m}
              onClick={() => { onSelect(pickerYear, i + 1); onClose(); }}
              className={`text-[0.65rem] font-bold py-1.5 rounded-lg transition-colors ${
                isActive
                  ? 'bg-[#3525cd] text-white'
                  : 'text-[#464555] hover:bg-[#f0f3ff]'
              }`}
            >
              {m.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── More Popup ──────────────────────────────────────────────────────────────
function MorePopup({ day, leaves, onClose, onLeaveClick }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute z-40 bg-white border border-[#c7c4d8] rounded-xl shadow-xl p-3 w-56"
      style={{ top: '100%', left: 0, marginTop: 4 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.65rem] font-black uppercase tracking-wide text-[#3525cd]">
          Day {day} — {leaves.length} people
        </span>
        <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#f0f3ff] text-[#777587]">
          <X size={11} />
        </button>
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {leaves.map(l => {
          const isWfh = l.leave_time === 'wfh' || l.leave_type === 'wfh';
          const colors = isWfh ? LEAVE_TYPE_COLORS.wfh : (LEAVE_TYPE_COLORS[l.leave_type] || LEAVE_TYPE_COLORS.other);
          return (
            <button
              key={l.id}
              onClick={() => { onLeaveClick(l); onClose(); }}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f0f3ff] transition-colors text-left"
            >
              <div
                className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[0.6rem] font-black text-white"
                style={{ background: l.avatar_color || '#3525cd' }}
              >
                {avatarInitials(l.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.72rem] font-bold text-[#151c27] truncate">{l.name}</p>
                {l.department && <p className="text-[0.6rem] text-[#9ca3af] truncate">{l.department}</p>}
              </div>
              <span
                className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
              >
                {isWfh ? 'WFH' : l.leave_type || 'Leave'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Leave Detail Modal ───────────────────────────────────────────────────────
function LeaveDetailModal({ leave, onClose }) {
  if (!leave) return null;
  const isWfh  = leave.leave_time === 'wfh' || leave.leave_type === 'wfh';
  const isHalf = leave.leave_time === 'half';
  const colors = isWfh ? LEAVE_TYPE_COLORS.wfh : (LEAVE_TYPE_COLORS[leave.leave_type] || LEAVE_TYPE_COLORS.other);

  const start  = new Date(leave.start_date + 'T12:00:00');
  const end    = new Date(leave.end_date   + 'T12:00:00');
  const diffMs = end - start;
  const days   = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;

  const typeLabel = isWfh ? 'Work From Home' : isHalf ? 'Half Day' : (leave.leave_type
    ? leave.leave_type.charAt(0).toUpperCase() + leave.leave_type.slice(1)
    : 'Leave');

  return (
    <Modal open={!!leave} onClose={onClose} title="Leave Details" size="sm">
      <div className="space-y-4">
        {/* Employee info */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
          <Avatar name={leave.name || '?'} color={leave.avatar_color} size={40} />
          <div>
            <p className="font-black text-sm text-[#151c27]">{leave.name}</p>
            {leave.department && <p className="text-[0.7rem] text-[#9ca3af]">{leave.department}</p>}
          </div>
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-[0.62rem] font-bold uppercase tracking-wide text-[#9ca3af] mb-1">Leave Type</p>
            <span
              className="text-xs font-black px-2 py-0.5 rounded-full"
              style={{ background: colors.bg, color: colors.text, border: `1px solid ${colors.border}` }}
            >
              {typeLabel}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-[0.62rem] font-bold uppercase tracking-wide text-[#9ca3af] mb-1">Status</p>
            <span className="text-xs font-black px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
              {leave.status ? leave.status.charAt(0).toUpperCase() + leave.status.slice(1) : 'Approved'}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-[0.62rem] font-bold uppercase tracking-wide text-[#9ca3af] mb-1">Start Date</p>
            <p className="text-xs font-bold text-[#151c27]">{formatDate(leave.start_date)}</p>
          </div>
          <div className="p-3 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
            <p className="text-[0.62rem] font-bold uppercase tracking-wide text-[#9ca3af] mb-1">End Date</p>
            <p className="text-xs font-bold text-[#151c27]">{formatDate(leave.end_date)}</p>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-[#f0f3ff] border border-[#c7c4d8] flex items-center justify-between">
          <span className="text-[0.7rem] font-bold text-[#777587]">Duration</span>
          <span className="text-sm font-black text-[#3525cd]">
            {days} {days === 1 ? 'day' : 'days'}
            {isHalf ? ' (Half)' : ''}
          </span>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function TeamCalendar() {
  const { user } = useAuth();
  const { selectedBranchId } = useBranch();
  const now      = new Date();

  const [year,           setYear]          = useState(now.getFullYear());
  const [month,          setMonth]         = useState(now.getMonth() + 1);
  const [selectedDay,    setSelectedDay]   = useState(null);

  // Filters
  const [searchQuery,    setSearchQuery]   = useState('');
  const [deptFilter,     setDeptFilter]    = useState('');
  const [eventTypeFilter,setEventTypeFilter] = useState('all'); // 'all' | 'leave' | 'wfh'

  // UI state
  const [showPicker,         setShowPicker]        = useState(false);
  const [morePopupDay,       setMorePopupDay]      = useState(null);
  const [detailLeave,        setDetailLeave]       = useState(null);
  const [showPeopleAffected, setShowPeopleAffected] = useState(false);
  const [showHolidays,       setShowHolidays]      = useState(false);

  const pickerAnchorRef = useRef(null);

  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd   = `${year}-${pad(month)}-${new Date(year, month, 0).getDate()}`;
  const today      = now.toISOString().split('T')[0];

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: teamLeaves = [], isLoading } = useQuery({
    queryKey: ['team-leaves', year, month, selectedBranchId],
    queryFn:  () => apiGet('/team-leaves', { startDate: monthStart, endDate: monthEnd }),
    staleTime: 60000,
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ['holidays', year],
    queryFn:  () => apiGet('/holidays', { year }),
    staleTime: 300000,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-calendar', selectedBranchId],
    queryFn:  () => apiGet('/employees'),
    staleTime: 300000,
  });

  const { data: schedule } = useQuery({
    queryKey: ['work-schedule'],
    queryFn:  () => apiGet('/settings/schedule'),
    staleTime: 300000,
  });

  const activeWorkDays = schedule?.work_days
    ? schedule.work_days.split(',').map(Number)
    : [1, 2, 3, 4, 5];

  // ── Unique departments for filter dropdown ─────────────────────────────────
  const allDepts = Array.from(
    new Set(
      employees
        .map(e => e.department)
        .filter(Boolean)
    )
  ).sort();

  // ── Filtered leaves (master filtered list) ─────────────────────────────────
  const filteredTeamLeaves = teamLeaves.filter(l => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!l.name?.toLowerCase().includes(q)) return false;
    }
    if (deptFilter) {
      if (l.department !== deptFilter) return false;
    }
    if (eventTypeFilter === 'wfh') {
      if (!(l.leave_time === 'wfh' || l.leave_type === 'wfh')) return false;
    } else if (eventTypeFilter === 'leave') {
      if (l.leave_time === 'wfh' || l.leave_type === 'wfh') return false;
    }
    return true;
  });

  // ── Core helpers ───────────────────────────────────────────────────────────
  function getLeavesForDay(day) {
    if (!day) return [];
    const dateObj = new Date(year, month - 1, day);
    const dow = dateObj.getDay();
    if (!activeWorkDays.includes(dow)) return [];
    const ds = `${year}-${pad(month)}-${pad(day)}`;
    return filteredTeamLeaves.filter(l => l.start_date <= ds && l.end_date >= ds);
  }

  function getHolidayForDay(day) {
    const ds = `${year}-${pad(month)}-${pad(day)}`;
    return holidays.find(h => h.date === ds);
  }

  function prev() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
    setSelectedDay(null);
  }

  function next() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
    setSelectedDay(null);
  }

  function goToToday() {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setSelectedDay(null);
  }

  const calDays        = getCalendarDays(year, month);
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const todayLeaves    = isCurrentMonth ? getLeavesForDay(now.getDate()) : [];
  const selectedLeaves = selectedDay ? getLeavesForDay(selectedDay) : [];
  const selectedDs     = selectedDay ? `${year}-${pad(month)}-${pad(selectedDay)}` : null;
  const selectedHol    = selectedDay ? getHolidayForDay(selectedDay) : null;

  // ── Sidebar: on leave this month (using filteredTeamLeaves) ───────────────
  const onLeaveThisMonth = [];
  const seen = new Set();
  for (const l of filteredTeamLeaves) {
    if (l.leave_time === 'wfh' || l.leave_type === 'wfh') continue;
    if (!seen.has(l.user_id)) {
      seen.add(l.user_id);
      onLeaveThisMonth.push({
        user_id: l.user_id,
        name: l.name,
        avatar_color: l.avatar_color,
        department: l.department,
      });
    }
  }

  const leaveDayCount = {};
  for (const l of filteredTeamLeaves) {
    if (l.leave_time === 'wfh' || l.leave_type === 'wfh') continue;
    const start = new Date(Math.max(
      new Date(l.start_date + 'T12:00:00'),
      new Date(monthStart   + 'T12:00:00')
    ));
    const end = new Date(Math.min(
      new Date(l.end_date + 'T12:00:00'),
      new Date(monthEnd   + 'T12:00:00')
    ));
    if (start > end) continue;
    let count = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 0 && d.getDay() !== 6) count++;
    }
    leaveDayCount[l.user_id] = (leaveDayCount[l.user_id] || 0) + count;
  }

  // ── Month summary values (uses filteredTeamLeaves) ─────────────────────────
  const summaryLeaveCount = filteredTeamLeaves.filter(
    l => l.leave_time !== 'wfh' && l.leave_type !== 'wfh'
  ).length;
  const summaryWfhCount = filteredTeamLeaves.filter(
    l => l.leave_time === 'wfh' || l.leave_type === 'wfh'
  ).length;
  const summaryHolidayCount = holidays.filter(
    h => h.date >= monthStart && h.date <= monthEnd
  ).length;

  const hasFilters = searchQuery || deptFilter || eventTypeFilter !== 'all';

  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Team Calendar</h1>
          <p className="page-subtitle">See who's on leave or working from home</p>
        </div>

        {/* Month navigation */}
        <div className="flex items-center gap-1.5 bg-white border border-[#c7c4d8] rounded-xl px-2 py-1.5 shadow-sm relative">
          <button
            onClick={prev}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"
          >
            <ChevronLeft size={15} />
          </button>

          {/* Clickable month-year label */}
          <button
            ref={pickerAnchorRef}
            onClick={() => setShowPicker(v => !v)}
            className="flex items-center gap-1 font-black text-[#151c27] min-w-[8rem] text-center text-sm justify-center px-1 py-0.5 rounded-lg hover:bg-[#f0f3ff] transition-colors"
          >
            {MONTHS[month - 1]} {year}
            <ChevronDown size={12} className={`text-[#777587] transition-transform ${showPicker ? 'rotate-180' : ''}`} />
          </button>

          {showPicker && (
            <MonthYearPicker
              year={year}
              month={month}
              anchorRef={pickerAnchorRef}
              onSelect={(y, m) => { setYear(y); setMonth(m); setSelectedDay(null); }}
              onClose={() => setShowPicker(false)}
            />
          )}

          <button
            onClick={next}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"
          >
            <ChevronRight size={15} />
          </button>

          {/* Today button */}
          {!isCurrentMonth && (
            <button
              onClick={goToToday}
              className="text-[0.65rem] font-black px-2.5 py-1 rounded-lg border border-[#3525cd] text-[#3525cd] hover:bg-[#f0f3ff] transition-colors ml-1"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="bg-white border border-[#c7c4d8] rounded-xl px-4 py-3 shadow-sm flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            type="text"
            placeholder="Search employee…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 text-xs border border-[#c7c4d8] rounded-lg focus:outline-none focus:border-[#3525cd] text-[#151c27] placeholder:text-[#9ca3af]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] hover:text-[#151c27]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Department filter */}
        <div className="relative">
          <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            className="pl-7 pr-7 py-1.5 text-xs border border-[#c7c4d8] rounded-lg focus:outline-none focus:border-[#3525cd] text-[#151c27] bg-white appearance-none cursor-pointer"
          >
            <option value="">All Departments</option>
            {allDepts.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9ca3af] pointer-events-none" />
        </div>

        {/* Event type filter */}
        <div className="flex items-center gap-1 bg-[#f9f9ff] border border-[#e7eefe] rounded-lg p-0.5">
          {[
            { key: 'all',   label: 'All' },
            { key: 'leave', label: 'Leave Only' },
            { key: 'wfh',   label: 'WFH Only' },
          ].map(opt => (
            <button
              key={opt.key}
              onClick={() => setEventTypeFilter(opt.key)}
              className={`text-[0.65rem] font-bold px-3 py-1 rounded-md transition-colors ${
                eventTypeFilter === opt.key
                  ? 'bg-[#3525cd] text-white shadow-sm'
                  : 'text-[#777587] hover:text-[#3525cd]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Clear all filters */}
        {hasFilters && (
          <button
            onClick={() => { setSearchQuery(''); setDeptFilter(''); setEventTypeFilter('all'); }}
            className="flex items-center gap-1 text-[0.65rem] font-bold text-rose-500 hover:text-rose-700 transition-colors"
          >
            <X size={11} /> Clear filters
          </button>
        )}
      </div>

      {/* ── Today's snapshot ─────────────────────────────────────────────────── */}
      {isCurrentMonth && todayLeaves.length > 0 && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-black uppercase tracking-widest text-amber-700">
              Out Today — {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            {hasFilters && (
              <span className="text-[0.6rem] font-bold text-[#9ca3af] bg-[#f0f3ff] px-2 py-0.5 rounded-full">
                filtered
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {todayLeaves.map(l => {
              const isWfh     = l.leave_time === 'wfh' || l.leave_type === 'wfh';
              const typeLabel = isWfh ? 'WFH' : l.leave_time === 'half' ? 'Half Day' : l.leave_type === 'sick' ? 'Sick' : 'On Leave';
              return (
                <button
                  key={l.id}
                  onClick={() => setDetailLeave(l)}
                  className={`flex items-center gap-2 rounded-full pl-1.5 pr-3 py-1 border transition-colors ${
                    isWfh ? 'bg-[#f0f3ff] border-[#c7c4d8] hover:border-[#3525cd]' : 'bg-amber-50 border-amber-200 hover:border-amber-400'
                  }`}
                >
                  <Avatar name={l.name || '?'} color={l.avatar_color} size={22} />
                  <span className={`text-xs font-semibold ${isWfh ? 'text-[#3525cd]' : 'text-amber-800'}`}>{l.name}</span>
                  {l.department && <span className="text-[0.6rem] text-[#9ca3af]">· {l.department}</span>}
                  <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${
                    isWfh ? 'bg-[#3525cd] text-white' : 'bg-amber-200 text-amber-800'
                  }`}>
                    {typeLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isCurrentMonth && todayLeaves.length === 0 && !isLoading && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-semibold text-emerald-700">
            {hasFilters
              ? 'No matches for today with current filters.'
              : 'Everyone is in today — no approved leaves.'}
          </span>
        </div>
      )}

      <div className="flex gap-5">

        {/* ── Calendar grid ──────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">

            {/* Day headers */}
            <div className="grid grid-cols-7 bg-[#f0f3ff] border-b border-[#c7c4d8]">
              {DAYS.map((d, i) => (
                <div
                  key={d}
                  className={`py-3 text-center text-[0.65rem] font-black uppercase tracking-wider ${
                    i === 0 || i === 6 ? 'text-rose-400' : 'text-[#777587]'
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>

            {isLoading ? (
              <div className="h-64 flex items-center justify-center">
                <div className="spinner w-6 h-6" />
              </div>
            ) : (
              <div className="grid grid-cols-7">
                {calDays.map((day, i) => {
                  if (!day) {
                    return (
                      <div
                        key={`e-${i}`}
                        className="min-h-[130px] border-b border-r border-[#f0f3ff] bg-[#fafafa]"
                      />
                    );
                  }

                  const ds         = `${year}-${pad(month)}-${pad(day)}`;
                  const isToday_   = ds === today;
                  const isSelected = selectedDay === day;
                  const holiday    = getHolidayForDay(day);
                  const dayLeaves  = getLeavesForDay(day);
                  const dow        = new Date(ds + 'T12:00:00').getDay();
                  const isWeekend  = dow === 0 || dow === 6;
                  const myLeave    = dayLeaves.find(l => l.user_id === user?.id);
                  const showMore   = morePopupDay === day;

                  return (
                    <div
                      key={day}
                      onClick={() => setSelectedDay(selectedDay === day ? null : day)}
                      className={`min-h-[130px] border-b border-r border-[#f0f3ff] p-2 cursor-pointer transition-all relative
                        ${isWeekend ? 'bg-[#fafafe]' : 'bg-white'}
                        ${holiday   ? 'bg-emerald-50/50' : ''}
                        ${isSelected ? 'ring-2 ring-inset ring-[#3525cd]' : 'hover:bg-[#f9f9ff]'}
                        ${isToday_  ? 'ring-2 ring-inset ring-[#3525cd]/30' : ''}`}
                    >
                      {/* Day number row */}
                      <div className="flex items-center justify-between mb-1">
                        <div
                          className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold transition-colors
                            ${isToday_
                              ? 'bg-[#3525cd] text-white shadow-sm'
                              : isWeekend
                                ? 'text-rose-400'
                                : 'text-[#464555]'
                            }`}
                        >
                          {day}
                        </div>
                        <div className="flex items-center gap-0.5">
                          {myLeave && (
                            <div className="w-1.5 h-1.5 rounded-full bg-[#3525cd]" title="You're on leave" />
                          )}
                          {holiday && <Globe size={9} className="text-emerald-600" />}
                        </div>
                      </div>

                      {/* Holiday label */}
                      {holiday && (
                        <div className="text-xs font-bold text-emerald-700 truncate px-0.5 mb-0.5 leading-tight">
                          {holiday.name}
                        </div>
                      )}

                      {/* Leave chips */}
                      <div className="space-y-1">
                        {dayLeaves.slice(0, 3).map(l => {
                          const isWfh  = l.leave_time === 'wfh' || l.leave_type === 'wfh';
                          const colors = isWfh
                            ? LEAVE_TYPE_COLORS.wfh
                            : (LEAVE_TYPE_COLORS[l.leave_type] || LEAVE_TYPE_COLORS.other);
                          const isMe   = l.user_id === user?.id;
                          const title  = `${l.name} · ${l.leave_type || 'leave'} · ${l.department || ''} · ${l.start_date} to ${l.end_date}`;
                          return (
                            <div
                              key={l.id}
                              title={title}
                              onClick={e => { e.stopPropagation(); setDetailLeave(l); }}
                              className="flex items-center gap-1 rounded px-1.5 py-1 text-[0.75rem] font-semibold truncate cursor-pointer hover:opacity-80 transition-opacity"
                              style={{
                                background: colors.bg,
                                color: colors.text,
                                border: `1px solid ${colors.border}`,
                              }}
                            >
                              <div
                                className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[0.65rem] font-black text-white"
                                style={{ background: l.avatar_color || '#3525cd' }}
                              >
                                {avatarInitials(l.name)}
                              </div>
                              <span className="truncate font-bold">
                                {isMe ? 'You' : l.name?.split(' ')[0]}
                              </span>
                              {isWfh
                                ? <Home size={10} className="flex-shrink-0 ml-auto" />
                                : <LeaveIcon leaveType={l.leave_type} size={10} className="flex-shrink-0 ml-auto" />
                              }
                            </div>
                          );
                        })}

                        {/* +More button */}
                        {dayLeaves.length > 3 && (
                          <div className="relative">
                            <button
                              onClick={e => {
                                e.stopPropagation();
                                setMorePopupDay(showMore ? null : day);
                              }}
                              className="text-[0.72rem] text-[#3525cd] pl-1 font-bold hover:underline"
                            >
                              +{dayLeaves.length - 3} more
                            </button>
                            {showMore && (
                              <MorePopup
                                day={day}
                                leaves={dayLeaves}
                                onClose={() => setMorePopupDay(null)}
                                onLeaveClick={l => setDetailLeave(l)}
                              />
                            )}
                          </div>
                        )}

                        {/* Day count */}
                        {dayLeaves.length >= 3 && (
                          <div className="text-[0.6rem] text-[#9ca3af] pl-1 leading-tight">
                            {dayLeaves.length} out
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-5 mt-3 flex-wrap">
            {[
              { label: 'On Leave', bg: '#fef3c7', border: '#fcd34d' },
              { label: 'WFH',      bg: '#eff6ff', border: '#93c5fd' },
              { label: 'Sick',     bg: '#fee2e2', border: '#fca5a5' },
              { label: 'Holiday',  bg: '#d1fae5', border: '#6ee7b7' },
              { label: 'Weekend',  bg: '#fafafe', border: '#e7eefe' },
            ].map(l => (
              <div key={l.label} className="flex items-center gap-1.5 text-xs text-[#777587]">
                <div
                  className="w-3 h-3 rounded border"
                  style={{ background: l.bg, borderColor: l.border }}
                />
                {l.label}
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-xs text-[#777587]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#3525cd]" /> Your leave
            </div>
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────────── */}
        <div className="w-64 flex-shrink-0 space-y-4 hidden lg:block">

          {/* Selected day detail */}
          {selectedDay && (
            <div className="bg-white rounded-xl border border-[#3525cd]/30 shadow-sm overflow-hidden">
              <div className="bg-[#3525cd] px-4 py-3">
                <p className="text-white text-xs font-black uppercase tracking-wide">
                  {new Date(selectedDs + 'T12:00:00').toLocaleDateString('en-US', {
                    weekday: 'long', month: 'short', day: 'numeric',
                  })}
                </p>
                {selectedHol && (
                  <p className="text-white/70 text-[0.6rem] mt-0.5">🎉 {selectedHol.name}</p>
                )}
              </div>
              <div className="p-3">
                {selectedLeaves.length === 0 ? (
                  <p className="text-xs text-[#9ca3af] text-center py-4">
                    {hasFilters ? 'No matches with current filters' : 'Everyone is in ✓'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedLeaves.map(l => {
                      const isWfh  = l.leave_time === 'wfh' || l.leave_type === 'wfh';
                      const isHalf = l.leave_time === 'half';
                      const isMe   = l.user_id === user?.id;
                      return (
                        <button
                          key={l.id}
                          onClick={() => setDetailLeave(l)}
                          className="w-full flex items-center gap-2.5 p-2 rounded-lg bg-[#f9f9ff] hover:bg-[#f0f3ff] transition-colors text-left"
                        >
                          <Avatar name={l.name || '?'} color={l.avatar_color} size={28} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-[#151c27] truncate">
                              {isMe ? `${l.name} (You)` : l.name}
                            </p>
                            <p className="text-[0.65rem] text-[#9ca3af]">{l.department}</p>
                          </div>
                          <span
                            className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
                              isWfh  ? 'bg-[#f0f3ff] text-[#3525cd]' :
                              isHalf ? 'bg-purple-50 text-purple-700' :
                                       'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {isWfh ? 'WFH' : isHalf ? 'Half' : 'Leave'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* On Leave This Month */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e7eefe] flex items-center justify-between">
              <h3 className="text-xs font-black text-[#151c27] flex items-center gap-1.5">
                <Users size={13} className="text-[#3525cd]" /> On Leave This Month
              </h3>
              <span className="text-[0.65rem] text-[#9ca3af]">{onLeaveThisMonth.length} people</span>
            </div>
            {onLeaveThisMonth.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-[#9ca3af]">
                  {hasFilters ? 'No matches with current filters' : 'No approved leaves this month'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-[#f9f9ff]">
                {onLeaveThisMonth.map(p => (
                  <div key={p.user_id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Avatar name={p.name || '?'} color={p.avatar_color} size={26} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-[#151c27] truncate">
                        {p.user_id === user?.id ? `${p.name} (You)` : p.name}
                      </p>
                      {p.department && (
                        <p className="text-[0.65rem] text-[#9ca3af] truncate">{p.department}</p>
                      )}
                    </div>
                    <span className="text-xs font-bold text-[#3525cd] bg-[#f0f3ff] px-1.5 py-0.5 rounded-full flex-shrink-0">
                      {leaveDayCount[p.user_id] || 1}d
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Month Summary — rows are clickable to filter */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4">
            <h3 className="text-xs font-black text-[#151c27] mb-3 uppercase tracking-wide">Month Summary</h3>
            <div className="space-y-1.5">
              {/* Total leaves row */}
              <div className="flex items-center justify-between text-xs p-1.5 rounded-lg">
                <span className="text-[#777587]">Total leaves</span>
                <span className="font-black px-2 py-0.5 rounded-full text-amber-600 bg-amber-50">
                  {filteredTeamLeaves.length}
                </span>
              </div>

              {/* On leave row — clickable filter */}
              <button
                onClick={() => setEventTypeFilter(f => f === 'leave' ? 'all' : 'leave')}
                className={`w-full flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors ${
                  eventTypeFilter === 'leave'
                    ? 'bg-rose-50 ring-1 ring-rose-200'
                    : 'hover:bg-[#f9f9ff]'
                }`}
              >
                <span className={`font-semibold ${eventTypeFilter === 'leave' ? 'text-rose-700' : 'text-[#777587]'}`}>
                  On leave
                  {eventTypeFilter === 'leave' && <span className="ml-1 text-[0.6rem]">✓</span>}
                </span>
                <span className="font-black px-2 py-0.5 rounded-full text-rose-600 bg-rose-50">
                  {summaryLeaveCount}
                </span>
              </button>

              {/* WFH row — clickable filter */}
              <button
                onClick={() => setEventTypeFilter(f => f === 'wfh' ? 'all' : 'wfh')}
                className={`w-full flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors ${
                  eventTypeFilter === 'wfh'
                    ? 'bg-[#f0f3ff] ring-1 ring-[#c7c4d8]'
                    : 'hover:bg-[#f9f9ff]'
                }`}
              >
                <span className={`font-semibold ${eventTypeFilter === 'wfh' ? 'text-[#3525cd]' : 'text-[#777587]'}`}>
                  WFH
                  {eventTypeFilter === 'wfh' && <span className="ml-1 text-[0.6rem]">✓</span>}
                </span>
                <span className="font-black px-2 py-0.5 rounded-full text-[#3525cd] bg-[#f0f3ff]">
                  {summaryWfhCount}
                </span>
              </button>

              {/* People affected — clickable */}
              <button
                onClick={() => setShowPeopleAffected(true)}
                className={`w-full flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors hover:bg-purple-50 ${showPeopleAffected ? 'bg-purple-50 ring-1 ring-purple-200' : ''}`}
              >
                <span className="font-semibold text-[#777587]">People affected ↗</span>
                <span className="font-black px-2 py-0.5 rounded-full text-purple-600 bg-purple-50">
                  {onLeaveThisMonth.length}
                </span>
              </button>

              {/* Public holidays — clickable */}
              <button
                onClick={() => setShowHolidays(true)}
                className={`w-full flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors hover:bg-emerald-50 ${showHolidays ? 'bg-emerald-50 ring-1 ring-emerald-200' : ''}`}
              >
                <span className="font-semibold text-[#777587]">Public holidays ↗</span>
                <span className="font-black px-2 py-0.5 rounded-full text-emerald-600 bg-emerald-50">
                  {summaryHolidayCount}
                </span>
              </button>
            </div>

            {eventTypeFilter !== 'all' && (
              <button
                onClick={() => setEventTypeFilter('all')}
                className="mt-2 w-full text-[0.65rem] font-bold text-[#9ca3af] hover:text-rose-500 transition-colors flex items-center justify-center gap-1"
              >
                <X size={10} /> Clear filter
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Leave Detail Modal ─────────────────────────────────────────────── */}
      <LeaveDetailModal leave={detailLeave} onClose={() => setDetailLeave(null)} />

      {/* ── People Affected Modal ──────────────────────────────────────────── */}
      <Modal open={showPeopleAffected} onClose={() => setShowPeopleAffected(false)} title={`People Affected — ${MONTHS[month - 1]} ${year}`} size="sm">
        {onLeaveThisMonth.length === 0 ? (
          <p className="text-sm text-[#9ca3af] text-center py-6">
            {hasFilters ? 'No matches with current filters' : 'No employees on leave this month'}
          </p>
        ) : (
          <div className="space-y-2">
            {onLeaveThisMonth.map(p => (
              <div key={p.user_id} className="flex items-center gap-3 p-2.5 rounded-xl bg-[#f9f9ff] border border-[#f0f3ff]">
                <Avatar name={p.name || '?'} color={p.avatar_color} size={32} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#151c27] truncate">{p.name}</p>
                  {p.department && <p className="text-xs text-[#9ca3af]">{p.department}</p>}
                </div>
                <span className="text-xs font-bold text-[#3525cd] bg-[#f0f3ff] px-2 py-0.5 rounded-full flex-shrink-0">
                  {leaveDayCount[p.user_id] || 1}d
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ── Public Holidays Modal ──────────────────────────────────────────── */}
      <Modal open={showHolidays} onClose={() => setShowHolidays(false)} title={`Public Holidays — ${MONTHS[month - 1]} ${year}`} size="sm">
        {(() => {
          const monthHolidays = holidays.filter(h => h.date >= monthStart && h.date <= monthEnd);
          return monthHolidays.length === 0 ? (
            <p className="text-sm text-[#9ca3af] text-center py-6">No public holidays this month</p>
          ) : (
            <div className="space-y-2">
              {monthHolidays.map(h => (
                <div key={h.date} className="flex items-center gap-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-100">
                  <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center text-lg shrink-0">🎉</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#151c27] truncate">{h.name}</p>
                    <p className="text-xs text-emerald-700">{formatDate(h.date)}</p>
                  </div>
                  {new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }) && (
                    <span className="text-[0.65rem] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
                      {new Date(h.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
