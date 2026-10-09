import React, { Suspense, useLayoutEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

/**
 * Placeholder shown INSIDE the content area while a page's code (or first data gate) is loading.
 * It reserves the same height as `.loading` / `.empty-state` (14rem) and mimics a page header + cards, so the area never
 * collapses to nothing and nothing jumps when the real page replaces it. The sidebar and header stay on screen.
 */
export function PageFallback() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading page" style={{ minHeight: '14rem' }}>
      <div className="skeleton" style={{ height: 28, width: '28%', maxWidth: 280, marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '42%', maxWidth: 420, marginBottom: 24 }} />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {[0, 1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 96 }} />)}
      </div>
      <div className="skeleton" style={{ height: 260, marginTop: 20 }} />
    </div>
  );
}

/**
 * The routed page area of every layout. Replaces a bare <Outlet />:
 *  • Suspense lives HERE, so a lazy page that is still downloading shows <PageFallback /> in the content area only —
 *    the sidebar / header (siblings, outside this boundary) are never replaced by a spinner.
 *    (With the router's startTransition flag the previous page simply stays on screen until the next one is ready.)
 *  • On a pathname change the scroll container is reset to the top and gets a 140 ms opacity fade-in (CSS .page-in,
 *    disabled for prefers-reduced-motion). Opacity only — no transform, so fixed/sticky descendants are unaffected.
 * It re-renders only for the location, adds no DOM wrapper and does not remount the page.
 */
export function PageOutlet({ scrollRef }) {
  const { pathname } = useLocation();
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = scrollRef && scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    el.classList.remove('page-in');
    void el.offsetWidth;            // restart the CSS animation
    el.classList.add('page-in');
  }, [pathname, scrollRef]);

  return <Suspense fallback={<PageFallback />}><Outlet /></Suspense>;
}
