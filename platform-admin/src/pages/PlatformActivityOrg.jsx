import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, RefreshCw, Layers, LogIn, UserPlus, UserMinus,
  FileText, Calendar, DollarSign, ClipboardList, Trash2,
  CheckCircle2, XCircle, Edit3, PlusCircle, AlertCircle,
  ArrowLeft, Users, Building2, Crown,
} from 'lucide-react';
import { paGet } from '@/lib/platformApi';

const MODULE_META = {
  login:              { icon: <LogIn size={14} />,        color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Login' },
  logout:             { icon: <LogIn size={14} />,        color: '#777587', bg: 'bg-gray-50',    border: 'border-gray-200',   label: 'Logout' },
  user_created:       { icon: <UserPlus size={14} />,     color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'User Created' },
  user_updated:       { icon: <Edit3 size={14} />,        color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'User Updated' },
  user_deleted:       { icon: <UserMinus size={14} />,    color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'User Deleted' },
  leave_applied:      { icon: <Calendar size={14} />,     color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',  label: 'Leave Applied' },
  leave_approved:     { icon: <CheckCircle2 size={14} />, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Leave Approved' },
  leave_rejected:     { icon: <XCircle size={14} />,      color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Leave Rejected' },
  leave_cancelled:    { icon: <XCircle size={14} />,      color: '#777587', bg: 'bg-gray-50',    border: 'border-gray-200',   label: 'Leave Cancelled' },
  attendance_marked:  { icon: <ClipboardList size={14} />,color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Attendance' },
  regularization:     { icon: <Edit3 size={14} />,        color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',  label: 'Regularization' },
  payroll_generated:  { icon: <DollarSign size={14} />,   color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Payroll Generated' },
  payslip_created:    { icon: <FileText size={14} />,     color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Payslip Created' },
  document_uploaded:  { icon: <FileText size={14} />,     color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',  label: 'Document Uploaded' },
  document_deleted:   { icon: <Trash2 size={14} />,       color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Document Deleted' },
  created:            { icon: <PlusCircle size={14} />,   color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Created' },
  updated:            { icon: <Edit3 size={14} />,        color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Updated' },
  deleted:            { icon: <Trash2 size={14} />,       color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Deleted' },
  approved:           { icon: <CheckCircle2 size={14} />, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Approved' },
  rejected:           { icon: <XCircle size={14} />,      color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Rejected' },
};

function getEventMeta(eventType = '') {
  if (MODULE_META[eventType]) return MODULE_META[eventType];
  for (const key of Object.keys(MODULE_META)) {
    if (eventType.endsWith(key) || eventType.includes(key)) return MODULE_META[key];
  }
  return { icon: <AlertCircle size={14} />, color: '#777587', bg: 'bg-gray-50', border: 'border-gray-200', label: eventType };
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

const PLAN_COLORS = {
  free:     { bg: 'bg-gray-100',     text: 'text-gray-600',     label: 'Free' },
  gold:     { bg: 'bg-amber-100',    text: 'text-amber-700',    label: 'Gold' },
  platinum: { bg: 'bg-[#f0f3ff]',   text: 'text-[#3525cd]',    label: 'Platinum' },
};

const STATUS_COLORS = {
  active:   { dot: 'bg-emerald-400', text: 'text-emerald-600' },
  inactive: { dot: 'bg-gray-300',    text: 'text-gray-500' },
  suspended:{ dot: 'bg-rose-400',    text: 'text-rose-600' },
};

function OrgInitials({ name }) {
  const initials = name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';
  const colors = ['#3525cd', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626'];
  const color = colors[(name?.charCodeAt(0) || 0) % colors.length];
  return (
    <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-sm font-black flex-shrink-0"
      style={{ background: color }}>
      {initials}
    </div>
  );
}

function OrgCard({ org, onSelect }) {
  const plan = PLAN_COLORS[org.plan?.toLowerCase()] || PLAN_COLORS.free;
  const status = STATUS_COLORS[org.status?.toLowerCase()] || STATUS_COLORS.active;

  return (
    <div className="bg-white border border-[#e7eefe] rounded-2xl p-5 flex flex-col gap-4 hover:border-[#3525cd]/30 hover:shadow-md transition-all duration-200">
      <div className="flex items-start gap-3">
        <OrgInitials name={org.name} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-black text-[#151c27] truncate">{org.name}</h3>
          <p className="text-xs text-[#777587] mt-0.5 truncate">{org.slug}</p>
        </div>
        <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-lg ${plan.bg} ${plan.text} flex-shrink-0`}>
          {plan.label}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs text-[#777587]">
        <div className="flex items-center gap-1.5">
          <Users size={12} />
          <span>{org.userCount ?? 0} members</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
          <span className={`capitalize font-semibold ${status.text}`}>{org.status || 'active'}</span>
        </div>
      </div>

      <div className="text-[0.68rem] text-[#c7c4d8]">
        Joined {fmtDate(org.created_at)}
      </div>

      <button
        onClick={() => onSelect(org)}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold bg-[#f0f3ff] text-[#3525cd] border border-[#e7eefe] hover:bg-[#3525cd] hover:text-white transition-all duration-150">
        <Activity size={13} />
        See Logs
      </button>
    </div>
  );
}

function OrgLogs({ org, onBack }) {
  const { data: events = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['org-specific-logs', org.id],
    queryFn: () => paGet('/activity/org-logs', { orgId: org.id, limit: 200 }),
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack}
            className="flex items-center gap-1.5 text-xs font-bold text-[#464555] px-3 py-2 rounded-xl border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-all">
            <ArrowLeft size={13} /> Back
          </button>
          <div>
            <div className="flex items-center gap-2">
              <OrgInitials name={org.name} />
              <div>
                <h1 className="text-xl font-black text-[#151c27] tracking-tight">{org.name}</h1>
                <p className="text-xs text-[#777587]">All system activity logs</p>
              </div>
            </div>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-[#464555] border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-all disabled:opacity-50">
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-[#e7eefe] border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && events.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-[#e7eefe]">
          <div className="w-14 h-14 rounded-2xl bg-[#f0f3ff] flex items-center justify-center mx-auto mb-3">
            <Layers size={28} className="text-[#3525cd]/40" />
          </div>
          <p className="text-[#464555] font-bold">No activity found</p>
          <p className="text-[#777587] text-sm mt-1">Activity will appear here as users interact with the system</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e7eefe] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f0f3ff] bg-[#f9f9ff]">
            <span className="text-xs font-bold text-[#464555]">{events.length} events</span>
          </div>
          <div className="relative">
            <div className="absolute left-[2.75rem] top-0 bottom-0 w-px bg-[#f0f3ff]" />
            <div className="divide-y divide-[#f0f3ff]">
              {events.map((ev, i) => {
                const meta = getEventMeta(ev.event_type);
                return (
                  <div key={ev.id ?? i} className="flex gap-4 px-5 py-4 hover:bg-[#f9f9ff] transition-colors">
                    <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border ${meta.bg} ${meta.border}`}
                      style={{ color: meta.color }}>
                      {meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#151c27]">{ev.description}</p>
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {ev.module && (
                          <span className="text-xs px-2 py-0.5 rounded-lg text-[#3525cd] bg-[#f0f3ff] border border-[#e7eefe] font-semibold capitalize">{ev.module}</span>
                        )}
                        {ev.actor_name && (
                          <span className="text-xs px-2 py-0.5 rounded-lg text-[#464555] bg-gray-50 border border-gray-200">{ev.actor_name}</span>
                        )}
                        {ev.metadata?.email && (
                          <span className="text-xs px-2 py-0.5 rounded-lg text-[#464555] bg-[#f0f3ff] border border-[#e7eefe]">{ev.metadata.email}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-xs text-[#c7c4d8] whitespace-nowrap flex-shrink-0 mt-0.5">{fmtDate(ev.created_at)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlatformActivityOrg() {
  const [selectedOrg, setSelectedOrg] = useState(null);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: ['platform-orgs-for-logs'],
    queryFn: () => paGet('/organizations'),
  });

  if (selectedOrg) return <OrgLogs org={selectedOrg} onBack={() => setSelectedOrg(null)} />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-[#151c27] tracking-tight">Org Specific Logs</h1>
        <p className="text-sm text-[#464555] mt-0.5">Select an organization to view all its system logs</p>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-[#e7eefe] border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && orgs.length === 0 && (
        <div className="text-center py-16 bg-white rounded-2xl border border-[#e7eefe]">
          <Building2 size={32} className="text-[#3525cd]/30 mx-auto mb-3" />
          <p className="text-[#464555] font-bold">No organizations found</p>
        </div>
      )}

      {!isLoading && orgs.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {orgs.map(org => (
            <OrgCard key={org.id} org={org} onSelect={setSelectedOrg} />
          ))}
        </div>
      )}
    </div>
  );
}
