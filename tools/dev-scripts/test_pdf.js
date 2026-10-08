const { pool } = require('../../backend/src/config/db');
const { generatePayslipPDF } = require('../../backend/src/services/payrollEmailService');
async function test() {
  const sql = "SELECT ps.*, u.name, u.email, u.employee_id, u.department FROM payslips ps JOIN users u ON u.id = ps.user_id WHERE ps.organization_id = 2 AND ps.status = 'published' ORDER BY ps.id DESC LIMIT 1";
  const { rows } = await pool.query(sql);
  if (rows.length === 0) { console.log('No published payslips found'); process.exit(0); }
  const r = rows[0];
  r.payslip_id = r.id;
  console.log('Payslip id:', r.id, '| user:', r.name, '| org:', r.organization_id);
  const pdf = await generatePayslipPDF(r, { name: r.name, email: r.email, employee_id: r.employee_id, department: r.department }, 'LumosLogic', 2);
  console.log('PDF result:', pdf ? pdf.length + ' bytes OK' : 'NULL - generation failed');
  await pool.end();
}
test().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
