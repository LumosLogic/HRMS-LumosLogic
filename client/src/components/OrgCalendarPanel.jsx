/**
 * OrgCalendarPanel
 *
 * Reusable organisation-wide attendance calendar panel.
 * Used by:
 *   - client/src/pages/Calendar.jsx  (the /root/calendar page)
 *   - client/src/pages/Reports.jsx   (embedded in a full-screen overlay)
 *
 * The calendar always respects the active BranchContext.
 * The "View Attendance" action is configurable via the onViewAttendance prop
 * so it can navigate (Calendar page) or update in-page state (Reports overlay).
 *
 * Props:
 *   initialDate       Date|null  — starting month; defaults to today
 *   initialDayModal   string     — YYYY-MM-DD to auto-open day modal on mount
 *   initialDayTab     string     — status tab to pre-select in day modal
 *   onViewAttendance  fn(empId, month, year) — what happens when admin clicks
 *                     "View Attendance" for an employee in the day modal.
 *                     Falls back to navigate(/root/reports?...) if omitted.
 */

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, ChevronRight, Home, Umbrella, UserCheck, XCircle,
  Timer, ChevronDown, Download, Search,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth }   from '@/context/AuthContext';
import { useToast }  from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost }    from '@/lib/api';
import { Avatar }    from '@/components/ui/Avatar';
import { StatusBadge, LeaveTypeBadge } from '@/components/ui/Badge';
import { Modal }     from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import {
  fmtTime, fmtHours, toISODate, todayStr, statusLabel,
  MONTHS, DAYS, DAYS_FULL, getWeekDates, cn,
} from '@/lib/utils';

const LEAVE_TYPE_LABEL = { annual:'Annual', sick:'Sick', casual:'Casual', emergency:'Emergency', other:'Other' };

// ── Main exported component ────────────────────────────────────────────────────

export function OrgCalendarPanel({ initialDate, initialDayModal = null, initialDayTab = null, onViewAttendance }) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const { selectedBranchId } = useBranch();

  const [date,             setDate]             = useState(initialDate || new Date());
  const [mode,             setMode]             = useState('month');
  const [dayModal,         setDayModal]         = useState(initialDayModal);
  const [dayModalInitTab,  setDayModalInitTab]  = useState(initialDayTab);
  const [monthPickerOpen,  setMonthPickerOpen]  = useState(false);
  const [weekSearch,       setWeekSearch]       = useState('');
  const monthPickerRef = useRef(null);

  const navigateFallback = useNavigate();

  function openDayModal(dateStr, tab = null) {
    setDayModal(dateStr);
    setDayModalInitTab(tab);
  }

  function handleViewAttendance(empId, month, year) {
    if (onViewAttendance) {
      onViewAttendance(empId, month, year);
    } else {
      navigateFallback(`/root/reports?userId=${empId}&month=${month}&year=${year}`);
    }
  }

  const year  = date.getFullYear();
  const month = date.getMonth() + 1;
  const today = new Date();

  // ── Data fetching (same query keys as Calendar.jsx — React Query shares the cache) ──

  const { data: attendance = [], isFetching, refetch } = useQuery({
    queryKey: ['calendar', year, month, selectedBranchId],
    queryFn: () => apiGet('/attendance', { year, month }),
  });

  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn:  () => apiGet('/settings'),
    staleTime: 5 * 60 * 1000,
  });

  const workingDayNumbers = React.useMemo(() => {
    const raw = orgSettings?.schedule?.work_days;
    if (!raw) return new Set([1, 2, 3, 4, 5]);
    return new Set(raw.split(',').map(Number));
  }, [orgSettings]);

  const { data: leaves = [] } = useQuery({
    queryKey: ['calendar-leaves', year, month, selectedBranchId],
    queryFn:  () => apiGet('/leaves', { year, month }),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list', selectedBranchId],
    queryFn:  async () => {
      const all = await apiGet('/employees');
      return all.filter(e => e.role === 'employee');
    },
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ['holidays', year],
    queryFn:  () => apiGet('/holidays', { year }),
  });

  const holidayMap = holidays.reduce((acc, h) => { acc[h.date] = h; return acc; }, {});

  // ── Build attendance map + overlay approved leaves ────────────────────────────

  const grouped = {};
  attendance.forEach(r => {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push(r);
  });

  leaves.filter(l => l.status === 'approved').forEach(l => {
    const start = new Date(l.start_date + 'T12:00:00');
    const end   = new Date(l.end_date   + 'T12:00:00');
    const leaveStatus = (l.leave_time === 'wfh' || l.leave_type === 'wfh') ? 'wfh'
                      : l.leave_time === 'half' ? 'half_day'
                      : 'on_leave';
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (!workingDayNumbers.has(d.getDay())) continue;
      const ds = toISODate(d);
      if (!grouped[ds]) grouped[ds] = [];
      const idx = grouped[ds].findIndex(r => r.user_id === l.user_id);
      if (idx === -1) {
        grouped[ds].push({ user_id: l.user_id, date: ds, status: leaveStatus, _synthetic: true });
      } else if (leaveStatus === 'wfh') {
        if (!['on_leave', 'half_day'].includes(grouped[ds][idx].status))
          grouped[ds][idx] = { ...grouped[ds][idx], status: 'wfh' };
      } else if (!['on_leave','wfh','half_day'].includes(grouped[ds][idx].status) && !grouped[ds][idx].check_in) {
        grouped[ds][idx] = { ...grouped[ds][idx], status: leaveStatus };
      }
    }
  });

  const leavesByUser = leaves.reduce((acc, l) => {
    if (!acc[l.user_id]) acc[l.user_id] = [];
    acc[l.user_id].push(l);
    return acc;
  }, {});

  function getLeaveForDate(userId, dateStr) {
    return (leavesByUser[userId] || []).find(l =>
      l.status === 'approved' && dateStr >= l.start_date && dateStr <= l.end_date
    ) || null;
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  function navPrev() {
    if (mode === 'month') setDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    else setDate(d => { const x = new Date(d); x.setDate(x.getDate() - 7); return x; });
  }
  function navNext() {
    if (mode === 'month') setDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    else setDate(d => { const x = new Date(d); x.setDate(x.getDate() + 7); return x; });
  }

  const weekDates = getWeekDates(date);
  const titleText = mode === 'month'
    ? `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
    : (() => {
        const s = weekDates[0]; const e = weekDates[6];
        return s.getMonth() === e.getMonth()
          ? `${MONTHS[s.getMonth()]} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`
          : `${MONTHS[s.getMonth()]} ${s.getDate()} – ${MONTHS[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
      })();

  return (
    <div>
      {/* Toolbar */}
      <div className="card px-5 py-3.5 mb-5 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 relative" ref={monthPickerRef}>
          <button className="btn btn-outline btn-icon p-1.5" onClick={navPrev}><ChevronLeft size={18} /></button>
          <button className="text-base font-black min-w-[200px] text-center tracking-tight hover:opacity-80 transition-opacity cursor-pointer px-2 py-1 rounded-lg hover:bg-[#f0f3ff]"
            style={{ background: 'linear-gradient(135deg, #151c27 30%, #3525cd)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            onClick={() => setMonthPickerOpen(o => !o)}>
            {titleText}
          </button>
          <button className="btn btn-outline btn-icon p-1.5" onClick={navNext}><ChevronRight size={18} /></button>
          {monthPickerOpen && (
            <div className="absolute top-full left-0 mt-2 z-50 bg-white border border-[#c7c4d8] rounded-xl shadow-xl p-4 min-w-[280px]">
              <div className="flex items-center gap-2 mb-3">
                <input type="number" className="form-control py-1 text-sm w-24 text-center font-bold"
                  value={date.getFullYear()} min={2020} max={2030}
                  onChange={e => { const y = Number(e.target.value); if (y >= 2020 && y <= 2030) setDate(new Date(y, date.getMonth(), 1)); }} />
                <span className="text-xs text-[#777587]">Year</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS.map((m, i) => (
                  <button key={m} onClick={() => { setDate(new Date(date.getFullYear(), i, 1)); setMonthPickerOpen(false); }}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-colors ${date.getMonth() === i ? 'bg-[#3525cd] text-white' : 'text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd]'}`}>
                    {m.substring(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => { setDate(new Date()); openDayModal(todayStr()); }}>Today</button>
        {isFetching && (
          <div className="w-4 h-4 rounded-full border-2 border-[#e7eefe] border-t-[#3525cd] animate-spin flex-shrink-0" />
        )}
        <div className="flex bg-[#f0f3ff] border border-[#c7c4d8] rounded-xl p-1 gap-1">
          {['month','week'].map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('px-4 py-1.5 rounded-lg text-xs font-bold transition-all duration-150', mode === m ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]')}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        {mode === 'week' && isAdmin && (
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#777587]" />
            <input className="form-control pl-7 py-1.5 text-xs w-36" placeholder="Filter employee…"
              value={weekSearch} onChange={e => setWeekSearch(e.target.value)} />
          </div>
        )}
        {mode === 'month' && (
          <button className="btn btn-outline btn-sm" title="Export month attendance"
            onClick={() => {
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              const fmtD = ds => {
                const d = new Date(ds + 'T12:00:00');
                return isNaN(d.getTime()) ? ds : `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
              };
              const rows = [['Date','Employee','Status','Check In','Check Out']];
              Object.entries(grouped).forEach(([d, recs]) => {
                recs.forEach(r => rows.push([fmtD(d), r.name || '', r.status || '', r.check_in || '', r.check_out || '']));
              });
              const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `attendance_${year}_${String(month).padStart(2,'0')}.csv`; a.click();
              URL.revokeObjectURL(url);
            }}>
            <Download size={13} />Export
          </button>
        )}
        <div className="hidden lg:flex items-center gap-3.5 ml-auto flex-wrap">
          {[['#10B981','Present'],['#EF4444','Absent'],['#F59E0B','On Leave'],['#06B6D4','Half Day'],['#3525cd','WFH']].map(([c, l]) => (
            <div key={l} className="flex items-center gap-1.5 text-xs text-[#777587] font-semibold">
              <span className="w-2.5 h-2.5 rounded-full border border-white/30" style={{ background: c, boxShadow: `0 0 5px ${c}` }} /> {l}
            </div>
          ))}
        </div>
      </div>

      {/* Calendar Body */}
      {mode === 'month'
        ? <MonthView year={year} month={month - 1} grouped={grouped} employees={employees} user={user} isAdmin={isAdmin} onDayClick={openDayModal} holidayMap={holidayMap} workingDayNumbers={workingDayNumbers} />
        : <WeekView weekDates={weekDates} grouped={grouped} employees={employees} user={user} isAdmin={isAdmin} onDayClick={openDayModal} getLeaveForDate={getLeaveForDate} searchQuery={weekSearch} />
      }

      {/* Day detail modal */}
      {dayModal && (
        <DayModal
          dateStr={dayModal}
          records={grouped[dayModal] || []}
          employees={employees}
          isAdmin={isAdmin}
          user={user}
          initialTab={dayModalInitTab}
          getLeaveForDate={getLeaveForDate}
          year={year}
          month={month}
          onClose={() => { setDayModal(null); setDayModalInitTab(null); }}
          onRefresh={refetch}
          onViewAttendance={handleViewAttendance}
        />
      )}
    </div>
  );
}

// ── Month View ─────────────────────────────────────────────────────────────────

function MonthView({ year, month, grouped, employees, user, isAdmin, onDayClick, holidayMap = {}, workingDayNumbers = new Set([1,2,3,4,5]) }) {
  const today = todayStr();
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay); startDate.setDate(startDate.getDate() - startDate.getDay());
  const endDate   = new Date(lastDay);  endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));
  const cells = [];
  const cur = new Date(startDate);
  while (cur <= endDate) { cells.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }

  return (
    <>
      <div className="grid grid-cols-7 rounded-t-xl overflow-hidden border border-[#c7c4d8] border-b-0" style={{ background: 'linear-gradient(135deg, #f0f3ff, #fff)' }}>
        {DAYS.map((d, idx) => (
          <div key={d} className={cn('py-3 text-center text-[0.7rem] font-black uppercase tracking-widest text-[#777587]', !workingDayNumbers.has(idx) && 'text-rose-400')}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 border border-[#c7c4d8] rounded-b-xl overflow-hidden shadow-card" style={{ background: 'rgba(14,165,233,.04)', gap: '1px' }}>
        {cells.map((c, i) => {
          const ds      = toISODate(c);
          const isOther = c.getMonth() !== month;
          const isTodayD = ds === today;
          const isWkend  = !workingDayNumbers.has(c.getDay());
          const records  = grouped[ds] || [];
          const holiday  = holidayMap[ds];
          return (
            <div key={i} onClick={() => onDayClick(ds)}
              className={cn('bg-white min-h-[110px] p-2 cursor-pointer flex flex-col gap-1 transition-colors duration-100',
                isOther && 'bg-[#f0f3ff]', isTodayD && 'bg-[#eef0ff]', isWkend && !isTodayD && 'bg-slate-50', 'hover:bg-[#f0f3ff]')}>
              <div className={cn('text-[0.8rem] font-black w-6.5 h-6.5 flex items-center justify-center shrink-0', isOther && 'opacity-25', isTodayD && 'w-7 h-7 rounded-full text-white text-xs')}
                style={isTodayD ? { background: '#3525cd' } : {}}>
                {c.getDate()}
              </div>
              {!isOther && holiday && (
                <span className="text-[0.56rem] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 truncate leading-tight" title={holiday.name}>
                  🗓 {holiday.name}
                </span>
              )}
              {!isOther && !isWkend && (
                isAdmin
                  ? <AdminCellContent ds={ds} records={records} total={employees.length} />
                  : <EmpCellContent records={records} userId={user?.id} />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function AdminCellContent({ ds, records, total }) {
  if (total === 0) return null;
  const isFuture = ds > todayStr();
  const present = records.filter(r => r.status === 'present').length;
  const onLeave = records.filter(r => r.status === 'on_leave').length;
  const absent  = records.filter(r => r.status === 'absent').length;
  const half    = records.filter(r => r.status === 'half_day').length;
  const wfh     = records.filter(r => r.status === 'wfh').length;
  if (isFuture) {
    if (onLeave + half + wfh === 0) return null;
    return (
      <div className="flex flex-col gap-0.5 mt-0.5">
        {onLeave > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">{onLeave} Leave</span>}
        {half    > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-cyan-100  text-cyan-700">{half} Half Day</span>}
        {wfh     > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-blue-100  text-blue-700">{wfh} WFH</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 mt-0.5">
      {present > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{present} Present</span>}
      {onLeave > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-amber-100   text-amber-700">{onLeave} Leave</span>}
      {absent  > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-rose-100    text-rose-700">{absent} Absent</span>}
      {half    > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-cyan-100    text-cyan-700">{half} Half Day</span>}
      {wfh     > 0 && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-blue-100    text-blue-700">{wfh} WFH</span>}
    </div>
  );
}

function EmpCellContent({ records, userId }) {
  const my = records.find(r => r.user_id === userId);
  if (!my) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn('text-[0.64rem] font-black px-1.5 py-0.5 rounded capitalize',
        { present:'bg-emerald-100 text-emerald-700', absent:'bg-rose-100 text-rose-700', on_leave:'bg-amber-100 text-amber-700', half_day:'bg-cyan-100 text-cyan-700', wfh:'bg-[#e7eefe] text-[#3525cd]' }[my.status] || 'bg-[#f0f3ff] text-[#464555]'
      )}>{statusLabel(my.status)}</span>
      {my.work_hours > 0 && <span className="text-[0.58rem] text-[#777587]">{fmtHours(my.work_hours)}</span>}
    </div>
  );
}

// ── Week View ──────────────────────────────────────────────────────────────────

const STATUS_COLORS_MAP = { present:'#10B981', early_leave:'#F97316', absent:'#EF4444', on_leave:'#F59E0B', half_day:'#06B6D4', wfh:'#3525cd' };

function WeekView({ weekDates, grouped, employees, user, isAdmin, onDayClick, getLeaveForDate, searchQuery = '' }) {
  const today = todayStr();
  return (
    <div className="grid grid-cols-7 gap-2.5">
      {weekDates.map(d => {
        const ds      = toISODate(d);
        const isToday = ds === today;
        const records = grouped[ds] || [];
        const displayRecords = isAdmin
          ? records.filter(r => !searchQuery || (r.name || '').toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 8)
          : records.filter(r => r.user_id === user?.id);
        return (
          <div key={ds} className={cn('card overflow-hidden hover:translate-y-[-4px] hover:shadow-card-hover transition-all duration-200', isToday && 'ring-2 ring-[#3525cd]/30')}>
            <div className={cn('py-3.5 px-2.5 text-center border-b border-[#f0f3ff] cursor-pointer hover:bg-[#f0f3ff] transition-colors', isToday && 'bg-[#f0f3ff]/60')} onClick={() => onDayClick(ds)}>
              <div className={cn('text-[0.64rem] font-black uppercase tracking-widest mb-1', isToday ? 'text-[#3525cd]' : 'text-[#777587]')}>{DAYS[d.getDay()]}</div>
              <div className={cn('text-2xl font-black tracking-tight', isToday ? 'text-[#3525cd]' : 'text-[#151c27]')}>{d.getDate()}</div>
              {isAdmin && records.length > 0 && <div className="mt-1 text-[0.6rem] text-[#777587]">{records.length} records</div>}
            </div>
            <div className="p-1.5 flex flex-col gap-0.5 max-h-48 overflow-y-auto">
              {displayRecords.map(r => {
                const leave = isAdmin ? getLeaveForDate?.(r.user_id, ds) : null;
                return (
                  <div key={r.id} className="flex items-start gap-1.5 px-1.5 py-1 rounded hover:bg-[#f0f3ff] transition-colors">
                    <span className="w-2 h-2 rounded-full shrink-0 mt-0.5" style={{ background: STATUS_COLORS_MAP[r.status] || '#777587' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[0.68rem] font-semibold truncate">{isAdmin ? r.name?.split(' ')[0] : statusLabel(r.status)}</div>
                      {r.status === 'on_leave' && leave && <div className="text-[0.58rem] text-amber-600 font-medium truncate">{LEAVE_TYPE_LABEL[leave.leave_type] || leave.leave_type}</div>}
                      {r.status === 'wfh'      && <div className="text-[0.58rem] text-[#3525cd] font-medium">WFH</div>}
                      {r.work_hours > 0 && r.status === 'present' && <div className="text-[0.58rem] text-[#777587]">{fmtHours(r.work_hours)}</div>}
                    </div>
                  </div>
                );
              })}
              {isAdmin && records.length > 8 && (
                <button className="text-[0.6rem] text-[#3525cd] font-bold px-1.5 py-1 text-left hover:underline" onClick={() => onDayClick(ds)}>
                  +{records.length - 8} more
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Day Modal ──────────────────────────────────────────────────────────────────

function DayModal({ dateStr, records, employees, isAdmin, user, onClose, onRefresh, getLeaveForDate, initialTab, year, month, onViewAttendance }) {
  const toast = useToast();
  const d = new Date(dateStr + 'T12:00:00');
  const [activeTab,     setActiveTab]     = useState(initialTab || 'all');
  const [confirmAbsent, setConfirmAbsent] = useState(null);

  async function doMarkAbsent(emp) {
    try {
      await apiPost('/attendance/mark-absent', { user_id: emp.id, date: dateStr });
      toast('Marked absent', 'success');
      onRefresh();
      onClose();
    } catch (err) { toast(err.message, 'error'); }
    setConfirmAbsent(null);
  }

  const present  = records.filter(r => r.status === 'present').length;
  const absent   = records.filter(r => r.status === 'absent').length;
  const onLeave  = records.filter(r => r.status === 'on_leave').length;
  const wfhCount = records.filter(r => r.status === 'wfh').length;
  const halfDay  = records.filter(r => r.status === 'half_day').length;
  const isFutureDay = dateStr > todayStr();

  const displayEmployees = isAdmin ? employees : employees.filter(e => e.id === user?.id);
  const filteredEmps = activeTab === 'all'
    ? (isFutureDay
        ? displayEmployees.filter(emp => records.some(r => r.user_id === emp.id && ['on_leave','half_day','wfh'].includes(r.status)))
        : displayEmployees)
    : displayEmployees.filter(emp => {
        const rec = records.find(r => r.user_id === emp.id);
        if (activeTab === 'present')  return rec && rec.status === 'present' && !rec._synthetic;
        if (activeTab === 'on_leave') return rec && (rec.status === 'on_leave' || rec.status === 'half_day');
        if (activeTab === 'wfh')      return rec && rec.status === 'wfh';
        if (activeTab === 'absent')   return rec && rec.status === 'absent';
        if (activeTab === 'none')     return !rec;
        return true;
      });

  return (
    <>
      <Modal open onClose={onClose}
        title={dateStr === todayStr() ? "Today's Attendance" : `Attendance — ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`}
        size="lg">
        {{
          body: (
            <>
              {/* Date header */}
              <div className="flex items-center gap-5 mb-4 p-4 rounded-xl border border-[#c7c4d8] relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(53,37,205,.06), rgba(113,42,226,.04))' }}>
                <div className="text-5xl font-black tracking-[-0.05em]"
                  style={{ background: 'linear-gradient(135deg, #3525cd, #712ae2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                  {d.getDate()}
                </div>
                <div className="flex-1">
                  <div className="text-base font-black">{DAYS_FULL[d.getDay()]}, {MONTHS[d.getMonth()]} {d.getFullYear()}</div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200"><UserCheck size={11} /> {present} Present</span>
                    <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200"><Umbrella size={11} /> {onLeave} On Leave</span>
                    {wfhCount > 0 && <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-[#e7eefe] text-[#3525cd] border border-[#c7c4d8]"><Home size={11} /> {wfhCount} WFH</span>}
                    {halfDay  > 0 && <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200">{halfDay} Half Day</span>}
                    {absent   > 0 && <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200"><XCircle size={11} /> {absent} Absent</span>}
                  </div>
                </div>
              </div>

              {/* Filter tabs */}
              {isAdmin && (
                <div className="flex gap-1 mb-3 flex-wrap">
                  {(isFutureDay
                    ? [['all','On Leave'],['on_leave','Leave'],['wfh','WFH']]
                    : [['all','All'],['present','Present'],['on_leave','On Leave'],['wfh','WFH'],['absent','Absent'],['none','No Record']]
                  ).map(([k, l]) => (
                    <button key={k} onClick={() => setActiveTab(k)}
                      className={cn('text-[0.7rem] font-bold px-2.5 py-1 rounded-lg transition-colors',
                        activeTab === k ? 'bg-[#3525cd] text-white' : 'bg-[#f0f3ff] text-[#464555] hover:bg-[#e7eefe]')}>
                      {l}
                    </button>
                  ))}
                </div>
              )}

              {/* Employee list */}
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {filteredEmps.map(emp => {
                  const rec   = records.find(r => r.user_id === emp.id);
                  const leave = getLeaveForDate?.(emp.id, dateStr);
                  return (
                    <div key={emp.id}
                      className={cn('flex items-center gap-3.5 p-3.5 border rounded-xl transition-all duration-150',
                        rec?.status === 'present'  ? 'border-emerald-300 bg-emerald-50 hover:border-emerald-400' :
                        rec?.status === 'on_leave' ? 'border-amber-300 bg-amber-50 hover:border-amber-400' :
                        rec?.status === 'wfh'      ? 'border-[#c7c4d8] bg-[#f0f3ff] hover:border-[#3525cd]' :
                        rec?.status === 'absent'   ? 'border-rose-300 bg-rose-50 hover:border-rose-400' :
                        rec?.status === 'half_day' ? 'border-cyan-300 bg-cyan-50 hover:border-cyan-400' :
                        'border-[#e7eefe] hover:border-[#3525cd] hover:bg-[#f0f3ff]')}>
                      <Avatar name={emp.name} color={emp.avatar_color} size={38} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">{emp.name}</span>
                          {rec?.status === 'on_leave' && leave && (
                            <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                              {LEAVE_TYPE_LABEL[leave.leave_type] || leave.leave_type} Leave
                            </span>
                          )}
                          {rec?.status === 'wfh' && (
                            <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-[#e7eefe] text-[#3525cd] border border-[#c7c4d8]">Work from Home</span>
                          )}
                        </div>
                        <div className="text-xs text-[#777587]">{emp.department}{emp.position ? ` · ${emp.position}` : ''}</div>
                        {rec && (
                          <div className="mt-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <StatusBadge status={rec.status} />
                              {leave && (rec.status === 'on_leave' || rec.status === 'wfh' || rec.status === 'half_day') && (
                                <span className="text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 capitalize">{leave.leave_type} leave</span>
                              )}
                              {rec.work_hours > 0 && !rec._synthetic && (
                                <span className="text-xs font-bold text-[#3525cd] flex items-center gap-1"><Timer size={11} /> {fmtHours(rec.work_hours)}</span>
                              )}
                              {!rec._synthetic && rec.check_in && (
                                <div className="flex items-center gap-2 text-[0.65rem] text-[#777587] flex-wrap mt-0.5">
                                  <span>In: <strong className="text-[#151c27]">{fmtTime(rec.check_in)}</strong></span>
                                  {rec.check_out
                                    ? <span>Out: <strong className="text-[#151c27]">{fmtTime(rec.check_out)}</strong></span>
                                    : dateStr === todayStr()
                                      ? <span className="text-emerald-600 font-semibold flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block" />In Progress</span>
                                      : <span className="text-amber-600 font-semibold">No checkout</span>
                                  }
                                  {rec.total_break_minutes > 0 && (
                                    <span className="text-amber-600">Break: <strong>{Math.floor(rec.total_break_minutes / 60) > 0 ? `${Math.floor(rec.total_break_minutes / 60)}h ` : ''}{rec.total_break_minutes % 60}m</strong></span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        {!rec && <span className="text-xs text-[#777587] italic">No record yet</span>}
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            className="btn btn-outline btn-sm text-xs py-1 px-2"
                            onClick={() => onViewAttendance(emp.id, month, year)}>
                            View Attendance
                          </button>
                          {!rec && dateStr <= todayStr() && (
                            <button className="btn btn-danger btn-sm text-xs py-1 px-2" onClick={() => setConfirmAbsent(emp)}>Absent</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredEmps.length === 0 && (
                  <div className="text-center py-8 text-sm text-[#777587]">No employees in this filter</div>
                )}
              </div>
            </>
          ),
        }}
      </Modal>

      <ConfirmModal
        open={!!confirmAbsent}
        title="Mark Absent"
        message={`Mark ${confirmAbsent?.name} as absent for ${dateStr}?`}
        confirmLabel="Mark Absent"
        variant="danger"
        onConfirm={() => doMarkAbsent(confirmAbsent)}
        onCancel={() => setConfirmAbsent(null)}
      />
    </>
  );
}
