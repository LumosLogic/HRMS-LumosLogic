import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign, Plus, Clock, ChevronRight, CheckCircle2,
  AlertCircle, Search, History, X, TrendingUp, TrendingDown,
  Users, IndianRupee, Lock, Unlock, Zap, Settings2, Info, Download,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { cn, fmtDate } from '@/lib/utils';
import {
  calculateFromCTC,
  mergeWithDefaults,
  ruleLabel,
  EARNING_KEYS,
  DEDUCTION_KEYS,
  EMPLOYER_KEYS,
} from '@/lib/salaryCalculator';

const fmt  = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const fmtD = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

const EMPTY_FORM = {
  effective_from: new Date().toISOString().split('T')[0],
  ctc_override: '',
  basic: '', hra: '', da: '', transport_allowance: '',
  medical_allowance: '', special_allowance: '', other_allowance: '',
  employee_pf: '', employee_esi: '', professional_tax: '', tds: '', other_deductions: '', retention: '',
  employer_pf: '', employer_esi: '',
  notes: '',
};

const COMPONENT_LABELS = {
  basic: 'Basic', hra: 'HRA', da: 'DA',
  transport_allowance: 'Transport Allowance', medical_allowance: 'Medical Allowance',
  special_allowance: 'Special Allowance', other_allowance: 'Other Allowance',
  employee_pf: 'PF (Employee)', employee_esi: 'ESI (Employee)',
  professional_tax: 'Professional Tax', tds: 'TDS',
  other_deductions: 'Other Deductions', retention: 'Retention',
  employer_pf: 'PF (Employer)', employer_esi: 'ESI (Employer)',
};

// Returns 'YYYY-MM-01' for the first day of the current calendar month.
function firstOfCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ── CTC Mode — auto-calculated salary form ────────────────────────────────────
function CtcModal({ employee, rules, onClose, onSaved, modeToggle }) {
  const toast = useToast();
  const qc    = useQueryClient();

  const [ctcInput, setCtcInput] = useState('');
  const [manualKeys, setManualKeys] = useState(new Set());
  const [manualVals, setManualVals] = useState({});
  const [notes, setNotes] = useState('');
  // Pre-populate from existing record in revision mode; default to 1st of current month for new.
  const [effectiveFrom, setEffectiveFrom] = useState(
    !!employee.salary_id && employee.effective_from
      ? String(employee.effective_from).split('T')[0]
      : firstOfCurrentMonth()
  );
  const isRevising = !!employee.salary_id;

  useEffect(() => {
    if (!isRevising) return;
    const storedCtc = Number(employee.ctc);
    if (storedCtc > 0) setCtcInput(String(storedCtc));
    setNotes(employee.notes || '');

    // Restore manual overrides: compare stored component values against what
    // calculateFromCTC would auto-produce. Any field that differs was manually set.
    if (storedCtc > 0) {
      const autoCalc = calculateFromCTC(storedCtc, rules, {});
      if (autoCalc) {
        const overriddenKeys = new Set();
        const overriddenVals = {};
        const allKeys = [...EARNING_KEYS, ...DEDUCTION_KEYS, ...EMPLOYER_KEYS];
        for (const key of allKeys) {
          const stored = Number(employee[key] ?? 0);
          const auto   = Number(autoCalc[key]  ?? 0);
          if (Math.abs(stored - auto) > 0.01 && key !== 'special_allowance') {
            overriddenKeys.add(key);
            overriddenVals[key] = stored;
          }
        }
        if (overriddenKeys.size > 0) {
          setManualKeys(overriddenKeys);
          setManualVals(overriddenVals);
        }
      }
    }
  }, []);

  const ctcNum = Number(ctcInput) || 0;

  const overrides = useMemo(() => {
    const o = {};
    for (const k of manualKeys) { if (manualVals[k] !== undefined) o[k] = manualVals[k]; }
    return o;
  }, [manualKeys, manualVals]);

  const calc = useMemo(() => calculateFromCTC(ctcNum, rules, overrides), [ctcNum, rules, overrides]);

  function val(key) {
    if (manualKeys.has(key)) return manualVals[key] ?? 0;
    return calc?.[key] ?? 0;
  }

  function toggleManual(key) {
    setManualKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        setManualVals(v => { const nv = { ...v }; delete nv[key]; return nv; });
      } else {
        next.add(key);
        setManualVals(v => ({ ...v, [key]: calc?.[key] ?? 0 }));
      }
      return next;
    });
  }

  const componentPayload = () => ({
    basic: val('basic'), hra: val('hra'), da: val('da'),
    transport_allowance: val('transport_allowance'), medical_allowance: val('medical_allowance'),
    special_allowance: val('special_allowance'), other_allowance: val('other_allowance'),
    employee_pf: val('employee_pf'), employee_esi: val('employee_esi'),
    professional_tax: val('professional_tax'), tds: val('tds'),
    other_deductions: val('other_deductions'), retention: val('retention'),
    employer_pf: val('employer_pf'), employer_esi: val('employer_esi'),
    notes,
  });

  const mut = useMutation({
    mutationFn: () => {
      if (!calc && ctcNum <= 0) throw new Error('Enter a valid monthly CTC');
      if (!effectiveFrom) throw new Error('Effective From date is required');
      if (isRevising) {
        return apiPut(`/payroll/salary-structures/${employee.salary_id}`, {
          ...componentPayload(),
          effective_from: effectiveFrom,
        });
      }
      return apiPost('/payroll/salary-structures', {
        user_id: employee.id,
        effective_from: effectiveFrom,
        ...componentPayload(),
      });
    },
    onSuccess: () => {
      toast(isRevising ? 'Salary updated!' : 'Salary structure saved!', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-employees'] });
      onSaved?.();
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  const getComp = key => rules.components?.find(c => c.key === key);

  function FieldRow({ fieldKey, group }) {
    const comp = getComp(fieldKey);
    const isMan = manualKeys.has(fieldKey);
    const amount = val(fieldKey);
    if (comp && !comp.enabled && !isMan) return null;

    return (
      <div className="flex items-center gap-3 py-2 border-b border-[#f0f3ff] last:border-0">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-[#151c27]">{COMPONENT_LABELS[fieldKey]}</p>
          {comp?.enabled && !isMan && <p className="text-[0.6rem] text-[#9ca3af]">{ruleLabel(comp)}</p>}
          {isMan && <p className="text-[0.6rem] text-amber-600">Manual override</p>}
        </div>
        {isMan ? (
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9ca3af] text-xs">₹</span>
              <input type="number" min={0} step={1} value={manualVals[fieldKey] ?? ''}
                onChange={e => setManualVals(v => ({ ...v, [fieldKey]: Number(e.target.value) || 0 }))}
                className="w-28 border border-amber-300 rounded-lg pl-5 pr-2 py-1 text-sm text-[#151c27] focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-400/30"
              />
            </div>
            <button onClick={() => toggleManual(fieldKey)} title="Use calculated value"
              className="w-6 h-6 flex items-center justify-center rounded-lg border border-[#c7c4d8] text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd] transition-all">
              <Lock size={10} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className={cn('text-sm font-black min-w-[6rem] text-right',
              group === 'earning' ? 'text-emerald-700' : group === 'deduction' ? 'text-rose-600' : 'text-blue-700')}>
              {fmtD(amount)}
            </span>
            {comp?.method !== 'remaining' && (
              <button onClick={() => toggleManual(fieldKey)} title="Override manually"
                className="w-6 h-6 flex items-center justify-center rounded-lg border border-[#c7c4d8] text-[#9ca3af] hover:border-amber-400 hover:text-amber-600 transition-all">
                <Unlock size={10} />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.55)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-[#c7c4d8] max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe] flex-shrink-0">
          <div className="flex items-center gap-3">
            <Avatar name={employee.name} color={employee.avatar_color} size={34} />
            <div>
              <h2 className="font-black text-[#151c27] text-sm">
                {isRevising ? 'Edit Salary Structure' : 'Set Salary Structure'}
              </h2>
              <p className="text-xs text-[#777587]">{employee.name} · {employee.department || 'No Dept'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {modeToggle || (
              <span className="flex items-center gap-1 text-[0.65rem] font-bold px-2 py-1 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">
                <Zap size={10} /> CTC Mode
              </span>
            )}
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center">
              <X size={16} className="text-[#777587]" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-bold text-[#151c27] mb-1.5">
              Monthly CTC <span className="text-rose-500">*</span>
              <span className="ml-2 text-[0.68rem] font-normal text-[#777587]">Cost to Company per month</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#777587] font-bold text-base">₹</span>
              <input type="number" min={0} step={1} placeholder="e.g. 25000" value={ctcInput}
                onChange={e => setCtcInput(e.target.value)}
                className="w-full border-2 border-[#3525cd]/40 rounded-xl pl-8 pr-4 py-3 text-lg font-black text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-2 focus:ring-[#3525cd]/20"
                autoFocus
              />
            </div>
            <p className="text-[0.65rem] text-[#9ca3af] mt-1">
              Components are calculated automatically. Click <Unlock size={9} className="inline" /> to override any field manually.
            </p>
          </div>

          {calc && ctcNum > 0 ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200">
                  <p className="text-[0.65rem] font-black uppercase tracking-widest text-emerald-700">Earnings</p>
                </div>
                <div className="px-4">{EARNING_KEYS.map(k => <FieldRow key={k} fieldKey={k} group="earning" />)}</div>
                <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50 border-t border-emerald-200">
                  <div className="flex items-center gap-1.5 text-emerald-700"><TrendingUp size={13} /><span className="text-xs font-bold">Gross Salary</span></div>
                  <span className="text-sm font-black text-emerald-700">{fmtD(calc.gross)}</span>
                </div>
              </div>

              <div className="rounded-xl border border-rose-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200">
                  <p className="text-[0.65rem] font-black uppercase tracking-widest text-rose-700">Employee Deductions</p>
                </div>
                <div className="px-4">{DEDUCTION_KEYS.map(k => <FieldRow key={k} fieldKey={k} group="deduction" />)}</div>
                <div className="flex items-center justify-between px-4 py-2.5 bg-rose-50 border-t border-rose-200">
                  <div className="flex items-center gap-1.5 text-rose-600"><TrendingDown size={13} /><span className="text-xs font-bold">Total Deductions</span></div>
                  <div className="text-right">
                    <p className="text-[0.62rem] text-[#9ca3af]">Net Salary</p>
                    <p className="text-sm font-black text-[#151c27]">{fmtD(calc.net_salary)}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-blue-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-200">
                  <p className="text-[0.65rem] font-black uppercase tracking-widest text-blue-700">Employer Contributions</p>
                </div>
                <div className="px-4">{EMPLOYER_KEYS.map(k => <FieldRow key={k} fieldKey={k} group="employer" />)}</div>
                <div className="flex items-center justify-between px-4 py-2.5 bg-blue-50 border-t border-blue-200">
                  <span className="text-xs font-bold text-blue-700">Total Employer</span>
                  <span className="text-sm font-black text-blue-700">{fmtD(calc.total_employer)}</span>
                </div>
              </div>

              <div className="rounded-xl border-2 border-[#3525cd]/30 bg-[#f0f3ff] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-[#3525cd]">Final CTC / month</p>
                    <p className="text-[0.65rem] text-[#777587] mt-0.5">Gross + Employer Contributions</p>
                  </div>
                  <p className="text-2xl font-black text-[#3525cd]">{fmtD(calc.final_ctc)}</p>
                </div>
                {Math.abs(calc.final_ctc - ctcNum) > 1 && (
                  <p className="text-[0.62rem] text-amber-600 mt-2 flex items-center gap-1">
                    <Info size={10} />
                    Target CTC ₹{Number(ctcNum).toLocaleString('en-IN')} · Calculated ₹{Number(calc.final_ctc).toLocaleString('en-IN')} (rounding)
                  </p>
                )}
              </div>
            </div>
          ) : ctcNum > 0 ? (
            <div className="text-center py-8 text-sm text-[#777587]">No salary rules configured for this organization.</div>
          ) : null}

          <div className="pt-2 border-t border-[#f0f3ff] space-y-3">
            <div>
              <label className="block text-[0.7rem] font-bold text-[#464555] mb-1">
                Effective From <span className="text-rose-500">*</span>
                <span className="ml-2 text-[0.65rem] font-normal text-[#777587]">
                  {isRevising
                    ? 'Shown from existing record — change to backdate for a past payroll month'
                    : 'First day of the month this salary applies from'}
                </span>
              </label>
              <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)}
                className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]" />
            </div>
            <div>
            <label className="block text-[0.7rem] font-bold text-[#464555] mb-1">Notes (optional)</label>
            <input value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Salary structure update"
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#e7eefe] flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2.5 border border-[#c7c4d8] rounded-xl text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff] transition-colors">
            Cancel
          </button>
          <button onClick={() => mut.mutate()}
            disabled={mut.isPending || !calc || ctcNum <= 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#3525cd] text-white rounded-xl text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-60 transition-colors">
            {mut.isPending
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              : <><Plus size={14} /> {isRevising ? 'Save Changes' : 'Save Structure'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Manual Mode ───────────────────────────────────────────────────────────────
function ManualModal({ employee, onClose, onSaved, modeToggle }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const isRevising = !!employee.salary_id;

  const [form, setForm] = useState({
    ...EMPTY_FORM,
    // Pre-populate effective_from from the stored record so HR can see and correct it.
    // In revision mode this reflects the actual current effective date (not today).
    // In create mode, default to 1st of the current month so same-month payroll picks it up.
    effective_from: isRevising && employee.effective_from
      ? String(employee.effective_from).split('T')[0]
      : firstOfCurrentMonth(),
    user_id: employee.id,
    ...(isRevising ? {
      basic: employee.basic || '', hra: employee.hra || '', da: employee.da || '',
      transport_allowance: employee.transport_allowance || '',
      medical_allowance: employee.medical_allowance || '',
      special_allowance: employee.special_allowance || '',
      other_allowance: employee.other_allowance || '',
      employee_pf: employee.employee_pf || '', employee_esi: employee.employee_esi || '',
      professional_tax: employee.professional_tax || '', tds: employee.tds || '',
      other_deductions: employee.other_deductions || '', retention: employee.retention || '',
      employer_pf: employee.employer_pf || '', employer_esi: employee.employer_esi || '',
      notes: employee.notes || '',
    } : {}),
  });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const num = k => Number(form[k] || 0);

  const gross       = num('basic') + num('hra') + num('da') + num('transport_allowance') + num('medical_allowance') + num('special_allowance') + num('other_allowance');
  const empDed      = num('employee_pf') + num('employee_esi') + num('professional_tax') + num('tds') + num('other_deductions') + num('retention');
  const empContrib  = num('employer_pf') + num('employer_esi');
  const netEstimate = Math.max(0, gross - empDed);
  const ctc         = gross + empContrib;

  const mut = useMutation({
    mutationFn: () => {
      const payload = {
        basic: num('basic'), hra: num('hra'), da: num('da'),
        transport_allowance: num('transport_allowance'), medical_allowance: num('medical_allowance'),
        special_allowance: num('special_allowance'), other_allowance: num('other_allowance'),
        employee_pf: num('employee_pf'), employee_esi: num('employee_esi'),
        professional_tax: num('professional_tax'), tds: num('tds'),
        other_deductions: num('other_deductions'), retention: num('retention'),
        employer_pf: num('employer_pf'), employer_esi: num('employer_esi'),
        notes: form.notes,
      };
      if (!form.effective_from) throw new Error('Effective From date is required');
      if (isRevising) {
        // Include effective_from so HR can correct a September-dated structure
        // back to August 1 without needing a new version.
        return apiPut(`/payroll/salary-structures/${employee.salary_id}`, {
          ...payload,
          effective_from: form.effective_from,
        });
      }
      return apiPost('/payroll/salary-structures', {
        ...payload, user_id: employee.id, effective_from: form.effective_from,
      });
    },
    onSuccess: () => {
      toast(isRevising ? 'Salary updated!' : 'Salary structure saved!', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-employees'] });
      onSaved?.();
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  const field = (label, key, placeholder = '0') => (
    <div key={key}>
      <label className="block text-[0.7rem] font-bold text-[#464555] mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] text-xs">₹</span>
        <input type="number" min={0} step="1" placeholder={placeholder} value={form[key]}
          onChange={e => set(key, e.target.value)} onWheel={e => e.target.blur()}
          className="w-full border border-[#c7c4d8] rounded-lg pl-6 pr-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
        />
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.55)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl border border-[#c7c4d8] max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe] flex-shrink-0">
          <div className="flex items-center gap-3">
            <Avatar name={employee.name} color={employee.avatar_color} size={34} />
            <div>
              <h2 className="font-black text-[#151c27] text-sm">
                {isRevising ? 'Edit Salary Structure' : 'Set Salary Structure'}
              </h2>
              <p className="text-xs text-[#777587]">{employee.name} · {employee.department || 'No Department'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {modeToggle}
            <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center">
              <X size={16} className="text-[#777587]" />
            </button>
          </div>
        </div>

        {/* EHN_PAYROLL_008: Sticky summary bar always visible */}
        <div className="flex items-center gap-4 px-6 py-2.5 bg-[#f9f9ff] border-b border-[#e7eefe] flex-shrink-0 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#777587]">Gross:</span>
            <span className="font-black text-emerald-700">{fmtD(gross)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#777587]">Deductions:</span>
            <span className="font-black text-rose-600">{fmtD(empDed)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#777587]">Est. Net:</span>
            <span className="font-black text-[#151c27]">{fmtD(netEstimate)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs ml-auto">
            <span className="text-[#777587]">CTC/mo:</span>
            <span className="font-black text-[#3525cd]">{fmtD(ctc)}</span>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {/* Effective From — visible in both create and revision modes so HR can */}
          {/* set the payroll month this structure applies from (e.g. Aug 1, 2026). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-[#f9f9ff] rounded-xl border border-[#e7eefe]">
            <div>
              <label className="block text-[0.7rem] font-bold text-[#464555] mb-1">
                Effective From <span className="text-rose-500">*</span>
              </label>
              <input type="date" value={form.effective_from}
                onChange={e => set('effective_from', e.target.value)}
                className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
              />
              <p className="text-[0.62rem] text-[#9ca3af] mt-1">
                {isRevising
                  ? 'Loaded from existing record. Change to August 1 to fix retroactive payroll.'
                  : 'First day of the payroll month this structure should apply from.'}
              </p>
            </div>
          </div>
          <div>
            <p className="text-[0.68rem] font-black uppercase tracking-widest text-[#777587] mb-3">Earnings (₹ / month)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {field('Basic *', 'basic')}{field('HRA', 'hra')}{field('Dearness Allowance', 'da')}
              {field('Transport Allowance', 'transport_allowance')}{field('Medical Allowance', 'medical_allowance')}
              {field('Special Allowance', 'special_allowance')}{field('Other Allowance', 'other_allowance')}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2 bg-emerald-50 rounded-lg px-3 py-2">
              <TrendingUp size={14} className="text-emerald-500" />
              <span className="text-sm font-black text-emerald-700">Gross: {fmtD(gross)}</span>
            </div>
          </div>

          <div>
            <p className="text-[0.68rem] font-black uppercase tracking-widest text-[#777587] mb-3">Employee Deductions (₹ / month)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {field('PF (Employee)', 'employee_pf')}{field('ESI (Employee)', 'employee_esi')}
              {field('Professional Tax', 'professional_tax')}{field('TDS', 'tds')}
              {field('Retention', 'retention')}{field('Other Deductions', 'other_deductions')}
            </div>
            <div className="mt-3 flex items-center justify-between bg-rose-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <TrendingDown size={14} className="text-rose-500" />
                <span className="text-sm font-bold text-rose-600">Deductions: {fmtD(empDed)}</span>
              </div>
              <span className="text-sm font-black text-[#151c27]">Est. Net: {fmtD(netEstimate)}</span>
            </div>
          </div>

          <div>
            <p className="text-[0.68rem] font-black uppercase tracking-widest text-[#777587] mb-3">Employer Contributions (₹ / month)</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {field('PF (Employer)', 'employer_pf')}{field('ESI (Employer)', 'employer_esi')}
            </div>
            <div className="mt-3 flex items-center justify-end gap-2 bg-blue-50 rounded-lg px-3 py-2">
              <span className="text-sm font-bold text-blue-700">CTC / month: {fmtD(ctc)}</span>
            </div>
          </div>

          <div>
            <label className="block text-[0.7rem] font-bold text-[#464555] mb-1">Notes (optional)</label>
            <input className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
              placeholder="e.g. Salary update" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#e7eefe] flex-shrink-0">
          <button onClick={onClose}
            className="px-4 py-2.5 border border-[#c7c4d8] rounded-xl text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff] transition-colors">
            Cancel
          </button>
          <button
            onClick={() => {
              if (gross === 0) { toast('Enter at least one earning amount.', 'error'); return; }
              mut.mutate();
            }}
            disabled={mut.isPending || !form.basic || num('basic') === 0}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#3525cd] text-white rounded-xl text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-60 transition-colors">
            {mut.isPending
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              : <><Plus size={14} /> {isRevising ? 'Save Changes' : 'Save Structure'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SalaryModal: picks CTC or Manual mode based on org rules ─────────────────
// Mode toggle is embedded inside the modal header (not floating above it).
function SalaryModal({ employee, rules, onClose }) {
  const rulesEnabled = rules?.enabled;
  const [mode, setMode] = useState(rulesEnabled ? 'ctc' : 'manual');

  // When mode changes, remount the inner modal with a fresh key
  return (
    <>
      {mode === 'ctc'
        ? <CtcModal key="ctc" employee={employee} rules={rules} onClose={onClose}
            modeToggle={rulesEnabled ? (
              <div className="flex items-center gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-0.5 rounded-lg">
                <button onClick={() => setMode('ctc')}
                  className={cn('flex items-center gap-1 px-2.5 py-1 rounded-md text-[0.68rem] font-bold transition-all',
                    'bg-[#3525cd] text-white')}>
                  <Zap size={10} /> CTC-Based
                </button>
                <button onClick={() => setMode('manual')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[0.68rem] font-bold text-[#464555] hover:bg-white transition-all">
                  <Settings2 size={10} /> Manual
                </button>
              </div>
            ) : null}
          />
        : <ManualModal key="manual" employee={employee} onClose={onClose}
            modeToggle={rulesEnabled ? (
              <div className="flex items-center gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-0.5 rounded-lg">
                <button onClick={() => setMode('ctc')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[0.68rem] font-bold text-[#464555] hover:bg-white transition-all">
                  <Zap size={10} /> CTC-Based
                </button>
                <button onClick={() => setMode('manual')}
                  className={cn('flex items-center gap-1 px-2.5 py-1 rounded-md text-[0.68rem] font-bold transition-all',
                    'bg-[#464555] text-white')}>
                  <Settings2 size={10} /> Manual
                </button>
              </div>
            ) : null}
          />}
    </>
  );
}

// ── History Modal ─────────────────────────────────────────────────────────────
function HistoryModal({ employee, onClose }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['salary-history', employee.id],
    queryFn: () => apiGet(`/payroll/salary-structures/history/${employee.id}`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.55)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl border border-[#c7c4d8] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe] flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <History size={16} className="text-[#3525cd]" />
            <h2 className="font-black text-[#151c27] text-sm">Salary History — {employee.name}</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center">
            <X size={16} className="text-[#777587]" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-10">
              <History size={32} className="text-[#c7c4d8] mx-auto mb-2" />
              <p className="text-sm text-[#777587]">No salary history yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map(h => (
                <div key={h.id} className={cn('rounded-xl border p-4', h.effective_to === null ? 'border-[#3525cd]/30 bg-[#f0f3ff]' : 'border-[#e7eefe] bg-white')}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full', h.effective_to === null ? 'bg-[#3525cd] text-white' : 'bg-slate-100 text-slate-600')}>
                        {h.effective_to === null ? 'Active' : 'Past'}
                      </span>
                      <span className="text-xs font-semibold text-[#151c27]">
                        {fmtDate(h.effective_from)}{h.effective_to ? ` → ${fmtDate(h.effective_to)}` : ' → Present'}
                      </span>
                    </div>
                    <span className="text-sm font-black text-[#3525cd]">{fmt(h.gross_salary)}/mo</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    {[['Basic', h.basic],['HRA', h.hra],['DA', h.da],['Transport', h.transport_allowance],['Medical', h.medical_allowance],['Special', h.special_allowance],['Other', h.other_allowance]]
                      .filter(([,v]) => Number(v) > 0)
                      .map(([label, val]) => (
                        <div key={label} className="flex justify-between">
                          <span className="text-[#777587]">{label}</span>
                          <span className="font-semibold text-[#151c27]">{fmt(val)}</span>
                        </div>
                      ))}
                  </div>
                  {[['PF', h.employee_pf],['ESI', h.employee_esi],['Prof. Tax', h.professional_tax],['TDS', h.tds],['Retention', h.retention],['Other Ded.', h.other_deductions]]
                    .filter(([,v]) => Number(v) > 0).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[#e7eefe]">
                      <p className="text-[0.6rem] font-black uppercase tracking-widest text-rose-500 mb-1.5">Deductions / month</p>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        {[['PF', h.employee_pf],['ESI', h.employee_esi],['Prof. Tax', h.professional_tax],['TDS', h.tds],['Retention', h.retention],['Other Ded.', h.other_deductions]]
                          .filter(([,v]) => Number(v) > 0)
                          .map(([label, val]) => (
                            <div key={label} className="flex justify-between">
                              <span className="text-[#777587]">{label}</span>
                              <span className="font-semibold text-rose-600">{fmt(val)}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#e7eefe]">
                    <span className="text-[0.65rem] text-[#9ca3af]">CTC: {fmt(h.ctc)}/mo{h.created_by_name && ` · By ${h.created_by_name}`}</span>
                    {h.notes && <span className="text-[0.65rem] italic text-[#777587] max-w-[60%] truncate">{h.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CSV Download ──────────────────────────────────────────────────────────────
function downloadSalaryStructuresCSV(employees) {
  const configured = employees.filter(e => e.salary_id);
  if (!configured.length) return;

  const headers = [
    'Employee ID', 'Name', 'Department',
    'Basic', 'HRA', 'DA', 'Transport Allowance', 'Medical Allowance',
    'Special Allowance', 'Other Allowance', 'Gross Salary',
    'PF (Employee)', 'ESI (Employee)', 'Professional Tax', 'TDS',
    'Retention', 'Other Deductions', 'Total Deductions',
    'PF (Employer)', 'ESI (Employer)',
    'CTC', 'Effective From',
  ];

  const n = v => Number(v || 0);
  const rows = configured.map(e => {
    const gross = n(e.basic) + n(e.hra) + n(e.da) + n(e.transport_allowance) +
                  n(e.medical_allowance) + n(e.special_allowance) + n(e.other_allowance);
    const totalDed = n(e.employee_pf) + n(e.employee_esi) + n(e.professional_tax) +
                     n(e.tds) + n(e.retention) + n(e.other_deductions);
    return [
      e.employee_id || '',
      e.name || '',
      e.department || '',
      n(e.basic), n(e.hra), n(e.da), n(e.transport_allowance), n(e.medical_allowance),
      n(e.special_allowance), n(e.other_allowance), gross,
      n(e.employee_pf), n(e.employee_esi), n(e.professional_tax), n(e.tds),
      n(e.retention), n(e.other_deductions), totalDed,
      n(e.employer_pf), n(e.employer_esi),
      n(e.ctc) || (gross + n(e.employer_pf) + n(e.employer_esi)),
      e.effective_from ? String(e.effective_from).split('T')[0] : '',
    ];
  });

  const escape = v => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const csv = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `salary-structures-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SalaryStructure() {
  const toast = useToast();
  const { selectedBranchId } = useBranch();
  const [search,       setSearch]      = useState('');
  const [filterStatus, setFilterStatus]= useState('all');
  const [editEmp,      setEditEmp]     = useState(null);
  const [historyEmp,   setHistoryEmp]  = useState(null);

  // Include selectedBranchId so branch switching loads the correct employees.
  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['payroll-employees', selectedBranchId],
    queryFn: () => apiGet('/payroll/employees'),
  });

  const { data: payrollSettings } = useQuery({
    queryKey: ['payroll-settings'],
    queryFn: () => apiGet('/payroll/settings'),
  });

  const salaryRules = useMemo(
    () => mergeWithDefaults(payrollSettings?.salary_calculation_rules),
    [payrollSettings]
  );

  const withSalary    = employees.filter(e => e.salary_id);
  const withoutSalary = employees.filter(e => !e.salary_id);

  const filtered = employees.filter(e => {
    if (filterStatus === 'configured'   && !e.salary_id) return false;
    if (filterStatus === 'unconfigured' &&  e.salary_id) return false;
    if (search) {
      const q = search.toLowerCase();
      return (e.name || '').toLowerCase().includes(q) ||
             (e.department || '').toLowerCase().includes(q) ||
             (e.employee_id || '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <div className="page-title">Salary Structures</div>
          <div className="page-subtitle">
            <span className="text-[#777587]">Payroll</span>
            <span className="mx-1.5 text-[#c7c4d8]">›</span>
            Salary Structures
          </div>
        </div>
        <div className="flex items-center gap-2">
          {salaryRules?.enabled && (
            <div className="flex items-center gap-1.5 text-[0.7rem] font-bold px-3 py-1.5 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8]">
              <Zap size={12} /> CTC-based calculation active
            </div>
          )}
          {withSalary.length > 0 && (
            <button
              onClick={() => downloadSalaryStructuresCSV(employees)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#c7c4d8] text-[0.75rem] font-bold text-[#464555] bg-white hover:bg-[#f0f3ff] hover:border-[#3525cd]/40 hover:text-[#3525cd] transition-all shadow-sm"
              title="Download salary structures as CSV"
            >
              <Download size={13} /> Download CSV
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total Employees',   value: employees.length,    icon: <Users size={16} />,        bg: 'bg-[#f0f3ff]',  text: 'text-[#3525cd]',   onClick: () => setFilterStatus('all') },
          { label: 'Salary Configured', value: withSalary.length,   icon: <CheckCircle2 size={16} />, bg: 'bg-emerald-50', text: 'text-emerald-700', onClick: () => setFilterStatus('configured') },
          { label: 'Not Configured',    value: withoutSalary.length, icon: <AlertCircle size={16} />,  bg: 'bg-amber-50',   text: 'text-amber-700',   onClick: () => setFilterStatus('unconfigured') },
        ].map(c => (
          <div key={c.label} onClick={c.onClick}
            className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-4 cursor-pointer hover:shadow-md hover:border-[#3525cd]/30 hover:-translate-y-0.5 transition-all">
            <div className={`w-9 h-9 rounded-xl ${c.bg} ${c.text} flex items-center justify-center mb-3`}>{c.icon}</div>
            <p className="text-2xl font-black text-[#151c27]">{c.value}</p>
            <p className="text-xs text-[#777587] font-medium mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-[#f0f3ff] bg-[#fafaff]">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
            <input className="w-full border border-[#c7c4d8] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white"
              placeholder="Search by name, department, employee ID…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-xs text-[#464555] bg-white focus:outline-none"
            value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="all">All Employees</option>
            <option value="configured">Salary Configured</option>
            <option value="unconfigured">Not Configured</option>
          </select>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <IndianRupee size={36} className="mx-auto mb-3 text-[#c7c4d8]" />
            <p className="font-semibold text-[#464555]">No employees found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0f3ff] bg-[#fafaff]">
                  {['Employee','Department','Basic','Gross / CTC','Effective From','Status',''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[0.65rem] font-black uppercase tracking-wider text-[#9ca3af]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f9f9ff]">
                {filtered.map(emp => (
                  <tr key={emp.id} className="hover:bg-[#fafaff] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={emp.name} color={emp.avatar_color} size={30} />
                        <div>
                          <p className="text-xs font-bold text-[#151c27]">{emp.name}</p>
                          {emp.employee_id && <p className="text-[0.6rem] text-[#9ca3af]">{emp.employee_id}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#464555]">{emp.department || '—'}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-[#151c27]">{emp.basic ? fmt(emp.basic) : '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {emp.gross_salary ? (
                        <div>
                          <p className="font-bold text-emerald-700">{fmt(emp.gross_salary)}</p>
                          <p className="text-[0.65rem] text-[#9ca3af]">CTC: {fmt(emp.ctc)}</p>
                        </div>
                      ) : <span className="text-[#c7c4d8]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-[#777587]">{emp.effective_from ? fmtDate(emp.effective_from) : '—'}</td>
                    <td className="px-4 py-3">
                      {emp.salary_id ? (
                        <span className="inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Configured
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Not Set
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {emp.salary_id && (
                          <button onClick={() => setHistoryEmp(emp)}
                            className="p-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-colors" title="View history">
                            <History size={13} className="text-[#777587]" />
                          </button>
                        )}
                        <button onClick={() => setEditEmp(emp)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[0.7rem] font-bold bg-[#3525cd] text-white hover:bg-[#2a1fb0] transition-colors">
                          <Plus size={11} />
                          {emp.salary_id ? 'Revise' : 'Set Salary'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="px-5 py-2.5 border-t border-[#f0f3ff] bg-[#fafaff]">
            <p className="text-xs text-[#777587]">Showing {filtered.length} of {employees.length} employees</p>
          </div>
        )}
      </div>

      {editEmp    && <SalaryModal   employee={editEmp}    rules={salaryRules} onClose={() => setEditEmp(null)} />}
      {historyEmp && <HistoryModal  employee={historyEmp} onClose={() => setHistoryEmp(null)} />}
    </div>
  );
}
