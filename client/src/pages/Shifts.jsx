import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Clock, Calendar,
  UserPlus, Search, X, ChevronLeft, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';
import { MONTHS, DAYS } from '@/lib/utils';

function fmtRosterDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T12:00:00');
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

function parseDays(str) {
  if (!str) return [];
  return str.split(',').map(Number).filter(n => !isNaN(n));
}

function serializeDays(arr) {
  return arr.length ? arr.sort((a, b) => a - b).join(',') : null;
}

// ── Validation helpers ────────────────────────────────────────────────────────

function validateShiftName(val) {
  if (!val || !val.trim()) return 'Shift name is required';
  if (val.trim().length < 2) return 'Shift name must be at least 2 characters';
  if (val.trim().length > 60) return 'Shift name cannot exceed 60 characters';
  if (/[<>;`"\\]/.test(val)) return 'Shift name contains invalid characters';
  return '';
}

function validateTimeRange(start, end) {
  if (!start) return 'Start time is required';
  if (!end)   return 'End time is required';
  // BUG_076: Allow overnight shifts (end < start means next day, which is valid)
  return '';
}

// ── ShiftModal ────────────────────────────────────────────────────────────────

function ShiftModal({ open, onClose, shift }) {
  const toast  = useToast();
  const qc     = useQueryClient();
  const isEdit = !!shift;

  const blankForm = { name: '', start_time: '09:00', end_time: '18:00', color: '#3525cd', description: '', days_of_week: [1, 2, 3, 4, 5] };

  const [form, setForm] = useState(blankForm);
  const [errs, setErrs] = useState({});

  useEffect(() => {
    if (open) {
      setForm(isEdit
        ? { name: shift.name, start_time: shift.start_time, end_time: shift.end_time, color: shift.color, description: shift.description || '', days_of_week: parseDays(shift.days_of_week) }
        : blankForm);
      setErrs({});
    }
  }, [open]);

  function handleNameChange(e) {
    const val = e.target.value.replace(/[<>;`"\\]/g, '').slice(0, 60);
    setForm(f => ({ ...f, name: val }));
    const err = validateShiftName(val);
    setErrs(prev => err ? { ...prev, name: err } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'name')));
  }

  function handleTimeChange(field, val) {
    const next = { ...form, [field]: val };
    setForm(next);
    const err = validateTimeRange(next.start_time, next.end_time);
    setErrs(prev => err ? { ...prev, time: err } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'time')));
  }

  function toggleDay(idx) {
    setForm(f => ({
      ...f,
      days_of_week: f.days_of_week.includes(idx)
        ? f.days_of_week.filter(d => d !== idx)
        : [...f.days_of_week, idx],
    }));
  }

  function validate() {
    const e = {};
    const nErr = validateShiftName(form.name);
    if (nErr) e.name = nErr;
    const tErr = validateTimeRange(form.start_time, form.end_time);
    if (tErr) e.time = tErr;
    return e;
  }

  const mut = useMutation({
    mutationFn: () => {
      const payload = { ...form, days_of_week: serializeDays(form.days_of_week) };
      return isEdit ? apiPut(`/shifts/${shift.id}`, payload) : apiPost('/shifts', payload);
    },
    onSuccess: () => {
      toast(isEdit ? 'Shift updated!' : 'Shift created!', 'success');
      qc.invalidateQueries({ queryKey: ['shifts'] });
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrs(e); return; }
    mut.mutate();
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Shift' : 'New Shift'} size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={mut.isPending}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Save'}
          </button>
        </div>
      }>
      <div className="space-y-4">

        {/* EHN_SR_002: Shift Templates */}
        {!isEdit && (
          <div>
            <p className="text-xs font-bold text-[#777587] uppercase tracking-wide mb-2">Quick Templates</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Morning',   start: '06:00', end: '14:00', days: [1,2,3,4,5], color: '#F59E0B' },
                { label: 'Afternoon', start: '14:00', end: '22:00', days: [1,2,3,4,5], color: '#3525cd' },
                { label: 'Night',     start: '22:00', end: '06:00', days: [1,2,3,4,5], color: '#1e1b5e' },
                { label: 'General',   start: '09:00', end: '18:00', days: [1,2,3,4,5], color: '#10B981' },
              ].map(t => (
                <button key={t.label} type="button" onClick={() => setForm(f => ({ ...f, name: `${t.label} Shift`, start_time: t.start, end_time: t.end, color: t.color, days_of_week: t.days }))}
                  className="flex items-center gap-2 p-2.5 rounded-xl border border-[#e7eefe] text-xs font-bold text-[#464555] hover:border-[#3525cd] hover:bg-[#f0f3ff] transition-colors text-left">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: t.color }} />
                  {t.label}<span className="font-normal text-[#777587] ml-auto">{t.start}–{t.end}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Shift Name */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="form-label mb-0">Shift Name <span className="text-rose-500">*</span></label>
            <span className={`text-[0.65rem] font-semibold ${form.name.length > 50 ? 'text-amber-500' : 'text-[#c7c4d8]'}`}>
              {form.name.length}/60
            </span>
          </div>
          <input
            className={`form-control ${errs.name ? 'border-rose-500 focus:border-rose-500' : ''}`}
            placeholder="e.g. Morning Shift"
            value={form.name}
            onChange={handleNameChange}
            maxLength={60}
          />
          {errs.name && <p className="text-[0.72rem] text-rose-600 mt-1">{errs.name}</p>}
        </div>

        {/* Time Range */}
        <div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Start Time <span className="text-rose-500">*</span></label>
              <input type="time"
                className={`form-control ${errs.time ? 'border-rose-500' : ''}`}
                value={form.start_time}
                onChange={e => handleTimeChange('start_time', e.target.value)} />
            </div>
            <div>
              <label className="form-label">End Time <span className="text-rose-500">*</span></label>
              <input type="time"
                className={`form-control ${errs.time ? 'border-rose-500' : ''}`}
                value={form.end_time}
                onChange={e => handleTimeChange('end_time', e.target.value)} />
            </div>
          </div>
          {errs.time && <p className="text-[0.72rem] text-rose-600 mt-1">{errs.time}</p>}
          {form.start_time && form.end_time && form.end_time < form.start_time && (
            <p className="text-[0.72rem] text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 mt-1">
              Overnight shift — ends the next day (e.g. 8:00 PM to 5:00 AM is valid)
            </p>
          )}
        </div>

        {/* Days of Week */}
        <div>
          <label className="form-label">Applicable Days
            <span className="text-xs font-normal text-[#777587] ml-1">(default days this shift runs)</span>
          </label>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {DAYS.map((day, idx) => {
              const active = form.days_of_week.includes(idx);
              return (
                <button key={idx} type="button" onClick={() => toggleDay(idx)}
                  className={`w-10 h-10 rounded-lg text-xs font-bold border transition-all ${
                    active ? 'text-white border-transparent' : 'bg-white text-[#777587] border-[#c7c4d8] hover:border-[#3525cd] hover:text-[#3525cd]'
                  }`}
                  style={active ? { background: form.color, borderColor: form.color } : {}}>
                  {day}
                </button>
              );
            })}
          </div>
          {form.days_of_week.length === 0 && (
            <p className="text-[0.7rem] text-[#a09ead] mt-1">No days selected — shift is a general template</p>
          )}
        </div>

        {/* Color + Description */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Color</label>
            <input type="color" className="form-control h-10 p-1" value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
          </div>
          <div>
            <label className="form-label">Description</label>
            <input className="form-control" value={form.description} maxLength={200}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional" />
          </div>
        </div>

      </div>
    </Modal>
  );
}

// ── AssignEmployeesModal ──────────────────────────────────────────────────────

function AssignEmployeesModal({ open, onClose, shift, employees, assignments }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);

  const [selectedIds,      setSelectedIds]      = useState(new Set());
  const [originalIds,      setOriginalIds]      = useState(new Set());
  const [fromDate,         setFromDate]         = useState(today);
  const [toDate,           setToDate]           = useState(today);
  const [days,             setDays]             = useState([]);
  const [search,           setSearch]           = useState('');
  const [errs,             setErrs]             = useState({});
  const [step,             setStep]             = useState('form');
  const [conflicts,        setConflicts]        = useState([]);
  const [pendingAssignIds, setPendingAssignIds] = useState([]);
  const [saving,           setSaving]           = useState(false);

  // Date presets (computed once)
  const presets = useMemo(() => {
    const n = new Date();
    const y = n.getFullYear();
    const mo = n.getMonth();
    return {
      today:      n.toISOString().slice(0, 10),
      monthStart: `${y}-${String(mo + 1).padStart(2, '0')}-01`,
      monthEnd:   new Date(y, mo + 1, 0).toISOString().slice(0, 10),
      yearStart:  `${y}-01-01`,
      yearEnd:    `${y}-12-31`,
    };
  }, []);

  // Employee id → object lookup
  const empMap = useMemo(() => {
    const m = {};
    employees.forEach(e => { m[e.id] = e; });
    return m;
  }, [employees]);

  // userId → other shift name (different shifts only)
  const otherShiftMap = useMemo(() => {
    const m = {};
    assignments.forEach(a => {
      if (a.user_id && a.shift?.id !== shift?.id) m[a.user_id] = a.shift?.name || 'Another Shift';
    });
    return m;
  }, [assignments, shift]);

  // userId set → already assigned to THIS shift in current month's data
  const thisShiftEmpIds = useMemo(() => {
    const s = new Set();
    assignments.forEach(a => {
      if (a.user_id && a.shift?.id === shift?.id) s.add(a.user_id);
    });
    return s;
  }, [assignments, shift]);

  // Reset on every open — pre-select already-assigned employees so they can be toggled
  useEffect(() => {
    if (open && shift) {
      setSelectedIds(new Set(thisShiftEmpIds));
      setOriginalIds(new Set(thisShiftEmpIds));
      setFromDate(today);
      setToDate(today);
      setDays(parseDays(shift.days_of_week).length > 0 ? parseDays(shift.days_of_week) : [1, 2, 3, 4, 5]);
      setSearch('');
      setErrs({});
      setConflicts([]);
      setPendingAssignIds([]);
      setStep('form');
      setSaving(false);
    }
  }, [open, shift]);

  const isWithinCurrentMonth = fromDate >= presets.monthStart && toDate <= presets.monthEnd;

  const filteredEmps = employees.filter(e =>
    !search ||
    e.name?.toLowerCase().includes(search.toLowerCase()) ||
    e.department?.toLowerCase().includes(search.toLowerCase())
  );

  const allFiltered = filteredEmps.length > 0 && filteredEmps.every(e => selectedIds.has(e.id));

  // Group conflicts by employee for display
  const conflictsByEmp = useMemo(() => {
    const m = {};
    conflicts.forEach(c => {
      if (!m[c.user_id]) m[c.user_id] = { emp: empMap[c.user_id], shift_name: c.shift_name, dates: [] };
      m[c.user_id].dates.push(c.date);
    });
    return Object.values(m);
  }, [conflicts, empMap]);

  function applyPreset(type) {
    if (type === 'today') { setFromDate(presets.today);      setToDate(presets.today); }
    if (type === 'month') { setFromDate(presets.monthStart); setToDate(presets.monthEnd); }
    if (type === 'year')  { setFromDate(presets.yearStart);  setToDate(presets.yearEnd); }
    setErrs(prev => { const e = { ...prev }; delete e.fromDate; delete e.toDate; return e; });
  }

  function toggleEmp(id) {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setErrs(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'employees')));
  }

  function toggleAll() {
    if (allFiltered) {
      setSelectedIds(prev => { const n = new Set(prev); filteredEmps.forEach(e => n.delete(e.id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); filteredEmps.forEach(e => n.add(e.id)); return n; });
      setErrs(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'employees')));
    }
  }

  function toggleDay(idx) {
    const next = days.includes(idx) ? days.filter(d => d !== idx) : [...days, idx];
    setDays(next);
    if (next.length === 0) setErrs(prev => ({ ...prev, days: 'Select at least one day' }));
    else setErrs(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== 'days')));
  }

  function handleFromChange(val) {
    setFromDate(val);
    const e = { ...errs };
    if (!val) { e.fromDate = 'Start date is required'; }
    else {
      delete e.fromDate;
      if (toDate && val > toDate) e.toDate = 'End date must be on or after start date';
      else delete e.toDate;
    }
    setErrs(e);
  }

  function handleToChange(val) {
    setToDate(val);
    const e = { ...errs };
    if (!val) { e.toDate = 'End date is required'; }
    else if (fromDate && val < fromDate) { e.toDate = 'End date must be on or after start date'; }
    else { delete e.toDate; }
    setErrs(e);
  }

  function validate() {
    const e = {};
    if (!fromDate) e.fromDate = 'Start date is required';
    if (!toDate)   e.toDate   = 'End date is required';
    if (fromDate && toDate && fromDate > toDate) e.toDate = 'End date must be on or after start date';
    if (days.length === 0) e.days = 'Select at least one day';
    const toUnassign = [...originalIds].filter(id => !selectedIds.has(id));
    const toAssign   = [...selectedIds].filter(id => !originalIds.has(id));
    if (selectedIds.size === 0 && toUnassign.length === 0 && toAssign.length === 0)
      e.employees = 'Select at least one employee';
    return e;
  }

  async function handleAssign() {
    const e = validate();
    if (Object.keys(e).length) { setErrs(e); return; }

    const toUnassign = [...originalIds].filter(id => !selectedIds.has(id));
    const toAssign   = [...selectedIds].filter(id => !originalIds.has(id));

    if (toUnassign.length === 0 && toAssign.length === 0) {
      toast('No changes to save', 'info');
      return;
    }

    setSaving(true);
    try {
      if (toUnassign.length > 0) {
        await apiDelete('/shifts/assignments/range', {
          shift_id:     shift.id,
          employee_ids: toUnassign,
          from_date:    fromDate,
          to_date:      toDate,
          days_of_week: days,
        });
      }

      if (toAssign.length > 0) {
        const data = await apiPost('/shifts/assignments/range', {
          shift_id:     shift.id,
          employee_ids: toAssign,
          from_date:    fromDate,
          to_date:      toDate,
          days_of_week: days,
          force:        false,
        });
        if (data.needs_confirmation) {
          setPendingAssignIds(toAssign);
          setConflicts(data.conflicts || []);
          setStep('conflicts');
          setSaving(false);
          return;
        }
      }

      const msgs = [];
      if (toAssign.length > 0)   msgs.push(`${toAssign.length} employee(s) assigned`);
      if (toUnassign.length > 0) msgs.push(`${toUnassign.length} employee(s) removed`);
      toast(`"${shift.name}": ${msgs.join(', ')}`, 'success');
      qc.invalidateQueries({ queryKey: ['shift-assign'] });
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleForce() {
    setSaving(true);
    try {
      await apiPost('/shifts/assignments/range', {
        shift_id:     shift.id,
        employee_ids: pendingAssignIds,
        from_date:    fromDate,
        to_date:      toDate,
        days_of_week: days,
        force:        true,
      });
      toast(`${pendingAssignIds.length} employee(s) assigned to "${shift.name}"`, 'success');
      qc.invalidateQueries({ queryKey: ['shift-assign'] });
      onClose();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!open || !shift) return null;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.55)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl border border-[#c7c4d8] flex flex-col"
        style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe] shrink-0">
          <div className="flex items-center gap-2.5">
            {step === 'conflicts' && (
              <button onClick={() => setStep('form')}
                className="w-7 h-7 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center mr-0.5">
                <ChevronLeft size={16} className="text-[#777587]" />
              </button>
            )}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: step === 'conflicts' ? '#fef3c7' : (shift.color + '20') }}>
              {step === 'conflicts'
                ? <AlertTriangle size={16} className="text-amber-500" />
                : <UserPlus size={16} style={{ color: shift.color || '#3525cd' }} />}
            </div>
            <div>
              <h2 className="font-black text-[#151c27] text-sm leading-tight">
                {step === 'conflicts' ? 'Shift Conflict Detected' : `Assign to "${shift.name}"`}
              </h2>
              <p className="text-[0.65rem] text-[#777587]">
                {step === 'conflicts'
                  ? `${conflictsByEmp.length} employee(s) already assigned elsewhere`
                  : `${shift.start_time} – ${shift.end_time}`}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center transition-colors">
            <X size={16} className="text-[#777587]" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {step === 'form' ? (
            <>
              {/* Date Range */}
              <div>
                <label className="block text-xs font-black text-[#464555] uppercase tracking-wider mb-2">
                  Assignment Period <span className="text-rose-500">*</span>
                </label>
                <div className="flex gap-2 mb-3">
                  {[
                    { key: 'today', label: 'Today' },
                    { key: 'month', label: 'This Month' },
                    { key: 'year',  label: 'Full Year' },
                  ].map(p => {
                    const active =
                      (p.key === 'today' && fromDate === presets.today && toDate === presets.today) ||
                      (p.key === 'month' && fromDate === presets.monthStart && toDate === presets.monthEnd) ||
                      (p.key === 'year'  && fromDate === presets.yearStart  && toDate === presets.yearEnd);
                    return (
                      <button key={p.key} type="button" onClick={() => applyPreset(p.key)}
                        className={`text-[0.68rem] font-bold px-3 py-1 rounded-full border transition-colors ${
                          active
                            ? 'border-[#3525cd] bg-[#3525cd] text-white'
                            : 'border-[#c7c4d8] text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd] hover:bg-[#f0f3ff]'
                        }`}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[0.7rem] text-[#777587] font-semibold mb-1 block">From</label>
                    <input type="date" value={fromDate}
                      onChange={e => handleFromChange(e.target.value)}
                      className={`form-control text-sm ${errs.fromDate ? 'border-rose-500' : ''}`} />
                    {errs.fromDate && <p className="text-[0.68rem] text-rose-600 mt-1">{errs.fromDate}</p>}
                  </div>
                  <div>
                    <label className="text-[0.7rem] text-[#777587] font-semibold mb-1 block">To</label>
                    <input type="date" value={toDate} min={fromDate}
                      onChange={e => handleToChange(e.target.value)}
                      className={`form-control text-sm ${errs.toDate ? 'border-rose-500' : ''}`} />
                    {errs.toDate && <p className="text-[0.68rem] text-rose-600 mt-1">{errs.toDate}</p>}
                  </div>
                </div>
              </div>

              {/* Days of Week */}
              <div>
                <label className="block text-xs font-black text-[#464555] uppercase tracking-wider mb-1.5">
                  Days within range <span className="text-rose-500">*</span>
                  <span className="text-[0.68rem] font-normal text-[#777587] ml-1.5 normal-case tracking-normal">
                    Which days of the week to assign
                  </span>
                </label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map((day, idx) => {
                    const active = days.includes(idx);
                    return (
                      <button key={idx} type="button" onClick={() => toggleDay(idx)}
                        className={`w-10 h-10 rounded-lg text-xs font-bold border transition-all ${
                          active ? 'text-white border-transparent' : 'bg-white text-[#777587] border-[#c7c4d8] hover:border-[#3525cd] hover:text-[#3525cd]'
                        }`}
                        style={active ? { background: shift.color || '#3525cd' } : {}}>
                        {day}
                      </button>
                    );
                  })}
                </div>
                {errs.days && <p className="text-[0.68rem] text-rose-600 mt-1.5">{errs.days}</p>}
              </div>

              {/* Employee Selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black text-[#464555] uppercase tracking-wider">
                    Select Employees <span className="text-rose-500">*</span>
                    {selectedIds.size > 0 && (
                      <span className="ml-2 text-[#3525cd] font-bold normal-case tracking-normal text-[0.7rem]">
                        {selectedIds.size} selected
                      </span>
                    )}
                  </label>
                  {filteredEmps.length > 0 && (
                    <button onClick={toggleAll}
                      className="text-[0.7rem] font-bold text-[#3525cd] hover:underline">
                      {allFiltered ? 'Deselect All' : 'Select All'}
                    </button>
                  )}
                </div>

                {/* Search */}
                <div className="relative mb-2">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name or department…"
                    className="form-control pl-8 text-xs" />
                </div>

                {/* Employee list */}
                <div className="border border-[#e7eefe] rounded-xl overflow-hidden"
                  style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {filteredEmps.length === 0 ? (
                    <p className="text-xs text-[#777587] text-center py-6">No employees found</p>
                  ) : filteredEmps.map(emp => {
                    const checked     = selectedIds.has(emp.id);
                    const wasAssigned = isWithinCurrentMonth && thisShiftEmpIds.has(emp.id);
                    const willRemove  = wasAssigned && !checked;
                    const otherShift  = !wasAssigned && otherShiftMap[emp.id];

                    const rowBg = willRemove ? 'bg-rose-50'
                      : wasAssigned ? 'bg-[#f4fef6]'
                      : checked ? 'bg-[#f0f3ff]' : '';

                    const cbClass = willRemove ? 'border-rose-400 bg-white'
                      : (wasAssigned && checked) ? 'border-green-500 bg-green-500'
                      : checked ? 'border-[#3525cd] bg-[#3525cd]'
                      : 'border-[#c7c4d8] bg-white';

                    let badge = null;
                    if (wasAssigned && checked)
                      badge = <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200 shrink-0 whitespace-nowrap">Assigned</span>;
                    else if (willRemove)
                      badge = <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-500 border border-rose-200 shrink-0 whitespace-nowrap">Will Remove</span>;
                    else if (otherShift)
                      badge = <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 shrink-0 whitespace-nowrap">{otherShift}</span>;

                    return (
                      <button key={emp.id} type="button" onClick={() => toggleEmp(emp.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#f0f3ff] transition-colors text-left border-b border-[#f0f3ff] last:border-0 ${rowBg}`}>
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${cbClass}`}>
                          {checked && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                          {willRemove && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                              <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          )}
                        </div>
                        <Avatar name={emp.name || '?'} color={emp.avatar_color} size={28} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-[#151c27] truncate">{emp.name}</p>
                          <p className="text-[0.65rem] text-[#777587] truncate">{emp.department || emp.email}</p>
                        </div>
                        {badge}
                      </button>
                    );
                  })}
                </div>
                {errs.employees && <p className="text-[0.68rem] text-rose-600 mt-1.5">{errs.employees}</p>}
              </div>
            </>
          ) : (
            /* Conflict step */
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  The employees below are already assigned to a <strong>different shift</strong> on some dates.
                  Proceeding will <strong>overwrite</strong> those assignments with <em>{shift.name}</em>.
                </p>
              </div>

              <div className="space-y-2.5">
                {conflictsByEmp.map(({ emp, shift_name, dates }) => (
                  <div key={emp?.id ?? shift_name}
                    className="bg-white border border-[#e7eefe] rounded-xl p-3">
                    <div className="flex items-center gap-2.5 mb-2">
                      <Avatar name={emp?.name || '?'} color={emp?.avatar_color} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-[#151c27] truncate">{emp?.name || 'Unknown'}</p>
                        <p className="text-[0.65rem] text-amber-600 font-semibold">Currently on: {shift_name}</p>
                      </div>
                      <span className="text-[0.6rem] font-bold text-[#777587] shrink-0">
                        {dates.length} date{dates.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {dates.slice(0, 12).map(d => (
                        <span key={d} className="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded bg-[#f0f3ff] text-[#3525cd]">
                          {d}
                        </span>
                      ))}
                      {dates.length > 12 && (
                        <span className="text-[0.6rem] text-[#777587]">+{dates.length - 12} more</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#e7eefe] flex justify-end gap-3 shrink-0">
          <button className="btn btn-outline"
            onClick={step === 'conflicts' ? () => setStep('form') : onClose}>
            {step === 'conflicts' ? 'Go Back' : 'Cancel'}
          </button>

          {step === 'form' ? (
            <button className="btn btn-primary" onClick={handleAssign} disabled={saving}>
              {saving
                ? <><span className="spinner w-4 h-4" />Saving…</>
                : 'Assign'}
            </button>
          ) : (
            <button
              onClick={handleForce}
              disabled={saving}
              className="flex items-center gap-2 bg-amber-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-amber-600 transition-colors disabled:opacity-60">
              {saving
                ? <><span className="spinner w-4 h-4" />Saving…</>
                : 'Proceed & Overwrite'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Shifts Page ──────────────────────────────────────────────────────────

export default function Shifts() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const qc    = useQueryClient();
  const { selectedBranchId } = useBranch();
  const now   = new Date();

  const [tab,         setTab]         = useState('shifts');
  const [addOpen,     setAddOpen]     = useState(false);
  const [editShift,   setEditShift]   = useState(null);
  const [assignShift, setAssignShift] = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null);
  const [month,       setMonth]       = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  );

  const { data: _sData, isLoading: sLoad } = useQuery({
    queryKey: ['shifts'],
    queryFn:  () => apiGet('/shifts'),
  });
  const { data: _aData, isLoading: aLoad } = useQuery({
    queryKey: ['shift-assign', month, selectedBranchId],
    queryFn:  () => apiGet('/shifts/assignments', { month }),
  });
  const { data: _eData } = useQuery({
    queryKey: ['employees', 'all', selectedBranchId],
    queryFn:  () => apiGet('/employees'),
    enabled:  isAdmin,
  });

  const shifts      = Array.isArray(_sData) ? _sData : [];
  const assignments = Array.isArray(_aData) ? _aData : [];
  const employees   = Array.isArray(_eData) ? _eData : (_eData?.employees || []);

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/shifts/${id}`),
    onSuccess:  () => { toast('Shift deleted', 'warning'); qc.invalidateQueries({ queryKey: ['shifts'] }); },
    onError:    e  => toast(e.message, 'error'),
  });

  // Derive unique employees per shift from current month's assignments
  const employeesByShift = useMemo(() => {
    const map = {};
    assignments.forEach(a => {
      const sid = a.shift?.id;
      if (!sid) return;
      if (!map[sid]) map[sid] = new Map();
      if (a.user_id && a.user) map[sid].set(a.user_id, a.user);
    });
    const result = {};
    Object.entries(map).forEach(([sid, empMap]) => {
      result[sid] = Array.from(empMap.values());
    });
    return result;
  }, [assignments]);

  return (
    <div>
      {/* Page header */}
      <div className="page-header mb-6">
        <div>
          <div className="page-title">Shifts & Roster</div>
          <div className="page-subtitle">Define shifts and manage employee assignments</div>
        </div>
        {isAdmin && tab === 'shifts' && (
          <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
            <Plus size={16} /> New Shift
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#f0f3ff] border border-[#c7c4d8] p-1 rounded-xl mb-6">
        {[
          { key: 'shifts', label: 'Shift Definitions', icon: <Clock size={13} /> },
          { key: 'roster', label: 'Monthly Roster',    icon: <Calendar size={13} /> },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
              tab === t.key ? 'bg-white text-[#3525cd] shadow-sm' : 'text-[#777587] hover:text-[#151c27]'
            }`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ── Shift Definitions ─────────────────────────────────────────────────── */}
      {tab === 'shifts' && (
        sLoad
          ? <div className="loading"><div className="spinner" />Loading…</div>
          : shifts.length === 0
            ? (
              <div className="empty-state">
                <Clock size={36} className="mx-auto mb-2 opacity-30" />
                <p>No shifts defined yet</p>
                {isAdmin && (
                  <button className="btn btn-primary mt-4" onClick={() => setAddOpen(true)}>
                    <Plus size={14} /> Create First Shift
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {shifts.map(s => {
                  const shiftDays  = parseDays(s.days_of_week);
                  const shiftEmps  = employeesByShift[s.id] || [];
                  const shownEmps  = shiftEmps.slice(0, 3);
                  const extraCount = Math.max(0, shiftEmps.length - 3);

                  return (
                    <div key={s.id} className="card p-5 flex flex-col">
                      {/* Card top row */}
                      <div className="flex items-start justify-between mb-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ background: s.color + '20' }}>
                          <Clock size={18} style={{ color: s.color }} />
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1">
                            <button
                              className="p-1.5 rounded-lg text-[#777587] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"
                              onClick={() => setEditShift(s)} title="Edit shift">
                              <Pencil size={13} />
                            </button>
                            <button
                              className="p-1.5 rounded-lg text-[#777587] hover:text-rose-500 hover:bg-rose-50 transition-colors"
                              onClick={() => setConfirmDel({ id: s.id, name: s.name })} title="Delete shift">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Name + time — EHN_SR_001: overnight indicator */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-black text-[#151c27]">{s.name}</div>
                        {s.start_time && s.end_time && s.end_time < s.start_time && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200">🌙 Overnight</span>
                        )}
                      </div>
                      <div className="text-sm font-bold mt-0.5" style={{ color: s.color }}>
                        {s.start_time} – {s.end_time}
                        {s.start_time && s.end_time && s.end_time < s.start_time && <span className="text-xs font-normal text-indigo-600 ml-1">(next day)</span>}
                      </div>

                      {/* Day pills */}
                      {shiftDays.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-2">
                          {DAYS.map((day, idx) => (
                            <span key={idx}
                              className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded ${
                                shiftDays.includes(idx) ? 'text-white' : 'text-[#c7c4d8] bg-[#f9f9ff]'
                              }`}
                              style={shiftDays.includes(idx) ? { background: s.color } : {}}>
                              {day}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Description */}
                      {s.description && (
                        <div className="text-xs text-[#777587] mt-1 line-clamp-1">{s.description}</div>
                      )}

                      {/* Employee info + assign button */}
                      <div className="border-t border-[#f0f3ff] mt-3 pt-3 flex-1 flex flex-col justify-between gap-2">
                        {shiftEmps.length > 0 ? (
                          <div className="flex items-center gap-2">
                            {/* Avatar stack */}
                            <div className="flex -space-x-1.5">
                              {shownEmps.map(emp => (
                                <div key={emp.id}
                                  className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-[0.5rem] font-black text-white"
                                  style={{ background: emp.avatar_color || '#3525cd' }}
                                  title={emp.name}>
                                  {(emp.name || '?').slice(0, 2).toUpperCase()}
                                </div>
                              ))}
                              {extraCount > 0 && (
                                <div className="w-6 h-6 rounded-full border-2 border-white bg-[#f0f3ff] flex items-center justify-center text-[0.5rem] font-black text-[#3525cd]">
                                  +{extraCount}
                                </div>
                              )}
                            </div>
                            <span className="text-[0.68rem] text-[#777587] font-semibold">
                              {shiftEmps.length} employee{shiftEmps.length !== 1 ? 's' : ''} · {month}
                            </span>
                          </div>
                        ) : (
                          <p className="text-[0.7rem] text-[#c7c4d8]">No employees assigned this month</p>
                        )}

                        {isAdmin && (
                          <button
                            onClick={() => setAssignShift(s)}
                            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-[#c7c4d8] text-xs font-bold text-[#3525cd] hover:border-[#3525cd] hover:bg-[#f0f3ff] transition-colors">
                            <UserPlus size={12} /> Assign Employees
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
      )}

      {/* ── Monthly Roster ─────────────────────────────────────────────────────── */}
      {tab === 'roster' && (
        <div>
          <div className="flex items-center gap-3 mb-5">
            <input type="month" className="form-control w-auto" value={month}
              onChange={e => setMonth(e.target.value)} />
            <span className="text-xs text-[#777587]">{assignments.length} assignment(s)</span>
          </div>

          {aLoad
            ? <div className="loading"><div className="spinner" />Loading…</div>
            : assignments.length === 0
              ? (
                <div className="empty-state">
                  <Calendar size={36} className="mx-auto mb-2 opacity-30" />
                  <p>No shifts assigned for {month}</p>
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-[#f0f3ff] border-b border-[#c7c4d8]">
                        <tr>
                          <th className="text-left px-4 py-3 font-black text-[#464555]">Employee</th>
                          <th className="text-left px-4 py-3 font-black text-[#464555]">Date</th>
                          <th className="text-left px-4 py-3 font-black text-[#464555]">Shift</th>
                          <th className="text-left px-4 py-3 font-black text-[#464555]">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f0f3ff]">
                        {assignments.map(a => (
                          <tr key={a.id} className="hover:bg-[#f9f9ff]">
                            <td className="px-4 py-3 flex items-center gap-2">
                              <Avatar name={a.user?.name || ''} color={a.user?.avatar_color} size={24} />
                              <span className="font-semibold text-[#151c27]">{a.user?.name}</span>
                            </td>
                            <td className="px-4 py-3 text-[#464555]">{fmtRosterDate(a.date)}</td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded-full text-[0.68rem] font-bold"
                                style={{ background: (a.shift?.color || '#3525cd') + '20', color: a.shift?.color || '#3525cd' }}>
                                {a.shift?.name}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-[#464555]">{a.shift?.start_time} – {a.shift?.end_time}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
          }
        </div>
      )}

      {/* Modals */}
      {addOpen     && <ShiftModal open onClose={() => setAddOpen(false)} />}
      {editShift   && <ShiftModal open onClose={() => setEditShift(null)} shift={editShift} />}
      {assignShift && (
        <AssignEmployeesModal
          open
          onClose={() => setAssignShift(null)}
          shift={assignShift}
          employees={employees}
          assignments={assignments}
        />
      )}
      <ConfirmModal
        open={!!confirmDel}
        title="Delete Shift"
        message={`Delete shift "${confirmDel?.name}"? All assignments for this shift will also be removed.`}
        confirmLabel="Delete"
        onConfirm={() => { delMut.mutate(confirmDel.id); setConfirmDel(null); }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
