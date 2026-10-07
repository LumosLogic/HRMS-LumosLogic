'use strict';

const { pool }           = require('../config/db');
const { getTransporter } = require('./emailService');
const { getPayslipTemplate } = require('./payslipTemplates');

const CHUNK_SIZE     = parseInt(process.env.PAYROLL_EMAIL_CHUNK_SIZE     || '10', 10);
const CHUNK_DELAY_MS = parseInt(process.env.PAYROLL_EMAIL_CHUNK_DELAY_MS || '500', 10);
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmtINR(n) { return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }); }
function num(n) { return Number(n || 0); }
function fmtAmt(n) {
  return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toWords(amount) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
    'Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function convert(n) {
    if (n < 20)       return ones[n];
    if (n < 100)      return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
    if (n < 1000)     return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + convert(n%100) : '');
    if (n < 100000)   return convert(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + convert(n%1000) : '');
    if (n < 10000000) return convert(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + convert(n%100000) : '');
    return convert(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + convert(n%10000000) : '');
  }
  const rupees = Math.floor(amount);
  const paise  = Math.round((amount - rupees) * 100);
  let words    = 'Rupees ' + (rupees > 0 ? convert(rupees) : 'Zero');
  if (paise > 0) words += ' and ' + convert(paise) + ' Paise';
  return words + ' Only';
}

function getTransport() { return getTransporter(); }

// ─── Fetch org, statutory, banking data for rich PDF ─────────────────────────
async function fetchRichData(organizationId, userId, payslipId) {
  const [orgRes, psRes, statRes, bankRes, slipRes, clRes] = await Promise.all([
    pool.query('SELECT name, logo_url FROM organizations WHERE id = $1', [organizationId]),
    // SELECT * so branding columns that a given DB has not migrated yet are simply absent (→ defaults).
    pool.query('SELECT * FROM payroll_settings WHERE organization_id = $1', [organizationId]),
    pool.query(
      'SELECT pan_number, uan_no, esi_no, pf_no, position FROM users WHERE id = $1',
      [userId]
    ),
    pool.query(
      'SELECT bank_name, account_number FROM employee_bank_accounts WHERE employee_id = $1 AND is_active = true ORDER BY is_primary DESC LIMIT 1',
      [userId]
    ),
    payslipId
      ? pool.query('SELECT attendance_snapshot FROM payslips WHERE id = $1', [payslipId])
      : Promise.resolve({ rows: [] }),
    // CL (casual leave) remaining balance for this employee
    pool.query(`
      SELECT lp.annual_quota,
        COALESCE((SELECT SUM(lba.delta) FROM leave_balance_adjustments lba
                  WHERE lba.user_id = $1 AND lba.org_id = $2
                    AND lba.leave_type = lp.leave_type
                    AND lba.year = EXTRACT(YEAR FROM NOW())::int), 0) AS adj,
        COALESCE((SELECT SUM(CASE WHEN l.leave_time = 'half' THEN 0.5
                                  ELSE (l.end_date::date - l.start_date::date + 1)::numeric END)
                  FROM leaves l
                  WHERE l.user_id = $1 AND l.organization_id = $2
                    AND l.status = 'approved' AND l.leave_time != 'wfh'
                    AND l.leave_type = lp.leave_type), 0) AS used
      FROM leave_policies lp
      WHERE lp.organization_id = $2
        AND lp.active = true AND lp.annual_quota > 0
        AND (lp.leave_type ILIKE 'casual%' OR lp.label ILIKE '%casual%')
        AND (lp.branch_id IS NULL OR lp.branch_id = (SELECT u.branch_id FROM users u WHERE u.id = $1))
      ORDER BY (lp.branch_id IS NULL)
      LIMIT 1
    `, [userId, organizationId]).catch(() => ({ rows: [] })),
  ]);

  const accNo     = bankRes.rows[0]?.account_number || '';
  const maskedAcc = accNo ? accNo.slice(0, -4).replace(/\d/g, '*') + accNo.slice(-4) : '';

  const snapRaw = slipRes.rows[0]?.attendance_snapshot;
  let attSnap = {};
  try { attSnap = snapRaw ? (typeof snapRaw === 'string' ? JSON.parse(snapRaw) : snapRaw) : {}; } catch {}

  let logoBuffer = null;
  const logoUrl = orgRes.rows[0]?.logo_url;
  if (logoUrl) {
    try {
      const axios = require('axios');
      const r = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 5000 });
      logoBuffer = Buffer.from(r.data);
    } catch { /* logo is optional */ }
  }

  const ps = psRes.rows[0] || {};
  return {
    orgName:             orgRes.rows[0]?.name || '',
    logoBuffer,
    orgAddress:          ps.payslip_company_address    || '',
    orgCin:              ps.payslip_company_cin         || '',
    footerNote:          ps.payslip_footer_note         ||
      'This is a computer generated salary slip and does not require a signature.',
    companyFullname:     ps.payslip_company_fullname    || '',
    registeredAddress:   ps.payslip_registered_address  || '',
    corporateAddress:    ps.payslip_corporate_address   || '',
    contactDetails:      ps.payslip_contact_details     || '',
    companyPfNo:         ps.payslip_company_pf_no        || '',
    companyEsiNo:        ps.payslip_company_esic_no      || '',
    template:            ps.payslip_template             || 'classic',
    watermarkMode:       ps.payslip_watermark_mode       || 'logo',
    watermarkText:       ps.payslip_watermark_text       || '',
    customFields:        Array.isArray(ps.payslip_custom_fields) ? ps.payslip_custom_fields : [],
    pan:      statRes.rows[0]?.pan_number || 'N/A',
    clBalance: (() => {
      const r = clRes.rows[0];
      if (!r) return '0.00';
      return Math.max(0, Number(r.annual_quota) + Number(r.adj) - Number(r.used)).toFixed(2);
    })(),
    uan:      statRes.rows[0]?.uan_no     || 'N/A',
    esiNo:    statRes.rows[0]?.esi_no     || 'N/A',
    pfNo:     statRes.rows[0]?.pf_no      || 'N/A',
    bankName: bankRes.rows[0]?.bank_name  || 'N/A',
    maskedAcc: maskedAcc || 'N/A',
    position: statRes.rows[0]?.position   || '',
    attSnap,
  };
}

// ─── PDF generation — matches Payslip.jsx print layout ───────────────────────
async function generatePayslipPDF(payslip, employee, orgName, organizationId) {
  let PDFDocument;
  try { PDFDocument = require('pdfkit'); }
  catch { return null; }

  const monthNum   = typeof payslip.month === 'string' ? parseInt(payslip.month, 10) : num(payslip.month);
  const monthLabel = MONTHS[monthNum - 1] || String(payslip.month);
  const period     = `${monthLabel} ${payslip.year}`;

  // Rich data from DB (org logo, address, statutory, banking)
  let rich = {
    orgName, logoBuffer: null, orgAddress: '', orgCin: '',
    footerNote: 'This is a computer generated salary slip and does not require a signature.',
    pan: 'N/A', uan: 'N/A', esiNo: 'N/A', pfNo: 'N/A', bankName: 'N/A', maskedAcc: 'N/A', position: '', attSnap: {},
    template: 'classic', watermarkMode: 'logo', watermarkText: '', customFields: [],
  };
  const tpl = () => getPayslipTemplate(rich.template);
  if (organizationId && payslip.user_id) {
    try {
      rich = await fetchRichData(organizationId, payslip.user_id, payslip.payslip_id);
      if (!rich.orgName) rich.orgName = orgName;
    } catch (e) {
      console.warn('[PayrollEmail] fetchRichData failed:', e.message);
    }
  }

  const earningRows = [
    { label: 'Basic',             value: num(payslip.basic) },
    { label: 'HRA',               value: num(payslip.hra) },
    { label: 'DA',                value: num(payslip.da) },
    { label: 'Conveyance',        value: num(payslip.transport_allowance) },
    { label: 'Medical Allowance', value: num(payslip.medical_allowance) },
    { label: 'Special Allowance', value: num(payslip.special_allowance) },
    { label: 'Other Allowance',   value: num(payslip.other_allowances) },
  ].filter(r => r.value > 0);

  const deductionRows = [
    { label: 'PF (Employee)',    value: num(payslip.pf_employee) },
    { label: 'ESI (Employee)',   value: num(payslip.esi_employee) },
    { label: 'PT',               value: num(payslip.professional_tax) },
    { label: 'TDS',              value: num(payslip.tds) },
    { label: 'Retention',        value: num(payslip.retention) },
    { label: 'Other Deductions', value: num(payslip.other_deductions) },
    { label: `LOP (${num(payslip.lop_days)} days)`, value: num(payslip.lop_amount) },
  ].filter(r => r.value > 0);

  const grossSalary = num(payslip.gross_salary);
  const totalDed    = num(payslip.total_deductions);
  const netSalary   = num(payslip.net_salary);
  const maxRows     = Math.max(earningRows.length, deductionRows.length, 1);

  const attSnap      = rich.attSnap;
  const presentFull  = attSnap.presentFull ?? num(payslip.present_days);
  const presentHalf  = attSnap.presentHalf ?? 0;
  const weekoff      = attSnap.weekoff     ?? 0;
  const paidHoliday  = attSnap.holiday     ?? 0;
  const paidLeave    = attSnap.paidLeave   ?? num(payslip.leave_days || 0);
  const lopDays      = num(payslip.lop_days);
  // working_days = all non-weekend days (including holidays); adding weekoff gives total calendar days.
  // paidHoliday must NOT be added again — it is already counted in working_days.
  const totalCalDays = num(payslip.working_days) + weekoff;
  const presentStr   = (presentFull + presentHalf * 0.5).toFixed(presentHalf ? 1 : 0);

  const empId   = employee.employee_id || payslip.user_id || '';
  const empName = employee.name || '';
  const dept    = employee.department || '';
  const pos     = rich.position || employee.position || '—';

  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: true });
    doc.on('data',  c => chunks.push(c));
    doc.on('end',   () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L   = 30;       // left margin
    const W   = 535;      // usable width
    const R   = L + W;    // right edge

    const T = tpl();
    const customAt = pos => (rich.customFields || []).filter(f => f.position === pos && (f.label || f.value));

    // ── Watermark: drawn FIRST so all content renders on top ───────────────────
    // 'text' → admin-defined diagonal text, 'none' → nothing, 'logo' (default) → company logo.
    if (rich.watermarkMode === 'text' && rich.watermarkText) {
      try {
        doc.save();
        doc.opacity(0.1);
        doc.fillColor(T.accent).font('Helvetica-Bold').fontSize(64);
        doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.text(rich.watermarkText, 0, doc.page.height / 2 - 32, { width: doc.page.width, align: 'center', lineBreak: false });
        doc.restore();
      } catch {}
    } else if (rich.watermarkMode !== 'none' && rich.watermarkMode !== 'text' && rich.logoBuffer) {
      try {
        doc.save();
        doc.opacity(0.13);
        const wmW = 480;
        const wmH = 280;
        const wmX = L + (W - wmW) / 2;
        const wmY = (doc.page.height - wmH) / 2;
        doc.image(rich.logoBuffer, wmX, wmY, { fit: [wmW, wmH] });
        doc.restore();
      } catch {}
    }

    // ── Header: logo left (slightly larger), company info starts at page midpoint ─
    if (rich.logoBuffer) {
      try { doc.image(rich.logoBuffer, L, 30, { fit: [150, 70] }); } catch {}
    }
    let ry = 30;

    // Company name and all address lines start at AX (≈45% from left = page midpoint)
    // and are CENTER-ALIGNED within the right half.
    const AX = L + Math.floor(W * 0.45); // x-start: ~45% from left edge
    const AW = R - AX;                    // width: remaining right portion

    const headerName = rich.companyFullname || rich.orgName;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
       .text(headerName, AX, ry, { width: AW, align: 'center' });
    // Use doc.y after every text() call — pdfkit sets it to the actual bottom
    // of the last rendered line, so we always advance past wrapped content.
    ry = doc.y + 2;

    if (rich.orgCin) {
      doc.font('Helvetica').fontSize(8).fillColor('#444')
         .text(rich.orgCin, AX, ry, { width: AW, align: 'center' });
      ry = doc.y + 2;
    }

    // Structured fields (Registered Office / Corporate Office / Contact)
    if (rich.registeredAddress || rich.corporateAddress || rich.contactDetails) {
      if (rich.registeredAddress) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#222')
           .text('Registered Office', AX, ry, { width: AW, align: 'center' });
        ry = doc.y + 1;
        doc.font('Helvetica').fontSize(7.5).fillColor('#444')
           .text(rich.registeredAddress.trim(), AX, ry, { width: AW, align: 'center' });
        ry = doc.y + 3;
      }
      if (rich.corporateAddress) {
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#222')
           .text('Corporate Office', AX, ry, { width: AW, align: 'center' });
        ry = doc.y + 1;
        doc.font('Helvetica').fontSize(7.5).fillColor('#444')
           .text(rich.corporateAddress.trim(), AX, ry, { width: AW, align: 'center' });
        ry = doc.y + 3;
      }
      if (rich.contactDetails) {
        doc.font('Helvetica').fontSize(7.5).fillColor('#444')
           .text(rich.contactDetails, AX, ry, { width: AW, align: 'center' });
        ry = doc.y + 2;
      }
    } else if (rich.orgAddress) {
      // Fallback: generic address lines, centered within right half
      rich.orgAddress.split('\n').forEach(line => {
        doc.font('Helvetica').fontSize(8).fillColor('#444')
           .text(line.trim(), AX, ry, { width: AW, align: 'center' });
        ry = doc.y + 1;
      });
    }

    // Admin-defined company details placed in the header
    customAt('header').forEach(f => {
      doc.font('Helvetica').fontSize(7.5).fillColor('#444')
         .text(`${f.label}${f.label && f.value ? ': ' : ''}${f.value}`, AX, ry, { width: AW, align: 'center' });
      ry = doc.y + 1;
    });

    let y = Math.max(ry + 4, 88);

    // ── Title bar ─────────────────────────────────────────────────────────
    if (T.titleBar === 'filled') {
      doc.rect(L, y, W, 18).fillColor(T.accent).fill();
      doc.font('Helvetica-Bold').fontSize(10).fillColor(T.titleText)
         .text(`Salary Slip for the Month of ${period}`, L, y + 4, { width: W, align: 'center' });
      y += 18 + 8;
    } else {
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor('#999').stroke();
      y += 3;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#000')
         .text(`Salary Slip for the Month of ${period}`, L, y, { width: W, align: 'center' });
      y += 14;
      doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor('#999').stroke();
      y += 8;
    }

    // ── Employee info (4 columns, no borders) ─────────────────────────────
    const ic1 = L,       iw1 = 92;
    const ic2 = ic1+iw1, iw2 = 155;
    const ic3 = ic2+iw2, iw3 = 110;
    const ic4 = ic3+iw3;

    function infoRow(l1, v1, l2, v2) {
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000').text(l1, ic1, y, { width: iw1 });
      doc.font('Helvetica').fontSize(8.5).text(': ' + (v1 || ''), ic2, y, { width: iw2 });
      doc.font('Helvetica-Bold').fontSize(8.5).text(l2, ic3, y, { width: iw3 });
      doc.font('Helvetica').fontSize(8.5).text(v2 ? ': ' + v2 : '', ic4, y, { width: R - ic4 });
      y += 13;
    }

    infoRow('Employee ID',   String(empId),           'Company P.F. No', rich.companyPfNo);
    infoRow('Employee Name', empName,                 'Company ESI No',  rich.companyEsiNo);
    infoRow('Designation',   pos,                     'P.F. No',         rich.pfNo);
    infoRow('Department',    dept || '—',             'ESI No.',         rich.esiNo);
    infoRow('Bank Name',     rich.bankName,   'PAN No.',    rich.pan);
    infoRow('Bank A/c No.', rich.maskedAcc,  'Attendance', `${totalCalDays} out of ${totalCalDays}`);
    const infoExtra = customAt('employee_info');
    for (let i = 0; i < infoExtra.length; i += 2) {
      const a = infoExtra[i], b = infoExtra[i + 1];
      infoRow(a.label, a.value, b ? b.label : '', b ? b.value : '');
    }
    y += 4;

    // ── Salary table ──────────────────────────────────────────────────────
    // Columns: Actuals | Amt | Earnings | Amt | Deductions | Amt
    const tc = [L, L+120, L+188, L+308, L+376, L+471];
    const tw = [120, 68, 120, 68, 95, R - (L+471)];
    const rH = 14;
    const hH = 16;

    function tableRect(row, col, h, fill) {
      if (fill) doc.rect(tc[col], row, tw[col], h).fillColor(fill).fill();
      doc.rect(tc[col], row, tw[col], h).strokeColor(T.border).lineWidth(0.4).stroke();
    }

    function allCols(row, h, fill) {
      tw.forEach((_, i) => tableRect(row, i, h, fill));
    }

    function cellText(text, col, row, h, align, bold, color) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(color || '#000')
         .text(text, tc[col] + 5, row + (h - 9) / 2, { width: tw[col] - 10, align: align || 'left', lineBreak: false });
    }

    // Header row
    allCols(y, hH, T.tableHead);
    ['Actuals','Amount(Rs)','Earnings','Amount(Rs)','Deductions','Amount(Rs)'].forEach((h, i) => {
      cellText(h, i, y, hH, i % 2 === 1 ? 'right' : 'left', true, T.tableHeadText);
    });
    y += hH;

    // Data rows
    for (let i = 0; i < maxRows; i++) {
      const er = earningRows[i];
      const dr = deductionRows[i];
      allCols(y, rH, T.zebra && i % 2 === 1 ? T.zebra : null);
      if (er) {
        cellText(er.label,          0, y, rH, 'left');
        cellText(fmtAmt(er.value),  1, y, rH, 'right');
        cellText(er.label,          2, y, rH, 'left');
        cellText(fmtAmt(er.value),  3, y, rH, 'right');
      }
      if (dr) {
        cellText(dr.label,          4, y, rH, 'left');
        cellText(fmtAmt(dr.value),  5, y, rH, 'right');
      }
      y += rH;
    }

    // Totals row
    allCols(y, rH, T.totals);
    [['Total',fmtAmt(grossSalary),'Gross',fmtAmt(grossSalary),'Deduction',fmtAmt(totalDed)]].forEach(row => {
      row.forEach((v, i) => cellText(v, i, y, rH, i % 2 === 1 ? 'right' : 'left', true));
    });
    y += rH;

    // Net salary + amount in words row
    // Columns 0-3 are a single merged cell (no internal borders) for the words text.
    // Columns 4 and 5 are individual cells for Net Salary label and value.
    const nH = 18;
    const mergedW = tc[4] - tc[0];  // width of merged cols 0-3
    doc.rect(tc[0], y, mergedW, nH).strokeColor(T.border).lineWidth(0.4).stroke();
    tableRect(y, 4, nH, null);
    tableRect(y, 5, nH, null);
    doc.font('Helvetica').fontSize(7.5).fillColor('#000')
       .text('Amount in Words: ' + toWords(netSalary), tc[0] + 5, y + (nH - 8) / 2, { width: mergedW - 10, lineBreak: false });
    cellText('Net Salary',      4, y, nH, 'left',  true);
    cellText(fmtAmt(netSalary), 5, y, nH, 'right', true);
    y += nH + 6;

    // ── Attendance summary — 6-column table (5 att cols + CL balance) ────────
    const attCols = [
      { label: 'P+OD',                value: (presentFull + presentHalf * 0.5).toFixed(2) },
      { label: 'W/OFF',               value: weekoff.toFixed(2) },
      { label: 'LWP/LOP',             value: lopDays.toFixed(2) },
      { label: 'HL',                  value: paidHoliday.toFixed(2) },
      { label: 'CL',                  value: paidLeave.toFixed(2) },
      { label: 'Available CL Balance', value: `${rich.clBalance} Days`, wide: true },
    ];
    // The last column (CL Balance) is given 1.8× the width of other columns
    const regularCols  = attCols.length - 1;
    const wideWeight   = 1.8;
    const totalWeights = regularCols + wideWeight;
    const unitW        = W / totalWeights;
    const colWidths    = attCols.map((_, i) => i < regularCols ? unitW : unitW * wideWeight);
    const colX         = colWidths.reduce((acc, w, i) => {
      acc.push(i === 0 ? L : acc[i - 1] + colWidths[i - 1]);
      return acc;
    }, []);

    const attHdr = 12;
    const attRow = 12;

    // Header row
    doc.rect(L, y, W, attHdr).fillColor('#f0f0f0').fill();
    doc.rect(L, y, W, attHdr).strokeColor('#aaa').lineWidth(0.4).stroke();
    attCols.forEach((col, i) => {
      if (i > 0) doc.moveTo(colX[i], y).lineTo(colX[i], y + attHdr).strokeColor('#aaa').lineWidth(0.3).stroke();
      doc.font('Helvetica-Bold').fontSize(7).fillColor('#000')
         .text(col.label, colX[i] + 1, y + (attHdr - 7) / 2,
               { width: colWidths[i] - 2, align: 'center', lineBreak: false });
    });
    y += attHdr;

    // Value row
    doc.rect(L, y, W, attRow).strokeColor('#aaa').lineWidth(0.4).stroke();
    attCols.forEach((col, i) => {
      if (i > 0) doc.moveTo(colX[i], y).lineTo(colX[i], y + attRow).strokeColor('#aaa').lineWidth(0.3).stroke();
      doc.font('Helvetica').fontSize(7.5).fillColor('#000')
         .text(col.value, colX[i] + 1, y + (attRow - 7) / 2,
               { width: colWidths[i] - 2, align: 'center', lineBreak: false });
    });
    y += attRow + 4;

    // ── Footer ────────────────────────────────────────────────────────────
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.5).strokeColor('#ddd').stroke();
    y += 5;
    customAt('footer').forEach(f => {
      doc.font('Helvetica').fontSize(7.5).fillColor('#444')
         .text(`${f.label}${f.label && f.value ? ': ' : ''}${f.value}`, L, y, { width: W, align: 'center' });
      y = doc.y + 2;
    });
    doc.font('Helvetica').fontSize(7.5).fillColor('#555')
       .text(rich.footerNote, L, y, { width: W, align: 'center' });
    y += 11;
    doc.font('Helvetica').fontSize(7).fillColor('#aaa')
       .text('HRMS by Lumos Logic', L, y, { width: W, align: 'center' });

    doc.end();
  });
}

// ─── HTML email body — matches HRMS branded template ─────────────────────────
function payslipEmailHtml(payslip, employee, orgName, period) {
  const row = (label, value) => `
    <tr>
      <td style="width:38%;padding:10px 14px;border-bottom:1px solid #e8eaf6;border-right:1px solid #e8eaf6;background:#f7f8ff;vertical-align:middle;">
        <span style="font-size:11px;font-weight:700;color:#777;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;">${label}</span>
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #e8eaf6;font-size:14px;font-weight:700;color:#1e1456;vertical-align:middle;font-family:Arial,sans-serif;">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:16px 8px;background:#eef0f8;font-family:Arial,Helvetica,sans-serif;">
<div style="max-width:680px;margin:0 auto;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#3525cd 0%,#5a3ce8 100%);padding:20px 28px 18px;border-radius:10px 10px 0 0;">
    <div style="margin-bottom:12px;">
      <div style="background:rgba(255,255,255,0.18);border-radius:8px;padding:5px 11px;display:inline-block;margin-bottom:6px;">
        <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:3px;color:rgba(255,255,255,0.85);font-family:Arial,sans-serif;">HRMS</span>
      </div>
      <div style="font-size:14px;font-weight:700;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;">${orgName}</div>
    </div>
    <h2 style="margin:0 0 4px;font-size:20px;font-weight:800;color:#ffffff;font-family:Arial,sans-serif;">Your Payslip</h2>
    <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.75);font-family:Arial,sans-serif;">Salary statement for ${period}</p>
  </div>

  <!-- Body -->
  <div style="background:#ffffff;padding:24px 28px;font-family:Arial,sans-serif;color:#1e293b;border-left:1px solid #dde1f0;border-right:1px solid #dde1f0;">
    <p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#1e1456;font-family:Arial,sans-serif;">Hello ${employee.name},</p>
    <p style="margin:0 0 20px;font-size:14px;color:#334155;line-height:1.7;font-family:Arial,sans-serif;">
      Your payslip for <strong>${period}</strong> has been generated. Please find the detailed salary slip attached as a PDF.
    </p>

    <!-- Salary summary table -->
    <div style="border:1px solid #e8eaf6;border-radius:8px;overflow:hidden;margin:0 0 20px;">
      <table style="width:100%;border-collapse:collapse;">
        ${row('Gross Salary',     fmtINR(payslip.gross_salary))}
        ${row('Total Deductions', '<span style="color:#e53e3e;">' + fmtINR(payslip.total_deductions) + '</span>')}
        <tr style="background:#f0f3ff;border-top:2px solid #3525cd;">
          <td style="width:38%;padding:12px 14px;border-right:1px solid #dde1f0;vertical-align:middle;">
            <span style="font-size:13px;font-weight:800;color:#3525cd;text-transform:uppercase;letter-spacing:1px;font-family:Arial,sans-serif;">Net Salary</span>
          </td>
          <td style="padding:12px 14px;font-size:16px;font-weight:900;color:#3525cd;font-family:Arial,sans-serif;">${fmtINR(payslip.net_salary)}</td>
        </tr>
      </table>
    </div>

    <!-- Note -->
    <div style="background:#f0f3ff;border-left:4px solid #3525cd;padding:12px 16px;border-radius:4px;font-family:Arial,sans-serif;">
      <p style="margin:0;font-size:13px;color:#3525cd;">Please open the attached PDF for the full salary breakdown including earnings, deductions, and attendance details.</p>
    </div>
  </div>

  <!-- Footer -->
  <div style="background:#f0f3ff;border:1px solid #dde1f0;border-top:none;padding:16px 28px 18px;border-radius:0 0 10px 10px;font-family:Arial,sans-serif;">
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#1e1456;">Need Help?</p>
    <p style="margin:0 0 12px;font-size:12px;color:#475569;">
      Portal: <a href="https://hrms.lumoslogic.com/" style="color:#3525cd;text-decoration:none;font-weight:600;">hrms.lumoslogic.com</a>
    </p>
    <div style="border-top:1px solid #c7c4d8;margin:0 0 10px;"></div>
    <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">Automated email from HRMS by LumosLogic &nbsp;&middot;&nbsp; Please do not reply &nbsp;&middot;&nbsp; &copy; ${new Date().getFullYear()}</p>
  </div>

</div></body></html>`;
}

// ─── Send one payslip email ───────────────────────────────────────────────────
async function sendOnePayslipEmail({ transport, payslip, employee, orgName, month, year, organizationId }) {
  const monthLabel = MONTHS[month - 1] || String(month);
  const period     = `${monthLabel} ${year}`;
  const fromName   = process.env.SMTP_FROM_NAME || 'Lumos Logic HRMS';
  const fromAddr   = process.env.SMTP_FROM || `"${fromName}" <${process.env.SMTP_USER}>`;
  const safeName   = (employee.employee_id || employee.name || 'employee').replace(/\W+/g, '_');
  const filename   = `Payslip_${safeName}_${String(month).padStart(2, '0')}_${year}.pdf`;

  const pdfBuffer   = await generatePayslipPDF(payslip, employee, orgName, organizationId);
  const attachments = pdfBuffer
    ? [{ filename, content: pdfBuffer, contentType: 'application/pdf' }]
    : [];

  await transport.sendMail({
    from:    fromAddr,
    to:      employee.email,
    subject: `Your Payslip for ${period} — ${orgName}`,
    html:    payslipEmailHtml(payslip, employee, orgName, period),
    ...(attachments.length ? { attachments } : {}),
  });
}

// ─── Batch email sending ──────────────────────────────────────────────────────
async function sendPayslipsBatch({ organizationId, runId, month, year }) {
  const transport = getTransport();
  if (!transport) {
    console.warn('[PayrollEmail] SMTP not configured — skipping email delivery');
    return { sent: 0, failed: 0, skipped: 0 };
  }

  const orgRes  = await pool.query('SELECT name FROM organizations WHERE id = $1', [organizationId]);
  const orgName = orgRes.rows[0]?.name || 'Company';

  const { rows } = await pool.query(
    `SELECT pre.user_id, pre.payslip_id,
            u.name, u.email, u.employee_id, u.department,
            ps.gross_salary, ps.total_deductions, ps.net_salary,
            ps.basic, ps.hra, ps.da, ps.transport_allowance, ps.medical_allowance,
            ps.special_allowance, ps.other_allowances,
            ps.pf_employee, ps.esi_employee, ps.professional_tax, ps.tds,
            ps.retention, ps.other_deductions, ps.lop_days, ps.lop_amount,
            ps.working_days, ps.present_days, ps.absent_days, ps.leave_days,
            ps.month, ps.year
       FROM payroll_run_employees pre
       JOIN  users    u  ON u.id  = pre.user_id
       JOIN  payslips ps ON ps.id = pre.payslip_id
      WHERE pre.payroll_run_id  = $1
        AND pre.organization_id = $2
        AND pre.status          = 'success'
        AND u.email IS NOT NULL AND u.email != ''
      ORDER BY u.name ASC`,
    [runId, organizationId]
  );

  let sent = 0, failed = 0, skipped = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    await Promise.all(chunk.map(async emp => {
      try {
        await sendOnePayslipEmail({
          transport,
          payslip:  emp,
          employee: { name: emp.name, email: emp.email, employee_id: emp.employee_id, department: emp.department },
          orgName,
          month,
          year,
          organizationId,
        });

        await pool.query(
          `INSERT INTO payroll_email_log
             (organization_id, payroll_run_id, payslip_id, user_id, email_address, status)
           VALUES ($1,$2,$3,$4,$5,'sent')`,
          [organizationId, runId, emp.payslip_id, emp.user_id, emp.email]
        );
        sent++;
      } catch (err) {
        const msg = (err.message || 'Unknown').substring(0, 500);
        await pool.query(
          `INSERT INTO payroll_email_log
             (organization_id, payroll_run_id, payslip_id, user_id, email_address, status, error_message)
           VALUES ($1,$2,$3,$4,$5,'failed',$6)`,
          [organizationId, runId, emp.payslip_id, emp.user_id, emp.email, msg]
        ).catch(() => {});
        failed++;
        console.error(`[PayrollEmail] Failed → ${emp.email}:`, err.message);
      }
    }));

    if (i + CHUNK_SIZE < rows.length) await sleep(CHUNK_DELAY_MS);
  }

  console.log(`[PayrollEmail] Org ${organizationId} run ${runId}: sent=${sent} failed=${failed} skipped=${skipped}`);
  return { sent, failed, skipped };
}

module.exports = { sendPayslipsBatch, generatePayslipPDF, payslipEmailHtml };
