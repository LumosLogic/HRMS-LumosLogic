import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import PublicNav from './PublicNav';
import PublicFooter from './PublicFooter';

const CANONICAL_BASE = 'https://hrms.lumoslogic.com';

function upsertMeta(attr, key, content) {
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

// Sets the document title, meta description, Open Graph tags and canonical URL
// for the public legal/support pages (a lightweight SPA-friendly SEO approach).
function useSeo({ title, description, path }) {
  useEffect(() => {
    document.title = title;
    upsertMeta('name', 'description', description);
    upsertMeta('property', 'og:title', title);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:url', CANONICAL_BASE + path);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', CANONICAL_BASE + path);
  }, [title, description, path]);
}

export default function LegalLayout({ title, description, path, children }) {
  const { pathname, hash } = useLocation();
  const scrollRef = useRef(null);

  useSeo({ title, description, path });

  // Scroll the page's scroll container back to top on page change
  // (unless jumping to an in-page anchor).
  useEffect(() => {
    if (!hash && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [pathname, hash]);

  return (
    <div ref={scrollRef} className="h-screen overflow-y-auto overflow-x-hidden w-full bg-[#f9f9ff]">
      <PublicNav />
      <main className="pt-16">{children}</main>
      <PublicFooter />
    </div>
  );
}
