/**
 * PayslipRelitrade.jsx — Payslip modal used in the Relitrade portal.
 *
 * Identical layout to Payslip.jsx but uses separate React Query keys to avoid
 * cache collisions when both components are mounted in the same session.
 *
 * All company details (name, logo, registered/corporate address, contact) come
 * from the org's own payroll_settings — nothing is hardcoded for Relitrade.
 * Other organisations that use this component will automatically see their own
 * configured details.
 */
import React, { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useOrgSettings, usePayrollSettings } from '@/hooks/useReferenceData';
import { MONTHS } from '@/lib/utils';

const num    = n => Number(n || 0);
const fmtAmt = n =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Number to words (Indian system) ──────────────────────────────────────────
function toWords(amount) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
    'Seventeen','Eighteen','Nineteen'];
  const tens  = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

  function convert(n) {
    if (n < 20)       return ones[n];
    if (n < 100)      return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000)     return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000)   return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }

  const rupees = Math.floor(amount);
  const paise  = Math.round((amount - rupees) * 100);
  let words    = 'Rupees ' + (rupees > 0 ? convert(rupees) : 'Zero');
  if (paise > 0) words += ' and ' + convert(paise) + ' Paise';
  return words + ' Only';
}

// ── Build right-side company header HTML ─────────────────────────────────────
// Uses structured fields (Registered/Corporate office, contact) when configured;
// falls back gracefully to generic address block for orgs that haven't set them.
// Every element uses display:block explicitly — print popup CSS resets can strip
// default block behaviour from generic element selectors.
function buildOrgHeaderHtml(ps, orgName) {
  const displayName    = ps?.payslip_company_fullname  || orgName || '';
  const cin            = ps?.payslip_company_cin        || '';
  const registeredAddr = ps?.payslip_registered_address || '';
  const corporateAddr  = ps?.payslip_corporate_address  || '';
  const contactDetails = ps?.payslip_contact_details    || '';
  const genericAddress = ps?.payslip_company_address    || '';

  // Block-level elements with explicit display:block so print-CSS resets can't
  // inadvertently collapse them to inline.
  const B = (style, text) => `<div style="display:block;${style}">${text}</div>`;

  let html = displayName ? B('font-size:12px;font-weight:bold;line-height:1.5', displayName) : '';

  if (cin) html += B('font-size:9px;color:#444;line-height:1.4;margin-top:2px', cin);

  if (registeredAddr || corporateAddr || contactDetails) {
    if (registeredAddr) {
      html += B('font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px', 'Registered Office');
      registeredAddr.split('\n').forEach(line => {
        html += B('font-size:8px;color:#444;line-height:1.4', line.trim());
      });
    }
    if (corporateAddr) {
      html += B('font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px', 'Corporate Office');
      corporateAddr.split('\n').forEach(line => {
        html += B('font-size:8px;color:#444;line-height:1.4', line.trim());
      });
    }
    if (contactDetails) {
      html += B('font-size:8px;color:#444;line-height:1.4;margin-top:5px', contactDetails);
    }
  } else if (genericAddress) {
    genericAddress.split('\n').forEach(line => {
      html += B('font-size:9px;color:#444;line-height:1.4', line.trim());
    });
  }

  return html;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PayslipRelitrade({ payslipId, onClose }) {
  const printRef = useRef(null);

  // ── Data fetching ─────────────────────────────────────────────────────────
  const { data: slip, isLoading } = useQuery({
    queryKey: ['payslip-relitrade', payslipId],
    queryFn:  () => apiGet(`/payroll/payslips/${payslipId}/details`),
    enabled:  Boolean(payslipId),
  });

  const { data: orgSettings, isFetched: orgFetched } = useOrgSettings({ staleTime: 5 * 60 * 1000 });

  const { data: payrollSettings } = usePayrollSettings({ staleTime: 5 * 60 * 1000 });

  const { data: statutory } = useQuery({
    queryKey: ['emp-statutory-relitrade', slip?.user_id],
    queryFn:  () => apiGet(`/profile/${slip.user_id}/statutory`),
    enabled:  !!slip?.user_id,
  });

  const { data: bankingData } = useQuery({
    queryKey: ['emp-banking-relitrade', slip?.user_id],
    queryFn:  () => apiGet(`/profile/${slip.user_id}/banking`),
    enabled:  !!slip?.user_id,
  });
  const banking = Array.isArray(bankingData) ? bankingData[0] : bankingData;

  const { data: leaveBalanceData } = useQuery({
    queryKey: ['emp-leave-balance-relitrade', slip?.user_id],
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
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:Arial,sans-serif;font-size:10px;color:#000;background:#fff}
        .payslip{max-width:800px;margin:10px auto;padding:20px;border:1px solid #ccc}
        table{width:100%;border-collapse:collapse;font-size:9.5px}
        th,td{border:1px solid #aaa;padding:4px 10px}
        th{background:#e8e8e8;font-weight:bold;text-align:left}
        .tright{text-align:right}
        .bold{font-weight:bold}
        .bg{background:#f0f0f0}
        .note{font-size:8px;text-align:center;margin-top:12px;color:#555;border-top:1px solid #ddd;padding-top:6px}
        @page{size:A4;margin:10mm}
        @media print{body{-webkit-print-color-adjust:exact}}
      </style></head><body>${content}</body></html>`);
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

  // ── Computed values ───────────────────────────────────────────────────────
  const monthNum   = typeof slip.month === 'string' ? parseInt(slip.month, 10) : num(slip.month);
  const monthLabel = MONTHS[monthNum - 1] || slip.month;

  const earningRows = [
    { label: 'Basic',             value: num(slip.basic) },
    { label: 'HRA',               value: num(slip.hra) },
    { label: 'DA',                value: num(slip.da) },
    { label: 'Conveyance',        value: num(slip.transport_allowance) },
    { label: 'Medical Allowance', value: num(slip.medical_allowance) },
    { label: 'Special Allowance', value: num(slip.special_allowance || 0) || num(slip.other_allowances || 0) },
  ].filter(r => r.value > 0);

  const deductionRows = [
    { label: 'PF (Employee)',    value: num(slip.pf_employee) },
    { label: 'ESI (Employee)',   value: num(slip.esi_employee) },
    { label: 'PT',               value: num(slip.professional_tax) },
    { label: 'TDS',              value: num(slip.tds) },
    { label: 'Retention',        value: num(slip.retention) },
    { label: 'Other Deductions', value: num(slip.other_deductions) },
    { label: `LOP (${num(slip.lop_days)} day${num(slip.lop_days) === 1 ? '' : 's'})`,
      value: num(slip.lop_amount) },
  ].filter(r => r.value > 0);

  const maxRows     = Math.max(earningRows.length, deductionRows.length);
  const grossSalary = num(slip.gross_salary);
  const totalDed    = num(slip.total_deductions);
  const netSalary   = num(slip.net_salary);

  const pan       = statutory?.pan_number   || 'N/A';
  const uan       = statutory?.uan_no        || 'N/A';
  const esiNo     = statutory?.esi_no        || 'N/A';
  const pfNo      = statutory?.pf_no         || 'N/A';
  const bankName  = banking?.bank_name        || 'N/A';
  const accNo     = banking?.account_number   || '';
  const maskedAcc = accNo
    ? accNo.slice(0, -4).replace(/\d/g, '*') + accNo.slice(-4)
    : 'N/A';

  let attSnap = {};
  try {
    attSnap = typeof slip.attendance_snapshot === 'string'
      ? JSON.parse(slip.attendance_snapshot)
      : (slip.attendance_snapshot || {});
  } catch {}

  const presentFull  = attSnap.presentFull  ?? num(slip.present_days);
  const presentHalf  = attSnap.presentHalf  ?? 0;
  const weekoff      = attSnap.weekoff      ?? 0;
  const paidHoliday  = attSnap.holiday      ?? 0;
  const paidLeave    = attSnap.paidLeave    ?? num(slip.leave_days);
  const lopDays      = num(slip.lop_days);
  // working_days = all non-weekend days (holidays included). weekoff = weekend days.
  // working_days + weekoff = total calendar days. paidHoliday must NOT be added again.
  const totalCalDays = num(slip.working_days) + weekoff;
  const presentStr   = (presentFull + presentHalf * 0.5).toFixed(presentHalf ? 1 : 0);

  const orgName     = orgSettings?.name || '';
  const footerNote  = payrollSettings?.payslip_footer_note ||
    'This is a computer generated salary slip and does not require a signature.';
  const orgLogoUrl  = orgSettings?.logo_url
    || (typeof window !== 'undefined' ? `${window.location.origin}/LogoWithoutName.svg` : '/LogoWithoutName.svg');
  const companyPfNo  = payrollSettings?.payslip_company_pf_no   || '';
  const companyEsiNo = payrollSettings?.payslip_company_esic_no || '';

  const orgHeaderHtml = buildOrgHeaderHtml(payrollSettings, orgName);

  // ── Print HTML (inline styles — must survive popup window) ───────────────
  const payslipHtml = `
  <div class="payslip" style="position:relative;overflow:hidden">
    <table style="border:none;margin-bottom:8px;width:100%;table-layout:fixed">
      <tr>
        <td style="border:none;padding:0;width:45%;vertical-align:top">
          <img src="${orgLogoUrl}" alt="${orgName}"
            style="max-width:200px;max-height:80px;object-fit:contain" />
        </td>
        <td style="border:none;padding:0;width:55%;text-align:center;vertical-align:top;word-break:break-word;overflow-wrap:break-word">
          ${orgHeaderHtml || `<div style="display:block;font-size:12px;font-weight:bold">${orgName || 'Organization'}</div>`}
        </td>
      </tr>
    </table>

    <div style="text-align:center;font-weight:bold;font-size:11px;border-top:1px solid #999;border-bottom:1px solid #999;padding:4px 0;margin:8px 0">
      Salary Slip for the Month of ${monthLabel} ${slip.year}
    </div>

    <table style="border:none;margin-bottom:8px;font-size:9.5px">
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:15%">Employee ID</td>
        <td style="border:none;padding:2px 4px;width:35%">: ${slip.employee_id || slip.user_id}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:18%">Company P.F. No</td>
        <td style="border:none;padding:2px 4px">${companyPfNo ? ': ' + companyPfNo : ''}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Employee Name</td>
        <td style="border:none;padding:2px 4px">: ${slip.name}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Company ESI No</td>
        <td style="border:none;padding:2px 4px">${companyEsiNo ? ': ' + companyEsiNo : ''}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Designation</td>
        <td style="border:none;padding:2px 4px">: ${slip.position || '—'}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">P.F. No</td>
        <td style="border:none;padding:2px 4px">: ${pfNo}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Department</td>
        <td style="border:none;padding:2px 4px">: ${slip.department || '—'}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">ESI No.</td>
        <td style="border:none;padding:2px 4px">: ${esiNo}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank Name</td>
        <td style="border:none;padding:2px 4px">: ${bankName}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">PAN No.</td>
        <td style="border:none;padding:2px 4px">: ${pan}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank A/c No.</td>
        <td style="border:none;padding:2px 4px">: ${maskedAcc}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Attendance</td>
        <td style="border:none;padding:2px 4px">: ${totalCalDays} out of ${totalCalDays}</td>
      </tr>
    </table>

    <table>
      <thead>
        <tr>
          <th style="width:25%">Actuals</th>
          <th style="width:12%;text-align:right">Amount(Rs)</th>
          <th style="width:25%">Earnings</th>
          <th style="width:12%;text-align:right">Amount(Rs)</th>
          <th style="width:15%">Deductions</th>
          <th style="width:11%;text-align:right">Amount(Rs)</th>
        </tr>
      </thead>
      <tbody>
        ${Array.from({ length: maxRows }).map((_, i) => {
          const er = earningRows[i];
          const dr = deductionRows[i];
          return `<tr>
            <td>${er?.label || ''}</td>
            <td class="tright">${er ? fmtAmt(er.value) : ''}</td>
            <td>${er?.label || ''}</td>
            <td class="tright">${er ? fmtAmt(er.value) : ''}</td>
            <td>${dr?.label || ''}</td>
            <td class="tright">${dr ? fmtAmt(dr.value) : ''}</td>
          </tr>`;
        }).join('')}
      </tbody>
      <tfoot>
        <tr class="bg bold">
          <td>Total</td>
          <td class="tright">${fmtAmt(grossSalary)}</td>
          <td>Gross</td>
          <td class="tright">${fmtAmt(grossSalary)}</td>
          <td>Deduction</td>
          <td class="tright">${fmtAmt(totalDed)}</td>
        </tr>
        <tr>
          <td colspan="4" style="font-size:9px;font-style:italic;border-right:none">
            Amount in Words: ${toWords(netSalary)}
          </td>
          <td class="bold bg">Net Salary</td>
          <td class="tright bold">${fmtAmt(netSalary)}</td>
        </tr>
      </tfoot>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:8px;margin-top:6px;border-top:1px solid #ddd">
      <thead>
        <tr style="background:#f0f0f0">
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">P+OD</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">W/OFF</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">LWP/LOP</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">HL</th>
          <th style="border:1px solid #aaa;padding:2px 4px;text-align:center;font-weight:bold">CL</th>
          <th style="border:1px solid #aaa;padding:2px 8px;text-align:center;font-weight:bold">Available CL Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${(presentFull + presentHalf * 0.5).toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${weekoff.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${lopDays.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${paidHoliday.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 4px;text-align:center">${paidLeave.toFixed(2)}</td>
          <td style="border:1px solid #aaa;padding:2px 8px;text-align:center">${clBalance} Days</td>
        </tr>
      </tbody>
    </table>

    <div class="note">${footerNote}</div>
    <div style="text-align:center;font-size:7.5px;color:#aaa;margin-top:4px">HRMS by Lumos Logic</div>

    <!-- Company logo watermark — absolutely covers the full payslip area -->
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden">
      <img src="${orgLogoUrl}" alt="" style="width:680px;max-width:95%;object-fit:contain;opacity:0.13" />
    </div>
  </div>`;

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
