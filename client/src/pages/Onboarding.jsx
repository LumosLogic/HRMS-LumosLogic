import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, UserPlus, ClipboardList, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';

const ASSIGNED_CFG = {
  employee: { cls: 'badge-pending',   label: 'You',     bg: 'bg-amber-50',   text: 'text-amber-700'  },
  hr:       { cls: 'badge-approved',  label: 'HR',      bg: 'bg-emerald-50', text: 'text-emerald-700'},
  it:       { cls: 'bg-[#f0f3ff] text-[#3525cd] border-[#c7c4d8]', label: 'IT',      bg: 'bg-[#f0f3ff]', text: 'text-[#3525cd]' },
  manager:  { cls: 'bg-purple-50 text-purple-700 border-purple-200', label: 'Manager', bg: 'bg-purple-50', text: 'text-purple-700' },
};

function ProgressRing({ pct }) {
  const r   = 20;
  const c   = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <svg width={52} height={52} viewBox="0 0 52 52" className="flex-shrink-0">
      <circle cx={26} cy={26} r={r} fill="none" stroke="#f0f3ff" strokeWidth={4} />
      <circle cx={26} cy={26} r={r} fill="none" stroke="#3525cd" strokeWidth={4}
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform="rotate(-90 26 26)" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      <text x={26} y={30} textAnchor="middle" fontSize={10} fontWeight="900" fill="#3525cd">{pct}%</text>
    </svg>
  );
}

function TaskItem({ task, onToggle, canToggle }) {
  const cfg = ASSIGNED_CFG[task.assigned_to] || ASSIGNED_CFG.employee;
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-xl border transition-all ${task.completed ? 'bg-emerald-50/50 border-emerald-100' : 'bg-white border-[#e7eefe] hover:border-[#c7c4d8]'} ${canToggle ? 'cursor-pointer' : ''}`}
      onClick={() => canToggle && onToggle(task.id, !task.completed)}>
      <div className="flex-shrink-0 mt-0.5">
        {task.completed
          ? <CheckCircle2 size={20} className="text-emerald-500" />
          : <Circle size={20} className={canToggle ? 'text-[#c7c4d8] hover:text-[#3525cd]' : 'text-[#c7c4d8]'} />}
      </div>
      <div className="flex-1 min-w-0">
        <span className={`font-semibold text-sm ${task.completed ? 'line-through text-[#777587]' : 'text-[#151c27]'}`}>{task.title}</span>
        {task.description && <p className="text-xs text-[#777587] mt-0.5">{task.description}</p>}
        {task.due_date && !task.completed && <p className="text-xs text-amber-600 mt-0.5 font-semibold">Due: {task.due_date}</p>}
        {task.completed_at && <p className="text-xs text-emerald-600 mt-0.5">Done {new Date(task.completed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>}
      </div>
      <span className={`badge ${cfg.cls} flex-shrink-0 text-[0.65rem]`}>{cfg.label}</span>
    </div>
  );
}

function MyOnboarding() {
  const toast = useToast();
  const qc    = useQueryClient();

  const { data: _taskData, isLoading } = useQuery({ queryKey: ['onboarding-me'], queryFn: () => apiGet('/onboarding') });
  const tasks = Array.isArray(_taskData) ? _taskData : [];

  const toggleMut = useMutation({
    mutationFn: ({ id, completed }) => apiPut(`/onboarding/${id}/complete`, { completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-me'] }),
    onError: e => toast(e.message, 'error'),
  });

  if (isLoading) return <div className="loading"><div className="spinner" />Loading your tasks…</div>;

  if (tasks.length === 0) return (
    <div className="empty-state">
      <ClipboardList size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
      <p className="font-semibold text-[#464555] mb-1">No onboarding tasks yet</p>
      <p className="text-sm">Your HR team will assign onboarding tasks when you join</p>
    </div>
  );

  const done       = tasks.filter(t => t.completed).length;
  const pct        = Math.round((done / tasks.length) * 100);
  const myTasks    = tasks.filter(t => t.assigned_to === 'employee');
  const hrTasks    = tasks.filter(t => t.assigned_to === 'hr');
  const itTasks    = tasks.filter(t => t.assigned_to === 'it');
  const mgrTasks   = tasks.filter(t => t.assigned_to === 'manager');
  const otherTasks = tasks.filter(t => t.assigned_to !== 'employee');
  const myDone     = myTasks.filter(t => t.completed).length;

  return (
    <div className="space-y-6">
      {/* Overall progress card */}
      <div className="card p-5">
        <div className="flex items-center gap-5">
          <ProgressRing pct={pct} />
          <div className="flex-1">
            <h3 className="font-black text-[#151c27] text-base mb-1">Onboarding Progress</h3>
            <p className="text-sm text-[#464555]">{done} of {tasks.length} tasks completed</p>
            <div className="h-2 bg-[#f0f3ff] rounded-full mt-3 overflow-hidden">
              <div className="h-full bg-[#3525cd] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
          {pct === 100 && (
            <div className="flex flex-col items-center gap-1">
              <CheckCircle2 size={28} className="text-emerald-500" />
              <span className="text-xs font-bold text-emerald-600">All done!</span>
            </div>
          )}
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Your Tasks',    value: `${myDone}/${myTasks.length}`,    color: 'from-[#f0f3ff] to-[#e7eefe]', top: '#3525cd', text: 'text-[#3525cd]' },
          { label: 'Team Tasks',    value: `${otherTasks.filter(t=>t.completed).length}/${otherTasks.length}`, color: 'from-emerald-50 to-emerald-100', top: '#10B981', text: 'text-emerald-700' },
          { label: 'Overall',       value: `${pct}%`,                        color: 'from-amber-50 to-amber-100',   top: '#F59E0B', text: 'text-amber-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-card relative overflow-hidden`}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
            <div className={`text-2xl font-black ${s.text}`}>{s.value}</div>
            <div className="text-[0.68rem] font-bold uppercase tracking-wider text-[#777587] mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Your tasks */}
      {myTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">Your Tasks</p>
            <div className="flex-1 h-px bg-[#f0f3ff]" />
            <span className="text-xs font-bold text-[#c7c4d8]">{myDone}/{myTasks.length}</span>
          </div>
          <div className="space-y-2">
            {myTasks.map(t => <TaskItem key={t.id} task={t} canToggle onToggle={(id, c) => toggleMut.mutate({ id, completed: c })} />)}
          </div>
        </div>
      )}

      {/* HR tasks */}
      {hrTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">HR Tasks</p>
            <div className="flex-1 h-px bg-[#f0f3ff]" />
            <span className="text-xs text-[#777587] italic">Managed by HR</span>
          </div>
          <div className="space-y-2">
            {hrTasks.map(t => <TaskItem key={t.id} task={t} canToggle={false} />)}
          </div>
        </div>
      )}

      {/* IT tasks */}
      {itTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">IT Tasks</p>
            <div className="flex-1 h-px bg-[#f0f3ff]" />
            <span className="text-xs text-[#777587] italic">Managed by IT</span>
          </div>
          <div className="space-y-2">
            {itTasks.map(t => <TaskItem key={t.id} task={t} canToggle={false} />)}
          </div>
        </div>
      )}

      {/* Manager tasks */}
      {mgrTasks.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">Manager Tasks</p>
            <div className="flex-1 h-px bg-[#f0f3ff]" />
            <span className="text-xs text-[#777587] italic">Managed by your Manager</span>
          </div>
          <div className="space-y-2">
            {mgrTasks.map(t => <TaskItem key={t.id} task={t} canToggle={false} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminOnboarding() {
  const toast = useToast();
  const qc    = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [expanded,    setExpanded]    = useState(null);
  // ENH_ONBOARD_007: search and filter state
  const [onbSearch,   setOnbSearch]   = useState('');
  const [onbFilter,   setOnbFilter]   = useState('all'); // 'all' | 'incomplete' | 'complete' | 'stuck'

  const { data: _ovData, isLoading } = useQuery({ queryKey: ['onboarding-overview', selectedBranchId], queryFn: () => apiGet('/onboarding/overview') });
  const { data: _eData }             = useQuery({ queryKey: ['employees', 'all', selectedBranchId],    queryFn: () => apiGet('/employees') });
  const overview  = Array.isArray(_ovData) ? _ovData : [];
  const employees = Array.isArray(_eData)  ? _eData  : [];

  const initMut = useMutation({
    mutationFn: userId => apiPost(`/onboarding/init/${userId}`, {}),
    onSuccess: () => { toast('Onboarding started!', 'success'); qc.invalidateQueries({ queryKey: ['onboarding-overview'] }); },
    onError: e => toast(e.message, 'error'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, completed }) => apiPut(`/onboarding/${id}/complete`, { completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-overview'] }),
    onError: e => toast(e.message, 'error'),
  });

  const onboardedIds = new Set(overview.map(o => String(o.user?.id)));
  // BUG_158: only show active employees in the "not started" list — exclude inactive/terminated/resigned
  const notStarted   = employees.filter(e =>
    !onboardedIds.has(String(e.id)) &&
    (!e.employee_status || e.employee_status === 'active' || e.employee_status === 'probation')
  );

  return (
    <div className="space-y-5">
      {/* Not started alert */}
      {notStarted.length > 0 && (
        <div className="card p-5 border-amber-200 bg-amber-50">
          <p className="text-xs font-black uppercase tracking-widest text-amber-800 mb-3">
            {notStarted.length} employee{notStarted.length > 1 ? 's' : ''} without onboarding checklist
          </p>
          <div className="flex flex-wrap gap-2">
            {notStarted.map(e => (
              <button key={e.id} onClick={() => initMut.mutate(e.id)} disabled={initMut.isPending}
                className="flex items-center gap-1.5 bg-white border border-amber-300 rounded-full px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 transition-colors">
                <UserPlus size={12} />{e.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ENH_ONBOARD_007: Search/filter bar */}
      {overview.length > 0 && (
        <div className="flex flex-wrap gap-2 p-3 bg-[#f9f9ff] border border-[#e7eefe] rounded-xl">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#777587]" />
            <input className="form-control pl-8 py-1.5 text-xs" placeholder="Search by name or department…"
              value={onbSearch} onChange={e => setOnbSearch(e.target.value)} />
          </div>
          {['all','incomplete','complete','stuck'].map(f => (
            <button key={f} onClick={() => setOnbFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${onbFilter === f ? 'bg-[#3525cd] text-white border-[#3525cd]' : 'border-[#c7c4d8] text-[#464555] hover:border-[#3525cd] hover:text-[#3525cd]'}`}>
              {f === 'all' ? 'All' : f === 'incomplete' ? 'In Progress' : f === 'complete' ? 'Completed' : 'Stuck (<50%)'}
            </button>
          ))}
        </div>
      )}

      {isLoading ? <div className="loading"><div className="spinner" />Loading…</div>
        : overview.length === 0
          ? <div className="empty-state"><ClipboardList size={48} className="mx-auto mb-3 text-[#c7c4d8]" /><p className="font-semibold text-[#464555] mb-1">No onboarding in progress</p><p className="text-sm">Click on an employee above to start their onboarding checklist</p></div>
          : overview.filter(o => {
              const pct = o.total > 0 ? Math.round((o.completed / o.total) * 100) : 0;
              if (onbSearch) {
                const q = onbSearch.toLowerCase();
                if (!(o.user?.name || '').toLowerCase().includes(q) && !(o.user?.department || '').toLowerCase().includes(q)) return false;
              }
              if (onbFilter === 'complete' && pct < 100) return false;
              if (onbFilter === 'incomplete' && pct >= 100) return false;
              if (onbFilter === 'stuck' && pct >= 50) return false;
              return true;
            }).map(o => {
              const pct    = o.total > 0 ? Math.round((o.completed / o.total) * 100) : 0;
              const isOpen = expanded === o.user?.id;
              return (
                <div key={o.user?.id} className="card overflow-hidden hover:shadow-card-hover transition-all duration-200">
                  <div className="p-5 flex items-center gap-4 cursor-pointer" onClick={() => setExpanded(isOpen ? null : o.user?.id)}>
                    <Avatar name={o.user?.name} color={o.user?.avatar_color} size={42} />
                    <div className="flex-1 min-w-0">
                      <div className="font-black text-[#151c27]">{o.user?.name}</div>
                      <div className="text-xs text-[#777587]">{o.user?.department || 'No department'}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <ProgressRing pct={pct} />
                      <div className="text-right hidden sm:block">
                        <div className="font-black text-[#151c27]">{o.completed}/{o.total}</div>
                        <div className="text-[0.65rem] text-[#777587] uppercase tracking-wide">Tasks done</div>
                      </div>
                      {isOpen ? <ChevronUp size={15} className="text-[#777587]" /> : <ChevronDown size={15} className="text-[#777587]" />}
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t border-[#f0f3ff] p-5 bg-[#f9f9ff] space-y-2">
                      {(o.tasks || []).map(t => (
                        <TaskItem key={t.id} task={t} canToggle
                          onToggle={(id, c) => toggleMut.mutate({ id, completed: c })} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
    </div>
  );
}

export default function Onboarding() {
  const { isAdmin, isEmployee } = useAuth();
  const wrap = '';
  return (
    <div className={wrap}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Onboarding</h1>
          <p className="page-subtitle">{isAdmin ? 'Manage new employee onboarding checklists' : 'Complete your onboarding tasks to get started'}</p>
        </div>
      </div>
      {isAdmin ? <AdminOnboarding /> : <MyOnboarding />}
    </div>
  );
}
