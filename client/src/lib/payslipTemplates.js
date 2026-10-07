// Style tokens for the selectable payslip templates (screen / print renderer).
// Mirrors backend/src/services/payslipTemplates.js (PDF renderer) — keep the two in step.
// A template only changes presentation; payslip content and calculations are identical.

export const PAYSLIP_TEMPLATES = {
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

export const PAYSLIP_TEMPLATE_LIST = Object.values(PAYSLIP_TEMPLATES);

export const CUSTOM_FIELD_POSITIONS = [
  { value: 'header',        label: 'Header (under company name)' },
  { value: 'employee_info', label: 'Employee details block' },
  { value: 'footer',        label: 'Footer (above the note)' },
];

export function getPayslipTemplate(id) {
  return PAYSLIP_TEMPLATES[id] || PAYSLIP_TEMPLATES.classic;
}
