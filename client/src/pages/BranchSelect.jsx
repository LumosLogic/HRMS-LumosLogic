import React, { useEffect, useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, ArrowRight, MapPin, Plus, UserCheck, X,
  ToggleRight, ToggleLeft,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBranch } from '@/context/BranchContext';
import { useAuth } from '@/context/AuthContext';
import { useFeature, FeatureFlagsLoadedContext } from '@/context/FeatureFlagContext';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';

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

// ─── Inline Add Branch Modal ──────────────────────────────────────────────────

function AddBranchModal({ open, onClose }) {
  const toast = useToast();
  const { reloadBranches } = useBranch();
  const [form, setForm] = useState({ name: '', code: '', location: '', address: '', is_active: true });
  const [nameErr, setNameErr] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function handleClose() {
    setForm({ name: '', code: '', location: '', address: '', is_active: true });
    setNameErr('');
    onClose();
  }

  async function handleSubmit() {
    const name = form.name.trim();
    if (!name) { setNameErr('Branch name is required.'); return; }
    if (name.length < 2) { setNameErr('Branch name must be at least 2 characters.'); return; }
    if (name.length > 100) { setNameErr('Branch name cannot exceed 100 characters.'); return; }
    setNameErr('');
    setLoading(true);
    try {
      await apiPost('/branches', form);
      toast('Branch created!', 'success');
      reloadBranches();
      handleClose();
    } catch (err) {
      toast(err.message || 'Failed to create branch.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Add Branch" size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={handleClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={loading || !form.name.trim()}>
            {loading ? <><span className="spinner w-4 h-4" />Creating…</> : 'Create Branch'}
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
          <button type="button" onClick={() => set('is_active', !form.is_active)}>
            {form.is_active
              ? <ToggleRight size={32} className="text-[#3525cd]" />
              : <ToggleLeft  size={32} className="text-[#c7c4d8]" />}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── HR Assign Modal ──────────────────────────────────────────────────────────

function HRAssignModal({ open, onClose, branch }) {
  const toast = useToast();
  const qc    = useQueryClient();

  const { data: hrUsers = [] } = useQuery({
    queryKey: ['hr-users-for-branch-access'],
    queryFn:  () => apiGet('/employees', { role: 'admin' }),
    enabled:  open,
    select:   d => (Array.isArray(d) ? d : []).filter(u => u.role === 'admin'),
  });

  const { data: accessData, isLoading: accessLoading } = useQuery({
    queryKey: ['branch-hr-access-users', branch?.id],
    queryFn:  () => apiGet('/branches/user-access-by-branch/' + branch.id),
    enabled:  open && !!branch?.id,
  });
  const usersWithAccess = accessData?.users || [];

  const grantMut = useMutation({
    mutationFn: ({ userId }) => apiPost('/branches/user-access', { userId, branchId: branch.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branch-hr-access-users', branch?.id] });
      toast('Access granted', 'success');
    },
    onError: e => toast(e.message, 'error'),
  });

  const revokeMut = useMutation({
    mutationFn: ({ userId }) => apiDelete(`/branches/user-access/${userId}/branch/${branch.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branch-hr-access-users', branch?.id] });
      toast('Access revoked', 'warning');
    },
    onError: e => toast(e.message, 'error'),
  });

  const userIdsWithAccess = new Set(usersWithAccess.map(u => u.user_id));
  const eligibleHRUsers   = hrUsers.filter(u => !userIdsWithAccess.has(u.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`HR Access — ${branch?.name || ''}`}
      size="md"
      footer={<div className="flex justify-end"><button className="btn btn-outline" onClick={onClose}>Close</button></div>}
    >
      <div className="space-y-5">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-[#777587] mb-2">Has Access</p>
          {accessLoading ? (
            <div className="text-xs text-[#777587] py-2">Loading…</div>
          ) : usersWithAccess.length === 0 ? (
            <p className="text-xs text-[#777587] italic py-2">No HR users have access to this branch yet.</p>
          ) : (
            <div className="space-y-2">
              {usersWithAccess.map(u => (
                <div key={u.user_id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#f0f3ff] border border-[#3525cd]/10">
                  <UserCheck size={14} className="text-[#3525cd] flex-shrink-0" />
                  <span className="text-sm font-semibold text-[#151c27] flex-1">{u.user_name}</span>
                  {u.all_branches && (
                    <span className="text-[0.65rem] font-bold bg-[#3525cd]/10 text-[#3525cd] px-1.5 py-0.5 rounded">All Branches</span>
                  )}
                  {!u.all_branches && (
                    <button
                      onClick={() => revokeMut.mutate({ userId: u.user_id })}
                      disabled={revokeMut.isPending}
                      className="p-1 rounded text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors"
                      title="Revoke access"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {eligibleHRUsers.length > 0 && (
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-[#777587] mb-2">Grant Access</p>
            <div className="space-y-1.5 max-h-44 overflow-y-auto">
              {eligibleHRUsers.map(u => (
                <div key={u.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f9f9ff]">
                  <span className="text-sm text-[#464555] flex-1">{u.name}</span>
                  <button
                    onClick={() => grantMut.mutate({ userId: u.id })}
                    disabled={grantMut.isPending}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-[#3525cd] text-white hover:bg-[#2a1eaa] transition-colors disabled:opacity-50"
                  >
                    Grant
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Branch Card ──────────────────────────────────────────────────────────────

function BranchCard({ branch, onSelect, onAssignHR, disabled }) {
  return (
    <div className={`relative bg-white rounded-2xl border shadow-sm p-6 transition-all
      ${disabled
        ? 'border-[#c7c4d8] opacity-55 cursor-not-allowed'
        : 'border-[#c7c4d8] hover:border-[#3525cd]/50 hover:shadow-md cursor-pointer group'
      }`}
    >
      {/* HR assign button — top-right corner */}
      <button
        onClick={e => { e.stopPropagation(); onAssignHR(branch); }}
        className="absolute top-3 right-3 p-1.5 rounded-lg text-[#777587] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors"
        title="Assign HR Manager"
      >
        <UserCheck size={14} />
      </button>

      <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-colors
        ${disabled ? 'bg-[#f5f5f5]' : 'bg-[#f0f3ff] group-hover:bg-[#3525cd]/10'}`}>
        <Building2 size={20} className={disabled ? 'text-[#aaa]' : 'text-[#3525cd]'} />
      </div>

      <h3 className="text-base font-black text-[#151c27] mb-1 leading-tight pr-6">{branch.name}</h3>

      {branch.code && (
        <p className="text-[0.7rem] font-semibold text-[#3525cd] uppercase tracking-wider mb-1">{branch.code}</p>
      )}

      {(branch.location || branch.address) ? (
        <div className="flex items-start gap-1.5 text-[#777587] text-xs mb-4">
          <MapPin size={11} className="flex-shrink-0 mt-0.5" />
          <span className="line-clamp-2">{branch.location || branch.address}</span>
        </div>
      ) : (
        <div className="mb-4" />
      )}

      {disabled ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-500 border border-slate-200">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" /> Inactive
        </span>
      ) : (
        <button
          onClick={() => onSelect(branch.id)}
          className="flex items-center gap-1.5 text-[#3525cd] text-xs font-bold group-hover:gap-2.5 transition-all"
        >
          Select <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BranchSelect() {
  const navigate      = useNavigate();
  const { user }      = useAuth();
  const branchesEnabled = useFeature('branches');
  const flagsLoaded   = useContext(FeatureFlagsLoadedContext);
  const {
    accessibleBranches,
    setSelectedBranchId,
    branchesLoaded,
    isLoading,
    reloadBranches,
  } = useBranch();

  const [addBranchOpen, setAddBranchOpen] = useState(false);
  const [hrBranch,      setHrBranch]      = useState(null);

  // Inline create state for the "0 branches" case
  const [createName,    setCreateName]    = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError,   setCreateError]   = useState('');

  const orgName = user?.organization_name || 'Your Organization';

  // Branches feature OFF → redirect
  useEffect(() => {
    if (flagsLoaded && !branchesEnabled) {
      navigate('/root/dashboard', { replace: true });
    }
  }, [flagsLoaded, branchesEnabled, navigate]);

  function handleSelect(branchId) {
    setSelectedBranchId(branchId);
    navigate('/root/dashboard', { replace: true });
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

  const activeBranches   = accessibleBranches.filter(b => b.is_active !== false);
  const inactiveBranches = accessibleBranches.filter(b => b.is_active === false);

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

  // ── Active + Inactive branch grid ─────────────────────────────────────────
  const gridClass = (count) =>
    count === 1 ? 'grid-cols-1 max-w-xs' :
    count === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className="min-h-screen bg-[#f9f9ff] flex flex-col items-center px-6 py-10">
      {/* Header */}
      <div className="w-full max-w-3xl mb-8">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#3525cd] flex items-center justify-center shadow-md shadow-[#3525cd]/20 flex-shrink-0">
              <Building2 size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-[#151c27] leading-tight">{orgName}</h2>
              <p className="text-[0.65rem] text-[#777587]">Root Admin Console</p>
            </div>
          </div>

          <button
            onClick={() => setAddBranchOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-[#3525cd] text-white hover:bg-[#4f46e5] transition-colors"
          >
            <Plus size={13} /> Add Branch
          </button>
        </div>

        <div className="text-center mb-2">
          <h1 className="text-2xl font-black text-[#151c27] tracking-tight mb-1">Select a Branch</h1>
          <p className="text-[#777587] text-sm">Choose the branch workspace to enter. You can switch branches anytime from the sidebar.</p>
        </div>

        {/* Summary counts */}
        <div className="flex items-center justify-center gap-4 mt-3">
          <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
            {activeBranches.length} Active
          </span>
          {inactiveBranches.length > 0 && (
            <span className="text-xs font-semibold text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
              {inactiveBranches.length} Inactive
            </span>
          )}
        </div>
      </div>

      {/* Active branches */}
      {activeBranches.length > 0 && (
        <div className="w-full max-w-3xl mb-8">
          <p className="text-xs font-black uppercase tracking-wider text-[#777587] mb-3">Active Branches</p>
          <div className={`grid gap-4 ${gridClass(activeBranches.length)}`}>
            {activeBranches.map(branch => (
              <BranchCard
                key={branch.id}
                branch={branch}
                onSelect={handleSelect}
                onAssignHR={setHrBranch}
                disabled={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* Inactive branches */}
      {inactiveBranches.length > 0 && (
        <div className="w-full max-w-3xl">
          <p className="text-xs font-black uppercase tracking-wider text-[#777587] mb-3">Inactive Branches</p>
          <div className={`grid gap-4 ${gridClass(inactiveBranches.length)}`}>
            {inactiveBranches.map(branch => (
              <BranchCard
                key={branch.id}
                branch={branch}
                onSelect={handleSelect}
                onAssignHR={setHrBranch}
                disabled={true}
              />
            ))}
          </div>
        </div>
      )}

      {addBranchOpen && (
        <AddBranchModal open onClose={() => setAddBranchOpen(false)} />
      )}
      {hrBranch && (
        <HRAssignModal open onClose={() => setHrBranch(null)} branch={hrBranch} />
      )}
    </div>
  );
}
