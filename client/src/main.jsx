import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // 3-minute freshness window — HR data rarely changes second-to-second.
      // Queries that genuinely need real-time updates set their own staleTime or
      // refetchInterval explicitly (notification badge, biometric devices, dashboards).
      staleTime: 3 * 60 * 1000,
      // Disable window-focus refetch globally. The burst of simultaneous refetches
      // after alt-tab caused staggered layout updates. Per-query real-time polling
      // (refetchInterval) is unaffected and continues to work as configured.
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
