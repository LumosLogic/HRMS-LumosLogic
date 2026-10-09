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
      // Keep unused query results for 15 min (default 5) so a module you visited a few minutes ago opens instantly from cache;
      // freshness is still governed by staleTime / the per-query tiers, so nothing is shown stale longer than before.
      gcTime: 15 * 60 * 1000,
    },
  },
});

// BUG_220: Prevent mouse-wheel scroll from changing number input values globally.
// When a number input is focused and the user scrolls, blur it so the scroll
// moves the page instead of incrementing/decrementing the field value.
document.addEventListener('wheel', () => {
  if (document.activeElement && document.activeElement.type === 'number') {
    document.activeElement.blur();
  }
}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
