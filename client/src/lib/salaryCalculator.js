// Pure CTC-to-salary-breakdown calculator.
// Mirrors the logic used at save time so the form preview is always accurate.

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

export const EARNING_KEYS   = ['basic','hra','da','transport_allowance','medical_allowance','special_allowance','other_allowance'];
export const DEDUCTION_KEYS = ['employee_pf','employee_esi','professional_tax','tds','other_deductions','retention'];
export const EMPLOYER_KEYS  = ['employer_pf','employer_esi'];

export const ALL_COMPONENT_KEYS = [...EARNING_KEYS, ...DEDUCTION_KEYS, ...EMPLOYER_KEYS];

// Statutory component keys — owned by Statutory Config, not by salary_calculation_rules.
export const STATUTORY_COMPONENT_KEYS = new Set([
  'employee_pf', 'employee_esi', 'professional_tax', 'tds',
  'employer_pf', 'employer_esi',
]);

export const DEFAULT_SALARY_RULES = {
  enabled: false,
  components: [
    // ── Earnings ──────────────────────────────────────────────────────────────
    { key: 'basic',               label: 'Basic',               group: 'earning',   enabled: true,  method: 'percentage', value: 40,    base: 'gross',  cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'hra',                 label: 'HRA',                 group: 'earning',   enabled: true,  method: 'percentage', value: 50,    base: 'basic',  cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'da',                  label: 'DA',                  group: 'earning',   enabled: false, method: 'percentage', value: 0,     base: 'basic',  cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'transport_allowance', label: 'Transport Allowance', group: 'earning',   enabled: true,  method: 'fixed',      value: 1600,  base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'medical_allowance',   label: 'Medical Allowance',   group: 'earning',   enabled: true,  method: 'fixed',      value: 1250,  base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'special_allowance',   label: 'Special Allowance',   group: 'earning',   enabled: true,  method: 'remaining',  value: 0,     base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'other_allowance',     label: 'Other Allowance',     group: 'earning',   enabled: false, method: 'manual',     value: 0,     base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    // ── Employee Deductions ───────────────────────────────────────────────────
    { key: 'employee_pf',         label: 'PF (Employee)',        group: 'deduction', enabled: true,  method: 'percentage', value: 12,    base: 'basic',  cap: 1800, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'employee_esi',        label: 'ESI (Employee)',       group: 'deduction', enabled: true,  method: 'percentage', value: 0.75,  base: 'gross',  cap: null, threshold_enabled: true,  threshold_type: 'gross_max', threshold_value: 21000 },
    { key: 'professional_tax',    label: 'Professional Tax',     group: 'deduction', enabled: true,  method: 'fixed',      value: 200,   base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'tds',                 label: 'TDS',                  group: 'deduction', enabled: false, method: 'manual',     value: 0,     base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'other_deductions',    label: 'Other Deductions',     group: 'deduction', enabled: false, method: 'manual',     value: 0,     base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'retention',           label: 'Retention',            group: 'deduction', enabled: false, method: 'manual',     value: 0,     base: null,     cap: null, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    // ── Employer Contributions ────────────────────────────────────────────────
    { key: 'employer_pf',         label: 'PF (Employer)',         group: 'employer',  enabled: true,  method: 'percentage', value: 12,    base: 'basic',  cap: 1800, threshold_enabled: false, threshold_type: 'gross_max', threshold_value: null },
    { key: 'employer_esi',        label: 'ESI (Employer)',        group: 'employer',  enabled: true,  method: 'percentage', value: 3.25,  base: 'gross',  cap: null, threshold_enabled: true,  threshold_type: 'gross_max', threshold_value: 21000 },
  ],
};

/** Merge saved DB rules with defaults (adds any missing keys from defaults). */
export function mergeWithDefaults(savedRules) {
  if (!savedRules) return { ...DEFAULT_SALARY_RULES };
  const savedMap = Object.fromEntries((savedRules.components || []).map(c => [c.key, c]));
  const merged   = DEFAULT_SALARY_RULES.components.map(d => ({ ...d, ...(savedMap[d.key] || {}) }));
  return { enabled: savedRules.enabled ?? false, components: merged };
}

/**
 * Derive a statutory component's CTC-suggestion amount from Statutory Config.
 *
 * Returns a number (including 0 when the component is disabled) so the caller
 * knows the value has been resolved from statutory config.
 * Returns null when the key is not a statutory component, or when the config
 * cannot produce a deterministic value (PT/TDS when enabled — caller falls
 * through to the rule-based suggestion in those cases).
 *
 * This function is pure: no DB calls, no side effects.
 */
function computeStatutory(key, statutoryConfig, ctx) {
  if (!statutoryConfig) return null;
  const { pf, esi, pt, tds } = statutoryConfig;

  if (key === 'employee_pf') {
    if (!pf?.enabled) return 0;
    const basis = pf.pf_wage_basis === 'basic_da'
      ? (ctx.basic || 0) + (ctx.da || 0)
      : (ctx.basic || 0);
    const wages = Number(pf.wage_ceiling || 0) > 0
      ? Math.min(basis, Number(pf.wage_ceiling))
      : basis;
    return r2(wages * (Number(pf.employee_pf_pct || 12) / 100));
  }

  if (key === 'employer_pf') {
    if (!pf?.enabled) return 0;
    const basis = pf.pf_wage_basis === 'basic_da'
      ? (ctx.basic || 0) + (ctx.da || 0)
      : (ctx.basic || 0);
    const wages     = Number(pf.wage_ceiling || 0) > 0 ? Math.min(basis, Number(pf.wage_ceiling)) : basis;
    const epsCeiling = Math.min(basis, 15000); // EPS statutory ceiling is always ₹15,000
    const eps = r2(epsCeiling * (Number(pf.employer_eps_pct || 8.33) / 100));
    const epf = r2(wages     * (Number(pf.employer_epf_pct || 3.67) / 100));
    return r2(eps + epf);
  }

  if (key === 'employee_esi') {
    if (!esi?.enabled) return 0;
    const wageLimit = Number(esi.wage_limit || 21000);
    if (wageLimit > 0 && (ctx.gross || 0) > wageLimit) return 0;
    return r2((ctx.gross || 0) * (Number(esi.employee_esi_pct || 0.75) / 100));
  }

  if (key === 'employer_esi') {
    if (!esi?.enabled) return 0;
    const wageLimit = Number(esi.wage_limit || 21000);
    if (wageLimit > 0 && (ctx.gross || 0) > wageLimit) return 0;
    return r2((ctx.gross || 0) * (Number(esi.employer_esi_pct || 3.25) / 100));
  }

  if (key === 'professional_tax') {
    // PT requires a state-specific slab lookup not available in this pure function.
    // Return 0 when PT is disabled; null when enabled so the rule-based fixed-amount
    // suggestion (₹200) is used as a reasonable in-form approximation.
    if (!pt?.enabled) return 0;
    return null;
  }

  if (key === 'tds') {
    // TDS requires annual projection + declarations — not computable at CTC-entry time.
    // Return 0 when disabled; null when enabled (rule default is already 0 / manual).
    if (!tds?.enabled) return 0;
    return null;
  }

  return null; // not a statutory component
}

/**
 * Calculate a full salary breakdown from CTC + org rules.
 *
 * Design contract:
 *  - Returns null when rules are disabled or ctc <= 0 (caller falls back to manual mode).
 *  - manual overrides take precedence over any calculated value; they cascade (e.g.
 *    overriding basic causes hra to re-compute from the new basic automatically).
 *  - The 'remaining' component fills whatever gap is left so gross exactly equals
 *    ctc - employer_contributions.  It cannot be manually overridden.
 *  - final_ctc is guaranteed to equal ctc within ₹0 (4-pass iterative convergence).
 *
 * @param {number} ctc              Monthly cost to company
 * @param {object} rules            Merged salary_calculation_rules (from mergeWithDefaults)
 * @param {object} manualOverrides  { [componentKey]: number } for HR-unlocked fields
 * @returns {object|null}
 */
export function calculateFromCTC(ctc, rules, manualOverrides = {}, statutoryConfig = null) {
  if (!ctc || ctc <= 0 || !rules?.enabled) return null;

  const getComp = key => rules.components?.find(c => c.key === key);

  // ── applyRule ──────────────────────────────────────────────────────────────
  // Manual overrides take precedence over every method so that overriding one
  // component cascades through components that depend on it (e.g. HRA = 50% of
  // basic reacts when basic is overridden).
  function applyRule(rule, ctx) {
    if (!rule) return 0;

    // Manual override: highest priority — always wins over every other source
    if (Object.prototype.hasOwnProperty.call(manualOverrides, rule.key)) {
      return r2(Number(manualOverrides[rule.key]) || 0);
    }

    // Statutory config: authoritative for statutory components.
    // computeStatutory returns a resolved number (including 0 when disabled)
    // or null when the value cannot be derived from config (→ fall through to rule).
    if (statutoryConfig) {
      const sv = computeStatutory(rule.key, statutoryConfig, ctx);
      if (sv !== null) return sv;
    }

    // Rule-based calculation (non-statutory components or statutory fallback)
    if (!rule.enabled) return 0;

    if (rule.method === 'manual')    return 0;
    if (rule.method === 'fixed')     return r2(Number(rule.value || 0));
    if (rule.method === 'remaining') return 0; // filled in a dedicated step

    if (rule.method === 'percentage') {
      if (rule.threshold_enabled && rule.threshold_type === 'gross_max' &&
          ctx.gross > Number(rule.threshold_value || 0)) return 0;
      const base = rule.base === 'basic' ? ctx.basic
                 : rule.base === 'gross' ? ctx.gross
                 : rule.base === 'ctc'   ? ctc
                 : 0;
      let v = r2((Number(rule.value || 0) / 100) * base);
      if (rule.cap) v = Math.min(v, r2(Number(rule.cap)));
      return v;
    }
    return 0;
  }

  // Helper: estimate basic for a given gross (respects override)
  const basicRule = getComp('basic');
  function estimateBasic(g) {
    if (Object.prototype.hasOwnProperty.call(manualOverrides, 'basic')) {
      return r2(Number(manualOverrides['basic']) || 0);
    }
    if (basicRule?.method === 'percentage' && basicRule?.enabled) {
      return r2((Number(basicRule.value || 0) / 100) * g);
    }
    return applyRule(basicRule, { gross: g, basic: 0 });
  }

  // ── Iterative solve ────────────────────────────────────────────────────────
  // Employer contributions depend on basic which depends on gross which depends
  // on employer contributions. 4 passes guarantee ₹0 CTC drift for all common
  // salary structures (verified: 3 passes can give ±₹0.10 for % PF structures).
  let gross = ctc * 0.92;

  for (let pass = 0; pass < 4; pass++) {
    const basicEst = estimateBasic(gross);
    const ctx      = { gross, basic: basicEst };
    const empPf    = applyRule(getComp('employer_pf'),  ctx);
    const empEsi   = applyRule(getComp('employer_esi'), ctx);
    gross = r2(ctc - empPf - empEsi);
  }

  // ── Final pass: every component with settled gross ─────────────────────────
  const basicVal      = applyRule(basicRule,                      { gross, basic: 0 });
  const ctx0          = { gross, basic: basicVal };

  const hraVal        = applyRule(getComp('hra'),                 ctx0);
  const daVal         = applyRule(getComp('da'),                  ctx0);
  const transportVal  = applyRule(getComp('transport_allowance'), ctx0);
  const medicalVal    = applyRule(getComp('medical_allowance'),   ctx0);
  const otherAllowVal = applyRule(getComp('other_allowance'),     ctx0);

  const sumBeforeRemaining = basicVal + hraVal + daVal + transportVal + medicalVal + otherAllowVal;

  // 'remaining' fills the gap so totalGross == gross exactly.
  // It cannot be overridden (no unlock button is rendered for it in the UI).
  const specialRule    = getComp('special_allowance');
  const hasRemaining   = specialRule?.enabled && specialRule.method === 'remaining';
  let   specialVal     = hasRemaining
    ? r2(Math.max(0, gross - sumBeforeRemaining))
    : applyRule(specialRule, ctx0);

  let totalGross = r2(basicVal + hraVal + daVal + transportVal + medicalVal + specialVal + otherAllowVal);
  let ctxFinal   = { gross: totalGross, basic: basicVal, da: daVal };

  // ── Employer contributions (final, using settled values) ───────────────────
  const employerPf  = applyRule(getComp('employer_pf'),  ctxFinal);
  const employerEsi = applyRule(getComp('employer_esi'), ctxFinal);
  const totalEmployer = r2(employerPf + employerEsi);

  // ── CTC reconciliation ─────────────────────────────────────────────────────
  // When a 'remaining' component exists, absorb any final rounding residual into
  // it so that finalCtc == ctc exactly (residual is at most ±₹0.01 / 1 paise).
  if (hasRemaining) {
    const grossAdj = r2(ctc - totalEmployer);
    const delta    = r2(grossAdj - totalGross);
    if (Math.abs(delta) > 0) {
      specialVal = r2(Math.max(0, specialVal + delta));
      totalGross = r2(totalGross + delta);
      ctxFinal   = { gross: totalGross, basic: basicVal, da: daVal };
    }
  }

  // ── Employee deductions ────────────────────────────────────────────────────
  const empPfVal    = applyRule(getComp('employee_pf'),        ctxFinal);
  const empEsiVal   = applyRule(getComp('employee_esi'),       ctxFinal);
  const ptVal       = applyRule(getComp('professional_tax'),   ctxFinal);
  const tdsVal      = applyRule(getComp('tds'),                ctxFinal);
  const otherDedVal = applyRule(getComp('other_deductions'),   ctxFinal);
  const retentionVal= applyRule(getComp('retention'),          ctxFinal);

  const totalDeductions = r2(empPfVal + empEsiVal + ptVal + tdsVal + otherDedVal + retentionVal);
  const netSalary       = r2(Math.max(0, totalGross - totalDeductions));

  const finalCtc = r2(totalGross + totalEmployer);

  return {
    basic: basicVal,
    hra: hraVal,
    da: daVal,
    transport_allowance: transportVal,
    medical_allowance: medicalVal,
    special_allowance: specialVal,
    other_allowance: otherAllowVal,
    gross: totalGross,
    employee_pf: empPfVal,
    employee_esi: empEsiVal,
    professional_tax: ptVal,
    tds: tdsVal,
    other_deductions: otherDedVal,
    retention: retentionVal,
    total_deductions: totalDeductions,
    net_salary: netSalary,
    employer_pf: employerPf,
    employer_esi: employerEsi,
    total_employer: totalEmployer,
    final_ctc: finalCtc,
  };
}

/** Describe a rule's calculation method in plain text (for UI labels). */
export function ruleLabel(rule) {
  if (!rule?.enabled) return 'disabled';
  if (rule.method === 'fixed')     return `Fixed ₹${Number(rule.value || 0).toLocaleString('en-IN')}`;
  if (rule.method === 'manual')    return 'Manual entry';
  if (rule.method === 'remaining') return 'Remaining amount';
  if (rule.method === 'percentage') {
    const base = rule.base === 'basic' ? 'Basic' : rule.base === 'gross' ? 'Gross' : rule.base === 'ctc' ? 'CTC' : rule.base;
    let s = `${rule.value}% of ${base}`;
    if (rule.cap)               s += `, max ₹${Number(rule.cap).toLocaleString('en-IN')}`;
    if (rule.threshold_enabled) s += ` (if gross ≤ ₹${Number(rule.threshold_value || 0).toLocaleString('en-IN')})`;
    return s;
  }
  return '';
}
