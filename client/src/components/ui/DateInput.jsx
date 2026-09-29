import React, { useRef } from 'react';
import { Calendar } from 'lucide-react';
import { fmtDate } from '@/lib/utils';

/**
 * BUG_245: Standardised date input.
 * Displays the selected date in "Sep 15, 2026" format (matching fmtDate) while
 * delegating the actual date-picking to the native browser control — no extra
 * dependency required.  The value is always stored / emitted as YYYY-MM-DD so
 * it is drop-in compatible with existing <input type="date"> usages.
 */
export function DateInput({ value, onChange, max, min, className, placeholder = 'Select date', disabled, title }) {
  const inputRef = useRef(null);

  function openPicker() {
    if (disabled || !inputRef.current) return;
    if (typeof inputRef.current.showPicker === 'function') {
      try { inputRef.current.showPicker(); } catch { inputRef.current.focus(); }
    } else {
      inputRef.current.focus();
    }
  }

  return (
    <div className={`relative select-none ${className || ''}`} title={title}>
      {/* Visible display — shows formatted date or placeholder */}
      <div
        onClick={openPicker}
        className={`form-control cursor-pointer flex items-center justify-between gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className={value ? 'text-[#151c27]' : 'text-[#9ca3af] font-normal'}>
          {value ? fmtDate(value) : placeholder}
        </span>
        <Calendar size={13} className="text-[#9ca3af] flex-shrink-0" />
      </div>

      {/* Hidden native picker — positioned over the display div so the click area matches */}
      <input
        ref={inputRef}
        type="date"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        min={min}
        max={max}
        disabled={disabled}
        tabIndex={-1}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        style={{ zIndex: 1, pointerEvents: 'none' }}
        aria-hidden="true"
      />
    </div>
  );
}
