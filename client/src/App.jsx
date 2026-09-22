import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ToastProvider } from '@/context/ToastContext';
import { FeatureFlagProvider, useFeature } from '@/context/FeatureFlagContext';
import { BranchProvider } from '@/context/BranchContext';
import { AppLayout }      from '@/components/layout/AppLayout';
import { RootLayout }     from '@/components/layout/RootLayout';
import { EmployeeLayout } from '@/components/layout/EmployeeLayout';
import { ForcePasswordChangeModal } from '@/components/ForcePasswordChangeModal';
import { Lock } from 'lucide-react';

// ── Lazy-loaded pages (fixes iOS Safari call stack overflow on startup) ──
const MaintenancePage  = lazy(() => import('@/pages/MaintenancePage'));
const LandingPage      = lazy(() => import('@/pages/LandingPage'));
const Login            = lazy(() => import('@/pages/Login'));
const Register         = lazy(() => import('@/pages/Register'));
const ForgotPassword   = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword    = lazy(() => import('@/pages/ResetPassword'));

// ── HR Admin / Root Admin pages ──
const Dashboard        = lazy(() => import('@/pages/Dashboard'));
const Calendar         = lazy(() => import('@/pages/Calendar'));
const Leaves           = lazy(() => import('@/pages/Leaves'));
const Employees        = lazy(() => import('@/pages/Employees'));
const Settings         = lazy(() => import('@/pages/Settings'));
const RootDashboard    = lazy(() => import('@/pages/RootDashboard'));
const ManageHR         = lazy(() => import('@/pages/ManageHR'));
const ManageRootAdmins = lazy(() => import('@/pages/ManageRootAdmins'));
const Broadcast        = lazy(() => import('@/pages/Broadcast'));
const MyProfile        = lazy(() => import('@/pages/MyProfile'));
const Departments      = lazy(() => import('@/pages/Departments'));
const HolidaysPage     = lazy(() => import('@/pages/Holidays'));
const LeavePolicies    = lazy(() => import('@/pages/LeavePolicies'));
const Regularization   = lazy(() => import('@/pages/Regularization'));
const Reports          = lazy(() => import('@/pages/Reports'));
const Documents        = lazy(() => import('@/pages/Documents'));
const Payroll             = lazy(() => import('@/pages/Payroll'));
const SalaryStructure     = lazy(() => import('@/pages/SalaryStructure'));
const PayrollSettings     = lazy(() => import('@/pages/PayrollSettings'));
const PayrollGeneration   = lazy(() => import('@/pages/PayrollGeneration'));
const PayrollRunDetails   = lazy(() => import('@/pages/PayrollRunDetails'));
const PayslipDetails      = lazy(() => import('@/pages/PayslipDetails'));
const PayrollDashboard    = lazy(() => import('@/pages/PayrollDashboard'));
const PayrollReports      = lazy(() => import('@/pages/PayrollReports'));
const StatutoryConfig     = lazy(() => import('@/pages/StatutoryConfig'));
const ComplianceDashboard = lazy(() => import('@/pages/ComplianceDashboard'));
const TaxDeclaration      = lazy(() => import('@/pages/TaxDeclaration'));
const Assets           = lazy(() => import('@/pages/Assets'));
const ExpensesPage     = lazy(() => import('@/pages/Expenses'));
const AnnouncementsPage = lazy(() => import('@/pages/Announcements'));
const Shifts           = lazy(() => import('@/pages/Shifts'));
const Performance      = lazy(() => import('@/pages/Performance'));
const Onboarding       = lazy(() => import('@/pages/Onboarding'));
const ExitManagement   = lazy(() => import('@/pages/ExitManagement'));
const NotificationCenter = lazy(() => import('@/pages/NotificationCenter'));
const Branches              = lazy(() => import('@/pages/Branches'));
const BiometricDevices      = lazy(() => import('@/pages/BiometricDevices'));
const BiometricPinMapping   = lazy(() => import('@/pages/BiometricPinMapping'));
const BiometricLogs         = lazy(() => import('@/pages/BiometricLogs'));
const BiometricLiveLogs     = lazy(() => import('@/pages/BiometricLiveLogs'));
const BiometricSettings        = lazy(() => import('@/pages/BiometricSettings'));
const BiometricHistoricalSync  = lazy(() => import('@/pages/BiometricHistoricalSync'));
const PendingApprovals      = lazy(() => import('@/pages/PendingApprovals'));
const RoleManagement        = lazy(() => import('@/pages/RoleManagement'));
const PermissionMatrix      = lazy(() => import('@/pages/PermissionMatrix'));
const LeaveWorkflowSettings = lazy(() => import('@/pages/LeaveWorkflowSettings'));

// ── Employee portal pages ──
const EmployeeHome            = lazy(() => import('@/pages/EmployeeHome'));
const MyLeaves                = lazy(() => import('@/pages/MyLeaves'));
const MyAttendance            = lazy(() => import('@/pages/MyAttendance'));
const TeamCalendar            = lazy(() => import('@/pages/TeamCalendar'));
const EmployeePortalProfile   = lazy(() => import('@/pages/EmployeePortalProfile'));
const DeptHeadApprovals       = lazy(() => import('@/pages/DeptHeadApprovals'));

// ── Shown while any lazy page is loading ──
function PageLoader() {
  return (
    <div style={{
      minHeight: '100%', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#f9f9ff',
    }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: '50%',
        border: '3px solid #e5e3f0', borderTopColor: '#3525cd',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// Shows a locked screen when a feature is disabled for the org
function FeatureRoute({ featureKey, children }) {
  const enabled = useFeature(featureKey);
  if (!enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="w-16 h-16 rounded-2xl bg-[#f0f3ff] border border-[#c7c4d8] flex items-center justify-center mx-auto mb-4">
          <Lock size={28} className="text-[#3525cd]/40" />
        </div>
        <h2 className="text-xl font-black text-[#151c27] mb-2">Feature Not Available</h2>
        <p className="text-sm text-[#777587] max-w-sm">
          This module is not enabled for your organization. Contact your platform administrator to enable it.
        </p>
      </div>
    );
  }
  return children;
}

// Checks /health on mount and blocks the app when maintenance mode is active.
// Root admins bypass if MAINTENANCE_ADMIN_BYPASS=true is set on the backend.
// Polls every 30 s while in maintenance so the app recovers automatically when
// the operator turns maintenance off and restarts the backend.
function MaintenanceGate({ children }) {
  const { user } = useAuth();
  const [health, setHealth] = useState(null); // null = loading, object = resolved

  function fetchHealth() {
    return fetch('/health')
      .then(r => r.json())
      .catch(() => ({ status: 'ok' }));
  }

  // Initial check
  useEffect(() => {
    fetchHealth().then(data => setHealth(data));
  }, []);

  // Auto-recovery: poll every 30 s while maintenance is active
  useEffect(() => {
    if (health?.status !== 'maintenance') return;
    const id = setInterval(() => {
      fetchHealth().then(data => {
        if (data.status !== 'maintenance') setHealth(data);
      });
    }, 30_000);
    return () => clearInterval(id);
  }, [health?.status]);

  // Mid-session detection: any API call returning 503+maintenance fires this event
  useEffect(() => {
    const handler = e => {
      setHealth(prev =>
        prev?.status === 'maintenance'
          ? prev
          : { status: 'maintenance', bypassAvailable: e.detail?.bypassAvailable ?? false, message: e.detail?.message ?? null }
      );
    };
    window.addEventListener('maintenance:active', handler);
    return () => window.removeEventListener('maintenance:active', handler);
  }, []);

  if (health === null) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#f9f9ff',
      }}>
        <div style={{
          width: '32px', height: '32px', borderRadius: '50%',
          border: '3px solid #e5e3f0', borderTopColor: '#3525cd',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (health.status === 'maintenance') {
    // Root admin with bypass configured can proceed normally
    if (health.bypassAvailable && user?.role === 'root_admin') return children;
    return (
      <MaintenancePage
        bypassAvailable={health.bypassAvailable}
        message={health.message}
      />
    );
  }

  return children;
}

function defaultPath(user) {
  if (!user) return '/login';
  if (user.role === 'root_admin') return '/root/dashboard';
  if (user.role === 'employee')   return '/portal/home';
  return '/dashboard';
}

function HRRoute({ children }) {
  const { token, isAdmin } = useAuth();
  if (!token)   return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/portal/home" replace />;
  return children;
}

function RootRoute({ children }) {
  const { token, isRootAdmin } = useAuth();
  if (!token)        return <Navigate to="/login" replace />;
  if (!isRootAdmin)  return <Navigate to="/dashboard" replace />;
  return children;
}

function EmployeeRoute({ children }) {
  const { token, isEmployee } = useAuth();
  if (!token)      return <Navigate to="/login" replace />;
  if (!isEmployee) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  const { token, user } = useAuth();
  const home = defaultPath(user);

  return (
    <Routes>
      <Route path="/" element={token ? <Navigate to={home} replace /> : <LandingPage />} />
      <Route path="/login"            element={token ? <Navigate to={home} replace /> : <Login />} />
      <Route path="/register"         element={token ? <Navigate to={home} replace /> : <Register />} />
      <Route path="/forgot-password"  element={<ForgotPassword />} />
      <Route path="/reset-password"   element={<ResetPassword />} />

      {/* ── HR Admin area (admin + root_admin) ── */}
      <Route element={<HRRoute><AppLayout /></HRRoute>}>
        <Route path="/dashboard"        element={<Dashboard />} />
        <Route path="/calendar"         element={<Calendar />} />
        <Route path="/attendance"       element={<Navigate to="/calendar" replace />} />
        <Route path="/leaves"           element={<Leaves />} />

        <Route path="/employees"        element={<Employees />} />
        <Route path="/employees/:id"    element={<Employees />} />
        <Route path="/departments"      element={<Departments />} />
        <Route path="/holidays"         element={<HolidaysPage />} />
        <Route path="/leave-policies"   element={<FeatureRoute featureKey="leave_policies"><LeavePolicies /></FeatureRoute>} />
        <Route path="/leave-workflow"   element={<LeaveWorkflowSettings />} />
        <Route path="/regularization"   element={<FeatureRoute featureKey="regularization"><Regularization /></FeatureRoute>} />
        <Route path="/reports"          element={<FeatureRoute featureKey="reports"><Reports /></FeatureRoute>} />
        <Route path="/documents"        element={<FeatureRoute featureKey="documents"><Documents /></FeatureRoute>} />
        <Route path="/payroll"                  element={<FeatureRoute featureKey="payroll"><Payroll /></FeatureRoute>} />
        <Route path="/payroll/dashboard"        element={<FeatureRoute featureKey="payroll"><PayrollDashboard /></FeatureRoute>} />
        <Route path="/payroll/salary"           element={<FeatureRoute featureKey="payroll"><SalaryStructure /></FeatureRoute>} />
        <Route path="/payroll/settings"         element={<FeatureRoute featureKey="payroll"><PayrollSettings /></FeatureRoute>} />
        <Route path="/payroll/generate"         element={<FeatureRoute featureKey="payroll"><PayrollGeneration /></FeatureRoute>} />
        <Route path="/payroll/runs/:id"         element={<FeatureRoute featureKey="payroll"><PayrollRunDetails /></FeatureRoute>} />
        <Route path="/payroll/payslips/:id"     element={<FeatureRoute featureKey="payroll"><PayslipDetails /></FeatureRoute>} />
        <Route path="/payroll/reports"          element={<FeatureRoute featureKey="payroll"><PayrollReports /></FeatureRoute>} />
        <Route path="/statutory/config"         element={<FeatureRoute featureKey="payroll"><StatutoryConfig /></FeatureRoute>} />
        <Route path="/statutory/compliance"     element={<FeatureRoute featureKey="payroll"><ComplianceDashboard /></FeatureRoute>} />
        <Route path="/statutory/declarations"   element={<FeatureRoute featureKey="payroll"><TaxDeclaration /></FeatureRoute>} />
        <Route path="/assets"           element={<FeatureRoute featureKey="assets"><Assets /></FeatureRoute>} />
        <Route path="/expenses"         element={<FeatureRoute featureKey="expenses"><ExpensesPage /></FeatureRoute>} />
        <Route path="/announcements"    element={<FeatureRoute featureKey="announcements"><AnnouncementsPage /></FeatureRoute>} />
        <Route path="/shifts"           element={<FeatureRoute featureKey="shifts"><Shifts /></FeatureRoute>} />
        <Route path="/performance"      element={<FeatureRoute featureKey="performance"><Performance /></FeatureRoute>} />
        <Route path="/onboarding"       element={<FeatureRoute featureKey="onboarding"><Onboarding /></FeatureRoute>} />
        <Route path="/exit-management"  element={<FeatureRoute featureKey="exit_management"><ExitManagement /></FeatureRoute>} />
        <Route path="/notifications"      element={<NotificationCenter />} />
        <Route path="/settings"           element={<Settings />} />
        <Route path="/profile"            element={<MyProfile />} />
        <Route path="/pending-approvals"  element={<PendingApprovals />} />
        <Route path="/roles"                    element={<RoleManagement />} />
        <Route path="/roles/:id/permissions"    element={<PermissionMatrix />} />
        <Route path="/branches"           element={<FeatureRoute featureKey="branches"><Branches /></FeatureRoute>} />
        <Route path="/biometric/devices"         element={<FeatureRoute featureKey="biometric"><BiometricDevices /></FeatureRoute>} />
        <Route path="/biometric/mapping"         element={<FeatureRoute featureKey="biometric"><BiometricPinMapping /></FeatureRoute>} />
        <Route path="/biometric/logs"            element={<FeatureRoute featureKey="biometric"><BiometricLogs /></FeatureRoute>} />
        <Route path="/biometric/settings"        element={<FeatureRoute featureKey="biometric"><BiometricSettings /></FeatureRoute>} />
        <Route path="/biometric/historical-sync" element={<FeatureRoute featureKey="biometric"><BiometricHistoricalSync /></FeatureRoute>} />
      </Route>

      {/* ── Root Admin area (root_admin only) ── */}
      <Route element={<RootRoute><RootLayout /></RootRoute>}>
        <Route path="/root/dashboard"       element={<RootDashboard />} />
        <Route path="/root/calendar"        element={<Calendar />} />
        <Route path="/root/leaves"          element={<Leaves />} />
        <Route path="/root/employees"       element={<Employees />} />
        <Route path="/root/employees/:id"   element={<Employees />} />
        <Route path="/root/departments"     element={<Departments />} />
        <Route path="/root/branches"        element={<FeatureRoute featureKey="branches"><Branches /></FeatureRoute>} />
        <Route path="/root/holidays"        element={<HolidaysPage />} />
        <Route path="/root/leave-policies"  element={<FeatureRoute featureKey="leave_policies"><LeavePolicies /></FeatureRoute>} />
        <Route path="/root/leave-workflow"  element={<LeaveWorkflowSettings />} />
        <Route path="/root/regularization"  element={<FeatureRoute featureKey="regularization"><Regularization /></FeatureRoute>} />
        <Route path="/root/reports"         element={<FeatureRoute featureKey="reports"><Reports /></FeatureRoute>} />
        <Route path="/root/documents"       element={<FeatureRoute featureKey="documents"><Documents /></FeatureRoute>} />
        <Route path="/root/payroll"                    element={<FeatureRoute featureKey="payroll"><Payroll /></FeatureRoute>} />
        <Route path="/root/payroll/dashboard"          element={<FeatureRoute featureKey="payroll"><PayrollDashboard /></FeatureRoute>} />
        <Route path="/root/payroll/salary"             element={<FeatureRoute featureKey="payroll"><SalaryStructure /></FeatureRoute>} />
        <Route path="/root/payroll/settings"           element={<FeatureRoute featureKey="payroll"><PayrollSettings /></FeatureRoute>} />
        <Route path="/root/payroll/generate"           element={<FeatureRoute featureKey="payroll"><PayrollGeneration /></FeatureRoute>} />
        <Route path="/root/payroll/runs/:id"           element={<FeatureRoute featureKey="payroll"><PayrollRunDetails /></FeatureRoute>} />
        <Route path="/root/payroll/payslips/:id"       element={<FeatureRoute featureKey="payroll"><PayslipDetails /></FeatureRoute>} />
        <Route path="/root/payroll/reports"            element={<FeatureRoute featureKey="payroll"><PayrollReports /></FeatureRoute>} />
        <Route path="/root/statutory/config"          element={<FeatureRoute featureKey="payroll"><StatutoryConfig /></FeatureRoute>} />
        <Route path="/root/statutory/compliance"      element={<FeatureRoute featureKey="payroll"><ComplianceDashboard /></FeatureRoute>} />
        <Route path="/root/statutory/declarations"    element={<FeatureRoute featureKey="payroll"><TaxDeclaration /></FeatureRoute>} />
        <Route path="/root/assets"          element={<FeatureRoute featureKey="assets"><Assets /></FeatureRoute>} />
        <Route path="/root/expenses"        element={<FeatureRoute featureKey="expenses"><ExpensesPage /></FeatureRoute>} />
        <Route path="/root/announcements"   element={<FeatureRoute featureKey="announcements"><AnnouncementsPage /></FeatureRoute>} />
        <Route path="/root/shifts"          element={<FeatureRoute featureKey="shifts"><Shifts /></FeatureRoute>} />
        <Route path="/root/performance"     element={<FeatureRoute featureKey="performance"><Performance /></FeatureRoute>} />
        <Route path="/root/onboarding"      element={<FeatureRoute featureKey="onboarding"><Onboarding /></FeatureRoute>} />
        <Route path="/root/exit-management" element={<FeatureRoute featureKey="exit_management"><ExitManagement /></FeatureRoute>} />
        <Route path="/root/notifications"      element={<NotificationCenter />} />
        <Route path="/root/settings"           element={<Settings />} />
        <Route path="/root/pending-approvals"  element={<PendingApprovals />} />
        <Route path="/root/manage-hr"            element={<ManageHR />} />
        <Route path="/root/manage-root-admins"  element={<ManageRootAdmins />} />
        <Route path="/root/roles"               element={<RoleManagement />} />
        <Route path="/root/roles/:id/permissions" element={<PermissionMatrix />} />
        <Route path="/root/broadcast"       element={<Broadcast />} />
        <Route path="/root/profile"         element={<MyProfile />} />
        <Route path="/root/org-settings"    element={<Navigate to="/root/settings" replace />} />
        <Route path="/root/biometric/devices"         element={<FeatureRoute featureKey="biometric"><BiometricDevices /></FeatureRoute>} />
        <Route path="/root/biometric/mapping"         element={<FeatureRoute featureKey="biometric"><BiometricPinMapping /></FeatureRoute>} />
        <Route path="/root/biometric/logs"            element={<FeatureRoute featureKey="biometric"><BiometricLogs /></FeatureRoute>} />
        <Route path="/root/biometric/live-logs"       element={<FeatureRoute featureKey="biometric"><BiometricLiveLogs /></FeatureRoute>} />
        <Route path="/root/biometric/settings"        element={<FeatureRoute featureKey="biometric"><BiometricSettings /></FeatureRoute>} />
        <Route path="/root/biometric/historical-sync" element={<FeatureRoute featureKey="biometric"><BiometricHistoricalSync /></FeatureRoute>} />
      </Route>

      {/* ── Employee portal (employee only) ── */}
      <Route element={<EmployeeRoute><EmployeeLayout /></EmployeeRoute>}>
        <Route path="/portal/home"           element={<EmployeeHome />} />
        <Route path="/portal/leaves"         element={<MyLeaves />} />
        <Route path="/portal/attendance"     element={<MyAttendance />} />
        <Route path="/portal/team-calendar"  element={<TeamCalendar />} />
        <Route path="/portal/documents"      element={<FeatureRoute featureKey="documents"><Documents /></FeatureRoute>} />
        <Route path="/portal/expenses"       element={<FeatureRoute featureKey="expenses"><ExpensesPage /></FeatureRoute>} />
        <Route path="/portal/payslips"           element={<FeatureRoute featureKey="payroll"><Payroll /></FeatureRoute>} />
        <Route path="/portal/tax-declaration"  element={<FeatureRoute featureKey="payroll"><TaxDeclaration /></FeatureRoute>} />
        <Route path="/portal/performance"    element={<FeatureRoute featureKey="performance"><Performance /></FeatureRoute>} />
        <Route path="/portal/onboarding"     element={<FeatureRoute featureKey="onboarding"><Onboarding /></FeatureRoute>} />
        <Route path="/portal/exit"           element={<FeatureRoute featureKey="exit_management"><ExitManagement /></FeatureRoute>} />
        <Route path="/portal/regularization" element={<FeatureRoute featureKey="regularization"><Regularization /></FeatureRoute>} />
        <Route path="/portal/notifications"  element={<NotificationCenter />} />
        <Route path="/portal/announcements"  element={<FeatureRoute featureKey="announcements"><AnnouncementsPage /></FeatureRoute>} />
        <Route path="/portal/profile"         element={<EmployeePortalProfile />} />
        <Route path="/portal/dept-approvals"  element={<DeptHeadApprovals />} />
      </Route>

      <Route path="*" element={<Navigate to={token ? home : '/'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <MaintenanceGate>
            <FeatureFlagProvider>
              <BranchProvider>
                <Suspense fallback={<PageLoader />}>
                  <AppRoutes />
                </Suspense>
                <ForcePasswordChangeModal />
              </BranchProvider>
            </FeatureFlagProvider>
          </MaintenanceGate>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
