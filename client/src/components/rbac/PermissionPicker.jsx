import React, { useMemo, useState } from 'react';
import { Search, X, AlertCircle, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeature } from '@/context/FeatureFlagContext';

// Tooltips for ambiguous permission actions
const PERMISSION_TOOLTIPS = {
  'payroll:lock':                     'Locks a finalised payroll run to prevent further edits. Use before distributing payslips.',
  'payroll:approve':                  'Final sign-off on a payroll run — marks it ready for payment processing.',
  'payroll:generate':                 'Runs the payroll engine to compute salaries, deductions, and net pay for a period.',
  'payroll:manage_adjustments':       'Add one-time bonuses, deductions, or corrections to individual employee payslips.',
  'payroll:verify':                   'Second-level review step — confirms calculations before the approver acts.',
  'payroll:export':                   'Download payroll summaries, payslips, and salary data for external processing.',
  'attendance:manage_structures':     'Edit shift schedules, work-week rules, and attendance policies org-wide.',
  'attendance:approve_regularization':'Approve or reject employee requests to correct their own attendance records.',
  'employees:delete':                 'Permanently removes an employee record and all associated data. Cannot be undone.',
  'roles:manage':                     'Full control over role permissions — effectively allows granting any permission to anyone.',
  'reports:export':                   'Download all HR data as CSV/Excel, including payroll figures and personal details.',
  'announcements:broadcast':          'Send a push notification to all employees simultaneously.',
  'leaves:forward':                   'Forward a leave request to the next approver (e.g. Dept Head → Root Admin).',
  'assets:assign':                    'Assign company assets (laptops, phones, etc.) to specific employees.',
  'settings:manage':                  'Change org-wide settings: work schedules, attendance rules, and integrations.',
  'biometric:manage':                 'Configure and manage biometric device connections and data sync settings.',
  'biometric:upload':                 'Upload historical attendance data from biometric device exports.',
  'onboarding:manage':                'Create, edit, and delete onboarding task templates for new joiners.',
  'payroll:logs':                     'View a full audit trail of payroll changes, approvals, and modifications.',
};

// High-risk permissions need a confirmation step when newly granted
const HIGH_RISK_ACTIONS = new Set(['delete', 'lock']);
const HIGH_RISK_COMBOS  = new Set(['payroll:approve', 'payroll:generate', 'employees:delete', 'roles:manage', 'attendance:delete']);

function isHighRisk(perm) {
  if (!perm) return false;
  return HIGH_RISK_ACTIONS.has(perm.action) || HIGH_RISK_COMBOS.has(`${perm.module_key}:${perm.action}`);
}

export const MODULE_LABELS = {
  dashboard:     'Dashboard',
  employees:     'Employees',
  departments:   'Departments',
  designations:  'Designations',
  attendance:    'Attendance',
  leaves:        'Leaves',
  payroll:       'Payroll',
  reports:       'Reports',
  settings:      'Settings',
  documents:     'Documents',
  onboarding:    'Onboarding',
  announcements: 'Announcements',
  holidays:      'Holidays',
  shifts:        'Shifts & Roster',
  biometric:     'Biometric',
  branches:      'Branches',
  assets:        'Assets',
  expenses:      'Expenses',
  performance:   'Performance',
  exit:          'Exit Management',
  roles:         'Role Management',
  team:          'My Team (Manager / HOD)',
  notifications: 'Notifications',
};
const MODULE_ORDER = Object.keys(MODULE_LABELS);

/** Flatten the GET /permissions catalog ([{module_key, permissions:[…]}]) into one array. */
export function flattenCatalog(modulesRaw) {
  return (Array.isArray(modulesRaw) ? modulesRaw : []).flatMap(m =>
    Array.isArray(m?.permissions) ? m.permissions.map(p => ({ ...p, module_key: m.module_key })) : []
  );
}

/**
 * PermissionPicker — module-grouped permission checklist backed by the existing permission catalog.
 *
 *   catalog      GET /permissions response
 *   selectedIds  Set of permission ids
 *   onChange     (nextSet) => void
 *   readOnly     show the checklist without allowing edits (system roles)
 */
export default function PermissionPicker({ catalog, selectedIds, onChange, readOnly = false }) {
  const biometricEnabled = useFeature('biometric');
  const [search, setSearch]       = useState('');
  const [riskConfirm, setRiskConfirm] = useState(null);

  const all = useMemo(
    () => flattenCatalog(catalog).filter(p => p.module_key !== 'biometric' || biometricEnabled),
    [catalog, biometricEnabled]
  );

  const q = search.trim().toLowerCase();
  const visible = q
    ? all.filter(p =>
        (p.label || '').toLowerCase().includes(q) ||
        (p.action || '').toLowerCase().includes(q) ||
        (MODULE_LABELS[p.module_key] || p.module_key || '').toLowerCase().includes(q))
    : all;

  const modules = [...new Set(visible.map(p => p.module_key))].sort((a, b) => {
    const ai = MODULE_ORDER.indexOf(a), bi = MODULE_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Count only ids that exist in the (feature-filtered) catalog
  const enabledCount = all.filter(p => selectedIds.has(p.id)).length;

  function setMany(perms, checked) {
    const next = new Set(selectedIds);
    perms.forEach(p => (checked ? next.add(p.id) : next.delete(p.id)));
    onChange(next);
  }

  function toggle(perm) {
    if (readOnly) return;
    const checked = !selectedIds.has(perm.id);
    if (checked && isHighRisk(perm)) { setRiskConfirm(perm); return; }
    setMany([perm], checked);
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search permissions…"
            className="w-full pl-8 pr-8 py-2 text-xs border border-[#c7c4d8] rounded-lg focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#464555]">
              <X size={12} />
            </button>
          )}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 text-xs font-bold">
            <button type="button" onClick={() => setMany(visible, true)} className="text-[#3525cd] hover:underline">Select All</button>
            <span className="text-[#c7c4d8]">·</span>
            <button type="button" onClick={() => setMany(visible, false)} className="text-[#777587] hover:underline">Deselect All</button>
          </div>
        )}
        <span className="ml-auto text-xs font-semibold text-[#464555]">
          {enabledCount} of {all.length} permissions enabled
        </span>
      </div>

      {/* Modules */}
      <div className="space-y-3">
        {modules.length === 0 && (
          <p className="text-center py-8 text-sm text-[#777587]">
            {q ? <>No permissions match "<strong>{search}</strong>"</> : 'No permissions available.'}
          </p>
        )}
        {modules.map(mod => {
          const perms   = visible.filter(p => p.module_key === mod);
          const checked = perms.filter(p => selectedIds.has(p.id)).length;
          return (
            <div key={mod} className="bg-white border border-[#e7eefe] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 bg-[#f9f9ff] border-b border-[#e7eefe]">
                <span className="font-bold text-sm text-[#151c27]">{MODULE_LABELS[mod] || mod}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[0.65rem] font-semibold text-[#777587]">{checked}/{perms.length}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setMany(perms, checked !== perms.length)}
                      className="text-[0.7rem] font-bold text-[#3525cd] hover:underline"
                    >
                      {checked === perms.length ? 'Clear' : 'All'}
                    </button>
                  )}
                </div>
              </div>
              <div className="p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-2">
                {perms.map(p => {
                  const on = selectedIds.has(p.id);
                  const tip = PERMISSION_TOOLTIPS[`${p.module_key}:${p.action}`];
                  return (
                    <label
                      key={p.id}
                      title={tip}
                      className={cn(
                        'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[0.8rem] select-none',
                        readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-[#f0f3ff]',
                        on ? 'text-[#151c27] font-semibold' : 'text-[#464555]'
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={readOnly}
                        onChange={() => toggle(p)}
                        className="w-4 h-4 accent-[#3525cd] flex-shrink-0"
                      />
                      <span className="truncate">{p.label || `${p.action} ${p.module_key}`}</span>
                      {isHighRisk(p) && <span className="ml-auto text-[0.6rem] font-bold text-rose-500 uppercase">Sensitive</span>}
                      {readOnly && on && <Lock size={11} className="ml-auto text-[#c7c4d8]" />}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* High-risk confirmation */}
      {riskConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(4,6,14,.6)', backdropFilter: 'blur(4px)' }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-[#c7c4d8] p-6">
            <div className="w-11 h-11 rounded-2xl bg-rose-50 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={22} className="text-rose-500" />
            </div>
            <h3 className="font-black text-[#151c27] text-center mb-1">Grant Sensitive Permission?</h3>
            <p className="text-xs text-center mb-1"><span className="font-bold text-[#151c27]">{riskConfirm.label}</span></p>
            <p className="text-xs text-[#777587] text-center mb-5">
              This is a high-risk permission and gives broad or irreversible access. Enable it for this role?
            </p>
            <div className="flex gap-2.5">
              <button onClick={() => setRiskConfirm(null)}
                className="flex-1 border border-[#c7c4d8] rounded-lg py-2.5 text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff]">Cancel</button>
              <button onClick={() => { setMany([riskConfirm], true); setRiskConfirm(null); }}
                className="flex-1 bg-rose-500 text-white rounded-lg py-2.5 text-sm font-bold hover:bg-rose-600">Yes, Grant Access</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
