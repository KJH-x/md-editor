'use strict';

const VER = 1;
const SHELL = 'md-shell-v' + VER;
const RUNTIME = 'md-runtime-v' + VER;

const PRECACHE = [
  '/',
  '/index.html',
  '/vditor-shell.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/css/style.css',
  '/js/shell.js',
  '/js/editor.js',
  '/js/tab-store.js',
  '/js/fsa.js',
  '/js/file-io.js',
  '/js/actions.js',
  '/js/i18n/index.js',
  '/js/i18n/zh-CN.js',
  '/js/i18n/en-US.js',
  '/js/i18n/es-ES.js',
  '/js/i18n/hi-IN.js',
  '/js/i18n/ar-AR.js',
  '/js/i18n/vditor-hi.js',
  '/js/i18n/vditor-ar.js',
  '/js/ui/modal.js',
  '/js/ui/command-palette.js',
  '/js/ui/slash-menu.js',
  '/js/ui/format-bar.js',
  '/js/ui/find-replace.js',
  '/vendor/dockview/index.mjs',
  '/vendor/dockview/dockview.css',
  '/vendor/vditor/dist/index.css',
  '/vendor/vditor/dist/index.min.js',
  '/vendor/vditor/dist/js/icons/ant.js',
  '/vendor/vditor/dist/js/lute/lute.min.js',
  '/vendor/vditor/dist/js/highlight.js/highlight.min.js',
  '/vendor/vditor/dist/js/highlight.js/third-languages.js',
  '/vendor/vditor/dist/js/highlight.js/styles/github.min.css'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    Promise.allSettled(
      PRECACHE.map(function (url) {
        return caches.open(SHELL).then(function (cache) {
          return fetch(url, { cache: 'no-cache' }).then(function (response) {
            if (response.ok) cache.put(url, response);
          });
        });
      })
    ).then(function () {
      self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== SHELL && key !== RUNTIME) return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response.ok) return response;
        return caches.match('/index.html');
      }).catch(function () {
        return caches.match('/index.html');
      })
    );
    return;
  }

  if (url.pathname.indexOf('/vendor/') !== -1) {
    event.respondWith(
      caches.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response.ok) {
            var clone = response.clone();
            caches.open(RUNTIME).then(function (cache) {
              cache.put(request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(function (cached) {
      var fetchPromise = fetch(request).then(function (response) {
        if (response.ok) {
          var clone = response.clone();
          caches.open(RUNTIME).then(function (cache) {
            cache.put(request, clone);
          });
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
