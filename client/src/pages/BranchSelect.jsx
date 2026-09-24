import React, { useEffect, useMemo, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ArrowRight, MapPin, Plus,
  ToggleRight, ToggleLeft, MoreVertical, Pencil, ShieldCheck, Users,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBranch } from '@/context/BranchContext';
import { useAuth } from '@/context/AuthContext';
import { useFeature, FeatureFlagsLoadedContext } from '@/context/FeatureFlagContext';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

function Spinner() {
  return (
    <div className="h-screen flex items-center justify-center bg-[#f9f9ff]">
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #e5e3f0', borderTopColor: '#3525cd',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ─── Branch Create/Edit Modal ─────────────────────────────────────────────────
// Reuses the existing POST /branches and PUT /branches/:id APIs. Passing a
// `branch` puts the modal in edit mode; omitting it creates a new branch.

function BranchFormModal({ open, onClose, branch }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const { reloadBranches } = useBranch();
  const isEdit = !!branch;

  const empty = { name: '', code: '', location: '', address: '', is_active: true };
  const [form, setForm] = useState(() => isEdit ? {
    name:      branch.name      || '',
    code:      branch.code      || '',
    location:  branch.location  || '',
    address:   branch.address   || '',
    is_active: branch.is_active !== false,
  } : empty);
  const [nameErr, setNameErr] = useState('');

  // Reset the form each time the modal is (re)opened or the target branch changes
  useEffect(() => {
    if (!open) return;
    setForm(isEdit ? {
      name:      branch.name      || '',
      code:      branch.code      || '',
      location:  branch.location  || '',
      address:   branch.address   || '',
      is_active: branch.is_active !== false,
    } : empty);
    setNameErr('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branch?.id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: () => isEdit ? apiPut(`/branches/${branch.id}`, form) : apiPost('/branches', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] });
      reloadBranches(); // keep BranchContext / sidebar selector in sync
      toast(isEdit ? 'Branch updated!' : 'Branch created!', 'success');
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  function handleSubmit() {
    const name = form.name.trim();
    if (!name) { setNameErr('Branch name is required.'); return; }
    if (name.length < 2) { setNameErr('Branch name must be at least 2 characters.'); return; }
    if (name.length > 100) { setNameErr('Branch name cannot exceed 100 characters.'); return; }
    setNameErr('');
    mut.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Branch' : 'Add Branch'} size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={mut.isPending || !form.name.trim()}>
            {mut.isPending
              ? <><span className="spinner w-4 h-4" />Saving…</>
              : isEdit ? 'Save Changes' : 'Create Branch'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Branch Name <span className="text-rose-500">*</span></label>
            <input
              className={`form-control ${nameErr ? 'border-rose-400' : ''}`}
              placeholder="e.g. Head Office"
              value={form.name}
              onChange={e => { set('name', e.target.value); if (nameErr) setNameErr(''); }}
            />
            {nameErr && <p className="text-xs text-rose-600 mt-1">{nameErr}</p>}
          </div>
          <div>
            <label className="form-label">Branch Code</label>
            <input className="form-control" placeholder="e.g. HO-01" value={form.code} onChange={e => set('code', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="form-label">Location / City</label>
          <input className="form-control" placeholder="e.g. Mumbai" value={form.location} onChange={e => set('location', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Address</label>
          <textarea className="form-control" rows={2} placeholder="Full address…" value={form.address} onChange={e => set('address', e.target.value)} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl border border-[#c7c4d8] bg-[#f8f9fe]">
          <div>
            <p className="text-sm font-bold text-[#151c27]">Status</p>
            <p className="text-xs text-[#777587]">{form.is_active ? 'Active — visible and in use' : 'Inactive — hidden from selections'}</p>
          </div>
          <button type="button" onClick={() => set('is_active', !form.is_active)} className="flex-shrink-0">
            {form.is_active
              ? <ToggleRight size={32} className="text-[#3525cd]" />
              : <ToggleLeft  size={32} className="text-[#c7c4d8]" />}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Manage HR Admins Modal ───────────────────────────────────────────────────
// Checkbox UI over the existing branch HR-access relationship:
//   GET    /branches/user-access-by-branch/:branchId
//   POST   /branches/user-access              { userId, branchId }
//   DELETE /branches/user-access/:userId/branch/:branchId
// Only users with role = 'admin' in this org are eligible (backend also rejects
// root_admin — they already have org-wide access).

function ManageHrAdminsModal({ open, onClose, branch }) {
  const toast = useToast();
  const qc    = useQueryClient();

  // Eligible HR admins (role = admin) in this organization
  const { data: hrUsers = [], isLoading: hrLoading } = useQuery({
    queryKey: ['hr-admins-for-branch-access'],
    queryFn:  () => apiGet('/employees', { role: 'admin' }),
    enabled:  open,
    select:   d => (Array.isArray(d) ? d : []).filter(u => u.role === 'admin'),
  });

  // Current access grants for this branch
  const { data: accessData, isLoading: accessLoading } = useQuery({
    queryKey: ['branch-hr-access-users', branch?.id],
    queryFn:  () => apiGet('/branches/user-access-by-branch/' + branch.id),
    enabled:  open && !!branch?.id,
  });
  const usersWithAccess = useMemo(() => accessData?.users || [], [accessData]);

  // Org-wide ("All Branches") grants — always checked and not removable here
  const allBranchesIds = useMemo(
    () => new Set(usersWithAccess.filter(u => u.all_branches).map(u => Number(u.user_id))),
    [usersWithAccess]
  );
  // Baselines captured on load, used to diff on save
  const initiallyGranted = useMemo(
    () => new Set(usersWithAccess.map(u => Number(u.user_id))),
    [usersWithAccess]
  );

  const [selected, setSelected] = useState(new Set());

  // Sync checkbox state whenever fresh access data arrives
  useEffect(() => {
    if (!open) return;
    setSelected(new Set(usersWithAccess.map(u => Number(u.user_id))));
  }, [open, accessData, usersWithAccess]);

  const toggle = (userId) => {
    if (allBranchesIds.has(Number(userId))) return; // org-wide grants are managed elsewhere
    setSelected(prev => {
      const next = new Set(prev);
      const id = Number(userId);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const toGrant  = [...selected].filter(id => !initiallyGranted.has(id));
      const toRevoke = [...initiallyGranted].filter(id => !selected.has(id) && !allBranchesIds.has(id));
      const results = await Promise.allSettled([
        ...toGrant.map(userId  => apiPost('/branches/user-access', { userId, branchId: branch.id })),
        ...toRevoke.map(userId => apiDelete(`/branches/user-access/${userId}/branch/${branch.id}`)),
      ]);
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length) throw new Error(`${failures.length} change(s) failed. ${failures[0].reason?.message || ''}`.trim());
      return { granted: toGrant.length, revoked: toRevoke.length };
    },
    onSuccess: ({ granted, revoked }) => {
      qc.invalidateQueries({ queryKey: ['branch-hr-access-users', branch?.id] });
      qc.invalidateQueries({ queryKey: ['branches'] });
      toast(`HR admins updated${granted ? ` · ${granted} added` : ''}${revoked ? ` · ${revoked} removed` : ''}`, 'success');
      onClose();
    },
    onError: e => {
      // Resync so the modal reflects the true server state, then surface the error
      qc.invalidateQueries({ queryKey: ['branch-hr-access-users', branch?.id] });
      qc.invalidateQueries({ queryKey: ['branches'] });
      toast(e.message, 'error');
    },
  });

  const loading = hrLoading || accessLoading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage HR Admins"
      size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose} disabled={saveMut.isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || loading}>
            {saveMut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Save Changes'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
            <Building2 size={14} className="text-[#3525cd]" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-black text-[#151c27] truncate">{branch?.name}</p>
            {branch?.code && <p className="text-[0.6rem] font-bold text-[#3525cd] uppercase tracking-wider">{branch.code}</p>}
          </div>
        </div>

        <div>
          <p className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] mb-2">Assigned HR Admins</p>
          {loading ? (
            <div className="text-xs text-[#777587] py-3">Loading…</div>
          ) : hrUsers.length === 0 ? (
            <p className="text-xs text-[#777587] italic py-3">No HR admins available in this organization yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
              {hrUsers.map(u => {
                const id       = Number(u.id);
                const checked  = selected.has(id) || allBranchesIds.has(id);
                const orgWide  = allBranchesIds.has(id);
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors
                      ${orgWide ? 'border-[#c7c4d8] bg-[#f8f9fe] cursor-default'
                                : checked ? 'border-[#3525cd]/30 bg-[#f0f3ff] cursor-pointer hover:bg-[#e8ecff]'
                                          : 'border-[#c7c4d8] bg-white cursor-pointer hover:bg-[#f9f9ff]'}`}
                  >
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-[#3525cd] flex-shrink-0"
                      checked={checked}
                      disabled={orgWide}
                      onChange={() => toggle(id)}
                    />
                    <span className="text-sm font-semibold text-[#151c27] flex-1 truncate">{u.name}</span>
                    {orgWide && (
                      <span className="text-[0.6rem] font-bold bg-[#3525cd]/10 text-[#3525cd] px-1.5 py-0.5 rounded flex-shrink-0">
                        All Branches
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <p className="text-[0.68rem] text-[#777587] leading-relaxed">
          Selected HR admins can manage this branch's workspace. Root Admins always have org-wide access.
        </p>
      </div>
    </Modal>
  );
}

// ─── Branch card ⋮ menu ───────────────────────────────────────────────────────

function BranchMenu({ branch, onManageHr, onEdit, onToggleStatus, busy }) {
  const [open, setOpen] = useState(false);
  const isActive = branch.is_active !== false;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        className="p-1 rounded-md text-[#777587] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors"
        title="Branch actions"
        aria-label="Branch actions"
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-30" onClick={e => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 top-8 z-40 w-52 bg-white rounded-xl border border-[#c7c4d8] shadow-xl py-1 animate-in">
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setOpen(false); onManageHr(branch); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-[#151c27] hover:bg-[#f0f3ff] transition-colors"
            >
              <ShieldCheck size={13} className="text-[#3525cd]" /> Manage HR Admins
            </button>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); setOpen(false); onEdit(branch); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-[#151c27] hover:bg-[#f0f3ff] transition-colors"
            >
              <Pencil size={13} className="text-[#464555]" /> Edit Branch
            </button>
            <div className="h-px bg-[#f0f3ff] my-1" />
            <button
              type="button"
              disabled={busy}
              onClick={e => { e.stopPropagation(); setOpen(false); onToggleStatus(branch); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50
                ${isActive ? 'text-amber-700 hover:bg-amber-50' : 'text-emerald-700 hover:bg-emerald-50'}`}
            >
              {isActive
                ? <><ToggleLeft  size={13} /> Deactivate Branch</>
                : <><ToggleRight size={13} /> Activate Branch</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Branch Card ──────────────────────────────────────────────────────────────

function BranchCard({ branch, onSelect, onManageHr, onEdit, onToggleStatus, disabled, canManage, busy }) {
  const hrCount = branch.hr_admin_count ?? 0;
  const names   = branch.hr_admin_names || [];
  const nameSummary = names.length === 0
    ? null
    : names.length <= 2
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;

  return (
    <div className={`relative flex flex-col bg-white rounded-xl border shadow-sm p-4 transition-all
      ${disabled
        ? 'border-[#c7c4d8] opacity-70'
        : 'border-[#c7c4d8] hover:border-[#3525cd]/50 hover:shadow-md'
      }`}
    >
      {/* Header: icon + name + ⋮ management menu */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
          ${disabled ? 'bg-[#f5f5f5]' : 'bg-[#f0f3ff]'}`}>
          <Building2 size={16} className={disabled ? 'text-[#aaa]' : 'text-[#3525cd]'} />
        </div>

        {canManage && (
          <BranchMenu
            branch={branch}
            onManageHr={onManageHr}
            onEdit={onEdit}
            onToggleStatus={onToggleStatus}
            busy={busy}
          />
        )}
      </div>

      {/* Identity */}
      <h3 className="text-sm font-black text-[#151c27] leading-tight truncate" title={branch.name}>{branch.name}</h3>
      {branch.code && (
        <p className="text-[0.6rem] font-bold text-[#3525cd] uppercase tracking-wider mt-0.5">{branch.code}</p>
      )}
      {(branch.location || branch.address) && (
        <div className="flex items-start gap-1 text-[#777587] text-[0.65rem] mt-1">
          <MapPin size={9} className="flex-shrink-0 mt-0.5" />
          <span className="line-clamp-1">{branch.location || branch.address}</span>
        </div>
      )}

      {/* HR admin assignment summary */}
      <div className="mt-3 pt-3 border-t border-[#f0f3ff]">
        <div className="flex items-center gap-1.5 text-[0.68rem] font-bold text-[#464555]">
          <Users size={11} className="text-[#3525cd] flex-shrink-0" />
          <span>
            HR Admins:{' '}
            {hrCount === 0
              ? <span className="font-semibold text-[#777587]">None</span>
              : hrCount}
          </span>
        </div>
        {nameSummary && (
          <p className="text-[0.65rem] text-[#777587] mt-0.5 truncate" title={names.join(', ')}>
            {nameSummary}
          </p>
        )}
      </div>

      {/* Primary action — Select enters the workspace (active branches only) */}
      <div className="mt-auto pt-3">
        {disabled ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[0.6rem] font-semibold bg-slate-50 text-slate-500 border border-slate-200">
            <span className="w-1 h-1 rounded-full bg-slate-400 inline-block" /> Inactive — not selectable
          </span>
        ) : (
          <button
            onClick={() => onSelect(branch.id)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#f0f3ff] text-[#3525cd] text-[0.7rem] font-bold hover:bg-[#3525cd] hover:text-white transition-colors"
          >
            Select <ArrowRight size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BranchSelect() {
  const navigate      = useNavigate();
  const { user, isRootAdmin } = useAuth();
  const branchesEnabled = useFeature('branches');
  const flagsLoaded   = useContext(FeatureFlagsLoadedContext);
  const toast         = useToast();
  const qc            = useQueryClient();
  const {
    accessibleBranches,
    setSelectedBranchId,
    branchesLoaded,
    isLoading,
    reloadBranches,
  } = useBranch();

  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [editBranch,    setEditBranch]    = useState(null);
  const [hrBranch,      setHrBranch]      = useState(null);
  const [statusTarget,  setStatusTarget]  = useState(null); // { branch, nextIsActive }

  // Inline create state for the "0 branches" case
  const [createName,    setCreateName]    = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError,   setCreateError]   = useState('');

  const orgName = user?.organization_name || 'Your Organization';

  // Management actions are Root-Admin-only (backend enforces this too — the HR
  // access endpoints are rootAdminOnly and all branch calls are org-scoped to
  // req.user.organization_id). Frontend gating is defense-in-depth only.
  const canManageBranch = !!isRootAdmin;

  // Branch metadata (hr_admin_count / hr_admin_names) — same source the
  // Settings → Branches page uses. BranchContext supplies the list itself.
  const { data: branchMeta } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => apiGet('/branches'),
    enabled:  !!isRootAdmin,
  });

  const metaById = useMemo(() => {
    const map = {};
    (Array.isArray(branchMeta) ? branchMeta : []).forEach(b => { map[Number(b.id)] = b; });
    return map;
  }, [branchMeta]);

  // Merge HR-admin summary into the BranchContext-supplied list
  const enrich = (b) => {
    const meta = metaById[Number(b.id)];
    return {
      ...b,
      hr_admin_count: meta?.hr_admin_count ?? b.hr_admin_count ?? 0,
      hr_admin_names: meta?.hr_admin_names ?? b.hr_admin_names ?? [],
    };
  };

  // Branches feature OFF → redirect
  useEffect(() => {
    if (flagsLoaded && !branchesEnabled) {
      navigate('/root/dashboard', { replace: true });
    }
  }, [flagsLoaded, branchesEnabled, navigate]);

  function handleSelect(branchId) {
    const target = accessibleBranches.find(b => Number(b.id) === Number(branchId));
    if (!target || target.is_active === false) return; // inactive branches are never selectable
    setSelectedBranchId(branchId);
    navigate('/root/dashboard', { replace: true });
  }

  // Existing activation mechanism: PUT /branches/:id with { is_active } only
  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => apiPut(`/branches/${id}`, { is_active }),
    onSuccess: (_, { is_active }) => {
      toast(is_active ? 'Branch activated' : 'Branch deactivated', 'success');
      qc.invalidateQueries({ queryKey: ['branches'] });
      reloadBranches(); // clears the selection if the active branch became inactive
    },
    onError: e => toast(e.message, 'error'),
  });

  function requestStatusToggle(branch) {
    const nextIsActive = branch.is_active === false; // true = activate, false = deactivate
    setStatusTarget({ branch, nextIsActive });
  }

  async function handleCreateFirstBranch(e) {
    e.preventDefault();
    const name = createName.trim();
    if (!name) { setCreateError('Branch name is required.'); return; }
    if (name.length < 2) { setCreateError('Name must be at least 2 characters.'); return; }
    setCreateLoading(true);
    setCreateError('');
    try {
      await apiPost('/branches', { name, is_active: true });
      setCreateName('');
      reloadBranches();
    } catch (err) {
      setCreateError(err.message || 'Failed to create branch.');
    } finally {
      setCreateLoading(false);
    }
  }

  if (isLoading || !branchesLoaded) return <Spinner />;

  const activeBranches   = accessibleBranches.filter(b => b.is_active !== false).map(enrich);
  const inactiveBranches = accessibleBranches.filter(b => b.is_active === false).map(enrich);

  // ── 0 branches: prompt to create the first branch ────────────────────────
  if (accessibleBranches.length === 0) {
    return (
      <div className="min-h-screen bg-[#f9f9ff] flex flex-col items-center justify-center px-6">
        <div className="mb-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#3525cd] flex items-center justify-center mx-auto mb-5 shadow-lg shadow-[#3525cd]/20">
            <img src="/LogoWithoutName.svg" alt="HRMS" className="w-9 h-9" onError={e => { e.target.style.display = 'none'; }} />
          </div>
          <h1 className="text-3xl font-black text-[#151c27] tracking-tight mb-1">{orgName}</h1>
          <p className="text-[#777587] text-sm">Root Admin Console</p>
        </div>

        <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm p-8 max-w-sm w-full">
          <div className="w-12 h-12 rounded-xl bg-[#f0f3ff] flex items-center justify-center mx-auto mb-4">
            <Building2 size={22} className="text-[#3525cd]" />
          </div>
          <h2 className="text-lg font-black text-[#151c27] mb-1 text-center">Set up your first branch</h2>
          <p className="text-sm text-[#777587] mb-6 text-center leading-relaxed">
            Create a branch to organize your workforce. You can add more branches later from Branch Management.
          </p>

          <form onSubmit={handleCreateFirstBranch} className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-[#464555] mb-1">Branch Name <span className="text-rose-500">*</span></label>
              <input
                type="text"
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-[#c7c4d8] bg-[#f9f9ff] focus:outline-none focus:border-[#3525cd] focus:ring-2 focus:ring-[#3525cd]/10 transition-all"
                placeholder="e.g. Head Office, Dalal, Bhuj…"
                value={createName}
                onChange={e => { setCreateName(e.target.value); if (createError) setCreateError(''); }}
                autoFocus
              />
              {createError && <p className="text-xs text-rose-600 mt-1">{createError}</p>}
            </div>
            <button
              type="submit"
              disabled={createLoading || !createName.trim()}
              className="w-full py-3 bg-[#3525cd] text-white font-bold rounded-xl hover:bg-[#4f46e5] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#3525cd]/20 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createLoading
                ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Creating…</>
                : <><Plus size={16} />Create Branch</>}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-[#f0f3ff] text-center">
            <button
              onClick={() => navigate('/root/dashboard', { replace: true })}
              className="text-xs text-[#777587] hover:text-[#3525cd] font-semibold transition-colors"
            >
              Skip for now — enter workspace without branches
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Active + Inactive branch grid — full width, scrollable ──────────────
  return (
    // h-screen + overflow-y-auto creates its own scroll context, bypassing
    // the global body { overflow: hidden } set in index.css
    <div className="h-screen overflow-y-auto bg-[#f9f9ff]">

      {/* ── Sticky top bar ── */}
      <div className="sticky top-0 z-20 bg-white border-b border-[#e7eefe] shadow-sm">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#3525cd] flex items-center justify-center shadow-sm flex-shrink-0">
              <Building2 size={15} className="text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-[#151c27] leading-tight">{orgName}</p>
              <p className="text-[0.6rem] text-[#777587] leading-none mt-0.5">Root Admin Console</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              {activeBranches.length} Active
            </span>
            {inactiveBranches.length > 0 && (
              <span className="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
                {inactiveBranches.length} Inactive
              </span>
            )}
            <button
              onClick={() => setAddBranchOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-lg bg-[#3525cd] text-white hover:bg-[#4f46e5] transition-colors"
            >
              <Plus size={13} /> Add Branch
            </button>
          </div>
        </div>
      </div>

      {/* ── Page content — full width ── */}
      <div className="px-6 py-6">

        {/* Title row */}
        <div className="mb-6">
          <h1 className="text-xl font-black text-[#151c27] tracking-tight">Select a Branch</h1>
          <p className="text-xs text-[#777587] mt-0.5">Choose a branch workspace to enter. Use ⋮ on a card to manage it.</p>
        </div>

        {/* Active branches */}
        {activeBranches.length > 0 && (
          <div className="mb-8">
            <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              Active Branches
            </p>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {activeBranches.map(branch => (
                <BranchCard
                  key={branch.id}
                  branch={branch}
                  onSelect={handleSelect}
                  onManageHr={setHrBranch}
                  onEdit={setEditBranch}
                  onToggleStatus={requestStatusToggle}
                  disabled={false}
                  canManage={canManageBranch}
                  busy={toggleMut.isPending}
                />
              ))}
            </div>
          </div>
        )}

        {/* Inactive branches */}
        {inactiveBranches.length > 0 && (
          <div>
            <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
              Inactive Branches
            </p>
            <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {inactiveBranches.map(branch => (
                <BranchCard
                  key={branch.id}
                  branch={branch}
                  onSelect={handleSelect}
                  onManageHr={setHrBranch}
                  onEdit={setEditBranch}
                  onToggleStatus={requestStatusToggle}
                  disabled={true}
                  canManage={canManageBranch}
                  busy={toggleMut.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {addBranchOpen && (
        <BranchFormModal open onClose={() => setAddBranchOpen(false)} />
      )}
      {editBranch && (
        <BranchFormModal open onClose={() => setEditBranch(null)} branch={editBranch} />
      )}
      {hrBranch && (
        <ManageHrAdminsModal open onClose={() => setHrBranch(null)} branch={hrBranch} />
      )}

      {/* Activate / Deactivate confirmation — changes only branch status.
          No data is deleted, no employee assignment is touched. */}
      <ConfirmModal
        open={!!statusTarget}
        title={statusTarget?.nextIsActive
          ? `Activate ${statusTarget?.branch?.name}?`
          : `Deactivate ${statusTarget?.branch?.name}?`}
        message={statusTarget?.nextIsActive
          ? 'This branch will become an active workspace again and can be selected by HR admins with access.'
          : 'Employees and existing data will not be deleted. The branch will simply become inactive and will no longer be available as an active workspace.'}
        confirmLabel={statusTarget?.nextIsActive ? 'Activate' : 'Deactivate'}
        variant={statusTarget?.nextIsActive ? 'warning' : 'danger'}
        onConfirm={() => {
          if (statusTarget) toggleMut.mutate({ id: statusTarget.branch.id, is_active: statusTarget.nextIsActive });
        }}
        onCancel={() => setStatusTarget(null)}
      />
    </div>
  );
}
