import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

// Shared public footer. Renders on both the landing page and the legal/support
// pages. Adds the required LEGAL and SUPPORT link groups while preserving the
// existing branding, navigation and copyright.
export default function PublicFooter() {
  const { pathname, hash } = useLocation();

  // When navigating from a legal page to a "#section" anchor on the home page,
  // the SPA renders the landing content asynchronously. Re-scroll once the
  // target element is available so the anchor behaves like a normal link.
  useEffect(() => {
    if (!hash) return;
    const id = hash.replace('#', '');
    if (!id) return;
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(t);
  }, [pathname, hash]);

  const platformLinks = [
    { href: '/#features',     label: 'Features' },
    { href: '/#how-it-works', label: 'How It Works' },
    { href: '/#stats',        label: 'Why Us' },
  ];

  const legalLinks = [
    { to: '/privacy-policy',   label: 'Privacy Policy' },
    { to: '/terms-of-service', label: 'Terms of Service' },
    { to: '/cookie-policy',    label: 'Cookie Policy' },
  ];

  const supportLinks = [
    { to: '/contact',          label: 'Contact & Support' },
    { to: '/account-deletion', label: 'Account & Data Deletion' },
    { to: '/security',         label: 'Security & Data Protection' },
  ];

  return (
    <footer className="bg-[#151c27] text-white py-12">
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-10">

          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <img src="/LogoWithoutName.svg" alt="Lumos Logic HRMS" className="w-9 h-9" />
              <div>
                <p className="font-black text-sm tracking-tight">Lumos Logic HRMS</p>
                <p className="text-xs text-white/40 mt-0.5">Complete HR Management Platform</p>
              </div>
            </div>
            <p className="text-sm text-white/50 leading-relaxed max-w-xs">
              A full-stack HRMS built for growing organizations — attendance, leaves, payroll, goals, and more in one place.
            </p>
          </div>

          {/* Platform + Access */}
          <div className="space-y-7">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-white/30 mb-3">Platform</p>
              <div className="space-y-2">
                {platformLinks.map(l => (
                  <a key={l.href} href={l.href} className="block text-sm text-white/60 hover:text-white transition-colors">{l.label}</a>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-white/30 mb-3">Access</p>
              <div className="space-y-2">
                <Link to="/login" className="block text-sm text-white/60 hover:text-white transition-colors">Sign In</Link>
                <Link to="/register" className="block text-sm text-white/60 hover:text-white transition-colors">Register</Link>
                <Link to="/platform/login" className="block text-sm text-white/60 hover:text-white transition-colors">Platform Admin</Link>
              </div>
            </div>
          </div>

          {/* Legal + Support */}
          <div className="space-y-7">
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-white/30 mb-3">Legal</p>
              <div className="space-y-2">
                {legalLinks.map(l => (
                  <Link key={l.to} to={l.to} className="block text-sm text-white/60 hover:text-white transition-colors">{l.label}</Link>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-white/30 mb-3">Support</p>
              <div className="space-y-2">
                {supportLinks.map(l => (
                  <Link key={l.to} to={l.to} className="block text-sm text-white/60 hover:text-white transition-colors">{l.label}</Link>
                ))}
              </div>
            </div>
          </div>

          {/* Modules quick list */}
          <div>
            <p className="text-xs font-black uppercase tracking-widest text-white/30 mb-3">Core Modules</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {['Attendance', 'Leave Management', 'Payroll', 'Reports', 'Goals', 'Expenses', 'Documents', 'Biometric'].map(m => (
                <span key={m} className="text-xs text-white/50 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-[#3525cd] flex-shrink-0" />{m}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/30">© {new Date().getFullYear()} LumosLogic. All rights reserved.</p>
          <p className="text-xs text-white/30">Hosted in India · IST Timezone · Enterprise-grade security</p>
        </div>
      </div>
    </footer>
  );
}
