import React from 'react';
import { Link } from 'react-router-dom';

const B = '#3525cd';

// Minimal public header shared by the legal / support pages.
// Matches the Lumos Logic HRMS branding without the landing-page anchor nav.
export default function PublicNav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md shadow-sm border-b border-[#c7c4d8]/40">
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 min-w-0">
          <img src="/LogoWithoutName.svg" alt="Lumos Logic HRMS" className="w-8 h-8" />
          <div className="flex items-baseline gap-1.5">
            <span className="font-black text-[#3525cd] text-base tracking-tight whitespace-nowrap">HRMS</span>
            <span className="text-xs font-semibold text-[#151c27] whitespace-nowrap">by Lumos Logic</span>
          </div>
        </Link>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <Link to="/login" className="text-sm font-bold text-[#464555] hover:text-[#3525cd] px-3 sm:px-4 py-2 transition-colors whitespace-nowrap">
            Sign In
          </Link>
          <Link to="/register"
            className="text-sm font-bold text-white px-3.5 sm:px-5 py-2.5 rounded-xl transition-all shadow-lg hover:-translate-y-0.5 whitespace-nowrap"
            style={{ background: B, boxShadow: '0 4px 16px rgba(53,37,205,.3)' }}>
            Get Started
          </Link>
        </div>
      </div>
    </nav>
  );
}
