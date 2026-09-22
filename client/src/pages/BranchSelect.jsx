import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ArrowRight, MapPin } from 'lucide-react';
import { useBranch } from '@/context/BranchContext';
import { useAuth } from '@/context/AuthContext';

function Spinner() {
  return (
    <div className="h-screen flex items-center justify-center bg-[#f9f9ff]">
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '3px solid #e5e3f0', borderTopColor: '#3525cd',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function BranchSelect() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    accessibleBranches,
    selectedBranchId,
    setSelectedBranchId,
    branchesLoaded,
    isLoading,
  } = useBranch();

  const orgName = user?.organization_name || 'Your Organization';

  // Already have a stored branch selection from a previous session → skip to dashboard
  useEffect(() => {
    if (!branchesLoaded) return;
    if (selectedBranchId !== null) {
      navigate('/root/dashboard', { replace: true });
    }
  }, [branchesLoaded, selectedBranchId, navigate]);

  // Exactly one branch → auto-select it and proceed
  useEffect(() => {
    if (!branchesLoaded) return;
    if (selectedBranchId !== null) return;
    if (accessibleBranches.length === 1) {
      setSelectedBranchId(accessibleBranches[0].id);
      navigate('/root/dashboard', { replace: true });
    }
  }, [branchesLoaded, accessibleBranches, selectedBranchId, setSelectedBranchId, navigate]);

  function handleSelect(branchId) {
    setSelectedBranchId(branchId);
    navigate('/root/dashboard', { replace: true });
  }

  function handleEnterWorkspace() {
    navigate('/root/dashboard', { replace: true });
  }

  // Still loading or redirecting (single branch auto-select)
  if (isLoading || !branchesLoaded || accessibleBranches.length === 1) {
    return <Spinner />;
  }

  // ── 0 branches: no branch structure configured yet ──────────────────────────
  if (accessibleBranches.length === 0) {
    return (
      <div className="min-h-screen bg-[#f9f9ff] flex flex-col items-center justify-center px-6">
        <div className="mb-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#3525cd] flex items-center justify-center mx-auto mb-5 shadow-lg shadow-[#3525cd]/20">
            <img src="/LogoWithoutName.svg" alt="HRMS" className="w-9 h-9" onError={e => { e.target.style.display = 'none'; }} />
          </div>
          <h1 className="text-3xl font-black text-[#151c27] tracking-tight mb-1">{orgName}</h1>
          <p className="text-[#777587] text-sm">Root Admin Console</p>
        </div>

        <div className="bg-white rounded-2xl border border-[#c7c4d8] shadow-sm p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-xl bg-[#f0f3ff] flex items-center justify-center mx-auto mb-4">
            <Building2 size={22} className="text-[#3525cd]" />
          </div>
          <h2 className="text-lg font-black text-[#151c27] mb-2">No branches configured</h2>
          <p className="text-sm text-[#777587] mb-6 leading-relaxed">
            Your organization hasn't set up branches yet. You can create branches from Settings after entering the workspace.
          </p>
          <button
            onClick={handleEnterWorkspace}
            className="w-full py-3 bg-[#3525cd] text-white font-bold rounded-xl hover:bg-[#4f46e5] transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#3525cd]/20"
          >
            Enter Workspace <ArrowRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  // ── Multiple branches: show selection grid ──────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f9f9ff] flex flex-col items-center justify-center px-6 py-10">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#3525cd] flex items-center justify-center mx-auto mb-5 shadow-lg shadow-[#3525cd]/20">
          <img src="/LogoWithoutName.svg" alt="HRMS" className="w-9 h-9" onError={e => { e.target.style.display = 'none'; }} />
        </div>
        <h1 className="text-3xl font-black text-[#151c27] tracking-tight mb-1">Welcome to {orgName}</h1>
        <p className="text-[#777587] text-sm">Select a branch to continue</p>
      </div>

      {/* Branch cards */}
      <div className={[
        'grid gap-4 w-full max-w-3xl',
        accessibleBranches.length === 2 ? 'grid-cols-1 sm:grid-cols-2 max-w-xl' :
        accessibleBranches.length === 3 ? 'grid-cols-1 sm:grid-cols-3' :
        'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      ].join(' ')}>
        {accessibleBranches.map(branch => (
          <button
            key={branch.id}
            onClick={() => handleSelect(branch.id)}
            className="group bg-white rounded-2xl border border-[#c7c4d8] shadow-sm p-6 text-left hover:border-[#3525cd]/50 hover:shadow-md transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-[#f0f3ff] flex items-center justify-center mb-4 group-hover:bg-[#3525cd]/10 transition-colors">
              <Building2 size={20} className="text-[#3525cd]" />
            </div>

            <h3 className="text-base font-black text-[#151c27] mb-1 leading-tight">{branch.name}</h3>

            {branch.code && (
              <p className="text-[0.7rem] font-semibold text-[#3525cd] uppercase tracking-wider mb-1">{branch.code}</p>
            )}

            {(branch.location || branch.address) && (
              <div className="flex items-start gap-1.5 text-[#777587] text-xs mb-4">
                <MapPin size={11} className="flex-shrink-0 mt-0.5" />
                <span className="line-clamp-2">{branch.location || branch.address}</span>
              </div>
            )}

            {!branch.location && !branch.address && <div className="mb-4" />}

            <div className="flex items-center gap-1.5 text-[#3525cd] text-xs font-bold group-hover:gap-2.5 transition-all">
              Select <ArrowRight size={13} />
            </div>
          </button>
        ))}
      </div>

      <p className="mt-8 text-xs text-[#777587]">
        You can switch branches anytime from the sidebar.
      </p>
    </div>
  );
}
