import React, { useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement,
  ArcElement, BarElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, ClipboardList, ShieldCheck, CalendarDays,
  Check, X, Clock, TrendingUp, AlertCircle, Building2,
  Activity, Zap, Star, UserPlus, Calendar, CheckCircle2, RefreshCw,
  Award, DollarSign, Receipt, BarChart3, Radio, Settings,
  ChevronUp, ChevronDown, Filter,
} from 'lucide-react';
import { apiGet, apiPut, apiDelete } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import { useToast } from '@/context/ToastContext';
import { AttendanceDayModal } from '@/components/AttendanceDayModal';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  ArcElement, BarElement, Tooltip, Legend, Filler,
);

// ── Shared chart tooltip style ─────────────────────────────────────────────────
const tooltipDefaults = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  titleColor: '#151c27',
  bodyColor: '#464555',
  borderColor: '#e7eefe',
  borderWidth: 1,
  padding: 10,
  cornerRadius: 8,
  titleFont: { weight: 'bold', size: 12 },
  bodyFont: { size: 12 },
  displayColors: true,
  boxWidth: 10,
  boxHeight: 10,
  boxPadding: 4,
};

const hoverCursor = (event, elements) => {
  const t = event.native?.target;
  if (t) t.style.cursor = elements.length > 0 ? 'pointer' : 'default';
};

// ── Constants ──────────────────────────────────────────────────────────────────
const LEAVE_KEYS = {
  casual:    { label: 'Casual',    color: '#10b981' },
  sick:      { label: 'Sick',      color: '#ef4444' },
  wfh:       { label: 'WFH',       color: '#6366f1' },
  emergency: { label: 'Emergency', color: '#f59e0b' },
  annual:    { label: 'Annual',    color: '#3525cd' },
  other:     { label: 'Other',     color: '#8b5cf6' },
};

const WORKFORCE_STATUS = {
  present:  { label: 'Present',  color: '#10b981', urlStatus: 'present' },
  wfh:      { label: 'WFH',      color: '#3525cd', urlStatus: 'wfh' },
  on_leave: { label: 'On Leave', color: '#f59e0b', urlStatus: 'on_leave' },
  half_day: { label: 'Half Day', color: '#4f46e5', urlStatus: 'half_day' },
  absent:   { label: 'Absent',   color: '#ef4444', urlStatus: 'absent' },
};

const PRIORITY_BADGE = {
  High:   'bg-rose-50 text-rose-600 border-rose-200',
  Medium: 'bg-amber-50 text-amber-600 border-amber-200',
  Low:    'bg-emerald-50 text-emerald-600 border-emerald-200',
};

const QUICK_ACTIONS = [
  { label: 'Add Employee',   to: '/root/employees?action=add',   icon: <UserPlus size={11} />,     color: 'bg-[#f0f3ff] text-[#3525cd]' },
  { label: 'Manage HR Admins', to: '/root/manage-hr',              icon: <ShieldCheck size={11} />,  color: 'bg-purple-50 text-purple-600' },
  { label: 'Add Department', to: '/root/departments?action=add', icon: <Building2 size={11} />,    color: 'bg-sky-50 text-sky-600' },
  { label: 'Add Holiday',    to: '/root/holidays?action=add',    icon: <CalendarDays size={11} />, color: 'bg-amber-50 text-amber-600' },
  { label: 'Manage Shifts',  to: '/root/shifts',                 icon: <Clock size={11} />,        color: 'bg-indigo-50 text-indigo-600' },
  { label: 'Broadcast',      to: '/root/broadcast',              icon: <Radio size={11} />,        color: 'bg-rose-50 text-rose-500' },
  { label: 'Payroll',        to: '/root/payroll',                icon: <DollarSign size={11} />,   color: 'bg-emerald-50 text-emerald-600' },
  { label: 'Expenses',       to: '/root/expenses',               icon: <Receipt size={11} />,      color: 'bg-orange-50 text-orange-500' },
  { label: 'Reports',        to: '/root/reports',                icon: <BarChart3 size={11} />,    color: 'bg-[#f0f3ff] text-[#3525cd]' },
  { label: 'Settings',       to: '/root/settings',               icon: <Settings size={11} />,     color: 'bg-slate-50 text-slate-500' },
];

// ── Utilities ──────────────────────────────────────────────────────────────────
function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtDate(ds) {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function daysUntil(ds) {
  const d = Math.ceil((new Date(ds + 'T12:00:00') - new Date()) / 86400000);
  if (d <= 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return `In ${d} days`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
}

function fmtUpdatedAt(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ── Doughnut wrapper (Chart.js + center label) ─────────────────────────────────
function DoughnutChart({ data, options, centerLabel, centerSub }) {
  const total = data.datasets[0]?.data?.reduce((a, b) => a + b, 0) ?? 0;
  return (
    <div className="relative" style={{ height: 180 }}>
      <Doughnut data={data} options={{ ...options, maintainAspectRatio: false }} />
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-2xl font-black text-[#151c27] leading-none">{centerLabel ?? total}</span>
        <span className="text-[0.62rem] text-[#777587] font-semibold mt-0.5 uppercase tracking-wide">{centerSub ?? 'Total'}</span>
      </div>
    </div>
  );
}

// ── KPI card tooltip ───────────────────────────────────────────────────────────
function KpiTooltip({ text, children }) {
  return (
    <div className="relative group/tip">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 hidden group-hover/tip:block pointer-events-none">
        <div className="bg-[#151c27] text-white text-[0.65rem] font-medium px-2.5 py-1.5 rounded-lg shadow-xl max-w-[180px] whitespace-normal text-center leading-snug">
          {text}
        </div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-[#151c27]" />
      </div>
    </div>
  );
}

// ── KPI loading skeleton ───────────────────────────────────────────────────────
function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 animate-pulse">
          <div className="w-8 h-8 rounded-lg bg-[#e7eefe] mb-3" />
          <div className="h-5 bg-[#e7eefe] rounded w-3/4 mb-2" />
          <div className="h-3 bg-[#f0f3ff] rounded w-1/2 mb-1" />
          <div className="h-2.5 bg-[#f0f3ff] rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

// ── Sort icon helper ───────────────────────────────────────────────────────────
function SortIcon({ col, sort }) {
  if (sort.col !== col) return <ChevronUp size={11} className="text-[#c7c4d8]" />;
  return sort.dir === 'asc'
    ? <ChevronUp size={11} className="text-[#3525cd]" />
    : <ChevronDown size={11} className="text-[#3525cd]" />;
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function RootDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedBranchId } = useBranch();
  const toast    = useToast();
  const qc       = useQueryClient();

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [trendDays,       setTrendDays]       = useState(30);
  const [yearlySort,      setYearlySort]      = useState({ col: 'usedDays', dir: 'desc' });
  const [yearlyDeptFilt,  setYearlyDeptFilt]  = useState('');
  const [attModal,        setAttModal]        = useState(null);
  const [pendingTab,      setPendingTab]      = useState('all');

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey:        ['root-dashboard', selectedBranchId],
    queryFn:         () => apiGet('/root/dashboard'),
    refetchInterval: 60000,
  });

  const { data: yearlyData } = useQuery({
    queryKey:        ['root-yearly-leaves', new Date().getFullYear(), selectedBranchId],
    queryFn:         () => apiGet('/root/yearly-leaves'),
    refetchInterval: 300000,
  });

  const { data: pendingRegs = [] } = useQuery({
    queryKey:        ['root-pending-regs', selectedBranchId],
    queryFn:         () => apiGet('/regularization').catch(() => []),
    select:          d => (Array.isArray(d) ? d : []).filter(r => r.status === 'pending'),
    refetchInterval: 60000,
  });

  const approveMut = useMutation({
    mutationFn: id => apiPut(`/leaves/${id}/approve`),
    onSuccess:  () => { toast('Leave approved!', 'success'); qc.invalidateQueries({ queryKey: ['root-dashboard', selectedBranchId] }); },
    onError:    err => toast(err.message, 'error'),
  });
  const rejectMut = useMutation({
    mutationFn: id => apiPut(`/leaves/${id}/reject`),
    onSuccess:  () => { toast('Leave rejected', 'warning'); qc.invalidateQueries({ queryKey: ['root-dashboard', selectedBranchId] }); },
    onError:    err => toast(err.message, 'error'),
  });
  const approveRegMut = useMutation({
    mutationFn: id => apiPut(`/regularization/${id}/review`, { status: 'approved' }),
    onSuccess:  () => { toast('Regularization approved!', 'success'); qc.invalidateQueries({ queryKey: ['root-pending-regs', selectedBranchId] }); },
    onError:    err => toast(err.message, 'error'),
  });
  const rejectRegMut = useMutation({
    mutationFn: id => apiPut(`/regularization/${id}/review`, { status: 'rejected' }),
    onSuccess:  () => { toast('Regularization rejected', 'warning'); qc.invalidateQueries({ queryKey: ['root-pending-regs', selectedBranchId] }); },
    onError:    err => toast(err.message, 'error'),
  });

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl h-36 bg-gradient-to-r from-[#1e1b5e] to-[#3525cd] animate-pulse" />
        <div className="h-4 bg-[#e7eefe] rounded w-32 animate-pulse" />
        <KpiSkeleton />
      </div>
    );
  }

  const {
    totalEmployees = 0, totalHR = 0, pendingLeaves = 0, presentToday = 0,
    // BUG_116: pendingRegCount and pendingExpCount come from dashboard API
    pendingRegCount = 0,
    pendingExpCount = 0,
    totalDepartments = 0,
    pendingLeavesData = [], attendanceBreakdown = {}, leavesByType = {},
    attendanceTrend = [], departmentHealth = [], headcountGrowth = [],
    liveActivity = [], actionCenter = [], upcomingEvents = [],
    recentJoiners = [], birthdays = [], anniversaries = [],
  } = data || {};

  const isBusy       = approveMut.isPending || rejectMut.isPending;
  const onLeaveToday = attendanceBreakdown.on_leave || 0;
  // BUG_117: totalEmployees from backend already excludes resigned/terminated
  const presentPct   = totalEmployees > 0 ? Math.min(100, Math.round((presentToday / totalEmployees) * 100)) : 0;
  // BUG_116: total pending = leaves/WFH + regularizations + expenses
  const totalPendingApprovals = pendingLeaves + pendingRegCount + pendingExpCount;

  // ── Yearly leave: sort + filter ───────────────────────────────────────────────
  const allYearly   = yearlyData?.employees || [];
  const yearlyDepts = [...new Set(allYearly.map(e => e.department).filter(Boolean))].sort();

  const displayedYearly = [...allYearly]
    .filter(e => !yearlyDeptFilt || e.department === yearlyDeptFilt)
    .sort((a, b) => {
      const m = yearlySort.dir === 'asc' ? 1 : -1;
      if (yearlySort.col === 'name')         return m * a.name.localeCompare(b.name);
      if (yearlySort.col === 'department')   return m * (a.department || '').localeCompare(b.department || '');
      if (yearlySort.col === 'usedDays')     return m * (a.usedDays - b.usedDays);
      if (yearlySort.col === 'remainingDays') return m * (a.remainingDays - b.remainingDays);
      return 0;
    });

  function toggleSort(col) {
    setYearlySort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  }

  // ── Attendance Trend — slice by selected days ─────────────────────────────────
  const trendSlice  = attendanceTrend.slice(-trendDays);
  const trendLabels = trendSlice.map((t, i) =>
    (i === 0 || i % Math.ceil(trendDays / 5) === 0 || i === trendSlice.length - 1) ? t.date.slice(5) : ''
  );
  // BUG_117: avg attendance % for the selected period (exclude days with no data)
  const trendDaysWithData = trendSlice.filter(t => t.total > 0);
  const trendAvgPct = trendDaysWithData.length > 0
    ? Math.round(trendDaysWithData.reduce((s, t) => s + t.pct, 0) / trendDaysWithData.length)
    : (trendSlice[trendSlice.length - 1]?.pct ?? 0);

  // ── Today's Workforce chart data ─────────────────────────────────────────────
  // EHN_DASH_001: Compute absent count if backend doesn't include it
  const accountedFor = (attendanceBreakdown.present || 0) + (attendanceBreakdown.wfh || 0) +
    (attendanceBreakdown.on_leave || 0) + (attendanceBreakdown.half_day || 0) +
    (attendanceBreakdown.holiday || 0) + (attendanceBreakdown.early_leave || 0);
  const computedAbsent = Math.max(0, totalEmployees - accountedFor);
  const enrichedBreakdown = {
    ...attendanceBreakdown,
    absent: (attendanceBreakdown.absent || 0) > 0 ? (attendanceBreakdown.absent || 0) : computedAbsent,
  };
  const workforceEntries = Object.entries(WORKFORCE_STATUS)
    .map(([key, cfg]) => ({ ...cfg, key, value: enrichedBreakdown[key] || 0 }))
    .filter(e => e.value > 0);
  const totalWorkforce = workforceEntries.reduce((s, e) => s + e.value, 0);

  const workforceChartData = {
    labels: workforceEntries.map(e => e.label),
    datasets: [{
      data: workforceEntries.map(e => e.value),
      backgroundColor: workforceEntries.map(e => e.color),
      borderWidth: 3, borderColor: '#fff',
      hoverBorderWidth: 3, hoverBorderColor: '#fff', hoverOffset: 6,
    }],
  };

  const workforceOptions = {
    cutout: '70%',
    plugins: {
      legend: { display: false },
      tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} employees` } },
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const s = workforceEntries[elements[0].index];
        if (s) navigateWorkforceStatus(s.urlStatus);
      }
    },
    onHover: hoverCursor,
  };

  // ── Leave Breakdown chart data ────────────────────────────────────────────────
  const leaveSegs = Object.entries(LEAVE_KEYS)
    .map(([key, cfg]) => ({ ...cfg, key, value: leavesByType[key] || 0 }))
    .filter(e => e.value > 0);
  const totalLeaveSegs = leaveSegs.reduce((s, e) => s + e.value, 0);

  // BUG_119: largest-remainder method so percentages always sum to exactly 100
  const leaveSegPcts = (() => {
    if (totalLeaveSegs === 0) return leaveSegs.map(() => 0);
    const floats   = leaveSegs.map(e => (e.value / totalLeaveSegs) * 100);
    const floors   = floats.map(f => Math.floor(f));
    const remainder = 100 - floors.reduce((s, f) => s + f, 0);
    const ranked   = floats
      .map((f, i) => ({ i, rem: f - floors[i] }))
      .sort((a, b) => b.rem - a.rem);
    const result   = [...floors];
    for (let j = 0; j < remainder; j++) result[ranked[j].i]++;
    return result;
  })();

  const leaveChartData = {
    labels: leaveSegs.map(e => e.label),
    datasets: [{
      data: leaveSegs.map(e => e.value),
      backgroundColor: leaveSegs.map(e => e.color),
      borderWidth: 3, borderColor: '#fff',
      hoverBorderWidth: 3, hoverBorderColor: '#fff', hoverOffset: 6,
    }],
  };

  const leaveOptions = {
    cutout: '70%',
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipDefaults,
        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${Math.round((ctx.parsed / totalLeaveSegs) * 100)}%)` },
      },
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const seg = leaveSegs[elements[0].index];
        if (seg) navigate(`/root/leaves?type=${seg.key}&status=approved`);
      }
    },
    onHover: hoverCursor,
  };

  // ── Attendance Trend chart data ───────────────────────────────────────────────
  const trendChartData = {
    labels: trendSlice.map(t => t.date),
    datasets: [{
      label: 'Attendance %',
      data: trendSlice.map(t => t.pct),
      fill: true,
      backgroundColor: 'rgba(53, 37, 205, 0.07)',
      borderColor: '#3525cd',
      borderWidth: 2.5,
      pointRadius: 0, pointHoverRadius: 6,
      pointHoverBackgroundColor: '#3525cd',
      pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2,
      tension: 0.4,
    }],
  };

  const trendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipDefaults,
        callbacks: {
          title: ([ctx]) => {
            const entry = trendSlice[ctx.dataIndex];
            return entry ? fmtDate(entry.date) : ctx.label;
          },
          label: ctx => ` ${ctx.parsed.y}% attendance (${trendSlice[ctx.dataIndex]?.present ?? 0} present)`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false }, border: { display: false },
        ticks: { maxRotation: 0, font: { size: 10 }, color: '#9ca3af', callback: (_, i) => trendLabels[i] || null },
      },
      y: {
        min: 0, max: 100,
        grid: { color: '#f0f0f8', lineWidth: 1 }, border: { display: false },
        ticks: { callback: v => `${v}%`, font: { size: 10 }, color: '#9ca3af', maxTicksLimit: 5 },
      },
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const entry = trendSlice[elements[0].index];
        if (entry?.date) navigate(`/root/calendar?date=${entry.date}`);
      }
    },
    onHover: hoverCursor,
  };

  // ── Headcount Growth chart data ───────────────────────────────────────────────
  const curMonth = new Date().getMonth();
  const headSlice = headcountGrowth.slice(0, curMonth + 1);

  const headChartData = {
    labels: headSlice.map(h => h.month),
    datasets: [
      {
        label: 'Total Employees',
        data: headSlice.map(h => h.total),
        fill: true, backgroundColor: 'rgba(16, 185, 129, 0.07)',
        borderColor: '#10b981', borderWidth: 2.5,
        pointRadius: 4, pointBackgroundColor: '#10b981',
        pointBorderColor: '#fff', pointBorderWidth: 2, pointHoverRadius: 7, tension: 0.4,
      },
      {
        label: 'New Joiners',
        data: headSlice.map(h => h.joined),
        fill: false, borderColor: '#3525cd', borderWidth: 1.5, borderDash: [4, 4],
        pointRadius: 3, pointBackgroundColor: '#3525cd',
        pointBorderColor: '#fff', pointBorderWidth: 1.5, pointHoverRadius: 6, tension: 0.4,
      },
    ],
  };

  const headOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true, position: 'top', align: 'end',
        labels: { font: { size: 11 }, color: '#777587', boxWidth: 10, boxHeight: 10, padding: 12 },
      },
      tooltip: { ...tooltipDefaults, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}` } },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
      y: { grid: { color: '#f0f0f8' }, border: { display: false }, ticks: { font: { size: 10 }, color: '#9ca3af', maxTicksLimit: 5 } },
    },
    onClick: (event, elements) => {
      const year = new Date().getFullYear();
      if (elements.length > 0 && elements[0].datasetIndex === 1) {
        // New Joiners dataset — filter employees by that specific month
        const monthIdx = elements[0].index; // 0-based index in headSlice
        const month = String(monthIdx + 1).padStart(2, '0');
        navigate(`/root/employees?role=employee&joined_ym=${year}-${month}`);
      } else {
        navigate('/root/employees?role=employee');
      }
    },
    onHover: hoverCursor,
  };

  // ── Department Health bar chart ───────────────────────────────────────────────
  const deptColors = departmentHealth.map(d =>
    d.attendancePct >= 90 ? 'rgba(16,185,129,0.85)' : d.attendancePct >= 70 ? 'rgba(245,158,11,0.85)' : 'rgba(239,68,68,0.85)'
  );
  const deptHoverColors = departmentHealth.map(d =>
    d.attendancePct >= 90 ? '#10b981' : d.attendancePct >= 70 ? '#f59e0b' : '#ef4444'
  );

  const deptChartData = {
    labels: departmentHealth.map(d => d.name),
    datasets: [{
      label: 'Attendance %',
      data: departmentHealth.map(d => d.attendancePct),
      backgroundColor: deptColors, hoverBackgroundColor: deptHoverColors,
      borderRadius: 5, borderSkipped: false,
    }],
  };

  const deptOptions = {
    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipDefaults,
        callbacks: {
          label: ctx => ` ${ctx.parsed.x}% · ${departmentHealth[ctx.dataIndex]?.present ?? 0} present · ${departmentHealth[ctx.dataIndex]?.onLeave ?? 0} on leave`,
          title: ([ctx]) => departmentHealth[ctx.dataIndex]?.name,
        },
      },
    },
    scales: {
      x: { max: 100, grid: { color: '#f0f0f8' }, border: { display: false }, ticks: { callback: v => `${v}%`, font: { size: 10 }, color: '#9ca3af' } },
      y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 12, weight: '600' }, color: '#464555' } },
    },
    onClick: (event, elements) => {
      if (elements.length > 0) {
        const dept = departmentHealth[elements[0].index]?.name;
        if (dept) navigate(`/root/employees?dept=${encodeURIComponent(dept)}`);
      }
    },
    onHover: hoverCursor,
  };

  // ── KPI cards ─────────────────────────────────────────────────────────────────
  const kpiCards = [
    { label: 'Total Employees', value: totalEmployees, sub: `+${recentJoiners.length} recent`,
      icon: <Users size={16} />, iconBg: 'bg-[#f0f3ff] text-[#3525cd]',
      tooltip: 'Total active employees in the organization. Click to view the full employee list.',
      onClick: () => navigate('/root/employees?role=employee') },
    { label: 'Present Today', value: `${presentPct}%`, sub: `${presentToday} present`,
      icon: <UserCheck size={16} />, iconBg: 'bg-emerald-50 text-emerald-600',
      tooltip: 'Percentage of employees present today. Click to view details.',
      onClick: () => setAttModal({ date: new Date().toISOString().split('T')[0], filter: 'present' }) },
    { label: 'Pending Approvals', value: totalPendingApprovals,
      sub: totalPendingApprovals > 0 ? 'Needs attention' : 'All clear',
      icon: <ClipboardList size={16} />,
      iconBg: totalPendingApprovals > 0 ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600',
      tooltip: 'All pending approval requests (leaves, WFH, regularizations). Click to view.',
      alert: totalPendingApprovals > 0,
      onClick: () => navigate('/root/pending-approvals') },
    { label: 'HR Admins', value: totalHR, sub: 'Active admins',
      icon: <ShieldCheck size={16} />, iconBg: 'bg-purple-50 text-purple-600',
      tooltip: 'Number of HR administrators managing the organization. Click to manage HR access.',
      onClick: () => navigate('/root/manage-hr') },
    { label: 'Departments', value: totalDepartments, sub: 'Active teams',
      icon: <Building2 size={16} />, iconBg: 'bg-sky-50 text-sky-600',
      tooltip: 'Total active departments. Click to view and manage departments.',
      onClick: () => navigate('/root/departments') },
    { label: 'On Leave Today', value: onLeaveToday,
      sub: onLeaveToday > 0 ? `${onLeaveToday} out today` : 'Full attendance',
      icon: <CalendarDays size={16} />,
      iconBg: onLeaveToday > 3 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-500',
      tooltip: 'Employees on approved leave today. Click to see who is on leave.',
      onClick: () => setAttModal({ date: new Date().toISOString().split('T')[0], filter: 'on_leave' }) },
  ];

  // ── Activity name click ───────────────────────────────────────────────────────
  function handleActivityNameClick(e, item) {
    e.stopPropagation();
    if (item.type === 'leave') navigate('/root/leaves');
    else if (item.type === 'checkin') navigate('/root/calendar');
    else navigate('/root/employees');
  }

  // ── Workforce status navigation ───────────────────────────────────────────────
  function navigateWorkforceStatus(urlStatus) {
    const today = new Date().toISOString().split('T')[0];
    const filter = urlStatus === 'present'  ? 'present'
                 : urlStatus === 'on_leave' ? 'on_leave'
                 : urlStatus === 'wfh'      ? 'wfh'
                 : urlStatus === 'absent'   ? 'absent'
                 : urlStatus === 'half_day' ? 'on_leave'
                 : 'all';
    setAttModal({ date: today, filter });
  }

  return (
    <div className="space-y-5">

      {/* ── HERO ──────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl p-6 relative overflow-hidden shadow-md"
        style={{ background: 'linear-gradient(135deg, #1e1b5e 0%, #3525cd 40%, #6d28d9 75%, #9333ea 100%)' }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 75% 50%, rgba(255,255,255,.1) 0%, transparent 55%), radial-gradient(circle at 20% 80%, rgba(255,255,255,.05) 0%, transparent 40%)' }} />
        <div className="relative flex flex-col lg:flex-row lg:items-center gap-5">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={13} className="text-white/60" />
              <span className="text-white/60 text-[0.65rem] font-bold uppercase tracking-widest">Root Admin Console</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Good {greeting()}, {user?.name?.split(' ')[0]} 👋
            </h1>
            <p className="text-white/70 text-sm mt-1">Your organization is running smoothly today.</p>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="flex items-center gap-1.5 bg-white/10 backdrop-blur border border-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {presentPct}% Attendance Rate
              </span>
              <span className="flex items-center gap-1.5 bg-white/10 border border-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                <CalendarDays size={11} /> {onLeaveToday} On Leave
              </span>
              {totalPendingApprovals > 0 && (
                <span className="flex items-center gap-1.5 bg-amber-400/20 border border-amber-400/40 text-amber-200 text-xs font-bold px-3 py-1.5 rounded-full">
                  <AlertCircle size={11} /> {totalPendingApprovals} Pending Approvals
                </span>
              )}
              {anniversaries.length > 0 && (
                <span className="flex items-center gap-1.5 bg-white/10 border border-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                  🎊 {anniversaries.length} Work Anniversar{anniversaries.length === 1 ? 'y' : 'ies'} Today
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:flex-col lg:w-auto">
            <button onClick={() => navigate('/root/employees?action=add')}
              className="flex items-center gap-2 bg-white text-[#3525cd] font-bold text-xs px-4 py-2.5 rounded-xl hover:bg-white/90 transition-all shadow-sm">
              <UserPlus size={13} /> Add Employee
            </button>
            <button onClick={() => navigate('/root/leaves')}
              className="flex items-center gap-2 bg-white/15 border border-white/30 text-white font-bold text-xs px-4 py-2.5 rounded-xl hover:bg-white/20 transition-all">
              <ClipboardList size={13} /> Approve Leaves
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI SECTION HEADER ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-black text-[#777587] uppercase tracking-wider">Key Metrics</h2>
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-[0.68rem] text-[#9ca3af]">Updated {fmtUpdatedAt(dataUpdatedAt)}</span>
          )}
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-1.5 text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2.5 py-1.5 rounded-lg hover:bg-[#f0f3ff] border border-transparent hover:border-[#c7c4d8] transition-all disabled:opacity-50">
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI CARDS ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map((card, i) => (
          <KpiTooltip key={i} text={card.tooltip}>
            <div onClick={card.onClick}
              className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 transition-all duration-200 hover:shadow-md hover:border-[#3525cd]/30 hover:-translate-y-0.5 cursor-pointer h-full">
              <div className="flex items-start justify-between mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.iconBg}`}>{card.icon}</div>
                {card.alert && <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
              </div>
              <p className="text-xl font-black text-[#151c27] leading-tight">{card.value}</p>
              <p className="text-[0.68rem] text-[#777587] mt-0.5 font-medium leading-tight">{card.label}</p>
              {card.sub && (
                <p className={`text-[0.62rem] mt-1 font-semibold ${card.alert ? 'text-amber-600' : 'text-emerald-600'}`}>{card.sub}</p>
              )}
            </div>
          </KpiTooltip>
        ))}
      </div>

      {/* ── PENDING APPROVALS + ACTION CENTER + WORKFORCE ─────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-5">

        {/* Pending Approvals (replaces Live Activity) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
              <ClipboardList size={14} className="text-amber-500" /> Pending Approvals
              {(pendingLeavesData.length + pendingRegs.length) > 0 && (
                <span className="text-[0.6rem] font-black px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
                  {pendingLeavesData.length + pendingRegs.length}
                </span>
              )}
            </h2>
            <button onClick={() => navigate('/root/pending-approvals')}
              className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
              View all →
            </button>
          </div>

          {/* Type tabs */}
          <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-[#f0f3ff] overflow-x-auto">
            {[
              { key: 'all',   label: `All (${pendingLeavesData.length + pendingRegs.length})` },
              { key: 'leave', label: `Leave (${pendingLeavesData.filter(l => l.leave_type !== 'wfh' && l.leave_time !== 'wfh').length})` },
              { key: 'wfh',   label: `WFH (${pendingLeavesData.filter(l => l.leave_type === 'wfh' || l.leave_time === 'wfh').length})` },
              { key: 'reg',   label: `Regularization (${pendingRegs.length})` },
            ].map(t => (
              <button key={t.key} onClick={() => setPendingTab(t.key)}
                className={`px-2.5 py-1 rounded-full text-[0.65rem] font-bold whitespace-nowrap transition-all ${
                  pendingTab === t.key ? 'bg-[#3525cd] text-white' : 'bg-[#f0f3ff] text-[#777587] hover:text-[#3525cd]'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 divide-y divide-[#f9f9ff] overflow-y-auto" style={{ maxHeight: 280 }}>
            {(() => {
              const isWfh = l => l.leave_type === 'wfh' || l.leave_time === 'wfh';
              const leaves = pendingTab === 'all'   ? pendingLeavesData
                           : pendingTab === 'leave' ? pendingLeavesData.filter(l => !isWfh(l))
                           : pendingTab === 'wfh'   ? pendingLeavesData.filter(isWfh)
                           : [];
              const regs   = pendingTab === 'all' || pendingTab === 'reg' ? pendingRegs : [];
              const combined = [
                ...leaves.map(l => ({ ...l, _kind: 'leave' })),
                ...regs.map(r => ({ ...r, _kind: 'reg' })),
              ];
              if (combined.length === 0) return (
                <div className="py-10 text-center">
                  <CheckCircle2 size={22} className="text-emerald-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-[#464555]">All clear!</p>
                  <p className="text-xs text-[#9ca3af] mt-0.5">No pending requests.</p>
                </div>
              );
              return combined.slice(0, 8).map((item, i) => (
                <div key={`${item._kind}-${item.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#fafaff] transition-colors">
                  <Avatar name={item.name || item.user_name} color={item.avatar_color || item.user_avatar_color} size={28} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#151c27] truncate">{item.name || item.user_name}</p>
                    <p className="text-[0.6rem] text-[#9ca3af]">
                      {item._kind === 'leave'
                        ? `${isWfh(item) ? 'WFH' : (item.leave_type || 'Leave')} · ${item.start_date}${item.end_date && item.end_date !== item.start_date ? ` → ${item.end_date}` : ''}`
                        : `Regularization · ${item.date}`}
                    </p>
                  </div>
                  <span className={`text-[0.58rem] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                    item._kind === 'reg' ? 'bg-orange-50 text-orange-600' : isWfh(item) ? 'bg-[#f0f3ff] text-[#3525cd]' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {item._kind === 'reg' ? 'Reg.' : isWfh(item) ? 'WFH' : 'Leave'}
                  </span>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => item._kind === 'leave' ? approveMut.mutate(item.id) : approveRegMut.mutate(item.id)}
                      disabled={isBusy || approveRegMut.isPending || rejectRegMut.isPending}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.65rem] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 transition-colors disabled:opacity-40">
                      <Check size={10} /> Approve
                    </button>
                    <button
                      onClick={() => item._kind === 'leave' ? rejectMut.mutate(item.id) : rejectRegMut.mutate(item.id)}
                      disabled={isBusy || approveRegMut.isPending || rejectRegMut.isPending}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.65rem] font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition-colors disabled:opacity-40">
                      <X size={10} /> Reject
                    </button>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Action Center — Quick Actions + Pending Tasks (Quick Approvals removed) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
              <Zap size={14} className="text-amber-500" /> Action Center
            </h2>
          </div>

          {/* Quick Actions grid */}
          <div className="px-4 py-3 border-b border-[#f0f3ff]">
            <p className="text-[0.6rem] font-black uppercase tracking-wider text-[#777587] mb-2">Quick Actions</p>
            <div className="grid grid-cols-2 gap-1">
              {QUICK_ACTIONS.map(action => (
                <button key={action.label} onClick={() => navigate(action.to)}
                  className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[0.72rem] font-semibold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] border border-transparent hover:border-[#c7c4d8] transition-all text-left">
                  <span className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${action.color}`}>
                    {action.icon}
                  </span>
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pending tasks */}
          <div className="flex-1 overflow-hidden">
            {actionCenter.length === 0 || (actionCenter.length === 1 && actionCenter[0].type === 'all_clear') ? (
              <div className="py-5 text-center">
                <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-1.5">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                </div>
                <p className="text-xs font-semibold text-[#151c27]">All clear!</p>
                <p className="text-[0.65rem] text-[#777587] mt-0.5">No pending tasks right now.</p>
              </div>
            ) : (
              <div className="divide-y divide-[#f9f9ff]">
                {actionCenter.filter(item => item.type !== 'all_clear').map((item, i) => (
                  <div key={i} onClick={item.link ? () => navigate(item.link) : undefined}
                    className={`flex items-center gap-3 px-5 py-3 ${item.link ? 'cursor-pointer hover:bg-[#fafaff]' : ''} transition-colors`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      item.priority === 'High' ? 'bg-rose-50' : item.priority === 'Medium' ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                      {item.type === 'leaves'     ? <ClipboardList size={12} className="text-rose-500" />  :
                       item.type === 'attendance' ? <Clock size={12} className="text-amber-500" />         :
                       item.type === 'expenses'   ? <AlertCircle size={12} className="text-amber-500" />   :
                       <CheckCircle2 size={12} className="text-emerald-500" />}
                    </div>
                    <div className="flex-1 text-xs font-semibold text-[#151c27]">{item.label}</div>
                    <span className={`text-[0.6rem] px-1.5 py-0.5 rounded-full border font-bold flex-shrink-0 ${PRIORITY_BADGE[item.priority] || PRIORITY_BADGE.Low}`}>
                      {item.priority}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Today's Workforce — interactive doughnut */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
          <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2 mb-1">
            <Activity size={13} className="text-[#3525cd]" /> Today's Workforce
          </h2>
          <p className="text-[0.65rem] text-[#9ca3af] mb-3">Click segment to filter</p>
          {workforceEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <Clock size={22} className="text-[#c7c4d8]" />
              <p className="text-sm font-semibold text-[#464555]">No check-ins yet</p>
              <p className="text-xs text-[#9ca3af] text-center">Workforce data will appear once employees mark their attendance.</p>
            </div>
          ) : (
            <>
              <DoughnutChart data={workforceChartData} options={workforceOptions} centerLabel={totalWorkforce} centerSub="Total" />
              <div className="mt-3 space-y-1.5">
                {workforceEntries.map(s => (
                  <button key={s.key} onClick={() => navigateWorkforceStatus(s.urlStatus)}
                    className="w-full flex items-center justify-between text-xs hover:bg-[#f9f9ff] px-1 py-0.5 rounded transition-colors">
                    <span className="flex items-center gap-1.5 font-medium text-[#464555]">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <span className="font-black text-[#151c27]">{s.value}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── ATTENDANCE TREND + LEAVE BREAKDOWN ───────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-5">

        {/* Attendance Trend — with time filter */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
          <div className="flex items-center justify-between mb-0.5">
            <h2 className="text-sm font-black text-[#151c27]">Attendance Trend</h2>
            <div className="flex items-center gap-2">
              {trendSlice.length > 0 && (
                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  {trendAvgPct}% Avg ({trendDays}d)
                </span>
              )}
              <div className="flex bg-[#f0f3ff] border border-[#c7c4d8] rounded-lg p-0.5 gap-0.5">
                {[7, 14, 30].map(d => (
                  <button key={d} onClick={() => setTrendDays(d)}
                    className={`px-2 py-0.5 rounded text-[0.65rem] font-bold transition-all ${trendDays === d ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'}`}>
                    {d}d
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[0.68rem] text-[#9ca3af] mb-4">Last {trendDays} Days · Click a point to view attendance</p>
          {trendSlice.length > 0 ? (
            <div style={{ height: 180 }}>
              <Line data={trendChartData} options={trendOptions} />
            </div>
          ) : (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <TrendingUp size={22} className="text-[#c7c4d8]" />
              <p className="text-sm font-semibold text-[#464555]">No attendance records yet</p>
              <p className="text-xs text-[#9ca3af]">Trend data will appear as employees mark attendance daily.</p>
            </div>
          )}
        </div>

        {/* Leave Breakdown */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
          <div className="flex items-center justify-between mb-0.5">
            <h2 className="text-sm font-black text-[#151c27]">Leave Breakdown</h2>
            <span className="text-[0.68rem] text-[#9ca3af]">{new Date().getFullYear()}</span>
          </div>
          <p className="text-[0.68rem] text-[#9ca3af] mb-4">Approved leaves by type · Click to view</p>
          {leaveSegs.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <CalendarDays size={22} className="text-[#c7c4d8]" />
              <p className="text-sm font-semibold text-[#464555]">No approved leaves yet</p>
              <p className="text-xs text-[#9ca3af]">Leave distribution will appear once leaves are approved this year.</p>
            </div>
          ) : (
            <div className="flex items-center gap-5">
              <div className="w-48 flex-shrink-0">
                <DoughnutChart data={leaveChartData} options={leaveOptions} centerLabel={totalLeaveSegs} centerSub="Leaves" />
              </div>
              <div className="flex-1 space-y-2.5">
                {leaveSegs.map((t, idx) => (
                  <button key={t.key} onClick={() => navigate(`/root/leaves?type=${t.key}&status=approved`)}
                    className="w-full flex items-center justify-between text-xs hover:bg-[#f9f9ff] px-2 py-1 rounded-lg transition-colors group">
                    <span className="flex items-center gap-2 font-medium text-[#464555] group-hover:text-[#3525cd] transition-colors">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: t.color }} />
                      {t.label}
                    </span>
                    <span className="font-bold text-[#151c27]">
                      {t.value}
                      <span className="text-[#9ca3af] font-normal ml-1">({leaveSegPcts[idx]}%)</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── DEPARTMENT HEALTH + HEADCOUNT GROWTH ─────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-5">

        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
          <div className="flex items-center justify-between mb-0.5">
            <h2 className="text-sm font-black text-[#151c27]">Department Health</h2>
            <span className="text-[0.68rem] text-[#9ca3af]">Attendance Overview</span>
          </div>
          <p className="text-[0.68rem] text-[#9ca3af] mb-4">Click a bar to view department employees</p>
          {departmentHealth.length === 0 ? (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <Building2 size={22} className="text-[#c7c4d8]" />
              <p className="text-sm font-semibold text-[#464555]">No departments found</p>
              <p className="text-xs text-[#9ca3af]">Add departments and assign employees to see attendance health.</p>
            </div>
          ) : (
            <div style={{ height: Math.max(180, departmentHealth.length * 44) }}>
              <Bar data={deptChartData} options={deptOptions} />
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
          <div className="flex items-center justify-between mb-0.5">
            <h2 className="text-sm font-black text-[#151c27]">Headcount Growth</h2>
            <span className="text-[0.68rem] text-[#9ca3af]">This Year</span>
          </div>
          <p className="text-[0.68rem] text-[#9ca3af] mb-4">Cumulative employee count · Click New Joiners to filter by month</p>
          {headSlice.length > 0 ? (
            <div style={{ height: 180 }}>
              <Line data={headChartData} options={headOptions} />
            </div>
          ) : (
            <div className="h-40 flex flex-col items-center justify-center gap-2">
              <TrendingUp size={22} className="text-[#c7c4d8]" />
              <p className="text-sm font-semibold text-[#464555]">No headcount data yet</p>
              <p className="text-xs text-[#9ca3af]">Growth trends will appear as employees are added.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── UPCOMING EVENTS + EMPLOYEE HIGHLIGHTS + PENDING APPROVALS ─────────── */}
      <div className="grid lg:grid-cols-3 gap-5">

        {/* Upcoming Events */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
              <Calendar size={13} className="text-[#3525cd]" /> Upcoming Events
            </h2>
            <button onClick={() => navigate('/root/calendar')}
              className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
              View Calendar
            </button>
          </div>
          <div className="divide-y divide-[#f9f9ff]">
            {upcomingEvents.length === 0 ? (
              <div className="py-10 text-center">
                <Calendar size={22} className="text-[#c7c4d8] mx-auto mb-2" />
                <p className="text-sm font-semibold text-[#464555]">No upcoming events</p>
                <p className="text-xs text-[#9ca3af] mt-0.5">Add holidays or events to see them here.</p>
              </div>
            ) : upcomingEvents.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#fafaff] transition-colors cursor-pointer"
                onClick={() => navigate('/root/calendar')}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${ev.type === 'holiday' ? 'bg-amber-50' : 'bg-[#f0f3ff]'}`}>
                  {ev.type === 'holiday' ? <Star size={13} className="text-amber-500" /> : <CalendarDays size={13} className="text-[#3525cd]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[#151c27] truncate">{ev.title}</p>
                  <p className="text-[0.62rem] text-[#9ca3af]">{fmtDate(ev.date)}</p>
                </div>
                <span className="text-[0.62rem] text-[#9ca3af] font-semibold whitespace-nowrap">{daysUntil(ev.date)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Employee Highlights — birthdays + anniversaries + new joiners */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
              <UserPlus size={13} className="text-emerald-500" /> Employee Highlights
            </h2>
            <button onClick={() => navigate('/root/employees')}
              className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
              View all
            </button>
          </div>
          <div className="divide-y divide-[#f9f9ff]">
            {birthdays.length > 0 && (
              <div className="px-5 py-3 bg-amber-50/60">
                <p className="text-xs font-bold text-amber-700 mb-2">🎂 Birthdays Today</p>
                <div className="space-y-1.5">
                  {birthdays.map((b, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Avatar name={b.name} color={b.avatar_color} size={22} />
                      <span className="text-xs font-semibold text-[#464555]">{b.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {anniversaries.length > 0 && (
              <div className="px-5 py-3 bg-[#f0f3ff]/60">
                <p className="text-xs font-bold text-[#3525cd] mb-2 flex items-center gap-1.5">
                  <Award size={12} /> Work Anniversaries Today
                </p>
                <div className="space-y-1.5">
                  {anniversaries.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Avatar name={a.name} color={a.avatar_color} size={22} />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-[#464555] block truncate">{a.name}</span>
                      </div>
                      <span className="text-[0.6rem] font-black text-[#3525cd] bg-[#e7eefe] px-1.5 py-0.5 rounded-full whitespace-nowrap">
                        {a.years}yr
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="px-5 py-3">
              <p className="text-[0.65rem] font-bold text-[#777587] uppercase tracking-wide mb-2">New Joiners</p>
              <div className="space-y-2">
                {recentJoiners.length === 0 ? (
                  <div className="py-3 text-center">
                    <p className="text-xs font-semibold text-[#464555]">No recent joiners</p>
                    <p className="text-[0.62rem] text-[#9ca3af] mt-0.5">New employees added will appear here.</p>
                  </div>
                ) : recentJoiners.map((emp, i) => (
                  <div key={i} onClick={() => navigate('/root/employees')}
                    className="flex items-center gap-2.5 hover:bg-[#fafaff] -mx-2 px-2 py-1 rounded-lg transition-colors cursor-pointer">
                    <Avatar name={emp.name} color={emp.avatar_color} size={30} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#151c27] truncate">{emp.name}</p>
                      <p className="text-[0.62rem] text-[#9ca3af]">{emp.position || emp.department || 'Employee'}</p>
                    </div>
                    <span className="text-[0.6rem] text-[#9ca3af] whitespace-nowrap">{relTime(emp.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* ── YEARLY LEAVE OVERVIEW — sortable + filterable ─────────────────────── */}
      {allYearly.length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#e7eefe] flex items-center gap-3 flex-wrap">
            <CalendarDays size={14} className="text-[#3525cd]" />
            <h2 className="text-sm font-black text-[#151c27] uppercase tracking-wider">
              Yearly Leave Overview — {yearlyData?.year || new Date().getFullYear()}
            </h2>
            <span className="text-xs text-[#777587]">{yearlyData?.totalLeaves || 18} days allocated</span>
            <div className="ml-auto flex items-center gap-2">
              <Filter size={12} className="text-[#777587]" />
              <select
                value={yearlyDeptFilt}
                onChange={e => setYearlyDeptFilt(e.target.value)}
                className="text-xs border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-[#464555] bg-white focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20">
                <option value="">All Departments</option>
                {yearlyDepts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {yearlyDeptFilt && (
                <button onClick={() => setYearlyDeptFilt('')}
                  className="text-[0.68rem] text-[#3525cd] hover:underline font-semibold">
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f9f9ff]">
                  <th className="px-5 py-3 text-left">
                    <button onClick={() => toggleSort('name')}
                      className="flex items-center gap-1 text-xs font-bold text-[#777587] uppercase tracking-wider hover:text-[#3525cd] transition-colors">
                      Employee <SortIcon col="name" sort={yearlySort} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <button onClick={() => toggleSort('department')}
                      className="flex items-center gap-1 text-xs font-bold text-[#777587] uppercase tracking-wider hover:text-[#3525cd] transition-colors whitespace-nowrap">
                      Department <SortIcon col="department" sort={yearlySort} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center">
                    <button onClick={() => toggleSort('usedDays')}
                      className="flex items-center gap-1 text-xs font-bold text-[#777587] uppercase tracking-wider hover:text-[#3525cd] transition-colors mx-auto">
                      Used <SortIcon col="usedDays" sort={yearlySort} />
                    </button>
                  </th>
                  <th className="px-4 py-3 text-center">
                    <button onClick={() => toggleSort('remainingDays')}
                      className="flex items-center gap-1 text-xs font-bold text-[#777587] uppercase tracking-wider hover:text-[#3525cd] transition-colors mx-auto">
                      Remaining <SortIcon col="remainingDays" sort={yearlySort} />
                    </button>
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-bold text-[#777587] uppercase tracking-wider w-44">
                    Progress
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {displayedYearly.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-xs text-[#9ca3af]">
                      No employees in this department.
                    </td>
                  </tr>
                ) : displayedYearly.map(emp => {
                  const pct      = Math.min(100, Math.round((emp.usedDays / emp.totalDays) * 100));
                  const barColor = pct >= 90 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-500';
                  const remColor = emp.remainingDays <= 3 ? 'text-rose-600' : emp.remainingDays <= 7 ? 'text-amber-600' : 'text-emerald-600';
                  return (
                    <tr key={emp.id} onClick={() => navigate(`/root/leaves?userId=${emp.id}`)}
                      className="hover:bg-[#f9f9ff] transition-colors cursor-pointer group">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={emp.name} color={emp.avatar_color} size={30} />
                          <div>
                            <div className="font-bold text-[#151c27] text-sm leading-tight group-hover:text-[#3525cd] transition-colors">{emp.name}</div>
                            {emp.position && <div className="text-xs text-[#777587]">{emp.position}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#464555] whitespace-nowrap">{emp.department || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-black text-[#151c27]">{emp.usedDays}</span>
                        <span className="text-xs text-[#777587]"> / {emp.totalDays}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-sm font-black ${remColor}`}>{emp.remainingDays}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-[#e7eefe] rounded-full h-1.5 overflow-hidden">
                            <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-[#777587] w-8 text-right shrink-0">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Inline attendance day-view modal — avoids navigation away from Dashboard */}
      {attModal && (
        <AttendanceDayModal
          dateStr={attModal.date}
          initialTab={attModal.filter}
          onClose={() => setAttModal(null)}
        />
      )}
    </div>
  );
}
