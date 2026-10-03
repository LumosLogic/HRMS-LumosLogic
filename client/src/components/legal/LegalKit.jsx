import React from 'react';

// Shared typographic primitives for the public legal / support pages.
// Keeps all pages visually consistent with the Lumos Logic HRMS design system.

export function PageHero({ eyebrow, title, subtitle, meta, children }) {
  return (
    <div className="bg-white border-b border-[#e7eefe]">
      <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 py-12 md:py-16">
        <div className="max-w-3xl">
          {eyebrow && (
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest mb-5 border"
              style={{ background: 'rgba(53,37,205,.07)', color: '#3525cd', borderColor: 'rgba(53,37,205,.2)' }}>
              {eyebrow}
            </div>
          )}
          <h1 className="text-3xl md:text-5xl font-black tracking-[-0.03em] text-[#151c27] leading-tight mb-4">{title}</h1>
          {subtitle && <p className="text-base md:text-lg text-[#464555] leading-relaxed max-w-2xl">{subtitle}</p>}
          {meta && (
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-5 text-xs font-semibold text-[#777587]">
              {meta.map(m => <span key={m}>{m}</span>)}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

export function Prose({ children }) {
  return (
    <div className="w-full max-w-[1440px] mx-auto px-6 lg:px-12 py-12 md:py-16">
      <div className="max-w-3xl text-[0.95rem] leading-relaxed text-[#464555]">{children}</div>
    </div>
  );
}

export function Section({ id, title, children }) {
  return (
    <section id={id} className="mt-10 first:mt-0">
      <h2 className="text-xl md:text-2xl font-black tracking-tight text-[#151c27] mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Sub({ title, children }) {
  return (
    <div className="mt-6">
      <h3 className="text-base font-bold text-[#151c27] mb-2">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function P({ children }) {
  return <p className="leading-relaxed">{children}</p>;
}

export function UL({ items }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

export function OL({ items }) {
  return (
    <ol className="list-decimal pl-5 space-y-1.5">
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ol>
  );
}

export function Callout({ tone = 'info', title, children }) {
  const styles = {
    info:    { bg: 'rgba(53,37,205,.05)',    border: 'rgba(53,37,205,.2)',  accent: '#3525cd' },
    warning: { bg: 'rgba(217,119,6,.06)',    border: 'rgba(217,119,6,.25)', accent: '#b45309' },
    success: { bg: 'rgba(5,150,105,.06)',    border: 'rgba(5,150,105,.25)', accent: '#047857' },
    danger:  { bg: 'rgba(220,38,38,.05)',    border: 'rgba(220,38,38,.22)', accent: '#b91c1c' },
  };
  const s = styles[tone] || styles.info;
  return (
    <div className="rounded-xl border p-4 md:p-5 my-4" style={{ background: s.bg, borderColor: s.border }}>
      {title && <p className="font-bold text-[#151c27] mb-1.5" style={{ color: s.accent }}>{title}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function DataItem({ label, children }) {
  return (
    <div className="py-1.5">
      <p className="text-xs font-bold uppercase tracking-widest text-[#777587] mb-0.5">{label}</p>
      <p className="text-[#151c27] font-medium">{children}</p>
    </div>
  );
}

export function Divider() {
  return <hr className="border-t border-[#e7eefe] my-8" />;
}
