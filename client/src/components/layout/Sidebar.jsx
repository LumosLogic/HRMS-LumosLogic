import React, { useContext, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Calendar, FileText, Users, Settings, LogOut, UserCircle,
  Building2, CalendarDays, Shield, ClipboardList, BarChart3, FolderOpen,
  DollarSign, Monitor, Receipt, Megaphone, Clock, Target, UserCheck, LogOut as Exit,
  Bell, Fingerprint, Link2, ScrollText, X, Search, Play, IndianRupee, Radio,
  PieChart, FileBarChart, ShieldCheck, ChevronDown, ChevronRight, History, KeyRound,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { FeatureFlagContext, FeatureFlagsLoadedContext } from '@/context/FeatureFlagContext';
import { BranchSelector } from '@/components/layout/BranchSelector';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { initials, cn } from '@/lib/utils';
import { GlobalSearchModal } from '@/components/ui/GlobalSearchModal';

// ── Section definitions ──────────────────────────────────────────────────────

// perm: module name used for hasPermission(perm, 'view') check when RBAC is loaded.
// Items without `perm` are always shown (subject to adminOnly/rootAdminOnly/featureKey).

const OVERVIEW_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard, perm: 'dashboard' },
];

const EMPLOYEE_MGMT_ITEMS = [
  { to: '/employees',       label: 'Employees',       Icon: Users,      adminOnly: true, perm: 'employees'    },
  { to: '/departments',     label: 'Departments',     Icon: Building2,  adminOnly: true, perm: 'departments'  },
  { to: '/branches',        label: 'Branches',        Icon: Building2,  adminOnly: true, featureKey: 'branches',       perm: 'branches'    },
  { to: '/onboarding',      label: 'Onboarding',      Icon: UserCheck,  adminOnly: true, featureKey: 'onboarding',     perm: 'onboarding'  },
  { to: '/exit-management', label: 'Exit Management', Icon: Exit,       adminOnly: true, featureKey: 'exit_management',perm: 'exit'        },
];

const ATTENDANCE_ITEMS = [
  { to: '/leaves',         label: 'Leaves',          Icon: FileText,     perm: 'leaves'     },
  { to: '/calendar',       label: 'Calendar',        Icon: Calendar,     perm: 'attendance' },
  { to: '/regularization', label: 'Regularization',  Icon: ClipboardList,featureKey: 'regularization', perm: 'attendance' },
  { to: '/holidays',       label: 'Holidays',        Icon: CalendarDays, adminOnly: true,              perm: 'holidays'   },
  { to: '/leave-policies', label: 'Leave Policies',  Icon: Shield,       adminOnly: true, featureKey: 'leave_policies', perm: 'settings'   },
  { to: '/shifts',         label: 'Shifts & Roster', Icon: Clock,        adminOnly: true, featureKey: 'shifts',         perm: 'shifts'      },
];

const BIOMETRIC_ITEMS = [
  { to: '/biometric/devices',          label: 'Devices',          Icon: Fingerprint, adminOnly: true, featureKey: 'biometric', perm: 'biometric' },
  { to: '/biometric/mapping',          label: 'PIN Mapping',      Icon: Link2,       adminOnly: true, featureKey: 'biometric', perm: 'biometric' },
  { to: '/biometric/logs',             label: 'Punch Logs',       Icon: ScrollText,  adminOnly: true, featureKey: 'biometric', perm: 'biometric' },
  { to: '/biometric/live-logs',        label: 'Live Logs',        Icon: Radio,       adminOnly: true, featureKey: 'biometric', hideFromRootAdmin: true, perm: 'biometric' },
  { to: '/biometric/historical-sync',  label: 'Historical Sync',  Icon: History,     adminOnly: true, featureKey: 'biometric', rootAdminOnly: true },
  { to: '/biometric/settings',         label: 'Settings',         Icon: Settings,    adminOnly: true, featureKey: 'biometric', rootAdminOnly: true },
];

// Payroll sub-items (shown inside dropdown)
const PAYROLL_SUB_ITEMS = [
  { to: '/payroll/dashboard', label: 'Payroll Dashboard',  Icon: PieChart,     adminOnly: true, perm: 'payroll' },
  { to: '/payroll/generate',  label: 'Payroll Generation', Icon: Play,         adminOnly: true, perm: 'payroll' },
  { to: '/payroll/reports',   label: 'Payroll Reports',    Icon: FileBarChart, adminOnly: true, perm: 'payroll' },
  { to: '/payroll/salary',    label: 'Salary Structures',  Icon: IndianRupee,  adminOnly: true, perm: 'payroll' },
  { to: '/payroll/settings',  label: 'Payroll Settings',   Icon: Settings,     adminOnly: true, perm: 'payroll' },
];

// Non-payroll finance items
const OTHER_FINANCE_ITEMS = [
  // statutory items have no `perm` — shown via adminOnly only because statutory.*
  // permissions are not yet seeded into hr_admin's system role. Adding perm here
  // would hide them for all HR admins. Add perm once statutory seeding is complete.
  { to: '/statutory/compliance',   label: 'Compliance Dashboard', Icon: ShieldCheck, featureKey: 'payroll', adminOnly: true },
  { to: '/statutory/config',       label: 'Statutory Config',     Icon: Shield,      featureKey: 'payroll', adminOnly: true },
  { to: '/statutory/declarations', label: 'Tax Declarations',     Icon: FileText,    featureKey: 'payroll', adminOnly: true },
  { to: '/expenses', label: 'Expenses', Icon: Receipt, featureKey: 'expenses', perm: 'expenses' },
  { to: '/assets',   label: 'Assets',   Icon: Monitor, featureKey: 'assets',   perm: 'assets'   },
  { to: '/reports',  label: 'Reports',  Icon: BarChart3, featureKey: 'reports', perm: 'reports'  },
];

const PERFORMANCE_ITEMS = [
  { to: '/performance', label: 'Performance', Icon: Target,     featureKey: 'performance', perm: 'performance' },
  { to: '/documents',   label: 'Documents',   Icon: FolderOpen, featureKey: 'documents',   perm: 'documents'   },
];

const COMMUNICATION_ITEMS = [
  { to: '/announcements', label: 'Announcements', Icon: Megaphone, featureKey: 'announcements', perm: 'announcements' },
  { to: '/notifications', label: 'Notifications', Icon: Bell,      notifBadge: true,            perm: 'notifications' },
];

const ADMIN_ITEMS = [
  { to: '/pending-approvals', label: 'Pending Approvals', Icon: ClipboardList, adminOnly: true },
  { to: '/roles',             label: 'Role Management',   Icon: KeyRound,      rootAdminOnly: true },
  { to: '/settings', label: 'Settings', Icon: Settings, perm: 'settings' },
  { to: '/profile',  label: 'Profile',  Icon: UserCircle },
];

// ── Standard nav item ────────────────────────────────────────────────────────
function NavItem({ to, label, Icon, badge, onClose }) {
  return (
    <NavLink to={to} onClick={onClose}
      className={({ isActive }) => cn(
        'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-150',
        isActive
          ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent font-bold'
          : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27] hover:border-[#c7c4d8]'
      )}>
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
}

// ── Payroll dropdown group ───────────────────────────────────────────────────
function PayrollGroup({ onClose, isAdmin, isRootAdmin, prefix = '', featureKey = 'payroll', hasPermission, permissionsLoaded }) {
  const featureFlags = useContext(FeatureFlagContext);
  const flagsLoaded  = useContext(FeatureFlagsLoadedContext);
  const location     = useLocation();

  const payrollEnabled = !flagsLoaded ? false : (featureKey in featureFlags ? featureFlags[featureKey] : true);
  const payrollPaths   = ['/payroll', ...PAYROLL_SUB_ITEMS.map(i => i.to)];
  const isChildActive  = payrollPaths.some(p => location.pathname.startsWith(prefix + p));

  // All hooks must be called before any conditional return
  const [open, setOpen] = useState(isChildActive);

  if (!payrollEnabled) return null;
  // BUG_172: hide entire payroll dropdown if user lacks payroll.view
  if (permissionsLoaded && !isRootAdmin && !hasPermission('payroll', 'view')) return null;

  const visibleSubs = PAYROLL_SUB_ITEMS.filter(item => {
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  return (
    <div>
      {/* Parent toggle button */}
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
          ? <ChevronDown size={14} className="text-current opacity-60 flex-shrink-0" />
          : <ChevronRight size={14} className="text-current opacity-60 flex-shrink-0" />}
      </button>

      {/* Sub-items */}
      {open && (
        <div className="ml-4 mt-0.5 pl-3 border-l-2 border-[#e7eefe] flex flex-col gap-0.5">
          {visibleSubs.map(item => (
            <NavLink
              key={item.to}
              to={prefix + item.to}
              onClick={onClose}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[0.82rem] font-semibold border transition-all duration-150',
                isActive
                  ? 'bg-[#3525cd]/10 text-[#3525cd] border-[#3525cd]/20 font-bold'
                  : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27]'
              )}>
              {({ isActive }) => (
                <>
                  <item.Icon size={14} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-50')} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Generic NavSection ───────────────────────────────────────────────────────
function NavSection({ title, items, onClose, isAdmin, isRootAdmin, prefix = '', unreadCount = 0, hasPermission, permissionsLoaded }) {
  const featureFlags = useContext(FeatureFlagContext);
  const flagsLoaded  = useContext(FeatureFlagsLoadedContext);
  const filtered = items.filter(i => {
    if (i.adminOnly && !isAdmin) return false;
    if (i.hideFromRootAdmin && isRootAdmin) return false;
    if (i.rootAdminOnly && !isRootAdmin) return false;
    if (i.featureKey) {
      if (!flagsLoaded) return false; // hide until flags are loaded
      const enabled = i.featureKey in featureFlags ? featureFlags[i.featureKey] : true;
      if (!enabled) return false;
    }
    // BUG_172: permission-based visibility when RBAC is loaded and user is not root admin
    // Root admin always sees everything; for others, check the module permission
    if (i.perm && permissionsLoaded && !isRootAdmin) {
      if (!hasPermission(i.perm, 'view')) return false;
    }
    return true;
  });
  if (!filtered.length) return null;
  return (
    <div className="mb-3">
      {title && <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-[#777587] px-2.5 py-2">{title}</p>}
      <div className="flex flex-col gap-0.5">
        {filtered.map(({ to, label, Icon, notifBadge }) => {
          const path  = prefix + to.replace(/^\//, '/');
          const badge = notifBadge && unreadCount > 0 ? unreadCount : null;
          return (
            <NavItem key={path} to={path} label={label} Icon={Icon} badge={badge} onClose={onClose} />
          );
        })}
      </div>
    </div>
  );
}

// ── Finance section: Payroll dropdown + other finance items ──────────────────
function FinanceSection({ onClose, isAdmin, isRootAdmin, prefix = '', hasPermission, permissionsLoaded }) {
  const featureFlags = useContext(FeatureFlagContext);
  const flagsLoaded  = useContext(FeatureFlagsLoadedContext);

  const otherFiltered = OTHER_FINANCE_ITEMS.filter(i => {
    if (i.adminOnly && !isAdmin) return false;
    if (i.featureKey) {
      if (!flagsLoaded) return false;
      const enabled = i.featureKey in featureFlags ? featureFlags[i.featureKey] : true;
      if (!enabled) return false;
    }
    // BUG_172: permission-based visibility
    if (i.perm && permissionsLoaded && !isRootAdmin) {
      if (!hasPermission(i.perm, 'view')) return false;
    }
    return true;
  });

  const payrollEnabled = !flagsLoaded ? false : ('payroll' in featureFlags ? featureFlags['payroll'] : true);

  if (!payrollEnabled && !otherFiltered.length) return null;

  return (
    <div className="mb-3">
      <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-[#777587] px-2.5 py-2">Finance</p>
      <div className="flex flex-col gap-0.5">
        {payrollEnabled && <PayrollGroup onClose={onClose} isAdmin={isAdmin} isRootAdmin={isRootAdmin} prefix={prefix} hasPermission={hasPermission} permissionsLoaded={permissionsLoaded} />}
        {otherFiltered.map(({ to, label, Icon }) => (
          <NavItem key={prefix + to} to={prefix + to} label={label} Icon={Icon} onClose={onClose} />
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────────────
export function Sidebar({ onClose, prefix = '', onMenuClick, onSearchOpen }) {
  const { user, logout, isAdmin, isRootAdmin, hasPermission, permissions } = useAuth();
  const navigate = useNavigate();

  const { data: countData } = useQuery({
    queryKey: ['notif-count'],
    queryFn: () => apiGet('/notifications/unread-count'),
    refetchInterval: 30000,
  });
  const unread = countData?.count || 0;

  // BUG_172: permissions are considered "loaded" once the array is non-empty
  // (empty = still fetching or legacy system → fall back to role-based checks)
  const permissionsLoaded = Array.isArray(permissions) && permissions.length > 0;

  function handleLogout() { logout(); navigate('/login'); }

  const sharedProps = { onClose, isAdmin, isRootAdmin, prefix, unreadCount: unread, hasPermission, permissionsLoaded };

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
          <img src="/LogoWithoutName.svg" alt="Lumos Logic" className="w-9 h-9 flex-shrink-0 hidden md:block" />
          <div>
            <h2 className="text-sm font-black text-[#151c27] leading-tight tracking-tight">Lumos Logic</h2>
            <p className="text-[0.65rem] text-[#777587] mt-0.5 tracking-wide">
              {isRootAdmin ? 'Root Admin Console' : 'HR Admin Console'}
            </p>
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

      {/* Branch Selector — shown only for multi-branch admins */}
      <BranchSelector />

      {/* Nav */}
      <nav className="flex-1 p-3 overflow-y-auto space-y-1">
        <div id="tour-nav-overview">
          <NavSection title="Overview" items={OVERVIEW_ITEMS} {...sharedProps} />
        </div>
        <div id="tour-nav-hr">
          <NavSection title="Employee Management" items={EMPLOYEE_MGMT_ITEMS} {...sharedProps} />
        </div>
        <div id="tour-nav-attendance">
          <NavSection title="Attendance & Leave" items={ATTENDANCE_ITEMS} {...sharedProps} />
        </div>
        <div id="tour-nav-biometric">
          <NavSection title="Biometric" items={BIOMETRIC_ITEMS} {...sharedProps} />
        </div>
        <div id="tour-nav-finance">
          <FinanceSection onClose={onClose} isAdmin={isAdmin} isRootAdmin={isRootAdmin} prefix={prefix} hasPermission={hasPermission} permissionsLoaded={permissionsLoaded} />
        </div>
        <div id="tour-nav-people">
          <NavSection title="Performance" items={PERFORMANCE_ITEMS} {...sharedProps} />
        </div>
        <div id="tour-nav-comms">
          <NavSection title="Communication" items={COMMUNICATION_ITEMS} {...sharedProps} />
        </div>
        <div id="tour-nav-account">
          <NavSection title="Administration" items={ADMIN_ITEMS} {...sharedProps} />
        </div>
      </nav>

      {/* User */}
      <div id="tour-user-card" className="p-3 border-t border-[#e7eefe]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#f0f3ff] transition-colors cursor-default border border-transparent hover:border-[#c7c4d8]">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-[0.78rem] font-black text-white flex-shrink-0 border-2 border-white shadow-md"
            style={{ background: user?.avatar_color || '#3525cd' }}>
            {initials(user?.name || '')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[0.84rem] font-black text-[#151c27] leading-tight truncate">{user?.name}</p>
            <p className="text-[0.68rem] text-[#777587] mt-0.5 truncate">
              {isRootAdmin ? 'Root Administrator' : isAdmin ? 'HR Admin' : user?.position || 'Employee'}
            </p>
          </div>
        </div>
        <button onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2.5 py-2 mt-1 rounded-lg text-[0.82rem] font-semibold text-rose-400/80 hover:bg-rose-50 hover:text-rose-500 transition-all">
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </aside>
  );
}
