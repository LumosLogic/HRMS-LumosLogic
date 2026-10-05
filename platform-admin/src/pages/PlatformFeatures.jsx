import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Building2, DollarSign, Receipt, Monitor, BarChart3,
  Target, FolderOpen, UserCheck, LogOut, Megaphone, ClipboardList,
  Shield, Clock, Timer, Bell, Calendar, ChevronDown, CheckCircle2,
  XCircle, Layers, Fingerprint, GitBranch, ScrollText, ShieldCheck,
} from 'lucide-react';
import { paGet, paPut } from '@/lib/platformApi';

// ── Feature Registry ──────────────────────────────────────────────────────────
const FEATURES = [
  // HR Management
  { key: 'announcements',   label: 'Announcements',     desc: 'Company announcements and broadcasts to all employees',      category: 'HR',          Icon: Megaphone },
  { key: 'regularization',  label: 'Regularization',    desc: 'Attendance regularization and correction requests',           category: 'HR',          Icon: ClipboardList },
  { key: 'leave_policies',  label: 'Leave Policies',    desc: 'Custom leave type policies and allocation configuration',     category: 'HR',          Icon: Shield },
  { key: 'shifts',          label: 'Shifts & Roster',   desc: 'Shift scheduling, roster management, and work patterns',      category: 'HR',          Icon: Clock },
  { key: 'onboarding',      label: 'Onboarding',        desc: 'Structured onboarding workflows for new employees',           category: 'HR',          Icon: UserCheck },
  { key: 'exit_management', label: 'Exit Management',   desc: 'Employee exit process, clearance, and offboarding',           category: 'HR',          Icon: LogOut },
  // Finance
  { key: 'payroll',         label: 'Payroll',           desc: 'Payroll processing, salary slips, and payslip management',    category: 'Finance',     Icon: DollarSign },
  { key: 'expenses',        label: 'Expenses',          desc: 'Employee expense claim submissions and approval workflow',     category: 'Finance',     Icon: Receipt },
  { key: 'assets',          label: 'Assets',            desc: 'Company asset tracking, assignment, and management',          category: 'Finance',     Icon: Monitor },
  { key: 'reports',         label: 'Reports',           desc: 'HR analytics, attendance reports, and data exports',          category: 'Finance',     Icon: BarChart3 },
  // People
  { key: 'performance',     label: 'Performance',       desc: 'Performance reviews, goal tracking, and appraisals',          category: 'People',      Icon: Target },
  { key: 'documents',       label: 'Documents',         desc: 'Employee document upload, storage, and access management',    category: 'People',      Icon: FolderOpen },
  // Integrations
  { key: 'google_calendar', label: 'Google Calendar',   desc: 'Sync approved leaves and events to Google Calendar',          category: 'Integration', Icon: Calendar },
  // System
  { key: 'push_notifications', label: 'Push Notifications', desc: 'Browser push alerts for leave updates and HR events',    category: 'System',      Icon: Bell },
  // Biometric
  { key: 'biometric', label: 'Biometric',  desc: 'ZKTeco device integration, punch logs, and biometric attendance', category: 'Biometric', Icon: Fingerprint },
  { key: 'branches',  label: 'Branches',   desc: 'Multi-branch organization structure and branch-level reporting',   category: 'Biometric', Icon: GitBranch },
  { key: 'statutory', label: 'Statutory',  desc: 'Statutory compliance fields — PF, ESI, UAN, PAN for employees',   category: 'Biometric', Icon: ScrollText },
  // Opt-in: never part of a plan or bulk toggle; Platform Admin must enable per organization.
  { key: 'bgv', label: 'Background Verification (BGV)', desc: 'SpringVerify background checks run manually by HR from the Documents verification queue (paid per request)', category: 'Integration', Icon: ShieldCheck, optIn: true },
];
const isOn = (f, flags) => (f.optIn ? flags[f.key] === true : flags[f.key] !== false);


const CATEGORY_ORDER = ['HR', 'Finance', 'People', 'Integration', 'System', 'Biometric'];
const CATEGORY_COLORS = {
  HR:          { bg: 'bg-[#f0f3ff]', text: 'text-[#3525cd]', border: 'border-[#c7c4d8]' },
  Finance:     { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  People:      { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  Integration: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  System:      { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' },
  Biometric:   { bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200' },
};

// ── Toggle Switch ─────────────────────────────────────────────────────────────
function Toggle({ enabled, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#3525cd]/30
        disabled:opacity-50 disabled:cursor-not-allowed
        ${enabled ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg
        transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

// ── Feature Card ──────────────────────────────────────────────────────────────
function FeatureCard({ feature, enabled, onChange, saving }) {
  const { Icon, label, desc, category } = feature;
  const cat = CATEGORY_COLORS[category] || CATEGORY_COLORS.HR;

  return (
    <div className={`bg-white rounded-xl border transition-all duration-200 p-4 flex items-start gap-4
      ${enabled ? 'border-[#c7c4d8]' : 'border-dashed border-[#c7c4d8] opacity-70'}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${enabled ? cat.bg : 'bg-[#f0f3ff]'}`}>
        <Icon size={18} className={enabled ? cat.text : 'text-[#777587]'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-[#151c27]">{label}</span>
            <span className={`text-[0.6rem] font-black px-1.5 py-0.5 rounded-full border uppercase tracking-wide ${cat.bg} ${cat.text} ${cat.border}`}>
              {category}
            </span>
          </div>
          <Toggle enabled={enabled} onChange={onChange} disabled={saving} />
        </div>
        <p className="text-xs text-[#777587] mt-1 leading-relaxed">{desc}</p>
        <div className="flex items-center gap-1 mt-2">
          {enabled
            ? <><CheckCircle2 size={11} className="text-emerald-500" /><span className="text-[0.68rem] font-semibold text-emerald-600">Enabled</span></>
            : <><XCircle size={11} className="text-[#777587]" /><span className="text-[0.68rem] font-semibold text-[#777587]">Disabled</span></>
          }
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PlatformFeatures() {
  const qc = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [localFlags,    setLocalFlags]    = useState({});
  const [savingKey,     setSavingKey]     = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Load all orgs for selector
  const { data: orgs = [] } = useQuery({
    queryKey: ['platform-orgs-list'],
    queryFn:  () => paGet('/organizations'),
  });

  // Load flags when org is selected
  const { data: flags = {}, isLoading: flagsLoading } = useQuery({
    queryKey: ['org-features', selectedOrgId],
    queryFn:  () => paGet(`/organizations/${selectedOrgId}/features`),
    enabled:  !!selectedOrgId,
  });

  useEffect(() => { if (flags && selectedOrgId) setLocalFlags(flags); }, [flags, selectedOrgId]);

  const saveMut = useMutation({
    mutationFn: ({ orgId, updates }) => paPut(`/organizations/${orgId}/features`, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-features', selectedOrgId] }),
  });

  async function handleToggle(featureKey, newValue) {
    setSavingKey(featureKey);
    setLocalFlags(prev => ({ ...prev, [featureKey]: newValue }));
    try {
      await saveMut.mutateAsync({ orgId: selectedOrgId, updates: { [featureKey]: newValue } });
    } catch {
      // Revert on error
      setLocalFlags(prev => ({ ...prev, [featureKey]: !newValue }));
    } finally {
      setSavingKey(null);
    }
  }

  function enableAll() {
    const all = {};
    FEATURES.filter(f => !f.optIn).forEach(f => { all[f.key] = true; });
    setLocalFlags(prev => ({ ...prev, ...all }));
    saveMut.mutate({ orgId: selectedOrgId, updates: all });
  }

  function disableAll() {
    const all = {};
    FEATURES.filter(f => !f.optIn).forEach(f => { all[f.key] = false; });
    setLocalFlags(prev => ({ ...prev, ...all }));
    saveMut.mutate({ orgId: selectedOrgId, updates: all });
  }

  const selectedOrg = orgs.find(o => String(o.id) === String(selectedOrgId));
  const activeCount  = FEATURES.filter(f => isOn(f, localFlags)).length;
  const totalCount   = FEATURES.length;

  const categories  = ['All', ...CATEGORY_ORDER];
  const visibleFeatures = categoryFilter === 'All'
    ? FEATURES
    : FEATURES.filter(f => f.category === categoryFilter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-[#3525cd]/10 flex items-center justify-center">
            <Zap size={18} className="text-[#3525cd]" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-[#151c27] tracking-tight">Feature Management</h1>
            <p className="text-sm text-[#777587]">Enable or disable modules per organization</p>
          </div>
        </div>
      </div>

      {/* Org Selector Card */}
      <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <Building2 size={16} className="text-[#3525cd] flex-shrink-0" />
          <label className="text-sm font-bold text-[#151c27]">Select Organization</label>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <select
              value={selectedOrgId}
              onChange={e => setSelectedOrgId(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2.5 border border-[#c7c4d8] rounded-lg text-sm font-medium
                bg-white text-[#151c27] outline-none focus:border-[#3525cd] focus:ring-2 focus:ring-[#3525cd]/20 cursor-pointer"
            >
              <option value="">— Choose an organization —</option>
              {orgs.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
          </div>

          {selectedOrgId && (
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <span className="text-xs text-[#777587] font-medium">
                {activeCount}/{totalCount} features active
              </span>
              <button onClick={enableAll}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                Enable All
              </button>
              <button onClick={disableAll}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors">
                Disable All
              </button>
            </div>
          )}
        </div>

        {/* Stats bar when org selected */}
        {selectedOrgId && (
          <div className="mt-4 pt-4 border-t border-[#f0f3ff]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-[#464555]">{selectedOrg?.name}</span>
              <span className="text-xs text-[#777587]">— {activeCount} of {totalCount} modules enabled</span>
            </div>
            <div className="h-2 bg-[#e7eefe] rounded-full overflow-hidden">
              <div
                className="h-2 rounded-full bg-[#3525cd] transition-all duration-500"
                style={{ width: `${(activeCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {!selectedOrgId ? (
        <div className="bg-white rounded-xl border border-dashed border-[#c7c4d8] py-20 text-center">
          <Layers size={36} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="text-sm font-semibold text-[#777587]">Select an organization to manage its features</p>
          <p className="text-xs text-[#777587] mt-1">You can enable or disable any module for any org independently</p>
        </div>
      ) : (
        <>
          {/* Category filter tabs */}
          <div className="flex gap-2 flex-wrap">
            {categories.map(cat => (
              <button key={cat} onClick={() => setCategoryFilter(cat)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all ${
                  categoryFilter === cat
                    ? 'bg-[#3525cd] text-white border-[#3525cd]'
                    : 'bg-white text-[#464555] border-[#c7c4d8] hover:bg-[#f0f3ff] hover:border-[#3525cd]/40'
                }`}>
                {cat}
                {cat !== 'All' && (
                  <span className="ml-1.5 opacity-70">
                    ({FEATURES.filter(f => f.category === cat && isOn(f, localFlags)).length}/{FEATURES.filter(f => f.category === cat).length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Feature cards grid */}
          {flagsLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 border-[#e7eefe] border-t-[#3525cd] animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {visibleFeatures.map(feature => (
                <FeatureCard
                  key={feature.key}
                  feature={feature}
                  enabled={isOn(feature, localFlags)}
                  onChange={val => handleToggle(feature.key, val)}
                  saving={savingKey === feature.key}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
