/**
 * AssignRoleModal
 *
 * Allows assigning/removing RBAC roles for a specific user.
 * Displays the list of all org roles with the user's current roles pre-checked.
 *
 * Usage:
 *   <AssignRoleModal
 *     user={{ id, name, email, avatar_color }}
 *     onClose={() => setOpen(false)}
 *     onSaved={() => refetch()}
 *   />
 *
 * Phase 1: Standalone modal component.
 * Phase 4: Will be embedded in Employee detail view.
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { BRANCH_KEYED } from '@/lib/queryScopes';
import {
  Shield, Lock, X, Save, AlertCircle, CheckCircle2,
  CheckSquare, Square, Users,
} from 'lucide-react';
import { apiGet, apiPut } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { cn } from '@/lib/utils';

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const SYSTEM_ROLE_COLORS = {
  root_admin: 'bg-purple-50 text-purple-700 border-purple-200',
  hr_admin:   'bg-blue-50 text-blue-700 border-blue-200',
  dept_head:  'bg-amber-50 text-amber-700 border-amber-200',
  employee:   'bg-green-50 text-green-700 border-green-200',
};

export function AssignRoleModal({ user, onClose, onSaved }) {
  const queryClient   = useQueryClient();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [error, setError]             = useState('');
  const [dirty, setDirty]             = useState(false);

  // Fetch all roles for the org
  const _bk1 = useBranch().selectedBranchId;
  const { data: allRoles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['roles', _bk1],
    meta: BRANCH_KEYED, placeholderData: keepPreviousData,
    queryFn: () => apiGet('/roles'),
  });

  // Fetch roles currently assigned to this user
  const { data: userRoles = [], isLoading: userRolesLoading } = useQuery({
    queryKey: ['user-roles', user.id],
    queryFn: () => apiGet(`/roles/user/${user.id}`),
    enabled: !!user.id,
  });

  // Initialize selection from current roles
  useEffect(() => {
    if (userRoles.length >= 0) {
      setSelectedIds(new Set(userRoles.map(r => r.id)));
      setDirty(false);
    }
  }, [userRoles.map(r => r.id).join(',')]);

  const saveMutation = useMutation({
    mutationFn: () => apiPut(`/roles/user/${user.id}`, {
      role_ids: Array.from(selectedIds),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-roles', user.id] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      if (onSaved) onSaved();
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  function handleToggle(roleId) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(roleId) ? next.delete(roleId) : next.add(roleId);
      return next;
    });
    setDirty(true);
    setError('');
  }

  const isLoading = rolesLoading || userRolesLoading;
  // Manager / Department Head are derived from reporting lines / department heads — never assigned by hand.
  const systemRoles = allRoles.filter(r => r.is_system_role && r.slug !== 'manager' && r.slug !== 'dept_head');
  const customRoles = allRoles.filter(r => !r.is_system_role);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.65)', backdropFilter: 'blur(4px)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[#c7c4d8] flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#3525cd]/10 flex items-center justify-center">
              <Shield size={16} className="text-[#3525cd]" />
            </div>
            <h2 className="font-black text-[#151c27] text-base">Assign Roles</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center transition-colors"
          >
            <X size={16} className="text-[#777587]" />
          </button>
        </div>

        {/* User info */}
        <div className="px-6 py-3 bg-[#f9f9ff] border-b border-[#e7eefe] flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-black text-white flex-shrink-0 border-2 border-white shadow-sm"
              style={{ background: user.avatar_color || '#3525cd' }}
            >
              {initials(user.name || '')}
            </div>
            <div>
              <p className="font-bold text-[0.88rem] text-[#151c27]">{user.name}</p>
              <p className="text-xs text-[#777587]">{user.email}</p>
            </div>
            <div className="ml-auto flex items-center gap-1 text-xs text-[#777587]">
              <Users size={12} />
              <span className="font-semibold">{selectedIds.size} role{selectedIds.size !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>

        {/* Role list */}
        <div className="overflow-y-auto flex-1 p-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-14 bg-[#f0f3ff] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {/* System Roles */}
              <div>
                <p className="text-[0.6rem] font-black uppercase tracking-widest text-[#777587] mb-2 flex items-center gap-1.5">
                  <Lock size={10} /> System Roles
                </p>
                <div className="space-y-1.5">
                  {systemRoles.map(role => {
                    const isSelected = selectedIds.has(role.id);
                    const colorClass = SYSTEM_ROLE_COLORS[role.slug] || 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]';
                    return (
                      <label
                        key={role.id}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all select-none',
                          isSelected
                            ? 'bg-[#3525cd]/5 border-[#3525cd]/30'
                            : 'bg-white border-[#e7eefe] hover:border-[#c7c4d8] hover:bg-[#f9f9ff]'
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={isSelected}
                          onChange={() => handleToggle(role.id)}
                        />
                        <div className="flex-shrink-0">
                          {isSelected
                            ? <CheckSquare size={15} className="text-[#3525cd]" />
                            : <Square size={15} className="text-[#c7c4d8]" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-[#151c27]">{role.name}</span>
                            <span className={cn('text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full border', colorClass)}>
                              system
                            </span>
                          </div>
                          {role.description && (
                            <p className="text-[0.7rem] text-[#777587] truncate mt-0.5">{role.description}</p>
                          )}
                        </div>
                        <div className="text-[0.65rem] text-[#777587] flex-shrink-0 text-right">
                          {role.permission_count || 0} perms
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Custom Roles */}
              {customRoles.length > 0 && (
                <div>
                  <p className="text-[0.6rem] font-black uppercase tracking-widest text-[#777587] mb-2 flex items-center gap-1.5">
                    <Shield size={10} /> Custom Roles
                  </p>
                  <div className="space-y-1.5">
                    {customRoles.map(role => {
                      const isSelected = selectedIds.has(role.id);
                      return (
                        <label
                          key={role.id}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-all select-none',
                            isSelected
                              ? 'bg-[#3525cd]/5 border-[#3525cd]/30'
                              : 'bg-white border-[#e7eefe] hover:border-[#c7c4d8] hover:bg-[#f9f9ff]'
                          )}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={isSelected}
                            onChange={() => handleToggle(role.id)}
                          />
                          <div className="flex-shrink-0">
                            {isSelected
                              ? <CheckSquare size={15} className="text-[#3525cd]" />
                              : <Square size={15} className="text-[#c7c4d8]" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-[#151c27]">{role.name}</span>
                              <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">
                                custom
                              </span>
                            </div>
                            {role.description && (
                              <p className="text-[0.7rem] text-[#777587] truncate mt-0.5">{role.description}</p>
                            )}
                          </div>
                          <div className="text-[0.65rem] text-[#777587] flex-shrink-0">
                            {role.permission_count || 0} perms
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {allRoles.length === 0 && (
                <div className="text-center py-8">
                  <Shield size={28} className="text-[#c7c4d8] mx-auto mb-2" />
                  <p className="text-sm text-[#777587]">No roles found</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#e7eefe] flex-shrink-0">
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
              <AlertCircle size={13} /> {error}
            </div>
          )}
          <div className="flex gap-2.5">
            <button
              onClick={onClose}
              className="flex-1 border border-[#c7c4d8] rounded-xl py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || saveMutation.isPending}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition-all',
                dirty
                  ? 'bg-[#3525cd] text-white hover:bg-[#2a1fb0]'
                  : 'bg-[#f0f3ff] text-[#777587] cursor-not-allowed'
              )}
            >
              <Save size={14} />
              {saveMutation.isPending ? 'Saving…' : 'Save Roles'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
