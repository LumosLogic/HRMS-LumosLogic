import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList, CheckCircle2, XCircle, Clock, Umbrella, Home,
  Search, ChevronLeft, ChevronRight, Check, X,
  Receipt, Download, FileText, X as XIcon,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPut } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { fmtDate } from '@/lib/utils';

// ── Currency helper ───────────────────────────────────────────────────────────
const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// ── Type badge config ─────────────────────────────────────────────────────────
const TYPE_CFG = {
  leave:   { label: 'Leave Request',   icon: <Umbrella size={13} />, bg: 'bg-amber-50',    text: 'text-amber-700',    border: 'border-amber-200'   },
  wfh:     { label: 'WFH Request',     icon: <Home size={13} />,     bg: 'bg-[#f0f3ff]',   text: 'text-[#3525cd]',    border: 'border-[#c7c4d8]'   },
  reg:     { label: 'Regularization',  icon: <Clock size={13} />,    bg: 'bg-orange-50',   text: 'text-orange-700',   border: 'border-orange-200'  },
  expense: { label: 'Expense Claim',   icon: <Receipt size={13} />,  bg: 'bg-emerald-50',  text: 'text-emerald-700',  border: 'border-emerald-200' },
};

function TypeBadge({ kind }) {
  const cfg = TYPE_CFG[kind] || TYPE_CFG.leave;
  return (
    <span className={`inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

const ROWS_OPTIONS = [5, 10, 20, 50];

// ── In-page receipt viewer ────────────────────────────────────────────────────
function ReceiptViewer({ url, onClose }) {
  if (!url) return null;
  const isPdf = /\.pdf($|\?)/i.test(url) || url.includes('%2Fpdf') || url.includes('application/pdf');
  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4"
      style={{ background: 'rgba(21,28,39,.80)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl overflow-hidden w-full max-w-3xl flex flex-col shadow-2xl"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#f0f3ff] flex-shrink-0">
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-[#3525cd]" />
            <span className="font-black text-sm text-[#151c27]">Receipt</span>
          </div>
          <div className="flex items-center gap-2">
            <a href={url} download target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:border-[#3525cd] transition-all">
              <Download size={13} /> Download
            </a>
            <button onClick={onClose}
              className="p-1.5 rounded-lg text-[#777587] hover:text-[#151c27] hover:bg-[#f0f3ff] transition-colors">
              <XIcon size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-[#151c27] flex items-center justify-center p-4" style={{ minHeight: 200 }}>
          {isPdf ? (
            <iframe src={url} title="Receipt" className="w-full rounded-lg"
              style={{ height: 'calc(92vh - 60px)', border: 'none' }} />
          ) : (
            <img src={url} alt="Receipt" className="max-w-full object-contain rounded-lg shadow-xl"
              style={{ maxHeight: 'calc(92vh - 60px)' }} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Expense review modal ──────────────────────────────────────────────────────
function ExpenseReviewModal({ open, onClose, expense, onDone }) {
  const toast = useToast();
  const [notes, setNotes] = useState('');
  const [viewReceipt, setViewReceipt] = useState(null);

  const mut = useMutation({
    mutationFn: status => apiPut(`/expenses/${expense.id}/review`, { status, reviewer_notes: notes }),
    onSuccess: (_, status) => {
      toast(status === 'approved' ? 'Expense approved!' : 'Expense rejected', status === 'approved' ? 'success' : 'warning');
      onDone();
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  if (!expense) return null;

  const statusCls = {
    pending:          'bg-amber-50 text-amber-700 border-amber-200',
    manager_approved: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <>
      <Modal open={open} onClose={onClose} title="Review Expense Claim" size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={() => mut.mutate('rejected')} disabled={mut.isPending}>
              {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Reject'}
            </button>
            <button className="btn btn-primary" onClick={() => mut.mutate('approved')} disabled={mut.isPending}>
              {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Approve'}
            </button>
          </div>
        }>
        <div className="space-y-3">
          {/* Expense detail card */}
          <div className="rounded-xl bg-[#f9f9ff] border border-[#e7eefe] p-4 space-y-2 text-xs">
            <div className="flex items-start justify-between gap-2">
              <p className="font-bold text-[#151c27] text-sm leading-snug">{expense.title}</p>
              {expense.status && (
                <span className={`inline-flex items-center text-[0.6rem] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${statusCls[expense.status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                  {expense.status === 'manager_approved' ? 'Mgr Approved' : 'Pending'}
                </span>
              )}
            </div>
            <p><span className="text-[#777587]">Submitted by:</span> <span className="font-semibold">{expense.user_name || '—'}</span></p>
            <p><span className="text-[#777587]">Amount:</span> <span className="font-black text-[#3525cd] text-base">{fmt(expense.amount)}</span></p>
            <p><span className="text-[#777587]">Date:</span> <span className="font-semibold">{fmtDate(expense.expense_date)}</span></p>
            <p><span className="text-[#777587]">Category:</span> <span className="capitalize font-semibold">{expense.category}</span></p>
            {expense.description && (
              <p><span className="text-[#777587]">Description:</span> <span>{expense.description}</span></p>
            )}
            {expense.manager_notes && (
              <div className="mt-1 p-2 rounded-lg bg-amber-50 border border-amber-200">
                <span className="text-amber-700 font-semibold">Manager note: </span>{expense.manager_notes}
              </div>
            )}
            {/* Receipt — opens in-page viewer */}
            {expense.receipt_url ? (
              <button type="button" onClick={() => setViewReceipt(expense.receipt_url)}
                className="flex items-center gap-1.5 mt-1 text-[#3525cd] hover:underline font-semibold">
                <Receipt size={11} /> View Receipt
              </button>
            ) : (
              <p className="text-[#9ca3af] italic">No receipt attached</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="form-label">Notes <span className="font-normal text-[#777587] normal-case tracking-normal">(sent to employee)</span></label>
            <textarea className="form-control" rows={2} placeholder="Optional review notes…"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
      </Modal>
      {viewReceipt && <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />}
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PendingApprovals() {
  const toast = useToast();
  const qc    = useQueryClient();
  const { selectedBranchId } = useBranch();

  const [tab,         setTab]         = useState('all');
  const [search,      setSearch]      = useState('');
  const [deptFilt,    setDeptFilt]    = useState('');
  const [page,        setPage]        = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [reviewExpense, setReviewExpense] = useState(null);
  // EHN_PA_001: Bulk selection state
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [historyTab,  setHistoryTab]  = useState(false); // EHN_PA_007

  // ── Queries ─────────────────────────────────────────────────────────────────
  // Fetch ALL leaves in any pending state so root/HR admin see the full picture.
  // Includes both old-flow ('pending','pending_root') and new-flow ('pending_approval','pending_dept').
  const { data: _allLeaves = [], isLoading: loadLeaves } = useQuery({
    queryKey: ['pending-approvals-leaves', selectedBranchId],
    queryFn:  () => apiGet('/leaves').catch(() => []),
    select:   d  => (Array.isArray(d) ? d : []).filter(l =>
      ['pending', 'pending_approval', 'pending_dept', 'pending_root'].includes(l.status)
    ),
    refetchInterval: 30000,
  });

  const { data: _rootLeaves = [], isLoading: loadRootLeaves } = useQuery({
    queryKey: ['pending-root-leaves', selectedBranchId],
    queryFn:  () => apiGet('/leaves/pending-root').catch(() => []),
    select:   d  => (Array.isArray(d) ? d : []).filter(l => l._flow === 'legacy' || l.status === 'pending_root'),
    refetchInterval: 30000,
  });

  // my-approvals returns leaves where THIS user must act (enriched with current_level_* fields).
  // We show ALL of them regardless of which role type is required — root admin has full visibility.
  const { data: _myApprovals = [], isLoading: loadMyApprovals } = useQuery({
    queryKey: ['my-workflow-approvals', selectedBranchId],
    queryFn:  () => apiGet('/leaves/my-approvals').catch(() => []),
    refetchInterval: 30000,
  });

  const { data: _regs = [], isLoading: loadRegs } = useQuery({
    queryKey: ['pending-approvals-regs', selectedBranchId],
    queryFn:  () => apiGet('/regularization').catch(() => []),
    select:   d  => (Array.isArray(d) ? d : []).filter(r => r.status === 'pending'),
    refetchInterval: 30000,
  });

  // Pending expenses — 'pending' (no manager) and 'manager_approved' (ready for HR/admin)
  const { data: _expenses = [], isLoading: loadExpenses } = useQuery({
    queryKey: ['pending-approvals-expenses', selectedBranchId],
    queryFn:  () => apiGet('/expenses').catch(() => []),
    select:   d  => (Array.isArray(d) ? d : []).filter(e => ['pending', 'manager_approved'].includes(e.status)),
    refetchInterval: 30000,
  });

  const isLoading = loadLeaves || loadRegs || loadRootLeaves || loadMyApprovals || loadExpenses;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['pending-approvals-leaves'] });
    qc.invalidateQueries({ queryKey: ['pending-approvals-all-leaves'] });
    qc.invalidateQueries({ queryKey: ['pending-root-leaves'] });
    qc.invalidateQueries({ queryKey: ['my-workflow-approvals'] });
    qc.invalidateQueries({ queryKey: ['pending-approvals-regs'] });
    qc.invalidateQueries({ queryKey: ['pending-approvals-expenses'] });
    qc.invalidateQueries({ queryKey: ['expenses'] });
    qc.invalidateQueries({ queryKey: ['root-dashboard'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  }

  // ── Leave / reg mutations ────────────────────────────────────────────────────
  const approveLeaveMut = useMutation({
    mutationFn: id => apiPut(`/leaves/${id}/approve`),
    onSuccess:  () => { toast('Leave approved!', 'success'); invalidate(); },
    onError:    e  => toast(e.message, 'error'),
  });
  const rejectLeaveMut = useMutation({
    mutationFn: id => apiPut(`/leaves/${id}/reject`),
    onSuccess:  () => { toast('Leave rejected', 'warning'); invalidate(); },
    onError:    e  => toast(e.message, 'error'),
  });
  const approveRegMut = useMutation({
    mutationFn: id => apiPut(`/regularization/${id}/review`, { status: 'approved' }),
    onSuccess:  () => { toast('Regularization approved!', 'success'); invalidate(); },
    onError:    e  => toast(e.message, 'error'),
  });
  const rejectRegMut = useMutation({
    mutationFn: id => apiPut(`/regularization/${id}/review`, { status: 'rejected' }),
    onSuccess:  () => { toast('Regularization rejected', 'warning'); invalidate(); },
    onError:    e  => toast(e.message, 'error'),
  });

  // EHN_PA_007: My Approval History
  const { data: approvalHistory = [] } = useQuery({
    queryKey: ['my-approval-history'],
    queryFn:  () => apiGet('/leaves/my-history').catch(() => []),
    enabled: historyTab,
    staleTime: 60000,
  });

  const isBusy = approveLeaveMut.isPending || rejectLeaveMut.isPending ||
    approveRegMut.isPending || rejectRegMut.isPending;

  // EHN_PA_001: Bulk approve/reject
  async function handleBulkApprove() {
    const items = paginated.filter(i => selectedIds.has(`${i._flow}-${i.id}`) && i._kind !== 'expense');
    for (const item of items) { await handleApprove(item); }
    setSelectedIds(new Set());
    toast(`${items.length} items approved`, 'success');
  }
  async function handleBulkReject() {
    const items = paginated.filter(i => selectedIds.has(`${i._flow}-${i.id}`) && i._kind !== 'expense');
    for (const item of items) { await handleReject(item); }
    setSelectedIds(new Set());
    toast(`${items.length} items rejected`, 'warning');
  }

  const isWfh = l => l.leave_type === 'wfh' || l.leave_time === 'wfh';

  // ── Unified list ─────────────────────────────────────────────────────────────
  // my-approvals has enriched current_level_* data. Use that as the authoritative
  // source for workflow leaves; fall back to _allLeaves for any not returned there.
  const myApprovalIds = new Set(_myApprovals.map(l => l.id));

  // Workflow leaves from my-approvals (no level restriction — root admin sees all)
  const workflowLeaves = _myApprovals.map(l => ({
    ...l, _kind: isWfh(l) ? 'wfh' : 'leave', _name: l.name, _dept: l.department || '', _flow: 'new',
  }));

  // All pending leaves that didn't come through my-approvals (old-flow + any missed new-flow)
  const otherLeaves = _allLeaves
    .filter(l => !myApprovalIds.has(l.id)) // deduplicate — already covered above
    .map(l => ({
      ...l,
      _kind: isWfh(l) ? 'wfh' : 'leave',
      _name: l.name,
      _dept: l.department || '',
      // Map by actual status so they land on the right tab
      _flow: ['pending_approval','pending_dept'].includes(l.status)
        ? 'new'
        : l.status === 'pending_root' ? 'old_root'
        : 'old_pending',
    }));

  // Legacy pending_root leaves from the dedicated endpoint (may have extra data)
  const rootLeavesExtra = _rootLeaves
    .filter(l => !myApprovalIds.has(l.id) && !otherLeaves.find(o => o.id === l.id))
    .map(l => ({ ...l, _kind: isWfh(l) ? 'wfh' : 'leave', _name: l.name, _dept: l.department || '', _flow: 'old_root' }));

  const regs     = _regs.map(r => ({ ...r, _kind: 'reg',     _name: r.user_name,  _dept: r.user_department || '', _flow: 'reg' }));
  const expenses = _expenses.map(e => ({ ...e, _kind: 'expense', _name: e.user_name, _dept: '', _flow: 'expense' }));

  const all = [...workflowLeaves, ...otherLeaves, ...rootLeavesExtra, ...regs, ...expenses]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const newWorkflowCount = [...workflowLeaves, ...otherLeaves.filter(l => l._flow === 'new')].length;
  const oldRootCount     = [...otherLeaves.filter(l => l._flow === 'old_root'), ...rootLeavesExtra].length;
  const legacyLeaveCount = otherLeaves.filter(l => l._flow === 'old_pending' && l._kind === 'leave').length;
  const expenseCount     = expenses.length;
  const regCount         = regs.length;
  const totalCount       = all.length;

  const summaryCards = [
    { label: 'Total Pending',       value: totalCount,        bg: 'bg-amber-50',   text: 'text-amber-700',   icon: <ClipboardList size={16} />, tabKey: 'all'      },
    { label: 'Leave / WFH',         value: newWorkflowCount + legacyLeaveCount + oldRootCount,
                                                               bg: 'bg-[#f0f3ff]',  text: 'text-[#3525cd]',   icon: <CheckCircle2 size={16} />,  tabKey: 'workflow' },
    { label: 'Regularization',      value: regCount,          bg: 'bg-orange-50',  text: 'text-orange-700',  icon: <Clock size={16} />,         tabKey: 'reg'      },
    { label: 'Expense Claims',       value: expenseCount,     bg: 'bg-emerald-50', text: 'text-emerald-700', icon: <Receipt size={16} />,       tabKey: 'expense'  },
  ];

  const TABS = [
    { key: 'all',      label: `All (${totalCount})` },
    { key: 'workflow', label: `Workflow Leaves (${newWorkflowCount})`, highlight: newWorkflowCount > 0 },
    { key: 'root',     label: `Pending Final (${oldRootCount})` },
    { key: 'leave',    label: `Legacy Leave (${legacyLeaveCount})` },
    { key: 'reg',      label: `Regularization (${regCount})` },
    { key: 'expense',  label: `Expenses (${expenseCount})`,            highlight: expenseCount > 0 },
  ];

  const depts = [...new Set(all.map(r => r._dept).filter(Boolean))].sort();

  const filtered = all.filter(r => {
    if (tab === 'workflow') return r._flow === 'new';
    if (tab === 'root')     return r._flow === 'old_root';
    if (tab === 'leave')    return r._flow === 'old_pending' && r._kind === 'leave';
    if (tab === 'wfh')      return r._flow === 'old_pending' && r._kind === 'wfh';
    if (tab === 'reg')      return r._kind === 'reg';
    if (tab === 'expense')  return r._kind === 'expense';
    // 'all' tab — apply search + dept filters
    if (deptFilt && r._dept !== deptFilt) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r._name?.toLowerCase().includes(q) && !r._dept?.toLowerCase().includes(q) && !r.title?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const paginated  = filtered.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  function handleApprove(item) {
    if (item._kind === 'reg')     return approveRegMut.mutate(item.id);
    if (item._kind === 'expense') return setReviewExpense(item); // expenses always use review modal
    approveLeaveMut.mutate(item.id);
  }
  function handleReject(item) {
    if (item._kind === 'reg')     return rejectRegMut.mutate(item.id);
    if (item._kind === 'expense') return setReviewExpense(item);
    rejectLeaveMut.mutate(item.id);
  }

  // ── Status cell ──────────────────────────────────────────────────────────────
  function StatusCell({ item }) {
    if (item._kind === 'expense') {
      const label = item.status === 'manager_approved' ? 'Mgr Approved → HR Review' : 'Pending Review';
      const cls   = item.status === 'manager_approved'
        ? 'bg-blue-50 text-blue-700 border-blue-200'
        : 'bg-amber-50 text-amber-700 border-amber-200';
      return (
        <span className={`inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full border ${cls}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" /> {label}
        </span>
      );
    }
    if (item._flow === 'new') {
      // For leaves from _allLeaves (no current_level_* enrichment), fall back to status
      const levelLabel = item.current_level_label
        || (item.current_level_role_type
            ? item.current_level_role_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            : item.status === 'pending_dept' ? 'Dept Head Review'
            : 'Pending Workflow');
      return (
        <div className="space-y-0.5 max-w-full overflow-hidden">
          <span title={levelLabel} className="inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8] max-w-full truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3525cd] animate-pulse flex-shrink-0" /> <span className="truncate">{levelLabel}</span>
          </span>
          {item.current_level && <p className="text-[0.58rem] text-[#777587]">Level {item.current_level}</p>}
        </div>
      );
    }
    if (item._flow === 'old_root') {
      return (
        <div className="space-y-0.5">
          <span className="inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" /> Pending Final Approval
          </span>
          <p className="text-[0.58rem] text-emerald-600 font-semibold">✓ Dept Head Approved</p>
        </div>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Pending
      </span>
    );
  }

  // ── Details cell ─────────────────────────────────────────────────────────────
  function DetailsCell({ item }) {
    if (item._kind === 'expense') {
      return (
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-[#151c27] truncate max-w-[180px]">{item.title}</p>
          <p className="text-[0.65rem] text-[#777587] capitalize">{item.category} · {fmtDate(item.expense_date)}</p>
          <p className="text-xs font-black text-[#3525cd]">{fmt(item.amount)}</p>
        </div>
      );
    }
    if (item._kind === 'reg') {
      return <span className="text-xs text-[#464555]">Check-in Correction · {fmtDate(item.date)}</span>;
    }
    return (
      <span className="text-xs text-[#464555]">
        {(item.leave_type || 'leave').replace(/_/g,' ')} ·{' '}
        {item.start_date === item.end_date
          ? fmtDate(item.start_date)
          : `${fmtDate(item.start_date)} – ${fmtDate(item.end_date)}`}
      </span>
    );
  }

  // ── Actions cell ─────────────────────────────────────────────────────────────
  function ActionsCell({ item }) {
    if (item._kind === 'expense') {
      return (
        <button
          onClick={() => setReviewExpense(item)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[0.7rem] font-bold bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8] hover:bg-[#e0e7ff] hover:border-[#3525cd] transition-all">
          <Receipt size={11} /> Review
        </button>
      );
    }
    return (
      <div className="flex gap-1.5">
        <button onClick={() => handleApprove(item)} disabled={isBusy}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.7rem] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-all disabled:opacity-50">
          <Check size={11} /> Approve
        </button>
        <button onClick={() => handleReject(item)} disabled={isBusy}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[0.7rem] font-bold bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-all disabled:opacity-50">
          <X size={11} /> Reject
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Pending Approvals</div>
          <div className="page-subtitle">
            <span className="text-[#777587]">Dashboard</span>
            <span className="mx-1.5 text-[#c7c4d8]">›</span>
            Pending Approvals
            {totalCount > 0 && (
              <span className="ml-2 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {totalCount} pending
              </span>
            )}
          </div>
        </div>
        {/* EHN_PA_007: My Approval History button */}
        <button onClick={() => setHistoryTab(h => !h)}
          className={`btn ${historyTab ? 'btn-primary' : 'btn-outline'} btn-sm`}>
          {historyTab ? 'Back to Pending' : 'Approval History'}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {summaryCards.map((c, i) => (
          <div key={i} onClick={() => { setTab(c.tabKey); setPage(1); }}
            className={`bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 cursor-pointer hover:shadow-md hover:border-[#3525cd]/30 hover:-translate-y-0.5 transition-all ${tab === c.tabKey ? 'ring-2 ring-[#3525cd]/30 border-[#3525cd]/30' : ''}`}>
            <div className={`w-9 h-9 rounded-xl ${c.bg} ${c.text} flex items-center justify-center mb-3`}>{c.icon}</div>
            <p className="text-2xl font-black text-[#151c27]">{c.value}</p>
            <p className="text-xs text-[#777587] font-medium mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* EHN_PA_007: Approval History tab */}
      {historyTab && (
        <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
          <p className="text-sm font-black text-[#151c27] mb-3">My Recent Approval Actions (past 30 days)</p>
          {approvalHistory.length === 0 ? (
            <p className="text-sm text-[#777587] text-center py-6">No recent approval activity.</p>
          ) : (
            <div className="space-y-2">
              {approvalHistory.slice(0, 20).map((h, idx) => (
                <div key={idx} className="flex items-center gap-3 py-2 px-3 rounded-xl bg-[#f9f9ff] border border-[#f0f3ff]">
                  <span className={`w-2 h-2 rounded-full ${h.action === 'approved' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-[#151c27] truncate">{h.employee_name || h.user_name || 'Employee'}</p>
                    <p className="text-[0.65rem] text-[#777587]">{h.leave_type?.replace('_',' ')} · {h.start_date || ''}</p>
                  </div>
                  <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full border ${h.action === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                    {h.action}
                  </span>
                  <span className="text-[0.6rem] text-[#9ca3af]">{h.created_at ? new Date(h.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short' }) : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table Card */}
      {!historyTab && <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
        {/* EHN_PA_001: Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-5 py-3 bg-[#f0f3ff] border-b border-[#c7c4d8]">
            <span className="text-sm font-bold text-[#3525cd]">{selectedIds.size} selected</span>
            <button onClick={handleBulkApprove} className="btn btn-primary btn-sm">Approve Selected</button>
            <button onClick={handleBulkReject} className="btn btn-outline btn-sm text-rose-600 border-rose-200 hover:bg-rose-50">Reject Selected</button>
            <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-[#777587] hover:text-[#3525cd]">Clear</button>
          </div>
        )}
        {/* Tabs */}
        <div className="flex gap-1 px-5 pt-4 border-b border-[#e7eefe] overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
              className={`px-3 py-2 text-xs font-bold rounded-t-lg border-b-2 transition-all flex items-center gap-1.5 whitespace-nowrap ${
                tab === t.key
                  ? 'border-[#3525cd] text-[#3525cd] bg-[#f0f3ff]'
                  : 'border-transparent text-[#777587] hover:text-[#151c27]'
              }`}>
              {t.label}
              {t.highlight && tab !== t.key && (
                <span className="w-2 h-2 rounded-full bg-[#3525cd] animate-pulse" />
              )}
            </button>
          ))}
        </div>

        {/* Filters (all tab only) */}
        {tab === 'all' && (
          <div className="flex flex-wrap gap-3 px-5 py-3 border-b border-[#f0f3ff] bg-[#fafaff]">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
              <input className="form-control pl-8 py-1.5 text-xs" placeholder="Search by name or title…"
                value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <select className="form-control w-44 py-1.5 text-xs" value={deptFilt} onChange={e => { setDeptFilt(e.target.value); setPage(1); }}>
              <option value="">All Departments</option>
              {depts.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        )}

        {/* Table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><div className="spinner w-6 h-6" /></div>
        ) : paginated.length === 0 ? (
          <div className="py-16 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-3 text-emerald-400" />
            <p className="font-semibold text-[#464555]">No pending requests</p>
            <p className="text-sm text-[#9ca3af] mt-1">All approval requests have been reviewed.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0f3ff] bg-[#fafaff]">
                  {['','Type','Employee','Department','Details','Applied','Stage','Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[0.65rem] font-black uppercase tracking-wider text-[#9ca3af]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f9f9ff]">
                {paginated.map(item => (
                  <tr key={`${item._flow || item._kind}-${item.id}`} className="hover:bg-[#fafaff] transition-colors">
                    {/* EHN_PA_001: Checkbox for bulk selection */}
                    <td className="px-4 py-3">
                      <input type="checkbox" className="w-4 h-4 accent-[#3525cd]"
                        checked={selectedIds.has(`${item._flow}-${item.id}`)}
                        onChange={e => setSelectedIds(prev => { const n = new Set(prev); const key = `${item._flow}-${item.id}`; e.target.checked ? n.add(key) : n.delete(key); return n; })} />
                    </td>
                    <td className="px-4 py-3"><TypeBadge kind={item._kind} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar name={item._name} color={item.avatar_color || item.user_avatar_color} size={28} />
                        <div>
                          <p className="text-xs font-bold text-[#151c27]">{item._name}</p>
                          {item.employee_id && <p className="text-[0.6rem] text-[#9ca3af]">{item.employee_id}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#464555]">{item._dept || '—'}</td>
                    <td className="px-4 py-3"><DetailsCell item={item} /></td>
                    <td className="px-4 py-3 text-xs text-[#777587] whitespace-nowrap">
                      {item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      {/* EHN_PA_002: SLA aging badge */}
                      {(() => {
                        if (!item.created_at) return null;
                        const days = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000);
                        if (days < 3) return null;
                        const isUrgent = days >= 7;
                        return (
                          <span className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded-full text-[0.58rem] font-bold border ${isUrgent ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                            {isUrgent ? '⚠' : '!'} {days}d
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 max-w-[150px] overflow-hidden"><StatusCell item={item} /></td>
                    <td className="px-4 py-3"><ActionsCell item={item} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-[#f0f3ff] bg-[#fafaff]">
            <p className="text-xs text-[#777587]">
              Showing {Math.min((page - 1) * rowsPerPage + 1, filtered.length)}–{Math.min(page * rowsPerPage, filtered.length)} of {filtered.length}
            </p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-[#777587]">
                <span>Rows:</span>
                <select className="border border-[#c7c4d8] rounded-lg px-1.5 py-0.5 text-xs text-[#464555] bg-white outline-none"
                  value={rowsPerPage} onChange={e => { setRowsPerPage(Number(e.target.value)); setPage(1); }}>
                  {ROWS_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] disabled:opacity-40 transition-colors">
                  <ChevronLeft size={13} />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded-lg text-xs font-bold border transition-all ${
                        p === page ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'border-[#c7c4d8] text-[#464555] hover:bg-[#f0f3ff]'
                      }`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] disabled:opacity-40 transition-colors">
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>}

      {/* Info banner */}
      <div className="rounded-xl border border-[#e7eefe] bg-[#f9f9ff] px-5 py-4 text-xs text-[#777587] space-y-1">
        <p><span className="font-bold text-[#3525cd]">ℹ️</span> New Workflow leaves use the configurable approval chain set in Leave Workflow Settings.</p>
        <p>All approval activities are logged for audit purposes.</p>
      </div>

      {/* Expense review modal */}
      {reviewExpense && (
        <ExpenseReviewModal
          open
          expense={reviewExpense}
          onClose={() => setReviewExpense(null)}
          onDone={invalidate}
        />
      )}
    </div>
  );
}
