import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Plus, Pencil, Trash2, Building2, Users, ChevronRight } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';

function DeptModal({ open, onClose, dept, employees }) {
  const toast  = useToast();
  const qc     = useQueryClient();
  const isEdit = !!dept;
  const [form, setForm] = useState(() => isEdit
    ? { name: dept.name, description: dept.description || '', head_user_id: dept.head_user_id || '' }
    : { name: '', description: '', head_user_id: '' });

  const [nameErr, setNameErr] = useState('');

  const mut = useMutation({
    mutationFn: () => isEdit ? apiPut(`/departments/${dept.id}`, form) : apiPost('/departments', form),
    onSuccess: () => { toast(isEdit ? 'Department updated!' : 'Department created!', 'success'); qc.invalidateQueries({ queryKey: ['departments'] }); onClose(); },
    onError:   e  => toast(e.message, 'error'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // BUG_061: Client-side validation before submit
  function handleSubmit() {
    const name = form.name.trim();
    if (!name) { setNameErr('Department name is required.'); return; }
    if (name.length < 2) { setNameErr('Department name must be at least 2 characters.'); return; }
    if (name.length > 100) { setNameErr('Department name cannot exceed 100 characters.'); return; }
    if (!/[a-zA-Z]/.test(name)) { setNameErr('Department name must contain at least one letter.'); return; }
    if (/[<>{}\[\]`\\]/.test(name)) { setNameErr('Department name contains invalid characters.'); return; }
    setNameErr('');
    mut.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Department' : 'New Department'} size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={mut.isPending || !form.name}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : isEdit ? 'Save Changes' : 'Create Department'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <label className="form-label">Department Name *</label>
          <input className={`form-control ${nameErr ? 'border-rose-400' : ''}`} placeholder="e.g. Engineering" value={form.name} onChange={e => { set('name', e.target.value); if (nameErr) setNameErr(''); }} />
          {nameErr && <p className="text-xs text-rose-600 mt-1">{nameErr}</p>}
        </div>
        <div>
          <label className="form-label">Description</label>
          <textarea className="form-control" rows={2} placeholder="Brief description…" value={form.description} onChange={e => set('description', e.target.value)} />
        </div>
        <div>
          <label className="form-label">Department Head <span className="font-normal text-[#777587] normal-case tracking-normal">(optional)</span></label>
          <select className="form-control" value={form.head_user_id} onChange={e => set('head_user_id', e.target.value)}>
            <option value="">— Select employee —</option>
            {(employees || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
      </div>
    </Modal>
  );
}

const DEPT_COLORS = ['#3525cd','#10B981','#F59E0B','#712ae2','#EF4444','#F97316','#4f46e5','#06B6D4'];

export default function Departments() {
  const toast    = useToast();
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { isRootAdmin } = useAuth();
  const { selectedBranchId } = useBranch();
  const employeesPath = location.pathname.startsWith('/root/') ? '/root/employees' : '/employees';
  const [searchParams, setSearchParams] = useSearchParams();
  const [addOpen,       setAddOpen]      = useState(false);
  const [editDept,      setEditDept]     = useState(null);
  const [deptStatFilter, setDeptStatFilter] = useState('all'); // ENH_DEPT_006
  const [confirmDel,    setConfirmDel]   = useState(null);
  const [reassignTarget, setReassignTarget] = useState(''); // ENH_DEPT_004: target dept for reassignment

  useEffect(() => {
    if (searchParams.get('action') === 'add') {
      setAddOpen(true);
      setSearchParams(prev => { const n = new URLSearchParams(prev); n.delete('action'); return n; }, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: _dData, isLoading } = useQuery({ queryKey: ['departments', selectedBranchId], queryFn: () => apiGet('/departments') });
  const { data: _eData }            = useQuery({ queryKey: ['employees', 'all', selectedBranchId], queryFn: () => apiGet('/employees') });
  const depts     = Array.isArray(_dData) ? _dData : [];
  const employees = Array.isArray(_eData) ? _eData : [];

  // Total members across all depts (from junction table counts)
  const totalAssigned = depts.reduce((s, d) => s + (d.member_count || 0), 0);
  // Active employees only (exclude resigned, terminated, inactive)
  const activeEmployees = employees.filter(e => !['resigned', 'terminated', 'inactive'].includes(e.employee_status));

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/departments/${id}`),
    onSuccess: () => { toast('Department deleted', 'warning'); qc.invalidateQueries({ queryKey: ['departments'] }); },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Departments</h1>
          <p className="page-subtitle">{depts.length} department{depts.length !== 1 ? 's' : ''} · manage teams and reporting structure</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Add Department
        </button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Departments',    value: depts.length,                                          color: 'from-[#f0f3ff] to-[#e7eefe]',   top: '#3525cd', text: 'text-[#3525cd]',  filter: 'all',       onClick: () => setDeptStatFilter('all') },
          { label: 'With Department Head', value: depts.filter(d => !!d.head_user_id).length,              color: 'from-emerald-50 to-emerald-100', top: '#10B981', text: 'text-emerald-700', filter: 'with_head',  onClick: () => setDeptStatFilter(f => f === 'with_head' ? 'all' : 'with_head') },
          { label: 'Total Employees',      value: activeEmployees.length,                                 color: 'from-amber-50 to-amber-100',     top: '#F59E0B', text: 'text-amber-700',  filter: null,         onClick: () => navigate(employeesPath) },
          { label: 'Assigned Members',     value: totalAssigned,                                          color: 'from-[#f0f3ff] to-[#e7eefe]',   top: '#712ae2', text: 'text-[#712ae2]', filter: 'assigned',   onClick: () => setDeptStatFilter(f => f === 'assigned' ? 'all' : 'assigned') },
        ].map(s => (
          /* ENH_DEPT_006: clickable stat cards */
          <div key={s.label} onClick={s.onClick}
            className={`rounded-xl p-5 bg-gradient-to-br ${s.color} border shadow-card relative overflow-hidden cursor-pointer hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 ${deptStatFilter === s.filter ? 'ring-2 ring-offset-1 ring-[#3525cd]' : 'border-[#c7c4d8]'}`}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
            <div className={`text-3xl font-black leading-none tracking-tight ${s.text}`}>{s.value}</div>
            <div className="text-[0.7rem] font-bold uppercase tracking-wider text-[#777587] mt-1.5">{s.label}</div>
            <div className="text-[0.62rem] text-[#9ca3af] mt-0.5">Click to filter ↓</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading departments…</div>
      ) : depts.length === 0 ? (
        <div className="empty-state">
          <Building2 size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">No departments yet</p>
          <p className="text-sm mb-4">Create departments to organize your team structure</p>
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={14} />Create First Department</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {depts.filter(d => {
            if (deptStatFilter === 'with_head') return !!d.head_user_id;
            if (deptStatFilter === 'assigned') {
              const empCount = d.member_count > 0 ? d.member_count : employees.filter(e => e.department === d.name).length;
              return empCount > 0;
            }
            return true;
          }).map((d, i) => {
            const color    = DEPT_COLORS[i % DEPT_COLORS.length];
            const headUser = d.users;
            // Use member_count from junction table (API), fallback to string-match for backward compat
            const empCount = d.member_count > 0
              ? d.member_count
              : employees.filter(e => e.department === d.name).length;
            return (
              <div key={d.id} className="card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
                {/* Colored top strip */}
                <div className="h-1.5 w-full" style={{ background: color }} />
                <div className="p-5">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: color + '18' }}>
                      <Building2 size={20} style={{ color }} />
                    </div>
                    <div className="flex gap-1">
                      <button className="btn btn-ghost btn-icon text-[#777587] hover:text-[#3525cd]" onClick={() => setEditDept(d)}><Pencil size={14} /></button>
                      <button className="btn btn-ghost btn-icon text-[#777587] hover:text-rose-500" onClick={() => setConfirmDel({ id: d.id, name: d.name })}><Trash2 size={14} /></button>
                    </div>
                  </div>

                  <h3 className="font-black text-[#151c27] text-base leading-tight mb-1">{d.name}</h3>
                  {d.description && <p className="text-xs text-[#777587] line-clamp-2 mb-3">{d.description}</p>}

                  <div className="flex items-center justify-between pt-3 border-t border-[#f0f3ff] mt-3">
                    <div className="flex items-center gap-1.5 text-xs text-[#464555]">
                      <Users size={12} className="text-[#777587]" />
                      <span className="font-semibold">{empCount} member{empCount !== 1 ? 's' : ''}</span>
                    </div>
                    {headUser ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar name={headUser.name} size={20} />
                        <span className="text-xs font-semibold text-[#464555] truncate max-w-[100px]">{headUser.name}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-[#c7c4d8] italic">No head assigned</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addOpen  && <DeptModal open onClose={() => setAddOpen(false)} employees={employees} />}
      {editDept && <DeptModal open onClose={() => setEditDept(null)} dept={editDept} employees={employees} />}
      {/* ENH_DEPT_004: Delete with optional reassign */}
      {confirmDel && (
        <Modal open onClose={() => { setConfirmDel(null); setReassignTarget(''); }} title="Delete Department" size="sm"
          footer={
            <div className="flex justify-end gap-3">
              <button className="btn btn-outline" onClick={() => { setConfirmDel(null); setReassignTarget(''); }}>Cancel</button>
              <button className="btn btn-danger" disabled={delMut.isPending} onClick={async () => {
                if (reassignTarget) {
                  const targetDept = depts.find(d => String(d.id) === reassignTarget);
                  if (targetDept) {
                    const deptEmps = employees.filter(e => e.department === confirmDel.name);
                    await Promise.all(deptEmps.map(e => apiPut(`/employees/${e.id}`, { department: targetDept.name }))).catch(() => {});
                    toast(`${deptEmps.length} employees moved to ${targetDept.name}`, 'success');
                  }
                }
                delMut.mutate(confirmDel.id);
                setConfirmDel(null);
                setReassignTarget('');
              }}>
                {delMut.isPending ? 'Deleting…' : 'Delete Department'}
              </button>
            </div>
          }>
          <div className="space-y-4">
            <p className="text-sm text-[#464555]">Delete "<strong>{confirmDel?.name}</strong>"? This won't delete employees — they'll just be unlinked.</p>
            {(() => {
              const memberCount = employees.filter(e => e.department === confirmDel?.name).length;
              return memberCount > 0 ? (
                <div>
                  <p className="text-xs text-[#777587] mb-2">{memberCount} employee{memberCount !== 1 ? 's are' : ' is'} currently in this department. Move them to another department first?</p>
                  <select className="form-control text-sm" value={reassignTarget} onChange={e => setReassignTarget(e.target.value)}>
                    <option value="">— Keep employees unlinked —</option>
                    {depts.filter(d => d.id !== confirmDel?.id).map(d => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              ) : null;
            })()}
          </div>
        </Modal>
      )}
    </div>
  );
}
