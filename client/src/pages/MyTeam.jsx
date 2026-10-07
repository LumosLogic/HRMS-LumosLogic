import React, { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Users, Clock, FileText, ClipboardList, Target, Search } from 'lucide-react';
import { useTeamMe, useTeamData } from '@/hooks/useTeam';
import { Avatar } from '@/components/ui/Avatar';
import { EmployeeLink } from '@/lib/employeeLink';
import { fmtDate, fmtTime, todayStr } from '@/lib/utils';

const TABS = [
  { id: 'members',        label: 'Members',        perm: 'view',           Icon: Users },
  { id: 'attendance',     label: 'Attendance',     perm: 'attendance',     Icon: Clock },
  { id: 'leaves',         label: 'Leaves',         perm: 'leaves',         Icon: FileText },
  { id: 'regularization', label: 'Regularization', perm: 'regularization', Icon: ClipboardList },
  { id: 'performance',    label: 'Performance',    perm: 'performance',    Icon: Target },
];

const STATUS_CLS = {
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  rejected: 'bg-rose-50 text-rose-700 border-rose-200',
  present: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  absent: 'bg-rose-50 text-rose-700 border-rose-200',
  half_day: 'bg-amber-50 text-amber-700 border-amber-200',
  wfh: 'bg-blue-50 text-blue-700 border-blue-200',
};
const Pill = ({ value }) => (
  <span className={`inline-block px-2 py-0.5 rounded-full border text-[0.68rem] font-bold capitalize ${STATUS_CLS[value] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
    {String(value || '—').replace(/_/g, ' ')}
  </span>
);

function Person({ id, name, color, sub }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Avatar name={name} color={color || '#3525cd'} size={30} />
      <div className="min-w-0">
        <EmployeeLink id={id} team className="text-sm font-bold text-[#151c27] truncate block">{name || '—'}</EmployeeLink>
        {sub && <p className="text-[0.7rem] text-[#777587] truncate">{sub}</p>}
      </div>
    </div>
  );
}

function Table({ head, rows, empty, loading }) {
  if (loading) return <div className="p-8 text-center text-sm text-[#777587]">Loading…</div>;
  if (!rows.length) return <div className="p-8 text-center text-sm text-[#777587]">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[0.68rem] uppercase tracking-wider text-[#777587] border-b border-[#e7eefe]">
            {head.map(h => <th key={h} className="px-4 py-2.5 font-black">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f0f3ff]">{rows}</tbody>
      </table>
    </div>
  );
}

export default function MyTeam() {
  const { data: me, isLoading } = useTeamMe();
  const tabs = TABS.filter(t => me?.can?.[t.perm]);
  const [tab, setTab] = useState(null);
  const active = tab && tabs.some(t => t.id === tab) ? tab : tabs[0]?.id;

  const [date, setDate] = useState(todayStr());
  const [q, setQ] = useState('');

  const members = useTeamData('members', {}, { enabled: active === 'members' });
  const attendance = useTeamData('attendance', { date }, { enabled: active === 'attendance' });
  const leaves = useTeamData('leaves', {}, { enabled: active === 'leaves' });
  const regs = useTeamData('regularization', {}, { enabled: active === 'regularization' });
  const perf = useTeamData('performance', {}, { enabled: active === 'performance' });

  const match = useMemo(() => {
    const s = q.trim().toLowerCase();
    return name => !s || String(name || '').toLowerCase().includes(s);
  }, [q]);

  if (isLoading) return <div className="p-8 text-center text-sm text-[#777587]">Loading…</div>;
  if (!me?.hasTeam) return <Navigate to="/portal/home" replace />;

  const heading = [me.isManager && 'Manager', me.isHod && 'Head of Department'].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-black text-[#151c27] tracking-tight">My Team</h1>
        <p className="text-sm text-[#464555]">{heading} · {me.memberCount} {me.memberCount === 1 ? 'person' : 'people'} in your scope</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-[#e7eefe]">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-bold border-b-2 -mb-px transition-colors ${active === id ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-[#777587] hover:text-[#151c27]'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
        <div className="ml-auto relative pb-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#777587]" />
          <input className="form-control pl-8 py-1.5 text-sm w-48" placeholder="Search name…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>

      <div className="bg-white border border-[#c7c4d8] rounded-2xl overflow-hidden">
        {active === 'members' && (
          <Table loading={members.isLoading} head={['Employee', 'Department', 'Position', 'Status', 'Relation']} empty="No team members."
            rows={(members.data || []).filter(m => match(m.name)).map(m => (
              <tr key={m.id}>
                <td className="px-4 py-2.5"><Person id={m.id} name={m.name} color={m.avatar_color} sub={m.email} /></td>
                <td className="px-4 py-2.5">{m.department || '—'}</td>
                <td className="px-4 py-2.5">{m.position || '—'}</td>
                <td className="px-4 py-2.5"><Pill value={m.employee_status || 'active'} /></td>
                <td className="px-4 py-2.5 text-xs text-[#464555]">{m.relation.map(r => (r === 'direct_report' ? 'Direct report' : 'Department')).join(' + ')}</td>
              </tr>
            ))} />
        )}

        {active === 'attendance' && (
          <>
            <div className="px-4 py-3 border-b border-[#e7eefe] flex items-center gap-2">
              <label className="text-xs font-bold text-[#777587]">Date</label>
              <input type="date" className="form-control py-1.5 text-sm w-44" value={date} max={todayStr()} onChange={e => e.target.value && setDate(e.target.value)} />
            </div>
            <Table loading={attendance.isLoading} head={['Employee', 'Check in', 'Check out', 'Hours', 'Status']} empty="No attendance records for this date."
              rows={(attendance.data || []).filter(r => match(r.user_name)).map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5"><Person id={r.user_id} name={r.user_name} color={r.user_avatar_color} sub={r.user_department} /></td>
                  <td className="px-4 py-2.5">{r.check_in ? fmtTime(r.check_in) : '—'}</td>
                  <td className="px-4 py-2.5">{r.check_out ? fmtTime(r.check_out) : '—'}</td>
                  <td className="px-4 py-2.5">{r.work_hours ? Number(r.work_hours).toFixed(1) : '—'}</td>
                  <td className="px-4 py-2.5"><Pill value={r.status} /></td>
                </tr>
              ))} />
          </>
        )}

        {active === 'leaves' && (
          <Table loading={leaves.isLoading} head={['Employee', 'Type', 'From', 'To', 'Status']} empty="No leave requests."
            rows={(leaves.data || []).filter(r => match(r.user_name)).map(r => (
              <tr key={r.id}>
                <td className="px-4 py-2.5"><Person id={r.user_id} name={r.user_name} color={r.user_avatar_color} sub={r.user_department} /></td>
                <td className="px-4 py-2.5 capitalize">{String(r.leave_type || '').replace(/_/g, ' ')}</td>
                <td className="px-4 py-2.5">{fmtDate(r.start_date)}</td>
                <td className="px-4 py-2.5">{fmtDate(r.end_date)}</td>
                <td className="px-4 py-2.5"><Pill value={r.status} /></td>
              </tr>
            ))} />
        )}

        {active === 'regularization' && (
          <Table loading={regs.isLoading} head={['Employee', 'Date', 'Requested in / out', 'Reason', 'Status']} empty="No regularization requests."
            rows={(regs.data || []).filter(r => match(r.user_name)).map(r => (
              <tr key={r.id}>
                <td className="px-4 py-2.5"><Person id={r.user_id} name={r.user_name} color={r.user_avatar_color} sub={r.user_department} /></td>
                <td className="px-4 py-2.5">{fmtDate(r.date)}</td>
                <td className="px-4 py-2.5">{[r.requested_check_in, r.requested_check_out].map(t => (t ? fmtTime(t) : '—')).join(' → ')}</td>
                <td className="px-4 py-2.5 max-w-[16rem] truncate" title={r.reason}>{r.reason || '—'}</td>
                <td className="px-4 py-2.5"><Pill value={r.status} /></td>
              </tr>
            ))} />
        )}

        {active === 'performance' && (
          <Table loading={perf.isLoading} head={['Employee', 'Goal', 'Cycle', 'Progress', 'Status']} empty="No goals."
            rows={(perf.data?.goals || []).filter(r => match(r.user_name)).map(r => (
              <tr key={r.id}>
                <td className="px-4 py-2.5"><Person id={r.user_id} name={r.user_name} color={r.user_avatar_color} sub={r.user_department} /></td>
                <td className="px-4 py-2.5 max-w-[18rem] truncate" title={r.title}>{r.title}</td>
                <td className="px-4 py-2.5">{r.review_cycle || '—'}</td>
                <td className="px-4 py-2.5">{r.progress != null ? `${r.progress}%` : '—'}</td>
                <td className="px-4 py-2.5"><Pill value={r.status} /></td>
              </tr>
            ))} />
        )}
      </div>
    </div>
  );
}
