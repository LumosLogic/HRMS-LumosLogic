import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Building2, MapPin, ToggleLeft, ToggleRight,
  ShieldCheck, X, UserCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

// ─── Branch Create/Edit Modal ─────────────────────────────────────────────────

function BranchModal({ open, onClose, branch }) {
  const toast           = useToast();
  const qc              = useQueryClient();
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

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const [nameErr, setNameErr] = useState('');

  const mut = useMutation({
    mutationFn: () => isEdit ? apiPut(`/branches/${branch.id}`, form) : apiPost('/branches', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branches'] });
      reloadBranches(); // sync the sidebar branch selector (BranchContext uses apiGet, not React Query)
      toast(isEdit ? 'Branch updated!' : 'Branch created!', 'success');
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  // BUG_063: Client-side validation
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
          <button className="btn btn-primary" onClick={handleSubmit} disabled={mut.isPending || !form.name}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : isEdit ? 'Save Changes' : 'Create Branch'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Branch Name <span className="text-rose-500">*</span></label>
            <input className={`form-control ${nameErr ? 'border-rose-400' : ''}`} placeholder="e.g. Head Office" value={form.name} onChange={e => { set('name', e.target.value); if (nameErr) setNameErr(''); }} />
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
          <button type="button" onClick={() => set('is_active', !form.is_active)}
            className="flex-shrink-0">
            {form.is_active
              ? <ToggleRight size={32} className="text-[#3525cd]" />
              : <ToggleLeft size={32} className="text-[#c7c4d8]" />}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── HR Access Management Modal ───────────────────────────────────────────────

function HRAccessModal({ open, onClose, branch }) {
  const toast = useToast();
  const qc    = useQueryClient();

  // Fetch HR users in this org
  const { data: hrUsers = [] } = useQuery({
    queryKey: ['hr-users-for-branch-access'],
    queryFn: () => apiGet('/employees', { role: 'admin' }),
    enabled: open,
    select: d => (Array.isArray(d) ? d : []).filter(u => u.role === 'admin'),
  });

  // Fetch who currently has access to this branch
  const { data: accessData, isLoading: accessLoading } = useQuery({
    queryKey: ['branch-hr-access-users', branch?.id],
    queryFn: () => apiGet('/branches/user-access-by-branch/' + branch.id),
    enabled: open && !!branch?.id,
  });
  const usersWithAccess = accessData?.users || [];

  // Grant access mutation
  const grantMut = useMutation({
    mutationFn: ({ userId }) => apiPost('/branches/user-access', { userId, branchId: branch.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branch-hr-access-users', branch?.id] });
      qc.invalidateQueries({ queryKey: ['branches'] });
      toast('Access granted', 'success');
    },
    onError: e => toast(e.message, 'error'),
  });

  // Revoke access mutation
  const revokeMut = useMutation({
    mutationFn: ({ userId }) => apiDelete(`/branches/user-access/${userId}/branch/${branch.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branch-hr-access-users', branch?.id] });
      qc.invalidateQueries({ queryKey: ['branches'] });
      toast('Access revoked', 'warning');
    },
    onError: e => toast(e.message, 'error'),
  });

  const userIdsWithAccess = new Set(usersWithAccess.map(u => u.user_id));

  const eligibleHRUsers = hrUsers.filter(u => !userIdsWithAccess.has(u.id));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`HR Access — ${branch?.name || ''}`}
      size="md"
      footer={
        <div className="flex justify-end">
          <button className="btn btn-outline" onClick={onClose}>Close</button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Users currently with access */}
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

        {/* Grant access to HR users */}
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

// ─── Main Branches Page ───────────────────────────────────────────────────────

export default function Branches() {
  const { isAdmin, isRootAdmin } = useAuth();
  const toast = useToast();
  const qc    = useQueryClient();
  const { reloadBranches } = useBranch();
  const [addOpen,      setAddOpen]      = useState(false);
  const [editBranch,   setEditBranch]   = useState(null);
  const [confirmDel,   setConfirmDel]   = useState(null);
  const [accessBranch, setAccessBranch] = useState(null); // for HR access modal

  const { data: _data, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => apiGet('/branches'),
  });
  const branches = Array.isArray(_data) ? _data : [];

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/branches/${id}`),
    onSuccess: () => {
      toast('Branch deleted', 'warning');
      qc.invalidateQueries({ queryKey: ['branches'] });
      reloadBranches();
    },
    onError: e => toast(e.message, 'error'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => apiPut(`/branches/${id}`, { is_active }),
    onSuccess: (_, { is_active }) => {
      toast(is_active ? 'Branch activated' : 'Branch deactivated', 'success');
      qc.invalidateQueries({ queryKey: ['branches'] });
      reloadBranches();
    },
    onError: e => toast(e.message, 'error'),
  });

  const active   = branches.filter(b => b.is_active !== false).length;
  const inactive = branches.filter(b => b.is_active === false).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Branches</h1>
          <p className="page-subtitle">{branches.length} branch{branches.length !== 1 ? 'es' : ''} · manage office locations</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={16} /> Add Branch
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Branches', value: branches.length, color: 'from-[#f0f3ff] to-[#e7eefe]', top: '#3525cd', text: 'text-[#3525cd]' },
          { label: 'Active',         value: active,          color: 'from-emerald-50 to-emerald-100', top: '#10B981', text: 'text-emerald-700' },
          { label: 'Inactive',       value: inactive,        color: 'from-slate-50 to-slate-100',     top: '#94a3b8', text: 'text-slate-600' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-5 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-sm relative overflow-hidden`}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
            <div className={`text-3xl font-black leading-none ${s.text}`}>{s.value}</div>
            <div className="text-[0.7rem] font-bold uppercase tracking-wider text-[#777587] mt-1.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading branches…</div>
      ) : branches.length === 0 ? (
        <div className="empty-state">
          <Building2 size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">No branches found</p>
          <p className="text-sm mb-4">Add your first branch to manage office locations</p>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Add First Branch
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f8f9fe] border-b border-[#e7eefe]">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Code</th>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Location</th>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Status</th>
                  {isRootAdmin && <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">HR Admins</th>}
                  {isAdmin && <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {branches.map(b => (
                  <tr key={b.id} className="hover:bg-[#f9f9ff] transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-xs font-bold bg-[#f0f3ff] text-[#3525cd] px-2 py-0.5 rounded">
                        {b.code || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                          <Building2 size={13} className="text-[#3525cd]" />
                        </div>
                        <span className="font-bold text-[#151c27]">{b.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {b.location ? (
                        <div className="flex items-center gap-1.5 text-xs text-[#464555]">
                          <MapPin size={12} className="text-[#777587]" />
                          {b.location}
                        </div>
                      ) : (
                        <span className="text-[#c7c4d8] text-xs">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      {b.is_active !== false ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-50 text-slate-500 border border-slate-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" /> Inactive
                        </span>
                      )}
                    </td>
                    {isRootAdmin && (
                      <td className="px-5 py-3.5">
                        {(b.hr_admin_count ?? 0) === 0 ? (
                          <span className="text-xs text-[#c7c4d8] italic">None</span>
                        ) : (
                          <button
                            onClick={() => setAccessBranch(b)}
                            className="group flex items-center gap-1.5 text-left"
                            title="Click to manage HR access"
                          >
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-[#f0f3ff] text-[#3525cd] border border-[#3525cd]/20 group-hover:bg-[#3525cd]/10 transition-colors">
                              <UserCheck size={10} />
                              {b.hr_admin_count}
                            </span>
                            {b.hr_admin_names && b.hr_admin_names.length > 0 && (
                              <span className="text-xs text-[#777587] truncate max-w-[120px]" title={(b.hr_admin_names || []).join(', ')}>
                                {b.hr_admin_names[0]}{b.hr_admin_names.length > 1 ? ` +${b.hr_admin_names.length - 1}` : ''}
                              </span>
                            )}
                          </button>
                        )}
                      </td>
                    )}
                    {isAdmin && (
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1">
                          {/* HR Access management — root admin only */}
                          {isRootAdmin && (
                            <button
                              onClick={() => setAccessBranch(b)}
                              className="p-1.5 rounded-lg text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors"
                              title="Manage HR access"
                            >
                              <ShieldCheck size={13} />
                            </button>
                          )}
                          {/* Quick activate/deactivate */}
                          <button
                            onClick={() => toggleMut.mutate({ id: b.id, is_active: !b.is_active })}
                            disabled={toggleMut.isPending}
                            className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                            title={b.is_active !== false ? 'Deactivate' : 'Activate'}
                          >
                            {b.is_active !== false
                              ? <ToggleRight size={16} className="text-[#3525cd]" />
                              : <ToggleLeft  size={16} className="text-[#c7c4d8] hover:text-[#3525cd]" />}
                          </button>
                          <button onClick={() => setEditBranch(b)}
                            className="p-1.5 rounded-lg text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors" title="Edit">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setConfirmDel({ id: b.id, name: b.name })}
                            className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" title="Delete">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addOpen    && <BranchModal open onClose={() => setAddOpen(false)} />}
      {editBranch && <BranchModal open onClose={() => setEditBranch(null)} branch={editBranch} />}
      {accessBranch && (
        <HRAccessModal open onClose={() => setAccessBranch(null)} branch={accessBranch} />
      )}

      <ConfirmModal
        open={!!confirmDel}
        title="Delete Branch"
        message={`Permanently delete branch "${confirmDel?.name}"? Employees assigned to this branch will be unlinked.`}
        confirmLabel="Delete"
        onConfirm={() => { delMut.mutate(confirmDel.id); setConfirmDel(null); }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
