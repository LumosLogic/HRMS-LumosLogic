import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Info, Plus, Trash2, Check } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { BRANCH_KEYED } from '@/lib/queryScopes';
import { useOrgSettings } from '@/hooks/useReferenceData';
import { cn } from '@/lib/utils';
import { buildPayslipHtml, PRINT_PAGE_CSS } from '@/lib/payslipHtml';
import { PAYSLIP_TEMPLATE_LIST, CUSTOM_FIELD_POSITIONS } from '@/lib/payslipTemplates';
import { Section, TextField } from './settingsUi';

// A realistic payslip used when the organisation has no payslip yet (or the viewer cannot read payslips).
const SAMPLE_SLIP = {
  month: new Date().getMonth() + 1, year: new Date().getFullYear(),
  user_id: 0, employee_id: 'EMP-014', name: 'Riya Shah', position: 'Software Engineer', department: 'Engineering',
  basic: 25000, hra: 10000, da: 0, transport_allowance: 2000, medical_allowance: 1250, special_allowance: 5000, other_allowances: 0,
  pf_employee: 1800, esi_employee: 0, professional_tax: 200, tds: 0, retention: 0, other_deductions: 0,
  lop_days: 1, lop_amount: 1600, gross_salary: 43250, total_deductions: 3600, net_salary: 39650,
  working_days: 22, present_days: 21, leave_days: 0,
  attendance_snapshot: { presentFull: 21, presentHalf: 0, weekoff: 8, holiday: 0, paidLeave: 0 },
};
const SAMPLE_STATUTORY = { pan_number: 'ABCDE1234F', pf_no: 'PF/12345/678', esi_no: '1234567890' };
const SAMPLE_BANKING   = { bank_name: 'Sample Bank', account_number: '123456789012' };

// Renders payslip HTML in an isolated iframe (so each template keeps its own CSS), scaled to fit its container.
function ScaledFrame({ html, visibleHeight }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setScale(Math.max(0.2, el.clientWidth / 820));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PRINT_PAGE_CSS} html,body{overflow:hidden}</style></head><body>${html}</body></html>`;
  const frameH = 1200;
  return (
    <div ref={wrapRef} className="w-full overflow-hidden bg-white" style={{ height: visibleHeight ?? frameH * scale }}>
      <iframe title="Payslip preview" srcDoc={doc} sandbox="" scrolling="no"
        style={{ width: 820, height: frameH, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }} />
    </div>
  );
}

export default function PayslipBranding({ form, set }) {
  const { data: orgSettings } = useOrgSettings({ staleTime: 5 * 60 * 1000 });
  const { selectedBranchId } = useBranch();

  // Latest generated payslip → realistic preview data. Falls back to the sample when none / not permitted.
  const { data: latest } = useQuery({
    queryKey: ['payslip-preview-source', selectedBranchId],
    meta: BRANCH_KEYED,
    staleTime: 5 * 60 * 1000, retry: false,
    queryFn: async () => {
      const list = await apiGet('/payroll/payslips/all');
      const first = Array.isArray(list) ? list[0] : null;
      return first ? apiGet(`/payroll/payslips/${first.id}/details`) : null;
    },
  });
  const slip = latest || SAMPLE_SLIP;

  const orgName    = orgSettings?.name || 'Your Company';
  const orgLogoUrl = orgSettings?.logo_url
    || (typeof window !== 'undefined' ? `${window.location.origin}/LogoWithoutName.svg` : '/LogoWithoutName.svg');

  const htmlFor = templateId => buildPayslipHtml({
    slip, settings: { ...form, payslip_template: templateId }, orgName, orgLogoUrl,
    statutory: SAMPLE_STATUTORY, banking: SAMPLE_BANKING, clBalance: '6.00',
  });
  const selectedHtml = useMemo(() => htmlFor(form.payslip_template || 'classic'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, slip, orgName, orgLogoUrl]);

  const fields = Array.isArray(form.payslip_custom_fields) ? form.payslip_custom_fields : [];
  const setFields = next => set('payslip_custom_fields', next);
  const mode = form.payslip_watermark_mode || 'logo';
  const inputCls = 'border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]';

  return (
    <Section icon={<FileText size={16} className="text-[#3525cd]" />}
      title="Payslip Branding"
      subtitle="Template, company details and watermark used on every payslip and payslip PDF">

      {/* ── Templates ── */}
      <div>
        <p className="text-sm font-semibold text-[#151c27] mb-1">Template</p>
        <p className="text-[0.68rem] text-[#777587] mb-3">The selected template is used for the payslip page, print and the PDF emailed to employees.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PAYSLIP_TEMPLATE_LIST.map(t => {
            const active = (form.payslip_template || 'classic') === t.id;
            return (
              <button key={t.id} type="button" onClick={() => set('payslip_template', t.id)}
                className={cn('text-left rounded-xl border overflow-hidden transition-all',
                  active ? 'border-[#3525cd] ring-2 ring-[#3525cd]/20' : 'border-[#c7c4d8] hover:border-[#3525cd]/40')}>
                <div className="border-b border-[#e7eefe]">
                  <ScaledFrame html={htmlFor(t.id)} visibleHeight={190} />
                </div>
                <div className="px-3 py-2.5 flex items-start gap-2">
                  <span className={cn('mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0',
                    active ? 'bg-[#3525cd] border-[#3525cd]' : 'border-[#c7c4d8]')}>
                    {active && <Check size={10} className="text-white" />}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-[#151c27]">{t.label}</p>
                    <p className="text-[0.65rem] text-[#777587]">{t.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Company details ── */}
      <div className="border-t border-[#f0f3ff] pt-5 space-y-4">
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5">
          <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Leave a field blank to leave it off the payslip. If <strong>Registered</strong> / <strong>Corporate Office</strong> are blank, the
            <strong> Generic Address</strong> is shown instead. <strong>Company Full Name</strong> overrides the organisation name in the header.
          </p>
        </div>
        <TextField label="Company Full Name" hint="Legal name shown in bold in the payslip header. Blank = organisation name."
          value={form.payslip_company_fullname} onChange={v => set('payslip_company_fullname', v)} placeholder="e.g. Acme Technologies Pvt. Ltd." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Registered Office" rows={2} value={form.payslip_registered_address} onChange={v => set('payslip_registered_address', v)}
            placeholder={'Office No. 206, Dalal Street\nGift City, Gandhinagar'} />
          <TextField label="Corporate Office" rows={2} value={form.payslip_corporate_address} onChange={v => set('payslip_corporate_address', v)}
            placeholder={'2nd Floor, O Block, Mondeal Retail Park\nAhmedabad – 380059'} />
        </div>
        <TextField label="Contact Details" hint="Phone / email shown under the addresses."
          value={form.payslip_contact_details} onChange={v => set('payslip_contact_details', v)} placeholder="Office: +91 98765 43210  |  Mail: hr@company.in" />
        <TextField label="Generic Address (fallback)" rows={2} value={form.payslip_company_address} onChange={v => set('payslip_company_address', v)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="CIN / GST Number" value={form.payslip_company_cin} onChange={v => set('payslip_company_cin', v)} placeholder="CIN No.: U67120GJ2012PTC116832" />
          <TextField label="Registration Number" value={form.payslip_company_registration} onChange={v => set('payslip_company_registration', v)} placeholder="SEBI Reg: INZ000242435" />
          <TextField label="Company P.F. No." value={form.payslip_company_pf_no} onChange={v => set('payslip_company_pf_no', v)} placeholder="GJAHM0001234000" />
          <TextField label="Company ESI No." value={form.payslip_company_esic_no} onChange={v => set('payslip_company_esic_no', v)} placeholder="37001945660000999" />
        </div>
        <TextField label="Payslip Footer Note" hint="Blank = the standard computer-generated note."
          value={form.payslip_footer_note} onChange={v => set('payslip_footer_note', v)} placeholder="This is a computer generated salary slip and does not require a signature." />
      </div>

      {/* ── Custom fields ── */}
      <div className="border-t border-[#f0f3ff] pt-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-semibold text-[#151c27]">Additional Company Details</p>
          <button type="button" disabled={fields.length >= 12}
            onClick={() => setFields([...fields, { label: '', value: '', position: 'header' }])}
            className="flex items-center gap-1 text-xs font-bold text-[#3525cd] px-2.5 py-1.5 rounded-lg border border-[#c7c4d8] hover:bg-[#f0f3ff] disabled:opacity-40">
            <Plus size={12} /> Add field
          </button>
        </div>
        <p className="text-[0.68rem] text-[#777587] mb-3">Any extra line you want printed (e.g. GSTIN, TAN, branch code) and where it should appear.</p>
        {fields.length === 0
          ? <p className="text-xs text-[#9ca3af] border border-dashed border-[#c7c4d8] rounded-lg px-3 py-4 text-center">No additional fields.</p>
          : (
            <div className="space-y-2">
              {fields.map((f, i) => {
                const upd = patch => setFields(fields.map((x, j) => j === i ? { ...x, ...patch } : x));
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className={`${inputCls} col-span-12 sm:col-span-3`} placeholder="Label (e.g. GSTIN)" maxLength={60} value={f.label} onChange={e => upd({ label: e.target.value })} />
                    <input className={`${inputCls} col-span-12 sm:col-span-4`} placeholder="Value" maxLength={300} value={f.value} onChange={e => upd({ value: e.target.value })} />
                    <select className={`${inputCls} bg-white col-span-10 sm:col-span-4`} value={f.position} onChange={e => upd({ position: e.target.value })}>
                      {CUSTOM_FIELD_POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                    <button type="button" onClick={() => setFields(fields.filter((_, j) => j !== i))} title="Remove"
                      className="col-span-2 sm:col-span-1 h-9 rounded-lg border border-[#c7c4d8] text-[#9ca3af] hover:text-rose-500 hover:border-rose-300 flex items-center justify-center">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* ── Watermark ── */}
      <div className="border-t border-[#f0f3ff] pt-5">
        <p className="text-sm font-semibold text-[#151c27] mb-1">Watermark</p>
        <p className="text-[0.68rem] text-[#777587] mb-3">Faint mark behind the payslip content.</p>
        <div className="flex gap-2 flex-wrap">
          {[['logo', 'Company logo'], ['text', 'Text'], ['none', 'None']].map(([v, l]) => (
            <button key={v} type="button" onClick={() => set('payslip_watermark_mode', v)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all',
                mode === v ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40')}>{l}</button>
          ))}
        </div>
        {mode === 'text' && (
          <div className="mt-3 max-w-sm">
            <input className={`${inputCls} w-full`} maxLength={40} placeholder="e.g. CONFIDENTIAL"
              value={form.payslip_watermark_text || ''} onChange={e => set('payslip_watermark_text', e.target.value)} />
            <p className="text-[0.65rem] text-[#9ca3af] mt-1">Up to 40 characters, drawn diagonally across the page.</p>
          </div>
        )}
      </div>

      {/* ── Live preview ── */}
      <div className="border-t border-[#f0f3ff] pt-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
          <p className="text-sm font-semibold text-[#151c27]">Preview</p>
          <p className="text-[0.65rem] text-[#777587]">
            {latest ? `Using the latest payslip (${latest.name}). Bank, PAN and PF numbers are sample values.` : 'Using sample data — no payslip generated yet.'}
            {' '}Reflects unsaved changes.
          </p>
        </div>
        <div className="border border-[#c7c4d8] rounded-xl overflow-hidden bg-[#f8f9ff] p-3">
          <div className="shadow-sm bg-white mx-auto" style={{ maxWidth: 820 }}>
            <ScaledFrame html={selectedHtml} />
          </div>
        </div>
      </div>
    </Section>
  );
}
