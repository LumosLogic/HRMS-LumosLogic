/**
 * payslipHtml.js — builds the payslip HTML used by the payslip viewer/print AND the branding preview,
 * so what the admin previews is exactly what is printed.
 *
 * Payslip values come from the stored payslip snapshot (`slip`); company details come from payroll settings.
 * The selected template (settings.payslip_template) only changes presentation.
 */
import { MONTHS } from '@/lib/utils';
import { getPayslipTemplate } from '@/lib/payslipTemplates';

const num    = n => Number(n || 0);
export const fmtAmt = n =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── Number to words (Indian system) ──────────────────────────────────────────
export function toWords(amount) {
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

const B = (style, text) => `<div style="display:block;${style}">${text}</div>`;

const customFieldsAt = (settings, pos) =>
  (Array.isArray(settings?.payslip_custom_fields) ? settings.payslip_custom_fields : [])
    .filter(f => f.position === pos && (f.label || f.value));

const customLine = f => `${esc(f.label)}${f.label && f.value ? ': ' : ''}${esc(f.value)}`;

// ── Right-side company header ────────────────────────────────────────────────
// Uses structured fields (Registered/Corporate office, contact) when configured;
// falls back to the generic address block. Every element is display:block explicitly —
// print popup CSS resets can strip default block behaviour from generic selectors.
export function buildOrgHeaderHtml(ps, orgName) {
  const displayName    = ps?.payslip_company_fullname  || orgName || '';
  const cin            = ps?.payslip_company_cin        || '';
  const registeredAddr = ps?.payslip_registered_address || '';
  const corporateAddr  = ps?.payslip_corporate_address  || '';
  const contactDetails = ps?.payslip_contact_details    || '';
  const genericAddress = ps?.payslip_company_address    || '';

  let html = displayName ? B('font-size:12px;font-weight:bold;line-height:1.5', esc(displayName)) : '';
  if (cin) html += B('font-size:9px;color:#444;line-height:1.4;margin-top:2px', esc(cin));

  if (registeredAddr || corporateAddr || contactDetails) {
    if (registeredAddr) {
      html += B('font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px', 'Registered Office');
      registeredAddr.split('\n').forEach(line => { html += B('font-size:8px;color:#444;line-height:1.4', esc(line.trim())); });
    }
    if (corporateAddr) {
      html += B('font-size:8px;color:#222;font-weight:bold;line-height:1.5;margin-top:5px', 'Corporate Office');
      corporateAddr.split('\n').forEach(line => { html += B('font-size:8px;color:#444;line-height:1.4', esc(line.trim())); });
    }
    if (contactDetails) html += B('font-size:8px;color:#444;line-height:1.4;margin-top:5px', esc(contactDetails));
  } else if (genericAddress) {
    genericAddress.split('\n').forEach(line => { html += B('font-size:9px;color:#444;line-height:1.4', esc(line.trim())); });
  }

  customFieldsAt(ps, 'header').forEach(f => { html += B('font-size:8px;color:#444;line-height:1.4;margin-top:2px', customLine(f)); });
  return html;
}

// Scoped to .payslip so it behaves identically in the page and in the print popup.
export function payslipCss(tpl) {
  return `
  .payslip{font-family:Arial,sans-serif;font-size:10px;color:#000}
  .payslip table{width:100%;border-collapse:collapse;font-size:9.5px}
  .payslip th,.payslip td{border:1px solid ${tpl.border};padding:4px 10px}
  .payslip th{background:${tpl.tableHead};color:${tpl.tableHeadText};font-weight:bold;text-align:left}
  .payslip .tright{text-align:right}
  .payslip .bold{font-weight:bold}
  .payslip .bg{background:${tpl.totals}}
  ${tpl.zebra ? `.payslip tbody tr:nth-child(even) td{background:${tpl.zebra}}` : ''}
  .payslip .note{font-size:8px;text-align:center;margin-top:12px;color:#555;border-top:1px solid #ddd;padding-top:6px}`;
}

/**
 * @param {object} d
 * @param {object} d.slip          payslip details row (/payroll/payslips/:id/details shape)
 * @param {object} d.settings      payroll_settings (branding fields + template)
 * @param {string} d.orgName
 * @param {string} d.orgLogoUrl
 * @param {object} d.statutory     { pan_number, uan_no, esi_no, pf_no }
 * @param {object} d.banking       { bank_name, account_number }
 * @param {string} d.clBalance
 */
export function buildPayslipHtml({ slip, settings, orgName, orgLogoUrl, statutory, banking, clBalance }) {
  const tpl = getPayslipTemplate(settings?.payslip_template);

  const monthNum   = typeof slip.month === 'string' ? parseInt(slip.month, 10) : num(slip.month);
  const monthLabel = MONTHS[monthNum - 1] || slip.month;

  const earningRows = [
    { label: 'Basic',             value: num(slip.basic) },
    { label: 'HRA',               value: num(slip.hra) },
    { label: 'DA',                value: num(slip.da) },
    { label: 'Conveyance',        value: num(slip.transport_allowance) },
    { label: 'Medical Allowance', value: num(slip.medical_allowance) },
    { label: 'Special Allowance', value: num(slip.special_allowance) },
    { label: 'Other Allowance',   value: num(slip.other_allowances) },
  ].filter(r => r.value > 0);

  const deductionRows = [
    { label: 'PF (Employee)',    value: num(slip.pf_employee) },
    { label: 'ESI (Employee)',   value: num(slip.esi_employee) },
    { label: 'PT',               value: num(slip.professional_tax) },
    { label: 'TDS',              value: num(slip.tds) },
    { label: 'Retention',        value: num(slip.retention) },
    { label: 'Other Deductions', value: num(slip.other_deductions) },
    { label: `LOP (${num(slip.lop_days)} day${num(slip.lop_days) === 1 ? '' : 's'})`, value: num(slip.lop_amount) },
  ].filter(r => r.value > 0);

  const maxRows     = Math.max(earningRows.length, deductionRows.length);
  const grossSalary = num(slip.gross_salary);
  const totalDed    = num(slip.total_deductions);
  const netSalary   = num(slip.net_salary);

  const pan       = statutory?.pan_number   || 'N/A';
  const esiNo     = statutory?.esi_no        || 'N/A';
  const pfNo      = statutory?.pf_no         || 'N/A';
  const bankName  = banking?.bank_name        || 'N/A';
  const accNo     = banking?.account_number   || '';
  const maskedAcc = accNo ? accNo.slice(0, -4).replace(/\d/g, '*') + accNo.slice(-4) : 'N/A';

  let attSnap = {};
  try {
    attSnap = typeof slip.attendance_snapshot === 'string'
      ? JSON.parse(slip.attendance_snapshot)
      : (slip.attendance_snapshot || {});
  } catch { /* snapshot is optional */ }

  const presentFull  = attSnap.presentFull  ?? num(slip.present_days);
  const presentHalf  = attSnap.presentHalf  ?? 0;
  const weekoff      = attSnap.weekoff      ?? 0;
  const paidHoliday  = attSnap.holiday      ?? 0;
  const paidLeave    = attSnap.paidLeave    ?? num(slip.leave_days);
  const lopDays      = num(slip.lop_days);
  // working_days = all non-weekend days (holidays included). weekoff = weekend days.
  // working_days + weekoff = total calendar days. paidHoliday must NOT be added again.
  const totalCalDays = num(slip.working_days) + weekoff;

  const footerNote   = settings?.payslip_footer_note ||
    'This is a computer generated salary slip and does not require a signature.';
  const companyPfNo  = settings?.payslip_company_pf_no  || '';
  const companyEsiNo = settings?.payslip_company_esic_no || '';
  const orgHeaderHtml = buildOrgHeaderHtml(settings, orgName);

  // Admin-defined company details for the employee block (two per row) and footer
  const infoExtra = customFieldsAt(settings, 'employee_info');
  const infoExtraRows = [];
  for (let i = 0; i < infoExtra.length; i += 2) {
    const a = infoExtra[i], b = infoExtra[i + 1];
    infoExtraRows.push(`<tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">${esc(a.label)}</td>
        <td style="border:none;padding:2px 4px">: ${esc(a.value)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">${b ? esc(b.label) : ''}</td>
        <td style="border:none;padding:2px 4px">${b ? ': ' + esc(b.value) : ''}</td>
      </tr>`);
  }
  const footerExtra = customFieldsAt(settings, 'footer')
    .map(f => `<div style="text-align:center;font-size:8px;color:#444;margin-top:4px">${customLine(f)}</div>`).join('');

  const mode = settings?.payslip_watermark_mode || 'logo';
  const watermark =
    mode === 'text' && settings?.payslip_watermark_text
      ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden">
           <div style="transform:rotate(-35deg);font-size:84px;font-weight:bold;letter-spacing:6px;white-space:nowrap;color:${tpl.accent};opacity:0.09">${esc(settings.payslip_watermark_text)}</div>
         </div>`
      : mode === 'logo'
        ? `<div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:flex;align-items:center;justify-content:center;overflow:hidden">
             <img src="${orgLogoUrl}" alt="" style="width:680px;max-width:95%;object-fit:contain;opacity:0.13" />
           </div>`
        : '';

  const titleStyle = tpl.titleBar === 'filled'
    ? `text-align:center;font-weight:bold;font-size:11px;background:${tpl.accent};color:${tpl.titleText};padding:5px 0;margin:8px 0`
    : 'text-align:center;font-weight:bold;font-size:11px;border-top:1px solid #999;border-bottom:1px solid #999;padding:4px 0;margin:8px 0';

  const th = c => `border:1px solid ${tpl.border};padding:2px 4px;text-align:center;font-weight:bold`;
  const td = (extra = '') => `border:1px solid ${tpl.border};padding:2px 4px;text-align:center;${extra}`;

  return `
  <style>${payslipCss(tpl)}</style>
  <div class="payslip" style="position:relative;overflow:hidden">
    <table style="border:none;margin-bottom:8px;width:100%;table-layout:fixed">
      <tr>
        <td style="border:none;padding:0;width:45%;vertical-align:top">
          <img src="${orgLogoUrl}" alt="${esc(orgName)}"
            style="max-width:200px;max-height:80px;object-fit:contain" />
        </td>
        <td style="border:none;padding:0;width:55%;text-align:center;vertical-align:top;word-break:break-word;overflow-wrap:break-word">
          ${orgHeaderHtml || `<div style="display:block;font-size:12px;font-weight:bold">${esc(orgName) || 'Organization'}</div>`}
        </td>
      </tr>
    </table>

    <div style="${titleStyle}">
      Salary Slip for the Month of ${monthLabel} ${slip.year}
    </div>

    <table style="border:none;margin-bottom:8px;font-size:9.5px">
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:15%">Employee ID</td>
        <td style="border:none;padding:2px 4px;width:35%">: ${esc(slip.employee_id || slip.user_id)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px;width:18%">Company P.F. No</td>
        <td style="border:none;padding:2px 4px">${companyPfNo ? ': ' + esc(companyPfNo) : ''}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Employee Name</td>
        <td style="border:none;padding:2px 4px">: ${esc(slip.name)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Company ESI No</td>
        <td style="border:none;padding:2px 4px">${companyEsiNo ? ': ' + esc(companyEsiNo) : ''}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Designation</td>
        <td style="border:none;padding:2px 4px">: ${esc(slip.position || '—')}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">P.F. No</td>
        <td style="border:none;padding:2px 4px">: ${esc(pfNo)}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Department</td>
        <td style="border:none;padding:2px 4px">: ${esc(slip.department || '—')}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">ESI No.</td>
        <td style="border:none;padding:2px 4px">: ${esc(esiNo)}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank Name</td>
        <td style="border:none;padding:2px 4px">: ${esc(bankName)}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">PAN No.</td>
        <td style="border:none;padding:2px 4px">: ${esc(pan)}</td>
      </tr>
      <tr>
        <td style="border:none;font-weight:bold;padding:2px 4px">Bank A/c No.</td>
        <td style="border:none;padding:2px 4px">: ${esc(maskedAcc || '—')}</td>
        <td style="border:none;font-weight:bold;padding:2px 4px">Attendance</td>
        <td style="border:none;padding:2px 4px">: ${totalCalDays} out of ${totalCalDays}</td>
      </tr>
      ${infoExtraRows.join('')}
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
        <tr style="background:${tpl.totals}">
          <th style="${th()};background:${tpl.totals};color:#000">P+OD</th>
          <th style="${th()};background:${tpl.totals};color:#000">W/OFF</th>
          <th style="${th()};background:${tpl.totals};color:#000">LWP/LOP</th>
          <th style="${th()};background:${tpl.totals};color:#000">HL</th>
          <th style="${th()};background:${tpl.totals};color:#000">CL</th>
          <th style="${th()};background:${tpl.totals};color:#000;padding:2px 8px">Available CL Balance</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${td()}">${(presentFull + presentHalf * 0.5).toFixed(2)}</td>
          <td style="${td()}">${weekoff.toFixed(2)}</td>
          <td style="${td()}">${lopDays.toFixed(2)}</td>
          <td style="${td()}">${paidHoliday.toFixed(2)}</td>
          <td style="${td()}">${paidLeave.toFixed(2)}</td>
          <td style="${td('padding:2px 8px')}">${clBalance} Days</td>
        </tr>
      </tbody>
    </table>

    ${footerExtra}
    <div class="note">${esc(footerNote)}</div>
    <div style="text-align:center;font-size:7.5px;color:#aaa;margin-top:4px">HRMS by Lumos Logic</div>

    ${watermark}
  </div>`;
}

// Page-level CSS for the print popup (the payslip's own CSS is inside the html itself).
export const PRINT_PAGE_CSS = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:10px;color:#000;background:#fff}
  .payslip{max-width:800px;margin:10px auto;padding:20px;border:1px solid #ccc}
  @page{size:A4;margin:10mm}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`;
