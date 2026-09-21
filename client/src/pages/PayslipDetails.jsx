import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, AlertCircle, Printer, Download } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiDownload } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { MONTHS } from '@/lib/utils';
import Payslip from '@/components/Payslip';

const fmtD = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const fmt  = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const num  = n => Number(n || 0);

function Row({ label, value, accent, bold }) {
  return (
    <tr className="border-b border-[#f0eef8] last:border-0">
      <td className="py-2.5 text-sm text-[#464555]">{label}</td>
      <td className={`py-2.5 text-sm text-right ${bold ? 'font-black' : 'font-medium'} ${accent || 'text-[#151c27]'}`}>
        {value}
      </td>
    </tr>
  );
}

function Section({ title, children }) {
  return (
    <div className="bg-white border border-[#e2e0f0] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#e2e0f0] bg-[#f9f9ff]">
        <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">{title}</p>
      </div>
      <div className="px-5 py-1">
        <table className="w-full">{children}</table>
      </div>
    </div>
  );
}

export default function PayslipDetails() {
  const { id }     = useParams();
  const navigate   = useNavigate();
  const location   = useLocation();
  const { user }   = useAuth();
  const [showPayslip, setShowPayslip] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const blob = await apiDownload(`/payroll/payslips/${id}/pdf`);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `Payslip_${slip?.name?.replace(/\s+/g,'_') || 'payslip'}_${slip?.month}_${slip?.year}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  const isRootAdmin  = user?.role === 'root_admin';
  const basePath     = isRootAdmin ? '/root' : '';
  const isAdminPath  = location.pathname.startsWith('/root/') || location.pathname.startsWith('/payroll/');

  const { data: slip, isLoading, error } = useQuery({
    queryKey: ['payslip-details', id],
    queryFn:  () => apiGet(`/payroll/payslips/${id}/details`),
    enabled:  Boolean(id),
  });

  const goBack = () => {
    if (location.state?.from) {
      navigate(location.state.from);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(`${basePath}/payroll/generate`);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <span className="w-7 h-7 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !slip) {
    return (
      <div className="text-center py-24">
        <AlertCircle size={36} className="text-red-400 mx-auto mb-3" />
        <p className="text-sm text-[#777587]">{error?.message || 'Payslip not found'}</p>
        <button onClick={goBack} className="mt-4 text-sm text-[#3525cd] font-bold hover:underline">Go back</button>
      </div>
    );
  }

  const monthNum    = typeof slip.month === 'string' ? parseInt(slip.month, 10) : num(slip.month);
  const monthLabel  = MONTHS[monthNum - 1] || slip.month;
  const grossSalary = num(slip.gross_salary);
  const totalDed    = num(slip.total_deductions);
  const netSalary   = num(slip.net_salary);

  // Earnings breakdown
  const earnings = [
    { label: 'Basic',                value: num(slip.basic) },
    { label: 'HRA',                  value: num(slip.hra) },
    { label: 'Dearness Allowance',   value: num(slip.da) },
    { label: 'Transport Allowance',  value: num(slip.transport_allowance) },
    { label: 'Medical Allowance',    value: num(slip.medical_allowance) },
    { label: 'Special Allowance',    value: num(slip.special_allowance || 0) },
    { label: 'Other Allowances',     value: num(slip.other_allowances || 0) },
  ].filter(r => r.value > 0);

  // Deductions breakdown
  const deductions = [
    { label: 'Provident Fund (Employee)', value: num(slip.pf_employee) },
    { label: 'ESI (Employee)',             value: num(slip.esi_employee) },
    { label: 'Professional Tax',           value: num(slip.professional_tax) },
    { label: 'TDS',                        value: num(slip.tds) },
    { label: 'Other Deductions',           value: num(slip.other_deductions) },
    { label: `LOP (${num(slip.lop_days)} day${num(slip.lop_days) === 1 ? '' : 's'})`, value: num(slip.lop_amount) },
  ].filter(r => r.value > 0);

  // Employer contributions
  const employer = [
    { label: 'Provident Fund (Employer)', value: num(slip.pf_employer) },
    { label: 'ESI (Employer)',             value: num(slip.esi_employer) },
  ].filter(r => r.value > 0);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center justify-between">
        <button onClick={goBack} className="flex items-center gap-1.5 text-sm text-[#777587] hover:text-[#3525cd] font-medium transition-colors">
          <ArrowLeft size={15} />
          Back
        </button>
        <div className="flex items-center gap-2">
          <button onClick={downloadPdf} disabled={downloading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#3525cd] text-white text-xs font-bold hover:bg-[#2a1fb0] transition-colors disabled:opacity-50">
            {downloading
              ? <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Download size={13} />}
            Download PDF
          </button>
          <button onClick={() => setShowPayslip(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#c7c4d8] text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] transition-colors">
            <Printer size={13} /> Print
          </button>
        </div>
      </div>
      {showPayslip && (
        <Payslip payslipId={id} onClose={() => setShowPayslip(false)} />
      )}

      {/* ── Header ── */}
      <div className="bg-white border border-[#e2e0f0] rounded-xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Avatar name={slip.name} size={44} color={slip.avatar_color} />
            <div>
              <p className="font-black text-[#151c27] text-base">{slip.name}</p>
              <p className="text-xs text-[#777587]">
                {slip.employee_id && <span>{slip.employee_id} · </span>}
                {slip.department || slip.position || 'Employee'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">Pay Period</p>
              <p className="font-black text-[#151c27]">{monthLabel} {slip.year}</p>
            </div>
            {slip.locked && (
              <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                <Lock size={11} />
                Locked
              </span>
            )}
          </div>
        </div>

        {/* Net pay highlight */}
        <div className="mt-4 pt-4 border-t border-[#e2e0f0] grid grid-cols-3 gap-0 divide-x divide-[#e2e0f0]">
          {[
            { label: 'Gross Salary',    value: fmtD(grossSalary) },
            { label: 'Total Deductions', value: fmtD(totalDed), accent: 'text-rose-600' },
            { label: 'Net Pay',          value: fmtD(netSalary), accent: 'text-emerald-700', bold: true },
          ].map(c => (
            <div key={c.label} className="px-4 first:pl-0 last:pr-0">
              <p className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{c.label}</p>
              <p className={`text-lg font-black ${c.accent || 'text-[#151c27]'}`}>{c.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Earnings ── */}
      <Section title="Earnings">
        {earnings.map(r => <Row key={r.label} label={r.label} value={fmtD(r.value)} />)}
        <Row label="Gross Salary" value={fmtD(grossSalary)} bold accent="text-[#3525cd]" />
      </Section>

      {/* ── Deductions ── */}
      {deductions.length > 0 && (
        <Section title="Deductions">
          {deductions.map(r => <Row key={r.label} label={r.label} value={fmtD(r.value)} accent="text-rose-600" />)}
          <Row label="Total Deductions" value={fmtD(totalDed)} bold accent="text-rose-700" />
        </Section>
      )}

      {/* ── Employer Contributions ── */}
      {employer.length > 0 && (
        <Section title="Employer Contributions (CTC)">
          {employer.map(r => <Row key={r.label} label={r.label} value={fmtD(r.value)} accent="text-slate-600" />)}
          <Row label="Total Employer Contribution" value={fmtD(employer.reduce((s, r) => s + r.value, 0))} bold accent="text-slate-700" />
        </Section>
      )}

      {/* ── Attendance Summary ── */}
      <div className="bg-white border border-[#e2e0f0] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[#e2e0f0] bg-[#f9f9ff]">
          <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">Attendance Summary</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#e2e0f0]">
          {[
            { label: 'Working Days',  value: slip.working_days || 0 },
            { label: 'Present Days',  value: num(slip.present_days) },
            { label: 'Absent Days',   value: slip.absent_days || 0 },
            { label: 'LOP Days',      value: num(slip.lop_days) },
          ].map(c => (
            <div key={c.label} className="px-5 py-3">
              <p className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{c.label}</p>
              <p className="text-lg font-black text-[#151c27]">{c.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Meta ── */}
      <div className="text-xs text-[#777587] space-y-0.5 pb-6">
        {slip.formula_version && <p>Calculation engine: v{slip.formula_version}</p>}
        {slip.generated_at && (
          <p>Generated: {new Date(slip.generated_at || slip.created_at).toLocaleString('en-IN')}</p>
        )}
        {slip.locked && slip.locked_at && (
          <p>Locked: {new Date(slip.locked_at).toLocaleString('en-IN')}</p>
        )}
      </div>
    </div>
  );
}
