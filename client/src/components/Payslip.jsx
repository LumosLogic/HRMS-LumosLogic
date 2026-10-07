/**
 * Payslip.jsx — Common org-independent payslip component.
 *
 * All org-specific data is fetched dynamically:
 *   • Org name / logo   ← GET /org/settings           (organizations.name, logo_url)
 *   • Company details   ← GET /payroll/settings        (payslip_company_*, payslip_custom_fields)
 *   • Template / mark   ← GET /payroll/settings        (payslip_template, payslip_watermark_*)
 *
 * Payslip values come exclusively from the stored payslips snapshot — no
 * salary recalculation happens here. The HTML itself is built by lib/payslipHtml.js,
 * which the Payslip Branding preview shares, so the preview matches what is printed.
 */
import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useOrgSettings, usePayrollSettings } from '@/hooks/useReferenceData';
import { MONTHS } from '@/lib/utils';
import { buildPayslipHtml, PRINT_PAGE_CSS } from '@/lib/payslipHtml';

export default function Payslip({ payslipId, onClose }) {
  const printRef = useRef(null);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: slip, isLoading } = useQuery({
    queryKey: ['payslip-details', payslipId],
    queryFn:  () => apiGet(`/payroll/payslips/${payslipId}/details`),
    enabled:  Boolean(payslipId),
  });

  const { data: orgSettings, isFetched: orgFetched } = useOrgSettings({ staleTime: 5 * 60 * 1000 });

  const { data: payrollSettings } = usePayrollSettings({ staleTime: 5 * 60 * 1000 });

  const { data: statutory } = useQuery({
    queryKey: ['emp-statutory', slip?.user_id],
    queryFn:  () => apiGet(`/profile/${slip.user_id}/statutory`),
    enabled:  !!slip?.user_id,
  });

  const { data: bankingData } = useQuery({
    queryKey: ['emp-banking', slip?.user_id],
    queryFn:  () => apiGet(`/profile/${slip.user_id}/banking`),
    enabled:  !!slip?.user_id,
  });
  const banking = Array.isArray(bankingData) ? bankingData[0] : bankingData;

  const { data: leaveBalanceData } = useQuery({
    queryKey: ['emp-leave-balance-payslip', slip?.user_id],
    queryFn:  () => apiGet('/leaves/balance', { userId: slip.user_id }),
    enabled:  !!slip?.user_id,
    staleTime: 5 * 60 * 1000,
  });
  const clBalance = (() => {
    const balances = leaveBalanceData?.balances || [];
    const cl = balances.find(b => b.leave_type === 'casual' || b.label?.toLowerCase().includes('casual'));
    return cl ? cl.remaining.toFixed(2) : '0.00';
  })();

  // ── Print handler ─────────────────────────────────────────────────────────
  function handlePrint() {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    win.document.write(`<!DOCTYPE html><html><head><title>Payslip - ${slip?.name || ''}</title>
      <style>${PRINT_PAGE_CSS}</style></head><body>${content}</body></html>`);
    win.document.close();
    win.focus();
    const imgs = win.document.images;
    if (imgs.length === 0) { win.print(); win.close(); return; }
    let loaded = 0;
    const total = imgs.length;
    const done = () => { if (++loaded >= total) { win.print(); win.close(); } };
    Array.from(imgs).forEach(img => {
      if (img.complete) { done(); }
      else { img.onload = done; img.onerror = done; }
    });
  }

  if (isLoading || !orgFetched) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl p-8 flex items-center gap-3">
        <span className="w-5 h-5 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin" />
        <span className="text-sm text-[#464555]">Loading payslip…</span>
      </div>
    </div>
  );

  if (!slip) return null;

  const monthNum   = typeof slip.month === 'string' ? parseInt(slip.month, 10) : Number(slip.month || 0);
  const monthLabel = MONTHS[monthNum - 1] || slip.month;

  const orgName    = orgSettings?.name || '';
  const orgLogoUrl = orgSettings?.logo_url
    || (typeof window !== 'undefined' ? `${window.location.origin}/LogoWithoutName.svg` : '/LogoWithoutName.svg');

  const payslipHtml = buildPayslipHtml({
    slip, settings: payrollSettings, orgName, orgLogoUrl, statutory, banking, clBalance,
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.7)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-3 border-b border-[#e7eefe] flex-shrink-0">
          <div>
            <p className="font-black text-[#151c27] text-sm">Salary Slip — {slip.name}</p>
            <p className="text-xs text-[#777587]">{monthLabel} {slip.year}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-2 bg-[#3525cd] text-white rounded-xl text-xs font-bold hover:bg-[#2a1fb0] transition-colors">
              <Printer size={13} /> Print / Save PDF
            </button>
            <button onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center">
              <X size={16} className="text-[#777587]" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-4 bg-[#f8f9ff]">
          <div ref={printRef} className="bg-white shadow-sm"
            dangerouslySetInnerHTML={{ __html: payslipHtml }} />
        </div>
      </div>
    </div>
  );
}
