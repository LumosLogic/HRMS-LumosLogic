import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Save, Info,
  Calendar, Clock, Users, Shield, IndianRupee,
  ChevronDown, ChevronUp, Percent, Lock, Zap,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPut, apiPost } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { DEFAULT_SALARY_RULES, mergeWithDefaults } from '@/lib/salaryCalculator';

const DEFAULTS = {
  payroll_cycle:                'monthly',
  payroll_date:                 1,
  working_days_rule:            'calendar',
  fixed_working_days:           26,
  weekend_policy:               'sat_sun',
  count_holidays_as_paid:       true,
  grace_minutes:                15,
  late_allowance_per_month:     3,
  early_exit_allowance_minutes: 30,
  half_day_after_lates:         3,
  lop_after_half_days:          2,
  pf_enabled:                   true,
  esi_enabled:                  true,
  professional_tax_enabled:     true,
  tds_enabled:                  false,
  payslip_auto_email:           true,
  auto_generate_payroll:        false,
  auto_publish:                 false,
  timezone:                     'Asia/Kolkata',
  payroll_generation_day:       null,
  payroll_generation_time:      '01:00',
  payroll_generate_for:         'PREVIOUS',
  payroll_publish_day:          null,
  payroll_publish_time:         '09:00',
  payroll_payout_day:           null,
  payroll_payout_time:          null,
  salary_calculation_rules:     null,
  probation_enabled:              false,
  default_probation_months:       3,
  paid_leave_during_probation:    true,
  probation_scope:                'selected',
  per_day_salary_basis:           'working_days',
  payslip_company_fullname:       '',
  payslip_registered_address:     '',
  payslip_corporate_address:      '',
  payslip_contact_details:        '',
  payslip_company_address:        '',
  payslip_company_cin:            '',
  payslip_company_registration:   '',
  payslip_footer_note:            '',
  payslip_company_pf_no:          '',
  payslip_company_esic_no:        '',
};

const TIMEZONES = [
  { value: 'Asia/Kolkata',       label: 'Asia/Kolkata (IST, UTC+5:30)' },
  { value: 'Asia/Dubai',         label: 'Asia/Dubai (GST, UTC+4)' },
  { value: 'Asia/Singapore',     label: 'Asia/Singapore (SGT, UTC+8)' },
  { value: 'Asia/Kuala_Lumpur',  label: 'Asia/Kuala_Lumpur (MYT, UTC+8)' },
  { value: 'Asia/Bangkok',       label: 'Asia/Bangkok (ICT, UTC+7)' },
  { value: 'Asia/Hong_Kong',     label: 'Asia/Hong_Kong (HKT, UTC+8)' },
  { value: 'Asia/Tokyo',         label: 'Asia/Tokyo (JST, UTC+9)' },
  { value: 'Europe/London',      label: 'Europe/London (GMT/BST)' },
  { value: 'Europe/Berlin',      label: 'Europe/Berlin (CET/CEST)' },
  { value: 'America/New_York',   label: 'America/New_York (EST/EDT)' },
  { value: 'America/Los_Angeles',label: 'America/Los_Angeles (PST/PDT)' },
  { value: 'UTC',                label: 'UTC' },
];

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
        checked ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}>
      <span className={cn(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm',
        checked ? 'translate-x-4' : 'translate-x-1'
      )} />
    </button>
  );
}

function Section({ icon, title, subtitle, children }) {
  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff] bg-[#fafaff]">
        <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="text-sm font-bold text-[#151c27]">{title}</p>
          {subtitle && <p className="text-[0.68rem] text-[#777587]">{subtitle}</p>}
        </div>
      </div>
      <div className="px-5 py-5 space-y-5">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#151c27]">{label}</p>
        {hint && <p className="text-[0.68rem] text-[#777587] mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function NumInput({ value, onChange, min, max, step = 1 }) {
  return (
    <input
      type="number" min={min} max={max} step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-20 border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm text-center text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
    />
  );
}

function DayPicker({ value, onChange }) {
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
      <option value="">— same as payroll date —</option>
      {days.map(d => (
        <option key={d} value={String(d)}>{d}{['th','st','nd','rd'][([11,12,13].includes(d%100)?0:d%10)] || 'th'} of month</option>
      ))}
      <option value="LAST_DAY">Last day of month</option>
      <option value="LAST_WORKING_DAY">Last working day</option>
    </select>
  );
}

function TimeInput({ value, onChange }) {
  return (
    <input
      type="time"
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20 w-32"
    />
  );
}

// ── Method badge ───────────────────────────────────────────────────────────────
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

// Group labels / order for the rules table
const GROUPS = [
  { key: 'earning',   label: 'Earnings',                color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { key: 'deduction', label: 'Employee Deductions',      color: 'text-rose-700 bg-rose-50 border-rose-200' },
  { key: 'employer',  label: 'Employer Contributions',   color: 'text-blue-700 bg-blue-50 border-blue-200' },
];

function ComponentRow({ comp, onChange }) {
  const [open, setOpen] = useState(false);
  const needsBase    = comp.method === 'percentage';
  const needsValue   = comp.method === 'percentage' || comp.method === 'fixed';
  const isRemaining  = comp.method === 'remaining';

  return (
    <div className={cn(
      'rounded-xl border transition-all',
      comp.enabled ? 'border-[#c7c4d8] bg-white' : 'border-[#e7eefe] bg-[#fafaff] opacity-60'
    )}>
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={() => comp.enabled && setOpen(o => !o)}>
        <Toggle checked={comp.enabled} onChange={v => { onChange({ ...comp, enabled: v }); if (!v) setOpen(false); }} />
        <span className={cn('text-sm font-semibold flex-1', comp.enabled ? 'text-[#151c27]' : 'text-[#9ca3af]')}>
          {comp.label}
        </span>
        {comp.enabled && (
          <span className="text-[0.65rem] text-[#777587] bg-[#f0f3ff] border border-[#c7c4d8] rounded-full px-2 py-0.5 font-semibold">
            {comp.method === 'percentage' ? `${comp.value}% of ${comp.base}` :
             comp.method === 'fixed'      ? `₹${Number(comp.value||0).toLocaleString('en-IN')} fixed` :
             comp.method === 'remaining'  ? 'Remaining balance' :
             'Manual entry'}
          </span>
        )}
        {comp.enabled && (open ? <ChevronUp size={14} className="text-[#777587]" /> : <ChevronDown size={14} className="text-[#777587]" />)}
      </div>

      {/* Expanded config */}
      {comp.enabled && open && (
        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-[#f0f3ff]">
          {/* Method */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
            {METHOD_OPTS.map(m => (
              <button key={m.value} type="button"
                onClick={() => onChange({ ...comp, method: m.value })}
                className={cn(
                  'py-1.5 px-2 rounded-lg text-xs font-bold border transition-all text-center',
                  comp.method === m.value
                    ? 'bg-[#3525cd] text-white border-[#3525cd]'
                    : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'
                )}>
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
              {/* Value */}
              <div>
                <label className="block text-[0.65rem] font-bold text-[#777587] uppercase mb-1">
                  {comp.method === 'percentage' ? 'Percentage (%)' : 'Amount (₹)'}
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] text-xs">
                    {comp.method === 'percentage' ? '%' : '₹'}
                  </span>
                  <input type="number" min={0} step={comp.method === 'percentage' ? 0.01 : 1}
                    value={comp.value || ''}
                    onChange={e => onChange({ ...comp, value: Number(e.target.value) })}
                    className="w-28 border border-[#c7c4d8] rounded-lg pl-7 pr-2 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
                  />
                </div>
              </div>

              {/* Base (only for percentage) */}
              {needsBase && (
                <div>
                  <label className="block text-[0.65rem] font-bold text-[#777587] uppercase mb-1">Base</label>
                  <select value={comp.base || 'gross'}
                    onChange={e => onChange({ ...comp, base: e.target.value })}
                    className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
                    {BASE_OPTS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                  </select>
                </div>
              )}

              {/* Cap (optional) */}
              {comp.method === 'percentage' && (
                <div>
                  <label className="block text-[0.65rem] font-bold text-[#777587] uppercase mb-1">Max Cap (₹, optional)</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] text-xs">₹</span>
                    <input type="number" min={0} step={1}
                      placeholder="No cap"
                      value={comp.cap || ''}
                      onChange={e => onChange({ ...comp, cap: e.target.value ? Number(e.target.value) : null })}
                      className="w-28 border border-[#c7c4d8] rounded-lg pl-7 pr-2 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Threshold (eligibility condition) */}
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
                  <input type="number" min={0} step={1000}
                    value={comp.threshold_value || ''}
                    onChange={e => onChange({ ...comp, threshold_value: Number(e.target.value) })}
                    className="w-28 border border-[#c7c4d8] rounded-lg pl-7 pr-2 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Probation Management section ──────────────────────────────────────────────
function ProbationSection({ form, set, settings }) {
  const toast = useToast();
  const [applying,    setApplying]    = React.useState(false);
  const [applyResult, setApplyResult] = React.useState(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  async function executeBulkApply() {
    setApplying(true);
    setApplyResult(null);
    try {
      const res = await apiPost('/payroll/apply-probation-bulk', {});
      setApplyResult(res);
      toast(
        `Done — ${res.set_to_probation} set to Probation, ${res.set_to_active} set to Active (probation already completed).`,
        'success'
      );
    } catch (e) {
      toast(e.message || 'Failed to apply probation.', 'error');
    } finally {
      setApplying(false);
    }
  }

  function handleApplyAll() {
    setConfirmOpen(true);
  }

  return (
    <Section
      icon={<Users size={15} className="text-[#3525cd]" />}
      title="Probation Management"
      subtitle="Configure company-wide probation defaults and leave rules during probation">

      <Row label="Enable Probation" hint="Turn on to allow setting probation periods for employees">
        <Toggle checked={!!form.probation_enabled} onChange={v => set('probation_enabled', v)} />
      </Row>

      {form.probation_enabled && (
        <>
          <Row label="Default Probation Period" hint="Default number of months for new employees on probation">
            <div className="flex items-center gap-2">
              <NumInput
                value={form.default_probation_months ?? 3}
                onChange={v => set('default_probation_months', Math.max(1, v))}
                min={1} max={24}
              />
              <span className="text-sm text-[#777587]">months</span>
            </div>
          </Row>

          <Row
            label="Paid Leave During Probation"
            hint="If OFF, approved leaves during probation are treated as unpaid (LOP applies in payroll)">
            <Toggle
              checked={form.paid_leave_during_probation !== false}
              onChange={v => set('paid_leave_during_probation', v)}
            />
          </Row>
          {form.paid_leave_during_probation === false && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <Info size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                Employees on probation will have all leave marked as unpaid (LWP/LOP). Payroll will deduct salary for those leave days regardless of the leave policy's paid setting.
              </p>
            </div>
          )}

          {/* ── Apply Probation To ── */}
          <div className="border-t border-[#f0f3ff] pt-4">
            <p className="text-sm font-semibold text-[#151c27] mb-1">Apply Probation To</p>
            <p className="text-[0.68rem] text-[#777587] mb-3">
              Controls which employees receive probation. Existing statuses are never changed automatically
              unless you explicitly click "Apply to All" below.
            </p>
            <div className="flex gap-3">
              {[
                { value: 'selected', label: 'Selected Employees', desc: 'HR sets probation per employee in the employee edit modal' },
                { value: 'all',     label: 'All Employees',       desc: 'Auto-applies to every active employee based on Joining Date' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set('probation_scope', opt.value)}
                  className={cn(
                    'flex-1 text-left rounded-xl border px-4 py-3 transition-all',
                    (form.probation_scope ?? 'selected') === opt.value
                      ? 'border-[#3525cd] bg-[#f0f3ff] ring-1 ring-[#3525cd]/20'
                      : 'border-[#c7c4d8] bg-white hover:border-[#3525cd]/40'
                  )}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      'w-3.5 h-3.5 rounded-full border-2 flex-shrink-0',
                      (form.probation_scope ?? 'selected') === opt.value
                        ? 'border-[#3525cd] bg-[#3525cd]'
                        : 'border-[#c7c4d8] bg-white'
                    )} />
                    <span className="text-sm font-bold text-[#151c27]">{opt.label}</span>
                  </div>
                  <p className="text-[0.68rem] text-[#777587] pl-5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* ── All Employees: bulk apply button ── */}
          {(form.probation_scope ?? 'selected') === 'all' && (
            <div className="bg-[#f0f3ff] border border-[#c7c4d8] rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Info size={14} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
                <div className="text-xs text-[#464555] space-y-1">
                  <p><strong>How it works:</strong> Click "Apply to All" after saving settings. Active employees still within their probation window are set to <em>Probation</em>; those whose window has already passed are set to <em>Active (Full Time)</em>. The daily cron auto-applies this to any new joiners overnight.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleApplyAll}
                  disabled={applying || !settings?.probation_enabled || settings?.probation_scope !== 'all'}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all',
                    applying || !settings?.probation_enabled || settings?.probation_scope !== 'all'
                      ? 'bg-[#e7eefe] text-[#9ca3af] cursor-not-allowed'
                      : 'bg-[#3525cd] text-white hover:bg-[#2a1fb0]'
                  )}>
                  {applying
                    ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Applying…</>
                    : <><Users size={13} /> Apply to All Eligible Employees</>}
                </button>
                {settings?.probation_enabled && settings?.probation_scope !== 'all' && (
                  <span className="text-[0.68rem] text-amber-600 font-semibold">Save settings first to enable this button.</span>
                )}
                {applyResult && (
                  <span className="text-[0.68rem] text-emerald-700 font-semibold">
                    Done — {applyResult.set_to_probation} set to Probation, {applyResult.set_to_active} set to Active (completed).
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Custom confirmation dialog — replaces native window.confirm */}
      <ConfirmModal
        open={confirmOpen}
        variant="warning"
        title="Apply Probation to All Employees?"
        message={`Active employees joining within the last ${form.default_probation_months ?? 3} months will be set to Probation. Employees whose probation period has already ended will be set to Active (Full Time). Employees without a joining date are skipped. This action cannot be undone automatically.`}
        confirmLabel="Yes, Apply"
        onConfirm={executeBulkApply}
        onCancel={() => setConfirmOpen(false)}
      />
    </Section>
  );
}

// ── Salary Calculation Rules section ─────────────────────────────────────────
function SalaryRulesSection({ rules, onChange }) {
  const updateComp = (key, updated) => {
    onChange({
      ...rules,
      components: rules.components.map(c => c.key === key ? updated : c),
    });
  };

  return (
    <div className="space-y-5">
      {/* Master enable */}
      <Row
        label="Enable CTC-based Salary Calculation"
        hint="When enabled, HR enters a monthly CTC and the system auto-calculates all components using the rules below.">
        <Toggle checked={!!rules.enabled} onChange={v => onChange({ ...rules, enabled: v })} />
      </Row>

      {rules.enabled && (
        <>
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <Info size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Configure how each salary component is calculated from CTC.
              <strong> Remaining</strong> = fills whatever balance is left so the earnings sum equals gross.
              <strong> Manual</strong> = HR enters the amount directly.
              Disabled components are excluded from calculations.
            </p>
          </div>

          {GROUPS.map(group => {
            const comps = rules.components.filter(c => c.group === group.key);
            if (!comps.length) return null;
            return (
              <div key={group.key}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={cn('text-[0.62rem] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border', group.color)}>
                    {group.label}
                  </span>
                </div>
                <div className="space-y-2">
                  {comps.map(comp => (
                    <ComponentRow key={comp.key} comp={comp} onChange={updated => updateComp(comp.key, updated)} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PayrollSettings() {
  const toast = useToast();
  const qc    = useQueryClient();
  const [form, setForm]   = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);
  const [salaryRules, setSalaryRules] = useState(mergeWithDefaults(null));

  const { data: settings, isLoading } = useQuery({
    queryKey: ['payroll-settings'],
    queryFn:  () => apiGet('/payroll/settings'),
  });

  useEffect(() => {
    if (settings) {
      setForm({ ...DEFAULTS, ...settings });
      setSalaryRules(mergeWithDefaults(settings.salary_calculation_rules));
      setDirty(false);
    }
  }, [settings]);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const handleRulesChange = (updated) => {
    setSalaryRules(updated);
    setDirty(true);
  };

  const saveMut = useMutation({
    mutationFn: () => apiPut('/payroll/settings', { ...form, salary_calculation_rules: salaryRules }),
    onSuccess: () => {
      toast('Payroll settings saved', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-settings'] });
      setDirty(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const ordinalDay = d => {
    const s = ['th','st','nd','rd'];
    const v = d % 100;
    return d + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="page-header">
          <div className="page-title">Payroll Settings</div>
        </div>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-5${dirty ? ' pb-20' : ''}`}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Payroll Settings</div>
          <div className="page-subtitle">
            <span className="text-[#777587]">Payroll</span>
            <span className="mx-1.5 text-[#c7c4d8]">›</span>
            Settings
          </div>
        </div>
        <button
          onClick={() => saveMut.mutate()}
          disabled={!dirty || saveMut.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all',
            dirty
              ? 'bg-[#3525cd] text-white hover:bg-[#2a1fb0] shadow-sm'
              : 'bg-[#f0f3ff] text-[#777587] cursor-not-allowed'
          )}>
          <Save size={15} />
          {saveMut.isPending ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      {/* Payroll Cycle */}
      <Section
        icon={<Calendar size={15} className="text-[#3525cd]" />}
        title="Payroll Cycle"
        subtitle="When payroll is calculated and payslips are generated">
        <Row label="Payroll Cycle" hint="Only monthly is supported in this version">
          <select
            value={form.payroll_cycle}
            onChange={e => set('payroll_cycle', e.target.value)}
            className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
            <option value="monthly">Monthly</option>
          </select>
        </Row>
        <Row label="Payroll Date" hint={`Payroll runs on the ${ordinalDay(form.payroll_date)} of each month`}>
          <NumInput value={form.payroll_date} onChange={v => set('payroll_date', v)} min={1} max={28} />
        </Row>
      </Section>

      {/* Working Days */}
      <Section
        icon={<Users size={15} className="text-[#3525cd]" />}
        title="Working Days Rules"
        subtitle="Controls how expected working days are calculated for LOP">
        <Row label="Working Days Calculation" hint="Calendar: count from actual weekdays. Fixed: use a set number.">
          <div className="flex gap-2">
            {[['calendar','Calendar'], ['fixed','Fixed']].map(([val, label]) => (
              <button key={val} onClick={() => set('working_days_rule', val)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                  form.working_days_rule === val
                    ? 'bg-[#3525cd] text-white border-[#3525cd]'
                    : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'
                )}>
                {label}
              </button>
            ))}
          </div>
        </Row>
        {form.working_days_rule === 'fixed' && (
          <Row label="Fixed Working Days / Month" hint="Used as the denominator for per-day salary calculation">
            <NumInput value={form.fixed_working_days} onChange={v => set('fixed_working_days', v)} min={1} max={31} />
          </Row>
        )}
        <Row label="Weekend Policy" hint="Determines which days are weekends (unpaid)">
          <select
            value={form.weekend_policy}
            onChange={e => set('weekend_policy', e.target.value)}
            className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
            <option value="sat_sun">Saturday + Sunday</option>
            <option value="sun_only">Sunday Only</option>
            <option value="alternate_sat">Alternate Saturday + Sunday</option>
            <option value="none">No Weekends (6-day work week)</option>
          </select>
        </Row>
        <Row label="Count Holidays as Paid" hint="Public/org holidays will not count as LOP">
          <Toggle checked={form.count_holidays_as_paid} onChange={v => set('count_holidays_as_paid', v)} />
        </Row>
        <Row
          label="Per-Day Salary Basis"
          hint={form.per_day_salary_basis === 'calendar_days'
            ? 'LOP per-day rate = Gross ÷ calendar days in month (e.g. Aug = ÷31). LOP day count still uses working days.'
            : 'LOP per-day rate = Gross ÷ actual working (non-weekend) days in month.'}>
          <div className="flex gap-2">
            {[['working_days','Working Days'], ['calendar_days','Calendar Days']].map(([val, label]) => (
              <button key={val} onClick={() => set('per_day_salary_basis', val)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                  form.per_day_salary_basis === val
                    ? 'bg-[#3525cd] text-white border-[#3525cd]'
                    : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'
                )}>
                {label}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      {/* Attendance Rules */}
      <Section
        icon={<Clock size={15} className="text-[#3525cd]" />}
        title="Attendance Rules"
        subtitle="Controls how late arrivals, half days, and LOP are calculated">
        <Row label="Grace Period (minutes)" hint="Arrivals within grace window are not counted as late">
          <NumInput value={form.grace_minutes} onChange={v => set('grace_minutes', v)} min={0} max={60} />
        </Row>
        <Row label="Late Allowances per Month" hint="First N late arrivals are forgiven before counting toward half-day">
          <NumInput value={form.late_allowance_per_month} onChange={v => set('late_allowance_per_month', v)} min={0} max={31} />
        </Row>
        <Row label="Early Exit Allowance (minutes)" hint="Leaving early by less than this is not penalized">
          <NumInput value={form.early_exit_allowance_minutes} onChange={v => set('early_exit_allowance_minutes', v)} min={0} max={120} />
        </Row>
        <Row label="Lates Before Half Day" hint={`Every ${form.half_day_after_lates} additional lates (after allowance) = 1 half day`}>
          <NumInput value={form.half_day_after_lates} onChange={v => set('half_day_after_lates', v)} min={1} max={10} />
        </Row>
        <Row label="Half Days Before LOP" hint={`Every ${form.lop_after_half_days} half days = 1 LOP day`}>
          <NumInput value={form.lop_after_half_days} onChange={v => set('lop_after_half_days', v)} min={1} max={10} />
        </Row>
      </Section>

      {/* Statutory */}
      <Section
        icon={<Shield size={15} className="text-[#3525cd]" />}
        title="Statutory Components"
        subtitle="Enable or disable statutory deductions. Amounts are set per employee in salary structures.">
        {[
          ['pf_enabled',                'Provident Fund (PF)',       'Employee and employer PF contributions'],
          ['esi_enabled',               'ESI',                       'Employee State Insurance contributions'],
          ['professional_tax_enabled',  'Professional Tax (PT)',      'State-level professional tax deduction'],
          ['tds_enabled',               'TDS',                       'Tax Deducted at Source on salary'],
        ].map(([key, label, hint]) => (
          <Row key={key} label={label} hint={hint}>
            <Toggle checked={form[key]} onChange={v => set(key, v)} />
          </Row>
        ))}
      </Section>

      {/* ── Salary Calculation Rules ─────────────────────────────────────── */}
      <Section
        icon={<IndianRupee size={15} className="text-[#3525cd]" />}
        title="Salary Calculation Rules"
        subtitle="Configure how CTC is broken down into individual salary components when setting salary structures">
        <SalaryRulesSection rules={salaryRules} onChange={handleRulesChange} />
      </Section>

      {/* ── Probation Management ─────────────────────────────────────────────── */}
      <ProbationSection form={form} set={set} settings={settings} />

      {/* Automation */}
      <Section
        icon={<Settings size={15} className="text-[#3525cd]" />}
        title="Automation"
        subtitle="Control automatic payroll generation, publishing, and payslip delivery">
        <Row label="Auto-generate Payroll" hint="Platform scheduler evaluates this organization's policy every hour">
          <Toggle checked={form.auto_generate_payroll} onChange={v => set('auto_generate_payroll', v)} />
        </Row>
        {form.auto_generate_payroll && (
          <>
            <div className="border-t border-[#f0f3ff] pt-4 space-y-4">
              <p className="text-xs font-bold text-[#464555] uppercase tracking-wide">Generation Schedule</p>
              <Row label="Generate On" hint="Day of month the scheduler generates payroll. Leave blank to use the Payroll Date above.">
                <DayPicker value={form.payroll_generation_day} onChange={v => set('payroll_generation_day', v)} />
              </Row>
              <Row label="Generate Time" hint="Earliest hour (in org timezone) the scheduler may generate payroll">
                <TimeInput value={form.payroll_generation_time} onChange={v => set('payroll_generation_time', v || '01:00')} />
              </Row>
              <Row label="Generate For" hint="Which month's payroll to generate on the configured day">
                <div className="flex gap-2">
                  {[['PREVIOUS', 'Previous month'], ['CURRENT', 'Current month']].map(([val, label]) => (
                    <button key={val} onClick={() => set('payroll_generate_for', val)}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                        form.payroll_generate_for === val
                          ? 'bg-[#3525cd] text-white border-[#3525cd]'
                          : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'
                      )}>
                      {label}
                    </button>
                  ))}
                </div>
              </Row>
            </div>
            <div className="border-t border-[#f0f3ff] pt-4 space-y-4">
              <p className="text-xs font-bold text-[#464555] uppercase tracking-wide">Publish Schedule</p>
              <Row label="Auto-publish Payslips" hint="Automatically publish payslips on the configured publish date (skips draft review)">
                <Toggle checked={form.auto_publish} onChange={v => set('auto_publish', v)} />
              </Row>
              {form.auto_publish && (
                <>
                  <Row label="Publish On" hint="Day of month to publish generated payslips. Leave blank to publish on the same day as generation.">
                    <DayPicker value={form.payroll_publish_day} onChange={v => set('payroll_publish_day', v)} />
                  </Row>
                  <Row label="Publish Time" hint="Earliest hour the scheduler may publish payslips">
                    <TimeInput value={form.payroll_publish_time} onChange={v => set('payroll_publish_time', v || '09:00')} />
                  </Row>
                </>
              )}
            </div>
            <div className="border-t border-[#f0f3ff] pt-4 space-y-4">
              <p className="text-xs font-bold text-[#464555] uppercase tracking-wide">Delivery &amp; Payout</p>
              <Row label="Auto-email Payslips" hint="Email PDF payslips to each employee after publication">
                <Toggle checked={form.payslip_auto_email} onChange={v => set('payslip_auto_email', v)} />
              </Row>
              <Row label="Expected Payout Day" hint="Informational — shown to employees as expected salary credit date">
                <DayPicker value={form.payroll_payout_day} onChange={v => set('payroll_payout_day', v)} />
              </Row>
            </div>
            <div className="border-t border-[#f0f3ff] pt-4">
              <Row label="Timezone" hint="All schedule day/time comparisons are evaluated in this timezone">
                <select
                  value={form.timezone}
                  onChange={e => set('timezone', e.target.value)}
                  className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white max-w-xs">
                  {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                </select>
              </Row>
            </div>
            <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
              <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                The platform scheduler runs every hour and evaluates each organization independently.
                Actions execute only when today's date and time match this organization's configuration.
              </p>
            </div>
          </>
        )}
        {!form.auto_generate_payroll && (
          <Row label="Auto-email Payslips" hint="Email PDF payslips to each employee when payroll is manually published">
            <Toggle checked={form.payslip_auto_email} onChange={v => set('payslip_auto_email', v)} />
          </Row>
        )}
      </Section>

      {/* Payslip Branding */}
      <Section icon={<IndianRupee size={16} className="text-[#3525cd]" />}
        title="Payslip Branding"
        subtitle="Company details printed on the payslip header and footer. Leave blank if not applicable.">
        <div className="space-y-5">

          {/* Priority note */}
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
            <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700">
              When <strong>Registered Office</strong> or <strong>Corporate Office</strong> are filled in, the payslip shows them as separate labelled sections.
              If only <strong>Generic Company Address</strong> is set, it is shown as a plain address block (backward-compatible).
              <strong> Company Full Name</strong> overrides the organization name in the payslip header.
            </p>
          </div>

          {/* ── Company Name ── */}
          <div>
            <p className="text-sm font-semibold text-[#151c27] mb-1">Company Full Name</p>
            <p className="text-[0.68rem] text-[#777587] mb-1.5">
              Full legal company name shown in bold at the top-right of every payslip.
              If blank, the organization name is used.
            </p>
            <input type="text"
              value={form.payslip_company_fullname || ''}
              onChange={e => set('payslip_company_fullname', e.target.value)}
              placeholder="e.g. Acme Technologies Pvt. Ltd."
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
            />
          </div>

          {/* ── Registered Office ── */}
          <div>
            <p className="text-sm font-semibold text-[#151c27] mb-1">Registered Office</p>
            <p className="text-[0.68rem] text-[#777587] mb-1.5">
              Shown with a <strong>Registered Office</strong> label in the payslip header.
              Use line breaks for multi-line addresses.
            </p>
            <textarea
              rows={2}
              value={form.payslip_registered_address || ''}
              onChange={e => set('payslip_registered_address', e.target.value)}
              placeholder={`e.g. Office No. 206 & 207, Dalal Street, Block 53, Zone 5\nGift City, Gandhinagar, Gujarat – 382050`}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] resize-none"
            />
          </div>

          {/* ── Corporate Office ── */}
          <div>
            <p className="text-sm font-semibold text-[#151c27] mb-1">Corporate Office</p>
            <p className="text-[0.68rem] text-[#777587] mb-1.5">
              Shown with a <strong>Corporate Office</strong> label in the payslip header.
              Use line breaks for multi-line addresses.
            </p>
            <textarea
              rows={2}
              value={form.payslip_corporate_address || ''}
              onChange={e => set('payslip_corporate_address', e.target.value)}
              placeholder={`e.g. 2nd Floor, O Block, Mondeal Retail Park\nNr. Rajpath Club, S. G. Highway, Ahmedabad – 380059`}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] resize-none"
            />
          </div>

          {/* ── Contact Details ── */}
          <div>
            <p className="text-sm font-semibold text-[#151c27] mb-1">Contact Details</p>
            <p className="text-[0.68rem] text-[#777587] mb-1.5">
              Phone number and/or email shown below the office addresses on the payslip.
            </p>
            <input type="text"
              value={form.payslip_contact_details || ''}
              onChange={e => set('payslip_contact_details', e.target.value)}
              placeholder="e.g. Office: +91 98765 43210  |  Mail: hr@company.in"
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
            />
          </div>

          {/* ── Divider + Legacy fallback ── */}
          <div className="border-t border-[#f0f3ff] pt-4">
            <p className="text-[0.68rem] font-bold text-[#777587] uppercase tracking-wider mb-3">
              Generic Address (fallback)
            </p>
            <div>
              <p className="text-sm font-semibold text-[#151c27] mb-1">Company Address</p>
              <p className="text-[0.68rem] text-[#777587] mb-1.5">
                Used only when Registered Office and Corporate Office above are both blank.
                Shown as a plain address block in the payslip header.
              </p>
              <textarea
                rows={3}
                value={form.payslip_company_address || ''}
                onChange={e => set('payslip_company_address', e.target.value)}
                placeholder={`e.g. 2nd Floor, O Block, Mondeal Retail Park\nSG Highway, Ahmedabad – 380054`}
                className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] resize-none"
              />
            </div>
          </div>

          {/* ── CIN / Registration / Footer ── */}
          <div className="border-t border-[#f0f3ff] pt-4 space-y-4">
            <p className="text-[0.68rem] font-bold text-[#777587] uppercase tracking-wider mb-1">
              Legal &amp; Footer
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-semibold text-[#151c27] mb-1">CIN / GST Number</p>
                <p className="text-[0.68rem] text-[#777587] mb-1.5">
                  Company identification number shown below the company name.
                </p>
                <input type="text"
                  value={form.payslip_company_cin || ''}
                  onChange={e => set('payslip_company_cin', e.target.value)}
                  placeholder="e.g. CIN No.: U67120GJ2012PTC116832"
                  className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#151c27] mb-1">Company P.F. No.</p>
                <p className="text-[0.68rem] text-[#777587] mb-1.5">
                  Company-level PF registration number printed on all payslips (different from individual employee PF numbers).
                </p>
                <input type="text"
                  value={form.payslip_company_pf_no || ''}
                  onChange={e => set('payslip_company_pf_no', e.target.value)}
                  placeholder="e.g. GJAHM0001234000"
                  className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-semibold text-[#151c27] mb-1">Company ESI No.</p>
                <p className="text-[0.68rem] text-[#777587] mb-1.5">
                  Company-level ESIC registration number printed on all payslips (different from individual employee ESI numbers).
                </p>
                <input type="text"
                  value={form.payslip_company_esic_no || ''}
                  onChange={e => set('payslip_company_esic_no', e.target.value)}
                  placeholder="e.g. 37001945660000999"
                  className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
                />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#151c27] mb-1">Registration Number</p>
                <p className="text-[0.68rem] text-[#777587] mb-1.5">
                  Any additional registration / licence number.
                </p>
                <input type="text"
                  value={form.payslip_company_registration || ''}
                  onChange={e => set('payslip_company_registration', e.target.value)}
                  placeholder="e.g. SEBI Reg: INZ000242435"
                  className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
                />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-[#151c27] mb-1">Payslip Footer Note</p>
              <p className="text-[0.68rem] text-[#777587] mb-1.5">
                Disclaimer text at the bottom of every payslip. If blank, a generic note is used.
              </p>
              <input type="text"
                value={form.payslip_footer_note || ''}
                onChange={e => set('payslip_footer_note', e.target.value)}
                placeholder="e.g. This is a computer generated salary slip and does not require a signature."
                className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
              />
            </div>
          </div>

        </div>
      </Section>

      {/* Footer */}
      <div className="rounded-xl border border-[#e7eefe] bg-[#f9f9ff] px-5 py-4 flex items-start gap-3">
        <Info size={14} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-[#777587]">
          These settings apply to all payroll calculations for this organization.
          Changes take effect from the next payroll run. Existing payslips are not recalculated.
        </p>
      </div>

      {/* Fixed save bar */}
      {dirty && (
        <div className="fixed bottom-0 left-0 md:left-64 right-0 z-20 bg-white border-t border-[#e7eefe] py-3 px-4 md:px-7 flex items-center justify-between shadow-lg">
          <p className="text-xs text-[#777587] font-semibold">You have unsaved changes.</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setForm({ ...DEFAULTS, ...settings }); setSalaryRules(mergeWithDefaults(settings?.salary_calculation_rules)); setDirty(false); }}
              className="text-xs font-semibold text-[#777587] hover:text-[#464555] px-3 py-2">
              Discard
            </button>
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="flex items-center gap-1.5 bg-[#3525cd] text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-[#2a1fb0] disabled:opacity-60">
              <Save size={13} /> {saveMut.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
