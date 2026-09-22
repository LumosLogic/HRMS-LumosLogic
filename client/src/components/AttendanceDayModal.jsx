import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck, XCircle, Home, Timer, Coffee, LogIn, LogOut, AlertTriangle, Fingerprint } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { StatusBadge } from '@/components/ui/Badge';
import { fmtTime, fmtHours, fmtDate, todayStr, statusLabel, MONTHS, DAYS_FULL } from '@/lib/utils';

function fmtBreakMins(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function effectiveHours(rec) {
  return rec.work_hours || 0;
}
function fmtPunchTs(ts) {
  if (!ts) return '--';
  try {
    return new Date(ts).toLocaleTimeString('en-US', {
      timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return '--'; }
}

// ─── Unified Attendance Correction Modal ──────────────────────────────────────
// Handles three cases:
//   A. Edit existing real attendance record (PUT /attendance/:id)
//   B. Create attendance where none exists (POST /attendance/admin-edit)
//   C. Override approved leave: two-step confirmation that atomically cancels the
//      leave AND creates/updates attendance (POST /leaves/admin-override-attendance).
//      Biometric punches shown as read-only reference. Does NOT modify raw_logs.
function AttCorrectionModal({ emp, dateStr, existingRecord, isSynthetic, onClose, onRefresh }) {
  const { user: adminUser } = useAuth();
  const toast = useToast();
  const isCreate = !existingRecord?.id;

  // For synthetic overrides, fetch the exact day count from the backend using
  // the same buildWorkingDates + fetchHolidaySet logic as the actual override.
  // This avoids any discrepancy due to public holidays or org-configured work days.
  const [overrideLeaveInfo, setOverrideLeaveInfo] = useState(null); // { isMultiDay, days, startDate, endDate } | null
  const [overridePreviewLoading, setOverridePreviewLoading] = useState(false);

  useEffect(() => {
    if (!isSynthetic) return;
    setOverridePreviewLoading(true);
    apiGet('/leaves/override-preview', { userId: emp.id, date: dateStr })
      .then(d => setOverrideLeaveInfo({
        isMultiDay: d.is_multi_day,
        days:       d.days_to_restore,
        startDate:  d.start_date,
        endDate:    d.end_date,
      }))
      .catch(() => setOverrideLeaveInfo(null)) // graceful fallback — confirm still works
      .finally(() => setOverridePreviewLoading(false));
  }, [isSynthetic, emp.id, dateStr]);

  const [form, setForm] = useState({
    check_in:      existingRecord?.check_in      || '',
    check_out:     existingRecord?.check_out     || '',
    status:        isSynthetic ? 'present' : (existingRecord?.status || 'present'),
    is_late:       existingRecord?.is_late       || false,
    is_early_exit: existingRecord?.is_early_exit || false,
    notes:         '',
  });
  const [punches,      setPunches]      = useState([]);
  const [punchLoading, setPunchLoading] = useState(false);
  const [saving,       setSaving]       = useState(false);
  // Leave-override confirmation step
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  // Fetch biometric punches as read-only reference (returns [] for non-biometric employees)
  useEffect(() => {
    setPunchLoading(true);
    apiGet('/biometric/punches-for-date', { userId: emp.id, date: dateStr })
      .then(d => setPunches(Array.isArray(d) ? d : []))
      .catch(() => setPunches([]))
      .finally(() => setPunchLoading(false));
  }, [emp.id, dateStr]);

  // Live gross-hours preview
  const grossHoursLabel = useMemo(() => {
    if (!form.check_in || !form.check_out) return null;
    const [h1, m1] = form.check_in.split(':').map(Number);
    const [h2, m2] = form.check_out.split(':').map(Number);
    const diff = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (diff <= 0) return null;
    const h = Math.floor(diff / 60), m = diff % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }, [form.check_in, form.check_out]);

  // ── Case A / B: normal save (no leave involved) ──────────────────────────────
  async function saveAttendance() {
    setSaving(true);
    try {
      const correctionNote = [
        `Manually corrected by ${adminUser?.name || 'Admin'}`,
        form.notes?.trim() || null,
      ].filter(Boolean).join(' — ');

      if (!isCreate && existingRecord.id) {
        // A: update existing real record
        await apiPut(`/attendance/${existingRecord.id}`, {
          check_in:      form.check_in      || null,
          check_out:     form.check_out     || null,
          status:        form.status,
          is_late:       form.is_late,
          is_early_exit: form.is_early_exit,
          notes:         correctionNote,
        });
      } else {
        // B: create new record for absent employee
        await apiPost('/attendance/admin-edit', {
          user_id:       emp.id,
          date:          dateStr,
          check_in:      form.check_in      || null,
          check_out:     form.check_out     || null,
          status:        form.status,
          is_late:       form.is_late,
          is_early_exit: form.is_early_exit,
          notes:         correctionNote,
        });
      }
      toast(`Attendance ${isCreate ? 'created' : 'updated'} for ${emp.name}`, 'success');
      onRefresh();
      onClose();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  // ── Case C: override leave — called after user confirms the ConfirmModal ──────
  async function saveOverride() {
    setSaving(true);
    try {
      const result = await apiPost('/leaves/admin-override-attendance', {
        userId:        emp.id,
        date:          dateStr,
        check_in:      form.check_in      || null,
        check_out:     form.check_out     || null,
        status:        form.status,
        is_late:       form.is_late,
        is_early_exit: form.is_early_exit,
        notes:         form.notes?.trim() || null,
      });
      const restored = result.days_restored ?? 0;
      toast(
        `Leave cancelled · ${restored} day${restored !== 1 ? 's' : ''} restored · Attendance marked as ${form.status}`,
        'success'
      );
      onRefresh();
      onClose();
    } catch (err) { toast(err.message, 'error'); }
    finally { setSaving(false); setShowLeaveConfirm(false); }
  }

  const title = isSynthetic
    ? `Override Leave — ${emp.name}`
    : isCreate
      ? `Add Attendance — ${emp.name}`
      : `Edit Attendance — ${emp.name}`;

  const formBody = (
    <div className="space-y-4">
      {/* Leave-override info banner — shows backend-calculated days once loaded */}
      {isSynthetic && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-700 space-y-0.5">
            <p className="font-bold">This employee has an approved leave on this date.</p>
            {overridePreviewLoading ? (
              <p>Calculating leave days…</p>
            ) : overrideLeaveInfo ? (
              overrideLeaveInfo.isMultiDay ? (
                <p>
                  This date is part of a{' '}
                  <strong>{overrideLeaveInfo.days}-day</strong> approved leave{' '}
                  ({fmtDate(overrideLeaveInfo.startDate)} – {fmtDate(overrideLeaveInfo.endDate)}).{' '}
                  Confirming will cancel the <strong>entire</strong> leave and restore{' '}
                  <strong>all {overrideLeaveInfo.days} days</strong> to the balance.
                </p>
              ) : (
                <p>
                  Confirming will cancel the leave and restore{' '}
                  <strong>{overrideLeaveInfo.days} day{overrideLeaveInfo.days !== 1 ? 's' : ''}</strong> to the balance.
                </p>
              )
            ) : (
              <p>Confirming will cancel the leave and restore the leave balance.</p>
            )}
            <p>Attendance will be recorded as <strong className="capitalize">{form.status.replace(/_/g, ' ')}</strong>. This action cannot be undone.</p>
          </div>
        </div>
      )}

      {/* Biometric punches — read-only, not shown when empty */}
      {(punchLoading || punches.length > 0) && (
        <div className="rounded-xl bg-[#f0f3ff] border border-[#c7c4d8] p-3">
          <p className="text-[0.65rem] font-bold text-[#3525cd] uppercase tracking-wide flex items-center gap-1.5 mb-2">
            <Fingerprint size={11} /> Biometric Punches — Read-only Reference
          </p>
          {punchLoading ? (
            <p className="text-xs text-[#777587]">Loading punches…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {punches.map((p, i) => (
                <span key={p.id ?? i}
                  className="inline-flex items-center gap-1 text-xs font-mono font-semibold text-[#151c27] bg-white border border-[#c7c4d8] px-2 py-1 rounded-lg">
                  {fmtPunchTs(p.punch_time)}
                  {p.punch_type != null && (
                    <span className={`text-[0.6rem] font-bold ${
                      p.punch_type === 0 || p.punch_type === '0' ? 'text-emerald-600' : 'text-rose-500'
                    }`}>
                      {p.punch_type === 0 || p.punch_type === '0' ? '↑' : '↓'}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Check-in / out */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="form-label">Check In</label>
          <input type="time" className="form-control" value={form.check_in}
            onChange={e => setForm(f => ({ ...f, check_in: e.target.value }))} />
        </div>
        <div>
          <label className="form-label">Check Out</label>
          <input type="time" className="form-control" value={form.check_out}
            onChange={e => setForm(f => ({ ...f, check_out: e.target.value }))} />
        </div>
      </div>

      {grossHoursLabel && (
        <p className="text-xs text-[#464555] -mt-2">
          <span className="font-semibold">Work hours:</span> {grossHoursLabel}
          <span className="text-[#777587] ml-1">(breaks reset to 0 for manual edits)</span>
        </p>
      )}

      <div>
        <label className="form-label">Status</label>
        <select className="form-control" value={form.status}
          onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
          {['present', 'early_leave', 'half_day', 'wfh', 'absent', 'on_leave'].map(s => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-5">
        <label className="flex items-center gap-2 text-sm text-[#464555] cursor-pointer">
          <input type="checkbox" checked={form.is_late}
            onChange={e => setForm(f => ({ ...f, is_late: e.target.checked }))} />
          Late arrival
        </label>
        <label className="flex items-center gap-2 text-sm text-[#464555] cursor-pointer">
          <input type="checkbox" checked={form.is_early_exit}
            onChange={e => setForm(f => ({ ...f, is_early_exit: e.target.checked }))} />
          Early exit
        </label>
      </div>

      <div>
        <label className="form-label">
          {isSynthetic ? 'Reason for Override' : 'Correction Reason'}
          <span className="text-[#777587] font-normal ml-1">(optional — saved in audit trail)</span>
        </label>
        <input type="text" className="form-control"
          placeholder={isSynthetic
            ? 'e.g. Employee was present despite approved leave'
            : 'e.g. Employee checked in but biometric not captured'}
          value={form.notes}
          onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      </div>
    </div>
  );

  return (
    <>
      <Modal open onClose={onClose} title={title} size="md"
        footer={
          <>
            <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
            {isSynthetic ? (
              <button
                className="btn bg-amber-500 hover:bg-amber-600 text-white border-0 disabled:opacity-60"
                onClick={() => setShowLeaveConfirm(true)}
                disabled={saving || overridePreviewLoading}>
                {overridePreviewLoading ? 'Loading…' : 'Review Override →'}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={saveAttendance} disabled={saving}>
                {saving ? <><span className="spinner w-4 h-4" />Saving…</> : 'Save'}
              </button>
            )}
          </>
        }>
        {{ body: formBody }}
      </Modal>

      {/* Step 2: explicit confirmation before cancelling the leave */}
      {showLeaveConfirm && (
        <ConfirmModal
          open
          title="Confirm Leave Override"
          message={
            overrideLeaveInfo?.isMultiDay
              ? `This date belongs to a ${overrideLeaveInfo.days}-day approved leave (${fmtDate(overrideLeaveInfo.startDate)} – ${fmtDate(overrideLeaveInfo.endDate)}). Overriding this date will cancel the entire leave request and restore all ${overrideLeaveInfo.days} days to ${emp.name}'s balance. Attendance will be recorded as "${statusLabel(form.status)}". Continue?`
              : `This will permanently cancel ${emp.name}'s approved leave on ${dateStr} and restore ${overrideLeaveInfo?.days ?? 1} day${(overrideLeaveInfo?.days ?? 1) !== 1 ? 's' : ''} to their balance. Attendance will be recorded as "${statusLabel(form.status)}". Continue?`
          }
          confirmLabel={saving ? 'Saving…' : 'Yes, Override'}
          variant="warning"
          onConfirm={saveOverride}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}
    </>
  );
}

// Self-contained attendance day-view modal — renders on any page without navigation
export function AttendanceDayModal({ dateStr, initialTab = 'all', onClose, onRefresh }) {
  const { user, isAdmin, isRootAdmin } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [activeTab, setActiveTab] = useState(initialTab || 'all');
  const [correctionTarget, setCorrectionTarget] = useState(null); // { emp, record, isSynthetic }
  const [confirmAbsent, setConfirmAbsent]       = useState(null);

  const d = new Date(dateStr + 'T12:00:00');
  const year  = d.getFullYear();
  const month = d.getMonth() + 1;

  const { data: attendance = [], refetch: refetchAtt } = useQuery({
    queryKey: ['att-day-modal', year, month, selectedBranchId],
    queryFn:  () => apiGet('/attendance', { year, month }),
    staleTime: 30000,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['employees-list', selectedBranchId],
    queryFn:  async () => {
      const all = await apiGet('/employees');
      return all.filter(e => e.role === 'employee');
    },
    staleTime: 60000,
  });

  const { data: leaves = [] } = useQuery({
    queryKey: ['leaves-month', year, month, selectedBranchId],
    queryFn:  () => apiGet('/leaves', { year, month }),
    staleTime: 60000,
  });

  // Build per-user attendance map for this date with leave overlay
  const grouped = {};
  attendance.filter(r => r.date === dateStr).forEach(r => {
    grouped[r.user_id] = r;
  });
  leaves
    .filter(l => l.status === 'approved' && l.start_date <= dateStr && l.end_date >= dateStr)
    .forEach(l => {
      const leaveStatus =
        (l.leave_time === 'wfh' || l.leave_type === 'wfh') ? 'wfh'
        : l.leave_time === 'half' ? 'half_day'
        : 'on_leave';
      if (!grouped[l.user_id]) {
        grouped[l.user_id] = {
          user_id: l.user_id, date: dateStr,
          status: leaveStatus, _synthetic: true,
        };
      }
    });

  const dayRecords = Object.values(grouped);
  const present  = dayRecords.filter(r => r.status === 'present' || r.status === 'early_leave').length;
  const absent   = dayRecords.filter(r => r.status === 'absent').length;
  const onLeave  = dayRecords.filter(r => r.status === 'on_leave').length;
  const wfh      = dayRecords.filter(r => r.status === 'wfh').length;
  const halfDay  = dayRecords.filter(r => r.status === 'half_day').length;

  const isFutureDay = dateStr > todayStr();
  const displayEmps = isAdmin ? employees : employees.filter(e => e.id === user?.id);

  const filteredEmps = activeTab === 'all'
    ? (isFutureDay
        ? displayEmps.filter(emp => {
            const rec = grouped[emp.id];
            return rec && ['on_leave', 'early_leave', 'half_day', 'wfh'].includes(rec.status);
          })
        : displayEmps)
    : displayEmps.filter(emp => {
        const rec = grouped[emp.id];
        if (activeTab === 'present')  return rec && (rec.status === 'present' || rec.status === 'early_leave') && !rec?._synthetic;
        if (activeTab === 'on_leave') return rec && (rec.status === 'on_leave' || rec.status === 'half_day');
        if (activeTab === 'wfh')      return rec && rec.status === 'wfh';
        if (activeTab === 'absent')   return rec && rec.status === 'absent';
        if (activeTab === 'none')     return !rec;
        return true;
      });

  async function doMarkAbsent(emp) {
    try {
      await apiPost('/attendance/mark-absent', { user_id: emp.id, date: dateStr });
      toast('Marked absent', 'success');
      handleAttRefresh();
    } catch (err) { toast(err.message, 'error'); }
    setConfirmAbsent(null);
  }

  function handleAttRefresh() {
    refetchAtt();
    qc.invalidateQueries({ queryKey: ['root-dashboard'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['calendar'] });
    onRefresh?.();
  }

  const filterTabs = isFutureDay
    ? [['all', 'On Leave'], ['on_leave', 'Leave'], ['wfh', 'WFH']]
    : [['all', 'All'], ['present', 'Present'], ['on_leave', 'On Leave'], ['wfh', 'WFH'], ['absent', 'Absent'], ['none', 'No Record']];

  return (
    <>
      <Modal open onClose={onClose} title="" size="lg">
        {{
          body: (
            <>
              {/* Date header */}
              <div className="flex items-center gap-5 mb-4 p-4 rounded-xl border border-[#c7c4d8] relative overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(53,37,205,.06), rgba(113,42,226,.04))' }}>
                <div className="text-5xl font-black tracking-[-0.05em]"
                  style={{ background: 'linear-gradient(135deg, #3525cd, #712ae2)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                  {d.getDate()}
                </div>
                <div className="flex-1">
                  <div className="text-base font-black">
                    {DAYS_FULL[d.getDay()]}, {MONTHS[d.getMonth()]} {d.getFullYear()}
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                      <UserCheck size={11} /> {present} Present
                    </span>
                    <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                      {onLeave} On Leave
                    </span>
                    {wfh > 0 && (
                      <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-[#e7eefe] text-[#3525cd] border border-[#c7c4d8]">
                        <Home size={11} /> {wfh} WFH
                      </span>
                    )}
                    {halfDay > 0 && (
                      <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-700 border border-cyan-200">
                        {halfDay} Half Day
                      </span>
                    )}
                    {absent > 0 && (
                      <span className="inline-flex items-center gap-1 text-[0.7rem] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                        <XCircle size={11} /> {absent} Absent
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Filter tabs */}
              {isAdmin && (
                <div className="flex gap-1 mb-3 flex-wrap">
                  {filterTabs.map(([k, l]) => (
                    <button key={k} onClick={() => setActiveTab(k)}
                      className={`text-[0.7rem] font-bold px-2.5 py-1 rounded-lg transition-colors ${
                        activeTab === k
                          ? 'bg-[#3525cd] text-white'
                          : 'bg-[#f0f3ff] text-[#464555] hover:bg-[#e7eefe]'
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              )}

              {/* Employee list */}
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                {filteredEmps.map(emp => {
                  const rec = grouped[emp.id];
                  return (
                    <div key={emp.id}
                      className={`flex items-center gap-3.5 p-3.5 border rounded-xl transition-all duration-150 ${
                        rec?.status === 'present'  ? 'border-emerald-300 bg-emerald-50 hover:border-emerald-400' :
                        rec?.status === 'on_leave' ? 'border-amber-300 bg-amber-50 hover:border-amber-400' :
                        rec?.status === 'wfh'      ? 'border-[#c7c4d8] bg-[#f0f3ff] hover:border-[#3525cd]' :
                        rec?.status === 'absent'   ? 'border-rose-300 bg-rose-50 hover:border-rose-400' :
                        rec?.status === 'half_day' ? 'border-cyan-300 bg-cyan-50 hover:border-cyan-400' :
                        'border-[#e7eefe] hover:border-[#3525cd] hover:bg-[#f0f3ff]'
                      }`}>
                      <Avatar name={emp.name} color={emp.avatar_color} size={38} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-[#151c27]">{emp.name}</div>
                        <div className="text-xs text-[#777587]">
                          {emp.department}{emp.position ? ` · ${emp.position}` : ''}
                        </div>
                        {rec && (
                          <div className="mt-1 flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <StatusBadge status={rec.status} />
                              {rec._synthetic && (
                                <span className="text-[0.6rem] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                  Approved Leave
                                </span>
                              )}
                            </div>
                            {!rec._synthetic && rec.check_in && (
                              <div className="flex items-center gap-2 flex-wrap text-[0.65rem] text-[#777587]">
                                <span className="flex items-center gap-0.5"><LogIn size={10} className="text-emerald-500" /> {fmtTime(rec.check_in)}</span>
                                {rec.check_out ? (
                                  <span className="flex items-center gap-0.5"><LogOut size={10} className="text-rose-500" /> {fmtTime(rec.check_out)}</span>
                                ) : dateStr === todayStr() ? (
                                  <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" /> In Progress
                                  </span>
                                ) : (
                                  <span className="text-amber-600 font-semibold">No checkout</span>
                                )}
                                {fmtBreakMins(rec.total_break_minutes) && (
                                  <span className="flex items-center gap-0.5 text-amber-600"><Coffee size={10} /> {fmtBreakMins(rec.total_break_minutes)} break</span>
                                )}
                                {effectiveHours(rec) > 0 && (
                                  <span className="flex items-center gap-0.5 font-bold text-[#3525cd]"><Timer size={10} /> {fmtHours(effectiveHours(rec))}</span>
                                )}
                                {rec.notes && (
                                  <span className="text-[#777587] italic truncate max-w-[160px]" title={rec.notes}>{rec.notes}</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {!rec && <span className="text-xs text-[#777587] italic">No record yet</span>}
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                          {/* Real record — Edit */}
                          {rec && !rec._synthetic && (
                            <button className="btn btn-outline btn-sm text-xs py-1 px-2"
                              onClick={() => setCorrectionTarget({ emp, record: rec, isSynthetic: false })}>
                              Edit
                            </button>
                          )}
                          {/* Synthetic / leave overlay — root admin can override */}
                          {rec && rec._synthetic && isRootAdmin && !isFutureDay && (
                            <button className="btn btn-outline btn-sm text-xs py-1 px-2 text-amber-700 border-amber-300 hover:bg-amber-50"
                              onClick={() => setCorrectionTarget({ emp, record: null, isSynthetic: true })}>
                              Override Leave
                            </button>
                          )}
                          {/* No record — Add or quick Absent */}
                          {!rec && dateStr <= todayStr() && (
                            <>
                              <button className="btn btn-outline btn-sm text-xs py-1 px-2"
                                onClick={() => setCorrectionTarget({ emp, record: null, isSynthetic: false })}>
                                Add Record
                              </button>
                              <button className="btn btn-danger btn-sm text-xs py-1 px-2"
                                onClick={() => setConfirmAbsent(emp)}>
                                Absent
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredEmps.length === 0 && (
                  <div className="text-center py-8 text-sm text-[#777587]">
                    No employees in this filter
                  </div>
                )}
              </div>
            </>
          ),
        }}
      </Modal>

      {/* Unified attendance correction modal */}
      {correctionTarget && (
        <AttCorrectionModal
          emp={correctionTarget.emp}
          dateStr={dateStr}
          existingRecord={correctionTarget.record}
          isSynthetic={correctionTarget.isSynthetic}
          onClose={() => setCorrectionTarget(null)}
          onRefresh={handleAttRefresh}
        />
      )}

      <ConfirmModal
        open={!!confirmAbsent}
        title="Mark Absent"
        message={`Mark ${confirmAbsent?.name} as absent for ${dateStr}?`}
        confirmLabel="Mark Absent"
        variant="danger"
        onConfirm={() => doMarkAbsent(confirmAbsent)}
        onCancel={() => setConfirmAbsent(null)}
      />
    </>
  );
}
