import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Pencil, UserCheck, Umbrella, Home, Key, Download, Plus,
  Trash2, User, Briefcase, GraduationCap, CreditCard, Shield, Calendar,
  BarChart3, Settings, Phone, Mail, MapPin, Heart, Users, FileText,
  Building2, Award, BookOpen, Activity, AlertCircle, CheckCircle2,
  ChevronDown, ChevronUp, Loader2, X, Save, Eye, EyeOff, Banknote,
  Globe, Fingerprint, Clock, AlarmClock, Timer, Coffee,
  History, TrendingUp, TrendingDown, Upload, CheckSquare, XCircle,
  FileCheck, FileClock, FileX, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useFeature } from '@/context/FeatureFlagContext';
import { useBranch } from '@/context/BranchContext';
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/Badge';
import { fmtDate, MONTHS, countWorkingDaysInRange, countLeaveDaysInRange } from '@/lib/utils';

// ─── Helpers ────────────────────────────────────────────────────────────────

function InfoRow({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#f0f3ff] last:border-0">
      {Icon && (
        <div className="w-7 h-7 rounded-lg bg-[#f0f3ff] flex items-center justify-center flex-shrink-0 mt-0.5">
          <Icon size={13} className="text-[#3525cd]" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[0.7rem] text-[#777587] font-medium">{label}</p>
        <p className="text-sm font-semibold text-[#151c27] break-words">{value || '—'}</p>
      </div>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, action }) {
  return (
    <div className="bg-white rounded-xl border border-[#c7c4d8] p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-black text-[#151c27] uppercase tracking-wider flex items-center gap-2">
          {Icon && <Icon size={14} className="text-[#3525cd]" />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function EmptyState({ icon: Icon, text, action }) {
  return (
    <div className="text-center py-8">
      <Icon size={32} className="mx-auto mb-2 text-[#c7c4d8]" />
      <p className="text-sm text-[#777587]">{text}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

function LoadingSection() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 size={24} className="animate-spin text-[#3525cd]" />
    </div>
  );
}

function AdminBtn({ onClick, label = 'Edit' }) {
  const isAdd = label.toLowerCase().startsWith('add');
  return (
    <button onClick={onClick}
      className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#c7c4d8] bg-white text-[0.7rem] font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/40 transition-all">
      {isAdd ? <Plus size={11} /> : <Pencil size={11} />} {label}
    </button>
  );
}

// ─── Address Data (country-state-city library) ────────────────────────────────
import { Country, State, City } from 'country-state-city';

const ALL_COUNTRIES = Country.getAllCountries(); // [{ isoCode, name, ... }]

function getStates(countryName) {
  const c = ALL_COUNTRIES.find(c => c.name === countryName);
  if (!c) return [];
  return State.getStatesOfCountry(c.isoCode);
}

function getCities(countryName, stateName) {
  const c = ALL_COUNTRIES.find(c => c.name === countryName);
  if (!c) return [];
  const s = State.getStatesOfCountry(c.isoCode).find(s => s.name === stateName);
  if (!s) return [];
  return City.getCitiesOfState(c.isoCode, s.isoCode);
}

const PROFICIENCY_COLORS = { beginner: 'bg-amber-100 text-amber-700', intermediate: 'bg-blue-100 text-blue-700', advanced: 'bg-emerald-100 text-emerald-700', expert: 'bg-purple-100 text-purple-700' };
const DOC_VERIFY_COLORS  = { pending: 'bg-amber-100 text-amber-700', verified: 'bg-emerald-100 text-emerald-700', rejected: 'bg-rose-100 text-rose-700' };

// ─── Tab Definitions ─────────────────────────────────────────────────────────

const TABS_ALL = [
  { id: 'overview',     label: 'Overview',     icon: BarChart3 },
  { id: 'personal',     label: 'Personal',     icon: User },
  { id: 'professional', label: 'Professional', icon: Briefcase },
  { id: 'education',    label: 'Education',    icon: GraduationCap },
  { id: 'compensation', label: 'Compensation', icon: Banknote,  adminOnly: true },
  { id: 'compliance',   label: 'Compliance',   icon: Shield,    adminOnly: true },
  { id: 'work',         label: 'Work',         icon: Clock },
  { id: 'documents',    label: 'Documents',    icon: FileText,  adminOnly: true },
  { id: 'performance',  label: 'Performance',  icon: Activity },
  { id: 'system',       label: 'System',       icon: Settings,  rootOnly: true },
];

// ─── Section: Personal Tab ───────────────────────────────────────────────────
// Uses inline editing: clicking Edit Section reveals the form within the card itself.

function PersonalTab({ empId, isAdmin }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [editSection, setEditSection] = useState(null); // 'basic'|'address'|'health' — null = view mode
  const [form, setForm]               = useState({});
  const [ecModal, setEcModal]         = useState(null); // null | record (for edit)
  const [familyModal, setFamilyModal] = useState(null); // null | record (for edit)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: personal = {}, isLoading: pLoad } = useQuery({
    queryKey: ['epv2-personal', empId],
    queryFn: () => apiGet(`/profile/${empId}/personal`),
  });
  const { data: contacts = [], isLoading: cLoad } = useQuery({
    queryKey: ['epv2-emergency', empId],
    queryFn: () => apiGet(`/profile/${empId}/emergency-contacts`),
  });
  const { data: health = {} } = useQuery({
    queryKey: ['epv2-health', empId],
    queryFn: () => apiGet(`/profile/${empId}/health`),
  });
  const { data: family = [] } = useQuery({
    queryKey: ['epv2-family', empId],
    queryFn: () => apiGet(`/profile/${empId}/family`),
  });

  const saveMut = useMutation({
    mutationFn: (body) => apiPut(`/profile/${empId}/personal`, body),
    onSuccess: () => { toast('Saved', 'success'); qc.invalidateQueries({ queryKey: ['epv2-personal', empId] }); qc.invalidateQueries({ queryKey: ['epv2-overview', empId] }); setEditSection(null); },
    onError: e => toast(e.message, 'error'),
  });
  const saveHealthMut = useMutation({
    mutationFn: (body) => apiPut(`/profile/${empId}/health`, body),
    onSuccess: () => { toast('Saved', 'success'); qc.invalidateQueries({ queryKey: ['epv2-health', empId] }); setEditSection(null); },
    onError: e => toast(e.message, 'error'),
  });
  const ecMut = useMutation({
    mutationFn: (body) => ecModal?.id ? apiPut(`/profile/${empId}/emergency-contacts/${ecModal.id}`, body) : apiPost(`/profile/${empId}/emergency-contacts`, body),
    onSuccess: () => { toast('Saved', 'success'); qc.invalidateQueries({ queryKey: ['epv2-emergency', empId] }); setEcModal(null); },
    onError: e => toast(e.message, 'error'),
  });
  const delEcMut = useMutation({
    mutationFn: (id) => apiDelete(`/profile/${empId}/emergency-contacts/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['epv2-emergency', empId] }); },
    onError: e => toast(e.message, 'error'),
  });
  const familyMut = useMutation({
    mutationFn: (body) => familyModal?.id ? apiPut(`/profile/${empId}/family/${familyModal.id}`, body) : apiPost(`/profile/${empId}/family`, body),
    onSuccess: () => { toast('Saved', 'success'); qc.invalidateQueries({ queryKey: ['epv2-family', empId] }); qc.invalidateQueries({ queryKey: ['epv2-overview', empId] }); setFamilyModal(null); },
    onError: e => toast(e.message, 'error'),
  });
  const delFamilyMut = useMutation({
    mutationFn: (id) => apiDelete(`/profile/${empId}/family/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['epv2-family', empId] }); qc.invalidateQueries({ queryKey: ['epv2-overview', empId] }); },
    onError: e => toast(e.message, 'error'),
  });

  if (pLoad) return <LoadingSection />;

  const openBasic   = () => { setForm({ ...personal }); setEditSection('basic'); };
  const openAddress = () => { setForm({ ...personal }); setEditSection('address'); };
  const openHealth  = () => { setForm({ ...health });   setEditSection('health'); };
  const cancelEdit  = () => setEditSection(null);
  const openEc     = (rec = {}) => { setForm({ contact_name: rec.contact_name || '', relationship: rec.relationship || '', mobile_number: rec.mobile_number || '', alternate_number: rec.alternate_number || '', email: rec.email || '', address: rec.address || '', is_primary: rec.is_primary || false }); setEcModal(rec); };
  const openFamily = (rec = {}) => { setForm({ relationship: rec.relationship||'', name: rec.name||'', date_of_birth: rec.date_of_birth||'', gender: rec.gender||'', occupation: rec.occupation||'', contact_number: rec.contact_number||'', dependent: rec.dependent||false }); setFamilyModal(rec); };

  const REL_ORDER = ['father','mother','spouse','child','sibling','other'];
  const groupedFamily = REL_ORDER.reduce((acc, rel) => {
    const members = family.filter(f => f.relationship === rel);
    if (members.length) acc[rel] = members;
    return acc;
  }, {});

  const InlineSaveBar = ({ onSave, onCancel, isPending }) => (
    <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#f0f3ff]">
      <button className="btn btn-outline" onClick={onCancel}>Cancel</button>
      <button className="btn btn-primary" onClick={onSave} disabled={isPending}>
        {isPending ? <><Loader2 size={13} className="animate-spin mr-1" />Saving…</> : <><Save size={13} className="mr-1" />Save</>}
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* ── Basic Information ── */}
      <SectionCard title="Basic Information" icon={User}
        action={isAdmin && editSection !== 'basic' && <AdminBtn onClick={openBasic} />}>
        {editSection === 'basic' ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="form-label">Salutation</label>
                <select className="form-control" value={form.salutation||''} onChange={e=>set('salutation',e.target.value)}>
                  <option value="">— Select —</option>
                  {['Mr.','Mrs.','Ms.','Miss','Dr.','Prof.'].map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><label className="form-label">First Name</label><input className="form-control" value={form.name||''} onChange={e=>set('name',e.target.value)}/></div>
              <div><label className="form-label">Middle Name</label><input className="form-control" value={form.middle_name||''} onChange={e=>set('middle_name',e.target.value)}/></div>
              <div><label className="form-label">Last Name</label><input className="form-control" value={form.surname||''} onChange={e=>set('surname',e.target.value)}/></div>
              <div><label className="form-label">Mobile</label><input className="form-control" type="tel" value={form.phone||''} onChange={e=>set('phone',e.target.value)}/></div>
              <div><label className="form-label">Personal Email</label><input className="form-control" type="email" value={form.personal_email||''} onChange={e=>set('personal_email',e.target.value)}/></div>
              <div><label className="form-label">Date of Birth</label><input className="form-control" type="date" value={form.date_of_birth||''} onChange={e=>set('date_of_birth',e.target.value)}/></div>
              <div><label className="form-label">Gender</label>
                <select className="form-control" value={form.gender||''} onChange={e=>set('gender',e.target.value)}>
                  <option value="">— Select —</option>
                  {['Male','Female','Other','Prefer not to say'].map(g=><option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div><label className="form-label">Blood Group</label>
                <select className="form-control" value={form.blood_group||''} onChange={e=>set('blood_group',e.target.value)}>
                  <option value="">— Select —</option>
                  {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b=><option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div><label className="form-label">Marital Status</label>
                <select className="form-control" value={form.marital_status||''} onChange={e=>set('marital_status',e.target.value)}>
                  <option value="">— Select —</option>
                  {['Single','Married','Divorced','Widowed','Separated'].map(m=><option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div><label className="form-label">Nationality</label>
                <input className="form-control" list="nationality-list" value={form.nationality||''} onChange={e=>set('nationality',e.target.value)}/>
                <datalist id="nationality-list">{['Indian','American','British','Canadian','Australian','Other'].map(n=><option key={n} value={n}/>)}</datalist>
              </div>
              <div><label className="form-label">Religion</label>
                <select className="form-control" value={form.religion||''} onChange={e=>set('religion',e.target.value)}>
                  <option value="">— Select —</option>
                  {['Hindu','Muslim','Christian','Sikh','Buddhist','Jain','Parsi','Jewish','Other'].map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div><label className="form-label">Citizenship</label><input className="form-control" value={form.citizenship||''} onChange={e=>set('citizenship',e.target.value)}/></div>
              <div><label className="form-label">Height (cm)</label><input className="form-control" type="number" min="0" step="0.1" value={form.height||''} onChange={e=>set('height',e.target.value)}/></div>
              <div><label className="form-label">Weight (kg)</label><input className="form-control" type="number" min="0" step="0.1" value={form.weight||''} onChange={e=>set('weight',e.target.value)}/></div>
            </div>
            <InlineSaveBar onSave={() => saveMut.mutate(form)} onCancel={cancelEdit} isPending={saveMut.isPending} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <InfoRow label="Full Name" value={[personal.salutation, personal.name, personal.middle_name, personal.surname].filter(Boolean).join(' ')} icon={User} />
            <InfoRow label="Date of Birth" value={personal.date_of_birth ? fmtDate(personal.date_of_birth) : null} />
            <InfoRow label="Gender" value={personal.gender} />
            <InfoRow label="Blood Group" value={personal.blood_group} icon={Heart} />
            <InfoRow label="Marital Status" value={personal.marital_status} />
            <InfoRow label="Nationality" value={personal.nationality} />
            <InfoRow label="Religion" value={personal.religion} />
            <InfoRow label="Citizenship" value={personal.citizenship} icon={Globe} />
            <InfoRow label="Height (cm)" value={personal.height} />
            <InfoRow label="Weight (kg)" value={personal.weight} />
            <InfoRow label="Company Email" value={personal.email} icon={Mail} />
            <InfoRow label="Personal Email" value={personal.personal_email} icon={Mail} />
            <InfoRow label="Mobile" value={personal.phone} icon={Phone} />
          </div>
        )}
      </SectionCard>

      {/* ── Addresses ── */}
      <SectionCard title="Addresses" icon={MapPin}
        action={isAdmin && editSection !== 'address' && <AdminBtn onClick={openAddress} />}>
        {editSection === 'address' ? (
          <div className="space-y-4">
            <p className="text-xs font-black text-[#777587] uppercase tracking-wider">Current Address</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="form-label">Address Line 1</label><input className="form-control" value={form.current_address_line1||''} onChange={e=>set('current_address_line1',e.target.value)}/></div>
              <div><label className="form-label">Address Line 2</label><input className="form-control" value={form.current_address_line2||''} onChange={e=>set('current_address_line2',e.target.value)}/></div>
              <div><label className="form-label">Country</label>
                <select className="form-control" value={form.current_country||''} onChange={e=>{set('current_country',e.target.value); set('current_state',''); set('current_city','');}}>
                  <option value="">— Select Country —</option>
                  {ALL_COUNTRIES.map(c=><option key={c.isoCode} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">State / Province</label>
                {form.current_country ? (
                  <select className="form-control" value={form.current_state||''} onChange={e=>{set('current_state',e.target.value); set('current_city','');}}>
                    <option value="">— Select State —</option>
                    {getStates(form.current_country).map(s=><option key={s.isoCode} value={s.name}>{s.name}</option>)}
                  </select>
                ) : <input className="form-control" placeholder="Select country first" disabled />}
              </div>
              <div><label className="form-label">City</label>
                {form.current_state ? (
                  <select className="form-control" value={form.current_city||''} onChange={e=>set('current_city',e.target.value)}>
                    <option value="">— Select City —</option>
                    {getCities(form.current_country, form.current_state).map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
                    <option value="__other__">Other (type below)</option>
                  </select>
                ) : <input className="form-control" placeholder="Select state first" value={form.current_city||''} onChange={e=>set('current_city',e.target.value)} />}
                {form.current_city === '__other__' && <input className="form-control mt-1" placeholder="Enter city name" onChange={e=>set('current_city',e.target.value)}/>}
              </div>
              <div><label className="form-label">Postal Code</label><input className="form-control" value={form.current_postal_code||''} onChange={e=>set('current_postal_code',e.target.value)}/></div>
            </div>
            <p className="text-xs font-black text-[#777587] uppercase tracking-wider mt-2">Permanent Address</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="form-label">Address</label><input className="form-control" value={form.permanent_address||''} onChange={e=>set('permanent_address',e.target.value)}/></div>
              <div><label className="form-label">Country</label>
                <select className="form-control" value={form.permanent_country||''} onChange={e=>{set('permanent_country',e.target.value); set('permanent_state',''); set('permanent_city','');}}>
                  <option value="">— Select Country —</option>
                  {ALL_COUNTRIES.map(c=><option key={c.isoCode} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">State / Province</label>
                {form.permanent_country ? (
                  <select className="form-control" value={form.permanent_state||''} onChange={e=>{set('permanent_state',e.target.value); set('permanent_city','');}}>
                    <option value="">— Select State —</option>
                    {getStates(form.permanent_country).map(s=><option key={s.isoCode} value={s.name}>{s.name}</option>)}
                  </select>
                ) : <input className="form-control" placeholder="Select country first" disabled />}
              </div>
              <div><label className="form-label">City</label>
                {form.permanent_state ? (
                  <select className="form-control" value={form.permanent_city||''} onChange={e=>set('permanent_city',e.target.value)}>
                    <option value="">— Select City —</option>
                    {getCities(form.permanent_country, form.permanent_state).map(c=><option key={c.name} value={c.name}>{c.name}</option>)}
                    <option value="__other__">Other (type below)</option>
                  </select>
                ) : <input className="form-control" placeholder="Select state first" value={form.permanent_city||''} onChange={e=>set('permanent_city',e.target.value)} />}
                {form.permanent_city === '__other__' && <input className="form-control mt-1" placeholder="Enter city name" onChange={e=>set('permanent_city',e.target.value)}/>}
              </div>
              <div><label className="form-label">Postal Code</label><input className="form-control" value={form.permanent_postal_code||''} onChange={e=>set('permanent_postal_code',e.target.value)}/></div>
            </div>
            <InlineSaveBar onSave={() => saveMut.mutate(form)} onCancel={cancelEdit} isPending={saveMut.isPending} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider mb-2">Current</p>
              <InfoRow label="Address Line 1" value={personal.current_address_line1} />
              <InfoRow label="Address Line 2" value={personal.current_address_line2} />
              <InfoRow label="City" value={personal.current_city} />
              <InfoRow label="State" value={personal.current_state} />
              <InfoRow label="Country" value={personal.current_country} />
              <InfoRow label="Postal Code" value={personal.current_postal_code} />
            </div>
            <div>
              <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider mb-2">Permanent</p>
              <InfoRow label="Address" value={personal.permanent_address} />
              <InfoRow label="City" value={personal.permanent_city} />
              <InfoRow label="State" value={personal.permanent_state} />
              <InfoRow label="Country" value={personal.permanent_country} />
              <InfoRow label="Postal Code" value={personal.permanent_postal_code} />
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Health Information ── */}
      <SectionCard title="Health Information" icon={Heart}
        action={isAdmin && editSection !== 'health' && <AdminBtn onClick={openHealth} />}>
        {editSection === 'health' ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="form-label">Blood Group</label>
                <select className="form-control" value={form.blood_group||''} onChange={e=>set('blood_group',e.target.value)}>
                  <option value="">— Select —</option>
                  {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b=><option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              {[['allergies','Allergies'],['medical_conditions','Medical Conditions'],['disabilities','Disabilities'],['emergency_medical_notes','Emergency Notes'],['health_insurance_provider','Insurance Provider'],['health_insurance_number','Insurance Number'],['health_insurance_expiry','Insurance Expiry','date']].map(([k,l,t])=>(
                <div key={k}><label className="form-label">{l}</label><input className="form-control" type={t||'text'} value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
              ))}
            </div>
            <InlineSaveBar onSave={() => saveHealthMut.mutate(form)} onCancel={cancelEdit} isPending={saveHealthMut.isPending} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <InfoRow label="Blood Group" value={health.blood_group} />
            <InfoRow label="Allergies" value={health.allergies} />
            <InfoRow label="Medical Conditions" value={health.medical_conditions} />
            <InfoRow label="Disabilities" value={health.disabilities} />
            {isAdmin && <InfoRow label="Insurance Provider" value={health.health_insurance_provider} />}
            {isAdmin && <InfoRow label="Insurance Number" value={health.health_insurance_number} />}
            <InfoRow label="Emergency Notes" value={health.emergency_medical_notes} />
          </div>
        )}
      </SectionCard>

      {/* ── Emergency Contacts ── */}
      <SectionCard title="Emergency Contacts" icon={AlertCircle}
        action={isAdmin && <AdminBtn onClick={() => openEc()} label="Add" />}>
        {cLoad ? <LoadingSection /> : contacts.length === 0
          ? <EmptyState icon={AlertCircle} text="No emergency contacts added" />
          : contacts.map(c => (
            <div key={c.id} className="py-3 border-b border-[#f0f3ff] last:border-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-[#151c27]">{c.contact_name} {c.is_primary && <span className="ml-1 text-[0.6rem] bg-[#3525cd] text-white px-1.5 py-0.5 rounded-full">Primary</span>}</p>
                  <p className="text-xs text-[#777587]">{c.relationship}</p>
                  <p className="text-xs text-[#464555] mt-0.5">{c.mobile_number}</p>
                  {c.email && <p className="text-xs text-[#464555]">{c.email}</p>}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button onClick={() => openEc(c)} className="p-1.5 rounded hover:bg-[#f0f3ff] text-[#3525cd]"><Pencil size={12} /></button>
                    <button onClick={() => delEcMut.mutate(c.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12} /></button>
                  </div>
                )}
              </div>
            </div>
          ))
        }
      </SectionCard>

      {/* ── Family Members ── */}
      <SectionCard title="Family Members" icon={Users}
        action={isAdmin && <AdminBtn onClick={() => openFamily()} label="Add" />}>
        {family.length === 0 ? <EmptyState icon={Users} text="No family members added" /> : (
          <div className="space-y-4">
            {Object.entries(groupedFamily).map(([rel, members]) => (
              <div key={rel}>
                <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider mb-2">
                  {rel === 'child' ? 'Children' : rel.charAt(0).toUpperCase() + rel.slice(1)}
                </p>
                {members.map(m => (
                  <div key={m.id} className="flex items-start justify-between py-2.5 border-b border-[#f0f3ff] last:border-0">
                    <div>
                      <p className="text-sm font-bold text-[#151c27]">{m.name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {m.date_of_birth && <span className="text-xs text-[#777587]">{fmtDate(m.date_of_birth)}</span>}
                        {m.occupation    && <span className="text-xs text-[#777587]">{m.occupation}</span>}
                        {m.contact_number && <span className="text-xs text-[#464555]">{m.contact_number}</span>}
                        {m.dependent && <span className="text-[0.6rem] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">Dependent</span>}
                      </div>
                    </div>
                    {isAdmin && (
                      <div className="flex gap-1">
                        <button onClick={() => openFamily(m)} className="p-1.5 rounded hover:bg-[#f0f3ff] text-[#3525cd]"><Pencil size={12}/></button>
                        <button onClick={() => delFamilyMut.mutate(m.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Family Member Modal */}
      <Modal open={familyModal !== null} onClose={() => setFamilyModal(null)}
        title={familyModal?.id ? 'Edit Family Member' : 'Add Family Member'} size="md"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setFamilyModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => familyMut.mutate(form)} disabled={familyMut.isPending}>{familyMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="form-label">Relationship *</label>
            <select className="form-control" value={form.relationship||''} onChange={e=>set('relationship',e.target.value)}>
              <option value="">— Select —</option>
              {['father','mother','spouse','child','sibling','other'].map(r=>(
                <option key={r} value={r}>{r.charAt(0).toUpperCase()+r.slice(1)}</option>
              ))}
            </select>
          </div>
          {[['name','Full Name *'],['date_of_birth','Date of Birth','date'],['occupation','Occupation'],['contact_number','Contact Number']].map(([k,l,t])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" type={t||'text'} value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
          <div><label className="form-label">Gender</label>
            <select className="form-control" value={form.gender||''} onChange={e=>set('gender',e.target.value)}>
              <option value="">— Select —</option>
              {['Male','Female','Other','Prefer not to say'].map(g=><option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm col-span-2">
            <input type="checkbox" checked={form.dependent||false} onChange={e=>set('dependent',e.target.checked)} className="accent-[#3525cd]"/>
            Financially dependent
          </label>
        </div>
      </Modal>

      {/* Emergency Contact Modal */}
      <Modal open={ecModal !== null} onClose={() => setEcModal(null)} title={ecModal?.id ? 'Edit Emergency Contact' : 'Add Emergency Contact'} size="md"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setEcModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => ecMut.mutate(form)} disabled={ecMut.isPending}>{ecMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        {!ecModal?.id && family.length > 0 && (
          <div className="mb-4 p-3 bg-[#f0f3ff] border border-[#c7c4d8] rounded-lg flex items-center gap-3">
            <Users size={15} className="text-[#3525cd] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-[#3525cd] mb-1">Import from Family Members</p>
              <select className="form-control text-sm" defaultValue="" onChange={e => {
                const member = family.find(f => String(f.id) === e.target.value);
                if (!member) return;
                setForm(prev => ({ ...prev, contact_name: member.name||'', relationship: member.relationship||'', mobile_number: member.contact_number||'' }));
              }}>
                <option value="">— Select a family member —</option>
                {family.map(m => <option key={m.id} value={m.id}>{m.name}{m.relationship ? ` (${m.relationship})` : ''}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          {[['contact_name','Name *'],['relationship','Relationship'],['mobile_number','Mobile *'],['alternate_number','Alternate Number'],['email','Email'],['address','Address']].map(([k,l])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
          <div className="flex items-center gap-2 col-span-2">
            <input type="checkbox" id="ecPrimary" checked={form.is_primary||false} onChange={e=>set('is_primary',e.target.checked)} className="accent-[#3525cd]"/>
            <label htmlFor="ecPrimary" className="text-sm text-[#464555]">Primary contact</label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Section: Professional Tab ───────────────────────────────────────────────

// DOW index → short name (0=Sun … 6=Sat)
const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function deriveWeeklyOff(weeklyOffDay, workSchedule) {
  if (weeklyOffDay) return weeklyOffDay; // employee-specific override wins
  // Fall back to org-level work schedule: off days = days NOT in work_days
  const workDayNums = workSchedule?.work_days
    ? workSchedule.work_days.split(',').map(Number)
    : [1, 2, 3, 4, 5]; // default Mon–Fri
  const offDays = [0,1,2,3,4,5,6].filter(d => !workDayNums.includes(d));
  if (!offDays.length) return null;
  return offDays.map(d => DOW_SHORT[d]).join(', ') + ' (Company Default)';
}

function ProfessionalTab({ empId, isAdmin, onEdit, emp }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { selectedBranchId } = useBranch();
  const branchingEnabled = useFeature('branches');
  const [skillModal, setSkillModal]             = useState(null);
  const [expModal, setExpModal]                 = useState(null);
  const [orgStructEditing, setOrgStructEditing] = useState(false);
  const [empDetailsEditing, setEmpDetailsEditing] = useState(false);
  const [form, setForm]                         = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: branches = [] } = useQuery({
    queryKey: ['branches'],
    queryFn: () => apiGet('/branches'),
    staleTime: 5 * 60 * 1000,
  });
  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => apiGet('/departments'),
    staleTime: 5 * 60 * 1000,
  });

  const { data: allEmployees = [] } = useQuery({
    queryKey: ['employees-list', selectedBranchId],
    queryFn: () => apiGet('/employees'),
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin,
  });

  const orgStructMut = useMutation({
    mutationFn: (body) => apiPut(`/profile/${empId}/professional`, body),
    onSuccess: () => {
      toast('Organisation structure updated', 'success');
      qc.invalidateQueries({ queryKey: ['epv2-professional', empId] });
      qc.invalidateQueries({ queryKey: ['epv2-overview',     empId] });
      setOrgStructEditing(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const empDetailsMut = useMutation({
    mutationFn: (body) => apiPut(`/profile/${empId}/professional`, body),
    onSuccess: () => {
      toast('Employment details updated', 'success');
      qc.invalidateQueries({ queryKey: ['epv2-professional', empId] });
      qc.invalidateQueries({ queryKey: ['epv2-overview',     empId] });
      setEmpDetailsEditing(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const { data: prof = {}, isLoading } = useQuery({
    queryKey: ['epv2-professional', empId],
    queryFn: () => apiGet(`/profile/${empId}/professional`),
  });

  // Fetch org work schedule to derive weekly-off fallback (cached globally)
  const { data: workSchedule } = useQuery({
    queryKey: ['work-schedule'],
    queryFn:  () => apiGet('/settings/schedule'),
    staleTime: 5 * 60 * 1000,
  });
  const { data: skills = [] } = useQuery({
    queryKey: ['epv2-skills', empId],
    queryFn: () => apiGet(`/profile/${empId}/skills`),
  });
  const { data: experiences = [] } = useQuery({
    queryKey: ['epv2-experience', empId],
    queryFn: () => apiGet(`/profile/${empId}/experience`),
  });

  const skillMut = useMutation({
    mutationFn: (body) => skillModal?.id ? apiPut(`/profile/${empId}/skills/${skillModal.id}`, body) : apiPost(`/profile/${empId}/skills`, body),
    onSuccess: () => { toast('Saved', 'success'); qc.invalidateQueries({ queryKey: ['epv2-skills', empId] }); qc.invalidateQueries({ queryKey: ['epv2-overview', empId] }); setSkillModal(null); },
    onError: e => toast(e.message, 'error'),
  });
  const delSkillMut = useMutation({
    mutationFn: (id) => apiDelete(`/profile/${empId}/skills/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['epv2-skills', empId] }); qc.invalidateQueries({ queryKey: ['epv2-overview', empId] }); },
    onError: e => toast(e.message, 'error'),
  });
  const expMut = useMutation({
    mutationFn: (body) => expModal?.id ? apiPut(`/profile/${empId}/experience/${expModal.id}`, body) : apiPost(`/profile/${empId}/experience`, body),
    onSuccess: () => {
      toast('Saved', 'success');
      qc.invalidateQueries({ queryKey: ['epv2-experience', empId] });
      qc.invalidateQueries({ queryKey: ['epv2-overview',   empId] });
      setExpModal(null);
    },
    onError: e => toast(e.message, 'error'),
  });
  const delExpMut = useMutation({
    mutationFn: (id) => apiDelete(`/profile/${empId}/experience/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epv2-experience', empId] });
      qc.invalidateQueries({ queryKey: ['epv2-overview',   empId] });
    },
    onError: e => toast(e.message, 'error'),
  });

  const openOrgStruct = () => {
    setForm({
      joining_date:       prof.joining_date?.slice(0, 10) || '',
      branch_id:          prof.branch_id || '',
      location:           prof.location  || '',
      weekly_off_day:     prof.weekly_off_day     || '',
      work_hours_per_day: prof.work_hours_per_day || 8,
    });
    setOrgStructEditing(true);
  };

  const openSkill = (rec = {}) => { setForm({ skill_name: rec.skill_name||'', skill_category: rec.skill_category||'technical', proficiency_level: rec.proficiency_level||'intermediate', years_of_experience: rec.years_of_experience||'', can_read: rec.can_read||false, can_write: rec.can_write||false, can_speak: rec.can_speak||false }); setSkillModal(rec); };
  const openExp   = (rec = {}) => { setForm({ company_name: rec.company_name||'', designation: rec.designation||'', industry: rec.industry||'', department: rec.department||'', employment_type: rec.employment_type||'', start_date: rec.start_date||'', end_date: rec.end_date||'', last_salary: rec.last_salary||'', manager_name: rec.manager_name||'', reason_leaving: rec.reason_leaving||'' }); setExpModal(rec); };

  if (isLoading) return <LoadingSection />;

  const techSkills = skills.filter(s => s.skill_category === 'technical');
  const softSkills = skills.filter(s => s.skill_category === 'soft');
  const languages  = skills.filter(s => s.skill_category === 'language');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* Employment Details — inline editing */}
      <SectionCard title="Employment Details" icon={Briefcase}
        action={isAdmin && !empDetailsEditing && <AdminBtn onClick={() => {
          setForm({
            employee_id:     prof.employee_id     || '',
            department_ids:  prof.departments?.map(d => d.id) || [],
            position:        prof.position        || '',
            grade:           prof.grade           || '',
            pay_cadre:       prof.pay_cadre       || '',
            cost_centre:     prof.cost_centre     || '',
            division:        prof.division        || '',
            sub_division:    prof.sub_division    || '',
            employment_type: prof.employment_type || '',
            work_mode:       prof.work_mode       || '',
            employee_status: prof.employee_status || '',
            reporting_to:    prof.reporting_to    || '',
            hod_id:          prof.hod_id          || '',
            confirmation_date: prof.confirmation_date?.slice(0,10) || '',
            probation_applicable: prof.probation_applicable || false,
            probation_months:    prof.probation_months     || '',
          });
          setEmpDetailsEditing(true);
        }} />}>
        {empDetailsEditing ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="form-label">Employee ID</label><input className="form-control" value={form.employee_id||''} onChange={e=>set('employee_id',e.target.value)}/></div>
              <div><label className="form-label">Department(s)</label>
                <select className="form-control" multiple size={3} value={form.department_ids||[]} onChange={e=>set('department_ids',Array.from(e.target.selectedOptions,o=>Number(o.value)))}>
                  {departments.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <p className="text-[0.65rem] text-[#777587] mt-0.5">Hold Ctrl/Cmd to select multiple</p>
              </div>
              <div><label className="form-label">Position / Title</label><input className="form-control" value={form.position||''} onChange={e=>set('position',e.target.value)}/></div>
              <div><label className="form-label">Grade</label><input className="form-control" value={form.grade||''} onChange={e=>set('grade',e.target.value)}/></div>
              <div><label className="form-label">Pay Cadre</label><input className="form-control" value={form.pay_cadre||''} onChange={e=>set('pay_cadre',e.target.value)}/></div>
              <div><label className="form-label">Cost Centre</label><input className="form-control" value={form.cost_centre||''} onChange={e=>set('cost_centre',e.target.value)}/></div>
              <div><label className="form-label">Division</label><input className="form-control" value={form.division||''} onChange={e=>set('division',e.target.value)}/></div>
              <div><label className="form-label">Sub Division</label><input className="form-control" value={form.sub_division||''} onChange={e=>set('sub_division',e.target.value)}/></div>
              <div><label className="form-label">Employment Type</label>
                <select className="form-control" value={form.employment_type||''} onChange={e=>set('employment_type',e.target.value)}>
                  <option value="">— Select —</option>
                  {[['full_time','Full Time'],['part_time','Part Time'],['contract','Contract'],['intern','Intern'],['consultant','Consultant'],['probation','Probation']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div><label className="form-label">Work Mode</label>
                <select className="form-control" value={form.work_mode||''} onChange={e=>set('work_mode',e.target.value)}>
                  <option value="">— Select —</option>
                  {[['office','Office'],['remote','Remote'],['hybrid','Hybrid'],['wfh','WFH']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div><label className="form-label">Employee Status</label>
                <select className="form-control" value={form.employee_status||''} onChange={e=>set('employee_status',e.target.value)}>
                  <option value="">— Select —</option>
                  {[['active','Active'],['probation','Probation'],['on_leave','On Leave'],['inactive','Inactive'],['resigned','Resigned'],['terminated','Terminated']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div><label className="form-label">Reporting Manager</label>
                <select className="form-control" value={form.reporting_to||''} onChange={e=>set('reporting_to',e.target.value)}>
                  <option value="">— None —</option>
                  {allEmployees.filter(e=>e.id!==empId).map(e=><option key={e.id} value={e.id}>{e.name}{e.position?` (${e.position})`:''}</option>)}
                </select>
              </div>
              <div><label className="form-label">HOD</label>
                <select className="form-control" value={form.hod_id||''} onChange={e=>set('hod_id',e.target.value)}>
                  <option value="">— None —</option>
                  {allEmployees.filter(e=>e.id!==empId).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div><label className="form-label">Confirmation Date</label><input type="date" className="form-control" value={form.confirmation_date||''} onChange={e=>set('confirmation_date',e.target.value)}/></div>
              <label className="flex items-center gap-2 text-sm col-span-2">
                <input type="checkbox" checked={form.probation_applicable||false} onChange={e=>set('probation_applicable',e.target.checked)} className="accent-[#3525cd]"/>
                Probation Applicable
              </label>
              {form.probation_applicable && (
                <div><label className="form-label">Probation Months</label><input type="number" className="form-control" min="1" max="24" value={form.probation_months||''} onChange={e=>set('probation_months',e.target.value)}/></div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#f0f3ff]">
              <button className="btn btn-outline" onClick={() => setEmpDetailsEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => empDetailsMut.mutate(form)} disabled={empDetailsMut.isPending}>
                {empDetailsMut.isPending ? <><Loader2 size={13} className="animate-spin mr-1" />Saving…</> : <><Save size={13} className="mr-1" />Save</>}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <InfoRow label="Employee ID" value={prof.employee_id || emp?.employee_id || `EMP${String(empId).padStart(3, '0')}`} />
            <InfoRow label="Department" value={prof.departments?.map(d => d.name).join(', ') || prof.department} icon={Building2} />
            <InfoRow label="Position / Title" value={prof.position} />
            <InfoRow label="Grade" value={prof.grade} />
            <InfoRow label="Pay Cadre" value={prof.pay_cadre} />
            <InfoRow label="Cost Centre" value={prof.cost_centre} />
            <InfoRow label="Division" value={prof.division} />
            <InfoRow label="Employment Type" value={prof.employment_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} />
            <InfoRow label="Work Mode" value={prof.work_mode?.replace(/\b\w/g, c => c.toUpperCase())} />
            <InfoRow label="Status" value={prof.employee_status?.replace(/\b\w/g, c => c.toUpperCase())} />
            {prof.reporting_to && <InfoRow label="Reporting Manager" value={prof.manager?.name} icon={User} />}
          </div>
        )}
      </SectionCard>

      {/* Org Structure */}
      <SectionCard title="Organisation Structure" icon={Users}
        action={isAdmin && !orgStructEditing && <AdminBtn onClick={openOrgStruct} />}>
        {orgStructEditing ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              {branchingEnabled && (
                <div className="col-span-2">
                  <label className="form-label">Branch</label>
                  <select className="form-control" value={form.branch_id || ''} onChange={e => {
                    const bId = e.target.value;
                    set('branch_id', bId);
                    const branch = branches.find(b => String(b.id) === String(bId));
                    if (branch?.location) set('location', branch.location);
                    else if (!bId) set('location', '');
                  }}>
                    <option value="">— No branch —</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.location ? ` · ${b.location}` : ''}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="form-label">Joining Date</label>
                <input type="date" className="form-control" value={form.joining_date || ''} onChange={e => set('joining_date', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Work Location</label>
                <input className="form-control" placeholder="e.g. Ahmedabad, Gujarat" value={form.location || ''} onChange={e => set('location', e.target.value)} />
              </div>
              <div>
                <label className="form-label">Weekly Off</label>
                <select className="form-control" value={form.weekly_off_day || ''} onChange={e => set('weekly_off_day', e.target.value)}>
                  <option value="">— Select —</option>
                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Work Hours/Day</label>
                <input type="number" className="form-control" min="1" max="24" value={form.work_hours_per_day || ''} onChange={e => set('work_hours_per_day', Number(e.target.value))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#f0f3ff]">
              <button className="btn btn-outline" onClick={() => setOrgStructEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => orgStructMut.mutate(form)} disabled={orgStructMut.isPending}>
                {orgStructMut.isPending ? <><Loader2 size={13} className="animate-spin mr-1" />Saving…</> : <><Save size={13} className="mr-1" />Save</>}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <InfoRow label="Joining Date" value={prof.joining_date ? fmtDate(prof.joining_date) : null} />
            <InfoRow label="HOD" value={prof.hod?.name} />
            {branchingEnabled && <InfoRow label="Branch" value={prof.branch?.name} icon={MapPin} />}
            <InfoRow label="Work Location" value={prof.location} />
            <InfoRow label="Weekly Off" value={deriveWeeklyOff(prof.weekly_off_day, workSchedule)} />
            <InfoRow label="Work Hours/Day" value={prof.work_hours_per_day ? `${prof.work_hours_per_day}h` : null} />
            {prof.probation_applicable && <InfoRow label="Probation" value={`${prof.probation_months} months`} />}
          </div>
        )}
      </SectionCard>

      {/* Skills */}
      <SectionCard title="Skills" icon={Award}
        action={isAdmin && <AdminBtn onClick={() => openSkill()} label="Add Skill" />}>
        {skills.length === 0 ? <EmptyState icon={Award} text="No skills added yet" /> : (
          <div className="space-y-4">
            {techSkills.length > 0 && (
              <div>
                <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider mb-2">Technical</p>
                <div className="flex flex-wrap gap-2">
                  {techSkills.map(s => (
                    <div key={s.id} className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e7eefe] bg-[#f9f9ff]">
                      <span className="text-xs font-semibold text-[#151c27]">{s.skill_name}</span>
                      <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${PROFICIENCY_COLORS[s.proficiency_level] || 'bg-gray-100 text-gray-600'}`}>{s.proficiency_level}</span>
                      {isAdmin && <button onClick={() => delSkillMut.mutate(s.id)} className="hidden group-hover:block text-rose-400 hover:text-rose-600"><X size={11}/></button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {softSkills.length > 0 && (
              <div>
                <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider mb-2">Soft Skills</p>
                <div className="flex flex-wrap gap-2">
                  {softSkills.map(s => (
                    <div key={s.id} className="group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#e7eefe] bg-[#f0f3ff]">
                      <span className="text-xs font-semibold text-[#3525cd]">{s.skill_name}</span>
                      {isAdmin && <button onClick={() => delSkillMut.mutate(s.id)} className="hidden group-hover:block text-rose-400"><X size={11}/></button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {languages.length > 0 && (
              <div>
                <p className="text-[0.65rem] font-black text-[#777587] uppercase tracking-wider mb-2">Languages</p>
                {languages.map(s => (
                  <div key={s.id} className="flex items-center justify-between py-1.5">
                    <span className="text-sm font-semibold text-[#151c27]">{s.skill_name}</span>
                    <div className="flex gap-2 text-[0.65rem]">
                      {s.can_read  && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">Read</span>}
                      {s.can_write && <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold">Write</span>}
                      {s.can_speak && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-bold">Speak</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Work Experience */}
      <SectionCard title="Work Experience" icon={Briefcase}
        action={isAdmin && <AdminBtn onClick={() => openExp()} label="Add" />}>
        {experiences.length === 0 ? <EmptyState icon={Briefcase} text="No experience records" /> : (
          <div className="space-y-4">
            {experiences.map(e => (
              <div key={e.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-[#151c27]">{e.designation}</p>
                    <p className="text-xs font-bold text-[#3525cd]">{e.company_name}</p>
                    <p className="text-xs text-[#777587] mt-0.5">{e.start_date ? fmtDate(e.start_date) : '—'} → {e.end_date ? fmtDate(e.end_date) : 'Present'}</p>
                    {e.industry && <p className="text-xs text-[#777587]">{e.industry}</p>}
                  </div>
                  {isAdmin && <div className="flex gap-1">
                    <button onClick={() => openExp(e)} className="p-1.5 rounded hover:bg-white text-[#3525cd]"><Pencil size={12}/></button>
                    <button onClick={() => delExpMut.mutate(e.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button>
                  </div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Skill Modal — BUG_215: validation */}
      <Modal open={skillModal !== null} onClose={() => setSkillModal(null)} title={skillModal?.id ? 'Edit Skill' : 'Add Skill'} size="md"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setSkillModal(null)}>Cancel</button><button className="btn btn-primary" disabled={skillMut.isPending} onClick={() => {
          const name = (form.skill_name || '').trim();
          if (!name) { toast('Skill Name is required.', 'error'); return; }
          if (!/[a-zA-Z]/.test(name)) { toast('Skill Name must contain at least one letter.', 'error'); return; }
          const yoe = form.years_of_experience;
          if (yoe !== '' && yoe != null && (isNaN(Number(yoe)) || Number(yoe) < 0 || Number(yoe) > 60)) { toast('Years of Experience must be between 0 and 60.', 'error'); return; }
          skillMut.mutate(form);
        }}>{skillMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="space-y-4">
          <div><label className="form-label">Skill Name *</label><input className="form-control" value={form.skill_name||''} onChange={e=>set('skill_name',e.target.value)}/></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="form-label">Category</label>
              <select className="form-control" value={form.skill_category||'technical'} onChange={e=>set('skill_category',e.target.value)}>
                {['technical','soft','language','other'].map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
              </select></div>
            <div><label className="form-label">Proficiency</label>
              <select className="form-control" value={form.proficiency_level||'intermediate'} onChange={e=>set('proficiency_level',e.target.value)}>
                {['beginner','intermediate','advanced','expert'].map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
              </select></div>
            <div><label className="form-label">Years of Experience</label><input className="form-control" type="number" value={form.years_of_experience||''} onChange={e=>set('years_of_experience',e.target.value)}/></div>
          </div>
          {form.skill_category === 'language' && (
            <div className="flex gap-4">
              {[['can_read','Read'],['can_write','Write'],['can_speak','Speak']].map(([k,l])=>(
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[k]||false} onChange={e=>set(k,e.target.checked)} className="accent-[#3525cd]"/>{l}</label>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* Experience Modal */}
      <Modal open={expModal !== null} onClose={() => setExpModal(null)} title={expModal?.id ? 'Edit Experience' : 'Add Experience'} size="lg"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setExpModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          const errs = [];
          if (!form.company_name?.trim()) { errs.push('Company Name is required.'); }
          else if (!/[a-zA-Z]/.test(form.company_name)) { errs.push('Company Name must contain at least one letter.'); }
          if (form.designation && !/[a-zA-Z]/.test(form.designation)) { errs.push('Designation must contain at least one letter.'); }
          if (form.industry && !/[a-zA-Z]/.test(form.industry)) { errs.push('Industry must contain at least one letter.'); }
          if (form.manager_name && !/[a-zA-Z]/.test(form.manager_name)) { errs.push('Manager Name must contain at least one letter.'); }
          if (form.reason_leaving && !/[a-zA-Z]/.test(form.reason_leaving)) { errs.push('Reason for Leaving must contain at least one letter.'); }
          if (form.last_salary && (isNaN(Number(form.last_salary)) || Number(form.last_salary) < 0)) { errs.push('Salary must be a positive number.'); }
          if (!form.start_date) { errs.push('Start Date is required.'); }
          if (form.start_date && form.end_date && form.end_date < form.start_date) { errs.push('End Date cannot be before Start Date.'); }
          if (errs.length > 0) { toast(errs[0], 'error'); return; }
          expMut.mutate(form);
        }} disabled={expMut.isPending}>{expMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          {[['company_name','Company Name *'],['designation','Designation'],['industry','Industry'],['department','Department'],['employment_type','Employment Type'],['start_date','Start Date','date'],['end_date','End Date','date'],['last_salary','Last Salary','number'],['manager_name','Manager Name'],['reason_leaving','Reason for Leaving']].map(([k,l,t])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" type={t||'text'} value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ─── Section: Education Tab ───────────────────────────────────────────────────

function EducationTab({ empId, isAdmin }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [eduModal,  setEduModal]  = useState(null);
  const [trainModal,setTrainModal]= useState(null);
  const [certModal, setCertModal] = useState(null);
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: education = [], isLoading } = useQuery({ queryKey: ['epv2-education', empId], queryFn: () => apiGet(`/profile/${empId}/education`) });
  const { data: training  = [] } = useQuery({ queryKey: ['epv2-training',   empId], queryFn: () => apiGet(`/profile/${empId}/training`) });
  const { data: certs     = [] } = useQuery({ queryKey: ['epv2-certs',      empId], queryFn: () => apiGet(`/profile/${empId}/certifications`) });

  const eduMut   = useMutation({ mutationFn: b => eduModal?.id  ? apiPut(`/profile/${empId}/education/${eduModal.id}`, b)    : apiPost(`/profile/${empId}/education`, b),    onSuccess: () => { toast('Saved','success'); qc.invalidateQueries({queryKey:['epv2-education',empId]}); qc.invalidateQueries({queryKey:['epv2-overview',empId]}); setEduModal(null);  }, onError: e=>toast(e.message,'error') });
  const trainMut = useMutation({ mutationFn: b => trainModal?.id? apiPut(`/profile/${empId}/training/${trainModal.id}`, b)   : apiPost(`/profile/${empId}/training`, b),     onSuccess: () => { toast('Saved','success'); qc.invalidateQueries({queryKey:['epv2-training',empId]}); setTrainModal(null);}, onError: e=>toast(e.message,'error') });
  const certMut  = useMutation({ mutationFn: b => certModal?.id ? apiPut(`/profile/${empId}/certifications/${certModal.id}`,b): apiPost(`/profile/${empId}/certifications`,b), onSuccess: () => { toast('Saved','success'); qc.invalidateQueries({queryKey:['epv2-certs',empId]});  setCertModal(null); }, onError: e=>toast(e.message,'error') });
  const delEdu   = useMutation({ mutationFn: id => apiDelete(`/profile/${empId}/education/${id}`),        onSuccess: () => { qc.invalidateQueries({queryKey:['epv2-education',empId]}); qc.invalidateQueries({queryKey:['epv2-overview',empId]}); } });
  const delTrain = useMutation({ mutationFn: id => apiDelete(`/profile/${empId}/training/${id}`),         onSuccess: () => qc.invalidateQueries({queryKey:['epv2-training',empId]}) });
  const delCert  = useMutation({ mutationFn: id => apiDelete(`/profile/${empId}/certifications/${id}`),   onSuccess: () => qc.invalidateQueries({queryKey:['epv2-certs',empId]}) });

  const openEdu   = (r={}) => { setForm({degree_level:r.degree_level||'',institution:r.institution||'',board_university:r.board_university||'',specialization:r.specialization||'',from_year:r.from_year?String(r.from_year):'',to_year:r.to_year?String(r.to_year):'',year_of_passing:r.year_of_passing?String(r.year_of_passing):'',result_type:r.result_type||'percentage',percentage:r.percentage||'',cgpa:r.cgpa||'',degree_class:r.degree_class||'',education_mode:r.education_mode||'',education_country:r.education_country||'India',enrollment_number:r.enrollment_number||'',remarks:r.remarks||''}); setEduModal(r); };
  const openTrain = (r={}) => { setForm({training_name:r.training_name||'',training_type:r.training_type||'other',training_provider:r.training_provider||'',start_date:r.start_date||'',end_date:r.end_date||'',duration_hours:r.duration_hours||'',completion_status:r.completion_status||'in_progress',score:r.score||'',certificate_url:r.certificate_url||'',remarks:r.remarks||''}); setTrainModal(r); };
  const openCert  = (r={}) => { setForm({certification_name:r.certification_name||'',issuing_authority:r.issuing_authority||'',issue_date:r.issue_date||'',expiry_date:r.expiry_date||'',certification_number:r.certification_number||'',file_url:r.file_url||'',is_lifetime:r.is_lifetime||false}); setCertModal(r); };

  const DEGREE_LEVELS = ['SSC / 10th','HSC / 12th','Diploma','Graduation','Post Graduation','PhD','Other'];

  if (isLoading) return <LoadingSection />;

  return (
    <div className="space-y-5">
      {/* Education */}
      <SectionCard title="Educational Qualifications" icon={GraduationCap}
        action={isAdmin && <AdminBtn onClick={() => openEdu()} label="Add" />}>
        {education.length === 0 ? <EmptyState icon={GraduationCap} text="No qualifications added" /> : (
          <div className="space-y-3">
            {education.map(e => (
              <div key={e.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff] flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-black text-[#151c27]">{e.degree_level || 'Qualification'}</p>
                    {e.specialization && <span className="text-[0.65rem] bg-[#e7eefe] text-[#3525cd] px-1.5 py-0.5 rounded-full font-bold">{e.specialization}</span>}
                  </div>
                  <p className="text-xs font-semibold text-[#464555]">{e.institution}</p>
                  {e.board_university && <p className="text-xs text-[#777587]">{e.board_university}</p>}
                  <div className="flex gap-3 mt-1 text-xs text-[#777587]">
                    {e.year_of_passing && <span>Year: {e.year_of_passing}</span>}
                    {e.percentage && <span>Score: {e.percentage}%</span>}
                    {e.cgpa && <span>CGPA: {e.cgpa}</span>}
                  </div>
                </div>
                {isAdmin && <div className="flex gap-1"><button onClick={() => openEdu(e)} className="p-1.5 rounded hover:bg-white text-[#3525cd]"><Pencil size={12}/></button><button onClick={() => delEdu.mutate(e.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Certifications */}
      <SectionCard title="Certifications" icon={Award}
        action={isAdmin && <AdminBtn onClick={() => openCert()} label="Add" />}>
        {certs.length === 0 ? <EmptyState icon={Award} text="No certifications added" /> : (
          <div className="space-y-3">
            {certs.map(c => (
              <div key={c.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff] flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-[#151c27]">{c.certification_name}</p>
                  {c.issuing_authority && <p className="text-xs text-[#3525cd] font-semibold">{c.issuing_authority}</p>}
                  <div className="flex gap-3 mt-0.5 text-xs text-[#777587]">
                    {c.issue_date && <span>Issued: {fmtDate(c.issue_date)}</span>}
                    {c.is_lifetime ? <span className="text-emerald-600 font-bold">Lifetime</span> : c.expiry_date && <span>Expires: {fmtDate(c.expiry_date)}</span>}
                  </div>
                  {c.file_url && <a href={c.file_url} target="_blank" rel="noreferrer" className="text-xs text-[#3525cd] underline mt-1 flex items-center gap-1"><Download size={10}/> View Certificate</a>}
                </div>
                {isAdmin && <div className="flex gap-1"><button onClick={() => openCert(c)} className="p-1.5 rounded hover:bg-white text-[#3525cd]"><Pencil size={12}/></button><button onClick={() => delCert.mutate(c.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Training */}
      <SectionCard title="Training & Learning" icon={BookOpen}
        action={isAdmin && <AdminBtn onClick={() => openTrain()} label="Add" />}>
        {training.length === 0 ? <EmptyState icon={BookOpen} text="No training records" /> : (
          <div className="space-y-3">
            {training.map(t => (
              <div key={t.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff] flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-[#151c27]">{t.training_name}</p>
                  {t.training_provider && <p className="text-xs text-[#464555]">{t.training_provider}</p>}
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    <span className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded-full ${t.completion_status === 'completed' ? 'bg-emerald-100 text-emerald-700' : t.completion_status === 'in_progress' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{t.completion_status}</span>
                    {t.duration_hours && <span className="text-xs text-[#777587]">{t.duration_hours}h</span>}
                    {t.score && <span className="text-xs text-[#777587]">Score: {t.score}</span>}
                  </div>
                </div>
                {isAdmin && <div className="flex gap-1"><button onClick={() => openTrain(t)} className="p-1.5 rounded hover:bg-white text-[#3525cd]"><Pencil size={12}/></button><button onClick={() => delTrain.mutate(t.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Education Modal */}
      <Modal open={eduModal !== null} onClose={() => setEduModal(null)} title={eduModal?.id ? 'Edit Qualification' : 'Add Qualification'} size="lg"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setEduModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => {
          const errs = [];
          if (!form.institution?.trim()) { errs.push('Institution name is required.'); }
          else if (!/[a-zA-Z]/.test(form.institution)) { errs.push('Institution name must contain at least one letter.'); }
          if (form.board_university && !/[a-zA-Z]/.test(form.board_university)) { errs.push('Board / University must contain at least one letter.'); }
          if (form.specialization && !/[a-zA-Z]/.test(form.specialization)) { errs.push('Specialization must contain at least one letter.'); }
          if (form.from_year && form.to_year && Number(form.to_year) < Number(form.from_year)) { errs.push('To Year cannot be before From Year.'); }
          if (form.year_of_passing) {
            if (form.from_year && Number(form.year_of_passing) < Number(form.from_year)) { errs.push('Year of Passing cannot be before From Year.'); }
            if (form.to_year && Number(form.year_of_passing) > Number(form.to_year)) { errs.push('Year of Passing cannot be after To Year.'); }
          }
          if (form.result_type === 'percentage' && form.percentage !== '' && (Number(form.percentage) < 0 || Number(form.percentage) > 100)) { errs.push('Percentage must be between 0 and 100.'); }
          if (form.result_type === 'cgpa' && form.cgpa !== '' && (Number(form.cgpa) < 0 || Number(form.cgpa) > 10)) { errs.push('CGPA must be between 0 and 10.'); }
          if (errs.length > 0) { toast(errs[0], 'error'); return; }
          eduMut.mutate(form);
        }} disabled={eduMut.isPending}>{eduMut.isPending ? 'Saving…' : 'Save Qualification'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          {/* Degree Level */}
          <div><label className="form-label">Degree Level</label>
            <select className="form-control" value={form.degree_level||''} onChange={e=>set('degree_level',e.target.value)}>
              <option value="">— Select —</option>
              {DEGREE_LEVELS.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {/* Education Mode */}
          <div><label className="form-label">Education Mode</label>
            <select className="form-control" value={form.education_mode||''} onChange={e=>set('education_mode',e.target.value)}>
              <option value="">— Select —</option>
              {['Regular','Distance Learning','Online','Part-Time','Full-Time'].map(m=><option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {/* Institution */}
          <div><label className="form-label">Institution / School <span className="text-rose-500">*</span></label>
            <input className="form-control" value={form.institution||''} onChange={e=>set('institution',e.target.value)} placeholder="e.g. IIT Bombay"/>
          </div>
          {/* Board / University */}
          <div><label className="form-label">Board / University</label>
            <input className="form-control" value={form.board_university||''} onChange={e=>set('board_university',e.target.value)} placeholder="e.g. Mumbai University"/>
          </div>
          {/* Specialization */}
          <div><label className="form-label">Specialization / Stream</label>
            <input className="form-control" value={form.specialization||''} onChange={e=>set('specialization',e.target.value)} placeholder="e.g. Computer Science"/>
          </div>
          {/* Country */}
          <div><label className="form-label">Country</label>
            <select className="form-control" value={form.education_country||'India'} onChange={e=>set('education_country',e.target.value)}>
              {ALL_COUNTRIES.map(c=><option key={c.isoCode} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {/* From Year / To Year */}
          <div><label className="form-label">From Year</label>
            <select className="form-control" value={form.from_year||''} onChange={e=>set('from_year',e.target.value)}>
              <option value="">— Select —</option>
              {Array.from({length:new Date().getFullYear()+5-1950+1},(_,i)=>new Date().getFullYear()+5-i).map(y=><option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div><label className="form-label">To Year</label>
            <select className="form-control" value={form.to_year||''} onChange={e=>set('to_year',e.target.value)}>
              <option value="">— Select —</option>
              {Array.from({length:new Date().getFullYear()+5-1950+1},(_,i)=>new Date().getFullYear()+5-i).map(y=><option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          {/* Year of Passing */}
          <div><label className="form-label">Year of Passing</label>
            <select className="form-control" value={form.year_of_passing||''} onChange={e=>set('year_of_passing',e.target.value)}>
              <option value="">— Select —</option>
              {Array.from({length:new Date().getFullYear()-1950+1},(_,i)=>new Date().getFullYear()-i).map(y=><option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          {/* Enrollment Number */}
          <div><label className="form-label">Enrollment / Roll Number</label>
            <input className="form-control" placeholder="Optional" value={form.enrollment_number||''} onChange={e=>set('enrollment_number',e.target.value)}/>
          </div>
          {/* Result Type */}
          <div className="col-span-2"><label className="form-label">Result Type</label>
            <div className="flex gap-3">
              {['percentage','cgpa'].map(t=>(
                <label key={t} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="result_type" value={t} checked={form.result_type===t} onChange={()=>set('result_type',t)} className="accent-[#3525cd]"/>
                  <span className="text-sm font-semibold text-[#464555]">{t === 'percentage' ? 'Percentage' : 'CGPA'}</span>
                </label>
              ))}
            </div>
          </div>
          {form.result_type === 'percentage' ? (
            <div><label className="form-label">Percentage (%)</label>
              <input className="form-control" type="number" min="0" max="100" step="0.01" value={form.percentage||''} onChange={e=>set('percentage',e.target.value)}/>
            </div>
          ) : (
            <div><label className="form-label">CGPA</label>
              <input className="form-control" type="number" min="0" max="10" step="0.01" value={form.cgpa||''} onChange={e=>set('cgpa',e.target.value)}/>
            </div>
          )}
          {/* Class / Division */}
          <div><label className="form-label">Class / Division</label>
            <select className="form-control" value={form.degree_class||''} onChange={e=>set('degree_class',e.target.value)}>
              <option value="">— Select —</option>
              {['Distinction','First Class','Second Class','Pass','Fail'].map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {/* Remarks */}
          <div className="col-span-2"><label className="form-label">Remarks <span className="text-xs font-normal text-[#777587]">(optional)</span></label>
            <textarea className="form-control" rows={2} placeholder="e.g. Gold Medalist, University Rank Holder…" value={form.remarks||''} onChange={e=>set('remarks',e.target.value)}/>
          </div>
        </div>
      </Modal>

      {/* Certification Modal — BUG_213: validation */}
      <Modal open={certModal !== null} onClose={() => setCertModal(null)} title={certModal?.id ? 'Edit Certification' : 'Add Certification'} size="md"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setCertModal(null)}>Cancel</button><button className="btn btn-primary" disabled={certMut.isPending} onClick={() => {
          const errs = [];
          if (!(form.certification_name||'').trim()) { errs.push('Certification Name is required.'); }
          else if (!/[a-zA-Z]/.test(form.certification_name)) { errs.push('Certification Name must contain at least one letter.'); }
          if (form.issuing_authority && !/[a-zA-Z]/.test(form.issuing_authority)) { errs.push('Issuing Authority must contain at least one letter.'); }
          if (form.issue_date && form.expiry_date && !form.is_lifetime && form.expiry_date < form.issue_date) { errs.push('Expiry Date cannot be before Issue Date.'); }
          if (form.file_url && !/^https?:\/\/.+/.test(form.file_url)) { errs.push('Certificate URL must be a valid URL (starting with http/https).'); }
          if (errs.length) { toast(errs[0], 'error'); return; }
          certMut.mutate(form);
        }}>{certMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          {[['certification_name','Certification Name *'],['issuing_authority','Issuing Authority'],['issue_date','Issue Date','date'],['expiry_date','Expiry Date','date'],['certification_number','Certificate Number'],['file_url','Certificate URL']].map(([k,l,t])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" type={t||'text'} value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
          <label className="flex items-center gap-2 text-sm col-span-2"><input type="checkbox" checked={form.is_lifetime||false} onChange={e=>set('is_lifetime',e.target.checked)} className="accent-[#3525cd]"/>Lifetime Certificate (no expiry)</label>
        </div>
      </Modal>

      {/* Training Modal — BUG_214: validation */}
      <Modal open={trainModal !== null} onClose={() => setTrainModal(null)} title={trainModal?.id ? 'Edit Training' : 'Add Training'} size="lg"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setTrainModal(null)}>Cancel</button><button className="btn btn-primary" disabled={trainMut.isPending} onClick={() => {
          const errs = [];
          if (!(form.training_name||'').trim()) { errs.push('Training Name is required.'); }
          else if (!/[a-zA-Z]/.test(form.training_name)) { errs.push('Training Name must contain at least one letter.'); }
          if (form.start_date && form.end_date && form.end_date < form.start_date) { errs.push('End Date cannot be before Start Date.'); }
          if (form.duration_hours && (isNaN(Number(form.duration_hours)) || Number(form.duration_hours) < 0)) { errs.push('Duration must be a positive number.'); }
          if (form.certificate_url && !/^https?:\/\/.+/.test(form.certificate_url)) { errs.push('Certificate URL must start with http/https.'); }
          if (errs.length) { toast(errs[0], 'error'); return; }
          trainMut.mutate(form);
        }}>{trainMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className="form-label">Training Name *</label><input className="form-control" value={form.training_name||''} onChange={e=>set('training_name',e.target.value)}/></div>
          <div><label className="form-label">Type</label>
            <select className="form-control" value={form.training_type||'other'} onChange={e=>set('training_type',e.target.value)}>
              {['online','offline','workshop','conference','internal','external','other'].map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select></div>
          <div><label className="form-label">Status</label>
            <select className="form-control" value={form.completion_status||'in_progress'} onChange={e=>set('completion_status',e.target.value)}>
              {[['planned','Planned'],['in_progress','In Progress'],['completed','Completed'],['cancelled','Cancelled']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select></div>
          {[['training_provider','Provider'],['start_date','Start Date','date'],['end_date','End Date','date'],['duration_hours','Duration (hrs)','number'],['score','Score / Grade'],['certificate_url','Certificate URL'],['remarks','Remarks']].map(([k,l,t])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" type={t||'text'} value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ─── Section: Compensation Tab ────────────────────────────────────────────────

function CompensationTab({ empId, isAdmin, onEdit, emp }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [bankModal,    setBankModal]    = useState(null);
  const [nomModal,     setNomModal]     = useState(null);
  const [salaryEditing, setSalaryEditing] = useState(false);
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const { data: payroll, isLoading: pLoad }  = useQuery({ queryKey: ['epv2-payroll',  empId], queryFn: () => apiGet('/payroll/structure', { userId: empId }) });
  const { data: banking  = [], isLoading: bLoad } = useQuery({ queryKey: ['epv2-banking',  empId], queryFn: () => apiGet(`/profile/${empId}/banking`) });
  const { data: nominees = [] } = useQuery({ queryKey: ['epv2-nominees', empId], queryFn: () => apiGet(`/profile/${empId}/nominees`) });

  // Salary CTC is stored on the users row via the professional endpoint (adminOnly on backend)
  const salaryMut = useMutation({
    mutationFn: (body) => apiPut(`/profile/${empId}/professional`, body),
    onSuccess: () => {
      toast('Salary details saved', 'success');
      qc.invalidateQueries({ queryKey: ['epv2-payroll',       empId] });
      qc.invalidateQueries({ queryKey: ['epv2-professional',  empId] });
      qc.invalidateQueries({ queryKey: ['epv2-overview',      empId] });
      setSalaryEditing(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const bankMut = useMutation({ mutationFn: b => bankModal?.id ? apiPut(`/profile/${empId}/banking/${bankModal.id}`,b) : apiPost(`/profile/${empId}/banking`,b), onSuccess: () => { toast('Saved','success'); qc.invalidateQueries({queryKey:['epv2-banking',empId]}); qc.invalidateQueries({queryKey:['epv2-overview',empId]}); setBankModal(null); }, onError: e=>toast(e.message,'error') });
  const delBank = useMutation({ mutationFn: id => apiDelete(`/profile/${empId}/banking/${id}`), onSuccess: () => { qc.invalidateQueries({queryKey:['epv2-banking',empId]}); qc.invalidateQueries({queryKey:['epv2-overview',empId]}); } });
  const nomMut  = useMutation({ mutationFn: b => nomModal?.id  ? apiPut(`/profile/${empId}/nominees/${nomModal.id}`,b)  : apiPost(`/profile/${empId}/nominees`,b),  onSuccess: () => { toast('Saved','success'); qc.invalidateQueries({queryKey:['epv2-nominees',empId]}); setNomModal(null); }, onError: e=>toast(e.message,'error') });
  const delNom  = useMutation({ mutationFn: id => apiDelete(`/profile/${empId}/nominees/${id}`), onSuccess: () => qc.invalidateQueries({queryKey:['epv2-nominees',empId]}) });

  const openBank = (r={}) => { setForm({bank_name:r.bank_name||'',branch_name:r.branch_name||'',branch_code:r.branch_code||'',account_number:r.account_number||'',account_holder_name:r.account_holder_name||'',account_type:r.account_type||'savings',ifsc_code:r.ifsc_code||'',payment_method:r.payment_method||'bank_transfer',is_primary:r.is_primary||false}); setBankModal(r); };
  const openNom  = (r={}) => { setForm({nominee_name:r.nominee_name||'',relationship:r.relationship||'',date_of_birth:r.date_of_birth||'',percentage_share:r.percentage_share||'',contact_number:r.contact_number||'',address:r.address||''}); setNomModal(r); };
  const openSalary = () => {
    setForm({ ctc: emp.ctc || '', salary_effective_date: emp.salary_effective_date?.slice(0,10) || '' });
    setSalaryEditing(true);
  };

  const totalNomShare = nominees.reduce((s, n) => s + (parseFloat(n.percentage_share) || 0), 0);

  return (
    <div className="space-y-5">
      {/* Salary Overview — inline CTC edit; full structure stays in Payroll module */}
      <SectionCard title="Salary Overview" icon={Banknote}
        action={isAdmin && !salaryEditing && <AdminBtn onClick={openSalary} />}>
        {salaryEditing ? (
          <div>
            <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-700 font-semibold">CTC and effective date only. Full salary structure (HRA, PF, components) is managed in the Payroll module.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">CTC (Annual) <span className="text-rose-500">*</span></label>
                <input className="form-control" type="number" min="0" placeholder="e.g. 600000"
                  value={form.ctc||''} onChange={e=>set('ctc',e.target.value)} />
              </div>
              <div>
                <label className="form-label">Effective Date</label>
                <input className="form-control" type="date"
                  value={form.salary_effective_date||''} onChange={e=>set('salary_effective_date',e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#f0f3ff]">
              <button className="btn btn-outline" onClick={() => setSalaryEditing(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={salaryMut.isPending}
                onClick={() => {
                  const ctcVal = parseFloat(form.ctc);
                  if (form.ctc && (isNaN(ctcVal) || ctcVal < 0)) { toast('CTC must be a positive number','error'); return; }
                  salaryMut.mutate({ ctc: form.ctc || null, salary_effective_date: form.salary_effective_date || null });
                }}>
                {salaryMut.isPending ? <><Loader2 size={13} className="animate-spin mr-1"/>Saving…</> : <><Save size={13} className="mr-1"/>Save</>}
              </button>
            </div>
          </div>
        ) : (
          <>
            {isAdmin && (
              <div className="mb-3 flex items-start gap-2 px-3 py-2 bg-[#f0f3ff] border border-[#c7c4d8] rounded-lg">
                <Banknote size={13} className="text-[#3525cd] mt-0.5 flex-shrink-0" />
                <p className="text-xs text-[#464555]">Full salary structure can be configured from the <span className="font-bold text-[#3525cd]">Payroll</span> module.</p>
              </div>
            )}
            {pLoad ? <LoadingSection /> : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  ['CTC (Annual)', payroll?.ctc ? `₹${(Number(payroll.ctc)*12).toLocaleString('en-IN')}` : emp.ctc ? `₹${Number(emp.ctc).toLocaleString('en-IN')}` : null],
                  ['Effective From', payroll?.effective_from ? fmtDate(payroll.effective_from) : emp.salary_effective_date ? fmtDate(emp.salary_effective_date) : null],
                  ['Net Salary', payroll?.gross_salary ? `₹${(Number(payroll.gross_salary)-[payroll.employee_pf,payroll.employee_esi,payroll.professional_tax,payroll.tds,payroll.other_deductions,payroll.retention].reduce((s,v)=>s+Number(v||0),0)).toLocaleString('en-IN')}` : null],
                  ['Basic',        payroll?.basic        ? `₹${Number(payroll.basic).toLocaleString('en-IN')}` : null],
                  ['HRA',          payroll?.hra          ? `₹${Number(payroll.hra).toLocaleString('en-IN')}` : null],
                  ['Gross Salary', payroll?.gross_salary ? `₹${Number(payroll.gross_salary).toLocaleString('en-IN')}` : null],
                  ['PF (Employee)',payroll?.employee_pf   ? `₹${Number(payroll.employee_pf).toLocaleString('en-IN')}` : null],
                  ['Prof. Tax',    payroll?.professional_tax ? `₹${Number(payroll.professional_tax).toLocaleString('en-IN')}` : null],
                  ['Retention',    payroll?.retention    ? `₹${Number(payroll.retention).toLocaleString('en-IN')}` : null],
                ].map(([l,v])=>(
                  <div key={l} className="bg-[#f9f9ff] rounded-xl p-3 border border-[#f0f3ff]">
                    <p className="text-[0.65rem] text-[#777587] font-medium">{l}</p>
                    <p className="text-sm font-black text-[#151c27] mt-0.5">{v || '—'}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SectionCard>

      {/* Bank Accounts */}
      <SectionCard title="Bank Accounts" icon={CreditCard}
        action={isAdmin && <AdminBtn onClick={() => openBank()} label="Add" />}>
        {bLoad ? <LoadingSection /> : banking.length === 0 ? <EmptyState icon={CreditCard} text="No bank accounts added" /> : (
          <div className="space-y-3">
            {banking.map(b => (
              <div key={b.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff] flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2"><p className="text-sm font-black text-[#151c27]">{b.bank_name}</p>{b.is_primary && <span className="text-[0.6rem] bg-[#3525cd] text-white px-1.5 py-0.5 rounded-full font-bold">Primary</span>}</div>
                  <p className="text-xs text-[#464555] font-mono mt-0.5">{b.account_number}</p>
                  <div className="flex gap-3 text-xs text-[#777587] mt-0.5">
                    {b.branch_name && <span>{b.branch_name}</span>}
                    {b.ifsc_code && <span>IFSC: {b.ifsc_code}</span>}
                    <span className="capitalize">{b.account_type}</span>
                  </div>
                </div>
                {isAdmin && <div className="flex gap-1"><button onClick={() => openBank(b)} className="p-1.5 rounded hover:bg-white text-[#3525cd]"><Pencil size={12}/></button><button onClick={() => delBank.mutate(b.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Nominees */}
      <SectionCard title="Nominees" icon={Users}
        action={isAdmin && <AdminBtn onClick={() => openNom()} label="Add" />}>
        {nominees.length === 0 ? <EmptyState icon={Users} text="No nominees added" /> : (
          <>
            <div className="space-y-3">
              {nominees.map(n => (
                <div key={n.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff] flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-[#151c27]">{n.nominee_name}</p>
                    <p className="text-xs text-[#777587]">{n.relationship}{n.date_of_birth && ` · ${fmtDate(n.date_of_birth)}`}</p>
                    {n.percentage_share && <p className="text-xs font-bold text-[#3525cd] mt-0.5">{n.percentage_share}% share</p>}
                  </div>
                  {isAdmin && <div className="flex gap-1"><button onClick={() => openNom(n)} className="p-1.5 rounded hover:bg-white text-[#3525cd]"><Pencil size={12}/></button><button onClick={() => delNom.mutate(n.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button></div>}
                </div>
              ))}
            </div>
            <div className={`mt-3 px-3 py-2 rounded-lg text-xs font-bold ${totalNomShare === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              Total nomination share: {totalNomShare}% {totalNomShare !== 100 && '(should be 100%)'}
            </div>
          </>
        )}
      </SectionCard>

      {/* Bank Modal */}
      <Modal open={bankModal !== null} onClose={() => setBankModal(null)} title={bankModal?.id ? 'Edit Bank Account' : 'Add Bank Account'} size="lg"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setBankModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => bankMut.mutate(form)} disabled={bankMut.isPending}>{bankMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          {[['bank_name','Bank Name *'],['branch_name','Branch Name'],['branch_code','Branch Code'],['account_number','Account Number *'],['account_holder_name','Account Holder Name'],['ifsc_code','IFSC Code']].map(([k,l])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
          <div><label className="form-label">Account Type</label>
            <select className="form-control" value={form.account_type||'savings'} onChange={e=>set('account_type',e.target.value)}>
              {['savings','current','salary','nre','nro','other'].map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
            </select></div>
          <div><label className="form-label">Payment Method</label>
            <select className="form-control" value={form.payment_method||'bank_transfer'} onChange={e=>set('payment_method',e.target.value)}>
              {[['bank_transfer','Bank Transfer'],['cheque','Cheque'],['cash','Cash'],['upi','UPI']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </select></div>
          <label className="flex items-center gap-2 text-sm col-span-2"><input type="checkbox" checked={form.is_primary||false} onChange={e=>set('is_primary',e.target.checked)} className="accent-[#3525cd]"/>Set as primary salary account</label>
        </div>
      </Modal>

      {/* Nominee Modal — BUG_207 + BUG_208: validation */}
      <Modal open={nomModal !== null} onClose={() => setNomModal(null)} title={nomModal?.id ? 'Edit Nominee' : 'Add Nominee'} size="md"
        footer={<div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={() => setNomModal(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={nomMut.isPending} onClick={() => {
            const errs = [];
            const name = (form.nominee_name || '').trim();
            const rel  = (form.relationship || '').trim();
            if (!name) { errs.push('Nominee Name is required.'); }
            else if (!/[a-zA-Z]/.test(name)) { errs.push('Nominee Name must contain at least one letter.'); }
            else if (/\d/.test(name)) { errs.push('Nominee Name cannot contain numbers.'); }
            if (!rel) { errs.push('Relationship is required.'); }
            else if (!/[a-zA-Z]/.test(rel)) { errs.push('Relationship must contain letters only.'); }
            const phone = (form.contact_number || '').trim();
            if (phone && !/^\d{7,15}$/.test(phone)) { errs.push('Contact Number must be 7–15 digits.'); }
            const dob = form.date_of_birth;
            if (dob && dob > new Date().toISOString().split('T')[0]) { errs.push('Date of Birth cannot be in the future.'); }
            const share = parseFloat(form.percentage_share);
            if (form.percentage_share !== '' && form.percentage_share != null) {
              if (isNaN(share) || share <= 0 || share > 100) { errs.push('Share % must be between 1 and 100.'); }
              else {
                // BUG_207: correct current total — exclude editing nominee's own share
                const currentTotal = nominees
                  .filter(n => n.id !== nomModal?.id)
                  .reduce((s, n) => s + (parseFloat(n.percentage_share) || 0), 0);
                const newTotal = currentTotal + share;
                if (newTotal > 100) {
                  errs.push(`Total nominee share would exceed 100% (current: ${currentTotal}%, adding: ${share}%)`);
                }
              }
            }
            if (errs.length) { toast(errs[0], 'error'); return; }
            nomMut.mutate(form);
          }}>{nomMut.isPending ? 'Saving…' : 'Save'}</button>
        </div>}>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="form-label">Nominee Name <span className="text-rose-500">*</span></label><input className="form-control" value={form.nominee_name||''} onChange={e=>set('nominee_name',e.target.value)} placeholder="Full name"/></div>
          <div><label className="form-label">Relationship <span className="text-rose-500">*</span></label><input className="form-control" value={form.relationship||''} onChange={e=>set('relationship',e.target.value)} placeholder="e.g. Spouse, Child"/></div>
          <div><label className="form-label">Date of Birth</label><input className="form-control" type="date" value={form.date_of_birth||''} onChange={e=>set('date_of_birth',e.target.value)} max={new Date().toISOString().split('T')[0]}/></div>
          <div><label className="form-label">Share %</label><input className="form-control" type="number" min={1} max={100} value={form.percentage_share||''} onChange={e=>set('percentage_share',e.target.value)} placeholder="0–100"/></div>
          <div><label className="form-label">Contact Number</label><input className="form-control" type="tel" value={form.contact_number||''} onChange={e=>set('contact_number',e.target.value.replace(/\D/g,''))} placeholder="Digits only"/></div>
          <div><label className="form-label">Address</label><input className="form-control" value={form.address||''} onChange={e=>set('address',e.target.value)}/></div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Section: Compliance Tab ──────────────────────────────────────────────────

function ComplianceTab({ empId, onEdit, emp }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [docModal,    setDocModal]    = useState(null);
  const [immiModal,   setImmiModal]   = useState(null);
  const [statEditing, setStatEditing] = useState(false);
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const statMut = useMutation({
    mutationFn: (body) => apiPut(`/profile/${empId}/statutory`, body),
    onSuccess: () => {
      toast('Statutory information updated', 'success');
      qc.invalidateQueries({ queryKey: ['epv2-stat', empId] });
      setStatEditing(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const openStat = (s) => {
    setForm({
      pf_applicable:   s.pf_applicable   ?? false,
      pf_no:           s.pf_no           || '',
      uan_no:          s.uan_no          || '',
      esi_applicable:  s.esi_applicable  ?? false,
      esi_no:          s.esi_no          || '',
      esi_dispensary:  s.esi_dispensary  || '',
      pt_applicable:   s.pt_applicable   ?? false,
      pt_rule:         s.pt_rule         || '',
      aadhar_no:       s.aadhar_no       || '',
      pan_number:      s.pan_number      || '',
      gratuity_applicable: s.gratuity_applicable ?? false,
      ot_applicable:   s.ot_applicable   ?? false,
      ot_rate:         s.ot_rate         || '',
      bonus_applicable: s.bonus_applicable ?? false,
      lwf_applicable:  s.lwf_applicable  ?? false,
      vpf_applicable:  s.vpf_applicable  ?? false,
      vpf_percentage:  s.vpf_percentage  || '',
      is_pf_on_gross:  s.is_pf_on_gross  ?? false,
    });
    setStatEditing(true);
  };

  const { data: govDocs = [],  isLoading: dLoad } = useQuery({ queryKey: ['epv2-govdocs',  empId], queryFn: () => apiGet(`/profile/${empId}/government-docs`) });
  const { data: immigration = [] } = useQuery({ queryKey: ['epv2-immig',    empId], queryFn: () => apiGet(`/profile/${empId}/immigration`) });
  const { data: statutory = {} }   = useQuery({ queryKey: ['epv2-stat',     empId], queryFn: () => apiGet(`/profile/${empId}/statutory`) });
  // BUG_211: also fetch documents the employee uploaded via My Documents portal
  const { data: empUploadedDocs = [] } = useQuery({ queryKey: ['epv2-emp-docs', empId], queryFn: () => apiGet('/documents', { userId: empId }), staleTime: 30000 });

  const docMut  = useMutation({ mutationFn: b => docModal?.id  ? apiPut(`/profile/${empId}/government-docs/${docModal.id}`,b)  : apiPost(`/profile/${empId}/government-docs`,b),  onSuccess: () => { toast('Saved','success'); qc.invalidateQueries({queryKey:['epv2-govdocs',empId]}); setDocModal(null); },  onError: e=>toast(e.message,'error') });
  const verifyMut = useMutation({ mutationFn: ({ id, status }) => apiPatch(`/profile/${empId}/government-docs/${id}/verify`, { verification_status: status }), onSuccess: () => qc.invalidateQueries({queryKey:['epv2-govdocs',empId]}), onError: e=>toast(e.message,'error') });
  const delDoc  = useMutation({ mutationFn: id => apiDelete(`/profile/${empId}/government-docs/${id}`), onSuccess: () => qc.invalidateQueries({queryKey:['epv2-govdocs',empId]}) });
  const immiMut = useMutation({ mutationFn: b => immiModal?.id ? apiPut(`/profile/${empId}/immigration/${immiModal.id}`,b) : apiPost(`/profile/${empId}/immigration`,b), onSuccess: () => { toast('Saved','success'); qc.invalidateQueries({queryKey:['epv2-immig',empId]}); setImmiModal(null); }, onError: e=>toast(e.message,'error') });
  const delImmi = useMutation({ mutationFn: id => apiDelete(`/profile/${empId}/immigration/${id}`), onSuccess: () => qc.invalidateQueries({queryKey:['epv2-immig',empId]}) });

  const openDoc  = (r={}) => { setForm({document_type:r.document_type||'',document_number:r.document_number||'',issue_date:r.issue_date||'',expiry_date:r.expiry_date||'',issuing_authority:r.issuing_authority||'',remarks:r.remarks||''}); setDocModal(r); };
  const openImmi = (r={}) => { setForm({citizenship:r.citizenship||'',immigration_type:r.immigration_type||'',immigration_no:r.immigration_no||'',passport_number:r.passport_number||'',visa_type:r.visa_type||'',issue_date:r.issue_date||'',expiry_date:r.expiry_date||'',country:r.country||'',remarks:r.remarks||''}); setImmiModal(r); };

  const DOC_TYPES = ['aadhar','pan','passport','driving_license','voter_id','ration_card','uan','esic','pf','birth_certificate','other'];

  return (
    <div className="space-y-5">
      {/* Government Documents */}
      <SectionCard title="Government Documents" icon={FileText}
        action={<AdminBtn onClick={() => openDoc()} label="Add" />}>
        {dLoad ? <LoadingSection /> : govDocs.length === 0 ? <EmptyState icon={FileText} text="No documents added" /> : (
          <div className="space-y-3">
            {govDocs.map(d => (
              <div key={d.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff] flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-black text-[#151c27] capitalize">{d.document_type.replace(/_/g,' ')}</p>
                    <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${DOC_VERIFY_COLORS[d.verification_status]}`}>{d.verification_status}</span>
                  </div>
                  {d.document_number && <p className="text-xs font-mono text-[#464555] mt-0.5">{d.document_number}</p>}
                  <div className="flex gap-3 text-xs text-[#777587] mt-0.5">
                    {d.issue_date   && <span>Issued: {fmtDate(d.issue_date)}</span>}
                    {d.expiry_date  && <span>Expires: {fmtDate(d.expiry_date)}</span>}
                  </div>
                  {d.file_url && <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-[#3525cd] underline mt-1 flex items-center gap-1"><Download size={10}/> View</a>}
                </div>
                <div className="flex gap-1 flex-col">
                  <div className="flex gap-1">
                    <button onClick={() => openDoc(d)} className="p-1.5 rounded hover:bg-white text-[#3525cd]"><Pencil size={12}/></button>
                    <button onClick={() => delDoc.mutate(d.id)} className="p-1.5 rounded hover:bg-rose-50 text-rose-500"><Trash2 size={12}/></button>
                  </div>
                  {d.verification_status !== 'verified' && <button onClick={() => verifyMut.mutate({ id: d.id, status: 'verified' })} className="text-[0.6rem] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold hover:bg-emerald-200">Verify</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* BUG_211: Employee-uploaded documents from My Documents portal */}
      {empUploadedDocs.filter(d => d.uploaded_by === empId || d.user_id === empId).length > 0 && (
        <SectionCard title="Employee Submitted Documents" icon={Upload}>
          <div className="space-y-3">
            {empUploadedDocs
              .filter(d => d.uploaded_by === empId || d.user_id === empId)
              .map(d => (
                <div key={d.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff] flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-black text-[#151c27]">{d.name || d.file_name || 'Document'}</p>
                      <span className={`text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full capitalize ${DOC_VERIFY_COLORS[d.verification_status] || 'bg-amber-50 text-amber-700'}`}>{d.verification_status || d.status || 'pending'}</span>
                      {d.category && <span className="text-[0.6rem] font-semibold px-1.5 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd] capitalize">{d.category.replace(/_/g,' ')}</span>}
                    </div>
                    <p className="text-[0.68rem] text-[#777587] mt-0.5">Uploaded by employee</p>
                    {d.file_url && <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs text-[#3525cd] underline mt-1 flex items-center gap-1"><Download size={10}/> View</a>}
                  </div>
                </div>
              ))}
          </div>
        </SectionCard>
      )}

      {/* Statutory — inline editing */}
      <SectionCard title="Statutory Information" icon={Shield}
        action={!statEditing && <AdminBtn onClick={() => openStat(statutory)} />}>
        {statEditing ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              {/* PF */}
              <label className="flex items-center gap-2 text-sm col-span-2">
                <input type="checkbox" checked={form.pf_applicable||false} onChange={e=>set('pf_applicable',e.target.checked)} className="accent-[#3525cd]"/> PF Applicable
              </label>
              {form.pf_applicable && (
                <>
                  <div><label className="form-label">PF Number</label><input className="form-control" value={form.pf_no||''} onChange={e=>set('pf_no',e.target.value)}/></div>
                  <div><label className="form-label">UAN Number</label><input className="form-control" value={form.uan_no||''} onChange={e=>set('uan_no',e.target.value)}/></div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.is_pf_on_gross||false} onChange={e=>set('is_pf_on_gross',e.target.checked)} className="accent-[#3525cd]"/> PF on Gross
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={form.vpf_applicable||false} onChange={e=>set('vpf_applicable',e.target.checked)} className="accent-[#3525cd]"/> VPF Applicable
                  </label>
                  {form.vpf_applicable && (
                    <div><label className="form-label">VPF %</label><input type="number" className="form-control" min="0" max="100" value={form.vpf_percentage||''} onChange={e=>set('vpf_percentage',e.target.value)}/></div>
                  )}
                </>
              )}
              {/* ESI */}
              <label className="flex items-center gap-2 text-sm col-span-2">
                <input type="checkbox" checked={form.esi_applicable||false} onChange={e=>set('esi_applicable',e.target.checked)} className="accent-[#3525cd]"/> ESI Applicable
              </label>
              {form.esi_applicable && (
                <>
                  <div><label className="form-label">ESI Number</label><input className="form-control" value={form.esi_no||''} onChange={e=>set('esi_no',e.target.value)}/></div>
                  <div><label className="form-label">ESI Dispensary</label><input className="form-control" value={form.esi_dispensary||''} onChange={e=>set('esi_dispensary',e.target.value)}/></div>
                </>
              )}
              {/* PT */}
              <label className="flex items-center gap-2 text-sm col-span-2">
                <input type="checkbox" checked={form.pt_applicable||false} onChange={e=>set('pt_applicable',e.target.checked)} className="accent-[#3525cd]"/> PT Applicable
              </label>
              {form.pt_applicable && (
                <div><label className="form-label">PT Rule</label><input className="form-control" value={form.pt_rule||''} onChange={e=>set('pt_rule',e.target.value)}/></div>
              )}
              {/* Identity */}
              <div><label className="form-label">Aadhar Number</label><input className="form-control" value={form.aadhar_no||''} onChange={e=>set('aadhar_no',e.target.value)}/></div>
              <div><label className="form-label">PAN Number</label><input className="form-control" value={form.pan_number||''} onChange={e=>set('pan_number',e.target.value)}/></div>
              {/* OT */}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.ot_applicable||false} onChange={e=>set('ot_applicable',e.target.checked)} className="accent-[#3525cd]"/> OT Applicable
              </label>
              {form.ot_applicable && (
                <div><label className="form-label">OT Rate (per hr)</label><input type="number" className="form-control" min="0" value={form.ot_rate||''} onChange={e=>set('ot_rate',e.target.value)}/></div>
              )}
              {/* Others */}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.gratuity_applicable||false} onChange={e=>set('gratuity_applicable',e.target.checked)} className="accent-[#3525cd]"/> Gratuity Applicable
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.bonus_applicable||false} onChange={e=>set('bonus_applicable',e.target.checked)} className="accent-[#3525cd]"/> Bonus Applicable
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.lwf_applicable||false} onChange={e=>set('lwf_applicable',e.target.checked)} className="accent-[#3525cd]"/> LWF Applicable
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#f0f3ff]">
              <button className="btn btn-outline" onClick={() => setStatEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => statMut.mutate(form)} disabled={statMut.isPending}>
                {statMut.isPending ? <><Loader2 size={13} className="animate-spin mr-1" />Saving…</> : <><Save size={13} className="mr-1" />Save</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6">
            {[['PF Applicable', statutory.pf_applicable ? 'Yes' : 'No'],['PF Number', statutory.pf_no],['UAN Number', statutory.uan_no],['ESI Applicable', statutory.esi_applicable ? 'Yes' : 'No'],['ESI Number', statutory.esi_no],['ESI Dispensary', statutory.esi_dispensary],['PT Applicable', statutory.pt_applicable ? 'Yes' : 'No'],['PT Rule', statutory.pt_rule],['Aadhar', statutory.aadhar_no],['PAN', statutory.pan_number],['Gratuity', statutory.gratuity_applicable ? 'Yes' : 'No'],['OT Applicable', statutory.ot_applicable ? 'Yes' : 'No'],['OT Rate', statutory.ot_rate],['Bonus', statutory.bonus_applicable ? 'Yes' : 'No']].map(([l,v])=>(
              <InfoRow key={l} label={l} value={v} />
            ))}
          </div>
        )}
      </SectionCard>

      {/* Immigration */}
      <SectionCard title="Immigration Details" icon={Globe}
        action={<AdminBtn onClick={() => openImmi()} label={immigration.length ? 'Edit' : 'Add'} />}>
        {immigration.length === 0 ? <EmptyState icon={Globe} text="No immigration records" /> : (
          immigration.map(i => (
            <div key={i.id} className="space-y-1">
              <InfoRow label="Citizenship"       value={i.citizenship} />
              <InfoRow label="Immigration Type"  value={i.immigration_type} />
              <InfoRow label="Immigration No."   value={i.immigration_no} />
              <InfoRow label="Passport Number"   value={i.passport_number} />
              <InfoRow label="Visa Type"         value={i.visa_type} />
              <InfoRow label="Issue Date"        value={i.issue_date ? fmtDate(i.issue_date) : null} />
              <InfoRow label="Expiry Date"       value={i.expiry_date ? fmtDate(i.expiry_date) : null} />
              <InfoRow label="Country"           value={i.country} />
              {i.remarks && <InfoRow label="Remarks" value={i.remarks} />}
              {immigration.length > 1 && (
                <button onClick={() => delImmi.mutate(i.id)} className="text-xs text-rose-500 mt-2 flex items-center gap-1"><Trash2 size={11}/>Remove</button>
              )}
            </div>
          ))
        )}
      </SectionCard>

      {/* Doc Modal */}
      <Modal open={docModal !== null} onClose={() => setDocModal(null)} title={docModal?.id ? 'Edit Document' : 'Add Document'} size="md"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setDocModal(null)}>Cancel</button><button className="btn btn-primary" onClick={() => docMut.mutate(form)} disabled={docMut.isPending}>{docMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2"><label className="form-label">Document Type *</label>
            <select className="form-control" value={form.document_type||''} onChange={e=>set('document_type',e.target.value)}>
              <option value="">— Select —</option>
              {DOC_TYPES.map(t=><option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>)}
            </select></div>
          {[['document_number','Document Number'],['issue_date','Issue Date','date'],['expiry_date','Expiry Date','date'],['issuing_authority','Issuing Authority'],['remarks','Remarks']].map(([k,l,t])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" type={t||'text'} value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
        </div>
      </Modal>

      {/* Immigration Modal — BUG_212: validation */}
      <Modal open={immiModal !== null} onClose={() => setImmiModal(null)} title="Immigration Details" size="lg"
        footer={<div className="flex justify-end gap-3"><button className="btn btn-outline" onClick={() => setImmiModal(null)}>Cancel</button><button className="btn btn-primary" disabled={immiMut.isPending} onClick={() => {
          const errs = [];
          if (!(form.citizenship||'').trim()) { errs.push('Citizenship is required.'); }
          if (form.passport_number && !/^[A-Z0-9]{6,20}$/i.test(form.passport_number)) { errs.push('Passport Number must be 6–20 alphanumeric characters.'); }
          if (form.immigration_no && !/^[A-Z0-9\-\/]{3,30}$/i.test(form.immigration_no)) { errs.push('Immigration No. must be 3–30 alphanumeric characters.'); }
          if (form.issue_date && form.expiry_date && form.expiry_date < form.issue_date) { errs.push('Expiry Date cannot be before Issue Date.'); }
          if (form.issue_date && form.issue_date > new Date().toISOString().split('T')[0]) { errs.push('Issue Date cannot be in the future.'); }
          if (errs.length) { toast(errs[0], 'error'); return; }
          immiMut.mutate(form);
        }}>{immiMut.isPending ? 'Saving…' : 'Save'}</button></div>}>
        <div className="grid grid-cols-2 gap-4">
          {[['citizenship','Citizenship *'],['immigration_type','Immigration Type'],['immigration_no','Immigration No.'],['passport_number','Passport Number'],['visa_type','Visa Type'],['issue_date','Issue Date','date'],['expiry_date','Expiry Date','date'],['country','Country'],['remarks','Remarks']].map(([k,l,t])=>(
            <div key={k}><label className="form-label">{l}</label><input className="form-control" type={t||'text'} value={form[k]||''} onChange={e=>set(k,e.target.value)}/></div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

// ─── Section: Work Tab ────────────────────────────────────────────────────────
// Reuses existing query keys so data comes from cache if already loaded

// ─── Document Requirements Section ───────────────────────────────────────────
// Shows org-level document requirements applicable to this employee (from Documents module).
// Admins can upload documents on behalf of the employee.

const DOC_STATUS_CFG = {
  under_review:       { label: 'Pending Review',     cls: 'bg-amber-100 text-amber-700',   icon: FileClock },
  hr_approved:        { label: 'HR Approved',         cls: 'bg-blue-100 text-blue-700',     icon: FileCheck },
  approved:           { label: 'Approved',             cls: 'bg-emerald-100 text-emerald-700', icon: FileCheck },
  rejected:           { label: 'Rejected',             cls: 'bg-rose-100 text-rose-700',     icon: FileX },
  re_upload_requested:{ label: 'Re-upload Requested', cls: 'bg-orange-100 text-orange-700', icon: RefreshCw },
};

function DocViewerModal({ url, name, onClose }) {
  if (!url) return null;
  const isPdf = url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('/pdf') || url.includes('application/pdf');
  const isImg = /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url) || url.includes('image/');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#f0f3ff] flex-shrink-0">
          <p className="text-sm font-bold text-[#151c27] truncate">{name}</p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href={url} download target="_blank" rel="noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#c7c4d8] text-[0.7rem] font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-all">
              <Download size={11} /> Download
            </a>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#f0f3ff] text-[#777587] hover:text-[#151c27]">
              <X size={16} />
            </button>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-auto bg-[#f9f9ff] flex items-center justify-center min-h-[400px]">
          {isPdf ? (
            <iframe src={url} title={name} className="w-full h-[70vh]" />
          ) : isImg ? (
            <img src={url} alt={name} className="max-w-full max-h-[70vh] object-contain rounded-lg shadow" />
          ) : (
            <div className="text-center py-12">
              <FileText size={48} className="mx-auto mb-3 text-[#c7c4d8]" />
              <p className="text-sm text-[#464555] mb-3">Preview not available for this file type.</p>
              <a href={url} download target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#3525cd] text-white text-sm font-bold hover:bg-[#4f46e5] transition-colors">
                <Download size={14} /> Download File
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentRequirementsSection({ empId, isAdmin }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const fileInputRefs = useRef({});
  const [uploading, setUploading] = useState({});
  const [viewDoc, setViewDoc]     = useState(null); // { url, name }

  const { data: requirements = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['emp-doc-requirements', empId],
    queryFn:  () => apiGet(`/doc-requirements/for-employee/${empId}`),
    enabled:  !!empId && isAdmin,
    staleTime: 30000,
  });

  const handleUpload = async (reqId, file) => {
    if (!file) return;
    setUploading(u => ({ ...u, [reqId]: true }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('lt_token');
      const res = await fetch(`/api/doc-requirements/${reqId}/submit-for/${empId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast('Document uploaded and approved', 'success');
      qc.invalidateQueries({ queryKey: ['emp-doc-requirements', empId] });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(u => ({ ...u, [reqId]: false }));
      if (fileInputRefs.current[reqId]) fileInputRefs.current[reqId].value = '';
    }
  };

  if (!isAdmin) return null;
  if (isLoading) return <SectionCard title="Document Requirements" icon={FileText}><LoadingSection /></SectionCard>;
  if (isError)   return (
    <SectionCard title="Document Requirements" icon={FileText}>
      <div className="text-center py-6">
        <p className="text-sm text-rose-600 mb-2">Failed to load document requirements</p>
        <button onClick={() => refetch()} className="text-xs text-[#3525cd] underline">Retry</button>
      </div>
    </SectionCard>
  );
  if (!requirements.length) return (
    <SectionCard title="Document Requirements" icon={FileText}>
      <EmptyState icon={FileText} text="No document requirements defined for this employee" />
    </SectionCard>
  );

  return (
    <>
      {viewDoc && <DocViewerModal url={viewDoc.url} name={viewDoc.name} onClose={() => setViewDoc(null)} />}
      <SectionCard title="Document Requirements" icon={FileText}>
        <p className="text-xs text-[#777587] mb-4">
          Requirements from the Documents module. Admin-uploaded documents are auto-approved.
        </p>
        <div className="space-y-3">
          {requirements.map(req => {
            const sub        = req._submission;
            const status     = sub?.status;
            const cfg        = status ? DOC_STATUS_CFG[status] : null;
            const StatusIcon = cfg?.icon;
            const notUploaded = !sub;
            // Admin can always replace (they auto-approved it, so they can update it any time)
            const canReplace  = !!sub;

            return (
              <div key={req.id} className="p-4 rounded-xl border border-[#e7eefe] bg-[#f9f9ff] space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-[#151c27]">{req.name}</p>
                      {req.is_required
                        ? <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">Required</span>
                        : <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-[#f0f3ff] text-[#3525cd]">Optional</span>
                      }
                      {cfg && (
                        <span className={`flex items-center gap-1 text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
                          {StatusIcon && <StatusIcon size={9} />} {cfg.label}
                        </span>
                      )}
                      {!sub && <span className="text-[0.6rem] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">Not Uploaded</span>}
                    </div>
                    {req.description && <p className="text-xs text-[#777587] mt-0.5">{req.description}</p>}
                    {sub?.rejection_reason && (
                      <p className="text-xs text-rose-600 mt-1 flex items-start gap-1">
                        <XCircle size={11} className="flex-shrink-0 mt-0.5" />
                        {sub.rejection_reason}
                      </p>
                    )}
                    {sub?.uploaded_at && (
                      <p className="text-[0.65rem] text-[#9ca3af] mt-0.5">
                        Uploaded {fmtDate(sub.uploaded_at)}
                        {sub.reviewer?.name && ` · By ${sub.reviewer.name}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* In-app viewer — opens a modal, NOT a new tab */}
                    {sub?.file_url && (
                      <button
                        onClick={() => setViewDoc({ url: sub.file_url, name: req.name })}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#c7c4d8] bg-white text-[0.7rem] font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-all">
                        <Eye size={11} /> View
                      </button>
                    )}
                    {/* Upload / Replace */}
                    {(notUploaded || canReplace) && (
                      <>
                        <input
                          type="file"
                          className="hidden"
                          accept={req.accepted_formats?.map(f => `.${f}`).join(',') || '.pdf,.jpg,.png'}
                          ref={el => { fileInputRefs.current[req.id] = el; }}
                          onChange={e => handleUpload(req.id, e.target.files?.[0])}
                        />
                        <button
                          onClick={() => fileInputRefs.current[req.id]?.click()}
                          disabled={uploading[req.id]}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#3525cd] text-white text-[0.7rem] font-bold hover:bg-[#4f46e5] transition-colors disabled:opacity-60">
                          {uploading[req.id]
                            ? <><Loader2 size={11} className="animate-spin" /> Uploading…</>
                            : <><Upload size={11} /> {sub ? 'Replace' : 'Upload'}</>
                          }
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {req.accepted_formats?.length > 0 && (
                  <p className="text-[0.6rem] text-[#9ca3af]">
                    Accepted: {req.accepted_formats.join(', ').toUpperCase()}
                    {req.max_file_size_mb ? ` · Max ${req.max_file_size_mb} MB` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </>
  );
}

function WorkTab({ empId, isAdmin, emp }) {
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const basePath  = user?.role === 'root_admin' ? '/root' : '';

  const { data: assets = [] } = useQuery({
    queryKey: ['emp-assets', empId],
    queryFn: () => apiGet('/assets', { userId: empId }),
  });
  const { data: docs = [] } = useQuery({
    queryKey: ['emp-docs', empId],
    queryFn: () => apiGet('/documents', { userId: empId }),
  });

  return (
    <div className="space-y-5">
      {/* Assets */}
      <SectionCard title="Assigned Assets" icon={Briefcase}>
        {assets.length === 0 ? <EmptyState icon={Briefcase} text="No assets assigned" /> : (
          <div className="space-y-2">
            {assets.map(a => (
              <div key={a.id} className="flex items-center justify-between py-2.5 border-b border-[#f0f3ff] last:border-0">
                <div>
                  <p className="text-sm font-semibold text-[#151c27]">{a.name}</p>
                  <p className="text-xs text-[#777587]">{a.category}{a.serial_number && ` · ${a.serial_number}`}</p>
                </div>
                <span className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full ${a.status === 'assigned' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{a.status}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Documents */}
      <SectionCard title="Documents" icon={FileText}>
        {docs.length === 0 ? <EmptyState icon={FileText} text="No documents uploaded" /> : (
          <div className="space-y-2">
            {docs.map(d => (
              <div key={d.id} className="flex items-center justify-between py-2.5 border-b border-[#f0f3ff] last:border-0">
                <div>
                  <p className="text-sm font-semibold text-[#151c27]">{d.name}</p>
                  <p className="text-xs text-[#777587]">{d.category}</p>
                </div>
                {d.file_url && <a href={d.file_url} target="_blank" rel="noreferrer" className="p-1.5 rounded hover:bg-[#f0f3ff] text-[#3525cd]"><Download size={14}/></a>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate(`${basePath}/reports?userId=${empId}`)}
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#c7c4d8] hover:border-[#3525cd]/40 hover:bg-[#f0f3ff] hover:-translate-y-0.5 transition-all text-left group shadow-sm">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] group-hover:bg-[#3525cd] flex items-center justify-center flex-shrink-0 transition-colors">
            <BarChart3 size={16} className="text-[#3525cd] group-hover:text-white transition-colors" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#151c27]">Attendance Records</p>
            <p className="text-[0.68rem] text-[#777587] mt-0.5">View reports page →</p>
          </div>
        </button>
        <button
          onClick={() => navigate(`${basePath}/leaves?userId=${empId}`)}
          className="flex items-center gap-3 p-4 bg-white rounded-xl border border-[#c7c4d8] hover:border-[#3525cd]/40 hover:bg-[#f0f3ff] hover:-translate-y-0.5 transition-all text-left group shadow-sm">
          <div className="w-9 h-9 rounded-xl bg-[#f0f3ff] group-hover:bg-[#3525cd] flex items-center justify-center flex-shrink-0 transition-colors">
            <Umbrella size={16} className="text-[#3525cd] group-hover:text-white transition-colors" />
          </div>
          <div>
            <p className="text-sm font-bold text-[#151c27]">Leave History</p>
            <p className="text-[0.68rem] text-[#777587] mt-0.5">View leaves page →</p>
          </div>
        </button>
      </div>

      {/* ── Leave Balance ── */}
      <LeaveBalanceSection empId={empId} isAdmin={isAdmin} />
    </div>
  );
}

// ─── Section: Performance Tab ─────────────────────────────────────────────────

function PerformanceTab({ empId, isAdmin }) {
  const toast = useToast();
  const qc    = useQueryClient();
  const { data: goals   = [], isLoading: gLoad } = useQuery({ queryKey: ['emp-goals',   empId], queryFn: () => apiGet('/performance/goals',   { userId: empId }) });
  const { data: reviews = [] }                   = useQuery({ queryKey: ['emp-reviews', empId], queryFn: () => apiGet('/performance/reviews', { userId: empId }) });
  const { data: exits   = [] }                   = useQuery({ queryKey: ['emp-exit',    empId], queryFn: () => apiGet('/exit',                { userId: empId }) });

  const [reviewModal, setReviewModal] = useState(false);
  const [rForm, setRForm]             = useState({ review_cycle: '', review_type: 'annual' });

  // BUG_209: create review mutation
  const reviewMut = useMutation({
    mutationFn: body => apiPost('/performance/reviews', { ...body, user_id: empId }),
    onSuccess: () => { toast('Review started', 'success'); qc.invalidateQueries({ queryKey: ['emp-reviews', empId] }); setReviewModal(false); },
    onError: e => toast(e.message, 'error'),
  });

  const exitReq = exits[0];

  return (
    <div className="space-y-5">
      {/* Goals */}
      <SectionCard title="Performance Goals" icon={BarChart3}>
        {gLoad ? <LoadingSection /> : goals.length === 0 ? <EmptyState icon={BarChart3} text="No goals set" /> : (
          <div className="space-y-3">
            {goals.map(g => (
              <div key={g.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff]">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-bold text-[#151c27]">{g.title}</p>
                  <span className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${g.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>{g.status}</span>
                </div>
                <div className="w-full bg-[#e7eefe] rounded-full h-1.5"><div className="h-1.5 rounded-full bg-[#3525cd] transition-all" style={{ width: `${g.progress || 0}%` }}/></div>
                <p className="text-xs text-[#777587] mt-1">{g.progress || 0}% · {g.review_cycle}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Reviews — BUG_209: Add Review button for admins */}
      <SectionCard title="Performance Reviews" icon={Activity}
        action={isAdmin && <AdminBtn onClick={() => { setRForm({ review_cycle: '', review_type: 'annual' }); setReviewModal(true); }} label="Add Review" />}>
        {reviews.length === 0 ? <EmptyState icon={Activity} text="No reviews recorded" /> : (
          <div className="space-y-3">
            {reviews.map(r => (
              <div key={r.id} className="p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff]">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-bold text-[#151c27]">{r.review_cycle} · {r.review_type}</p>
                  {r.final_rating && <span className="text-sm font-black text-[#3525cd]">{r.final_rating}/5</span>}
                </div>
                <span className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded-full ${r.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Add Review Modal */}
      <Modal open={reviewModal} onClose={() => setReviewModal(false)} title="Start Performance Review" size="sm"
        footer={<div className="flex justify-end gap-3">
          <button className="btn btn-outline" onClick={() => setReviewModal(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={reviewMut.isPending} onClick={() => {
            if (!(rForm.review_cycle||'').trim()) { toast('Review Cycle is required (e.g. Q1 2026, Annual 2026).', 'error'); return; }
            reviewMut.mutate(rForm);
          }}>{reviewMut.isPending ? 'Creating…' : 'Start Review'}</button>
        </div>}>
        <div className="space-y-4">
          <div><label className="form-label">Review Cycle <span className="text-rose-500">*</span></label>
            <input className="form-control" placeholder="e.g. Q1 2026, Annual 2026" value={rForm.review_cycle} onChange={e => setRForm(f => ({...f, review_cycle: e.target.value}))} /></div>
          <div><label className="form-label">Review Type</label>
            <select className="form-control" value={rForm.review_type} onChange={e => setRForm(f => ({...f, review_type: e.target.value}))}>
              {[['annual','Annual'],['mid_year','Mid-Year'],['quarterly','Quarterly'],['probation','Probation'],['adhoc','Ad-hoc']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
        </div>
      </Modal>

      {/* Exit */}
      {exitReq && (
        <SectionCard title="Exit Information" icon={AlertCircle}>
          <InfoRow label="Resignation Date"  value={exitReq.resignation_date ? fmtDate(exitReq.resignation_date) : null} />
          <InfoRow label="Last Working Day"  value={exitReq.last_working_day  ? fmtDate(exitReq.last_working_day)  : null} />
          <InfoRow label="Notice Period"     value={exitReq.notice_period_days ? `${exitReq.notice_period_days} days` : null} />
          <InfoRow label="Reason"            value={exitReq.reason} />
          <InfoRow label="Status"            value={exitReq.status} />
        </SectionCard>
      )}
    </div>
  );
}

// ─── Section: System Tab ─────────────────────────────────────────────────────
// Visible only to root_admin — login info, roles, internal settings

const AVATAR_COLORS_OPTS = ['#3525cd','#10B981','#F59E0B','#EF4444','#712ae2','#F97316','#4f46e5','#EC4899'];

function SystemTab({ emp, onEdit }) {
  const toast           = useToast();
  const qc              = useQueryClient();
  const biometricEnabled = useFeature('biometric');
  const [internalEditing, setInternalEditing] = useState(false);
  const [form, setForm] = useState({});
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Internal settings are saved through the professional endpoint (adminOnly on backend)
  const internalMut = useMutation({
    mutationFn: (body) => apiPut(`/profile/${emp.id}/professional`, body),
    onSuccess: () => {
      toast('Internal settings saved', 'success');
      qc.invalidateQueries({ queryKey: ['epv2-professional', emp.id] });
      qc.invalidateQueries({ queryKey: ['epv2-overview',     emp.id] });
      setInternalEditing(false);
    },
    onError: e => toast(e.message, 'error'),
  });

  const openInternal = () => {
    setForm({
      salary_on:          emp.salary_on         || 'Month',
      salary_structure:   emp.salary_structure  || 'GROSS',
      work_hours_per_day: emp.work_hours_per_day || 8,
      weekly_off_day:     emp.weekly_off_day     || '',
      device_enrollment_id: emp.device_enrollment_id || '',
      avatar_color:       emp.avatar_color       || AVATAR_COLORS_OPTS[0],
    });
    setInternalEditing(true);
  };

  return (
    <div className="space-y-5">
      {/* Login Information — display only, not editable here */}
      <SectionCard title="Login Information" icon={Key}>
        <InfoRow label="Company Email"   value={emp.email}           icon={Mail} />
        <InfoRow label="Role"            value={emp.role}            icon={Shield} />
        <InfoRow label="Employee ID"     value={emp.employee_id}     icon={Fingerprint} />
        <InfoRow label="Employee Status" value={emp.employee_status} />
        <InfoRow label="Account Created" value={emp.created_at ? fmtDate(emp.created_at) : null} />
      </SectionCard>

      {/* Account Actions — these are account-level actions, intentionally kept as action buttons */}
      <SectionCard title="Account Actions" icon={Settings}>
        <div className="space-y-1">
          {[
            ['Reset Password',     'Send a password reset to the employee\'s company email', 'account',  Key,         true],
            ['Edit Role & Status', 'Change role, employment status, avatar colour',          'account',  Pencil,      true],
            ['Biometric / RFID',   'Update device enrollment PIN or RFID card number',      'extended', Fingerprint, biometricEnabled],
          ].filter(([,,,,show]) => show).map(([label, desc, tab, Icon]) => (
            <div key={label} className="flex items-center justify-between py-3 border-b border-[#f0f3ff] last:border-0">
              <div>
                <p className="text-sm font-semibold text-[#151c27]">{label}</p>
                <p className="text-xs text-[#777587]">{desc}</p>
              </div>
              <button onClick={() => onEdit(emp, tab)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/40 transition-all">
                <Icon size={12}/> Manage
              </button>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Internal Settings — inline editable */}
      <SectionCard title="Internal Settings" icon={Settings}
        action={!internalEditing && <AdminBtn onClick={openInternal} />}>
        {internalEditing ? (
          <div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Salary On</label>
                <select className="form-control" value={form.salary_on||'Month'} onChange={e=>set('salary_on',e.target.value)}>
                  {['Month','Day','Hour'].map(v=><option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Salary Structure</label>
                <select className="form-control" value={form.salary_structure||'GROSS'} onChange={e=>set('salary_structure',e.target.value)}>
                  {['GROSS','CTC','NET'].map(v=><option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Work Hours / Day</label>
                <input type="number" className="form-control" min="1" max="24" value={form.work_hours_per_day||8} onChange={e=>set('work_hours_per_day',Number(e.target.value))}/>
              </div>
              <div>
                <label className="form-label">Weekly Off</label>
                <select className="form-control" value={form.weekly_off_day||''} onChange={e=>set('weekly_off_day',e.target.value)}>
                  <option value="">— None / Use org schedule —</option>
                  {['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map(d=><option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Device / Biometric PIN</label>
                <input className="form-control" value={form.device_enrollment_id||''} onChange={e=>set('device_enrollment_id',e.target.value)} placeholder="Enrollment ID"/>
              </div>
              <div>
                <label className="form-label">Avatar Colour</label>
                <div className="flex gap-2 flex-wrap mt-1">
                  {AVATAR_COLORS_OPTS.map(c=>(
                    <button key={c} type="button" onClick={()=>set('avatar_color',c)}
                      className="w-7 h-7 rounded-full border-2 flex-shrink-0 transition-transform hover:scale-110"
                      style={{ background:c, borderColor: form.avatar_color===c ? '#151c27' : 'transparent', outline: form.avatar_color===c ? '2px solid #BAE6FD' : 'none' }}/>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-[#f0f3ff]">
              <button className="btn btn-outline" onClick={() => setInternalEditing(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={internalMut.isPending}
                onClick={() => {
                  const hrs = Number(form.work_hours_per_day);
                  if (isNaN(hrs) || hrs < 1 || hrs > 24) { toast('Work hours must be between 1 and 24','error'); return; }
                  internalMut.mutate(form);
                }}>
                {internalMut.isPending ? <><Loader2 size={13} className="animate-spin mr-1"/>Saving…</> : <><Save size={13} className="mr-1"/>Save</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6">
            <InfoRow label="Salary On"        value={emp.salary_on} />
            <InfoRow label="Salary Structure" value={emp.salary_structure} />
            <InfoRow label="Work Hours / Day" value={emp.work_hours_per_day ? `${emp.work_hours_per_day}h` : null} />
            <InfoRow label="Weekly Off"       value={emp.weekly_off_day} />
            <InfoRow label="Device PIN"       value={emp.device_enrollment_id} />
            <InfoRow label="Avatar Colour" value={emp.avatar_color ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full inline-block border border-[#c7c4d8]" style={{ background: emp.avatar_color }}/>
                {emp.avatar_color}
              </span>
            ) : null} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Leave Balance Adjust Modal ───────────────────────────────────────────────
// adjusting = { leave_type (null = multi-select), label, available }
// balances  = full list — passed so modal can show a leave type dropdown when needed
function AdjustBalanceModal({ empId, leaveType: initLeaveType, leaveLabel: initLabel, curYear, currentAvailable, balances = [], onClose }) {
  const toast = useToast();
  const qc    = useQueryClient();

  // When opened from the header "Adjust Balance" button, leave_type may be null (multi leave types)
  const [selectedType, setSelectedType] = useState(initLeaveType || '');
  const [action, setAction] = useState('add');   // 'add' | 'deduct'
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const leaveType  = selectedType;
  const leaveLabel = initLabel || balances.find(b => b.leave_type === selectedType)?.label || selectedType;
  const selBalance = balances.find(b => b.leave_type === selectedType);
  const available  = selBalance
    ? Number(selBalance.allocated) + Number(selBalance.adjustment || 0) - Number(selBalance.used)
    : currentAvailable;

  const mut = useMutation({
    mutationFn: () => {
      if (!leaveType) throw new Error('Select a leave type');
      const parsed = parseFloat(amount);
      if (!parsed || parsed <= 0) throw new Error('Enter a valid amount (e.g. 1 or 0.5)');
      if (!reason.trim()) throw new Error('Reason is required');
      const delta = action === 'add' ? parsed : -parsed;
      return apiPost('/leaves/balance/adjust', {
        userId: empId, leave_type: leaveType,
        delta, reason: reason.trim(), year: curYear,
      });
    },
    onSuccess: () => {
      toast('Leave balance adjusted', 'success');
      qc.invalidateQueries({ queryKey: ['emp-balance',      empId, curYear] });
      qc.invalidateQueries({ queryKey: ['emp-adj-history',  empId, curYear] });
      onClose();
    },
    onError: e => toast(e.message, 'error'),
  });

  const previewDelta = parseFloat(amount) || 0;
  const previewAvail = action === 'add'
    ? available + previewDelta
    : available - previewDelta;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,6,14,.55)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm border border-[#c7c4d8]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e7eefe]">
          <div>
            <p className="font-black text-[#151c27] text-sm">Adjust Leave Balance</p>
            <p className="text-xs text-[#777587]">{leaveLabel || 'Select leave type'} · {curYear}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f0f3ff] flex items-center justify-center">
            <X size={15} className="text-[#777587]" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Leave type selector — shown only when multiple leave types exist and none pre-selected */}
          {!initLeaveType && balances.length > 1 && (
            <div>
              <p className="text-[0.7rem] font-bold text-[#464555] mb-1">Leave Type <span className="text-rose-500">*</span></p>
              <select value={selectedType} onChange={e => setSelectedType(e.target.value)}
                className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] bg-white">
                <option value="">— Select leave type —</option>
                {balances.map(b => <option key={b.leave_type} value={b.leave_type}>{b.label}</option>)}
              </select>
            </div>
          )}
          {/* Add / Deduct toggle */}
          <div>
            <p className="text-[0.7rem] font-bold text-[#464555] mb-1.5">Action</p>
            <div className="grid grid-cols-2 gap-2">
              {[['add', 'Add Days', 'text-emerald-700 border-emerald-300 bg-emerald-50'],
                ['deduct', 'Deduct Days', 'text-rose-700 border-rose-300 bg-rose-50']].map(([v, l, cls]) => (
                <button key={v} type="button" onClick={() => setAction(v)}
                  className={`py-2 rounded-xl border-2 text-sm font-bold transition-all ${action === v ? cls + ' ring-2 ring-offset-1 ' + (v === 'add' ? 'ring-emerald-400' : 'ring-rose-400') : 'border-[#c7c4d8] text-[#464555] bg-white hover:bg-[#f9f9ff]'}`}>
                  {v === 'add' ? <TrendingUp size={13} className="inline mr-1" /> : <TrendingDown size={13} className="inline mr-1" />}
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-[0.7rem] font-bold text-[#464555] mb-1">
              Days <span className="font-normal text-[#777587]">(0.5 for half-day)</span>
            </label>
            <input
              type="number" min={0.5} step={0.5} placeholder="e.g. 1 or 0.5"
              value={amount} onChange={e => setAmount(e.target.value)}
              onWheel={e => e.target.blur()}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd]"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-[0.7rem] font-bold text-[#464555] mb-1">
              Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={2} placeholder="e.g. Opening balance correction for FY 2026"
              value={reason} onChange={e => setReason(e.target.value)}
              className="w-full border border-[#c7c4d8] rounded-lg px-3 py-2 text-sm text-[#151c27] focus:outline-none focus:border-[#3525cd] resize-none"
            />
          </div>

          {/* Preview */}
          {previewDelta > 0 && (
            <div className="rounded-xl bg-[#f0f3ff] border border-[#e7eefe] px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#777587]">Available after adjustment</span>
              <span className={`text-base font-black ${previewAvail < 0 ? 'text-rose-600' : 'text-[#3525cd]'}`}>
                {previewAvail % 1 === 0 ? previewAvail : previewAvail.toFixed(1)} days
                {previewAvail < 0 && <span className="text-xs font-normal ml-1">(deficit)</span>}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#e7eefe]">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-[#464555] border border-[#c7c4d8] rounded-xl hover:bg-[#f0f3ff] transition-colors">
            Cancel
          </button>
          <button onClick={() => mut.mutate()} disabled={mut.isPending || !amount || !reason.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#3525cd] text-white rounded-xl text-sm font-bold hover:bg-[#2a1fb0] disabled:opacity-60 transition-colors">
            {mut.isPending
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              : <><Save size={13} /> Save Adjustment</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Leave Balance Section ────────────────────────────────────────────────────
function LeaveBalanceSection({ empId, isAdmin }) {
  const curYear = new Date().getFullYear();

  const { data, isLoading } = useQuery({
    queryKey: ['emp-balance', empId, curYear],
    queryFn:  () => apiGet('/leaves/balance', { userId: empId, year: curYear }),
    staleTime: 60000,
  });

  const { data: adjHistory = [], isLoading: hLoad } = useQuery({
    queryKey: ['emp-adj-history', empId, curYear],
    queryFn:  () => apiGet('/leaves/balance/adjustments', { userId: empId, year: curYear }),
    enabled:  isAdmin,
    staleTime: 30000,
  });

  const [adjusting, setAdjusting]     = useState(null);   // { leave_type, label, available }
  const [showHistory, setShowHistory] = useState(false);

  const balances = (data?.balances || []).filter(b => b.leave_type !== 'wfh');
  if (!isLoading && balances.length === 0) return null;

  return (
    <>
      <SectionCard
        title={`Leave Balance ${curYear}`}
        icon={Umbrella}
        action={isAdmin && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAdjusting({ leave_type: balances.length === 1 ? balances[0].leave_type : null, label: balances.length === 1 ? balances[0].label : null, available: balances.length === 1 ? Number(balances[0].allocated) + Number(balances[0].adjustment || 0) - Number(balances[0].used) : 0 })}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#3525cd]/30 bg-[#f0f3ff] text-[0.7rem] font-bold text-[#3525cd] hover:bg-[#3525cd] hover:text-white transition-all">
              <Plus size={11} /> Adjust Balance
            </button>
            {adjHistory.length > 0 && (
              <button onClick={() => setShowHistory(s => !s)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#c7c4d8] bg-white text-[0.7rem] font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/40 transition-all">
                <History size={11} />
                {showHistory ? 'Hide History' : `History (${adjHistory.length})`}
              </button>
            )}
          </div>
        )}
      >
        {isLoading ? <LoadingSection /> : (
          <div className="space-y-4">
            {/* ── Balance Table ── */}
            <div className="rounded-xl border border-[#e7eefe] overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-3 py-2 bg-[#fafaff] border-b border-[#f0f3ff]">
                {['Leave Type','Allocated','Adj.','Used','Available'].map(h => (
                  <p key={h} className="text-[0.62rem] font-black uppercase tracking-wider text-[#9ca3af] text-right first:text-left">{h}</p>
                ))}
              </div>
              {/* Rows */}
              {balances.map(b => {
                const adj       = Number(b.adjustment || 0);
                const available = Number(b.allocated) + adj - Number(b.used);
                const isLow     = available <= 2 && b.allocated > 0;
                const isDeficit = available < 0;
                return (
                  <div key={b.leave_type}
                    className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 px-3 py-2.5 border-b border-[#f0f3ff] last:border-0 items-center hover:bg-[#fafaff] transition-colors">
                    {/* Leave type */}
                    <span className="text-sm font-semibold text-[#151c27]">{b.label}</span>
                    {/* Allocated */}
                    <p className="text-sm text-[#464555] text-right">{b.allocated}</p>
                    {/* Adjustment */}
                    <p className={`text-sm font-semibold text-right ${adj > 0 ? 'text-emerald-600' : adj < 0 ? 'text-rose-600' : 'text-[#c7c4d8]'}`}>
                      {adj > 0 ? '+' : ''}{adj !== 0 ? adj : '—'}
                    </p>
                    {/* Used */}
                    <p className="text-sm font-semibold text-rose-600 text-right">{Number(b.used)}</p>
                    {/* Available */}
                    <p className={`text-sm font-black text-right ${isDeficit ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {available % 1 === 0 ? available : available.toFixed(1)}
                      {isDeficit && <span className="text-[0.6rem] font-normal ml-0.5">⚠</span>}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* ── Pending note ── */}
            {balances.some(b => b.pending > 0) && (
              <p className="text-[0.65rem] text-amber-600 flex items-center gap-1">
                <AlertCircle size={11} />
                {balances.filter(b => b.pending > 0).map(b => `${b.label}: ${b.pending} day(s) pending approval`).join(' · ')}
              </p>
            )}

            {/* ── Adjustment History (admin only, collapsible) ── */}
            {isAdmin && showHistory && (
              <div className="space-y-2 pt-1 border-t border-[#f0f3ff]">
                <p className="text-[0.65rem] font-black uppercase tracking-wider text-[#777587] pt-1">
                  Adjustment History
                </p>
                {hLoad ? <LoadingSection /> : adjHistory.length === 0 ? (
                  <p className="text-xs text-[#9ca3af] text-center py-3">No adjustments recorded for {curYear}</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {adjHistory.map(h => (
                      <div key={h.id}
                        className="flex items-start justify-between gap-3 p-2.5 rounded-lg border border-[#f0f3ff] bg-[#fafaff]">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[#151c27] leading-snug">{h.reason}</p>
                          <p className="text-[0.62rem] text-[#9ca3af] mt-0.5">
                            {h.leave_type} · {h.adjusted_by_name || 'HR'} · {new Date(h.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                        <span className={`text-sm font-black flex-shrink-0 ${Number(h.delta) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {Number(h.delta) > 0 ? '+' : ''}{Number(h.delta) % 1 === 0 ? Number(h.delta) : Number(h.delta).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* Adjust modal — rendered outside SectionCard to avoid z-index issues */}
      {adjusting && (
        <AdjustBalanceModal
          empId={empId}
          leaveType={adjusting.leave_type}
          leaveLabel={adjusting.label}
          curYear={curYear}
          currentAvailable={adjusting.available}
          balances={balances}
          onClose={() => setAdjusting(null)}
        />
      )}
    </>
  );
}

function CircularProgress({ value = 0 }) {
  const r    = 38;
  const circ = 2 * Math.PI * r;
  const off  = circ - (Math.min(100, Math.max(0, value)) / 100) * circ;
  return (
    <div className="relative w-24 h-24">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#e7eefe" strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" stroke="#3525cd" strokeWidth="9"
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-black text-[#3525cd]">{value}%</span>
      </div>
    </div>
  );
}

// ─── Status config for profile page ─────────────────────────────────────────
const PROFILE_STATUS_CFG = {
  active:     { label: 'Active',     cls: 'bg-emerald-100 text-emerald-700' },
  on_leave:   { label: 'On Leave',   cls: 'bg-amber-100 text-amber-700' },
  inactive:   { label: 'Inactive',   cls: 'bg-slate-100 text-slate-600' },
  resigned:   { label: 'Resigned',   cls: 'bg-rose-100 text-rose-700' },
  terminated: { label: 'Terminated', cls: 'bg-red-200 text-red-800' },
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function EmployeeProfileV2({ emp, onBack, onEdit }) {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin' || user.role === 'root_admin';
  const isRoot  = user.role === 'root_admin';
  const branchingEnabled = useFeature('branches');

  const now = new Date();
  const [currentTab, setCurrentTab] = useState('overview');

  const curMonth = now.getMonth() + 1;
  const curYear  = now.getFullYear();
  const today    = now.toISOString().split('T')[0];

  const { data: curAttendance = [] } = useQuery({
    queryKey: ['emp-att-cur', emp.id, curYear, curMonth],
    queryFn: () => apiGet('/attendance', { year: curYear, month: curMonth, userId: emp.id }),
    staleTime: 60000,
  });
  const { data: curLeaves = [] } = useQuery({
    queryKey: ['emp-leaves-cur', emp.id, curYear, curMonth],
    queryFn: () => apiGet('/leaves', { userId: emp.id, year: curYear, month: curMonth }),
    staleTime: 60000,
  });
  const { data: overview = {} } = useQuery({
    queryKey: ['epv2-overview', emp.id],
    queryFn: () => apiGet(`/profile/${emp.id}/overview`),
    staleTime: 60000,
  });

  const { data: curHolidays = [] } = useQuery({
    queryKey: ['holidays', curYear],
    queryFn:  () => apiGet('/holidays', { year: curYear }),
    staleTime: 60 * 60 * 1000,
  });

  const { data: workSchedule } = useQuery({
    queryKey: ['work-schedule'],
    queryFn:  () => apiGet('/settings/schedule'),
    staleTime: 5 * 60 * 1000,
  });
  // 0=Sun,1=Mon,...,6=Sat; default Mon-Fri
  const workDaySet = new Set(
    workSchedule?.work_days ? workSchedule.work_days.split(',').map(Number) : [1,2,3,4,5]
  );

  // Holiday dates in the current month as a Set for O(1) lookup
  const curMonthPrefix = `${curYear}-${String(curMonth).padStart(2,'0')}`;
  const holidaySet = new Set(curHolidays.filter(h => h.date?.startsWith(curMonthPrefix)).map(h => h.date));

  const todayRecord = curAttendance.find(r => r.date === today);

  // "Present Days" stat card — full-day physical presence on working days (excludes weekends/holidays)
  const presentCount = curAttendance.filter(r => {
    if (!['present','half_day','wfh'].includes(r.status)) return false;
    const d = new Date(r.date + 'T12:00:00');
    return workDaySet.has(d.getDay()) && !holidaySet.has(r.date);
  }).length;

  // Attendance % numerator — any day the employee physically came in, including late-arrival days
  // (late entries are recorded as is_late=true even if payroll marks the day absent due to cut-off)
  const attendanceDays = curAttendance.filter(r => {
    const d = new Date(r.date + 'T12:00:00');
    if (!workDaySet.has(d.getDay()) || holidaySet.has(r.date)) return false;
    return ['present','half_day','wfh','early_leave'].includes(r.status) || r.is_late === true;
  }).length;

  const leaveCount = curLeaves.filter(l => l.status === 'approved').length;
  const lateCount  = curAttendance.filter(r => r.is_late).length;

  const empName   = [emp.salutation, emp.name, emp.middle_name, emp.surname].filter(Boolean).join(' ');
  const deptLabel = emp.departments?.length > 0 ? emp.departments.map(d => d.name).join(', ') : emp.department || '—';
  const statusKey = emp.employee_status || 'active';
  const statusCfg = PROFILE_STATUS_CFG[statusKey] || PROFILE_STATUS_CFG.active;

  const TABS = TABS_ALL.filter(t => (!t.adminOnly || isAdmin) && (!t.rootOnly || isRoot));

  // Denominator: working days elapsed this month. Exclude today if no attendance record
  // exists yet for today (day still in progress — don't penalise for an unrecorded current day).
  const lastDay = todayRecord
    ? new Date(curYear, curMonth - 1, now.getDate())
    : new Date(curYear, curMonth - 1, now.getDate() - 1);

  const workingDaysElapsed = (() => {
    let count = 0;
    const first = new Date(curYear, curMonth - 1, 1);
    for (let d = new Date(first); d <= lastDay; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().split('T')[0];
      if (workDaySet.has(d.getDay()) && !holidaySet.has(ds)) count++;
    }
    return count;
  })();

  // Cap at 100% — attendance cannot exceed 100% of working days
  const attendancePct = workingDaysElapsed > 0
    ? Math.min(100, Math.round((attendanceDays / workingDaysElapsed) * 100))
    : 0;

  const STAT_CARDS = [
    { label: 'Present Days', value: presentCount,        sub: 'This Month', icon: UserCheck,    iconBg: 'bg-emerald-50', iconClr: 'text-emerald-600', border: 'border-emerald-100' },
    { label: 'Leaves',       value: leaveCount,          sub: 'This Month', icon: Umbrella,     iconBg: 'bg-amber-50',   iconClr: 'text-amber-600',   border: 'border-amber-100' },
    { label: 'Late Marks',   value: lateCount,           sub: 'This Month', icon: AlarmClock,   iconBg: 'bg-rose-50',    iconClr: 'text-rose-500',    border: 'border-rose-100' },
    { label: 'Attendance',   value: `${attendancePct}%`, sub: 'This Month', icon: CheckCircle2, iconBg: 'bg-blue-50',    iconClr: 'text-blue-600',    border: 'border-blue-100' },
  ];

  return (
    <div className="space-y-4">

      {/* ── Action Bar ── */}
      <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm px-4 py-3 flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-[#464555] hover:text-[#3525cd] transition-colors">
          <ArrowLeft size={16} /> Back to Employees
        </button>
        <div className="flex-1" />
        {isAdmin && (
          <>
            <button onClick={() => onEdit(emp, 'account')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] hover:border-[#3525cd]/40 transition-all">
              <Key size={12} /> Reset Password
            </button>
          </>
        )}
        <button onClick={() => setCurrentTab('work')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-emerald-50 hover:text-emerald-700 transition-all">
          <UserCheck size={12} /> Attendance
        </button>
        <button onClick={() => setCurrentTab('performance')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#c7c4d8] bg-white text-xs font-bold text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd] transition-all">
          <BarChart3 size={12} /> Performance
        </button>
      </div>

      {/* ── Full-Width Hero Section ── */}
      <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm p-6">
        <div className="flex gap-6 items-start">

          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {emp.profile_photo_url
              ? <img src={emp.profile_photo_url} alt={empName} className="w-24 h-24 rounded-full object-cover ring-4 ring-[#e7eefe] shadow" />
              : <Avatar name={emp.name} color={emp.avatar_color} size={96} className="ring-4 ring-[#e7eefe]" />
            }
            <div className={`absolute bottom-1 right-1 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm ${todayRecord ? 'bg-emerald-400' : 'bg-slate-300'}`} />
          </div>

          {/* Core info */}
          <div className="flex-1 min-w-0">
            {/* Name + badges */}
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-2xl font-black text-[#151c27]">{empName}</h2>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full capitalize ${statusCfg.cls}`}>{statusCfg.label}</span>
              {todayRecord && <StatusBadge status={todayRecord.status} />}
            </div>

            {/* Position / Title */}
            <p className="text-sm font-semibold text-[#464555] mb-3">{emp.position || '—'}</p>

            {/* Info row */}
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-[#777587]">
              <span className="flex items-center gap-1.5"><Building2 size={13} className="text-[#3525cd]" />{deptLabel}</span>
              {branchingEnabled && overview.branch?.name && <span className="flex items-center gap-1.5"><MapPin size={13} className="text-[#3525cd]" />{overview.branch.name}</span>}
              {emp.email && <span className="flex items-center gap-1.5"><Mail size={13} className="text-[#3525cd]" />{emp.email}</span>}
              {emp.phone && <span className="flex items-center gap-1.5"><Phone size={13} className="text-[#3525cd]" />{emp.phone}</span>}
            </div>
            {emp.joining_date && (
              <div className="flex items-center gap-1.5 text-xs text-[#777587] mt-1.5">
                <Calendar size={13} className="text-[#3525cd]" />
                Joined {fmtDate(emp.joining_date)}
              </div>
            )}

            {/* Tag pills */}
            <div className="flex flex-wrap gap-2 mt-3">
              {emp.employee_id && (
                <span className="text-[0.7rem] font-bold px-2.5 py-1 rounded-full bg-[#f0f3ff] text-[#3525cd] border border-[#e7eefe]">
                  ID: {emp.employee_id}
                </span>
              )}
              {emp.employment_type && (
                <span className="text-[0.7rem] font-bold px-2.5 py-1 rounded-full bg-[#f9f9ff] text-[#464555] border border-[#c7c4d8] capitalize">
                  {emp.employment_type.replace('_', ' ')}
                </span>
              )}
              {emp.work_mode && (
                <span className="text-[0.7rem] font-bold px-2.5 py-1 rounded-full bg-[#f9f9ff] text-[#464555] border border-[#c7c4d8] capitalize">
                  {emp.work_mode}
                </span>
              )}
            </div>
          </div>

          {/* Profile completion ring */}
          {overview.profileCompletion !== undefined && (
            <div className="flex-shrink-0 text-center">
              <p className="text-xs font-bold text-[#464555] mb-2">Profile Completion</p>
              <CircularProgress value={overview.profileCompletion} />
              <p className="text-[0.65rem] text-[#777587] mt-1.5">
                {Math.round(overview.profileCompletion / 20)} of 5 sections done
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Stats Row ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {STAT_CARDS.map(({ label, value, sub, icon: Icon, iconBg, iconClr, border }) => (
          <div key={label} className={`bg-white rounded-2xl border shadow-sm p-4 flex items-center gap-3 ${border}`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
              <Icon size={18} className={iconClr} />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-black text-[#151c27]">{value}</p>
              <p className="text-xs font-semibold text-[#464555] truncate">{label}</p>
              <p className="text-[0.65rem] text-[#777587]">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Two-Column Layout: Vertical Nav + Content ── */}
      <div className="flex gap-4 items-start">

        {/* ── Left sidebar navigation (desktop) ── */}
        <div className="hidden sm:block w-48 flex-shrink-0">
          <nav className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm p-2 sticky top-4">
            {TABS.map(tab => {
              const Icon     = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setCurrentTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-[0.8rem] font-semibold text-left transition-all mb-0.5 last:mb-0 ${
                    isActive
                      ? 'bg-[#3525cd] text-white shadow-sm'
                      : 'text-[#464555] hover:bg-[#f0f3ff] hover:text-[#3525cd]'
                  }`}>
                  <Icon size={14} className={isActive ? 'text-white' : 'text-[#9ca3af]'} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Right content panel ── */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-[#c7c4d8] shadow-sm">

          {/* Mobile: horizontal scroll tab bar */}
          <div className="flex overflow-x-auto border-b border-[#f0f3ff] sm:hidden">
            {TABS.map(tab => {
              const Icon     = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setCurrentTab(tab.id)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors flex-shrink-0 ${
                    isActive
                      ? 'border-[#3525cd] text-[#3525cd]'
                      : 'border-transparent text-[#777587] hover:text-[#151c27] hover:border-[#c7c4d8]'
                  }`}>
                  <Icon size={13} className={isActive ? 'text-[#3525cd]' : ''} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Section title pill */}
          <div className="px-5 pt-4 pb-1 hidden sm:block">
            <div className="flex items-center gap-2">
              {(() => { const t = TABS.find(t => t.id === currentTab); return t ? <><t.icon size={14} className="text-[#3525cd]" /><span className="text-xs font-black text-[#464555] uppercase tracking-wider">{t.label}</span></> : null; })()}
            </div>
          </div>

          {/* Content */}
          <div className="p-5">
            {currentTab === 'overview' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {[
                    ['Department',   deptLabel,              Building2],
                    ['Position',     emp.position,           Briefcase],
                    ['Employment',   emp.employment_type?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), Users],
                    ['Work Mode',    emp.work_mode,          Home],
                    ['Grade',        emp.grade,              Award],
                    ...(branchingEnabled ? [['Branch', overview.branch?.name, MapPin]] : []),
                    ['Manager',      overview.manager?.name, User],
                    ['Joining Date', emp.joining_date ? fmtDate(emp.joining_date) : null, Calendar],
                    ['Status',       statusCfg.label,        CheckCircle2],
                  ].map(([l, v, Icon]) => (
                    <div key={l} className="flex items-center gap-3 p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff]">
                      <div className="w-8 h-8 rounded-lg bg-[#e7eefe] flex items-center justify-center flex-shrink-0">
                        <Icon size={14} className="text-[#3525cd]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[0.65rem] text-[#777587] font-medium">{l}</p>
                        <p className="text-sm font-bold text-[#151c27] truncate">{v || '—'}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {overview.sectionCounts && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.entries(overview.sectionCounts).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between p-3 rounded-xl border border-[#f0f3ff] bg-[#f9f9ff]">
                        <span className="text-xs font-semibold text-[#464555] capitalize">{k}</span>
                        <span className="text-sm font-black text-[#3525cd]">{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {currentTab === 'personal'     && <PersonalTab                 empId={emp.id} isAdmin={isAdmin} />}
            {currentTab === 'professional' && <ProfessionalTab             empId={emp.id} isAdmin={isAdmin} onEdit={onEdit} emp={emp} />}
            {currentTab === 'education'    && <EducationTab                empId={emp.id} isAdmin={isAdmin} />}
            {currentTab === 'compensation' && <CompensationTab             empId={emp.id} isAdmin={isAdmin} onEdit={onEdit} emp={emp} />}
            {currentTab === 'compliance'   && <ComplianceTab               empId={emp.id} onEdit={onEdit} emp={emp} />}
            {currentTab === 'work'         && <WorkTab                     empId={emp.id} isAdmin={isAdmin} emp={emp} />}
            {currentTab === 'documents'    && <DocumentRequirementsSection empId={emp.id} isAdmin={isAdmin} />}
            {currentTab === 'performance'  && <PerformanceTab              empId={emp.id} isAdmin={isAdmin} />}
            {currentTab === 'system'       && <SystemTab                   emp={emp} onEdit={onEdit} />}
          </div>
        </div>
      </div>
    </div>
  );
}
