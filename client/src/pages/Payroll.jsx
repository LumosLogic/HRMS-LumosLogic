import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDownload } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { DollarSign, Plus, Play, ChevronDown, ChevronUp, Layers, Download } from 'lucide-react';
import { MONTHS } from '@/lib/utils';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });

// ── Generate Payslip Modal ────────────────────────────────────────────────────
function GenerateModal({ open, onClose, selectedBranchId }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const now   = new Date();
  const [form, setForm] = useState({ user_id: '', month: now.getMonth() + 1, year: now.getFullYear(), other_deductions: 0, notes: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // BUG_132 FIX: self-fetch active employees (with salary_id set) so the
  // dropdown populates independently of the parent pages employee cache.
  // Include selectedBranchId in queryKey so branch switching shows the correct employees.
  const { data: _empForGenerate = [] } = useQuery({
    queryKey: ['payroll-employees-modal', selectedBranchId],
    queryFn: () => apiGet('/payroll/employees'),
    enabled: open,
  });
  const employees = _empForGenerate.filter(e => e.salary_id);

  const mut = useMutation({
    mutationFn: () => apiPost('/payroll/payslips/generate', form),
    onSuccess: () => { toast('Payslip generated!', 'success'); qc.invalidateQueries({ queryKey: ['payslips-all'] }); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Generate Payslip" size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => mut.mutate()} disabled={mut.isPending || !form.user_id}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Generating…</> : <><Play size={14} />Generate</>}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div>
          <label className="form-label">Employee *</label>
          <select className="form-control" value={form.user_id} onChange={e => set('user_id', e.target.value)}>
            <option value="">— Select employee —</option>
            {(employees || []).map(e => {
              const dept = e.departments?.length > 0
                ? e.departments.map(d => d.name).join(', ')
                : (e.department || '');
              return <option key={e.id} value={e.id}>{e.name}{dept ? ` · ${dept}` : ''}</option>;
            })}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Month</label>
            <select className="form-control" value={form.month} onChange={e => set('month', Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label">Year</label>
            <input type="number" className="form-control" value={form.year} onChange={e => set('year', Number(e.target.value))} min={2020} max={2030} />
          </div>
        </div>
        <div>
          <label className="form-label">Additional Deductions (₹)</label>
          <input type="number" className="form-control" min={0} value={form.other_deductions} onChange={e => set('other_deductions', Number(e.target.value))} />
        </div>
        <div>
          <label className="form-label">Notes <span className="font-normal text-[#777587] normal-case tracking-normal">(optional)</span></label>
          <input className="form-control" placeholder="e.g. Bonus included" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ── Payslip Card ──────────────────────────────────────────────────────────────
function PayslipCard({ ps, isAdmin, onPublish }) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf(e) {
    e.stopPropagation();
    setDownloading(true);
    try {
      const blob = await apiDownload(`/payroll/payslips/${ps.id}/pdf`);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Payslip_${MONTHS[Number(ps.month)-1]}_${ps.year}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Download failed');
    } finally { setDownloading(false); }
  }
  const u        = ps.users || {};
  const isDraft  = ps.status === 'draft' || ps.status === 'generated';
  const hasEmployerContrib = Number(ps.pf_employer) > 0 || Number(ps.esi_employer) > 0;
  const ctc = Number(ps.gross_salary) + Number(ps.pf_employer || 0) + Number(ps.esi_employer || 0);

  return (
    <div className="card overflow-hidden hover:shadow-card-hover transition-all duration-200">
      <div className="h-1 w-full" style={{ background: isDraft ? '#F59E0B' : '#10B981' }} />
      <div className="p-5">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setOpen(o => !o)}>
          {isAdmin && <Avatar name={u.name || ''} color={u.avatar_color} size={38} />}
          <div className="flex-1 min-w-0">
            {isAdmin && <div className="font-bold text-[#151c27]">{u.name}</div>}
            <div className="text-xs text-[#777587]">{MONTHS[Number(ps.month) - 1]} {ps.year} {u.department ? `· ${u.department}` : ''}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-black text-xl text-[#3525cd]">{fmt(ps.net_salary)}</div>
            <div className="flex items-center justify-end gap-1.5 mt-1">
              <span className={`badge ${isDraft ? 'badge-pending' : 'badge-approved'}`}>{ps.status}</span>
            </div>
          </div>
          {open ? <ChevronUp size={15} className="text-[#777587] flex-shrink-0" /> : <ChevronDown size={15} className="text-[#777587] flex-shrink-0" />}
        </div>

        {open && (
          <div className="mt-4 pt-4 border-t border-[#f0f3ff]">
            {/* Earnings / Deductions grid */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                <p className="text-[0.68rem] font-black uppercase tracking-widest text-emerald-700 mb-3">Earnings</p>
                {[['Basic', ps.basic],['HRA', ps.hra],['DA', ps.da],['Transport', ps.transport_allowance],['Medical', ps.medical_allowance],['Others', ps.other_allowances]].filter(([,v]) => Number(v) > 0).map(([label, val]) => (
                  <div key={label} className="flex justify-between text-xs mb-1.5">
                    <span className="text-emerald-700">{label}</span>
                    <span className="font-bold text-emerald-800">{fmt(val)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-black pt-2 border-t border-emerald-200 mt-2">
                  <span className="text-emerald-800">Gross</span>
                  <span className="text-emerald-700">{fmt(ps.gross_salary)}</span>
                </div>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-100 p-4">
                <p className="text-[0.68rem] font-black uppercase tracking-widest text-rose-700 mb-3">Deductions</p>
                {[['PF','pf_employee'],['ESI','esi_employee'],['Prof. Tax','professional_tax'],['TDS','tds'],['Retention','retention'],['LOP','lop_amount'],['Other','other_deductions']].filter(([,k]) => Number(ps[k]) > 0).map(([label, key]) => (
                  <div key={key} className="flex justify-between text-xs mb-1.5">
                    <span className="text-rose-700">{label}{key === 'lop_amount' ? ` (${ps.lop_days}d)` : ''}</span>
                    <span className="font-bold text-rose-800">{fmt(ps[key])}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-black pt-2 border-t border-rose-200 mt-2">
                  <span className="text-rose-800">Total</span>
                  <span className="text-rose-700">{fmt(ps.total_deductions)}</span>
                </div>
              </div>
            </div>

            {/* Employer contributions (CTC section) */}
            {hasEmployerContrib && (
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 mb-4">
                <p className="text-[0.68rem] font-black uppercase tracking-widest text-blue-700 mb-3">Employer Contributions</p>
                {Number(ps.pf_employer) > 0 && (
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-blue-700">PF (Employer)</span>
                    <span className="font-bold text-blue-800">{fmt(ps.pf_employer)}</span>
                  </div>
                )}
                {Number(ps.esi_employer) > 0 && (
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-blue-700">ESI (Employer)</span>
                    <span className="font-bold text-blue-800">{fmt(ps.esi_employer)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black pt-2 border-t border-blue-200 mt-2">
                  <span className="text-blue-800">Total CTC / month</span>
                  <span className="text-blue-700">{fmt(ctc)}</span>
                </div>
              </div>
            )}

            {/* Net pay highlight */}
            <div className="rounded-xl bg-gradient-to-r from-[#f0f3ff] to-[#e7eefe] border border-[#c7c4d8] p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-[#777587] uppercase tracking-wide">Net Pay</p>
                <p className="text-xs text-[#464555]">
                  Working: {ps.working_days} · Present: {ps.present_days}
                  {Number(ps.absent_days) > 0 ? ` · Absent: ${ps.absent_days}` : ''}
                  {Number(ps.leave_days) > 0 ? ` · Leave: ${ps.leave_days}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-black text-[#3525cd]">{fmt(ps.net_salary)}</p>
                {ps.notes && <p className="text-xs text-[#777587] italic mt-0.5">{ps.notes}</p>}
              </div>
            </div>

            {/* Download PDF */}
            {ps.status !== 'draft' && (
              <div className="mt-3 flex gap-2">
                <button onClick={downloadPdf} disabled={downloading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#3525cd] text-white text-xs font-bold hover:bg-[#2a1fb0] transition-colors disabled:opacity-50">
                  {downloading
                    ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <Download size={12} />}
                  Download PDF
                </button>
              </div>
            )}
            {/* Publish button (admin only, draft payslips) */}
            {isAdmin && isDraft && (
              <div className="mt-3">
                <button className="btn btn-primary btn-sm" onClick={() => onPublish(ps.id)}>
                  <Play size={12} />Publish Payslip
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Payroll Page ─────────────────────────────────────────────────────────
export default function Payroll() {
  const { isAdmin, user } = useAuth();
  const { selectedBranchId } = useBranch();
  const basePath = user?.role === 'root_admin' ? '/root' : '';
  const wrap = '';
  const toast = useToast();
  const qc    = useQueryClient();
  const now   = new Date();
  const [genOpen,  setGenOpen] = useState(false);
  const [filterY,  setFilterY] = useState(now.getFullYear());
  const [filterM,  setFilterM] = useState(now.getMonth() + 1);

  // Include selectedBranchId in admin queryKey so branch switching invalidates the cache.
  // Employee self-service ('payslips-mine') is not branch-scoped and remains unchanged.
  const { data: _psData, isLoading } = useQuery({
    queryKey: isAdmin ? ['payslips-all', filterM, filterY, selectedBranchId] : ['payslips-mine'],
    queryFn: () => isAdmin
      ? apiGet('/payroll/payslips/all', { month: String(filterM).padStart(2,'0'), year: filterY })
      : apiGet('/payroll/payslips'),
  });
  const payslips  = Array.isArray(_psData)  ? _psData  : [];

  const publishMut = useMutation({
    mutationFn: id => apiPut(`/payroll/payslips/${id}/publish`),
    onSuccess: () => { toast('Payslip published!', 'success'); qc.invalidateQueries({ queryKey: ['payslips-all'] }); },
    onError: e => toast(e.message, 'error'),
  });

  const totalNet = payslips.reduce((s, p) => s + Number(p.net_salary || 0), 0);

  return (
    <div className={wrap}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll</h1>
          <p className="page-subtitle">{isAdmin ? `${payslips.length} payslip${payslips.length !== 1 ? 's' : ''} · total ${fmt(totalNet)}` : 'View your monthly payslips'}</p>
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-wrap">
            <button className="btn btn-outline" onClick={() => setGenOpen(true)}>
              <Plus size={14} />Quick Payslip
            </button>
            <Link to={`${basePath}/payroll/generate`} className="btn btn-primary inline-flex items-center gap-1.5">
              <Layers size={14} />Run Payroll
            </Link>
          </div>
        )}
      </div>

      {/* Stats (admin) */}
      {isAdmin && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Payslips', value: payslips.length,                                       color: 'from-[#f0f3ff] to-[#e7eefe]',   top: '#3525cd', text: 'text-[#3525cd]' },
            { label: 'Total Net Pay',  value: fmt(totalNet),                                         color: 'from-emerald-50 to-emerald-100', top: '#10B981', text: 'text-emerald-700' },
            { label: 'Published',      value: payslips.filter(p => p.status === 'published').length, color: 'from-amber-50 to-amber-100',     top: '#F59E0B', text: 'text-amber-700' },
          ].map(s => (
            <div key={s.label} className={`rounded-xl p-5 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-card relative overflow-hidden`}>
              <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
              <div className={`text-2xl font-black ${s.text}`}>{s.value}</div>
              <div className="text-[0.68rem] font-bold uppercase tracking-wider text-[#777587] mt-1.5">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Period filter (admin only) */}
      {isAdmin && (
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <select className="form-control w-auto" value={filterM} onChange={e => setFilterM(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-white border border-[#c7c4d8] rounded-lg px-2 py-1.5">
            <button onClick={() => setFilterY(y => y - 1)} className="w-7 h-7 flex items-center justify-center rounded text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff]">‹</button>
            <span className="font-black text-[#151c27] min-w-[3rem] text-center text-sm">{filterY}</span>
            <button onClick={() => setFilterY(y => y + 1)} className="w-7 h-7 flex items-center justify-center rounded text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff]">›</button>
          </div>
        </div>
      )}

      {isLoading
        ? <div className="loading"><div className="spinner" />Loading payslips…</div>
        : payslips.length === 0
          ? <div className="empty-state"><DollarSign size={48} className="mx-auto mb-3 text-[#c7c4d8]" /><p className="font-semibold text-[#464555] mb-1">No payslips yet</p><p className="text-sm">{isAdmin ? 'Generate payslips for your employees' : 'Your payslips will appear here once generated'}</p></div>
          : <div className="flex flex-col gap-3">{payslips.map(ps => <PayslipCard key={ps.id} ps={ps} isAdmin={isAdmin} onPublish={id => publishMut.mutate(id)} />)}</div>}

      {genOpen && <GenerateModal open onClose={() => setGenOpen(false)} selectedBranchId={selectedBranchId} />}
    </div>
  );
}
