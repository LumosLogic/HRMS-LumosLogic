import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, RefreshCw, Info, Copy, History } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPost } from '@/lib/api';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Modal } from '@/components/ui/Modal';

const LEAVE_ICONS = {
  annual:    '🌴',
  sick:      '🤒',
  casual:    '☕',
  emergency: '🚨',
  maternity: '👶',
  paternity: '👨‍👦',
  comp_off:  '⚖️',
};

const DEFAULT_POLICIES = [
  { leave_type: 'annual',    label: 'Annual Leave',    annual_quota: 18, carry_forward: true,  max_carry_forward: 5,  paid: true,  half_day_allowed: true,  min_notice_days: 1, max_consecutive_days: 0, active: true },
  { leave_type: 'sick',      label: 'Sick Leave',      annual_quota: 12, carry_forward: false, max_carry_forward: 0,  paid: true,  half_day_allowed: true,  min_notice_days: 0, max_consecutive_days: 0, active: true },
  { leave_type: 'casual',    label: 'Casual Leave',    annual_quota:  8, carry_forward: false, max_carry_forward: 0,  paid: true,  half_day_allowed: true,  min_notice_days: 1, max_consecutive_days: 3, active: true },
  { leave_type: 'emergency', label: 'Emergency Leave', annual_quota:  3, carry_forward: false, max_carry_forward: 0,  paid: true,  half_day_allowed: false, min_notice_days: 0, max_consecutive_days: 0, active: true },
  { leave_type: 'maternity', label: 'Maternity Leave', annual_quota: 180,carry_forward: false, max_carry_forward: 0,  paid: true,  half_day_allowed: false, min_notice_days: 7, max_consecutive_days: 0, active: true },
  { leave_type: 'paternity', label: 'Paternity Leave', annual_quota: 15, carry_forward: false, max_carry_forward: 0,  paid: true,  half_day_allowed: false, min_notice_days: 7, max_consecutive_days: 0, active: true },
  { leave_type: 'comp_off',  label: 'Comp Off',        annual_quota:  0, carry_forward: false, max_carry_forward: 0,  paid: true,  half_day_allowed: true,  min_notice_days: 0, max_consecutive_days: 0, active: true },
];

// EHN_LP_001: Leave Policy History Modal
function PolicyHistoryModal({ leaveType, label, onClose }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['lp-history', leaveType],
    queryFn: () => apiGet(`/leave-policies/${leaveType}/history`).catch(() => []),
  });
  return (
    <Modal open onClose={onClose} title={`Change History — ${label}`} size="md"
      footer={<div className="flex justify-end"><button className="btn btn-outline" onClick={onClose}>Close</button></div>}>
      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading…</div>
      ) : history.length === 0 ? (
        <p className="text-sm text-center text-[#777587] py-4">No change history recorded yet.</p>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {history.map(h => (
            <div key={h.id} className="flex items-start gap-3 py-2.5 px-3 rounded-xl bg-[#f9f9ff] border border-[#f0f3ff]">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-[#151c27]">
                  {h.field_changed ? <>{h.field_changed}: <span className="text-rose-600">{h.old_value}</span> → <span className="text-emerald-600">{h.new_value}</span></> : 'Policy updated'}
                </p>
                <p className="text-[0.65rem] text-[#777587] mt-0.5">By {h.changed_by_name || 'Admin'} · {h.created_at ? new Date(h.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function LeavePolicies() {
  const toast = useToast();
  const qc    = useQueryClient();
  const [policies, setPolicies] = useState(DEFAULT_POLICIES);
  const [dirty,    setDirty]    = useState(false);
  // EHN_LP_003: confirm when disabling requires_approval
  const [approvalConfirm, setApprovalConfirm] = useState(null); // {idx, leaveLabel}
  // EHN_LP_002: Bulk edit mode
  const [bulkEdit,      setBulkEdit]    = useState(false);
  const [bulkSelected,  setBulkSelected] = useState(new Set());
  // EHN_LP_001: History modal
  const [historyModal,  setHistoryModal] = useState(null); // {leave_type, label}

  const { data: _lpData, isLoading } = useQuery({ queryKey: ['leave-policies'], queryFn: () => apiGet('/leave-policies') });
  const data = Array.isArray(_lpData) ? _lpData : [];

  useEffect(() => {
    if (data.length) { setPolicies(data); setDirty(false); }
  }, [data]);

  const [savedPolicies, setSavedPolicies] = useState([]);
  useEffect(() => { if (data.length) setSavedPolicies(data); }, [data]);

  // Normalize any empty-string number fields to 0 before saving
  function normalizePolicies(ps) {
    return ps.map(p => ({
      ...p,
      annual_quota:        Number(p.annual_quota        ?? 0) || 0,
      min_notice_days:     Number(p.min_notice_days     ?? 0) || 0,
      max_consecutive_days:Number(p.max_consecutive_days?? 0) || 0,
      max_carry_forward:   Number(p.max_carry_forward   ?? 0) || 0,
    }));
  }

  const saveMut = useMutation({
    mutationFn: () => apiPost('/leave-policies', { policies: normalizePolicies(policies) }),
    onSuccess: () => { toast('Leave policies saved!', 'success'); setDirty(false); setSavedPolicies(policies); qc.invalidateQueries({ queryKey: ['leave-policies'] }); },
    onError: e => toast(e.message, 'error'),
  });

  function handleSave() {
    // BUG_146: validate annual_quota >= 0
    for (const p of policies) {
      const quota = Number(p.annual_quota ?? 0);
      if (quota < 0 || !Number.isInteger(quota)) {
        toast(`Annual quota for "${p.label}" must be a non-negative whole number.`, 'error');
        return;
      }
    }
    // BUG_149: warn if any quota is being reduced mid-year
    const reduced = policies.filter(p => {
      const saved = savedPolicies.find(s => s.leave_type === p.leave_type);
      return saved && Number(p.annual_quota ?? 0) < saved.annual_quota;
    });
    if (reduced.length > 0) {
      const names = reduced.map(p => p.label).join(', ');
      if (!window.confirm(`Reducing leave quota for ${names} may affect existing employee balances. Are you sure you want to continue?`)) return;
    }
    saveMut.mutate();
  }

  function update(idx, field, value) {
    setPolicies(p => p.map((item, i) => i === idx ? { ...item, [field]: value } : item));
    setDirty(true);
  }

  // EHN_LP_004: Clone a policy
  function clonePolicy(idx) {
    const source = policies[idx];
    const cloned = { ...source, leave_type: `${source.leave_type}_copy_${Date.now()}`, label: `${source.label} (Copy)`, _isNew: true };
    setPolicies(p => [...p, cloned]);
    setDirty(true);
    toast(`Cloned "${source.label}" — edit and save`, 'success');
  }

  if (isLoading) return <div className="loading"><div className="spinner" /> Loading…</div>;

  return (
    <div>
      <div className="page-header mb-6">
        <div>
          <div className="page-title">Leave Policies</div>
          {/* EHN_LP_002: Bulk Edit mode toggle */}
          <div className="page-subtitle">Configure quotas, carry-forward rules and approval settings for each leave type</div>
        </div>
        <div className="flex items-center gap-2">
          <button className={`btn ${bulkEdit ? 'bg-amber-50 text-amber-700 border-amber-300' : 'btn-outline'} btn-sm`}
            onClick={() => { setBulkEdit(b => !b); setBulkSelected(new Set()); }}>
            {bulkEdit ? 'Exit Bulk Edit' : 'Bulk Edit'}
          </button>
          <button className="btn btn-primary" onClick={() => handleSave()} disabled={!dirty || saveMut.isPending}>
            {saveMut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : <><Save size={15} />Save All</>}
          </button>
        </div>
      </div>

      <div className="card px-4 py-3 mb-4 flex items-center gap-2.5 text-xs text-[#464555] bg-[#f0f3ff] border-[#c7c4d8]">
        <Info size={14} className="text-[#3525cd] flex-shrink-0" />
        <p>Changes apply to new leave requests. Existing approved leaves are not affected.</p>
      </div>

      {/* EHN_LP_002: Bulk action bar */}
      {bulkEdit && bulkSelected.size > 0 && (
        <div className="card px-4 py-3 mb-4 flex items-center gap-3 flex-wrap bg-amber-50 border-amber-300">
          <span className="text-xs font-bold text-amber-800">{bulkSelected.size} selected</span>
          <button className="btn btn-outline btn-sm text-amber-700 border-amber-400 hover:bg-amber-100" onClick={() => {
            bulkSelected.forEach(idx => update(idx, 'requires_approval', true));
            toast(`Requires Approval enabled for ${bulkSelected.size} policy(ies)`, 'success');
          }}>Enable Approval for Selected</button>
          <button className="btn btn-outline btn-sm text-rose-700 border-rose-400 hover:bg-rose-50" onClick={() => {
            bulkSelected.forEach(idx => update(idx, 'requires_approval', false));
            toast(`Requires Approval disabled for ${bulkSelected.size} policy(ies)`, 'warning');
          }}>Disable Approval for Selected</button>
          <button className="btn btn-ghost btn-sm text-[#777587]" onClick={() => setBulkSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {policies.map((p, i) => (
          <div key={p.leave_type} className={`card p-5 ${bulkEdit && bulkSelected.has(i) ? 'ring-2 ring-amber-400' : ''}`}>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              {/* EHN_LP_002: Checkbox in bulk edit mode */}
              {bulkEdit && (
                <input type="checkbox" className="w-4 h-4 accent-amber-500" checked={bulkSelected.has(i)}
                  onChange={e => setBulkSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(i) : n.delete(i); return n; })} />
              )}
              <span className="text-2xl">{LEAVE_ICONS[p.leave_type] || '📋'}</span>
              <div>
                <div className="font-black text-[#151c27]">{p.label}</div>
                <div className="text-xs text-[#777587] capitalize">{p.leave_type.replace('_', ' ')}</div>
              </div>
              {/* EHN_LP_004: Clone button */}
              <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                {/* EHN_LP_001: History button */}
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#777587] border border-[#c7c4d8] hover:text-[#3525cd] hover:border-[#3525cd] hover:bg-[#f0f3ff] transition-colors"
                  title="View change history" onClick={() => setHistoryModal({ leave_type: p.leave_type, label: p.label })}>
                  <History size={11} />History
                </button>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#777587] border border-[#c7c4d8] hover:text-[#3525cd] hover:border-[#3525cd] hover:bg-[#f0f3ff] transition-colors"
                  title="Clone this policy" onClick={() => clonePolicy(i)}>
                  <Copy size={11} />Clone
                </button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs font-semibold text-[#464555]">Active</span>
                <div className={`relative w-10 h-5 rounded-full transition-colors ${p.active ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}
                  onClick={() => update(i, 'active', !p.active)}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${p.active ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="form-label">Annual Quota (days)</label>
                <input type="number" className="form-control" min={0} value={p.annual_quota ?? ''}
                  onChange={e => update(i, 'annual_quota', e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                  onBlur={e => { if (e.target.value === '') update(i, 'annual_quota', 0); }} />
              </div>
              <div>
                <label className="form-label">Min Notice Days</label>
                <input type="number" className="form-control" min={0} value={p.min_notice_days ?? ''}
                  onChange={e => update(i, 'min_notice_days', e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                  onBlur={e => { if (e.target.value === '') update(i, 'min_notice_days', 0); }} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="form-label">Max Consecutive Days <span className="text-[#777587]">(0=unlimited)</span></label>
                <input type="number" className="form-control" min={0} value={p.max_consecutive_days ?? ''}
                  onChange={e => update(i, 'max_consecutive_days', e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                  onBlur={e => { if (e.target.value === '') update(i, 'max_consecutive_days', 0); }} />
              </div>
              <div className="flex flex-col gap-2 pt-5">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="w-4 h-4 accent-[#3525cd]" checked={!!p.paid}
                    onChange={e => update(i, 'paid', e.target.checked)} />
                  <span className="font-semibold text-[#151c27]">Paid Leave</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="w-4 h-4 accent-[#3525cd]" checked={!!p.half_day_allowed}
                    onChange={e => update(i, 'half_day_allowed', e.target.checked)} />
                  <span className="font-semibold text-[#151c27]">Half-day Allowed</span>
                </label>
              </div>
            </div>

            <div className="border-t border-[#f0f3ff] pt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* EHN_LP_003: Confirm when disabling requires_approval */}
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="w-4 h-4 accent-[#3525cd]" checked={!!p.requires_approval}
                    onChange={e => {
                      if (!e.target.checked && p.requires_approval) {
                        setApprovalConfirm({ idx: i, leaveLabel: p.label });
                      } else {
                        update(i, 'requires_approval', e.target.checked);
                      }
                    }} />
                  <span className="font-semibold text-[#151c27]">Requires Approval</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" className="w-4 h-4 accent-[#3525cd]" checked={!!p.require_document}
                    onChange={e => update(i, 'require_document', e.target.checked)} />
                  <span className="font-semibold text-[#151c27]">Document Required</span>
                </label>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input type="checkbox" className="w-4 h-4 accent-[#3525cd]" checked={!!p.carry_forward}
                  onChange={e => update(i, 'carry_forward', e.target.checked)} />
                <span className="font-semibold text-[#151c27]">Allow Carry Forward</span>
              </label>
              {p.carry_forward && (
                <div>
                  <label className="form-label">Max Carry Forward Days</label>
                  <input type="number" className="form-control" min={0} value={p.max_carry_forward ?? ''}
                    onChange={e => update(i, 'max_carry_forward', e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                    onBlur={e => { if (e.target.value === '') update(i, 'max_carry_forward', 0); }} />
                </div>
              )}
              <div>
                <label className="form-label">Description <span className="text-[#777587] font-normal">(optional)</span></label>
                <input type="text" className="form-control" value={p.description || ''}
                  onChange={e => update(i, 'description', e.target.value)}
                  placeholder="e.g. Up to 8 days per year, cannot carry forward" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {dirty && (
        <div className="fixed bottom-6 right-6 z-50 flex gap-3">
          <button className="btn btn-outline" onClick={() => { setPolicies(data); setDirty(false); }}><RefreshCw size={14} />Discard</button>
          <button className="btn btn-primary shadow-lg" onClick={() => handleSave()} disabled={saveMut.isPending}>
            <Save size={15} />Save Changes
          </button>
        </div>
      )}

      {/* EHN_LP_001: Leave Policy History Modal */}
      {historyModal && (
        <PolicyHistoryModal leaveType={historyModal.leave_type} label={historyModal.label} onClose={() => setHistoryModal(null)} />
      )}

      {/* EHN_LP_003: Confirm disabling Requires Approval */}
      <ConfirmModal
        open={!!approvalConfirm}
        title="Disable Approval Requirement?"
        message={`Disabling approval requirement means all "${approvalConfirm?.leaveLabel}" requests will be automatically approved without HR review. Are you sure?`}
        confirmLabel="Yes, Disable"
        onConfirm={() => { update(approvalConfirm.idx, 'requires_approval', false); setApprovalConfirm(null); }}
        onCancel={() => setApprovalConfirm(null)}
      />
    </div>
  );
}
