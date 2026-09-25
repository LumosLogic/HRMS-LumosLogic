import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings2, Plus, Trash2, ChevronUp, ChevronDown, Save,
  AlertCircle, CheckCircle2, GripVertical, Info, ArrowLeft,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPut } from '@/lib/api';
import { useToast } from '@/context/ToastContext';

// Priority order enforced — each type can only appear once (except specific_user)
const ROLE_TYPE_OPTIONS = [
  { value: 'reporting_manager', label: 'Reporting Manager', description: 'The employee\'s direct reporting manager (from profile)' },
  { value: 'department_head',   label: 'Department Head',   description: 'The head of the employee\'s primary department' },
  { value: 'hr_admin',          label: 'HR Admin',          description: 'Any HR Admin or Root Admin in the organisation' },
  { value: 'root_admin',        label: 'Root Admin',        description: 'Any Root Admin only (highest authority)' },
  { value: 'specific_user',     label: 'Specific User',     description: 'A specific user by their Employee ID' },
];
// Types that can only be used once in the workflow
const UNIQUE_ROLE_TYPES = ['reporting_manager', 'department_head', 'hr_admin', 'root_admin'];

function LevelRow({ level, index, total, usedTypes = new Set(), onChange, onDelete, onMoveUp, onMoveDown }) {
  const roleOption = ROLE_TYPE_OPTIONS.find(r => r.value === level.role_type);

  // Filter dropdown: hide unique types already used in OTHER levels
  const availableOptions = ROLE_TYPE_OPTIONS.filter(opt =>
    opt.value === level.role_type ||            // always show current selection
    !UNIQUE_ROLE_TYPES.includes(opt.value) ||   // specific_user always available
    !usedTypes.has(opt.value)                   // not used in another level
  );

  return (
    <div className="bg-white border border-[#e7eefe] rounded-xl p-4 hover:border-[#3525cd]/30 transition-all">
      <div className="flex items-start gap-3">
        {/* Level badge */}
        <div className="w-8 h-8 rounded-xl bg-[#3525cd] text-white flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">
          {index + 1}
        </div>

        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Role type */}
          <div>
            <label className="block text-[0.68rem] font-bold text-[#777587] mb-1 uppercase tracking-wide">Approver Type</label>
            <select
              value={level.role_type}
              onChange={e => onChange({ ...level, role_type: e.target.value, role_reference: '', level_label: '' })}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20 bg-white"
            >
              {availableOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {roleOption && (
              <p className="text-[0.62rem] text-[#9ca3af] mt-1">{roleOption.description}</p>
            )}
          </div>

          {/* Label */}
          <div>
            <label className="block text-[0.68rem] font-bold text-[#777587] mb-1 uppercase tracking-wide">Display Label <span className="text-rose-500 normal-case">*</span></label>
            <input
              type="text"
              value={level.level_label || ''}
              onChange={e => {
                const v = e.target.value;
                // BUG_105: required; must contain at least one letter; reject pure-numeric/symbol values
                const trimmed = v.trim();
                const err = !trimmed ? 'Display label is required'
                  : !/[a-zA-Z]/.test(trimmed) ? 'Must contain at least one letter'
                  : '';
                onChange({ ...level, level_label: v, _labelErr: err });
              }}
              placeholder={roleOption?.label || 'e.g. HR Approval'}
              maxLength={30}
              className={`w-full border rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:ring-1 ${level._labelErr ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-200' : 'border-[#c7c4d8] focus:border-[#3525cd] focus:ring-[#3525cd]/20'}`}
            />
            {level._labelErr && <p className="text-[0.62rem] text-rose-500 mt-0.5">{level._labelErr}</p>}
            <p className="text-[0.62rem] text-[#9ca3af] mt-1">Shown in employee timeline</p>
          </div>

          {/* Required + specific user */}
          <div className="space-y-2">
            {level.role_type === 'specific_user' && (
              <div>
                <label className="block text-[0.68rem] font-bold text-[#777587] mb-1 uppercase tracking-wide">User ID</label>
                <input
                  type="text"
                  value={level.role_reference || ''}
                  onChange={e => onChange({ ...level, role_reference: e.target.value })}
                  placeholder="Enter user ID"
                  className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20"
                />
              </div>
            )}
            <label className="flex items-center gap-2 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={level.is_required !== false}
                onChange={e => onChange({ ...level, is_required: e.target.checked })}
                className="w-4 h-4 accent-[#3525cd] rounded"
              />
              <span className="text-sm text-[#464555] font-semibold">Required</span>
              <span className="text-[0.62rem] text-[#9ca3af]">If unchecked, level is skipped when no approver is found</span>
            </label>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-1 ml-2">
          <button
            onClick={onMoveUp} disabled={index === 0}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#c7c4d8] text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          ><ChevronUp size={13} /></button>
          <button
            onClick={onMoveDown} disabled={index === total - 1}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#c7c4d8] text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd] disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          ><ChevronDown size={13} /></button>
          <button
            onClick={onDelete}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-rose-200 text-rose-400 hover:bg-rose-50 hover:border-rose-400 transition-all"
          ><Trash2 size={12} /></button>
        </div>
      </div>
    </div>
  );
}

export default function LeaveWorkflowSettings() {
  const toast    = useToast();
  const qc       = useQueryClient();
  const navigate = useNavigate();

  const { data: workflow, isLoading, isError } = useQuery({
    queryKey: ['leave-workflow-config'],
    queryFn:  () => apiGet('/leaves/workflow-config'),
  });

  const [workflowName,      setWorkflowName]      = useState('');
  const [workflowNameError, setWorkflowNameError] = useState(''); // BUG_109
  const [levels, setLevels] = useState([]);
  const [dirty, setDirty] = useState(false);

  // BUG_109: validate workflow name — requires at least one letter, no pure digits/special-char names
  function validateWorkflowName(name) {
    if (!name.trim()) return 'Workflow name is required.';
    if (!/[a-zA-Z]/.test(name)) return 'Workflow name must contain at least one alphabetic character.';
    if (/^\s+/.test(name)) return 'Workflow name cannot start with spaces.';
    if (/\s{2,}/.test(name)) return 'Workflow name cannot contain consecutive spaces.';
    if (name.trim().length < 3) return 'Workflow name must be at least 3 characters.';
    if (name.trim().length > 100) return 'Workflow name must be 100 characters or fewer.';
    return '';
  }

  useEffect(() => {
    if (workflow) {
      setWorkflowName(workflow.workflow_name || 'Default Approval Workflow');
      setLevels((workflow.levels || []).map((l, i) => ({ ...l, _key: Date.now() + i })));
      setDirty(false);
    }
  }, [workflow]);

  const saveMut = useMutation({
    mutationFn: () => apiPut('/leaves/workflow-config', {
      workflow_name: workflowName,
      levels: levels.map((l, i) => ({
        level_number:   i + 1,
        role_type:      l.role_type,
        role_reference: l.role_reference || null,
        level_label:    (l.level_label || '').trim(),
        is_required:    l.is_required    !== false,
      })),
    }),
    onSuccess: () => {
      toast('Workflow saved successfully!', 'success');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['leave-workflow-config'] });
      // BUG_108: also invalidate summary so the Settings page summary card refreshes
      qc.invalidateQueries({ queryKey: ['leave-workflow-config-summary'] });
    },
    onError: err => toast(err.message, 'error'),
  });

  function addLevel() {
    // Pick the next unused type from the priority order
    const usedTypes = new Set(levels.map(l => l.role_type));
    const nextType = UNIQUE_ROLE_TYPES.find(t => !usedTypes.has(t)) || 'specific_user';
    // If all unique types are used and specific_user is also limited, just add specific_user
    setLevels(prev => [
      ...prev,
      { role_type: nextType, level_label: '', is_required: true, role_reference: '', _key: Date.now() },
    ]);
    setDirty(true);
  }

  function updateLevel(index, updated) {
    // Dropdown already filters out duplicate types — just apply the update
    setLevels(prev => prev.map((l, i) => i === index ? { ...updated } : l));
    setDirty(true);
  }

  function deleteLevel(index) {
    setLevels(prev => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function moveLevel(index, dir) {
    setLevels(prev => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setDirty(true);
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="spinner w-6 h-6" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle size={32} className="text-rose-400 mb-3" />
        <p className="font-bold text-[#151c27] mb-2">Failed to load workflow configuration</p>
        <button onClick={() => qc.invalidateQueries({ queryKey: ['leave-workflow-config'] })}
          className="text-[#3525cd] text-sm font-bold hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">
      {/* Header */}
      <div>
        <button onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#777587] hover:text-[#3525cd] mb-3 transition-colors">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 rounded-xl bg-[#3525cd]/10 flex items-center justify-center">
            <Settings2 size={18} className="text-[#3525cd]" />
          </div>
          <h1 className="text-xl font-black text-[#151c27]">Leave Approval Workflow</h1>
        </div>
        <p className="text-sm text-[#777587] ml-11.5">
          Configure the approval chain for your organisation. Changes apply to all new leave requests.
        </p>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <Info size={15} className="text-blue-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700">
          <p className="font-bold mb-0.5">How it works</p>
          <p>
            Each level defines who must approve before the leave moves to the next stage. Optional levels
            are automatically skipped if no approver is found (e.g., an employee with no reporting manager).
            Existing pending leaves are not affected by workflow changes.
          </p>
        </div>
      </div>

      {/* Workflow name */}
      <div className="bg-white border border-[#e7eefe] rounded-xl p-5">
        <label className="block text-xs font-bold text-[#777587] mb-2 uppercase tracking-wide">Workflow Name</label>
        <input
          type="text"
          value={workflowName}
          onChange={e => { const v = e.target.value; setWorkflowName(v); setDirty(true); setWorkflowNameError(validateWorkflowName(v)); }}
          placeholder="e.g. Standard Leave Approval"
          className={`w-full border rounded-lg px-3 py-2.5 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] focus:ring-1 focus:ring-[#3525cd]/20 ${workflowNameError ? 'border-rose-400' : 'border-[#c7c4d8]'}`}
          maxLength={100}
        />
        {workflowNameError && <p className="text-xs text-rose-500 mt-1">{workflowNameError}</p>}
      </div>

      {/* Flow preview */}
      <div className="bg-[#f9f9ff] border border-[#e7eefe] rounded-xl px-5 py-4">
        <p className="text-xs font-bold text-[#777587] mb-3 uppercase tracking-wide">Approval Flow Preview</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#3525cd]/10 text-[#3525cd] border border-[#3525cd]/20">
            Employee
          </span>
          {levels.map((level, i) => (
            <React.Fragment key={level._key || i}>
              <span className="text-[#c7c4d8] text-lg">→</span>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${
                level.is_required !== false
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}>
                {(() => {
                  const raw = level.level_label || ROLE_TYPE_OPTIONS.find(r => r.value === level.role_type)?.label || level.role_type;
                  return raw.length > 15 ? raw.slice(0, 15) + '…' : raw;
                })()}
                {level.is_required === false && <span className="ml-1 opacity-60">(opt.)</span>}
              </span>
            </React.Fragment>
          ))}
          {levels.length > 0 && <span className="text-[#c7c4d8] text-lg">→</span>}
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            ✓ Approved
          </span>
        </div>
        {levels.length === 0 && (
          <p className="text-xs text-[#9ca3af] mt-2">No levels configured — all leaves will require at least one approver.</p>
        )}
      </div>

      {/* Levels */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black text-[#151c27]">Approval Levels ({levels.length})</p>
        </div>

        {levels.length === 0 ? (
          <div className="bg-white border border-dashed border-[#c7c4d8] rounded-xl py-10 text-center">
            <p className="text-sm font-semibold text-[#464555] mb-1">No approval levels configured</p>
            <p className="text-xs text-[#9ca3af] mb-4">Add at least one level to define your approval chain.</p>
            <button onClick={addLevel}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#3525cd] text-white text-sm font-bold hover:bg-[#2a1fb0] transition-colors">
              <Plus size={14} /> Add First Level
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {levels.map((level, i) => {
              // Build set of types used by ALL other levels (not this one)
              const usedByOthers = new Set(
                levels.filter((_, j) => j !== i).map(l => l.role_type)
              );
              return (
                <LevelRow
                  key={level._key || i}
                  level={level}
                  index={i}
                  total={levels.length}
                  usedTypes={usedByOthers}
                  onChange={updated => updateLevel(i, updated)}
                  onDelete={() => deleteLevel(i)}
                  onMoveUp={() => moveLevel(i, -1)}
                  onMoveDown={() => moveLevel(i, 1)}
                />
              );
            })}
          </div>
        )}

        {/* Hide Add button when all unique types are already used */}
        {UNIQUE_ROLE_TYPES.some(t => !levels.find(l => l.role_type === t)) && (
          <button
            onClick={addLevel}
            className="w-full flex items-center justify-center gap-2 border border-dashed border-[#3525cd]/40 rounded-xl py-3 text-sm font-bold text-[#3525cd] hover:bg-[#f0f3ff] hover:border-[#3525cd] transition-all"
          >
            <Plus size={15} /> Add Approval Level
          </button>
        )}
      </div>

      {/* Save bar */}
      <div className={`sticky bottom-4 transition-all ${dirty ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
        <div className="bg-white border border-[#3525cd]/20 rounded-2xl shadow-lg px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <p className="text-sm font-bold text-[#151c27]">You have unsaved changes</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setWorkflowName(workflow?.workflow_name || '');
                setLevels((workflow?.levels || []).map((l, i) => ({ ...l, _key: Date.now() + i })));
                setDirty(false);
              }}
              className="px-4 py-2 border border-[#c7c4d8] rounded-xl text-sm font-semibold text-[#464555] hover:bg-[#f0f3ff] transition-colors"
            >
              Discard
            </button>
            <button
              onClick={() => {
                // BUG_109: validate name before saving
                const nameErr = validateWorkflowName(workflowName);
                if (nameErr) { setWorkflowNameError(nameErr); return; }
                setWorkflowNameError('');
                // BUG_105: display label is required and must contain at least one letter
                let hasLabelErrors = false;
                const updatedLevels = levels.map((lvl, i) => {
                  const trimmed = (lvl.level_label || '').trim();
                  const err = !trimmed ? 'Display label is required'
                    : !/[a-zA-Z]/.test(trimmed) ? 'Must contain at least one letter'
                    : '';
                  if (err) hasLabelErrors = true;
                  return { ...lvl, _labelErr: err };
                });
                if (hasLabelErrors) {
                  setLevels(updatedLevels);
                  toast('All levels must have a valid Display Label.', 'error');
                  return;
                }
                saveMut.mutate();
              }}
              disabled={saveMut.isPending}
              className="flex items-center gap-2 px-5 py-2 bg-[#3525cd] text-white rounded-xl text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-60 transition-colors"
            >
              {saveMut.isPending ? (
                <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</>
              ) : (
                <><Save size={14} /> Save Workflow</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Success confirmation */}
      {!dirty && !saveMut.isPending && saveMut.isSuccess && (
        <div className="flex items-center gap-2 text-emerald-600 text-sm font-semibold bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
          <CheckCircle2 size={16} />
          Workflow saved. New leave requests will use this approval chain.
        </div>
      )}
    </div>
  );
}
