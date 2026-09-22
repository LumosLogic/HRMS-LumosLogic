import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Save, CheckCircle2, Clock, AlertCircle,
  ChevronDown, ChevronUp, Info, Upload, ExternalLink, RefreshCw,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { cn } from '@/lib/utils';

const REGIME_INFO = {
  new: {
    title: 'New Tax Regime (FY 2024-25)',
    slabs: [
      { range: '₹0 – ₹3 L',   rate: 'Nil' },
      { range: '₹3 L – ₹7 L',  rate: '5%'  },
      { range: '₹7 L – ₹10 L', rate: '10%' },
      { range: '₹10 L – ₹12 L',rate: '15%' },
      { range: '₹12 L – ₹15 L',rate: '20%' },
      { range: 'Above ₹15 L',  rate: '30%' },
    ],
    stdDed: '₹75,000',
    rebate: 'No tax if taxable income ≤ ₹7 L (87A rebate)',
    note: 'Deductions like 80C, 80D, HRA are NOT available.',
  },
  old: {
    title: 'Old Tax Regime',
    slabs: [
      { range: '₹0 – ₹2.5 L', rate: 'Nil' },
      { range: '₹2.5 L – ₹5 L', rate: '5%' },
      { range: '₹5 L – ₹10 L',  rate: '20%' },
      { range: 'Above ₹10 L',   rate: '30%' },
    ],
    stdDed: '₹50,000',
    rebate: '87A rebate up to ₹12,500 if income ≤ ₹5 L',
    note: 'Allows 80C, 80D, HRA, Home Loan deductions.',
  },
};

const STATUS_META = {
  draft:     { label: 'Draft',      cls: 'bg-gray-100 text-gray-600',    Icon: Clock },
  submitted: { label: 'Submitted',  cls: 'bg-amber-50 text-amber-700',   Icon: Clock },
  hr_review: { label: 'Under Review', cls: 'bg-blue-50 text-blue-700',   Icon: Clock },
  approved:  { label: 'Approved',   cls: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  rejected:  { label: 'Rejected',   cls: 'bg-red-50 text-red-700',       Icon: AlertCircle },
};

function AmtInput({ label, hint, value, onChange, max }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-[#f0f3ff] last:border-0">
      <div>
        <p className="text-sm font-semibold text-[#151c27]">{label}</p>
        {hint && <p className="text-[0.68rem] text-[#777587] mt-0.5">{hint}</p>}
      </div>
      <div className="text-right flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[#777587]">₹</span>
          <input type="number" min={0} max={max}
            value={value || ''}
            onChange={e => onChange(Number(e.target.value) || 0)}
            placeholder="0"
            className="w-32 border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm text-right focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20" />
        </div>
        {max && <p className="text-[0.6rem] text-[#c7c4d8] mt-0.5">Max: ₹{Number(max).toLocaleString('en-IN')}</p>}
      </div>
    </div>
  );
}

function SlabTable({ regime }) {
  const info = REGIME_INFO[regime];
  if (!info) return null;
  return (
    <div className="bg-[#f9f9ff] rounded-xl border border-[#e7eefe] p-4">
      <p className="text-xs font-bold text-[#3525cd] mb-2">{info.title}</p>
      <div className="grid grid-cols-2 gap-1 mb-3">
        {info.slabs.map(s => (
          <div key={s.range} className="flex justify-between text-[0.7rem] text-[#464555] py-0.5 border-b border-[#f0f3ff] last:border-0">
            <span>{s.range}</span>
            <span className="font-bold">{s.rate}</span>
          </div>
        ))}
      </div>
      <p className="text-[0.68rem] text-[#777587]">Std. deduction: {info.stdDed}</p>
      <p className="text-[0.68rem] text-emerald-600 mt-0.5">{info.rebate}</p>
      {info.note && <p className="text-[0.68rem] text-amber-600 mt-1">{info.note}</p>}
    </div>
  );
}

// ── HR Review panel ───────────────────────────────────────────────────────────
function HRReviewPanel({ declarations }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [notes, setNotes] = useState({});

  const approveMut = useMutation({
    mutationFn: ({ id, reviewer_notes }) => apiPut(`/statutory/declarations/${id}/approve`, { reviewer_notes }),
    onSuccess: () => { toast('Declaration approved', 'success'); qc.invalidateQueries({ queryKey: ['declarations-hr'] }); qc.invalidateQueries({ queryKey: ['proofs-hr'] }); },
    onError: e => toast(e.message, 'error'),
  });
  const rejectMut = useMutation({
    mutationFn: ({ id, reviewer_notes }) => apiPut(`/statutory/declarations/${id}/reject`, { reviewer_notes }),
    onSuccess: () => { toast('Declaration rejected', 'error'); qc.invalidateQueries({ queryKey: ['declarations-hr'] }); },
    onError: e => toast(e.message, 'error'),
  });

  const pending = declarations.filter(d => ['submitted','hr_review'].includes(d.status));

  if (!pending.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center bg-white rounded-xl border border-[#e2e0f0]">
        <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
        <p className="text-sm font-semibold text-[#464555]">No pending declarations</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {pending.map(d => (
        <div key={d.id} className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-[#151c27]">{d.employee_name}</p>
              <p className="text-xs text-[#777587]">FY {d.financial_year} · {d.regime === 'new' ? 'New Regime' : 'Old Regime'}</p>
            </div>
            <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full ${STATUS_META[d.status]?.cls || ''}`}>{d.status}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-[#464555]">
            <div><span className="font-bold">80C:</span> ₹{Number(d.deduction_80c).toLocaleString('en-IN')}</div>
            <div><span className="font-bold">80D Self:</span> ₹{Number(d.deduction_80d_self).toLocaleString('en-IN')}</div>
            <div><span className="font-bold">HRA:</span> ₹{Number(d.deduction_hra).toLocaleString('en-IN')}</div>
            <div><span className="font-bold">Prev Emp:</span> ₹{Number(d.prev_employer_income).toLocaleString('en-IN')}</div>
            <div><span className="font-bold">Other Inc:</span> ₹{Number(d.other_income).toLocaleString('en-IN')}</div>
            <div><span className="font-bold">Home Loan:</span> ₹{Number(d.deduction_home_loan).toLocaleString('en-IN')}</div>
          </div>

          <textarea rows={2} placeholder="Review notes (required for rejection)…"
            value={notes[d.id] || ''}
            onChange={e => setNotes(n => ({ ...n, [d.id]: e.target.value }))}
            className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3525cd] resize-none" />

          <div className="flex gap-2">
            <button onClick={() => approveMut.mutate({ id: d.id, reviewer_notes: notes[d.id] })}
              disabled={approveMut.isPending}
              className="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50">
              Approve
            </button>
            <button onClick={() => {
                if (!notes[d.id]) { toast('Add rejection reason first', 'error'); return; }
                rejectMut.mutate({ id: d.id, reviewer_notes: notes[d.id] });
              }}
              disabled={rejectMut.isPending}
              className="flex-1 bg-rose-600 text-white rounded-lg py-2 text-sm font-bold hover:bg-rose-700 transition-colors disabled:opacity-50">
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Investment Proof HR Review Panel ─────────────────────────────────────────
const PROOF_STATUS_CLS = {
  pending:        'bg-amber-50 text-amber-700 border-amber-200',
  approved:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected:       'bg-rose-50 text-rose-700 border-rose-200',
  needs_reupload: 'bg-orange-50 text-orange-700 border-orange-200',
};

function InvestmentProofReviewPanel({ proofs, onReviewed }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [notes, setNotes] = useState({});

  const reviewMut = useMutation({
    mutationFn: ({ id, status, rejection_reason }) =>
      apiPut(`/statutory/proofs/${id}/review`, { status, rejection_reason }),
    onSuccess: () => {
      toast('Proof reviewed', 'success');
      qc.invalidateQueries({ queryKey: ['proofs-hr'] });
      onReviewed?.();
    },
    onError: e => toast(e.message, 'error'),
  });

  const pending = (proofs || []).filter(p => p.status === 'pending');

  return (
    <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between">
        <p className="text-sm font-bold text-[#151c27] flex items-center gap-2">
          <Upload size={14} className="text-[#3525cd]" />
          Investment Proof Review
          {pending.length > 0 && (
            <span className="text-[0.6rem] font-black px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
              {pending.length}
            </span>
          )}
        </p>
        <span className="text-xs text-[#777587]">{(proofs || []).length} proofs total</span>
      </div>

      {pending.length === 0 ? (
        <div className="py-10 text-center">
          <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2" />
          <p className="text-sm font-semibold text-[#464555]">No pending proofs</p>
          <p className="text-xs text-[#9ca3af] mt-0.5">All investment proofs have been reviewed.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#f0f3ff]">
          {pending.map(p => (
            <div key={p.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-[#151c27] text-sm">{p.employee_name}</p>
                  <p className="text-xs text-[#777587] mt-0.5 capitalize">
                    {p.proof_type?.replace(/_/g, ' ')}
                    {p.claimed_amount > 0 && ` · ₹${Number(p.claimed_amount).toLocaleString('en-IN')}`}
                  </p>
                  {p.description && (
                    <p className="text-xs text-[#464555] mt-1 italic">"{p.description}"</p>
                  )}
                </div>
                <span className={`text-[0.6rem] font-bold px-2 py-0.5 rounded-full border flex-shrink-0 ${PROOF_STATUS_CLS[p.status] || ''}`}>
                  {p.status}
                </span>
              </div>

              {p.document_url && (
                <a href={p.document_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#3525cd] hover:underline">
                  <ExternalLink size={12} />
                  {p.document_name || 'View Document'}
                </a>
              )}

              <textarea rows={2} placeholder="Review notes (required for reject / needs re-upload)…"
                value={notes[p.id] || ''}
                onChange={e => setNotes(n => ({ ...n, [p.id]: e.target.value }))}
                className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#3525cd] resize-none" />

              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => reviewMut.mutate({ id: p.id, status: 'approved', rejection_reason: notes[p.id] })}
                  disabled={reviewMut.isPending}
                  className="flex-1 bg-emerald-600 text-white rounded-lg py-2 text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                  Approve
                </button>
                <button
                  onClick={() => {
                    if (!notes[p.id]) { toast('Add rejection reason first', 'error'); return; }
                    reviewMut.mutate({ id: p.id, status: 'needs_reupload', rejection_reason: notes[p.id] });
                  }}
                  disabled={reviewMut.isPending}
                  className="flex-1 bg-amber-500 text-white rounded-lg py-2 text-xs font-bold hover:bg-amber-600 disabled:opacity-50 transition-colors">
                  Needs Re-upload
                </button>
                <button
                  onClick={() => {
                    if (!notes[p.id]) { toast('Add rejection reason first', 'error'); return; }
                    reviewMut.mutate({ id: p.id, status: 'rejected', rejection_reason: notes[p.id] });
                  }}
                  disabled={reviewMut.isPending}
                  className="flex-1 bg-rose-600 text-white rounded-lg py-2 text-xs font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors">
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reviewed proofs summary */}
      {(proofs || []).filter(p => p.status !== 'pending').length > 0 && (
        <div className="border-t border-[#f0f3ff] px-5 py-3">
          <p className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] mb-2">Reviewed</p>
          <div className="space-y-1.5">
            {(proofs || []).filter(p => p.status !== 'pending').map(p => (
              <div key={p.id} className="flex items-center justify-between text-xs text-[#464555]">
                <span className="font-semibold">{p.employee_name}</span>
                <span className="capitalize text-[#777587]">{p.proof_type?.replace(/_/g, ' ')}</span>
                <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full border ${PROOF_STATUS_CLS[p.status] || ''}`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function TaxDeclaration() {
  const toast   = useToast();
  const qc      = useQueryClient();
  const { user } = useAuth();
  const { selectedBranchId } = useBranch();
  const isHR    = ['admin','root_admin'].includes(user?.role);

  const currentFY = () => {
    const now = new Date();
    const m   = now.getMonth() + 1;
    const y   = now.getFullYear();
    return m >= 4 ? `${y}-${String(y + 1).slice(-2)}` : `${y - 1}-${String(y).slice(-2)}`;
  };
  const fy = currentFY();

  const [regime, setRegime] = useState('new');
  const [form, setForm]     = useState({
    financial_year: fy,
    prev_employer_income: 0, prev_employer_tds: 0, other_income: 0,
    deduction_80c: 0, deduction_80d_self: 0, deduction_80d_parents: 0,
    deduction_80ccd: 0, deduction_hra: 0, deduction_home_loan: 0, deduction_other: 0,
    hra_rent_paid_annual: 0, hra_city_type: 'non_metro',
  });
  const [oldSection, setOldSection] = useState(false);

  const { data: myDecl } = useQuery({
    queryKey: ['my-declaration', fy],
    queryFn:  () => apiGet('/statutory/declarations', { fy }),
    enabled:  !isHR,
  });

  const { data: allDecl = [] } = useQuery({
    queryKey: ['declarations-hr', selectedBranchId],
    queryFn:  () => apiGet('/statutory/declarations'),
    enabled:  isHR,
  });

  const { data: allProofs = [], refetch: refetchProofs } = useQuery({
    queryKey: ['proofs-hr', selectedBranchId],
    queryFn:  () => apiGet('/statutory/proofs'),
    enabled:  isHR,
    staleTime: 60000,
  });

  useEffect(() => {
    const existing = myDecl?.[0];
    if (existing) {
      setRegime(existing.regime || 'new');
      setForm(f => ({
        ...f,
        prev_employer_income: existing.prev_employer_income || 0,
        prev_employer_tds:    existing.prev_employer_tds    || 0,
        other_income:         existing.other_income          || 0,
        deduction_80c:        existing.deduction_80c         || 0,
        deduction_80d_self:   existing.deduction_80d_self    || 0,
        deduction_80d_parents:existing.deduction_80d_parents || 0,
        deduction_80ccd:      existing.deduction_80ccd       || 0,
        deduction_hra:        existing.deduction_hra         || 0,
        deduction_home_loan:  existing.deduction_home_loan   || 0,
        deduction_other:      existing.deduction_other        || 0,
        hra_rent_paid_annual: existing.hra_rent_paid_annual  || 0,
        hra_city_type:        existing.hra_city_type         || 'non_metro',
      }));
    }
  }, [myDecl]);

  const submitMut = useMutation({
    mutationFn: () => apiPost('/statutory/declarations', { ...form, regime }),
    onSuccess: () => {
      toast('Tax declaration submitted for HR review', 'success');
      qc.invalidateQueries({ queryKey: ['my-declaration'] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const existing = myDecl?.[0];
  const isLocked = existing && ['approved'].includes(existing.status);

  // HR view
  if (isHR) {
    return (
      <div className="space-y-5">
        <div className="page-header">
          <div>
            <div className="page-title">Tax Declarations</div>
            <div className="page-subtitle">
              <span className="text-[#777587]">Statutory</span>
              <span className="mx-1.5 text-[#c7c4d8]">›</span>
              Review Declarations
            </div>
          </div>
          <p className="text-sm text-[#777587]">{allDecl.length} declarations · FY {fy}</p>
        </div>
        <HRReviewPanel declarations={allDecl} />
        <InvestmentProofReviewPanel proofs={allProofs} onReviewed={refetchProofs} />
        {allDecl.filter(d => !['submitted','hr_review'].includes(d.status)).length > 0 && (
          <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-[#f0f3ff]">
              <p className="text-sm font-bold text-[#151c27]">All Declarations</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#fafaff] border-b border-[#f0f3ff]">
                    {['Employee','FY','Regime','Status','Submitted'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allDecl.map((d, i) => {
                    const m = STATUS_META[d.status] || {};
                    return (
                      <tr key={d.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#fafaff]'}>
                        <td className="px-4 py-2.5 font-semibold text-[#151c27]">{d.employee_name}</td>
                        <td className="px-4 py-2.5 text-[#464555]">{d.financial_year}</td>
                        <td className="px-4 py-2.5 text-[#464555] capitalize">{d.regime}</td>
                        <td className="px-4 py-2.5"><span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full ${m.cls || ''}`}>{d.status}</span></td>
                        <td className="px-4 py-2.5 text-[#777587]">{d.submitted_at ? new Date(d.submitted_at).toLocaleDateString('en-IN') : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Employee self-service view
  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <div className="page-title">My Tax Declaration</div>
          <div className="page-subtitle">FY {fy} · Income Tax / TDS</div>
        </div>
        {existing && (
          <span className={cn('inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full', STATUS_META[existing.status]?.cls || '')}>
            {React.createElement(STATUS_META[existing.status]?.Icon || Clock, { size: 12 })}
            {STATUS_META[existing.status]?.label || existing.status}
          </span>
        )}
      </div>

      {isLocked && (
        <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-emerald-700">Your declaration has been approved by HR and will be used for TDS calculation.</p>
        </div>
      )}

      {existing?.status === 'rejected' && (
        <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-red-700">Declaration rejected</p>
            {existing.reviewer_notes && <p className="text-xs text-red-600 mt-0.5">Reason: {existing.reviewer_notes}</p>}
            <p className="text-xs text-red-600 mt-1">Please update and resubmit.</p>
          </div>
        </div>
      )}

      {/* Regime selection */}
      <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm p-5 space-y-4">
        <p className="text-sm font-bold text-[#151c27]">1. Select Tax Regime</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {['new','old'].map(r => (
            <button key={r} type="button" disabled={isLocked}
              onClick={() => setRegime(r)}
              className={cn('p-4 rounded-xl border-2 text-left transition-all',
                regime === r ? 'border-[#3525cd] bg-[#f0f3ff]' : 'border-[#c7c4d8] hover:border-[#3525cd]/40')}>
              <p className="text-sm font-bold text-[#151c27]">{r === 'new' ? 'New Regime (Recommended)' : 'Old Regime'}</p>
              <p className="text-xs text-[#777587] mt-0.5">{REGIME_INFO[r].stdDed} std. deduction</p>
            </button>
          ))}
        </div>
        <SlabTable regime={regime} />
      </div>

      {/* Other income */}
      <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm p-5">
        <p className="text-sm font-bold text-[#151c27] mb-3">2. Other Income (Annual)</p>
        <AmtInput label="Previous Employer Gross Income"
          hint="Income from previous employer in this FY"
          value={form.prev_employer_income}
          onChange={v => set('prev_employer_income', v)} />
        <AmtInput label="TDS by Previous Employer"
          hint="TDS already deducted by previous employer"
          value={form.prev_employer_tds}
          onChange={v => set('prev_employer_tds', v)} />
        <AmtInput label="Other Income (Interest, FD, etc.)"
          value={form.other_income}
          onChange={v => set('other_income', v)} />
      </div>

      {/* Old-regime deductions */}
      {regime === 'old' && (
        <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
          <button type="button"
            onClick={() => setOldSection(o => !o)}
            className="w-full flex items-center justify-between px-5 py-4 bg-[#fafaff] border-b border-[#f0f3ff]">
            <p className="text-sm font-bold text-[#151c27]">3. Tax-Saving Deductions (Old Regime)</p>
            {oldSection ? <ChevronUp size={15} className="text-[#777587]" /> : <ChevronDown size={15} className="text-[#777587]" />}
          </button>
          {oldSection && (
            <div className="px-5 py-4">
              <AmtInput label="Section 80C" hint="ELSS, PPF, LIC, NSC, etc." value={form.deduction_80c}
                onChange={v => set('deduction_80c', v)} max={150000} />
              <AmtInput label="Section 80D — Self & Family" hint="Medical insurance premium"
                value={form.deduction_80d_self} onChange={v => set('deduction_80d_self', v)} max={25000} />
              <AmtInput label="Section 80D — Parents" hint="Parents' medical insurance (50K if senior)"
                value={form.deduction_80d_parents} onChange={v => set('deduction_80d_parents', v)} max={50000} />
              <AmtInput label="Section 80CCD(1B) — NPS" hint="Additional NPS contribution"
                value={form.deduction_80ccd} onChange={v => set('deduction_80ccd', v)} max={50000} />
              <AmtInput label="HRA Exemption" hint="Pre-calculated HRA exemption amount"
                value={form.deduction_hra} onChange={v => set('deduction_hra', v)} />
              <AmtInput label="Home Loan Interest (Section 24B)"
                value={form.deduction_home_loan} onChange={v => set('deduction_home_loan', v)} max={200000} />
              <AmtInput label="Other Deductions" value={form.deduction_other}
                onChange={v => set('deduction_other', v)} />
            </div>
          )}
        </div>
      )}

      {/* Submit */}
      {!isLocked && (
        <div className="flex justify-end">
          <button onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending}
            className="flex items-center gap-2 bg-[#3525cd] text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-[#2a1fb0] transition-all disabled:opacity-50 shadow-sm">
            <Save size={15} /> {submitMut.isPending ? 'Submitting…' : 'Submit Declaration'}
          </button>
        </div>
      )}
    </div>
  );
}
