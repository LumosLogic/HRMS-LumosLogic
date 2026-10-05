import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Mail, Building2, AlertTriangle, UserMinus, Eye, EyeOff, KeyRound, Check, Lock } from 'lucide-react';
import { apiGet, apiDelete, apiPut } from '@/lib/api';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/context/ToastContext';
import { useAuth } from '@/context/AuthContext';

function ChangePasswordModal({ open, onClose, target }) {
  const toast = useToast();
  const [password,   setPassword]   = useState('');
  const [showPw,     setShowPw]     = useState(false);

  React.useEffect(() => { if (open) { setPassword(''); setShowPw(false); } }, [open]);

  const save = useMutation({
    mutationFn: () => apiPut(`/root/root-admins/${target?.id}/password`, { password }),
    onSuccess: () => {
      toast(`Password updated for ${target?.name}.`, 'success');
      onClose();
    },
    onError: (e) => toast(e.message, 'error'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Change Password"
      footer={
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !password} className="btn btn-primary btn-sm">
            {save.isPending
              ? <span className="flex items-center gap-1.5"><span className="spinner w-3.5 h-3.5" /> Saving…</span>
              : <><Check size={14} /> Update Password</>}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {target && (
          <div className="flex items-center gap-3 bg-[#f9f9ff] rounded-xl p-3 border border-[#f0f3ff]">
            <Avatar name={target.name} color={target.avatar_color} size={36} />
            <div>
              <p className="font-bold text-[#151c27] text-sm">{target.name}</p>
              <p className="text-xs text-[#777587]">{target.email}</p>
            </div>
          </div>
        )}
        <div>
          <label className="form-label">New Password</label>
          <div className="relative">
            <input
              className="form-control pr-10"
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Min. 6 characters"
              autoFocus
            />
            <button type="button" onClick={() => setShowPw(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs text-[#777587] mt-1.5">The user will need to use this new password to log in.</p>
        </div>
      </div>
    </Modal>
  );
}

function ChangeSelfPasswordModal({ open, onClose }) {
  const toast = useToast();
  const [curPw,   setCurPw]   = useState('');
  const [newPw,   setNewPw]   = useState('');
  const [confPw,  setConfPw]  = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConf, setShowConf] = useState(false);

  React.useEffect(() => { if (open) { setCurPw(''); setNewPw(''); setConfPw(''); setShowCur(false); setShowNew(false); setShowConf(false); } }, [open]);

  const save = useMutation({
    mutationFn: () => apiPut('/auth/change-password', { currentPassword: curPw, newPassword: newPw }),
    onSuccess: () => {
      toast('Your password has been changed successfully.', 'success');
      onClose();
    },
    onError: (e) => toast(e.message, 'error'),
  });

  const passwordValid = newPw.length >= 8;
  const passwordsMatch = newPw && confPw && newPw === confPw;
  const canSubmit = curPw && passwordValid && passwordsMatch;

  return (
    <Modal open={open} onClose={onClose} title="Change Your Password"
      footer={
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-outline btn-sm">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !canSubmit} className="btn btn-primary btn-sm">
            {save.isPending
              ? <span className="flex items-center gap-1.5"><span className="spinner w-3.5 h-3.5" /> Saving…</span>
              : <><Check size={14} /> Update Password</>}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 bg-[#f9f9ff] rounded-xl p-3 border border-[#f0f3ff]">
          <Lock size={14} className="text-[#3525cd] flex-shrink-0" />
          <p className="text-xs text-[#777587]">You'll need your current password to set a new one.</p>
        </div>

        <div>
          <label className="form-label">Current Password</label>
          <div className="relative">
            <input className="form-control pr-10" type={showCur ? 'text' : 'password'} value={curPw}
              onChange={e => setCurPw(e.target.value)} placeholder="••••••••" autoFocus />
            <button type="button" onClick={() => setShowCur(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
              {showCur ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="form-label">New Password</label>
          <div className="relative">
            <input className="form-control pr-10" type={showNew ? 'text' : 'password'} value={newPw}
              onChange={e => setNewPw(e.target.value)} placeholder="Min. 8 characters" />
            <button type="button" onClick={() => setShowNew(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
              {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="form-label">Confirm New Password</label>
          <div className="relative">
            <input className="form-control pr-10" type={showConf ? 'text' : 'password'} value={confPw}
              onChange={e => setConfPw(e.target.value)} placeholder="Repeat new password" />
            <button type="button" onClick={() => setShowConf(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#777587] hover:text-[#151c27]">
              {showConf ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {newPw && confPw && !passwordsMatch && (
            <p className="text-xs text-rose-600 mt-1">Passwords do not match</p>
          )}
          {newPw && confPw && passwordsMatch && (
            <p className="text-xs text-emerald-600 mt-1">Passwords match</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function ManageRootAdmins() {
  const qc    = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();

  const [rootDelTarget,  setRootDelTarget]  = useState(null);
  const [pwTarget,       setPwTarget]       = useState(null);
  const [selfPwOpen,     setSelfPwOpen]     = useState(false);

  const { data: rootAdmins = [], isLoading } = useQuery({
    queryKey: ['root-admins'],
    queryFn:  () => apiGet('/root/root-admins'),
  });

  const rootDel = useMutation({
    mutationFn: (id) => apiDelete(`/root/root-admins/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['root-admins'] });
      qc.invalidateQueries({ queryKey: ['root-dashboard'] });
      toast('Root admin access removed. Account demoted to employee.', 'success');
      setRootDelTarget(null);
    },
    onError: (e) => { toast(e.message, 'error'); setRootDelTarget(null); },
  });

  const canDeleteRoot = rootAdmins.length > 1;

  return (
    <div>
      {/* Hero Banner */}
      <div className="rounded-xl p-6 mb-6 relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #7f1d1d 0%, #dc2626 50%, #f97316 100%)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Shield size={14} className="text-white/70" />
          <span className="text-xs font-bold text-white/70 uppercase tracking-widest">Manage Root Admins</span>
        </div>
        <h1 className="text-2xl font-black text-white tracking-tight">Root Administrators</h1>
        <p className="text-white/75 text-sm mt-1">
          Manage root admin accounts. An organisation must always retain at least one root admin.
        </p>
      </div>

      {!canDeleteRoot && !isLoading && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
          <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs font-semibold text-amber-800">
            Only one root admin exists in this organisation. Add another root admin before you can remove this account.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><div className="spinner w-8 h-8" /></div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {rootAdmins.map(ra => {
            const isSelf = ra.id === user?.id;
            return (
              <div key={ra.id}
                className="bg-white rounded-xl border border-[#c7c4d8] shadow-sm p-5 hover:border-rose-200 hover:shadow-md transition-all duration-200">
                <div className="h-[3px] -mx-5 -mt-5 mb-4 rounded-t-xl bg-gradient-to-r from-rose-600 via-rose-500 to-orange-400" />

                <div className="flex items-start gap-3 mb-4">
                  <Avatar name={ra.name} color={ra.avatar_color} size={48} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-black text-[#151c27] text-[0.95rem] truncate">{ra.name}</p>
                      {isSelf && (
                        <span className="text-[0.6rem] font-bold bg-[#f0f3ff] text-[#3525cd] border border-[#c7c4d8] px-1.5 py-0.5 rounded-full flex-shrink-0">You</span>
                      )}
                    </div>
                    <p className="text-xs text-[#777587] truncate">{ra.position || 'Root Administrator'}</p>
                    <span className="inline-block mt-1.5 text-[0.65rem] bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">
                      Root Admin
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 mb-4 bg-[#f9f9ff] rounded-lg p-3 border border-[#f0f3ff]">
                  <div className="flex items-center gap-2 text-xs text-[#464555]">
                    <Mail size={12} className="text-[#777587] flex-shrink-0" />
                    <span className="truncate">{ra.email}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#464555]">
                    <Building2 size={12} className="text-[#777587] flex-shrink-0" />
                    <span className="truncate">{ra.department || 'Administration'}</span>
                  </div>
                </div>

                {isSelf ? (
                  <div className="flex flex-col gap-2">
                    <button onClick={() => setSelfPwOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-[#3525cd] bg-[#f0f3ff] border border-[#c7c4d8] hover:bg-[#e7eefe] transition-all">
                      <KeyRound size={13} /> Change Your Password
                    </button>
                    <p className="text-[0.72rem] text-[#9ca3af] text-center py-2 font-semibold bg-[#f9f9ff] rounded-lg border border-[#f0f3ff]">
                      You cannot remove your own access here
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <button onClick={() => setPwTarget(ra)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-[#3525cd] bg-[#f0f3ff] border border-[#c7c4d8] hover:bg-[#e7eefe] transition-all">
                      <KeyRound size={13} /> Change Password
                    </button>
                    {canDeleteRoot ? (
                      <button onClick={() => setRootDelTarget(ra)}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-all">
                        <UserMinus size={13} /> Remove Root Admin Access
                      </button>
                    ) : (
                      <p className="text-[0.72rem] text-amber-600 text-center py-2 font-semibold bg-amber-50 rounded-lg border border-amber-100">
                        Cannot remove — only admin in org
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Change Password Modal */}
      <ChangePasswordModal open={!!pwTarget} onClose={() => setPwTarget(null)} target={pwTarget} />

      {/* Change Self Password Modal */}
      <ChangeSelfPasswordModal open={selfPwOpen} onClose={() => setSelfPwOpen(false)} />

      {/* Remove Root Admin Modal */}
      <Modal open={!!rootDelTarget} onClose={() => setRootDelTarget(null)} title="Remove Root Admin Access"
        footer={
          <div className="flex gap-2 justify-end">
            <button onClick={() => setRootDelTarget(null)} className="btn btn-outline btn-sm">Cancel</button>
            <button onClick={() => rootDel.mutate(rootDelTarget.id)} disabled={rootDel.isPending} className="btn btn-danger btn-sm">
              {rootDel.isPending ? 'Removing…' : 'Yes, Remove Access'}
            </button>
          </div>
        }>
        <div className="space-y-3">
          <div className="flex items-center gap-3 bg-[#f9f9ff] rounded-xl p-3 border border-[#f0f3ff]">
            <Avatar name={rootDelTarget?.name} color={rootDelTarget?.avatar_color} size={40} />
            <div>
              <p className="font-bold text-[#151c27] text-sm">{rootDelTarget?.name}</p>
              <p className="text-xs text-[#777587]">{rootDelTarget?.email}</p>
            </div>
          </div>
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2">
            <AlertTriangle size={14} className="text-rose-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-rose-800 space-y-1">
              <p className="font-bold">This is a soft delete — the account is not permanently removed.</p>
              <ul className="list-disc pl-4 space-y-0.5 font-medium">
                <li>Their role will be demoted to <strong>Employee</strong></li>
                <li>Their account will be set to <strong>Inactive</strong></li>
                <li>All attendance, leave, and payroll records are preserved</li>
                <li>They will lose all root admin access immediately</li>
              </ul>
            </div>
          </div>
          <p className="text-xs text-[#777587]">
            Remaining root admins after this action: <strong className="text-[#151c27]">{rootAdmins.length - 1}</strong>
          </p>
        </div>
      </Modal>
    </div>
  );
}
