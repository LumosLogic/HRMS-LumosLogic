import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck, XCircle, Home, Timer, Coffee, LogIn, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { StatusBadge } from '@/components/ui/Badge';
import { fmtTime, fmtHours, todayStr, statusLabel, MONTHS, DAYS_FULL } from '@/lib/utils';

function fmtBreakMins(mins) {
  if (!mins) return null;
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function effectiveHours(rec) {
  return rec.work_hours || 0;
}

// Inline edit attendance sub-modal — stays within the dashboard context
function EditAttSubModal({ record, onClose, onRefresh }) {
  const toast = useToast();
  const [form, setForm] = useState({
    check_in:   record.check_in   || '',
    check_out:  record.check_out  || '',
    status:     record.status     || 'present',
    work_hours: record.work_hours || '',
  });

  async function save() {
    try {
      await apiPut(`/attendance/${record.id}`, form);
      toast('Attendance updated', 'success');
      onRefresh();
      onClose();
    } catch (err) { toast(err.message, 'error'); }
  }

  return (
    <Modal open onClose={onClose} title={`Edit Attendance — ${record.name}`} size="sm"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </>
      }>
      {{
        body: (
          <div className="space-y-3">
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
            <div>
              <label className="form-label">Status</label>
              <select className="form-control" value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {['present','early_leave','absent','on_leave','half_day','wfh'].map(s => (
                  <option key={s} value={s}>{statusLabel(s)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Work Hours</label>
              <input type="number" className="form-control" step="0.25" value={form.work_hours}
                onChange={e => setForm(f => ({ ...f, work_hours: e.target.value }))} />
            </div>
          </div>
        ),
      }}
    </Modal>
  );
}

// Self-contained attendance day-view modal — renders on any page without navigation
export function AttendanceDayModal({ dateStr, initialTab = 'all', onClose, onRefresh }) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [activeTab, setActiveTab] = useState(initialTab || 'all');
  const [editRec, setEditRec] = useState(null);
  const [confirmAbsent, setConfirmAbsent] = useState(null);

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
    qc.invalidateQueries({ queryKey: ['calendar'] }); // BUG_072: refresh calendar grid
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
                              </div>
                            )}
                          </div>
                        )}
                        {!rec && <span className="text-xs text-[#777587] italic">No record yet</span>}
                      </div>
                      {isAdmin && (
                        <div className="flex gap-1.5 shrink-0">
                          {rec && !rec._synthetic && (
                            <button className="btn btn-outline btn-sm text-xs py-1 px-2"
                              onClick={() => setEditRec(rec)}>
                              Edit
                            </button>
                          )}
                          {!rec && dateStr <= todayStr() && (
                            <button className="btn btn-danger btn-sm text-xs py-1 px-2"
                              onClick={() => setConfirmAbsent(emp)}>
                              Absent
                            </button>
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

      {/* Edit sub-modal — stacks on top without closing the day view */}
      {editRec && (
        <EditAttSubModal
          record={editRec}
          onClose={() => setEditRec(null)}
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
