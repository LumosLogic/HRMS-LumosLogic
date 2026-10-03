import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Database, RefreshCw, CheckCircle2, AlertCircle, Loader2,
  FileText, Copy, XCircle, ChevronDown, BarChart2, Info,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';
import { useToast } from '@/context/ToastContext';

// ── Step IDs ──────────────────────────────────────────────────────────────────
const STEP = {
  SELECT:          1,
  DRY_RUN_LOADING: 2,
  DRY_RUN_DONE:    3,
  SYNC_LOADING:    4,
  REPROCESS:       5,
  DONE:            6,
};

// ── Step progress bar config ───────────────────────────────────────────────────
const STEPS_CFG = [
  { id: 1, label: 'Select Range' },
  { id: 2, label: 'Dry Run'      },
  { id: 3, label: 'Sync & Import'},
  { id: 4, label: 'Reprocess'   },
  { id: 5, label: 'Completed'   },
];

function barStep(current) {
  if (current <= STEP.SELECT)          return 1;
  if (current <= STEP.DRY_RUN_DONE)   return 2;
  if (current <= STEP.SYNC_LOADING)   return 3;
  if (current <= STEP.REPROCESS)      return 4;
  return 5;
}

function StepBar({ current }) {
  const active = barStep(current);
  return (
    <div className="flex items-center justify-between mb-8 px-2">
      {STEPS_CFG.map((s, i) => {
        const done   = s.id < active;
        const isCur  = s.id === active;
        return (
          <React.Fragment key={s.id}>
            <div className="flex flex-col items-center gap-1.5 z-10">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black border-2 transition-all
                ${done  ? 'bg-[#3525cd] border-[#3525cd] text-white'
                : isCur ? 'bg-[#3525cd] border-[#3525cd] text-white ring-4 ring-[#3525cd]/20'
                :         'bg-white border-[#c7c4d8] text-[#777587]'}`}>
                {done ? <CheckCircle2 size={16} /> : s.id}
              </div>
              <span className={`text-[0.68rem] font-bold whitespace-nowrap ${isCur || done ? 'text-[#3525cd]' : 'text-[#777587]'}`}>
                {s.label}
              </span>
            </div>
            {i < STEPS_CFG.length - 1 && (
              <div className={`flex-1 h-[2px] mx-1 -mt-5 ${done ? 'bg-[#3525cd]' : 'bg-[#e7eefe]'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, value, label, sub, color = 'blue', warn }) {
  const colors = {
    blue:   { bg: 'bg-[#f0f3ff]', text: 'text-[#3525cd]', icon: 'text-[#3525cd]' },
    green:  { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'text-emerald-600' },
    amber:  { bg: 'bg-amber-50',   text: 'text-amber-700',   icon: 'text-amber-500'  },
    slate:  { bg: 'bg-slate-50',   text: 'text-slate-600',   icon: 'text-slate-400'  },
  };
  const c = colors[color] || colors.blue;
  return (
    <div className={`rounded-xl border border-[#e7eefe] p-5 ${warn ? 'border-amber-200 bg-amber-50/30' : 'bg-white'}`}>
      <div className={`w-9 h-9 rounded-xl ${c.bg} flex items-center justify-center mb-3`}>
        {React.cloneElement(icon, { size: 18, className: c.icon })}
      </div>
      <div className={`text-2xl font-black ${c.text}`}>{value ?? '—'}</div>
      <div className="text-xs font-bold text-[#151c27] mt-0.5">{label}</div>
      {sub && <div className="text-[0.65rem] text-[#777587] mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Progress stage row ────────────────────────────────────────────────────────
function SyncStage({ icon, label, status, count, total, ts }) {
  const done    = status === 'done';
  const loading = status === 'loading';
  const pending = status === 'pending';
  return (
    <div className="flex flex-col items-center gap-2 flex-1">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all
        ${done    ? 'bg-[#3525cd] border-[#3525cd] text-white'
        : loading ? 'bg-white border-[#3525cd] text-[#3525cd]'
        :           'bg-white border-[#c7c4d8] text-[#c7c4d8]'}`}>
        {loading ? <Loader2 size={20} className="animate-spin" /> : React.cloneElement(icon, { size: 20 })}
      </div>
      <div className="text-xs font-bold text-[#151c27] text-center">{label}</div>
      {done && (
        <div className="text-xs text-emerald-600 font-semibold text-center">
          {count !== undefined && total !== undefined ? `${count.toLocaleString()} / ${total.toLocaleString()}` : ts ? `Just now` : 'Completed'}
        </div>
      )}
      {loading && <div className="text-xs text-[#3525cd] font-semibold">In progress…</div>}
      {pending && <div className="text-xs text-[#c7c4d8] font-semibold">Waiting</div>}
    </div>
  );
}

function SyncStageConnector({ active }) {
  return (
    <div className={`flex-1 h-[2px] mt-6 mx-1 ${active ? 'bg-[#3525cd]' : 'bg-[#e7eefe]'}`} />
  );
}

// ── Summary modal ─────────────────────────────────────────────────────────────
function SummaryModal({ job, reprocessResult, onClose }) {
  if (!job) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-[#c7c4d8]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe]">
          <h2 className="font-black text-[#151c27]">Sync Summary</h2>
          <button onClick={onClose} className="btn btn-ghost btn-icon"><XCircle size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          {[
            { label: 'Total Records Received',    value: job.records_received?.toLocaleString()  ?? '—' },
            { label: 'Records in Date Range',     value: job.records_in_range?.toLocaleString()  ?? '—' },
            { label: 'Records Imported',          value: job.records_inserted?.toLocaleString()  ?? '—' },
            { label: 'Duplicates Skipped',        value: job.records_duplicate?.toLocaleString() ?? '—' },
            { label: 'Ignored / Invalid',         value: job.records_ignored?.toLocaleString()   ?? '—' },
            { label: 'Employees Reprocessed',     value: reprocessResult?.pins_count?.toLocaleString() ?? job.employees_reprocessed?.toLocaleString() ?? '—' },
            { label: 'Attendance Records Updated',value: job.attendance_records_updated?.toLocaleString() ?? '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-[#f0f3ff] last:border-0">
              <span className="text-sm text-[#464555]">{label}</span>
              <span className="text-sm font-black text-[#151c27]">{value}</span>
            </div>
          ))}
        </div>
        <div className="px-6 pb-5">
          <button onClick={onClose} className="btn btn-primary w-full">Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BiometricHistoricalSync() {
  const toast = useToast();
  const qc    = useQueryClient();
  const [searchParams] = useSearchParams();

  // Devices
  const _bk1 = useBranch().selectedBranchId;
  const { data: devices = [] } = useQuery({
    queryKey: ['biometric-devices', _bk1],
    queryFn:  () => apiGet('/biometric/devices'),
    staleTime: 2 * 60 * 1000,
  });

  // State
  const [selectedDeviceId, setSelectedDeviceId] = useState(searchParams.get('device') || '');
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [step, setStep]               = useState(STEP.SELECT);
  const [dryRunJob, setDryRunJob]     = useState(null);   // job object from dry run
  const [syncJob, setSyncJob]         = useState(null);   // job object from real sync
  const [reprocessResult, setReprocessResult] = useState(null);
  const [reprocessPollId, setReprocessPollId] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [error, setError]             = useState('');

  const pollRef = useRef(null);

  const selectedDevice = devices.find(d => String(d.id) === String(selectedDeviceId));

  // Pre-select first device if arriving from device card
  useEffect(() => {
    if (!selectedDeviceId && devices.length === 1) {
      setSelectedDeviceId(String(devices[0].id));
    }
  }, [devices]);

  // ── Poll a job by ID ──────────────────────────────────────────────────────
  function startPolling(jobId, onComplete) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const j = await apiGet(`/biometric/historical-sync-jobs/${jobId}`);
        if (j.status === 'completed' || j.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          onComplete(j);
        }
      } catch (_) { /* ignore transient errors */ }
    }, 2500);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── Step 1 → Dry Run ─────────────────────────────────────────────────────
  async function handleStartDryRun() {
    if (!selectedDeviceId)      { toast('Please select a device.', 'error'); return; }
    if (!fromDate || !toDate)   { toast('Please select a date range.', 'error'); return; }
    if (fromDate > toDate)      { toast('From date must be before To date.', 'error'); return; }

    setError('');
    setStep(STEP.DRY_RUN_LOADING);
    setDryRunJob(null);

    try {
      const r = await apiPost(`/biometric/devices/${selectedDeviceId}/historical-sync`, {
        from: fromDate, to: toDate, dry_run: true,
      });

      startPolling(r.job_id, (finishedJob) => {
        if (finishedJob.status === 'failed') {
          setError(`Dry run failed: ${finishedJob.error || 'Unknown error'}`);
          setStep(STEP.SELECT);
        } else {
          setDryRunJob(finishedJob);
          setStep(STEP.DRY_RUN_DONE);
        }
      });
    } catch (err) {
      setError(err.message);
      setStep(STEP.SELECT);
    }
  }

  // ── Step 3 → Sync & Import ────────────────────────────────────────────────
  async function handleSyncImport() {
    setError('');
    setStep(STEP.SYNC_LOADING);
    setSyncJob(null);
    setReprocessResult(null);

    try {
      const r = await apiPost(`/biometric/devices/${selectedDeviceId}/historical-sync`, {
        from: fromDate, to: toDate, dry_run: false,
      });

      startPolling(r.job_id, async (finishedJob) => {
        setSyncJob(finishedJob);

        if (finishedJob.status === 'failed') {
          setError(`Sync failed: ${finishedJob.error || 'Unknown error'}`);
          setStep(STEP.DRY_RUN_DONE); // Allow retry
          return;
        }

        // ── Start scoped reprocess ────────────────────────────────────────
        setStep(STEP.REPROCESS);

        try {
          const rr = await apiPost(`/biometric/historical-sync-jobs/${finishedJob.id}/reprocess`);
          setReprocessResult(rr);
          setReprocessPollId(finishedJob.id);

          // Poll for reprocess completion
          const reprocessPoller = setInterval(async () => {
            try {
              const updated = await apiGet(`/biometric/historical-sync-jobs/${finishedJob.id}`);
              const rs = updated.reprocess_status;
              if (rs === 'completed' || rs === 'partial') {
                clearInterval(reprocessPoller);
                setSyncJob(updated);
                setStep(STEP.DONE);
              }
            } catch (_) {}
          }, 2000);

          // Safety timeout: if reprocess doesn't report completion in 5 min, show done anyway
          setTimeout(() => {
            clearInterval(reprocessPoller);
            if (step !== STEP.DONE) setStep(STEP.DONE);
          }, 5 * 60 * 1000);
        } catch (rpErr) {
          // Reprocess call failed — sync records are safe, show partial success
          setError(`Sync completed but reprocessing failed: ${rpErr.message}. Records are imported safely — retry reprocessing from the sync jobs list.`);
          setStep(STEP.DONE);
        }
      });
    } catch (err) {
      setError(err.message);
      setStep(STEP.DRY_RUN_DONE);
    }
  }

  // ── Reset ─────────────────────────────────────────────────────────────────
  function handleReset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setStep(STEP.SELECT);
    setDryRunJob(null);
    setSyncJob(null);
    setReprocessResult(null);
    setError('');
  }

  const displayedJob = syncJob || dryRunJob;
  const insertedCount = displayedJob?.records_inserted ?? 0;

  // ── Sync stage statuses ───────────────────────────────────────────────────
  const stg1 = step >= STEP.SYNC_LOADING ? (step > STEP.SYNC_LOADING ? 'done' : 'loading') : 'pending';
  const stg2 = step >= STEP.REPROCESS    ? (step > STEP.REPROCESS    ? 'done' : 'loading') : (step === STEP.SYNC_LOADING ? 'loading' : 'pending');
  const stg3 = step >= STEP.REPROCESS    ? (step === STEP.DONE       ? 'done' : 'loading') : 'pending';
  const stg4 = step === STEP.DONE        ? 'done' : 'pending';

  // Adjust stage 2 more precisely
  const stage2status = (step === STEP.SYNC_LOADING) ? 'loading' : (step >= STEP.REPROCESS ? 'done' : 'pending');
  const stage3status = (step === STEP.REPROCESS) ? 'loading' : (step === STEP.DONE ? 'done' : 'pending');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="page-title">Historical Sync</h1>
          <p className="page-subtitle">Sync old attendance data from device and update attendance records</p>
        </div>

        {/* Device selector */}
        {step === STEP.SELECT && (
          <div className="relative">
            <select
              className="form-control pr-8 min-w-[240px] text-sm font-semibold appearance-none"
              value={selectedDeviceId}
              onChange={e => setSelectedDeviceId(e.target.value)}
            >
              <option value="">— Select Device —</option>
              {devices.map(d => (
                <option key={d.id} value={d.id}>
                  {d.device_name} ({d.serial_number})
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
          </div>
        )}
        {step !== STEP.SELECT && selectedDevice && (
          <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-sm font-bold text-emerald-700">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            {selectedDevice.device_name} ({selectedDevice.serial_number})
          </div>
        )}
      </div>

      {/* ── Step progress bar ── */}
      <StepBar current={step} />

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-start gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl">
          <AlertCircle size={16} className="text-rose-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 font-semibold">{error}</p>
          <button onClick={() => setError('')} className="ml-auto text-rose-400 hover:text-rose-600">
            <XCircle size={15} />
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEP 1 — Select Range                                                  */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {step === STEP.SELECT && (
        <div className="card p-6 space-y-5">
          <p className="text-sm text-[#464555]">
            Select the date range for historical data you want to sync from the device.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">From Date</label>
              <input
                type="date"
                className="form-control"
                value={fromDate}
                max={toDate}
                onChange={e => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">To Date</label>
              <input
                type="date"
                className="form-control"
                value={toDate}
                min={fromDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => setToDate(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#777587] bg-[#f0f3ff] border border-[#e7eefe] rounded-lg px-3 py-2.5">
            <Info size={13} className="flex-shrink-0 text-[#3525cd]" />
            Dry run will show how many records will be imported and how many already exist.
          </div>
          <div className="flex justify-end">
            <button
              className="btn btn-primary gap-2"
              onClick={handleStartDryRun}
              disabled={!selectedDeviceId}
            >
              <FileText size={15} /> Start Dry Run
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEP 2 — Dry Run Loading                                               */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {step === STEP.DRY_RUN_LOADING && (
        <div className="card p-8 text-center space-y-4">
          <Loader2 size={36} className="mx-auto text-[#3525cd] animate-spin" />
          <div>
            <p className="font-bold text-[#151c27] text-base">Running Dry Run…</p>
            <p className="text-sm text-[#777587] mt-1">
              Querying device for records between {fromDate} and {toDate}.
              This may take 60–120 seconds.
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-[#777587]">
            <div className="w-2 h-2 rounded-full bg-[#3525cd] animate-pulse" />
            No data is being written — safe preview only
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEP 2 — Dry Run Results                                               */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {step === STEP.DRY_RUN_DONE && dryRunJob && (
        <div className="card p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-black text-[#151c27] text-base">Dry Run Results</h2>
              <span className="badge badge-approved text-[0.65rem]">Completed</span>
            </div>
            <div className="text-xs text-[#777587]">
              Device: {selectedDevice?.device_name} ({selectedDevice?.serial_number})
              &nbsp;·&nbsp;Range: {fromDate} to {toDate}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              icon={<FileText />}
              value={(dryRunJob.records_in_range ?? dryRunJob.records_received ?? 0).toLocaleString()}
              label="Total Records Found"
              sub="In selected date range"
              color="blue"
            />
            <StatCard
              icon={<CheckCircle2 />}
              value={(dryRunJob.records_inserted ?? 0).toLocaleString()}
              label="New Records"
              sub="Will be imported"
              color="green"
            />
            <StatCard
              icon={<Copy />}
              value={(dryRunJob.records_duplicate ?? 0).toLocaleString()}
              label="Duplicate Records"
              sub="Already exist"
              color="amber"
              warn={(dryRunJob.records_duplicate ?? 0) > 0}
            />
            <StatCard
              icon={<XCircle />}
              value={(dryRunJob.records_ignored ?? 0).toLocaleString()}
              label="Ignored Records"
              sub="Out of range / invalid"
              color="slate"
            />
          </div>

          {(dryRunJob.records_inserted ?? 0) === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700 font-semibold">
              <AlertCircle size={15} className="flex-shrink-0" />
              No new records found in this date range — all records already exist.
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 font-semibold">
              <CheckCircle2 size={15} className="flex-shrink-0" />
              Looks good! You can proceed to sync these records.
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <button className="btn btn-outline btn-sm" onClick={handleReset}>
              ← Change Range
            </button>
            <button
              className="btn btn-primary gap-2"
              onClick={handleSyncImport}
            >
              <Upload size={15} /> Sync &amp; Import Records
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* STEPS 3-5 — Sync & Reprocess Progress                                  */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {[STEP.SYNC_LOADING, STEP.REPROCESS, STEP.DONE].includes(step) && (
        <div className="card p-6 space-y-6">
          <h2 className="font-black text-[#151c27] text-base">Sync &amp; Reprocess Progress</h2>

          {/* 4-stage progress track */}
          <div className="flex items-start">
            <SyncStage
              icon={<Upload />}
              label="Syncing from Device"
              status={step === STEP.SYNC_LOADING ? 'loading' : step > STEP.SYNC_LOADING ? 'done' : 'pending'}
            />
            <SyncStageConnector active={step >= STEP.REPROCESS} />
            <SyncStage
              icon={<Database />}
              label="Importing Records"
              status={stage2status}
              count={syncJob?.records_inserted}
              total={syncJob?.records_in_range}
            />
            <SyncStageConnector active={step >= STEP.DONE} />
            <SyncStage
              icon={<RefreshCw />}
              label="Reprocessing Attendance"
              status={stage3status}
              count={syncJob?.attendance_records_updated}
              total={syncJob?.employees_reprocessed}
            />
            <SyncStageConnector active={step === STEP.DONE} />
            <SyncStage
              icon={<CheckCircle2 />}
              label="Completed"
              status={step === STEP.DONE ? 'done' : 'pending'}
              ts={step === STEP.DONE}
            />
          </div>

          {/* Completion banner */}
          {step === STEP.DONE && (
            <div className="flex items-center justify-between gap-4 px-5 py-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={20} className="text-white" />
                </div>
                <div>
                  <p className="font-black text-[#151c27] text-sm">Historical Sync Completed Successfully!</p>
                  <p className="text-xs text-[#464555] mt-0.5">
                    {(syncJob?.records_inserted ?? 0).toLocaleString()} records have been synced and attendance records have been updated.
                  </p>
                </div>
              </div>
              <button
                className="btn btn-outline btn-sm gap-1.5 flex-shrink-0"
                onClick={() => setShowSummary(true)}
              >
                <BarChart2 size={13} /> View Summary
              </button>
            </div>
          )}

          {/* In-progress note */}
          {step !== STEP.DONE && (
            <div className="flex items-center gap-2 text-xs text-[#777587] bg-[#f0f3ff] border border-[#e7eefe] rounded-lg px-3 py-2.5">
              <Loader2 size={12} className="text-[#3525cd] animate-spin flex-shrink-0" />
              Please keep this page open — do not navigate away while sync is in progress.
            </div>
          )}

          {/* Start new sync button */}
          {step === STEP.DONE && (
            <div className="flex justify-end">
              <button className="btn btn-outline btn-sm" onClick={handleReset}>
                Start New Sync
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Summary modal ── */}
      {showSummary && (
        <SummaryModal
          job={syncJob}
          reprocessResult={reprocessResult}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
