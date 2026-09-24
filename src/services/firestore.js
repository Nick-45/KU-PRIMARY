// src/services/firestore.js
import {
    collection, query, where, getDocs, doc, getDoc,
    orderBy, limit, startAfter, writeBatch, setDoc,
    serverTimestamp, onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { makeScoreId, makeAssessmentConfigId } from '../utils/scoreId';
import { withMemoryCache, getMemory, setMemory, idbGet, idbSet } from './cache';

// ============================================================
// TENANT GUARD — Fix #11: never default schoolId
// ============================================================
export function requireSchoolId(userData) {
    const schoolId = userData?.schoolId;
    if (!schoolId) {
        throw new Error('School context missing. Please re-login.');
    }
    return schoolId;
}

// ============================================================
// ASSESSMENT CONFIGS — Fix #5, #16: cached, filtered
// ============================================================
export async function getAssessmentConfigs(schoolId, { level, cls, subject } = {}) {
    const cacheKey = `configs_${schoolId}_${level || 'all'}_${cls || 'all'}_${subject || 'all'}`;
    const cached = getMemory(cacheKey);
    if (cached) return cached;

    const constraints = [where('schoolId', '==', schoolId)];
    if (level) constraints.push(where('level', '==', level));
    if (cls) constraints.push(where('class', '==', cls));
    if (subject) constraints.push(where('subject', '==', subject));

    const q = query(collection(db, 'assessment_configs'), ...constraints);
    const snap = await getDocs(q);
    const configs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setMemory(cacheKey, configs, 30 * 60 * 1000);
    return configs;
}

export async function saveAssessmentConfig(schoolId, { level, cls, subject, assessmentType, term, deadline, createdBy }) {
    const id = makeAssessmentConfigId(schoolId, level, cls, subject, assessmentType, term);
    const ref = doc(db, 'assessment_configs', id);
    await setDoc(ref, {
        schoolId, level, class: cls, subject, assessmentType, term,
        deadline: deadline instanceof Date ? deadline : new Date(deadline),
        createdBy: createdBy || '',
        createdAt: serverTimestamp(),
        isActive: true
    }, { merge: true });
    // Invalidate cache
    setMemory(`configs_${schoolId}_${level}_${cls}_${subject}`, null, 0);
    return id;
}

// ============================================================
// STUDENTS — Fix #6: one-time fetch, no persistent listener
// ============================================================
export async function getStudents(schoolId, level, cls, { maxResults = 500 } = {}) {
    const q = query(
        collection(db, 'students'),
        where('schoolId', '==', schoolId),
        where('level', '==', level),
        where('class', '==', cls),
        orderBy('firstName'),
        limit(maxResults)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Optional: subscribe only to a *small* page of students (10).
 * Use this for the visible page, not the whole class.
 */
export function subscribeStudentsPage(schoolId, level, cls, pageSize = 10, callback) {
    const q = query(
        collection(db, 'students'),
        where('schoolId', '==', schoolId),
        where('level', '==', level),
        where('class', '==', cls),
        orderBy('firstName'),
        limit(pageSize)
    );
    return onSnapshot(q, (snap) => {
        callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
}

// ============================================================
// SCORES — Fix #2, #13: filtered by assessmentType, deterministic IDs
// ============================================================
export async function getScores(schoolId, level, cls, subject, term, assessmentType) {
    const cacheKey = `scores_${schoolId}_${level}_${cls}_${subject}_${term}_${assessmentType}`;
    const cached = getMemory(cacheKey);
    if (cached) return cached;

    const q = query(
        collection(db, 'student_scores'),
        where('schoolId', '==', schoolId),
        where('level', '==', level),
        where('class', '==', cls),
        where('subject', '==', subject),
        where('term', '==', term),
        where('assessmentType', '==', assessmentType)
    );
    const snap = await getDocs(q);
    const scores = {};
    snap.forEach(d => {
        const data = d.data();
        if (!scores[data.studentId]) scores[data.studentId] = [];
        scores[data.studentId].push({ id: d.id, ...data });
    });
    setMemory(cacheKey, scores, 2 * 60 * 1000); // 2 min TTL for scores
    return scores;
}

/**
 * Fix #3 + #4: batch write with deterministic IDs — no existence queries.
 */
export async function saveScoresBatch(schoolId, level, cls, subject, term, assessmentType, entries, teacherMeta) {
    if (!entries || entries.length === 0) return { count: 0 };
    if (entries.length > 500) throw new Error('Batch exceeds 500 operations');

    const batch = writeBatch(db);
    const now = new Date();

    for (const { studentId, score } of entries) {
        const id = makeScoreId(studentId, subject, term, assessmentType);
        const ref = doc(db, 'student_scores', id);
        batch.set(ref, {
            studentId,
            schoolId,
            level,
            class: cls,
            subject,
            term,
            assessmentType,
            score,
            teacherId: teacherMeta.teacherId || '',
            teacherName: teacherMeta.teacherName || '',
            status: 'pending',
            recordedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
    }

    await batch.commit();

    // Invalidate score cache
    setMemory(`scores_${schoolId}_${level}_${cls}_${subject}_${term}_${assessmentType}`, null, 0);

    return { count: entries.length };
}

/**
 * Publish all scores for a given (class, subject, term, assessmentType).
 */
export async function publishScoresBatch(schoolId, level, cls, subject, term, assessmentType, studentIds) {
    const batch = writeBatch(db);
    for (const studentId of studentIds) {
        const id = makeScoreId(studentId, subject, term, assessmentType);
        batch.update(doc(db, 'student_scores', id), {
            status: 'published',
            publishedAt: serverTimestamp()
        });
    }
    await batch.commit();
    setMemory(`scores_${schoolId}_${level}_${cls}_${subject}_${term}_${assessmentType}`, null, 0);
}

// ============================================================
// CLASS SUMMARIES — Fix #14: precomputed aggregates
// ============================================================
export async function getClassSummary(schoolId, level, cls, subject, term) {
    const cacheKey = `summary_${schoolId}_${level}_${cls}_${subject}_${term}`;
    const cached = getMemory(cacheKey);
    if (cached) return cached;

    const id = `${schoolId}__${level}__${cls}__${subject}__${term}`.replace(/\s+/g, '_');
    const snap = await getDoc(doc(db, 'class_summaries', id));
    if (!snap.exists()) return null;
    const data = snap.data();
    setMemory(cacheKey, data, 5 * 60 * 1000);
    return data;
}

// ============================================================
// TENANT-SAFE STUDENT FETCH — used by CSV import
// ============================================================
export async function findStudentByAdmission(schoolId, level, cls, admissionNumber) {
    const q = query(
        collection(db, 'students'),
        where('schoolId', '==', schoolId),
        where('level', '==', level),
        where('class', '==', cls),
        where('admissionNumber', '==', admissionNumber),
        limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
}
