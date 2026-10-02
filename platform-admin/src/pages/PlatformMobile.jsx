import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Smartphone, Search, ChevronRight } from 'lucide-react';
import { paGet, paPut } from '@/lib/platformApi';

// Mobile Application Management — platform-wide control of the mobile app.
//   • The app switch / feature switches here apply to EVERY organization (a kill switch on top of per-org settings).
//   • The table shows each organization's own mobile status; per-org detail lives in Organizations → Features → Mobile App.
// Enforced server-side on every mobile request and pushed live to installed devices.

function Toggle({ enabled, onChange, disabled }) {
  return (
    <button type="button" role="switch" aria-checked={enabled} disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
        transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#3525cd]/30
        disabled:opacity-50 disabled:cursor-not-allowed ${enabled ? 'bg-[#3525cd]' : 'bg-[#c7c4d8]'}`}>
      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg
        transition duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

export default function PlatformMobile() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(null);
  const [error, setError]   = useState('');
  const [q, setQ]           = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['mobile-overview'],
    queryFn: () => paGet('/mobile/overview'),
  });

  async function save(body, key) {
    setSaving(key); setError('');
    try { await paPut('/mobile/global', body); }
    catch (e) { setError(e.message || 'Failed to save'); }
    finally { setSaving(null); qc.invalidateQueries({ queryKey: ['mobile-overview'] }); }
  }
  async function toggleOrg(org, v) {
    setSaving(`org-${org.id}`); setError('');
    try { await paPut(`/organizations/${org.id}/mobile`, { enabled: v }); qc.invalidateQueries({ queryKey: ['org-mobile', String(org.id)] }); }
    catch (e) { setError(e.message || 'Failed to save'); }
    finally { setSaving(null); qc.invalidateQueries({ queryKey: ['mobile-overview'] }); }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><div className="w-8 h-8 rounded-full border-2 border-[#e7eefe] border-t-[#3525cd] animate-spin" /></div>;
  }

  const catalog = data?.catalog || [];
  const gf = data?.globalFeatures || {};
  const appOn = data?.globalApp !== false;
  const groups = [...new Set(catalog.map(f => f.group))];
  const activeCount = catalog.filter(f => gf[f.key] !== false).length;
  const allOrgs = data?.orgs || [];
  const orgs = allOrgs.filter(o => o.name.toLowerCase().includes(q.toLowerCase()));
  const enabledOrgs = allOrgs.filter(o => o.enabled).length;
  const bulk = v => { const n = {}; catalog.forEach(f => { n[f.key] = v; }); save({ features: n }, '__bulk'); };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#3525cd]/10 flex items-center justify-center"><Smartphone size={18} className="text-[#3525cd]" /></div>
        <div>
          <h1 className="text-2xl font-black text-[#151c27] tracking-tight">Mobile App Management</h1>
          <p className="text-sm text-[#777587]">Platform-wide control of the mobile application. Changes reach installed devices immediately.</p>
        </div>
      </div>

      {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}

      <div className={`rounded-2xl border-2 p-5 flex items-center gap-4 ${appOn ? 'border-emerald-300 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/40'}`}>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${appOn ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-600'}`}><Smartphone size={20} /></div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-[#151c27]">Mobile App — All Organizations</p>
          <p className="text-xs text-[#777587] mt-0.5">
            {appOn
              ? `Available. ${enabledOrgs} of ${allOrgs.length} organizations currently have mobile access.`
              : 'Switched off for every organization. All signed-in devices are locked out and logins are blocked.'}
          </p>
        </div>
        <Toggle enabled={appOn} onChange={v => save({ enabled: v }, '__app')} disabled={saving === '__app'} />
      </div>

      <div className={appOn ? '' : 'opacity-50 pointer-events-none'}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <p className="text-sm font-bold text-[#151c27]">{activeCount} / {catalog.length} features available platform-wide</p>
          <div className="flex gap-2">
            <button onClick={() => bulk(true)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">Enable All</button>
            <button onClick={() => bulk(false)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100">Disable All</button>
          </div>
        </div>
        {groups.map(g => (
          <div key={g} className="mb-4">
            <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest mb-2">{g}</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {catalog.filter(f => f.group === g).map(f => {
                const on = gf[f.key] !== false;
                return (
                  <div key={f.key} className={`bg-white rounded-xl border p-4 flex items-center gap-3 ${on ? 'border-[#c7c4d8]' : 'border-dashed border-[#c7c4d8] opacity-70'}`}>
                    <p className="flex-1 text-sm font-bold text-[#151c27]">{f.label}</p>
                    <Toggle enabled={on} onChange={v => save({ features: { [f.key]: v } }, f.key)} disabled={saving === f.key || saving === '__bulk'} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-[#c7c4d8] overflow-hidden">
        <div className="flex items-center justify-between gap-3 flex-wrap p-4 border-b border-[#e7eefe]">
          <p className="text-sm font-bold text-[#151c27]">Organizations</p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#777587]" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search organizations"
              className="pl-8 pr-3 py-2 border border-[#c7c4d8] rounded-lg text-sm outline-none focus:border-[#3525cd]" />
          </div>
        </div>
        <div className="divide-y divide-[#f0f3ff]">
          {orgs.map(o => (
            <div key={o.id} className="flex items-center gap-4 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#151c27] truncate">{o.name}</p>
                <p className="text-xs text-[#777587]">{o.devices} device(s){o.featuresOff ? ` · ${o.featuresOff} feature(s) off` : ''}</p>
              </div>
              <span className={`text-[0.65rem] font-black px-2 py-0.5 rounded-full border uppercase ${o.enabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[#f0f3ff] text-[#777587] border-[#c7c4d8]'}`}>
                {o.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Toggle enabled={o.enabled} onChange={v => toggleOrg(o, v)} disabled={saving === `org-${o.id}`} />
              <button onClick={() => navigate(`/orgs/${o.id}`)} title="Open organization" className="text-[#777587] hover:text-[#3525cd]"><ChevronRight size={16} /></button>
            </div>
          ))}
          {orgs.length === 0 && <p className="text-sm text-[#777587] text-center py-8">No organizations found</p>}
        </div>
      </div>
    </div>
  );
}
