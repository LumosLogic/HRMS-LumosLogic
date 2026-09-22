import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ShieldCheck, Mail, Building2, Check, Inbox, Eye, EyeOff, RefreshCw, AlertCircle } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { initials } from '@/lib/utils';

const AVATAR_COLORS = ['#3525cd','#4f46e5','#712ae2','#8a4cfc','#10B981','#F59E0B','#EF4444','#F97316'];
const INITIAL = { name:'', email:'', password:'', department:'Human Resources', position:'HR Manager', avatar_color:'#3525cd' };

function HRFormModal({ open, onClose, editing }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(editing || INITIAL);
  const [showPw, setShowPw] = useState(false);

  React.useEffect(() => { setForm(editing ? { ...editing, password: '' } : INITIAL); }, [editing]);

  const save = useMutation({
    mutationFn: () => {
      if (!form.email || !form.email.trim()) throw new Error('Email is required.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) throw new Error('Please enter a valid email address.');
      return editing
        ? apiPut(`/root/hr/${editing.id}`, form)
        : apiPost('/root/hr', form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['root-hr'] });
      qc.invalidateQueries({ queryKey: ['root-stats'] });
      toast(editing ? 'HR admin updated.' : 'HR admin created.', 'success');
      onClose();
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit HR Admin' : 'Add HR Admin'}
      footer={
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn btn-primary btn-sm">
            {save.isPending
              ? <span className="flex items-center gap-1.5"><span className="spinner w-3.5 h-3.5" /> Saving…</span>
              : <><Check size={14} /> {editing ? 'Update' : 'Create'}</>}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-black text-white flex-shrink-0"
            style={{ background: form.avatar_color }}>
            {initials(form.name || 'HR')}
          </div>
          <div className="flex gap-2 flex-wrap">
            {AVATAR_COLORS.map(c => (
              <button key={c} onClick={() => set('avatar_color', c)}
                className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{ background: c, borderColor: form.avatar_color === c ? '#fff' : 'transparent', outline: form.avatar_color === c ? `2px solid ${c}` : 'none', outlineOffset: '1px' }} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="form-label">Full Name</label>
            <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" />
          </div>
          <div className="col-span-2">
            <label className="form-label">Official Email</label>
            <input className="form-control" type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="hr@company.com" />
          </div>
          <div className="col-span-2">
            <label className="form-label">{editing ? 'New Password (leave blank to keep)' : 'Password'}</label>
            <div className="relative">
              <input className="form-control pr-10" type={showPw ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min. 6 characters" />
              <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">Department</label>
            <input className="form-control" value={form.department} onChange={e => set('department', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Position</label>
            <input className="form-control" value={form.position} onChange={e => set('position', e.target.value)} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function ManageHR() {
  const qc    = useQueryClient();
  const toast = useToast();
  const { selectedBranchId } = useBranch();

  const [modalOpen,    setModalOpen]    = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: hrList = [], isLoading } = useQuery({
    queryKey: ['root-hr', selectedBranchId],
    queryFn:  () => apiGet('/root/hr'),
  });

  const del = useMutation({
    mutationFn: (id) => apiDelete(`/root/hr/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['root-hr'] });
      qc.invalidateQueries({ queryKey: ['root-stats'] });
      toast('HR admin removed.', 'success');
      setDeleteTarget(null);
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const reactivate = useMutation({
    mutationFn: (id) => apiPut(`/root/hr/${id}/reactivate`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['root-hr'] });
      toast('Account reactivated successfully.', 'success');
    },
    onError: (e) => toast(e.message, 'error'),
  });

  function openAdd()    { setEditing(null); setModalOpen(true); }
  function openEdit(hr) { setEditing(hr);   setModalOpen(true); }

  return (
    <div>
      {/* Hero Banner */}
      <div className="rounded-xl p-6 mb-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #3525cd 0%, #4f46e5 50%, #712ae2 100%)' }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck size={14} className="text-white/70" />
              <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Manage HR Admins</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">HR Administrators</h1>
            <p className="text-white/75 text-sm mt-1">Create, edit, or remove HR administrator accounts.</p>
          </div>
          <button onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all"
            style={{ background: 'rgba(255,255,255,.15)', border: '1.5px solid rgba(255,255,255,.3)', color: 'white' }}>
            <Plus size={16} /> Add HR Admin
          </button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-20"><div className="spinner w-8 h-8" /></div>
      ) : hrList.length === 0 ? (
        <div className="card">
          <div className="empty-state py-16">
            <Inbox size={40} className="mx-auto mb-3 opacity-30" />
            <p className="font-semibold text-[#464555]">No HR admins yet</p>
            <p className="text-sm mt-1">Create the first HR admin account to get started.</p>
            <button onClick={openAdd} className="btn btn-primary btn-sm mt-4">
              <Plus size={14} /> Add First HR Admin
            </button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {hrList.map(hr => {
            const isInactive = hr.status === 'inactive';
            return (
              <div key={hr.id}
                className={`bg-white rounded-xl border shadow-sm p-5 transition-all duration-200 ${isInactive ? 'border-amber-300 opacity-80' : 'border-[#c7c4d8] hover:border-[#3525cd]/40 hover:shadow-md hover:-translate-y-0.5'}`}>
                <div className="h-[3px] -mx-5 -mt-5 mb-4 rounded-t-xl"
                  style={{ background: isInactive ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#3525cd,#4f46e5,#712ae2)' }} />

                {isInactive && (
                  <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                    <AlertCircle size={13} className="text-amber-600 flex-shrink-0" />
                    <span className="text-[0.7rem] font-bold text-amber-700 uppercase tracking-wide">Account Deactivated</span>
                  </div>
                )}

                <div className="flex items-start gap-3 mb-4">
                  <div className={isInactive ? 'opacity-50 grayscale' : ''}>
                    <Avatar name={hr.name} color={hr.avatar_color} size={48} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-[#151c27] text-[0.95rem] truncate">{hr.name}</p>
                    <p className="text-xs text-[#777587] truncate">{hr.position}</p>
                    <span className={`inline-block mt-1.5 text-[0.65rem] px-2 py-0.5 rounded-full font-bold uppercase tracking-wide border ${isInactive ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]'}`}>
                      {isInactive ? 'Deactivated' : 'HR Admin'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 mb-4 bg-[#f9f9ff] rounded-lg p-3 border border-[#f0f3ff]">
                  <div className="flex items-center gap-2 text-xs text-[#464555]">
                    <Mail size={12} className="text-[#777587] flex-shrink-0" />
                    <span className="truncate">{hr.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#464555]">
                    <Building2 size={12} className="text-[#777587] flex-shrink-0" />
                    <span className="truncate">{hr.department}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {isInactive ? (
                    <>
                      <button
                        onClick={() => reactivate.mutate(hr.id)}
                        disabled={reactivate.isPending}
                        className="btn btn-sm flex-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 transition-colors"
                      >
                        <RefreshCw size={13} />
                        {reactivate.isPending ? 'Reactivating…' : 'Reactivate Account'}
                      </button>
                      <button onClick={() => setDeleteTarget(hr)} className="btn btn-danger btn-sm px-3">
                        <Trash2 size={13} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => openEdit(hr)} className="btn btn-outline btn-sm flex-1 text-xs">
                        <Pencil size={13} /> Edit
                      </button>
                      <button onClick={() => setDeleteTarget(hr)} className="btn btn-danger btn-sm px-3">
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <HRFormModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove HR Admin"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setDeleteTarget(null)} className="btn btn-outline btn-sm">Cancel</button>
            <button onClick={() => del.mutate(deleteTarget.id)} disabled={del.isPending} className="btn btn-danger btn-sm">
              {del.isPending ? 'Removing…' : 'Yes, Remove'}
            </button>
          </div>
        }>
        <p className="text-[#464555] text-sm">
          Are you sure you want to remove <strong>{deleteTarget?.name}</strong> from the HR admin role? This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
