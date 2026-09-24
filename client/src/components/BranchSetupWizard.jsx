import React, { useState } from 'react';
import { GitBranch, Building2, CheckCircle2, AlertTriangle, Loader2, ArrowRight, ChevronLeft } from 'lucide-react';
import { apiPost } from '@/lib/api';

const STEP = { WELCOME: 0, CHOICE: 1, NAME: 2, CONFIRM: 3, LOADING: 4, SUCCESS: 5 };

/**
 * BranchSetupWizard
 *
 * Full-screen overlay modal shown to Root Admin when branches are enabled
 * but the organization has no branches configured yet.
 *
 * Props:
 *   onComplete(branch) — called after successful setup; parent should reload branch context
 *   orgName            — organization name (used to suggest default branch name)
 *   defaultBranchName  — pre-computed safe default name from backend
 */
export default function BranchSetupWizard({ onComplete, orgName, defaultBranchName }) {
  const [step,       setStep]       = useState(STEP.WELCOME);
  const [mode,       setMode]       = useState(null);       // 'custom' | 'default'
  const [branchName, setBranchName] = useState('');
  const [error,      setError]      = useState('');
  const [result,     setResult]     = useState(null);

  const displayDefault = defaultBranchName || (orgName ? orgName.replace(/\s+/g, '_') + '_Branch_Def' : 'Main_Branch_Def');
  const effectiveName  = mode === 'default' ? displayDefault : branchName.trim();

  async function handleSetup() {
    setStep(STEP.LOADING);
    setError('');
    try {
      const data = await apiPost('/branches/setup', {
        mode,
        branch_name: mode === 'custom' ? branchName.trim() : undefined,
      });
      setResult(data);
      setStep(STEP.SUCCESS);
    } catch (err) {
      setError(err.message || 'Setup failed. Please try again.');
      setStep(STEP.CONFIRM); // Go back to confirm so user can retry
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="bg-[#3525cd] px-6 py-5 text-white">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
              <GitBranch size={18} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight">Branch Setup</h2>
              <p className="text-white/70 text-xs">One-time configuration for {orgName || 'your organization'}</p>
            </div>
          </div>
          {/* Progress dots */}
          {step < STEP.LOADING && (
            <div className="flex gap-1.5 mt-3">
              {[STEP.WELCOME, STEP.CHOICE, STEP.NAME, STEP.CONFIRM].map(s => (
                <div key={s} className={`h-1 rounded-full transition-all ${s <= step ? 'bg-white' : 'bg-white/30'}`}
                  style={{ width: s === step ? '24px' : '8px' }} />
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-6 py-5">

          {/* ── STEP 0: Welcome ── */}
          {step === STEP.WELCOME && (
            <div className="space-y-4">
              <p className="text-[#464555] text-sm leading-relaxed">
                Branches have been enabled for <strong>{orgName}</strong>. Your existing data is currently not assigned to a branch.
              </p>
              <p className="text-[#464555] text-sm leading-relaxed">
                This wizard will help you create your first branch and migrate existing employee data to it. This only takes a moment.
              </p>
              <div className="bg-[#f0f3ff] border border-[#3525cd]/20 rounded-xl p-3 text-xs text-[#3525cd] space-y-1.5">
                <div className="flex items-center gap-2"><CheckCircle2 size={12} /><span>All existing employees will be assigned to the branch</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 size={12} /><span>Attendance, leaves, and payroll data are preserved</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 size={12} /><span>Org-level data (holidays, policies, announcements) stays org-wide</span></div>
              </div>
            </div>
          )}

          {/* ── STEP 1: Choice ── */}
          {step === STEP.CHOICE && (
            <div className="space-y-4">
              <p className="text-sm font-bold text-[#151c27]">How would you like to set up your branch?</p>
              <div className="space-y-2.5">
                <button type="button"
                  onClick={() => { setMode('custom'); setStep(STEP.NAME); }}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-[#e7eefe] hover:border-[#3525cd] text-left transition-all group">
                  <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] flex items-center justify-center flex-shrink-0 group-hover:bg-[#3525cd]/10">
                    <Building2 size={16} className="text-[#3525cd]" />
                  </div>
                  <div>
                    <div className="font-bold text-[#151c27] text-sm">Enter a branch name</div>
                    <div className="text-xs text-[#777587]">e.g. Main Branch · Ahmedabad Office · Head Office</div>
                  </div>
                  <ArrowRight size={16} className="ml-auto text-[#c7c4d8] group-hover:text-[#3525cd] flex-shrink-0" />
                </button>

                <button type="button"
                  onClick={() => { setMode('default'); setStep(STEP.NAME); }}
                  className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-[#e7eefe] hover:border-[#3525cd] text-left transition-all group">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-100">
                    <GitBranch size={16} className="text-emerald-600" />
                  </div>
                  <div>
                    <div className="font-bold text-[#151c27] text-sm">Use default name</div>
                    <div className="text-xs text-[#777587] font-mono">{displayDefault}</div>
                  </div>
                  <ArrowRight size={16} className="ml-auto text-[#c7c4d8] group-hover:text-[#3525cd] flex-shrink-0" />
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: Name Entry ── */}
          {step === STEP.NAME && (
            <div className="space-y-4">
              {mode === 'custom' ? (
                <>
                  <label className="block text-sm font-bold text-[#151c27]">Branch Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="e.g. Ahmedabad Office"
                    maxLength={100}
                    value={branchName}
                    onChange={e => setBranchName(e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-[#777587]">This is the name your team will see when switching branches.</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-[#464555]">Your default branch will be named:</p>
                  <div className="bg-[#f0f3ff] border border-[#3525cd]/20 rounded-xl px-4 py-3 font-mono font-bold text-[#3525cd]">
                    {displayDefault}
                  </div>
                  <p className="text-xs text-[#777587]">You can rename it later from the Branches settings page.</p>
                </>
              )}
            </div>
          )}

          {/* ── STEP 3: Confirmation ── */}
          {step === STEP.CONFIRM && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2.5">
                <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  Existing employee-related data will be associated with <strong>{effectiveName}</strong>. Complete this setup only if your organization currently operates as a single workspace.
                </p>
              </div>
              <div className="text-sm text-[#464555] space-y-1">
                <div className="flex gap-2"><span className="font-bold text-[#151c27] w-28 flex-shrink-0">Branch name:</span><span className="font-mono text-[#3525cd]">{effectiveName}</span></div>
                <div className="flex gap-2"><span className="font-bold text-[#151c27] w-28 flex-shrink-0">Organization:</span><span>{orgName}</span></div>
              </div>
              {error && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* ── STEP 4: Loading ── */}
          {step === STEP.LOADING && (
            <div className="py-6 flex flex-col items-center gap-3 text-[#464555]">
              <Loader2 size={32} className="text-[#3525cd] animate-spin" />
              <p className="text-sm font-bold">Setting up your branch…</p>
              <p className="text-xs text-[#777587]">Creating branch and migrating employee assignments.</p>
            </div>
          )}

          {/* ── STEP 5: Success ── */}
          {step === STEP.SUCCESS && (
            <div className="py-4 space-y-4">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle2 size={28} className="text-emerald-600" />
                </div>
                <div>
                  <p className="font-black text-[#151c27]">Branch setup complete!</p>
                  <p className="text-xs text-[#777587] mt-0.5">
                    <span className="font-mono font-bold text-[#3525cd]">{result?.branch?.name}</span> was created.
                    {result?.employees_migrated > 0 && ` ${result.employees_migrated} employee${result.employees_migrated !== 1 ? 's' : ''} assigned.`}
                  </p>
                </div>
              </div>
              <div className="bg-[#f0f3ff] border border-[#3525cd]/20 rounded-xl p-3 text-xs text-[#3525cd] space-y-1">
                <div className="flex items-center gap-2"><CheckCircle2 size={12} /><span>Branch context is now active</span></div>
                <div className="flex items-center gap-2"><CheckCircle2 size={12} /><span>Manage branches and HR access from Settings → Branches</span></div>
              </div>
            </div>
          )}

        </div>

        {/* Footer buttons */}
        <div className="px-6 pb-5 flex items-center justify-between gap-3">
          {/* Back button */}
          {step > STEP.WELCOME && step < STEP.LOADING && (
            <button type="button" className="btn btn-outline btn-sm flex items-center gap-1"
              onClick={() => setStep(s => s - 1)}>
              <ChevronLeft size={14} /> Back
            </button>
          )}
          {(step <= STEP.WELCOME || step >= STEP.LOADING) && <div />}

          {/* Primary action */}
          {step === STEP.WELCOME && (
            <button className="btn btn-primary btn-sm" onClick={() => setStep(STEP.CHOICE)}>
              Get Started <ArrowRight size={14} />
            </button>
          )}
          {step === STEP.NAME && mode === 'custom' && (
            <button className="btn btn-primary btn-sm"
              disabled={!branchName.trim() || branchName.trim().length < 2}
              onClick={() => setStep(STEP.CONFIRM)}>
              Continue <ArrowRight size={14} />
            </button>
          )}
          {step === STEP.NAME && mode === 'default' && (
            <button className="btn btn-primary btn-sm" onClick={() => setStep(STEP.CONFIRM)}>
              Continue <ArrowRight size={14} />
            </button>
          )}
          {step === STEP.CONFIRM && (
            <button className="btn btn-primary btn-sm" onClick={handleSetup}>
              Confirm Setup
            </button>
          )}
          {step === STEP.SUCCESS && (
            <button className="btn btn-primary btn-sm" onClick={() => onComplete(result?.branch)}>
              Open Dashboard <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
