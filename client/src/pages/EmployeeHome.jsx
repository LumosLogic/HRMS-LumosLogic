import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays, Umbrella, TrendingUp, Cake, PartyPopper,
  Home, Users, ChevronLeft, ChevronRight,
  CheckCircle2, LogIn, LogOut, Timer, UserPlus,
  Coffee, Play, Bell, ClipboardList, Clock, AlertTriangle,
  BookOpen, FileText, CreditCard, Download, FolderOpen,
  Target, User, Zap, ArrowRight,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { STALE } from '@/lib/queryTiers';
import { useAnnouncements } from '@/hooks/useReferenceData';
import { useLeavesList, useRegularizations, useExpenses, useLeavePolicies } from '@/hooks/useListQueries';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { Avatar } from '@/components/ui/Avatar';
import { invalidateMyAttendance } from '@/hooks/useAttendanceDay';
import { todayStr, fmtDate, fmtTime, fmtHours, countWorkingDaysInRange, toISODate } from '@/lib/utils';
import { ApplyLeaveModal } from './Leaves';

/* ─── constants ──────────────────────────────────────────────────────────── */

const LEAVE_ICONS = {
  casual:      { emoji: '🌂', bg: 'bg-amber-50',   border: 'border-amber-100',  bar: '#f59e0b' },
  sick:        { emoji: '🤒', bg: 'bg-rose-50',    border: 'border-rose-100',   bar: '#ef4444' },
  annual:      { emoji: '🏖️', bg: 'bg-[#f0f3ff]', border: 'border-[#e7eefe]', bar: '#4f46e5' },
  earned:      { emoji: '🏖️', bg: 'bg-[#f0f3ff]', border: 'border-[#e7eefe]', bar: '#4f46e5' },
  emergency:   { emoji: '🚨', bg: 'bg-rose-50',    border: 'border-rose-100',   bar: '#ef4444' },
  maternity:   { emoji: '👶', bg: 'bg-pink-50',    border: 'border-pink-100',   bar: '#ec4899' },
  paternity:   { emoji: '👨‍👧', bg: 'bg-blue-50',  border: 'border-blue-100',   bar: '#3b82f6' },
  bereavement: { emoji: '🕊️', bg: 'bg-slate-50',  border: 'border-slate-100',  bar: '#64748b' },
  unpaid:      { emoji: '📋', bg: 'bg-slate-50',   border: 'border-slate-100',  bar: '#94a3b8' },
  comp_off:    { emoji: '⏱️', bg: 'bg-purple-50',  border: 'border-purple-100', bar: '#a855f7' },
  other:       { emoji: '📋', bg: 'bg-slate-50',   border: 'border-slate-100',  bar: '#64748b' },
  wfh:         { emoji: '🏠', bg: 'bg-[#f0f3ff]', border: 'border-[#e7eefe]', bar: '#06b6d4' },
};

const LEAVE_LABELS = {
  wfh: 'WFH', casual: 'Casual Leave', sick: 'Sick Leave', annual: 'Annual Leave',
  earned: 'Earned Leave', emergency: 'Emergency Leave', maternity: 'Maternity Leave',
  paternity: 'Paternity Leave', bereavement: 'Bereavement Leave', unpaid: 'Unpaid Leave',
  comp_off: 'Comp Off', other: 'Other Leave',
};

function leaveLabel(type) {
  return LEAVE_LABELS[type] || (type ? type.replace(/_/g, ' ').replace(/\b\w/g, s => s.toUpperCase()) : 'Leave');
}

const STATUS_BADGE = {
  pending:      'border border-amber-300 text-amber-700 bg-amber-50',
  pending_dept: 'border border-blue-300 text-blue-700 bg-blue-50',
  pending_root: 'border border-violet-300 text-violet-700 bg-violet-50',
  approved:     'bg-emerald-500 text-white border border-emerald-500',
  rejected:     'bg-rose-500 text-white border border-rose-500',
  cancelled:    'border border-[#c7c4d8] text-[#777587] bg-[#f9f9ff]',
};

const STATUS_DISPLAY_LABEL = {
  pending:      'Pending',
  pending_dept: 'Pending Dept. Approval',
  pending_root: 'Pending Final Approval',
  approved:     'Approved',
  rejected:     'Rejected',
  cancelled:    'Cancelled',
};

const ATT_STATUS_CONFIG = {
  present:  { label: 'Present',  dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50',  border: 'border-emerald-200' },
  half_day: { label: 'Half Day', dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',    border: 'border-amber-200'   },
  on_leave: { label: 'On Leave', dot: 'bg-[#3525cd]',   text: 'text-[#3525cd]',   bg: 'bg-[#f0f3ff]',  border: 'border-[#e7eefe]'   },
  wfh:      { label: 'WFH',      dot: 'bg-cyan-500',    text: 'text-cyan-700',     bg: 'bg-cyan-50',     border: 'border-cyan-200'    },
  absent:   { label: 'Absent',   dot: 'bg-rose-500',    text: 'text-rose-700',     bg: 'bg-rose-50',     border: 'border-rose-200'    },
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ─── helpers ────────────────────────────────────────────────────────────── */

function fmtLeaveDate(start, end) {
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  const s = new Date(start + 'T12:00:00').toLocaleDateString('en-IN', opts);
  if (start === end) return s;
  const e = new Date(end + 'T12:00:00').toLocaleDateString('en-IN', opts);
  return `${s} – ${e}`;
}

function fmtBreakTime(totalBreakMinutes) {
  if (!totalBreakMinutes) return '—';
  const h = Math.floor(totalBreakMinutes / 60), m = totalBreakMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function getGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good Morning';
  if (h >= 12 && h < 17) return 'Good Afternoon';
  if (h >= 17 && h < 21) return 'Good Evening';
  return 'Good Night';
}

function parseWorkMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + (m || 0);
}

/* ─── sub-components ─────────────────────────────────────────────────────── */

function WeekBarChart({ recentAttendance, today }) {
  // Build Mon–Sun of the current week
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dow + 6) % 7));

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toISODate(d);
    const rec = recentAttendance.find(r => r.date === dateStr);
    const hours = parseFloat(rec?.work_hours ?? 0) || 0;
    return { label: DAY_LABELS[(d.getDay())], dateStr, hours, isToday: dateStr === today, isFuture: dateStr > today };
  });

  const maxH = 8; // target workday hours

  const presentDays  = weekDays.filter(d => !d.isFuture && d.hours > 0).length;
  const avgHours     = presentDays > 0
    ? (weekDays.filter(d => d.hours > 0).reduce((s, d) => s + d.hours, 0) / presentDays).toFixed(1)
    : '0.0';
  const attendancePct = Math.round((presentDays / 5) * 100); // out of 5 weekdays

  return (
    <div>
      {/* bars — outer is items-stretch so columns fill h-28 (112px) */}
      <div className="flex gap-2 h-28 mb-2">
        {weekDays.map((d, i) => {
          const isWknd = i === 5 || i === 6; // Sat/Sun
          let barColor = '#e0e7ff';
          if (!d.isFuture && !isWknd && d.hours > 0) {
            barColor = d.hours >= 8 ? '#10b981' : d.hours >= 6 ? '#f59e0b' : '#ef4444';
          }
          if (d.isToday && d.hours === 0 && !isWknd) barColor = '#c7c4d8';

          // Use pixel heights so bars are visible regardless of parent flex sizing
          const barPx = (!d.isFuture && d.hours > 0)
            ? Math.max(6, Math.round((d.hours / maxH) * 88))
            : 6;

          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 group relative">
              {/* tooltip */}
              {!d.isFuture && d.hours > 0 && (
                <div className="absolute bottom-full mb-1 hidden group-hover:block z-10 bg-[#151c27] text-white text-[0.6rem] font-bold px-1.5 py-0.5 rounded whitespace-nowrap">
                  {d.hours.toFixed(1)}h
                </div>
              )}
              <div
                className="w-full rounded-t-md transition-all duration-300"
                style={{
                  height: `${barPx}px`,
                  background: barColor,
                  opacity: d.isFuture ? 0.35 : 1,
                }}
              />
              <span className={`text-[0.6rem] font-bold ${d.isToday ? 'text-[#3525cd]' : 'text-[#9ca3af]'}`}>
                {d.label}
              </span>
              {d.isToday && <div className="w-1 h-1 rounded-full bg-[#3525cd]" />}
            </div>
          );
        })}
      </div>

      {/* legend */}
      <div className="flex gap-2 flex-wrap mb-3">
        {[
          { color: '#10b981', label: '≥ 8h' },
          { color: '#f59e0b', label: '6–8h' },
          { color: '#ef4444', label: '< 6h' },
          { color: '#e0e7ff', label: 'Weekend / No data' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
            <span className="text-[0.58rem] text-[#777587]">{label}</span>
          </div>
        ))}
      </div>

      {/* stats strip */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#f0f3ff]">
        {[
          { label: 'Attendance', value: `${attendancePct}%` },
          { label: 'Avg Hours',  value: `${avgHours}h`      },
        ].map(({ label, value }) => (
          <div key={label} className="text-center py-2 rounded-lg bg-[#f9f9ff]">
            <p className="text-sm font-black text-[#151c27]">{value}</p>
            <p className="text-[0.6rem] font-semibold text-[#777587] uppercase tracking-wide">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamDonut({ todayTeamLeaves, user, teamCount }) {
  const isWFHLeave  = (l) => l.leave_time === 'wfh' || l.leave_type === 'wfh';
  const onLeave     = todayTeamLeaves.filter(l => !isWFHLeave(l) && l.user_id !== user?.id).length;
  const onWfh       = todayTeamLeaves.filter(l =>  isWFHLeave(l) && l.user_id !== user?.id).length;
  const inOffice    = teamCount != null ? Math.max(0, teamCount - onLeave - onWfh) : null;
  const total       = teamCount || todayTeamLeaves.length || 1;

  const segments = [
    { label: 'On Leave', count: onLeave, color: '#4f46e5', pct: (onLeave / total) * 100 },
    { label: 'WFH',      count: onWfh,   color: '#06b6d4', pct: (onWfh   / total) * 100 },
  ];

  // Simple SVG donut
  const r = 36; const cx = 44; const cy = 44; const stroke = 12;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const arcs = segments.map(seg => {
    const dash  = (seg.pct / 100) * circumference;
    const arc   = { ...seg, dash, offset };
    offset += dash;
    return arc;
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0f3ff" strokeWidth={stroke} />
          {arcs.map((arc, i) => (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={arc.color}
              strokeWidth={stroke}
              strokeDasharray={`${arc.dash} ${circumference}`}
              strokeDashoffset={-arc.offset}
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
            />
          ))}
          <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#151c27">{teamCount ?? total}</text>
          <text x={cx} y={cy + 9} textAnchor="middle" fontSize="8" fill="#777587">members</text>
        </svg>
        <div className="space-y-2 flex-1">
          {segments.map(seg => (
            <div key={seg.label} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: seg.color }} />
                <span className="text-xs text-[#464555]">{seg.label}</span>
              </div>
              <span className="text-xs font-bold text-[#151c27]">{seg.count}</span>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#f0f3ff] border border-[#c7c4d8]" />
              <span className="text-xs text-[#464555]">In Office</span>
            </div>
            <span className="text-xs font-bold text-[#151c27]">{inOffice != null ? inOffice : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────────────── */

const PER_PAGE = 3;

export default function EmployeeHome() {
  const { user } = useAuth();
  const navigate  = useNavigate();
  const toast     = useToast();
  const qc        = useQueryClient();
  const [applyLeaveOpen, setApplyLeaveOpen] = useState(false);
  const [holidayPage, setHolidayPage] = useState(0);
  const [attRecord, setAttRecord]     = useState(null);
  const [elapsed,   setElapsed]       = useState('');
  const [checkBusy, setCheckBusy]     = useState(false);
  const [breakBusy, setBreakBusy]     = useState(false);

  const nowDate = new Date();

  /* ── load today's attendance ── */
  const loadToday = useCallback(async () => {
    try { setAttRecord(await apiGet('/attendance/today')); } catch { /* silent */ }
  }, []);
  useEffect(() => { loadToday(); }, [loadToday]);

  /* ── elapsed timer (pauses on break) ── */
  useEffect(() => {
    const isOnBreak = attRecord?.break_start && !attRecord?.break_end;
    if (!attRecord?.check_in || attRecord?.check_out) { setElapsed(''); return; }
    const tick = () => {
      if (isOnBreak) {
        const [bh, bm] = attRecord.break_start.split(':').map(Number);
        const breakStart = new Date(); breakStart.setHours(bh, bm, 0, 0);
        const total = Math.floor((Date.now() - breakStart.getTime()) / 60000);
        const hrs = Math.floor(total / 60); const min = total % 60;
        setElapsed(hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
      } else {
        const [h, m] = attRecord.check_in.split(':').map(Number);
        const start = new Date(); start.setHours(h, m, 0, 0);
        const totalMins = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000) - (attRecord.total_break_minutes || 0));
        const hrs = Math.floor(totalMins / 60); const min = totalMins % 60;
        setElapsed(hrs > 0 ? `${hrs}h ${min}m` : `${min}m`);
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [attRecord]);

  /* ── check-in / out / break actions ── */
  async function checkIn() {
    setCheckBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/checkin', {});
      setAttRecord(r);
      invalidateMyAttendance(qc);
      toast(message || 'Checked in!', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setCheckBusy(false); }
  }
  async function checkOut() {
    setCheckBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/checkout', {});
      setAttRecord(r);
      invalidateMyAttendance(qc);
      toast(message || 'Checked out!', r.status === 'half_day' ? 'warning' : 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setCheckBusy(false); }
  }
  async function breakIn() {
    setBreakBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/break-in', {});
      setAttRecord(r);
      invalidateMyAttendance(qc);
      toast(message || 'Break started', 'info');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBreakBusy(false); }
  }
  async function breakOut() {
    setBreakBusy(true);
    try {
      const { record: r, message } = await apiPost('/attendance/break-out', {});
      setAttRecord(r);
      invalidateMyAttendance(qc);
      toast(message || 'Break ended', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { setBreakBusy(false); }
  }

  /* ── queries ── */
  const { data: settingsData } = useQuery({ queryKey: ['settings'], queryFn: () => apiGet('/settings'), staleTime: 10 * 60 * 1000 });
  const { data: myStats } = useQuery({ queryKey: ['my-stats'], queryFn: () => apiGet('/my-stats') });
  const { data: myLeaves = [] } = useLeavesList();   // own leaves — one cache entry shared with My Leaves / profile
  const { data: culture } = useQuery({
    queryKey: ['culture'], queryFn: () => apiGet('/culture'), staleTime: 5 * 60 * 1000, retry: 2,
  });
  const today = todayStr();
  const { data: todayTeamLeaves = [] } = useQuery({
    queryKey: ['team-leaves-today'], queryFn: () => apiGet('/team-leaves', { startDate: today, endDate: today }), staleTime: 60000,
  });
  const { data: newJoiners = [] } = useQuery({
    queryKey: ['new-joiners'], queryFn: () => apiGet('/new-joiners'), staleTime: 5 * 60 * 1000,
  });
  const { data: announcements = [] } = useAnnouncements({ staleTime: 5 * 60 * 1000 });
  const { data: regularizations = [] } = useRegularizations({}, { staleTime: 2 * 60 * 1000 });
  const thirtyDaysAgo = new Date(nowDate);
  thirtyDaysAgo.setDate(nowDate.getDate() - 30);
  const nextWeek = new Date(nowDate);
  nextWeek.setDate(nowDate.getDate() + 7);
  const { data: recentAttendance = [] } = useQuery({
    queryKey: ['my-att-recent', toISODate(thirtyDaysAgo), toISODate(nextWeek)],
    queryFn: () => apiGet('/attendance', { startDate: toISODate(thirtyDaysAgo), endDate: toISODate(nextWeek) }),
    staleTime: STALE.frequent,
  });
  const { data: leavePolicies = [] } = useLeavePolicies({ staleTime: 5 * 60 * 1000 });
  const { data: leaveBalance } = useQuery({
    queryKey: ['my-leave-balance', new Date().getFullYear()],
    queryFn:  () => apiGet('/leaves/balance'),
    staleTime: 5 * 60 * 1000,
  });

  // Fetch this employee's shift assignment for the current month to show actual shift on the hero chip
  const currentMonthStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}`;
  const { data: myShiftAssignments = [] } = useQuery({
    queryKey: ['my-shift-assignments', currentMonthStr],
    queryFn:  () => apiGet('/shifts/assignments', { month: currentMonthStr }),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Find assignment for today specifically
  const todayShiftRow    = myShiftAssignments.find(a => a.date === today);
  const todayShift       = todayShiftRow?.shift || null;

  // Dept Head: reuse sidebar cache so no extra request is fired
  const { data: deptHeadInfo } = useQuery({
    queryKey: ['is-dept-head'],
    queryFn:  () => apiGet('/leaves/is-dept-head').catch(() => ({ is_dept_head: false })),
    staleTime: 5 * 60 * 1000,
  });
  const isDeptHead = deptHeadInfo?.is_dept_head === true;

  const { data: teamDashboard } = useQuery({
    queryKey: ['team-dashboard'],
    queryFn:  () => apiGet('/leaves/team-dashboard'),
    enabled:  isDeptHead,
    staleTime: 60000,
  });

  /* ── derived data ── */
  const allHolidays     = culture?.holidays || [];
  const totalPages      = Math.max(1, Math.ceil(allHolidays.length / PER_PAGE));
  const visibleHolidays = allHolidays.slice(holidayPage * PER_PAGE, (holidayPage + 1) * PER_PAGE);
  const birthdaysToday  = culture?.birthdaysToday || [];
  const upcomingBdays   = culture?.upcomingBirthdays || [];
  const upcomingEvents  = (culture?.events || []).slice(0, 4);

  const isWFHRecord  = (l) => l.leave_time === 'wfh' || l.leave_type === 'wfh';
  const isWFHLeave   = (l) => l.leave_time === 'wfh' || l.leave_type === 'wfh';
  const teamOnLeave  = todayTeamLeaves.filter(l => !isWFHLeave(l) && l.user_id !== user?.id);
  const teamWfh      = todayTeamLeaves.filter(l =>  isWFHLeave(l) && l.user_id !== user?.id);

  const todayDow      = new Date().getDay();
  const isWeekend     = todayDow === 0 || todayDow === 6;
  const todayHoliday  = allHolidays.find(h => h.date === today);

  const orgName   = user?.organization_name || user?.org_name || 'lumoslogic';
  const roleLabel = user?.position || 'Team Member';

  const isOnBreak    = !!(attRecord?.break_start && !attRecord?.break_end && !attRecord?.check_out);
  const hasBreakDone = !!(attRecord?.break_end && !attRecord?.check_out);

  const last7Days = recentAttendance
    .filter(r => r.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);

  const pendingReg    = regularizations.filter(r => r.status === 'pending');
  const pendingLeaves = myLeaves.filter(l => ['pending', 'pending_dept', 'pending_root', 'pending_approval'].includes(l.status) && !isWFHRecord(l));
  const recentLeaves  = myLeaves.slice(0, 4);
  const upcomingLeaves = myLeaves
    .filter(l => l.status === 'approved' && l.start_date >= today && !isWFHRecord(l))
    .slice(0, 3);
  const activePolicies = leavePolicies.filter(p => p.active && p.annual_quota > 0);
  const latestAnnouncements = announcements.slice(0, 3);

  /* hero stat chips derived values */
  const checkedInTime = attRecord?.check_in ? fmtTime(attRecord.check_in) : null;
  const workingMins   = attRecord?.check_in && !attRecord?.check_out
    ? (() => {
        const [h, m] = attRecord.check_in.split(':').map(Number);
        const start = new Date(); start.setHours(h, m, 0, 0);
        return Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000) - (attRecord.total_break_minutes || 0));
      })()
    : attRecord?.work_hours
      ? Math.round(attRecord.work_hours * 60)
      : 0;
  const workSchedule = settingsData?.schedule;
  const shiftTotalMins = workSchedule?.start_time && workSchedule?.end_time
    ? parseWorkMins(workSchedule.end_time) - parseWorkMins(workSchedule.start_time)
    : 480;
  const remainingMins = Math.max(0, shiftTotalMins - workingMins);
  const fmtMins = (mins) => {
    const h = Math.floor(mins / 60); const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  function fmt24to12(t) {
    if (!t) return '—';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12  = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  // Prefer the employee's actual shift assignment; fall back to org-wide schedule from settings
  const shiftLabel = todayShift
    ? `${todayShift.name} · ${fmt24to12(todayShift.start_time)}–${fmt24to12(todayShift.end_time)}`
    : (workSchedule?.start_time && workSchedule?.end_time
        ? `${fmt24to12(workSchedule.start_time)} – ${fmt24to12(workSchedule.end_time)}`
        : '—');

  /* recent activity: synthesize from attendance + leaves */
  const recentActivity = [
    ...recentAttendance.slice(0, 3).map(r => ({
      id: `att-${r.id}`,
      icon: r.check_in ? '✅' : '❌',
      text: r.check_in
        ? `Checked in at ${fmtTime(r.check_in)}${r.check_out ? ` · out at ${fmtTime(r.check_out)}` : ''}`
        : 'Absent',
      date: r.date,
    })),
    ...myLeaves.slice(0, 3).map(l => ({
      id: `leave-${l.id}`,
      icon: l.status === 'approved' ? '✅' : l.status === 'rejected' ? '❌' : '⏳',
      text: `${leaveLabel(l.leave_type)} — ${l.status.charAt(0).toUpperCase() + l.status.slice(1)}`,
      date: l.created_at?.split('T')[0] || l.start_date,
    })),
  ]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 5);

  const { data: myExpenses = [] } = useExpenses({}, { staleTime: 2 * 60 * 1000 });

  /* ── pending actions count ── */
  const pendingExpenses = myExpenses.filter(e => e.status === 'pending' || e.status === 'manager_approved').length;

  /* ── quick action items ── */
  const quickActions = [
    { icon: <Umbrella size={18} />,   label: 'Apply Leave',             onClick: () => setApplyLeaveOpen(true),    color: 'bg-[#f0f3ff] text-[#3525cd]' },
    { icon: <ClipboardList size={18}/>,label: 'Attendance Correction',   to: '/portal/regularization?action=apply', color: 'bg-amber-50 text-amber-600'   },
    { icon: <CreditCard size={18} />, label: 'Expense Claim',            to: '/portal/expenses?action=apply',       color: 'bg-emerald-50 text-emerald-600'},
    { icon: <Download size={18} />,   label: 'Download Payslip',         to: '/portal/payslips',                    color: 'bg-rose-50 text-rose-600'     },
    { icon: <FolderOpen size={18} />, label: 'My Documents',             to: '/portal/documents',                   color: 'bg-purple-50 text-purple-600' },
    { icon: <CalendarDays size={18}/>, label: 'Attendance History',      to: '/portal/attendance',                  color: 'bg-cyan-50 text-cyan-600'     },
    { icon: <User size={18} />,        label: 'My Profile',              to: '/portal/profile',                     color: 'bg-pink-50 text-pink-600'     },
    { icon: <Target size={18} />,      label: 'Goals & Tasks',           to: '/portal/performance',                 color: 'bg-orange-50 text-orange-600' },
  ];

  /* ── upcoming schedule items (holidays + birthdays + announcements) ── */
  const upcomingSchedule = [
    ...allHolidays.slice(0, 3).map(h => ({ type: 'holiday',  emoji: '🏖️', label: h.name,              sub: fmtDate(h.date) })),
    ...upcomingBdays.slice(0, 2).map(b => ({ type: 'birthday', emoji: '🎂', label: `${b.name}'s Birthday`, sub: `In ${b.days_until} day${b.days_until !== 1 ? 's' : ''}` })),
    ...latestAnnouncements.slice(0, 2).map(a => ({ type: 'announcement', emoji: '📢', label: a.title, sub: fmtDate(a.created_at?.split('T')[0]) })),
  ].slice(0, 6);

  /* ────────────────────────────────────────────────────────────────────────
     RENDER
  ─────────────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">

      {/* ═══════════════════════════════════════════════════════════════════
          1. HERO HEADER CARD
      ═══════════════════════════════════════════════════════════════════ */}
      <div
        className="rounded-2xl relative overflow-hidden shadow-lg"
        style={{ background: 'linear-gradient(135deg, #1e1b8e 0%, #3525cd 55%, #4f46e5 100%)' }}
      >
        {/* decorative glows */}
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(255,255,255,.10) 0%, transparent 50%), radial-gradient(circle at 20% 80%, rgba(79,70,229,.35) 0%, transparent 50%)',
        }} />

        <div className="relative px-6 pt-5 pb-5">
          {/* greeting */}
          <h1 className="text-lg sm:text-xl font-bold text-white leading-tight">
            {getGreeting()}, {user?.name?.split(' ')[0] || 'there'}! 👋
          </h1>
          <p className="text-white/60 text-xs mt-0.5">Have a productive and amazing day ahead.</p>

          {/* stat chips */}
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              {
                icon: <LogIn size={13} />,
                label: 'Checked In',
                value: checkedInTime || 'Not Checked In',
              },
              {
                icon: <Timer size={13} />,
                label: 'Working Time',
                value: workingMins > 0 ? fmtMins(workingMins) : '—',
              },
              {
                icon: <Clock size={13} />,
                label: 'Remaining',
                value: attRecord?.check_out ? 'Done' : workingMins > 0 ? fmtMins(remainingMins) : '—',
              },
              {
                icon: <CalendarDays size={13} />,
                label: "Today's Shift",
                value: shiftLabel,
              },
            ].map(({ icon, label, value }) => (
              <div key={label} className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl px-3 py-2">
                <span className="text-white/60">{icon}</span>
                <div>
                  <p className="text-[0.58rem] font-semibold text-white/50 uppercase tracking-wide leading-none mb-0.5">{label}</p>
                  <p className="text-xs font-black text-white leading-none">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* action buttons */}
          <div className="mt-5 flex flex-wrap gap-2">
            {/* primary: check-in/out */}
            {attRecord?.check_out ? (
              <span className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-white/15 text-white/80 border border-white/20">
                <CheckCircle2 size={15} /> Day Complete
              </span>
            ) : isOnBreak ? (
              <button onClick={breakOut} disabled={breakBusy}
                className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-white text-amber-600 hover:bg-white/90 transition-all disabled:opacity-60 shadow-sm">
                <Play size={15} /> {breakBusy ? 'Ending…' : 'End Break'}
              </button>
            ) : !attRecord?.check_in ? (
              <button onClick={checkIn} disabled={checkBusy}
                className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-white text-[#3525cd] hover:bg-white/90 transition-all disabled:opacity-60 shadow-sm">
                <LogIn size={15} /> {checkBusy ? 'Checking in…' : 'Check In'}
              </button>
            ) : (
              <>
                <button onClick={breakIn} disabled={breakBusy || checkBusy}
                  className="flex items-center gap-2 text-sm font-bold px-4 py-2.5 rounded-xl bg-white/15 border border-white/30 text-white hover:bg-white/25 transition-all disabled:opacity-60">
                  <Coffee size={15} /> {breakBusy ? '…' : 'Break'}
                </button>
                <button onClick={checkOut} disabled={checkBusy}
                  className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-white text-[#3525cd] hover:bg-white/90 transition-all disabled:opacity-60 shadow-sm">
                  <LogOut size={15} /> {checkBusy ? 'Checking out…' : 'Check Out'}
                </button>
              </>
            )}

            {/* secondary buttons */}
            <button onClick={() => setApplyLeaveOpen(true)}
              className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl border border-white/40 text-white hover:bg-white/10 transition-all">
              <Umbrella size={15} /> Apply Leave
            </button>
            <Link to="/portal/regularization"
              className="flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl border border-white/40 text-white hover:bg-white/10 transition-all">
              <ClipboardList size={15} /> Attendance Correction
            </Link>
          </div>

          {/* status strip */}
          {attRecord?.check_in && (
            <div className="mt-4 pt-4 border-t border-white/10">
              {isOnBreak ? (
                <span className="text-xs text-amber-300 flex items-center gap-1.5">
                  <Coffee size={12} /> On break since {fmtTime(attRecord.break_start)}{elapsed ? ` · ${elapsed} elapsed` : ''}
                </span>
              ) : attRecord.check_out ? (
                <span className="text-xs text-white/75 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-emerald-300" />
                  {fmtTime(attRecord.check_in)} – {fmtTime(attRecord.check_out)}
                  {attRecord.work_hours ? ` · ${fmtHours(attRecord.work_hours)} effective` : ''}
                </span>
              ) : (
                <span className="text-xs text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Since {fmtTime(attRecord.check_in)}{elapsed ? ` · ${elapsed} working` : ''}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          2. THREE-COLUMN INFO SECTION
      ═══════════════════════════════════════════════════════════════════ */}
      <div className={`grid ${isDeptHead ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-5`}>

        {/* ── Col 1: Today's Overview ── */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between">
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
              <Clock size={13} className="text-[#3525cd]" /> Today's Overview
            </h2>
            {attRecord?.status && (() => {
              const cfg = ATT_STATUS_CONFIG[attRecord.status];
              return (
                <span className={`text-[0.65rem] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 ${cfg?.bg} ${cfg?.text} border ${cfg?.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg?.dot}`} />
                  {cfg?.label || attRecord.status}
                </span>
              );
            })()}
          </div>
          <div className="p-5 space-y-3">
            {attRecord?.check_in ? (
              <>
                {[
                  { label: 'Check In',      value: fmtTime(attRecord.check_in),               icon: <LogIn size={13} className="text-emerald-500" /> },
                  attRecord?.is_late && { label: 'Late By',         value: attRecord.late_by_minutes ? `${attRecord.late_by_minutes} min late` : 'Late', icon: <AlertTriangle size={13} className="text-amber-500" /> },
                  { label: 'Break Time',    value: fmtBreakTime(attRecord.total_break_minutes), icon: <Coffee size={13} className="text-amber-500" />  },
                  { label: 'Working Time',  value: workingMins > 0 ? fmtMins(workingMins) : '—', icon: <Timer size={13} className="text-[#3525cd]" /> },
                  { label: 'Remaining',     value: attRecord?.check_out ? 'Done' : fmtMins(remainingMins), icon: <Clock size={13} className="text-rose-500" /> },
                ].filter(Boolean).map(({ label, value, icon }) => (
                  <div key={label} className="flex items-center justify-between py-1 border-b border-[#f9f9ff] last:border-0">
                    <div className="flex items-center gap-2 text-[#777587]">
                      {icon}
                      <span className="text-xs font-medium text-[#464555]">{label}</span>
                    </div>
                    <span className="text-xs font-bold text-[#151c27]">{value}</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-6 gap-2">
                <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center text-xl">🕐</div>
                <p className="text-sm font-semibold text-[#464555]">Not checked in yet</p>
                <p className="text-xs text-[#9ca3af]">Your attendance details will appear here.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Col 2: My Pending Actions ── */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between">
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
              <Zap size={13} className="text-amber-500" /> My Pending Actions
            </h2>
            {(pendingLeaves.length + pendingReg.length + pendingExpenses) > 0 && (
              <span className="text-[0.6rem] font-black px-2 py-0.5 rounded-full bg-amber-500 text-white">
                {pendingLeaves.length + pendingReg.length + pendingExpenses}
              </span>
            )}
          </div>
          <div className="p-5 space-y-2.5">
            {[
              {
                label: 'Pending Leave Requests',
                count: pendingLeaves.length,
                to: '/portal/leaves?status=pending',
                icon: <Umbrella size={14} className="text-[#3525cd]" />,
                bg: 'bg-[#f0f3ff]',
              },
              {
                label: 'Pending Regularization',
                count: pendingReg.length,
                to: '/portal/regularization?status=pending',
                icon: <ClipboardList size={14} className="text-amber-500" />,
                bg: 'bg-amber-50',
              },
              {
                label: 'Pending Expenses',
                count: pendingExpenses,
                to: '/portal/expenses?status=pending',
                icon: <CreditCard size={14} className="text-emerald-500" />,
                bg: 'bg-emerald-50',
              },
            ].map(({ label, count, to, icon, bg }) => (
              <Link key={label} to={to}
                className="flex items-center justify-between p-3 rounded-xl border border-[#f0f3ff] hover:border-[#c7c4d8] transition-colors group">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`}>{icon}</div>
                  <span className="text-xs font-semibold text-[#464555]">{label}</span>
                </div>
                <div className="flex items-center gap-2">
                  {count > 0 && (
                    <span className="text-[0.6rem] font-black px-1.5 py-0.5 rounded-full bg-amber-500 text-white min-w-[18px] text-center">
                      {count}
                    </span>
                  )}
                  <ArrowRight size={12} className="text-[#c7c4d8] group-hover:text-[#3525cd] transition-colors" />
                </div>
              </Link>
            ))}

          </div>
        </div>

        {/* ── Col 3: My Team — only for dept heads ── */}
        {isDeptHead && teamDashboard?.is_dept_head && (
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3ff]">
              <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
                <Users size={13} className="text-[#3525cd]" />
                My Team — {teamDashboard.department?.name}
              </h2>
              <Link to="/portal/dept-approvals" className="text-[0.68rem] font-bold text-[#3525cd] hover:underline flex items-center gap-1">
                {teamDashboard.pending_approvals > 0 && (
                  <span className="bg-amber-500 text-white text-[0.58rem] font-black px-1.5 py-0.5 rounded-full">
                    {teamDashboard.pending_approvals}
                  </span>
                )}
                Team Approvals →
              </Link>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { label: 'Team Size',      value: teamDashboard.team_count,     icon: '👥', color: 'text-[#3525cd]' },
                  { label: 'Present Today',  value: teamDashboard.present_today,  icon: '✅', color: 'text-emerald-700' },
                  { label: 'On Leave',       value: teamDashboard.on_leave_today, icon: '🏖️', color: 'text-amber-700' },
                  { label: 'Not Checked In', value: teamDashboard.not_checked_in, icon: '⏰', color: 'text-slate-500' },
                ].map(({ label, value, icon, color }) => (
                  <div key={label} className="rounded-xl border border-[#e7eefe] p-3 text-center">
                    <p className="text-base mb-0.5">{icon}</p>
                    <p className={`text-xl font-black leading-none ${color}`}>{value ?? 0}</p>
                    <p className="text-[0.58rem] text-[#777587] font-semibold mt-1 uppercase tracking-wide">{label}</p>
                  </div>
                ))}
              </div>
              {teamDashboard.upcoming_leaves?.length > 0 ? (
                <div>
                  <p className="text-[0.6rem] font-black uppercase tracking-wider text-[#777587] mb-2">Upcoming Leaves (Next 7 Days)</p>
                  <div className="space-y-1.5">
                    {teamDashboard.upcoming_leaves.slice(0, 3).map((l, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg bg-[#f9f9ff]">
                        <span className="font-bold text-[#151c27] flex-1 truncate">{l.name}</span>
                        <span className="text-[0.6rem] font-bold text-[#3525cd] bg-[#f0f3ff] px-1.5 py-0.5 rounded-full capitalize">
                          {l.leave_time === 'wfh' ? 'WFH' : l.leave_type}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[#9ca3af] text-center py-2">No upcoming leaves in the next 7 days.</p>
              )}
            </div>
          </div>
        )}
      </div>


      {/* ═══════════════════════════════════════════════════════════════════
          3. ATTENDANCE CHART + UPCOMING SCHEDULE
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid lg:grid-cols-2 gap-5">

        {/* ── Left: Attendance This Week ── */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3ff]">
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
              <TrendingUp size={13} className="text-[#3525cd]" /> Attendance This Week
            </h2>
            <Link to="/portal/attendance" className="text-[0.68rem] font-bold text-[#3525cd] hover:underline">
              Full History
            </Link>
          </div>
          <div className="p-5">
            <WeekBarChart recentAttendance={recentAttendance} today={today} />
          </div>
        </div>

        {/* ── Right: Upcoming Schedule ── */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3ff]">
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
              <CalendarDays size={13} className="text-rose-500" /> Upcoming Schedule
            </h2>
            <Link to="/portal/team-calendar" className="text-[0.68rem] font-bold text-[#3525cd] hover:underline">
              View Calendar →
            </Link>
          </div>
          <div className="divide-y divide-[#f9f9ff]">
            {upcomingSchedule.length === 0 ? (
              <div className="py-10 flex flex-col items-center gap-2 text-center px-5">
                <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-xl">📅</div>
                <p className="text-sm font-semibold text-[#464555]">Nothing upcoming</p>
                <p className="text-xs text-[#9ca3af]">Holidays, birthdays & events will appear here.</p>
              </div>
            ) : (
              upcomingSchedule.map((item, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3 hover:bg-[#fafaff] transition-colors">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 ${
                    item.type === 'holiday' ? 'bg-rose-50 border border-rose-100'
                    : item.type === 'birthday' ? 'bg-pink-50 border border-pink-100'
                    : 'bg-amber-50 border border-amber-100'
                  }`}>
                    {item.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#151c27] truncate leading-tight">{item.label}</p>
                    <p className="text-[0.65rem] text-[#9ca3af] mt-0.5">{item.sub}</p>
                  </div>
                  <span className={`text-[0.58rem] font-bold px-1.5 py-0.5 rounded capitalize shrink-0 ${
                    item.type === 'holiday' ? 'bg-rose-50 text-rose-600'
                    : item.type === 'birthday' ? 'bg-pink-50 text-pink-600'
                    : 'bg-amber-50 text-amber-600'
                  }`}>
                    {item.type}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          4. RECENT ACTIVITY + TEAM STATUS
      ═══════════════════════════════════════════════════════════════════ */}
      <div className={`grid ${isDeptHead ? 'lg:grid-cols-2' : 'grid-cols-1'} gap-5`}>

        {/* ── Left: My Recent Activity ── */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3ff]">
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
              <Bell size={13} className="text-amber-500" /> My Recent Activity
            </h2>
            <Link to="/portal/attendance" className="text-[0.68rem] font-bold text-[#3525cd] hover:underline">
              View All
            </Link>
          </div>
          <div className="divide-y divide-[#f9f9ff]">
            {recentActivity.length === 0 ? (
              <div className="py-10 text-center px-5">
                <p className="text-sm text-[#9ca3af]">No recent activity found.</p>
              </div>
            ) : (
              recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-[#fafaff] transition-colors">
                  <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center text-sm shrink-0 mt-0.5">
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#151c27] leading-snug">{item.text}</p>
                    <p className="text-[0.62rem] text-[#9ca3af] mt-0.5">{item.date ? fmtDateShort(item.date) : ''}</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Right: My Team Status — only for dept heads ── */}
        {isDeptHead && (
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3ff]">
              <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
                <Users size={13} className="text-[#3525cd]" /> My Team Status
              </h2>
            </div>
            <div className="p-5">
              {(todayHoliday || isWeekend) ? (
                <div className="flex flex-col items-center justify-center text-center py-6 gap-2">
                  <span className="text-3xl">{todayHoliday ? '🏖️' : '🌟'}</span>
                  <p className="text-sm font-black text-[#151c27]">{todayHoliday ? todayHoliday.name : 'Weekend'}</p>
                  <p className="text-[0.7rem] text-[#777587]">Attendance not applicable today</p>
                </div>
              ) : (
                <>
                  <TeamDonut todayTeamLeaves={todayTeamLeaves} user={user} teamCount={teamDashboard?.team_count} />

                  {/* member lists */}
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[0.6rem] font-black text-amber-600 uppercase tracking-wider mb-2">
                        On Leave ({teamOnLeave.length})
                      </p>
                      {teamOnLeave.length === 0 ? (
                        <p className="text-[0.7rem] text-[#9ca3af] italic">Everyone's in</p>
                      ) : (
                        <div className="space-y-1.5">
                          {teamOnLeave.slice(0, 3).map(l => (
                            <div key={l.id} className="flex items-center gap-1.5">
                              <Avatar name={l.name} color={l.avatar_color} size={22} />
                              <span className="text-[0.68rem] font-medium text-[#151c27] truncate">{l.name}</span>
                            </div>
                          ))}
                          {teamOnLeave.length > 3 && <p className="text-[0.62rem] text-[#777587]">+{teamOnLeave.length - 3} more</p>}
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-[0.6rem] font-black text-cyan-600 uppercase tracking-wider mb-2">
                        WFH ({teamWfh.length})
                      </p>
                      {teamWfh.length === 0 ? (
                        <p className="text-[0.7rem] text-[#9ca3af] italic">No WFH today</p>
                      ) : (
                        <div className="space-y-1.5">
                          {teamWfh.slice(0, 3).map(l => (
                            <div key={l.id} className="flex items-center gap-1.5">
                              <Avatar name={l.name} color={l.avatar_color} size={22} />
                              <span className="text-[0.68rem] font-medium text-[#151c27] truncate">{l.name}</span>
                            </div>
                          ))}
                          {teamWfh.length > 3 && <p className="text-[0.62rem] text-[#777587]">+{teamWfh.length - 3} more</p>}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          5. QUICK ACTIONS GRID
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f0f3ff]">
          <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
            <Zap size={13} className="text-[#3525cd]" /> Quick Actions
          </h2>
        </div>
        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quickActions.map(({ icon, label, to, onClick, color }) => {
            const cls = "flex flex-col items-center gap-2.5 p-4 rounded-xl border border-[#f0f3ff] hover:border-[#c7c4d8] hover:shadow-sm transition-all group text-center w-full";
            const inner = (
              <>
                <div className={`w-10 h-10 rounded-xl ${color} flex items-center justify-center group-hover:scale-110 transition-transform`}>{icon}</div>
                <span className="text-[0.72rem] font-semibold text-[#464555] leading-tight">{label}</span>
              </>
            );
            return onClick
              ? <button key={label} onClick={onClick} className={cls}>{inner}</button>
              : <Link key={label} to={to} className={cls}>{inner}</Link>;
          })}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          BONUS: My Recent Leaves (keep existing)
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#f0f3ff]">
          <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
            <Umbrella size={13} className="text-[#3525cd]" /> My Recent Leaves
          </h2>
          <Link to="/portal/leaves" className="text-[0.68rem] font-bold text-[#3525cd] hover:underline">View All</Link>
        </div>

        {recentLeaves.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center gap-2">
            <div className="w-12 h-12 rounded-2xl bg-[#f0f3ff] flex items-center justify-center text-2xl">🗓️</div>
            <p className="text-sm font-semibold text-[#464555]">No leave requests yet</p>
            <p className="text-xs text-[#9ca3af]">You haven't applied for any leave yet.</p>
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[2fr_2fr_auto] px-5 py-2.5 bg-[#fafaff] border-b border-[#f0f3ff]">
              <span className="text-[0.62rem] font-black uppercase tracking-wider text-[#9ca3af]">Leave Type</span>
              <span className="text-[0.62rem] font-black uppercase tracking-wider text-[#9ca3af]">Dates</span>
              <span className="text-[0.62rem] font-black uppercase tracking-wider text-[#9ca3af] text-right">Status</span>
            </div>
            {recentLeaves.map(l => {
              const lt    = LEAVE_ICONS[l.leave_type] || LEAVE_ICONS.other;
              const badge = STATUS_BADGE[l.status] || STATUS_BADGE.pending;
              const isWfh = isWFHLeave(l);
              return (
                <div key={l.id} className="grid grid-cols-[2fr_2fr_auto] px-5 py-3.5 items-center border-b border-[#f9f9ff] last:border-0 hover:bg-[#fafaff] transition-colors gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg ${lt.bg} border ${lt.border} flex items-center justify-center text-sm shrink-0`}>{lt.emoji}</div>
                    <span className="text-sm font-semibold text-[#151c27] truncate">{isWfh ? 'WFH' : leaveLabel(l.leave_type)}</span>
                  </div>
                  <span className="text-xs text-[#464555] leading-tight">{fmtLeaveDate(l.start_date, l.end_date)}</span>
                  <span className={`text-[0.7rem] font-bold px-3 py-1 rounded-full whitespace-nowrap ${badge}`}>
                    {STATUS_DISPLAY_LABEL[l.status] || (l.status ? l.status.charAt(0).toUpperCase() + l.status.slice(1) : 'Unknown')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          BONUS: New Joiners
      ═══════════════════════════════════════════════════════════════════ */}
      {newJoiners.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center gap-2">
            <UserPlus size={13} className="text-emerald-500" />
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest">New Team Members</h2>
            <span className="text-[0.6rem] font-semibold text-[#9ca3af] ml-1">· Last 7 days</span>
          </div>
          <div className="divide-y divide-[#f9f9ff]">
            {newJoiners.map(e => {
              const daysAgo = Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86400000);
              return (
                <div key={e.id} className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-[#fafaff] transition-colors">
                  <Avatar name={e.name} color={e.avatar_color} size={36} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#151c27] leading-tight">{e.name}</p>
                    <p className="text-xs text-[#777587] mt-0.5">{e.position || 'Staff'} · {e.department || '—'}</p>
                  </div>
                  <span className="text-[0.65rem] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                    {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          BONUS: Birthdays + Upcoming Events
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff]">
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
              <Cake size={13} className="text-pink-500" /> Birthdays
            </h2>
          </div>
          <div className="p-5">
            {birthdaysToday.length === 0 && upcomingBdays.length === 0 ? (
              <div className="min-h-[120px] flex flex-col items-center justify-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-[#f0f3ff] flex items-center justify-center text-2xl">🎁</div>
                <div>
                  <p className="text-sm font-semibold text-[#464555]">No upcoming birthdays</p>
                  <p className="text-xs text-[#9ca3af] mt-0.5">We'll show birthdays here when available.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {birthdaysToday.length > 0 && (
                  <div>
                    <p className="text-[0.62rem] font-black text-pink-600 uppercase tracking-wider mb-2.5">Today 🎂</p>
                    <div className="space-y-2">
                      {birthdaysToday.map(u => (
                        <div key={u.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-pink-50 border border-pink-100">
                          <Avatar name={u.name} color={u.avatar_color} size={32} />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#151c27] truncate leading-tight">{u.name}</p>
                            <p className="text-xs text-[#777587] mt-0.5">{u.department}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {upcomingBdays.length > 0 && (
                  <div>
                    {birthdaysToday.length > 0 && <p className="text-[0.62rem] font-black text-[#777587] uppercase tracking-wider mb-2.5 mt-4">Coming Up</p>}
                    <div className="space-y-2.5">
                      {upcomingBdays.slice(0, 4).map(u => (
                        <div key={u.id + u.birthday_date} className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-pink-50 border border-pink-100 flex items-center justify-center text-lg shrink-0">🎂</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-[#151c27] truncate leading-tight">{u.name}</p>
                            <p className="text-xs text-[#777587] mt-0.5">in {u.days_until} day{u.days_until !== 1 ? 's' : ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff]">
            <h2 className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest flex items-center gap-2">
              <PartyPopper size={13} className="text-amber-500" /> Upcoming Events
            </h2>
          </div>
          <div className="p-5">
            {upcomingEvents.length === 0 ? (
              <div className="min-h-[120px] flex flex-col items-center justify-center gap-3 text-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 flex items-center justify-center text-2xl">📅</div>
                <div>
                  <p className="text-sm font-semibold text-[#464555]">No upcoming events</p>
                  <p className="text-xs text-[#9ca3af] mt-0.5">Stay tuned for exciting events!</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingEvents.map(ev => (
                  <div key={ev.id} className="flex items-center gap-3.5">
                    <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-lg shrink-0">🎉</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#151c27] truncate leading-tight">{ev.title}</p>
                      <p className="text-xs text-[#777587] mt-0.5">
                        {fmtDate(ev.date)}{ev.end_date && ev.end_date !== ev.date ? ` → ${fmtDate(ev.end_date)}` : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {applyLeaveOpen && (
        <ApplyLeaveModal
          isAdmin={false}
          employees={[]}
          allLeaves={[]}
          policies={[]}
          onClose={() => setApplyLeaveOpen(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ['leaves'] })}
        />
      )}
    </div>
  );
}
