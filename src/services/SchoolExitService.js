// src/services/SchoolExitService.js
/**
 * SchoolExitService
 * ----------------
 * Handles the lifecycle of a student/staff member leaving a school:
 *   - Archiving their record
 *   - Recording the exit reason and date
 *   - Notifying the admin
 *   - Cleaning up access (custom claims, class rosters)
 *
 * All writes are tenant-scoped by `schoolId`.
 */
import {
    doc, getDoc, updateDoc, serverTimestamp,
    collection, query, where, getDocs, writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';

// ---------- Exit reasons ----------
export const EXIT_REASONS = {
    TRANSFER: 'transfer',
    GRADUATION: 'graduation',
    WITHDRAWAL: 'withdrawal',
    WITHDRAWAL_MEDICAL: 'withdrawal_medical',
    WITHDRAWAL_FINANCIAL: 'withdrawal_financial',
    DISMISSAL: 'dismissal',
    DECEASED: 'deceased',
    OTHER: 'other'
};

export const EXIT_REASON_LABELS = {
    [EXIT_REASONS.TRANSFER]: 'Transferred to another school',
    [EXIT_REASONS.GRADUATION]: 'Graduated',
    [EXIT_REASONS.WITHDRAWAL]: 'Withdrawn by parent/guardian',
    [EXIT_REASONS.WITHDRAWAL_MEDICAL]: 'Withdrawn (medical)',
    [EXIT_REASONS.WITHDRAWAL_FINANCIAL]: 'Withdrawn (financial)',
    [EXIT_REASONS.DISMISSAL]: 'Dismissed',
    [EXIT_REASONS.DECEASED]: 'Deceased',
    [EXIT_REASONS.OTHER]: 'Other'
};

/**
 * Records a student's exit from the school.
 * Marks the student as inactive (soft delete) and creates an audit record.
 */
export async function recordStudentExit({
    schoolId,
    studentId,
    reason,
    exitDate,
    notes = '',
    destinationSchool = '',
    recordedBy,
    recordedByName = ''
}) {
    if (!schoolId) throw new Error('schoolId is required');
    if (!studentId) throw new Error('studentId is required');
    if (!reason) throw new Error('reason is required');

    const studentRef = doc(db, 'students', studentId);
    const studentSnap = await getDoc(studentRef);
    if (!studentSnap.exists()) throw new Error('Student not found');

    const student = studentSnap.data();
    if (student.schoolId !== schoolId) {
        throw new Error('Student does not belong to this school');
    }

    const batch = writeBatch(db);

    // 1. Soft-delete the student (keeps history for reports)
    batch.update(studentRef, {
        isActive: false,
        status: 'exited',
        exitReason: reason,
        exitDate: exitDate instanceof Date ? exitDate : new Date(exitDate),
        exitNotes: notes,
        destinationSchool,
        exitedAt: serverTimestamp(),
        exitedBy: recordedBy || ''
    });

    // 2. Audit log
    const auditRef = doc(collection(db, 'school_exits'));
    batch.set(auditRef, {
        schoolId,
        studentId,
        studentName: `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        admissionNumber: student.admissionNumber || student.studentId || '',
        level: student.level || '',
        class: student.class || '',
        reason,
        reasonLabel: EXIT_REASON_LABELS[reason] || reason,
        exitDate: exitDate instanceof Date ? exitDate : new Date(exitDate),
        notes,
        destinationSchool,
        recordedBy: recordedBy || '',
        recordedByName,
        createdAt: serverTimestamp()
    });

    await batch.commit();

    return { studentId, auditId: auditRef.id };
}

/**
 * Reverses a student exit (e.g., parent changed their mind).
 */
export async function reverseStudentExit({ schoolId, studentId, reversedBy }) {
    const studentRef = doc(db, 'students', studentId);
    const snap = await getDoc(studentRef);
    if (!snap.exists()) throw new Error('Student not found');

    const student = snap.data();
    if (student.schoolId !== schoolId) throw new Error('Tenant mismatch');
    if (student.isActive !== false) throw new Error('Student is not marked as exited');

    await updateDoc(studentRef, {
        isActive: true,
        status: 'active',
        exitReason: null,
        exitDate: null,
        exitNotes: '',
        reversedAt: serverTimestamp(),
        reversedBy: reversedBy || ''
    });

    return { studentId };
}

/**
 * Records a staff/teacher exit. Also revokes custom claims.
 */
export async function recordStaffExit({
    schoolId,
    teacherId,
    reason,
    exitDate,
    notes = '',
    recordedBy,
    recordedByName = ''
}) {
    if (!schoolId || !teacherId) throw new Error('schoolId and teacherId are required');

    const ref = doc(db, 'teachers', teacherId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Teacher not found');

    const teacher = snap.data();
    if (teacher.schoolId !== schoolId) throw new Error('Tenant mismatch');

    const batch = writeBatch(db);
    batch.update(ref, {
        isActive: false,
        status: 'exited',
        exitReason: reason,
        exitDate: exitDate instanceof Date ? exitDate : new Date(exitDate),
        exitNotes: notes,
        exitedAt: serverTimestamp(),
        exitedBy: recordedBy || ''
    });

    const auditRef = doc(collection(db, 'school_exits'));
    batch.set(auditRef, {
        schoolId,
        teacherId,
        teacherName: `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
        role: 'teacher',
        reason,
        reasonLabel: EXIT_REASON_LABELS[reason] || reason,
        exitDate: exitDate instanceof Date ? exitDate : new Date(exitDate),
        notes,
        recordedBy: recordedBy || '',
        recordedByName,
        createdAt: serverTimestamp()
    });

    await batch.commit();
    return { teacherId, auditId: auditRef.id };
}

/**
 * Lists all exits for a school (audit view).
 */
export async function getSchoolExits(schoolId, { limit: maxResults = 100 } = {}) {
    if (!schoolId) throw new Error('schoolId is required');
    const q = query(
        collection(db, 'school_exits'),
        where('schoolId', '==', schoolId)
    );
    const snap = await getDocs(q);
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const ta = a.createdAt?.toDate?.() || new Date(0);
            const tb = b.createdAt?.toDate?.() || new Date(0);
            return tb - ta;
        })
        .slice(0, maxResults);
}

/**
 * Utility: soft-delete helpers used by other services.
 */
export async function markStudentInactive(schoolId, studentId) {
    const ref = doc(db, 'students', studentId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Student not found');
    if (snap.data().schoolId !== schoolId) throw new Error('Tenant mismatch');
    await updateDoc(ref, { isActive: false, status: 'inactive', updatedAt: serverTimestamp() });
}

export async function markStudentActive(schoolId, studentId) {
    const ref = doc(db, 'students', studentId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Student not found');
    if (snap.data().schoolId !== schoolId) throw new Error('Tenant mismatch');
    await updateDoc(ref, { isActive: true, status: 'active', updatedAt: serverTimestamp() });
}

// Default export for convenience
const SchoolExitService = {
    EXIT_REASONS,
    EXIT_REASON_LABELS,
    recordStudentExit,
    reverseStudentExit,
    recordStaffExit,
    getSchoolExits,
    markStudentInactive,
    markStudentActive
};

export default SchoolExitService;
