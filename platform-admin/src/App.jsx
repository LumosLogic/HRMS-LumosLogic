import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PlatformAuthProvider, usePlatformAuth } from '@/context/PlatformAuthContext';
import { PlatformLayout } from '@/components/layout/PlatformLayout';
import PlatformLogin     from '@/pages/PlatformLogin';
import PlatformDashboard from '@/pages/PlatformDashboard';
import PlatformRequests  from '@/pages/PlatformRequests';
import PlatformOrgs      from '@/pages/PlatformOrgs';
import PlatformOrgDetail from '@/pages/PlatformOrgDetail';
import PlatformActivity        from '@/pages/PlatformActivity';
import PlatformActivityPlatform from '@/pages/PlatformActivityPlatform';
import PlatformActivityOrg      from '@/pages/PlatformActivityOrg';
import PlatformFeatures  from '@/pages/PlatformFeatures';

function PlatformRoute({ children }) {
  const { token } = usePlatformAuth();
  return token ? children : <Navigate to="/login" replace />;
}

function AppRoutes() {
  const { token } = usePlatformAuth();
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/dashboard" replace /> : <PlatformLogin />} />

      <Route element={<PlatformRoute><PlatformLayout /></PlatformRoute>}>
        <Route path="/dashboard"  element={<PlatformDashboard />} />
        <Route path="/requests"   element={<PlatformRequests />} />
        <Route path="/orgs"       element={<PlatformOrgs />} />
        <Route path="/orgs/:id"   element={<PlatformOrgDetail />} />
        <Route path="/activity"          element={<PlatformActivity />} />
        <Route path="/activity/platform" element={<PlatformActivityPlatform />} />
        <Route path="/activity/org"      element={<PlatformActivityOrg />} />
        <Route path="/features"   element={<PlatformFeatures />} />
      </Route>

      <Route path="*" element={<Navigate to={token ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename="/admin">
      <PlatformAuthProvider>
        <AppRoutes />
      </PlatformAuthProvider>
    </BrowserRouter>
  );
}
