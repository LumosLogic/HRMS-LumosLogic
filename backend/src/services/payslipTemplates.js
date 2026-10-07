/**
 * payslipTemplates.js — style tokens for the selectable payslip templates (PDF renderer).
 *
 * A template only changes presentation (colours, title bar, table header, zebra rows). The payslip
 * content and calculations are identical across templates. The client mirrors these tokens in
 * client/src/lib/payslipTemplates.js — keep the two in step.
 */

const PAYSLIP_TEMPLATES = {
  classic: {
    id: 'classic', label: 'Classic',
    description: 'Plain black-and-grey grid. The original payslip layout.',
    accent: '#000000', titleBar: 'lines', titleText: '#000000',
    tableHead: '#e8e8e8', tableHeadText: '#000000', border: '#aaaaaa',
    totals: '#f0f0f0', zebra: null,
  },
  professional: {
    id: 'professional', label: 'Professional',
    description: 'Navy title bar and table header with a clean ruled grid.',
    accent: '#1f2d5a', titleBar: 'filled', titleText: '#ffffff',
    tableHead: '#1f2d5a', tableHeadText: '#ffffff', border: '#9aa3bd',
    totals: '#e9ecf5', zebra: null,
  },
  modern: {
    id: 'modern', label: 'Modern',
    description: 'Soft indigo accents, light borders and striped rows.',
    accent: '#3525cd', titleBar: 'filled', titleText: '#ffffff',
    tableHead: '#ece9ff', tableHeadText: '#3525cd', border: '#d5d1f5',
    totals: '#f4f2ff', zebra: '#fafaff',
  },
};

const PAYSLIP_TEMPLATE_IDS = Object.keys(PAYSLIP_TEMPLATES);
const CUSTOM_FIELD_POSITIONS = ['header', 'employee_info', 'footer'];
const WATERMARK_MODES = ['logo', 'text', 'none'];

function getPayslipTemplate(id) {
  return PAYSLIP_TEMPLATES[id] || PAYSLIP_TEMPLATES.classic;
}

/** Clean + validate the payslip look fields of a settings payload in place. Returns an error string or null. */
function sanitizePayslipBranding(payload) {
  if (payload.payslip_template !== undefined && !PAYSLIP_TEMPLATE_IDS.includes(payload.payslip_template)) {
    return `Unknown payslip template. Choose one of: ${PAYSLIP_TEMPLATE_IDS.join(', ')}.`;
  }
  if (payload.payslip_watermark_mode !== undefined && !WATERMARK_MODES.includes(payload.payslip_watermark_mode)) {
    return `Invalid watermark mode. Choose one of: ${WATERMARK_MODES.join(', ')}.`;
  }
  if (payload.payslip_watermark_text !== undefined && payload.payslip_watermark_text !== null) {
    payload.payslip_watermark_text = String(payload.payslip_watermark_text).trim().slice(0, 40) || null;
  }
  if (payload.payslip_custom_fields !== undefined) {
    const list = Array.isArray(payload.payslip_custom_fields) ? payload.payslip_custom_fields : null;
    if (!list) return 'payslip_custom_fields must be a list.';
    if (list.length > 12) return 'You can add at most 12 custom payslip fields.';
    payload.payslip_custom_fields = list
      .map(f => ({
        label:    String(f?.label ?? '').trim().slice(0, 60),
        value:    String(f?.value ?? '').trim().slice(0, 300),
        position: CUSTOM_FIELD_POSITIONS.includes(f?.position) ? f.position : 'header',
      }))
      .filter(f => f.label || f.value);
  }
  return null;
}

module.exports = {
  PAYSLIP_TEMPLATES, PAYSLIP_TEMPLATE_IDS, CUSTOM_FIELD_POSITIONS, WATERMARK_MODES,
  getPayslipTemplate, sanitizePayslipBranding,
};
