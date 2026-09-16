import React, { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ScrollText, ChevronLeft, ChevronRight, Filter, Upload, X, CheckCircle, AlertCircle, Eye, Database, ArrowRight } from 'lucide-react';
import { apiGet, apiUpload } from '@/lib/api';
import { useBranch } from '@/context/BranchContext';

const PAGE_SIZE = 20;

const PUNCH_TYPE_CFG = {
  0: { label: 'Check-In',  cls: 'bg-green-50 text-green-700 border-green-200' },
  1: { label: 'Check-Out', cls: 'bg-blue-50 text-blue-700 border-blue-200'   },
  4: { label: 'OT-In',     cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  5: { label: 'OT-Out',    cls: 'bg-purple-50 text-purple-700 border-purple-200' },
};

function PunchTypeBadge({ type }) {
  const cfg = PUNCH_TYPE_CFG[type] ?? { label: `Type ${type}`, cls: 'bg-slate-50 text-slate-600 border-slate-200' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function ProcessedBadge({ processed }) {
  return processed ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
      Yes
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
      No
    </span>
  );
}

function fmtDateOnly(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

function fmtTimeOnly(str) {
  if (!str) return '—';
  return new Date(str).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true
  });
}

const getToday = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

export default function BiometricLogs() {
  const [searchParams] = useSearchParams();
  const initDevice = searchParams.get('device') || '';
  const queryClient = useQueryClient();
  const { selectedBranchId } = useBranch();

  const [dateFrom,   setDateFrom]   = useState(getToday());
  const [dateTo,     setDateTo]     = useState(getToday());
  const [device,     setDevice]     = useState(initDevice);
  const [pin,        setPin]        = useState('');
  const [nameSearch, setNameSearch] = useState('');
  const [page,       setPage]       = useState(1);

  // ── Import modal state (3-step: select → preview → result) ───────────────
  const [showImport,    setShowImport]    = useState(false);
  const [importStep,    setImportStep]    = useState('select'); // 'select'|'preview'|'result'
  const [importFile,    setImportFile]    = useState(null);
  const [importFrom,    setImportFrom]    = useState('');
  const [importTo,      setImportTo]      = useState('');
  const [importBusy,    setImportBusy]    = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importResult,  setImportResult]  = useState(null);
  const [importError,   setImportError]   = useState('');
  const fileInputRef = useRef(null);

  function openImport() {
    setShowImport(true);
    setImportStep('select');
    setImportFile(null);
    setImportFrom('');
    setImportTo('');
    setImportPreview(null);
    setImportResult(null);
    setImportError('');
  }
  function closeImport() {
    if (importBusy) return;
    setShowImport(false);
  }

  async function handlePreview() {
    if (!importFile) return;
    setImportBusy(true);
    setImportError('');
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      if (importFrom) fd.append('date_from', importFrom);
      if (importTo)   fd.append('date_to',   importTo);
      const preview = await apiUpload('/biometric/preview-easywdms', fd);
      setImportPreview(preview);
      setImportStep('preview');
    } catch (err) {
      setImportError(err.message || 'Preview failed');
    } finally {
      setImportBusy(false);
    }
  }

  async function handleImport() {
    if (!importFile) return;
    setImportBusy(true);
    setImportError('');
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      if (importFrom) fd.append('date_from', importFrom);
      if (importTo)   fd.append('date_to',   importTo);
      const result = await apiUpload('/biometric/import-easywdms', fd);
      setImportResult(result);
      setImportStep('result');
      queryClient.invalidateQueries({ queryKey: ['biometric-logs'] });
    } catch (err) {
      setImportError(err.message || 'Import failed');
    } finally {
      setImportBusy(false);
    }
  }

  const params = {
    page,
    limit: PAGE_SIZE,
    ...(dateFrom  ? { date_from: dateFrom }        : {}),
    ...(dateTo    ? { date_to: dateTo }            : {}),
    ...(device    ? { device_serial: device }      : {}),
    ...(pin        ? { employee_pin: pin }         : {}),
    ...(nameSearch ? { name_search: nameSearch }   : {}),
  };

  const { data: _res, isLoading } = useQuery({
    queryKey: ['biometric-logs', params, selectedBranchId],
    queryFn:  () => apiGet('/biometric/logs', params),
    keepPreviousData: true,
  });

  const { data: _devices } = useQuery({
    queryKey: ['biometric-devices'],
    queryFn:  () => apiGet('/biometric/devices'),
  });

  const { data: _empList = [] } = useQuery({
    queryKey: ['employees-for-bio-logs'],
    queryFn:  () => apiGet('/reports/employees'),
    staleTime: 300000,
  });
  const empList = Array.isArray(_empList) ? _empList : [];

  const logs        = Array.isArray(_res?.data) ? _res.data : Array.isArray(_res?.logs) ? _res.logs : Array.isArray(_res) ? _res : [];
  const total       = _res?.total ?? logs.length;
  const totalPages  = Math.ceil(total / PAGE_SIZE);
  const devices     = Array.isArray(_devices) ? _devices : [];

  function resetFilters() {
    setDateFrom(getToday()); setDateTo(getToday()); setDevice(initDevice); setPin(''); setNameSearch(''); setPage(1);
  }

  const hasFilter = dateFrom || dateTo || (device && device !== initDevice) || pin || nameSearch;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Punch Logs</h1>
          <p className="page-subtitle">Raw biometric punch records from all devices</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openImport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#3525cd] text-white text-sm font-bold hover:bg-[#2a1eb0] transition-colors shadow-sm"
          >
            <Upload size={15} />
            Import EasyWDMS Data
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm px-5 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-[#777587]" />
          <span className="text-xs font-black text-[#464555] uppercase tracking-wider">Filters</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider">From</label>
            <input type="date" className="form-control text-xs py-1.5"
              value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider">To</label>
            <input type="date" className="form-control text-xs py-1.5"
              value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} />
          </div>
          <div className="flex flex-col gap-1 border-l border-[#e7eefe] pl-3 ml-1 mr-1">
            <label className="text-[0.65rem] font-black text-[#3525cd] uppercase tracking-wider">Quick Month</label>
            <input type="month" className="form-control text-xs py-1.5 w-32 cursor-pointer"
              onChange={e => {
                if (!e.target.value) return;
                const [y, m] = e.target.value.split('-');
                setDateFrom(`${y}-${m}-01`);
                const lastDay = new Date(y, m, 0);
                const dd = String(lastDay.getDate()).padStart(2, '0');
                setDateTo(`${y}-${m}-${dd}`);
                setPage(1);
              }} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider">Device</label>
            <select className="form-control text-xs py-1.5 min-w-[160px]"
              value={device} onChange={e => { setDevice(e.target.value); setPage(1); }}>
              <option value="">All Devices</option>
              {devices.map(d => (
                <option key={d.id} value={d.serial_number}>{d.device_name} ({d.serial_number})</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider">Employee</label>
            <select
              className="form-control text-xs py-1.5 min-w-[180px]"
              value={nameSearch}
              onChange={e => {
                setNameSearch(e.target.value);
                setPin('');
                setPage(1);
              }}>
              <option value="">All Employees</option>
              {empList.map(emp => (
                <option key={emp.id} value={emp.name}>{emp.name}</option>
              ))}
            </select>
          </div>
          {hasFilter && (
            <div className="flex items-end">
              <button onClick={resetFilters}
                className="text-xs font-bold text-rose-500 hover:text-rose-600 px-3 py-1.5 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all">
                Clear Filters
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading logs…</div>
      ) : logs.length === 0 ? (
        <div className="empty-state">
          <ScrollText size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">No punch logs found</p>
          <p className="text-sm">Try adjusting your filters or check if devices are sending data</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#f8f9fe] border-b border-[#e7eefe]">
                  <tr>
                    <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider whitespace-nowrap">Date</th>
                    <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider whitespace-nowrap">Time</th>
                    <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider">Employee ID</th>
                    <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider whitespace-nowrap">Employee Name</th>
                    {/* Device hidden from UI, Verify Type removed */}
                    <th className="px-5 py-3.5 text-left text-xs font-black text-[#464555] uppercase tracking-wider whitespace-nowrap">Punch Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f3ff]">
                  {logs.map((log, idx) => (
                    <tr key={log.id ?? idx} className="hover:bg-[#f9f9ff] transition-colors">
                      <td className="px-5 py-3 text-xs text-[#464555] whitespace-nowrap font-mono">
                        {fmtDateOnly(log.punch_time || log.timestamp)}
                      </td>
                      <td className="px-5 py-3 text-xs text-[#464555] whitespace-nowrap font-mono">
                        {fmtTimeOnly(log.punch_time || log.timestamp)}
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs font-bold bg-[#f0f3ff] text-[#3525cd] px-2 py-0.5 rounded">
                          {log.employee_pin || log.pin}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-xs font-semibold text-[#151c27]">
                        {log.employee_name || log.user?.name || <span className="text-[#c7c4d8] italic">Unmatched</span>}
                      </td>
                      {/* Device hidden from UI via exclusion of td */}
                      <td className="px-5 py-3">
                        <PunchTypeBadge type={log.punch_type ?? log.punch_state} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between bg-white rounded-xl border border-[#c7c4d8] shadow-sm px-5 py-3">
              <span className="text-xs text-[#777587] font-semibold">
                Page {page} of {totalPages} · {total.toLocaleString()} total records
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1.5 rounded-lg hover:bg-[#f0f3ff] text-[#3525cd] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft size={16} />
                </button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  const p = totalPages <= 5 ? i + 1
                    : page <= 3 ? i + 1
                    : page >= totalPages - 2 ? totalPages - 4 + i
                    : page - 2 + i;
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${p === page ? 'bg-[#3525cd] text-white' : 'hover:bg-[#f0f3ff] text-[#464555]'}`}>
                      {p}
                    </button>
                  );
                })}
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="p-1.5 rounded-lg hover:bg-[#f0f3ff] text-[#3525cd] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── EasyWDMS Historical Import Modal (3-step) ────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7eefe]">
              <div className="flex items-center gap-2">
                <Database size={18} className="text-[#3525cd]" />
                <h2 className="text-base font-black text-[#151c27]">Import EasyWDMS Historical Data</h2>
              </div>
              <button onClick={closeImport} disabled={importBusy}
                className="p-1.5 rounded-lg hover:bg-[#f0f3ff] text-[#777587] transition-colors disabled:opacity-40">
                <X size={16} />
              </button>
            </div>

            {/* Step indicator */}
            <div className="flex items-center gap-1 px-6 pt-4 pb-1">
              {[['select','1','Select File'],['preview','2','Preview'],['result','3','Result']].map(([s, n, lbl], idx) => (
                <React.Fragment key={s}>
                  <div className={`flex items-center gap-1.5 text-[0.68rem] font-bold ${importStep === s ? 'text-[#3525cd]' : importStep === 'preview' && s === 'select' || importStep === 'result' ? 'text-emerald-600' : 'text-[#c7c4d8]'}`}>
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.6rem] font-black ${importStep === s ? 'bg-[#3525cd] text-white' : importStep === 'preview' && s === 'select' || importStep === 'result' ? 'bg-emerald-500 text-white' : 'bg-[#f0f3ff] text-[#c7c4d8]'}`}>{n}</span>
                    {lbl}
                  </div>
                  {idx < 2 && <ArrowRight size={11} className="text-[#c7c4d8] flex-shrink-0" />}
                </React.Fragment>
              ))}
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">

              {/* STEP 1: Select file + date range */}
              {importStep === 'select' && (
                <>
                  <p className="text-xs text-[#777587] leading-relaxed">
                    Export the <strong className="text-[#464555]">Transaction Report</strong> from EasyWDMS and upload it here.
                    Optionally filter by date range to import only specific months.
                  </p>

                  {/* Date range */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider block mb-1">From Date <span className="font-normal normal-case">(optional)</span></label>
                      <input type="date" className="form-control text-xs py-1.5"
                        value={importFrom} onChange={e => setImportFrom(e.target.value)} max={importTo || undefined} />
                    </div>
                    <div>
                      <label className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider block mb-1">To Date <span className="font-normal normal-case">(optional)</span></label>
                      <input type="date" className="form-control text-xs py-1.5"
                        value={importTo} onChange={e => setImportTo(e.target.value)} min={importFrom || undefined} />
                    </div>
                  </div>

                  {/* File drop zone */}
                  <div onClick={() => fileInputRef.current?.click()}
                    className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
                      ${importFile ? 'border-[#3525cd] bg-[#f0f3ff]' : 'border-[#c7c4d8] hover:border-[#3525cd] hover:bg-[#fafafe]'}`}>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden"
                      onChange={e => { setImportFile(e.target.files?.[0] || null); setImportError(''); }} />
                    {importFile ? (
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-[#3525cd]">{importFile.name}</p>
                        <p className="text-xs text-[#777587]">{(importFile.size / 1024).toFixed(1)} KB · Click to change</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload size={24} className="mx-auto text-[#c7c4d8]" />
                        <p className="text-sm font-semibold text-[#464555]">Click to select file</p>
                        <p className="text-xs text-[#777587]">.xlsx · .xls · .csv · .tsv · .txt</p>
                      </div>
                    )}
                  </div>

                  {importError && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" /><span>{importError}</span>
                    </div>
                  )}
                </>
              )}

              {/* STEP 2: Preview */}
              {importStep === 'preview' && importPreview && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-[#3525cd]">
                    <Eye size={16} className="shrink-0" />
                    <span className="font-bold text-sm">Preview — no changes made yet</span>
                  </div>

                  {/* Date range detected */}
                  {importPreview.date_range?.from && (
                    <div className="text-xs text-[#464555] bg-[#f8f9fe] rounded-xl px-4 py-2.5 border border-[#e7eefe]">
                      Date range in file: <strong>{importPreview.date_range.from}</strong> → <strong>{importPreview.date_range.to}</strong>
                      {' · '}{importPreview.unique_pin_count} employee{importPreview.unique_pin_count !== 1 ? 's' : ''}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Records in file',   value: importPreview.total_in_file,     cls: 'text-[#151c27]' },
                      { label: 'After date filter',  value: importPreview.after_date_filter, cls: 'text-[#3525cd]' },
                      { label: 'New records',        value: importPreview.new_records,       cls: 'text-green-700' },
                      { label: 'Already in HRMS',   value: importPreview.existing_in_db,    cls: 'text-amber-700' },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="bg-[#f8f9fe] rounded-xl px-4 py-3 border border-[#e7eefe]">
                        <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider">{label}</p>
                        <p className={`text-xl font-black mt-0.5 ${cls}`}>{value ?? '—'}</p>
                      </div>
                    ))}
                  </div>

                  {importPreview.invalid_device > 0 && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>{importPreview.invalid_device} records from unregistered devices will be skipped.</span>
                    </div>
                  )}

                  {importPreview.new_records === 0 && (
                    <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#f0f3ff] border border-[#c7c4d8] text-xs text-[#464555]">
                      <CheckCircle size={14} className="shrink-0 mt-0.5 text-[#3525cd]" />
                      <span>All records in this file already exist in HRMS. Import will complete with 0 new records inserted.</span>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 3: Result */}
              {importStep === 'result' && importResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-green-700">
                    <CheckCircle size={18} className="shrink-0" />
                    <span className="font-bold text-sm">Import completed successfully</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Total records',     value: importResult.total,       cls: 'text-[#151c27]' },
                      { label: 'New records',        value: importResult.inserted,    cls: 'text-green-700' },
                      { label: 'Duplicates skipped', value: importResult.skipped,     cls: 'text-amber-700' },
                      { label: 'Attendance updated', value: importResult.reprocessed, cls: 'text-blue-700'  },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="bg-[#f8f9fe] rounded-xl px-4 py-3 border border-[#e7eefe]">
                        <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider">{label}</p>
                        <p className={`text-xl font-black mt-0.5 ${cls}`}>{value ?? '—'}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[0.65rem] text-[#777587]">Batch ID: <span className="font-mono">{importResult.batch_id}</span></p>
                  {importResult.errors?.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1">
                      <p className="text-xs font-bold text-amber-700">Warnings ({importResult.errors.length})</p>
                      {importResult.errors.slice(0, 5).map((e, i) => (
                        <p key={i} className="text-xs text-amber-600 font-mono">{e}</p>
                      ))}
                      {importResult.errors.length > 5 && <p className="text-xs text-amber-500">…and {importResult.errors.length - 5} more</p>}
                    </div>
                  )}
                </div>
              )}

              {importError && importStep !== 'select' && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700">
                  <AlertCircle size={14} className="shrink-0 mt-0.5" /><span>{importError}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#e7eefe]">
              {importStep === 'result' ? (
                <button onClick={closeImport} className="px-5 py-2 rounded-xl bg-[#3525cd] text-white text-sm font-bold hover:bg-[#2a1eb0] transition-colors">Done</button>
              ) : importStep === 'preview' ? (
                <>
                  <button onClick={() => { setImportStep('select'); setImportError(''); }} disabled={importBusy}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-[#464555] hover:bg-[#f0f3ff] border border-[#c7c4d8] transition-colors disabled:opacity-40">
                    Back
                  </button>
                  <button onClick={handleImport} disabled={importBusy || importPreview?.after_date_filter === 0}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#3525cd] text-white text-sm font-bold hover:bg-[#2a1eb0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {importBusy ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Importing…</> : <><Upload size={14} />Confirm Import</>}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={closeImport} disabled={importBusy}
                    className="px-4 py-2 rounded-xl text-sm font-bold text-[#464555] hover:bg-[#f0f3ff] border border-[#c7c4d8] transition-colors disabled:opacity-40">
                    Cancel
                  </button>
                  <button onClick={handlePreview} disabled={!importFile || importBusy}
                    className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#3525cd] text-white text-sm font-bold hover:bg-[#2a1eb0] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                    {importBusy ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Analysing…</> : <><Eye size={14} />Preview Import</>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
