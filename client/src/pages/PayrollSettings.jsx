import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Settings, Save, Info, Calendar, ChevronLeft, ChevronRight, ExternalLink, Scale,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import { BRANCH_KEYED } from '@/lib/queryScopes';
import { apiGet, apiPut } from '@/lib/api';
import { usePayrollSettings } from '@/hooks/useReferenceData';
import { cn, MONTHS, fmtDate } from '@/lib/utils';
import { Section, Row, Toggle, NumInput, DayPicker, TimeInput } from '@/components/payroll/settingsUi';
import ProbationManager from '@/components/payroll/ProbationManager';
import PayslipBranding from '@/components/payroll/PayslipBranding';

// Only payroll-OWNED settings live here. Anything the organisation already configures elsewhere is read from
// there and shown read-only:
//   • weekly offs, holidays, late/early thresholds → Organization Settings (work schedule) / Holidays
//   • PF / ESI / PT / TDS                           → Statutory Compliance
//   • CTC-based salary rules                        → Salary Structure
const DEFAULTS = {
  payroll_cycle:                'monthly',
  payroll_date:                 1,
  count_holidays_as_paid:       true,
  late_allowance_per_month:     3,
  half_day_after_lates:         3,
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
  probation_enabled:            false,
  default_probation_months:     3,
  paid_leave_during_probation:  true,
  probation_scope:              'selected',
  per_day_salary_basis:         'working_days',
  payslip_company_fullname:     '',
  payslip_registered_address:   '',
  payslip_corporate_address:    '',
  payslip_contact_details:      '',
  payslip_company_address:      '',
  payslip_company_cin:          '',
  payslip_company_registration: '',
  payslip_footer_note:          '',
  payslip_company_pf_no:        '',
  payslip_company_esic_no:      '',
  payslip_template:             'classic',
  payslip_watermark_mode:       'logo',
  payslip_watermark_text:       '',
  payslip_custom_fields:        [],
};

// Fields the page can save. Everything else on the settings row (legacy payroll-side copies of working-day /
// grace / statutory values) is left untouched in the database.
const SAVE_KEYS = Object.keys(DEFAULTS);
const NEW_COLUMN_KEYS = ['payslip_template', 'payslip_watermark_mode', 'payslip_watermark_text', 'payslip_custom_fields'];

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

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = t => (t ? String(t).slice(0, 5) : '—');

function Stat({ label, value, sign, tone = 'text-[#151c27]' }) {
  return (
    <div className="flex-1 min-w-[6rem] rounded-xl border border-[#e7eefe] bg-white px-4 py-3 text-center relative">
      {sign && <span className="absolute -left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af] font-black">{sign}</span>}
      <p className={cn('text-2xl font-black', tone)}>{value}</p>
      <p className="text-[0.65rem] font-bold uppercase tracking-wider text-[#777587]">{label}</p>
    </div>
  );
}

// ── Working days + attendance rules, derived from Organization Settings ──────
function OrgDerivedRules({ form, set, basePath }) {
  const { selectedBranchId } = useBranch();
  const now = new Date();
  const [period, setPeriod] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-org-rules', selectedBranchId, period.month, period.year],
    meta: BRANCH_KEYED, placeholderData: keepPreviousData,
    queryFn: () => apiGet('/payroll/settings/org-rules', { month: period.month, year: period.year }),
  });

  const shift = d => setPeriod(p => {
    const m = p.month + d;
    return m < 1 ? { month: 12, year: p.year - 1 } : m > 12 ? { month: 1, year: p.year + 1 } : { month: m, year: p.year };
  });

  const a = data?.attendance;
  const workDays = (data?.workDays || []).map(d => DOW[d]).join(', ');

  return (
    <Section
      icon={<Calendar size={15} className="text-[#3525cd]" />}
      title="Working Days & Attendance Rules"
      subtitle="Taken from Organization Settings — nothing to configure twice">

      <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
        <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          Payroll counts working days as <strong>month days − weekly offs − holidays</strong>, using the work schedule and holidays
          set in <Link to={`${basePath}/settings`} className="font-bold underline">Organization Settings</Link>. Change them there and payroll follows.
        </p>
      </div>

      {/* Working-day calculation */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-[#151c27]">Working days for the period</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => shift(-1)} className="w-7 h-7 rounded-lg border border-[#c7c4d8] flex items-center justify-center hover:bg-[#f0f3ff]"><ChevronLeft size={14} /></button>
            <span className="text-sm font-bold text-[#151c27] w-32 text-center">{MONTHS[period.month - 1]} {period.year}</span>
            <button type="button" onClick={() => shift(1)} className="w-7 h-7 rounded-lg border border-[#c7c4d8] flex items-center justify-center hover:bg-[#f0f3ff]"><ChevronRight size={14} /></button>
          </div>
        </div>
        {isLoading || !data ? (
          <div className="flex justify-center py-6"><span className="w-5 h-5 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" /></div>
        ) : (
          <>
            <div className="flex items-stretch gap-4 pl-3 flex-wrap">
              <Stat label="Days in month" value={data.totalDays} />
              <Stat label="Weekly offs" value={data.weeklyOffs} sign="−" tone="text-amber-600" />
              <Stat label="Holidays" value={data.holidays} sign="−" tone="text-amber-600" />
              <Stat label="Working days" value={data.workingDays} sign="=" tone="text-emerald-700" />
            </div>
            <p className="text-[0.68rem] text-[#777587] mt-2">
              Working week: {workDays || '—'}.
              {data.holidayList?.length > 0 && <> Holidays: {data.holidayList.map(h => `${fmtDate(h.date)} ${h.name}`).join(' · ')}.</>}
            </p>
          </>
        )}
      </div>

      {/* Attendance rules (read-only) */}
      <div className="border-t border-[#f0f3ff] pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-[#151c27]">Attendance rules used by payroll</p>
          <Link to={`${basePath}/settings`} className="text-xs font-bold text-[#3525cd] inline-flex items-center gap-1 hover:underline">
            Edit in Organization Settings <ExternalLink size={11} />
          </Link>
        </div>
        {a ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ['Work hours', `${hhmm(a.start_time)} – ${hhmm(a.end_time)}`],
              ['Late check-in after', a.late_entry_threshold_enabled ? hhmm(a.late_threshold) : 'Not enforced'],
              ['Early leave before', a.early_exit_threshold_enabled ? hhmm(a.early_exit_threshold) : 'Not enforced'],
              ['Half day below', a.half_day_hours != null ? `${a.half_day_hours} hrs` : '—'],
              ['Full day from', a.full_day_hours != null ? `${a.full_day_hours} hrs` : '—'],
              ['Early leaves allowed / month', a.max_early_leave_count != null ? `${a.max_early_leave_count} (extra → LOP)` : '—'],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-[#fafaff] border border-[#e7eefe] px-3 py-2.5">
                <p className="text-[0.62rem] font-bold uppercase tracking-wider text-[#777587]">{l}</p>
                <p className="text-sm font-bold text-[#151c27]">{v}</p>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-[#9ca3af]">Loading…</p>}
        <p className="text-[0.68rem] text-[#777587] mt-2">Shift-specific or branch-specific rules, where set, take priority for those employees.</p>
      </div>

      {/* The few LOP policies that only payroll owns */}
      <div className="border-t border-[#f0f3ff] pt-4 space-y-4">
        <p className="text-xs font-bold text-[#464555] uppercase tracking-wide">Payroll LOP policy</p>
        <Row label="Count holidays as paid" hint="Public / organisation holidays are not treated as LOP">
          <Toggle checked={form.count_holidays_as_paid} onChange={v => set('count_holidays_as_paid', v)} />
        </Row>
        <Row label="Per-day salary basis"
          hint={form.per_day_salary_basis === 'calendar_days'
            ? 'LOP per-day rate = Gross ÷ calendar days in the month. LOP day count still uses working days.'
            : 'LOP per-day rate = Gross ÷ working days of the month.'}>
          <div className="flex gap-2">
            {[['working_days', 'Working days'], ['calendar_days', 'Calendar days']].map(([val, label]) => (
              <button key={val} type="button" onClick={() => set('per_day_salary_basis', val)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                  form.per_day_salary_basis === val ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40')}>
                {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Late arrivals forgiven per month" hint="Late check-ins (after the late threshold above) beyond this count start converting to half days">
          <NumInput value={form.late_allowance_per_month} onChange={v => set('late_allowance_per_month', v)} min={0} max={31} />
        </Row>
        <Row label="Extra lates per half day" hint={`Every ${form.half_day_after_lates} late arrivals beyond the allowance = 1 half day LOP`}>
          <NumInput value={form.half_day_after_lates} onChange={v => set('half_day_after_lates', v)} min={1} max={10} />
        </Row>
      </div>
    </Section>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PayrollSettings() {
  const toast = useToast();
  const qc    = useQueryClient();
  const { user } = useAuth();
  const basePath = user?.role === 'root_admin' ? '/root' : '';
  const [form, setForm]   = useState(DEFAULTS);
  const [dirty, setDirty] = useState(false);

  const { data: settings, isLoading } = usePayrollSettings({ staleTime: 0 });

  useEffect(() => {
    if (settings) {
      setForm({ ...DEFAULTS, ...settings });
      setDirty(false);
    }
  }, [settings]);

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    setDirty(true);
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = {};
      for (const k of SAVE_KEYS) {
        // The template columns arrive with payroll_simplification_2026_10_07.sql — until a database has them,
        // do not send untouched defaults (that would make every save fail on the unknown column).
        if (NEW_COLUMN_KEYS.includes(k) && !(settings && k in settings) && JSON.stringify(form[k]) === JSON.stringify(DEFAULTS[k])) continue;
        payload[k] = form[k];
      }
      return apiPut('/payroll/settings', payload);
    },
    onSuccess: () => {
      toast('Payroll settings saved', 'success');
      qc.invalidateQueries({ queryKey: ['payroll-settings'] });
      qc.invalidateQueries({ queryKey: ['probation-list'] });
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
        <div className="page-header"><div className="page-title">Payroll Settings</div></div>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-5${dirty ? ' pb-20' : ''}`}>
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
          className={cn('flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-all',
            dirty ? 'bg-[#3525cd] text-white hover:bg-[#2a1fb0] shadow-sm' : 'bg-[#f0f3ff] text-[#777587] cursor-not-allowed')}>
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

      <OrgDerivedRules form={form} set={set} basePath={basePath} />

      {/* Statutory + salary pointers (no duplicate configuration here) */}
      <div className="rounded-xl border border-[#e7eefe] bg-[#f9f9ff] px-5 py-4 flex items-start gap-3">
        <Scale size={15} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-[#464555]">
          <strong>PF, ESI, Professional Tax and TDS</strong> are configured in{' '}
          <Link to={`${basePath}/statutory/config`} className="font-bold text-[#3525cd] underline">Statutory Compliance</Link> and used by payroll as-is.{' '}
          <strong>CTC-based salary rules</strong> are on the{' '}
          <Link to={`${basePath}/payroll/salary`} className="font-bold text-[#3525cd] underline">Salary Structure</Link> page.
        </p>
      </div>

      <ProbationManager form={form} set={set} settings={settings} />

      {/* Payslip Generation Settings (formerly "Automation") */}
      <Section
        icon={<Settings size={15} className="text-[#3525cd]" />}
        title="Payslip Generation Settings"
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
              <Row label="Generate For" hint="Payroll is generated for the month that just ended — never for an incomplete month">
                <span className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-[#3525cd] text-white border-[#3525cd]">Previous month</span>
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

      <PayslipBranding form={form} set={set} />

      <div className="rounded-xl border border-[#e7eefe] bg-[#f9f9ff] px-5 py-4 flex items-start gap-3">
        <Info size={14} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
        <p className="text-xs text-[#777587]">
          These settings apply to all payroll calculations for this organization.
          Changes take effect from the next payroll run. Existing payslips are not recalculated.
        </p>
      </div>

      {dirty && (
        <div className="fixed bottom-0 left-0 md:left-64 right-0 z-20 bg-white border-t border-[#e7eefe] py-3 px-4 md:px-7 flex items-center justify-between shadow-lg">
          <p className="text-xs text-[#777587] font-semibold">You have unsaved changes.</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setForm({ ...DEFAULTS, ...settings }); setDirty(false); }}
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
