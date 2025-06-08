/**
 * StreamArtSEO - Service Worker
 * Version: 0.0.1
 * 
 * This Service Worker provides offline functionality, caching,
 * and performance optimizations for the StreamArtSEO platform.
 */

const CACHE_NAME = 'streamartseo-v0.0.1';
const RUNTIME_CACHE = 'runtime-cache';

// Resources to cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/css/critical.css',
  '/css/styles.css',
  '/js/main.js',
  '/js/lazysizes.min.js',
  '/images/youtube-placeholder.jpg',
  '/images/deviantart-placeholder.jpg',
  '/images/twitch-placeholder.jpg',
  '/images/reddit-placeholder.jpg',
  '/offline.html'
];

// Install event - precache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Caching files');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  const currentCaches = [CACHE_NAME, RUNTIME_CACHE];
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
    }).then(cachesToDelete => {
      return Promise.all(cachesToDelete.map(cacheToDelete => {
        return caches.delete(cacheToDelete);
      }));
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', event => {
  // Skip cross-origin requests
  if (event.request.url.startsWith(self.location.origin)) {
    // For HTML pages - network-first strategy
    if (event.request.headers.get('Accept').includes('text/html')) {
      event.respondWith(
        fetch(event.request)
          .then(response => {
            // Clone the response for caching
            const responseToCache = response.clone();
            
            caches.open(RUNTIME_CACHE)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            
            return response;
          })
          .catch(() => {
            // If network fails, try to serve from cache
            return caches.match(event.request)
              .then(cachedResponse => {
                if (cachedResponse) {
                  return cachedResponse;
                }
                // If not in cache, serve offline page
                return caches.match('/offline.html');
              });
          })
      );
      return;
    }
    
    // For API requests - network-only strategy
    if (event.request.url.includes('/api/')) {
      event.respondWith(
        fetch(event.request)
          .catch(() => {
            return new Response(JSON.stringify({
              error: 'Network error. You appear to be offline.'
            }), {
              headers: { 'Content-Type': 'application/json' }
            });
          })
      );
      return;
    }
    
    // For images - cache-first strategy
    if (event.request.destination === 'image') {
      event.respondWith(
        caches.match(event.request)
          .then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            return fetch(event.request)
              .then(response => {
                // Clone the response for caching
                const responseToCache = response.clone();
                
                caches.open(RUNTIME_CACHE)
                  .then(cache => {
                    cache.put(event.request, responseToCache);
                  });
                
                return response;
              })
              .catch(() => {
                // If network fails and no cache, serve placeholder
                if (event.request.url.includes('youtube')) {
                  return caches.match('/images/youtube-placeholder.jpg');
                } else if (event.request.url.includes('deviantart')) {
                  return caches.match('/images/deviantart-placeholder.jpg');
                } else if (event.request.url.includes('twitch')) {
                  return caches.match('/images/twitch-placeholder.jpg');
                } else if (event.request.url.includes('reddit')) {
                  return caches.match('/images/reddit-placeholder.jpg');
                }
                // Default placeholder
                return new Response('Image not available', {
                  headers: { 'Content-Type': 'text/plain' }
                });
              });
          })
      );
      return;
    }
    
    // For all other requests - stale-while-revalidate strategy
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          const fetchPromise = fetch(event.request)
            .then(response => {
              // Clone the response for caching
              const responseToCache = response.clone();
              
              caches.open(RUNTIME_CACHE)
                .then(cache => {
                  cache.put(event.request, responseToCache);
                });
              
              return response;
            })
            .catch(error => {
              console.error('Fetch failed:', error);
              // Return nothing, which will trigger the cached response
            });
          
          // Return cached response immediately, then update cache in background
          return cachedResponse || fetchPromise;
        })
    );
  }
});

// Background sync for offline form submissions
self.addEventListener('sync', event => {
  if (event.tag === 'sync-forms') {
    event.waitUntil(
      syncForms()
    );
  }
});

// Function to sync forms when back online
async function syncForms() {
  try {
    const db = await openDB();
    const pendingForms = await db.getAll('pending-forms');
    
    for (const form of pendingForms) {
      try {
        const response = await fetch(form.url, {
          method: form.method,
          headers: form.headers,
          body: form.body
        });
        
        if (response.ok) {
          // If successful, remove from IndexedDB
          await db.delete('pending-forms', form.id);
        }
      } catch (error) {
        console.error('Failed to sync form:', error);
      }
    }
  } catch (error) {
    console.error('Error syncing forms:', error);
  }
}

// Simple IndexedDB wrapper for storing offline forms
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('streamartseo-offline', 1);
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      db.createObjectStore('pending-forms', { keyPath: 'id', autoIncrement: true });
    };
    
    request.onsuccess = event => {
      const db = event.target.result;
      resolve({
        getAll: storeName => {
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        },
        delete: (storeName, id) => {
          return new Promise((resolve, reject) => {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
        }
      });
    };
    
    request.onerror = event => {
      reject(event.target.error);
    };
  });
}

// Push notification event
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    
    const options = {
      body: data.body,
      icon: '/images/notification-icon.png',
      badge: '/images/notification-badge.png',
      data: {
        url: data.url
      }
    };
    
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.notification.data && event.notification.data.url) {
    event.waitUntil(
      clients.openWindow(event.notification.data.url)
    );
  }
});