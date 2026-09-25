import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Shield, AlertTriangle, CheckCircle2, Clock, Download,
  FileText, IndianRupee, Users, ArrowRight,
} from 'lucide-react';
import { apiGet } from '@/lib/api';
import { MONTHS, cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

const fmt = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 });

const LIABILITY_ITEMS = [
  { key: 'pf',       label: 'Provident Fund',    color: 'text-blue-700',   bg: 'bg-blue-50',   accent: '#3b82f6' },
  { key: 'esi',      label: 'ESI',               color: 'text-violet-700', bg: 'bg-violet-50', accent: '#7c3aed' },
  { key: 'pt',       label: 'Professional Tax',  color: 'text-teal-700',   bg: 'bg-teal-50',   accent: '#0d9488' },
  { key: 'tds',      label: 'TDS',               color: 'text-rose-700',   bg: 'bg-rose-50',   accent: '#e11d48' },
  { key: 'lwf',      label: 'LWF',               color: 'text-amber-700',  bg: 'bg-amber-50',  accent: '#d97706' },
  { key: 'gratuity', label: 'Gratuity Accrual',  color: 'text-emerald-700',bg: 'bg-emerald-50',accent: '#059669' },
];

const REPORT_LINKS = [
  { label: 'PF ECR',      to: '/statutory/reports/pf-ecr',     icon: FileText },
  { label: 'ESI Return',  to: '/statutory/reports/esi',         icon: FileText },
  { label: 'PT Challan',  to: '/statutory/reports/pt',          icon: FileText },
  { label: 'TDS 24Q',     to: '/statutory/reports/tds',         icon: FileText },
  { label: 'Form 16',     to: '/statutory/reports/form16',      icon: Download },
];

function StatusPill({ status }) {
  const MAP = {
    pending:     'bg-amber-50 text-amber-700',
    in_progress: 'bg-blue-50 text-blue-700',
    filed:       'bg-emerald-50 text-emerald-700',
    overdue:     'bg-red-50 text-red-700',
  };
  const ICON = { filed: CheckCircle2, overdue: AlertTriangle, pending: Clock };
  const Icon = ICON[status] || Clock;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[0.65rem] font-bold px-2 py-0.5 rounded-full', MAP[status] || 'bg-gray-100 text-gray-600')}>
      <Icon size={10} /> {status}
    </span>
  );
}

export default function ComplianceDashboard() {
  const { user, isRootAdmin } = useAuth();
  const toast    = useToast();
  const basePath = isRootAdmin ? '/root' : '';
  const now      = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());

  async function downloadReport(to, label) {
    const token = localStorage.getItem('lt_token');
    try {
      const params = new URLSearchParams({ format: 'csv', month, year });
      const res = await fetch(`/api${to}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (res.status === 403) {
          toast('You do not have permission to download this report. Please contact your administrator.', 'error');
        } else if (res.status === 400) {
          toast(d.error || `No ${label} data found for the selected period. Ensure payroll has been generated for ${MONTHS[month - 1]} ${year}.`, 'warning');
        } else {
          toast(d.error || `Failed to generate ${label} report. Please try again or contact support.`, 'error');
        }
        return;
      }
      const blob = await res.blob();
      if (!blob || blob.size === 0) {
        toast(`No ${label} data found for ${MONTHS[month - 1]} ${year}. Generate payroll first to produce statutory reports.`, 'warning');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label.toLowerCase().replace(/[\s/]+/g, '_')}_${month}_${year}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 200);
    } catch (e) {
      toast(`Download failed. Please check your connection and try again.`, 'error');
    }
  }

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['compliance-summary', month, year],
    queryFn:  () => apiGet('/statutory/compliance-summary', { month, year }),
    retry: false,
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['compliance-returns'],
    queryFn:  () => apiGet('/statutory/returns'),
  });

  const liabilities = data?.liabilities || {};
  const coverage    = data?.coverage    || {};
  const totalLiability = Object.values(liabilities).reduce((s, v) => s + Number(v || 0), 0);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="page-header"><div className="page-title">Compliance Dashboard</div></div>
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (isError) {
    const msg = error?.message || '';
    const isPermission = msg.includes('permission') || msg.includes('403');
    return (
      <div className="space-y-5">
        <div className="page-header"><div className="page-title">Compliance Dashboard</div></div>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertTriangle size={40} className="text-amber-500 mb-4" />
          <p className="text-lg font-black text-[#151c27] mb-2">
            {isPermission ? 'Access Restricted' : 'Failed to Load Dashboard'}
          </p>
          <p className="text-sm text-[#777587] max-w-sm">
            {isPermission
              ? 'You do not have permission to view the Compliance Dashboard. Please ask your Root Admin to grant you statutory access.'
              : 'An error occurred while loading compliance data. Please refresh the page or contact support if the issue persists.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Compliance Dashboard</div>
          <div className="page-subtitle">
            <span className="text-[#777587]">Statutory</span>
            <span className="mx-1.5 text-[#c7c4d8]">›</span>
            Compliance Overview
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-[#3525cd] bg-white">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-white border border-[#c7c4d8] rounded-lg px-2 py-1.5">
            <button onClick={() => setYear(y => y - 1)} className="w-6 h-6 flex items-center justify-center text-[#777587] hover:text-[#3525cd]">‹</button>
            <span className="font-black text-sm text-[#151c27] min-w-[3rem] text-center">{year}</span>
            <button onClick={() => setYear(y => y + 1)} className="w-6 h-6 flex items-center justify-center text-[#777587] hover:text-[#3525cd]">›</button>
          </div>
        </div>
      </div>

      {/* Total liability banner */}
      <div className="bg-gradient-to-r from-[#3525cd] to-[#6b5fff] rounded-xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold opacity-80">Total Statutory Liability</p>
            <p className="text-3xl font-black mt-1">{fmt(totalLiability)}</p>
            <p className="text-xs opacity-70 mt-1">{MONTHS[month - 1]} {year}</p>
          </div>
          <Shield size={40} className="opacity-20" />
        </div>
      </div>

      {/* Liability Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {LIABILITY_ITEMS.map(item => (
          <div key={item.key} className={`${item.bg} rounded-xl border border-current/10 p-4`}>
            <p className={`text-[0.65rem] font-black uppercase tracking-widest ${item.color} opacity-70`}>{item.label}</p>
            <p className={`text-xl font-black mt-1 ${item.color}`}>{fmt(liabilities[item.key])}</p>
            {coverage[item.key] !== undefined && (
              <p className="text-[0.68rem] opacity-60 mt-1 font-semibold">{coverage[item.key]} employees</p>
            )}
          </div>
        ))}
      </div>

      {/* Quick report links */}
      <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center gap-2">
          <Download size={15} className="text-[#3525cd]" />
          <p className="text-sm font-bold text-[#151c27]">Compliance Reports</p>
        </div>
        <div className="p-4 grid grid-cols-2 sm:grid-cols-5 gap-2">
          {REPORT_LINKS.map(r => (
            <button key={r.label}
              onClick={() => downloadReport(r.to, r.label)}
              className="flex flex-col items-center gap-2 p-3 rounded-lg border border-[#e2e0f0] hover:bg-[#f0f3ff] hover:border-[#3525cd]/30 transition-all text-center">
              <r.icon size={18} className="text-[#3525cd]" />
              <span className="text-xs font-semibold text-[#464555]">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Pending Returns */}
      <div className="bg-white rounded-xl border border-[#e2e0f0] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[#f0f3ff] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={15} className="text-[#3525cd]" />
            <p className="text-sm font-bold text-[#151c27]">Compliance Returns</p>
          </div>
          <Link to={`${basePath}/statutory/returns`} className="text-xs font-bold text-[#3525cd] flex items-center gap-1 hover:underline">
            Manage <ArrowRight size={12} />
          </Link>
        </div>

        {returns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 size={28} className="text-emerald-400 mb-2" />
            <p className="text-sm text-[#464555] font-semibold">All returns up to date</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#fafaff] border-b border-[#f0f3ff]">
                  {['Type','Period','Due Date','Status','Amount'].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-[0.65rem] font-black uppercase tracking-widest text-[#777587]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {returns.slice(0, 12).map(r => (
                  <tr key={r.id} className="border-b border-[#f9f9ff] hover:bg-[#fafaff]">
                    <td className="px-4 py-2.5 font-semibold text-[#151c27]">{r.return_type?.replace(/_/g,' ')}</td>
                    <td className="px-4 py-2.5 text-[#464555]">
                      {r.period_month ? `${MONTHS[r.period_month - 1]} ${r.period_year}` : r.financial_year || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[#464555]">
                      {r.due_date ? new Date(r.due_date).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-2.5 font-semibold text-[#151c27]">{r.amount ? fmt(r.amount) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
