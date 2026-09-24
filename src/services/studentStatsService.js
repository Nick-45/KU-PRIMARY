// src/services/studentStatsService.js
import { db } from '../firebase';
import {
    collection,
    query,
    where,
    getCountFromServer,
} from 'firebase/firestore';

/**
 * Firestore `in` filters cap at 30 values.
 * Split into chunks and run one count per chunk, then sum.
 */
const chunk = (arr, size = 30) => {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
};

/**
 * Count documents matching a base query plus optional extra wheres.
 * Uses server-side aggregation — billed as ~1 read per 1000 docs, and
 * NO document payload is transferred.
 */
async function countQuery(col, baseWheres, extraWheres = []) {
    const q = query(col, ...baseWheres, ...extraWheres);
    const snap = await getCountFromServer(q);
    return snap.data().count;
}

/**
 * Load accurate, server-side counts for a school.
 *
 * Mirrors the filtering logic in Students.jsx:
 *   - schoolId is always applied
 *   - soft-deleted docs excluded unless includeDeleted
 *   - teacher scope (classes preferred, else levels)
 *
 * Returns:
 *   {
 *     total, active, promoted, graduated, archived,
 *     archivedOrGraduated, deleted,
 *   }
 */
export async function loadStudentStats(schoolId, {
    includeDeleted = false,
    teacherLevels = [],
    teacherClasses = [],
} = {}) {
    if (!schoolId) {
        return {
            total: 0, active: 0, promoted: 0, graduated: 0,
            archived: 0, archivedOrGraduated: 0, deleted: 0,
        };
    }

    const col = collection(db, 'students');

    // ---- Base predicate shared by every count ----
    const base = [where('schoolId', '==', schoolId)];

    // ---- Teacher scope ----
    // We handle chunking by summing. If both classes and levels are set,
    // classes take precedence (matches accessibleStudents logic).
    let scopeChunks = [[]]; // default = no scope restriction
    if (teacherClasses.length) {
        scopeChunks = chunk(teacherClasses).map(
            (c) => [where('class', 'in', c)]
        );
    } else if (teacherLevels.length) {
        scopeChunks = chunk(teacherLevels).map(
            (l) => [where('level', 'in', l)]
        );
    }

    const notDeleted = includeDeleted ? [] : [where('isDeleted', '==', false)];

    /**
     * Run a single logical count across all scope chunks and sum.
     * `extra` is an array of additional where() clauses.
     */
    const sumCount = async (extra = []) => {
        const parts = await Promise.all(
            scopeChunks.map((scope) =>
                countQuery(col, [...base, ...scope, ...notDeleted, ...extra])
            )
        );
        return parts.reduce((a, b) => a + b, 0);
    };

    // Deleted count ignores `notDeleted` by design
    const sumDeleted = async () => {
        const parts = await Promise.all(
            scopeChunks.map((scope) =>
                countQuery(col, [...base, ...scope, where('isDeleted', '==', true)])
            )
        );
        return parts.reduce((a, b) => a + b, 0);
    };

    // Run everything in parallel
    const [
        total,
        active,
        promoted,
        graduated,
        archived,
        deleted,
    ] = await Promise.all([
        sumCount(),
        sumCount([where('status', '==', 'active')]),
        sumCount([where('status', '==', 'promoted')]),
        sumCount([where('status', '==', 'graduated')]),
        sumCount([where('status', '==', 'archived')]),
        sumDeleted(),
    ]);

    return {
        total,
        active,
        promoted,
        graduated,
        archived,
        archivedOrGraduated: archived + graduated,
        deleted,
    };
}
