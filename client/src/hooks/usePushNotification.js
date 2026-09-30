import { useState, useEffect, useCallback } from 'react';
import { apiPost, apiDelete } from '@/lib/api';

// VAPID public key — must match VAPID_PUBLIC_KEY on the server
const VAPID_PUBLIC_KEY = 'BPHtP5JayS-VUWhf4mBAFBWGUdRxaAoGR9G1RLP_nmnUD2PiBHPfhUslDDy0YIgxc63z--ADuzsOkDJN2d8Y-vE';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

const isSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function usePushNotification(userId) {
  const [permission, setPermission] = useState(
    isSupported() ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);

  // Register service worker once on mount
  useEffect(() => {
    if (!isSupported() || !userId) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, [userId]);

  // If permission already granted, auto-subscribe
  useEffect(() => {
    if (!isSupported() || !userId || permission !== 'granted') return;
    autoSubscribe();
  }, [userId, permission]);

  async function autoSubscribe() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      if (sub) {
        setSubscribed(true);
        apiPost('/push/subscribe', {
          subscription: sub.toJSON(),
          endpoint:     sub.endpoint,
          userAgent:    navigator.userAgent,
        }).catch(() => {});
      }
    } catch {}
  }

  const requestAndSubscribe = useCallback(async () => {
    if (!isSupported()) return;
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== 'granted') return;
    try {
      const reg  = await navigator.serviceWorker.ready;
      const sub  = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      // Mark as subscribed immediately once local subscription is created
      setSubscribed(true);
      // Sync with server (non-blocking — badge already shows Enabled)
      apiPost('/push/subscribe', {
        subscription: sub.toJSON(),
        endpoint:     sub.endpoint,
        userAgent:    navigator.userAgent,
      }).catch(err => console.warn('[Push] Server sync failed:', err.message));
    } catch (err) {
      console.warn('[Push] Subscribe failed:', err.message);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      await apiDelete('/push/unsubscribe');
      setSubscribed(false);
    } catch {}
  }, []);

  return { permission, subscribed, requestAndSubscribe, unsubscribe, isSupported: isSupported() };
}
