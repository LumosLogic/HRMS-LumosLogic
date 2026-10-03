import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, CheckCircle2, Clock, Users, ChevronRight,
  AlertCircle, FileText, Calendar, X, Info,
} from 'lucide-react';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useLeavePolicies } from '@/hooks/useListQueries';
import { useToast } from '@/context/ToastContext';
import { cn } from '@/lib/utils';

const LEAVE_TYPE_LABELS = {
  annual: 'Annual Leave', casual: 'Casual Leave', sick: 'Sick Leave', emergency: 'Emergency Leave',
  maternity: 'Maternity Leave', paternity: 'Paternity Leave', bereavement: 'Bereavement Leave',
  comp_off: 'Comp Off', earned: 'Earned Leave', unpaid: 'Unpaid Leave', other: 'Other Leave',
};
function leaveLabel(type, policyMap = {}) {
  return policyMap[type] || LEAVE_TYPE_LABELS[type] || (type ? type.replace(/_/g, ' ') : 'Leave');
}

function Avatar({ name = '', color }) {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div className="w-9 h-9 rounded-full flex items-center justify-center text-[0.72rem] font-black text-white flex-shrink-0 border-2 border-white shadow-sm"
      style={{ background: color || '#3525cd' }}>
      {initials}
    </div>
  );
}

function RejectModal({ leave, onConfirm, onCancel, loading, policyMap = {} }) {
  const [remarks, setRemarks] = useState('');
  const empName = leave.name || 'Employee';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-[#c7c4d8] p-6">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
          <X size={22} className="text-rose-500" />
        </div>
        <h3 className="text-center font-black text-[#151c27] mb-1 text-base">Reject Leave Request</h3>
        <p className="text-center text-sm text-[#777587] mb-4">
          Reject <strong className="text-[#151c27]">{empName}</strong>'s leave request?
        </p>
        <textarea
          rows={3}
          value={remarks}
          onChange={e => setRemarks(e.target.value)}
          placeholder="Reason for rejection (optional)"
          className="w-full border border-[#c7c4d8] rounded-xl px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-rose-400 resize-none mb-4"
        />
        <div className="flex gap-2.5">
          <button onClick={onCancel}
            className="flex-1 border border-[#c7c4d8] rounded-xl py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">
            Cancel
          </button>
          <button onClick={() => onConfirm(remarks)} disabled={loading}
            className="flex-1 bg-rose-500 text-white rounded-xl py-2.5 text-sm font-bold hover:bg-rose-600 disabled:opacity-60">
            {loading ? 'Rejecting…' : 'Reject Leave'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ForwardModal({ leave, onConfirm, onCancel, loading, policyMap = {} }) {
  const empName  = leave.name || 'Employee';
  const isNewFlow = leave._flow === 'new';
  const leaveStr = `${leaveLabel(leave.leave_type, policyMap)} — ${leave.start_date}${leave.start_date !== leave.end_date ? ` to ${leave.end_date}` : ''}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-[#c7c4d8] p-6">
        <div className="w-12 h-12 rounded-2xl bg-[#3525cd]/10 flex items-center justify-center mx-auto mb-4">
          <ClipboardCheck size={22} className="text-[#3525cd]" />
        </div>
        <h3 className="text-center font-black text-[#151c27] mb-1 text-base">
          {isNewFlow ? 'Approve & Forward' : 'Forward for Final Approval'}
        </h3>
        <p className="text-center text-sm text-[#777587] mb-5">
          {isNewFlow
            ? <>Approve <strong className="text-[#151c27]">{empName}</strong>'s {leaveStr} and forward to the next approver?</>
            : <>Forward <strong className="text-[#151c27]">{empName}</strong>'s {leaveStr} to the Root Admin for final decision?</>
          }
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5 text-xs text-blue-700 font-semibold">
          {isNewFlow
            ? 'This will advance the leave to the next approval stage.'
            : 'Once forwarded, the leave goes to the Root Admin. You cannot undo this action.'
          }
        </div>
        <div className="flex gap-2.5">
          <button onClick={onCancel}
            className="flex-1 border border-[#c7c4d8] rounded-xl py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 bg-[#3525cd] text-white rounded-xl py-2.5 text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-60">
            {loading ? 'Processing…' : isNewFlow ? 'Approve & Forward' : 'Forward to Root Admin'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaveCard({ leave, onApprove, onReject, busy, policyMap = {} }) {
  const [showForward, setShowForward] = useState(false);
  const [showReject,  setShowReject]  = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const empName = leave.name || 'Employee';
  const isHalf  = leave.leave_time === 'half';
  const dateStr = leave.start_date === leave.end_date
    ? leave.start_date
    : `${leave.start_date} → ${leave.end_date}`;
  const isNewFlow = leave._flow === 'new';
  const levelLabel = leave.current_level_label || (isNewFlow ? 'Your Approval' : 'Dept. Approval');

  async function handleApprove() {
    setActionLoading(true);
    await onApprove(leave.id, leave._flow);
    setActionLoading(false);
    setShowForward(false);
  }
  async function handleReject(remarks) {
    setActionLoading(true);
    await onReject(leave.id, leave._flow, remarks);
    setActionLoading(false);
    setShowReject(false);
  }

  return (
    <>
      <div className="bg-white border border-[#e7eefe] rounded-xl p-4 hover:border-[#3525cd]/30 hover:shadow-sm transition-all">
        <div className="flex items-start gap-3">
          <Avatar name={empName} color={leave.avatar_color} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[0.9rem] text-[#151c27] truncate">{empName}</p>
            <p className="text-xs text-[#777587] truncate">{leave.department || leave.position || 'Employee'}</p>
          </div>
          <span className={cn(
            'inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full border flex-shrink-0',
            isNewFlow ? 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]' : 'bg-blue-50 text-blue-700 border-blue-200'
          )}>
            <Clock size={10} /> {levelLabel}
          </span>
        </div>

        <div className="mt-3 pt-3 border-t border-[#f0f3ff] grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[#464555]">
            <FileText size={12} className="text-[#777587]" />
            <span className="font-semibold">{leaveLabel(leave.leave_type, policyMap)}</span>
            {isHalf && <span className="text-[0.6rem] bg-amber-50 text-amber-600 px-1 rounded">Half Day</span>}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[#464555]">
            <Calendar size={12} className="text-[#777587]" />
            <span>{dateStr}</span>
          </div>
        </div>

        {leave.reason && (
          <p className="mt-2 text-xs text-[#777587] bg-[#f9f9ff] rounded-lg px-3 py-2 line-clamp-2 border border-[#f0f3ff]">
            {leave.reason}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[0.68rem] text-[#777587]">
            Applied {new Date(leave.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
          <div className="flex gap-2">
            {isNewFlow && (
              <button
                onClick={() => setShowReject(true)}
                disabled={busy || actionLoading}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors disabled:opacity-60"
              >
                <X size={12} /> Reject
              </button>
            )}
            <button
              onClick={() => setShowForward(true)}
              disabled={busy || actionLoading}
              className="flex items-center gap-1.5 bg-[#3525cd] text-white px-4 py-1.5 rounded-xl text-xs font-bold hover:bg-[#2a1fb0] transition-colors disabled:opacity-60"
            >
              <ChevronRight size={14} /> {isNewFlow ? 'Approve' : 'Forward to Root Admin'}
            </button>
          </div>
        </div>
      </div>

      {showForward && (
        <ForwardModal
          leave={{ ...leave, name: empName }}
          onConfirm={handleApprove}
          onCancel={() => setShowForward(false)}
          loading={actionLoading}
          policyMap={policyMap}
        />
      )}
      {showReject && (
        <RejectModal
          leave={{ ...leave, name: empName }}
          onConfirm={handleReject}
          onCancel={() => setShowReject(false)}
          loading={actionLoading}
          policyMap={policyMap}
        />
      )}
    </>
  );
}

export default function DeptHeadApprovals() {
  const qc   = useQueryClient();
  const toast = useToast();

  // Legacy pending_dept + new workflow my-approvals (dept-level)
  const { data: pending = [], isLoading, isError } = useQuery({
    queryKey: ['dept-pending-leaves'],
    queryFn:  async () => {
      const rows = await apiGet('/leaves/pending-department');
      return rows;
    },
    refetchInterval: 30000,
  });

  const { data: leavePolicies = [] } = useLeavePolicies({ staleTime: 10 * 60 * 1000 });
  const policyMap = Object.fromEntries(
    leavePolicies.map(p => [p.leave_type, p.label]).filter(([k]) => !!k)
  );

  const { data: deptInfo } = useQuery({
    queryKey: ['is-dept-head'],
    queryFn:  () => apiGet('/leaves/is-dept-head'),
  });

  // BUG_153: fetch actual team count for the Team Members stat
  const { data: teamData } = useQuery({
    queryKey: ['team-dashboard'],
    queryFn:  () => apiGet('/leaves/team-dashboard'),
    enabled:  !!(deptInfo?.is_dept_head),
  });
  const actualTeamCount = teamData?.team_count ?? new Set(pending.map(l => l.user_id)).size;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['dept-pending-leaves'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  // Approve: legacy → department-approve, new → PUT /approve
  const approveMut = useMutation({
    mutationFn: ({ id, flow }) =>
      flow === 'new'
        ? apiPut(`/leaves/${id}/approve`, {})
        : apiPost(`/leaves/${id}/department-approve`, {}),
    onSuccess: () => { toast('Leave approved and forwarded.', 'success'); invalidate(); },
    onError:   (err) => toast(err.message, 'error'),
  });

  // Reject: new workflow only (legacy dept heads cannot reject)
  const rejectMut = useMutation({
    mutationFn: ({ id, remarks }) => apiPut(`/leaves/${id}/reject`, { remarks }),
    onSuccess: () => { toast('Leave rejected.', 'warning'); invalidate(); },
    onError:   (err) => toast(err.message, 'error'),
  });

  async function handleApprove(id, flow) {
    await approveMut.mutateAsync({ id, flow });
  }
  async function handleReject(id, flow, remarks) {
    if (flow !== 'new') return; // legacy dept heads cannot reject
    await rejectMut.mutateAsync({ id, remarks });
  }

  const newFlowCount    = pending.filter(l => l._flow === 'new').length;
  const legacyFlowCount = pending.filter(l => l._flow !== 'new').length;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle size={32} className="text-rose-400 mb-3" />
        <p className="font-bold text-[#151c27] mb-1">Failed to load</p>
        <button onClick={() => window.location.reload()} className="text-[#3525cd] text-sm font-bold hover:underline mt-2">Retry</button>
      </div>
    );
  }

  if (deptInfo && !deptInfo.is_dept_head && newFlowCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center max-w-sm mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-[#f0f3ff] flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={26} className="text-[#3525cd]" />
        </div>
        <h2 className="text-base font-black text-[#151c27] mb-1">No Pending Approvals</h2>
        <p className="text-sm text-[#777587]">
          You have no pending leave approvals assigned to you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-xl bg-[#3525cd]/10 flex items-center justify-center">
            <ClipboardCheck size={17} className="text-[#3525cd]" />
          </div>
          <h1 className="text-xl font-black text-[#151c27]">My Leave Approvals</h1>
        </div>
        {deptInfo?.department_name && (
          <p className="text-sm text-[#777587] ml-10.5">
            Department Head — <span className="font-semibold text-[#464555]">{deptInfo.department_name}</span>
          </p>
        )}
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700">
          <p className="font-bold mb-0.5">Your role in the approval flow</p>
          <p>
            New workflow leaves show an <strong>Approve</strong> and <strong>Reject</strong> button — you can make a final decision.
            Legacy leaves can only be forwarded to the Root Admin for final approval.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Pending',  value: pending.length,    bg: 'bg-[#f0f3ff]', icon: <Clock size={16} className="text-[#3525cd]" /> },
          { label: 'New Workflow',   value: newFlowCount,      bg: 'bg-emerald-50', icon: <CheckCircle2 size={16} className="text-emerald-600" /> },
          // BUG_153: show actual team size, not just those with pending leaves
          { label: 'Team Members',   value: actualTeamCount, bg: 'bg-amber-50', icon: <Users size={16} className="text-amber-600" /> },
        ].map((c, i) => (
          <div key={i} className="bg-white border border-[#e7eefe] rounded-xl p-4">
            <div className={`w-8 h-8 rounded-xl ${c.bg} flex items-center justify-center mb-2`}>{c.icon}</div>
            <p className="text-2xl font-black text-[#151c27]">{c.value}</p>
            <p className="text-xs text-[#777587] font-medium mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="bg-white border border-[#e7eefe] rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#f0f3ff]" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 bg-[#f0f3ff] rounded" />
                  <div className="h-3 w-20 bg-[#f0f3ff] rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : pending.length === 0 ? (
        <div className="bg-white border border-[#e7eefe] rounded-2xl py-16 text-center">
          <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-400" />
          <p className="font-bold text-[#464555] mb-1">No pending leave requests</p>
          <p className="text-sm text-[#777587]">All leave requests assigned to you have been reviewed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(leave => (
            <LeaveCard
              key={`${leave._flow || 'l'}-${leave.id}`}
              leave={leave}
              onApprove={handleApprove}
              onReject={handleReject}
              busy={approveMut.isPending || rejectMut.isPending}
              policyMap={policyMap}
            />
          ))}
        </div>
      )}
    </div>
  );
}
