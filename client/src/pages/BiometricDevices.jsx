import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Fingerprint, Wifi, WifiOff, MapPin, Server, Eye, Trash2, History } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days < 7)   return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOnline(lastSeen) {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000;
}

// ── Register Device Modal ─────────────────────────────────────────────────────
function RegisterDeviceModal({ open, onClose, branches }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const empty = { serial_number: '', device_name: '', location: '', area_code: '', device_ip: '', branch_id: '' };
  const [form, setForm] = useState(empty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const mut = useMutation({
    mutationFn: () => apiPost('/biometric/devices', form),
    onSuccess: () => {
      toast('Device registered!', 'success');
      qc.invalidateQueries({ queryKey: ['biometric-devices'] });
      onClose();
      setForm(empty);
    },
    onError: e => toast(e.message, 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Register Biometric Device" size="md"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => mut.mutate()}
            disabled={mut.isPending || !form.serial_number || !form.device_name}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Register Device'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Serial Number <span className="text-rose-500">*</span></label>
            <input className="form-control font-mono" placeholder="e.g. ZKT-001-ABC" value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Device Name <span className="text-rose-500">*</span></label>
            <input className="form-control" placeholder="e.g. Main Entrance" value={form.device_name} onChange={e => set('device_name', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Location</label>
            <input className="form-control" placeholder="e.g. Ground Floor Lobby" value={form.location} onChange={e => set('location', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Area Code</label>
            <input className="form-control" placeholder="e.g. A1" value={form.area_code} onChange={e => set('area_code', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Device IP Address</label>
            <input className="form-control font-mono" placeholder="e.g. 192.168.1.100" value={form.device_ip} onChange={e => set('device_ip', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Branch</label>
            <select className="form-control" value={form.branch_id} onChange={e => set('branch_id', e.target.value)}>
              <option value="">— Select branch —</option>
              {(branches || []).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BiometricDevices() {
  const { isAdmin } = useAuth();
  const toast       = useToast();
  const qc          = useQueryClient();
  const { selectedBranchId } = useBranch();
  const navigate    = useNavigate();
  const [regOpen,      setRegOpen]      = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const deleteMut = useMutation({
    mutationFn: id => apiDelete(`/biometric/devices/${id}`),
    onSuccess: () => {
      toast('Device removed', 'success');
      qc.invalidateQueries({ queryKey: ['biometric-devices'] });
      setDeleteTarget(null);
    },
    onError: e => toast(e.message, 'error'),
  });

  const { data: _devices, isLoading } = useQuery({
    queryKey: ['biometric-devices', selectedBranchId],
    queryFn:  () => apiGet('/biometric/devices'),
    refetchInterval: 30000,
  });
  const { data: _branches } = useQuery({
    queryKey: ['branches'],
    queryFn:  () => apiGet('/branches'),
  });

  const devices  = Array.isArray(_devices)  ? _devices  : [];
  const branches = Array.isArray(_branches) ? _branches : [];

  const onlineCount  = devices.filter(d => isOnline(d.last_seen)).length;
  const offlineCount = devices.length - onlineCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Biometric Devices</h1>
          <p className="page-subtitle">{devices.length} device{devices.length !== 1 ? 's' : ''} registered · ZKTeco ADMS push</p>
        </div>
        {isAdmin && (
          <button
            className="flex items-center gap-2 bg-[#3525cd] hover:bg-[#2d1eb5] text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
            onClick={() => setRegOpen(true)}>
            <Plus size={16} /> Register Device
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Devices', value: devices.length,  color: 'from-[#f0f3ff] to-[#e7eefe]', top: '#3525cd',  text: 'text-[#3525cd]' },
          { label: 'Online',        value: onlineCount,     color: 'from-emerald-50 to-emerald-100', top: '#10B981', text: 'text-emerald-700' },
          { label: 'Offline',       value: offlineCount,    color: 'from-red-50 to-red-100',          top: '#EF4444', text: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-5 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-sm relative overflow-hidden`}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
            <div className={`text-3xl font-black leading-none ${s.text}`}>{s.value}</div>
            <div className="text-[0.7rem] font-bold uppercase tracking-wider text-[#777587] mt-1.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Devices grid */}
      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading devices…</div>
      ) : devices.length === 0 ? (
        <div className="empty-state">
          <Fingerprint size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">No devices registered</p>
          <p className="text-sm mb-4">Register your ZKTeco biometric devices to start tracking attendance</p>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => setRegOpen(true)}>
              <Plus size={14} /> Register First Device
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {devices.map(device => {
            const online = isOnline(device.last_seen);
            return (
              <div key={device.id}
                className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                <div className="p-5">
                  {/* Top row: icon + status badge */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-11 h-11 rounded-xl bg-[#f0f3ff] flex items-center justify-center flex-shrink-0">
                      <Fingerprint size={22} className="text-[#3525cd]" />
                    </div>
                    {online ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                        <Wifi size={10} /> Online
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
                        <WifiOff size={10} /> Offline
                      </span>
                    )}
                  </div>

                  {/* Name + serial */}
                  <h3 className="font-black text-[#151c27] leading-tight">{device.device_name}</h3>
                  <p className="text-xs font-mono text-[#777587] mt-0.5">{device.serial_number}</p>

                  {/* Details */}
                  <div className="space-y-2 mt-4">
                    {device.location && (
                      <div className="flex items-center gap-2 text-xs text-[#464555]">
                        <MapPin size={12} className="text-[#777587] flex-shrink-0" />
                        <span>{device.location}</span>
                        {device.area_code && (
                          <span className="ml-auto font-mono text-[0.68rem] font-bold bg-[#f0f3ff] text-[#3525cd] px-1.5 py-0.5 rounded">
                            {device.area_code}
                          </span>
                        )}
                      </div>
                    )}
                    {device.device_ip && (
                      <div className="flex items-center gap-2 text-xs text-[#464555]">
                        <Server size={12} className="text-[#777587] flex-shrink-0" />
                        <span className="font-mono">{device.device_ip}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-[#777587] pt-1">
                      <span>Last seen:</span>
                      <span className={`font-semibold ml-0.5 ${online ? 'text-emerald-600' : 'text-[#464555]'}`}>
                        {timeAgo(device.last_seen)}
                      </span>
                    </div>
                    {/* Last sync status */}
                    {device.last_sync_requested_at && (
                      <div className="flex items-center gap-1.5 pt-0.5">
                        <History size={11} className="text-[#777587] flex-shrink-0" />
                        <span className="text-[0.68rem] text-[#777587]">
                          Last sync: {timeAgo(device.last_sync_requested_at)}
                        </span>
                        {device.last_sync_status === 'requested' && (
                          <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            Waiting for device…
                          </span>
                        )}
                        {device.last_sync_status === 'syncing' && (
                          <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse inline-block" />
                            Syncing…
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer actions */}
                <div className="flex items-center px-4 py-3 border-t border-[#f0f3ff] bg-[#f9f9ff] gap-2">
                  <button
                    onClick={() => navigate(`/biometric/logs?device=${device.serial_number}`)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] hover:bg-[#f0f3ff] transition-colors">
                    <Eye size={12} /> View Logs
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => setDeleteTarget(device)}
                      className="flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold text-red-500 hover:bg-red-50 transition-colors"
                      title="Remove device">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {regOpen && (
        <RegisterDeviceModal open onClose={() => setRegOpen(false)} branches={branches} />
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="Remove Device"
        message={`Remove "${deleteTarget?.device_name}" (${deleteTarget?.serial_number}) from the system? This will also remove it from the IP allowlist.`}
        confirmLabel={deleteMut.isPending ? 'Removing…' : 'Remove'}
        variant="danger"
        onConfirm={() => deleteMut.mutate(deleteTarget.id)}
        onCancel={() => !deleteMut.isPending && setDeleteTarget(null)}
      />
    </div>
  );
}
