import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Umbrella, FileText, Megaphone, ArrowRight, X } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

const SYSTEM_MODULES = [
  { name: 'My Leaves', description: 'View leave history, leave balances, and request status', path: '/portal/leaves', forEmployee: true },
  { name: 'Apply Leave', description: 'Submit a new leave or WFH application', path: '/portal/leaves?action=apply', forEmployee: true },
  { name: 'Leave Balance', description: 'Check remaining annual, sick, and casual leave quotas', path: '/portal/leaves', forEmployee: true },
  { name: 'My Attendance', description: 'Check-in/out logs, work hours, and daily status', path: '/portal/attendance', forEmployee: true },
  { name: 'Attendance Correction / Regularization', description: 'Request attendance regularization for missed check-ins', path: '/portal/regularization', forEmployee: true },
  { name: 'My Expenses', description: 'View and submit expense claims and receipts', path: '/portal/expenses', forEmployee: true },
  { name: 'Submit Expense Claim', description: 'Upload receipts and claim work-related expenses', path: '/portal/expenses?action=apply', forEmployee: true },
  { name: 'My Payslips & Payroll', description: 'Download monthly payslips and salary statements', path: '/portal/payslips', forEmployee: true },
  { name: 'My Documents', description: 'Access organization policies, contracts, and letters', path: '/portal/documents', forEmployee: true },
  { name: 'My Profile', description: 'View personal details, bank info, and emergency contacts', path: '/portal/profile', forEmployee: true },

  { name: 'Leave Management', description: 'Review and approve employee leave applications', path: '/leaves', forAdmin: true },
  { name: 'Leave Balances & Policies', description: 'View org-wide leave balances and policies', path: '/leaves', forAdmin: true },
  { name: 'Attendance Management', description: 'Monitor daily employee attendance and logs', path: '/attendance', forAdmin: true },
  { name: 'Regularization Requests', description: 'Approve employee attendance regularization requests', path: '/regularization', forAdmin: true },
  { name: 'Expense Claims', description: 'Review and approve employee expense claims', path: '/expenses', forAdmin: true },
  { name: 'Employee Directory', description: 'Manage employee profiles, roles, and departments', path: '/employees', forAdmin: true },
  { name: 'Payroll & Reports', description: 'Generate salary slips and payroll summaries', path: '/payroll', forAdmin: true },
  { name: 'Document Center', description: 'Upload and share organization documents', path: '/documents', forAdmin: true },
  { name: 'Company Calendar & Holidays', description: 'Manage holidays, shifts, and company events', path: '/calendar', forAdmin: true },
  { name: 'Organization Settings', description: 'Configure HR rules, shifts, and integrations', path: '/settings', forAdmin: true },
  { name: 'Branches', description: 'Manage office branches, locations, and HR access assignments', path: '/branches', forAdmin: true },
  { name: 'Branch Management', description: 'Add or edit branch details and assign HR administrators', path: '/branches', forAdmin: true },
];

export function GlobalSearchModal({ open, onClose }) {
  const { isEmployee, isRootAdmin } = useAuth();
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState({ modules: [], employees: [], leaves: [], documents: [], announcements: [] });
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // ESC to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Clear query every time modal closes
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  // Clear results when modal closes or query is empty
  useEffect(() => {
    if (!query.trim() || !open) {
      setResults({ modules: [], employees: [], leaves: [], documents: [], announcements: [] });
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const q = query.toLowerCase().trim();

        const matchingModules = SYSTEM_MODULES.filter(m => {
          const roleOk = isEmployee ? m.forEmployee : m.forAdmin;
          return roleOk && (m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q));
        }).slice(0, 4);

        if (isEmployee) {
          // Employee: search only own data
          const [lvs, docs, anns] = await Promise.all([
            apiGet('/leaves').catch(() => []),
            apiGet('/documents').catch(() => []),
            apiGet('/announcements').catch(() => []),
          ]);
          setResults({
            modules: matchingModules,
            employees: [],
            leaves: (lvs || []).filter(l =>
              l.leave_type?.toLowerCase().includes(q) ||
              l.reason?.toLowerCase().includes(q) ||
              l.status?.toLowerCase().includes(q)
            ).slice(0, 4),
            documents: (docs || []).filter(d =>
              d.name?.toLowerCase().includes(q) ||
              d.category?.toLowerCase().includes(q)
            ).slice(0, 4),
            announcements: (anns || []).filter(a =>
              a.title?.toLowerCase().includes(q) ||
              a.content?.toLowerCase().includes(q)
            ).slice(0, 4),
          });
        } else {
          // HR Admin / Root Admin: search all org data
          const [emps, lvs, docs, anns] = await Promise.all([
            apiGet('/employees').catch(() => []),
            apiGet('/leaves').catch(() => []),
            apiGet('/documents').catch(() => []),
            apiGet('/announcements').catch(() => []),
          ]);
          setResults({
            modules: matchingModules,
            employees: (emps || []).filter(e =>
              e.name?.toLowerCase().includes(q) ||
              e.email?.toLowerCase().includes(q) ||
              e.department?.toLowerCase().includes(q)
            ).slice(0, 4),
            leaves: (lvs || []).filter(l =>
              l.employee_name?.toLowerCase().includes(q) ||
              l.name?.toLowerCase().includes(q) ||
              l.leave_type?.toLowerCase().includes(q) ||
              l.reason?.toLowerCase().includes(q)
            ).slice(0, 4),
            documents: (docs || []).filter(d =>
              d.name?.toLowerCase().includes(q) ||
              d.title?.toLowerCase().includes(q) ||
              d.category?.toLowerCase().includes(q)
            ).slice(0, 4),
            announcements: (anns || []).filter(a =>
              a.title?.toLowerCase().includes(q) ||
              a.content?.toLowerCase().includes(q)
            ).slice(0, 4),
          });
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, open, isEmployee]);

  if (!open) return null;

  // Navigate based on role
  const basePaths = isEmployee
    ? { employees: '/portal/home', leaves: '/portal/leaves', documents: '/portal/documents', announcements: '/portal/announcements' }
    : { employees: '/employees',  leaves: '/leaves',         documents: '/documents',         announcements: '/announcements' };

  const handleSelect = (section, item) => {
    onClose();
    if (section === 'modules' && item?.path) {
      navigate(item.path);
    } else if (section === 'employees' && item?.id && !isEmployee) {
      navigate(`/employees?view=${item.id}`);
    } else if (section === 'documents' && item?.id) {
      navigate(`${basePaths.documents}?doc=${item.id}`);
    } else {
      navigate(basePaths[section]);
    }
  };

  const hasResults = results.modules.length > 0 || results.employees.length > 0 || results.leaves.length > 0 ||
                     results.documents.length > 0  || results.announcements.length > 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-20 px-4">
      <div className="fixed inset-0 bg-[#04060e]/60 backdrop-blur-xs transition-opacity" onClick={onClose} />
      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-[#c7c4d8] overflow-hidden flex flex-col z-10 animate-in fade-in zoom-in-95 duration-150">

        {/* Search input */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#e7eefe] gap-3">
          <Search size={18} className="text-[#3525cd] shrink-0" />
          <input
            autoFocus
            className="flex-1 bg-transparent border-none text-base font-medium text-[#151c27] placeholder-[#777587] focus:outline-none"
            placeholder={isEmployee
              ? 'Search your leaves, documents, announcements…'
              : 'Search employees, leaves, documents, announcements…'}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {loading && <span className="spinner w-4 h-4 shrink-0" />}
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#f0f3ff] text-[#777587] hover:text-[#151c27]">
            <X size={18} />
          </button>
        </div>

        {/* Role hint */}
        {!query.trim() && (
          <div className="px-4 py-2 bg-[#fafaff] border-b border-[#f0f3ff] flex items-center gap-2">
            <span className={`text-[0.6rem] font-black px-2 py-0.5 rounded-full border uppercase tracking-wider ${
              isEmployee ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]'
            }`}>
              {isEmployee ? 'Employee' : isRootAdmin ? 'Root Admin' : 'HR Admin'}
            </span>
            <span className="text-[0.68rem] text-[#777587]">
              {isEmployee ? 'Searching your personal workspace' : 'Searching all organization data'}
            </span>
          </div>
        )}

        <div className="max-h-96 overflow-y-auto p-4 divide-y divide-[#f0f3ff]">
          {!query.trim() && (
            <div className="py-8 text-center text-xs text-[#777587]">
              Type to search. Press <kbd className="px-1.5 py-0.5 rounded bg-[#f0f3ff] border border-[#c7c4d8] font-mono text-[0.65rem]">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-[#f0f3ff] border border-[#c7c4d8] font-mono text-[0.65rem]">K</kbd> anytime.
            </div>
          )}

          {query.trim() && !loading && !hasResults && (
            <div className="py-8 text-center text-xs text-[#777587]">
              No matching records found for <strong>"{query}"</strong>.
            </div>
          )}

          {/* Navigation / Modules */}
          {results.modules.length > 0 && (
            <div className="py-2.5">
              <div className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] flex items-center gap-1.5 mb-2">
                <Search size={12} className="text-[#3525cd]" /> Modules & Pages
              </div>
              <div className="space-y-1">
                {results.modules.map(m => (
                  <div key={m.name} onClick={() => handleSelect('modules', m)} className="flex items-center justify-between p-2 rounded-xl hover:bg-[#f0f3ff] cursor-pointer transition-colors group">
                    <div>
                      <div className="text-xs font-bold text-[#151c27] group-hover:text-[#3525cd]">{m.name}</div>
                      <div className="text-[0.65rem] text-[#777587]">{m.description}</div>
                    </div>
                    <ArrowRight size={14} className="text-[#c7c4d8] group-hover:text-[#3525cd] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Employees — admin/root only */}
          {results.employees.length > 0 && (
            <div className="py-2.5">
              <div className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] flex items-center gap-1.5 mb-2">
                <Users size={12} className="text-[#3525cd]" /> Employees
              </div>
              <div className="space-y-1">
                {results.employees.map(e => (
                  <div key={e.id} onClick={() => handleSelect('employees', e)} className="flex items-center justify-between p-2 rounded-xl hover:bg-[#f0f3ff] cursor-pointer transition-colors group">
                    <div>
                      <div className="text-xs font-bold text-[#151c27] group-hover:text-[#3525cd]">{e.name}</div>
                      <div className="text-[0.65rem] text-[#777587]">{e.department} · {e.email}</div>
                    </div>
                    <ArrowRight size={14} className="text-[#c7c4d8] group-hover:text-[#3525cd] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leaves */}
          {results.leaves.length > 0 && (
            <div className="py-2.5">
              <div className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] flex items-center gap-1.5 mb-2">
                <Umbrella size={12} className="text-amber-600" /> {isEmployee ? 'My Leave Requests' : 'Leave Requests'}
              </div>
              <div className="space-y-1">
                {results.leaves.map(l => (
                  <div key={l.id} onClick={() => handleSelect('leaves')} className="flex items-center justify-between p-2 rounded-xl hover:bg-[#f0f3ff] cursor-pointer transition-colors group">
                    <div>
                      <div className="text-xs font-bold text-[#151c27] group-hover:text-[#3525cd] capitalize">
                        {isEmployee ? l.leave_type : (l.employee_name || l.name)} {!isEmployee && `(${l.leave_type})`}
                      </div>
                      <div className="text-[0.65rem] text-[#777587]">{l.start_date} → {l.end_date} · {l.status}</div>
                    </div>
                    <ArrowRight size={14} className="text-[#c7c4d8] group-hover:text-[#3525cd] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Documents */}
          {results.documents.length > 0 && (
            <div className="py-2.5">
              <div className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] flex items-center gap-1.5 mb-2">
                <FileText size={12} className="text-indigo-600" /> {isEmployee ? 'My Documents' : 'Documents'}
              </div>
              <div className="space-y-1">
                {results.documents.map(d => (
                  <div key={d.id} onClick={() => handleSelect('documents', d)} className="flex items-center justify-between p-2 rounded-xl hover:bg-[#f0f3ff] cursor-pointer transition-colors group">
                    <div>
                      <div className="text-xs font-bold text-[#151c27] group-hover:text-[#3525cd]">{d.name || d.title}</div>
                      <div className="text-[0.65rem] text-[#777587]">{d.category || 'Company Doc'}</div>
                    </div>
                    <ArrowRight size={14} className="text-[#c7c4d8] group-hover:text-[#3525cd] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Announcements */}
          {results.announcements.length > 0 && (
            <div className="py-2.5">
              <div className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] flex items-center gap-1.5 mb-2">
                <Megaphone size={12} className="text-purple-600" /> Announcements
              </div>
              <div className="space-y-1">
                {results.announcements.map(a => (
                  <div key={a.id} onClick={() => handleSelect('announcements')} className="flex items-center justify-between p-2 rounded-xl hover:bg-[#f0f3ff] cursor-pointer transition-colors group">
                    <div>
                      <div className="text-xs font-bold text-[#151c27] group-hover:text-[#3525cd]">{a.title}</div>
                      <div className="text-[0.65rem] text-[#777587] line-clamp-1">{a.content}</div>
                    </div>
                    <ArrowRight size={14} className="text-[#c7c4d8] group-hover:text-[#3525cd] transition-colors" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
