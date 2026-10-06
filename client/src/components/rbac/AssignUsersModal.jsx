import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { X, Search, AlertCircle, Users } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { useEmployees } from '@/hooks/useEmployees';
import { useBranch } from '@/context/BranchContext';
import { BRANCH_KEYED } from '@/lib/queryScopes';
import { cn } from '@/lib/utils';

const INACTIVE = new Set(['inactive', 'resigned', 'terminated']);
// users.role → the predefined role they hold when no explicit role row is shown
const BASE_ROLE_LABEL = { employee: 'Employee', admin: 'HR Admin', root_admin: 'Root Admin' };

/**
 * Assign Users — assign a custom role to one or many employees.
 * Uses the existing member endpoints only:
 *   POST   /roles/:id/members          (add one user)
 *   DELETE /roles/:id/members/:userId  (remove one user)
 * Adding a role is ADDITIVE: it never replaces the user's other roles. Users who already hold this role are pre-checked;
 * unchecking one removes ONLY this role from that user.
 */
export default function AssignUsersModal({ role, onClose, onSaved }) {
  const qc = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState(null); // Set<userId>, null until members load
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const { data: members, isLoading: membersLoading } = useQuery({
    queryKey: ['role-members', role.id],
    queryFn: () => apiGet(`/roles/${role.id}/members`),
    staleTime: 0,
  });
  const { data: employees = [], isLoading: usersLoading } = useEmployees({ lite: true });

  // "Current Role": every role a user is explicitly assigned (one request per role, org has only a handful).
  const { data: allRoles = [] } = useQuery({
    queryKey: ['roles', selectedBranchId],
    meta: BRANCH_KEYED,
    queryFn: () => apiGet('/roles'),
  });
  const memberQueries = useQueries({
    queries: allRoles.map(r => ({
      queryKey: ['role-members', r.id],
      queryFn: () => apiGet(`/roles/${r.id}/members`),
      staleTime: 30000,
    })),
  });
  const rolesByUser = useMemo(() => {
    const map = new Map();
    allRoles.forEach((r, i) => {
      (memberQueries[i]?.data || []).forEach(m => {
        const list = map.get(m.id) || [];
        list.push(r.name);
        map.set(m.id, list);
      });
    });
    return map;
  }, [allRoles, memberQueries.map(q => q.dataUpdatedAt).join(',')]); // eslint-disable-line

  const initial = useMemo(() => new Set((members || []).map(m => m.id)), [members]);
  useEffect(() => { if (members && selected === null) setSelected(new Set(initial)); }, [members]); // eslint-disable-line

  // Union of current members and active, non-root employees
  const users = useMemo(() => {
    const byId = new Map();
    (members || []).forEach(m => byId.set(m.id, m));
    employees.forEach(e => {
      if (e.role === 'root_admin') return;                              // Root Admin is never assigned a custom role
      if (INACTIVE.has(e.employee_status) && !byId.has(e.id)) return;   // lifecycle status is employee_status
      byId.set(e.id, { ...(byId.get(e.id) || {}), ...e });
    });
    return [...byId.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [members, employees]);

  const q = search.trim().toLowerCase();
  const shown = q ? users.filter(u =>
    (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) ||
    String(u.employee_id || '').toLowerCase().includes(q) || (u.department || '').toLowerCase().includes(q)) : users;
  const sel = selected || new Set();

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const toAdd    = [...sel].filter(id => !initial.has(id));
  const toRemove = [...initial].filter(id => !sel.has(id));
  const changed  = toAdd.length + toRemove.length > 0;

  async function handleSave() {
    setSaving(true);
    setError('');
    const failures = [];
    for (const id of toAdd) {
      try { await apiPost(`/roles/${role.id}/members`, { user_id: id }); }
      catch (e) { failures.push(`${users.find(u => u.id === id)?.name || id}: ${e.message}`); }
    }
    for (const id of toRemove) {
      try { await apiDelete(`/roles/${role.id}/members/${id}`); }
      catch (e) { failures.push(`${users.find(u => u.id === id)?.name || id}: ${e.message}`); }
    }
    qc.invalidateQueries({ queryKey: ['roles'] });
    qc.invalidateQueries({ queryKey: ['role-members'] });
    setSaving(false);
    if (failures.length) { setError(failures.join(' · ')); return; }
    onSaved?.(`Users updated for "${role.name}"`);
    onClose();
  }

  const loading = membersLoading || usersLoading || selected === null;
  const currentRole = (u) => {
    const names = (rolesByUser.get(u.id) || []).filter(n => n !== role.name);
    return names.length ? names.join(', ') : (BASE_ROLE_LABEL[u.role] || 'Employee');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-[#c7c4d8] flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe]">
          <div className="min-w-0">
            <h2 className="font-black text-[#151c27] text-base">Assign Users</h2>
            <p className="text-xs text-[#777587] truncate">Role: <strong className="text-[#464555]">{role.name}</strong></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center"><X size={16} className="text-[#777587]" /></button>
        </div>

        <div className="px-6 pt-4">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, employee ID, department or email…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-[#c7c4d8] rounded-lg focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20" />
          </div>
          <p className="text-[0.68rem] text-[#777587] mt-2">
            Users who already have this role are checked. Checking adds this role (their other roles are kept); unchecking removes only this role.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 min-h-[160px]">
          {!loading && shown.length > 0 && (
            <div className="grid grid-cols-[1.5rem_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-wider text-[#777587]">
              <span /><span>Employee</span><span>Emp ID</span><span>Department</span><span>Current Role</span>
            </div>
          )}
          {loading ? (
            <p className="text-center text-xs text-[#777587] py-8">Loading users…</p>
          ) : shown.length === 0 ? (
            <div className="text-center py-8"><Users size={20} className="mx-auto text-[#c7c4d8] mb-1.5" /><p className="text-xs text-[#777587]">No users found</p></div>
          ) : shown.map(u => (
            <label key={u.id} className={cn('grid grid-cols-[1.5rem_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 px-3 py-2 rounded-lg cursor-pointer hover:bg-[#f0f3ff]', sel.has(u.id) && 'bg-[#3525cd]/5')}>
              <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} className="w-4 h-4 accent-[#3525cd]" />
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[0.65rem] font-black text-white flex-shrink-0" style={{ background: u.avatar_color || '#3525cd' }}>
                  {(u.name || '?').slice(0, 2).toUpperCase()}
                </div>
                <p className="text-sm font-semibold text-[#151c27] truncate" title={u.email}>{u.name}</p>
              </div>
              <span className="text-xs text-[#464555] truncate">{u.employee_id || '—'}</span>
              <span className="text-xs text-[#464555] truncate" title={u.department}>{u.department || '—'}</span>
              <span className="text-xs text-[#464555] truncate" title={currentRole(u)}>{currentRole(u)}</span>
            </label>
          ))}
        </div>

        {error && (
          <div className="mx-6 mb-2 flex items-start gap-2 text-red-600 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> <span className="break-words">{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[#e7eefe]">
          <span className="text-xs font-semibold text-[#464555]">Selected: {sel.size} user{sel.size === 1 ? '' : 's'}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="border border-[#c7c4d8] rounded-lg px-4 py-2 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">Cancel</button>
            <button onClick={handleSave} disabled={saving || loading || !changed}
              className="bg-[#3525cd] text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Assigning…' : 'Assign Role'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
