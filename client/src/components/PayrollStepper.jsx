import React from 'react';
import { Check } from 'lucide-react';

// Existing payroll_runs.status values mapped onto the controlled flow:
// Generate → Verify → Approve → Lock/Publish → Payslip
const STEPS = ['Generated', 'Verified', 'Approved', 'Locked', 'Payslip'];

const STEP_INDEX = {
  processing: -1, failed: -1, draft: -1,
  completed: 0, completed_with_errors: 0,
  verified: 1,
  approved: 2,
  locked: 3,
  paid: 4,
};

const NEXT_ACTION = {
  completed: 'Next: Verify',
  completed_with_errors: 'Next: Verify',
  verified: 'Next: Approve',
  approved: 'Next: Lock',
  locked: 'Next: Mark Paid',
  paid: 'Complete',
};

export function nextActionLabel(status) {
  return NEXT_ACTION[status] || '';
}

/** `status` is the payroll run status; with no status it shows the bare flow (no step reached). */
export default function PayrollStepper({ status, compact = false }) {
  const current = status ? (STEP_INDEX[status] ?? -1) : -1;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STEPS.map((label, i) => {
        const done   = i < current || (i === current && status === 'paid');
        const active = i === current && status !== 'paid';
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.6rem] font-black border ${
                  done   ? 'bg-emerald-600 border-emerald-600 text-white'
                  : active ? 'bg-[#3525cd] border-[#3525cd] text-white'
                  : 'bg-white border-[#c7c4d8] text-[#777587]'
                }`}
              >
                {done ? <Check size={11} /> : i + 1}
              </span>
              {!compact && (
                <span className={`text-xs font-bold ${active ? 'text-[#3525cd]' : done ? 'text-emerald-700' : 'text-[#777587]'}`}>
                  {label}
                </span>
              )}
            </div>
            {i < STEPS.length - 1 && <span className={`h-px ${compact ? 'w-3' : 'w-6'} ${i < current ? 'bg-emerald-500' : 'bg-[#e2e0f0]'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
