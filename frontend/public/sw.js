// Basic Service Worker for MaintAI PWA
self.addEventListener('install', (event) => {
  console.log('MaintAI Service Worker: Installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('MaintAI Service Worker: Activated');
});

self.addEventListener('fetch', (event) => {
  // Pass-through (no caching for now to avoid issues in dev)
  event.respondWith(fetch(event.request));
});
