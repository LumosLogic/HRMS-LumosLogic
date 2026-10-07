import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUTORY_COMPONENT_KEYS } from '@/lib/salaryCalculator';
import { Toggle, Row } from './settingsUi';

// Editor for the organisation's CTC-based salary rules (payroll_settings.salary_calculation_rules).
// It lives on the Salary Structure page — that is where CTC drives the components. PF / ESI / PT / TDS
// are NOT configured here: they come from Statutory Compliance.

const METHOD_OPTS = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed',      label: 'Fixed Amount' },
  { value: 'manual',     label: 'Manual' },
  { value: 'remaining',  label: 'Remaining' },
];

const BASE_OPTS = [
  { value: 'gross', label: 'of Gross' },
  { value: 'basic', label: 'of Basic' },
  { value: 'ctc',   label: 'of CTC' },
];

const GROUPS = [
  { key: 'earning',   label: 'Earnings',               color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { key: 'deduction', label: 'Employee Deductions',    color: 'text-rose-700 bg-rose-50 border-rose-200' },
  { key: 'employer',  label: 'Employer Contributions', color: 'text-blue-700 bg-blue-50 border-blue-200' },
];

function ComponentRow({ comp, onChange }) {
  const [open, setOpen] = useState(false);
  const needsBase    = comp.method === 'percentage';
  const needsValue   = comp.method === 'percentage' || comp.method === 'fixed';
  const isRemaining  = comp.method === 'remaining';
  const input = 'border border-[#c7c4d8] rounded-lg py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20';

  return (
    <div className={cn('rounded-xl border transition-all', comp.enabled ? 'border-[#c7c4d8] bg-white' : 'border-[#e7eefe] bg-[#fafaff] opacity-60')}>
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => comp.enabled && setOpen(o => !o)}>
        <Toggle checked={comp.enabled} onChange={v => { onChange({ ...comp, enabled: v }); if (!v) setOpen(false); }} />
        <span className={cn('text-sm font-semibold flex-1', comp.enabled ? 'text-[#151c27]' : 'text-[#9ca3af]')}>{comp.label}</span>
        {comp.enabled && (
          <span className="text-[0.65rem] text-[#777587] bg-[#f0f3ff] border border-[#c7c4d8] rounded-full px-2 py-0.5 font-semibold">
            {comp.method === 'percentage' ? `${comp.value}% of ${comp.base}` :
             comp.method === 'fixed'      ? `₹${Number(comp.value || 0).toLocaleString('en-IN')} fixed` :
             comp.method === 'remaining'  ? 'Remaining balance' : 'Manual entry'}
          </span>
        )}
        {comp.enabled && (open ? <ChevronUp size={14} className="text-[#777587]" /> : <ChevronDown size={14} className="text-[#777587]" />)}
      </div>

      {comp.enabled && open && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-[#f0f3ff]">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
            {METHOD_OPTS.map(m => (
              <button key={m.value} type="button" onClick={() => onChange({ ...comp, method: m.value })}
                className={cn('py-1.5 px-2 rounded-lg text-xs font-bold border transition-all text-center',
                  comp.method === m.value ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40')}>
                {m.label}
              </button>
            ))}
          </div>

          {isRemaining && (
            <p className="text-xs text-[#777587] bg-[#f0f3ff] rounded-lg px-3 py-2 flex items-start gap-2">
              <Info size={13} className="text-[#3525cd] mt-0.5 flex-shrink-0" />
              This component fills the gap so that earnings sum exactly equals the gross target derived from CTC.
            </p>
          )}

          {needsValue && (
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <label className="block text-[0.65rem] font-bold text-[#777587] uppercase mb-1">
                  {comp.method === 'percentage' ? 'Percentage (%)' : 'Amount (₹)'}
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] text-xs">{comp.method === 'percentage' ? '%' : '₹'}</span>
                  <input type="number" min={0} step={comp.method === 'percentage' ? 0.01 : 1}
                    value={comp.value || ''} onChange={e => onChange({ ...comp, value: Number(e.target.value) })}
                    className={`w-28 pl-7 pr-2 ${input}`} />
                </div>
              </div>
              {needsBase && (
                <div>
                  <label className="block text-[0.65rem] font-bold text-[#777587] uppercase mb-1">Base</label>
                  <select value={comp.base || 'gross'} onChange={e => onChange({ ...comp, base: e.target.value })} className={`px-3 bg-white ${input}`}>
                    {BASE_OPTS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </div>
              )}
              {comp.method === 'percentage' && (
                <div>
                  <label className="block text-[0.65rem] font-bold text-[#777587] uppercase mb-1">Max Cap (₹, optional)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] text-xs">₹</span>
                    <input type="number" min={0} step={1} placeholder="No cap" value={comp.cap || ''}
                      onChange={e => onChange({ ...comp, cap: e.target.value ? Number(e.target.value) : null })}
                      className={`w-28 pl-7 pr-2 ${input}`} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-[#f0f3ff]">
            <div className="flex items-center gap-2">
              <Toggle checked={!!comp.threshold_enabled} onChange={v => onChange({ ...comp, threshold_enabled: v })} />
              <span className="text-xs font-semibold text-[#464555]">Eligibility threshold</span>
            </div>
            {comp.threshold_enabled && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[#777587]">Apply only if gross ≤</span>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] text-xs">₹</span>
                  <input type="number" min={0} step={1000} value={comp.threshold_value || ''}
                    onChange={e => onChange({ ...comp, threshold_value: Number(e.target.value) })}
                    className={`w-28 pl-7 pr-2 ${input}`} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SalaryRulesEditor({ rules, onChange }) {
  const updateComp = (key, updated) =>
    onChange({ ...rules, components: rules.components.map(c => c.key === key ? updated : c) });

  return (
    <div className="space-y-5">
      <Row
        label="CTC-based salary"
        hint="ON: HR enters a monthly CTC and the components are calculated from the rules below. OFF: components are entered manually.">
        <Toggle checked={!!rules.enabled} onChange={v => onChange({ ...rules, enabled: v })} />
      </Row>

      {rules.enabled && (
        <>
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
            <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              <strong>Remaining</strong> fills the balance so earnings equal the gross derived from CTC; <strong>Manual</strong> lets HR type the amount.
              PF, ESI, Professional Tax and TDS are not set here — they come from <strong>Statutory Compliance</strong>.
            </p>
          </div>

          {GROUPS.map(group => {
            const comps = rules.components.filter(c => c.group === group.key && !STATUTORY_COMPONENT_KEYS.has(c.key));
            if (!comps.length) return null;
            return (
              <div key={group.key}>
                <span className={cn('text-[0.62rem] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border', group.color)}>{group.label}</span>
                <div className="space-y-2 mt-3">
                  {comps.map(comp => <ComponentRow key={comp.key} comp={comp} onChange={updated => updateComp(comp.key, updated)} />)}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
