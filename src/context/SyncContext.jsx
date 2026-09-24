// src/context/SyncContext.jsx
import React, {
    createContext, useContext, useState, useEffect,
    useRef, useCallback
} from 'react';
import { openDB } from 'idb';
import { db as firestore } from '../firebase';
import {
    doc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import { makeScoreId } from '../utils/scoreId';

const SyncContext = createContext();

export function useSync() {
    const ctx = useContext(SyncContext);
    if (!ctx) throw new Error('useSync must be used within a SyncProvider');
    return ctx;
}

// ------- IndexedDB config -------
const DB_NAME = 'toplink_sync';
const DB_VERSION = 1;
const STORE_QUEUE = 'sync_queue';
const STORE_KV = 'kv'; // generic key-value store for cached users, statements, etc.

export function SyncProvider({ children }) {
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );
    const [isSyncing, setIsSyncing] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [lastSync, setLastSync] = useState(null);

    const dbRef = useRef(null);
    const processingRef = useRef(false);
    const mountedRef = useRef(true);

    // ------- Open / upgrade IndexedDB -------
    const ensureDB = useCallback(async () => {
        if (dbRef.current) return dbRef.current;
        dbRef.current = await openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(STORE_QUEUE)) {
                    const q = db.createObjectStore(STORE_QUEUE, {
                        keyPath: 'id', autoIncrement: true
                    });
                    q.createIndex('by-createdAt', 'createdAt');
                }
                if (!db.objectStoreNames.contains(STORE_KV)) {
                    db.createObjectStore(STORE_KV);
                }
            }
        });
        return dbRef.current;
    }, []);

    // ------- Generic IndexedDB helpers -------
    const saveToIndexedDB = useCallback(async (key, value) => {
        const idb = await ensureDB();
        await idb.put(STORE_KV, value, key);
    }, [ensureDB]);

    const getFromIndexedDB = useCallback(async (key) => {
        const idb = await ensureDB();
        return await idb.get(STORE_KV, key);
    }, [ensureDB]);

    const deleteFromIndexedDB = useCallback(async (key) => {
        const idb = await ensureDB();
        await idb.delete(STORE_KV, key);
    }, [ensureDB]);

    // ------- Queue length tracking -------
    const refreshPendingCount = useCallback(async () => {
        try {
            const idb = await ensureDB();
            const count = await idb.count(STORE_QUEUE);
            if (mountedRef.current) setPendingCount(count);
            return count;
        } catch (e) {
            console.warn('refreshPendingCount failed:', e);
            return 0;
        }
    }, [ensureDB]);

    // ------- Add item to queue -------
    const addToSyncQueue = useCallback(async (collectionName, operation, data) => {
        const idb = await ensureDB();
        const item = {
            collection: collectionName,
            operation,
            data,
            createdAt: new Date().toISOString()
        };
        await idb.add(STORE_QUEUE, item);
        await refreshPendingCount();

        // Kick the processor if we're online
        if (navigator.onLine && !processingRef.current) {
            processSyncQueue().catch(err => console.warn('sync failed:', err));
        }
    }, [ensureDB, refreshPendingCount]);

    // ------- Apply one queued item to Firestore -------
    const applySyncItem = async (item) => {
        const { collection: collectionName, operation, data } = item;

        // Special-case: student_scores use deterministic IDs so writes are idempotent
        if (collectionName === 'student_scores') {
            const id = makeScoreId(data.studentId, data.subject, data.term, data.assessmentType);
            await setDoc(doc(firestore, 'student_scores', id), {
                ...data,
                recordedAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }, { merge: true });
            return;
        }

        // Generic path: expect data.id to be the document ID
        if (!data?.id) {
            throw new Error(`Queued item missing data.id for ${collectionName}/${operation}`);
        }

        const ref = doc(firestore, collectionName, data.id);
        const { id, ...payload } = data;

        if (operation === 'set') {
            await setDoc(ref, { ...payload, updatedAt: serverTimestamp() }, { merge: true });
        } else if (operation === 'update') {
            await updateDoc(ref, { ...payload, updatedAt: serverTimestamp() });
        } else if (operation === 'delete') {
            await deleteDoc(ref);
        } else if (operation === 'add') {
            // For adds without deterministic IDs, we lose the original client ID
            // but writes still land; skip since fee/invoice flows use set with IDs.
            console.warn('add operation not supported in sync queue — use set with id');
        } else {
            throw new Error(`Unknown operation: ${operation}`);
        }
    };

    // ------- Drain queue -------
    const processSyncQueue = useCallback(async () => {
        if (processingRef.current) return;
        if (!navigator.onLine) return;

        processingRef.current = true;
        setIsSyncing(true);

        try {
            const idb = await ensureDB();
            const items = await idb.getAll(STORE_QUEUE);
            if (items.length === 0) return;

            let remaining = [...items];

            for (const item of items) {
                try {
                    await applySyncItem(item);
                    await idb.delete(STORE_QUEUE, item.id);
                    remaining = remaining.filter(x => x.id !== item.id);
                } catch (err) {
                    console.error('Sync item failed (kept in queue):', err, item);
                    // stop processing on first failure to preserve order
                    break;
                }
            }

            if (mountedRef.current) {
                setLastSync(new Date().toISOString());
            }
            await refreshPendingCount();
        } finally {
            processingRef.current = false;
            if (mountedRef.current) setIsSyncing(false);
        }
    }, [ensureDB, refreshPendingCount]);

    // ------- Deprecated but kept for compatibility -------
    // These were used by older code; returning null/[] is safer than throwing.
    const loadDataWithOfflineCache = useCallback(async () => {
        console.warn('loadDataWithOfflineCache is deprecated — use service layer instead');
        return [];
    }, []);

    const setupRealtimeSync = useCallback(() => {
        console.warn('setupRealtimeSync is deprecated — realtime listeners removed for cost reasons');
        return () => {};
    }, []);

    // ------- Lifecycle: online/offline + init + interval -------
    useEffect(() => {
        mountedRef.current = true;

        const handleOnline = () => {
            setIsOnline(true);
            // Give the network a moment to stabilize
            setTimeout(() => processSyncQueue(), 800);
        };
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        (async () => {
            await ensureDB();
            await refreshPendingCount();
            if (navigator.onLine) {
                setTimeout(() => processSyncQueue(), 1500);
            }
        })();

        // Only poll when there's actually something to sync
        const interval = setInterval(() => {
            if (navigator.onLine && !processingRef.current) {
                refreshPendingCount().then(count => {
                    if (count > 0) processSyncQueue();
                });
            }
        }, 30000);

        return () => {
            mountedRef.current = false;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            clearInterval(interval);
        };
    }, [ensureDB, refreshPendingCount, processSyncQueue]);

    const value = {
        isOnline,
        isSyncing,
        lastSync,
        pendingCount,
        saveToIndexedDB,
        getFromIndexedDB,
        deleteFromIndexedDB,
        addToSyncQueue,
        processSyncQueue,
        // Kept for backwards compat; safe no-ops
        loadDataWithOfflineCache,
        setupRealtimeSync
    };

    return (
        <SyncContext.Provider value={value}>
            {children}
        </SyncContext.Provider>
    );
}

export default SyncContext;
