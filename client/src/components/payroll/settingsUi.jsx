import React from 'react';
import { cn } from '@/lib/utils';

export function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
        checked ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}>
      <span className={cn(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm',
        checked ? 'translate-x-4' : 'translate-x-1'
      )} />
    </button>
  );
}

export function Section({ icon, title, subtitle, children }) {
  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff] bg-[#fafaff]">
        <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="text-sm font-bold text-[#151c27]">{title}</p>
          {subtitle && <p className="text-[0.68rem] text-[#777587]">{subtitle}</p>}
        </div>
      </div>
      <div className="px-5 py-5 space-y-5">{children}</div>
    </div>
  );
}

export function Row({ label, hint, children }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#151c27]">{label}</p>
        {hint && <p className="text-[0.68rem] text-[#777587] mt-0.5">{hint}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export function NumInput({ value, onChange, min, max, step = 1 }) {
  return (
    <input
      type="number" min={min} max={max} step={step}
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-20 border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm text-center text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
    />
  );
}

export function DayPicker({ value, onChange }) {
  const days = Array.from({ length: 28 }, (_, i) => i + 1);
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      className="border border-[#c7c4d8] rounded-lg px-3 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
      <option value="">— same as payroll date —</option>
      {days.map(d => (
        <option key={d} value={String(d)}>{d}{['th','st','nd','rd'][([11,12,13].includes(d%100)?0:d%10)] || 'th'} of month</option>
      ))}
      <option value="LAST_DAY">Last day of month</option>
      <option value="LAST_WORKING_DAY">Last working day</option>
    </select>
  );
}

export function TimeInput({ value, onChange }) {
  return (
    <input
      type="time"
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      className="border border-[#c7c4d8] rounded-lg px-2.5 py-1.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20 w-32"
    />
  );
}

export function TextField({ label, hint, value, onChange, placeholder, rows }) {
  const cls = 'w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]';
  return (
    <div>
      <p className="text-sm font-semibold text-[#151c27] mb-1">{label}</p>
      {hint && <p className="text-[0.68rem] text-[#777587] mb-1.5">{hint}</p>}
      {rows
        ? <textarea rows={rows} value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${cls} resize-none`} />
        : <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={cls} />}
    </div>
  );
}
