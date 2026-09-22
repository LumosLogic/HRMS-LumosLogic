import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, RefreshCw, Filter, Layers, LogIn, UserPlus, UserMinus,
  FileText, Calendar, DollarSign, ClipboardList, Settings, Trash2,
  CheckCircle2, XCircle, Edit3, PlusCircle, AlertCircle,
} from 'lucide-react';
import { paGet } from '@/lib/platformApi';

const MODULE_META = {
  // Auth
  login:              { icon: <LogIn size={14} />,        color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Login' },
  logout:             { icon: <LogIn size={14} />,        color: '#777587', bg: 'bg-gray-50',    border: 'border-gray-200',   label: 'Logout' },
  // Users
  user_created:       { icon: <UserPlus size={14} />,     color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'User Created' },
  user_updated:       { icon: <Edit3 size={14} />,        color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'User Updated' },
  user_deleted:       { icon: <UserMinus size={14} />,    color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'User Deleted' },
  // Leaves
  leave_applied:      { icon: <Calendar size={14} />,     color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',  label: 'Leave Applied' },
  leave_approved:     { icon: <CheckCircle2 size={14} />, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Leave Approved' },
  leave_rejected:     { icon: <XCircle size={14} />,      color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Leave Rejected' },
  leave_cancelled:    { icon: <XCircle size={14} />,      color: '#777587', bg: 'bg-gray-50',    border: 'border-gray-200',   label: 'Leave Cancelled' },
  // Attendance
  attendance_marked:  { icon: <ClipboardList size={14} />,color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Attendance' },
  regularization:     { icon: <Edit3 size={14} />,        color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',  label: 'Regularization' },
  // Payroll
  payroll_generated:  { icon: <DollarSign size={14} />,   color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Payroll Generated' },
  payslip_created:    { icon: <FileText size={14} />,     color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Payslip Created' },
  // Documents
  document_uploaded:  { icon: <FileText size={14} />,     color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',  label: 'Document Uploaded' },
  document_deleted:   { icon: <Trash2 size={14} />,       color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Document Deleted' },
  // Settings
  settings_updated:   { icon: <Settings size={14} />,     color: '#777587', bg: 'bg-gray-50',    border: 'border-gray-200',   label: 'Settings Updated' },
  // Generic
  created:            { icon: <PlusCircle size={14} />,   color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Created' },
  updated:            { icon: <Edit3 size={14} />,        color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Updated' },
  deleted:            { icon: <Trash2 size={14} />,       color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Deleted' },
  approved:           { icon: <CheckCircle2 size={14} />, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200',label: 'Approved' },
  rejected:           { icon: <XCircle size={14} />,      color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',   label: 'Rejected' },
};

function getEventMeta(eventType = '') {
  if (MODULE_META[eventType]) return MODULE_META[eventType];
  // Fuzzy match suffix
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

export default function PlatformActivityOrg() {
  const [orgFilter, setOrgFilter] = useState('');

  const { data: orgs = [] } = useQuery({
    queryKey: ['platform-orgs-for-logs'],
    queryFn: () => paGet('/organizations'),
  });

  const { data: events = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['org-specific-logs', orgFilter],
    queryFn: () => paGet('/activity/org-logs', { orgId: orgFilter || undefined, limit: 200 }),
    enabled: true,
    refetchInterval: 30000,
  });

  const selectedOrgName = orgs.find(o => String(o.id) === orgFilter)?.name || '';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#151c27] tracking-tight">Org Specific Logs</h1>
          <p className="text-sm text-[#464555] mt-0.5">
            {orgFilter
              ? `All system activity for ${selectedOrgName}`
              : 'Select an organization to view all its system logs'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-white border border-[#c7c4d8] rounded-xl px-3 py-2">
            <Filter size={13} className="text-[#777587] flex-shrink-0" />
            <select
              value={orgFilter}
              onChange={e => setOrgFilter(e.target.value)}
              className="text-xs font-semibold text-[#151c27] bg-transparent outline-none cursor-pointer min-w-[180px]">
              <option value="">All Organizations</option>
              {orgs.map(o => (
                <option key={o.id} value={String(o.id)}>{o.name}</option>
              ))}
            </select>
          </div>
          {orgFilter && (
            <button onClick={() => setOrgFilter('')}
              className="text-xs font-bold px-3 py-2 rounded-xl border border-[#c7c4d8] bg-white text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-all">
              Clear
            </button>
          )}
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-[#464555] border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-all disabled:opacity-50">
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
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
          <p className="text-[#464555] font-bold">
            {orgFilter ? 'No activity found for this organization' : 'No org activity yet'}
          </p>
          <p className="text-[#777587] text-sm mt-1">
            {orgFilter ? 'Activity will appear here as users interact with the system' : 'Select an organization above to filter logs'}
          </p>
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e7eefe] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f0f3ff] bg-[#f9f9ff]">
            <span className="text-xs font-bold text-[#464555]">{events.length} events</span>
            {!orgFilter && <span className="text-xs text-[#777587]">Showing all organizations</span>}
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
                        {ev.org_name && !orgFilter && (
                          <span className="text-xs px-2 py-0.5 rounded-lg text-[#464555] bg-[#f0f3ff] border border-[#e7eefe]">{ev.org_name}</span>
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
