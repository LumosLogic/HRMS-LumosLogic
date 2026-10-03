import React, { useState } from 'react';
import { Copy, RotateCcw, Building2, Layers } from 'lucide-react';
import { useBranch } from '@/context/BranchContext';
import { useFeature } from '@/context/FeatureFlagContext';

/**
 * Inherit / customise controls for a branch-capable setting. Used on the EXISTING settings screens
 * (Leave Policies, Work Schedule) — there is no per-branch page.
 *
 *   Effective configuration indicator   "Inherited from organisation default" | "Custom for <branch>"
 *   Same as…                            copy another branch's (or the organisation default's) config here
 *   Apply to other branches             push this branch's config to selected branches
 *   Reset to inherited                  drop this branch's override (falls back to the org default)
 *
 * Callbacks do the API calls; this component only collects intent and asks for confirmation.
 *   onCopy({ fromBranchId: number|null, toBranchIds: number[] })   fromBranchId null = org default
 *   onReset(branchId)
 * Renders nothing unless the branches feature is on and a specific branch is selected.
 */
export function BranchConfigBar({ hasOverride, source, group, busy = false, onCopy, onReset, subject = 'configuration' }) {
  // source ('org' | 'group' | 'branch') comes from /config-groups/effective; without it fall back to hasOverride.
  const isCustom = source ? source === 'branch' : !!hasOverride;
  const fromGroup = source === 'group';
  const fallbackLabel = group ? `its group “${group.name}”` : 'the organisation default';
  const branchesEnabled = useFeature('branches');
  const { selectedBranchId, selectedBranch, accessibleBranches } = useBranch();
  const [sameAs,   setSameAs]   = useState('');
  const [applyTo,  setApplyTo]  = useState([]);
  const [confirm,  setConfirm]  = useState(null); // { kind, label, run }

  if (!branchesEnabled || selectedBranchId == null || !selectedBranch) return null;

  const others = (accessibleBranches || []).filter(b => b.is_active !== false && Number(b.id) !== Number(selectedBranchId));
  const toggle = (id) => setApplyTo(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  const ask = (kind, label, run) => setConfirm({ kind, label, run });

  return (
    <div className="card px-4 py-3 mb-4 border-[#c7c4d8]">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 text-[0.7rem] font-bold px-2.5 py-1 rounded-full ${isCustom ? 'bg-amber-50 text-amber-700 border border-amber-200' : fromGroup ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
          <Layers size={12} />
          {isCustom ? `Custom for ${selectedBranch.name}` : fromGroup ? `Inherited from group “${group?.name}”` : 'Inherited from organisation default'}
        </span>

        <div className="flex items-center gap-2">
          <select className="form-control !py-1.5 !text-xs w-52" value={sameAs} onChange={e => setSameAs(e.target.value)} disabled={busy}>
            <option value="">Same as…</option>
            <option value="org">Organisation default</option>
            {others.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button className="btn btn-outline btn-sm" disabled={!sameAs || busy}
            onClick={() => ask('copy', `Make ${selectedBranch.name}'s ${subject} the same as ${sameAs === 'org' ? 'the organisation default' : others.find(b => String(b.id) === sameAs)?.name}? This replaces its current ${subject}.`,
              () => onCopy({ fromBranchId: sameAs === 'org' ? null : Number(sameAs), toBranchIds: [Number(selectedBranchId)] }))}>
            <Copy size={13} /> Apply
          </button>
        </div>

        {isCustom && (
          <button className="btn btn-ghost btn-sm text-rose-600" disabled={busy}
            onClick={() => ask('reset', `Reset ${selectedBranch.name} to inherited? Its custom ${subject} will be removed and it will use ${fallbackLabel}.`, () => onReset(Number(selectedBranchId)))}>
            <RotateCcw size={13} /> Reset to inherited
          </button>
        )}
      </div>

      {others.length > 0 && (
        <details className="mt-3">
          <summary className="text-xs font-semibold text-[#3525cd] cursor-pointer select-none flex items-center gap-1.5"><Building2 size={12} />Apply {selectedBranch.name}'s {subject} to other branches</summary>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 items-center">
            {others.map(b => (
              <label key={b.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={applyTo.includes(Number(b.id))} onChange={() => toggle(Number(b.id))} />{b.name}
              </label>
            ))}
            <button className="btn btn-outline btn-sm" disabled={!applyTo.length || busy}
              onClick={() => ask('apply', `Apply ${selectedBranch.name}'s ${subject} to ${applyTo.length} other branch${applyTo.length !== 1 ? 'es' : ''}? Their current ${subject} will be replaced.`,
                () => onCopy({ fromBranchId: Number(selectedBranchId), toBranchIds: applyTo }))}>
              Apply to selected
            </button>
          </div>
        </details>
      )}

      {confirm && (
        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-[16rem]">{confirm.label}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy}
            onClick={async () => { const run = confirm.run; setConfirm(null); setSameAs(''); setApplyTo([]); await run(); }}>
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}
