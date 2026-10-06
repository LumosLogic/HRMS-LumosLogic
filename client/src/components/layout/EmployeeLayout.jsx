import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTour } from '@/hooks/useTour';
import { employeeTourSteps } from '@/lib/tours';
import { Header } from '@/components/layout/Header';
import {
  Home, FileText, Clock, UserCircle, LogOut, Menu, X, CalendarDays,
  FolderOpen, Receipt, DollarSign, Target, ClipboardList, UserCheck,
  LogOut as Exit, Bell, Megaphone, Search, ClipboardCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import { STALE } from '@/lib/queryTiers';
import { initials, cn } from '@/lib/utils';
import { GlobalSearchModal } from '@/components/ui/GlobalSearchModal';

const NAV_SECTIONS = [
  { title: 'My Workspace', items: [
    { to: '/portal/home',          label: 'My Dashboard',   Icon: Home },
    { to: '/portal/attendance',    label: 'My Attendance',  Icon: Clock },
    { to: '/portal/leaves',        label: 'My Leaves',      Icon: FileText },
    { to: '/portal/team-calendar', label: 'Team Calendar',  Icon: CalendarDays },
  ]},
  { title: 'Self Service', items: [
    { to: '/portal/regularization',label: 'Regularization', Icon: ClipboardList },
    { to: '/portal/documents',     label: 'My Documents',   Icon: FolderOpen },
    { to: '/portal/expenses',      label: 'My Expenses',    Icon: Receipt },
    { to: '/portal/payslips',      label: 'My Payslips',    Icon: DollarSign },
  ]},
  { title: 'Growth', items: [
    { to: '/portal/performance',   label: 'Performance',    Icon: Target },
    { to: '/portal/onboarding',    label: 'Onboarding',     Icon: UserCheck },
    { to: '/portal/exit',          label: 'Exit / Resign',  Icon: Exit },
  ]},
  { title: 'Company', items: [
    { to: '/portal/announcements', label: 'Announcements',  Icon: Megaphone },
    { to: '/portal/notifications', label: 'Notifications',  Icon: Bell, badge: true },
  ]},
];

function EmployeeSidebar({ onClose, onMenuClick, onSearchOpen }) {
  const { user, logout, hasCustomAccess, adminLanding } = useAuth();
  const navigate = useNavigate();
  // A custom-role user can switch to the permission-driven admin modules their role grants
  const sections = hasCustomAccess
    ? [{ title: 'Team Workspace', items: [{ to: adminLanding, label: 'Admin Modules', Icon: ClipboardCheck }] }, ...NAV_SECTIONS]
    : NAV_SECTIONS;

  const { data: countData } = useQuery({
    queryKey: ['notif-count'],
    staleTime: STALE.realtime,   // realtime
    queryFn: () => apiGet('/notifications/unread-count'),
    refetchInterval: 30000,
  });
  const unread = countData?.count || 0;

  // Check if this user is a department head — show Team Approvals nav item if yes
  const { data: deptHeadData } = useQuery({
    queryKey: ['is-dept-head'],
    queryFn:  () => apiGet('/leaves/is-dept-head').catch(() => ({ is_dept_head: false })),
    staleTime: 5 * 60 * 1000,
  });
  const isDeptHead = deptHeadData?.is_dept_head === true;

  // Count of pending dept approvals for badge
  const { data: pendingDept = [] } = useQuery({
    queryKey: ['dept-pending-leaves'],
    queryFn:  () => isDeptHead ? apiGet('/leaves/pending-department').catch(() => []) : Promise.resolve([]),
    enabled:  isDeptHead,
    refetchInterval: 60000,
  });
  const pendingDeptCount = pendingDept.length;

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <aside className="w-64 h-full bg-white flex flex-col flex-shrink-0 relative border-r border-[#c7c4d8] shadow-sm">
      {/* Brand + mobile menu toggle */}
      <div className="px-4 py-4 border-b border-[#e7eefe]">
        <div className="flex items-center gap-3">
          <button
            onClick={onMenuClick}
            aria-label="Close menu"
            className="md:hidden w-8 h-8 flex items-center justify-center rounded-lg border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] transition-colors flex-shrink-0"
          >
            <X size={16} className="text-[#464555]" />
          </button>
          <img src="/LogoWithoutName.svg" alt="Lumos Logic" className="w-9 h-9 flex-shrink-0 hidden md:block" />
          <div>
            <h2 className="text-sm font-black text-[#151c27] leading-tight tracking-tight">Lumos Logic</h2>
            <p className="text-[0.65rem] text-[#777587] mt-0.5 tracking-wide">Employee Portal</p>
          </div>
        </div>
      </div>

      {/* Search trigger */}
      <div className="px-3 py-2">
        <button
          onClick={onSearchOpen}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#777587] bg-[#f9f9ff] border border-[#c7c4d8] hover:border-[#3525cd]/40 hover:text-[#151c27] transition-colors"
        >
          <Search size={13} className="text-[#3525cd]" />
          <span>Search...</span>
        </button>
      </div>

      <nav className="flex-1 px-3 pb-3 pt-1 overflow-y-auto space-y-1">
        {sections.map((sec, idx) => (
          <div key={sec.title} id={`tour-emp-${['workspace','selfservice','growth','company'][idx] || idx}`} className="mb-2">
            <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-[#777587] px-2.5 py-2">{sec.title}</p>
            <div className="flex flex-col gap-0.5">
              {sec.items.map(({ to, label, Icon, badge }) => (
                <NavLink key={to} to={to} onClick={onClose}
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
                      {badge && unread > 0 && <span className="ml-auto bg-[#3525cd] text-white text-[0.6rem] font-black px-1.5 py-0.5 rounded-full">{unread > 99 ? '99+' : unread}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}

        {/* Team Approvals — only visible to Department Heads */}
        {isDeptHead && (
          <div className="mb-2">
            <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-[#777587] px-2.5 py-2">My Team</p>
            <div className="flex flex-col gap-0.5">
              <NavLink to="/portal/dept-approvals" onClick={onClose}
                className={({ isActive }) => cn(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-150',
                  isActive
                    ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent font-bold'
                    : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27] hover:border-[#c7c4d8]'
                )}>
                {({ isActive }) => (
                  <>
                    <ClipboardCheck size={17} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-60')} />
                    Team Approvals
                    {pendingDeptCount > 0 && (
                      <span className="ml-auto bg-[#3525cd] text-white text-[0.6rem] font-black px-1.5 py-0.5 rounded-full">
                        {pendingDeptCount > 99 ? '99+' : pendingDeptCount}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </div>
          </div>
        )}
      </nav>

      <div id="tour-emp-user-card" className="p-3 border-t border-[#e7eefe]">
        <NavLink to="/portal/profile" onClick={onClose}
          className={({ isActive }) => cn(
            'flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-all duration-150',
            isActive
              ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent'
              : 'border-transparent hover:bg-[#f0f3ff] hover:border-[#c7c4d8] cursor-pointer'
          )}>
          {() => (
            <>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[0.78rem] font-black text-white flex-shrink-0 border-2 border-white shadow-sm"
                style={{ background: user?.avatar_color || '#3525cd' }}>
                {initials(user?.name || '')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.84rem] font-black text-[#151c27] leading-tight truncate">{user?.name}</p>
                <p className="text-[0.68rem] text-[#777587] mt-0.5 truncate">{user?.position || 'Employee'} · My Profile</p>
              </div>
            </>
          )}
        </NavLink>
        <button onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2.5 py-2 mt-1 rounded-lg text-[0.82rem] font-semibold text-rose-400/80 hover:bg-rose-50 hover:text-rose-500 transition-all duration-150">
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </aside>
  );
}

export function EmployeeLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen,  setSearchOpen]  = useState(false);
  const { user } = useAuth();
  useTour(employeeTourSteps, (user?.id && !user?.force_password_change) ? `lt_tour_emp_${user.id}` : null);

  return (
    <div className="flex app-height overflow-hidden bg-[#f9f9ff]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-[#151c27]/40 z-[499] md:hidden"
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed md:relative z-[500] md:z-auto h-full transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <EmployeeSidebar
          onClose={() => setSidebarOpen(false)}
          onMenuClick={() => setSidebarOpen(o => !o)}
          onSearchOpen={() => setSearchOpen(true)}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile top bar — visible only on small screens, always on top */}
        <div className="md:hidden flex items-center gap-3 px-4 h-13 py-2.5 bg-white border-b border-[#e7eefe] flex-shrink-0 z-10 shadow-sm">
          <button
            onClick={() => setSidebarOpen(o => !o)}
            aria-label="Open menu"
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] active:scale-95 transition-all flex-shrink-0"
          >
            <Menu size={18} className="text-[#464555]" />
          </button>
          <img src="/LogoWithoutName.svg" alt="Lumos Logic" className="w-7 h-7 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-black text-[#151c27] leading-tight">Lumos Logic</p>
            <p className="text-[0.6rem] text-[#777587] tracking-wide">Employee Portal</p>
          </div>
        </div>

        {/* Headless Header — registers Ctrl+K shortcut only */}
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>

      {/* GlobalSearchModal rendered at root level to avoid sidebar stacking-context clipping */}
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
