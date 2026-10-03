import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import PublicFooter from '@/components/layout/PublicFooter';
import {
  BarChart2, ClipboardList, Users, ShieldCheck, Bell, Globe,
  CalendarDays, Zap, CheckCircle2, ArrowRight, Menu, X,
  Star, TrendingUp, Clock, Building2, ChevronRight, Fingerprint,
  FileText, Target, CreditCard, Mail, Cpu, GitBranch,
  UserCheck, MailCheck, Layers, LayoutDashboard, LogOut,
  Package, Sparkles, MapPin, DollarSign, Activity,
} from 'lucide-react';

const B = '#3525cd';

// ── Navbar ────────────────────────────────────────────────────────────────────
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', fn);
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const links = [
    { href: '#features',    label: 'Features' },
    { href: '#how-it-works',label: 'How It Works' },
    { href: '#stats',       label: 'Why Us' },
  ];

  return (
    <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'bg-white/96 backdrop-blur-md shadow-sm border-b border-[#c7c4d8]/40' : 'bg-transparent'}`}>
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 flex-shrink-0">
          <img src="/LogoWithoutName.svg" alt="HRMS" className="w-8 h-8" />
          <div className="flex items-baseline gap-1.5">
            <span className="font-black text-[#3525cd] text-base tracking-tight">HRMS</span>
            <span className="text-xs font-semibold text-[#151c27]">by Lumos Logic</span>
          </div>
        </Link>

        <div className="hidden md:flex items-center gap-8">
          {links.map(l => (
            <a key={l.href} href={l.href} className="text-sm font-semibold text-[#464555] hover:text-[#3525cd] transition-colors">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <Link to="/login" className="text-sm font-bold text-[#464555] hover:text-[#3525cd] px-4 py-2 transition-colors">Sign In</Link>
          <Link to="/register"
            className="text-sm font-bold text-white px-5 py-2.5 rounded-xl transition-all shadow-lg hover:-translate-y-0.5"
            style={{ background: B, boxShadow: '0 4px 16px rgba(53,37,205,.3)' }}>
            Get Started Free
          </Link>
        </div>

        <button className="md:hidden p-2 rounded-lg text-[#464555]" onClick={() => setOpen(o => !o)}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-white border-b border-[#c7c4d8] px-6 pb-5 space-y-1">
          {links.map(l => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}
              className="block py-2.5 text-sm font-semibold text-[#464555] border-b border-[#f0f3ff] last:border-0">{l.label}</a>
          ))}
          <div className="pt-3 flex flex-col gap-2.5">
            <Link to="/login" onClick={() => setOpen(false)}
              className="text-center py-2.5 text-sm font-bold text-[#3525cd] border border-[#3525cd] rounded-xl">Sign In</Link>
            <Link to="/register" onClick={() => setOpen(false)}
              className="text-center py-2.5 text-sm font-bold text-white rounded-xl" style={{ background: B }}>Get Started Free</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <section className="relative pt-28 pb-20 overflow-hidden">
      <div className="absolute inset-0 bg-[#f9f9ff]" />
      <div className="absolute inset-0 pointer-events-none"
        style={{ backgroundImage: 'linear-gradient(rgba(53,37,205,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(53,37,205,.035) 1px,transparent 1px)', backgroundSize: '72px 72px' }} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[560px] rounded-full opacity-[0.08] pointer-events-none"
        style={{ background: 'radial-gradient(ellipse, #3525cd 0%, transparent 70%)' }} />

      <div className="relative w-full max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-8 border"
            style={{ background: 'rgba(53,37,205,.07)', color: B, borderColor: 'rgba(53,37,205,.2)' }}>
            <Zap size={11} /> Multi-Tenant HRMS Platform
          </div>

          <h1 className="text-5xl md:text-6xl lg:text-[4.5rem] font-black tracking-[-0.04em] text-[#151c27] leading-[1.05] mb-6">
            Complete HR Management<br />
            <span style={{ background: 'linear-gradient(135deg, #3525cd, #712ae2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Built for Modern Teams
            </span>
          </h1>

          <p className="text-lg md:text-xl text-[#464555] leading-relaxed max-w-2xl mx-auto mb-10">
            Attendance, leaves, payroll, goals, expenses, onboarding, and more — all in one intelligent HRMS. Fully configurable for every organization.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-14">
            <Link to="/register"
              className="flex items-center gap-2 px-8 py-4 text-base font-bold text-white rounded-2xl shadow-xl hover:-translate-y-1 transition-all duration-200 w-full sm:w-auto justify-center"
              style={{ background: 'linear-gradient(135deg, #3525cd, #4f46e5)', boxShadow: '0 8px 32px rgba(53,37,205,.35)' }}>
              Start for Free <ArrowRight size={18} />
            </Link>
            <Link to="/login"
              className="flex items-center gap-2 px-8 py-4 text-base font-bold text-[#3525cd] rounded-2xl border-2 border-[#3525cd]/30 hover:border-[#3525cd] hover:bg-[#3525cd]/5 transition-all w-full sm:w-auto justify-center">
              Sign In to Dashboard
            </Link>
          </div>

          {/* Dashboard mockup */}
          <div className="relative mx-auto max-w-6xl">
            <div className="rounded-2xl overflow-hidden border border-[#c7c4d8]/60"
              style={{ boxShadow: '0 40px 80px rgba(53,37,205,.15), 0 0 0 1px rgba(53,37,205,.08)' }}>
              <div className="bg-white border-b border-[#e7eefe] px-4 py-3 flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-rose-400" />
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <div className="w-3 h-3 rounded-full bg-emerald-400" />
                </div>
                <div className="flex-1 mx-3 bg-[#f0f3ff] rounded-lg px-3 py-1 text-xs text-[#777587] font-mono text-left">
                  hrms.lumoslogic.com/dashboard
                </div>
              </div>
              <div className="bg-[#f9f9ff] p-5 grid grid-cols-12 gap-4" style={{ minHeight: 300 }}>
                {/* Sidebar */}
                <div className="col-span-2 bg-white rounded-xl border border-[#e7eefe] p-3 space-y-1.5">
                  <div className="h-8 bg-[#f0f3ff] rounded-lg flex items-center px-2 gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: B }} />
                    <div className="h-1.5 bg-[#3525cd]/30 rounded flex-1" />
                  </div>
                  {[0.75, 0.55, 0.65, 0.45, 0.6, 0.5, 0.7].map((w, i) => (
                    <div key={i} className={`h-6 rounded-lg flex items-center px-2 gap-1.5 ${i === 0 ? 'bg-[#f0f3ff]' : 'bg-[#f9f9ff]'}`}>
                      <div className="w-2.5 h-2.5 rounded-sm bg-[#c7c4d8]" />
                      <div className="h-1.5 bg-[#c7c4d8]/60 rounded" style={{ width: `${w * 100}%` }} />
                    </div>
                  ))}
                </div>
                {/* Main content */}
                <div className="col-span-10 space-y-3">
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label: 'Total Employees', val: '48', color: '#3525cd' },
                      { label: 'Present Today',   val: '41', color: '#059669' },
                      { label: 'On Leave',         val: '4',  color: '#d97706' },
                      { label: 'Pending Leaves',   val: '3',  color: '#dc2626' },
                    ].map(s => (
                      <div key={s.label} className="bg-white rounded-xl border border-[#e7eefe] p-3">
                        <div className="text-xl font-black mb-0.5" style={{ color: s.color }}>{s.val}</div>
                        <div className="text-[0.65rem] text-[#777587] font-medium">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 bg-white rounded-xl border border-[#e7eefe] p-4 flex items-end gap-1.5" style={{ height: 130 }}>
                      {[55, 72, 48, 88, 65, 79, 52, 91, 68, 74, 83, 70].map((h, i) => (
                        <div key={i} className="flex-1 rounded-t-sm"
                          style={{ height: `${h}%`, background: i === 8 ? B : `rgba(53,37,205,${0.12 + i * 0.02})` }} />
                      ))}
                    </div>
                    <div className="bg-white rounded-xl border border-[#e7eefe] p-3 space-y-2">
                      {[
                        { label: 'Annual', pct: 72, c: '#3525cd' },
                        { label: 'Sick',   pct: 45, c: '#059669' },
                        { label: 'Casual', pct: 28, c: '#d97706' },
                      ].map(r => (
                        <div key={r.label}>
                          <div className="flex justify-between text-[0.6rem] text-[#777587] mb-0.5">
                            <span>{r.label}</span><span>{r.pct}%</span>
                          </div>
                          <div className="h-1.5 bg-[#f0f3ff] rounded-full">
                            <div className="h-full rounded-full" style={{ width: `${r.pct}%`, background: r.c }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating badges */}
            <div className="absolute -left-5 top-1/3 bg-white rounded-2xl shadow-xl border border-[#e7eefe] px-4 py-3 hidden lg:flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(53,37,205,.1)' }}>
                <CheckCircle2 size={18} style={{ color: B }} />
              </div>
              <div>
                <p className="text-xs font-black text-[#151c27]">Leave Approved</p>
                <p className="text-[0.68rem] text-[#777587]">2 minutes ago</p>
              </div>
            </div>

            <div className="absolute -right-5 bottom-1/4 bg-white rounded-2xl shadow-xl border border-[#e7eefe] px-4 py-3 hidden lg:flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-50">
                <TrendingUp size={18} className="text-emerald-600" />
              </div>
              <div>
                <p className="text-xs font-black text-[#151c27]">96% Attendance</p>
                <p className="text-[0.68rem] text-[#777587]">This month</p>
              </div>
            </div>

            <div className="absolute -right-5 top-1/4 bg-white rounded-2xl shadow-xl border border-[#e7eefe] px-4 py-3 hidden xl:flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-50">
                <Fingerprint size={18} className="text-amber-600" />
              </div>
              <div>
                <p className="text-xs font-black text-[#151c27]">Biometric Synced</p>
                <p className="text-[0.68rem] text-[#777587]">5 devices connected</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────
function FeaturesSection() {
  const core = [
    { icon: <ClipboardList size={22} />, title: 'Leave Management', desc: 'Multi-type leave workflows — annual, sick, casual, emergency, comp-off, WFH. Multi-level approval chains with instant notifications.', color: '#3525cd', bg: 'rgba(53,37,205,.08)' },
    { icon: <Clock size={22} />, title: 'Attendance Tracking', desc: 'Clock-in/out with live status. Late arrival and early exit detection, half-day and break tracking with configurable thresholds.', color: '#059669', bg: 'rgba(5,150,105,.08)' },
    { icon: <BarChart2 size={22} />, title: 'Analytics & Reports', desc: 'Attendance trends, leave utilization, department breakdowns. Export to CSV, print-ready reports. Yearly and monthly views.', color: '#7c3aed', bg: 'rgba(124,58,237,.08)' },
    { icon: <Users size={22} />, title: 'Employee Management', desc: 'Full employee profiles with photo, documents, and statutory fields. Department hierarchy, position tracking, and multi-department support.', color: '#0891b2', bg: 'rgba(8,145,178,.08)' },
    { icon: <ShieldCheck size={22} />, title: 'Role-Based Access (RBAC)', desc: 'Granular permission matrix across all modules. Platform Admin → Root Admin → HR Admin → Employee with custom role creation.', color: '#16a34a', bg: 'rgba(22,163,74,.08)' },
    { icon: <Target size={22} />, title: 'Goals & Performance', desc: 'Set individual and team OKRs, track progress, and link performance to attendance patterns. Quarterly review cycles.', color: '#ea580c', bg: 'rgba(234,88,12,.08)' },
    { icon: <CreditCard size={22} />, title: 'Expense Management', desc: 'Submit, review, and approve expense claims with receipt uploads. Department-level budgets and approval workflows.', color: '#db2777', bg: 'rgba(219,39,119,.08)' },
    { icon: <Bell size={22} />, title: 'Announcements & Broadcasts', desc: 'Company-wide or department-specific announcements with pin support. Scheduled posts and expiry dates.', color: '#d97706', bg: 'rgba(217,119,6,.08)' },
    { icon: <FileText size={22} />, title: 'Document Management', desc: 'Store, organize, and share HR documents. Employee self-service document portal with admin approval for sensitive files.', color: '#475569', bg: 'rgba(71,85,105,.08)' },
    { icon: <UserCheck size={22} />, title: 'Onboarding Workflows', desc: 'Structured new-hire checklists, task assignments, and progress tracking. Automate welcome emails and document collection.', color: '#0d9488', bg: 'rgba(13,148,136,.08)' },
    { icon: <LogOut size={22} />, title: 'Exit Management', desc: 'Full offboarding process — notice period tracking, clearance workflows, asset return, final settlement checklist.', color: '#9f1239', bg: 'rgba(159,18,57,.08)' },
    { icon: <GitBranch size={22} />, title: 'Approval Workflows', desc: 'Configure multi-level approval chains per leave type, expense, or document. Role-based routing with dept-head bypass options.', color: '#6d28d9', bg: 'rgba(109,40,217,.08)' },
  ];

  const enterprise = [
    { icon: <Fingerprint size={22} />, title: 'Biometric Integration', desc: 'ZKTeco ADMS device integration. Real-time punch sync, historical import, multi-device management, and auto-sync scheduling.', color: '#3525cd', bg: 'rgba(53,37,205,.08)', tag: 'ZKTeco ADMS' },
    { icon: <DollarSign size={22} />, title: 'Payroll Engine', desc: 'Custom salary structures, LOP (Loss of Pay) deductions tied to attendance, and monthly payslip generation with PDF export.', color: '#059669', bg: 'rgba(5,150,105,.08)', tag: 'Custom Structures' },
    { icon: <MapPin size={22} />, title: 'Multi-Branch Management', desc: 'Branch entities with independent employee rosters, device assignments, and branch-level HR management.', color: '#7c3aed', bg: 'rgba(124,58,237,.08)', tag: 'Enterprise' },
    { icon: <MailCheck size={22} />, title: 'Email Automation', desc: 'Late check-in alerts, daily attendance summaries, appreciation emails. Custom SMTP with your domain and sender identity.', color: '#0891b2', bg: 'rgba(8,145,178,.08)', tag: 'Custom SMTP' },
    { icon: <CalendarDays size={22} />, title: 'Google Calendar Sync', desc: 'Auto-sync approved leaves and company holidays to individual and team Google Calendars via OAuth2 integration.', color: '#dc2626', bg: 'rgba(220,38,38,.08)', tag: 'Google OAuth2' },
    { icon: <Activity size={22} />, title: 'Shift & Roster Management', desc: 'Define shifts with custom days and hours. Assign employees to shifts per month. Track who works which shift and detect conflicts.', color: '#d97706', bg: 'rgba(217,119,6,.08)', tag: 'Custom Schedules' },
  ];

  return (
    <section id="features" className="py-24 bg-white">
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12">

        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-5 border"
            style={{ background: 'rgba(53,37,205,.07)', color: B, borderColor: 'rgba(53,37,205,.2)' }}>
            <Layers size={11} /> Platform Modules
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-[-0.03em] text-[#151c27] mb-4">
            Everything your HR team needs
          </h2>
          <p className="text-[#464555] text-lg max-w-2xl mx-auto">
            A full-stack HRMS designed to save hours of admin work every week — from day-one onboarding to exit clearance.
          </p>
        </div>

        {/* Core Features */}
        <div className="mb-14">
          <div className="flex items-center gap-3 mb-7">
            <div className="h-px flex-1 bg-[#f0f3ff]" />
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#f0f3ff] border border-[#c7c4d8]">
              <Package size={12} className="text-[#3525cd]" />
              <span className="text-xs font-black text-[#3525cd] uppercase tracking-widest">Core Platform — Included in Every Plan</span>
            </div>
            <div className="h-px flex-1 bg-[#f0f3ff]" />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {core.map(f => (
              <div key={f.title} className="group p-5 rounded-2xl border border-[#e7eefe] bg-white hover:border-[#c7c4d8] hover:shadow-lg transition-all duration-200">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3.5 group-hover:scale-110 transition-transform"
                  style={{ background: f.bg, color: f.color }}>
                  {f.icon}
                </div>
                <h3 className="text-sm font-black text-[#151c27] mb-1.5">{f.title}</h3>
                <p className="text-xs text-[#464555] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Enterprise Modules */}
        <div>
          <div className="flex items-center gap-3 mb-7">
            <div className="h-px flex-1 bg-[#f0f3ff]" />
            <div className="flex items-center gap-2 px-4 py-1.5 rounded-full border"
              style={{ background: 'rgba(53,37,205,.06)', borderColor: 'rgba(53,37,205,.2)' }}>
              <Sparkles size={12} style={{ color: B }} />
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: B }}>Enterprise Add-ons — Enabled Per Client Request</span>
            </div>
            <div className="h-px flex-1 bg-[#f0f3ff]" />
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {enterprise.map(f => (
              <div key={f.title} className="group p-5 rounded-2xl border-2 border-dashed border-[#c7c4d8] bg-[#fafaff] hover:border-[#3525cd]/40 hover:bg-white hover:shadow-md transition-all duration-200">
                <div className="flex items-start justify-between mb-3.5">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform"
                    style={{ background: f.bg, color: f.color }}>
                    {f.icon}
                  </div>
                  <span className="text-[0.6rem] font-bold px-2 py-1 rounded-full border"
                    style={{ background: f.bg, color: f.color, borderColor: `${f.color}30` }}>
                    {f.tag}
                  </span>
                </div>
                <h3 className="text-sm font-black text-[#151c27] mb-1.5">{f.title}</h3>
                <p className="text-xs text-[#464555] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── How It Works ──────────────────────────────────────────────────────────────
function HowItWorksSection() {
  const steps = [
    {
      icon: <Building2 size={26} />,
      title: 'Submit Your Request',
      desc: 'Register your organization with basic company details. Our platform team reviews and approves within 24 hours — you receive admin credentials by email.',
      points: ['Company name, domain & plan selection', 'Review by platform administrators', 'Approval email with login credentials'],
      color: '#3525cd', bg: 'linear-gradient(135deg,#3525cd,#4f46e5)',
    },
    {
      icon: <Cpu size={26} />,
      title: 'Configure Your Workspace',
      desc: 'Set up your organization\'s work schedule, leave types, approval workflows, and department structure. Everything is customizable to match your HR policy.',
      points: ['Work hours, days, attendance thresholds', 'Leave types, quotas & carry-forward rules', 'Multi-level approval workflow builder'],
      color: '#7c3aed', bg: 'linear-gradient(135deg,#7c3aed,#9333ea)',
    },
    {
      icon: <Users size={26} />,
      title: 'Add Your Team',
      desc: 'Add employees individually or request bulk import. Assign roles, departments, positions, and work schedules. Employees receive welcome emails automatically.',
      points: ['Employee profiles with all statutory fields', 'Role assignment — Employee / HR Admin / Root Admin', 'Welcome email with portal access link'],
      color: '#0891b2', bg: 'linear-gradient(135deg,#0891b2,#0e7490)',
    },
    {
      icon: <Activity size={26} />,
      title: 'Connect Integrations',
      desc: 'Link Google Calendar for automatic leave sync, configure your SMTP for branded emails. Enterprise clients connect ZKTeco biometric devices for automated attendance.',
      points: ['Google Calendar OAuth2 sync', 'Custom SMTP with company email domain', 'ZKTeco ADMS biometric device pairing (optional)'],
      color: '#059669', bg: 'linear-gradient(135deg,#059669,#10b981)',
    },
    {
      icon: <Zap size={26} />,
      title: 'Go Live & Automate',
      desc: 'Your team starts clocking in, applying for leaves, and getting instant notifications — all from one dashboard. Attendance data flows in automatically, 24/7.',
      points: ['Real-time dashboard updates for HR admins', 'Employee self-service portal (mobile-friendly)', 'Automated reports, reminders & email alerts'],
      color: '#d97706', bg: 'linear-gradient(135deg,#d97706,#f59e0b)',
    },
  ];

  return (
    <section id="how-it-works" className="py-24 bg-[#f9f9ff]">
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-5 border"
            style={{ background: 'rgba(53,37,205,.07)', color: B, borderColor: 'rgba(53,37,205,.2)' }}>
            <ChevronRight size={11} /> How It Works
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-[-0.03em] text-[#151c27] mb-4">
            Up and running in minutes
          </h2>
          <p className="text-[#464555] text-lg max-w-xl mx-auto">
            No complex IT setup. Just register, configure, and start managing your HR — the platform handles the rest.
          </p>
        </div>

        {/* Desktop: horizontal steps with connecting line */}
        <div className="hidden lg:block">
          <div className="relative">
            {/* Connecting line */}
            <div className="absolute top-10 left-0 right-0 flex items-center px-20">
              <div className="flex-1 h-0.5" style={{ background: 'linear-gradient(90deg, rgba(53,37,205,.15), rgba(53,37,205,.4), rgba(53,37,205,.15))' }} />
            </div>
            <div className="grid grid-cols-5 gap-6">
              {steps.map((s, i) => (
                <div key={s.title} className="flex flex-col items-center text-center">
                  {/* Icon */}
                  <div className="relative w-20 h-20 rounded-2xl flex items-center justify-center mb-5 z-10"
                    style={{ background: s.bg, boxShadow: `0 8px 24px ${s.color}40` }}>
                    <div className="text-white">{s.icon}</div>
                    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border-2 flex items-center justify-center text-[0.6rem] font-black"
                      style={{ color: s.color, borderColor: s.color }}>
                      {i + 1}
                    </div>
                  </div>
                  <h3 className="text-sm font-black text-[#151c27] mb-2">{s.title}</h3>
                  <p className="text-[0.73rem] text-[#464555] leading-relaxed mb-3">{s.desc}</p>
                  <div className="space-y-1.5 text-left w-full">
                    {s.points.map(p => (
                      <div key={p} className="flex items-start gap-1.5">
                        <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" style={{ color: s.color }} />
                        <span className="text-[0.68rem] text-[#777587]">{p}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Mobile: vertical timeline */}
        <div className="lg:hidden space-y-6">
          {steps.map((s, i) => (
            <div key={s.title} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
                  style={{ background: s.bg, boxShadow: `0 4px 12px ${s.color}35` }}>
                  {s.icon}
                </div>
                {i < steps.length - 1 && <div className="w-0.5 flex-1 mt-2" style={{ background: `${s.color}30` }} />}
              </div>
              <div className="flex-1 pb-6">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[0.6rem] font-black uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ background: s.color }}>Step {i + 1}</span>
                  <h3 className="text-sm font-black text-[#151c27]">{s.title}</h3>
                </div>
                <p className="text-xs text-[#464555] leading-relaxed mb-2">{s.desc}</p>
                <div className="space-y-1">
                  {s.points.map(p => (
                    <div key={p} className="flex items-start gap-1.5">
                      <CheckCircle2 size={11} className="flex-shrink-0 mt-0.5" style={{ color: s.color }} />
                      <span className="text-[0.68rem] text-[#777587]">{p}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function StatsSection() {
  const metrics = [
    { value: '14+',    label: 'HR Modules',          sub: 'Core + enterprise',    icon: <Package size={20} />,   color: B },
    { value: '7',      label: 'Leave Types',          sub: 'Fully configurable',   icon: <ClipboardList size={20}/>,color:'#059669' },
    { value: '3-Tier', label: 'Role Hierarchy',       sub: 'Granular permissions', icon: <ShieldCheck size={20}/>,color:'#7c3aed' },
    { value: '<60s',   label: 'Avg. Approval Time',   sub: 'Instant notifications',icon: <Clock size={20} />,    color:'#0891b2' },
    { value: '99.9%',  label: 'Uptime SLA',           sub: 'VPS hosted, IST zone', icon: <Activity size={20} />, color:'#16a34a' },
    { value: 'Real-time',label:'Attendance Updates',  sub: 'Live dashboard sync',  icon: <TrendingUp size={20}/>, color:'#d97706' },
    { value: 'ZKTeco', label: 'Biometric Support',    sub: 'ADMS + 7-device sync', icon: <Fingerprint size={20}/>,color:'#dc2626' },
    { value: '24/7',   label: 'Platform Support',     sub: 'Dedicated to clients', icon: <Star size={20} />,     color:'#db2777' },
  ];

  const coreCapabilities = [
    'Multi-type leave management with carryforward',
    'Real-time clock-in / clock-out attendance',
    'Multi-level leave approval workflows',
    'Analytics dashboards with CSV export',
    'Employee self-service portal',
    'Role-based access control (RBAC)',
    'Announcements, broadcasts & notifications',
    'Goals, performance & OKR tracking',
    'Expense claims & approval',
    'Document management & e-signatures',
    'Onboarding & exit management workflows',
    'Birthday, holiday & event reminders',
  ];

  const enterpriseCapabilities = [
    'ZKTeco biometric ADMS integration',
    'Payroll engine with LOP deduction',
    'Multi-branch employee management',
    'Historical biometric data import',
    'Custom SMTP with company email domain',
    'Google Calendar OAuth2 leave sync',
    'Shift & roster management',
    'Automated daily attendance email reports',
  ];

  return (
    <section id="stats" className="py-24 bg-white">
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12">

        <div className="text-center mb-14">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-5 border"
            style={{ background: 'rgba(53,37,205,.07)', color: B, borderColor: 'rgba(53,37,205,.2)' }}>
            <Star size={11} /> Platform Reliability
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-[-0.03em] text-[#151c27] mb-4">
            Built for reliability & scale
          </h2>
          <p className="text-[#464555] text-lg max-w-xl mx-auto">
            Enterprise-grade infrastructure, IST-optimized, and deployed on dedicated VPS with full data isolation per organization.
          </p>
        </div>

        {/* Metric cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4 mb-14">
          {metrics.map(s => (
            <div key={s.label} className="text-center p-5 rounded-2xl border border-[#e7eefe] bg-[#fafaff] hover:border-[#c7c4d8] hover:shadow-md transition-all group">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform"
                style={{ background: `${s.color}15`, color: s.color }}>
                {s.icon}
              </div>
              <div className="text-xl font-black text-[#151c27] mb-0.5 leading-tight">{s.value}</div>
              <div className="text-[0.68rem] font-bold text-[#464555] mb-0.5">{s.label}</div>
              <div className="text-[0.6rem] text-[#9ca3af]">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Capability breakdown */}
        <div className="rounded-3xl overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #3525cd 0%, #4f46e5 50%, #712ae2 100%)' }}>
          <div className="px-8 md:px-12 py-10 md:py-14 grid md:grid-cols-2 gap-10 items-start">

            {/* Left */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-[0.7rem] font-bold uppercase tracking-widest mb-5">
                <Package size={10} /> Core Platform — Every Organization
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">
                Everything out of the box
              </h3>
              <p className="text-white/70 text-sm leading-relaxed mb-6">
                From day-one attendance records to year-end reports — every organization gets the full core HRMS suite, with no additional configuration fees.
              </p>
              <div className="grid grid-cols-1 gap-2">
                {coreCapabilities.map(item => (
                  <div key={item} className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 size={10} className="text-white" />
                    </div>
                    <span className="text-white/85 text-sm">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-white text-[0.7rem] font-bold uppercase tracking-widest mb-5">
                <Sparkles size={10} /> Enterprise Add-ons — Enabled on Request
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-3 tracking-tight">
                Customized for your needs
              </h3>
              <p className="text-white/70 text-sm leading-relaxed mb-6">
                Enterprise clients get additional modules configured specifically for their workflows — biometric, payroll, multi-branch, and more.
              </p>
              <div className="grid grid-cols-1 gap-2 mb-8">
                {enterpriseCapabilities.map(item => (
                  <div key={item} className="flex items-center gap-2.5">
                    <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                      <Sparkles size={8} className="text-amber-300" />
                    </div>
                    <span className="text-white/85 text-sm">{item}</span>
                  </div>
                ))}
              </div>
              <Link to="/register"
                className="inline-flex items-center gap-2 px-6 py-3 bg-white rounded-xl text-sm font-bold hover:-translate-y-0.5 transition-all shadow-lg"
                style={{ color: B }}>
                Get Started Free <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── CTA ───────────────────────────────────────────────────────────────────────
function CTASection() {
  return (
    <section className="py-24 bg-[#f9f9ff]">
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-8 border"
            style={{ background: 'rgba(53,37,205,.07)', color: B, borderColor: 'rgba(53,37,205,.2)' }}>
            <Globe size={11} /> Multi-Tenant SaaS
          </div>
          <h2 className="text-4xl md:text-5xl font-black tracking-[-0.03em] text-[#151c27] mb-5">
            Ready to transform<br />your HR operations?
          </h2>
          <p className="text-lg text-[#464555] max-w-xl mx-auto mb-10">
            Register your organization today. Get a dedicated HR dashboard, invite your team, and go live within minutes — no IT setup required.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            <Link to="/register"
              className="flex items-center gap-2 px-8 py-4 text-base font-bold text-white rounded-2xl shadow-xl hover:-translate-y-1 transition-all w-full sm:w-auto justify-center"
              style={{ background: 'linear-gradient(135deg, #3525cd, #4f46e5)', boxShadow: '0 8px 32px rgba(53,37,205,.35)' }}>
              Register Your Organization <ArrowRight size={18} />
            </Link>
            <Link to="/login"
              className="flex items-center gap-2 px-8 py-4 text-base font-bold text-[#3525cd] rounded-2xl border-2 border-[#3525cd]/30 hover:border-[#3525cd] transition-all w-full sm:w-auto justify-center">
              Sign In
            </Link>
          </div>
          <p className="text-sm text-[#777587]">No credit card required · Free to get started · Approval within 24 hours</p>
        </div>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <div className="h-screen overflow-y-auto overflow-x-hidden w-full">
      <Navbar />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <StatsSection />
      <CTASection />
      <PublicFooter />
    </div>
  );
}
