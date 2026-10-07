import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Users, Info, Plus, Minus, Search } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { BRANCH_KEYED } from '@/lib/queryScopes';
import { apiGet, apiPost } from '@/lib/api';
import { cn, fmtDate } from '@/lib/utils';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Section, Row, Toggle, NumInput } from './settingsUi';

// Probation management: org defaults + the two lists (on probation / not on probation).
// Add (+) and Remove (−) call the payroll probation endpoints, which write the same employee fields the
// Employees form, the profile and the daily probation cron use — so the profile and status stay in step.

function PersonRow({ emp, action, busy, onAction, sub }) {
  const isAdd = action === 'add';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#fafaff]">
      <Avatar name={emp.name} color={emp.avatar_color} size={30} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-[#151c27] truncate">{emp.name}</p>
        <p className="text-[0.65rem] text-[#777587] truncate">
          {[emp.employee_id, emp.department].filter(Boolean).join(' · ') || '—'}
        </p>
        {sub && <p className="text-[0.62rem] text-[#9ca3af]">{sub}</p>}
      </div>
      <button
        type="button" disabled={busy} onClick={() => onAction(emp)}
        title={isAdd ? 'Add to probation' : 'Remove from probation'}
        className={cn('w-7 h-7 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-40',
          isAdd ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border-rose-300 text-rose-600 hover:bg-rose-50')}>
        {isAdd ? <Plus size={14} /> : <Minus size={14} />}
      </button>
    </div>
  );
}

function PersonList({ title, count, tone, search, onSearch, empty, children }) {
  return (
    <div className="border border-[#e7eefe] rounded-xl overflow-hidden flex flex-col min-h-[16rem]">
      <div className={cn('flex items-center justify-between px-3 py-2 border-b border-[#e7eefe]', tone)}>
        <p className="text-xs font-black uppercase tracking-wider">{title}</p>
        <span className="text-[0.68rem] font-bold">{count}</span>
      </div>
      <div className="relative border-b border-[#f0f3ff]">
        <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Search name, ID, department…"
          className="w-full pl-8 pr-3 py-2 text-xs focus:outline-none bg-white" />
      </div>
      <div className="overflow-y-auto max-h-80 divide-y divide-[#f4f5fb] flex-1">
        {React.Children.count(children) === 0
          ? <p className="text-xs text-[#9ca3af] text-center py-8">{empty}</p>
          : children}
      </div>
    </div>
  );
}

const matches = (e, q) => {
  if (!q.trim()) return true;
  const t = q.trim().toLowerCase();
  return [e.name, e.employee_id, e.department, e.position].some(v => String(v || '').toLowerCase().includes(t));
};

export default function ProbationManager({ form, set, settings }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const { selectedBranchId } = useBranch();
  const [onSearch,  setOnSearch]  = useState('');
  const [offSearch, setOffSearch] = useState('');
  const [removing,  setRemoving]  = useState(null);
  const [applying,  setApplying]  = useState(false);
  const [bulkOpen,  setBulkOpen]  = useState(false);

  // Lists follow the SAVED setting: probation must be enabled (and saved) before anyone can be added.
  const enabledSaved = !!settings?.probation_enabled;

  const { data, isLoading } = useQuery({
    queryKey: ['probation-list', selectedBranchId],
    meta: BRANCH_KEYED, placeholderData: keepPreviousData,
    queryFn: () => apiGet('/payroll/probation'),
    enabled: enabledSaved,
  });
  const onProbation    = (data?.onProbation    || []).filter(e => matches(e, onSearch));
  const notOnProbation = (data?.notOnProbation || []).filter(e => matches(e, offSearch));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['probation-list'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['payroll-employees'] });
  };

  const addMut = useMutation({
    mutationFn: emp => apiPost('/payroll/probation/add', { user_id: emp.id }),
    onSuccess: (_, emp) => { toast(`${emp.name} is now on probation`, 'success'); refresh(); },
    onError: e => toast(e.message, 'error'),
  });
  const removeMut = useMutation({
    mutationFn: emp => apiPost('/payroll/probation/remove', { user_id: emp.id }),
    onSuccess: (_, emp) => { toast(`${emp.name} removed from probation — now Active / Full Time`, 'success'); setRemoving(null); refresh(); },
    onError: e => { toast(e.message, 'error'); setRemoving(null); },
  });

  async function executeBulkApply() {
    setApplying(true);
    try {
      const res = await apiPost('/payroll/apply-probation-bulk', {});
      toast(`Done — ${res.set_to_probation} set to Probation, ${res.set_to_active} set to Active (probation already completed).`, 'success');
      refresh();
    } catch (e) {
      toast(e.message || 'Failed to apply probation.', 'error');
    } finally {
      setApplying(false);
      setBulkOpen(false);
    }
  }

  const months = Number(form.default_probation_months) || 3;
  const scopeAll = (form.probation_scope ?? 'selected') === 'all';

  return (
    <Section
      icon={<Users size={15} className="text-[#3525cd]" />}
      title="Probation Management"
      subtitle="Company probation defaults, and who is currently on probation">

      <Row label="Enable Probation" hint="Turn on to allow probation periods for employees">
        <Toggle checked={!!form.probation_enabled} onChange={v => set('probation_enabled', v)} />
      </Row>

      {form.probation_enabled && (
        <>
          <Row label="Default Probation Period" hint="Months counted from the joining date">
            <div className="flex items-center gap-2">
              <NumInput value={form.default_probation_months ?? 3} onChange={v => set('default_probation_months', Math.max(1, v))} min={1} max={24} />
              <span className="text-sm text-[#777587]">months</span>
            </div>
          </Row>

          <Row label="Paid Leave During Probation" hint="If OFF, approved leaves during probation are treated as unpaid (LOP applies in payroll)">
            <Toggle checked={form.paid_leave_during_probation !== false} onChange={v => set('paid_leave_during_probation', v)} />
          </Row>

          <Row label="Auto-apply to all employees"
            hint="ON: every active employee is put on (or confirmed out of) probation automatically from their joining date. OFF: you choose who, using the lists below.">
            <Toggle checked={scopeAll} onChange={v => set('probation_scope', v ? 'all' : 'selected')} />
          </Row>

          {scopeAll && (
            <div className="bg-[#f0f3ff] border border-[#c7c4d8] rounded-xl p-4 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2 text-xs text-[#464555] max-w-xl">
                <Info size={14} className="text-[#3525cd] flex-shrink-0 mt-0.5" />
                <p>Save settings, then apply once to existing employees. New joiners are applied overnight automatically.
                  Employees you remove from probation below are not re-applied.</p>
              </div>
              <button type="button" onClick={() => setBulkOpen(true)}
                disabled={applying || !settings?.probation_enabled || settings?.probation_scope !== 'all'}
                className={cn('flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all',
                  applying || !settings?.probation_enabled || settings?.probation_scope !== 'all'
                    ? 'bg-[#e7eefe] text-[#9ca3af] cursor-not-allowed' : 'bg-[#3525cd] text-white hover:bg-[#2a1fb0]')}>
                <Users size={13} /> {applying ? 'Applying…' : 'Apply to All Eligible'}
              </button>
            </div>
          )}

          {/* ── The two lists ── */}
          {!enabledSaved ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              Save the settings to turn probation on — the employee lists appear after that.
            </p>
          ) : isLoading ? (
            <div className="flex justify-center py-8"><span className="w-5 h-5 border-2 border-[#3525cd]/30 border-t-[#3525cd] rounded-full animate-spin" /></div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PersonList title="On Probation" count={data?.onProbation?.length ?? 0}
                tone="bg-amber-50 text-amber-800" search={onSearch} onSearch={setOnSearch}
                empty="No employees are on probation.">
                {onProbation.map(e => (
                  <PersonRow key={e.id} emp={e} action="remove" busy={removeMut.isPending}
                    onAction={setRemoving}
                    sub={e.probation_end_date ? `Probation ends ${fmtDate(e.probation_end_date)}` : null} />
                ))}
              </PersonList>
              <PersonList title="Not on Probation" count={data?.notOnProbation?.length ?? 0}
                tone="bg-emerald-50 text-emerald-800" search={offSearch} onSearch={setOffSearch}
                empty="Everyone eligible is already on probation.">
                {notOnProbation.map(e => (
                  <PersonRow key={e.id} emp={e} action="add" busy={addMut.isPending}
                    onAction={emp => addMut.mutate(emp)}
                    sub={e.joining_date ? `Joined ${fmtDate(e.joining_date)} · ${months}-month probation` : 'No joining date'} />
                ))}
              </PersonList>
            </div>
          )}
          <p className="text-[0.68rem] text-[#777587]">
            <strong>+</strong> puts the employee on probation for {months} month{months === 1 ? '' : 's'} from joining and sets their profile status to Probation.{' '}
            <strong>−</strong> ends probation now: the profile becomes Active / Full Time and the confirmation date is set.
          </p>
        </>
      )}

      <ConfirmModal
        open={!!removing}
        variant="warning"
        title="Remove from probation?"
        message={removing ? `${removing.name} will be confirmed now: status becomes Active (Full Time) and probation leave rules stop applying.` : ''}
        confirmLabel="Remove from probation"
        onConfirm={() => removing && removeMut.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
      <ConfirmModal
        open={bulkOpen}
        variant="warning"
        title="Apply Probation to All Employees?"
        message={`Active employees joining within the last ${months} months will be set to Probation. Employees whose probation period has already ended will be set to Active (Full Time). Employees without a joining date, or already confirmed, are skipped.`}
        confirmLabel="Yes, Apply"
        onConfirm={executeBulkApply}
        onCancel={() => setBulkOpen(false)}
      />
    </Section>
  );
}
