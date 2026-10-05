import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Building2, Users, ClipboardList, Clock, Globe,
  AtSign, Calendar, Mail, Briefcase, CheckCircle2, XCircle,
  Crown, Zap, Megaphone, DollarSign, Receipt, Monitor, BarChart3,
  Target, FolderOpen, UserCheck, LogOut, Shield, Timer, Bell,
  Layers, Activity, UserPlus, UserMinus, Fingerprint, GitBranch, ScrollText,
  Pencil, X, Save, Smartphone, ShieldCheck,
} from 'lucide-react';
import MobileAppTab from './MobileAppTab';
import { paGet, paPut, paPatch } from '@/lib/platformApi';

// ── Shared helpers ─────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
function initials(name = '') {
  return name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

function RoleBadge({ role }) {
  const map = {
    root_admin: { cls: 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]', label: 'Root Admin' },
    admin:      { cls: 'bg-amber-50 text-amber-700 border-amber-200',   label: 'HR Admin' },
    employee:   { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Employee' },
  };
  const s = map[role] || { cls: 'bg-[#f0f3ff] text-[#464555] border-[#c7c4d8]', label: role };
  return <span className={`px-2 py-0.5 rounded-full text-[0.65rem] font-bold border ${s.cls}`}>{s.label}</span>;
}

function StatusBadge({ status }) {
  const map = {
    active:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    inactive:  'bg-[#f0f3ff] text-[#464555] border-[#c7c4d8]',
    suspended: 'bg-rose-50 text-rose-700 border-rose-200',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize border ${map[status] || map.active}`}>
      {status || 'active'}
    </span>
  );
}

// ── Toggle switch ──────────────────────────────────────────────────────────────
function Toggle({ enabled, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={enabled} disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#3525cd]/30
        disabled:opacity-50 disabled:cursor-not-allowed
        ${enabled ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}>
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg
        transition duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

// ── Feature registry (same as PlatformFeatures) ───────────────────────────────
const FEATURES = [
  { key: 'announcements',      label: 'Announcements',       category: 'HR',          Icon: Megaphone },
  { key: 'regularization',     label: 'Regularization',      category: 'HR',          Icon: ClipboardList },
  { key: 'leave_policies',     label: 'Leave Policies',      category: 'HR',          Icon: Shield },
  { key: 'shifts',             label: 'Shifts & Roster',     category: 'HR',          Icon: Clock },
  { key: 'onboarding',         label: 'Onboarding',          category: 'HR',          Icon: UserCheck },
  { key: 'exit_management',    label: 'Exit Management',     category: 'HR',          Icon: LogOut },
  { key: 'payroll',            label: 'Payroll',             category: 'Finance',     Icon: DollarSign },
  { key: 'expenses',           label: 'Expenses',            category: 'Finance',     Icon: Receipt },
  { key: 'assets',             label: 'Assets',              category: 'Finance',     Icon: Monitor },
  { key: 'reports',            label: 'Reports',             category: 'Finance',     Icon: BarChart3 },
  { key: 'performance',        label: 'Performance',         category: 'People',      Icon: Target },
  { key: 'documents',          label: 'Documents',           category: 'People',      Icon: FolderOpen },
  { key: 'google_calendar',    label: 'Google Calendar',     category: 'Integration', Icon: Calendar },
  { key: 'push_notifications', label: 'Push Notifications',  category: 'System',      Icon: Bell },
  { key: 'biometric',          label: 'Biometric',           category: 'Biometric',   Icon: Fingerprint },
  { key: 'branches',           label: 'Branches',            category: 'Biometric',   Icon: GitBranch },
  { key: 'statutory',          label: 'Statutory',           category: 'Biometric',   Icon: ScrollText },
  // Opt-in: never part of a plan or bulk toggle; Platform Admin must enable per organization.
  { key: 'bgv',                label: 'Background Verification (BGV)', category: 'Integration', Icon: ShieldCheck, optIn: true },
];
const isOn = (f, flags) => (f.optIn ? flags[f.key] === true : flags[f.key] !== false);


const CAT_COLORS = {
  HR:          { bg: 'bg-[#f0f3ff]', text: 'text-[#3525cd]', border: 'border-[#c7c4d8]' },
  Finance:     { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  People:      { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  Integration: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  System:      { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' },
  Biometric:   { bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200' },
};

// ── Plan definitions (Items 4) ─────────────────────────────────────────────────
const PLANS = [
  {
    key: 'free',
    label: 'Free',
    color: '#777587',
    bg: 'bg-slate-50',
    border: 'border-slate-200',
    activeBorder: 'border-slate-400',
    activeFeatures: ['announcements', 'documents'],
    description: 'Basic access for small teams getting started',
    badge: null,
  },
  {
    key: 'gold',
    label: 'Gold',
    color: '#f59e0b',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    activeBorder: 'border-amber-400',
    activeFeatures: ['announcements', 'regularization', 'leave_policies', 'documents', 'reports', 'performance', 'payroll', 'shifts'],
    description: 'Full HR suite for growing organizations',
    badge: '⭐',
  },
  {
    key: 'platinum',
    label: 'Platinum',
    color: '#3525cd',
    bg: 'bg-[#f0f3ff]',
    border: 'border-[#c7c4d8]',
    activeBorder: 'border-[#3525cd]',
    activeFeatures: FEATURES.filter(f => !f.optIn).map(f => f.key),
    description: 'Complete platform access with all integrations',
    badge: '👑',
  },
];

// ── Activity event meta ────────────────────────────────────────────────────────
const ACT_META = {
  org_request_submitted: { icon: <Building2 size={13} />, color: '#d97706', bg: 'bg-amber-50',   border: 'border-amber-200',   label: 'Request Submitted' },
  org_approved:          { icon: <CheckCircle2 size={13} />, color: '#059669', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Org Approved' },
  org_rejected:          { icon: <XCircle size={13} />,   color: '#dc2626', bg: 'bg-rose-50',    border: 'border-rose-200',    label: 'Org Rejected' },
  org_created:           { icon: <Building2 size={13} />, color: '#3525cd', bg: 'bg-[#f0f3ff]',  border: 'border-[#c7c4d8]',  label: 'Org Created' },
  member_added:          { icon: <UserPlus size={13} />,  color: '#10b981', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Member Added' },
  member_removed:        { icon: <UserMinus size={13} />, color: '#ef4444', bg: 'bg-rose-50',    border: 'border-rose-200',    label: 'Member Removed' },
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PlatformOrgDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [activeTab,   setActiveTab]   = useState('overview');
  const [featureView, setFeatureView] = useState('web'); // 'web' | 'mobile' (sub-view of the Features tab)
  const [localFlags,  setLocalFlags]  = useState({});
  const [savingKey,   setSavingKey]   = useState(null);
  const [planSaving,  setPlanSaving]  = useState(false);
  const [editingOrg,  setEditingOrg]  = useState(false);
  const [editName,    setEditName]    = useState('');
  const [editSlug,    setEditSlug]    = useState('');
  const [editErr,     setEditErr]     = useState('');

  // Org + members
  const { data: orgData, isLoading } = useQuery({
    queryKey: ['platform-org-members', id],
    queryFn: () => paGet(`/organizations/${id}/members`),
    enabled: !!id,
  });
  const { org, members = [], stats = {} } = orgData || {};

  // Features
  const { data: flags = {}, isLoading: flagsLoading } = useQuery({
    queryKey: ['org-features', id],
    queryFn: () => paGet(`/organizations/${id}/features`),
    enabled: !!id,
  });
  useEffect(() => { if (flags && id) setLocalFlags(flags); }, [flags, id]);

  // Per-org activity
  const { data: orgActivity = [] } = useQuery({
    queryKey: ['org-activity', id],
    queryFn: () => paGet('/activity', { orgId: id, limit: 50 }),
    enabled: !!id && activeTab === 'activity',
  });

  // Feature toggle
  const saveMut = useMutation({
    mutationFn: ({ updates }) => paPut(`/organizations/${id}/features`, updates),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-features', id] }),
  });

  async function handleToggle(featureKey, newValue) {
    setSavingKey(featureKey);
    setLocalFlags(prev => ({ ...prev, [featureKey]: newValue }));
    try {
      await saveMut.mutateAsync({ updates: { [featureKey]: newValue } });
    } catch {
      setLocalFlags(prev => ({ ...prev, [featureKey]: !newValue }));
    } finally { setSavingKey(null); }
  }

  function bulkFeatures(all) {
    const updates = {};
    FEATURES.filter(f => !f.optIn).forEach(f => { updates[f.key] = all; });
    setLocalFlags(prev => ({ ...prev, ...updates }));
    saveMut.mutate({ updates });
  }

  // Org name / slug edit
  const editMut = useMutation({
    mutationFn: (body) => paPatch(`/organizations/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform-org-members', id] });
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      setEditingOrg(false);
      setEditErr('');
    },
    onError: (err) => setEditErr(err.message),
  });

  function openEdit() {
    setEditName(org?.name || '');
    setEditSlug(org?.slug || '');
    setEditErr('');
    setEditingOrg(true);
  }

  function handleSlugInput(val) {
    setEditSlug(val.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'));
  }

  function saveEdit() {
    if (!editName.trim()) { setEditErr('Name is required'); return; }
    if (!editSlug.trim()) { setEditErr('Slug is required'); return; }
    editMut.mutate({ name: editName.trim(), slug: editSlug.trim() });
  }

  // Plan change
  async function applyPlan(planKey) {
    setPlanSaving(true);
    try {
      await paPatch(`/organizations/${id}/plan`, { plan: planKey });
      qc.invalidateQueries({ queryKey: ['org-features', id] });
      qc.invalidateQueries({ queryKey: ['platform-org-members', id] });
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
    } catch { /* handled silently */ }
    finally { setPlanSaving(false); }
  }

  const activeCount = FEATURES.filter(f => isOn(f, localFlags)).length;
  const currentPlan = (org?.plan || 'free').toLowerCase();

  const TABS = [
    { id: 'overview',  label: 'Overview',  Icon: Building2 },
    { id: 'members',   label: `Members (${members.length})`, Icon: Users },
    { id: 'features',  label: 'Features',  Icon: Zap },
    { id: 'plan',      label: 'Plan',      Icon: Crown },
    { id: 'activity',  label: 'Activity',  Icon: Activity },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[#e7eefe] border-t-[#3525cd] rounded-full animate-spin" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="text-center py-24">
        <p className="text-[#777587] font-semibold">Organization not found.</p>
        <button onClick={() => navigate('/orgs')} className="text-[#3525cd] text-sm mt-2 hover:underline">← Back to Organizations</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Back + Header */}
      <div>
        <button onClick={() => navigate('/orgs')}
          className="flex items-center gap-2 text-sm font-semibold text-[#464555] hover:text-[#3525cd] transition-colors mb-4">
          <ArrowLeft size={15} /> Back to Organizations
        </button>

        {/* Org hero card */}
        <div className="bg-white rounded-2xl border border-[#e7eefe] p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-black text-white flex-shrink-0"
              style={{ background: `hsl(${(org.id * 47) % 360}, 65%, 45%)` }}>
              {org.name?.charAt(0).toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              {editingOrg ? (
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[0.65rem] font-bold text-[#777587] uppercase tracking-wide mb-1">Organization Name</label>
                    <input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm border border-[#c7c4d8] text-[#151c27] bg-white focus:outline-none focus:border-[#3525cd] focus:ring-2 focus:ring-[#3525cd]/20 transition-all"
                      placeholder="Organization name"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[0.65rem] font-bold text-[#777587] uppercase tracking-wide mb-1">Slug (URL identifier)</label>
                    <input
                      value={editSlug}
                      onChange={e => handleSlugInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm font-mono border border-[#c7c4d8] text-[#151c27] bg-white focus:outline-none focus:border-[#3525cd] focus:ring-2 focus:ring-[#3525cd]/20 transition-all"
                      placeholder="org-slug"
                    />
                    <p className="text-[0.6rem] text-[#777587] mt-1">Lowercase letters, numbers and hyphens only. Users need to re-login after slug change.</p>
                  </div>
                  {editErr && <p className="text-xs text-rose-600 font-semibold">{editErr}</p>}
                  <div className="flex gap-2">
                    <button onClick={saveEdit} disabled={editMut.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-[#3525cd] hover:bg-[#4f46e5] disabled:opacity-50 transition-all">
                      <Save size={12} /> {editMut.isPending ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button onClick={() => { setEditingOrg(false); setEditErr(''); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#464555] border border-[#c7c4d8] hover:bg-[#f0f3ff] transition-all">
                      <X size={12} /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <h1 className="text-xl font-black text-[#151c27] tracking-tight">{org.name}</h1>
                    <StatusBadge status={org.status} />
                    <span className="text-xs font-bold capitalize px-2.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                      {currentPlan}
                    </span>
                    <button onClick={openEdit}
                      className="flex items-center gap-1 text-[0.68rem] font-semibold text-[#777587] hover:text-[#3525cd] border border-[#c7c4d8] rounded-lg px-2 py-0.5 hover:border-[#3525cd] transition-all">
                      <Pencil size={10} /> Edit
                    </button>
                  </div>
                  {org.domain && <p className="text-sm text-[#777587]">{org.domain}</p>}
                  <code className="text-xs text-[#777587] font-mono">{org.slug}</code>
                </>
              )}
            </div>
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-[#f0f3ff]">
            {[
              { label: 'Members',    value: members.length,            cls: 'text-[#3525cd]',  bg: 'bg-[#f0f3ff]',  Icon: Users },
              { label: 'Leaves',     value: stats.leaveCount ?? 0,    cls: 'text-amber-600',  bg: 'bg-amber-50',   Icon: ClipboardList },
              { label: 'Attendance', value: stats.attendanceCount ?? 0, cls: 'text-emerald-600', bg: 'bg-emerald-50', Icon: Clock },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className={`w-9 h-9 rounded-xl ${s.bg} flex items-center justify-center mx-auto mb-1.5 ${s.cls}`}>
                  <s.Icon size={15} />
                </div>
                <div className="text-xl font-black text-[#151c27]">{s.value}</div>
                <div className="text-[0.62rem] text-[#777587] uppercase tracking-widest font-semibold">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-1 rounded-xl">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              activeTab === t.id ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'
            }`}>
            <t.Icon size={13} /> <span className="hidden sm:inline">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <div className="bg-white rounded-2xl border border-[#e7eefe] p-5">
          <h3 className="text-sm font-black text-[#151c27] mb-4">Organization Details</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { Icon: Crown,        label: 'Plan',          value: currentPlan },
              { Icon: Calendar,     label: 'Created',       value: fmtDate(org.created_at) },
              { Icon: ClipboardList, label: 'Annual Leaves', value: org.total_annual_leaves ?? '—' },
              { Icon: Globe,        label: 'Domain',        value: org.domain || '—' },
              { Icon: AtSign,       label: 'SMTP',          value: org.smtp_user || '—' },
              { Icon: Calendar,     label: 'Google Calendar', value: org.google_calendar_id ? '✓ Connected' : '—' },
              { Icon: Zap,          label: 'Features Active', value: `${activeCount} / ${FEATURES.length}` },
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-[#f9f9ff] border border-[#e7eefe]">
                <div className="w-7 h-7 rounded-lg bg-white border border-[#e7eefe] flex items-center justify-center flex-shrink-0">
                  <item.Icon size={13} className="text-[#777587]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[0.6rem] text-[#777587] uppercase tracking-widest font-bold">{item.label}</p>
                  <p className="text-xs text-[#151c27] font-semibold mt-0.5 truncate capitalize">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Members tab ── */}
      {activeTab === 'members' && (
        <div className="bg-white rounded-2xl border border-[#e7eefe] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff]">
            <h3 className="text-sm font-black text-[#151c27]">Members ({members.length})</h3>
          </div>
          {members.length === 0 ? (
            <p className="text-sm text-[#777587] text-center py-12">No members yet</p>
          ) : (
            <div className="divide-y divide-[#f0f3ff]">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#f9f9ff] transition-colors">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white flex-shrink-0"
                    style={{ background: m.avatar_color || '#3525cd' }}>
                    {initials(m.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-bold text-[#151c27] truncate">{m.name}</span>
                      <RoleBadge role={m.role} />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-[#777587]">
                      <Mail size={11} className="flex-shrink-0" />
                      <span className="truncate">{m.email}</span>
                    </div>
                    {(m.department || m.position) && (
                      <div className="flex items-center gap-1 mt-0.5 text-[0.65rem] text-[#777587]">
                        <Briefcase size={10} className="flex-shrink-0" />
                        {[m.position, m.department].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-[0.6rem] text-[#c7c4d8] uppercase tracking-wider">Joined</p>
                    <p className="text-[0.65rem] text-[#777587] font-semibold">{fmtDate(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Features tab ── */}
      {activeTab === 'features' && (
        <div className="space-y-4">
          {/* Sub-view switch: web modules vs mobile app access */}
          <div className="inline-flex p-1 rounded-xl bg-[#e7eefe] border border-[#c7c4d8]">
            {[{ k: 'web', label: 'Web Modules', Icon: Zap }, { k: 'mobile', label: 'Mobile App', Icon: Smartphone }].map(v => (
              <button key={v.k} onClick={() => setFeatureView(v.k)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${featureView === v.k ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'}`}>
                <v.Icon size={13} /> {v.label}
              </button>
            ))}
          </div>
          {featureView === 'mobile' ? <MobileAppTab orgId={id} /> : (<>
          {/* Header controls */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-bold text-[#151c27]">{activeCount} / {FEATURES.length} features active</p>
              <div className="h-1.5 w-48 bg-[#e7eefe] rounded-full mt-1.5 overflow-hidden">
                <div className="h-full rounded-full bg-[#3525cd] transition-all duration-500"
                  style={{ width: `${(activeCount / FEATURES.length) * 100}%` }} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => bulkFeatures(true)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                Enable All
              </button>
              <button onClick={() => bulkFeatures(false)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 transition-colors">
                Disable All
              </button>
            </div>
          </div>

          {flagsLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 rounded-full border-2 border-[#e7eefe] border-t-[#3525cd] animate-spin" />
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {FEATURES.map(f => {
                const enabled = isOn(f, localFlags);
                const cat = CAT_COLORS[f.category] || CAT_COLORS.HR;
                return (
                  <div key={f.key} className={`bg-white rounded-xl border p-4 flex items-center gap-3 transition-all ${enabled ? 'border-[#c7c4d8]' : 'border-dashed border-[#c7c4d8] opacity-70'}`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${enabled ? cat.bg : 'bg-[#f0f3ff]'}`}>
                      <f.Icon size={16} className={enabled ? cat.text : 'text-[#777587]'} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#151c27]">{f.label}</p>
                      <span className={`text-[0.6rem] font-black px-1.5 py-0.5 rounded-full border uppercase tracking-wide ${cat.bg} ${cat.text} ${cat.border}`}>
                        {f.category}
                      </span>
                    </div>
                    <Toggle enabled={enabled} onChange={v => handleToggle(f.key, v)} disabled={savingKey === f.key} />
                  </div>
                );
              })}
            </div>
          )}
          </>)}
        </div>
      )}

      {/* ── Plan tab ── */}
      {activeTab === 'plan' && (
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-black text-[#151c27] mb-0.5">Subscription Plan</h3>
            <p className="text-xs text-[#777587]">Changing the plan will automatically enable / disable the corresponding features.</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4">
            {PLANS.map(plan => {
              const isCurrent = currentPlan === plan.key;
              return (
                <div key={plan.key}
                  className={`bg-white rounded-2xl border-2 p-5 transition-all ${isCurrent ? plan.activeBorder + ' shadow-md' : plan.border}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                        style={{ background: plan.color + '20' }}>
                        <Crown size={15} style={{ color: plan.color }} />
                      </div>
                      <span className="text-base font-black text-[#151c27]">
                        {plan.badge && <span className="mr-1">{plan.badge}</span>}{plan.label}
                      </span>
                    </div>
                    {isCurrent && (
                      <span className="text-[0.6rem] font-black px-2 py-0.5 rounded-full uppercase tracking-wider text-white"
                        style={{ background: plan.color }}>
                        Current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#777587] mb-4 leading-relaxed">{plan.description}</p>
                  <div className="mb-4">
                    <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest mb-2">
                      {plan.activeFeatures.length} features included
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {FEATURES.filter(f => plan.activeFeatures.includes(f.key)).map(f => (
                        <span key={f.key} className="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded-md bg-[#f0f3ff] text-[#464555] border border-[#e7eefe]">
                          {f.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => !isCurrent && applyPlan(plan.key)}
                    disabled={isCurrent || planSaving}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      isCurrent
                        ? 'bg-[#f0f3ff] text-[#777587]'
                        : 'text-white hover:opacity-90'
                    }`}
                    style={!isCurrent ? { background: plan.color } : {}}>
                    {planSaving ? 'Applying…' : isCurrent ? 'Active Plan' : `Switch to ${plan.label}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Activity tab ── */}
      {activeTab === 'activity' && (
        <div className="bg-white rounded-2xl border border-[#e7eefe] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#f0f3ff]">
            <h3 className="text-sm font-black text-[#151c27]">Organization Activity</h3>
            <p className="text-xs text-[#777587] mt-0.5">Member join / leave events for this organization</p>
          </div>
          {orgActivity.length === 0 ? (
            <div className="text-center py-12">
              <Layers size={28} className="mx-auto mb-2 text-[#c7c4d8]" />
              <p className="text-xs text-[#777587] font-semibold">No activity recorded yet</p>
              <p className="text-[0.65rem] text-[#777587] mt-1">Member add/remove events will appear here</p>
            </div>
          ) : (
            <div className="relative">
              <div className="absolute left-[2.75rem] top-0 bottom-0 w-px bg-[#f0f3ff]" />
              <div className="divide-y divide-[#f0f3ff]">
                {orgActivity.map(ev => {
                  const meta = ACT_META[ev.event_type] || { icon: <Activity size={13} />, color: '#777587', bg: 'bg-[#f0f3ff]', border: 'border-[#c7c4d8]', label: ev.event_type };
                  return (
                    <div key={ev.id} className="flex gap-4 px-5 py-4 hover:bg-[#f9f9ff] transition-colors">
                      <div className={`relative z-10 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 border ${meta.bg} ${meta.border}`}
                        style={{ color: meta.color }}>
                        {meta.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#151c27]">{ev.description}</p>
                        {ev.metadata?.name && (
                          <p className="text-xs text-[#777587] mt-0.5">{ev.metadata.name} · {ev.metadata.email}</p>
                        )}
                      </div>
                      <span className="text-xs text-[#c7c4d8] whitespace-nowrap flex-shrink-0 mt-0.5">{fmtDateTime(ev.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
