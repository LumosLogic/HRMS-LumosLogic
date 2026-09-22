import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, XCircle, Building2, Activity, PlusCircle,
  RefreshCw, UserPlus, UserMinus, Globe, Trash2,
} from 'lucide-react';
import { paGet } from '@/lib/platformApi';

const EVENT_META = {
  org_request_submitted: { icon: <Building2 size={14} />,   color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',   label: 'Request Submitted' },
  org_approved:          { icon: <CheckCircle2 size={14} />, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Org Approved' },
  org_rejected:          { icon: <XCircle size={14} />,      color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',    label: 'Org Rejected' },
  org_created:           { icon: <PlusCircle size={14} />,   color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Org Created' },
  org_deleted:           { icon: <Trash2 size={14} />,       color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',    label: 'Org Deleted' },
  member_added:          { icon: <UserPlus size={14} />,     color: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Member Added' },
  member_removed:        { icon: <UserMinus size={14} />,    color: '#ef4444', bg: 'bg-rose-50',    border: 'border-rose-200',    label: 'Member Removed' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
  });
}

export default function PlatformActivityPlatform() {
  const { data: events = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['platform-logs'],
    queryFn: () => paGet('/activity', { limit: 100 }),
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#151c27] tracking-tight">Platform Logs</h1>
          <p className="text-sm text-[#464555] mt-0.5">
            Organization requests, approvals, rejections and platform-level events
          </p>
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
            <Globe size={28} className="text-[#3525cd]/40" />
          </div>
          <p className="text-[#464555] font-bold">No platform events yet</p>
          <p className="text-[#777587] text-sm mt-1">Platform events will appear here as they happen</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e7eefe] overflow-hidden">
          <div className="flex flex-wrap gap-3 px-5 py-3.5 border-b border-[#f0f3ff] bg-[#f9f9ff]">
            {Object.entries(EVENT_META).map(([key, m]) => (
              <div key={key} className="flex items-center gap-1.5">
                <div className={`w-5 h-5 rounded-lg border flex items-center justify-center ${m.bg} ${m.border}`}
                  style={{ color: m.color }}>
                  {m.icon}
                </div>
                <span className="text-[0.65rem] text-[#777587] font-semibold">{m.label}</span>
              </div>
            ))}
          </div>
          <div className="relative">
            <div className="absolute left-[2.75rem] top-0 bottom-0 w-px bg-[#f0f3ff]" />
            <div className="divide-y divide-[#f0f3ff]">
              {events.map(ev => {
                const meta = EVENT_META[ev.event_type] || {
                  icon: <Activity size={14} />, color: '#777587',
                  bg: 'bg-[#f0f3ff]', border: 'border-[#c7c4d8]', label: ev.event_type,
                };
                return (
                  <div key={ev.id} className="flex gap-4 px-5 py-4 hover:bg-[#f9f9ff] transition-colors">
                    <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border ${meta.bg} ${meta.border}`}
                      style={{ color: meta.color }}>
                      {meta.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#151c27]">{ev.description}</p>
                      {ev.metadata && (
                        <div className="flex flex-wrap gap-2 mt-1.5">
                          {ev.metadata.company && (
                            <span className="text-xs px-2 py-0.5 rounded-lg text-[#464555] bg-[#f0f3ff] border border-[#e7eefe] font-mono">{ev.metadata.company}</span>
                          )}
                          {ev.metadata.email && (
                            <span className="text-xs px-2 py-0.5 rounded-lg text-[#464555] bg-[#f0f3ff] border border-[#e7eefe]">{ev.metadata.email}</span>
                          )}
                          {ev.metadata.org_id && (
                            <span className="text-xs px-2 py-0.5 rounded-lg text-[#464555] bg-[#f0f3ff] border border-[#e7eefe]">org #{ev.metadata.org_id}</span>
                          )}
                        </div>
                      )}
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
