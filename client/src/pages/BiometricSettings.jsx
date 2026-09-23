import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Server, Copy, Info, RefreshCw, CheckCircle2,
  XCircle, Clock, Play, Calendar, Save, ChevronDown, AlertTriangle, Building2,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPut, apiPost } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
    timeZone: 'Asia/Kolkata',
  });
}

function fmtDuration(start, end) {
  if (!start || !end) return null;
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function StatusBadge({ status }) {
  const styles = {
    success:   'text-emerald-700 bg-emerald-50 border-emerald-200',
    completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    partial:   'text-amber-700  bg-amber-50  border-amber-200',
    failed:    'text-red-700    bg-red-50    border-red-200',
    running:   'text-blue-700   bg-blue-50   border-blue-200',
    never:     'text-gray-500   bg-gray-50   border-gray-200',
  };
  const labels = {
    success: 'Success', completed: 'Completed',
    partial: 'Partial', failed: 'Failed',
    running: 'Running…', never: 'Never run',
  };
  const s = styles[status] || styles.never;
  const l = labels[status] || 'Unknown';
  return (
    <span className={`inline-flex items-center gap-1 text-[0.68rem] font-bold border rounded-full px-2 py-0.5 ${s}`}>
      {(status === 'success' || status === 'completed') && <CheckCircle2 size={10} />}
      {status === 'failed'  && <XCircle size={10} />}
      {status === 'running' && <RefreshCw size={10} className="animate-spin" />}
      {l}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function BiometricSettings() {
  const toast = useToast();
  const qc    = useQueryClient();
  const { selectedBranchId, selectedBranch } = useBranch();

  // ── ADMS URL ─────────────────────────────────────────────────────────────────
  const { data: admsData, isLoading: admsLoading } = useQuery({
    queryKey: ['biometric-config'],
    queryFn:  () => apiGet('/settings/biometric-config'),
  });
  const serverUrl = admsData?.adms_url || admsData?.server_url || '—';

  function copyUrl() {
    if (serverUrl === '—') return;
    navigator.clipboard.writeText(serverUrl).then(() => toast('URL copied!', 'success'));
  }

  // ── Auto-sync config ──────────────────────────────────────────────────────────
  const { data: syncCfg, isLoading: cfgLoading } = useQuery({
    queryKey: ['biometric-auto-sync-config', selectedBranchId],
    queryFn:  () => apiGet('/biometric/auto-sync/config'),
  });

  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (syncCfg !== undefined && form === null) {
      setForm(syncCfg
        ? { enabled: syncCfg.enabled, frequency: syncCfg.frequency, sync_time_1: syncCfg.sync_time_1, sync_time_2: syncCfg.sync_time_2 || '' }
        : { enabled: true, frequency: 'day', sync_time_1: '10:00', sync_time_2: '17:00' }
      );
    }
  }, [syncCfg, form]);

  // ── Sync history ──────────────────────────────────────────────────────────────
  const { data: history = [], isLoading: histLoading, refetch: refetchHistory } = useQuery({
    queryKey: ['biometric-auto-sync-history', selectedBranchId],
    queryFn:  () => apiGet('/biometric/auto-sync/history', { limit: 100 }),
    refetchInterval: syncCfg?.last_sync_status === 'running' ? 4000 : false,
  });

  // History filter state
  const now = new Date();
  const [histDeviceFilter, setHistDeviceFilter] = useState('');
  const [histStatusFilter, setHistStatusFilter] = useState('');
  const [histRowsPerPage,  setHistRowsPerPage]  = useState(10);
  const [histPage,         setHistPage]         = useState(1);
  const [histFrom,         setHistFrom]         = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [histTo, setHistTo] = useState(now.toISOString().slice(0, 10));

  const uniqueDevices = useMemo(() =>
    [...new Set(history.map(r => r.device_name || r.serial_number).filter(Boolean))],
  [history]);

  const filteredHistory = useMemo(() => {
    let rows = history;
    if (histFrom) rows = rows.filter(r => r.created_at && r.created_at.slice(0, 10) >= histFrom);
    if (histTo)   rows = rows.filter(r => r.created_at && r.created_at.slice(0, 10) <= histTo);
    if (histDeviceFilter) rows = rows.filter(r => (r.device_name || r.serial_number) === histDeviceFilter);
    if (histStatusFilter) rows = rows.filter(r => r.status === histStatusFilter);
    return rows;
  }, [history, histFrom, histTo, histDeviceFilter, histStatusFilter]);

  const histTotalPages = Math.max(1, Math.ceil(filteredHistory.length / histRowsPerPage));
  const histSafePage   = Math.min(histPage, histTotalPages);
  const pagedHistory   = filteredHistory.slice((histSafePage - 1) * histRowsPerPage, histSafePage * histRowsPerPage);

  // ── Save config ───────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: (payload) => apiPut('/biometric/auto-sync/config', payload),
    onSuccess: () => {
      toast('Schedule saved and applied immediately.', 'success');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['biometric-auto-sync-config'] });
    },
    onError: (err) => toast(err.message, 'error'),
  });

  // ── Manual trigger ────────────────────────────────────────────────────────────
  const triggerMut = useMutation({
    mutationFn: () => apiPost('/biometric/auto-sync/trigger', {}),
    onSuccess: () => {
      toast('Sync triggered — devices will upload on next heartbeat (~30–60 s).', 'success');
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['biometric-auto-sync-config'] });
        qc.invalidateQueries({ queryKey: ['biometric-auto-sync-history'] });
      }, 5000);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  // ── Reset stuck jobs ──────────────────────────────────────────────────────────
  const resetStuckMut = useMutation({
    mutationFn: () => apiPost('/biometric/auto-sync/reset-stuck', {}),
    onSuccess: (data) => {
      toast(`${data.reset} stuck job(s) reset — future syncs will now proceed.`, 'success');
      qc.invalidateQueries({ queryKey: ['biometric-auto-sync-history'] });
      qc.invalidateQueries({ queryKey: ['biometric-auto-sync-config'] });
    },
    onError: (err) => toast(err.message, 'error'),
  });

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
    setDirty(true);
  }

  const loading  = admsLoading || cfgLoading;
  const latestJob = history[0];

  // Detect jobs stuck in 'running' for >2 hours (blocking future auto-syncs)
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  const stuckJobs = history.filter(
    r => r.status === 'running' && new Date(r.created_at).getTime() < twoHoursAgo
  );

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="page-title">Biometric Settings</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="page-subtitle">ZKTeco ADMS configuration and automatic biometric sync schedule</p>
            {selectedBranch && (
              <span className="inline-flex items-center gap-1 text-[0.68rem] font-bold bg-[#f0f3ff] text-[#3525cd] border border-[#3525cd]/20 px-2 py-0.5 rounded-full">
                <Building2 size={10} /> {selectedBranch.name}
              </span>
            )}
          </div>
        </div>
        {form && (
          <button
            onClick={() => saveMut.mutate(form)}
            disabled={saveMut.isLoading || !dirty}
            className="flex items-center gap-2 bg-[#3525cd] hover:bg-[#2a1db5] text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50 shadow-sm">
            {saveMut.isLoading
              ? <><RefreshCw size={14} className="animate-spin" />Saving…</>
              : <><Save size={14} />Save Changes</>}
          </button>
        )}
      </div>

      {/* ── Stuck jobs warning ── */}
      {stuckJobs.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-800">
              {stuckJobs.length} sync job{stuckJobs.length > 1 ? 's' : ''} stuck in "Running" state
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              {stuckJobs.map(j => j.device_name || j.serial_number).join(', ')} — started {new Date(stuckJobs[stuckJobs.length - 1].created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. These block future auto-syncs for the affected device(s).
            </p>
          </div>
          <button
            onClick={() => resetStuckMut.mutate()}
            disabled={resetStuckMut.isPending}
            className="flex-shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {resetStuckMut.isPending
              ? <><RefreshCw size={11} className="animate-spin" />Resetting…</>
              : 'Reset Stuck Jobs'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading"><div className="spinner" />Loading…</div>
      ) : (
        <div className="space-y-5">

          {/* ── ADMS Server Configuration ── */}
          <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-[#e7eefe] bg-[#f8f9fe]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center">
                  <Server size={15} className="text-[#3525cd]" />
                </div>
                <h2 className="font-black text-[#151c27]">ADMS Server Configuration</h2>
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* URL row */}
              <div>
                <label className="text-[0.68rem] font-black text-[#464555] uppercase tracking-wider mb-2 block">
                  ADMS Server URL
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 font-mono text-sm bg-[#f9f9ff] border border-[#c7c4d8] rounded-xl px-4 py-3 text-[#151c27] select-all break-all">
                    {serverUrl}
                  </div>
                  <button onClick={copyUrl}
                    className="flex items-center gap-1.5 border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] text-[#464555] text-xs font-bold px-4 py-3 rounded-xl transition-colors flex-shrink-0">
                    <Copy size={13} /> Copy
                  </button>
                </div>
              </div>

              {/* Setup guide */}
              <div className="p-4 rounded-xl bg-[#f0f3ff] border border-[#c7c4d8]">
                <div className="flex items-start gap-2.5">
                  <Info size={14} className="text-[#3525cd] mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-[#3525cd] mb-1.5">How to configure your ZKTeco device</p>
                    <ol className="text-xs text-[#464555] space-y-1 list-decimal list-inside">
                      <li>Open the device's web interface or use the ZKTeco configuration tool</li>
                      <li>Navigate to <strong>ADMS</strong> or <strong>Cloud Server Settings</strong></li>
                      <li>Set the <strong>Server Address</strong> to the URL shown above</li>
                      <li>Set <strong>HTTPS</strong> based on whether the URL uses <code className="bg-white px-1 rounded">https://</code></li>
                      <li>Save settings — the device will begin pushing punch data automatically</li>
                    </ol>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer note */}
            <div className="px-6 py-3 border-t border-[#f0f3ff] bg-[#fafaff] flex items-center gap-2 text-[0.7rem] text-[#777587]">
              <Info size={11} className="flex-shrink-0" />
              ADMS URL is managed via environment variables (<code className="bg-[#f0f3ff] px-1 rounded text-[0.65rem]">ADMS_URL</code>).
              Contact your system administrator to update it.
            </div>
          </div>

          {/* ── Automatic Sync Schedule ── */}
          {form && (
            <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm overflow-hidden">
              {/* Card header */}
              <div className="px-6 py-4 border-b border-[#e7eefe] bg-[#f8f9fe] flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center">
                    <Calendar size={15} className="text-[#3525cd]" />
                  </div>
                  <h2 className="font-black text-[#151c27]">Automatic Sync Schedule</h2>
                </div>
                {/* Toggle */}
                <div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => setField('enabled', !form.enabled)}>
                  <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${form.enabled ? 'bg-green-500' : 'bg-[#c7c4d8]'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-200 ${form.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </div>
                  <span className={`text-sm font-bold ${form.enabled ? 'text-green-600' : 'text-[#777587]'}`}>
                    {form.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>

              {/* Two-column body */}
              <div className="p-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-5">

                  {/* Left: Last Sync Result */}
                  {syncCfg && (
                    <div className="rounded-xl bg-[#f8f9fe] border border-[#e7eefe] p-4">
                      <p className="text-[0.68rem] font-black text-[#777587] uppercase tracking-wider mb-3">
                        Last Sync Result
                      </p>
                      <div className="space-y-2">
                        {[
                          { label: 'Status',           value: <StatusBadge status={syncCfg.last_sync_status || 'never'} /> },
                          { label: 'Schedule',         value: `${syncCfg.frequency === 'day' ? 'Daily' : syncCfg.frequency === 'week' ? 'Weekly' : 'Monthly'} — ${syncCfg.sync_time_1}${syncCfg.sync_time_2 ? `, ${syncCfg.sync_time_2}` : ''}` },
                          syncCfg.last_sync_at && { label: 'Last Triggered', value: fmtTs(syncCfg.last_sync_at) },
                          latestJob && { label: 'Records Received', value: latestJob.records_received ?? '—' },
                          latestJob && { label: 'New Records',      value: <span className="text-green-700 font-bold">{latestJob.records_inserted ?? '—'}</span> },
                          latestJob && { label: 'Already Existing', value: latestJob.records_duplicate ?? '—' },
                        ].filter(Boolean).map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between py-1.5 border-b border-[#f0f3ff] last:border-0">
                            <span className="text-xs text-[#777587]">{label}</span>
                            <span className="text-xs font-semibold text-[#151c27]">{value}</span>
                          </div>
                        ))}
                        {syncCfg.last_sync_error && (
                          <div className="pt-1.5 text-[0.63rem] text-red-600 font-mono break-all">
                            {syncCfg.last_sync_error}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Right: Frequency + Times */}
                  <div className="space-y-5">
                    <div>
                      <label className="text-[0.68rem] font-black text-[#777587] uppercase tracking-wider mb-2.5 block">
                        Frequency
                      </label>
                      <div className="flex gap-2">
                        {[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].map(([val, lbl]) => (
                          <button key={val} onClick={() => setField('frequency', val)}
                            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold border transition-colors ${
                              form.frequency === val
                                ? 'bg-[#3525cd] text-white border-[#3525cd]'
                                : 'bg-white text-[#464555] border-[#c7c4d8] hover:bg-[#f0f3ff]'
                            }`}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[0.68rem] font-black text-[#777587] uppercase tracking-wider mb-1.5 block">
                          Sync Time 1
                        </label>
                        <input type="time" value={form.sync_time_1}
                          onChange={e => setField('sync_time_1', e.target.value)}
                          className="w-full border border-[#c7c4d8] rounded-xl px-3 py-2.5 text-sm text-[#151c27] bg-white focus:outline-none focus:border-[#3525cd] transition-colors" />
                      </div>
                      {form.frequency === 'day' && (
                        <div>
                          <label className="text-[0.68rem] font-black text-[#777587] uppercase tracking-wider mb-1.5 block">
                            Sync Time 2 <span className="normal-case font-normal text-[#aaa]">(optional)</span>
                          </label>
                          <input type="time" value={form.sync_time_2 || ''}
                            onChange={e => setField('sync_time_2', e.target.value)}
                            className="w-full border border-[#c7c4d8] rounded-xl px-3 py-2.5 text-sm text-[#151c27] bg-white focus:outline-none focus:border-[#3525cd] transition-colors" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Info note */}
                <div className="p-3.5 rounded-xl bg-[#f0f3ff] border border-[#c7c4d8] mb-5">
                  <div className="flex items-start gap-2">
                    <Info size={13} className="text-[#3525cd] mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-[#464555]">
                      {form.frequency === 'day'   && 'Runs at the configured time(s) every day — syncs yesterday + today\'s records.'}
                      {form.frequency === 'week'  && 'Runs every Sunday at the configured time — syncs the full week (Monday → Sunday).'}
                      {form.frequency === 'month' && 'Runs on the 1st of each month — syncs the entire previous month\'s records.'}
                      {' '}The device uploads automatically via ADMS — no manual steps required. Times are in IST.
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 pt-4 border-t border-[#e7eefe]">
                  <button
                    onClick={() => saveMut.mutate(form)}
                    disabled={saveMut.isLoading || !dirty}
                    className="flex items-center gap-2 bg-[#3525cd] hover:bg-[#2a1db5] text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
                    {saveMut.isLoading
                      ? <><RefreshCw size={13} className="animate-spin" />Saving…</>
                      : <><Save size={13} />Save Schedule</>}
                  </button>

                  <button
                    onClick={() => triggerMut.mutate()}
                    disabled={triggerMut.isLoading}
                    className="flex items-center gap-2 border border-[#c7c4d8] bg-white hover:bg-[#f0f3ff] text-[#464555] text-xs font-bold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50">
                    <Play size={12} />
                    {triggerMut.isLoading ? 'Triggering…' : 'Run Now'}
                  </button>

                  <button
                    onClick={() => { refetchHistory(); qc.invalidateQueries({ queryKey: ['biometric-auto-sync-config'] }); }}
                    className="ml-auto flex items-center gap-1.5 text-xs text-[#777587] hover:text-[#3525cd] font-semibold transition-colors">
                    <RefreshCw size={12} />Refresh
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Sync History ── */}
          {(history.length > 0 || histLoading) && (
            <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm overflow-hidden">

              {/* History header with filters */}
              <div className="px-6 py-4 border-b border-[#e7eefe] bg-[#f8f9fe] flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2.5 mr-auto">
                  <div className="w-8 h-8 rounded-lg bg-[#f0f3ff] flex items-center justify-center">
                    <Clock size={15} className="text-[#3525cd]" />
                  </div>
                  <h2 className="font-black text-[#151c27]">Sync History</h2>
                  {history.length > 0 && (
                    <span className="text-xs text-[#777587]">— last {history.length} runs</span>
                  )}
                </div>

                {/* Date range filter */}
                <div className="flex items-center gap-1.5 border border-[#c7c4d8] bg-white rounded-lg px-3 py-1.5 text-xs text-[#464555]">
                  <Calendar size={12} className="text-[#777587] flex-shrink-0" />
                  <input type="date" value={histFrom} onChange={e => { setHistFrom(e.target.value); setHistPage(1); }}
                    className="border-0 outline-none text-xs text-[#464555] bg-transparent w-[7rem]" />
                  <span className="text-[#c7c4d8]">—</span>
                  <input type="date" value={histTo} onChange={e => { setHistTo(e.target.value); setHistPage(1); }}
                    className="border-0 outline-none text-xs text-[#464555] bg-transparent w-[7rem]" />
                </div>

                {/* Device filter */}
                <div className="relative">
                  <select value={histDeviceFilter} onChange={e => { setHistDeviceFilter(e.target.value); setHistPage(1); }}
                    className="appearance-none border border-[#c7c4d8] bg-white rounded-lg pl-3 pr-7 py-1.5 text-xs text-[#464555] focus:outline-none focus:border-[#3525cd] cursor-pointer">
                    <option value="">All Devices</option>
                    {uniqueDevices.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                </div>

                {/* Status filter */}
                <div className="relative">
                  <select value={histStatusFilter} onChange={e => { setHistStatusFilter(e.target.value); setHistPage(1); }}
                    className="appearance-none border border-[#c7c4d8] bg-white rounded-lg pl-3 pr-7 py-1.5 text-xs text-[#464555] focus:outline-none focus:border-[#3525cd] cursor-pointer">
                    <option value="">All Status</option>
                    <option value="completed">Completed</option>
                    <option value="success">Success</option>
                    <option value="partial">Partial</option>
                    <option value="failed">Failed</option>
                    <option value="running">Running</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#e7eefe] bg-[#f8f9fe]">
                      {['Date / Time (IST)', 'Device', 'Range', 'Received', 'New', 'Existing', 'Duration', 'Status'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-[0.65rem] font-black text-[#777587] uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f3ff]">
                    {histLoading ? (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-[#777587]">Loading…</td></tr>
                    ) : pagedHistory.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-10 text-center text-[#777587]">No sync runs match the current filters.</td></tr>
                    ) : pagedHistory.map(row => (
                      <tr key={row.id} className="hover:bg-[#f8f9fe] transition-colors">
                        <td className="px-4 py-3 font-mono text-[#464555] whitespace-nowrap">{fmtTs(row.created_at)}</td>
                        <td className="px-4 py-3 text-[#464555] font-semibold">{row.device_name || row.serial_number || '—'}</td>
                        <td className="px-4 py-3 text-[#777587] whitespace-nowrap font-mono text-[0.65rem]">
                          {row.from_date?.slice(0, 10)} → {row.to_date?.slice(0, 10)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-[#464555]">{row.records_received ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-semibold text-green-700">{row.records_inserted ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-[#777587]">{row.records_duplicate ?? '—'}</td>
                        <td className="px-4 py-3 text-[#777587] whitespace-nowrap">
                          {fmtDuration(row.created_at, row.completed_at) || (row.status === 'running' ? '…' : '—')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-0.5">
                            <StatusBadge status={row.status} />
                            {row.error && (
                              <span className="text-[0.6rem] text-red-500 font-mono max-w-[140px] truncate" title={row.error}>
                                {row.error}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Table footer: rows per page + pagination */}
              <div className="px-4 py-3 border-t border-[#f0f3ff] bg-[#fafaff] flex items-center justify-between gap-3 flex-wrap">
                {/* Rows per page */}
                <div className="flex items-center gap-2 text-xs text-[#777587]">
                  <span>Rows per page</span>
                  <div className="relative">
                    <select value={histRowsPerPage} onChange={e => { setHistRowsPerPage(Number(e.target.value)); setHistPage(1); }}
                      className="appearance-none border border-[#c7c4d8] bg-white rounded-lg pl-2.5 pr-6 py-1 text-xs text-[#464555] focus:outline-none focus:border-[#3525cd] cursor-pointer">
                      {[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#777587] pointer-events-none" />
                  </div>
                </div>

                {/* Showing X–Y of Z + page buttons */}
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[#777587]">
                    Showing {filteredHistory.length === 0 ? 0 : (histSafePage - 1) * histRowsPerPage + 1} to{' '}
                    {Math.min(histSafePage * histRowsPerPage, filteredHistory.length)} of {filteredHistory.length} runs
                  </span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setHistPage(p => p - 1)} disabled={histSafePage === 1}
                      className="w-7 h-7 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors">
                      ‹
                    </button>
                    {Array.from({ length: histTotalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === histTotalPages || Math.abs(p - histSafePage) <= 1)
                      .reduce((acc, p, idx, arr) => {
                        if (idx > 0 && p - arr[idx - 1] > 1) acc.push('…');
                        acc.push(p);
                        return acc;
                      }, [])
                      .map((p, i) => p === '…'
                        ? <span key={`e-${i}`} className="text-xs text-[#777587] px-0.5">…</span>
                        : (
                          <button key={p} onClick={() => setHistPage(p)}
                            className={`w-7 h-7 rounded-lg border text-xs font-bold transition-colors ${
                              p === histSafePage
                                ? 'bg-[#3525cd] text-white border-[#3525cd]'
                                : 'border-[#c7c4d8] text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd]'
                            }`}>
                            {p}
                          </button>
                        )
                      )
                    }
                    <button onClick={() => setHistPage(p => p + 1)} disabled={histSafePage === histTotalPages}
                      className="w-7 h-7 rounded-lg border border-[#c7c4d8] text-xs font-bold text-[#777587] hover:border-[#3525cd] hover:text-[#3525cd] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors">
                      ›
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
