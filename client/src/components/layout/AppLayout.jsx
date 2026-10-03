import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BranchSwitchGuard } from './BranchSwitchGuard';
import { GlobalSearchModal } from '@/components/ui/GlobalSearchModal';
import { useAuth } from '@/context/AuthContext';
import { useTour } from '@/hooks/useTour';
import { hrAdminTourSteps } from '@/lib/tours';

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen,  setSearchOpen]  = useState(false);
  const { user } = useAuth();
  useTour(hrAdminTourSteps, (user?.id && !user?.force_password_change) ? `lt_tour_hr_${user.id}` : null);

  return (
    <div className="flex app-height overflow-hidden bg-[#f9f9ff]">

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-[499] md:hidden"
          style={{ background: 'rgba(4,6,14,.65)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar – always visible on md+, drawer on mobile */}
      <div className={`fixed md:relative z-[500] md:z-auto h-full transition-transform duration-300 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <Sidebar
          onClose={() => setSidebarOpen(false)}
          onMenuClick={() => setSidebarOpen(o => !o)}
          onSearchOpen={() => setSearchOpen(true)}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Mobile top bar — visible only on small screens */}
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
            <p className="text-[0.6rem] text-[#777587] tracking-wide">HR Admin Console</p>
          </div>
        </div>

        {/* Headless Header — registers Ctrl+K shortcut only */}
        <Header />
        <main id="tour-main-content" className="flex-1 overflow-y-auto p-4 md:p-7">
          <BranchSwitchGuard><Outlet /></BranchSwitchGuard>
        </main>
      </div>

      {/* GlobalSearchModal at root level to avoid sidebar stacking-context clipping */}
      <GlobalSearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
