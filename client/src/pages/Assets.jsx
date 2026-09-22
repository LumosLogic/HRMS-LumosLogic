import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Monitor, Package, Smartphone, Tablet, Headphones, CreditCard, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useBranch } from '@/context/BranchContext';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ConfirmModal } from '@/components/ui/ConfirmModal';
import { Avatar } from '@/components/ui/Avatar';

const CATEGORIES = ['laptop','phone','tablet','monitor','keyboard','mouse','headset','access_card','vehicle','other'];
const CONDITIONS  = ['new','good','fair','poor'];

const STATUS_CFG = {
  available: { cls: 'badge-approved',  dot: 'bg-emerald-500', label: 'Available' },
  assigned:  { cls: 'badge-pending',   dot: 'bg-amber-500',   label: 'Assigned'  },
  in_repair: { cls: 'badge-rejected',  dot: 'bg-rose-500',    label: 'In Repair' },
  retired:   { cls: 'badge-cancelled', dot: 'bg-[#c7c4d8]',   label: 'Retired'   },
};

const CAT_ICONS = {
  laptop: Monitor, phone: Smartphone, tablet: Tablet, headset: Headphones,
  access_card: CreditCard,
};

function AssetModal({ open, onClose, asset, employees, allAssets = [] }) {
  const toast  = useToast();
  const qc     = useQueryClient();
  const isEdit = !!asset;
  const empty  = { asset_tag: '', name: '', category: 'laptop', brand: '', model: '', serial_number: '', condition: 'good', status: 'available', assigned_to: '', notes: '' };
  const [form,   setForm]   = useState(() => {
    if (isEdit) {
      // BUG_189/190: strip 'assigned_user' (the nested join object from GET)
      // before spreading — it is NOT a writable column on the assets table
      const { assigned_user: _au, ...rest } = asset;
      return {
        ...rest,
        // Normalise nulls → empty strings so React controlled inputs don't warn
        asset_tag:     rest.asset_tag     || '',
        name:          rest.name          || '',
        brand:         rest.brand         || '',
        model:         rest.model         || '',
        serial_number: rest.serial_number || '',
        notes:         rest.notes         || '',
        assigned_to:   rest.assigned_to   || '',
      };
    }
    return empty;
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    // clear the field's error as user types
    if (errors[k]) setErrors(p => ({ ...p, [k]: '' }));
  };

  const mut = useMutation({
    mutationFn: () => isEdit ? apiPut(`/assets/${asset.id}`, form) : apiPost('/assets', form),
    onSuccess: () => { toast(isEdit ? 'Asset updated!' : 'Asset added!', 'success'); qc.invalidateQueries({ queryKey: ['assets'] }); qc.invalidateQueries({ queryKey: ['assets-all'] }); onClose(); },
    onError: e => toast(e.message, 'error'),
  });

  function validate() {
    const errs = {};
    const tag = form.asset_tag.trim();
    const sn  = (form.serial_number || '').trim();

    if (!tag) {
      errs.asset_tag = 'Asset tag is required.';
    } else {
      const dup = allAssets.find(a => a.asset_tag === tag && (!asset || String(a.id) !== String(asset.id)));
      if (dup) errs.asset_tag = `Asset tag '${tag}' is already in use.`;
    }

    if (!form.name.trim()) errs.name = 'Name is required.';

    if (sn) {
      const dup = allAssets.find(a => (a.serial_number || '') === sn && (!asset || String(a.id) !== String(asset.id)));
      if (dup) errs.serial_number = `Serial number '${sn}' is already registered to another asset.`;
    }

    if (form.status === 'assigned' && !form.assigned_to) {
      errs.assigned_to = 'Select an employee to assign this asset to.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit Asset' : 'Add Asset'} size="lg"
      footer={
        <div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { if (validate()) mut.mutate(); }} disabled={mut.isPending}>
            {mut.isPending ? <><span className="spinner w-4 h-4" />Saving…</> : 'Save Asset'}
          </button>
        </div>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Asset Tag *</label>
            <input className={`form-control ${errors.asset_tag ? 'border-rose-400' : ''}`} placeholder="ASSET-001"
              value={form.asset_tag} onChange={e => set('asset_tag', e.target.value)} />
            {errors.asset_tag && <p className="text-xs text-rose-500 mt-1">{errors.asset_tag}</p>}
          </div>
          <div>
            <label className="form-label">Name *</label>
            <input className={`form-control ${errors.name ? 'border-rose-400' : ''}`} placeholder="MacBook Pro 14"
              value={form.name} onChange={e => set('name', e.target.value)} />
            {errors.name && <p className="text-xs text-rose-500 mt-1">{errors.name}</p>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div><label className="form-label">Category</label><select className="form-control" value={form.category} onChange={e => set('category', e.target.value)}>{CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}</select></div>
          <div><label className="form-label">Brand</label><input className="form-control" placeholder="Apple" value={form.brand} onChange={e => set('brand', e.target.value)} /></div>
          <div><label className="form-label">Model</label><input className="form-control" placeholder="MNW83HN/A" value={form.model} onChange={e => set('model', e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="form-label">
              Serial Number
              <span className="ml-1 font-normal text-[#777587] normal-case tracking-normal">(unique if provided)</span>
            </label>
            <input className={`form-control ${errors.serial_number ? 'border-rose-400' : ''}`}
              value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
            {errors.serial_number && <p className="text-xs text-rose-500 mt-1">{errors.serial_number}</p>}
          </div>
          <div><label className="form-label">Condition</label><select className="form-control" value={form.condition} onChange={e => set('condition', e.target.value)}>{CONDITIONS.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}</select></div>
          <div><label className="form-label">Status</label><select className="form-control" value={form.status} onChange={e => { set('status', e.target.value); if (e.target.value !== 'assigned') set('assigned_to', ''); }}><option value="available">Available</option><option value="assigned">Assigned</option><option value="in_repair">In Repair</option><option value="retired">Retired</option></select></div>
        </div>
        {form.status === 'assigned' && (
          <div>
            <label className="form-label">Assigned To *</label>
            <select className={`form-control ${errors.assigned_to ? 'border-rose-400' : ''}`}
              value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
              <option value="">— Select employee —</option>
              {(employees || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            {errors.assigned_to && <p className="text-xs text-rose-500 mt-1">{errors.assigned_to}</p>}
          </div>
        )}
        <div><label className="form-label">Notes</label><textarea className="form-control" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function Assets() {
  const { isAdmin, isEmployee }  = useAuth();
  const { selectedBranchId } = useBranch();
  const wrap = '';
  const toast        = useToast();
  const qc           = useQueryClient();
  const [addOpen,    setAddOpen]    = useState(false);
  const [editAsset,  setEditAsset]  = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [filter,     setFilter]     = useState('all');

  const { data: _aData, isLoading } = useQuery({ queryKey: ['assets', filter, selectedBranchId], queryFn: () => apiGet('/assets', filter !== 'all' ? { status: filter } : {}) });
  // Unfiltered list used for client-side duplicate validation in the modal
  const { data: _allAData }         = useQuery({ queryKey: ['assets-all', selectedBranchId], queryFn: () => apiGet('/assets'), staleTime: 30000 });
  const { data: _eData }            = useQuery({ queryKey: ['employees', 'all', selectedBranchId], queryFn: () => apiGet('/employees'), enabled: isAdmin });
  const assets    = Array.isArray(_aData)    ? _aData    : [];
  const allAssets = Array.isArray(_allAData) ? _allAData : [];
  const employees = Array.isArray(_eData)    ? _eData    : [];

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/assets/${id}`),
    onSuccess: () => { toast('Asset deleted', 'warning'); qc.invalidateQueries({ queryKey: ['assets'] }); },
    onError: e => toast(e.message, 'error'),
  });

  const counts = { available: assets.filter(a => a.status === 'available').length, assigned: assets.filter(a => a.status === 'assigned').length, in_repair: assets.filter(a => a.status === 'in_repair').length };

  return (
    <div className={wrap}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Asset Management</h1>
          <p className="page-subtitle">{assets.length} asset{assets.length !== 1 ? 's' : ''} · track company-issued equipment</p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setAddOpen(true)}><Plus size={16} />Add Asset</button>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Assets',  value: assets.length,         color: 'from-[#f0f3ff] to-[#e7eefe]',    top: '#3525cd', text: 'text-[#3525cd]' },
          { label: 'Available',     value: counts.available,      color: 'from-emerald-50 to-emerald-100',  top: '#10B981', text: 'text-emerald-700' },
          { label: 'Assigned',      value: counts.assigned,       color: 'from-amber-50 to-amber-100',      top: '#F59E0B', text: 'text-amber-700' },
          { label: 'In Repair',     value: counts.in_repair,      color: 'from-rose-50 to-rose-100',        top: '#EF4444', text: 'text-rose-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-5 bg-gradient-to-br ${s.color} border border-[#c7c4d8] shadow-card relative overflow-hidden`}>
            <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ background: s.top }} />
            <div className={`text-3xl font-black leading-none ${s.text}`}>{s.value}</div>
            <div className="text-[0.7rem] font-bold uppercase tracking-wider text-[#777587] mt-1.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap mb-6">
        {['all', 'available', 'assigned', 'in_repair', 'retired'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full text-xs font-bold capitalize border transition-all ${filter === f ? 'bg-[#3525cd] text-white border-[#3525cd] shadow-sm' : 'bg-white text-[#464555] border-[#c7c4d8] hover:border-[#3525cd]/40'}`}>
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading assets…</div>
      ) : assets.length === 0 ? (
        <div className="empty-state">
          <Package size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
          <p className="font-semibold text-[#464555] mb-1">No assets found</p>
          <p className="text-sm">{filter !== 'all' ? `No ${filter.replace('_', ' ')} assets` : 'Start tracking company equipment by adding assets'}</p>
          {isAdmin && filter === 'all' && <button className="btn btn-primary mt-4" onClick={() => setAddOpen(true)}><Plus size={14} />Add First Asset</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {assets.map(a => {
            const cfg     = STATUS_CFG[a.status] || STATUS_CFG.available;
            const CatIcon = CAT_ICONS[a.category] || Package;
            return (
              <div key={a.id} className="card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200 overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-[#f0f3ff] flex items-center justify-center">
                      <CatIcon size={18} className="text-[#3525cd]" />
                    </div>
                    <span className={`badge ${cfg.cls}`}>{cfg.label}</span>
                  </div>
                  <div className="font-black text-[#151c27] truncate">{a.name}</div>
                  <div className="text-xs text-[#777587] mt-0.5 font-mono">{a.asset_tag}</div>
                  {(a.brand || a.model) && <div className="text-xs text-[#464555] mt-1">{[a.brand, a.model].filter(Boolean).join(' ')}</div>}

                  {a.assigned_user && (
                    <div className="mt-3 flex items-center gap-2 pt-3 border-t border-[#f0f3ff]">
                      <Avatar name={a.assigned_user.name} color={a.assigned_user.avatar_color} size={22} />
                      <span className="text-xs font-semibold text-[#464555] truncate">{a.assigned_user.name}</span>
                    </div>
                  )}
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2 px-4 py-3 border-t border-[#f0f3ff] bg-[#f9f9ff]">
                    <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"
                      onClick={() => setEditAsset(a)}><Pencil size={12} />Edit</button>
                    <button className="p-1.5 rounded-lg text-[#c7c4d8] hover:text-rose-500 hover:bg-rose-50 transition-colors"
                      onClick={() => setConfirmDel({ id: a.id, name: a.name })}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {addOpen   && <AssetModal open onClose={() => setAddOpen(false)} employees={employees} allAssets={allAssets} />}
      {editAsset && <AssetModal open onClose={() => setEditAsset(null)} asset={editAsset} employees={employees} allAssets={allAssets} />}
      <ConfirmModal open={!!confirmDel} title="Delete Asset" message={`Permanently delete asset "${confirmDel?.name}"?`}
        confirmLabel="Delete" onConfirm={() => { delMut.mutate(confirmDel.id); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />
    </div>
  );
}
