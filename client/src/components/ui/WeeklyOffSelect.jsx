import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// BUG_260: Weekly Off supports more than one day (e.g. "Saturday,Sunday").
// The value stays a plain comma-separated string so the existing TEXT column
// (users.weekly_off_day) and every existing single-day value ("Sunday") keep working.

export const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MAX_WEEKLY_OFF_DAYS = 3;

// Existing data was saved in two spellings by two screens: "Saturday" (profile) and "Sat"
// (employee modal). Both are accepted and normalised to the full name.
function toFullDay(token) {
  const t = String(token || '').trim().toLowerCase();
  if (t.length < 3) return null;
  return WEEK_DAYS.find(d => d.toLowerCase() === t || d.toLowerCase().slice(0, 3) === t.slice(0, 3)) || null;
}

/** "Saturday,Sunday" / "Sat,Sun" -> ['Sunday','Saturday'] (week order, duplicates/unknown dropped) */
export function parseWeeklyOff(value) {
  const set = new Set(String(value || '').split(',').map(toFullDay).filter(Boolean));
  return WEEK_DAYS.filter(d => set.has(d));
}

/** 'Saturday,Sunday' -> 'Sunday, Saturday' for read-only display */
export function formatWeeklyOff(value) {
  const days = parseWeeklyOff(value);
  return days.length ? days.join(', ') : (value || '');
}

export default function WeeklyOffSelect({ value, onChange, label = 'Weekly Off' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const selected = parseWeeklyOff(value);

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function toggle(day) {
    let next;
    if (selected.includes(day)) next = selected.filter(d => d !== day);
    else if (selected.length >= MAX_WEEKLY_OFF_DAYS) return;           // cap reached
    else next = [...selected, day];
    onChange(WEEK_DAYS.filter(d => next.includes(d)).join(','));        // keep week order
  }

  const atLimit = selected.length >= MAX_WEEKLY_OFF_DAYS;

  return (
    <div ref={wrapRef} className="relative">
      <label className="form-label">{label}</label>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="form-control text-left flex items-center justify-between gap-2">
        <span className={`truncate ${selected.length ? '' : 'text-[#9ca3af]'}`}>
          {selected.length ? selected.join(', ') : '— Select —'}
        </span>
        <ChevronDown size={13} className={`text-[#777587] flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-[#c7c4d8] rounded-xl shadow-lg p-1.5">
          {WEEK_DAYS.map(day => {
            const checked  = selected.includes(day);
            const disabled = !checked && atLimit;
            return (
              <label key={day}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-[#f0f3ff]'}`}>
                <input type="checkbox" className="accent-[#3525cd]" checked={checked} disabled={disabled}
                  onChange={() => toggle(day)} />
                <span className="flex-1">{day}</span>
                {checked && <Check size={12} className="text-[#3525cd]" />}
              </label>
            );
          })}
          <p className="text-[0.62rem] text-[#777587] px-2 pt-1">Select up to {MAX_WEEKLY_OFF_DAYS} days.</p>
        </div>
      )}
    </div>
  );
}
