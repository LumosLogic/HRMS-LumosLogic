import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Save, ChevronDown, ChevronUp, Info, AlertCircle } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPut } from '@/lib/api';
import { cn } from '@/lib/utils';

// ── Shared primitives ─────────────────────────────────────────────────────────
function Toggle({ checked, onChange, disabled }) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)} disabled={disabled}
      className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
        checked ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]', disabled && 'opacity-50 cursor-not-allowed')}>
      <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm',
        checked ? 'translate-x-4' : 'translate-x-1')} />
    </button>
  );
}

function NumField({ label, hint, value, onChange, min, max, step = 0.01 }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-semibold text-[#151c27]">{label}</p>
        {hint && <p className="text-[0.68rem] text-[#777587] mt-0.5">{hint}</p>}
      </div>
      <input type="number" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-28 border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm text-right text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20" />
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

// ── Section accordion ─────────────────────────────────────────────────────────
function Section({ title, subtitle, enabled, children, onSave, saving }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 bg-[#fafaff] border-b border-[#f0f3ff] hover:bg-[#f0f3ff] transition-colors">
        <div className="flex items-center gap-3 text-left">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', enabled ? 'bg-emerald-500' : 'bg-[#c7c4d8]')} />
          <div>
            <p className="text-sm font-bold text-[#151c27]">{title}</p>
            {subtitle && <p className="text-[0.68rem] text-[#777587]">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {onSave && (
            <button type="button" onClick={e => { e.stopPropagation(); onSave(); }}
              disabled={saving}
              className="flex items-center gap-1.5 bg-[#3525cd] text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-[#2a1fb0] disabled:opacity-50 transition-all">
              <Save size={12} /> {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {open ? <ChevronUp size={15} className="text-[#777587]" /> : <ChevronDown size={15} className="text-[#777587]" />}
        </div>
      </button>
      {open && <div className="px-5 py-5 space-y-5">{children}</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function StatutoryConfig() {
  const toast = useToast();
  const qc    = useQueryClient();

  const { data: raw, isLoading, isError, error } = useQuery({
    queryKey: ['statutory-config'],
    queryFn:  () => apiGet('/statutory/config'),
    retry: false,
  });

  // Local state per section
  const [pf,       setPF]       = useState(null);
  const [esi,      setESI]      = useState(null);
  const [pt,       setPT]       = useState(null);
  const [tds,      setTDS]      = useState(null);
  const [gratuity, setGratuity] = useState(null);
  const [lwf,      setLWF]      = useState(null);
  const [bonus,    setBonus]    = useState(null);

  useEffect(() => {
    if (!raw) return;
    setPF(raw.pf || {
      enabled: false, employee_pf_pct: 12, employer_epf_pct: 3.67,
      employer_eps_pct: 8.33, wage_ceiling: 15000, pf_wage_basis: 'basic',
      vpf_enabled: false, vpf_pct: 0,
    });
    setESI(raw.esi || { enabled: false, employee_esi_pct: 0.75, employer_esi_pct: 3.25, wage_limit: 21000 });
    setPT(raw.pt  || { enabled: false, state_code: 'KA' });
    setTDS(raw.tds || {
      enabled: false, default_regime: 'new', fy_start_month: 4,
      standard_deduction_old: 50000, standard_deduction_new: 75000,
    });
    setGratuity(raw.gratuity || {
      enabled: false, min_service_years: 5, wage_basis: 'basic',
      working_days_denominator: 26, days_per_year: 15, max_gratuity: 2000000,
    });
    setLWF(raw.lwf || { enabled: false, state_code: 'KA' });
    setBonus(raw.bonus || {
      statutory_bonus_enabled: false, statutory_bonus_pct: 8.33,
      statutory_wage_ceiling: 21000, statutory_wage_floor: 7000,
      festival_bonus_enabled: false, festival_bonus_months: [10],
    });
  }, [raw]);

  const saveMut = (endpoint, payload, label) => () =>
    apiPut(`/statutory/config/${endpoint}`, payload).then(() => {
      toast(`${label} saved`, 'success');
      qc.invalidateQueries({ queryKey: ['statutory-config'] });
    }).catch(e => toast(e.message, 'error'));

  const [saving, setSaving] = useState({});
  const withSave = (key, fn) => async () => {
    setSaving(s => ({ ...s, [key]: true }));
    await fn();
    setSaving(s => ({ ...s, [key]: false }));
  };

  if (isError) {
    const msg = error?.message || '';
    const isPermission = msg.includes('permission') || msg.includes('403');
    return (
      <div className="space-y-5">
        <div className="page-header"><div className="page-title">Statutory Compliance Config</div></div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mb-4">
            <span className="text-amber-600 text-2xl">⚠️</span>
          </div>
          <p className="text-lg font-black text-[#151c27] mb-2">
            {isPermission ? 'Access Restricted' : 'Page Failed to Load'}
          </p>
          <p className="text-sm text-[#777587] max-w-sm">
            {isPermission
              ? 'You do not have permission to access Statutory Configuration. Please ask your Root Admin to grant you the required access.'
              : 'Failed to load statutory configuration. Please refresh the page.'}
          </p>
        </div>
      </div>
    );
  }

  if (isLoading || !pf) {
    return (
      <div className="space-y-5">
        <div className="page-header"><div className="page-title">Statutory Compliance Config</div></div>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const ptStates  = raw?.ptStates  || [];
  const lwfStates = raw?.lwfStates || [];

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
          Statutory configurations apply from the next payroll run. Existing payslips are not recalculated.
          Enable each component individually and save.
        </p>
      </div>

      {/* ── PF ── */}
      {pf && (
        <Section title="Provident Fund (PF)" subtitle="Employee PF, Employer EPF & EPS"
          enabled={pf.enabled}
          onSave={withSave('pf', saveMut('pf', pf, 'PF config'))}
          saving={saving.pf}>
          <Row label="Enable PF" hint="Activates PF deduction for all eligible employees">
            <Toggle checked={pf.enabled} onChange={v => setPF(f => ({ ...f, enabled: v }))} />
          </Row>
          {pf.enabled && (
            <>
              <Row label="PF Wage Basis" hint="Basis for PF calculation">
                <div className="flex gap-2">
                  {[['basic','Basic Only'],['basic_da','Basic + DA']].map(([v, l]) => (
                    <button key={v} onClick={() => setPF(f => ({ ...f, pf_wage_basis: v }))}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                        pf.pf_wage_basis === v
                          ? 'bg-[#3525cd] text-white border-[#3525cd]'
                          : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40')}>
                      {l}
                    </button>
                  ))}
                </div>
              </Row>
              <NumField label="Employee PF %" hint="Statutory: 12%" value={pf.employee_pf_pct}
                onChange={v => setPF(f => ({ ...f, employee_pf_pct: v }))} min={0} max={100} />
              <NumField label="Employer EPF %" hint="Statutory: 3.67%" value={pf.employer_epf_pct}
                onChange={v => setPF(f => ({ ...f, employer_epf_pct: v }))} min={0} max={100} />
              <NumField label="Employer EPS %" hint="Statutory: 8.33% (capped at ₹15,000)" value={pf.employer_eps_pct}
                onChange={v => setPF(f => ({ ...f, employer_eps_pct: v }))} min={0} max={100} />
              <NumField label="PF Wage Ceiling (₹)" hint="0 = no ceiling (use actual wages)" value={pf.wage_ceiling}
                onChange={v => setPF(f => ({ ...f, wage_ceiling: v }))} min={0} max={100000} step={1000} />
              <div className="border-t border-[#f0f3ff] pt-4">
                <Row label="Voluntary PF (VPF)" hint="Additional employee contribution above 12%">
                  <Toggle checked={pf.vpf_enabled} onChange={v => setPF(f => ({ ...f, vpf_enabled: v }))} />
                </Row>
                {pf.vpf_enabled && (
                  <div className="mt-4">
                    <NumField label="VPF %" hint="Additional % on actual wages" value={pf.vpf_pct}
                      onChange={v => setPF(f => ({ ...f, vpf_pct: v }))} min={0} max={100} />
                  </div>
                )}
              </div>
            </>
          )}
        </Section>
      )}

      {/* ── ESI ── */}
      {esi && (
        <Section title="Employee State Insurance (ESI)" subtitle="Auto-disabled above wage limit"
          enabled={esi.enabled}
          onSave={withSave('esi', saveMut('esi', esi, 'ESI config'))}
          saving={saving.esi}>
          <Row label="Enable ESI" hint="Applies to employees with gross ≤ wage limit">
            <Toggle checked={esi.enabled} onChange={v => setESI(f => ({ ...f, enabled: v }))} />
          </Row>
          {esi.enabled && (
            <>
              <NumField label="Employee ESI %" hint="Statutory: 0.75%" value={esi.employee_esi_pct}
                onChange={v => setESI(f => ({ ...f, employee_esi_pct: v }))} min={0} max={10} />
              <NumField label="Employer ESI %" hint="Statutory: 3.25%" value={esi.employer_esi_pct}
                onChange={v => setESI(f => ({ ...f, employer_esi_pct: v }))} min={0} max={10} />
              <NumField label="Wage Eligibility Limit (₹/month)" hint="ESI not applicable above this gross"
                value={esi.wage_limit}
                onChange={v => setESI(f => ({ ...f, wage_limit: v }))} min={0} step={1000} />
            </>
          )}
        </Section>
      )}

      {/* ── PT ── */}
      {pt && (
        <Section title="Professional Tax (PT)" subtitle="State-wise slab-based deduction"
          enabled={pt.enabled}
          onSave={withSave('pt', saveMut('pt', pt, 'PT config'))}
          saving={saving.pt}>
          <Row label="Enable PT">
            <Toggle checked={pt.enabled} onChange={v => setPT(f => ({ ...f, enabled: v }))} />
          </Row>
          {pt.enabled && (
            <Row label="State" hint="Selects the applicable PT slab table">
              <select value={pt.state_code} onChange={e => setPT(f => ({ ...f, state_code: e.target.value }))}
                className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
                {ptStates.map(s => <option key={s.state_code} value={s.state_code}>{s.state_name}</option>)}
              </select>
            </Row>
          )}
        </Section>
      )}

      {/* ── TDS ── */}
      {tds && (
        <Section title="Income Tax / TDS" subtitle="Monthly TDS with old/new regime support"
          enabled={tds.enabled}
          onSave={withSave('tds', saveMut('tds', tds, 'TDS config'))}
          saving={saving.tds}>
          <Row label="Enable TDS" hint="Employees can submit declarations; monthly TDS auto-calculated">
            <Toggle checked={tds.enabled} onChange={v => setTDS(f => ({ ...f, enabled: v }))} />
          </Row>
          {tds.enabled && (
            <>
              <Row label="Default Tax Regime" hint="Applied when employee has not submitted a declaration">
                <div className="flex gap-2">
                  {[['new','New Regime (FY25)'],['old','Old Regime']].map(([v, l]) => (
                    <button key={v} onClick={() => setTDS(f => ({ ...f, default_regime: v }))}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                        tds.default_regime === v
                          ? 'bg-[#3525cd] text-white border-[#3525cd]'
                          : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40')}>
                      {l}
                    </button>
                  ))}
                </div>
              </Row>
              <NumField label="Standard Deduction — Old Regime (₹)"
                value={tds.standard_deduction_old}
                onChange={v => setTDS(f => ({ ...f, standard_deduction_old: v }))} min={0} step={1000} />
              <NumField label="Standard Deduction — New Regime (₹)"
                value={tds.standard_deduction_new}
                onChange={v => setTDS(f => ({ ...f, standard_deduction_new: v }))} min={0} step={1000} />
            </>
          )}
        </Section>
      )}

      {/* ── Gratuity ── */}
      {gratuity && (
        <Section title="Gratuity" subtitle="Monthly accrual based on formula"
          enabled={gratuity.enabled}
          onSave={withSave('gratuity', saveMut('gratuity', gratuity, 'Gratuity config'))}
          saving={saving.gratuity}>
          <Row label="Enable Gratuity">
            <Toggle checked={gratuity.enabled} onChange={v => setGratuity(f => ({ ...f, enabled: v }))} />
          </Row>
          {gratuity.enabled && (
            <>
              <Row label="Wage Basis">
                <div className="flex gap-2">
                  {[['basic','Basic'],['basic_da','Basic + DA']].map(([v, l]) => (
                    <button key={v} onClick={() => setGratuity(f => ({ ...f, wage_basis: v }))}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                        gratuity.wage_basis === v
                          ? 'bg-[#3525cd] text-white border-[#3525cd]'
                          : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40')}>
                      {l}
                    </button>
                  ))}
                </div>
              </Row>
              <NumField label="Min. Service Years" hint="Employees eligible after this period"
                value={gratuity.min_service_years}
                onChange={v => setGratuity(f => ({ ...f, min_service_years: v }))} min={1} max={10} step={0.5} />
              <NumField label="Working Days Denominator" hint="26 for 5-day week, 30 for 6-day"
                value={gratuity.working_days_denominator}
                onChange={v => setGratuity(f => ({ ...f, working_days_denominator: v }))} min={20} max={31} step={1} />
              <NumField label="Days Per Year" hint="Statutory: 15" value={gratuity.days_per_year}
                onChange={v => setGratuity(f => ({ ...f, days_per_year: v }))} min={1} max={30} step={1} />
              <NumField label="Maximum Gratuity (₹)" hint="Statutory cap: ₹20,00,000"
                value={gratuity.max_gratuity}
                onChange={v => setGratuity(f => ({ ...f, max_gratuity: v }))} min={0} step={100000} />
            </>
          )}
        </Section>
      )}

      {/* ── LWF ── */}
      {lwf && (
        <Section title="Labour Welfare Fund (LWF)" subtitle="State-wise employee & employer contribution"
          enabled={lwf.enabled}
          onSave={withSave('lwf', saveMut('lwf', lwf, 'LWF config'))}
          saving={saving.lwf}>
          <Row label="Enable LWF">
            <Toggle checked={lwf.enabled} onChange={v => setLWF(f => ({ ...f, enabled: v }))} />
          </Row>
          {lwf.enabled && (
            <Row label="State">
              <select value={lwf.state_code} onChange={e => setLWF(f => ({ ...f, state_code: e.target.value }))}
                className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
                {lwfStates.map(s => <option key={s.state_code} value={s.state_code}>{s.state_name}</option>)}
              </select>
            </Row>
          )}
        </Section>
      )}

      {/* ── Bonus ── */}
      {bonus && (
        <Section title="Bonus" subtitle="Statutory & festival bonus configuration"
          enabled={bonus.statutory_bonus_enabled || bonus.festival_bonus_enabled}
          onSave={withSave('bonus', saveMut('bonus', bonus, 'Bonus config'))}
          saving={saving.bonus}>
          <Row label="Statutory Bonus" hint="8.33% of wages (Payment of Bonus Act)">
            <Toggle checked={bonus.statutory_bonus_enabled} onChange={v => setBonus(f => ({ ...f, statutory_bonus_enabled: v }))} />
          </Row>
          {bonus.statutory_bonus_enabled && (
            <>
              <NumField label="Bonus %" hint="Statutory min: 8.33%, max: 20%" value={bonus.statutory_bonus_pct}
                onChange={v => setBonus(f => ({ ...f, statutory_bonus_pct: v }))} min={8.33} max={20} />
              <NumField label="Wage Ceiling (₹)" hint="Eligible up to this monthly wage"
                value={bonus.statutory_wage_ceiling}
                onChange={v => setBonus(f => ({ ...f, statutory_wage_ceiling: v }))} min={0} step={1000} />
              <NumField label="Wage Floor (₹)" hint="Minimum bonus if actual wage < floor"
                value={bonus.statutory_wage_floor}
                onChange={v => setBonus(f => ({ ...f, statutory_wage_floor: v }))} min={0} step={500} />
            </>
          )}
          <Row label="Festival Bonus" hint="One-time bonus in specified month(s)">
            <Toggle checked={bonus.festival_bonus_enabled} onChange={v => setBonus(f => ({ ...f, festival_bonus_enabled: v }))} />
          </Row>
        </Section>
      )}
    </div>
  );
}
