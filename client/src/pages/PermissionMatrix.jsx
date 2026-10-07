import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Shield, Lock, Pencil, X, AlertCircle, CheckCircle2, Users } from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
import PermissionPicker, { flattenCatalog } from '@/components/rbac/PermissionPicker';
import { cn } from '@/lib/utils';

// ─── Edit Role Modal (name + description, custom roles only) ──────────────────
function EditRoleModal({ role, onClose, onSaved }) {
  const [name, setName]   = useState(role.name || '');
  const [desc, setDesc]   = useState(role.description || '');
  const [error, setError] = useState('');
  const qc                = useQueryClient();

  const mut = useMutation({
    mutationFn: () => apiPut(`/roles/${role.id}`, { name: name.trim(), description: desc.trim() }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['role', String(role.id)] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      onSaved(updated);
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const trimmed = name.trim();
    if (!trimmed) { setError('Role name is required'); return; }
    if (trimmed.length < 2) { setError('Must be at least 2 characters'); return; }
    if (trimmed.length > 50) { setError('Must be 50 characters or fewer'); return; }
    if (/[^a-zA-Z0-9\s\-_]/.test(trimmed)) { setError('Only letters, numbers, spaces, hyphens, and underscores allowed'); return; }
    mut.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#c7c4d8]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#3525cd]/10 flex items-center justify-center"><Pencil size={15} className="text-[#3525cd]" /></div>
            <h2 className="font-black text-[#151c27] text-base">Edit Role</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center"><X size={16} className="text-[#777587]" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-[#464555] mb-1.5">Role Name <span className="text-rose-500">*</span></label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={50} placeholder="e.g. Finance Manager"
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20" />
          </div>
          <div>
            <label className="block text-xs font-bold text-[#464555] mb-1.5">Description <span className="text-[#c7c4d8] font-normal">(optional)</span></label>
            <textarea value={desc} onChange={e => setDesc(e.target.value.slice(0, 500))} rows={3} maxLength={500} placeholder="What does this role do?"
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2.5 text-sm text-[#151c27] resize-none focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20" />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={13} /> {error}</div>
          )}
          <div className="flex gap-2.5 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border border-[#c7c4d8] rounded-lg py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">Cancel</button>
            <button type="submit" disabled={mut.isPending || !name.trim()}
              className="flex-1 bg-[#3525cd] text-white rounded-lg py-2.5 text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-50 disabled:cursor-not-allowed">
              {mut.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Manage Role page ─────────────────────────────────────────────────────────
// Custom roles: editable permissions. System roles: read-only view (predefined + protected).
export default function PermissionMatrix() {
  const { id }      = useParams();
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const [selectedIds, setSelectedIds]   = useState(new Set());
  const [dirty, setDirty]               = useState(false);
  const [toast, setToast]               = useState(null);
  const [showEditRole, setShowEditRole] = useState(false);

  const { data: role, isLoading: roleLoading, isError: roleError } = useQuery({
    queryKey: ['role', id],
    queryFn: () => apiGet(`/roles/${id}`),
    retry: 1,
  });
  const { data: catalog = [], isLoading: permsLoading, isError: permsError } = useQuery({
    queryKey: ['all-permissions'],
    queryFn: () => apiGet('/permissions'),
    retry: 1,
  });

  // Warn about unsaved changes on tab close / reload
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const permissionKey = role?.permission_ids?.join(',');
  useEffect(() => {
    if (role && Array.isArray(role.permission_ids)) {
      setSelectedIds(new Set(role.permission_ids));
      setDirty(false);
    }
  }, [permissionKey]); // eslint-disable-line

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  const saveMutation = useMutation({
    mutationFn: () => apiPut(`/roles/${id}/permissions`, { permission_ids: Array.from(selectedIds) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['role', id] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setDirty(false);
      showToast('Permissions saved');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  const back = (
    <button onClick={() => navigate('/root/roles')} className="flex items-center gap-1.5 text-xs text-[#777587] hover:text-[#3525cd] mb-3 font-semibold">
      <ArrowLeft size={13} /> Back to Roles
    </button>
  );

  if (roleError || permsError) {
    return (
      <div className="w-full">{back}
        <div className="bg-white border border-red-200 rounded-2xl p-10 text-center">
          <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
          <h2 className="font-black text-[#151c27] mb-2">Failed to load role</h2>
          <button onClick={() => window.location.reload()} className="bg-[#3525cd] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-[#2a1fb0]">Retry</button>
        </div>
      </div>
    );
  }
  if (roleLoading || permsLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 bg-[#f0f3ff] rounded-xl" />
        {[1, 2, 3].map(i => <div key={i} className="h-24 bg-white border border-[#e7eefe] rounded-xl" />)}
      </div>
    );
  }
  // Root Admin has full access and no configurable permission list.
  if (!role || role.slug === 'root_admin') {
    return (
      <div className="text-center py-16">
        <p className="text-[#777587]">Role not found.</p>
        <button onClick={() => navigate('/root/roles')} className="text-[#3525cd] text-sm font-bold mt-2 hover:underline">← Back to Roles</button>
      </div>
    );
  }

  // Manager and Department Head are the only system roles whose permissions Root Admin can edit (membership is derived).
  const isTeamRole = !!role.is_system_role && (role.slug === 'manager' || role.slug === 'dept_head');
  const isSystem = !!role.is_system_role && !isTeamRole; // locked system role
  const isSystemBadge = !!role.is_system_role;
  const total    = flattenCatalog(catalog).length;

  return (
    <div className="w-full">
      {back}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-[#3525cd]/10 flex items-center justify-center flex-shrink-0">
            {isSystemBadge ? <Lock size={17} className="text-[#3525cd]" /> : <Shield size={17} className="text-[#3525cd]" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-[#151c27] truncate">{role.name}</h1>
              <span className={cn('text-[0.6rem] font-black tracking-wider px-1.5 py-0.5 rounded-full', isSystemBadge ? 'bg-purple-50 text-purple-600' : 'bg-[#f0f3ff] text-[#3525cd]')}>
                {isSystemBadge ? 'SYSTEM' : 'CUSTOM'}
              </span>
              {!isSystemBadge && (
                <button onClick={() => setShowEditRole(true)} title="Edit role name and description"
                  className="w-7 h-7 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center"><Pencil size={13} className="text-[#777587]" /></button>
              )}
            </div>
            {role.description && <p className="text-sm text-[#777587] mt-0.5">{role.description}</p>}
          </div>
        </div>
        {/* Read-only: who has this role is managed from the Roles list ("Assign"), not from Manage. */}
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[#777587] whitespace-nowrap pt-2">
          <Users size={13} /> {role.members?.length ?? 0} user{(role.members?.length ?? 0) === 1 ? '' : 's'}
        </span>
      </div>

      {isSystem && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex items-center gap-3">
          <Lock size={15} className="text-amber-500 flex-shrink-0" />
          <p className="text-xs text-amber-700 font-semibold">
            System roles are predefined and cannot be customized. To vary this access, create a custom role from it on the Role Management page.
          </p>
        </div>
      )}

      {isTeamRole && (
        <div className="bg-[#f0f3ff] border border-[#c7c4d8] rounded-xl px-4 py-3 mb-5 flex items-center gap-3">
          <Users size={15} className="text-[#3525cd] flex-shrink-0" />
          <p className="text-xs text-[#464555] font-semibold">
            This role is applied automatically — {role.slug === 'manager' ? 'to anyone who is the reporting manager of at least one employee' : 'to anyone set as a department head'}. Changes here take effect for them immediately (sidebar, pages and API access).
          </p>
        </div>
      )}

      <div className={cn(!isSystem && 'pb-24')}>
        <PermissionPicker
          catalog={catalog}
          selectedIds={selectedIds}
          readOnly={isSystem}
          onChange={(next) => { setSelectedIds(next); setDirty(true); }}
        />
      </div>

      {!isSystem && (
        <div className="fixed bottom-0 left-0 md:left-64 right-0 z-20 bg-white border-t border-[#e7eefe] py-3 px-4 md:px-7 flex items-center justify-between shadow-lg">
          <p className="text-xs text-[#777587] font-semibold">
            {dirty ? 'You have unsaved permission changes.' : `${selectedIds.size} of ${total} permissions enabled`}
          </p>
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/root/roles')}
              className="border border-[#c7c4d8] rounded-lg px-4 py-2 text-xs font-semibold text-[#464555] hover:bg-[#f0f3ff]">
              Cancel
            </button>
            <button onClick={() => saveMutation.mutate()} disabled={!dirty || saveMutation.isPending}
              className="bg-[#3525cd] text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-[#2a1fb0] disabled:opacity-50 disabled:cursor-not-allowed">
              {saveMutation.isPending ? 'Saving…' : 'Save Permissions'}
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={cn('fixed bottom-20 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold border bg-white',
          toast.type === 'success' ? 'border-green-200 text-green-700' : 'border-red-200 text-red-600')}>
          {toast.type === 'success' ? <CheckCircle2 size={16} className="text-green-500" /> : <AlertCircle size={16} className="text-red-500" />}
          {toast.message}
        </div>
      )}

      {showEditRole && !isSystemBadge && <EditRoleModal role={role} onClose={() => setShowEditRole(false)} onSaved={() => showToast('Role updated')} />}
    </div>
  );
}
