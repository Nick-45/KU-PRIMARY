// src/services/reportsService.js
import { doc, getDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { getMemory, setMemory } from './cache';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load the most recent snapshot for a school.
 * Reads: up to 2 docs (report_latest + report_snapshots/{id}).
 * Falls back to the newest snapshot in the collection if `report_latest`
 * hasn't been written yet.
 */
export async function getLatestSnapshot(schoolId) {
    if (!schoolId) return null;

    const cacheKey = `snapshot_${schoolId}`;
    const cached = getMemory(cacheKey);
    if (cached) return cached;

    // 1. Read the pointer
    const pointerSnap = await getDoc(doc(db, 'report_latest', schoolId));

    let snapshotId = pointerSnap.exists()
        ? pointerSnap.data().snapshotId
        : null;

    // 2. Fallback: scan newest snapshot if pointer is missing
    if (!snapshotId) {
        const q = query(
            collection(db, 'report_snapshots'),
            where('schoolId', '==', schoolId),
            orderBy('date', 'desc'),
            limit(1)
        );
        const snap = await getDocs(q);
        if (snap.empty) return null;
        snapshotId = snap.docs[0].id;
    }

    // 3. Read the actual snapshot
    const snapDoc = await getDoc(doc(db, 'report_snapshots', snapshotId));
    if (!snapDoc.exists()) return null;

    const data = { id: snapDoc.id, ...snapDoc.data() };
    setMemory(cacheKey, data, CACHE_TTL);
    return data;
}
