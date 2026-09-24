// src/services/cache.js

/**
 * Two-tier cache: in-memory (per session) + IndexedDB (persistent).
 * 
 * - Memory cache: survives re-renders, cleared on page reload.
 * - IndexedDB: survives reloads, useful for offline support.
 * 
 * TTLs are per-key and configurable.
 */

const MEMORY_TTL_MS = 5 * 60 * 1000;      // 5 minutes for hot data
const CONFIG_TTL_MS = 30 * 60 * 1000;     // 30 minutes for assessment configs

const memoryCache = new Map();

function isExpired(entry) {
    return entry && entry.expiresAt && Date.now() > entry.expiresAt;
}

export function getMemory(key) {
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (isExpired(entry)) {
        memoryCache.delete(key);
        return null;
    }
    return entry.value;
}

export function setMemory(key, value, ttlMs = MEMORY_TTL_MS) {
    memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
    });
}

export function clearMemory(prefix) {
    if (!prefix) {
        memoryCache.clear();
        return;
    }
    for (const key of memoryCache.keys()) {
        if (key.startsWith(prefix)) memoryCache.delete(key);
    }
}

/**
 * Wraps an async fetcher with memory caching.
 * If the value is cached and fresh, returns it without calling the fetcher.
 */
export async function withMemoryCache(key, fetcher, ttlMs = MEMORY_TTL_MS) {
    const cached = getMemory(key);
    if (cached !== null && cached !== undefined) {
        return { data: cached, fromCache: true };
    }
    const data = await fetcher();
    setMemory(key, data, ttlMs);
    return { data, fromCache: false };
}

// ---- IndexedDB helpers (used by SyncContext, kept here for reuse) ----

const DB_NAME = 'toplink_cache';
const DB_VERSION = 1;
const STORE_NAME = 'kv';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function idbGet(storeKey) {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(storeKey);
            req.onsuccess = () => resolve(req.result?.value ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.warn('idbGet failed:', e);
        return null;
    }
}

export async function idbSet(storeKey, value) {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ id: storeKey, value, savedAt: Date.now() });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.warn('idbSet failed:', e);
        return false;
    }
}
