import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Fingerprint, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';

function AddMappingModal({ open, onClose, employees, existingPins }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [form, setForm]     = useState({ employee_id: '', pin: '' });
  const [search, setSearch] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const pinExists = form.pin && existingPins.includes(form.pin.trim());

  const filtered = (employees || []).filter(e => {
    const q = search.toLowerCase();
    return !q || e.name?.toLowerCase().includes(q) || e.email?.toLowerCase().includes(q);
  });

  const mut = useMutation({
    mutationFn: (variables) => apiPost('/biometric/employee-map', variables),
    onSuccess: () => {
      toast('Mapping added!', 'success');
      qc.invalidateQueries({ queryKey: ['biometric-map'] });
      onClose();
      setForm({ employee_id: '', pin: '' });
      setSearch('');
    },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Employee PIN Mapping" size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => mut.mutate({ user_id: form.employee_id, employee_pin: form.pin })}
            disabled={mut.isPending || !form.employee_id || !form.pin || !!pinExists}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Add Mapping'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <label className="form-label">Employee <span className="text-rose-500">*</span></label>
          <div className="relative mb-2">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
            <input className="form-control pl-8 text-xs" placeholder="Search employee…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="border border-[#c7c4d8] rounded-xl max-h-48 overflow-y-auto bg-white">
            {filtered.length === 0 ? (
              <p className="text-xs text-[#777587] text-center py-4">No employees found</p>
            ) : (
              filtered.map(emp => (
                <button key={emp.id} type="button"
                  onClick={() => set('employee_id', emp.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-[#f0f3ff] transition-colors border-b border-[#f0f3ff] last:border-0 ${
                    String(form.employee_id) === String(emp.id) ? 'bg-[#f0f3ff]' : ''
                  }`}>
                  <Avatar name={emp.name} color={emp.avatar_color} size={24} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#151c27] truncate">{emp.name}</p>
                    <p className="text-[0.65rem] text-[#777587] truncate">{emp.email}</p>
                  </div>
                  {String(form.employee_id) === String(emp.id) && (
                    <span className="w-4 h-4 rounded-full bg-[#3525cd] flex items-center justify-center flex-shrink-0">
                      <span className="w-2 h-2 rounded-full bg-white" />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        <div>
          <label className="form-label">Device PIN <span className="text-rose-500">*</span></label>
          <input className="form-control font-mono" placeholder="e.g. 1001"
            value={form.pin} onChange={e => set('pin', e.target.value)} />
          {pinExists && (
            <div className="flex items-center gap-1.5 mt-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={13} />
              This PIN is already assigned to another employee.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function BiometricPinMapping() {
  const { isAdmin } = useAuth();
  const toast       = useToast();
  const qc          = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [addOpen,    setAddOpen]    = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [isReprocessing, setIsReprocessing] = useState(false);

  const { data: _map, isLoading } = useQuery({
    queryKey: ['biometric-map', selectedBranchId],
    queryFn:  () => apiGet('/biometric/employee-map'),
  });
  const { data: _emps } = useQuery({
    queryKey: ['employees', 'all', selectedBranchId],
    queryFn:  () => apiGet('/employees'),
  });

  const mappings  = Array.isArray(_map)  ? _map  : [];
  const employees = Array.isArray(_emps) ? _emps : [];
  const existingPins = mappings.map(m => String(m.employee_pin));

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/biometric/employee-map/${id}`),
    onSuccess: () => { toast('Mapping deleted', 'warning'); qc.invalidateQueries({ queryKey: ['biometric-map'] }); },
    onError: e => toast(e.message, 'error'),
  });

  async function handleReprocess() {
    setIsReprocessing(true);
    try {
      const res = await apiGet('/biometric/reprocess');
      toast(`Reprocessed ${res.count ?? 0} log records`, 'success');
      qc.invalidateQueries({ queryKey: ['biometric-map'] });
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setIsReprocessing(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Employee PIN Mapping</h1>
          <p className="page-subtitle">{mappings.length} mapping{mappings.length !== 1 ? 's' : ''} · link device PINs to employees</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleReprocess} disabled={isReprocessing}
            className="flex items-center gap-2 border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] text-[#464555] text-sm font-bold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50">
            <RefreshCw size={15} className={isReprocessing ? 'animate-spin' : ''} />
            {isReprocessing ? 'Reprocessing…' : 'Reprocess Logs'}
          </button>
          {isAdmin && (
            <button onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 bg-[#3525cd] hover:bg-[#2d1eb5] text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors">
              <Plus size={16} /> Add Mapping
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading mappings…</div>
      ) : mappings.length === 0 ? (
        <div className="empty-state">
          <Fingerprint size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">No PIN mappings yet</p>
          <p className="text-sm mb-4">Map device PINs to employees so punch logs can be matched</p>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Add First Mapping
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f8f9fe] border-b border-[#e7eefe]">
                <tr>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Employee PIN</th>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Employee Name</th>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Department</th>
                  <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Enrollment ID</th>
                  {isAdmin && <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3ff]">
                {mappings.map(m => (
                  <tr key={m.id} className="hover:bg-[#f9f9ff] transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="font-mono text-sm font-bold bg-[#f0f3ff] text-[#3525cd] px-2.5 py-1 rounded-lg">
                        {m.employee_pin}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.user?.name || m.employee_name || '?'} color={m.user?.avatar_color} size={28} />
                        <span className="font-semibold text-[#151c27]">{m.user?.name || m.employee_name || '—'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-[#464555]">
                      {m.user?.department || m.department || '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      {(m.user?.device_enrollment_id || m.device_enrollment_id) ? (
                        <span className="font-mono text-xs text-[#464555] bg-[#f8f9fe] border border-[#c7c4d8] px-2 py-0.5 rounded">
                          {m.user?.device_enrollment_id || m.device_enrollment_id}
                        </span>
                      ) : (
                        <span className="text-[#c7c4d8] text-xs">—</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-5 py-3.5">
                        <button onClick={() => setConfirmDel({ id: m.id, pin: m.employee_pin })}
                          className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition-colors" title="Delete">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addOpen && (
        <AddMappingModal open onClose={() => setAddOpen(false)} employees={employees} existingPins={existingPins} />
      )}

      <ConfirmModal
        open={!!confirmDel}
        title="Remove PIN Mapping"
        message={`Remove mapping for PIN "${confirmDel?.pin}"? Punch logs from this PIN will no longer be attributed to the linked employee.`}
        confirmLabel="Remove"
        onConfirm={() => { delMut.mutate(confirmDel.id); setConfirmDel(null); }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
