import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import { paGet, paPut } from '@/lib/platformApi';

// Mobile App management for one organization (new, self-contained — used as a tab in PlatformOrgDetail).
// Master switch: can this organization (and its employees) sign in to the mobile app at all.
// Feature toggles: enforced server-side on every mobile API call and pushed live to installed devices.

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

export default function MobileAppTab({ orgId }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['org-mobile', orgId],
    queryFn: () => paGet(`/organizations/${orgId}/mobile`),
    enabled: !!orgId,
  });
  const [enabled, setEnabled]   = useState(false);
  const [features, setFeatures] = useState({});
  const [saving, setSaving]     = useState(null);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (data) { setEnabled(!!data.enabled); setFeatures(data.features || {}); }
  }, [data]);

  async function save(body, key) {
    setSaving(key); setError('');
    try {
      await paPut(`/organizations/${orgId}/mobile`, body);
      qc.invalidateQueries({ queryKey: ['org-mobile', orgId] });
    } catch (e) {
      setError(e.message || 'Failed to save');
      qc.invalidateQueries({ queryKey: ['org-mobile', orgId] });
    } finally { setSaving(null); }
  }

  function toggleApp(v) { setEnabled(v); save({ enabled: v }, '__app'); }
  function toggleFeature(key, v) { setFeatures(p => ({ ...p, [key]: v })); save({ features: { [key]: v } }, key); }
  function bulk(v) {
    const next = {}; (data?.catalog || []).forEach(f => { next[f.key] = v; });
    setFeatures(next); save({ features: next }, '__bulk');
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><div className="w-8 h-8 rounded-full border-2 border-[#e7eefe] border-t-[#3525cd] animate-spin" /></div>;
  }

  const catalog = data?.catalog || [];
  const groups = [...new Set(catalog.map(f => f.group))];
  const activeCount = catalog.filter(f => features[f.key] !== false).length;

  return (
    <div className="space-y-4">
      <div className={`rounded-2xl border-2 p-5 flex items-center gap-4 ${enabled ? 'border-emerald-300 bg-emerald-50/50' : 'border-[#c7c4d8] bg-white'}`}>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-[#f0f3ff] text-[#777587]'}`}>
          <Smartphone size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-[#151c27]">Mobile App Access</p>
          <p className="text-xs text-[#777587] mt-0.5">
            {enabled
              ? 'Enabled — this organization’s users can sign in to the mobile app.'
              : 'Disabled — users see "contact platform admin" when they try to sign in, and signed-in devices are locked out immediately.'}
          </p>
          <p className="text-[0.65rem] text-[#777587] mt-1">{data?.devices ?? 0} registered device(s)</p>
        </div>
        <Toggle enabled={enabled} onChange={toggleApp} disabled={saving === '__app'} />
      </div>

      {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}

      <div className={enabled ? '' : 'opacity-50 pointer-events-none'}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <p className="text-sm font-bold text-[#151c27]">{activeCount} / {catalog.length} mobile features active</p>
          <div className="flex gap-2">
            <button onClick={() => bulk(true)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100">Enable All</button>
            <button onClick={() => bulk(false)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100">Disable All</button>
          </div>
        </div>
        {groups.map(g => (
          <div key={g} className="mb-4">
            <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-widest mb-2">{g}</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {catalog.filter(f => f.group === g).map(f => {
                const on = features[f.key] !== false;
                return (
                  <div key={f.key} className={`bg-white rounded-xl border p-4 flex items-center gap-3 ${on ? 'border-[#c7c4d8]' : 'border-dashed border-[#c7c4d8] opacity-70'}`}>
                    <p className="flex-1 text-sm font-bold text-[#151c27]">{f.label}</p>
                    <Toggle enabled={on} onChange={v => toggleFeature(f.key, v)} disabled={saving === f.key || saving === '__bulk'} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
