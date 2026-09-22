import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, ClipboardList, Building2, Activity, LogOut, Menu, X, ChevronDown, Globe, Layers } from 'lucide-react';
import { usePlatformAuth } from '@/context/PlatformAuthContext';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard',    Icon: LayoutDashboard },
  { to: '/requests',  label: 'Org Requests', Icon: ClipboardList },
  { to: '/orgs',      label: 'Organizations',Icon: Building2 },
  {
    label: 'Activity Log', Icon: Activity,
    children: [
      { to: '/activity/platform', label: 'Platform Logs',      Icon: Globe },
      { to: '/activity/org',      label: 'Org Specific Logs',  Icon: Layers },
    ],
  },
];

function cn(...classes) { return classes.filter(Boolean).join(' '); }

function initials(name = '') {
  return name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'PA';
}

function SidebarNav({ onClose }) {
  const location = useLocation();
  const activityOpen = location.pathname.startsWith('/activity');
  const [expanded, setExpanded] = useState(activityOpen);

  return (
    <nav className="flex-1 p-3 overflow-y-auto">
      <p className="text-[0.6rem] font-black uppercase tracking-[0.14em] text-[#777587] px-2.5 py-3">Navigation</p>
      <div className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          if (item.children) {
            const isGroupActive = item.children.some(c => location.pathname.startsWith(c.to));
            return (
              <div key={item.label}>
                <button
                  onClick={() => setExpanded(e => !e)}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-150 w-full',
                    isGroupActive
                      ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent font-bold'
                      : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27] hover:border-[#c7c4d8]'
                  )}>
                  <item.Icon size={18} className={cn('flex-shrink-0', isGroupActive ? 'opacity-100' : 'opacity-60')} />
                  <span className="flex-1 text-left">{item.label}</span>
                  <ChevronDown size={14} className={cn('transition-transform duration-200', expanded ? 'rotate-180' : '')} />
                </button>
                {expanded && (
                  <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l-2 border-[#e7eefe] pl-2">
                    {item.children.map(({ to, label, Icon }) => (
                      <NavLink key={to} to={to} onClick={onClose}
                        className={({ isActive }) => cn(
                          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition-all duration-150',
                          isActive
                            ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent font-bold'
                            : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27]'
                        )}>
                        {({ isActive }) => (
                          <>
                            <Icon size={14} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-60')} />
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
          return (
            <NavLink key={item.to} to={item.to} onClick={onClose}
              className={({ isActive }) => cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold border transition-all duration-150 relative',
                isActive
                  ? 'bg-[#3525cd]/10 text-[#3525cd] border-l-[3px] border-[#3525cd] border-t-transparent border-r-transparent border-b-transparent font-bold'
                  : 'text-[#464555] border-transparent hover:bg-[#f0f3ff] hover:text-[#151c27] hover:border-[#c7c4d8]'
              )}>
              {({ isActive }) => (
                <>
                  <item.Icon size={18} className={cn('flex-shrink-0', isActive ? 'opacity-100' : 'opacity-60')} />
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

function Sidebar({ onClose }) {
  const { admin, logout } = usePlatformAuth();
  const navigate = useNavigate();

  function handleLogout() { logout(); navigate('/login'); }

  return (
    <aside className="w-64 h-full bg-white flex flex-col flex-shrink-0 relative border-r border-[#c7c4d8] shadow-sm">
      {/* Brand */}
      <div className="px-4 py-4 border-b border-[#e7eefe]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-white border border-[#e7eefe] overflow-hidden"
            style={{ boxShadow: '0 2px 8px rgba(53,37,205,.15)' }}>
            <img src="/LogoWithoutName.svg" alt="Lumos Logic" className="w-7 h-7 object-contain" />
          </div>
          <div>
            <h2 className="text-sm font-black text-[#151c27] leading-tight tracking-tight">Platform Admin</h2>
            <p className="text-[0.62rem] text-[#777587] mt-0.5 tracking-wide">HRMS Console</p>
          </div>
        </div>
      </div>

      <SidebarNav onClose={onClose} />

      {/* User */}
      <div className="p-3 border-t border-[#e7eefe]">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-[#f0f3ff] transition-colors cursor-default border border-transparent hover:border-[#c7c4d8]">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-[0.78rem] font-black text-white flex-shrink-0 border-2 border-white shadow-md"
            style={{ background: '#3525cd' }}>
            {initials(admin?.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[0.84rem] font-black text-[#151c27] leading-tight truncate">{admin?.name || 'Admin'}</p>
            <p className="text-[0.68rem] text-[#777587] mt-0.5 truncate">{admin?.email}</p>
          </div>
        </div>
        <button onClick={handleLogout}
          className="flex items-center gap-2 w-full px-2.5 py-2 mt-1 rounded-lg text-[0.82rem] font-semibold text-rose-400/80 hover:bg-rose-50 hover:text-rose-500 transition-all duration-150">
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </aside>
  );
}

export function PlatformLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f9f9ff]">
      {sidebarOpen && (
        <div className="fixed inset-0 z-[499] md:hidden"
          style={{ background: 'rgba(4,6,14,.65)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSidebarOpen(false)} />
      )}

      <div className={`fixed md:relative z-[500] md:z-auto h-full transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-3 bg-white border-b border-[#e7eefe] flex-shrink-0">
          <button className="md:hidden p-1.5 rounded-lg text-[#464555] hover:bg-[#f0f3ff] transition-colors"
            onClick={() => setSidebarOpen(o => !o)}>
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs text-[#777587] font-semibold">HRMS — Platform Admin Console</span>
          </div>
          <div className="flex-1" />
          <span className="text-[0.65rem] text-[#c7c4d8] font-mono hidden sm:block">v2.2.0</span>
        </div>

        <main className="flex-1 overflow-y-auto p-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
