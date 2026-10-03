import React from 'react';
import { Building2 } from 'lucide-react';
import { useBranch } from '@/context/BranchContext';
import { useFeature } from '@/context/FeatureFlagContext';

/**
 * Branch audience / scope picker, reused by Announcements, Broadcast and Holidays.
 *
 *   value    = { orgWide: boolean, branchIds: number[] }
 *   onChange = (next) => void
 *
 * "Whole organisation" is offered only to callers with all-branch access (the server enforces the
 * same rule). Renders nothing when the branches feature is off or there is only one branch, so
 * single-branch / non-branch organisations see no change.
 */
export function defaultBranchTarget({ selectedBranchId, canOrgWide }) {
  if (selectedBranchId != null) return { orgWide: false, branchIds: [Number(selectedBranchId)] };
  return { orgWide: !!canOrgWide, branchIds: [] };
}

/** Request-body fields for a target value (org_wide / branch_ids). */
export function branchTargetPayload(value) {
  if (!value) return {};
  if (value.orgWide) return { org_wide: true };
  return value.branchIds?.length ? { branch_ids: value.branchIds } : {};
}

/**
 * State + payload for a create form that uses the picker. When the picker is not shown (branches off
 * or a single branch) nothing is sent, so those organisations behave exactly as before.
 *   const bt = useBranchTarget();
 *   <BranchTargetPicker value={bt.value} onChange={bt.setValue} />
 *   apiPost(url, { ...form, ...bt.payload });   disabled={!bt.valid}
 */
export function useBranchTarget() {
  const branchesEnabled = useFeature('branches');
  const { accessibleBranches, hasAllBranches, isRootAdmin, selectedBranchId } = useBranch();
  const visible = branchesEnabled && (accessibleBranches || []).filter(b => b.is_active !== false).length >= 2;
  const canOrgWide = !!(hasAllBranches || isRootAdmin);
  const [value, setValue] = React.useState(() => defaultBranchTarget({ selectedBranchId, canOrgWide }));
  const valid = !visible || value.orgWide || (value.branchIds || []).length > 0;
  return { value, setValue, visible, valid, payload: visible ? branchTargetPayload(value) : {} };
}

export function BranchTargetPicker({ value, onChange, label = 'Branches', orgWideLabel = 'Whole organisation (all branches)' }) {
  const branchesEnabled = useFeature('branches');
  const { accessibleBranches, hasAllBranches, isRootAdmin } = useBranch();
  const branches = (accessibleBranches || []).filter(b => b.is_active !== false);
  const canOrgWide = !!(hasAllBranches || isRootAdmin);
  if (!branchesEnabled || branches.length < 2) return null;

  const v = value || { orgWide: false, branchIds: [] };
  const toggle = (id) => {
    const set = new Set((v.branchIds || []).map(Number));
    set.has(Number(id)) ? set.delete(Number(id)) : set.add(Number(id));
    onChange({ orgWide: false, branchIds: [...set] });
  };

  return (
    <div>
      <label className="form-label flex items-center gap-1.5"><Building2 size={13} />{label}</label>
      <div className="rounded-xl border border-[#c7c4d8] divide-y divide-[#e6e8f5] max-h-44 overflow-y-auto">
        {canOrgWide && (
          <label className="flex items-center gap-2.5 px-3 py-2 text-xs font-semibold cursor-pointer hover:bg-[#f0f3ff]">
            <input type="checkbox" checked={!!v.orgWide} onChange={e => onChange(e.target.checked ? { orgWide: true, branchIds: [] } : { orgWide: false, branchIds: [] })} />
            {orgWideLabel}
          </label>
        )}
        {branches.map(b => (
          <label key={b.id} className={`flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-[#f0f3ff] ${v.orgWide ? 'opacity-50' : ''}`}>
            <input type="checkbox" disabled={!!v.orgWide} checked={!v.orgWide && (v.branchIds || []).map(Number).includes(Number(b.id))} onChange={() => toggle(b.id)} />
            {b.name}
          </label>
        ))}
      </div>
      {!v.orgWide && (v.branchIds || []).length === 0 && (
        <p className="text-[0.7rem] text-amber-600 mt-1">Select at least one branch{canOrgWide ? ' or choose the whole organisation' : ''}.</p>
      )}
    </div>
  );
}
