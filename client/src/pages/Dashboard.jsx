import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  ArcElement, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Legend, Filler,
} from 'chart.js';
import { Doughnut, Line } from 'react-chartjs-2';
import {
  Users, UserCheck, Umbrella, Home, Clock, ClipboardList,
  CalendarDays, Megaphone, Activity, BarChart2,
  Timer, X, LogIn, LogOut,
  UserPlus, FileText, CheckCircle2, Pencil, RefreshCw, Inbox,
  Trash2, ChevronRight, TrendingUp, TrendingDown,
  Cake, Building2, Mail, AlertCircle, Gift, ShieldCheck,
  Coffee, Play, FolderOpen,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge, LeaveTypeBadge } from '@/components/ui/Badge';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { fmtDate, fmtDateRange, fmtTime, fmtHours, todayStr, getGreeting } from '@/lib/utils';
import { AttendanceDayModal } from '@/components/AttendanceDayModal';

ChartJS.register(
  ArcElement, CategoryScale, LinearScale, PointElement, LineElement,
  BarElement, Tooltip, Legend, Filler,
);

const tooltipStyle = {
  backgroundColor: 'rgba(255,255,255,0.97)',
  titleColor: '#151c27', bodyColor: '#464555',
  borderColor: '#e7eefe', borderWidth: 1,
  padding: 10, cornerRadius: 8,
  titleFont: { weight: 'bold', size: 12 },
  bodyFont: { size: 12 },
  boxWidth: 10, boxHeight: 10, boxPadding: 4,
};

function getWeekNumber(d = new Date()) {
  const date = new Date(d); date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const y = new Date(date.getFullYear(), 0, 1);
  return Math.ceil((((date - y) / 86400000) + 1) / 7);
}
function getSeason(month) {
  if (month >= 3 && month <= 5) return 'Spring Season';
  if (month >= 6 && month <= 8) return 'Summer Season';
  if (month >= 9 && month <= 11) return 'Autumn Season';
  return 'Winter Season';
}
function relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  if (h < 48) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
const hoverCursor = (event, elements) => {
  const t = event.native?.target;
  if (t) t.style.cursor = elements.length > 0 ? 'pointer' : 'default';
};

// ── Check-in Widget ────────────────────────────────────────────────────────────
function CheckinWidget({ onRefresh }) {
  const toast = useToast();
  const [record, setRecord] = useState(null);
  const [elapsed, setElapsed] = useState('');
  const [busy, setBusy] = useState(false);
  const [breakBusy, setBreakBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await apiGet('/attendance/today'); setRecord(r); } catch { /* silent */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const isOnBreak = record?.break_start && !record?.break_end;
    if (!record?.check_in || record?.check_out) { setElapsed(''); return; }
    const tick = () => {
      if (isOnBreak) {
        const [bh, bm] = record.break_start.split(':').map(Number);
        const s = new Date(); s.setHours(bh, bm, 0, 0);
        const t = Math.floor((Date.now() - s.getTime()) / 60000);
        setElapsed(`${Math.floor(t/60) > 0 ? Math.floor(t/60) + 'h ' : ''}${t%60}m on break`);
      } else {
        const [h, m] = record.check_in.split(':').map(Number);
        const s = new Date(); s.setHours(h, m, 0, 0);
        const t = Math.max(0, Math.floor((Date.now() - s.getTime()) / 60000) - (record.total_break_minutes || 0));
        setElapsed(`${Math.floor(t/60) > 0 ? Math.floor(t/60) + 'h ' : ''}${t%60}m`);
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [record]);

  async function checkIn() {
    setBusy(true);
    try { const { record: r, message } = await apiPost('/attendance/checkin', {}); setRecord(r); toast(message || 'Checked in!', 'success'); onRefresh?.(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  async function checkOut() {
    setBusy(true);
    try { const { record: r, message } = await apiPost('/attendance/checkout', {}); setRecord(r); toast(message || 'Checked out!', (r.status === 'half_day' || r.status === 'early_leave') ? 'warning' : 'success'); onRefresh?.(); }
    catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  }
  async function breakIn() {
    setBreakBusy(true);
    try { const { record: r, message } = await apiPost('/attendance/break-in', {}); setRecord(r); toast(message || 'Break started', 'info'); }
    catch (err) { toast(err.message, 'error'); } finally { setBreakBusy(false); }
  }
  async function breakOut() {
    setBreakBusy(true);
    try { const { record: r, message } = await apiPost('/attendance/break-out', {}); setRecord(r); toast(message || 'Break ended', 'success'); }
    catch (err) { toast(err.message, 'error'); } finally { setBreakBusy(false); }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const isOnBreak = !!(record?.break_start && !record?.break_end && !record?.check_out);

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e7eefe] flex items-center gap-2">
        <CalendarDays size={13} className="text-[#777587]" />
        <span className="text-xs font-semibold text-[#777587]">{dateStr}</span>
      </div>
      <div className="p-4">
        {!record?.check_in ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 size={16} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#151c27]">Check In</p>
                <p className="text-xs text-[#777587]">You haven't checked in today</p>
              </div>
            </div>
            <button onClick={checkIn} disabled={busy}
              className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-sm">
              <CheckCircle2 size={14} /> {busy ? 'Checking in…' : 'Check In Now'}
            </button>
          </>
        ) : isOnBreak ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center">
                <Coffee size={16} className="text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-amber-600">On Break</p>
                <p className="text-xs text-[#777587]">{elapsed || `Since ${fmtTime(record.break_start)}`}</p>
              </div>
            </div>
            <button onClick={breakOut} disabled={breakBusy}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-all shadow-sm">
              <Play size={14} /> {breakBusy ? 'Ending…' : 'End Break'}
            </button>
          </>
        ) : !record.check_out ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 size={16} className="text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-bold text-emerald-600">Checked In</p>
                <p className="text-xs text-[#777587]">Since {fmtTime(record.check_in)} · {elapsed}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={breakIn} disabled={breakBusy || busy}
                className="flex-1 flex items-center justify-center gap-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white font-bold text-sm px-3 py-2.5 rounded-xl transition-all shadow-sm">
                <Coffee size={13} /> {breakBusy ? '…' : 'Break'}
              </button>
              <button onClick={checkOut} disabled={busy}
                className="flex-1 flex items-center justify-center gap-1.5 bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white font-bold text-sm px-3 py-2.5 rounded-xl transition-all shadow-sm">
                <LogOut size={13} /> {busy ? '…' : 'Check Out'}
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 py-1">
            <div className="w-8 h-8 rounded-full bg-[#f0f3ff] flex items-center justify-center">
              <CheckCircle2 size={16} className="text-[#3525cd]" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#151c27]">Work Done</p>
              <p className="text-xs text-[#777587]">
                {fmtTime(record.check_in)} – {fmtTime(record.check_out)}
                {record.work_hours > 0 && ` · ${fmtHours(record.work_hours)}`}
                {record.total_break_minutes > 0 && <span className="text-amber-600 ml-1">({record.total_break_minutes >= 60 ? `${Math.floor(record.total_break_minutes/60)}h ` : ''}{record.total_break_minutes % 60}m break)</span>}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Employee Quick View Modal ──────────────────────────────────────────────────
function EmployeeQuickView({ record: r, onClose }) {
  if (!r) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
      style={{ background: 'rgba(4,6,14,.55)', backdropFilter: 'blur(8px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl w-full max-w-sm shadow-2xl border border-[#c7c4d8] overflow-hidden">
        <div className="h-[3px]" style={{ background: 'linear-gradient(90deg, #3525cd, #4f46e5, #712ae2)' }} />
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#f0f3ff]">
          <div className="flex items-center gap-3">
            <Avatar name={r.name} color={r.avatar_color} size={44} />
            <div>
              <div className="font-black text-[#151c27] text-base leading-tight">{r.name}</div>
              {r.position && <div className="text-xs text-[#777587] mt-0.5">{r.position}</div>}
            </div>
          </div>
          <button className="btn btn-ghost btn-icon text-[#777587]" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex flex-col gap-2">
            {r.department && <div className="flex items-center gap-2 text-sm text-slate-600"><Building2 size={14} className="text-[#777587]" /> {r.department}</div>}
            {r.email && <div className="flex items-center gap-2 text-sm text-slate-600"><Mail size={14} className="text-[#777587]" /> {r.email}</div>}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={r.status} />
          </div>
          <div className="rounded-xl border border-[#c7c4d8] bg-[#f0f3ff] divide-y divide-[#e7eefe]">
            {r.check_in && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#464555]"><LogIn size={13} className="text-emerald-500" /> Check In</div>
                <span className="text-sm font-bold text-[#151c27]">{fmtTime(r.check_in)}</span>
              </div>
            )}
            {r.check_out ? (
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#464555]"><LogOut size={13} className="text-rose-500" /> Check Out</div>
                <span className="text-sm font-bold text-[#151c27]">{fmtTime(r.check_out)}</span>
              </div>
            ) : r.check_in ? (
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#464555]"><LogOut size={13} className="text-emerald-500" /> Status</div>
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse inline-block" /> In Progress
                </span>
              </div>
            ) : null}
            {r.work_hours > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#464555]">
                  <Timer size={13} className="text-[#4f46e5]" />
                  Working Hrs
                </div>
                <span className="text-sm font-bold text-[#3525cd]">{fmtHours(r.work_hours)}</span>
              </div>
            )}
            {r.total_break_minutes > 0 && (
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs text-[#464555]"><Timer size={13} className="text-amber-500" /> Break Time</div>
                <span className="text-sm font-bold text-amber-600">
                  {r.total_break_minutes >= 60 ? `${Math.floor(r.total_break_minutes/60)}h ` : ''}{r.total_break_minutes % 60}m
                </span>
              </div>
            )}
            {!r.check_in && <div className="px-4 py-3 text-xs text-[#777587] text-center">No attendance recorded today</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Manage Birthdays Modal ────────────────────────────────────────────────────
function ManageBirthdaysBtn({ onRefresh }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [saving, setSaving] = useState(null);
  const [search, setSearch] = useState('');

  async function load() {
    const emps = await apiGet('/employees').catch(() => []);
    setEmployees(emps); setOpen(true);
  }
  async function saveDob(emp, dob) {
    setSaving(emp.id);
    try {
      await apiPut(`/employees/${emp.id}`, { ...emp, date_of_birth: dob || null });
      setEmployees(es => es.map(e => e.id === emp.id ? { ...e, date_of_birth: dob } : e));
      toast(`Birthday updated for ${emp.name}`, 'success'); onRefresh?.();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(null); }
  }

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    (e.department || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <button className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors" onClick={load}>Manage</button>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-5"
          style={{ background: 'rgba(4,6,14,.65)', backdropFilter: 'blur(14px)' }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl border border-[#c7c4d8] overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#f0f3ff] shrink-0">
              <h2 className="font-black text-[#151c27] flex items-center gap-2"><Cake size={18} className="text-[#3525cd]" /> Manage Birthdays</h2>
              <button className="btn btn-ghost btn-icon text-[#777587]" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <div className="px-6 pt-4 shrink-0">
              <input className="form-control" placeholder="Search employees…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {filtered.map(emp => (
                <div key={emp.id} className="flex items-center gap-3 py-3 border-b border-[#f0f3ff] last:border-0">
                  <Avatar name={emp.name} color={emp.avatar_color} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{emp.name}</div>
                    <div className="text-xs text-[#777587]">{emp.department || '—'}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <input type="date" className="form-control w-36 text-xs py-1.5" defaultValue={emp.date_of_birth || ''}
                      onBlur={e => { if (e.target.value !== (emp.date_of_birth || '')) saveDob(emp, e.target.value); }} />
                    {saving === emp.id && <span className="spinner w-4 h-4 flex-shrink-0" />}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-5 shrink-0 border-t border-[#f0f3ff] pt-4">
              <p className="text-xs text-[#777587]">Changes save automatically on blur.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Manage Holidays Modal ─────────────────────────────────────────────────────
function ManageHolidaysBtn({ onRefresh }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [form, setForm] = useState({ name: '', date: '', type: 'public', description: '' });
  const [confirmDel, setConfirmDel] = useState(null);

  async function load() { const h = await apiGet('/holidays').catch(() => []); setHolidays(h); setOpen(true); }
  async function add() {
    if (!form.name) return toast('Enter holiday name', 'warning');
    if (!form.date) return toast('Select a date', 'warning');
    try {
      await apiPost('/holidays', form);
      toast('Holiday added!', 'success');
      const h = await apiGet('/holidays'); setHolidays(h);
      setForm({ name: '', date: '', type: 'public', description: '' }); onRefresh?.();
    } catch (err) { toast(err.message, 'error'); }
  }
  async function del(id) {
    try { await apiDelete(`/holidays/${id}`); setHolidays(h => h.filter(x => x.id !== id)); toast('Deleted', 'info'); onRefresh?.(); }
    catch (err) { toast(err.message, 'error'); }
  }

  return (
    <>
      <button className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors" onClick={load}>Manage</button>
      {open && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-5" style={{ background: 'rgba(4,6,14,.65)', backdropFilter: 'blur(14px)' }} onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[85vh] flex flex-col shadow-2xl border border-[#c7c4d8] overflow-hidden">
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#f0f3ff] shrink-0">
              <h2 className="font-black text-[#151c27] flex items-center gap-2"><CalendarDays size={18} className="text-[#3525cd]" /> Manage Holidays</h2>
              <button className="btn btn-ghost btn-icon text-[#777587]" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            <div className="p-6 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div><label className="form-label">Name</label><input className="form-control" placeholder="e.g. Diwali" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
                <div><label className="form-label">Date</label><input type="date" className="form-control" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
                <div><label className="form-label">Type</label>
                  <select className="form-control" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="public">Public</option><option value="optional">Optional</option><option value="restricted">Restricted</option>
                  </select>
                </div>
                <div><label className="form-label">Description</label><input className="form-control" placeholder="Optional" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              </div>
              <button className="btn btn-primary btn-sm mb-5" onClick={add}>Add Holiday</button>
              <div className="border-t border-[#f0f3ff] pt-4">
                {holidays.map(h => (
                  <div key={h.id} className="flex items-center justify-between py-2 border-b border-[#f0f3ff] last:border-0 gap-2">
                    <div><div className="text-sm font-semibold">{h.name}</div><div className="text-xs text-[#777587]">{fmtDate(h.date)} · {h.type}</div></div>
                    <button className="btn btn-danger btn-sm text-xs py-1 px-2" onClick={() => setConfirmDel(h)}><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmModal open={!!confirmDel} title="Delete Holiday" message={`Delete "${confirmDel?.name}"?`} confirmLabel="Delete"
        onConfirm={() => del(confirmDel.id)} onCancel={() => setConfirmDel(null)} />
    </>
  );
}

// ── Attendance Trend Chart ─────────────────────────────────────────────────────
const TREND_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#3525cd', '#ef4444'];
const DEPT_CHART_COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#ec4899','#94a3b8'];

function AttendanceTrendChart({ analytics, navigate }) {
  const [period, setPeriod] = useState('7d');
  const trend = period === '7d' ? (analytics?.weeklyTrend || []) : (analytics?.monthlyTrend || []);
  const avg = analytics?.avgPct7 ?? 0;
  const change = analytics?.attendanceChange ?? 0;

  const chartData = {
    labels: trend.map(t => t.label),
    datasets: [{
      label: 'Attendance %',
      data: trend.map(t => t.pct),
      fill: true,
      backgroundColor: 'rgba(53, 37, 205, 0.06)',
      borderColor: '#4f46e5',
      borderWidth: 2.5,
      pointRadius: 4,
      pointBackgroundColor: '#4f46e5',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointHoverRadius: 6,
      tension: 0.4,
    }],
  };
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { ...tooltipStyle, callbacks: { label: ctx => ` ${ctx.parsed.y}% attendance` } },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 9 }, color: '#9ca3af', maxTicksLimit: period === '7d' ? 7 : 10 } },
      y: { min: 0, max: 100, grid: { color: '#f0f0f8' }, border: { display: false }, ticks: { callback: v => `${v}%`, font: { size: 9 }, color: '#9ca3af', maxTicksLimit: 5 } },
    },
    onClick: () => navigate('/calendar'),
    onHover: (e) => { const t = e.native?.target; if (t) t.style.cursor = 'pointer'; },
  };

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
        <h2 className="text-sm font-black text-[#151c27]">Attendance Trend</h2>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          className="text-xs border border-[#c7c4d8] rounded-lg px-2 py-1 text-[#464555] font-semibold bg-white outline-none cursor-pointer">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>
      <div className="flex-1 px-5 pt-4 pb-2" style={{ minHeight: 180 }}>
        {trend.length === 0
          ? <div className="h-full flex items-center justify-center text-sm text-[#9ca3af]">No data</div>
          : <Line data={chartData} options={chartOptions} />}
      </div>
      <div className="px-5 pb-4 pt-2 flex items-center justify-between border-t border-[#f0f3ff] mt-2">
        <div>
          <p className="text-[0.65rem] text-[#9ca3af]">Average Attendance</p>
          <p className="text-xl font-black text-[#151c27]">{avg}%</p>
        </div>
        <div className="text-right">
          <p className="text-[0.65rem] text-[#9ca3af]">Change</p>
          <p className={`text-sm font-bold flex items-center gap-1 justify-end ${change >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
            {change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {change >= 0 ? '+' : ''}{change}% vs last 7 days
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Organization Overview ──────────────────────────────────────────────────────
// ── Organization Overview ──────────────────────────────────────────────────────
function OrgOverviewSection({ analytics, navigate }) {
  const { deptDistribution = [], roleDistribution = [], totalDepts = 0, totalEmpCount = 0 } = analytics || {};
  // BUG_170: number of distinct designation/role types shown in chart (not total employees)
  const totalRoleTypes = roleDistribution.length;
  const [tab, setTab] = useState('depts');

  const deptChartData = {
    labels: deptDistribution.map(d => d.name),
    datasets: [{
      data: deptDistribution.map(d => d.count),
      backgroundColor: DEPT_CHART_COLORS.slice(0, deptDistribution.length),
      borderWidth: 2, borderColor: '#fff', hoverOffset: 4,
    }],
  };

  const doughnutOpts = {
    cutout: '72%', responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: tooltipStyle },
    onHover: hoverCursor,
  };

  const roleColors = ['#3525cd', '#10b981', '#f59e0b', '#64748b'];
  const roleChartData = {
    labels: roleDistribution.map(r => r.name),
    datasets: [{
      data: roleDistribution.map(r => r.count),
      backgroundColor: roleColors.slice(0, roleDistribution.length),
      borderWidth: 2, borderColor: '#fff', hoverOffset: 4,
    }],
  };

  const isDepts = tab === 'depts';
  const list = isDepts ? deptDistribution : roleDistribution;
  const total = isDepts ? totalDepts : totalEmpCount;
  const chartData = isDepts ? deptChartData : roleChartData;
  const colors = isDepts ? DEPT_CHART_COLORS : roleColors;

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col justify-between h-full">
      <div className="px-5 py-3.5 border-b border-[#e7eefe] flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-black text-[#151c27]">Organization Overview</h2>
        <div className="flex items-center gap-1 bg-[#f0f3ff] p-1 rounded-lg border border-[#c7c4d8]">
          <button onClick={() => setTab('depts')}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${isDepts ? 'bg-white text-[#3525cd] shadow-xs' : 'text-[#777587] hover:text-[#151c27]'}`}>
            Depts ({totalDepts})
          </button>
          <button onClick={() => setTab('roles')}
            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${!isDepts ? 'bg-white text-[#3525cd] shadow-xs' : 'text-[#777587] hover:text-[#151c27]'}`}>
            Positions / Job Title ({totalRoleTypes})
          </button>
        </div>
      </div>

      <div className="p-5 flex items-center gap-5 flex-1">
        <div className="relative shrink-0" style={{ width: 110, height: 110 }}>
          {list.length > 0 && list.some(x => x.count > 0)
            ? <Doughnut data={chartData} options={doughnutOpts} />
            : <div className="w-full h-full rounded-full border-4 border-[#f0f3ff]" />}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-black text-[#151c27]">{total}</span>
            <span className="text-[0.58rem] font-bold text-[#777587] uppercase">{isDepts ? 'Depts' : 'Members'}</span>
          </div>
        </div>

        <div className="flex-1 space-y-2.5 min-w-0">
          {list.slice(0, 5).map((item, i) => (
            <div key={item.name} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colors[i % colors.length] }} />
                  <span className="text-[#151c27] truncate font-bold">{item.name}</span>
                </div>
                <span className="text-[#464555] font-black shrink-0 ml-2">{item.count} <span className="text-[0.65rem] font-normal text-[#777587]">({item.pct}%)</span></span>
              </div>
              <div className="h-1.5 bg-[#f0f3ff] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${item.pct}%`, background: colors[i % colors.length] }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-2.5 bg-[#fafaff] border-t border-[#e7eefe] flex items-center justify-between text-xs">
        <span className="text-[#777587] font-medium">Department Management</span>
        <button onClick={() => navigate('/departments')} className="font-bold text-[#3525cd] hover:underline flex items-center gap-1">
          Manage Departments →
        </button>
      </div>
    </div>
  );
}

// ── Leave Balance Overview ─────────────────────────────────────────────────────
function LeaveBalanceSection({ analytics, navigate }) {
  const { leaveBalanceByType = [] } = analytics || {};

  const LEAVE_ICONS = {
    casual: '📅', sick: '🤒', annual: '🏖️', emergency: '🚨', wfh: '🏠', maternity: '👶', paternity: '👨‍👧', comp_off: '🔄',
  };

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
        <h2 className="text-sm font-black text-[#151c27]">Leave Balance Overview</h2>
        <button onClick={() => navigate('/reports')}
          className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
          View report
        </button>
      </div>
      <div className="p-4 space-y-3">
        {leaveBalanceByType.length === 0 ? (
          <div className="py-6 text-center text-sm text-[#9ca3af]">No leave data</div>
        ) : leaveBalanceByType.map(lb => {
          const pct = lb.total > 0 ? Math.min(100, Math.round((lb.used / lb.total) * 100)) : 0;
          return (
            <div key={lb.type} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{LEAVE_ICONS[lb.type] || '📋'}</span>
                  <span className="text-xs font-bold text-[#151c27]">{lb.label}</span>
                </div>
                <span className="text-xs font-bold text-[#464555]">{lb.used} / {lb.total}</span>
              </div>
              <div className="h-1.5 bg-[#f0f3ff] rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: lb.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── HR Insights Row ────────────────────────────────────────────────────────────
function HRInsightsRow({ d, culture, navigate }) {
  const lateToday = d?.lateToday ?? 0;
  const birthdayCount = (culture?.birthdaysToday?.length ?? 0) + (culture?.upcomingBirthdays?.length ?? 0);

  const insights = [
    {
      icon: lateToday === 0 ? <ShieldCheck size={16} className="text-emerald-600" /> : <AlertCircle size={16} className="text-amber-500" />,
      bg: lateToday === 0 ? 'bg-emerald-50' : 'bg-amber-50',
      title: lateToday === 0 ? 'No attendance issues today' : `${lateToday} late arrival${lateToday > 1 ? 's' : ''} today`,
      subtitle: lateToday === 0 ? 'Great job! Everything looks good.' : 'Review attendance records.',
      onClick: () => navigate('/calendar'),
    },
    {
      icon: <Gift size={16} className="text-pink-500" />,
      bg: 'bg-pink-50',
      title: birthdayCount > 0 ? `${birthdayCount} birthday${birthdayCount > 1 ? 's' : ''} coming up` : 'No upcoming birthdays',
      subtitle: birthdayCount > 0 ? 'Send wishes to your team' : 'No birthdays in next 30 days.',
      onClick: () => navigate('/employees?filter=birthday&include_inactive=false'),
    },
    {
      icon: <FileText size={16} className="text-blue-500" />,
      bg: 'bg-blue-50',
      title: 'Document management',
      subtitle: 'Review employee documents.',
      onClick: () => navigate('/documents'),
    },
    {
      icon: <Users size={16} className="text-purple-500" />,
      bg: 'bg-purple-50',
      title: 'Team overview',
      subtitle: 'View all employees and status.',
      onClick: () => navigate('/employees'),
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
        <h2 className="text-sm font-black text-[#151c27]">HR Insights</h2>
        <button onClick={() => navigate('/reports')}
          className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
          View Reports →
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#e7eefe]">
        {insights.map((ins, i) => (
          <button key={i} onClick={ins.onClick}
            className="flex items-start gap-3 px-5 py-4 text-left hover:bg-[#fafaff] transition-colors">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ins.bg}`}>
              {ins.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#151c27] leading-tight">{ins.title}</p>
              <p className="text-[0.62rem] text-[#777587] mt-0.5">{ins.subtitle}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user, isAdmin } = useAuth();
  const toast    = useToast();
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [dashDate, setDashDate]   = useState('');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [attModal, setAttModal] = useState(null);

  const qs = dashDate ? { date: dashDate } : {};
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard', dashDate, selectedBranchId],
    queryFn: async () => {
      const [d, culture] = await Promise.all([
        apiGet('/dashboard', qs),
        apiGet('/culture').catch(() => ({ birthdaysToday: [], upcomingBirthdays: [], holidays: [], events: [] })),
      ]);
      return { d, culture };
    },
    retry: 1,
  });
  // ENH_DASH_004: compute how long ago data was updated
  const lastUpdatedLabel = dataUpdatedAt ? (() => {
    const diff = Math.floor((Date.now() - dataUpdatedAt) / 60000);
    if (diff < 1) return 'just now';
    if (diff === 1) return '1 min ago';
    return `${diff} min ago`;
  })() : null;

  const { data: analytics } = useQuery({
    queryKey: ['analytics'],
    queryFn: () => apiGet('/analytics').catch(() => null),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const { data: announcements } = useQuery({
    queryKey: ['announcements-dash'],
    queryFn: () => apiGet('/announcements').catch(() => []),
    staleTime: 5 * 60 * 1000,
  });

  // HR Work Items — onboarding in-progress + exit clearances pending
  const { data: onboardingOverview = [] } = useQuery({
    queryKey: ['onboarding-overview-dash'],
    queryFn:  () => apiGet('/onboarding/overview').catch(() => []),
    enabled:  isAdmin,
    staleTime: 3 * 60 * 1000,
  });
  const { data: exitRequestsDash = [] } = useQuery({
    queryKey: ['exit-requests-dash'],
    queryFn:  () => apiGet('/exit').catch(() => []),
    enabled:  isAdmin,
    staleTime: 3 * 60 * 1000,
  });

  const { d, culture } = data || {};
  const isToday = d?.isToday ?? true;
  const now = new Date();
  const weekNum = getWeekNumber(now);
  const season  = getSeason(now.getMonth());
  const displayDate = d?.today
    ? new Date(d.today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  async function handleApprove(id) {
    try { await apiPut(`/leaves/${id}/approve`, {}); toast('Leave approved', 'success'); refetch(); }
    catch (err) { toast(err.message, 'error'); }
  }
  async function handleReject(id) {
    try { await apiPut(`/leaves/${id}/reject`, {}); toast('Leave rejected', 'warning'); refetch(); }
    catch (err) { toast(err.message, 'error'); }
  }

  if (isLoading) return <div className="loading"><span className="spinner" /> Loading…</div>;
  if (isError) return (
    <div className="card p-8 text-center">
      <div className="text-rose-600 font-bold mb-2">Dashboard failed to load</div>
      <div className="text-sm text-[#777587] mb-4">{error?.message}</div>
      <button className="btn btn-primary btn-sm" onClick={() => refetch()}>Retry</button>
    </div>
  );

  const total   = d?.totalEmployees ?? 0;
  const present = d?.presentToday   ?? 0;
  const onLeave = d?.onLeaveToday   ?? 0;
  const wfh     = d?.wfhToday       ?? 0;
  const checked = d?.checkedInToday ?? 0;
  const pending = d?.pendingLeaves  ?? 0;
  const newThis = d?.newThisMonth   ?? 0;

  const pct = v => total > 0 ? `${Math.round((v / total) * 100)}% of total` : '0% of total';

  // Work Items — derived counts for admin action prompts
  const onboardingPending = onboardingOverview.filter(e => e.completed < e.total).length;
  const exitClearancePending = exitRequestsDash.filter(r =>
    r.status === 'approved' &&
    [r.clearance_it, r.clearance_hr, r.clearance_finance, r.clearance_admin].filter(Boolean).length < 4
  ).length;

  const kpiCards = [
    {
      label: 'Total Employees', value: total,
      hint: newThis > 0 ? `↑${newThis} this month` : 'No new this month', hintGreen: newThis > 0,
      icon: <Users size={18} />, iconBg: 'bg-[#eef0ff]', iconColor: 'text-[#3525cd]',
      onClick: () => navigate('/employees'),
    },
    {
      label: 'Present Today', value: present, hint: pct(present), hintGreen: false,
      icon: <UserCheck size={18} />, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600',
      onClick: () => setAttModal({ date: todayStr(), filter: 'present' }),
    },
    {
      label: 'On Leave', value: onLeave, hint: pct(onLeave), hintGreen: false,
      icon: <Umbrella size={18} />, iconBg: 'bg-amber-50', iconColor: 'text-amber-600',
      onClick: () => setAttModal({ date: todayStr(), filter: 'on_leave' }),
    },
    {
      label: 'WFH Today', value: wfh, hint: pct(wfh), hintGreen: false,
      icon: <Home size={18} />, iconBg: 'bg-sky-50', iconColor: 'text-sky-600',
      onClick: () => setAttModal({ date: todayStr(), filter: 'wfh' }),
    },
    {
      label: 'Checked In', value: checked, hint: pct(checked), hintGreen: false,
      icon: <Clock size={18} />, iconBg: 'bg-teal-50', iconColor: 'text-teal-600',
      onClick: () => setAttModal({ date: todayStr(), filter: 'present' }),
    },
    {
      label: 'Pending Approvals', value: pending,
      hint: pending === 0 ? 'No pending' : 'Needs attention', hintGreen: false, alert: pending > 0,
      icon: <ClipboardList size={18} />, iconBg: pending > 0 ? 'bg-rose-50' : 'bg-slate-50', iconColor: pending > 0 ? 'text-rose-500' : 'text-slate-400',
      onClick: () => {
        if (pending === 0) { toast('No pending approvals at this time.', 'info'); return; }
        navigate('/pending-approvals');
      },
    },
  ];

  const { birthdaysToday = [], upcomingBirthdays = [], holidays = [] } = culture || {};

  const quickActions = [
    { label: 'Add Employee',     icon: <UserPlus size={15} />,     color: 'text-[#3525cd] bg-[#eef0ff]',    onClick: () => navigate('/employees?action=add') },
    { label: 'Apply Leave',      icon: <Umbrella size={15} />,     color: 'text-emerald-600 bg-emerald-50', onClick: () => navigate('/leaves') },
    { label: 'Mark Attendance',  icon: <UserCheck size={15} />,    color: 'text-amber-600 bg-amber-50',     onClick: () => navigate('/calendar') },
    { label: 'Regularization',   icon: <Pencil size={15} />,       color: 'text-orange-600 bg-orange-50',   onClick: () => navigate('/regularization') },
    { label: 'Announcement',     icon: <Megaphone size={15} />,    color: 'text-purple-600 bg-purple-50',   onClick: () => navigate('/announcements') },
    { label: 'View Reports',     icon: <BarChart2 size={15} />,    color: 'text-sky-600 bg-sky-50',         onClick: () => navigate('/reports') },
    { label: 'Assign Shift',     icon: <Clock size={15} />,        color: 'text-indigo-600 bg-indigo-50',   onClick: () => navigate('/shifts') },
    { label: 'Manage Holidays',  icon: <CalendarDays size={15} />, color: 'text-rose-600 bg-rose-50',       onClick: () => navigate('/holidays') },
    { label: 'Document Manager', icon: <FolderOpen size={15} />,   color: 'text-teal-600 bg-teal-50',       onClick: () => navigate('/documents') },
  ];

  return (
    <div className="space-y-5">

      {/* ─── HERO ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl relative overflow-hidden shadow-md"
        style={{ background: 'linear-gradient(135deg, #1e1b5e 0%, #3525cd 45%, #6d28d9 80%, #9333ea 100%)' }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(circle at 85% 30%, rgba(255,255,255,.13) 0%, transparent 45%), radial-gradient(circle at 15% 70%, rgba(109,40,217,.4) 0%, transparent 50%)' }} />
        <div className="relative px-7 pt-6 pb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-xl font-black text-white tracking-tight">
                {getGreeting()}, {user?.name?.split(' ')[0]}!
              </h1>
              <p className="text-white/65 text-sm mt-1">Here's what's happening in your organization today.{lastUpdatedLabel && <span className="ml-2 text-white/40 text-xs">· Updated {lastUpdatedLabel}</span>}</p>
            </div>
            {dashDate && (
              <button className="flex items-center gap-1.5 text-white text-xs font-bold px-3 py-1.5 rounded-xl shrink-0"
                style={{ background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.3)' }}
                onClick={() => setDashDate('')}>
                <RefreshCw size={12} /> Back to Today
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-white/10 flex-wrap">
            <span className="flex items-center gap-1.5 text-white/70 text-[0.72rem] font-semibold bg-white/10 px-2.5 py-1 rounded-lg">
              <CalendarDays size={11} /> {displayDate}
            </span>
            <span className="text-white/70 text-[0.72rem] font-semibold bg-white/10 px-2.5 py-1 rounded-lg">
              📅 Week {weekNum}
            </span>
            <span className="text-white/70 text-[0.72rem] font-semibold bg-white/10 px-2.5 py-1 rounded-lg">
              ✨ {season}
            </span>
            {/* ENH_DASH_007: Quick-select date range presets */}
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              {[
                { label: 'Yesterday', days: -1 },
                { label: 'Last Week', days: -7 },
              ].map(p => (
                <button key={p.label} onClick={() => {
                  const d = new Date(); d.setDate(d.getDate() + p.days);
                  setDashDate(d.toISOString().split('T')[0]);
                }} className="text-white/70 text-[0.65rem] font-bold bg-white/10 px-2 py-1 rounded-lg border border-white/20 hover:bg-white/20 transition-colors whitespace-nowrap">
                  {p.label}
                </button>
              ))}
              <label className="flex items-center gap-1.5 text-white/70 text-[0.72rem] font-semibold bg-white/10 px-2.5 py-1 rounded-lg border border-white/20 cursor-pointer hover:bg-white/20 transition-colors"
                title="View attendance for a specific date">
                <CalendarDays size={11} className="shrink-0" />
                <span className="hidden sm:inline">Jump to date</span>
                <input type="date" className="bg-transparent text-white text-[0.72rem] font-semibold cursor-pointer outline-none w-28"
                  style={{ colorScheme: 'dark' }}
                  value={dashDate} max={todayStr()} onChange={e => setDashDate(e.target.value)} />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 6 KPI CARDS ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map((card, i) => (
          <div key={i} onClick={card.onClick}
            className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 cursor-pointer transition-all duration-200 hover:shadow-md hover:border-[#3525cd]/30 hover:-translate-y-0.5 group">
            <div className="flex items-center gap-3 mb-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${card.iconBg} ${card.iconColor}`}>
                {card.icon}
              </div>
              {card.alert && <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse ml-auto flex-shrink-0" />}
            </div>
            <p className="text-2xl font-black text-[#151c27] leading-tight">{card.value}</p>
            <p className="text-[0.7rem] text-[#777587] mt-0.5 font-medium leading-tight">{card.label}</p>
            {card.hint && (
              <p className={`text-[0.62rem] mt-1 font-semibold ${card.alert ? 'text-rose-500' : card.hintGreen ? 'text-emerald-600' : 'text-[#9ca3af]'}`}>
                {card.hint}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ─── HR INSIGHTS ─────────────────────────────────────────────────── */}
      {isAdmin && <HRInsightsRow d={d} culture={culture} navigate={navigate} />}

      {/* ─── PENDING WORK ITEMS — actionable, admin-only, conditional ────── */}
      {isAdmin && (onboardingPending > 0 || exitClearancePending > 0) && (
        <div className={`grid gap-3 ${onboardingPending > 0 && exitClearancePending > 0 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
          {onboardingPending > 0 && (
            <button onClick={() => navigate('/onboarding')}
              className="flex items-center gap-3 bg-white border border-amber-200 rounded-xl px-5 py-3.5 text-left hover:border-amber-400 hover:shadow-sm transition-all group">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <UserPlus size={18} className="text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-[#151c27]">
                  {onboardingPending} Onboarding{onboardingPending > 1 ? 's' : ''} in Progress
                </p>
                <p className="text-xs text-[#777587] mt-0.5">
                  {onboardingPending === 1 ? '1 employee has' : `${onboardingPending} employees have`} incomplete onboarding tasks
                </p>
              </div>
              <ChevronRight size={15} className="text-[#c7c4d8] group-hover:text-amber-500 shrink-0 transition-colors" />
            </button>
          )}
          {exitClearancePending > 0 && (
            <button onClick={() => navigate('/exit-management')}
              className="flex items-center gap-3 bg-white border border-rose-200 rounded-xl px-5 py-3.5 text-left hover:border-rose-400 hover:shadow-sm transition-all group">
              <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
                <LogOut size={18} className="text-rose-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-[#151c27]">
                  {exitClearancePending} Exit Clearance{exitClearancePending > 1 ? 's' : ''} Pending
                </p>
                <p className="text-xs text-[#777587] mt-0.5">
                  Approved resignation{exitClearancePending > 1 ? 's' : ''} with incomplete IT / finance clearance
                </p>
              </div>
              <ChevronRight size={15} className="text-[#c7c4d8] group-hover:text-rose-500 shrink-0 transition-colors" />
            </button>
          )}
        </div>
      )}

      {/* ─── LIVE ATTENDANCE | TREND | LEAVE REQUESTS ──────────────────── */}
      <div className="grid lg:grid-cols-[1fr_300px_280px] gap-4">

        {/* Live Attendance */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <div>
              <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
                {isToday ? <Activity size={14} className="text-[#3525cd]" /> : <BarChart2 size={14} className="text-[#3525cd]" />}
                {isToday ? 'Live Attendance' : 'Attendance'}
              </h2>
              <p className="text-[0.62rem] text-[#9ca3af] mt-0.5">
                {isToday ? `Today · ${displayDate}` : displayDate}
              </p>
            </div>
            <button onClick={() => navigate('/calendar')}
              className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
              View all
            </button>
          </div>
          <div className="flex-1 divide-y divide-[#f9f9ff] overflow-y-auto" style={{ maxHeight: 300 }}>
            {(d?.recentActivity || []).length === 0 ? (
              <div className="py-12 text-center">
                <Inbox size={32} className="mx-auto mb-2 text-[#c7c4d8]" />
                <p className="text-sm text-[#777587]">No activity recorded today</p>
              </div>
            ) : (d?.recentActivity || []).map(r => (
              <div key={r.id || r.name} className="flex items-center gap-3 px-5 py-2.5 hover:bg-[#fafaff] cursor-pointer transition-colors"
                onClick={() => setSelectedEmp(r)}>
                <Avatar name={r.name} color={r.avatar_color} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[#151c27] truncate">{r.name}</div>
                  <div className="text-[0.6rem] text-[#9ca3af] truncate">{r.department}</div>
                </div>
                <StatusBadge status={r.status} />
                <div className="text-right shrink-0 ml-1">
                  {r.check_in && <div className="text-[0.65rem] font-bold text-[#151c27]">{fmtTime(r.check_in)}</div>}
                  {r.check_in && <div className="text-[0.58rem] text-[#9ca3af]">{r.is_late ? 'Late' : 'On time'}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-[#e7eefe]">
            <button onClick={() => navigate('/calendar')}
              className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] flex items-center gap-1 transition-colors">
              View full attendance <ChevronRight size={13} />
            </button>
          </div>
        </div>

        {/* Attendance Trend */}
        {isAdmin && analytics
          ? <AttendanceTrendChart analytics={analytics} navigate={navigate} />
          : <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm flex items-center justify-center text-sm text-[#9ca3af] p-6 text-center">
              Attendance trend available for admins
            </div>
        }

        {/* Leave Requests */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <div>
              <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
                <ClipboardList size={14} className="text-amber-500" />
                {isAdmin ? 'Leave Requests' : 'My Leaves'}
              </h2>
              {isAdmin && <p className="text-[0.62rem] text-[#9ca3af] mt-0.5">Pending approval</p>}
            </div>
            <button onClick={() => navigate('/leaves?status=pending')}
              className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
              View all
            </button>
          </div>
          <div className="flex-1 divide-y divide-[#f0f3ff] overflow-y-auto" style={{ maxHeight: 300 }}>
            {(d?.pendingLeaveList || []).length === 0 ? (
              <div className="py-10 text-center px-4">
                <div className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 size={18} className="text-emerald-500" />
                </div>
                <p className="text-xs font-semibold text-[#151c27]">No pending requests</p>
                <p className="text-[0.62rem] text-[#777587] mt-1">All leave requests have been reviewed.</p>
              </div>
            ) : (d?.pendingLeaveList || []).map(l => (
              <div key={l.id} className="flex items-start gap-2.5 px-4 py-3 hover:bg-[#fafaff] cursor-pointer transition-colors"
                onClick={() => navigate('/leaves?status=pending')}>
                <Avatar name={l.name} color={l.avatar_color} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-[#151c27]">{l.name}</div>
                  <div className="text-[0.6rem] text-[#9ca3af] mt-0.5">{fmtDateRange(l.start_date, l.end_date)}</div>
                  <LeaveTypeBadge type={l.leave_type} />
                  {isAdmin && l.status === 'pending' && (
                    <div className="flex gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
                      <button className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[0.6rem] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all"
                        onClick={() => handleApprove(l.id)}>
                        <CheckCircle2 size={9} /> Approve
                      </button>
                      <button className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[0.6rem] font-bold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-all"
                        onClick={() => handleReject(l.id)}>
                        <X size={9} /> Reject
                      </button>
                    </div>
                  )}
                  {isAdmin && l.status === 'pending_root' && user?.role === 'root_admin' && (
                    <div className="flex gap-1 mt-1.5" onClick={e => e.stopPropagation()}>
                      <button className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[0.6rem] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all"
                        onClick={() => handleApprove(l.id)}>
                        <CheckCircle2 size={9} /> Approve
                      </button>
                      <button className="flex items-center gap-0.5 px-2 py-0.5 rounded text-[0.6rem] font-bold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-all"
                        onClick={() => handleReject(l.id)}>
                        <X size={9} /> Reject
                      </button>
                    </div>
                  )}
                  {isAdmin && l.status === 'pending_root' && user?.role !== 'root_admin' && (
                    <span className="inline-block mt-1.5 text-[0.58rem] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-1.5 py-0.5 rounded">
                      Awaiting Root Admin
                    </span>
                  )}
                  {isAdmin && l.status === 'pending_dept' && (
                    <span className="inline-block mt-1.5 text-[0.58rem] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                      Awaiting Dept Head
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── ORG OVERVIEW | LEAVE BALANCE | QUICK ACTIONS ──────────────── */}
      {isAdmin && analytics && (
        <div className="grid lg:grid-cols-[1fr_1fr_280px] gap-4">
          <OrgOverviewSection analytics={analytics} navigate={navigate} />
          <LeaveBalanceSection analytics={analytics} navigate={navigate} />

          {/* Quick Actions — 3×3 grid */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#e7eefe]">
              <h2 className="text-sm font-black text-[#151c27]">Quick Actions</h2>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2.5">
              {quickActions.map((action, i) => (
                <button key={i} onClick={action.onClick}
                  className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl border border-[#f0f3ff] hover:border-[#3525cd]/25 hover:shadow-sm hover:-translate-y-0.5 transition-all duration-150 text-center bg-white">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${action.color}`}>{action.icon}</div>
                  <span className="text-[0.58rem] font-bold text-[#464555] leading-tight">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── UPCOMING HOLIDAYS | ANNOUNCEMENTS | BIRTHDAYS ──────────────── */}
      <div className="grid lg:grid-cols-[1fr_1fr_280px] gap-4">

        {/* Upcoming Holidays — vertical list */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
              <CalendarDays size={14} className="text-[#3525cd]" /> Upcoming Holidays
            </h2>
            {isAdmin && <ManageHolidaysBtn onRefresh={refetch} />}
          </div>
          {holidays.length === 0 ? (
            <div className="py-8 text-center flex-1 flex flex-col items-center justify-center gap-2">
              <CalendarDays size={24} className="text-[#c7c4d8]" />
              <p className="text-sm text-[#777587]">No holidays in the next 30 days</p>
            </div>
          ) : (
            <div className="flex-1 divide-y divide-[#f9f9ff]">
              {holidays.slice(0, 5).map(h => (
                <div key={h.id} onClick={() => navigate('/holidays')}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-[#fafaff] transition-colors cursor-pointer">
                  <div className="w-8 h-8 rounded-lg bg-[#eef0ff] flex items-center justify-center shrink-0 text-base">🗓️</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#151c27] truncate">{h.name}</p>
                    <p className="text-[0.6rem] text-[#9ca3af] mt-0.5">{fmtDate(h.date)}</p>
                  </div>
                  <span className={`text-[0.6rem] font-bold px-2 py-0.5 rounded-full capitalize shrink-0 ${
                    h.type === 'public' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}>{h.type}</span>
                </div>
              ))}
            </div>
          )}
          <div className="px-5 py-3 border-t border-[#f0f3ff] mt-auto">
            <button onClick={() => navigate('/holidays')}
              className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] flex items-center gap-1 transition-colors">
              See holiday calendar <ChevronRight size={12} />
            </button>
          </div>
        </div>

        {/* Announcements — vertical */}

          {/* Announcements */}
          <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
              <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
                <Megaphone size={14} className="text-[#3525cd]" /> Announcements
              </h2>
              <button onClick={() => navigate('/announcements')}
                className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
                View all
              </button>
            </div>
            <div className="p-5">
              {!(announcements || []).length ? (
                <div className="py-8 flex flex-col items-center text-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-[#f0f3ff] flex items-center justify-center text-2xl">📢</div>
                  <div>
                    <p className="text-sm font-semibold text-[#464555]">No announcements yet</p>
                    <p className="text-xs text-[#9ca3af] mt-0.5">Post an announcement to keep your team informed.</p>
                  </div>
                  {isAdmin && (
                    <button onClick={() => navigate('/announcements')}
                      className="text-xs font-bold text-[#3525cd] border border-[#c7c4d8] rounded-xl px-4 py-2 hover:bg-[#f0f3ff] transition-colors">
                      Post Announcement
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {(announcements || []).slice(0, 3).map(a => (
                    <div key={a.id} className="flex items-start gap-3 cursor-pointer hover:bg-[#fafaff] -mx-2 px-2 py-2 rounded-xl transition-colors"
                      onClick={() => navigate('/announcements')}>
                      <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center shrink-0">
                        <Megaphone size={13} className="text-[#3525cd]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-[#151c27] truncate">{a.title}</p>
                        <p className="text-[0.6rem] text-[#9ca3af] mt-0.5">{relTime(a.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        {/* Right column: Upcoming Birthdays */}
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
              <Cake size={14} className="text-pink-500" /> Upcoming Birthdays
            </h2>
            {isAdmin && <ManageBirthdaysBtn onRefresh={refetch} />}
          </div>
          <div className="p-4">
            {(birthdaysToday.length + upcomingBirthdays.length) === 0 ? (
              <div className="py-6 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center text-xl">🎁</div>
                <p className="text-xs text-[#777587]">No birthdays in the next 30 days</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {birthdaysToday.map(u => (
                  <div key={u.id} onClick={() => navigate(`/employees?search=${encodeURIComponent(u.name)}`)}
                    className="flex items-center gap-3 p-2.5 rounded-xl bg-pink-50 border border-pink-100 cursor-pointer hover:bg-pink-100 transition-colors">
                    <Avatar name={u.name} color={u.avatar_color} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-[#151c27] truncate">{u.name} 🎂</p>
                      <p className="text-[0.6rem] text-pink-500 font-semibold">Birthday today!</p>
                    </div>
                  </div>
                ))}
                {upcomingBirthdays.slice(0, 5).map(u => (
                  <div key={u.id + u.birthday_date} onClick={() => navigate(`/employees?search=${encodeURIComponent(u.name)}`)}
                    className="flex items-center gap-3 cursor-pointer hover:bg-[#fafaff] -mx-1 px-1 py-1.5 rounded-lg transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-pink-50 border border-pink-100 flex items-center justify-center text-base shrink-0">🎂</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-[#151c27] truncate">{u.name}</p>
                      <p className="text-[0.6rem] text-[#777587]">In {u.days_until} day{u.days_until !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── NEW JOINERS — horizontal scroll ────────────────────────────── */}
      {(d?.newJoiners || []).length > 0 && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
            <h2 className="text-sm font-black text-[#151c27] flex items-center gap-2">
              <UserPlus size={14} className="text-emerald-500" /> New Joiners
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-[0.65rem] text-[#9ca3af] font-medium">Last 7 days</span>
              <button onClick={() => navigate('/employees')}
                className="text-xs font-bold text-[#3525cd] hover:text-[#4f46e5] px-2 py-1 rounded-lg hover:bg-[#f0f3ff] transition-colors">
                View all
              </button>
            </div>
          </div>
          <div className="flex gap-3 px-5 py-4 overflow-x-auto scrollbar-hide">
            {(d.newJoiners || []).map(e => {
              const daysAgo = Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86400000);
              return (
                <div key={e.id} onClick={() => navigate('/employees')}
                  className="flex flex-col items-center gap-2 min-w-[110px] p-3 rounded-xl border border-[#f0f3ff] hover:border-[#c7c4d8] hover:bg-[#fafaff] transition-colors cursor-pointer shrink-0 text-center">
                  <Avatar name={e.name} color={e.avatar_color} size={40} />
                  <div>
                    <p className="text-[0.72rem] font-bold text-[#151c27] leading-tight">{e.name}</p>
                    <p className="text-[0.58rem] text-[#777587] mt-0.5 leading-tight">{e.position || 'Staff'} · {e.department || '—'}</p>
                  </div>
                  <span className="text-[0.58rem] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {daysAgo === 0 ? 'Today' : `${daysAgo}d ago`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      {selectedEmp && <EmployeeQuickView record={selectedEmp} onClose={() => setSelectedEmp(null)} />}
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
