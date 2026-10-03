import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { BRANCH_KEYED } from '@/lib/queryScopes';
import {
  Shield, Plus, Trash2, ChevronRight, Users, Lock,
  Settings, AlertCircle, CheckCircle2, X, Pencil,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, apiPut } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { cn } from '@/lib/utils';

// ─── Create Role Modal ────────────────────────────────────────────────────────

function validateRoleName(val) {
  if (!val || !val.trim()) return 'Role name is required';
  if (val.trim().length < 2) return 'Must be at least 2 characters';
  if (val.trim().length > 50) return 'Must be 50 characters or fewer';
  if (/[^a-zA-Z0-9\s\-_]/.test(val)) return 'Only letters, numbers, spaces, hyphens, and underscores are allowed';
  return '';
}

function CreateRoleModal({ onClose, onCreate }) {
  const [name, setName]       = useState('');
  const [desc, setDesc]       = useState('');
  const [nameErr, setNameErr] = useState('');
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  function handleNameChange(e) {
    const val = e.target.value;
    setName(val);
    setNameErr(validateRoleName(val));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validateRoleName(name);
    if (err) { setNameErr(err); return; }
    setSaving(true);
    setError('');
    try {
      const role = await apiPost('/roles', { name: name.trim(), description: desc.trim() });
      onCreate(role);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const nameOk = !nameErr && name.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#c7c4d8]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#3525cd]/10 flex items-center justify-center">
              <Shield size={16} className="text-[#3525cd]" />
            </div>
            <h2 className="font-black text-[#151c27] text-base">Create Custom Role</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center transition-colors">
            <X size={16} className="text-[#777587]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#464555]">Role Name <span className="text-rose-500">*</span></label>
              <span className={cn('text-[0.65rem] font-semibold', name.length > 45 ? 'text-amber-500' : 'text-[#c7c4d8]')}>
                {name.length}/50
              </span>
            </div>
            <input
              autoFocus
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Finance Manager"
              maxLength={50}
              className={cn(
                'w-full border rounded-lg px-3 py-2.5 text-sm text-[#151c27] focus:outline-none focus:ring-1 transition-colors',
                nameErr
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                  : nameOk
                    ? 'border-green-400 focus:border-green-500 focus:ring-green-100'
                    : 'border-[#c7c4d8] focus:border-[#3525cd] focus:ring-[#3525cd]/20'
              )}
            />
            {nameErr && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <AlertCircle size={11} className="text-rose-500 shrink-0" />
                <p className="text-[0.68rem] text-rose-600">{nameErr}</p>
              </div>
            )}
            {!nameErr && name.trim() && (
              <p className="text-[0.68rem] text-[#777587] mt-1">Allowed: letters, numbers, spaces, hyphens, underscores</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#464555]">Description <span className="text-[#c7c4d8] font-normal">(optional)</span></label>
              <span className={cn('text-[0.65rem] font-semibold', desc.length > 450 ? 'text-amber-500' : 'text-[#c7c4d8]')}>
                {desc.length}/500
              </span>
            </div>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value.slice(0, 500))}
              placeholder="What does this role do? Who should have it?"
              rows={3}
              maxLength={500}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2.5 text-sm text-[#151c27] resize-none focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={13} /> {error}
            </div>
          )}

          <div className="flex gap-2.5 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-[#c7c4d8] rounded-lg py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !!nameErr || !name.trim()}
              className="flex-1 bg-[#3525cd] text-white rounded-lg py-2.5 text-sm font-bold hover:bg-[#2a1fb0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Creating…' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Role Modal ──────────────────────────────────────────────────────────

function EditRoleModal({ role, onClose, onSaved }) {
  const [name, setName]       = useState(role.name || '');
  const [desc, setDesc]       = useState(role.description || '');
  const [nameErr, setNameErr] = useState('');
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  function handleNameChange(e) {
    const val = e.target.value;
    setName(val);
    setNameErr(validateRoleName(val));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validateRoleName(name);
    if (err) { setNameErr(err); return; }
    setSaving(true);
    setError('');
    try {
      const updated = await apiPut(`/roles/${role.id}`, {
        name: name.trim(),
        description: desc.trim(),
      });
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const nameOk = !nameErr && name.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#c7c4d8]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#3525cd]/10 flex items-center justify-center">
              <Pencil size={15} className="text-[#3525cd]" />
            </div>
            <h2 className="font-black text-[#151c27] text-base">Edit Role</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center transition-colors">
            <X size={16} className="text-[#777587]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#464555]">Role Name <span className="text-rose-500">*</span></label>
              <span className={cn('text-[0.65rem] font-semibold', name.length > 45 ? 'text-amber-500' : 'text-[#c7c4d8]')}>
                {name.length}/50
              </span>
            </div>
            <input
              autoFocus
              value={name}
              onChange={handleNameChange}
              placeholder="e.g. Finance Manager"
              maxLength={50}
              className={cn(
                'w-full border rounded-lg px-3 py-2.5 text-sm text-[#151c27] focus:outline-none focus:ring-1 transition-colors',
                nameErr
                  ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-200'
                  : nameOk
                    ? 'border-green-400 focus:border-green-500 focus:ring-green-100'
                    : 'border-[#c7c4d8] focus:border-[#3525cd] focus:ring-[#3525cd]/20'
              )}
            />
            {nameErr && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <AlertCircle size={11} className="text-rose-500 shrink-0" />
                <p className="text-[0.68rem] text-rose-600">{nameErr}</p>
              </div>
            )}
            {!nameErr && name.trim() && (
              <p className="text-[0.68rem] text-[#777587] mt-1">Allowed: letters, numbers, spaces, hyphens, underscores</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-[#464555]">Description <span className="text-[#c7c4d8] font-normal">(optional)</span></label>
              <span className={cn('text-[0.65rem] font-semibold', desc.length > 450 ? 'text-amber-500' : 'text-[#c7c4d8]')}>
                {desc.length}/500
              </span>
            </div>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value.slice(0, 500))}
              placeholder="What does this role do? Who should have it?"
              rows={3}
              maxLength={500}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2.5 text-sm text-[#151c27] resize-none focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={13} /> {error}
            </div>
          )}

          <div className="flex gap-2.5 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 border border-[#c7c4d8] rounded-lg py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !!nameErr || !name.trim()}
              className="flex-1 bg-[#3525cd] text-white rounded-lg py-2.5 text-sm font-bold hover:bg-[#2a1fb0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ role, onCancel, onConfirm, loading }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-[#c7c4d8] p-6">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mx-auto mb-4">
          <Trash2 size={22} className="text-red-500" />
        </div>
        <h3 className="text-center font-black text-[#151c27] mb-1">Delete Role</h3>
        <p className="text-center text-sm text-[#777587] mb-2">
          Are you sure you want to delete <strong className="text-[#151c27]">{role.name}</strong>?
        </p>
        <p className="text-center text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-6">
          All member assignments and permissions for this role will be permanently revoked. This cannot be undone.
        </p>
        <div className="flex gap-2.5">
          <button onClick={onCancel}
            className="flex-1 border border-[#c7c4d8] rounded-lg py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 bg-red-500 text-white rounded-lg py-2.5 text-sm font-bold hover:bg-red-600 disabled:opacity-60">
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Role Card ────────────────────────────────────────────────────────────────

function RoleCard({ role, onDelete, onClick, onEdit }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting]           = useState(false);

  const SYSTEM_COLORS = {
    root_admin: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', dot: 'bg-purple-400' },
    hr_admin:   { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   dot: 'bg-blue-400'   },
    dept_head:  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  dot: 'bg-amber-400'  },
    employee:   { bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  dot: 'bg-green-400'  },
  };
  const colors = SYSTEM_COLORS[role.slug] || {
    bg: 'bg-[#f0f3ff]', border: 'border-[#c7c4d8]', text: 'text-[#3525cd]', dot: 'bg-[#3525cd]',
  };

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(role.id);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <div
        className="bg-white border border-[#e7eefe] rounded-xl p-4 hover:border-[#3525cd]/30 hover:shadow-sm transition-all cursor-pointer group relative overflow-hidden"
        onClick={() => onClick(role)}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', colors.bg, 'border', colors.border)}>
              {role.is_system_role
                ? <Lock size={15} className={colors.text} />
                : <Shield size={15} className="text-[#3525cd]" />
              }
            </div>
            {/* BUG_143: prevent long name/description causing horizontal scroll */}
            <div className="min-w-0 flex-1 overflow-hidden">
              <p title={role.name} className="font-bold text-[0.88rem] text-[#151c27] leading-tight break-all line-clamp-2">{role.name}</p>
              <span className={cn(
                'inline-flex items-center gap-1 text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full mt-0.5',
                role.is_system_role ? cn(colors.bg, colors.text) : 'bg-[#f0f3ff] text-[#3525cd]'
              )}>
                <span className={cn('w-1.5 h-1.5 rounded-full', role.is_system_role ? colors.dot : 'bg-[#3525cd]')} />
                {role.is_system_role ? 'System' : 'Custom'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!role.is_system_role && (
              <>
                <button
                  onClick={e => { e.stopPropagation(); onEdit(role); }}
                  className="w-7 h-7 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center transition-colors"
                  title="Edit role"
                >
                  <Pencil size={13} className="text-[#3525cd]" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center transition-colors"
                  title="Delete role"
                >
                  <Trash2 size={13} className="text-red-400" />
                </button>
              </>
            )}
            <ChevronRight size={16} className="text-[#777587]" />
          </div>
        </div>

        {/* Description */}
        {role.description && (
          <p title={role.description} className="text-xs text-[#777587] mb-3 line-clamp-2 leading-relaxed break-all overflow-hidden">{role.description}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 pt-2.5 border-t border-[#f0f3ff]">
          <div className="flex items-center gap-1.5 text-[#777587]">
            <Shield size={12} />
            <span className="text-xs font-semibold">{role.permission_count || 0} permissions</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#777587]">
            <Users size={12} />
            <span className="text-xs font-semibold">{role.member_count || 0} members</span>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <DeleteConfirm
          role={role}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDelete}
          loading={deleting}
        />
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RoleManagement() {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [showCreate, setShowCreate] = useState(false);
  const [editRole, setEditRole]     = useState(null); // role object being edited
  const [toast, setToast]           = useState(null);

  // Include selectedBranchId in queryKey so member counts refresh when branch changes
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles', selectedBranchId],
    meta: BRANCH_KEYED, placeholderData: keepPreviousData,
    queryFn: () => apiGet('/roles'),
  });

  const deleteMutation = useMutation({
    mutationFn: (roleId) => apiDelete(`/roles/${roleId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      showToast('Role deleted successfully', 'success');
    },
    onError: (err) => showToast(err.message, 'error'),
  });

  function showToast(message, type = 'success') {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }

  function handleRoleClick(role) {
    navigate(`/root/roles/${role.id}/permissions`);
  }

  function handleCreated(role) {
    queryClient.invalidateQueries({ queryKey: ['roles'] });
    // EHN_RM_001: drop the admin straight into the new role's Permissions tab
    navigate(`/root/roles/${role.id}/permissions`);
  }

  function handleRoleSaved(updatedRole) {
    queryClient.invalidateQueries({ queryKey: ['roles'] });
    showToast(`Role "${updatedRole.name}" updated`, 'success');
  }

  // BUG_25: Root Admin has all permissions by default; Employee uses self-service dashboard only.
  // Only HR Admin and Department Head need configurable permission management.
  const systemRoles = roles.filter(r => r.is_system_role);
  const configurableSystemRoles = systemRoles.filter(r => !['root_admin', 'employee'].includes(r.slug));
  const lockedSystemRoles = systemRoles.filter(r => ['root_admin', 'employee'].includes(r.slug));
  const customRoles = roles.filter(r => !r.is_system_role);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-xl bg-[#3525cd]/10 flex items-center justify-center">
              <Shield size={17} className="text-[#3525cd]" />
            </div>
            <h1 className="text-xl font-black text-[#151c27]">Role Management</h1>
          </div>
          <p className="text-sm text-[#777587] ml-10.5">
            Define roles and assign permissions to control what users can access.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#3525cd] text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-[#2a1fb0] transition-colors shadow-sm"
        >
          <Plus size={16} /> Create Role
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-[#f0f3ff] border border-[#c7c4d8] rounded-xl px-4 py-3 mb-6 flex items-start gap-3">
        <Settings size={16} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-bold text-[#3525cd] mb-0.5">Click any role to manage its permissions and members</p>
          <p className="text-xs text-[#777587]">
            System roles are seeded automatically and cannot be deleted or renamed. Custom roles can be created, edited, and deleted. Hover a custom role card to edit or delete it.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-white border border-[#e7eefe] rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-xl bg-[#f0f3ff]" />
                <div className="space-y-1.5">
                  <div className="h-4 w-28 bg-[#f0f3ff] rounded" />
                  <div className="h-3 w-14 bg-[#f0f3ff] rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-[#f0f3ff] rounded mb-4" />
              <div className="h-3 w-2/3 bg-[#f0f3ff] rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Configurable System Roles — HR Admin & Department Head */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-[#3525cd]" />
              <h2 className="text-xs font-black uppercase tracking-widest text-[#777587]">Configurable Roles</h2>
              <span className="text-xs text-[#777587] font-medium">— manage permissions for these roles</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {configurableSystemRoles.map(role => (
                <RoleCard
                  key={role.id}
                  role={role}
                  onDelete={(id) => deleteMutation.mutateAsync(id)}
                  onClick={handleRoleClick}
                  onEdit={setEditRole}
                />
              ))}
            </div>
          </div>

          {/* Locked System Roles — Root Admin & Employee */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Lock size={14} className="text-[#777587]" />
              <h2 className="text-xs font-black uppercase tracking-widest text-[#777587]">Fixed System Roles</h2>
              <span className="text-xs text-[#777587] font-medium">— predefined access, click to view</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {lockedSystemRoles.map(role => (
                <RoleCard
                  key={role.id}
                  role={role}
                  onDelete={(id) => deleteMutation.mutateAsync(id)}
                  onClick={handleRoleClick}
                  onEdit={setEditRole}
                />
              ))}
            </div>
          </div>

          {/* Custom Roles */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-[#777587]" />
              <h2 className="text-xs font-black uppercase tracking-widest text-[#777587]">Custom Roles</h2>
            </div>
            {customRoles.length === 0 ? (
              <div className="bg-white border border-dashed border-[#c7c4d8] rounded-xl p-8 text-center">
                <div className="w-12 h-12 rounded-2xl bg-[#f0f3ff] flex items-center justify-center mx-auto mb-3">
                  <Plus size={22} className="text-[#3525cd]/40" />
                </div>
                <p className="text-sm font-bold text-[#151c27] mb-1">No custom roles yet</p>
                <p className="text-xs text-[#777587] mb-4">Create a custom role for specific job functions in your organization.</p>
                <button
                  onClick={() => setShowCreate(true)}
                  className="text-[#3525cd] text-xs font-bold hover:underline"
                >
                  + Create your first custom role
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {customRoles.map(role => (
                  <RoleCard
                    key={role.id}
                    role={role}
                    onDelete={(id) => deleteMutation.mutateAsync(id)}
                    onClick={handleRoleClick}
                    onEdit={setEditRole}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateRoleModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreated}
        />
      )}

      {editRole && (
        <EditRoleModal
          role={editRole}
          onClose={() => setEditRole(null)}
          onSaved={handleRoleSaved}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={cn(
          'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-semibold border',
          toast.type === 'success'
            ? 'bg-white border-green-200 text-green-700'
            : 'bg-white border-red-200 text-red-600'
        )}>
          {toast.type === 'success'
            ? <CheckCircle2 size={16} className="text-green-500" />
            : <AlertCircle size={16} className="text-red-500" />
          }
          {toast.message}
        </div>
      )}
    </div>
  );
}
