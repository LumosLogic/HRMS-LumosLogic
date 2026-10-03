import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Save, RefreshCw, Info, Copy, History } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { ConfigGroupsManager } from '@/components/ConfigGroupsManager';
import { BranchConfigBar } from '@/components/BranchConfigBar';
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
  const { selectedBranchId, selectedBranch } = useBranch();
  const [policies, setPolicies] = useState(DEFAULT_POLICIES);
  const [dirty,    setDirty]    = useState(false);
  // EHN_LP_003: confirm when disabling requires_approval
  const [approvalConfirm, setApprovalConfirm] = useState(null); // {idx, leaveLabel}
  // EHN_LP_002: Bulk edit mode
  const [bulkEdit,      setBulkEdit]    = useState(false);
  const [bulkSelected,  setBulkSelected] = useState(new Set());
  // EHN_LP_001: History modal
  const [historyModal,  setHistoryModal] = useState(null); // {leave_type, label}

  // Group edit mode: the page edits a configuration group's policies instead of the selected branch's.
  const [editGroup, setEditGroup] = useState(null);

  const { data: _lpData, isLoading: _lpLoading } = useQuery({ queryKey: ['leave-policies', selectedBranchId], queryFn: () => apiGet('/leave-policies'), placeholderData: keepPreviousData });
  const { data: _grpData, isLoading: _grpLoading } = useQuery({
    queryKey: ['leave-policies-group', editGroup?.id],
    queryFn:  () => apiGet(`/config-groups/${editGroup.id}/config`),
    enabled:  !!editGroup,
  });
  // Where the selected branch's effective policies come from: its own override, its group, or the org default.
  const { data: effective } = useQuery({
    queryKey: ['effective-config', 'leave_policies', selectedBranchId],
    queryFn:  () => apiGet('/config-groups/effective', { domain: 'leave_policies', branch_id: selectedBranchId }),
    enabled:  !!selectedBranchId && !editGroup,
    retry:    false,
  });
  const isLoading = editGroup ? _grpLoading : _lpLoading;
  const data = editGroup
    ? (Array.isArray(_grpData?.config) ? _grpData.config : [])
    : (Array.isArray(_lpData) ? _lpData : []);

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
    mutationFn: () => editGroup
      ? apiPut(`/config-groups/${editGroup.id}/config`, { policies: normalizePolicies(policies) })
      : apiPost('/leave-policies', { policies: normalizePolicies(policies) }),
    onSuccess: (r) => {
      toast(editGroup ? `Group “${editGroup.name}” saved — applied to ${(r?.applied || []).length} branch(es)${(r?.custom || []).length ? `; ${r.custom.length} keep a custom override` : ''}` : 'Leave policies saved!', 'success');
      setDirty(false); setSavedPolicies(policies);
      qc.invalidateQueries({ queryKey: ['leave-policies'] });
      qc.invalidateQueries({ queryKey: ['leave-policies-group'] });
      qc.invalidateQueries({ queryKey: ['effective-config'] });
    },
    onError: e => toast(e.message, 'error'),
  });

  // Effective-configuration state: a branch has its own override when the rows returned carry its branch_id.
  const hasBranchOverride = effective ? effective.source === 'branch' : (!!selectedBranchId && data.length > 0 && data[0].branch_id != null && data[0].group_id == null);
  const copyMut = useMutation({
    mutationFn: ({ fromBranchId, toBranchIds }) => apiPost('/leave-policies/copy', { from_branch_id: fromBranchId, to_branch_ids: toBranchIds }),
    onSuccess: () => { toast('Leave policies copied', 'success'); qc.invalidateQueries({ queryKey: ['leave-policies'] }); qc.invalidateQueries({ queryKey: ['effective-config'] }); },
    onError: e => toast(e.message, 'error'),
  });
  const resetMut = useMutation({
    mutationFn: (branchId) => apiDelete(`/leave-policies/branch/${branchId}`),
    onSuccess: (r) => { toast(r?.inherited_from_group ? 'Branch reset — now inherits its group' : 'Branch reset to the organisation default', 'success'); qc.invalidateQueries({ queryKey: ['leave-policies'] }); qc.invalidateQueries({ queryKey: ['effective-config'] }); },
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
    // BUG-132: Leave Name is editable — it must be filled in, and unique. Only new or
    // changed names are checked, so existing policies that already share a name never
    // block an unrelated change (e.g. toggling Active/Inactive — BUG-131).
    const nameCount = {};
    policies.forEach(p => { const k = (p.label || '').trim().toLowerCase(); nameCount[k] = (nameCount[k] || 0) + 1; });
    for (const p of policies) {
      const name = (p.label || '').trim();
      if (!name) {
        toast('Leave Name cannot be empty.', 'error');
        return;
      }
      const saved = savedPolicies.find(s => s.leave_type === p.leave_type);
      const unchanged = saved && (saved.label || '').trim().toLowerCase() === name.toLowerCase();
      if (!unchanged && nameCount[name.toLowerCase()] > 1) {
        toast(`Leave Name "${name}" is already used by another policy. Please use a unique name.`, 'error');
        return;
      }
    }
    // Guard: no two policies may share the same leave_type
    const typesSeen = new Set();
    for (const p of policies) {
      if (typesSeen.has(p.leave_type)) {
        toast(`Duplicate leave type "${p.leave_type}". Rename one of the cloned policies before saving.`, 'error');
        return;
      }
      typesSeen.add(p.leave_type);
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
    // Build a guaranteed-unique leave_type: timestamp + 4-char random hex.
    // This prevents collisions when two clones are created within the same millisecond.
    const rand = Math.random().toString(36).slice(2, 6);
    let baseType = source.leave_type.replace(/_copy_[a-z0-9]+$/i, ''); // strip prior _copy_ suffix for re-clones
    let candidate = `${baseType}_copy_${Date.now()}${rand}`;
    // Final safety: ensure no existing policy already has this type (loop until unique)
    setPolicies(prev => {
      const existing = new Set(prev.map(p => p.leave_type));
      while (existing.has(candidate)) {
        candidate = `${baseType}_copy_${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
      }
      const cloned = { ...source, id: undefined, leave_type: candidate, label: `${source.label} (Copy)`, _isNew: true };
      return [...prev, cloned];
    });
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
        <p>
          {selectedBranchId && selectedBranch
            ? <>Editing leave policies for <strong>{selectedBranch.name}</strong>. Changes apply only to this branch.</>
            : <>Editing the organisation-wide leave policies (applies to all branches without their own override).</>}{' '}
          Changes apply to new leave requests. Existing approved leaves are not affected.
        </p>
      </div>

      {editGroup && (
        <div className="card px-4 py-3 mb-4 flex items-center gap-2.5 text-xs bg-indigo-50 border-indigo-200 text-indigo-900">
          <Info size={14} className="flex-shrink-0" />
          <p className="flex-1">Editing configuration group <strong>“{editGroup.name}”</strong>. Saving updates every member branch (a branch with its own custom override keeps it).</p>
          <button className="btn btn-outline btn-sm" onClick={() => { setEditGroup(null); setDirty(false); }}>Back to branch view</button>
        </div>
      )}

      <ConfigGroupsManager domain="leave_policies" noun="leave policy" onEditGroup={setEditGroup} editingGroupId={editGroup?.id} />

      {!editGroup && <BranchConfigBar
        subject="leave policies"
        source={effective?.source}
        group={effective?.group}
        hasOverride={hasBranchOverride}
        busy={copyMut.isPending || resetMut.isPending || dirty}
        onCopy={(p) => copyMut.mutate(p)}
        onReset={(id) => resetMut.mutate(id)}
      />}

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

            {/* BUG-132: editable Leave Name (display name only — the leave type key is unchanged,
                so existing leaves, balances and payroll keep working) */}
            <div className="mb-4">
              <label className="form-label">Leave Name</label>
              <input type="text" className="form-control" maxLength={100} value={p.label ?? ''}
                onChange={e => update(i, 'label', e.target.value)}
                placeholder="e.g. Annual Leave" />
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
