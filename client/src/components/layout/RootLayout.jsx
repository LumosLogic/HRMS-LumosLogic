import React, { useState, useContext } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, FileText, Users, Settings, LogOut, ShieldCheck,
  UserCircle, Bell, Building2, ClipboardList, CalendarDays, Shield, Clock,
  DollarSign, Receipt, Monitor, BarChart3, Target, FolderOpen, UserCheck, Megaphone,
  Radio, Fingerprint, Link2, ScrollText, Menu, X, Search, KeyRound, Terminal,
  PieChart, Play, FileBarChart, IndianRupee, ShieldAlert, History,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { FeatureFlagContext, FeatureFlagsLoadedContext } from '@/context/FeatureFlagContext';
import { Header } from './Header';
import { initials, cn } from '@/lib/utils';
import { useTour } from '@/hooks/useTour';
import { rootAdminTourSteps } from '@/lib/tours';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { GlobalSearchModal } from '@/components/ui/GlobalSearchModal';
import { BranchSelector } from '@/components/layout/BranchSelector';

// ── Payroll sub-items (inside collapsible dropdown) ──────────────────────────
const ROOT_PAYROLL_SUB_ITEMS = [
  { to: '/root/payroll/dashboard', label: 'Payroll Dashboard',  Icon: PieChart     },
  { to: '/root/payroll/generate',  label: 'Payroll Generation', Icon: Play         },
  { to: '/root/payroll/reports',   label: 'Payroll Reports',    Icon: FileBarChart },
  { to: '/root/payroll/salary',    label: 'Salary Structures',  Icon: IndianRupee  },
  { to: '/root/payroll/settings',  label: 'Payroll Settings',   Icon: Settings     },
];

// ── Other finance items shown below the Payroll dropdown ─────────────────────
const ROOT_OTHER_FINANCE_ITEMS = [
  { to: '/root/statutory/compliance',   label: 'Compliance Dashboard', Icon: ShieldCheck, featureKey: 'payroll' },
  { to: '/root/statutory/config',       label: 'Statutory Config',     Icon: ShieldAlert, featureKey: 'payroll' },
  { to: '/root/statutory/declarations', label: 'Tax Declarations',     Icon: FileText,    featureKey: 'payroll' },
  { to: '/root/expenses', label: 'Expenses', Icon: Receipt },
  { to: '/root/assets',   label: 'Assets',   Icon: Monitor },
];

const NAV_SECTIONS = [
  { id: 'tour-nav-overview', title: 'Overview', items: [
    { to: '/root/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
    { to: '/root/reports',   label: 'Reports',   Icon: BarChart3 },
  ]},
  { id: 'tour-nav-hr', title: 'Workforce Management', items: [
    { to: '/root/employees',       label: 'Employees',        Icon: Users },
    { to: '/root/departments',     label: 'Departments',      Icon: Building2 },
    { to: '/root/branches',        label: 'Branches',         Icon: Building2, featureKey: 'branches' },
    { to: '/root/manage-hr',       label: 'Manage HR Admins', Icon: ShieldCheck },
    { to: '/root/onboarding',      label: 'Onboarding',       Icon: UserCheck },
    { to: '/root/exit-management', label: 'Exit Management',  Icon: LogOut },
  ]},
  { id: 'tour-nav-attendance', title: 'Attendance & Leave', items: [
    { to: '/root/calendar',       label: 'Calendar',        Icon: Calendar },
    { to: '/root/leaves',         label: 'Leaves',          Icon: FileText },
    { to: '/root/regularization', label: 'Regularization',  Icon: ClipboardList },
    { to: '/root/holidays',       label: 'Holidays',        Icon: CalendarDays },
    { to: '/root/leave-policies', label: 'Leave Policies',  Icon: Shield },
    { to: '/root/shifts',         label: 'Shifts & Roster', Icon: Clock },
  ]},
  { id: 'tour-nav-biometric', title: 'Biometric', items: [
    { to: '/root/biometric/devices',  label: 'Devices',     Icon: Fingerprint, featureKey: 'biometric' },
    { to: '/root/biometric/mapping',  label: 'PIN Mapping', Icon: Link2,       featureKey: 'biometric' },
    { to: '/root/biometric/logs',     label: 'Punch Logs',  Icon: ScrollText,  featureKey: 'biometric' },
    { to: '/root/biometric/historical-sync', label: 'Historical Sync', Icon: History,  featureKey: 'biometric' },
    { to: '/root/biometric/settings',        label: 'Settings',        Icon: Settings, featureKey: 'biometric' },
  ]},
  // Finance is handled by RootFinanceSection — this sentinel keeps the position
  { id: 'tour-nav-finance', title: null, items: [] },
  { id: 'tour-nav-people', title: 'Performance', items: [
    { to: '/root/performance', label: 'Performance', Icon: Target },
    { to: '/root/documents',   label: 'Documents',   Icon: FolderOpen },
  ]},
  { id: 'tour-nav-comms', title: 'Communication', items: [
    { to: '/root/announcements', label: 'Announcements', Icon: Megaphone },
    { to: '/root/broadcast',     label: 'Broadcast',     Icon: Radio },
    { to: '/root/notifications', label: 'Notifications', Icon: Bell, notifBadge: true },
  ]},
  { id: 'tour-nav-account', title: 'Administration', items: [
    { to: '/root/pending-approvals',  label: 'Pending Approvals',  Icon: ClipboardList },
    { to: '/root/roles',              label: 'Role Management',    Icon: KeyRound },
    { to: '/root/manage-root-admins', label: 'Manage Root Admins', Icon: Shield },
    { to: '/root/settings',           label: 'Settings',           Icon: Settings },
  ]},
];

// ── Shared nav link style ─────────────────────────────────────────────────────
const navLinkClass = ({ isActive }) => cn(
  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-150',
  isActive
    ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent font-bold'
    : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27] hover:border-[#c7c4d8]'
);

// ── Payroll collapsible dropdown (root admin) ─────────────────────────────────
function RootPayrollGroup({ onClose }) {
  const location      = useLocation();
  const featureFlags  = useContext(FeatureFlagContext);
  const flagsLoaded   = useContext(FeatureFlagsLoadedContext);

  const payrollEnabled = !flagsLoaded ? false : ('payroll' in featureFlags ? featureFlags['payroll'] : true);
  const payrollPaths   = ROOT_PAYROLL_SUB_ITEMS.map(i => i.to);
  const isChildActive  = payrollPaths.some(p => location.pathname.startsWith(p));

  // All hooks must be called before any conditional return
  const [open, setOpen] = useState(isChildActive);

  if (!payrollEnabled) return null;

  return (
    <div>
      {/* Parent toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-150',
          isChildActive
            ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent font-bold'
            : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27] hover:border-[#c7c4d8]'
        )}>
        <DollarSign size={17} className={cn('flex-shrink-0', isChildActive ? 'opacity-100' : 'opacity-60')} />
        <span className="flex-1 text-left">Payroll</span>
        {open
          ? <ChevronDown  size={14} className="text-current opacity-60 flex-shrink-0" />
          : <ChevronRight size={14} className="text-current opacity-60 flex-shrink-0" />
        }
      </button>

      {/* Sub-items */}
      {open && (
        <div className="ml-4 mt-0.5 pl-3 border-l-2 border-[#e7eefe] flex flex-col gap-0.5">
          {ROOT_PAYROLL_SUB_ITEMS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onClose}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.82rem] font-semibold border transition-all duration-150',
                isActive
                  ? 'bg-[#3525cd]/10 text-[#3525cd] border-[#3525cd]/20 font-bold'
                  : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27]'
              )}>
              {({ isActive }) => (
                <>
                  <Icon size={14} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-50')} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Finance section: Payroll dropdown + other items ───────────────────────────
function RootFinanceSection({ onClose, unread }) {
  const featureFlags  = useContext(FeatureFlagContext);
  const flagsLoaded   = useContext(FeatureFlagsLoadedContext);
  const payrollEnabled = !flagsLoaded ? false : ('payroll' in featureFlags ? featureFlags['payroll'] : true);

  const otherItems = ROOT_OTHER_FINANCE_ITEMS.filter(i => {
    if (!i.featureKey) return true;
    if (!flagsLoaded) return false;
    return i.featureKey in featureFlags ? featureFlags[i.featureKey] : true;
  });

  if (!payrollEnabled && !otherItems.length) return null;

  return (
    <div id="tour-nav-finance" className="mb-2">
      <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-[#777587] px-2.5 py-2">Finance</p>
      <div className="flex flex-col gap-0.5">
        {payrollEnabled && <RootPayrollGroup onClose={onClose} />}
        {otherItems.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} onClick={onClose} className={navLinkClass}>
            {({ isActive }) => (
              <>
                <Icon size={17} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-60')} />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

// ── Root sidebar ──────────────────────────────────────────────────────────────
function RootSidebar({ onClose, onMenuClick, onSearchOpen }) {
  const { user, logout, organization } = useAuth();
  const featureFlags = useContext(FeatureFlagContext);
  const flagsLoaded  = useContext(FeatureFlagsLoadedContext);
  const navigate = useNavigate();

  const { data: countData } = useQuery({
    queryKey: ['notif-count-root'],
    queryFn: () => apiGet('/notifications/unread-count'),
    refetchInterval: 30000,
  });
  const unread = countData?.count || 0;

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <aside className="w-64 h-full bg-white flex flex-col flex-shrink-0 relative border-r border-[#c7c4d8] shadow-sm">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-[#e7eefe]">
        <div className="flex items-center gap-3">
          <button
            onClick={onMenuClick}
            aria-label="Close menu"
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] transition-colors flex-shrink-0">
            <X size={16} className="text-[#464555]" />
          </button>
          <img src="/LogoWithoutName.svg" alt="HRMS" className="w-9 h-9 flex-shrink-0 hidden md:block" />
          <div>
            <h2 className="text-sm font-black text-[#151c27] leading-tight tracking-tight truncate">
              {organization?.name || 'Lumos Logic'}
            </h2>
            <p className="text-[0.65rem] text-[#777587] mt-0.5 tracking-wide">Root Admin Console</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <button
          onClick={onSearchOpen}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#777587] bg-[#f9f9ff] border border-[#c7c4d8] hover:border-[#3525cd]/40 hover:text-[#151c27] transition-colors">
          <Search size={13} className="text-[#3525cd]" />
          <span>Search...</span>
        </button>
      </div>

      {/* Global branch selector — shows when org has 1+ branch */}
      <BranchSelector />

      {/* Nav */}
      <nav className="flex-1 p-3 overflow-y-auto space-y-1">
        {NAV_SECTIONS.map(sec => {
          // Finance sentinel — render dropdown in correct position
          if (sec.id === 'tour-nav-finance') {
            return <RootFinanceSection key="finance" onClose={onClose} />;
          }

          const visibleItems = sec.items.filter(i => {
            if (!i.featureKey) return true;
            if (!flagsLoaded) return false; // hide feature-gated items until flags load
            return i.featureKey in featureFlags ? featureFlags[i.featureKey] : true;
          });
          if (!visibleItems.length) return null;
          return (
            <div key={sec.id} id={sec.id} className="mb-2">
              <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-[#777587] px-2.5 py-2">
                {sec.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {visibleItems.map(({ to, label, Icon, notifBadge }) => {
                  const badge = notifBadge && unread > 0 ? unread : null;
                  return (
                    <NavLink key={to} to={to} onClick={onClose} className={navLinkClass}>
                      {({ isActive }) => (
                        <>
                          <Icon size={17} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-60')} />
                          {label}
                          {badge && (
                            <span className="ml-auto bg-[#3525cd] text-white text-[0.6rem] font-black px-1.5 py-0.5 rounded-full min-w-[1.2rem] text-center">
                              {badge > 99 ? '99+' : badge}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User */}
      <div id="tour-user-card" className="p-3 border-t border-[#e7eefe]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#f0f3ff] transition-colors cursor-default border border-transparent hover:border-[#c7c4d8]">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-[0.78rem] font-black text-white flex-shrink-0 border-2 border-white shadow-md"
            style={{ background: user?.avatar_color || '#3525cd' }}>
            {initials(user?.name || '')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[0.84rem] font-black text-[#151c27] leading-tight truncate">{user?.name}</p>
            <p className="text-[0.68rem] text-[#777587] mt-0.5">Root Administrator</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2.5 py-2 mt-1 rounded-lg text-[0.82rem] font-semibold text-rose-400/80 hover:bg-rose-50 hover:text-rose-500 transition-all duration-150">
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </aside>
  );
}

export function RootLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen,  setSearchOpen]  = useState(false);
  const { user } = useAuth();
  useTour(rootAdminTourSteps, (user?.id && !user?.force_password_change) ? `lt_tour_root_${user.id}` : null);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f9f9ff]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[499] md:hidden"
          style={{ background: 'rgba(4,6,14,.65)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed md:relative z-[500] md:z-auto h-full transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <RootSidebar
          onClose={() => setSidebarOpen(false)}
          onMenuClick={() => setSidebarOpen(o => !o)}
          onSearchOpen={() => setSearchOpen(true)}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 h-13 py-2.5 bg-white border-b border-[#e7eefe] flex-shrink-0 z-10 shadow-sm">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Open menu"
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] active:scale-95 transition-all flex-shrink-0">
            <Menu size={18} className="text-[#464555]" />
          </button>
          <img src="/LogoWithoutName.svg" alt="Lumos Logic" className="w-7 h-7 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-[#151c27] leading-tight">Lumos Logic</p>
            <p className="text-[0.6rem] text-[#777587] tracking-wide">Root Admin Console</p>
          </div>
        </div>

        <Header />
        <main id="tour-main-content" className="flex-1 overflow-y-auto p-4 md:p-7">
          <Outlet />
        </main>
      </div>

      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
