import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, Trash2, Users, SlidersHorizontal, Check } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { useFeature } from '@/context/FeatureFlagContext';

/**
 * Configuration groups for ONE domain ('work_schedule' | 'leave_policies'), shown on the EXISTING
 * settings page for that domain (no separate page).
 *
 *   Group "A" → Branch 1 + Branch 2   → editing the group's configuration changes both branches
 *   Group "B" → Branch 3              → a branch can be in at most ONE group per domain
 *
 * Effective configuration:  branch custom override  >  group  >  organisation default.
 * A member branch that has its own custom override keeps it until it is reset to inherited.
 *
 * Props: domain, onEditGroup(group) — the host page switches its editor to the group's configuration.
 * Renders nothing unless branches are on, there are ≥2 branches, and the caller has all-branch access
 * (the server enforces the same rule).
 */
export function ConfigGroupsManager({ domain, onEditGroup, editingGroupId = null, noun = 'configuration' }) {
  const toast = useToast();
  const qc = useQueryClient();
  const branchesEnabled = useFeature('branches');
  const { accessibleBranches, hasAllBranches, isRootAdmin } = useBranch();
  const branches = (accessibleBranches || []).filter(b => b.is_active !== false);
  const allowed = !!(branchesEnabled && (hasAllBranches || isRootAdmin) && branches.length >= 2);

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['config-groups', domain],
    queryFn: () => apiGet('/config-groups', { domain }),
    enabled: allowed,
  });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState([]);
  const [fromBranch, setFromBranch] = useState('org');
  const [membersFor, setMembersFor] = useState(null);   // group id whose members are being edited
  const [memberPick, setMemberPick] = useState([]);
  const [confirmDel, setConfirmDel] = useState(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['config-groups'] });
    qc.invalidateQueries({ queryKey: ['effective-config'] });
    qc.invalidateQueries({ queryKey: ['leave-policies'] });
    qc.invalidateQueries({ queryKey: ['branch-schedule-overrides'] });
  };

  const createMut = useMutation({
    mutationFn: () => apiPost('/config-groups', {
      domain, name: name.trim(), branch_ids: picked,
      ...(fromBranch !== 'org' ? { from_branch_id: Number(fromBranch) } : {}),
    }),
    onSuccess: (r) => {
      const kept = (r.custom || []).length;
      toast(`Group created${kept ? ` — ${kept} branch${kept !== 1 ? 'es keep' : ' keeps'} a custom override until reset` : ''}`, 'success');
      setCreating(false); setName(''); setPicked([]); setFromBranch('org'); refresh();
    },
    onError: e => toast(e.message, 'error'),
  });
  const membersMut = useMutation({
    mutationFn: ({ id, ids }) => apiPut(`/config-groups/${id}`, { branch_ids: ids }),
    onSuccess: () => { toast('Group members updated', 'success'); setMembersFor(null); refresh(); },
    onError: e => toast(e.message, 'error'),
  });
  const deleteMut = useMutation({
    mutationFn: (id) => apiDelete(`/config-groups/${id}`),
    onSuccess: () => { toast('Group dissolved — its branches use the organisation default again', 'success'); setConfirmDel(null); refresh(); },
    onError: e => toast(e.message, 'error'),
  });

  if (!allowed) return null;

  const branchName = (id) => branches.find(b => Number(b.id) === Number(id))?.name || `Branch ${id}`;
  // branch → group it already belongs to (a branch can be in only one group per domain)
  const taken = new Map();
  groups.forEach(g => (g.branch_ids || []).forEach(b => taken.set(Number(b), g)));
  const toggle = (list, setList, id) => setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

  return (
    <div className="card px-4 py-3 mb-4 border-[#c7c4d8]">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs font-bold text-[#151c27]">
          <Layers size={14} className="text-[#3525cd]" /> Shared {noun} groups
          <span className="font-normal text-[#777587]">— one configuration for several branches; changes apply to every member</span>
        </div>
        {!creating && <button className="btn btn-outline btn-sm" onClick={() => setCreating(true)}><Plus size={13} /> New group</button>}
      </div>

      {creating && (
        <div className="mt-3 p-3 rounded-lg bg-[#f9f9ff] border border-[#e7eefe] space-y-3">
          <input className="form-control !text-sm" placeholder="Group name (e.g. Gujarat sites)" value={name} maxLength={100} onChange={e => setName(e.target.value)} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {branches.map(b => {
              const g = taken.get(Number(b.id));
              return (
                <label key={b.id} className={`flex items-center gap-1.5 text-xs ${g ? 'opacity-50' : 'cursor-pointer'}`} title={g ? `Already in "${g.name}"` : ''}>
                  <input type="checkbox" disabled={!!g} checked={picked.includes(Number(b.id))} onChange={() => toggle(picked, setPicked, Number(b.id))} />
                  {b.name}{g ? ` (in ${g.name})` : ''}
                </label>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-[#464555]">Start from</span>
            <select className="form-control !py-1.5 !text-xs w-56" value={fromBranch} onChange={e => setFromBranch(e.target.value)}>
              <option value="org">Organisation default</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}'s current {noun}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" disabled={!name.trim() || !picked.length || createMut.isPending} onClick={() => createMut.mutate()}>
              {createMut.isPending ? 'Creating…' : 'Create group'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setName(''); setPicked([]); }}>Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? <p className="text-xs text-[#777587] mt-3">Loading…</p> : groups.length === 0 && !creating ? (
        <p className="text-xs text-[#777587] mt-3">No groups yet. Branches without a group (or custom override) use the organisation default.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {groups.map(g => {
            const editing = membersFor === g.id;
            return (
              <div key={g.id} className={`rounded-lg border ${editingGroupId === g.id ? 'border-[#3525cd] bg-[#f0f3ff]' : 'border-[#e7eefe]'} px-3 py-2.5`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#151c27] flex items-center gap-1.5"><Users size={13} className="text-[#3525cd]" />{g.name}</p>
                    <p className="text-[0.7rem] text-[#777587]">{(g.branch_ids || []).length ? g.branch_ids.map(branchName).join(' · ') : 'No branches'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-outline btn-sm" onClick={() => onEditGroup && onEditGroup(g)}><SlidersHorizontal size={12} /> Edit {noun}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setMembersFor(editing ? null : g.id); setMemberPick((g.branch_ids || []).map(Number)); }}>Members</button>
                    <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => setConfirmDel(g)}><Trash2 size={12} /></button>
                  </div>
                </div>
                {editing && (
                  <div className="mt-2 pt-2 border-t border-[#e7eefe] flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {branches.map(b => {
                      const other = taken.get(Number(b.id));
                      const blocked = other && other.id !== g.id;
                      return (
                        <label key={b.id} className={`flex items-center gap-1.5 text-xs ${blocked ? 'opacity-50' : 'cursor-pointer'}`} title={blocked ? `Already in "${other.name}"` : ''}>
                          <input type="checkbox" disabled={blocked} checked={memberPick.includes(Number(b.id))} onChange={() => toggle(memberPick, setMemberPick, Number(b.id))} />
                          {b.name}{blocked ? ` (in ${other.name})` : ''}
                        </label>
                      );
                    })}
                    <button className="btn btn-primary btn-sm" disabled={membersMut.isPending} onClick={() => membersMut.mutate({ id: g.id, ids: memberPick })}><Check size={12} /> Save members</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {confirmDel && (
        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-[16rem]">Dissolve “{confirmDel.name}”? Its {(confirmDel.branch_ids || []).length} branch(es) go back to the organisation default (a branch's own custom override is kept).</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(confirmDel.id)}>Dissolve</button>
        </div>
      )}
    </div>
  );
}
