import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Info, Landmark, HeartPulse, Receipt, Percent, Gift, Award, Users } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPut } from '@/lib/api';
import { cn } from '@/lib/utils';

const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const r2  = n => Math.round((Number(n) || 0) * 100) / 100;

// ── Primitives ────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)} disabled={disabled}
      className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none flex-shrink-0',
        checked ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]', disabled && 'opacity-50 cursor-not-allowed')}>
      <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm',
        checked ? 'translate-x-4' : 'translate-x-1')} />
    </button>
  );
}

// Labelled number field with a unit (% or ₹) and a plain-language hint.
function Field({ label, hint, value, onChange, unit = '%', min = 0, max, step }) {
  const money = unit === '₹';
  return (
    <div>
      <label className="block text-xs font-bold text-[#464555] mb-1">{label}</label>
      <div className="relative">
        {money && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-sm">₹</span>}
        <input type="number" min={min} max={max} step={step ?? (money ? 1000 : 0.01)} value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          className={cn('w-full border border-[#c7c4d8] rounded-lg py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20',
            money ? 'pl-7 pr-3' : 'pl-3 pr-8')} />
        {!money && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9ca3af] text-sm">{unit}</span>}
      </div>
      {hint && <p className="text-[0.66rem] text-[#777587] mt-1">{hint}</p>}
    </div>
  );
}

function Choice({ label, hint, value, onChange, options }) {
  return (
    <div>
      <label className="block text-xs font-bold text-[#464555] mb-1">{label}</label>
      <div className="flex gap-2 flex-wrap">
        {options.map(([v, l]) => (
          <button key={v} type="button" onClick={() => onChange(v)}
            className={cn('px-3 py-2 rounded-lg text-xs font-bold border transition-all',
              value === v ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40')}>
            {l}
          </button>
        ))}
      </div>
      {hint && <p className="text-[0.66rem] text-[#777587] mt-1">{hint}</p>}
    </div>
  );
}

function StateSelect({ label, hint, value, onChange, states }) {
  return (
    <div>
      <label className="block text-xs font-bold text-[#464555] mb-1">{label}</label>
      <select value={value || ''} onChange={e => onChange(e.target.value)}
        className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
        {states.map(s => <option key={s.state_code} value={s.state_code}>{s.state_name}</option>)}
      </select>
      {hint && <p className="text-[0.66rem] text-[#777587] mt-1">{hint}</p>}
    </div>
  );
}

// The example box: what this configuration does to a sample salary.
function Example({ title = 'Example', children }) {
  return (
    <div className="rounded-lg bg-[#f6f7ff] border border-[#dfe3fb] px-4 py-3">
      <p className="text-[0.62rem] font-black uppercase tracking-widest text-[#3525cd] mb-1.5">{title}</p>
      <div className="text-xs text-[#464555] space-y-0.5">{children}</div>
    </div>
  );
}
const Line = ({ k, v, bold }) => (
  <div className="flex justify-between gap-3"><span>{k}</span><span className={cn('tabular-nums', bold && 'font-black text-[#151c27]')}>{v}</span></div>
);

// One component = one card: header with the enable switch, fields only when ON, its own Save.
function Card({ icon: Icon, title, subtitle, enabled, onToggle, dirty, saving, onSave, offText, children }) {
  return (
    <div className={cn('bg-white rounded-xl border shadow-sm overflow-hidden transition-colors', enabled ? 'border-[#c7c4d8]' : 'border-[#e2e0f0]')}>
      <div className="flex items-center gap-3 px-5 py-4 bg-[#fafaff] border-b border-[#f0f3ff] flex-wrap">
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', enabled ? 'bg-[#e8e5ff] text-[#3525cd]' : 'bg-[#f1f2f7] text-[#9ca3af]')}>
          <Icon size={17} />
        </div>
        <div className="flex-1 min-w-[10rem]">
          <p className="text-sm font-bold text-[#151c27]">{title}</p>
          <p className="text-[0.7rem] text-[#777587]">{subtitle}</p>
        </div>
        <span className={cn('text-[0.65rem] font-black uppercase tracking-wider px-2 py-0.5 rounded-full',
          enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f1f2f7] text-[#777587]')}>{enabled ? 'On' : 'Off'}</span>
        <Toggle checked={!!enabled} onChange={onToggle} />
        <button type="button" onClick={onSave} disabled={!dirty || saving}
          className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
            dirty ? 'bg-[#3525cd] text-white hover:bg-[#2a1fb0]' : 'bg-[#f0f3ff] text-[#9ca3af] cursor-not-allowed')}>
          <Save size={12} /> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      <div className="px-5 py-5">
        {enabled
          ? <div className="space-y-5">{children}</div>
          : <p className="text-xs text-[#777587]">{offText}</p>}
      </div>
    </div>
  );
}

// Local editable copy of one config block, with dirty tracking against what was loaded.
function useSection(raw, defaults) {
  const [val, setVal]   = useState(null);
  const [base, setBase] = useState('');
  useEffect(() => {
    if (raw === undefined) return;
    const v = { ...defaults, ...(raw || {}) };
    setVal(v); setBase(JSON.stringify(v));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
  return { val, patch: p => setVal(v => ({ ...v, ...p })), dirty: !!val && JSON.stringify(val) !== base };
}

const DEFAULTS = {
  pf:  { enabled: false, employee_pf_pct: 12, employer_epf_pct: 3.67, employer_eps_pct: 8.33, wage_ceiling: 15000, pf_wage_basis: 'basic', vpf_enabled: false, vpf_pct: 0 },
  esi: { enabled: false, employee_esi_pct: 0.75, employer_esi_pct: 3.25, wage_limit: 21000 },
  pt:  { enabled: false, state_code: 'KA' },
  tds: { enabled: false, default_regime: 'new', fy_start_month: 4, standard_deduction_old: 50000, standard_deduction_new: 75000 },
  gratuity: { enabled: false, min_service_years: 5, wage_basis: 'basic', working_days_denominator: 26, days_per_year: 15, max_gratuity: 2000000 },
  lwf: { enabled: false, state_code: 'KA' },
  bonus: { statutory_bonus_enabled: false, statutory_bonus_pct: 8.33, statutory_wage_ceiling: 21000, statutory_wage_floor: 7000, festival_bonus_enabled: false, festival_bonus_months: [10] },
};

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ═══════════════════════════════════════════════════════════════════════════════
export default function StatutoryConfig() {
  const toast = useToast();
  const qc    = useQueryClient();

  const { data: raw, isLoading, isError, error } = useQuery({
    queryKey: ['statutory-config'],
    queryFn:  () => apiGet('/statutory/config'),
    retry: false,
  });
  const { data: ptSlabRows = [] } = useQuery({
    queryKey: ['statutory-pt-slabs'],
    queryFn:  () => apiGet('/statutory/pt-slabs'),
    retry: false, staleTime: 10 * 60 * 1000,
  });

  const pf = useSection(raw ? raw.pf       : undefined, DEFAULTS.pf);
  const esi = useSection(raw ? raw.esi     : undefined, DEFAULTS.esi);
  const pt = useSection(raw ? raw.pt       : undefined, DEFAULTS.pt);
  const tds = useSection(raw ? raw.tds     : undefined, DEFAULTS.tds);
  const gratuity = useSection(raw ? raw.gratuity : undefined, DEFAULTS.gratuity);
  const lwf = useSection(raw ? raw.lwf     : undefined, DEFAULTS.lwf);
  const bonus = useSection(raw ? raw.bonus : undefined, DEFAULTS.bonus);

  // Sample salary used by the example boxes (illustration only — never saved)
  const [sample, setSample] = useState({ basic: 15000, gross: 30000 });

  const saveMut = useMutation({
    mutationFn: ({ endpoint, payload }) => apiPut(`/statutory/config/${endpoint}`, payload),
    onSuccess: (_, { label }) => {
      toast(`${label} saved — applies from the next payroll run`, 'success');
      qc.invalidateQueries({ queryKey: ['statutory-config'] });
      qc.invalidateQueries({ queryKey: ['payroll-settings'] });
    },
    onError: e => toast(e.message, 'error'),
  });
  const save = (endpoint, section, label) => () => saveMut.mutate({ endpoint, payload: section.val, label });
  const savingOf = endpoint => saveMut.isPending && saveMut.variables?.endpoint === endpoint;

  const ptSlab = useMemo(() => ptSlabRows.find(s => s.state_code === pt.val?.state_code), [ptSlabRows, pt.val?.state_code]);

  if (isError) {
    const msg = error?.message || '';
    const isPermission = msg.includes('permission') || msg.includes('403');
    return (
      <div className="space-y-5">
        <div className="page-header"><div className="page-title">Statutory Compliance</div></div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-4"><span className="text-amber-600 text-2xl">⚠️</span></div>
          <p className="text-lg font-black text-[#151c27] mb-2">{isPermission ? 'Access Restricted' : 'Page Failed to Load'}</p>
          <p className="text-sm text-[#777587] max-w-sm">
            {isPermission
              ? 'You do not have permission to access Statutory Configuration. Please ask your Root Admin to grant you the required access.'
              : 'Failed to load statutory configuration. Please refresh the page.'}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !pf.val || !bonus.val) {
    return (
      <div className="space-y-5">
        <div className="page-header"><div className="page-title">Statutory Compliance</div></div>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const ptStates  = raw?.ptStates  || [];
  const lwfStates = raw?.lwfStates || [];

  // ── Example maths — mirrors statutoryCalculationService so the example matches payslips ──
  const pfv = pf.val;
  const rawWages = sample.basic; // the sample salary has no separate DA
  const pfWages  = Number(pfv.wage_ceiling) > 0 ? Math.min(rawWages, Number(pfv.wage_ceiling)) : rawWages;
  const pfEmp    = r2(pfWages * (Number(pfv.employee_pf_pct) || 0) / 100);
  const pfEps    = r2(Math.min(rawWages, 15000) * (Number(pfv.employer_eps_pct) || 0) / 100);
  const pfEpf    = r2(pfWages * (Number(pfv.employer_epf_pct) || 0) / 100);
  const esiv     = esi.val;
  const esiOk    = !(Number(esiv.wage_limit) > 0 && sample.gross > Number(esiv.wage_limit));
  const ptAmount = (() => {
    const slabs = Array.isArray(ptSlab?.slabs) ? ptSlab.slabs : [];
    const s = slabs.find(x => sample.gross >= Number(x.from) && (x.to == null || sample.gross <= Number(x.to)));
    return s ? Number(s.monthly_pt) : 0;
  })();

  const tiles = [
    { label: 'Provident Fund', on: pfv.enabled,  note: pfv.enabled ? `${pfv.employee_pf_pct}% employee` : 'Off' },
    { label: 'ESI',            on: esiv.enabled, note: esiv.enabled ? `up to ${inr(esiv.wage_limit)}` : 'Off' },
    { label: 'Professional Tax', on: pt.val.enabled, note: pt.val.enabled ? (ptStates.find(s => s.state_code === pt.val.state_code)?.state_name || pt.val.state_code) : 'Off' },
    { label: 'Income Tax / TDS', on: tds.val.enabled, note: tds.val.enabled ? `${tds.val.default_regime === 'old' ? 'Old' : 'New'} regime` : 'Off' },
  ];

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <div className="page-title">Statutory Compliance</div>
          <div className="page-subtitle">
            <span className="text-[#777587]">Payroll</span>
            <span className="mx-1.5 text-[#c7c4d8]">›</span>
            Statutory Config
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 flex items-start gap-2.5">
        <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700">
          This is the <strong>only place</strong> PF, ESI, Professional Tax and TDS are configured — payroll and salary structures read these settings.
          Turn a component <strong>On</strong> to see and edit its rules. Changes apply from the next payroll run; existing payslips are not recalculated.
        </p>
      </div>

      {/* At-a-glance status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(t => (
          <div key={t.label} className="bg-white border border-[#e2e0f0] rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <span className={cn('w-2 h-2 rounded-full', t.on ? 'bg-emerald-500' : 'bg-[#c7c4d8]')} />
              <p className="text-xs font-bold text-[#151c27]">{t.label}</p>
            </div>
            <p className="text-[0.7rem] text-[#777587] mt-1 pl-4">{t.note}</p>
          </div>
        ))}
      </div>

      {/* Sample salary for the examples */}
      <div className="bg-white border border-[#e2e0f0] rounded-xl px-5 py-3 flex items-center gap-4 flex-wrap">
        <p className="text-xs font-bold text-[#464555]">Try it with a sample salary (monthly)</p>
        {[['basic', 'Basic'], ['gross', 'Gross']].map(([k, l]) => (
          <label key={k} className="flex items-center gap-2 text-xs text-[#777587]">
            {l}
            <span className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]">₹</span>
              <input type="number" min={0} step={1000} value={sample[k]}
                onChange={e => setSample(s => ({ ...s, [k]: Number(e.target.value) || 0 }))}
                className="w-28 border border-[#c7c4d8] rounded-lg pl-6 pr-2 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]" />
            </span>
          </label>
        ))}
        <p className="text-[0.66rem] text-[#9ca3af]">Used only for the examples below.</p>
      </div>

      {/* ── PF ── */}
      <Card icon={Landmark} title="Provident Fund (PF)" subtitle="Employee PF, employer EPF and EPS"
        enabled={pfv.enabled} onToggle={v => pf.patch({ enabled: v })}
        dirty={pf.dirty} saving={savingOf('pf')} onSave={save('pf', pf, 'PF config')}
        offText="PF is off — no provident fund is deducted or contributed. Turn on to set the wage limit, basis and percentages.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Salary limit for PF (₹ / month)" unit="₹" value={pfv.wage_ceiling} min={0} max={1000000}
            onChange={v => pf.patch({ wage_ceiling: v })}
            hint="PF is calculated on wages up to this amount. Statutory: ₹15,000. Enter 0 to use actual wages (no limit)." />
          <Choice label="PF wage basis" value={pfv.pf_wage_basis} onChange={v => pf.patch({ pf_wage_basis: v })}
            options={[['basic', 'Basic only'], ['basic_da', 'Basic + DA']]} hint="Which salary components count as PF wages." />
          <Field label="Employee PF" value={pfv.employee_pf_pct} max={100} onChange={v => pf.patch({ employee_pf_pct: v })} hint="Deducted from the employee. Statutory: 12%." />
          <Field label="Employer EPF" value={pfv.employer_epf_pct} max={100} onChange={v => pf.patch({ employer_epf_pct: v })} hint="Employer share to EPF. Statutory: 3.67%." />
          <Field label="Employer EPS" value={pfv.employer_eps_pct} max={100} onChange={v => pf.patch({ employer_eps_pct: v })} hint="Employer share to pension. Statutory: 8.33%, on wages up to ₹15,000." />
        </div>
        <div className="border-t border-[#f0f3ff] pt-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#151c27]">Voluntary PF (VPF)</p>
              <p className="text-[0.68rem] text-[#777587]">Extra employee contribution on top of the standard PF.</p>
            </div>
            <Toggle checked={!!pfv.vpf_enabled} onChange={v => pf.patch({ vpf_enabled: v })} />
          </div>
          {pfv.vpf_enabled && (
            <div className="max-w-xs"><Field label="VPF" value={pfv.vpf_pct} max={100} onChange={v => pf.patch({ vpf_pct: v })} hint="Charged on actual wages (no limit)." /></div>
          )}
        </div>
        <Example>
          <Line k={`PF wages (basic ${inr(sample.basic)}${Number(pfv.wage_ceiling) > 0 ? `, limit ${inr(pfv.wage_ceiling)}` : ''})`} v={inr(pfWages)} />
          <Line k={`Employee PF @ ${pfv.employee_pf_pct}%`} v={inr(pfEmp)} bold />
          <Line k={`Employer EPF @ ${pfv.employer_epf_pct}%`} v={inr(pfEpf)} />
          <Line k={`Employer EPS @ ${pfv.employer_eps_pct}% (max ₹15,000 wages)`} v={inr(pfEps)} />
        </Example>
      </Card>

      {/* ── ESI ── */}
      <Card icon={HeartPulse} title="Employee State Insurance (ESI)" subtitle="Applies only up to the wage limit"
        enabled={esiv.enabled} onToggle={v => esi.patch({ enabled: v })}
        dirty={esi.dirty} saving={savingOf('esi')} onSave={save('esi', esi, 'ESI config')}
        offText="ESI is off — no ESI is deducted. Turn on to set the eligibility limit and contribution percentages.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Eligibility limit (₹ gross / month)" unit="₹" value={esiv.wage_limit} min={0} onChange={v => esi.patch({ wage_limit: v })}
            hint="Employees earning more than this are not covered. Statutory: ₹21,000." />
          <Field label="Employee ESI" value={esiv.employee_esi_pct} max={10} onChange={v => esi.patch({ employee_esi_pct: v })} hint="Statutory: 0.75%." />
          <Field label="Employer ESI" value={esiv.employer_esi_pct} max={10} onChange={v => esi.patch({ employer_esi_pct: v })} hint="Statutory: 3.25%." />
        </div>
        <Example>
          {esiOk ? (
            <>
              <Line k={`Employee ESI @ ${esiv.employee_esi_pct}% of gross ${inr(sample.gross)}`} v={inr(r2(sample.gross * (Number(esiv.employee_esi_pct) || 0) / 100))} bold />
              <Line k={`Employer ESI @ ${esiv.employer_esi_pct}%`} v={inr(r2(sample.gross * (Number(esiv.employer_esi_pct) || 0) / 100))} />
            </>
          ) : <p>Gross {inr(sample.gross)} is above the limit of {inr(esiv.wage_limit)} — ESI does not apply.</p>}
        </Example>
      </Card>

      {/* ── PT ── */}
      <Card icon={Receipt} title="Professional Tax (PT)" subtitle="State-wise slab deduction"
        enabled={pt.val.enabled} onToggle={v => pt.patch({ enabled: v })}
        dirty={pt.dirty} saving={savingOf('pt')} onSave={save('pt', pt, 'PT config')}
        offText="Professional Tax is off. Turn on and choose the state whose slabs apply.">
        <div className="max-w-sm">
          <StateSelect label="State" value={pt.val.state_code} onChange={v => pt.patch({ state_code: v })} states={ptStates}
            hint="The slab table of this state decides the monthly amount." />
        </div>
        {Array.isArray(ptSlab?.slabs) && ptSlab.slabs.length > 0 && (
          <div>
            <p className="text-xs font-bold text-[#464555] mb-1.5">Slabs for {ptSlab.state_name}</p>
            <div className="border border-[#e7eefe] rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead><tr className="bg-[#fafaff] text-[#777587]"><th className="text-left px-3 py-1.5 font-bold">Monthly salary</th><th className="text-right px-3 py-1.5 font-bold">PT / month</th></tr></thead>
                <tbody className="divide-y divide-[#f0f3ff]">
                  {ptSlab.slabs.map((s, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5">{inr(s.from)} – {s.to == null ? 'and above' : inr(s.to)}</td>
                      <td className="px-3 py-1.5 text-right font-semibold">{inr(s.monthly_pt)}{s.feb_amount ? ` (Feb ${inr(s.feb_amount)})` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ptSlab.notes && <p className="text-[0.66rem] text-[#777587] mt-1.5">{ptSlab.notes}</p>}
          </div>
        )}
        <Example><Line k={`Gross ${inr(sample.gross)} → PT per month`} v={inr(ptAmount)} bold /></Example>
      </Card>

      {/* ── TDS ── */}
      <Card icon={Percent} title="Income Tax / TDS" subtitle="Monthly TDS with old / new regime"
        enabled={tds.val.enabled} onToggle={v => tds.patch({ enabled: v })}
        dirty={tds.dirty} saving={savingOf('tds')} onSave={save('tds', tds, 'TDS config')}
        offText="TDS is off. Turn on to deduct monthly income tax and let employees submit tax declarations.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Choice label="Default tax regime" value={tds.val.default_regime} onChange={v => tds.patch({ default_regime: v })}
            options={[['new', 'New regime'], ['old', 'Old regime']]} hint="Used for employees who have not submitted a declaration." />
          <div>
            <label className="block text-xs font-bold text-[#464555] mb-1">Financial year starts in</label>
            <select value={tds.val.fy_start_month} onChange={e => tds.patch({ fy_start_month: Number(e.target.value) })}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <p className="text-[0.66rem] text-[#777587] mt-1">India: April.</p>
          </div>
          <Field label="Standard deduction — old regime" unit="₹" value={tds.val.standard_deduction_old} onChange={v => tds.patch({ standard_deduction_old: v })} />
          <Field label="Standard deduction — new regime" unit="₹" value={tds.val.standard_deduction_new} onChange={v => tds.patch({ standard_deduction_new: v })} />
        </div>
      </Card>

      {/* ── Other statutory ── */}
      <div className="pt-2">
        <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-3">Other statutory items</p>
        <div className="space-y-5">
          <Card icon={Award} title="Gratuity" subtitle="Monthly accrual by formula"
            enabled={gratuity.val.enabled} onToggle={v => gratuity.patch({ enabled: v })}
            dirty={gratuity.dirty} saving={savingOf('gratuity')} onSave={save('gratuity', gratuity, 'Gratuity config')}
            offText="Gratuity is off.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Choice label="Wage basis" value={gratuity.val.wage_basis} onChange={v => gratuity.patch({ wage_basis: v })} options={[['basic', 'Basic'], ['basic_da', 'Basic + DA']]} />
              <Field label="Minimum service" unit="yrs" value={gratuity.val.min_service_years} min={1} max={10} step={0.5} onChange={v => gratuity.patch({ min_service_years: v })} hint="Eligible after this many years." />
              <Field label="Working-days denominator" unit="days" value={gratuity.val.working_days_denominator} min={20} max={31} step={1} onChange={v => gratuity.patch({ working_days_denominator: v })} hint="26 for a 5-day week, 30 for 6-day." />
              <Field label="Days per year" unit="days" value={gratuity.val.days_per_year} min={1} max={30} step={1} onChange={v => gratuity.patch({ days_per_year: v })} hint="Statutory: 15." />
              <Field label="Maximum gratuity" unit="₹" value={gratuity.val.max_gratuity} step={100000} onChange={v => gratuity.patch({ max_gratuity: v })} hint="Statutory cap: ₹20,00,000." />
            </div>
          </Card>

          <Card icon={Users} title="Labour Welfare Fund (LWF)" subtitle="State-wise employee & employer contribution"
            enabled={lwf.val.enabled} onToggle={v => lwf.patch({ enabled: v })}
            dirty={lwf.dirty} saving={savingOf('lwf')} onSave={save('lwf', lwf, 'LWF config')}
            offText="LWF is off.">
            <div className="max-w-sm"><StateSelect label="State" value={lwf.val.state_code} onChange={v => lwf.patch({ state_code: v })} states={lwfStates} /></div>
          </Card>

          <Card icon={Gift} title="Bonus" subtitle="Statutory and festival bonus"
            enabled={bonus.val.statutory_bonus_enabled || bonus.val.festival_bonus_enabled}
            onToggle={v => bonus.patch({ statutory_bonus_enabled: v, festival_bonus_enabled: v ? bonus.val.festival_bonus_enabled : false })}
            dirty={bonus.dirty} saving={savingOf('bonus')} onSave={save('bonus', bonus, 'Bonus config')}
            offText="Bonus is off.">
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-sm font-semibold text-[#151c27]">Statutory bonus</p><p className="text-[0.68rem] text-[#777587]">Payment of Bonus Act</p></div>
              <Toggle checked={!!bonus.val.statutory_bonus_enabled} onChange={v => bonus.patch({ statutory_bonus_enabled: v })} />
            </div>
            {bonus.val.statutory_bonus_enabled && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Bonus" value={bonus.val.statutory_bonus_pct} min={8.33} max={20} onChange={v => bonus.patch({ statutory_bonus_pct: v })} hint="Min 8.33%, max 20%." />
                <Field label="Wage ceiling" unit="₹" value={bonus.val.statutory_wage_ceiling} onChange={v => bonus.patch({ statutory_wage_ceiling: v })} hint="Eligible up to this monthly wage." />
                <Field label="Wage floor" unit="₹" value={bonus.val.statutory_wage_floor} step={500} onChange={v => bonus.patch({ statutory_wage_floor: v })} hint="Minimum bonus wage if actual wage is lower." />
              </div>
            )}
            <div className="flex items-center justify-between gap-4 border-t border-[#f0f3ff] pt-4">
              <div><p className="text-sm font-semibold text-[#151c27]">Festival bonus</p><p className="text-[0.68rem] text-[#777587]">One-time bonus in the specified month(s)</p></div>
              <Toggle checked={!!bonus.val.festival_bonus_enabled} onChange={v => bonus.patch({ festival_bonus_enabled: v })} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
