import React from 'react';
import { NavLink } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { initials, cn } from '@/lib/utils';

/**
 * Bottom-of-sidebar user card shared by the employee, HR and root-admin layouts.
 * The card IS the profile link (no separate "Profile" menu item). When the profile page is open the card turns white,
 * so the name / subtitle switch to dark text — they are white on the normal blue sidebar.
 */
export function SidebarUserCard({ user, to, subtitle, onNavigate, onLogout }) {
  return (
    <>
      <NavLink to={to} onClick={onNavigate}
        className={({ isActive }) => cn(
          'flex items-center gap-2.5 px-2.5 py-2 rounded-lg border transition-all duration-150',
          isActive
            ? 'bg-white border-transparent shadow-sm'
            : 'border-transparent hover:bg-white/10 cursor-pointer'
        )}>
        {({ isActive }) => (
          <>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-[0.78rem] font-black text-white flex-shrink-0 border-2 border-white shadow-sm overflow-hidden"
              style={{ background: user?.avatar_color || '#3525cd' }}>
              {/* uploaded photo (kept in the auth user by the profile page); initials remain the fallback */}
              {user?.avatar_url
                ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                : initials(user?.name || '')}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn('text-[0.84rem] font-black leading-tight truncate', isActive ? 'text-[#151c27]' : 'text-white')}>{user?.name}</p>
              <p className={cn('text-[0.68rem] mt-0.5 truncate', isActive ? 'text-[#3525cd]' : 'text-white/70')}>{subtitle}</p>
            </div>
          </>
        )}
      </NavLink>
      <button onClick={onLogout}
        className="flex items-center gap-2 w-full px-2.5 py-2 mt-1 rounded-lg text-[0.82rem] font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all duration-150">
        <LogOut size={16} /> Sign Out
      </button>
    </>
  );
}
