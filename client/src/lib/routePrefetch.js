/**
 * Route chunk prefetch — warms the lazy page chunk BEFORE the user clicks, so opening a module never waits on the network.
 * (Data is not prefetched here: list queries are branch-keyed and already cached by react-query tiers; see lib/queryTiers.js.)
 *
 * GENERATED from the lazy routes in App.jsx and checked by backend/src/tests/route_prefetch_contract.test.js — add a new lazy
 * route to App.jsx and the test tells you to add it here. import() of the same module is de-duplicated by the bundler/browser,
 * so this never downloads a chunk twice and never changes what a route renders.
 */
const PAGES = {
  LandingPage: () => import('@/pages/LandingPage'),
  Login: () => import('@/pages/Login'),
  Register: () => import('@/pages/Register'),
  ForgotPassword: () => import('@/pages/ForgotPassword'),
  ResetPassword: () => import('@/pages/ResetPassword'),
  PrivacyPolicy: () => import('@/pages/legal/PrivacyPolicy'),
  TermsOfService: () => import('@/pages/legal/TermsOfService'),
  AccountDeletion: () => import('@/pages/legal/AccountDeletion'),
  ContactPage: () => import('@/pages/legal/Contact'),
  SecurityPage: () => import('@/pages/legal/Security'),
  CookiePolicy: () => import('@/pages/legal/CookiePolicy'),
  Dashboard: () => import('@/pages/Dashboard'),
  Calendar: () => import('@/pages/Calendar'),
  Leaves: () => import('@/pages/Leaves'),
  Employees: () => import('@/pages/Employees'),
  Departments: () => import('@/pages/Departments'),
  HolidaysPage: () => import('@/pages/Holidays'),
  LeavePolicies: () => import('@/pages/LeavePolicies'),
  LeaveWorkflowSettings: () => import('@/pages/LeaveWorkflowSettings'),
  Regularization: () => import('@/pages/Regularization'),
  Reports: () => import('@/pages/Reports'),
  Documents: () => import('@/pages/Documents'),
  PayrollDashboard: () => import('@/pages/PayrollDashboard'),
  SalaryStructure: () => import('@/pages/SalaryStructure'),
  PayrollSettings: () => import('@/pages/PayrollSettings'),
  PayrollGeneration: () => import('@/pages/PayrollGeneration'),
  PayrollRunDetails: () => import('@/pages/PayrollRunDetails'),
  PayslipDetails: () => import('@/pages/PayslipDetails'),
  PayrollReports: () => import('@/pages/PayrollReports'),
  StatutoryConfig: () => import('@/pages/StatutoryConfig'),
  ComplianceDashboard: () => import('@/pages/ComplianceDashboard'),
  TaxDeclaration: () => import('@/pages/TaxDeclaration'),
  Assets: () => import('@/pages/Assets'),
  ExpensesPage: () => import('@/pages/Expenses'),
  AnnouncementsPage: () => import('@/pages/Announcements'),
  Shifts: () => import('@/pages/Shifts'),
  Performance: () => import('@/pages/Performance'),
  Onboarding: () => import('@/pages/Onboarding'),
  ExitManagement: () => import('@/pages/ExitManagement'),
  NotificationCenter: () => import('@/pages/NotificationCenter'),
  Settings: () => import('@/pages/Settings'),
  MyProfile: () => import('@/pages/MyProfile'),
  PendingApprovals: () => import('@/pages/PendingApprovals'),
  RoleManagement: () => import('@/pages/RoleManagement'),
  PermissionMatrix: () => import('@/pages/PermissionMatrix'),
  Branches: () => import('@/pages/Branches'),
  BiometricDevices: () => import('@/pages/BiometricDevices'),
  BiometricPinMapping: () => import('@/pages/BiometricPinMapping'),
  BiometricLogs: () => import('@/pages/BiometricLogs'),
  BiometricSettings: () => import('@/pages/BiometricSettings'),
  BiometricHistoricalSync: () => import('@/pages/BiometricHistoricalSync'),
  BranchSelect: () => import('@/pages/BranchSelect'),
  RootDashboard: () => import('@/pages/RootDashboard'),
  ManageHR: () => import('@/pages/ManageHR'),
  ManageRootAdmins: () => import('@/pages/ManageRootAdmins'),
  Broadcast: () => import('@/pages/Broadcast'),
  BiometricLiveLogs: () => import('@/pages/BiometricLiveLogs'),
  EmployeeHome: () => import('@/pages/EmployeeHome'),
  MyLeaves: () => import('@/pages/MyLeaves'),
  MyAttendance: () => import('@/pages/MyAttendance'),
  TeamCalendar: () => import('@/pages/TeamCalendar'),
  Payroll: () => import('@/pages/Payroll'),
  EmployeePortalProfile: () => import('@/pages/EmployeePortalProfile'),
  DeptHeadApprovals: () => import('@/pages/DeptHeadApprovals'),
  MyTeam: () => import('@/pages/MyTeam'),
  TeamMemberProfile: () => import('@/pages/TeamMemberProfile'),
};

// route path (as declared in App.jsx) -> page loader
export const ROUTE_LOADERS = {
  '/': PAGES.LandingPage,
  '/login': PAGES.Login,
  '/register': PAGES.Register,
  '/forgot-password': PAGES.ForgotPassword,
  '/reset-password': PAGES.ResetPassword,
  '/privacy-policy': PAGES.PrivacyPolicy,
  '/terms-of-service': PAGES.TermsOfService,
  '/account-deletion': PAGES.AccountDeletion,
  '/contact': PAGES.ContactPage,
  '/security': PAGES.SecurityPage,
  '/cookie-policy': PAGES.CookiePolicy,
  '/dashboard': PAGES.Dashboard,
  '/calendar': PAGES.Calendar,
  '/leaves': PAGES.Leaves,
  '/employees': PAGES.Employees,
  '/employees/:id': PAGES.Employees,
  '/departments': PAGES.Departments,
  '/holidays': PAGES.HolidaysPage,
  '/leave-policies': PAGES.LeavePolicies,
  '/leave-workflow': PAGES.LeaveWorkflowSettings,
  '/regularization': PAGES.Regularization,
  '/reports': PAGES.Reports,
  '/documents': PAGES.Documents,
  '/payroll/dashboard': PAGES.PayrollDashboard,
  '/payroll/salary': PAGES.SalaryStructure,
  '/payroll/settings': PAGES.PayrollSettings,
  '/payroll/generate': PAGES.PayrollGeneration,
  '/payroll/runs/:id': PAGES.PayrollRunDetails,
  '/payroll/payslips/:id': PAGES.PayslipDetails,
  '/payroll/reports': PAGES.PayrollReports,
  '/statutory/config': PAGES.StatutoryConfig,
  '/statutory/compliance': PAGES.ComplianceDashboard,
  '/statutory/declarations': PAGES.TaxDeclaration,
  '/assets': PAGES.Assets,
  '/expenses': PAGES.ExpensesPage,
  '/announcements': PAGES.AnnouncementsPage,
  '/shifts': PAGES.Shifts,
  '/performance': PAGES.Performance,
  '/onboarding': PAGES.Onboarding,
  '/exit-management': PAGES.ExitManagement,
  '/notifications': PAGES.NotificationCenter,
  '/settings': PAGES.Settings,
  '/profile': PAGES.MyProfile,
  '/pending-approvals': PAGES.PendingApprovals,
  '/roles': PAGES.RoleManagement,
  '/roles/:id/permissions': PAGES.PermissionMatrix,
  '/branches': PAGES.Branches,
  '/biometric/devices': PAGES.BiometricDevices,
  '/biometric/mapping': PAGES.BiometricPinMapping,
  '/biometric/logs': PAGES.BiometricLogs,
  '/biometric/settings': PAGES.BiometricSettings,
  '/biometric/historical-sync': PAGES.BiometricHistoricalSync,
  '/root/branch-select': PAGES.BranchSelect,
  '/root/dashboard': PAGES.RootDashboard,
  '/root/calendar': PAGES.Calendar,
  '/root/leaves': PAGES.Leaves,
  '/root/employees': PAGES.Employees,
  '/root/employees/:id': PAGES.Employees,
  '/root/departments': PAGES.Departments,
  '/root/branches': PAGES.Branches,
  '/root/holidays': PAGES.HolidaysPage,
  '/root/leave-policies': PAGES.LeavePolicies,
  '/root/leave-workflow': PAGES.LeaveWorkflowSettings,
  '/root/regularization': PAGES.Regularization,
  '/root/reports': PAGES.Reports,
  '/root/documents': PAGES.Documents,
  '/root/payroll/dashboard': PAGES.PayrollDashboard,
  '/root/payroll/salary': PAGES.SalaryStructure,
  '/root/payroll/settings': PAGES.PayrollSettings,
  '/root/payroll/generate': PAGES.PayrollGeneration,
  '/root/payroll/runs/:id': PAGES.PayrollRunDetails,
  '/root/payroll/payslips/:id': PAGES.PayslipDetails,
  '/root/payroll/reports': PAGES.PayrollReports,
  '/root/statutory/config': PAGES.StatutoryConfig,
  '/root/statutory/compliance': PAGES.ComplianceDashboard,
  '/root/statutory/declarations': PAGES.TaxDeclaration,
  '/root/assets': PAGES.Assets,
  '/root/expenses': PAGES.ExpensesPage,
  '/root/announcements': PAGES.AnnouncementsPage,
  '/root/shifts': PAGES.Shifts,
  '/root/performance': PAGES.Performance,
  '/root/onboarding': PAGES.Onboarding,
  '/root/exit-management': PAGES.ExitManagement,
  '/root/notifications': PAGES.NotificationCenter,
  '/root/settings': PAGES.Settings,
  '/root/pending-approvals': PAGES.PendingApprovals,
  '/root/manage-hr': PAGES.ManageHR,
  '/root/manage-root-admins': PAGES.ManageRootAdmins,
  '/root/roles': PAGES.RoleManagement,
  '/root/roles/:id/permissions': PAGES.PermissionMatrix,
  '/root/broadcast': PAGES.Broadcast,
  '/root/profile': PAGES.MyProfile,
  '/root/biometric/devices': PAGES.BiometricDevices,
  '/root/biometric/mapping': PAGES.BiometricPinMapping,
  '/root/biometric/logs': PAGES.BiometricLogs,
  '/root/biometric/live-logs': PAGES.BiometricLiveLogs,
  '/root/biometric/settings': PAGES.BiometricSettings,
  '/root/biometric/historical-sync': PAGES.BiometricHistoricalSync,
  '/portal/home': PAGES.EmployeeHome,
  '/portal/leaves': PAGES.MyLeaves,
  '/portal/attendance': PAGES.MyAttendance,
  '/portal/team-calendar': PAGES.TeamCalendar,
  '/portal/documents': PAGES.Documents,
  '/portal/expenses': PAGES.ExpensesPage,
  '/portal/payslips': PAGES.Payroll,
  '/portal/tax-declaration': PAGES.TaxDeclaration,
  '/portal/performance': PAGES.Performance,
  '/portal/onboarding': PAGES.Onboarding,
  '/portal/exit': PAGES.ExitManagement,
  '/portal/regularization': PAGES.Regularization,
  '/portal/notifications': PAGES.NotificationCenter,
  '/portal/announcements': PAGES.AnnouncementsPage,
  '/portal/profile': PAGES.EmployeePortalProfile,
  '/portal/dept-approvals': PAGES.DeptHeadApprovals,
  '/portal/team': PAGES.MyTeam,
  '/portal/team/:id': PAGES.TeamMemberProfile,
};

const started = new Set();

function loaderFor(pathname) {
  const clean = String(pathname || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (ROUTE_LOADERS[clean]) return ROUTE_LOADERS[clean];
  // parameterised routes: /employees/12 -> /employees/:id
  const parts = clean.split('/');
  for (const key of Object.keys(ROUTE_LOADERS)) {
    if (!key.includes(':')) continue;
    const k = key.split('/');
    if (k.length === parts.length && k.every((seg, i) => seg.startsWith(':') || seg === parts[i])) return ROUTE_LOADERS[key];
  }
  return null;
}

const saveData = () => {
  try { const c = navigator.connection; return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))); } catch { return false; }
};

/** Start downloading the chunk for `pathname` (hover / focus / touch). Fire-and-forget, once per route, never throws. */
export function prefetchRoute(pathname) {
  const load = loaderFor(pathname);
  if (!load || started.has(load) || saveData()) return;
  started.add(load);
  load().catch(() => { started.delete(load); });          // a failed prefetch is retried on the next hover; the real navigation reports its own error
}

/** Spread onto a NavLink/Link: prefetch on hover, keyboard focus and touch. */
export const prefetchProps = (to) => ({
  onMouseEnter: () => prefetchRoute(to),
  onFocus: () => prefetchRoute(to),
  onTouchStart: () => prefetchRoute(to),
});

/** Warm a few likely next routes while the browser is idle (after first paint). */
export function warmRoutes(paths = []) {
  if (typeof window === 'undefined') return () => {};
  const run = () => paths.forEach((p, i) => setTimeout(() => prefetchRoute(p), i * 150));
  if ('requestIdleCallback' in window) { const id = window.requestIdleCallback(run, { timeout: 4000 }); return () => window.cancelIdleCallback(id); }
  const id = setTimeout(run, 2000);
  return () => clearTimeout(id);
}
