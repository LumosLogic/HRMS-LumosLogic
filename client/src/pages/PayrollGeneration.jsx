import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Play, Eye, Lock, Unlock, CheckCircle2, AlertCircle, Clock,
  AlertTriangle, ChevronRight, Users, IndianRupee, Calendar, GitBranch,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { MONTHS } from '@/lib/utils';

const fmt  = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const fmtD = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
const padZ = n  => String(n).padStart(2, '0');

const now = new Date();

const STATUS_META = {
  draft:                  { label: 'Draft',               cls: 'bg-[#f0f3ff] text-[#3525cd]', Icon: Clock },
  processing:             { label: 'Processing',          cls: 'bg-amber-50 text-amber-700',   Icon: Clock },
  completed:              { label: 'Completed',           cls: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  completed_with_errors:  { label: 'Completed w/ Errors', cls: 'bg-orange-50 text-orange-700',  Icon: AlertTriangle },
  failed:                 { label: 'Failed',              cls: 'bg-red-50 text-red-700',        Icon: AlertCircle },
  locked:                 { label: 'Locked',              cls: 'bg-slate-100 text-slate-600',   Icon: Lock },
};

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-600', Icon: Clock };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${m.cls}`}>
      <m.Icon size={11} />
      {m.label}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-white border border-[#e2e0f0] rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
        <Icon size={18} className="text-[#3525cd]" />
      </div>
      <div>
        <p className="text-[0.7rem] font-bold text-[#777587] uppercase tracking-wider">{label}</p>
        <p className="text-lg font-black text-[#151c27]">{value}</p>
        {sub && <p className="text-xs text-[#777587]">{sub}</p>}
      </div>
    </div>
  );
}

export default function PayrollGeneration() {
  const toast    = useToast();
  const qc       = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch } = useBranch();

  const branchLabel = selectedBranch ? selectedBranch.name : 'All Branches';

  const isRootAdmin = user?.role === 'root_admin';
  const basePath    = isRootAdmin ? '/root' : '';

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [preview, setPreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [forceConfirm, setForceConfirm] = useState(false);
  const [forceMessage, setForceMessage] = useState('');

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['payroll-runs', selectedBranchId],
    queryFn:  () => apiGet('/payroll/runs'),
  });

  const previewMut = useMutation({
    mutationFn: () => apiPost('/payroll/preview', { month, year }),
    onSuccess:  data => { setPreview(data); setShowPreview(true); },
    onError:    e => toast(e.message, 'error'),
  });

  const generateMut = useMutation({
    mutationFn: (force) => apiPost('/payroll/generate', { month, year, force }),
    onSuccess: data => {
      const msg = data.status === 'completed'
        ? 'Payroll run completed successfully'
        : `Payroll run finished with ${data.errorCount} error(s)`;
      toast(msg, data.errorCount ? 'warning' : 'success');
      setShowPreview(false);
      setPreview(null);
      setForceConfirm(false);
      qc.invalidateQueries({ queryKey: ['payroll-runs', selectedBranchId] });
    },
    onError: e => {
      if (e.message && (e.message.includes('already exists') || e.message.includes('PAYROLL_EXISTS'))) {
        setForceMessage(e.message);
        setForceConfirm(true);
      } else {
        toast(e.message, 'error');
      }
    },
  });

  const years = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 3; y--) years.push(y);

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#151c27]">Payroll Generation</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-sm text-[#777587]">Generate and manage payroll runs</p>
            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd]">
              <GitBranch size={11} />
              {branchLabel}
            </span>
          </div>
        </div>
      </div>

      {/* ── Period + Actions ── */}
      <div className="bg-white border border-[#e2e0f0] rounded-xl p-5">
        <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587] mb-4">Pay Period</p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-bold text-[#464555] mb-1">Month</label>
            <select
              value={month}
              onChange={e => { setMonth(Number(e.target.value)); setShowPreview(false); setPreview(null); }}
              className="border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
            >
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#464555] mb-1">Year</label>
            <select
              value={year}
              onChange={e => { setYear(Number(e.target.value)); setShowPreview(false); setPreview(null); }}
              className="border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
            >
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => previewMut.mutate()}
              disabled={previewMut.isPending}
              className="inline-flex items-center gap-2 border border-[#3525cd] text-[#3525cd] rounded-lg px-4 py-2 text-sm font-bold hover:bg-[#f0f3ff] transition-colors disabled:opacity-50"
            >
              {previewMut.isPending ? <span className="w-4 h-4 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" /> : <Eye size={15} />}
              Preview
            </button>
            <button
              onClick={() => generateMut.mutate(false)}
              disabled={generateMut.isPending}
              className="inline-flex items-center gap-2 bg-[#3525cd] text-white rounded-lg px-4 py-2 text-sm font-bold hover:bg-[#2a1eb5] transition-colors disabled:opacity-50"
            >
              {generateMut.isPending ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play size={15} />}
              Generate Payroll
            </button>
          </div>
        </div>
      </div>

      {/* ── Preview Panel ── */}
      {showPreview && preview && (
        <div className="bg-white border border-[#e2e0f0] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#e2e0f0]">
            <div>
              <p className="font-black text-[#151c27]">Preview — {MONTHS[month - 1]} {year}</p>
              <p className="text-xs text-[#777587]">{preview.eligibleCount} eligible · {preview.errorCount} with errors</p>
            </div>
            {preview.existingRun && (
              <StatusBadge status={preview.existingRun.status} />
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-0 divide-x divide-[#e2e0f0]">
            {[
              { label: 'Employees', value: preview.employeeCount },
              { label: 'Total Gross', value: fmt(preview.totalGross) },
              { label: 'Total Deductions', value: fmt(preview.totalDeductions) },
              { label: 'Total Net Pay', value: fmt(preview.totalNet) },
            ].map(c => (
              <div key={c.label} className="px-5 py-3">
                <p className="text-[0.65rem] font-bold text-[#777587] uppercase tracking-wider">{c.label}</p>
                <p className="text-base font-black text-[#151c27]">{c.value}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#f9f9ff] border-y border-[#e2e0f0]">
                  <th className="text-left text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-5 py-2.5">Employee</th>
                  <th className="text-right text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-4 py-2.5">Gross</th>
                  <th className="text-right text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-4 py-2.5">Deductions</th>
                  <th className="text-right text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-4 py-2.5">Net Pay</th>
                  <th className="text-right text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-4 py-2.5">LOP Days</th>
                  <th className="text-right text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0eef8]">
                {preview.employees.map(emp => (
                  <tr key={emp.userId} className="hover:bg-[#f9f9ff]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={emp.name} size={28} />
                        <div>
                          <p className="font-bold text-[#151c27] text-xs">{emp.name}</p>
                          <p className="text-[0.65rem] text-[#777587]">{emp.department || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[#151c27] text-xs">
                      {emp.status === 'eligible' ? fmtD(emp.grossSalary) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-rose-600 font-bold">
                      {emp.status === 'eligible' ? fmtD(emp.deductions) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-emerald-700 text-xs">
                      {emp.status === 'eligible' ? fmtD(emp.netSalary) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[#777587]">
                      {emp.status === 'eligible' ? emp.lopDays : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {emp.status === 'eligible'
                        ? <span className="text-xs font-bold text-emerald-600">Eligible</span>
                        : <span className="text-xs font-bold text-red-500" title={emp.error}>Error</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.existingRun && (
            <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 flex items-center gap-2">
              <AlertTriangle size={13} />
              A run already exists for this period (status: <StatusBadge status={preview.existingRun.status} />). Generating will overwrite it.
            </div>
          )}
        </div>
      )}

      {/* ── Payroll Runs ── */}
      <div className="bg-white border border-[#e2e0f0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#e2e0f0]">
          <p className="font-black text-[#151c27]">Payroll Runs</p>
        </div>
        {runsLoading ? (
          <div className="flex justify-center py-12">
            <span className="w-6 h-6 border-2 border-[#3525cd]/20 border-t-[#3525cd] rounded-full animate-spin" />
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-12">
            <Calendar size={36} className="text-[#c7c4d8] mx-auto mb-3" />
            <p className="text-sm text-[#777587]">No payroll runs yet. Generate your first payroll above.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f9f9ff] border-b border-[#e2e0f0]">
                {['Period', 'Branch', 'Status', 'Employees', 'Total Gross', 'Total Net', 'Generated By', 'Date', ''].map(h => (
                  <th key={h} className={`text-[0.65rem] font-black uppercase tracking-widest text-[#777587] px-4 py-2.5 ${h === '' ? '' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0eef8]">
              {runs.map(run => (
                <tr key={run.id} className="hover:bg-[#f9f9ff] cursor-pointer" onClick={() => navigate(`${basePath}/payroll/runs/${run.id}`)}>
                  <td className="px-4 py-3 font-bold text-[#151c27]">
                    {MONTHS[run.month - 1]} {run.year}
                  </td>
                  <td className="px-4 py-3 text-xs text-[#777587]">
                    {run.branch_name
                      ? <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd]"><GitBranch size={10} />{run.branch_name}</span>
                      : <span className="text-[#c7c4d8]">All Branches</span>
                    }
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
                  <td className="px-4 py-3 text-[#151c27]">{run.employee_count}</td>
                  <td className="px-4 py-3 text-[#151c27]">{fmt(run.total_gross)}</td>
                  <td className="px-4 py-3 font-bold text-emerald-700">{fmt(run.total_net)}</td>
                  <td className="px-4 py-3 text-[#777587] text-xs">{run.generated_by_name || '—'}</td>
                  <td className="px-4 py-3 text-[#777587] text-xs">
                    {run.generated_at ? new Date(run.generated_at).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ChevronRight size={14} className="text-[#c7c4d8] ml-auto" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Force Regenerate Confirmation Modal ── */}
      {forceConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <p className="font-black text-[#151c27]">Payroll Already Exists</p>
                <p className="text-sm text-[#777587] mt-1">{forceMessage}</p>
              </div>
            </div>
            <p className="text-sm text-[#464555] mb-5">
              Regenerating will overwrite all payslips for <strong>{MONTHS[month - 1]} {year}</strong>
              {selectedBranch ? <> — <strong>{selectedBranch.name}</strong> branch only</> : <> (All Branches)</>}.
              This cannot be undone unless the run was previously locked.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setForceConfirm(false)}
                className="px-4 py-2 text-sm font-bold text-[#464555] border border-[#c7c4d8] rounded-lg hover:bg-[#f9f9ff] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => generateMut.mutate(true)}
                disabled={generateMut.isPending}
                className="px-4 py-2 text-sm font-bold bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {generateMut.isPending
                  ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  : <Play size={14} />
                }
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
