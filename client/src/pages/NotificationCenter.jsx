import React, { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Bell, BellOff, CheckCheck, Trash2, Megaphone, DollarSign, Receipt, Monitor, Target, UserCheck, LogOut as ExitIcon, ClipboardList, Info, FileText, Archive, X, Square, CheckSquare } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import { apiGet, apiPut, apiDelete } from '@/lib/api';
import { usePushNotification } from '@/hooks/usePushNotification';
import { ConfirmModal } from '@/components/ui/ConfirmModal';

// Build role-aware navigation map for notification types
function getTypeLink(isEmployee, isRootAdmin) {
  const prefix = isEmployee ? '/portal' : isRootAdmin ? '/root' : '';
  return {
    payroll:        isEmployee ? '/portal/payslips'      : `${prefix}/payroll`,
    expense:        `${prefix}/expenses`,
    regularization: isEmployee ? '/portal/regularization' : `${prefix}/regularization`,
    performance:    `${prefix}/performance`,
    onboarding:     isEmployee ? '/portal/onboarding'    : `${prefix}/onboarding`,
    exit:           isEmployee ? '/portal/exit'          : `${prefix}/exit-management`,
    announcement:   isEmployee ? '/portal/announcements' : `${prefix}/announcements`,
    asset:          isEmployee ? '/portal/home'          : `${prefix}/assets`,
    // BUG_231: employees should go to their own documents section, not the HR verification queue
    document:       isEmployee ? '/portal/my-profile?tab=documents' : '/documents?tab=verification',
    leave:          isEmployee ? '/portal/leaves'        : `${prefix}/leaves`,
  };
}

// BUG_091: Announcement uses Megaphone; General uses Bell; they must be distinct
const TYPE_CFG = {
  regularization: { icon: <ClipboardList size={14} />, bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   strip: '#F59E0B', label: 'Regularization' },
  payroll:        { icon: <DollarSign size={14} />,    bg: 'bg-[#f0f3ff]',  text: 'text-[#3525cd]',   border: 'border-[#c7c4d8]',   strip: '#3525cd', label: 'Payroll' },
  expense:        { icon: <Receipt size={14} />,       bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', strip: '#10B981', label: 'Expense' },
  // BUG_091: Announcement → Megaphone (distinct from General/Bell)
  announcement:   { icon: <Megaphone size={14} />,     bg: 'bg-[#f0f3ff]',  text: 'text-[#712ae2]',   border: 'border-[#c7c4d8]',   strip: '#712ae2', label: 'Announcement' },
  // BUG_091: General → Bell (distinct from Announcement/Megaphone)
  general:        { icon: <Bell size={14} />,          bg: 'bg-[#f0f3ff]',  text: 'text-[#464555]',   border: 'border-[#c7c4d8]',   strip: '#c7c4d8', label: 'General' },
  asset:          { icon: <Monitor size={14} />,       bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200',    strip: '#06B6D4', label: 'Asset' },
  performance:    { icon: <Target size={14} />,        bg: 'bg-amber-50',   text: 'text-amber-800',   border: 'border-amber-200',   strip: '#F59E0B', label: 'Performance' },
  onboarding:     { icon: <UserCheck size={14} />,     bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', strip: '#10B981', label: 'Onboarding' },
  exit:           { icon: <ExitIcon size={14} />,      bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    strip: '#EF4444', label: 'Exit' },
  // BUG_091: info fallback uses Info icon to differentiate from both Bell (general) and Megaphone (announcement)
  info:           { icon: <Info size={14} />,          bg: 'bg-[#f0f3ff]',  text: 'text-[#464555]',   border: 'border-[#c7c4d8]',   strip: '#c7c4d8', label: 'Info' },
  // BUG_093: Document notification type
  document:       { icon: <FileText size={14} />,      bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    strip: '#3B82F6', label: 'Document' },
  leave:          { icon: <ClipboardList size={14} />, bg: 'bg-[#f0f3ff]',  text: 'text-[#3525cd]',   border: 'border-[#c7c4d8]',   strip: '#3525cd', label: 'Leave' },
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 7) return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'Just now';
}

export default function NotificationCenter() {
  const { isEmployee, isRootAdmin, user } = useAuth();
  const TYPE_LINK = getTypeLink(isEmployee, isRootAdmin);
  const wrap = '';
  const { permission, subscribed, requestAndSubscribe, unsubscribe, isSupported } = usePushNotification(user?.id);
  const pushEnabled = permission === 'granted' && subscribed;
  const toast    = useToast();
  const qc       = useQueryClient();
  const navigate = useNavigate();

  // EHN_NOT_002: multi-select state
  const [selectedIds, setSelectedIds] = useState(new Set());
  // EHN_NOT_003: undo delete state
  const undoTimerRef = useRef(null);
  const [pendingDelete, setPendingDelete] = useState(null); // {id} or {ids: []}
  // EHN_NOT_005: archive tab
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'archived'

  // BUG_092: confirmation state for delete (kept for bulk)
  const [deleteConfirm, setDeleteConfirm] = useState({ open: false, id: null });

  const { data: _notifData, isLoading } = useQuery({
    queryKey: ['notifications', activeTab],
    queryFn: () => apiGet('/notifications', activeTab === 'archived' ? { archived: true } : {}),
  });
  const notifications = Array.isArray(_notifData) ? _notifData : [];

  function invalidateNotifs() {
    qc.invalidateQueries({ queryKey: ['notifications'] });
    qc.invalidateQueries({ queryKey: ['notif-count'] });
  }

  // EHN_NOT_003: Undo delete - schedule actual deletion with undo window
  const scheduleDelete = useCallback((id) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPendingDelete({ id });
    // Optimistically remove from UI (invalidate after delay)
    undoTimerRef.current = setTimeout(() => {
      apiDelete(`/notifications/${id}`).then(() => invalidateNotifs()).catch(() => {});
      setPendingDelete(null);
    }, 5000);
  }, []);

  const undoDelete = useCallback(() => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setPendingDelete(null);
  }, []);

  const readMut = useMutation({
    mutationFn: id => apiPut(`/notifications/${id}/read`),
    onSuccess: invalidateNotifs,
  });

  const readAllMut = useMutation({
    mutationFn: () => apiPut('/notifications/mark-all-read'),
    onSuccess: () => { toast('All marked as read', 'success'); invalidateNotifs(); },
  });

  const delMut = useMutation({
    mutationFn: id => apiDelete(`/notifications/${id}`),
    onSuccess: invalidateNotifs,
  });

  // EHN_NOT_002: bulk mutations
  const bulkReadMut = useMutation({
    mutationFn: ids => Promise.all(ids.map(id => apiPut(`/notifications/${id}/read`))),
    onSuccess: () => { toast('Marked as read', 'success'); invalidateNotifs(); setSelectedIds(new Set()); },
  });
  const bulkDelMut = useMutation({
    mutationFn: ids => Promise.all(ids.map(id => apiDelete(`/notifications/${id}`))),
    onSuccess: () => { toast('Deleted', 'warning'); invalidateNotifs(); setSelectedIds(new Set()); },
  });

  // EHN_NOT_005: archive mutations
  const archiveReadMut = useMutation({
    mutationFn: () => apiPut('/notifications/archive-read').catch(() => {
      const readIds = notifications.filter(n => n.is_read).map(n => n.id);
      return Promise.all(readIds.map(id => apiDelete(`/notifications/${id}`)));
    }),
    onSuccess: () => { toast('Read notifications archived', 'success'); invalidateNotifs(); },
  });

  const unread = notifications.filter(n => !n.is_read).length;
  // Filter out the pending-delete item from UI
  const visibleNotifs = pendingDelete?.id
    ? notifications.filter(n => n.id !== pendingDelete.id)
    : notifications;

  // Group: Today, This Week, Earlier
  const now      = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const weekAgo  = new Date(now - 7 * 864e5).toISOString();

  const groups = [
    { label: 'Today',      items: visibleNotifs.filter(n => n.created_at?.startsWith(todayStr)) },
    { label: 'This Week',  items: visibleNotifs.filter(n => !n.created_at?.startsWith(todayStr) && n.created_at >= weekAgo) },
    { label: 'Earlier',    items: visibleNotifs.filter(n => n.created_at < weekAgo) },
  ].filter(g => g.items.length > 0);

  const allIds = visibleNotifs.map(n => n.id);
  const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(allIds));
  }

  return (
    <>
    <div className={wrap}>
      {/* EHN_NOT_005: Active/Archived tabs */}
      <div className="flex items-center gap-4 mb-4 border-b border-[#f0f3ff] pb-3">
        {['active','archived'].map(t => (
          <button key={t} onClick={() => { setActiveTab(t); setSelectedIds(new Set()); }}
            className={`pb-2 text-sm font-bold capitalize border-b-2 transition-colors ${activeTab === t ? 'border-[#3525cd] text-[#3525cd]' : 'border-transparent text-[#777587] hover:text-[#464555]'}`}>
            {t === 'active' ? `Active${unread > 0 ? ` (${unread} unread)` : ''}` : 'Archived'}
          </button>
        ))}
        {activeTab === 'active' && notifications.some(n => n.is_read) && (
          <button className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-[#777587] hover:text-[#3525cd] border border-[#c7c4d8] rounded-lg px-3 py-1.5 transition-colors"
            onClick={() => archiveReadMut.mutate()} disabled={archiveReadMut.isPending}>
            <Archive size={12} />Archive Read
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mb-4">
        {/* EHN_NOT_002: Select all + count */}
        <div className="flex items-center gap-3">
          <button onClick={toggleSelectAll} className="p-1 text-[#777587] hover:text-[#3525cd] transition-colors" title={allSelected ? 'Deselect all' : 'Select all'}>
            {allSelected ? <CheckSquare size={16} className="text-[#3525cd]" /> : <Square size={16} />}
          </button>
          <p className="text-sm font-medium text-[#777587]">
            {unread > 0 && activeTab === 'active' ? <span className="font-bold text-[#3525cd]">{unread} unread</span> : <span>{visibleNotifs.length} total</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Push notification toggle */}
          {isEmployee && isSupported && (
            <button onClick={pushEnabled ? unsubscribe : requestAndSubscribe}
              title={pushEnabled ? 'Disable push notifications' : 'Enable push notifications'}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-all ${pushEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}>
              {pushEnabled ? <Bell size={13} /> : <BellOff size={13} />}
              {pushEnabled ? 'Push On' : 'Push Off'}
            </button>
          )}
          {unread > 0 && activeTab === 'active' && (
            <button className="btn btn-outline" onClick={() => readAllMut.mutate()} disabled={readAllMut.isPending}>
              {readAllMut.isPending ? <><span className="spinner w-4 h-4" />Marking…</> : <><CheckCheck size={15} />Mark All Read</>}
            </button>
          )}
        </div>
      </div>

      {/* EHN_NOT_002: Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 mb-3 bg-[#f0f3ff] border border-[#c7c4d8] rounded-xl">
          <span className="text-xs font-bold text-[#3525cd]">{selectedIds.size} selected</span>
          <button className="btn btn-outline btn-sm"
            onClick={() => bulkReadMut.mutate([...selectedIds])} disabled={bulkReadMut.isPending}>
            <CheckCheck size={12} />Mark Read
          </button>
          <button className="btn btn-sm bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
            onClick={() => bulkDelMut.mutate([...selectedIds])} disabled={bulkDelMut.isPending}>
            <Trash2 size={12} />Delete Selected
          </button>
          <button className="ml-auto text-[#777587] hover:text-[#3525cd] p-1 rounded" onClick={() => setSelectedIds(new Set())}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* EHN_NOT_003: Undo delete toast bar */}
      {pendingDelete && (
        <div className="flex items-center justify-between p-3 mb-3 bg-[#151c27] text-white rounded-xl">
          <span className="text-sm">Notification deleted</span>
          <button className="text-xs font-bold text-amber-400 hover:text-amber-300 px-2 py-1 rounded transition-colors"
            onClick={undoDelete}>Undo</button>
        </div>
      )}

      {isLoading ? (
        <div className="loading"><div className="spinner" />Loading notifications…</div>
      ) : visibleNotifs.length === 0 ? (
        <div className="empty-state">
          {activeTab === 'archived' ? (
            <><Archive size={48} className="mx-auto mb-3 text-[#c7c4d8]" /><p className="font-semibold text-[#464555] mb-1">No archived notifications</p></>
          ) : (
            <><Bell size={48} className="mx-auto mb-3 text-[#c7c4d8]" /><p className="font-semibold text-[#464555] mb-1">You're all caught up!</p><p className="text-sm">No notifications yet — they'll appear here when there's activity.</p></>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.label}>
              <div className="flex items-center gap-3 mb-3">
                <span className="text-[0.7rem] font-black uppercase tracking-widest text-[#777587]">{group.label}</span>
                <div className="flex-1 h-px bg-[#f0f3ff]" />
              </div>
              <div className="flex flex-col gap-2">
                {group.items.map(n => {
                  const cfg      = TYPE_CFG[n.type] || TYPE_CFG.info;
                  const isChecked = selectedIds.has(n.id);
                  return (
                    <div key={n.id}
                      className={`card overflow-hidden transition-all duration-200 ${!n.is_read ? 'border-[#3525cd]/20' : ''} ${isChecked ? 'ring-2 ring-[#3525cd] ring-offset-1' : ''}`}>
                      {!n.is_read && <div className="h-0.5 w-full" style={{ background: cfg.strip }} />}
                      <div className="p-4 flex items-start gap-3">
                        {/* EHN_NOT_002: Checkbox */}
                        <button onClick={e => { e.stopPropagation(); toggleSelect(n.id); }} className="flex-shrink-0 mt-0.5 text-[#777587] hover:text-[#3525cd] transition-colors">
                          {isChecked ? <CheckSquare size={15} className="text-[#3525cd]" /> : <Square size={15} />}
                        </button>
                        {/* Type icon */}
                        <div className="flex-shrink-0 flex flex-col items-center gap-1 pt-0.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cfg.bg}`}>
                            <span className={cfg.text}>{cfg.icon}</span>
                          </div>
                          {!n.is_read && <div className="w-1.5 h-1.5 rounded-full bg-[#3525cd]" />}
                        </div>
                        {/* Content — clickable navigates to linked page */}
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => {
                            if (!n.is_read) readMut.mutate(n.id);
                            // BUG_231: route document notifications by user role
                            // Employees see their own docs; admins go to the verification queue
                            if (n.type === 'document' || n.reference_type === 'document_submission') {
                              navigate(TYPE_LINK.document);
                              return;
                            }
                            const link = TYPE_LINK[n.type];
                            if (link) {
                              // BUG_094: pass reference_id so target page can highlight the item
                              const qs = n.reference_id ? `?highlight=${n.reference_id}` : '';
                              navigate(`${link}${qs}`);
                            }
                          }}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-bold text-sm ${!n.is_read ? 'text-[#151c27]' : 'text-[#464555]'}`}>{n.title}</span>
                              <span className={`badge ${cfg.bg} ${cfg.text} ${cfg.border} border text-[0.6rem]`}>{cfg.label}</span>
                            </div>
                            <span className="text-[0.65rem] text-[#c7c4d8] flex-shrink-0">{timeAgo(n.created_at)}</span>
                          </div>
                          <p className="text-xs text-[#777587] mt-1 leading-relaxed">{n.message}</p>
                        </div>
                        {/* Action buttons */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!n.is_read && (
                            <button title="Mark as read"
                              className="p-1.5 rounded-lg text-[#c7c4d8] hover:text-[#3525cd] hover:bg-[#f0f3ff] transition-colors"
                              onClick={e => { e.stopPropagation(); readMut.mutate(n.id); }}>
                              <CheckCheck size={13} />
                            </button>
                          )}
                          {/* EHN_NOT_003: Delete with undo (no confirm modal) */}
                          <button title="Delete"
                            className="p-1.5 rounded-lg text-[#c7c4d8] hover:text-rose-500 hover:bg-rose-50 transition-colors"
                            onClick={e => { e.stopPropagation(); scheduleDelete(n.id); }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
    </>
  );
}
