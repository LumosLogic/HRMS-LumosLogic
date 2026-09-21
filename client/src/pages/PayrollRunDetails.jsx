import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Lock, Unlock, CheckCircle2, AlertCircle, AlertTriangle,
  Clock, ChevronRight, Users, IndianRupee, ShieldCheck, ThumbsUp,
  CreditCard, PlusCircle, Trash2, Download, ChevronDown, Mail, GitBranch,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { MONTHS, cn } from '@/lib/utils';

const fmt  = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const fmtD = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

const STATUS_META = {
  draft:                  { label: 'Draft',               cls: 'bg-[#f0f3ff] text-[#3525cd]',   Icon: Clock },
  processing:             { label: 'Processing',          cls: 'bg-amber-50 text-amber-700',     Icon: Clock },
  completed:              { label: 'Completed',           cls: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  completed_with_errors:  { label: 'Completed w/ Errors', cls: 'bg-orange-50 text-orange-700',   Icon: AlertTriangle },
  failed:                 { label: 'Failed',              cls: 'bg-red-50 text-red-700',         Icon: AlertCircle },
  verified:               { label: 'Verified',            cls: 'bg-violet-50 text-violet-700',   Icon: ShieldCheck },
  approved:               { label: 'Approved',            cls: 'bg-blue-50 text-blue-700',       Icon: ThumbsUp },
  locked:                 { label: 'Locked',              cls: 'bg-slate-100 text-slate-600',    Icon: Lock },
  paid:                   { label: 'Paid',                cls: 'bg-teal-50 text-teal-700',       Icon: CreditCard },
};

const ADJ_CATEGORY_COLORS = {
  BONUS: 'bg-emerald-50 text-emerald-700', INCENTIVE: 'bg-emerald-50 text-emerald-700',
  COMMISSION: 'bg-blue-50 text-blue-700',  OVERTIME: 'bg-violet-50 text-violet-700',
  REIMBURSEMENT: 'bg-cyan-50 text-cyan-700', ARREARS: 'bg-teal-50 text-teal-700',
  ADVANCE_RECOVERY: 'bg-rose-50 text-rose-700', LOAN_EMI: 'bg-rose-50 text-rose-700',
  PENALTY: 'bg-red-50 text-red-700', DEDUCTION: 'bg-red-50 text-red-700',
  OTHER: 'bg-gray-100 text-gray-600',
};

const EMP_STATUS_META = {
  success: { label: 'Success', cls: 'text-emerald-600' },
  failed:  { label: 'Failed',  cls: 'text-red-500' },
  pending: { label: 'Pending', cls: 'text-amber-600' },
  skipped: { label: 'Skipped', cls: 'text-slate-400' },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-600', Icon: Clock };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${m.cls}`}>
      <m.Icon size={12} />
      {m.label}
    </span>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className="bg-white border border-[#e2e0f0] rounded-xl p-4">
      <p className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{label}</p>
      <p className={`text-xl font-black mt-1 ${accent || 'text-[#151c27]'}`}>{value}</p>
    </div>
  );
}

function ConfirmDialog({ title, message, onOk, onCancel, danger = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 pt-6 pb-3">
          <p className="font-black text-[#151c27] text-base mb-1.5">{title}</p>
          <p className="text-sm text-[#777587] leading-relaxed">{message}</p>
        </div>
        <div className="px-6 pb-5 pt-2 flex gap-2 justify-end">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-bold text-[#464555] border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-colors">
            Cancel
          </button>
          <button onClick={onOk}
            className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors ${
              danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#3525cd] hover:bg-[#2a1fb0]'
            }`}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PayrollRunDetails() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const toast    = useToast();
  const qc       = useQueryClient();
  const { user } = useAuth();

  const isRootAdmin = user?.role === 'root_admin';
  const basePath    = isRootAdmin ? '/root' : '';

  const { data: run, isLoading, error } = useQuery({
    queryKey: ['payroll-run', id],
    queryFn:  () => apiGet(`/payroll/runs/${id}`),
    enabled:  Boolean(id),
  });

  const [adjOpen, setAdjOpen] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState(null); // { title, message, onOk, danger? }
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const bankDropdownRef = useRef(null);

  useEffect(() => {
    if (!bankDropdownOpen) return;
    function handleClick(e) {
      if (bankDropdownRef.current && !bankDropdownRef.current.contains(e.target)) {
        setBankDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [bankDropdownOpen]);

  async function downloadBankFile(format) {
    const token    = localStorage.getItem('lt_token');
    const branchId = localStorage.getItem('lt_selected_branch');
    try {
      const res = await fetch(`/api/payroll/bank-file/${id}?format=${format}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(branchId ? { 'X-Branch-Id': branchId } : {}),
        },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast(d.error || 'Bank file download failed', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bank_${format}_run${id}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast('Bank file download failed: ' + e.message, 'error');
    }
    setBankDropdownOpen(false);
  }

  const sendEmailsMut = useMutation({
    mutationFn: () => apiPost(`/payroll/runs/${id}/send-emails`),
    onSuccess: d => toast(`Payslips sent: ${d.sent} success, ${d.failed} failed`, d.failed > 0 ? 'warning' : 'success'),
    onError: e => toast(e.message, 'error'),
  });
  const [adjForm, setAdjForm] = useState({
    user_id: '', adjustment_category: 'BONUS', amount: '',
    addition_or_deduction: 'addition', remarks: '',
    effective_month: new Date().getMonth() + 1,
    effective_year:  new Date().getFullYear(),
  });

  const lockMut = useMutation({
    mutationFn: () => apiPost(`/payroll/lock/${id}`),
    onSuccess:  () => {
      toast('Payroll run locked', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const unlockMut = useMutation({
    mutationFn: () => apiPost(`/payroll/unlock/${id}`),
    onSuccess:  () => {
      toast('Payroll run unlocked', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const verifyMut = useMutation({
    mutationFn: () => apiPost(`/payroll/runs/${id}/verify`),
    onSuccess:  () => {
      toast('Payroll run verified', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const approveMut = useMutation({
    mutationFn: () => apiPost(`/payroll/runs/${id}/approve`),
    onSuccess:  () => {
      toast('Payroll run approved', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const markPaidMut = useMutation({
    mutationFn: () => apiPost(`/payroll/runs/${id}/mark-paid`),
    onSuccess:  () => {
      toast('Payroll run marked as paid', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const createAdjMut = useMutation({
    mutationFn: () => apiPost('/payroll/adjustments', {
      ...adjForm,
      payroll_run_id: parseInt(id, 10),
      amount: parseFloat(adjForm.amount),
      effective_month: parseInt(adjForm.effective_month, 10),
      effective_year:  parseInt(adjForm.effective_year,  10),
    }),
    onSuccess: () => {
      toast('Adjustment added', 'success');
      setAdjOpen(false);
      setAdjForm(f => ({ ...f, user_id: '', amount: '', remarks: '' }));
      qc.invalidateQueries({ queryKey: ['run-adjustments', id] });
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const deleteAdjMut = useMutation({
    mutationFn: adjId => apiDelete(`/payroll/adjustments/${adjId}`),
    onSuccess: () => {
      toast('Adjustment removed', 'success');
      qc.invalidateQueries({ queryKey: ['run-adjustments', id] });
      qc.invalidateQueries({ queryKey: ['payroll-run', id] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const { data: adjustments = [] } = useQuery({
    queryKey: ['run-adjustments', id],
    queryFn:  () => apiGet('/payroll/adjustments', { runId: id }),
    enabled:  Boolean(id),
  });

  const fmt2 = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  const canLock    = run && isRootAdmin && ['completed', 'completed_with_errors', 'approved'].includes(run.status);
  const canUnlock  = run?.status === 'locked' && isRootAdmin;
  const canVerify  = run && ['completed', 'completed_with_errors'].includes(run.status);
  const canApprove = run?.status === 'verified' && isRootAdmin;
  const canPaid    = run && ['locked', 'approved'].includes(run.status) && isRootAdmin;
  const canAddAdj  = run && !['locked', 'paid'].includes(run.status);

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <span className="w-7 h-7 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="text-center py-24">
        <AlertCircle size={36} className="text-red-400 mx-auto mb-3" />
        <p className="text-sm text-[#777587]">{error?.message || 'Payroll run not found'}</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sm text-[#3525cd] font-bold hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const employees = run.employees || [];
  const failed    = employees.filter(e => e.employee_status === 'failed');

  return (
    <div className="space-y-6">
      {confirmDlg && (
        <ConfirmDialog
          title={confirmDlg.title}
          message={confirmDlg.message}
          danger={confirmDlg.danger}
          onOk={() => { confirmDlg.onOk(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate(`${basePath}/payroll/generate`)}
          className="flex items-center gap-1.5 text-[#777587] hover:text-[#3525cd] font-medium transition-colors"
        >
          <ArrowLeft size={15} />
          Payroll Generation
        </button>
        <span className="text-[#c7c4d8]">/</span>
        <span className="font-bold text-[#151c27]">{MONTHS[run.month - 1]} {run.year}</span>
      </div>

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-black text-[#151c27]">{MONTHS[run.month - 1]} {run.year}</h1>
            <StatusBadge status={run.status} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-[#777587]">
              Generated by {run.generated_by_name || 'System'} ·{' '}
              {new Date(run.generated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
              {run.status === 'locked' && run.locked_by_name && (
                <> · Locked by {run.locked_by_name}</>
              )}
            </p>
            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd]">
              <GitBranch size={10} />
              {run.branch_name || 'All Branches'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canVerify && (
            <button onClick={() => setConfirmDlg({
                title: 'Verify Payroll Run',
                message: 'Confirm that all payroll figures are correct. This marks the run as verified and ready for approval.',
                onOk: () => verifyMut.mutate(),
              })}
              disabled={verifyMut.isPending}
              className="inline-flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-violet-700 transition-colors disabled:opacity-50">
              <ShieldCheck size={14} /> Verify
            </button>
          )}
          {canApprove && (
            <button onClick={() => setConfirmDlg({
                title: 'Approve Payroll Run',
                message: 'Approve this payroll run for payment processing. Payslips will be sent to employees if auto-email is enabled.',
                onOk: () => approveMut.mutate(),
              })}
              disabled={approveMut.isPending}
              className="inline-flex items-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-blue-700 transition-colors disabled:opacity-50">
              <ThumbsUp size={14} /> Approve
            </button>
          )}
          {canLock && (
            <button onClick={() => setConfirmDlg({
                title: 'Lock Payroll Run',
                message: 'Lock this run? All payslips will become immutable and cannot be modified.',
                onOk: () => lockMut.mutate(),
                danger: true,
              })}
              disabled={lockMut.isPending}
              className="inline-flex items-center gap-2 bg-slate-800 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-slate-900 transition-colors disabled:opacity-50">
              {lockMut.isPending ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Lock size={14} />}
              Lock Run
            </button>
          )}
          {canUnlock && (
            <button onClick={() => setConfirmDlg({
                title: 'Unlock Payroll Run',
                message: 'Unlock this run? It will return to editable state.',
                onOk: () => unlockMut.mutate(),
              })}
              disabled={unlockMut.isPending}
              className="inline-flex items-center gap-2 bg-amber-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-amber-700 transition-colors disabled:opacity-50">
              {unlockMut.isPending ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Unlock size={14} />}
              Unlock Run
            </button>
          )}
          {canPaid && (
            <button onClick={() => setConfirmDlg({
                title: 'Mark as Paid',
                message: 'Confirm that salaries have been credited to all employees\' bank accounts.',
                onOk: () => markPaidMut.mutate(),
              })}
              disabled={markPaidMut.isPending}
              className="inline-flex items-center gap-2 bg-teal-600 text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-teal-700 transition-colors disabled:opacity-50">
              <CreditCard size={14} /> Mark Paid
            </button>
          )}
          {/* Send payslip emails */}
          {['approved','locked','paid'].includes(run?.status) && isRootAdmin && (
            <button
              onClick={() => setConfirmDlg({
                title: 'Send Payslip Emails',
                message: `Send payslip emails with PDF attachments to all ${employees.length} employee(s) in this run?`,
                onOk: () => sendEmailsMut.mutate(),
              })}
              disabled={sendEmailsMut.isPending}
              className="inline-flex items-center gap-2 bg-white border border-[#c7c4d8] text-[#464555] rounded-lg px-4 py-2 text-sm font-bold hover:bg-[#f0f3ff] transition-colors disabled:opacity-50">
              {sendEmailsMut.isPending
                ? <span className="w-4 h-4 border-2 border-[#464555]/30 border-t-[#464555] rounded-full animate-spin" />
                : <Mail size={14} />}
              Send Payslips
            </button>
          )}
          {/* Bank file download */}
          {['locked','approved','paid'].includes(run?.status) && (
            <div ref={bankDropdownRef} className="relative">
              <button
                onClick={() => setBankDropdownOpen(o => !o)}
                className="inline-flex items-center gap-2 bg-white border border-[#c7c4d8] text-[#464555] rounded-lg px-4 py-2 text-sm font-bold hover:bg-[#f0f3ff] transition-colors">
                <Download size={14} /> Bank File <ChevronDown size={12} />
              </button>
              {bankDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-[#e2e0f0] rounded-xl shadow-lg z-20 w-44 overflow-hidden">
                  {[
                    ['generic', 'Generic CSV'],
                    ['hdfc',    'HDFC Format'],
                    ['icici',   'ICICI Format'],
                    ['sbi',     'SBI Format'],
                    ['axis',    'Axis Format'],
                  ].map(([fmt, label]) => (
                    <button key={fmt} onClick={() => downloadBankFile(fmt)}
                      className="w-full text-left px-4 py-2.5 text-sm text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-colors">
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Total Employees"  value={run.employee_count} />
        <StatCard label="Total Gross"      value={fmt(run.total_gross)} />
        <StatCard label="Total Deductions" value={fmt(run.total_deductions)} accent="text-rose-600" />
        <StatCard label="Net Pay"          value={fmt(run.total_net)} accent="text-emerald-700" />
      </div>
      {Number(run.total_adjustments) !== 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard label="Adjustments (Net)" value={fmt(run.total_adjustments)} accent={Number(run.total_adjustments) >= 0 ? 'text-emerald-700' : 'text-rose-600'} />
          <StatCard label="Effective Net Pay" value={fmt(Number(run.total_net || 0) + Number(run.total_adjustments || 0))} accent="text-[#3525cd]" />
        </div>
      )}

      {/* ── Failed employees alert ── */}
      {failed.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex gap-3">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-red-700">{failed.length} employee(s) failed processing</p>
            <ul className="mt-1.5 space-y-0.5">
              {failed.map(e => (
                <li key={e.user_id} className="text-xs text-red-600">
                  <span className="font-bold">{e.name}</span>: {e.error_message || 'Unknown error'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── Adjustments Panel ── */}
      <div className="bg-white border border-[#e2e0f0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e2e0f0] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PlusCircle size={15} className="text-[#3525cd]" />
            <p className="font-black text-[#151c27]">Adjustments</p>
            {adjustments.length > 0 && (
              <span className="text-[0.65rem] font-black bg-[#f0f3ff] text-[#3525cd] px-2 py-0.5 rounded-full">{adjustments.length}</span>
            )}
          </div>
          {canAddAdj && (
            <button onClick={() => setAdjOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs font-bold text-[#3525cd] px-3 py-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-all">
              <PlusCircle size={12} /> Add Adjustment
            </button>
          )}
        </div>

        {/* Add form */}
        {adjOpen && (
          <div className="px-5 py-4 bg-[#fafaff] border-b border-[#e2e0f0]">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587] mb-1 block">Employee</label>
                <select value={adjForm.user_id} onChange={e => setAdjForm(f => ({ ...f, user_id: e.target.value }))}
                  className="w-full border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#3525cd] bg-white">
                  <option value="">— Select —</option>
                  {(run.employees || []).filter(e => e.employee_status === 'success').map(e => (
                    <option key={e.user_id} value={e.user_id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587] mb-1 block">Category</label>
                <select value={adjForm.adjustment_category} onChange={e => setAdjForm(f => ({ ...f, adjustment_category: e.target.value }))}
                  className="w-full border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#3525cd] bg-white">
                  {['BONUS','INCENTIVE','COMMISSION','OVERTIME','REIMBURSEMENT','ARREARS','ADVANCE_RECOVERY','LOAN_EMI','PENALTY','DEDUCTION','OTHER'].map(c => (
                    <option key={c} value={c}>{c.replace(/_/g,' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587] mb-1 block">Type</label>
                <div className="flex gap-2">
                  {[['addition','Addition'],['deduction','Deduction']].map(([v, l]) => (
                    <button key={v} onClick={() => setAdjForm(f => ({ ...f, addition_or_deduction: v }))}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border flex-1 transition-all',
                        adjForm.addition_or_deduction === v
                          ? v === 'addition' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-rose-600 text-white border-rose-600'
                          : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'
                      )}>{l}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587] mb-1 block">Amount (₹)</label>
                <input type="number" min={0} placeholder="0.00"
                  value={adjForm.amount} onChange={e => setAdjForm(f => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#3525cd]" />
              </div>
              <div>
                <label className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587] mb-1 block">Remarks</label>
                <input placeholder="Optional note"
                  value={adjForm.remarks} onChange={e => setAdjForm(f => ({ ...f, remarks: e.target.value }))}
                  className="w-full border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#3525cd]" />
              </div>
              <div className="flex items-end">
                <button onClick={() => createAdjMut.mutate()}
                  disabled={createAdjMut.isPending || !adjForm.user_id || !adjForm.amount}
                  className="w-full bg-[#3525cd] text-white rounded-lg px-4 py-1.5 text-sm font-bold hover:bg-[#2a1fb0] transition-all disabled:opacity-50">
                  {createAdjMut.isPending ? 'Saving…' : 'Save Adjustment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Adjustment list */}
        {adjustments.length === 0 ? (
          <p className="text-center text-sm text-[#777587] py-8">No adjustments for this run.</p>
        ) : (
          <div className="divide-y divide-[#f0eef8]">
            {adjustments.map(adj => (
              <div key={adj.id} className="flex items-center gap-3 px-5 py-3 hover:bg-[#fafaff]">
                <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full ${ADJ_CATEGORY_COLORS[adj.adjustment_category] || 'bg-gray-100 text-gray-600'}`}>
                  {adj.adjustment_category.replace(/_/g,' ')}
                </span>
                <span className="text-sm font-semibold text-[#151c27] flex-1 truncate">{adj.employee_name}</span>
                <span className="text-xs text-[#777587]">{adj.remarks || '—'}</span>
                <span className={`text-sm font-black min-w-[80px] text-right ${adj.addition_or_deduction === 'addition' ? 'text-emerald-700' : 'text-rose-600'}`}>
                  {adj.addition_or_deduction === 'addition' ? '+' : '−'}{fmt2(adj.amount)}
                </span>
                {canAddAdj && (
                  <button onClick={() => setConfirmDlg({
                      title: 'Remove Adjustment',
                      message: 'Remove this adjustment? This cannot be undone.',
                      onOk: () => deleteAdjMut.mutate(adj.id),
                      danger: true,
                    })}
                    className="text-[#c7c4d8] hover:text-rose-500 transition-colors ml-1">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Employee Breakdown ── */}
      <div className="bg-white border border-[#e2e0f0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e2e0f0] flex items-center justify-between">
          <p className="font-black text-[#151c27]">Employee Payslips</p>
          <span className="text-xs text-[#777587]">{employees.length} employees</span>
        </div>
        {employees.length === 0 ? (
          <p className="text-center text-sm text-[#777587] py-12">No employees processed.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f9f9ff] border-b border-[#e2e0f0]">
                {['Employee', 'Gross', 'Deductions', 'Net Pay', 'LOP', 'Status', ''].map(h => (
                  <th key={h} className={`text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-4 py-2.5 ${h === '' ? '' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0eef8]">
              {employees.map(emp => {
                const em = EMP_STATUS_META[emp.employee_status] || { label: emp.employee_status, cls: 'text-gray-500' };
                const canView = emp.employee_status === 'success' && emp.payslip_id;
                return (
                  <tr
                    key={emp.user_id}
                    className={`hover:bg-[#f9f9ff] ${canView ? 'cursor-pointer' : ''}`}
                    onClick={() => canView && navigate(`${basePath}/payroll/payslips/${emp.payslip_id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={emp.name} size={28} color={emp.avatar_color} />
                        <div>
                          <p className="font-bold text-[#151c27] text-xs">{emp.name}</p>
                          <p className="text-[0.65rem] text-[#777587]">{emp.department || emp.employee_id || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-[#151c27]">
                      {emp.gross_salary != null ? fmtD(emp.gross_salary) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-rose-600 font-bold">
                      {emp.total_deductions != null ? fmtD(emp.total_deductions) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-black text-emerald-700">
                      {emp.net_salary != null ? fmtD(emp.net_salary) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#777587]">
                      {emp.lop_days != null ? emp.lop_days : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-bold ${em.cls}`}>{em.label}</span>
                        {emp.locked && <Lock size={10} className="text-slate-400" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canView && <ChevronRight size={14} className="text-[#c7c4d8] ml-auto" />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
