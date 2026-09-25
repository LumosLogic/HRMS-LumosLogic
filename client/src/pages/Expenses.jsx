import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt, Upload, ExternalLink, CheckCircle2, XCircle, Clock, Trash2, ChevronRight, AlertTriangle, Download, X as XIcon, FileText, Search, Filter, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';
import { fmtDate } from '@/lib/utils';

const CATEGORIES = ['travel','meals','accommodation','fuel','office_supplies','internet','medical','parking','training','client_entertainment','communication','other'];
const CAT_ICONS  = { travel:'✈️', meals:'🍽️', accommodation:'🏨', fuel:'⛽', office_supplies:'🖊️', internet:'🌐', medical:'🏥', parking:'🅿️', training:'📚', client_entertainment:'🤝', communication:'📱', other:'🧾' };
const CAT_LABELS = { travel:'Travel', meals:'Meals', accommodation:'Accommodation', fuel:'Fuel', office_supplies:'Office Supplies', internet:'Internet', medical:'Medical', parking:'Parking', training:'Training', client_entertainment:'Client Entertainment', communication:'Communication', other:'Other' };
const STATUS_CFG = {
  pending:          { cls: 'badge-pending',  icon: <Clock size={11} />,        label: 'Pending'       },
  manager_approved: { cls: 'badge-warning',  icon: <CheckCircle2 size={11} />, label: 'Mgr Approved'  },
  approved:         { cls: 'badge-approved', icon: <CheckCircle2 size={11} />, label: 'Approved'      },
  rejected:         { cls: 'badge-rejected', icon: <XCircle size={11} />,      label: 'Rejected'      },
};

// ENH_EXP_004: Consistent currency format with 2 decimal places
const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function ExpenseModal({ open, onClose, expense, allExpenses = [] }) {
  const toast  = useToast();
  const qc     = useQueryClient();
  const isEdit = !!expense;
  const fileRef  = useRef();
  const [uploading,  setUploading]  = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [amountErr,  setAmountErr]  = useState('');
  const [checking,   setChecking]   = useState(false);
  const [dupBlock,   setDupBlock]   = useState(null);   // hard duplicate — blocks submit
  const [dupConfirm, setDupConfirm] = useState(null);   // soft duplicate — requires confirmation
  const today = new Date().toISOString().split('T')[0];

  const [form, setForm] = useState(() => isEdit
    ? {
        title: expense.title, category: expense.category, amount: expense.amount,
        expense_date: expense.expense_date, description: expense.description || '',
        receipt_url: expense.receipt_url || '',
        merchant_name: expense.merchant_name || '',
        receipt_number: expense.receipt_number || '',
      }
    : {
        title: '', category: 'travel', amount: '', expense_date: today,
        description: '', receipt_url: '',
        merchant_name: '', receipt_number: '',
      });

  const set = (k, v) => {
    // Clear hard-block when the user corrects the receipt/merchant fields
    if (k === 'receipt_number' || k === 'merchant_name') setDupBlock(null);
    setForm(f => ({ ...f, [k]: v }));
  };

  function validateAmount(val) {
    const n = parseFloat(val);
    if (!val) { setAmountErr('Amount is required'); return false; }
    if (isNaN(n) || n <= 0) { setAmountErr('Enter a positive amount'); return false; }
    setAmountErr('');
    return true;
  }

  async function handleReceipt(file) {
    if (!file || !file.type) { toast('Invalid file. Please select a valid file.', 'error'); return; }
    const maxBytes = 5 * 1024 * 1024;
    const ok = ['application/pdf','image/jpeg','image/png','image/jpg'].includes(file.type);
    if (!ok) { toast('Unsupported file format. Please upload a PDF, JPG, or PNG file.', 'error'); return; }
    if (file.size > maxBytes) { toast('File too large — max 5 MB', 'error'); return; }
    setPendingFile(file);
    setUploading(true);
    try {
      const token = localStorage.getItem('lt_token');
      const fd = new FormData();
      fd.append('file', file);
      const res  = await fetch('/api/expenses/upload-receipt', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      set('receipt_url', data.url);
      toast('Receipt uploaded!', 'success');
    } catch (err) { toast(err.message, 'error'); setPendingFile(null); }
    finally { setUploading(false); }
  }

  const mut = useMutation({
    mutationFn: () => isEdit ? apiPut(`/expenses/${expense.id}`, form) : apiPost('/expenses', form),
    onSuccess: () => {
      toast(isEdit ? 'Expense updated!' : 'Expense claim submitted successfully. Waiting for manager approval.', 'success');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  async function runDuplicateCheck() {
    const rn = form.receipt_number.trim();
    const mn = form.merchant_name.trim();
    if (!rn && !mn) return null;   // nothing to check
    try {
      return await apiPost('/expenses/check-duplicate', {
        merchant_name: mn,
        receipt_number: rn,
        amount: form.amount,
        expense_date: form.expense_date,
        exclude_id: isEdit ? expense.id : undefined,
      });
    } catch {
      return null;   // fail-open: don't block on API error
    }
  }

  async function handleSubmit() {
    if (!form.title.trim()) { toast('Enter a title for the expense', 'warning'); return; }
    if (!/[a-zA-Z0-9]/.test(form.title.trim())) { toast('Expense title must contain at least one letter or number.', 'error'); return; }
    if (!validateAmount(form.amount)) return;
    if (!form.expense_date) { toast('Select an expense date', 'warning'); return; }
    if (!form.receipt_url) { toast('Receipt is required. Please upload a receipt before submitting.', 'warning'); return; }

    setChecking(true);
    const result = await runDuplicateCheck();
    setChecking(false);

    if (result?.type === 'hard') { setDupBlock(result.existing); return; }
    if (result?.type === 'soft') { setDupConfirm(result.existing); return; }

    mut.mutate();
  }

  const fmtFileSize = b => b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;

  return (
    <>
      <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Expense' : 'Submit Expense Claim'} size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSubmit}
              disabled={mut.isPending || checking || !!dupBlock || !form.title || !form.amount || !form.receipt_url}>
              {(mut.isPending || checking)
                ? <><span className="spinner w-4 h-4" />{checking ? 'Checking…' : 'Submitting…'}</>
                : isEdit ? 'Save Changes' : 'Submit Claim'}
            </button>
          </div>
        }>
        <div className="space-y-4">
          <p className="text-[0.65rem] text-[#9ca3af]"><span className="text-rose-500">*</span> Indicates required fields</p>

          {/* Hard-duplicate banner — clears when receipt_number or merchant_name changes */}
          {dupBlock && (
            <div className="rounded-lg bg-rose-50 border border-rose-300 p-3 flex gap-2.5 items-start">
              <AlertTriangle size={15} className="text-rose-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-rose-700">Duplicate Receipt Detected</p>
                <p className="text-xs text-rose-600 mt-0.5">
                  {dupBlock.receipt_number
                    ? <>Receipt <strong>#{dupBlock.receipt_number}</strong> is already used in </>
                    : <>A matching expense exists in </>}
                  "<strong>{dupBlock.title}</strong>"
                  {dupBlock.expense_date && <> ({fmtDate(dupBlock.expense_date)})</>}.
                  The same receipt cannot be submitted twice.
                  Update the Receipt / Invoice No. or Merchant Name below if this is a different transaction.
                </p>
              </div>
            </div>
          )}

          {/* Title */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="form-label mb-0">Title <span className="text-rose-500">*</span></label>
              <span className="text-[0.65rem] text-[#9ca3af]">{form.title.length}/80</span>
            </div>
            <input className={`form-control ${form.title && !/[a-zA-Z0-9]/.test(form.title.trim()) ? 'border-rose-400' : ''}`}
              maxLength={80} placeholder="e.g. Cab to client office" value={form.title}
              onChange={e => set('title', e.target.value)} />
            {form.title && !/[a-zA-Z0-9]/.test(form.title.trim()) && (
              <p className="text-xs text-rose-600 mt-1">Title must contain at least one letter or number.</p>
            )}
          </div>

          {/* Merchant + Receipt number — used for duplicate detection */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Merchant Name <span className="font-normal text-[#777587] text-xs normal-case">(Optional)</span></label>
              <input className="form-control" placeholder="e.g. Uber, Swiggy, OYO"
                value={form.merchant_name} onChange={e => set('merchant_name', e.target.value)} />
            </div>
            <div>
              <label className="form-label">Receipt / Invoice No. <span className="font-normal text-[#777587] text-xs normal-case">(Optional)</span></label>
              <input className="form-control" placeholder="e.g. INV-00123"
                value={form.receipt_number} onChange={e => set('receipt_number', e.target.value)} />
            </div>
          </div>
          <p className="text-[0.62rem] text-[#9ca3af] -mt-2">Providing these helps detect duplicate submissions automatically.</p>

          {/* Category + Amount */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Category</label>
              <select className="form-control" value={form.category} onChange={e => set('category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_ICONS[c]} {CAT_LABELS[c]}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Amount (₹) <span className="text-rose-500">*</span></label>
              <input type="number" className={`form-control ${amountErr ? 'border-rose-400' : ''}`}
                min={0.01} step={0.01} placeholder="0.00" value={form.amount}
                onChange={e => { set('amount', e.target.value); validateAmount(e.target.value); }} />
              {amountErr && <p className="text-[0.65rem] text-rose-500 mt-1">{amountErr}</p>}
            </div>
          </div>

          <div>
            <label className="form-label">Expense Date <span className="text-rose-500">*</span></label>
            <input type="date" className="form-control" max={today} value={form.expense_date}
              onChange={e => set('expense_date', e.target.value)} />
            <p className="text-[0.65rem] text-[#9ca3af] mt-1">Future dates are not allowed</p>
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="form-label mb-0">Description <span className="font-normal text-[#777587] text-xs normal-case">(Optional)</span></label>
              <span className="text-[0.65rem] text-[#9ca3af]">{form.description.length}/200</span>
            </div>
            <textarea className="form-control" rows={2} maxLength={200}
              placeholder="Additional details about this expense…"
              value={form.description} onChange={e => set('description', e.target.value)} />
          </div>

          {/* Receipt upload */}
          <div>
            <label className="form-label">Receipt <span className="text-rose-500">*</span></label>
            <div className="flex items-center gap-2 p-2.5 mb-2 rounded-lg bg-[#f0f3ff] border border-[#e7eefe] text-xs text-[#777587]">
              <span className="text-[#3525cd]">ℹ</span>
              <span>Accepted: <strong className="text-[#464555]">PDF, JPG, PNG</strong> · Max size: <strong className="text-[#464555]">5 MB</strong></span>
            </div>
            <input type="file" ref={fileRef} className="hidden" accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleReceipt(f); e.target.value = ''; }} />
            {form.receipt_url ? (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 space-y-2">
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-emerald-700 truncate">{pendingFile?.name || 'Receipt uploaded'}</p>
                    {pendingFile && <p className="text-[0.65rem] text-emerald-600">{fmtFileSize(pendingFile.size)}</p>}
                  </div>
                  <a href={form.receipt_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-[#3525cd] flex items-center gap-1 hover:underline flex-shrink-0">
                    <ExternalLink size={11} />View
                  </a>
                  <button className="text-xs text-rose-500 hover:underline flex-shrink-0"
                    onClick={() => { set('receipt_url', ''); setPendingFile(null); }}>Remove</button>
                </div>
              </div>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <><span className="spinner w-3 h-3" />Uploading…</> : <><Upload size={13} />Upload Receipt</>}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* Soft-duplicate confirmation — same merchant + amount + date, different receipt number */}
      {dupConfirm && (
        <ConfirmModal
          open
          title="Possible Duplicate Expense"
          message={
            `A similar expense "${dupConfirm.title}"` +
            (dupConfirm.merchant_name ? ` from ${dupConfirm.merchant_name}` : '') +
            ` for ${fmt(dupConfirm.amount)} on ${fmtDate(dupConfirm.expense_date)} already exists in your claims.` +
            ` If this is a genuinely different transaction, click Submit Anyway.`
          }
          confirmLabel="Submit Anyway"
          onConfirm={() => { setDupConfirm(null); mut.mutate(); }}
          onCancel={() => setDupConfirm(null)}
        />
      )}
    </>
  );
}

// In-page receipt / attachment viewer — no new-tab redirect
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
            <button
              onClick={async () => {
                try {
                  const res = await fetch(url);
                  const blob = await res.blob();
                  const blobUrl = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = blobUrl;
                  a.download = 'receipt';
                  a.click();
                  URL.revokeObjectURL(blobUrl);
                } catch { window.open(url, '_blank'); }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:border-[#3525cd] transition-all">
              <Download size={13} /> Download
            </button>
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

function ReviewModal({ open, onClose, expense }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [notes, setNotes] = useState('');
  const [viewReceipt, setViewReceipt] = useState(null);

  const mut = useMutation({
    mutationFn: status => apiPut(`/expenses/${expense.id}/review`, { status, reviewer_notes: notes }),
    onSuccess: () => { toast('Review saved!', 'success'); qc.invalidateQueries({ queryKey: ['expenses'] }); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <>
      <Modal open={open} onClose={onClose} title="Review Expense Claim" size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={() => mut.mutate('rejected')} disabled={mut.isPending}>Reject</button>
            <button className="btn btn-primary" onClick={() => mut.mutate('approved')} disabled={mut.isPending}>Approve</button>
          </div>
        }>
        <div className="space-y-3">
          <div className="rounded-xl bg-[#f9f9ff] border border-[#e7eefe] p-4 space-y-2 text-xs">
            <p className="font-bold text-[#151c27]">{expense.title}</p>
            <p><span className="text-[#777587]">Amount:</span> <span className="font-black text-[#3525cd] text-base">{fmt(expense.amount)}</span></p>
            <p><span className="text-[#777587]">Date:</span> <span className="font-semibold">{fmtDate(expense.expense_date)}</span></p>
            <p><span className="text-[#777587]">Category:</span> <span className="capitalize">{expense.category}</span></p>
            {expense.receipt_url && (
              <button type="button" onClick={() => setViewReceipt(expense.receipt_url)}
                className="flex items-center gap-1 text-[#3525cd] hover:underline mt-1 font-semibold">
                <Receipt size={11} /> View Receipt
              </button>
            )}
          </div>
          <div>
            <label className="form-label">Notes <span className="font-normal text-[#777587] normal-case tracking-normal">(sent to employee)</span></label>
            <textarea className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
      </Modal>
      {viewReceipt && <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />}
    </>
  );
}

function ManagerReviewModal({ open, onClose, expense }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [notes, setNotes] = useState('');
  const [viewReceipt, setViewReceipt] = useState(null);

  const mut = useMutation({
    mutationFn: action => apiPut(`/expenses/${expense.id}/manager-approve`, { action, notes }),
    onSuccess: () => { toast('Response saved!', 'success'); qc.invalidateQueries({ queryKey: ['expenses'] }); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <>
      <Modal open={open} onClose={onClose} title="Review Expense — Manager Approval" size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-danger" onClick={() => mut.mutate('reject')} disabled={mut.isPending}>Reject</button>
            <button className="btn btn-primary" onClick={() => mut.mutate('approve')} disabled={mut.isPending}>Approve & Forward to HR</button>
          </div>
        }>
        <div className="space-y-3">
          <div className="rounded-xl bg-[#f9f9ff] border border-[#e7eefe] p-4 space-y-2 text-xs">
            <p className="font-bold text-[#151c27]">{expense.title}</p>
            <p><span className="text-[#777587]">Amount:</span> <span className="font-black text-[#3525cd] text-base">{fmt(expense.amount)}</span></p>
            <p><span className="text-[#777587]">Date:</span> <span className="font-semibold">{fmtDate(expense.expense_date)}</span></p>
            <p><span className="text-[#777587]">Submitted by:</span> <span className="font-semibold">{expense.user_name}</span></p>
            {expense.receipt_url && (
              <button type="button" onClick={() => setViewReceipt(expense.receipt_url)}
                className="flex items-center gap-1 text-[#3525cd] hover:underline mt-1 font-semibold">
                <Receipt size={11} /> View Receipt
              </button>
            )}
          </div>
          <div>
            <label className="form-label">Notes <span className="font-normal text-[#777587] normal-case tracking-normal">(optional — sent to employee)</span></label>
            <textarea className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
      </Modal>
      {viewReceipt && <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />}
    </>
  );
}

export default function ExpensesPage() {
  const { user, isAdmin, isEmployee } = useAuth();
  const { selectedBranchId } = useBranch();
  const wrap = '';
  const toast = useToast();
  const qc    = useQueryClient();
  const [searchParams] = useSearchParams();
  const [addOpen,          setAddOpen]          = useState(false);
  const [editExp,          setEditExp]          = useState(null);
  const [reviewExp,        setReviewExp]        = useState(null);
  const [managerReviewExp, setManagerReviewExp] = useState(null);
  const [confirmDel,       setConfirmDel]       = useState(null);
  const [filter,           setFilter]           = useState('all');
  const [viewReceipt,      setViewReceipt]      = useState(null);
  // ENH_EXP_002: Advanced search/filter state
  const [expSearch,        setExpSearch]        = useState('');
  const [expCatFilt,       setExpCatFilt]       = useState('');
  const [expAmtMin,        setExpAmtMin]        = useState('');
  const [expAmtMax,        setExpAmtMax]        = useState('');
  const [expDateFrom,      setExpDateFrom]      = useState('');
  const [expDateTo,        setExpDateTo]        = useState('');

  // BUG_094: read ?highlight=X from URL for notification-driven scrolling
  const highlightExpId = searchParams.get('highlight') ? parseInt(searchParams.get('highlight'), 10) : null;
  const [highlightActive, setHighlightActive] = useState(true);

  // Auto-open submit form from quick actions; auto-apply status filter from dashboard
  useEffect(() => {
    if (!isAdmin && searchParams.get('action') === 'apply') setAddOpen(true);
    const s = searchParams.get('status');
    if (s && ['pending', 'manager_approved', 'approved', 'rejected'].includes(s)) setFilter(s);
  }, []);

  const { data: _expData, isLoading } = useQuery({ queryKey: ['expenses', filter, selectedBranchId], queryFn: () => apiGet('/expenses', filter !== 'all' ? { status: filter } : {}) });
  const expenses = Array.isArray(_expData) ? _expData : [];

  // BUG_094: scroll to highlighted expense and fade out ring after 3 seconds
  useEffect(() => {
    if (!highlightExpId || !expenses.length) return;
    const el = document.getElementById(`exp-${highlightExpId}`);
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
  }, [highlightExpId, expenses.length]);
  useEffect(() => {
    if (!highlightExpId) return;
    const t = setTimeout(() => setHighlightActive(false), 3000);
    return () => clearTimeout(t);
  }, [highlightExpId]);
  // Fetch all claims (unfiltered) to differentiate "no records for filter" vs "no claims at all"
  const { data: _allExpData } = useQuery({ queryKey: ['expenses', 'all', selectedBranchId], queryFn: () => apiGet('/expenses') });
  const allExpenses = Array.isArray(_allExpData) ? _allExpData : [];
  const hasAnyClaims = allExpenses.length > 0;

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/expenses/${id}`),
    onSuccess: () => { toast('Claim deleted', 'warning'); qc.invalidateQueries({ queryKey: ['expenses'] }); },
    onError: e => toast(e.message, 'error'),
  });

  const totalAmt   = allExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const pendingAmt = allExpenses.filter(e => ['pending','manager_approved'].includes(e.status)).reduce((s, e) => s + Number(e.amount || 0), 0);
  const approvedAmt= allExpenses.filter(e => e.status === 'approved').reduce((s, e) => s + Number(e.amount || 0), 0);

  return (
    <div className={wrap}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">{expenses.length} claim{expenses.length !== 1 ? 's' : ''} · total {fmt(totalAmt)}</p>
        </div>
        {!isAdmin && <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={16} />Submit Claim</button>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {[
          { label: 'Total Claims',    value: fmt(totalAmt),    color: 'from-[#f0f3ff] to-[#e7eefe]',    top: '#3525cd', text: 'text-[#3525cd]' },
          { label: 'Pending',         value: fmt(pendingAmt),  color: 'from-amber-50 to-amber-100',      top: '#F59E0B', text: 'text-amber-700' },
          { label: 'Approved',        value: fmt(approvedAmt), color: 'from-emerald-50 to-emerald-100',  top: '#10B981', text: 'text-emerald-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-5 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-card relative overflow-hidden`}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
            <div className={`text-xl font-black leading-none ${s.text}`}>{s.value}</div>
            <div className="text-[0.7rem] font-bold uppercase tracking-wider text-[#777587] mt-1.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-3 flex-wrap">
        {[
          { key: 'all',              label: 'All' },
          { key: 'pending',          label: 'Pending' },
          { key: 'manager_approved', label: 'Mgr Approved' },
          { key: 'approved',         label: 'Approved' },
          { key: 'rejected',         label: 'Rejected' },
        ].map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold border transition-all ${filter === f.key ? 'bg-[#3525cd] text-white border-[#3525cd] shadow-sm' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* ENH_EXP_002: Advanced search/filter bar */}
      {(() => {
        const isAdvancedFilterActive = !!(expSearch || expCatFilt || expAmtMin || expAmtMax || expDateFrom || expDateTo);
        return (
          <div className="flex flex-wrap gap-2 mb-4 p-3 bg-[#f9f9ff] border border-[#e7eefe] rounded-xl">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#777587]" />
              <input className="form-control pl-8 py-1.5 text-xs" placeholder="Search by name, ID…"
                value={expSearch} onChange={e => setExpSearch(e.target.value)} />
            </div>
            <select className="form-control py-1.5 text-xs w-auto" value={expCatFilt} onChange={e => setExpCatFilt(e.target.value)}>
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
            </select>
            <div className="flex items-center gap-1.5">
              <input type="number" className="form-control py-1.5 text-xs w-24" placeholder="Min ₹" value={expAmtMin} onChange={e => setExpAmtMin(e.target.value)} />
              <span className="text-xs text-[#777587]">–</span>
              <input type="number" className="form-control py-1.5 text-xs w-24" placeholder="Max ₹" value={expAmtMax} onChange={e => setExpAmtMax(e.target.value)} />
            </div>
            <input type="date" className="form-control py-1.5 text-xs w-auto" value={expDateFrom} onChange={e => setExpDateFrom(e.target.value)} title="Date from" />
            <input type="date" className="form-control py-1.5 text-xs w-auto" value={expDateTo} onChange={e => setExpDateTo(e.target.value)} title="Date to" />
            {isAdvancedFilterActive && (
              <button className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-rose-600 border border-rose-200 bg-rose-50 hover:bg-rose-100 transition-colors"
                onClick={() => { setExpSearch(''); setExpCatFilt(''); setExpAmtMin(''); setExpAmtMax(''); setExpDateFrom(''); setExpDateTo(''); }}>
                <X size={11} />Clear
              </button>
            )}
          </div>
        );
      })()}

      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading…</div>
      ) : expenses.length === 0 ? (
        <div className="empty-state">
          <Receipt size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          {hasAnyClaims && filter !== 'all' ? (
            <>
              <p className="font-semibold text-[#464555] mb-1">No claims for this status</p>
              <p className="text-sm">No expense claims match the selected filter. Try a different status.</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-[#464555] mb-1">No expense claims</p>
              <p className="text-sm">{!isAdmin ? 'Submit a claim to get reimbursed for work-related expenses' : 'No expense claims submitted yet'}</p>
              {!isAdmin && <button className="btn btn-primary mt-4" onClick={() => setAddOpen(true)}><Plus size={14} />Submit First Claim</button>}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {expenses.filter(e => {
            if (expSearch) {
              const q = expSearch.toLowerCase();
              if (!e.title?.toLowerCase().includes(q) && !String(e.id).includes(q)) return false;
            }
            if (expCatFilt && e.category !== expCatFilt) return false;
            if (expAmtMin && Number(e.amount) < Number(expAmtMin)) return false;
            if (expAmtMax && Number(e.amount) > Number(expAmtMax)) return false;
            if (expDateFrom && e.expense_date < expDateFrom) return false;
            if (expDateTo   && e.expense_date > expDateTo)   return false;
            return true;
          }).map(e => {
            const cfg = STATUS_CFG[e.status] || STATUS_CFG.pending;
            return (
              <div key={e.id} id={`exp-${e.id}`} className={`card p-4 hover:shadow-card-hover transition-all duration-200 ${highlightActive && highlightExpId != null && String(e.id) === String(highlightExpId) ? 'bg-[#f0f3ff] ring-4 ring-[#3525cd] ring-offset-2 border-[#3525cd]/40' : ''}`}>
                <div className="flex items-start gap-4">
                  {isAdmin && <Avatar name={e.user_name || ''} color={e.user_avatar_color} size={38} />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          {isAdmin && <span className="font-bold text-[#151c27]">{e.user_name}</span>}
                          <span className={isAdmin ? 'text-sm font-semibold text-[#464555]' : 'font-bold text-[#151c27]'}>{e.title}</span>
                          <span className="text-lg">{CAT_ICONS[e.category] || '🧾'}</span>
                          <span className={`badge ${cfg.cls} flex items-center gap-1`}>{cfg.icon}{cfg.label}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[#777587] mt-1">
                          <span className="capitalize">{e.category}</span>
                          <span>·</span>
                          <span>{fmtDate(e.expense_date)}</span>
                          {e.description && <><span>·</span><span className="truncate max-w-[200px]">{e.description}</span></>}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-black text-xl text-[#3525cd]">{fmt(e.amount)}</div>
                        {e.receipt_url && (
                          <button type="button" onClick={() => setViewReceipt(e.receipt_url)}
                            className="text-[0.68rem] text-[#3525cd] hover:underline flex items-center gap-0.5 justify-end mt-0.5 font-semibold">
                            <Receipt size={10} />Receipt
                          </button>
                        )}
                      </div>
                    </div>
                    {e.manager_notes && (
                      <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[#464555] mt-2">
                        <span className="text-amber-700 font-semibold">Manager:</span> {e.manager_notes}
                      </div>
                    )}
                    {e.reviewer_notes && (
                      <div className="text-xs bg-[#f9f9ff] border border-[#f0f3ff] rounded-lg px-3 py-2 text-[#464555] mt-2">
                        <span className="text-[#777587]">HR:</span> {e.reviewer_notes}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 flex-shrink-0">
                    {/* HR Admin: review pending (no manager) or manager-approved expenses */}
                    {isAdmin && ['pending', 'manager_approved'].includes(e.status) && (
                      <button className="btn btn-outline btn-sm" onClick={() => setReviewExp(e)}>Review <ChevronRight size={12} /></button>
                    )}
                    {/* Manager: approve/reject their direct report's pending expense */}
                    {!isAdmin && e.manager_id === user?.id && e.status === 'pending' && (
                      <button className="btn btn-primary btn-sm" onClick={() => setManagerReviewExp(e)}>Approve <ChevronRight size={12} /></button>
                    )}
                    {/* Employee: edit/delete their own pending claims only */}
                    {!isAdmin && e.user_id === user?.id && e.status === 'pending' && !e.manager_id && (
                      <>
                        <button className="btn btn-ghost btn-icon text-[#777587] hover:text-[#3525cd]" onClick={() => setEditExp(e)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                        <button className="btn btn-ghost btn-icon text-[#777587] hover:text-rose-500" onClick={() => setConfirmDel({ id: e.id, name: e.title })}><Trash2 size={13} /></button>
                      </>
                    )}
                    {/* Employee: can still delete if manager hasn't acted yet */}
                    {!isAdmin && e.user_id === user?.id && e.status === 'pending' && e.manager_id && (
                      <button className="btn btn-ghost btn-icon text-[#777587] hover:text-rose-500" onClick={() => setConfirmDel({ id: e.id, name: e.title })}><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {addOpen           && <ExpenseModal       open onClose={() => setAddOpen(false)} allExpenses={allExpenses} />}
      {editExp           && <ExpenseModal       open onClose={() => setEditExp(null)} expense={editExp} allExpenses={allExpenses} />}
      {reviewExp         && <ReviewModal        open onClose={() => setReviewExp(null)} expense={reviewExp} />}
      {managerReviewExp  && <ManagerReviewModal open onClose={() => setManagerReviewExp(null)} expense={managerReviewExp} />}
      <ConfirmModal open={!!confirmDel} title="Delete Expense" message={`Delete expense "${confirmDel?.name}"?`}
        confirmLabel="Delete" onConfirm={() => { delMut.mutate(confirmDel.id); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />
      {viewReceipt && <ReceiptViewer url={viewReceipt} onClose={() => setViewReceipt(null)} />}
    </div>
  );
}
