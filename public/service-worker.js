// public/service-worker.js
const CACHE_NAME = 'edupriva-v1';
const RUNTIME_CACHE = 'edupriva-runtime';

// Assets to cache on install
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/logo.png',
    '/manifest.json',
    '/favicon.ico',
    // Add your static assets here
];

// Install event - cache essential assets
self.addEventListener('install', function(event) {
    console.log('📦 Service Worker installing...');
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function(cache) {
                console.log('📦 Pre-caching essential assets');
                return cache.addAll(PRECACHE_ASSETS);
            })
            .then(function() {
                console.log('✅ Service Worker installed successfully');
                return self.skipWaiting();
            })
            .catch(function(error) {
                console.error('❌ Service Worker installation failed:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', function(event) {
    console.log('🔧 Service Worker activating...');
    
    const cacheWhitelist = [CACHE_NAME, RUNTIME_CACHE];
    
    event.waitUntil(
        caches.keys()
            .then(function(cacheNames) {
                return Promise.all(
                    cacheNames.map(function(cacheName) {
                        if (!cacheWhitelist.includes(cacheName)) {
                            console.log('🗑️ Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(function() {
                console.log('✅ Service Worker activated successfully');
                return self.clients.claim();
            })
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', function(event) {
    const request = event.request;
    const url = new URL(request.url);
    
    // Skip cross-origin requests
    if (url.origin !== self.location.origin) {
        return;
    }
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip Firebase and analytics requests
    if (url.pathname.includes('firebase') || 
        url.pathname.includes('google-analytics') ||
        url.pathname.includes('cloudinary')) {
        return;
    }
    
    event.respondWith(
        caches.match(request)
            .then(function(cachedResponse) {
                // Return cached response if available
                if (cachedResponse) {
                    // Update cache in background for stale-while-revalidate
                    if (navigator.onLine) {
                        fetch(request)
                            .then(function(networkResponse) {
                                if (networkResponse && networkResponse.status === 200) {
                                    const cache = caches.open(RUNTIME_CACHE);
                                    cache.then(function(c) {
                                        c.put(request, networkResponse.clone());
                                    });
                                }
                            })
                            .catch(function(error) {
                                // Silent fail
                            });
                    }
                    return cachedResponse;
                }
                
                // If not in cache, fetch from network
                return fetch(request)
                    .then(function(networkResponse) {
                        // Cache successful responses
                        if (networkResponse && networkResponse.status === 200) {
                            const responseClone = networkResponse.clone();
                            caches.open(RUNTIME_CACHE)
                                .then(function(cache) {
                                    cache.put(request, responseClone);
                                })
                                .catch(function(error) {
                                    console.error('Error caching response:', error);
                                });
                        }
                        return networkResponse;
                    })
                    .catch(function(error) {
                        console.error('Fetch error:', error);
                        // Return offline fallback for HTML pages
                        if (request.headers.get('accept').includes('text/html')) {
                            return caches.match('/offline.html');
                        }
                        // Return error response
                        return new Response('Offline - Please check your connection.', {
                            status: 503,
                            statusText: 'Service Unavailable'
                        });
                    });
            })
    );
});

// Background sync for offline operations
self.addEventListener('sync', function(event) {
    if (event.tag === 'sync-data') {
        console.log('🔄 Background sync triggered');
        event.waitUntil(
            // Notify all clients to sync data
            self.clients.matchAll()
                .then(function(clients) {
                    clients.forEach(function(client) {
                        client.postMessage({
                            type: 'SYNC_TRIGGERED',
                            timestamp: Date.now()
                        });
                    });
                })
        );
    }
});

// Message handling for communication with main thread
self.addEventListener('message', function(event) {
    const data = event.data;
    
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (data.type === 'GET_VERSION') {
        event.ports[0].postMessage({
            version: CACHE_NAME,
            timestamp: Date.now()
        });
    }
});

// Handle push notifications
self.addEventListener('push', function(event) {
    const data = event.data.json();
    
    const options = {
        body: data.body || 'New notification from Edupriva',
        icon: '/logo-192.png',
        badge: '/logo-192.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/',
            timestamp: Date.now()
        },
        actions: [
            {
                action: 'view',
                title: 'View'
            },
            {
                action: 'dismiss',
                title: 'Dismiss'
            }
        ]
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title || 'Edupriva', options)
    );
});

// Handle notification click
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    const url = event.notification.data.url || '/';
    
    event.waitUntil(
        clients.matchAll({ type: 'window' })
            .then(function(windowClients) {
                // Check if there's already a window/tab open with the target URL
                for (let i = 0; i < windowClients.length; i++) {
                    const client = windowClients[i];
                    if (client.url === url && 'focus' in client) {
                        return client.focus();
                    }
                }
                // If not, open a new window
                if (clients.openWindow) {
                    return clients.openWindow(url);
                }
            })
    );
});
