import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Mail, Send } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api';
import { useEmployees } from '@/hooks/useEmployees';
import { useToast } from '@/context/ToastContext';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

// BUG_137: character limits
const TITLE_MAX   = 100;
const MESSAGE_MAX = 1000;
const SUBJECT_MAX = 150;

function CharCounter({ value, max }) {
  const over = value.length > max;
  return (
    <span className={`text-[0.65rem] font-semibold ml-1 ${over ? 'text-rose-500' : value.length > max * 0.85 ? 'text-amber-500' : 'text-[#c7c4d8]'}`}>
      {value.length}/{max}
    </span>
  );
}

function FieldError({ msg }) {
  if (!msg) return null;
  return <p className="text-[0.68rem] text-rose-500 mt-1">{msg}</p>;
}

function Section({ icon, title, iconBg, children }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[#f0f3ff]">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
          {icon}
        </div>
        <h2 className="font-black text-[#151c27] text-base">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function RecipientSelect({ value, onChange, employees, label }) {
  return (
    <div>
      <label className="form-label">{label}</label>
      <select className="form-control" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">All Employees</option>
        {employees.map(e => (
          <option key={e.id} value={e.id}>{e.name} — {e.department || e.role}</option>
        ))}
      </select>
    </div>
  );
}

export default function Broadcast() {
  const toast = useToast();

  const { data: allUsers = [] } = useEmployees({ lite: true });
  // BUG_135/136: exclude both root admins and HR admins — broadcast should reach employees only
  const employees = allUsers.filter(u => u.role !== 'root_admin' && u.role !== 'admin');

  const [nTitle,   setNTitle]   = useState('');
  const [nBody,    setNBody]    = useState('');
  const [nUrl,     setNUrl]     = useState('');
  const [nTarget,  setNTarget]  = useState('');
  const [nSending, setNSending] = useState(false);
  const [nErrors,  setNErrors]  = useState({});

  const [eSubject, setESubject] = useState('');
  const [eMessage, setEMessage] = useState('');
  const [eTarget,  setETarget]  = useState('');
  const [eSending, setESending] = useState(false);
  const [eErrors,  setEErrors]  = useState({});

  // BUG_138: confirmation dialog state
  const [confirm, setConfirm] = useState({ open: false, type: null });
  // EHN_BROAD_009: Draft storage (localStorage)
  const NOTIF_DRAFT_KEY = 'broadcast_notif_draft';
  const EMAIL_DRAFT_KEY = 'broadcast_email_draft';
  // EHN_BROAD_010: Recipient count preview
  const nRecipientCount = nTarget ? 1 : employees.length;
  const eRecipientCount = eTarget ? 1 : employees.length;

  function validateNotif() {
    const errs = {};
    if (!nTitle.trim())             errs.title   = 'Title is required';
    else if (nTitle.length > TITLE_MAX) errs.title = `Title must be ${TITLE_MAX} characters or fewer`;
    if (!nBody.trim())              errs.body    = 'Message is required';
    else if (nBody.length > MESSAGE_MAX) errs.body = `Message must be ${MESSAGE_MAX} characters or fewer`;
    return errs;
  }

  function validateEmail() {
    const errs = {};
    if (!eSubject.trim())               errs.subject = 'Subject is required';
    else if (eSubject.length > SUBJECT_MAX) errs.subject = `Subject must be ${SUBJECT_MAX} characters or fewer`;
    if (!eMessage.trim())               errs.message = 'Message is required';
    else if (eMessage.length > MESSAGE_MAX) errs.message = `Message must be ${MESSAGE_MAX} characters or fewer`;
    return errs;
  }

  function handleSendNotificationClick() {
    const errs = validateNotif();
    setNErrors(errs);
    if (Object.keys(errs).length) return;
    setConfirm({ open: true, type: 'push' });
  }

  function handleSendEmailClick() {
    const errs = validateEmail();
    setEErrors(errs);
    if (Object.keys(errs).length) return;
    setConfirm({ open: true, type: 'email' });
  }

  async function sendNotification() {
    setNSending(true);
    try {
      // BUG_135: push route is /api/push/send, not /api/notifications/send
      const res = await apiPost('/push/send', {
        title:          nTitle.trim(),
        body:           nBody.trim(),
        url:            nUrl.trim() || '/',
        target_user_id: nTarget || null,
      });
      if (res.sent === 0 && res.targeted > 0) {
        toast(`Notification sent to ${res.targeted} employee${res.targeted !== 1 ? 's' : ''} (no active push subscriptions found — employees may need to enable notifications in Settings).`, 'warning');
      } else {
        toast(`Notification sent to ${res.sent} device${res.sent !== 1 ? 's' : ''} (${res.targeted ?? res.sent} employee${(res.targeted ?? res.sent) !== 1 ? 's' : ''} targeted).`, 'success');
      }
      setNTitle(''); setNBody(''); setNUrl(''); setNTarget(''); setNErrors({});
    } catch (err) { toast(err.message, 'error'); }
    finally { setNSending(false); }
  }

  async function sendEmail() {
    setESending(true);
    try {
      const res = await apiPost('/root/send-email', {
        subject:        eSubject.trim(),
        message:        eMessage.trim(),
        target_user_id: eTarget || null,
      });
      toast(`Email sent to ${res.sent} recipient${res.sent !== 1 ? 's' : ''}`, 'success');
      setESubject(''); setEMessage(''); setETarget(''); setEErrors({});
    } catch (err) { toast(err.message, 'error'); }
    finally { setESending(false); }
  }

  function handleConfirm() {
    if (confirm.type === 'push')  sendNotification();
    if (confirm.type === 'email') sendEmail();
  }

  const recipientLabel = (target) =>
    target
      ? employees.find(e => String(e.id) === target)?.name || 'selected employee'
      : `all ${employees.length} employee${employees.length !== 1 ? 's' : ''}`;

  const confirmMessage = confirm.type === 'push'
    ? `Type: Push Notification\nRecipients: ${recipientLabel(nTarget)}\n\nAre you sure you want to send this broadcast? This action cannot be undone.`
    : `Type: Email\nRecipients: ${recipientLabel(eTarget)}\n\nAre you sure you want to send this broadcast? This action cannot be undone.`;

  return (
    <div>
      {/* Hero Banner */}
      <div className="rounded-xl p-6 mb-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #3525cd 0%, #4f46e5 50%, #712ae2 100%)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Bell size={14} className="text-white/70" />
          <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Root Admin</span>
        </div>
        <h1 className="text-2xl font-black text-white tracking-tight">Broadcast Centre</h1>
        <p className="text-white/75 text-sm mt-1">
          Send push notifications and emails to all employees or a specific person.
        </p>
      </div>

      <div className="max-w-3xl space-y-5">
        {/* Push Notification */}
        <Section
          icon={<Bell size={18} className="text-[#3525cd]" />}
          title="Send Push Notification"
          iconBg="bg-[#f0f3ff]"
        >
          <div className="space-y-4">
            <RecipientSelect label="Recipient" value={nTarget} onChange={setNTarget} employees={employees} />
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Title *</label>
                <CharCounter value={nTitle} max={TITLE_MAX} />
              </div>
              <input
                className={`form-control ${nErrors.title ? 'border-rose-400' : ''}`}
                placeholder="e.g. Office Closed Tomorrow"
                value={nTitle}
                maxLength={TITLE_MAX}
                onChange={e => { setNTitle(e.target.value); if (nErrors.title) setNErrors(p => ({ ...p, title: '' })); }}
              />
              <FieldError msg={nErrors.title} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Message *</label>
                <CharCounter value={nBody} max={MESSAGE_MAX} />
              </div>
              <textarea
                className={`form-control ${nErrors.body ? 'border-rose-400' : ''}`}
                rows={3}
                placeholder="Notification message…"
                value={nBody}
                maxLength={MESSAGE_MAX}
                onChange={e => { setNBody(e.target.value); if (nErrors.body) setNErrors(p => ({ ...p, body: '' })); }}
              />
              <FieldError msg={nErrors.body} />
            </div>
            <div>
              <label className="form-label">
                Link URL <span className="text-[#777587] font-normal">(optional — defaults to /)</span>
              </label>
              <input className="form-control" placeholder="/portal/home" value={nUrl} onChange={e => setNUrl(e.target.value)} />
            </div>
            {/* EHN_BROAD_010: Recipient count preview */}
            <div className="text-xs text-[#777587] bg-[#f0f3ff] border border-[#c7c4d8] rounded-lg px-3 py-2">
              Recipients: <strong className="text-[#3525cd]">{nRecipientCount} employee{nRecipientCount !== 1 ? 's' : ''}</strong>
              {nTarget && <span> — {employees.find(e => String(e.id) === nTarget)?.name}</span>}
            </div>
            <div className="flex items-center gap-3 pt-1 border-t border-[#f0f3ff]">
              <button
                onClick={handleSendNotificationClick}
                disabled={nSending}
                className="btn btn-primary btn-sm"
              >
                {nSending ? <span className="spinner w-4 h-4" /> : <Send size={14} />}
                {nTarget ? 'Send to Employee' : 'Broadcast to All'}
              </button>
              {/* EHN_BROAD_009: Save as Draft for push notification */}
              <button onClick={() => {
                localStorage.setItem(NOTIF_DRAFT_KEY, JSON.stringify({ nTitle, nBody, nUrl, nTarget }));
                toast('Draft saved!', 'success');
              }} className="btn btn-outline btn-sm">Save Draft</button>
              {localStorage.getItem(NOTIF_DRAFT_KEY) && (
                <button onClick={() => {
                  const draft = JSON.parse(localStorage.getItem(NOTIF_DRAFT_KEY) || '{}');
                  if (draft.nTitle) setNTitle(draft.nTitle);
                  if (draft.nBody) setNBody(draft.nBody);
                  if (draft.nUrl) setNUrl(draft.nUrl);
                  if (draft.nTarget) setNTarget(draft.nTarget);
                  toast('Draft loaded!', 'success');
                }} className="text-xs text-[#3525cd] font-semibold hover:underline">Load Draft</button>
              )}
            </div>
          </div>
        </Section>

        {/* Email */}
        <Section
          icon={<Mail size={18} className="text-emerald-600" />}
          title="Send Email"
          iconBg="bg-emerald-50"
        >
          <div className="space-y-4">
            <RecipientSelect label="Recipient" value={eTarget} onChange={setETarget} employees={employees} />
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Subject *</label>
                <CharCounter value={eSubject} max={SUBJECT_MAX} />
              </div>
              <input
                className={`form-control ${eErrors.subject ? 'border-rose-400' : ''}`}
                placeholder="e.g. Important Company Announcement"
                value={eSubject}
                maxLength={SUBJECT_MAX}
                onChange={e => { setESubject(e.target.value); if (eErrors.subject) setEErrors(p => ({ ...p, subject: '' })); }}
              />
              <FieldError msg={eErrors.subject} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="form-label mb-0">Message *</label>
                <CharCounter value={eMessage} max={MESSAGE_MAX} />
              </div>
              <textarea
                className={`form-control ${eErrors.message ? 'border-rose-400' : ''}`}
                rows={6}
                placeholder="Write your message here… (supports line breaks)"
                value={eMessage}
                maxLength={MESSAGE_MAX}
                onChange={e => { setEMessage(e.target.value); if (eErrors.message) setEErrors(p => ({ ...p, message: '' })); }}
              />
              <FieldError msg={eErrors.message} />
            </div>
            {/* EHN_BROAD_010: Recipient count preview for email */}
            <div className="text-xs text-[#777587] bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              Recipients: <strong className="text-emerald-700">{eRecipientCount} employee{eRecipientCount !== 1 ? 's' : ''}</strong>
              {eTarget && <span> — {employees.find(e => String(e.id) === eTarget)?.name}</span>}
            </div>
            <div className="flex items-center gap-3 pt-1 border-t border-[#f0f3ff]">
              <button
                onClick={handleSendEmailClick}
                disabled={eSending}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-all"
              >
                {eSending ? <span className="spinner w-4 h-4" /> : <Send size={14} />}
                {eTarget ? 'Send Email' : 'Email All'}
              </button>
              {/* EHN_BROAD_009: Save as Draft for email */}
              <button onClick={() => {
                localStorage.setItem(EMAIL_DRAFT_KEY, JSON.stringify({ eSubject, eMessage, eTarget }));
                toast('Draft saved!', 'success');
              }} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border border-[#c7c4d8] text-[#464555] hover:bg-[#f0f3ff]">Save Draft</button>
              {localStorage.getItem(EMAIL_DRAFT_KEY) && (
                <button onClick={() => {
                  const draft = JSON.parse(localStorage.getItem(EMAIL_DRAFT_KEY) || '{}');
                  if (draft.eSubject) setESubject(draft.eSubject);
                  if (draft.eMessage) setEMessage(draft.eMessage);
                  if (draft.eTarget) setETarget(draft.eTarget);
                  toast('Draft loaded!', 'success');
                }} className="text-xs text-emerald-600 font-semibold hover:underline">Load Draft</button>
              )}
            </div>
          </div>
        </Section>
      </div>

      {/* BUG_138: broadcast confirmation dialog */}
      <ConfirmModal
        open={confirm.open}
        title={confirm.type === 'push' ? 'Send Push Notification' : 'Send Email Broadcast'}
        message={confirmMessage}
        confirmLabel="Send"
        variant="warning"
        onConfirm={handleConfirm}
        onCancel={() => setConfirm({ open: false, type: null })}
      />
    </div>
  );
}
