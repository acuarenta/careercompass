// sw.js — CareerCompass Service Worker
const CACHE_NAME = 'careercompass-v1';
const ASSETS = ['/', '/index.html'];

// ── Install: cache core assets ──────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate: clear old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first, cache fallback ────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/') || event.request.url.includes('/.netlify/')) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// ── Push notifications ───────────────────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'CareerCompass', {
      body: data.body || 'Time to follow up on your job applications.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || 'careercompass',
      data: { url: data.url || '/' },
      actions: [
        { action: 'open', title: 'Open App' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(wins => {
      const url = event.notification.data?.url || '/';
      const existing = wins.find(w => w.url === url && 'focus' in w);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

// ── Background sync for scheduled reminders ──────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag.startsWith('reminder-')) {
    const jobId = event.tag.replace('reminder-', '');
    event.waitUntil(fireReminder(jobId));
  }
});

async function fireReminder(jobId) {
  return self.registration.showNotification('CareerCompass Reminder', {
    body: `It's been 7 days — time to follow up on your application! Tap to open CareerCompass.`,
    tag: 'reminder-' + jobId,
    data: { url: '/' }
  });
}
