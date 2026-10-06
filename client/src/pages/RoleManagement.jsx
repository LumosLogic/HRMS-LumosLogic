import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { BRANCH_KEYED } from '@/lib/queryScopes';
import { Shield, Plus, Trash2, Users, Lock, AlertCircle, CheckCircle2, X, Copy } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import PermissionPicker from '@/components/rbac/PermissionPicker';
import AssignUsersModal from '@/components/rbac/AssignUsersModal';
import { cn } from '@/lib/utils';

function validateRoleName(val) {
  if (!val || !val.trim()) return 'Role name is required';
  if (val.trim().length < 2) return 'Must be at least 2 characters';
  if (val.trim().length > 50) return 'Must be 50 characters or fewer';
  if (/[^a-zA-Z0-9\s\-_]/.test(val)) return 'Only letters, numbers, spaces, hyphens, and underscores are allowed';
  return '';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function Badge({ system }) {
  return (
    <span className={cn(
      'inline-flex items-center text-[0.6rem] font-black tracking-wider px-1.5 py-0.5 rounded-full',
      system ? 'bg-purple-50 text-purple-600' : 'bg-[#f0f3ff] text-[#3525cd]'
    )}>
      {system ? 'SYSTEM' : 'CUSTOM'}
    </span>
  );
}

// ─── Create Role Modal ────────────────────────────────────────────────────────
// `templateRole` pre-selects a "start from" role (used by "Create custom role" on a system role).
function CreateRoleModal({ roles, templateRole, onClose, onCreated }) {
  const [name, setName]         = useState(templateRole ? `${templateRole.name} - Limited` : '');
  const [desc, setDesc]         = useState('');
  const [fromId, setFromId]     = useState(templateRole ? String(templateRole.id) : '');
  const [selected, setSelected] = useState(new Set());
  const [error, setError]       = useState('');
  const [saving, setSaving]     = useState(false);
  const nameErr = name ? validateRoleName(name) : '';

  const { data: catalog = [] } = useQuery({ queryKey: ['all-permissions'], queryFn: () => apiGet('/permissions'), retry: 1 });

  // Copy the chosen role's permissions into the (editable) selection. The source role is only read.
  useEffect(() => {
    if (!fromId) return;
    let cancelled = false;
    apiGet(`/roles/${fromId}`)
      .then(r => { if (!cancelled) setSelected(new Set(r.permission_ids || [])); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [fromId]);

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validateRoleName(name);
    if (err) return;
    setSaving(true); setError('');
    try {
      const role = await apiPost('/roles', {
        name: name.trim(), description: desc.trim(), permission_ids: [...selected],
      });
      onCreated(role);
    } catch (e2) { setError(e2.message); } finally { setSaving(false); }
  }

  const templates = roles.filter(r => r.slug !== 'root_admin');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl border border-[#c7c4d8] flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#3525cd]/10 flex items-center justify-center"><Shield size={16} className="text-[#3525cd]" /></div>
            <h2 className="font-black text-[#151c27] text-base">Create Custom Role</h2>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center"><X size={16} className="text-[#777587]" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#464555] mb-1.5">Role Name <span className="text-rose-500">*</span></label>
              <input autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={50} placeholder="e.g. Payroll Manager"
                className={cn('w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1',
                  nameErr ? 'border-rose-400 focus:ring-rose-200' : 'border-[#c7c4d8] focus:border-[#3525cd] focus:ring-[#3525cd]/20')} />
              {nameErr && <p className="text-[0.68rem] text-rose-600 mt-1">{nameErr}</p>}
            </div>
            <div>
              <label className="block text-xs font-bold text-[#464555] mb-1.5">Start from <span className="text-[#c7c4d8] font-normal">(optional)</span></label>
              <select value={fromId} onChange={e => { setFromId(e.target.value); if (!e.target.value) setSelected(new Set()); }}
                className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-[#3525cd]">
                <option value="">Blank — no permissions</option>
                {templates.map(r => <option key={r.id} value={r.id}>{r.name}{r.is_system_role ? ' (system)' : ''}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#464555] mb-1.5">Description <span className="text-[#c7c4d8] font-normal">(optional)</span></label>
            <textarea value={desc} onChange={e => setDesc(e.target.value.slice(0, 500))} rows={2} maxLength={500}
              placeholder="What does this role do? Who should have it?"
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-[#777587] mb-2">Permissions</p>
            <PermissionPicker catalog={catalog} selectedIds={selected} onChange={setSelected} />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertCircle size={13} /> {error}</div>
          )}
        </div>

        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-[#e7eefe]">
          <button type="button" onClick={onClose} className="border border-[#c7c4d8] rounded-lg px-5 py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">Cancel</button>
          <button type="submit" disabled={saving || !name.trim() || !!nameErr}
            className="bg-[#3525cd] text-white rounded-lg px-5 py-2.5 text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? 'Creating…' : 'Create Role'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ role, onCancel, onConfirm, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-[#c7c4d8] p-6">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4"><Trash2 size={22} className="text-red-500" /></div>
        <h3 className="text-center font-black text-[#151c27] mb-1">Delete Role</h3>
        <p className="text-center text-sm text-[#777587] mb-6">
          Delete <strong className="text-[#151c27]">{role.name}</strong> and its permissions? This cannot be undone.
        </p>
        <div className="flex gap-2.5">
          <button onClick={onCancel} className="flex-1 border border-[#c7c4d8] rounded-lg py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">Cancel</button>
          <button onClick={onConfirm} disabled={loading} className="flex-1 bg-red-500 text-white rounded-lg py-2.5 text-sm font-bold hover:bg-red-600 disabled:opacity-60">
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RoleManagement() {
  const navigate    = useNavigate();
  const queryClient = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [createFor, setCreateFor]       = useState(null);  // null | { template: role|null }
  const [assignRole, setAssignRole]     = useState(null);
  const [deleteRole, setDeleteRole]     = useState(null);
  const [toast, setToast]               = useState(null);

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles', selectedBranchId],
    meta: BRANCH_KEYED, placeholderData: keepPreviousData,
    queryFn: () => apiGet('/roles'),
  });

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  const deleteMutation = useMutation({
    mutationFn: (id) => apiDelete(`/roles/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['roles'] }); showToast('Role deleted'); },
    onError: (err) => showToast(err.message, 'error'),
    onSettled: () => setDeleteRole(null),
  });

  // Root Admin is never shown as a role; it has full access without a permission list.
  const customRoles = roles.filter(r => !r.is_system_role);
  const systemRoles = roles.filter(r => r.is_system_role && r.slug !== 'root_admin');
  const manage = (role) => navigate(`/root/roles/${role.id}/permissions`);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-[#3525cd]/10 flex items-center justify-center"><Shield size={17} className="text-[#3525cd]" /></div>
            <h1 className="text-xl font-black text-[#151c27]">Role Management</h1>
          </div>
          <p className="text-sm text-[#777587]">Create and manage custom roles and their permissions.</p>
        </div>
        <button onClick={() => setCreateFor({ template: null })}
          className="flex items-center gap-2 bg-[#3525cd] text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-[#2a1fb0] shadow-sm whitespace-nowrap">
          <Plus size={16} /> Create Role
        </button>
      </div>

      {/* Custom roles */}
      <h2 className="text-xs font-black uppercase tracking-widest text-[#777587] mb-3">Custom Roles</h2>
      {isLoading ? (
        <div className="bg-white border border-[#e7eefe] rounded-xl p-6 animate-pulse space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-9 bg-[#f0f3ff] rounded" />)}
        </div>
      ) : customRoles.length === 0 ? (
        <div className="bg-white border border-dashed border-[#c7c4d8] rounded-xl p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#f0f3ff] flex items-center justify-center mx-auto mb-3"><Plus size={22} className="text-[#3525cd]/50" /></div>
          <button onClick={() => setCreateFor({ template: null })} className="text-sm font-bold text-[#3525cd] hover:underline">+ Create your first custom role</button>
          <p className="text-xs text-[#777587] mt-1">Create a role for specific responsibilities.</p>
        </div>
      ) : (
        <div className="bg-white border border-[#e7eefe] rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="bg-[#f9f9ff] text-left text-[0.68rem] font-black uppercase tracking-wider text-[#777587]">
                <th className="px-4 py-3">Role Name</th>
                <th className="px-4 py-3">Permissions</th>
                <th className="px-4 py-3">Users</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customRoles.map(role => {
                const members = role.member_count || 0;
                return (
                  <tr key={role.id} className="border-t border-[#f0f3ff] hover:bg-[#f9f9ff]">
                    <td className="px-4 py-3 max-w-[280px]">
                      <div className="flex items-center gap-2">
                        <span title={role.name} className="font-bold text-[#151c27] truncate">{role.name}</span>
                        <Badge />
                      </div>
                      {role.description && <p title={role.description} className="text-xs text-[#777587] truncate mt-0.5">{role.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-[#464555] whitespace-nowrap">{plural(role.permission_count || 0, 'permission')}</td>
                    <td className="px-4 py-3 text-[#464555] whitespace-nowrap">{plural(members, 'user')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => manage(role)} className="px-3 py-1.5 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#3525cd] hover:bg-[#f0f3ff]">Manage</button>
                        <button onClick={() => setAssignRole(role)} className="px-3 py-1.5 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff]">Assign</button>
                        <button onClick={() => setDeleteRole(role)} disabled={members > 0}
                          title={members > 0 ? 'Remove all users from this role before deleting it' : 'Delete role'}
                          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed">
                          <Trash2 size={14} className="text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* System roles — informational */}
      <div className="mt-8">
        <div className="flex items-center gap-2 mb-1">
          <Lock size={13} className="text-[#777587]" />
          <h2 className="text-xs font-black uppercase tracking-widest text-[#777587]">System Roles</h2>
        </div>
        <p className="text-xs text-[#777587] mb-3">System roles are predefined and cannot be customized.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {systemRoles.map(role => (
            <div key={role.id} className="bg-white border border-[#e7eefe] rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-[#151c27] truncate">{role.name}</span>
                <Badge system />
              </div>
              <p className="text-xs text-[#777587]">{plural(role.member_count || 0, 'user')}</p>
              <button onClick={() => setCreateFor({ template: role })}
                className="mt-auto inline-flex items-center gap-1.5 text-xs font-bold text-[#3525cd] hover:underline self-start">
                <Copy size={12} /> Create custom role
              </button>
            </div>
          ))}
        </div>
      </div>

      {createFor && (
        <CreateRoleModal
          roles={roles}
          templateRole={createFor.template}
          onClose={() => setCreateFor(null)}
          onCreated={(role) => {
            queryClient.invalidateQueries({ queryKey: ['roles'] });
            setCreateFor(null);
            showToast(`Role "${role.name}" created`);
          }}
        />
      )}
      {assignRole && <AssignUsersModal role={assignRole} onClose={() => setAssignRole(null)} onSaved={showToast} />}
      {deleteRole && <DeleteConfirm role={deleteRole} loading={deleteMutation.isPending} onCancel={() => setDeleteRole(null)} onConfirm={() => deleteMutation.mutate(deleteRole.id)} />}

      {toast && (
        <div className={cn('fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold border bg-white',
          toast.type === 'success' ? 'border-green-200 text-green-700' : 'border-red-200 text-red-600')}>
          {toast.type === 'success' ? <CheckCircle2 size={16} className="text-green-500" /> : <AlertCircle size={16} className="text-red-500" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}
