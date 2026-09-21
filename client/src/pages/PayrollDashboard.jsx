import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users, IndianRupee, TrendingDown, AlertTriangle,
  Clock, CheckCircle2, BarChart3, Building2, ArrowRight, GitBranch,
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, PointElement, LineElement,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet } from '@/lib/api';
import { MONTHS } from '@/lib/utils';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, ArcElement,
  Title, Tooltip, Legend, PointElement, LineElement
);

const fmt  = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });
const fmtC = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });

const DEPT_COLORS = [
  '#3525cd','#6b5fff','#10b981','#f59e0b','#ef4444',
  '#8b5cf6','#06b6d4','#84cc16','#f97316','#ec4899',
];

function KpiCard({ icon: Icon, label, value, sub, accent, trend }) {
  return (
    <div className="bg-white rounded-xl border border-[#e2e0f0] p-5 shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent || 'bg-[#f0f3ff]'}`}>
          <Icon size={18} className="text-[#3525cd]" />
        </div>
        {trend !== undefined && (
          <span className={`text-[0.65rem] font-black px-2 py-0.5 rounded-full ${trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{label}</p>
      <p className="text-2xl font-black text-[#151c27] mt-1">{value}</p>
      {sub && <p className="text-[0.7rem] text-[#777587] mt-1">{sub}</p>}
    </div>
  );
}

function MonthYearPicker({ month, year, onMonth, onYear }) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={month}
        onChange={e => onMonth(Number(e.target.value))}
        className="border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
        <option value={0}>All months</option>
        {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
      </select>
      <div className="flex items-center gap-1 bg-white border border-[#c7c4d8] rounded-lg px-2 py-1.5">
        <button onClick={() => onYear(y => y - 1)} className="w-6 h-6 flex items-center justify-center rounded text-[#777587] hover:text-[#3525cd]">‹</button>
        <span className="font-black text-sm text-[#151c27] min-w-[3rem] text-center">{year}</span>
        <button onClick={() => onYear(y => y + 1)} className="w-6 h-6 flex items-center justify-center rounded text-[#777587] hover:text-[#3525cd]">›</button>
      </div>
    </div>
  );
}

export default function PayrollDashboard() {
  const { user } = useAuth();
  const { selectedBranchId, selectedBranch } = useBranch();
  const branchLabel = selectedBranch?.name || 'All Branches';
  const basePath = user?.role === 'root_admin' ? '/root' : '';
  const now      = new Date();
  const [month, setMonth] = useState(0); // 0 = all
  const [year,  setYear]  = useState(now.getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['payroll-dashboard', month, year, selectedBranchId],
    queryFn:  () => apiGet('/payroll/dashboard', {
      ...(month ? { month } : {}),
      year,
    }),
  });

  const kpi     = data?.kpi         || {};
  const summary = data?.summary      || [];
  const dept    = data?.deptBreakdown || [];
  const trend   = data?.trend        || [];

  // EHN_PAYROLL_005: Compute month-on-month delta for KPI display
  const momDelta = (() => {
    if (trend.length < 2) return null;
    const latest = trend[trend.length - 1];
    const prev   = trend[trend.length - 2];
    if (!prev?.total_gross || Number(prev.total_gross) === 0) return null;
    const pct = Math.round(((Number(latest.total_gross) - Number(prev.total_gross)) / Number(prev.total_gross)) * 100);
    return pct;
  })();

  // ── Monthly trend chart ───────────────────────────────────────────────────
  const trendChart = {
    labels: trend.map(r => `${MONTHS[r.month - 1].slice(0,3)} ${r.year}`),
    datasets: [
      {
        label: 'Gross Payroll',
        data: trend.map(r => Number(r.total_gross || 0)),
        backgroundColor: '#3525cd33',
        borderColor: '#3525cd',
        borderWidth: 2,
        borderRadius: 4,
      },
      {
        label: 'Net Payroll',
        data: trend.map(r => Number(r.total_net || 0)),
        backgroundColor: '#10b98133',
        borderColor: '#10b981',
        borderWidth: 2,
        borderRadius: 4,
      },
    ],
  };

  const trendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', labels: { font: { size: 11, weight: 'bold' }, padding: 16 } },
      tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } },
    },
    scales: {
      y: {
        ticks: { callback: v => '₹' + fmtC(v), font: { size: 10 } },
        grid: { color: '#f0f3ff' },
      },
      x: { ticks: { font: { size: 10 } } },
    },
  };

  // ── Department doughnut chart ─────────────────────────────────────────────
  const deptChart = {
    labels: dept.map(d => d.department),
    datasets: [{
      data: dept.map(d => Number(d.total_net || 0)),
      backgroundColor: dept.map((_, i) => DEPT_COLORS[i % DEPT_COLORS.length]),
      borderWidth: 2,
      borderColor: '#fff',
    }],
  };

  const deptOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right', labels: { font: { size: 11 }, padding: 12, boxWidth: 12 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)}` } },
    },
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="page-header"><div className="page-title">Payroll Dashboard</div></div>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Payroll Dashboard</div>
          <div className="page-subtitle flex items-center gap-2">
            <span className="text-[#777587]">Payroll</span>
            <span className="mx-1.5 text-[#c7c4d8]">›</span>
            Dashboard
            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd]">
              <GitBranch size={10} />
              {branchLabel}
            </span>
          </div>
        </div>
        <MonthYearPicker month={month} year={year} onMonth={setMonth} onYear={setYear} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={IndianRupee}  label="Total Gross Payroll" value={fmt(kpi.totalPayroll)} trend={momDelta} />
        <KpiCard icon={CheckCircle2} label="Net Salary Disbursed" value={fmt(kpi.totalNet)}    accent="bg-emerald-50" />
        <KpiCard icon={Users}        label="Employees Paid"       value={kpi.employeesPaid || 0} />
        <KpiCard icon={Clock}        label="Pending Runs"         value={kpi.pendingRuns || 0}  accent="bg-amber-50" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={TrendingDown}  label="Total Deductions"  value={fmt(kpi.totalDeductions)} accent="bg-rose-50" />
        <KpiCard icon={BarChart3}     label="Total Bonuses"     value={fmt(kpi.totalBonuses)}    accent="bg-blue-50" />
        <KpiCard icon={AlertTriangle} label="Processing Errors" value={kpi.errorCount || 0}      accent="bg-orange-50" />
        <KpiCard icon={IndianRupee}   label="Average Net Salary" value={fmt(kpi.avgSalary)}      accent="bg-violet-50" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Monthly Trend */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-[#e2e0f0] shadow-sm p-5">
          <p className="text-sm font-bold text-[#151c27] mb-4">Monthly Payroll Trend</p>
          {trend.length > 0
            ? <div style={{ height: 240 }}><Bar data={trendChart} options={trendOptions} /></div>
            : <div className="flex items-center justify-center h-40 text-sm text-[#777587]">No trend data yet</div>
          }
        </div>

        {/* Department Cost */}
        <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm p-5">
          <p className="text-sm font-bold text-[#151c27] mb-4">Department Cost Split</p>
          {dept.length > 0
            ? <div style={{ height: 240 }}><Doughnut data={deptChart} options={deptOptions} /></div>
            : <div className="flex items-center justify-center h-40 text-sm text-[#777587]">No data for period</div>
          }
        </div>
      </div>

      {/* Department Table */}
      {dept.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center gap-2">
            <Building2 size={15} className="text-[#3525cd]" />
            <p className="text-sm font-bold text-[#151c27]">Department Breakdown</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0f3ff] bg-[#fafaff]">
                  {['Department','Employees','Gross','Deductions','LOP','Net Salary','Avg Net'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dept.map((d, i) => (
                  <tr key={d.department} className={i % 2 === 0 ? 'bg-white' : 'bg-[#fafaff]'}>
                    <td className="px-4 py-2.5 font-semibold text-[#151c27]">{d.department}</td>
                    <td className="px-4 py-2.5 text-[#464555]">{d.employee_count}</td>
                    <td className="px-4 py-2.5 text-emerald-700 font-semibold">{fmt(d.total_gross)}</td>
                    <td className="px-4 py-2.5 text-rose-600">{fmt(d.total_deductions)}</td>
                    <td className="px-4 py-2.5 text-orange-600">{fmt(d.total_lop)}</td>
                    <td className="px-4 py-2.5 font-bold text-[#3525cd]">{fmt(d.total_net)}</td>
                    <td className="px-4 py-2.5 text-[#464555]">{fmt(d.avg_net_salary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Runs */}
      {summary.length > 0 && (
        <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between">
            <p className="text-sm font-bold text-[#151c27]">Payroll Runs</p>
            <Link to={`${basePath}/payroll/generate`} className="text-xs font-bold text-[#3525cd] flex items-center gap-1 hover:underline">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f0f3ff] bg-[#fafaff]">
                  {['Period','Status','Employees','Gross','Net','Adjustments','Generated By'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.slice(0, 8).map((r, i) => (
                  <tr key={r.run_id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#fafaff]'}>
                    <td className="px-4 py-2.5 font-semibold text-[#151c27]">
                      <Link to={`${basePath}/payroll/runs/${r.run_id}`} className="hover:text-[#3525cd]">
                        {MONTHS[r.month - 1]} {r.year}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[0.68rem] font-bold px-2 py-0.5 rounded-full ${
                        r.status === 'paid'     ? 'bg-emerald-50 text-emerald-700' :
                        r.status === 'locked'   ? 'bg-slate-100 text-slate-600' :
                        r.status === 'approved' ? 'bg-blue-50 text-blue-700' :
                        r.status === 'verified' ? 'bg-violet-50 text-violet-700' :
                        r.status === 'completed'? 'bg-teal-50 text-teal-700' :
                        r.status === 'failed'   ? 'bg-red-50 text-red-700' :
                        'bg-amber-50 text-amber-700'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[#464555]">{r.employee_count}</td>
                    <td className="px-4 py-2.5 text-[#464555]">{fmt(r.total_gross)}</td>
                    <td className="px-4 py-2.5 font-bold text-[#3525cd]">{fmt(r.total_net)}</td>
                    <td className="px-4 py-2.5 text-[#464555]">{fmt(r.total_adjustments)}</td>
                    <td className="px-4 py-2.5 text-[#777587]">{r.generated_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
